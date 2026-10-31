// Gdje su mace? – where the kittens can hide in the scanned room.
// Pure logic (no three.js), so it can be tested in Node. Units: metres, y up; the floor is near y = 0.
//
// Input: the room's tracked points (feature points from room tracking, collected during the scan) and the camera
// positions along the scan. Output: the floor height, occupied 10 cm voxels (used to hide cats behind real things and
// to test what the camera can see), hiding spots for the 5 white cats, walking loops for the 3 grey cats and the
// dash spots of the black cat.

export const CELL = 0.1;                 // grid and voxel size
const IY0 = 8;                           // voxel rows below the floor kept in the key
const TOP_MIN = 0.2, TOP_HIGH = 1.35, TOP_MAX = 2.2;

export function rng(seed) {              // small deterministic random generator (mulberry32)
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const vkey = (ix, iy, iz) => ((ix + 2048) * 4096 + (iz + 2048)) * 64 + (iy + IY0);
const ckey = (ix, iz) => (ix + 2048) * 4096 + (iz + 2048);
const ci = v => Math.floor(v / CELL);

// Floor: the lowest dense layer of points; tracking puts its ground near y = 0, so look around there.
export function estimateFloor(points) {
  const low = points.filter(p => p.y > -0.9 && p.y < 0.7);
  if (low.length < 12) return 0;
  const BIN = 0.02, n = Math.round(1.6 / BIN), h = new Array(n).fill(0);
  for (const p of low) { const b = Math.floor((p.y + 0.9) / BIN); if (b >= 0 && b < n) h[b]++; }
  const need = Math.max(6, low.length * 0.06);
  for (let b = 1; b < n - 1; b++) {
    if (h[b - 1] + h[b] + h[b + 1] >= need) {
      const y0 = -0.9 + (b - 1) * BIN, y1 = -0.9 + (b + 2) * BIN;
      const sel = low.filter(p => p.y >= y0 && p.y < y1);
      sel.sort((a, c) => a.y - c.y);
      return sel[sel.length >> 1].y;
    }
  }
  return 0;
}

export function analyseRoom(pointsIn, camsIn, opt = {}) {
  const R = rng(opt.seed ?? 1);
  const points = pointsIn.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  const floorY = opt.floorY ?? estimateFloor(points);
  const cams = thin(camsIn.length ? camsIn : [{ x: 0, y: floorY + 1.4, z: 0 }], 30);
  const camC = cams.reduce((a, c) => ({ x: a.x + c.x / cams.length, y: a.y + c.y / cams.length, z: a.z + c.z / cams.length }), { x: 0, y: 0, z: 0 });

  // ---- voxels and columns ----
  const vox = new Map(), cols = new Map(), vb = new Map();   // points per voxel, and the box around its points
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    const h = p.y - floorY;
    if (h < -0.15 || h > 2.6) continue;
    const ix = ci(p.x), iz = ci(p.z);
    const ck = ckey(ix, iz);
    let c = cols.get(ck); if (!c) cols.set(ck, c = []); c.push({ x: p.x, h, z: p.z });
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    if (h < 0.04) continue;
    const k = vkey(ix, ci(h), iz); vox.set(k, (vox.get(k) || 0) + 1);
    const b = vb.get(k);
    if (!b) vb.set(k, [p.x, p.x, p.y, p.y, p.z, p.z]);
    else { if (p.x < b[0]) b[0] = p.x; if (p.x > b[1]) b[1] = p.x; if (p.y < b[2]) b[2] = p.y; if (p.y > b[3]) b[3] = p.y; if (p.z < b[4]) b[4] = p.z; if (p.z > b[5]) b[5] = p.z; }
  }
  for (const c of cams) { minX = Math.min(minX, c.x - 0.6); maxX = Math.max(maxX, c.x + 0.6); minZ = Math.min(minZ, c.z - 0.6); maxZ = Math.max(maxZ, c.z + 0.6); }
  // a voxel counts when it has 2+ points, or 1 point with an occupied neighbour (lonely points are often noise)
  const occ = new Set();
  for (const [k, n] of vox) {
    if (n >= 2) { occ.add(k); continue; }
    const iy = (k % 64) - IY0, rest = Math.floor(k / 64), iz = (rest % 4096) - 2048, ix = Math.floor(rest / 4096) - 2048;
    let nb = false;
    for (let dx = -1; dx <= 1 && !nb; dx++) for (let dy = -1; dy <= 1 && !nb; dy++) for (let dz = -1; dz <= 1 && !nb; dz++) {
      if ((dx || dy || dz) && vox.has(vkey(ix + dx, iy + dy, iz + dz))) nb = true;
    }
    if (nb) occ.add(k);
  }
  // close one-voxel holes in sparse surfaces (a voxel between two occupied ones along an axis), so a sofa front or a
  // wall with few points still hides what is behind it
  const dec = k => { const iy = (k % 64) - IY0, rest = Math.floor(k / 64); return [Math.floor(rest / 4096) - 2048, iy, (rest % 4096) - 2048]; };
  for (let pass = 0; pass < 2; pass++) {
    const add = [];
    for (const k of occ) {
      const [ix, iy, iz] = dec(k);
      for (const [dx, dy, dz] of [[2, 0, 0], [0, 2, 0], [0, 0, 2], [2, 0, 2], [2, 0, -2]]) {
        const k2 = vkey(ix + dx, iy + dy, iz + dz), km = vkey(ix + dx / 2, iy + dy / 2, iz + dz / 2);
        if (!occ.has(k2) || occ.has(km) || iy + dy / 2 < 0) continue;
        const a = vb.get(k), b = vb.get(k2);
        add.push([km, [Math.min(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.min(a[4], b[4]), Math.max(a[5], b[5])]]);
      }
    }
    for (const [k, b] of add) if (!occ.has(k)) { occ.add(k); vb.set(k, b); }
  }
  const isOcc = (ix, iy, iz) => occ.has(vkey(ix, iy, iz));
  // each occupied voxel hides only the space around its own points (padded a little), stretched to the voxel's
  // side wherever the neighbour on that side is occupied too: a table top becomes a thin continuous slab, a wall a thin
  // continuous sheet, and a cat sitting on the table or next to its edge is not cut off by the rest of a 10 cm cube
  const box = new Map();
  for (const k of occ) {
    const b = vb.get(k), iy = (k % 64) - IY0, rest = Math.floor(k / 64), iz = (rest % 4096) - 2048, ix = Math.floor(rest / 4096) - 2048;
    const c0 = [ix * CELL, floorY + iy * CELL, iz * CELL], P = 0.025, E = 0.008;
    const lo = [b[0] - P, b[2] - 0.035, b[4] - P], hi = [b[1] + P, b[3] - 0.004, b[5] + P];   // tops stay just under a sitting cat's feet
    const nb = [[[-1, 0, 0], [1, 0, 0]], [[0, -1, 0], [0, 1, 0]], [[0, 0, -1], [0, 0, 1]]];
    for (let a = 0; a < 3; a++) {
      if (occ.has(vkey(ix + nb[a][0][0], iy + nb[a][0][1], iz + nb[a][0][2]))) lo[a] = c0[a] - E;
      if (occ.has(vkey(ix + nb[a][1][0], iy + nb[a][1][1], iz + nb[a][1][2]))) hi[a] = c0[a] + CELL + E;
      if (hi[a] - lo[a] < 0.05) { if (a === 1) lo[a] = hi[a] - 0.05; else { const m = (lo[a] + hi[a]) / 2; lo[a] = m - 0.025; hi[a] = m + 0.025; } }
      lo[a] = Math.max(c0[a] - E, lo[a]); hi[a] = Math.min(c0[a] + CELL + E, hi[a]);
    }
    box.set(k, [lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]]);
  }
  function hitBox(k, ox, oy, oz, dx, dy, dz, tmin, tmax) {      // slab test against one voxel's box
    const b = box.get(k); if (!b) return Infinity;
    let t0 = tmin, t1 = tmax;
    for (let a = 0; a < 3; a++) {
      const o = a === 0 ? ox : a === 1 ? oy : oz, d = a === 0 ? dx : a === 1 ? dy : dz, lo = b[a * 2], hi = b[a * 2 + 1];
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; continue; }
      let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) { const q = ta; ta = tb; tb = q; }
      if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return Infinity;
    }
    return t0;
  }

  // ---- ray through the voxels (Amanatides & Woo); t of the first occupied voxel, or Infinity ----
  function rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    const len = Math.hypot(dx, dy, dz) || 1; dx /= len; dy /= len; dz /= len;
    const y0 = oy - floorY;
    let ix = ci(ox), iy = ci(y0), iz = ci(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(CELL / dx) : Infinity, tdy = dy ? Math.abs(CELL / dy) : Infinity, tdz = dz ? Math.abs(CELL / dz) : Infinity;
    let tx = dx ? ((dx > 0 ? (ix + 1) * CELL - ox : ox - ix * CELL) / Math.abs(dx)) : Infinity;
    let ty = dy ? ((dy > 0 ? (iy + 1) * CELL - y0 : y0 - iy * CELL) / Math.abs(dy)) : Infinity;
    let tz = dz ? ((dz > 0 ? (iz + 1) * CELL - oz : oz - iz * CELL) / Math.abs(dz)) : Infinity;
    let t = 0;
    for (let step = 0; step < 400 && t <= maxT; step++) {
      const tNext = Math.min(tx, ty, tz);
      if (iy >= 0 && iy < 56 && isOcc(ix, iy, iz)) { const th = hitBox(vkey(ix, iy, iz), ox, oy, oz, dx, dy, dz, t, Math.min(tNext, maxT)); if (th <= maxT) return th; }
      if (tx < ty && tx < tz) { t = tx; tx += tdx; ix += sx; }
      else if (ty < tz) { t = ty; ty += tdy; iy += sy; }
      else { t = tz; tz += tdz; iz += sz; }
      if (iy < -2 || iy > 60) return Infinity;
    }
    return Infinity;
  }
  // share of a cat's sample points hidden from a camera (0 = fully visible)
  function hidden(samples, cam) {
    let n = 0;
    for (const s of samples) {
      const dx = s.x - cam.x, dy = s.y - cam.y, dz = s.z - cam.z, d = Math.hypot(dx, dy, dz);
      if (rayHit(cam.x, cam.y, cam.z, dx, dy, dz, d - 0.07) < d - 0.07) n++;
    }
    return n / samples.length;
  }

  // ---- floor grid ----
  const gx0 = ci(minX) - 1, gz0 = ci(minZ) - 1, gw = ci(maxX) - gx0 + 2, gd = ci(maxZ) - gz0 + 2;
  const inGrid = (ix, iz) => ix >= gx0 && iz >= gz0 && ix < gx0 + gw && iz < gz0 + gd;
  const gi = (ix, iz) => (iz - gz0) * gw + (ix - gx0);
  const blocked = new Uint8Array(gw * gd), known = new Uint8Array(gw * gd), walk = new Uint8Array(gw * gd);
  const floorPts = [];
  for (const c of cols.values()) for (const p of c) if (p.h < 0.05) floorPts.push(p);
  for (let iz = gz0; iz < gz0 + gd; iz++) for (let ix = gx0; ix < gx0 + gw; ix++) {
    const i = gi(ix, iz);
    blocked[i] = (isOcc(ix, 1, iz) || isOcc(ix, 2, iz) || isOcc(ix, 3, iz) || (vox.get(vkey(ix, 0, iz)) || 0) >= 3) ? 1 : 0;
  }
  // known floor: seen floor points nearby, under something that was seen, or where the visitor walked
  for (const p of floorPts) {
    const ix = ci(p.x), iz = ci(p.z);
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dz * dz <= 16 && inGrid(ix + dx, iz + dz)) known[gi(ix + dx, iz + dz)] = 1;
  }
  for (const ck of cols.keys()) { const ix = Math.floor(ck / 4096) - 2048, iz = (ck % 4096) - 2048; if (inGrid(ix, iz)) known[gi(ix, iz)] = 1; }
  for (const c of cams) {
    const ix = ci(c.x), iz = ci(c.z);
    for (let dz = -16; dz <= 16; dz++) for (let dx = -16; dx <= 16; dx++) if (dx * dx + dz * dz <= 256 && inGrid(ix + dx, iz + dz)) known[gi(ix + dx, iz + dz)] = 1;
  }
  // a floor cell with something above it (a table, or the top of a solid sofa or cabinet) counts only if floor points
  // were seen right there: under a table you can see the floor, inside a sofa you cannot
  const fp = new Uint16Array(gw * gd);
  for (const p of floorPts) { const ix = ci(p.x), iz = ci(p.z); if (inGrid(ix, iz)) fp[gi(ix, iz)]++; }
  const covered = (ix, iz) => (cols.get(ckey(ix, iz)) || []).some(p => p.h > 0.3 && p.h < 1.25);
  const seenUnder = (ix, iz) => {                               // floor seen in this cell, or in two covered neighbours
    if (fp[gi(ix, iz)]) return true;
    let n = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const x = ix + dx, z = iz + dz;
      if ((dx || dz) && inGrid(x, z) && fp[gi(x, z)] && covered(x, z)) n++;
    }
    return n >= 2;
  };
  for (let iz = gz0; iz < gz0 + gd; iz++) for (let ix = gx0; ix < gx0 + gw; ix++) {
    const i = gi(ix, iz);
    walk[i] = known[i] && !blocked[i] && (!covered(ix, iz) || seenUnder(ix, iz)) ? 1 : 0;
  }
  // cats are about 8 cm wide: keep paths one cell away from obstacles
  const pass = new Uint8Array(gw * gd);
  for (let iz = gz0; iz < gz0 + gd; iz++) for (let ix = gx0; ix < gx0 + gw; ix++) {
    if (!walk[gi(ix, iz)]) continue;
    let ok = 1;
    for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) if (inGrid(ix + dx, iz + dz) && blocked[gi(ix + dx, iz + dz)]) ok = 0;
    pass[gi(ix, iz)] = ok;
  }
  const camDist = (x, z) => { let d = Infinity; for (const c of cams) d = Math.min(d, Math.hypot(c.x - x, c.z - z)); return d; };

  // ---- candidate spots ----
  const cands = [];
  const colAt = (ix, iz) => cols.get(ckey(ix, iz)) || [];
  const clearAbove = (ix, iz, h0, h1) => !colAt(ix, iz).some(p => p.h > h0 && p.h < h1);
  // 1. flat layers of points (table tops, seats, shelves); with free space above they are places to sit on
  const flat = new Map();
  for (const [ck, col] of cols) {
    const ix = Math.floor(ck / 4096) - 2048, iz = (ck % 4096) - 2048;
    const hs = col.map(p => p.h).filter(h => h > TOP_MIN && h < TOP_MAX).sort((a, b) => a - b);
    if (!hs.length) continue;
    const layers = []; let cur = [hs[0]];
    for (let i = 1; i < hs.length; i++) { if (hs[i] - hs[i - 1] > 0.1) { layers.push(cur); cur = []; } cur.push(hs[i]); }
    layers.push(cur);
    for (const L of layers) {
      const top = L[L.length - 1];
      const sup = [];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const p of colAt(ix + dx, iz + dz)) if (Math.abs(p.h - top) < 0.045) sup.push(p);
      if (sup.length < 4) continue;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, sx = 0, sz = 0, sh = 0;
      for (const p of sup) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); sx += p.x; sz += p.z; sh += p.h; }
      if (x1 - x0 < 0.08 || z1 - z0 < 0.08) continue;         // a wall or a thin edge, not a surface
      let below = 0;                                           // many points just below: a wall or a corner, not a top
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const p of colAt(ix + dx, iz + dz)) if (p.h > top - 0.35 && p.h < top - 0.06) below++;
      if (below > sup.length * 1.5) continue;
      // the cells holding this layer must be open above it; on a wall (or in a corner) the wall goes on upwards
      let supCells = 0, wallish = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const cc = colAt(ix + dx, iz + dz);
        if (!cc.some(p => Math.abs(p.h - top) < 0.045)) continue;
        supCells++;
        if (cc.some(p => p.h > top + 0.12 && p.h < top + 0.6)) wallish++;
      }
      if (wallish * 2 >= supCells) continue;
      let f = flat.get(ck); if (!f) flat.set(ck, f = []); f.push(top);
      if (!clearAbove(ix, iz, top + 0.05, top + 0.32)) continue;
      let freeNb = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && clearAbove(ix + dx, iz + dz, top + 0.05, top + 0.3)) freeNb++;
      if (freeNb < 5) continue;
      const x = sx / sup.length, z = sz / sup.length, h = Math.max(top, sh / sup.length);
      cands.push({ type: h < TOP_HIGH ? 'on' : 'high', x, y: floorY + h, z, ix, iz });
    }
  }
  const roofOver = (ix, iz) => {                                 // a flat surface 34 cm – 1 m above this floor cell
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const f = flat.get(ckey(ix + dx, iz + dz)); if (f && f.some(h => h > 0.34 && h < 1.05)) return true;
    }
    return false;
  };
  // 2. floor: beside things, under things, open floor
  for (let iz = gz0; iz < gz0 + gd; iz++) for (let ix = gx0; ix < gx0 + gw; ix++) {
    const i = gi(ix, iz);
    if (!walk[i]) continue;
    const x = (ix + 0.5) * CELL, z = (iz + 0.5) * CELL;
    if (camDist(x, z) < 0.55) continue;
    if (roofOver(ix, iz) && colAt(ix, iz).some(p => p.h > 0.34 && p.h < 1.05) && clearAbove(ix, iz, 0.04, 0.3)) { cands.push({ type: 'under', x, y: floorY, z, ix, iz }); continue; }
    let ox = 0, oz = 0, nb = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!(dx || dz) || !inGrid(ix + dx, iz + dz) || !blocked[gi(ix + dx, iz + dz)]) continue;
      if (colAt(ix + dx, iz + dz).some(p => p.h > 0.28)) { ox += dx; oz += dz; nb++; }
    }
    if (nb) cands.push({ type: 'beside', x, y: floorY, z, ix, iz, away: Math.atan2(-ox, -oz) });
    else if (known[i] && floorPts.length && R() < 0.35) cands.push({ type: 'floor', x, y: floorY, z, ix, iz });
  }

  // ---- how visible is each candidate from where the visitor was? ----
  const SIT = [[0, 0.19, 0.08], [0.03, 0.24, 0.09], [-0.03, 0.24, 0.09], [0, 0.1, 0], [0, 0.09, -0.09]];
  const LOW = [[0, 0.1, 0.1], [0.03, 0.15, 0.11], [-0.03, 0.15, 0.11], [0, 0.07, 0], [0, 0.06, -0.09]];
  const camsNear = c => cams.filter(k => Math.hypot(k.x - c.x, k.z - c.z) < 6);
  const samplesFor = (c, low, yaw = 0) => (low ? LOW : SIT).map(([a, b, d]) => ({
    x: c.x + a * Math.cos(yaw) + d * Math.sin(yaw), y: c.y + b, z: c.z - a * Math.sin(yaw) + d * Math.cos(yaw) }));
  // nothing within a cat's reach around it (walls with few points, chair legs…): nudge it away or drop it
  function clearFoot(c, r = 0.09) {
    const h0 = c.y - floorY + 0.03, h1 = c.y - floorY + 0.28;
    for (let tries = 0; tries < 3; tries++) {
      let hx = 0, hz = 0, n = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const p of colAt(ci(c.x) + dx, ci(c.z) + dz)) {
        if (p.h < h0 || p.h > h1) continue;
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < r) { hx += (c.x - p.x) / (d || 1); hz += (c.z - p.z) / (d || 1); n++; }
      }
      if (!n) return true;
      const l = Math.hypot(hx, hz) || 1;
      c.x += hx / l * 0.05; c.z += hz / l * 0.05;
    }
    return false;
  }
  const kept = [];
  for (const c of cands) {
    if (!clearFoot(c)) continue;
    const near = camsNear(c);
    if (!near.length) continue;
    const s = samplesFor(c, c.type === 'under');
    const hs = near.map(k => hidden(s, k)).sort((a, b) => a - b);
    c.best = hs[0]; c.median = hs[hs.length >> 1];
    if (c.best > 0.8) continue;                                 // nobody could see it from where they walked
    c.dist = camDist(c.x, c.z);
    if (c.median >= 0.4 && c.type !== 'under') c.base = c.type, c.type = 'behind';
    kept.push(c);
  }

  // ---- choose ----
  const chosen = [];
  const farFrom = (c, list, d) => list.every(o => Math.hypot(o.x - c.x, o.z - c.z) >= d);
  const BONUS = { on: 0.5, behind: 0.6, under: 0.5, high: 0.4, beside: 0.25, floor: 0 };
  const score = c => (c.dist < 0.6 ? -2 : 0) + 1 - Math.abs(c.dist - 2) / 3 + BONUS[c.type] + R() * 0.35 - c.best * 0.3;
  for (const c of kept) c.score = score(c);
  kept.sort((a, b) => b.score - a.score);
  const pick = (types, d, avoid = []) => {
    const c = kept.find(k => types.includes(k.type) && !k.used && farFrom(k, chosen, d) && farFrom(k, avoid, 0.5));
    if (c) c.used = true;
    return c;
  };
  const PREF = ['on', 'behind', 'under', 'high', 'beside', 'on', 'behind', 'beside', 'under', 'floor'];
  for (const t of PREF) { if (chosen.length >= 5) break; const c = pick([t], 0.7); if (c) chosen.push(c); }
  for (const d of [0.7, 0.45, 0.25]) while (chosen.length < 5) { const c = pick(Object.keys(BONUS), d); if (!c) break; chosen.push(c); }
  const fallback = chosen.length < 5;
  while (chosen.length < 5) {                                    // too few points: put them on the floor around the visitor
    const a = R() * Math.PI * 2, r = 1 + R() * 1.6;
    chosen.push({ type: 'floor', x: camC.x + Math.sin(a) * r, y: floorY, z: camC.z + Math.cos(a) * r, best: 0, dist: r });
  }
  const faceCam = c => Math.atan2(camC.x - c.x, camC.z - c.z);
  const POSES = { on: ['sit', 'loaf'], high: ['loaf'], under: ['sleep'], behind: ['peek', 'sit'], beside: ['sit', 'sleep'], floor: ['sleep', 'sit'] };
  const whites = chosen.slice(0, 5).map(c => {
    const poses = POSES[c.type];
    const pose = poses[Math.floor(R() * poses.length)];
    const yaw = c.type === 'beside' && c.away != null && R() < 0.5 ? c.away : faceCam(c) + (R() - 0.5) * 1.2;
    return { type: c.type, base: c.base || c.type, pose, x: c.x, y: c.y, z: c.z, yaw, best: c.best };
  });

  // ---- floor paths (breadth-first search on the grid) ----
  function nearestPass(x, z, maxR = 8) {
    const ix = ci(x), iz = ci(z);
    for (let r = 0; r <= maxR; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (inGrid(ix + dx, iz + dz) && pass[gi(ix + dx, iz + dz)]) return [ix + dx, iz + dz];
    }
    return null;
  }
  function bfs(start) {
    const dist = new Int32Array(gw * gd).fill(-1), par = new Int32Array(gw * gd).fill(-1);
    const q = [gi(start[0], start[1])]; dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], ix = (i % gw) + gx0, iz = Math.floor(i / gw) + gz0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = ix + dx, nz = iz + dz;
        if (!inGrid(nx, nz)) continue;
        const j = gi(nx, nz);
        if (dist[j] >= 0 || !pass[j]) continue;
        if (dx && dz && (!pass[gi(ix + dx, iz)] || !pass[gi(ix, iz + dz)])) continue;    // no corner cutting
        dist[j] = dist[i] + 1; par[j] = i; q.push(j);
      }
    }
    return { dist, par };
  }
  const cellPt = i => ({ x: ((i % gw) + gx0 + 0.5) * CELL, y: floorY, z: (Math.floor(i / gw) + gz0 + 0.5) * CELL });
  function trace(b, to) { const out = []; for (let i = to; i >= 0; i = b.par[i]) out.push(cellPt(i)); return out.reverse(); }
  function lineFree(a, b) {                                      // straight walk between two floor points stays on passable cells
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL * 0.5));
    for (let k = 0; k <= n; k++) {
      const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n, ix = ci(x), iz = ci(z);
      if (!inGrid(ix, iz) || !pass[gi(ix, iz)]) return false;
    }
    return true;
  }
  function smooth(p) {
    if (p.length < 3) return p;
    const out = [p[0]]; let i = 0;
    while (i < p.length - 1) { let j = p.length - 1; while (j > i + 1 && !lineFree(p[i], p[j])) j--; out.push(p[j]); i = j; }
    return out;
  }
  // a route between any two spots: down from a surface, across the floor, up onto the other one
  function route(a, b) {
    const sa = nearestPass(a.x, a.z, 6), sb = nearestPass(b.x, b.z, 6);
    let mid = null;
    if (sa && sb) {
      const r = bfs(sa), j = gi(sb[0], sb[1]);
      if (r.dist[j] >= 0) mid = smooth(trace(r, j));
    }
    const pts = [{ x: a.x, y: a.y, z: a.z }];
    if (mid) for (const p of mid) pts.push(p);
    pts.push({ x: b.x, y: b.y, z: b.z });
    return dedupe(pts);
  }

  // ---- grey cats: walking loops on the floor ----
  const passCells = [];
  for (let i = 0; i < pass.length; i++) if (pass[i]) { const p = cellPt(i); if (camDist(p.x, p.z) > 0.6) passCells.push(i); }
  const greys = [];
  const usedStarts = [];
  for (let g = 0; g < 3; g++) {
    let loop = null;
    for (let tries = 0; tries < 40 && !loop && passCells.length; tries++) {
      const i0 = passCells[Math.floor(R() * passCells.length)], p0 = cellPt(i0);
      if (!farFrom(p0, usedStarts, 0.9) || !farFrom(p0, whites, 0.35)) continue;
      const b0 = bfs([(i0 % gw) + gx0, Math.floor(i0 / gw) + gz0]);
      const ring = passCells.filter(i => b0.dist[i] >= 7 && b0.dist[i] <= 22);
      if (ring.length < 4) continue;
      const i1 = ring[Math.floor(R() * ring.length)];
      const b1 = bfs([(i1 % gw) + gx0, Math.floor(i1 / gw) + gz0]);
      const ring2 = ring.filter(i => b1.dist[i] >= 6 && Math.hypot(cellPt(i).x - p0.x, cellPt(i).z - p0.z) > 0.5);
      if (!ring2.length) continue;
      const i2 = ring2[Math.floor(R() * ring2.length)];
      const leg1 = smooth(trace(b0, i1)), leg2 = smooth(trace(b1, i2)), leg3 = smooth(trace(bfs([(i2 % gw) + gx0, Math.floor(i2 / gw) + gz0]), i0));
      loop = dedupe([...leg1, ...leg2.slice(1), ...leg3.slice(1)]);
      usedStarts.push(p0);
    }
    if (!loop) {                                                 // nowhere to walk: a small circle on the floor
      const a = R() * Math.PI * 2, r = 1.2 + R(), cx = camC.x + Math.sin(a) * r, cz = camC.z + Math.cos(a) * r;
      loop = []; for (let k = 0; k <= 10; k++) { const b = k / 10 * Math.PI * 2; loop.push({ x: cx + Math.sin(b) * 0.45, y: floorY, z: cz + Math.cos(b) * 0.45 }); }
    }
    greys.push({ path: loop, loop: true });
  }

  // ---- black cat: four places to rest, far apart ----
  const blackSpots = [];
  const order = kept.filter(k => !k.used && k.type !== 'high').map(k => ({ k, s: k.median + R() * 0.5 }))
    .sort((a, b) => b.s - a.s).map(o => o.k);
  for (const c of order) {
    if (blackSpots.length >= 4) break;
    if (farFrom(c, blackSpots, 1.0) && farFrom(c, whites, 0.5)) blackSpots.push({ type: c.type, x: c.x, y: c.y, z: c.z, yaw: faceCam(c) });
  }
  while (blackSpots.length < 4) {
    const a = R() * Math.PI * 2, r = 1 + R() * 1.8;
    const s = { type: 'floor', x: camC.x + Math.sin(a) * r, y: floorY, z: camC.z + Math.cos(a) * r };
    s.yaw = faceCam(s); blackSpots.push(s);
  }

  // where a thrown fish lands: the first thing the ray hits, or the floor
  function land(o, d) {
    const len = Math.hypot(d.x, d.y, d.z) || 1, dx = d.x / len, dy = d.y / len, dz = d.z / len;
    let t = rayHit(o.x, o.y, o.z, dx, dy, dz, 6);
    if (dy < -0.02) { const tf = (floorY - o.y) / dy; if (tf > 0 && tf < t) t = tf; }
    if (!Number.isFinite(t) || t > 6) return null;
    const x = o.x + dx * t, z = o.z + dz * t;
    let y = Math.max(floorY, o.y + dy * t);
    const ix = ci(x), iz = ci(z);                                // climb to the top of what was hit
    let iy = ci(y - floorY); while (iy < 40 && isOcc(ix, iy, iz)) iy++;
    if (iy > 0 && isOcc(ix, iy - 1, iz)) y = floorY + iy * CELL;
    return { x, y, z };
  }

  const occList = [...box.values()];                           // [x0, x1, y0, y1, z0, z1] boxes that hide what is behind them
  return {
    floorY, whites, greys, blackSpots, route, land, rayHit, hidden, samplesFor, occ: occList,
    stats: { points: points.length, voxels: occ.size, candidates: kept.length, fallback,
      types: kept.reduce((a, c) => (a[c.type] = (a[c.type] || 0) + 1, a), {}), walkCells: passCells.length },
  };
}

function thin(arr, n) { if (arr.length <= n) return arr.slice(); const out = []; for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * (arr.length - 1) / (n - 1))]); return out; }
function dedupe(p) { const out = []; for (const q of p) { const l = out[out.length - 1]; if (!l || Math.hypot(l.x - q.x, l.y - q.y, l.z - q.z) > 0.03) out.push(q); } return out; }
