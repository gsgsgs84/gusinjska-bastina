// Accuracy of the AR map tracker on synthetic frames (tools/tests/staze_ar_synth.py random OUT N).
// usage: node tools/tests/staze_ar_track.mjs OUT [--trueK]
// Frames are scaled to 720x960 as on the phone (js/staze-ar.js PROC_LONG = 960).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { MapTracker, focalFromPlane } from '../../js/staze-ar-track.js';
const require = createRequire(import.meta.url);
const sharp = require('/opt/npm-tools/node_modules/sharp');

const dir = process.argv[2];
const trueK = process.argv.includes('--trueK');
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json')));
const layout = JSON.parse(fs.readFileSync(new URL('../../data/staze-mapa.json', import.meta.url)));
const SC = 0.75, FREL_GUESS = 0.5 / Math.tan(33 * Math.PI / 180);
const MW = layout.map[0] / 1000, MH = layout.map[1] / 1000;
// test points: map corners on the paper and a peak 3 cm above it (Zla Kolata at height x1.5 on an A4 print)
const PTS = [[-MW / 2, 0, -MH / 2], [MW / 2, 0, -MH / 2], [MW / 2, 0, MH / 2], [-MW / 2, 0, MH / 2], [0.045, 0.031, 0.048]];

const proj = (R, t, f, cx, cy, X) => {
  const x = R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0], y = R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1], z = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2];
  return [f * x / z + cx, f * y / z + cy];
};
const rotErr = (A, B) => { let tr = 0; for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += A[i * 3 + k] * B[i * 3 + k]; return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI; };

const rows = [];
let tracker = new MapTracker(layout);
for (const fr of truth.frames) {
  const { data, info } = await sharp(path.join(dir, fr.file)).resize(Math.round(truth.w * SC), Math.round(truth.h * SC)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const f = trueK ? fr.K[0] * SC : FREL_GUESS * Math.max(w, h);
  const K = { fx: f, fy: f, cx: w / 2, cy: h / 2 };
  tracker.prev = null;                       // independent frames: no prior
  const r = tracker.process(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w, h, K, 0);
  const row = { file: fr.file, dist: fr.dist, elev: fr.elev, fov: fr.fov, blur: fr.opts.motion, defocus: fr.opts.defocus, hand: fr.opts.hand, light: fr.opts.light,
    found: r.found, n: r.n || 0, ms: r.ms, seen: r.markers.length };
  // is the map (all 8 markers) inside the frame at all?
  const inside = layout.markers.filter(m => m.corners.every(c => { const p = proj(fr.R, fr.t, fr.K[0], fr.K[1], fr.K[2], [c[0] / 1000, 0, c[2] / 1000]); return p[0] > 0 && p[1] > 0 && p[0] < truth.w && p[1] < truth.h; })).length;
  row.visible = inside;
  if (r.found) {
    row.rot = rotErr(r.R, fr.R);
    const tl = Math.hypot(...fr.t), dt = Math.hypot(r.t[0] - fr.t[0], r.t[1] - fr.t[1], r.t[2] - fr.t[2]);
    row.tErr = dt / tl;
    // overlay error in full-resolution pixels: estimated pose with the guessed focal vs the true camera
    const errs = PTS.map(X => { const a = proj(r.R, r.t, f / SC, truth.w / 2, truth.h / 2, X), b = proj(fr.R, fr.t, fr.K[0], fr.K[1], fr.K[2], X); return Math.hypot(a[0] - b[0], a[1] - b[1]); });
    row.cornerPx = Math.max(...errs.slice(0, 4)); row.peakPx = errs[4];
    row.rms = r.rms; row.tilt = r.tilt;
    if (r.f) row.fRel = r.f / Math.max(w, h);
    row.fRelTrue = fr.K[0] / Math.max(truth.w, truth.h);
  }
  rows.push(row);
}
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '-';
const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const p90 = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.9)] : NaN; };
const vis = rows.filter(r => r.visible >= 2);
console.log(`frames ${rows.length}, with >=2 markers fully in view ${vis.length}, ${trueK ? 'true focal' : 'guessed focal (66°)'}`);
console.log(`found: ${pct(vis.filter(r => r.found).length, vis.length)} of frames with the map in view; false finds on frames without it: ${rows.filter(r => r.visible === 0 && r.found).length}`);
const groups = {
  'dist <35 cm': r => r.dist < 0.35, 'dist 35-60': r => r.dist >= 0.35 && r.dist < 0.6, 'dist 60-90': r => r.dist >= 0.6,
  'elev <45°': r => r.elev < 45, 'elev 45-70': r => r.elev >= 45 && r.elev < 70, 'elev >70': r => r.elev >= 70,
  'motion blur 4-7px': r => r.blur >= 4, 'defocus 1.6': r => r.defocus >= 1.5, 'hand': r => r.hand, 'dim (<0.6)': r => r.light < 0.6,
};
for (const [k, fn] of Object.entries(groups)) {
  const g = vis.filter(fn), ok = g.filter(r => r.found);
  console.log(`  ${k.padEnd(18)} n=${String(g.length).padStart(3)} found ${pct(ok.length, g.length).padStart(6)}  corner px med ${med(ok.map(r => r.cornerPx)).toFixed(1)} p90 ${p90(ok.map(r => r.cornerPx)).toFixed(1)}  peak px med ${med(ok.map(r => r.peakPx)).toFixed(1)}`);
}
const ok = vis.filter(r => r.found);
console.log(`rotation error deg: median ${med(ok.map(r => r.rot)).toFixed(2)}, p90 ${p90(ok.map(r => r.rot)).toFixed(2)}`);
console.log(`overlay error (full-res px): map corners median ${med(ok.map(r => r.cornerPx)).toFixed(1)} p90 ${p90(ok.map(r => r.cornerPx)).toFixed(1)}; 3 cm peak median ${med(ok.map(r => r.peakPx)).toFixed(1)} p90 ${p90(ok.map(r => r.peakPx)).toFixed(1)}`);
console.log(`detect time median ${med(rows.map(r => r.ms)).toFixed(1)} ms (node, one core)`);
const fr = ok.filter(r => r.fRel);
if (fr.length) {
  const relErr = fr.map(r => Math.abs(r.fRel - r.fRelTrue) / r.fRelTrue);
  console.log(`focal estimates: ${fr.length} frames, error median ${(100 * med(relErr)).toFixed(1)}%, p90 ${(100 * p90(relErr)).toFixed(1)}%`);
  for (const fov of [58, 63, 66, 72, 78]) {
    const g = fr.filter(r => Math.abs(2 * Math.atan(0.5 / r.fRelTrue) * 180 / Math.PI - fov) < 0.5);
    if (g.length) console.log(`   fov ${fov}°: median estimate ${(2 * Math.atan(0.5 / med(g.map(r => r.fRel))) * 180 / Math.PI).toFixed(1)}° from ${g.length} frames`);
  }
}
fs.writeFileSync(path.join(dir, trueK ? 'result_trueK.json' : 'result.json'), JSON.stringify(rows));
