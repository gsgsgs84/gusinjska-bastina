// Printed AR trail map: finds its markers in a camera frame and solves where the map lies.
// Used inside a worker (staze-ar-worker.js) and, where module workers are missing, on the main thread.
// Coordinates: map frame in millimetres at A4 size (x east, y up out of the paper, z south), camera frame as in OpenCV;
// the pose returned is in metres. (The shared pose solver expects millimetre-sized depths.)
import { MarkerDetector } from './cv/detector.js';
import { refinePose, planarPoseCandidates, reprojErrors, mulv } from './cv/pose.js';

const PLANE = { U: [1, 0, 0], V: [0, 0, -1], N: [0, 1, 0], O: [0, 0, 0] };
const RADII = [3, 5, 8, 2];       // adaptive-threshold windows, cycled so sharp, blurred, small and large markers are all found

export class MapTracker {
  constructor(layout) {
    this.corners = new Map();
    for (const m of layout.markers) this.corners.set(m.id, m.corners.map(c => [c[0], c[1], c[2]]));
    this.detector = new MarkerDetector(layout.markers.map(m => ({ id: m.id, cells: m.cells })), { maxHamming: 3, minSide: 10 });
    this.prev = null;
    this.frame = 0;
  }

  // rgba: Uint8ClampedArray w*h*4; K: {fx, fy, cx, cy} in these pixels; time in seconds.
  process(rgba, w, h, K, time) {
    const t0 = now();
    this.frame++;
    const radius = RADII[this.frame % RADII.length];
    let det = this.detector.detect(rgba, w, h, { radius });
    let rescue = false;
    if (!det.some(m => this.corners.has(m.id))) {
      // nothing found: try once more at half size, where motion blur and defocus are half as wide
      const hw = w >> 1, hh = h >> 1, g = this.detector.gray, half = this.half && this.half.length === hw * hh ? this.half : (this.half = new Uint8Array(hw * hh));
      for (let y = 0; y < hh; y++) {
        const r0 = 2 * y * w, r1 = r0 + w, o = y * hw;
        for (let x = 0; x < hw; x++) { const i = r0 + 2 * x, j = r1 + 2 * x; half[o + x] = (g[i] + g[i + 1] + g[j] + g[j + 1] + 2) >> 2; }
      }
      det = this.detector.detectGray(half, hw, hh, { radius: 3 }).map(m => ({ ...m, corners: m.corners.map(p => ({ x: p.x * 2 + 0.5, y: p.y * 2 + 0.5 })) }));
      rescue = true;
    }
    const seen = new Map();
    for (const m of det) {
      if (!this.corners.has(m.id)) continue;
      const c = m.corners.map(p => [p.x, p.y]);
      const old = seen.get(m.id);             // the same marker twice: keep the larger outline
      if (!old || area(c) > area(old.img)) seen.set(m.id, { id: m.id, obj: this.corners.get(m.id), img: c });
    }
    const groups = [...seen.values()];
    const out = { found: false, n: 0, markers: groups.map(g => ({ id: g.id, c: g.img })), ms: 0, radius, w, h, rescue };
    if (groups.length) {
      const prior = this.prev && time - this.prev.time < 0.35 ? this.prev : null;
      const p = solve(groups, K, prior);
      if (p && p.rms < Math.max(3, 0.006 * Math.max(w, h))) {
        Object.assign(out, { found: true, R: p.R, t: p.t.map(v => v / 1000), rms: p.rms, n: p.ids.length, ids: p.ids, ambiguous: p.ambiguous, tilt: p.tilt });
        this.prev = { R: p.R, t: p.t, time };
        // focal length from the map's perspective (only when tilted and spread over 2+ markers)
        if (p.ids.length >= 2 && p.tilt > 22) {
          const used = groups.filter(g => p.ids.includes(g.id));
          const f = focalFromPlane(used.flatMap(g => g.obj.map(X => [X[0], -X[2]])), used.flatMap(g => g.img.map(q => [q[0] - K.cx, q[1] - K.cy])));
          if (f) out.f = f;
        }
      } else if (!p) this.prev = null;
    }
    out.ms = now() - t0;
    return out;
  }
}

