// node tools/qr/render.cjs DIR  (repo served on :8130) -> DIR/qr_android.png, qr_windows.png, Xplore_Prokletije_QR_A4.pdf
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const dir = process.argv[2]; const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1000, height: 2720 }, deviceScaleFactor: 2 })).newPage();
  await p.goto(`http://localhost:8130/${dir}/cards.html`); await p.waitForTimeout(500);
  for (const k of ['android', 'windows']) await (await p.$('#' + k)).screenshot({ path: `${dir}/qr_${k}.png`, omitBackground: true });
  await p.goto(`http://localhost:8130/${dir}/print.html`); await p.waitForTimeout(500);
  await p.pdf({ path: `${dir}/Xplore_Prokletije_QR_A4.pdf`, format: 'A4', printBackground: true });
  await b.close(); console.log('rendered');
})();
