(() => {
  'use strict';

  const width = 1080, height = 1620, fps = 30, transition = 500, samples = 64;
  const verticalInset = (height - 1350) / 2;
  const targetRadius = 466, constellationCenterY = 650;
  const palette = ['#626870', '#262930', '#19465f', '#842e2d', '#8e6616'];
  const directions = Array.from({ length: samples }, (_, i) => {
    const angle = i * Math.PI * 2 / samples;
    return [Math.cos(angle), Math.sin(angle)];
  });
  const mix = (a, b, t) => a + (b - a) * t;

  // Compact Gaussian KDE. Fixed bandwidth in target units keeps separated groups
  // separate and makes density comparable across sessions, independent of score.
  function densityAt(points, x, y, bandwidth) {
    const sigma = targetRadius * bandwidth, cutoff2 = (sigma * 3.5) ** 2;
    let density = 0;
    for (const p of points) {
      const distance2 = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (distance2 <= cutoff2) density += Math.exp(-distance2 / (2 * sigma ** 2));
    }
    return density;
  }

  function colorAt(density) {
    // A single isolated arrow cannot become a yellow peak through max-normalization.
    const q = 1 - Math.exp(-density / 4);
    const stops = [[0, 15, 70, 255], [.28, 35, 85, 255], [.42, 150, 32, 190],
      [.55, 245, 38, 65], [.74, 255, 125, 20], [.9, 255, 220, 70], [1, 255, 248, 210]];
    let i = 1;
    while (i < stops.length - 1 && q > stops[i][0]) i++;
    const a = stops[i - 1], b = stops[i], t = (q - a[0]) / (b[0] - a[0]);
    return a.slice(1).map((v, j) => Math.round(v + (b[j + 1] - v) * t));
  }

  function createCloud(points) {
    if (!points.length) return null;
    const size = 192, heat = document.createElement('canvas'); heat.width = heat.height = size;
    const hctx = heat.getContext('2d'), image = hctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xx = width / 2 - targetRadius + (x + .5) / size * targetRadius * 2, yy = constellationCenterY - targetRadius + (y + .5) / size * targetRadius * 2;
      // Wider gas field blends nearby impacts without moving a single star.
      const density = densityAt(points, xx, yy, .08);
      if (density < .035) continue;
      const i = (y * size + x) * 4, color = colorAt(density);
      image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2];
      // Fine-scale KDE adds soft internal filaments only where measured density exists.
      const fine = densityAt(points, xx, yy, .018);
      const detail = .82 + .18 * Math.min(1, fine / Math.max(density * .3, .001));
      image.data[i + 3] = 245 * (1 - Math.exp(-density / 2)) * detail;
    }
    hctx.putImageData(image, 0, 0);
    return heat;
  }

  function outline(points) {
    if (!points.length) return [];
    const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    // Intersect rays with the supporting lines of the group, plus a small
    // margin for the stars and for groups with only one or two distinct hits.
    const supports = directions.map(([x, y]) =>
      Math.max(...points.map(p => (p.x - cx) * x + (p.y - cy) * y)) + 8);
    return directions.map(([x, y]) => {
      let radius = Infinity;
      directions.forEach(([nx, ny], i) => {
        const dot = nx * x + ny * y;
        if (dot > 0) radius = Math.min(radius, supports[i] / dot);
      });
      return { x: cx + x * radius, y: cy + y * radius };
    });
  }

  function groups(session, constellation) {
    const ends = (session.completed || []).map((end, i) => ({
      number: end.ordinal ?? i + 1, arrows: end.arrows || []
    }));
    if (session.current?.length) ends.push({ number: ends.length + 1, arrows: session.current });
    if (!ends.some(end => end.arrows.length) && session.arrows?.length) {
      ends.push({ number: 1, arrows: session.arrows });
    }
    return ends.filter(end => end.arrows.length).map(end => {
      const points = constellation.geometry(end.arrows);
      const average = end.arrows.reduce((sum, arrow) => sum + constellation.valueOf(arrow), 0) / end.arrows.length;
      const color = palette[Math.max(0, Math.min(4, Math.floor((Math.round(average) - 1) / 2)))];
      return { ...end, points, outline: outline(points), cloud: createCloud(points),
        color: color.slice(1).match(/../g).map(channel => parseInt(channel, 16)) };
    });
  }

  // Equal time between ends: use a shared, monotone tangent on both
  // sides of each recorded shape to avoid overshooting its coordinates.
  function tangent(incoming, outgoing) {
    if (incoming * outgoing <= 0) return 0;
    return 2 * incoming * outgoing / (incoming + outgoing);
  }

  function interpolateContour(previous, from, to, next, progress, eased) {
    const change = to - from;
    const start = tangent(from - previous, change);
    const end = tangent(change, next - to);
    const remaining = 1 - progress;
    return mix(from, to, eased) + progress * remaining *
      (remaining * start - progress * end);
  }

  function drawOutline(ctx, previous, from, to, next, progress, t) {
    if (!from.outline.length && !to.outline.length) return;
    const a = from.outline.length ? from.outline : to.outline;
    const b = to.outline.length ? to.outline : from.outline;
    const points = a.map((p, i) => {
      const q = b[i];
      const before = from.outline.length && previous.outline.length ? previous.outline[i] : p;
      const after = to.outline.length && next.outline.length ? next.outline[i] : q;
      return {
        x: interpolateContour(before.x, p.x, q.x, after.x, progress, t),
        y: interpolateContour(before.y, p.y, q.y, after.y, progress, t)
      };
    });
    const color = from.color.map((channel, i) => Math.round(mix(channel, to.color[i], t)));
    ctx.save();
    ctx.globalAlpha = mix(Number(Boolean(from.outline.length)), Number(Boolean(to.outline.length)), t);
    ctx.beginPath();
    const first = points[0], last = points[points.length - 1];
    ctx.moveTo((first.x + last.x) / 2, (first.y + last.y) / 2);
    points.forEach((point, i) => {
      const next = points[(i + 1) % points.length];
      ctx.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(' + color.join(',') + ',0.7)';
    ctx.fill();
    ctx.strokeStyle = 'rgb(' + color.map(channel => Math.round(mix(channel, 255, 0.48))).join(',') + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function renderFrame(ctx, backdrop, ends, constellation, time) {
    const index = Math.floor(time / transition) % ends.length;
    const from = ends[index], to = ends[(index + 1) % ends.length];
    const progress = ends.length === 1 ? 0 : (time % transition) / transition;
    const t = progress * progress * (3 - 2 * progress);
    ctx.drawImage(backdrop, 0, 0);
    ctx.save();
    ctx.translate(0, 15 + verticalInset);
    const previous = ends[(index + ends.length - 1) % ends.length];
    const next = ends[(index + 2) % ends.length];
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, constellationCenterY, targetRadius, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    for (const [group, opacity] of [[from, 1 - t], [to, t]]) {
      if (!group.cloud || !opacity) continue;
      ctx.globalAlpha = 0.38 * opacity;
      ctx.drawImage(group.cloud, width / 2 - targetRadius, constellationCenterY - targetRadius,
        targetRadius * 2, targetRadius * 2);
    }
    ctx.restore();
    drawOutline(ctx, previous, from, to, next, progress, t);
    ctx.globalAlpha = 1 - t;
    constellation.drawStars(ctx, from.points);
    if (t > 0) {
      ctx.globalAlpha = t;
      constellation.drawStars(ctx, to.points);
    }
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = '28px Arial, sans-serif';
    ctx.fillText('Andanada ' + String((progress < 0.5 ? from : to).number).padStart(2, '0'), width / 2, 202 + verticalInset - 60);
  }

  function makeCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function backdropFor(session, profile, constellation) {
    const canvas = makeCanvas(), ctx = canvas.getContext('2d');
    const metadata = constellation.createSessionCanvas(session, profile, true);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(metadata, 0, 0, width, 200, 0, verticalInset - 60, width, 200);
    ctx.drawImage(metadata, 0, 1130, width, 220, 0, 1130 + verticalInset + 65, width, 220);
    const fills = ['#202124', '#202124', '#090a0c', '#090a0c', '#061d2a', '#061d2a',
      '#290c10', '#290c10', '#2a2309', '#2a2309'];
    fills.forEach((fill, i) => {
      ctx.beginPath();
      ctx.arc(width / 2, 665 + verticalInset, targetRadius * (10 - i) / 10, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = i === 0 ? '#363839' : '#08090a';
      ctx.stroke();
    });
    return canvas;
  }

  async function record(canvas, draw, duration, signal, update) {
    const types = ['video/mp4;codecs=avc1.420033', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = types.find(type => window.MediaRecorder?.isTypeSupported(type));
    if (!mimeType || !canvas.captureStream) throw new Error('Este navegador no permite grabar el video.');
    const stream = canvas.captureStream(fps);
    try {
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4500000 });
      const chunks = [];
      let frame, start;
      const clip = await new Promise((resolve, reject) => {
        const finish = () => {
          cancelAnimationFrame(frame);
          if (recorder.state !== 'inactive') recorder.stop();
        };
        signal.addEventListener('abort', finish, { once: true });
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => {
          cancelAnimationFrame(frame);
          signal.removeEventListener('abort', finish);
          reject(new Error('No se pudo grabar el video.'));
        };
        recorder.onstop = () => {
          signal.removeEventListener('abort', finish);
          const blob = new Blob(chunks, { type: recorder.mimeType });
          if (signal.aborted || blob.size) resolve(blob);
          else reject(new Error('El navegador no produjo un video.'));
        };
        const tick = now => {
          start ??= now;
          const elapsed = now - start;
          if (elapsed >= duration) { finish(); return; }
          draw(Math.floor(elapsed * fps / 1000) * 1000 / fps);
          update(Math.floor(elapsed / duration * 100));
          frame = requestAnimationFrame(tick);
        };
        draw(0);
        recorder.start();
        frame = requestAnimationFrame(tick);
      });
      return clip;
    } finally {
      stream.getTracks().forEach(track => track.stop());
    }
  }

  let active;
  async function open(session, profile) {
    if (active?.open) return;
    const constellation = window.ArbatConstellation;
    const ends = groups(session, constellation);
    const dialog = document.createElement('dialog');
    active = dialog;
    dialog.style.cssText = 'color:white;background:#14181d;border:0;border-radius:12px;padding:0;max-width:100vw';
    dialog.setAttribute('aria-label', 'Respiración de grupos');
    const status = document.createElement('p'), actions = document.createElement('div');
    status.style.margin = '1rem';
    actions.style.padding = '0.75rem 1rem';
    status.setAttribute('role', 'status');
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Cerrar';
    close.addEventListener('click', () => dialog.close());
    const video = document.createElement('video'), download = document.createElement('a');
    video.controls = video.loop = video.playsInline = video.autoplay = video.muted = true;
    video.style.cssText = 'width:auto;height:min(84vh, calc(100vw * 3 / 2));max-width:100%;margin:0';
    video.hidden = download.hidden = true;
    video.style.display = 'none';
    download.textContent = 'Guardar video';
    download.style.marginInlineEnd = '1em';
    const controller = new AbortController();
    let url;
    dialog.addEventListener('close', () => {
      controller.abort();
      video.pause();
      if (url) URL.revokeObjectURL(url);
      dialog.remove();
      if (active === dialog) active = null;
    }, { once: true });
    actions.append(download, close);
    dialog.append(status, video, actions);
    document.body.append(dialog);
    dialog.showModal();
    if (!ends.length) { status.textContent = 'Esta sesión todavía no tiene flechas.'; return; }
    try {
      const canvas = makeCanvas(), ctx = canvas.getContext('2d');
      const backdrop = backdropFor(session, profile, constellation);
      status.textContent = 'Generando video…';
      const blob = await record(canvas, time => renderFrame(ctx, backdrop, ends, constellation, time),
        ends.length * transition, controller.signal, percent => {
          const message = 'Generando video… ' + percent + ' %';
          if (status.textContent !== message && percent % 10 === 0) status.textContent = message;
        });
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      video.src = download.href = url;
      const extension = blob.type.startsWith('video/mp4') ? 'mp4' : 'webm';
      download.download = 'arbat-respiracion-' + (session.date || 'sesion') + '.' + extension;
      status.hidden = true;
      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
        const type = extension === 'mp4' ? 'video/mp4' : 'video/webm';
        const file = new File([blob], download.download, { type });
        const shareData = { files: [file] };
        if (navigator.canShare(shareData)) {
          download.addEventListener('click', async event => {
            event.preventDefault();
            try {
              await navigator.share(shareData);
            } catch (error) {
              if (error.name === 'AbortError' || controller.signal.aborted) return;
              const fallback = download.cloneNode(false);
              actions.append(fallback);
              fallback.click();
              fallback.remove();
            }
          });
        }
      }
      video.hidden = download.hidden = false;
      video.style.display = 'block';
      video.play().catch(() => {});
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error.message || 'No se pudo generar el video.';
    }
  }

  window.ArbatGroupBreathing = { open };
})();
