// End-to-end test of the trails AR in headless Chrome with a simulated phone: the camera plays the synthetic walk
// (tools/tests/staze_ar_synth.py path DIR) and matching motion-sensor events are sent, so the AR overlay can be compared
// with the true position of the printed map on screen. Serve the repo on port 8130 first.
// usage: node tools/tests/staze_ar_e2e.cjs SYNTH_DIR OUT [gyro|nogyro|free|room] [me|sq|en]
//   room: SYNTH_DIR from `staze_ar_synth.py room`; taps "No map" and walks round the desk, checking that the relief
//   stays on the same spot of the desk.
// Software WebGL here draws only ~2 frames per second, so the page runs in slow motion: its clock (performance.now and
// requestAnimationFrame) runs at TIME_K of real time, which gives the app ~12 frames per second of its own time.
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [dir, out, mode = 'gyro', lang = 'me'] = process.argv.slice(2);
const TIME_K = +(process.env.TIME_K || 0.15);
const cfg = JSON.parse(fs.readFileSync(path.join(dir, mode === 'room' ? 'room.json' : 'path.json')));
if (mode === 'room') for (const f of cfg.frames) f.t_ = f.t_ || f.t;
fs.mkdirSync(out, { recursive: true });

// runs in the page before its own scripts
function fakePhone({ cfg, mode, timeK }) {
  if (timeK && timeK !== 1) {
    const realNow = performance.now.bind(performance), base = realNow();
    performance.now = () => base + (realNow() - base) * timeK;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(() => cb(performance.now()));
  }
  const F = cfg.frames, n = F.length;
  const S = window.__synth = { t0: 0, idx: -1, started: false, mode };
  // three.js camera orientation (quaternion x,y,z,w) of frame i: camera->world of the OpenCV pose with y,z flipped
  const quat = R => {
    const m = [R[0], -R[3], -R[6], R[1], -R[4], -R[7], R[2], -R[5], -R[8]];     // (diag(1,-1,-1) R)^T, row-major
    const tr = m[0] + m[4] + m[8]; let x, y, z, w;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s; }
    else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
    else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s; }
    else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s; }
    return [x, y, z, w];
  };
  const Q = F.map(f => quat(f.R));
  const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const slerp = (a, b, u) => {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; let bb = b;
    if (d < 0) { d = -d; bb = b.map(v => -v); }
    if (d > 0.9995) { const r = a.map((v, i) => v + (bb[i] - v) * u); const l = Math.hypot(...r); return r.map(v => v / l); }
    const th = Math.acos(d), s = Math.sin(th);
    return a.map((v, i) => (Math.sin((1 - u) * th) * v + Math.sin(u * th) * bb[i]) / s);
  };
  const yaw = (q, deg) => mul([0, Math.sin(deg * Math.PI / 360), 0, Math.cos(deg * Math.PI / 360)], q);
  S.qAt = t => {                 // camera orientation at walk time t (s)
    const x = Math.max(0, Math.min(mode === 'free' ? 30 : n - 1.001, t * cfg.fps)), i = Math.floor(x);
    let q = slerp(Q[i], Q[i + 1], x - i);
    if (mode === 'free') q = yaw(q, 50 * Math.sin(Math.max(0, t - 4) * 0.55));      // free test: turn left and right
    return q;
  };
  const QX = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];          // inverse of the -90° about X in the orientation formula
  const YAW0 = 37;                                        // the phone's own heading reference is arbitrary
  S.orientation = q => {           // q (camera in world) -> deviceorientation alpha/beta/gamma (portrait)
    const e = mul(q, QX);
    const [x, y, z, w] = e;
    const m13 = 2 * (x * z + y * w), m23 = 2 * (y * z - x * w), m33 = 1 - 2 * (x * x + y * y), m21 = 2 * (x * y + z * w), m22 = 1 - 2 * (x * x + z * z);
    const ex = Math.asin(-Math.max(-1, Math.min(1, m23))), ey = Math.atan2(m13, m33), ez = Math.atan2(m21, m22);
    return { alpha: ((ey * 180 / Math.PI + YAW0) % 360 + 360) % 360, beta: ex * 180 / Math.PI, gamma: -ez * 180 / Math.PI };
  };
  const imgs = new Array(n);
  const PRE = mode === 'room' ? 'r' : 'p';
  const load = i => { if (!imgs[i]) { imgs[i] = new Image(); imgs[i].src = '/__synth/' + PRE + String(i).padStart(4, '0') + '.jpg'; } return imgs[i]; };
  S.walkT0 = mode === 'room' ? Infinity : 0;      // room test: the walk starts when "No map" is tapped
  for (let i = 0; i < Math.min(n, 40); i++) load(i);
  const md = navigator.mediaDevices || (navigator.mediaDevices = {});
  md.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'synth', label: 'Synthetic back camera', groupId: 'g' }];
  md.getUserMedia = async () => {
    const c = document.createElement('canvas'); c.width = cfg.w || 960; c.height = cfg.h || 1280;
    const g = c.getContext('2d');
    g.fillStyle = '#777'; g.fillRect(0, 0, c.width, c.height);
    S.t0 = performance.now(); S.started = true;
    const frameIdx = t => mode === 'free' ? Math.min(Math.floor(t * cfg.fps), 30) : Math.max(0, Math.min(n - 1, Math.floor((t - Math.min(t, S.walkT0)) * cfg.fps)));
    setInterval(() => {
      const t = (performance.now() - S.t0) / 1000, i = frameIdx(t);
      for (let k = i; k < Math.min(n, i + 30); k++) load(k);
      const im = imgs[i];
      if (im && im.complete && im.naturalWidth && S.idx !== i) { g.drawImage(im, 0, 0); S.idx = i; S.drawnAt = performance.now(); }
    }, 1000 / cfg.fps / 3 * timeK);
    if (mode !== 'nogyro') setInterval(() => {
      let t = (performance.now() - S.t0) / 1000 + 0.05 - 0.5 / cfg.fps;      // the app expects the picture 50 ms behind the sensor
      if (mode === 'room') t = Math.max(0, t - Math.min(t, S.walkT0));
      const o = S.orientation(S.qAt(Math.max(0, t)));
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: o.alpha, beta: o.beta, gamma: o.gamma, absolute: false }));
    }, 16);
    return c.captureStream(Math.max(4, 30 * timeK));
  };
}

