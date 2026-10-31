// Play "Gdje su mace?" in the test room and screenshot each stage. Serve the repo on port 8130 first.
// usage: node tools/tests/mace.cjs OUTDIR [lang] [--mobile]
// Software WebGL is slow (a few frames per second), hence the generous waits.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const [out, lang = 'me'] = args;
  const mobile = process.argv.includes('--mobile');
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: mobile,
    userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' : undefined });
  await ctx.addInitScript(l => { localStorage.setItem('gkb.lang', JSON.stringify(l)); localStorage.removeItem('gkb.mace.best'); }, lang);
  const p = await ctx.newPage();
  const logs = []; p.on('console', m => { if (m.type() !== 'log') logs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', e => logs.push('ERR ' + e.message));
  const shot = name => p.screenshot({ timeout: 120000, path: `${out}/${name}.png` });
  await p.goto('http://localhost:8130/mace.html'); await p.waitForTimeout(2500);
  await shot('01_start');
  await p.evaluate(() => window.__mace.startDemo());
  await p.waitForFunction(() => window.__mace.G.phase === 'play', null, { timeout: 120000 });
  await p.waitForTimeout(2500);
  const info = await p.evaluate(() => { const { G } = window.__mace; return { stats: G.room.stats, floor: G.room.floorY, whites: G.room.whites.map(w => `${w.type}/${w.pose} @${w.x.toFixed(2)},${w.y.toFixed(2)},${w.z.toFixed(2)} best=${w.best?.toFixed(2)}`), greys: G.room.greys.map(g => g.path.length), black: G.room.blackSpots.map(s => s.type) }; });
  console.log(JSON.stringify(info, null, 1));
  await shot('02_room');
  // look at each white cat and hold still until it is caught
  const catchCat = async (i, maxMs = 25000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const st = await p.evaluate(i => { const m = window.__mace; m.aimAt(i); return m.G.cats[i].state; }, i);
      if (st === 'caught') return true;
      await p.waitForTimeout(150);
    }
    return false;
  };
  for (let i = 0; i < 5; i++) {
    // stand where the cat can be seen: a little back from it, at its side facing the scan point
    const seen = await p.evaluate(i => window.__mace.vantage(i), i);
    if (!seen) console.log('white', i, 'no clear view found');
    await p.waitForTimeout(400); await shot(`w_${i}`);
    if (i === 0) {
      await p.evaluate(() => window.__mace.aimAt(0)); await p.waitForTimeout(1800);
      await shot('03_aiming');
    }
    const ok = await catchCat(i);
    console.log('white', i, ok ? 'caught' : 'NOT caught', await p.evaluate(i => window.__mace.G.room.whites[i].type, i));
    if (!ok) { await shot(`fail_white_${i}`); await p.evaluate(i => window.__mace.catchCat(window.__mace.G.cats[i]), i); }
    if (i === 0) { await p.waitForTimeout(600); await shot('04_caught'); }
  }
  for (let i = 5; i < 8; i++) {
    await p.evaluate(i => { const { G, demoCam } = window.__mace, c = G.cats[i].cat.root.position; demoCam.position.set(0, 1.5, 1.0); }, i);
    const ok = await catchCat(i, 30000);
    console.log('grey', i, ok ? 'caught' : 'NOT caught');
    if (!ok) { await shot(`fail_grey_${i}`); await p.evaluate(i => window.__mace.catchCat(window.__mace.G.cats[i]), i); }
    if (i === 5) await shot('05_grey');
  }
  await p.waitForFunction(() => window.__mace.G.cats[8].state === 'active', null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  await shot('06_black');
  // go near her while she rests (a teleport, so speed measuring restarts), then swing the phone fast: she runs
  const goNear = () => p.evaluate(() => window.__mace.vantage(8, 1.1));
  const waitRest = () => p.waitForFunction(() => ['rest', 'eat'].includes(window.__mace.G.cats[8].mode), null, { timeout: 40000 });
  await waitRest();
  console.log('black resting at', JSON.stringify(await p.evaluate(() => { const c = window.__mace.G.cats[8]; const q = c.cat.root.position; return { spot: c.spot, type: c.dest ? c.dest.type : window.__mace.G.room.blackSpots[c.spot].type, x: +q.x.toFixed(2), y: +q.y.toFixed(2), z: +q.z.toFixed(2) }; })), 'view:', await goNear());
  await p.waitForTimeout(700);
  const boltTest = await p.evaluate(async () => {
    const m = window.__mace, before = m.G.bolts, fill = m.G.cats[8].fill;
    for (let k = 0; k < 14; k++) { m.ctl.yaw += 0.3 * (k % 2 ? -1 : 1); await new Promise(r => setTimeout(r, 50)); }
    await new Promise(r => setTimeout(r, 600));
    return { fillBefore: +fill.toFixed(2), boltsBefore: before, boltsAfter: m.G.bolts, mode: m.G.cats[8].mode };
  });
  console.log('bolt test', JSON.stringify(boltTest));
  await p.waitForTimeout(300); await shot('06b_bolt');
  // fish: aim at the floor in front and toss; she comes to eat
  await p.evaluate(() => { const m = window.__mace; m.demoCam.position.set(0, 1.4, 0.8); m.ctl.yaw = 0; m.ctl.pitch = -0.75; m.G.fishCool = 0; });
  await p.waitForTimeout(800);
  await p.evaluate(() => window.__mace.tossFish());
  await p.waitForTimeout(400);
  console.log('fish', JSON.stringify(await p.evaluate(() => ({ fish: !!window.__mace.G.fish, mode: window.__mace.G.cats[8].mode }))));
  await p.waitForFunction(() => window.__mace.G.cats[8].mode === 'eat', null, { timeout: 30000 }).then(() => console.log('she is eating the fish')).catch(() => console.log('she did NOT come to the fish'));
  await p.waitForTimeout(500);
  await shot('07_fish');
  // stand still near her: she lets you pet her
  await waitRest(); await goNear();
  const okB = await p.waitForFunction(() => window.__mace.G.cats[8].state === 'caught', null, { timeout: 15000 }).then(() => true).catch(() => false);
  console.log('black', okB ? 'caught by holding still' : 'NOT caught', JSON.stringify(await p.evaluate(() => { const m = window.__mace; return { mode: m.G.cats[8].mode, fill: m.G.cats[8].fill, speed: m.G.speed, ang: m.G.ang, target: m.G.target && m.G.target.name }; })));
  if (!okB) { await shot('fail_black'); await p.evaluate(() => window.__mace.catchCat(window.__mace.G.cats[8])); }
  await p.waitForFunction(() => window.__mace.G.phase === 'win', null, { timeout: 20000 });
  await p.waitForTimeout(1200);
  await shot('08_win');
  console.log(logs.join('\n') || 'no console errors');
  await b.close();
})();
