// Capture app screens for the showcase video (repo served on :8130)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const p = await ctx.newPage();
  await p.addInitScript(() => { localStorage.setItem('gkb.lang', '"me"'); localStorage.setItem('gkb.installSeen', 'true'); });
  await p.goto('http://localhost:8130/'); await p.waitForTimeout(3500);
  await p.evaluate(() => document.querySelector('#dstage').scrollIntoView({ block: 'center' })); await p.waitForTimeout(9000);
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(600);
  await p.screenshot({ path: 'tools/video/assets/home_full.jpg', fullPage: true, type: 'jpeg', quality: 92 });
  console.log(await p.evaluate(() => document.documentElement.scrollHeight));
  await b.close();
})();
