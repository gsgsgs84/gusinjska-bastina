// node tools/models/preview.cjs OUTDIR model1.glb model2.glb ...   (repo served on :8130; paths relative to the repo)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [out, ...files] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 1200, height: 600 } })).newPage();
  for (const f of files) {
    await p.goto(`http://localhost:8130/tools/models/preview.html?src=../../${f}`);
    await p.waitForFunction(() => document.title.startsWith('done'), null, { timeout: 120000 });
    const name = f.split('/').pop().replace('.glb', '');
    await p.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 85 });
    console.log(name, (await p.title()).slice(5));
  }
  await b.close();
})();
