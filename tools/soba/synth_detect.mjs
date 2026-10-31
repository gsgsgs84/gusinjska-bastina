// Runs the app's marker detector (js/cv/detector.js) over the synthetic frames made by synth.py.
// usage: node tools/soba/synth_detect.mjs SYN_DIR  -> SYN_DIR/detections.json
import fs from 'node:fs';
import path from 'node:path';
import { MarkerDetector } from '../../js/cv/detector.js';

const dir = process.argv[2];
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const soba = JSON.parse(fs.readFileSync(new URL('../../data/soba.json', import.meta.url), 'utf8'));
const det = new MarkerDetector(soba.markers.map(m => ({ id: m.id, cells: m.cells })));
const modes = (process.env.MODES || 'full:2,3,5;centre:2,3').split(';').map(s => { const [m, r] = s.split(':'); return [m, r.split(',').map(Number)]; });
const out = [];
let ms = 0, runs = 0;
for (const f of man.frames) {
  const r = { name: f.name };
  for (const [mode, radii] of modes) {
    const buf = fs.readFileSync(path.join(dir, 'frames', `${f.name}_${mode}.gray`));
    const g = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    const w = man[`w_${mode}`], h = man[`h_${mode}`];
    for (const rad of radii) {
      const t0 = performance.now();
      const found = det.detectGray(g, w, h, { radius: rad });
      ms += performance.now() - t0; runs++;
      r[`${mode}_${rad}`] = found.map(m => m.id);
    }
  }
  out.push(r);
}
fs.writeFileSync(path.join(dir, 'detections.json'), JSON.stringify(out));
console.log(`frames ${out.length}, mean detect time ${(ms / runs).toFixed(1)} ms per 720x540 picture`);