function solve(groups, K, prior) {
  for (let pass = 0; pass < 3; pass++) {
    const obj = groups.flatMap(g => g.obj), img = groups.flatMap(g => g.img);
    const cands = [];
    if (prior) cands.push(refinePose(prior.R, prior.t, obj, img, K));
    if (!prior || cands[0].cost / obj.length > 4) {
      for (const c of planarPoseCandidates(obj, img, K, PLANE)) cands.push(refinePose(c.R, c.t, obj, img, K));
    }
    const ok = cands.filter(c => c.t[2] > 0 && facing(c));
    const pool = (ok.length ? ok : cands).sort((a, b) => a.cost - b.cost);
    const best = pool[0];
    if (!best || !isFinite(best.cost)) return null;
    // drop the worst marker if it clearly disagrees with the rest, then solve again
    const errs = groups.map(g => reprojErrors(best.R, best.t, K, g.obj, g.img).reduce((s, x) => s + x, 0) / 4);
    const sorted = errs.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1];
    let worst = 0;
    for (let i = 1; i < errs.length; i++) if (errs[i] > errs[worst]) worst = i;
    if (groups.length > 1 && errs[worst] > Math.max(4, 3 * med)) { groups = groups.filter((_, i) => i !== worst); prior = best; continue; }
    const all = reprojErrors(best.R, best.t, K, obj, img);
    const rms = Math.sqrt(all.reduce((s, x) => s + x * x, 0) / all.length);
    let margin = Infinity;
    for (const c of pool.slice(1)) if (rotAngle(best.R, c.R) > 5) margin = Math.min(margin, (c.cost - best.cost) / Math.max(best.cost, 1));
    const n = mulv(best.R, PLANE.N);                                     // map normal in the camera frame
    const tilt = Math.acos(Math.min(1, Math.abs(n[2]))) * 180 / Math.PI;  // 0 = looking straight down at it
    return { R: best.R, t: best.t, rms, ids: groups.map(g => g.id), ambiguous: groups.length === 1 && margin < 0.5, tilt };
  }
  return null;
}

function facing(pose) {        // the printed side looks at the camera
  const n = mulv(pose.R, PLANE.N);
  return n[0] * pose.t[0] + n[1] * pose.t[1] + n[2] * pose.t[2] < 0;
}
function rotAngle(A, B) {
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += A[i * 3 + k] * B[i * 3 + k];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
}
function area(c) {
  let a = 0;
  for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

// Focal length (pixels) from the homography of a plane seen in perspective, assuming square pixels and the
// principal point at the image centre: the two plane axes must come out perpendicular and of equal length.
// uv: plane coordinates (metric), xy: pixel coordinates relative to the image centre.
export function focalFromPlane(uv, xy) {
  const H = homography(uv, xy);
  if (!H) return null;
  const [a1, a2, , b1, b2, , c1, c2] = H;
  const A1 = a1 * a2 + b1 * b2, B1 = -c1 * c2;
  const A2 = a1 * a1 + b1 * b1 - a2 * a2 - b2 * b2, B2 = -(c1 * c1 - c2 * c2);
  const den = A1 * A1 + A2 * A2;
  if (den < 1e-30) return null;
  const x = (A1 * B1 + A2 * B2) / den;          // 1 / f^2
  if (!(x > 0)) return null;
  const f = 1 / Math.sqrt(x);
  return isFinite(f) ? f : null;
}

// Normalised DLT homography (uv -> xy), h33 = 1; returns row-major 3x3 or null.
function homography(uv, xy) {
  const n = uv.length;
  if (n < 4) return null;
  const norm = pts => {
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= n; my /= n;
    let d = 0;
    for (const p of pts) d += Math.hypot(p[0] - mx, p[1] - my);
    const s = Math.SQRT2 / Math.max(d / n, 1e-12);
    return { s, mx, my, p: pts.map(p => [(p[0] - mx) * s, (p[1] - my) * s]) };
  };
  const A = norm(uv), B = norm(xy);
  // least squares on the 8 unknowns
  const M = new Float64Array(64), r = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const [u, v] = A.p[i], [x, y] = B.p[i];
    const rows = [[u, v, 1, 0, 0, 0, -u * x, -v * x, x], [0, 0, 0, u, v, 1, -u * y, -v * y, y]];
    for (const row of rows) for (let a = 0; a < 8; a++) { r[a] += row[a] * row[8]; for (let b = 0; b < 8; b++) M[a * 8 + b] += row[a] * row[b]; }
  }
  const h = solveN(M, r, 8);
  if (!h) return null;
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  // denormalise: H = T_B^-1 * Hn * T_A
  const TA = [A.s, 0, -A.s * A.mx, 0, A.s, -A.s * A.my, 0, 0, 1];
  const TBi = [1 / B.s, 0, B.mx, 0, 1 / B.s, B.my, 0, 0, 1];
  const H = mul3(mul3(TBi, Hn), TA);
  const k = Math.hypot(...H);
  return H.map(x => x / k);
}
function mul3(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}
function solveN(Ain, bin, n) {
  const A = Array.from(Ain), b = Array.from(bin);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (Math.abs(A[p * n + c]) < 1e-14) return null;
    if (p !== c) { for (let k = 0; k < n; k++) [A[c * n + k], A[p * n + k]] = [A[p * n + k], A[c * n + k]]; [b[c], b[p]] = [b[p], b[c]]; }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r * n + k] * x[k]; x[r] = s / A[r * n + r]; }
  return x;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