// room test helpers: the true camera of the frame on screen
function roomHelpers() {
  const cam = () => { const S = window.__synth, f = window.__cfg.frames[S.idx], e = window.__staze.S.ar.engine; return { f, K: window.__cfg.K, cov: e.cover }; };
  window.__deskPoint = ([x, y]) => {          // screen point -> point on the true desk (y = 0)
    const { f, K, cov } = cam();
    const u = (x + cov.offx) / cov.s, v = (y + cov.offy) / cov.s;
    const m = [(u - K[1]) / K[0], (v - K[2]) / K[0], 1], R = f.R;
    const d = [R[0] * m[0] + R[3] * m[1] + R[6], R[1] * m[0] + R[4] * m[1] + R[7], R[2] * m[0] + R[5] * m[1] + R[8]];
    const s = -f.C[1] / d[1];
    return [f.C[0] + s * d[0], 0, f.C[2] + s * d[2]];
  };
  window.__projectTrue = X => {
    const { f, K, cov } = cam(), R = f.R, a = X[0] - f.C[0], b = X[1] - f.C[1], c = X[2] - f.C[2];
    const x = R[0] * a + R[1] * b + R[2] * c, y = R[3] * a + R[4] * b + R[5] * c, z = R[6] * a + R[7] * b + R[8] * c;
    return z > 0 ? [(K[0] * x / z + K[1]) * cov.s - cov.offx, (K[0] * y / z + K[2]) * cov.s - cov.offy] : null;
  };
}

// AR overlay vs truth, in screen pixels
function sample() {
  const st = window.__staze, ar = st.S.ar, S = window.__synth;
  if (!ar || !S || S.idx < 0) return null;
  const e = ar.engine, cam = e.camera, cov = e.cover, cfg = window.__cfg;
  if (!cov) return null;
  const f = cfg.frames[S.idx], K = cfg.K;
  const W = 0.186, D = st.S.data.depth, exag = st.S.exag;
  const zk = st.S.data.places.find(p => p.id === 'zla-kolata').pos;
  const local = [[-0.5, 0, -D / 2], [0.5, 0, -D / 2], [0.5, 0, D / 2], [-0.5, 0, D / 2], [zk[0], zk[1] * exag, zk[2]]];
  const truth = local.map(([x, y, z]) => {
    const X = [x * W, y * W, z * W], R = f.R, t = f.t_;
    const cx = R[0] * X[0] + R[1] * X[1] + R[2] * X[2] + t[0], cy = R[3] * X[0] + R[4] * X[1] + R[5] * X[2] + t[1], cz = R[6] * X[0] + R[7] * X[1] + R[8] * X[2] + t[2];
    return [(K[0] * cx / cz + K[1]) * cov.s - cov.offx, (K[0] * cy / cz + K[2]) * cov.s - cov.offy, cz];
  });
  const H = st.holder; H.updateMatrixWorld(true);
  const V = H.position.constructor;
  const est = local.map(([x, y, z]) => {
    const v = new V(x, y * st.rise.scale.y, z).applyMatrix4(H.matrixWorld).project(cam);
    return [(v.x + 1) / 2 * ar.w, (1 - v.y) / 2 * ar.h, v.z];
  });
  const err = est.map((p, i) => Math.hypot(p[0] - truth[i][0], p[1] - truth[i][1]));
  const onScreen = truth.slice(0, 4).filter(p => p[0] > 0 && p[1] > 0 && p[0] < ar.w && p[1] < ar.h && p[2] > 0).length;
  const cw = new V().setFromMatrixPosition(H.matrixWorld).project(cam);
  const center = cw.z < 1 ? [Math.round((cw.x + 1) / 2 * ar.w), Math.round((1 - cw.y) / 2 * ar.h)] : 'behind';
  return { center, t: (performance.now() - S.t0) / 1000, idx: S.idx, note: f.note, hold: f.hold, mode: ar.mode, visible: H.visible, rise: st.rise.scale.y,
    n: e.stats.n, gyro: e.gyroOn, fov: e.fovLong, calibrated: e.calibrated, cornerErr: Math.max(...err.slice(0, 4)), peakErr: err[4], onScreen,
    est: est.map(p => p.slice(0, 2).map(v => Math.round(v))), truth: truth.map(p => p.slice(0, 2).map(v => Math.round(v))),
    arrow: !document.querySelector('#xrArrow').hidden, coach: !document.querySelector('#xrCoach').hidden, msg: document.querySelector('#xrMsg').textContent };
}

