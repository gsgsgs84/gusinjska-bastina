// Cube tracking for the museum cube: camera frame -> markers -> cube pose, smoothed.
//
// Markers are found by OpenCV's ArUco detector in a background worker (js/kocka/cv-worker.js), so the page
// stays smooth. Until OpenCV has loaded (about 3.7 MB the first time), and if it cannot load or stops
// answering, the museum's own detector (js/cv/detector.js) runs on the page instead.
// Each frame is shown together with the pose found in it, so the exhibit never lags behind the picture.
import { Tracker, projectedBox } from '../cv/tracker.js';
import { OneEuro, matToQuat } from '../cv/pose.js';
import { poseIsGood } from '../cv/calib.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const D2R = Math.PI / 180;
const qAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) / D2R;

function targetState() {
  return { filtT: new OneEuro(3, 1.6, 0.25, 5.0), filtQ: new OneEuro(4, 1.6, 30, 5.0), raw: null, seen: -10, lostAt: -10, q: null, t: null, prevQ: null, cand: null, candT: 0, size: 70 };
}

export class CubeTracking {
  // opts: { workerUrl, opencvUrl, useOpenCV, onLearn(res, K) }
  constructor(layout, opts = {}) {
    this.layout = layout;
    this.opts = opts;
    this.tracker = new Tracker(layout);
    this.T = { cube: targetState(), card: targetState() };
    this.T.cube.size = layout.edge; this.T.card.size = layout.card ? layout.card.size * 0.6 : 100;
    this.active = null;
    this.proc = document.createElement('canvas');
    this.pctx = this.proc.getContext('2d', { willReadFrequently: true });
    this.PROC = 720;                       // processing size (long side), adapted to the phone's speed
    this.frameNo = 0;
    this.busy = false;
    this.pending = null;
    this.lastRes = null;
    this.region = null;
    this.fps = 0; this.lastT = 0;
    this.stats = { det: 0, read: 0, solve: 0, latency: 0, found: 0, frames: 0, detector: 'own', opencvMs: 0, cand: 0, error: '' };
    this.light = null;                     // smoothed mean colour of the camera picture, 0..255
    this.worker = null; this.workerState = opts.useOpenCV === false ? 'off' : 'loading';
    this.errors = 0;
    if (this.workerState === 'loading') this._startWorker();
  }

  get detector() { return this.workerState === 'ready' ? 'opencv' : 'own'; }

