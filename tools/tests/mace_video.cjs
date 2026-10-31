// Run "Gdje su mace?" through the real room-tracking engine on a fake camera: the test room filmed as a phone video.
// Serve the repo on port 8130 first.
// usage: node tools/tests/mace_video.cjs OUTDIR [--frames]   (--frames re-renders the video, otherwise OUTDIR/room.y4m is reused)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
(async () => {
  const out = process.argv[2];
  const y4m = path.join(out, 'room.y4m');
  if (process.argv.includes('--frames') || !fs.existsSync(y4m)) {
    const fdir = path.join(out, 'frames'); fs.mkdirSync(fdir, { recursive: true });
    const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
    const p = await (await b.newContext({ viewport: { width: 640, height: 480 } })).newPage();
    await p.goto('http://localhost:8130/tools/tests/mace_film.html');
    await p.waitForFunction(() => window.ready, null, { timeout: 60000 });
    const FPS = 15, N = 40 * FPS;
    for (let i = 0; i < N; i++) {
      const data = await p.evaluate(t => window.render(t), i / FPS);
      fs.writeFileSync(path.join(fdir, `f${String(i).padStart(4, '0')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
      if (i % 100 === 0) console.log('frame', i);
    }
    await b.close();
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(fdir, 'f%04d.jpg'), '-pix_fmt', 'yuv420p', y4m]);
    console.log('video written');
  }
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`, '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, permissions: ['camera'],
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  await ctx.addInitScript(() => localStorage.setItem('gkb.lang', '"me"'));
  // motion sensors for the fake phone, following the same camera path as the video (keep K in step with mace_film.html)
  await ctx.addInitScript(() => {
    const K = [
      [0, 0, 1.4, 1.0, 0, -0.95], [2.5, 0, 1.4, 1.0, 0, -0.95], [6, 0.35, 1.38, 0.95, 0.05, -0.85],
      [9, 0.3, 1.38, 0.8, 0.55, -0.55], [13, 0.1, 1.35, 0.7, 1.05, -0.45], [17, -0.15, 1.35, 0.6, 0.2, -0.35],
      [21, -0.3, 1.33, 0.6, -0.7, -0.45], [25, -0.35, 1.3, 0.75, -1.15, -0.4], [29, -0.1, 1.35, 0.85, -0.4, -0.6],
      [33, 0.15, 1.38, 0.9, 0.3, -0.5], [37, 0.0, 1.4, 1.0, 0, -0.75], [40, 0, 1.4, 1.0, 0, -0.95],
    ];
    const ease = x => x * x * (3 - 2 * x);
    const pose = t => {
      t = t % 40;
      let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
      const a = K[i], b = K[i + 1], f = ease(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))));
      return { yaw: a[4] + (b[4] - a[4]) * f, pitch: a[5] + (b[5] - a[5]) * f };
    };
    for (const E of [window.DeviceOrientationEvent, window.DeviceMotionEvent]) if (E) E.requestPermission = async () => 'granted';
    let t0 = null;
    const gum = navigator.mediaDevices && navigator.mediaDevices.getUserMedia && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    if (gum) navigator.mediaDevices.getUserMedia = c => gum(c).then(s => { if (c && c.video && t0 == null) t0 = performance.now(); return s; });
    let prev = null;
    setInterval(() => {
      const t = t0 == null ? 0 : (performance.now() - t0) / 1000, q = pose(t), d = 180 / Math.PI;
      const alpha = ((q.yaw * d) % 360 + 360) % 360, beta = 90 + q.pitch * d, gamma = 0;
      const rr = prev ? { alpha: (q.yaw - prev.yaw) * d / 0.016, beta: (q.pitch - prev.pitch) * d / 0.016, gamma: 0 } : { alpha: 0, beta: 0, gamma: 0 };
      prev = q;
      const g = 9.81, br = beta / d;
      try { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha, beta, gamma, absolute: false })); } catch (e) {}
      try {
        window.dispatchEvent(new DeviceMotionEvent('devicemotion', { acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: g * Math.sin(br), z: g * Math.cos(br) },
          rotationRate: { alpha: 0, beta: rr.beta, gamma: rr.alpha }, interval: 16 }));
      } catch (e) {}
    }, 16);
  });
  const p = await ctx.newPage();
  const logs = []; p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/performance warning|THREE.Clock/.test(m.text())) logs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => logs.push('ERR ' + e.message));
  await p.goto('http://localhost:8130/mace.html?debug'); await p.waitForTimeout(1500);
  await p.click('#btnAR');
  const t0 = Date.now();
  const st = () => p.evaluate(() => { const G = window.__mace.G; return { phase: G.phase, status: G.track.status, reason: G.track.reason, pts: G.points.size, sectors: G.sectors.size, cams: G.cams.length }; });
  let s;
  for (;;) {
    await p.waitForTimeout(2000);
    s = await st();
    console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(s));
    if (s.phase === 'scan' && !fs.existsSync(path.join(out, 'ar_1_scan.png'))) await p.screenshot({ path: path.join(out, 'ar_1_scan.png') });
    if (s.phase === 'play' || Date.now() - t0 > 150000) break;
    if (s.phase === 'scan' && Date.now() - t0 > 100000 && s.pts > 100) { await p.evaluate(() => window.__mace.finishScan()); }
  }
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => { const G = window.__mace.G, R = G.room; return R ? { floor: R.floorY, stats: R.stats, whites: R.whites.map(w => `${w.type}/${w.pose} ${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)}`) } : null; });
  console.log(JSON.stringify(info));
  for (let k = 0; k < 4; k++) { await p.screenshot({ path: path.join(out, `ar_2_play_${k}.png`) }); await p.waitForTimeout(4000); }
  console.log(logs.slice(0, 20).join('\n') || 'no console errors');
  await b.close();
})();
