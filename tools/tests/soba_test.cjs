// End-to-end: the room-test page (soba-test.html) in Chromium with a fake camera fed from an MJPEG file
// made by tools/soba/synth.py. Serve the repo on port 8130 first (python3 -m http.server 8130).
// usage: node tools/tests/soba_test.cjs VIDEO.mjpeg OUTPREFIX spot|range [VPxVP] [lang]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [video, out, action = 'spot', vpS = '390x844', lang = 'me'] = process.argv.slice(2);
  const vp = vpS.split('x').map(Number);
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  });
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 2, permissions: ['camera', 'clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(l => { try { localStorage.setItem('soba.lang', JSON.stringify(l)); localStorage.setItem('soba.device', JSON.stringify('test')); } catch {} }, lang);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto('http://localhost:8130/soba-test.html');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}_start.png` });
  await page.click('#go');
  // wait until the card has been seen (or give up)
  let seen = false;
  for (let i = 0; i < 40 && !seen; i++) {
    await page.waitForTimeout(250);
    seen = await page.evaluate(() => [...window.__soba.S.seen.values()].some(v => performance.now() / 1000 - v.t < 0.5));
  }
  await page.screenshot({ path: `${out}_live.png` });
  const t0 = Date.now();
  await page.click(action === 'range' ? '#rangeBtn' : '#spotBtn');
  await page.waitForTimeout(1500);
  if (!process.env.NOSHOT) await page.screenshot({ path: `${out}_run.png` });
  await page.waitForSelector('#verdict:not([hidden])', { timeout: 120000 });
  const secs = (Date.now() - t0) / 1000;
  await page.screenshot({ path: `${out}_verdict.png` });
  const res = await page.evaluate(() => window.__soba.results.slice(-1)[0]);
  const perf = await page.evaluate(() => ({ fps: +window.__soba.S.fps.toFixed(1), procMs: +window.__soba.S.procMs.toFixed(1), PROC: window.__soba.S.PROC, video: [document.querySelector('#cam').videoWidth, document.querySelector('#cam').videoHeight] }));
  await page.click('#vOk');
  await page.click('#resBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}_results.png` });
  const copy = await page.evaluate(() => window.__soba.copyText());
  console.log(JSON.stringify({ seenBeforeTest: seen, testSeconds: +secs.toFixed(1), result: res, perf }));
  console.log('--- copy text ---\n' + copy);
  console.log('--- console ---\n' + (logs.slice(0, 20).join('\n') || '(none)'));
  await browser.close();
})();
