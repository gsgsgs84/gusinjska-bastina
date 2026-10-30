// Screenshot the trails page (and make its home-page thumbnail). Serve the repo on port 8130 first.
// usage: node tools/tests/staze.cjs OUTDIR [lang] [scheme] [--thumb]
// Software WebGL is slow (a few frames per second), hence the long waits.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const [out, lang = 'me', scheme = 'light'] = args;
  const thumb = process.argv.includes('--thumb');
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme });
  await ctx.addInitScript(l => { localStorage.setItem('gkb.lang', JSON.stringify(l)); localStorage.removeItem('gkb.staze.labels'); }, lang);
  const p = await ctx.newPage();
  const logs = []; p.on('console', m => { if (m.type() !== 'log') logs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => logs.push('ERR ' + e.message));
  const shot = async (name, opt = {}) => p.screenshot({ timeout: 120000, path: `${out}/${name}.png`, ...opt });
  await p.goto('http://localhost:8130/staze.html'); await p.waitForTimeout(9000);
  if (thumb) {
    await p.evaluate(() => {
      const { S, camera, controls } = window.__staze;
      S.labels = false; document.querySelector('#btnLabels').click(); document.querySelector('#btnLabels').click();
      controls.target.set(0, 0.0, 0.0); camera.position.set(0.42, 1.02, 0.95); controls.update();
      document.querySelector('#hint').style.display = 'none'; document.querySelector('#north').style.display = 'none';
    });
    await p.waitForTimeout(4000);
    await (await p.$('#stage')).screenshot({ timeout: 120000, path: `${out}/thumb_raw.png` });
    await b.close(); return;
  }
  await shot('staze_home');
  await p.evaluate(() => window.__staze.select('zla-kolata')); await p.waitForTimeout(4000);
  await shot('staze_sel');
  await p.evaluate(() => document.querySelector('#card').scrollIntoView()); await p.waitForTimeout(800);
  await shot('staze_card');
  await p.evaluate(() => window.__staze.renderer.setAnimationLoop(null)); await p.waitForTimeout(500);
  await p.evaluate(() => { const o = document.querySelector('#xrOverlay'); o.hidden = false; document.querySelector('#xrMsg').textContent = 'Dodirnite ekran da postavite teren'; document.querySelector('#xrSize').textContent = '60 cm · 1:28 800'; });
  await shot('staze_xr_overlay');
  await p.goto('http://localhost:8130/index.html'); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('.trailbox')?.scrollIntoView({ block: 'center' })); await p.waitForTimeout(500);
  await shot('museum_home_trailbox');
  console.log(logs.join('\n') || 'no console errors');
  await b.close();
})();
