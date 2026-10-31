// Gdje su mace? – sounds made in the browser (no audio files): meows from where the cat is, purring, a bell, a hiss.
export function makeSound() {
  let ctx = null, master = null, on = true, purrGain = null, noise = null;
  const S = {
    get on() { return on; },
    set on(v) { on = v; if (master) master.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.05); },
    init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = on ? 0.9 : 0; master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0); let b = 0;
      for (let i = 0; i < d.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; }   // brown-ish noise
      // purring: noise through a low filter, pulsed about 25 times a second; louder while a cat is being petted
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
      const am = ctx.createGain(); am.gain.value = 0.5;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 24; const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
      lfo.connect(lfoG); lfoG.connect(am.gain);
      purrGain = ctx.createGain(); purrGain.gain.value = 0;
      src.connect(lp); lp.connect(am); am.connect(purrGain); purrGain.connect(master);
      src.start(); lfo.start();
    },
    listener(pos, fwd, up) {
      if (!ctx) return;
      const L = ctx.listener, t = ctx.currentTime;
      if (L.positionX) {
        L.positionX.setTargetAtTime(pos.x, t, 0.03); L.positionY.setTargetAtTime(pos.y, t, 0.03); L.positionZ.setTargetAtTime(pos.z, t, 0.03);
        L.forwardX.setTargetAtTime(fwd.x, t, 0.03); L.forwardY.setTargetAtTime(fwd.y, t, 0.03); L.forwardZ.setTargetAtTime(fwd.z, t, 0.03);
        L.upX.setTargetAtTime(up.x, t, 0.03); L.upY.setTargetAtTime(up.y, t, 0.03); L.upZ.setTargetAtTime(up.z, t, 0.03);
      } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    },
    purr(level) { if (purrGain) purrGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.55, ctx.currentTime, 0.08); },
    meow(pos, pitch = 1) {
      if (!ctx) return;
      const t = ctx.currentTime, out = at(pos);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = o.frequency; f.setValueAtTime(480 * pitch, t); f.linearRampToValueAtTime(800 * pitch, t + 0.16); f.linearRampToValueAtTime(700 * pitch, t + 0.38); f.linearRampToValueAtTime(430 * pitch, t + 0.62);
      const vib = ctx.createOscillator(); vib.frequency.value = 6.5; const vg = ctx.createGain(); vg.gain.value = 12 * pitch; vib.connect(vg); vg.connect(f);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.05); g.gain.linearRampToValueAtTime(0.35, t + 0.42); g.gain.linearRampToValueAtTime(0, t + 0.66);
      // vowel-like filters: "mi-a-u"
      for (const [f0, f1, f2, q, gain] of [[700, 1150, 650, 7, 1], [2300, 1650, 1000, 9, 0.6]]) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
        bp.frequency.setValueAtTime(f0 * pitch, t); bp.frequency.linearRampToValueAtTime(f1 * pitch, t + 0.25); bp.frequency.linearRampToValueAtTime(f2 * pitch, t + 0.62);
        const bg = ctx.createGain(); bg.gain.value = gain * 2.2;
        o.connect(bp); bp.connect(bg); bg.connect(g);
      }
      g.connect(out);
      o.start(t); vib.start(t); o.stop(t + 0.7); vib.stop(t + 0.7);
    },
    bell(pos) {
      if (!ctx) return;
      const t = ctx.currentTime, out = at(pos, 0.5);
      for (const [fr, v] of [[2850, 0.12], [4230, 0.07], [6100, 0.04]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fr * (0.98 + Math.random() * 0.04);
        const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.28);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.3);
      }
    },
    hiss(pos) {
      if (!ctx) return;
      const t = ctx.currentTime, out = at(pos);
      const s = ctx.createBufferSource(); s.buffer = noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      s.connect(hp); hp.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + 0.5);
    },
    plop(pos) {
      if (!ctx) return;
      const t = ctx.currentTime, out = at(pos);
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.13);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.45, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
    },
    chime(n = 0) {                       // caught: two notes, climbing with every cat
      if (!ctx) return;
      const t = ctx.currentTime, base = 660 * Math.pow(2, (n % 9) / 12);
      [[base, 0], [base * 1.5, 0.11]].forEach(([fr, d]) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr;
        const g = ctx.createGain(); g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.25, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.6);
        o.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 0.65);
      });
    },
    fanfare() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1047, 784, 1047].forEach((fr, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr;
        const g = ctx.createGain(), d = i * 0.13 + (i > 3 ? 0.12 : 0);
        g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.22, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + d + (i === 5 ? 1.2 : 0.4));
        o.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 1.3);
      });
    },
    tick() {
      if (!ctx) return;
      const t = ctx.currentTime, o = ctx.createOscillator(); o.frequency.value = 1800;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.06);
    },
  };
  function at(pos, ref = 0.6) {          // a sound placed in the room; louder when you are near
    if (!pos) return master;
    const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(master);
    return p;
  }
  return S;
}