  _startWorker() {
    let w;
    try { w = new Worker(this.opts.workerUrl); } catch (e) { this.workerState = 'failed'; this.stats.error = 'worker: ' + e.message; return; }
    this.worker = w;
    const ids = [...this.layout.markers, ...(this.layout.card ? this.layout.card.markers : [])].map(m => m.id);
    const timer = setTimeout(() => { if (this.workerState === 'loading') this._fail('opencv timeout'); }, 60000);
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === 'ready') { clearTimeout(timer); this.workerState = 'ready'; this.stats.opencvMs = m.ms; this.stats.detector = 'opencv'; return; }
      if (m.type === 'error') {
        if (this.workerState === 'loading') { clearTimeout(timer); this._fail(m.message); return; }
        this.stats.error = m.message;
        if (++this.errors >= 3) this._fail(m.message);
        this._finish(null);
        return;
      }
      if (m.type === 'result') this._onWorkerResult(m);
    };
    w.onerror = (e) => { clearTimeout(timer); this._fail('worker error ' + (e.message || '')); };
    w.postMessage({ type: 'init', url: this.opts.opencvUrl, ids });
  }

  _fail(msg) {
    this.workerState = 'failed'; this.stats.error = msg; this.stats.detector = 'own';
    try { this.worker && this.worker.terminate(); } catch { /* gone */ }
    this.worker = null;
    if (this.busy) this._finish(null);
  }

  // Search the whole picture (alternately a sharper centre crop) until the cube is found, then look only
  // around where it is expected, at higher resolution.
  chooseRegion(K, vw, vh, t) {
    const L = Math.max(vw, vh);
    for (const key of ['cube', 'card']) {
      const st = this.T[key];
      if (!st.raw || t - st.seen > Math.max(0.3, 3 / Math.max(this.fps, 1))) continue;
      const tg = this.tracker.targets[key];
      if (!tg) continue;
      const b = projectedBox(tg, st.raw, K);
      if (!b) continue;
      const pad = 0.35 * Math.max(b.x1 - b.x0, b.y1 - b.y0) + 24;
      const x0 = Math.max(0, Math.floor(b.x0 - pad)), y0 = Math.max(0, Math.floor(b.y0 - pad));
      const x1 = Math.min(vw, Math.ceil(b.x1 + pad)), y1 = Math.min(vh, Math.ceil(b.y1 + pad));
      if (x1 - x0 < 32 || y1 - y0 < 32) continue;
      const cellNative = tg.cell * K.fx / Math.max(50, st.raw.t[2]);
      const scale = Math.min(1, this.PROC / Math.max(x1 - x0, y1 - y0), 10 / cellNative);
      return { sx: x0, sy: y0, sw: x1 - x0, sh: y1 - y0, scale, radius: clamp(Math.round(cellNative * scale), 2, 7), mode: 'track', key };
    }
    if (this.frameNo % 2 === 0) {
      return { sx: 0, sy: 0, sw: vw, sh: vh, scale: Math.min(1, this.PROC / L), radius: [2, 3, 5][(this.frameNo >> 1) % 3], mode: 'search' };
    }
    const cw = Math.round(vw / 2), ch = Math.round(vh / 2);
    return { sx: Math.round((vw - cw) / 2), sy: Math.round((vh - ch) / 2), sw: cw, sh: ch, scale: Math.min(1, this.PROC / Math.max(cw, ch)), radius: [3, 5][(this.frameNo >> 1) % 2], mode: 'centre' };
  }

  // Start work on one camera frame already drawn into `src` (a canvas of vw x vh).
  // Returns false when the previous frame is still being processed (this one is skipped).
  // done(res) is called with { markers, poses, t, slot } once the frame has been processed.
  submit(src, vw, vh, K, t, slot, done) {
    if (this.busy) return false;
    this.frameNo++;
    if (this.lastT) this.fps = this.fps * 0.9 + 0.1 / Math.max(1e-3, t - this.lastT);
    this.lastT = t;
    const r = this.chooseRegion(K, vw, vh, t);
    this.region = r;
    const w = Math.max(16, Math.round(r.sw * r.scale)), h = Math.max(16, Math.round(r.sh * r.scale));
    if (this.proc.width < w || this.proc.height < h) { this.proc.width = Math.max(this.proc.width, w + 64); this.proc.height = Math.max(this.proc.height, h + 64); }
    const t0 = performance.now();
    this.pctx.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    const img = this.pctx.getImageData(0, 0, w, h);
    const t1 = performance.now();
    this.stats.read = this.stats.read * 0.85 + 0.15 * (t1 - t0);
    const roi = { x0: r.sx, y0: r.sy, scale: w / r.sw };
    this.busy = true;
    this.pending = { K, t, slot, done, roi, t0, w, h, mode: r.mode };
    if (this.workerState === 'ready' && this.worker) {
      const id = this.frameNo;
      this.pending.id = id;
      this.pending.timer = setTimeout(() => { if (this.pending && this.pending.id === id) { this._fail('no answer'); } }, 2500);
      this.worker.postMessage({ type: 'detect', id, buf: img.data.buffer, w, h, mode: r.mode === 'track' ? 'track' : 'search', scale: roi.scale }, [img.data.buffer]);
    } else {
      // own detector on the page
      const res = this.tracker.process(img.data, w, h, roi, K, t, { radius: r.radius });
      this.stats.det = this.stats.det * 0.85 + 0.15 * res.stats.detectMs;
      this._light(meanColour(img.data));
      this._finish({ markers: res.markers, poses: res.poses });
    }
    return true;
  }

  _onWorkerResult(m) {
    const p = this.pending;
    if (!p || p.id !== m.id) return;
    clearTimeout(p.timer);
    this.errors = 0;
    this.stats.det = this.stats.det * 0.85 + 0.15 * m.ms;
    this.stats.cand = m.cand;
    const s0 = performance.now();
    const markers = m.markers.map(k => ({ id: k.id, refined: true, corners: [0, 1, 2, 3].map(i => [p.roi.x0 + k.c[2 * i] / p.roi.scale, p.roi.y0 + k.c[2 * i + 1] / p.roi.scale]) }));
    const poses = this.tracker.solveAll(markers, p.K, p.t);
    this.stats.solve = this.stats.solve * 0.85 + 0.15 * (performance.now() - s0);
    this._light(m.light);
    this._finish({ markers, poses });
  }

  _light(c) {
    if (!c) return;
    if (!this.light) this.light = c.slice();
    else for (let i = 0; i < 3; i++) this.light[i] += 0.08 * (c[i] - this.light[i]);
  }

  _finish(res) {
    const p = this.pending;
    this.pending = null; this.busy = false;
    if (!p) return;
    const ms = performance.now() - p.t0;
    this.stats.latency = this.stats.latency * 0.85 + 0.15 * ms;
    // keep the work within one camera frame on slower phones
    if (this.frameNo % 15 === 0) {
      if (ms > 32 && this.PROC > 480) this.PROC = Math.round(this.PROC * 0.88);
      else if (ms < 16 && this.PROC < 720) this.PROC = Math.min(720, Math.round(this.PROC * 1.08));
    }
    if (!res) res = { markers: [], poses: {} };
    res.t = p.t; res.K = p.K; res.slot = p.slot;
    this.lastRes = res;
    this.stats.frames++;
    this._update(res, p.t, p.K);
    if (res.poses.cube && this.opts.onLearn) this.opts.onLearn(res, p.K);
    p.done(res);
  }

  // Accept good poses, reject mirror flips, smooth, and hold the pose through short drop-outs.
  _update(res, t, K) {
    for (const key of ['cube', 'card']) {
      const st = this.T[key], p = res.poses[key];
      if (!poseIsGood(p, st.size, K)) continue;
      let q = matToQuat(p.R);
      // a pose that suddenly turns a lot is almost always a wrong solution (a mirror flip of one face):
      // accept it only when the next frame agrees
      if (st.q && t - st.seen < 0.3 && p.n < 4) {
        const jump = qAngle(q, st.q);
        if (jump > 40 && !(st.cand && qAngle(q, st.cand) < 15 && t - st.candT < 0.25)) { st.cand = q; st.candT = t; continue; }
        if (jump > 40) { st.filtT.reset(); st.filtQ.reset(); st.prevQ = null; }
      }
      st.cand = null;
      if (t - st.seen > 0.6) { st.filtT.reset(); st.filtQ.reset(); st.prevQ = null; }
      st.raw = p; st.seen = t;
      if (st.prevQ && q[0] * st.prevQ[0] + q[1] * st.prevQ[1] + q[2] * st.prevQ[2] + q[3] * st.prevQ[3] < 0) q = q.map(x => -x);
      st.prevQ = q;
      const qf = st.filtQ.filter(q, t), tf = st.filtT.filter(p.t, t);
      const nq = Math.hypot(qf[0], qf[1], qf[2], qf[3]);
      st.q = qf.map(x => x / nq); st.t = tf;
    }
    if (res.poses.cube || res.poses.card) this.stats.found++;
    const hold = Math.max(0.45, 4 / Math.max(this.fps, 1));
    const visible = k => this.T[k].raw && t - this.T[k].seen < hold;
    const next = visible('cube') ? 'cube' : visible('card') ? 'card' : null;
    res.prevActive = this.active;
    if (next !== this.active) {
      if (this.active) this.T[this.active].lostAt = t;
      this.active = next;
    }
    res.active = this.active;
  }

  // the field of view changed: scale distances so the next frames continue smoothly
  rescale(k) {
    for (const st of Object.values(this.T)) {
      st.filtT.reset(); st.filtQ.reset(); st.prevQ = null;
      if (st.raw) st.raw = Object.assign({}, st.raw, { t: st.raw.t.map(x => x * k) });
      if (st.t) st.t = st.t.map(x => x * k);
    }
    this.tracker.prev = {};
  }

  reset() {
    for (const k of Object.keys(this.T)) { const s = targetState(); s.size = this.T[k].size; this.T[k] = s; }
    this.active = null; this.tracker.prev = {};
  }
}

function meanColour(d) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 64) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return n ? [r / n, g / n, b / n] : null;
}
