(() => {
  'use strict';

  const OUTER_R = 46;
  const valueOf = arrow => arrow && arrow.label === 'M' ? 0 : Number(arrow && arrow.score) || 0;

  function createCanvas({ arrows = [], date = '', sessionType = 'training', shootingDistance = '', targetSize = '' } = {}) {
    if (!arrows.length) return null;
    const visible = arrows.filter(arrow => arrow.label !== 'M' && Number.isFinite(Number(arrow.x)) && Number.isFinite(Number(arrow.y)));
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
    canvas.width = 1080; canvas.height = 1350;
    const W = canvas.width, H = canvas.height, cx = 540, cy = 650, targetR = 466;

    ctx.fillStyle = '#fffdf9'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#11131a'; ctx.font = '500 51px Arial, sans-serif';
    ctx.fillText('CONSTELACIÓN DE FLECHAS', cx, 102);
    const parsedDate = new Date(`${date}T12:00:00`);
    const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    const validDate = !Number.isNaN(parsedDate.getTime());
    const dateText = validDate ? `${String(parsedDate.getDate()).padStart(2, '0')} ${months[parsedDate.getMonth()]} ${parsedDate.getFullYear()}` : '';
    const sessionLabel = sessionType === 'competition' || sessionType === 'Tournament' ? 'Sesión de competencia' : 'Sesión de entrenamiento';
    ctx.fillStyle = '#68727a'; ctx.font = '400 22px Arial, sans-serif';
    ctx.fillText(`${sessionLabel}${dateText ? ` · ${dateText}` : ''}`, cx, 140);
    const measurements = [];
    if (String(shootingDistance).trim()) measurements.push(`Distancia: ${shootingDistance} m`);
    if (String(targetSize).trim()) measurements.push(`Diana: ${targetSize} cm`);
    if (measurements.length) {
      ctx.fillStyle = '#4d5660'; ctx.font = '600 20px Arial, sans-serif';
      ctx.fillText(measurements.join(' · '), cx, 172);
    }

    ctx.strokeStyle = 'rgba(201,157,68,.34)'; ctx.lineWidth = 1.2;
    [260, 330, 400, 470].forEach(radius => {
      ctx.beginPath(); ctx.arc(cx, cy, radius + 62, Math.PI * 1.12, Math.PI * 1.86); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, radius + 62, Math.PI * 1.88, Math.PI * 2.48); ctx.stroke();
    });
    [[58, 295], [965, 328], [69, 1010], [958, 970]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(201,157,68,.42)'; ctx.fill();
    });

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.24)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 14;
    ctx.beginPath(); ctx.arc(cx, cy, targetR, 0, Math.PI * 2); ctx.fillStyle = '#66686a'; ctx.fill();
    ctx.restore();

    const zoneRings = [1, .90, .66, .40, .19];
    const zoneFills = ['#505256', '#090b0e', '#043f62', '#861124', '#746b22'];
    zoneFills.forEach((fill, index) => {
      ctx.beginPath(); ctx.arc(cx, cy, targetR * zoneRings[index], 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    });
    [.90, .70, .60, .50, .40, .30, .20, .10].forEach(ratio => {
      ctx.beginPath(); ctx.arc(cx, cy, targetR * ratio, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(15,18,20,.72)'; ctx.lineWidth = 1.15; ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(cx, cy, targetR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(15,18,20,.72)'; ctx.lineWidth = 1.3; ctx.stroke();

    const points = visible.map(arrow => ({
      x: cx + (Number(arrow.x) - 50) / OUTER_R * targetR,
      y: cy + (Number(arrow.y) - 50) / OUTER_R * targetR
    }));

    if (points.length) {
      const heatWidth = 500, heatHeight = 500, heat = document.createElement('canvas');
      heat.width = heatWidth; heat.height = heatHeight;
      const heatContext = heat.getContext('2d'), image = heatContext.createImageData(heatWidth, heatHeight);
      const sigma = 28, values = new Float32Array(heatWidth * heatHeight); let maxDensity = 0;
      for (let py = 0; py < heatHeight; py += 1) {
        const yy = cy - targetR + py / (heatHeight - 1) * targetR * 2;
        for (let px = 0; px < heatWidth; px += 1) {
          const xx = cx - targetR + px / (heatWidth - 1) * targetR * 2;
          let density = 0;
          points.forEach(point => {
            const dx = xx - point.x, dy = yy - point.y;
            density += Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          });
          const index = py * heatWidth + px; values[index] = density; maxDensity = Math.max(maxDensity, density);
        }
      }
      if (maxDensity > 0) {
        for (let py = 0; py < heatHeight; py += 1) for (let px = 0; px < heatWidth; px += 1) {
          const index = py * heatWidth + px, density = values[index] / maxDensity;
          if (density < .028) continue;
          const q = Math.min(1, Math.pow(density, .68)); let r, g, b;
          if (q < .24) { const u = q / .24; r = 8 * u; g = 38 + 42 * u; b = 255; }
          else if (q < .46) { const u = (q - .24) / .22; r = 8 + 232 * u; g = 80 - 10 * u; b = 255 - 18 * u; }
          else if (q < .70) { const u = (q - .46) / .24; r = 240 + 15 * u; g = 70 - 48 * u; b = 237 - 150 * u; }
          else { const u = (q - .70) / .30; r = 255; g = 22 + 225 * u; b = 87 - 75 * u; }
          const pixel = index * 4;
          image.data[pixel] = r; image.data[pixel + 1] = g; image.data[pixel + 2] = b; image.data[pixel + 3] = 255 * Math.pow(q, .58);
        }
        heatContext.putImageData(image, 0, 0);
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, targetR, 0, Math.PI * 2); ctx.clip();
        ctx.globalCompositeOperation = 'screen'; ctx.filter = 'blur(14px)'; ctx.globalAlpha = .92;
        ctx.drawImage(heat, cx - targetR, cy - targetR, targetR * 2, targetR * 2);
        ctx.filter = 'none'; ctx.globalAlpha = 1;
        ctx.drawImage(heat, cx - targetR, cy - targetR, targetR * 2, targetR * 2);
        ctx.restore(); ctx.globalCompositeOperation = 'source-over';
      }
    }

    for (let first = 0; first < points.length; first += 1) for (let second = first + 1; second < points.length; second += 1) {
      if (Math.hypot(points[first].x - points[second].x, points[first].y - points[second].y) <= 112) {
        ctx.beginPath(); ctx.moveTo(points[first].x, points[first].y); ctx.lineTo(points[second].x, points[second].y);
        ctx.strokeStyle = 'rgba(205,220,235,.52)'; ctx.lineWidth = 1.2; ctx.stroke();
      }
    }

    const markerSigma = 28;
    const markerDensity = points.map((point, index) => points.reduce((density, other, otherIndex) => {
      if (index === otherIndex) return density;
      const dx = point.x - other.x, dy = point.y - other.y;
      return density + Math.exp(-(dx * dx + dy * dy) / (2 * markerSigma * markerSigma));
    }, 0));
    const markerMax = Math.max(...markerDensity, 0);
    const heatColor = value => {
      const q = Math.max(0, Math.min(1, value));
      if (q < .24) { const u = q / .24; return [8 * u, 38 + 42 * u, 255]; }
      if (q < .46) { const u = (q - .24) / .22; return [8 + 232 * u, 80 - 10 * u, 255 - 18 * u]; }
      if (q < .70) { const u = (q - .46) / .24; return [240 + 15 * u, 70 - 48 * u, 237 - 150 * u]; }
      const u = (q - .70) / .30; return [255, 22 + 225 * u, 87 - 75 * u];
    };
    points.forEach((point, index) => {
      const q = markerMax > 0 ? Math.pow(markerDensity[index] / markerMax, .68) : 0;
      const [r, g, b] = heatColor(q), whiteMix = .72;
      const bright = [r, g, b].map(channel => Math.round(channel + (255 - channel) * whiteMix));
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.shadowColor = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},.95)`; ctx.shadowBlur = 14; ctx.globalAlpha = .98;
      ctx.beginPath(); ctx.arc(point.x, point.y, 7.2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${bright[0]},${bright[1]},${bright[2]},.96)`; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
      ctx.beginPath(); ctx.arc(point.x, point.y, 5.2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.98)'; ctx.lineWidth = 1.55; ctx.stroke();
    });

    const total = arrows.reduce((sum, arrow) => sum + valueOf(arrow), 0), average = total / arrows.length;
    const stats = [[String(arrows.length), 'FLECHAS'], [String(total), 'PUNTAJE'], [average.toFixed(2).replace('.', ','), 'PROMEDIO']];
    const columns = [290, 540, 790];
    ctx.strokeStyle = 'rgba(190,150,67,.72)'; ctx.lineWidth = 1.2;
    [415, 665].forEach(x => { ctx.beginPath(); ctx.moveTo(x, 1138); ctx.lineTo(x, 1230); ctx.stroke(); });
    stats.forEach((stat, index) => {
      ctx.fillStyle = '#11131a'; ctx.font = '800 42px Arial, sans-serif'; ctx.fillText(stat[0], columns[index], 1174);
      ctx.fillStyle = '#4d5660'; ctx.font = '500 17px Arial, sans-serif'; ctx.fillText(stat[1], columns[index], 1205);
    });
    ctx.fillStyle = '#222831'; ctx.font = '500 18px Arial, sans-serif'; ctx.fillText('arbatarchery.com', cx, 1280);
    ctx.textAlign = 'right'; ctx.fillStyle = '#697178'; ctx.font = '500 13px Arial, sans-serif'; ctx.fillText('V-1.7', 1035, 1320);
    return canvas;
  }

  window.ArbatConstellation = { createCanvas };
})();
