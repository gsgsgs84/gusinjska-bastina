// How well the room tracker (js/staze-room-track.js) keeps the terrain in place on a synthetic walk round a desk
// (tools/tests/staze_ar_synth.py room DIR). The motion sensors are simulated with noise, a drifting heading and lag,
// and the surface is assumed at the wrong distance (as on a phone), so the room is rebuilt at another scale.
// usage: node tools/tests/staze_room_track.mjs DIR [scale=1.4] [fovGuess=66]
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
globalThis.jsfeat = require('../../js/vendor/jsfeat/jsfeat-min.js');
require('../../js/staze-room-track.js');
const sharp = require('/opt/npm-tools/node_modules/sharp');

const dir = process.argv[2], SCALE = +(process.argv[3] || 1.4), FOV = +(process.argv[4] || 66);
const OPTS = JSON.parse(process.env.ROOM_OPTS || '{}');
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'room.json')));
// RES=s: frames scaled by s before tracking (errors are still reported in the original pixels)
const RS = +(process.env.RES || 1);
const w = Math.round(cfg.w * RS), h = Math.round(cfg.h * RS);
const fG = (Math.max(w, h) / 2) / Math.tan(FOV * Math.PI / 360);
const K = { fx: fG, fy: fG, cx: w / 2, cy: h / 2 };
const Ktrue = { fx: cfg.K[0] * RS, fy: cfg.K[0] * RS, cx: cfg.K[1] * RS, cy: cfg.K[2] * RS };

// rotation helpers (row-major 3x3)
const mul = (A, B) => { const o = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return o; };
const rotY = a => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotAx = (ax, a) => { const [x, y, z] = ax, c = Math.cos(a), s = Math.sin(a), v = 1 - c; return [c + x * x * v, x * y * v - z * s, x * z * v + y * s, y * x * v + z * s, c + y * y * v, y * z * v - x * s, z * x * v - y * s, z * y * v + x * s, c + z * z * v]; };
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

// simulated motion sensor, like a phone's: smooth but late (one frame), heading drifting 1°/s, a slow wobble of 0.3°
// and 0.05° of noise
const gyro = (i) => {
  const F = cfg.frames[Math.max(0, i - 1)], t = i / cfg.fps;
  const drift = rotY((1.0 * t) * Math.PI / 180);              // room heading drifts: R_cam = R_true * drift
  const wob = rotAx([Math.sin(t * 2.1), Math.cos(t * 1.7), Math.sin(t * 1.3 + 1)].map((v, _, a) => v / Math.hypot(...a)), 0.3 * Math.PI / 180 * Math.sin(t * 3.0));
  const n = rotAx([gauss(), gauss(), gauss()].map((v, _, a) => v / Math.hypot(...a)), 0.05 * Math.PI / 180 * Math.abs(gauss()));
  return mul(n, mul(wob, mul(F.R, drift)));
};
const proj = (R, C, Kk, X) => {
  const a = X[0] - C[0], b = X[1] - C[1], c = X[2] - C[2];
  const x = R[0] * a + R[1] * b + R[2] * c, y = R[3] * a + R[4] * b + R[5] * c, z = R[6] * a + R[7] * b + R[8] * c;
  return z > 0 ? [Kk.fx * x / z + Kk.cx, Kk.fy * y / z + Kk.cy] : null;
};

