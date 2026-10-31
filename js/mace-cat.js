// Gdje su mace? – the kittens: a small cartoon cat built from simple shapes, with poses and a walk/run cycle.
// About kitten size: 0.27 m to the ear tips when standing, 0.33 m long with the tail. Faces +z; the root is on the ground.
import * as THREE from 'three';

export const KINDS = {
  white: { fur: 0xf3efe7, belly: 0xffffff, ear: 0xf0b2ae, nose: 0xe8949a, eyes: [0x58a8e8, 0xe2a838], label: '#f4f1ea' },
  grey: { fur: 0xa3a7ae, stripe: '#5b5f67', belly: 0xdcdde0, ear: 0xd79c9e, nose: 0xc4787f, eyes: [0x9ccc58, 0x9ccc58], label: '#8f949c' },
  black: { fur: 0x1d1c21, belly: 0x2b2a30, ear: 0x4b3b42, nose: 0x3d2c33, eyes: [0xe0cf3a, 0xe0cf3a], glow: true, label: '#1d1c20' },
};

const SPH = new THREE.SphereGeometry(1, 20, 14);
const SPH_LO = new THREE.SphereGeometry(1, 12, 8);
const EAR = new THREE.ConeGeometry(1, 1, 4, 1); EAR.rotateY(Math.PI / 4);
const LEG = new THREE.CapsuleGeometry(0.017, 0.055, 4, 10);
const TAILSEG = new THREE.CapsuleGeometry(0.0145, 0.03, 4, 8); TAILSEG.rotateX(Math.PI / 2);

