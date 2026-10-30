// usage: node tools/skyline/bake.cjs "<query>" OUT.json   (repo served on :8130)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [qs = '', out] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('http://localhost:8130/tools/skyline/skyline.html?' + qs);
  await p.waitForFunction(() => document.title === 'done', null, { timeout: 120000 });
  const r = await p.evaluate(() => window.result);
  require('fs').writeFileSync(out, JSON.stringify(r));
  console.log('eye', r.eyeM, 'm; peaks', r.peaks.map(k => `${k.name.me} az${k.az.toFixed(0)} el${k.el.toFixed(1)} ${k.km.toFixed(1)}km`).join(' | '));
  await b.close();
})();
