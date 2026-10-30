// Run: node --test tests/constelacion.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('entrenamiento/js/constelacion.js', 'utf8');
function setup() {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, key) => (...args) => {
    calls.push([key, ...args]);
    if (key === 'createImageData') return { data: new Uint8ClampedArray(args[0] * args[1] * 4) };
    if (key === 'createRadialGradient') return { addColorStop() {} };
  }, set: () => true });
  const sandbox = { window: {}, document: { createElement: () => ({ getContext: () => ctx }) }, Intl };
  vm.runInNewContext(source.replace('window.ArbatConstellation = { createCanvas };', 'window.ArbatConstellation = { createCanvas, geometry, densityAt, colorAt };'), sandbox);
  return { ...sandbox.window.ArbatConstellation, calls };
}
const arrow = (x, y) => ({ x, y, score: 7, label: '7' });
const cluster = Array.from({ length: 36 }, (_, i) => arrow(65 + (i % 6) * .15, 42 + Math.floor(i / 6) * .15));
for (const [name, arrows, stars] of [
  ['A: 36 valid arrows', cluster, 36],
  ['B: 34 valid and two misses', [...cluster.slice(0, 34), { label: 'M', x: 50, y: 50, score: 10 }, { label: 'M' }], 34],
  ['F: only misses', Array.from({ length: 36 }, () => ({ label: 'M', x: 50, y: 50 })), 0]
]) test(name, () => {
  const api = setup(), before = JSON.stringify(arrows);
  const canvas = api.createCanvas({ arrows, rounds: 6, arrowsPerEnd: 6, date: '2026-10-30' });
  assert.equal(canvas.width / canvas.height, 4 / 5);
  const cores = api.calls.filter(c => c[0] === 'arc' && c[3] === 3);
  assert.equal(cores.length, stars);
  api.geometry(arrows).forEach((p, i) => { assert.equal(cores[i][1], p.x); assert.equal(cores[i][2], p.y); });
  const text = api.calls.filter(c => c[0] === 'fillText').map(c => String(c[1]));
  assert.ok(text.includes('36')); assert.ok(text.includes('6')); assert.ok(text.includes('v1.8'));
  assert.ok(!text.some(s => /\bM\b|miss/i.test(s)));
  const total = stars * 7;
  assert.ok(text.includes(String(total))); assert.ok(text.includes((total / 36).toFixed(2).replace('.', ',')));
  assert.equal(JSON.stringify(arrows), before);
  if (!stars) assert.equal(api.calls.filter(c => c[0] === 'drawImage').length, 0);
});
test('C: density follows the displaced group', () => {
  const a = setup(), points = a.geometry(cluster);
  assert.ok(a.densityAt(points, points[18].x, points[18].y) > 30);
  assert.equal(a.densityAt(points, 540, 650), 0);
  const color = a.colorAt(30); assert.ok(color[0] === 255 && color[1] > 220);
});
test('D: separated clusters do not generate an artificial bridge', () => {
  const a = setup(), points = a.geometry([...cluster, ...cluster.map(p => ({ ...p, x: p.x - 30 }))]);
  assert.ok(a.densityAt(points, points[0].x, points[0].y) > 30);
  assert.ok(a.densityAt(points, points[36].x, points[36].y) > 30);
  assert.equal(a.densityAt(points, 540, points[0].y), 0);
});
test('E: widely dispersed arrows remain cool', () => {
  const a = setup(), points = a.geometry([arrow(20, 30), arrow(40, 70), arrow(70, 25), arrow(75, 70)]);
  for (const p of points) {
    const density = a.densityAt(points, p.x, p.y), color = a.colorAt(density);
    assert.ok(density <= 1.01); assert.ok(color[2] > color[0]);
  }
  assert.equal(a.densityAt(points, 540, 650), 0);
});
test('reject absent coordinates; preserve numeric CSV coordinates and coincident arrows', () => {
  const a = setup(), points = a.geometry([{x:null,y:50}, {x:'',y:50}, {x:Infinity,y:50}, arrow('65','42'), arrow(65,42)]);
  assert.equal(points.length, 2); assert.equal(points[0].x, points[1].x);
});

test('retain distance and target size in the exported header', () => {
  const a = setup();
  a.createCanvas({ arrows: [], shootingDistance: '18', targetSize: '40' });
  assert.ok(a.calls.some(c => c[0] === 'fillText' && c[1] === 'Distancia: 18 m · Diana: 40 cm'));
});
