// usage: node tools/video/render.cjs frames OUTDIR t1,t2,...   -> JPEG stills
//        node tools/video/render.cjs scene OUT.mp4 T0 T1       -> encoded scene (1080x1920, 30 fps)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('child_process'); const fs = require('fs');
(async () => {
  const [mode, out, a, b] = process.argv.slice(2);
  const br = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await br.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8130/tools/video/film.html');
  await p.waitForFunction(() => window.FILM_READY, null, { timeout: 180000 });
  await p.waitForTimeout(800);
  const shot = async t => { await p.evaluate(t => window.render(t), t); return p.screenshot({ type: 'jpeg', quality: 92 }); };
  if (mode === 'frames') {
    fs.mkdirSync(out, { recursive: true });
    for (const t of a.split(',').map(Number)) fs.writeFileSync(`${out}/f_${t.toFixed(2)}.jpg`, await shot(t));
  } else {
    const T0 = +a, T1 = +b, n = Math.round((T1 - T0) * 30), tmp = out.replace(/\.mp4$/, '.part.mp4');
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let i = 0; i < n; i++) { const buf = await shot(T0 + i / 30); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); }
    ff.stdin.end();
    const code = await new Promise(r => ff.on('close', r));
    if (code === 0) fs.renameSync(tmp, out); else { console.error('ffmpeg failed', code); process.exitCode = 1; }
    console.log(out, n, 'frames');
  }
  if (errs.length) console.log('page errors:', errs.slice(0, 5).join(' | '));
  await br.close();
})();
