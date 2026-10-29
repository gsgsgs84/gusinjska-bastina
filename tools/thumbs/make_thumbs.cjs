// usage (with the repo served on :8130): node tools/thumbs/make_thumbs.cjs   -> thumbs/<id>.png for every exhibit
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/exhibits.json')));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  for (const e of data.exhibits) {
    const p = await b.newPage({ viewport: { width: 512, height: 512 } });
    await p.goto(`http://localhost:8130/tools/thumbs/thumb.html?m=${encodeURIComponent(e.model)}`);
    await p.waitForFunction(() => document.title === 'done', null, { timeout: 120000 });
    await p.locator('canvas').screenshot({ path: path.join(root, e.thumb), omitBackground: true });
    console.log('thumb', e.thumb); await p.close();
  }
  await b.close();
})();
