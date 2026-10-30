// Screenshot the museum pages on a phone-sized viewport. usage: node tools/tests/ui.cjs OUTDIR [lang] [scheme]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [out, lang = 'me', scheme = 'light'] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, locale: lang === 'en' ? 'en-GB' : lang === 'sq' ? 'sq-AL' : 'sr-Latn-ME' });
  const p = await ctx.newPage();
  const logs = []; p.on('console', m => { if (m.type() !== 'log') logs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => logs.push('ERR ' + e.message));
  const shot = async (hash, name, wait = 900) => { await p.goto('http://localhost:8130/' + hash); await p.waitForTimeout(wait); await p.screenshot({ path: `${out}/${name}.png` }); };
  await shot('', 'home');
  await shot('#/g/vuna', 'gallery');
  await shot('#/e/ibrik', 'exhibit', 5000);
  await p.click('#btnShow'); await p.waitForTimeout(300);
  await p.goto('http://localhost:8130/#/e/razboj'); await p.waitForTimeout(4000); await p.click('#btnShow');
  await p.click('#btnRoom'); await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/exhibit_kula.png` });
  await p.evaluate(() => window.scrollTo(0, 600)); await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/exhibit_kula_scrolled.png` });
  await shot('#/vitrina', 'showcase');
  await shot('#/kocka', 'cubeinfo');
  await shot('kocka.html?ids=ibrik,kula-rasica', 'cube_start');
  console.log(logs.join('\n') || 'no console errors');
  await b.close();
})();
