(() => {
  'use strict';

  // Same SVG coordinate system as the interactive target: centre 50, radius 46.
  const OUTER_R = 46, CX = 540, CY = 650, R = 466;
  const valueOf = arrow => arrow && arrow.label === 'M' ? 0 : Number(arrow && arrow.score) || 0;
  const coordinate = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value));

  function geometry(arrows) {
    return arrows.filter(a => a && a.label !== 'M' && coordinate(a.x) && coordinate(a.y))
      .map(a => ({ x: CX + (Number(a.x) - 50) / OUTER_R * R, y: CY + (Number(a.y) - 50) / OUTER_R * R }));
  }

  // Compact Gaussian KDE. Fixed bandwidth in target units keeps separated groups
  // separate and makes density comparable across sessions, independent of score.
  function densityAt(points, x, y, bandwidth = .055) {
    const sigma = R * bandwidth, cutoff2 = (sigma * 3.5) ** 2;
    let density = 0;
    for (const p of points) {
      const distance2 = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (distance2 <= cutoff2) density += Math.exp(-distance2 / (2 * sigma ** 2));
    }
    return density;
  }

  function colorAt(density) {
    // A single isolated arrow cannot become a yellow peak through max-normalization.
    const q = 1 - Math.exp(-density / 8);
    const stops = [[0, 15, 70, 255], [.18, 72, 40, 220], [.36, 180, 28, 170],
      [.55, 245, 38, 65], [.74, 255, 125, 20], [.9, 255, 220, 70], [1, 255, 248, 210]];
    let i = 1;
    while (i < stops.length - 1 && q > stops[i][0]) i++;
    const a = stops[i - 1], b = stops[i], t = (q - a[0]) / (b[0] - a[0]);
    return a.slice(1).map((v, j) => Math.round(v + (b[j + 1] - v) * t));
  }

  function drawTarget(ctx, points) {
    const fills = ['#202124', '#202124', '#08090b', '#08090b', '#06202e', '#06202e', '#320c12', '#320c12', '#322b0b', '#322b0b'];
    fills.forEach((fill, i) => {
      ctx.beginPath(); ctx.arc(CX, CY, R * (10 - i) / 10, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#44454a'; ctx.lineWidth = 1; ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(CX, CY, R * .05, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '16px Arial, sans-serif'; ctx.fillStyle = '#899099';
    for (let score = 1; score <= 10; score++) {
      const x = CX + R * (10.5 - score) / 10;
      if (!points.some(p => Math.hypot(p.x - x, p.y - CY) < 22)) ctx.fillText(String(score), x, CY + 5);
    }
  }

  function drawNebula(ctx, points) {
    if (!points.length) return;
    const size = 400, heat = document.createElement('canvas'); heat.width = heat.height = size;
    const hctx = heat.getContext('2d'), image = hctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xx = CX - R + (x + .5) / size * R * 2, yy = CY - R + (y + .5) / size * R * 2;
      const density = densityAt(points, xx, yy);
      if (density < .035) continue;
      const i = (y * size + x) * 4, color = colorAt(density);
      image.data[i] = color[0]; image.data[i + 1] = color[1]; image.data[i + 2] = color[2];
      // Fine-scale KDE adds soft internal filaments only where measured density exists.
      const fine = densityAt(points, xx, yy, .018);
      const detail = .82 + .18 * Math.min(1, fine / Math.max(density * .3, .001));
      image.data[i + 3] = 235 * (1 - Math.exp(-density / 4)) * detail;
    }
    hctx.putImageData(image, 0, 0);
    ctx.save(); ctx.beginPath(); ctx.arc(CX, CY, R, 0, Math.PI * 2); ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = 'blur(12px)'; ctx.globalAlpha = .65;
    ctx.drawImage(heat, CX - R, CY - R, R * 2, R * 2);
    ctx.filter = 'none'; ctx.globalAlpha = 1;
    ctx.drawImage(heat, CX - R, CY - R, R * 2, R * 2);
    ctx.restore();
  }

  function drawStars(ctx, points) {
    // No jitter, clamping, merging, or synthetic marks. Even coincident arrows
    // each receive a drawing operation at their original transformed position.
    points.forEach(p => {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 17);
      halo.addColorStop(0, 'rgba(230,241,255,.85)'); halo.addColorStop(1, 'rgba(130,175,255,0)');
      ctx.fillStyle = halo; ctx.fillRect(p.x - 17, p.y - 17, 34, 34);
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x + 1.5, p.y - 1.5);
      ctx.lineTo(p.x + 10, p.y); ctx.lineTo(p.x + 1.5, p.y + 1.5);
      ctx.lineTo(p.x, p.y + 10); ctx.lineTo(p.x - 1.5, p.y + 1.5);
      ctx.lineTo(p.x - 10, p.y); ctx.lineTo(p.x - 1.5, p.y - 1.5); ctx.closePath();
      ctx.fillStyle = 'rgba(238,246,255,.85)'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.restore();
    });
  }

  function createCanvas({ arrows = [], date = '', sessionType = 'training', rounds, arrowsPerEnd } = {}) {
    const points = geometry(arrows), canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 1080, 1350);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff'; ctx.font = '600 55px Arial, sans-serif'; ctx.fillText('Constelación de flechas', CX, 91);
    ctx.fillStyle = '#b8cde2'; ctx.font = '26px Arial, sans-serif';
    ctx.fillText(['competition', 'Tournament'].includes(sessionType) ? 'Sesión de competencia' : 'Sesión de entrenamiento', CX, 133);
    const parsed = new Date(`${date}T12:00:00`);
    const dateText = Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('es-BO').format(parsed);
    ctx.font = '23px Arial, sans-serif'; ctx.fillText(`Fecha: ${dateText}`, CX, 168);
    drawTarget(ctx, points); drawNebula(ctx, points); drawStars(ctx, points);
    const total = arrows.reduce((sum, a) => sum + valueOf(a), 0);
    const stats = [[rounds ?? '—', ['Rondas']], [arrowsPerEnd ?? '—', ['Flechas por', 'ronda']],
      [arrows.length, ['Flechas totales', 'de sesión']], [(arrows.length ? total / arrows.length : 0).toFixed(2).replace('.', ','), ['Promedio']], [total, ['Puntos totales']]];
    stats.forEach(([value, lines], i) => {
      const x = 108 + i * 216;
      if (i) { ctx.strokeStyle = '#29333f'; ctx.beginPath(); ctx.moveTo(i * 216, 1150); ctx.lineTo(i * 216, 1230); ctx.stroke(); }
      ctx.fillStyle = '#ffffff'; ctx.font = '600 42px Arial, sans-serif'; ctx.fillText(String(value), x, 1184, 200);
      ctx.fillStyle = '#b8cde2'; ctx.font = '20px Arial, sans-serif'; lines.forEach((line, j) => ctx.fillText(line, x, 1216 + j * 24));
    });
    ctx.fillStyle = '#b8cde2'; ctx.font = '23px Arial, sans-serif'; ctx.fillText('arbatarchery.com', CX, 1290);
    ctx.fillStyle = '#778899'; ctx.font = '16px Arial, sans-serif'; ctx.fillText('v1.2', CX, 1324);
    return canvas;
  }

  window.ArbatConstellation = { createCanvas };
})();