(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addInitScript(l => { localStorage.setItem('gkb.lang', JSON.stringify(l)); localStorage.removeItem('gkb.staze.ar.f'); localStorage.setItem('gkb.staze.exag', '1.5'); }, lang);
  await ctx.addInitScript(fakePhone, { cfg, mode, timeK: TIME_K });
  await ctx.addInitScript(c => { window.__cfg = c; }, cfg);
  await ctx.addInitScript(roomHelpers);
  if (mode === 'room') await ctx.addInitScript(() => { window.__roomLog = []; });
  await ctx.route('**/__synth/**', r => r.fulfill({ path: path.join(dir, path.basename(new URL(r.request().url()).pathname)), contentType: 'image/jpeg' }));
  const p = await ctx.newPage();
  const logs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => logs.push('ERR ' + e.message));
  await p.goto(`http://localhost:8130/staze.html?ar=1${mode === 'nogyro' ? '&nogyro' : ''}`);
  await p.waitForFunction(() => window.__staze && window.__staze.S.data && !document.querySelector('#loading'), null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/0_cta.png` });
  await p.tap('#ctaStart');
  const shots = new Set(), samples = [];
  const keys = cfg.keys;
  const total = mode === 'free' ? 16 : mode === 'room' ? cfg.frames.length / cfg.fps + 2.5 : keys[keys.length - 1].t2;
  let anchor = null;
  let tapped = false, freeClicked = false;
  for (;;) {
    const s = await p.evaluate(sample);
    if (s) {
      samples.push(s);
      if (mode === 'room') {
        if (!freeClicked && s.coach) {
          await p.screenshot({ path: `${out}/1_coach.png` }); await p.tap('#coachFree'); freeClicked = true;
          await p.evaluate(() => { window.__synth.walkT0 = (performance.now() - window.__synth.t0) / 1000 + 0.6; });
        }
        // the spot of the real desk under the relief's centre when the walk starts; afterwards the relief must stay on it
        const walk = await p.evaluate(() => (performance.now() - window.__synth.t0) / 1000 - window.__synth.walkT0);
        s.walk = walk;
        if (freeClicked && walk > -0.1 && !anchor && s.center !== 'behind') {
          anchor = await p.evaluate(c => window.__deskPoint(c), s.center);
          console.log('anchor on the desk', anchor.map(v => v.toFixed(3)).join(', '));
        }
        if (anchor && s.center !== 'behind') {
          const tr = await p.evaluate(a => window.__projectTrue(a), anchor);
          s.roomErr = tr ? Math.hypot(tr[0] - s.center[0], tr[1] - s.center[1]) : null;
        }
        s.room = await p.evaluate(() => { const e = window.__staze.S.ar.engine, r = e.room, c = e.camera; return { on: r.tracking, n: r.n, inl: r.inl, st: document.querySelector('#xrOverlay').dataset.room,
          pos: r.pos.toArray(), q: c.quaternion.toArray(), corr: e.corr.toArray(), idx: window.__synth.idx, planeY: r.planeY }; });
        for (const [at, name] of [[0.4, '2_room_start'], [4.5, '3_room_side'], [7.2, '4_room_close'], [12, '5_room_back'], [15.6, '6_room_end']]) if (walk > at && !shots.has(name)) { shots.add(name); await p.screenshot({ path: `${out}/${name}.png` }); }
      } else if (mode === 'free') {
        if (!freeClicked && s.coach) { await p.screenshot({ path: `${out}/1_coach.png` }); await p.tap('#coachFree'); freeClicked = true; }
        for (const [at, name] of [[3.5, '2_free'], [6.6, '3_free_turned'], [9.6, '4_free_back'], [12.5, '5_free_other_side']]) if (s.t > at && !shots.has(name)) { shots.add(name); await p.screenshot({ path: `${out}/${name}.png` }); }
      } else {
        keys.forEach((k, i) => {
          const name = `${i + 1}_${k.note.replace(/[^a-z]+/gi, '_').slice(0, 28)}`;
          if (s.t > k.t2 - 0.35 && s.t < k.t2 + 0.6 && !shots.has(name)) { shots.add(name); s.shot = name; }
        });
        if (s.shot) await p.screenshot({ path: `${out}/${s.shot}.png` });
        if (s.t > 1.2 && s.t < 2.8 && !shots.has('1b_coach')) { shots.add('1b_coach'); await p.screenshot({ path: `${out}/1b_coach.png` }); }
        // tap the Zla Kolata trail while looking from the east
        if (!tapped && s.note === 'from the east side' && s.hold && s.mode === 'map' && s.t > keys[3].t1 + 0.8) {
          const pt = await p.evaluate(() => {
            const st = window.__staze, ar = st.S.ar, tr = st.S.data.trails.find(x => x.id === 'zla-kolata'), sg = tr.segs[0], k = Math.floor(sg.length / 3 * 0.6) * 3;
            const v = new st.holder.position.constructor(sg[k], sg[k + 1] * st.S.exag, sg[k + 2]).applyMatrix4(st.holder.matrixWorld).project(ar.engine.camera);
            return [(v.x + 1) / 2 * ar.w, (1 - v.y) / 2 * ar.h];
          });
          await p.touchscreen.tap(pt[0], pt[1]); tapped = pt;
          await p.waitForTimeout(400);
          await p.screenshot({ path: `${out}/4b_tapped_trail.png` });
        }
      }
      if (s.t > total + 0.5) break;
    }
    await p.waitForTimeout(150);
  }
  const sel = await p.evaluate(() => window.__staze.S.sel);
  fs.writeFileSync(`${out}/samples.json`, JSON.stringify(samples));
  if (mode === 'room') fs.writeFileSync(`${out}/roomlog.json`, JSON.stringify(await p.evaluate(() => window.__roomLog)));
  // summary per stop of the walk
  const med = a => { const q = a.slice().sort((x, y) => x - y); return q.length ? q[q.length >> 1] : NaN; };
  const mx = a => a.length ? Math.max(...a) : NaN;
  console.log(`mode ${mode}; ${samples.length} samples; trail tapped at ${tapped ? tapped.map(Math.round) : '-'} -> selected ${sel}`);
  if (mode === 'room') {
    const g = samples.filter(s => s.walk > 0 && s.roomErr != null);
    const segs = [[0, 1.5], [1.5, 5.5], [5.5, 7.5], [7.5, 9], [9, 10.5], [10.5, 14.5], [14.5, 16.5]];
    for (const [a, b] of segs) {
      const q = g.filter(s => s.walk >= a && s.walk < b);
      if (q.length) console.log(`walk ${a}-${b} s: relief vs desk spot px med ${med(q.map(s => s.roomErr)).toFixed(1)} max ${mx(q.map(s => s.roomErr)).toFixed(1)}  tracking ${q.filter(s => s.room.on).length}/${q.length}  points ${med(q.map(s => s.room.n))}`);
    }
  } else if (mode !== 'free') for (const k of keys) {
    const g = samples.filter(s => s.t > k.t1 + 0.9 && s.t < k.t2 && s.visible);
    const all = samples.filter(s => s.t > k.t1 + 0.4 && s.t < k.t2);
    const modes = [...new Set(all.map(s => s.mode))].join('/');
    const map = g.filter(s => s.onScreen >= 2);
    console.log(`${k.note.padEnd(34)} modes ${modes.padEnd(14)} n ${med(all.map(s => s.n))}  corner err px med ${med(map.map(s => s.cornerErr)).toFixed(1)} max ${mx(map.map(s => s.cornerErr)).toFixed(1)}  peak med ${med(g.map(s => s.peakErr)).toFixed(1)}  arrow ${all.some(s => s.arrow)}  fov ${all.length ? all[all.length - 1].fov.toFixed(1) : '-'}`);
  } else {
    for (const s of samples.filter((_, i) => i % 6 === 0)) console.log(`t ${s.t.toFixed(1)} mode ${s.mode} visible ${s.visible} arrow ${s.arrow} model on screen at ${s.center}`);
  }
  console.log(logs.slice(0, 12).join('\n') || 'no console errors');
  await b.close();
})();
