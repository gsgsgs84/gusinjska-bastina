// Print pages of the AR trail map -> PDF (A4, A3), the page thumbnail and a preview PNG (build/). Run tools/trails/ar_map.py first.
// usage: node tools/trails/ar_map_pdf.cjs
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(__dirname, '..', '..');
(async () => {
  const b = await chromium.launch();
  for (const page of ['A4', 'A3']) {
    const p = await b.newPage();
    await p.goto('file://' + path.join(ROOT, 'print/staze/build', `ar_mapa_${page}.html`));
    await p.evaluate(() => document.fonts.ready);
    await p.pdf({ path: path.join(ROOT, 'print/staze', `AR_mapa_staze_${page}.pdf`), format: page, printBackground: true, preferCSSPageSize: true });
    await p.close();
    if (page === 'A4') {     // preview for checking, and the small picture on the trails page
      for (const [file, scale, type] of [['build/AR_mapa_staze_preview.png', 1, 'png'], ['AR_mapa_staze_thumb.jpg', 208 / 794, 'jpeg']]) {
        const q = await b.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: scale });
        await q.goto('file://' + path.join(ROOT, 'print/staze/build', 'ar_mapa_A4.html'));
        await q.evaluate(() => document.fonts.ready);
        await q.screenshot({ path: path.join(ROOT, 'print/staze', file), type, ...(type === 'jpeg' ? { quality: 84 } : {}) });
        await q.close();
      }
    }
    console.log('wrote', page);
  }
  await b.close();
})();
