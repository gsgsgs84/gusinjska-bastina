// Gdje su mace? – a furnished test room, used when there is no camera (computer, or AR not available) and for tests.
// It also produces "tracked points" like room tracking would, so the same hiding-spot code runs on it.
import * as THREE from 'three';

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat);
  t.anisotropy = 4;
  return t;
}
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function wood(base, dark, seed = 1) {
  const r = rnd(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = dark; g.globalAlpha = 0.08 + r() * 0.18; g.lineWidth = 1 + r() * 3;
      const y = r() * h; g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x / 30 + i) * 4 + (r() - 0.5) * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
}
function fabric(base, line, seed = 2) {
  const r = rnd(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { g.fillStyle = r() < 0.5 ? line : 'rgba(255,255,255,0.25)'; g.globalAlpha = 0.25; g.fillRect(r() * w, r() * h, 2, 2); }
    g.globalAlpha = 0.18; g.strokeStyle = line; g.lineWidth = 3;
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.globalAlpha = 1;
  }, [2, 2]);
}
function parquet() {
  const r = rnd(7);
  return canvasTex(512, 512, (g, w, h) => {
    const bw = 64, bh = 256;
    for (let y = -bh; y < h; y += bh) for (let x = 0; x < w; x += bw) {
      const off = (x / bw) % 2 ? bh / 2 : 0, l = 120 + r() * 50;
      g.fillStyle = `rgb(${l + 40},${l},${l - 45})`; g.fillRect(x, y + off, bw - 2, bh - 2);
      g.globalAlpha = 0.15; g.strokeStyle = '#3b2412';
      for (let k = 0; k < 6; k++) { const xx = x + r() * bw; g.beginPath(); g.moveTo(xx, y + off); g.lineTo(xx + (r() - 0.5) * 8, y + off + bh); g.stroke(); }
      g.globalAlpha = 1;
    }
  }, [5, 5]);
}
function wallTex() {
  const r = rnd(11);
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e9e2d4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(120,100,80,0.07)' : 'rgba(255,255,255,0.12)'; g.fillRect(r() * w, r() * h, 3, 3); }
  }, [3, 2]);
}
function picture(seed) {
  const r = rnd(seed);
  return canvasTex(256, 192, (g, w, h) => {
    g.fillStyle = '#5b4632'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2ead8'; g.fillRect(12, 12, w - 24, h - 24);
    const sky = g.createLinearGradient(0, 20, 0, h); sky.addColorStop(0, '#8fb6d6'); sky.addColorStop(1, '#e9dcc0');
    g.fillStyle = sky; g.fillRect(22, 22, w - 44, h - 44);
    g.fillStyle = '#4d6553'; g.beginPath(); g.moveTo(22, h - 22);
    for (let x = 22; x <= w - 22; x += 18) g.lineTo(x, 60 + r() * 70);
    g.lineTo(w - 22, h - 22); g.fill();
    g.fillStyle = '#f7f3ea'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(30 + r() * (w - 60), 70 + r() * 40, 3, 0, 7); g.fill(); }
  });
}
function books(seed) {
  const r = rnd(seed), cols = ['#8c2f2a', '#2f4a6b', '#c9a24a', '#3e6b48', '#6b3e5e', '#d9cdb2', '#24303a', '#b5652b'];
  return canvasTex(256, 64, (g, w, h) => {
    let x = 0;
    while (x < w) {
      const bw = 6 + r() * 12, bh = h * (0.7 + r() * 0.3);
      g.fillStyle = cols[Math.floor(r() * cols.length)]; g.fillRect(x, h - bh, bw - 1, bh);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 2, h - bh + 6, bw - 5, 2); g.fillRect(x + 2, h - 10, bw - 5, 2);
      x += bw;
    }
  });
}

