// End-to-end test of the museum cube (kocka.html) in Chromium with a fake camera.
// usage: node tools/tests/kocka2.cjs OUTDIR [VIDEO.y4m] [query] [seconds] [page]
//   no VIDEO: screenshots of the start screen only (portrait and landscape)
//   with VIDEO (from tools/tests/cube_video.py): starts the camera, logs every tracked frame (frame number + pose)
//   to OUTDIR/log.json and takes screenshots of the camera view and the sheets.
// Needs the repo served on http://localhost:8130.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const [out, video, query = '', secs = '10', pageName = 'kocka.html'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const args = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
  if (video) args.push('--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`);
  const browser = await chromium.launch({ args });
  const vp = (process.env.VP || '390x844').split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: +(process.env.DPR || 2), permissions: ['camera'], hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  if (process.env.BLOCK_OPENCV) await page.route('**/opencv.js', r => r.abort());
  await page.goto(`http://localhost:8130/${pageName}${query}`);
  await page.waitForTimeout(+(process.env.WAIT || 3500));
  if (process.env.NOBLUR) await page.addStyleTag({ content: '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' });
  await page.screenshot({ path: `${out}/start.png` });
  if (!video) {
    console.log(logs.join('\n'));
    if (!process.env.NOLAND) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/start_wide.png` });
    }
    await browser.close(); return;
  }
  if (pageName === 'kocka.html') await page.evaluate(() => { window.__cubeLog = []; });
  await page.click('#go');
  const t0 = Date.now(), samples = [];
  const total = +secs * 1000;
  let shot = 0;
  while (Date.now() - t0 < total) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => {
      const a = window.__cube;
      if (a) { const tr = a.tracking; return tr ? { det: tr.detector, ws: tr.workerState, fps: +tr.fps.toFixed(1), lat: +tr.stats.latency.toFixed(1), detMs: +tr.stats.det.toFixed(1), active: tr.active, fov: +a.camera.fov.value.toFixed(1), src: a.camera.fov.source, draw: +a.ui.renderMs.toFixed(1), grab: +(a.ui.grabMs || 0).toFixed(1), read: +tr.stats.read.toFixed(1), solve: +tr.stats.solve.toFixed(1), err: tr.stats.error } : null; }
      const b = window.__arcube; if (!b) return null;
      return { active: b.active, fps: +b.fps.toFixed(1), procMs: +b.procMs.toFixed(1) };
    });
    samples.push({ t: ((Date.now() - t0) / 1000).toFixed(1), ...s });
    if (process.env.SHOTS && shot < 12) await page.screenshot({ path: `${out}/ar_${String(++shot).padStart(2, '0')}.png` });
  }
  await page.screenshot({ path: `${out}/ar_end.png` });
  if (pageName === 'kocka.html') {
    const log = await page.evaluate(() => window.__cubeLog);
    fs.writeFileSync(`${out}/log.json`, JSON.stringify(log));
    if (process.env.TOUR) {
      const steps = [['default', () => {}], ['vitrine', () => document.getElementById('btnVitrine').click()],
        ['marble', () => { document.getElementById('btnVitrine').click(); document.querySelector('#segPlinth [data-v=marble]').click(); }],
        ['wood', () => document.querySelector('#segPlinth [data-v=wood]').click()],
        ['hand', () => { document.querySelector('#segPlinth [data-v=stone]').click(); document.getElementById('btnPlace').click(); }],
        ['mini', () => { document.getElementById('btnPlace').click(); document.getElementById('btnStrip').click(); }],
        ['kolijevka', () => { document.getElementById('btnStrip').click(); window.__cube.select('kolijevka'); }]];
      for (const [name, fn] of steps) {
        await page.evaluate(fn); await page.waitForTimeout(name === 'kolijevka' ? 9000 : 2500);
        await page.screenshot({ path: `${out}/tour_${name}.png` });
      }
    }
    if (process.env.SHEETS) {
      for (const id of ['sheetInfo', 'sheetSettings', 'sheetHelp']) {
        await page.evaluate(i => window.__cube.openSheet(i), id); await page.waitForTimeout(600);
        await page.screenshot({ path: `${out}/${id}.png` });
      }
      await page.evaluate(() => window.__cube.openSheet(null));
      await page.evaluate(() => window.__cube.takePhoto()); await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/sheetPhoto.png` });
    }
  }
  console.log(samples.map(s => JSON.stringify(s)).join('\n'));
  console.log('--- console ---\n' + logs.slice(0, 40).join('\n'));
  await browser.close();
})();