let stripeTex = null;
function stripes(base, line) {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = line; g.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const x0 = i * 256 / 14 + 4; g.lineWidth = 5 + (i % 3) * 2; g.beginPath(); g.moveTo(x0, 8);
    for (let y = 8; y <= 120; y += 8) g.lineTo(x0 + Math.sin(y / 14 + i) * 4, y);
    g.stroke();
  }
  stripeTex = new THREE.CanvasTexture(c); stripeTex.colorSpace = THREE.SRGBColorSpace; stripeTex.wrapS = THREE.RepeatWrapping;
  return stripeTex;
}
let shadowTex = null;
function blobShadow() {
  if (!shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 2;
  return m;
}

// pose targets; walking/running adds a leg cycle on top
const POSES = {
  stand: { bodyY: 0.1, pitch: 0, head: 0, headY: 0, legF: 1, legB: 1, legFr: 0, legBr: 0, tailLift: 0.55, tailBend: -0.12, tailCurl: 0, eye: 1, stretch: 1, ears: 0 },
  sit: { bodyY: 0.097, pitch: -0.62, head: 0.5, headY: 0.004, legF: 1.32, legB: 0.7, legFr: 0.62, legBr: -1.25, tailLift: -0.35, tailBend: 0.05, tailCurl: 0.42, eye: 1, stretch: 1, ears: 0 },
  loaf: { bodyY: 0.066, pitch: 0.02, head: 0.06, headY: 0, legF: 0.3, legB: 0.3, legFr: -1.4, legBr: 1.4, tailLift: -0.1, tailBend: 0.02, tailCurl: 0.5, eye: 1, stretch: 1, ears: 0 },
  sleep: { bodyY: 0.06, pitch: 0.05, head: 0.42, headY: -0.018, legF: 0.3, legB: 0.3, legFr: -1.4, legBr: 1.4, tailLift: -0.08, tailBend: 0.02, tailCurl: 0.62, eye: 0.08, stretch: 1, ears: -0.2 },
  peek: { bodyY: 0.072, pitch: 0.12, head: -0.28, headY: 0.01, legF: 0.55, legB: 0.45, legFr: -0.6, legBr: 0.9, tailLift: -0.05, tailBend: 0.04, tailCurl: 0.1, eye: 1.1, stretch: 1.05, ears: 0.25 },
  walk: { bodyY: 0.1, pitch: 0, head: 0.1, headY: 0, legF: 1, legB: 1, legFr: 0, legBr: 0, tailLift: 0.7, tailBend: -0.18, tailCurl: 0, eye: 1, stretch: 1, ears: 0.1 },
  run: { bodyY: 0.095, pitch: 0.05, head: 0.18, headY: 0, legF: 1, legB: 1, legFr: 0, legBr: 0, tailLift: 0.12, tailBend: 0.02, tailCurl: 0, eye: 1, stretch: 1.12, ears: -0.35 },
  happy: { bodyY: 0.1, pitch: -0.15, head: -0.15, headY: 0.005, legF: 1, legB: 1, legFr: 0.1, legBr: 0, tailLift: 1.1, tailBend: -0.05, tailCurl: 0, eye: 0.3, stretch: 1, ears: 0.15 },
};
const KEYS = Object.keys(POSES.stand);

export function makeCat(kind, seed = 1) {
  const k = KINDS[kind];
  const fur = new THREE.MeshStandardMaterial({ color: kind === 'grey' ? 0xffffff : k.fur, roughness: kind === 'black' ? 0.62 : 0.9, map: kind === 'grey' ? stripes('#' + k.fur.toString(16), k.stripe) : null });
  const belly = new THREE.MeshStandardMaterial({ color: k.belly, roughness: 0.92 });
  const earIn = new THREE.MeshStandardMaterial({ color: k.ear, roughness: 0.9 });
  const noseM = new THREE.MeshStandardMaterial({ color: k.nose, roughness: 0.6 });
  const pupilM = new THREE.MeshBasicMaterial({ color: 0x111014 });
  const hiM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mk = (geo, mat, sx, sy, sz, x = 0, y = 0, z = 0, parent) => {
    const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };
  const root = new THREE.Group(); root.name = 'cat-' + kind;
  const lift = new THREE.Group(); root.add(lift);
  const body = new THREE.Group(); lift.add(body);
  const torso = mk(SPH, fur, 0.072, 0.066, 0.115, 0, 0, 0, body);
  mk(SPH, belly, 0.058, 0.056, 0.06, 0, -0.008, 0.062, body);       // chest
  mk(SPH, fur, 0.064, 0.062, 0.07, 0, 0.004, -0.06, body);           // haunches
  const headPivot = new THREE.Group(); headPivot.position.set(0, 0.05, 0.095); body.add(headPivot);
  const head = new THREE.Group(); headPivot.add(head);
  mk(SPH, fur, 0.069, 0.06, 0.061, 0, 0.045, 0.03, head);
  mk(SPH, fur, 0.04, 0.032, 0.036, 0.034, 0.024, 0.055, head); mk(SPH, fur, 0.04, 0.032, 0.036, -0.034, 0.024, 0.055, head);   // cheeks
  mk(SPH_LO, belly, 0.03, 0.021, 0.022, 0, 0.023, 0.08, head);      // muzzle
  mk(SPH_LO, noseM, 0.009, 0.007, 0.007, 0, 0.037, 0.093, head);
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(s * 0.027, 0.056, 0.079); head.add(eye);
    const irisM = new THREE.MeshStandardMaterial({ color: k.eyes[s < 0 ? 0 : 1], roughness: 0.25, emissive: k.glow ? k.eyes[0] : 0x000000, emissiveIntensity: k.glow ? 0.55 : 0 });
    mk(SPH_LO, irisM, 0.0135, 0.0135, 0.008, 0, 0, 0, eye);
    mk(SPH_LO, pupilM, 0.0042, 0.0105, 0.004, 0, 0, 0.0055, eye);
    mk(SPH_LO, hiM, 0.0028, 0.0028, 0.002, 0.004, 0.005, 0.0085, eye);
    eye.rotation.y = s * 0.28;
    eyes.push(eye);
  }
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group(); ear.position.set(s * 0.036, 0.088, 0.02); ear.rotation.set(-0.12, 0, -s * 0.32); head.add(ear);
    mk(EAR, fur, 0.026, 0.052, 0.014, 0, 0.022, 0, ear);
    mk(EAR, earIn, 0.016, 0.034, 0.006, 0, 0.016, 0.007, ear);
    ears.push(ear);
  }
  // whiskers
  const wpos = [];
  for (const s of [-1, 1]) for (const dy of [-0.004, 0.003, 0.009]) wpos.push(s * 0.02, 0.025, 0.09, s * 0.075, 0.025 + dy * 3, 0.085);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  head.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: kind === 'black' ? 0x8a8a90 : 0xcfcac2, transparent: true, opacity: 0.85 })));
  // legs
  const legs = [];
  for (const [x, z, front] of [[0.036, 0.07, 1], [-0.036, 0.07, 1], [0.041, -0.075, 0], [-0.041, -0.075, 0]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, -0.02, z); body.add(pivot);
    const leg = new THREE.Group(); pivot.add(leg);
    mk(LEG, fur, 1, 1, 1, 0, -0.04, 0, leg);
    mk(SPH_LO, kind === 'black' ? fur : belly, 0.021, 0.014, 0.025, 0, -0.072, 0.006, leg);
    legs.push({ pivot, leg, front, side: x > 0 ? 1 : -1 });
  }
  // tail: a chain of segments pointing backwards
  const tail = [];
  let parent = new THREE.Group(); parent.position.set(0, 0.022, -0.112); body.add(parent);
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group(); parent.add(seg);
    mk(TAILSEG, fur, 1 - i * 0.04, 1 - i * 0.04, 1, 0, 0, -0.017, seg);
    tail.push(seg);
    const next = new THREE.Group(); next.position.set(0, 0, -0.032); seg.add(next); parent = next;
  }
  const shadow = blobShadow(); shadow.position.y = 0.003; shadow.scale.set(0.22, 0.3, 1); root.add(shadow);

  const r = (seed * 9301 + 49297) % 233280 / 233280;
  const size = 0.94 + r * 0.14;
  root.scale.setScalar(size);
  const P = { ...POSES.sit };
  const cat = {
    kind, root, body, head: headPivot, size, pose: 'sit', gait: 0, speed: 0, phase: r * 10, t: r * 100, jump: 0, look: 0,
    // world points for the "can it be seen" test (head, ears, body, rump)
    samples(out = []) {
      out.length = 0;
      root.updateMatrixWorld(true);
      for (const o of [headPivot, ears[0], ears[1]]) out.push(new THREE.Vector3(0, 0.04, 0.03).applyMatrix4(o.matrixWorld));
      out.push(new THREE.Vector3(0, 0, 0).applyMatrix4(torso.matrixWorld), new THREE.Vector3(0, 0, -0.08).applyMatrix4(body.matrixWorld));
      return out;
    },
    center(out = new THREE.Vector3()) { return out.set(0, 0, 0).applyMatrix4(body.matrixWorld); },
    update(dt) {
      cat.t += dt;
      const T = POSES[cat.pose] || POSES.stand, a = 1 - Math.exp(-dt * 7);
      for (const key of KEYS) P[key] += (T[key] - P[key]) * a;
      const moving = cat.pose === 'walk' || cat.pose === 'run';
      cat.gait += ((moving ? 1 : 0) - cat.gait) * a;
      const freq = cat.pose === 'run' ? 3.2 : 1.6;
      cat.phase += dt * Math.max(0.6, cat.speed) * freq * Math.PI * 2 / (cat.pose === 'run' ? 1.4 : 0.42);
      const amp = (cat.pose === 'run' ? 0.95 : 0.45) * cat.gait;
      const breathe = Math.sin(cat.t * (cat.pose === 'sleep' ? 1.6 : 3.4)) * (cat.pose === 'sleep' ? 0.035 : 0.012);
      body.position.y = P.bodyY + Math.abs(Math.sin(cat.phase)) * 0.012 * cat.gait;
      body.rotation.x = P.pitch + Math.sin(cat.phase * 2) * 0.04 * cat.gait;
      body.scale.set(1 + breathe * 0.6, 1 + breathe, P.stretch);
      lift.position.y = cat.jump;
      headPivot.rotation.x = P.head + Math.sin(cat.phase * 2) * 0.05 * cat.gait;
      headPivot.position.y = 0.05 + P.headY;
      headPivot.rotation.y = cat.look + (cat.pose === 'peek' ? Math.sin(cat.t * 0.9) * 0.35 : cat.pose === 'sit' || cat.pose === 'loaf' ? Math.sin(cat.t * 0.37) * 0.3 : 0);
      headPivot.rotation.z = cat.pose === 'happy' ? Math.sin(cat.t * 6) * 0.15 : 0;
      for (const l of legs) {
        const ph = cat.phase + (l.front ? 0 : Math.PI) + (l.side > 0 ? Math.PI / 2 * (cat.pose === 'run' ? 0.3 : 2) : 0);
        l.pivot.rotation.x = (l.front ? P.legFr : P.legBr) + Math.sin(ph) * amp;
        l.leg.scale.y = l.front ? P.legF : P.legB;
      }
      // blink every few seconds
      const blink = cat.pose !== 'sleep' && (cat.t % 4.1) < 0.12 ? 0.12 : 1;
      for (const e of eyes) e.scale.y = Math.max(0.06, P.eye * blink);
      for (const [i, e] of ears.entries()) e.rotation.x = -0.12 - P.ears + (i ? 1 : -1) * Math.sin(cat.t * 0.8 + i) * 0.02;
      const sway = Math.sin(cat.t * (moving ? 5 : 1.3)) * (moving ? 0.12 : 0.18);
      tail.forEach((s, i) => {
        s.rotation.x = i === 0 ? P.tailLift : P.tailBend + (cat.pose === 'happy' ? Math.sin(cat.t * 9 + i) * 0.08 : 0);
        s.rotation.y = P.tailCurl + sway * (i / 6);
      });
      shadow.scale.set(0.24 / (1 + cat.jump * 4), (cat.pose === 'sit' ? 0.24 : 0.32) / (1 + cat.jump * 4), 1);
      shadow.material.opacity = 1 / (1 + cat.jump * 6);
    },
  };
  cat.update(0.016);
  return cat;
}

// The cat-head shape used for the aiming reticle and the checklist (100 × 100 box)
export const HEAD_PATH = 'M19 43 L15 9 L41 27 Q50 24.5 59 27 L85 9 L81 43 Q91 58 84 74 Q73 93 50 93 Q27 93 16 74 Q9 58 19 43 Z';