export function buildDemoRoom() {
  const group = new THREE.Group(); group.name = 'demoRoom';
  const meshes = [];
  const mat = (map, extra = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0, ...extra });
  const M = {
    floor: mat(parquet()), wall: mat(wallTex()), sofa: mat(fabric('#4f6f7a', '#2c4148', 3)), cushion: mat(fabric('#c9824a', '#7a4a24', 4)),
    oak: mat(wood('#b88a5a', '#5a3a1c', 5)), walnut: mat(wood('#6e4a2e', '#2e1c0e', 6)), white: mat(wood('#ece6da', '#c9bfae', 8)),
    pot: mat(fabric('#b5653a', '#7a3b1c', 9)), leaf: new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.8, flatShading: true }),
    rug: mat(fabric('#a9443a', '#e8d6b0', 10)), basket: mat(fabric('#c8a46a', '#7a5a2a', 12)), lamp: new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffe2a8, emissiveIntensity: 0.6 }),
  };
  const box = (w, h, d, x, y, z, m, solid = true) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(w, d), uv.getY(i) * Math.max(h, 0.3));
    const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true;
    o.userData.solid = solid; group.add(o); meshes.push(o); return o;
  };
  const W = 2.5, BACK = -2.6, FRONT = 2.0, H = 2.6;
  // room
  const floor = box(2 * W, 0.02, FRONT - BACK, 0, -0.01, (FRONT + BACK) / 2, M.floor); floor.userData.floor = true;
  box(2 * W, H, 0.05, 0, H / 2, BACK - 0.025, M.wall); box(0.05, H, FRONT - BACK, -W - 0.025, H / 2, (FRONT + BACK) / 2, M.wall);
  box(0.05, H, FRONT - BACK, W + 0.025, H / 2, (FRONT + BACK) / 2, M.wall); box(2 * W, H, 0.05, 0, H / 2, FRONT + 0.025, M.wall);
  const pic = (x, y, z, ry, s) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), mat(picture(s))); p.position.set(x, y, z); p.rotation.y = ry; group.add(p); meshes.push(p); p.userData.solid = false; };
  pic(0, 1.55, BACK + 0.01, 0, 21); pic(W - 0.01, 1.5, -0.6, -Math.PI / 2, 22); pic(-W + 0.01, 1.55, 0.7, Math.PI / 2, 23);
  // rug
  box(2.0, 0.01, 1.4, 0, 0.005, -1.05, M.rug, false);
  // sofa against the back wall
  box(2.0, 0.42, 0.78, 0, 0.21, -1.99, M.sofa); box(2.0, 0.85, 0.22, 0, 0.425, -2.49, M.sofa);
  box(0.18, 0.62, 1.0, -1.09, 0.31, -2.1, M.sofa); box(0.18, 0.62, 1.0, 1.09, 0.31, -2.1, M.sofa);
  box(0.45, 0.4, 0.14, -0.55, 0.62, -2.28, M.cushion).rotation.x = -0.2; box(0.45, 0.4, 0.14, 0.55, 0.62, -2.28, M.cushion).rotation.x = -0.2;
  // coffee table
  box(1.0, 0.05, 0.55, 0, 0.425, -1.0, M.oak);
  for (const [x, z] of [[-0.45, -1.22], [0.45, -1.22], [-0.45, -0.78], [0.45, -0.78]]) box(0.05, 0.4, 0.05, x, 0.2, z, M.oak);
  box(0.3, 0.04, 0.22, -0.2, 0.47, -1.05, mat(books(31)));
  // bookshelf on the left wall
  const bx = -2.34, bz = -1.15;
  box(0.32, 1.8, 0.03, bx, 0.9, bz - 0.5, M.walnut); box(0.32, 1.8, 0.03, bx, 0.9, bz + 0.5, M.walnut); box(0.02, 1.8, 1.0, bx - 0.15, 0.9, bz, M.walnut);
  for (const y of [0.02, 0.42, 0.82, 1.22, 1.62, 1.79]) box(0.32, 0.03, 1.0, bx, y, bz, M.walnut);
  for (const [y, s] of [[0.42, 41], [0.82, 42], [1.22, 43]]) { const b = box(0.22, 0.3, 0.9, bx - 0.04, y + 0.165, bz, mat(books(s))); b.material.map.repeat.set(1, 1); }
  // dining table and chairs on the right
  const tx = 1.6, tz = -0.6;
  box(0.8, 0.04, 1.2, tx, 0.75, tz, M.oak);
  for (const [x, z] of [[-0.35, -0.55], [0.35, -0.55], [-0.35, 0.55], [0.35, 0.55]]) box(0.05, 0.73, 0.05, tx + x, 0.365, tz + z, M.oak);
  const chair = (x, z, dir) => {                     // dir: the back is at +z (1) or at -x (0)
    box(0.42, 0.04, 0.42, x, 0.45, z, M.white);
    if (dir) box(0.42, 0.48, 0.04, x, 0.71, z + 0.19, M.white); else box(0.04, 0.48, 0.42, x - 0.19, 0.71, z, M.white);
    for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) box(0.035, 0.45, 0.035, x + a, 0.225, z + b, M.white);
  };
  chair(tx - 0.62, tz + 0.05, 0); chair(tx, tz + 0.82, 1);
  // dresser by the right wall, near the door, with a lamp
  box(0.45, 0.8, 1.0, 2.25, 0.4, 1.2, M.white);
  for (const y of [0.2, 0.45, 0.68]) box(0.02, 0.02, 0.6, 2.02, y, 1.2, M.walnut, false);
  box(0.16, 0.05, 0.16, 2.25, 0.825, 1.45, M.walnut); box(0.03, 0.3, 0.03, 2.25, 0.99, 1.45, M.walnut);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.18, 20, 1, true), M.lamp); shade.position.set(2.25, 1.2, 1.45); group.add(shade); meshes.push(shade); shade.userData.solid = true;
  // plant in the corner
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.36, 20), M.pot); pot.position.set(-1.65, 0.18, -2.3); pot.castShadow = true; group.add(pot); meshes.push(pot); pot.userData.solid = true;
  const R = rnd(5);
  for (let i = 0; i < 9; i++) {
    const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16 + R() * 0.1, 0), M.leaf);
    l.position.set(-1.65 + (R() - 0.5) * 0.35, 0.55 + R() * 0.6, -2.3 + (R() - 0.5) * 0.3); l.rotation.set(R() * 3, R() * 3, 0); l.castShadow = true;
    group.add(l); meshes.push(l); l.userData.solid = true;
  }
  // wicker basket by the left wall
  const bk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.26, 24, 1, true), M.basket); bk.material.side = THREE.DoubleSide;
  bk.position.set(-1.95, 0.13, 0.55); group.add(bk); meshes.push(bk); bk.userData.solid = true;
  const bkb = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), M.basket); bkb.rotation.x = -Math.PI / 2; bkb.position.set(-1.95, 0.01, 0.55); group.add(bkb);
  // a floor cushion (pouf) in the open
  const pouf = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.34, 24), M.cushion); pouf.position.set(0.95, 0.17, 0.15); pouf.castShadow = true;
  group.add(pouf); meshes.push(pouf); pouf.userData.solid = true;

  group.traverse(o => { if (o.isMesh) o.receiveShadow = true; });
  group.updateMatrixWorld(true);

  // ---- points like room tracking would find: on textured surfaces seen from where the visitor stands ----
  function makePoints(cams, seed = 3) {
    const r = rnd(seed), ray = new THREE.Raycaster(), pts = [], tmp = new THREE.Vector3(), dir = new THREE.Vector3(), nrm = new THREE.Vector3();
    const solids = meshes;
    const gauss = () => (r() + r() + r() - 1.5) * 0.012;
    for (const m of meshes) {
      const g = m.geometry, pos = g.attributes.position, idx = g.index;
      const density = m === floor ? 26 : m.material === M.wall ? 30 : m.material === M.rug ? 60 : 110;
      const tris = idx ? idx.count / 3 : pos.count / 3;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let t = 0; t < tris; t++) {
        const ia = idx ? idx.getX(3 * t) : 3 * t, ib = idx ? idx.getX(3 * t + 1) : 3 * t + 1, ic = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
        a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
        const area = tmp.subVectors(b, a).cross(nrm.subVectors(c, a)).length() / 2;
        if (a.y > 2.45 && b.y > 2.45 && c.y > 2.45) continue;        // ceiling edge: few points up there
        let n = area * density; n = Math.floor(n) + (r() < n % 1 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          let u = r(), v = r(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
          const p = new THREE.Vector3().copy(a).addScaledVector(tmp.subVectors(b, a), u).addScaledVector(nrm.subVectors(c, a), v);
          if (p.y > 2.4) continue;
          // seen from at least one camera?
          let seen = false;
          for (const cam of cams) {
            dir.subVectors(p, cam); const d = dir.length(); dir.divideScalar(d);
            ray.set(cam, dir); ray.far = d - 0.01;
            if (!ray.intersectObjects(solids, false).length) { seen = true; break; }
          }
          if (seen) pts.push({ x: p.x + gauss(), y: p.y + gauss(), z: p.z + gauss() });
        }
      }
    }
    return pts;
  }
  return { group, meshes, start: { pos: new THREE.Vector3(0, 1.4, 1.0), yaw: 0 }, makePoints, bounds: { x0: -W + 0.2, x1: W - 0.2, z0: BACK + 0.2, z1: FRONT - 0.2 } };
}