const tr = new RoomTracker(w, h, OPTS);
const F0 = cfg.frames[0], C0 = F0.C;
// the app's room: the drifting sensor frame, surface assumed SCALE times farther than it is
const D0 = rotY(0);
const T3 = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
let D = D0;
const planeY = C0[1] - SCALE * C0[1];
const rows = [];
// anchors: the terrain's centre on the desk and a peak 4 cm above it, in the true room and in the tracker's room
const anchors = [[0, 0, 0], [0.03, 0.04, 0.02], [-0.15, 0, 0.12]];
const toEst = X => [C0[0] + SCALE * (X[0] - C0[0]), C0[1] + SCALE * (X[1] - C0[1]), C0[2] + SCALE * (X[2] - C0[2])];
// STEP=n: only every n-th frame reaches the tracker (a slow phone); DROP=p: frames lost at random
const STEP = +(process.env.STEP || 1), DROP = +(process.env.DROP || 0);
for (let i = 0; i < cfg.frames.length; i++) {
  if (i > 0 && (i % STEP || rnd() < DROP)) continue;
  const F = cfg.frames[i];
  const { data } = await sharp(path.join(dir, `r${String(i).padStart(4, '0')}.jpg`)).resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
  let r;
  if (i === 0) { tr.start(rgba, K, mul(F.R, D0), C0, planeY, F.t); r = { ok: true, R: mul(F.R, D0), C: C0, inl: tr.pts.length, n: tr.pts.length, ms: 0 }; }
  else {
    // like the app: the sensor rotation corrected by what the camera saw (the sensor's heading drifts)
    r = tr.track(rgba, K, gyro(i), F.t);       // raw sensor rotation: the tracker uses only its change since the key frame
  }
  // the tracker's room is the true room turned by the sensor drift about the start camera... compare on screen instead:
  const errs = anchors.map(A => {
    const t = proj(F.R, F.C, Ktrue, A), e = proj(r.R, r.C, K, toEst(A));
    return t && e && t[0] > -50 && t[0] < w + 50 && t[1] > -50 && t[1] < h + 50 ? Math.hypot(t[0] - e[0], t[1] - e[1]) / RS : null;
  });
  rows.push({ i, t: F.t, ok: r.ok, inl: r.inl, n: r.n, ms: r.ms, e: errs });
  if (process.env.DBG && tr.dbg && F.t > +process.env.DBG && F.t < +process.env.DBG + 2.5) {
    // how many tracked points are where the true camera sees them (LK right?) and how good is the prior pose
    const fromEst = X => [C0[0] + (X[0] - C0[0]) / SCALE, C0[1] + (X[1] - C0[1]) / SCALE, C0[2] + (X[2] - C0[2]) / SCALE];
    const lk = tr.dbg.obsPts.map(([X, u, v]) => { const p = proj(F.R, F.C, Ktrue, fromEst(X)); return p ? Math.hypot(p[0] - u, p[1] - v) : 999; });
    const pr = tr.dbg.obsPts.map(([X, u, v]) => { const p = proj(tr.dbg.Rprior, tr.dbg.Cp, K, X); return p ? Math.hypot(p[0] - u, p[1] - v) : 999; });
    const md = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
    if (process.env.DBG2) {
      const { solvePose: sp, errs: er } = RoomTracker.internals;
      const Rt = F.R, Ct = toEst(F.C), Xs = tr.dbg.obsPts.map(o => o[0]), Us = tr.dbg.obsPts.map(o => [o[1], o[2]]);
      const et = er(Rt, Ct, K, Xs, Us);
      const s1 = sp(Xs, Us, K, Rt, Ct, 2.6, 3), s2 = sp(Xs, Us, K, tr.dbg.Rprior, tr.dbg.Cp, 2.6, 3);
      console.log('   true pose inliers', et.filter(e => e < 2.6).length, '| solver from truth', s1 && s1.inl.length, '| from prior', s2 && s2.inl.length);
      const { refine: rf, solveC: sc } = RoomTracker.internals;
      const ti = Xs.map((_, i) => i).filter(i => et[i] < 2.6);
      const ang = (A, B) => { let t = 0; for (let k = 0; k < 9; k++) t += A[k] * B[k]; return Math.acos(Math.min(1, (t - 1) / 2)) * 180 / Math.PI; };
      const C0p = sc(tr.dbg.Rprior, K, Xs, Us, ti);
      const r1 = rf(tr.dbg.Rprior, C0p, K, Xs, Us, ti, tr.dbg.Rprior, 3, 10);
      const e1 = er(r1.R, r1.C, K, Xs, Us);
      console.log('   prior vs true rot', ang(tr.dbg.Rprior, Rt).toFixed(2), 'deg; Cp vs true', Math.hypot(...tr.dbg.Cp.map((v, k) => v - Ct[k])).toFixed(3), '| refine on true inliers ->', e1.filter(e => e < 2.6).length, 'rot err', ang(r1.R, Rt).toFixed(2), 'C err', Math.hypot(...r1.C.map((v, k) => v - Ct[k])).toFixed(3));
    }
    console.log('   LK vs truth: median', md(lk)?.toFixed(1), 'within 3px', lk.filter(e => e < 3).length, '/', lk.length, '| prior pose residual median', md(pr)?.toFixed(1), 'guess used', tr.dbg.useGuess, '');
  }
  if (process.env.DBG && tr.dbg && i % (STEP > 1 ? 1 : 3) === 0 && F.t > +process.env.DBG && F.t < +process.env.DBG + 2.5) console.log(F.t.toFixed(2), r.ok ? 'ok ' : 'BAD', 'pts', tr.dbg.n, 'tracked', tr.dbg.obs, 'inl', r.inl, 'guess off', tr.dbg.guessErr.toFixed(1), 'moved', tr.dbg.motion.toFixed(1), 'err', errs[0] && errs[0].toFixed(1));
}
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const p90 = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length * 0.9)] : NaN; };
const seg = cfg.walk;
console.log(`room tracker, every ${STEP}. frame, drop ${DROP}: ${rows.length} frames ${w}x${h}, surface assumed ${SCALE}x as far, focal guess ${FOV}° (true ${cfg.fov}°)`);
for (let k = 0; k < seg.length - 1; k++) {
  const g = rows.filter(r => r.t >= seg[k][0] && r.t < seg[k + 1][0]);
  if (!g.length) continue;
  console.log(`  ${seg[k][0].toFixed(1)}-${seg[k + 1][0].toFixed(1)} s  ok ${(100 * g.filter(r => r.ok).length / g.length).toFixed(0)}%  points ${med(g.map(r => r.n))} inliers ${med(g.map(r => r.inl))}  centre err px med ${med(g.map(r => r.e[0])).toFixed(1)} p90 ${p90(g.map(r => r.e[0])).toFixed(1)} | peak ${med(g.map(r => r.e[1])).toFixed(1)} | edge ${med(g.map(r => r.e[2])).toFixed(1)}`);
}
console.log(`all: centre err med ${med(rows.map(r => r.e[0])).toFixed(1)} px, p90 ${p90(rows.map(r => r.e[0])).toFixed(1)}, end ${rows[rows.length - 1].e[0]?.toFixed(1)} px; ${med(rows.map(r => r.ms)).toFixed(1)} ms/frame`);
fs.writeFileSync(path.join(dir, `room_result_${SCALE}_${FOV}.json`), JSON.stringify(rows));
