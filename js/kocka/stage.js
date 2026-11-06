// three.js stage of the museum cube: the camera picture, the pedestal that covers the cube, the exhibit,
// its light and shadow, the glass case, the reveal effect, and the turntable preview on the start screen.
//
// Coordinates: a tracked pose is X_cam = R X_cube + t (OpenCV camera: x right, y down, z forward, mm);
// the cube's frame has +Y up and its origin at the cube's centre (data/layout.json).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const CV2GL = new THREE.Matrix4().set(1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
const easeIO = x => x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const now = () => performance.now() / 1000;

export class Stage {
  constructor(canvas, layout) {
    this.canvas = canvas;
    this.S = layout.edge;                     // cube edge, mm
    this.cardSize = layout.card ? layout.card.size : 170;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.localClippingEnabled = true;
    r.autoClear = false;
    r.setClearColor(0x000000, 0);
    this.pixK = 1;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 5, 20000);
    this.camera.matrixAutoUpdate = false;
    this.mode = 'preview';                    // 'preview' (start screen) | 'ar'

    // ---- camera picture: two buffers, so the frame being tracked is never shown half-drawn ----
    this.bgScene = new THREE.Scene();
    this.bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.bgMat = new THREE.MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false });
    this.bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat);
    this.blurMat = new THREE.MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false, color: 0x707070 });
    this.bgBlur = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.bgBlur.renderOrder = 0; this.bgMesh.renderOrder = 1; this.bgBlur.visible = false;
    this.bgScene.add(this.bgBlur, this.bgMesh);
    this.frames = [0, 1].map(() => { const c = document.createElement('canvas'); c.width = c.height = 2; return { canvas: c, ctx: c.getContext('2d', { alpha: false }), tex: null }; });
    this.blurCanvas = document.createElement('canvas'); this.blurCtx = this.blurCanvas.getContext('2d', { alpha: false });
    this.blurTex = null; this.showSlot = -1;
    this.view = { W: 0, H: 0, vw: 0, vh: 0, s: 1, ox: 0, oy: 0, mode: 'fill' };

    // ---- light ----
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.envBase = 0.62;
    this.scene.environmentIntensity = this.envBase;
    this.hemi = new THREE.HemisphereLight(0xfff6ea, 0x6d655a, 0.5);
    this.sun = new THREE.DirectionalLight(0xfff3e0, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.5; this.sun.shadow.radius = 3;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.lightK = 1; this.tint = new THREE.Color(1, 1, 1);

    // ---- anchors: the real cube and the flat card ----
    this.anchors = { cube: new THREE.Group(), card: new THREE.Group() };
    for (const a of Object.values(this.anchors)) { a.matrixAutoUpdate = false; a.visible = false; this.scene.add(a); }
    // holder: where the exhibit stands (top of the pedestal; turns between cube faces); yaw: turning; fit: scale
    this.holder = new THREE.Group();
    this.yawGroup = new THREE.Group();
    this.fitGroup = new THREE.Group();
    this.holder.add(this.yawGroup); this.yawGroup.add(this.fitGroup);
    this.place = { Q: new THREE.Quaternion(), from: new THREE.Quaternion(), to: new THREE.Quaternion(), t0: 0, dur: 0, yaw: 0, yawFrom: 0, yawTo: 0, yt0: -10, spin: 0 };
    this.target = null;                       // 'cube' | 'card' | null
    this.opts = { plinth: 'stone', place: 'top', shadows: true, vitrine: false, size: 1 };

    this.buildPedestal();
    this.buildFx();
    this.loader = new GLTFLoader(); this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.cache = new Map();
    this.model = null; this.exhibit = null; this.loadSeq = 0;
    this.reveal = { k: 1, t0: -10, dur: 1.15, dir: 1, pending: null };
    this.clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
    this.raycaster = new THREE.Raycaster();
    this.preview = { t0: now(), yaw: 0.6, drag: 0 };
    this.anchors.cube.add(this.holder);
    this._tmpQ = new THREE.Quaternion(); this._tmpM = new THREE.Matrix4(); this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();
  }

  // ---------------- pedestal ----------------
  buildPedestal() {
    const S = this.S, k = 1.035, E = S * k;
    this.E = E; this.cap = 3.2; this.capW = S * 1.085;
    this.mats = {
      stone: new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.86, metalness: 0 }),
      marble: new THREE.MeshPhysicalMaterial({ map: marbleTexture(), roughness: 0.22, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
      wood: new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.5, metalness: 0 }),
    };
    this.capMats = {
      stone: new THREE.MeshStandardMaterial({ color: 0x3b3128, roughness: 0.55, metalness: 0.15 }),
      marble: new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.35, metalness: 0.6 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x1f1610, roughness: 0.45, metalness: 0.1 }),
    };
    this.plinth = new THREE.Mesh(roundedBlock(E, E, E, 1.6), this.mats.stone);
    this.plinth.receiveShadow = true;
    this.anchors.cube.add(this.plinth);
    // a thin dark top slab: the display surface, on whichever face points up
    this.capMesh = new THREE.Mesh(roundedBlock(this.capW, this.cap, this.capW, 1.0), this.capMats.stone);
    this.capMesh.position.y = -this.cap / 2; this.capMesh.receiveShadow = true; this.capMesh.castShadow = false;
    this.holder.add(this.capMesh);
    // brass name plate on the side that faces you
    this.plateGroup = new THREE.Group(); this.holder.add(this.plateGroup);
    this.plateCanvas = document.createElement('canvas'); this.plateCanvas.width = 1024; this.plateCanvas.height = 256;
    this.plateTex = new THREE.CanvasTexture(this.plateCanvas); this.plateTex.colorSpace = THREE.SRGBColorSpace; this.plateTex.anisotropy = 4;
    const plateMat = new THREE.MeshStandardMaterial({ map: this.plateTex, metalness: 0.8, roughness: 0.34, color: 0xffffff });
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xb08a3e, metalness: 0.9, roughness: 0.3 });
    const pw = S * 0.74, ph = pw / 4;
    // box faces: +x, -x, +y, -y, +z (the engraved front), -z
    this.plate = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.9), [edgeMat, edgeMat, edgeMat, edgeMat, plateMat, edgeMat]);
    this.plate.position.set(0, -this.cap - E * 0.24, E / 2 + 0.45);
    this.plate.castShadow = false; this.plate.receiveShadow = true;
    this.plateGroup.add(this.plate);
    this.plateYaw = 0; this.plateFade = 1; this.plateFadeDir = 0;
    // shadow catcher and a soft contact shadow, for the card and the "no pedestal" look
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false }));
    this.catcher.rotation.x = -Math.PI / 2; this.catcher.receiveShadow = true; this.catcher.position.y = 0.05;
    this.holder.add(this.catcher);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, toneMapped: false, color: 0x000000, opacity: 0.55 }));
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.12; this.blob.renderOrder = 2;
    this.holder.add(this.blob);
    // glass case
    this.vitrine = new THREE.Group(); this.holder.add(this.vitrine); this.vitrine.visible = false;
    // glass: env reflections plus two soft diagonal streaks, so the pane reads as glass on any background
    this.glassMat = new THREE.MeshPhysicalMaterial({ color: 0xf4f8f6, map: glassTexture(), metalness: 0, roughness: 0.04, transparent: true, opacity: 0.32,
      envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false, side: THREE.FrontSide });
    this.frameMat = new THREE.MeshStandardMaterial({ color: 0x9a7536, metalness: 0.9, roughness: 0.32 });
  }

  setPlinth(style) {
    this.opts.plinth = style;
    if (this.mats[style]) { this.plinth.material = this.mats[style]; this.capMesh.material = this.capMats[style]; }
    this.layoutHolder();
  }
  setPlace(p) { this.opts.place = p; this.layoutHolder(); this.fitModel(); }
  setShadows(on) { this.opts.shadows = on; this.sun.castShadow = on; this.blob.visible = on && this.blobWanted; }
  setVitrine(on) { this.opts.vitrine = on; this.buildVitrine(); }

  get hand() { return this.opts.place === 'hand' && this.target !== 'card'; }

  // which parts show, and where the exhibit stands
  layoutHolder() {
    const onCube = this.target !== 'card', hand = this.hand, ped = onCube && !hand && this.opts.plinth !== 'none';
    this.plinth.visible = onCube && !hand && this.opts.plinth !== 'none';
    this.capMesh.visible = ped; this.plateGroup.visible = ped;
    this.catcher.visible = !hand && !ped;
    this.blobWanted = !hand;
    this.blob.visible = this.opts.shadows && this.blobWanted;
    this.vitrine.visible = this.opts.vitrine && !hand && !!this.model;
    const parent = this.target === 'card' ? this.anchors.card : this.anchors.cube;
    if (this.holder.parent !== parent) parent.add(this.holder);
    this.fitModel();
  }

  // ---------------- exhibits ----------------
  // m: { id, file, name, fit, yaw, ... }; onProgress(0..1)
  async load(m, onProgress) {
    const seq = ++this.loadSeq;
    let root = this.cache.get(m.id);
    if (!root) {
      const gltf = await this.loader.loadAsync(m.file, e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); });
      root = prepareModel(gltf.scene, this.clip);
      try { await this.renderer.compileAsync(root, this.camera, this.scene); } catch { /* older browsers: compiled on first draw */ }
      this.cache.set(m.id, root);
      if (this.cache.size > 6) { const old = [...this.cache.keys()].find(k => k !== m.id && (!this.exhibit || k !== this.exhibit.id)); if (old) { disposeTree(this.cache.get(old)); this.cache.delete(old); } }
    }
    if (seq !== this.loadSeq) return false;
    // dissolve the current exhibit downwards, then raise the new one
    const swap = () => {
      if (this.model) this.fitGroup.remove(this.model);
      this.model = root; this.exhibit = m;
      this.fitGroup.add(root);
      this.place.yaw = this.place.yawTo = this.place.yawFrom = (m.yaw || 0) * Math.PI / 180;
      this.fitModel(); this.drawPlate(m); this.buildVitrine(); this.layoutHolder();
      this.startReveal(1);
    };
    if (this.model && this.reveal.k > 0.5 && this.target) { this.startReveal(-1, swap); } else swap();
    return true;
  }

  fitModel() {
    if (!this.model) return;
    const u = this.model.userData, m = this.exhibit || {}, S = this.S;
    const fit = m.fit || 0.92;
    let s;
    if (this.target === 'card') s = Math.min(u.unit * this.cardSize * 0.62, 200 / Math.max(1e-6, u.height));
    else if (this.hand) s = S * 1.8 / Math.max(u.foot, u.height);
    else s = Math.min(u.unit * (this.capW * fit), S * 1.75 / Math.max(1e-6, u.height));
    s *= this.opts.size;
    this.model.scale.setScalar(s);
    this.mH = u.height * s; this.mF = u.foot * s;
    const rr = Math.max(this.mF, this.mH) * 0.75 + 20, c = this.sun.shadow.camera;
    c.left = -rr; c.right = rr; c.top = rr; c.bottom = -rr; c.near = 1; c.far = 2000; c.updateProjectionMatrix();
    const blob = Math.max(this.mF * 1.25, 20);
    this.blob.scale.set(blob, blob, 1);
    const cs = this.target === 'card' ? this.cardSize * 1.6 : Math.max(this.mF * 2.4, 140);
    this.catcher.scale.set(cs, cs, 1);
    this.holderOffset();
    if (this.opts.vitrine) this.buildVitrine();
  }

  holderOffset() {
    this.fitGroup.position.y = this.hand ? -this.mH / 2 : 0;
  }

  buildVitrine() {
    const v = this.vitrine;
    for (const c of [...v.children]) { v.remove(c); c.geometry.dispose(); }
    if (!this.opts.vitrine || !this.model) { v.visible = false; return; }
    const w = this.capW * 0.97, h = Math.max(this.mH * 1.06 + 8, w * 0.7), t = 1.5;
    const glass = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), this.glassMat);
    glass.position.y = h / 2; glass.renderOrder = 5; glass.castShadow = false;
    v.add(glass);
    const bar = (sx, sy, sz, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.frameMat); b.position.set(x, y, z); b.castShadow = true; v.add(b); };
    const hw = w / 2;
    for (const [x, z] of [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]]) bar(t, h, t, x, h / 2, z);
    bar(w + t, t, t, 0, h, -hw); bar(w + t, t, t, 0, h, hw); bar(t, t, w + t, -hw, h, 0); bar(t, t, w + t, hw, h, 0);
    v.visible = !this.hand && this.target !== null || this.mode === 'preview';
  }

  drawPlate(m) {
    const c = this.plateCanvas, g = c.getContext('2d'), W = c.width, H = c.height;
    // brushed brass
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#b8893a'); grad.addColorStop(0.45, '#e2bf6e'); grad.addColorStop(0.55, '#d4ad5c'); grad.addColorStop(1, '#9c7130');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.08;
    for (let y = 0; y < H; y += 2) { g.fillStyle = Math.random() < 0.5 ? '#fff' : '#3a2a10'; g.fillRect(0, y, W, 1); }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(60,40,10,0.55)'; g.lineWidth = 6; g.strokeRect(14, 14, W - 28, H - 28);
    const engrave = (text, y, size, weight, font, spacing) => {
      g.font = `${weight} ${size}px ${font}`;
      let s = size;
      while (g.measureText(text).width + spacing * text.length > W - 90 && s > 26) { s -= 2; g.font = `${weight} ${s}px ${font}`; }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
      g.fillStyle = 'rgba(255,240,200,0.55)'; g.fillText(text, W / 2 + 2, y + 2);
      g.fillStyle = '#3b2a10'; g.fillText(text, W / 2, y);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
    };
    const serif = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, "Noto Serif", serif';
    engrave((m.name || '').toUpperCase(), H * 0.44, 86, '600', serif, 4);
    engrave(m.plateSub || 'GUSINJE', H * 0.76, 34, '500', serif, 10);
    this.plateTex.needsUpdate = true;
  }

  // ---------------- reveal: the exhibit is drawn from the base up, with a ring of light ----------------
  buildFx() {
    this.fx = new THREE.Group(); this.holder.add(this.fx);
    const ringMat = new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xffc56b, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ringMat); this.ring.rotation.x = -Math.PI / 2; this.ring.renderOrder = 6;
    const beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xffd38a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, opacity: 0 });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), beamMat); this.beam.renderOrder = 6;
    const N = 46, pos = new Float32Array(N * 3); this.sparkSeed = Array.from({ length: N }, () => [Math.random() * Math.PI * 2, Math.sqrt(Math.random()), Math.random(), 0.6 + Math.random() * 0.8]);
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(pg, new THREE.PointsMaterial({ map: dotTexture(), color: 0xffd99a, size: 2.6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
    this.sparks.frustumCulled = false; this.sparks.renderOrder = 7;
    this.fx.add(this.ring, this.beam, this.sparks);
    this.fx.visible = false;
  }
  startReveal(dir, then) {
    const r = this.reveal;
    r.dir = dir; r.t0 = now(); r.dur = dir > 0 ? 1.15 : 0.32; r.then = then || null; r.from = r.k;
  }
  stepReveal(t) {
    const r = this.reveal;
    let x = 1;
    if (r.t0 >= 0) {
      x = clamp((t - r.t0) / r.dur, 0, 1);
      r.k = r.dir > 0 ? x : r.from * (1 - x);
      if (x >= 1) {
        r.t0 = -10;
        if (r.then) { const f = r.then; r.then = null; f(); return; }
      }
    }
    if (r.t0 < 0) {
      // at rest: everything shown (or everything hidden before the cube is found)
      this.fx.visible = false;
      if (r.k >= 1) this.clip.normal.set(0, 1, 0), this.clip.constant = 1e6;
      else this.clip.normal.set(0, -1, 0), this.clip.constant = -1e6;
      return;
    }
    // wipe plane through the holder, at the current height
    const k = r.dir > 0 ? easeIO(r.k) : r.k, h = (this.mH || 50) * 1.04 + 1;
    const level = this.hand ? -this.mH / 2 + h * k : h * k;
    this.fx.visible = r.dir > 0 && x < 1 && !!this.target || (this.mode === 'preview' && r.dir > 0 && x < 1);
    this.holder.updateWorldMatrix(true, true);
    const up = this._v.set(0, 1, 0).transformDirection(this.holder.matrixWorld);
    const p = this._v2.set(0, level, 0).applyMatrix4(this.holder.matrixWorld);
    this.clip.setFromNormalAndCoplanarPoint(up.clone().negate(), p);
    if (!this.fx.visible) return;
    const bell = Math.sin(Math.PI * clamp(x * 1.05, 0, 1));
    const rad = Math.max(this.mF * 0.62, 14);
    this.ring.position.y = level + 0.2; this.ring.scale.set(rad * 2.4, rad * 2.4, 1);
    this.ring.material.opacity = 0.95 * bell;
    this.beam.position.y = (this.hand ? -this.mH / 2 : 0) + h * 0.6; this.beam.scale.set(rad * 0.95, h * 1.2, rad * 0.95);
    this.beam.material.opacity = 0.38 * Math.pow(bell, 1.5);
    const pos = this.sparks.geometry.attributes.position;
    for (let i = 0; i < this.sparkSeed.length; i++) {
      const [a, rr, ph, sp] = this.sparkSeed[i];
      const yy = ((x * sp + ph) % 1) * h * 1.25;
      const ra = rad * (0.4 + 0.75 * rr) * (1 + 0.25 * Math.sin(t * 3 + a));
      pos.setXYZ(i, Math.cos(a + x * 2) * ra, (this.hand ? -this.mH / 2 : 0) + yy, Math.sin(a + x * 2) * ra);
    }
    pos.needsUpdate = true;
    this.sparks.material.opacity = 0.9 * bell; this.sparks.material.size = Math.max(1.6, rad * 0.09);
  }

  // ---------------- camera picture ----------------
  ensureFrames(vw, vh) {
    for (const f of this.frames) {
      if (f.canvas.width !== vw || f.canvas.height !== vh) {
        f.canvas.width = vw; f.canvas.height = vh;
        if (f.tex) f.tex.dispose();
        f.tex = new THREE.CanvasTexture(f.canvas); f.tex.colorSpace = THREE.SRGBColorSpace; f.tex.generateMipmaps = false; f.tex.minFilter = THREE.LinearFilter;
      }
    }
    const bw = 48, bh = Math.max(8, Math.round(bw * vh / vw));
    if (this.blurCanvas.width !== bw || this.blurCanvas.height !== bh) {
      this.blurCanvas.width = bw; this.blurCanvas.height = bh;
      if (this.blurTex) this.blurTex.dispose();
      this.blurTex = new THREE.CanvasTexture(this.blurCanvas); this.blurTex.colorSpace = THREE.SRGBColorSpace; this.blurTex.minFilter = THREE.LinearFilter; this.blurTex.generateMipmaps = false;
      this.blurMat.map = this.blurTex; this.blurMat.needsUpdate = true;
    }
  }
  // draw the current video frame into buffer `slot` (not shown yet)
  grab(video, slot) {
    const vw = video.videoWidth, vh = video.videoHeight;
    this.ensureFrames(vw, vh);
    const f = this.frames[slot];
    f.ctx.drawImage(video, 0, 0, vw, vh);
    return f.canvas;
  }
  // show buffer `slot` (the frame whose pose has just been found)
  show(slot) {
    const f = this.frames[slot];
    if (!f || !f.tex) return;
    f.tex.needsUpdate = true;
    if (this.bgMat.map !== f.tex) { this.bgMat.map = f.tex; this.bgMat.needsUpdate = true; }
    this.showSlot = slot;
    if (this.bgBlur.visible && (this._blurN = (this._blurN || 0) + 1) % 3 === 0) {
      this.blurCtx.drawImage(f.canvas, 0, 0, this.blurCanvas.width, this.blurCanvas.height);
      this.blurTex.needsUpdate = true;
    }
  }

  resize() {
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2) * this.pixK);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.canvas.clientWidth || innerWidth, this.canvas.clientHeight || innerHeight, false);
    if (this.mode === 'ar' && this.K) this.setProjection(this.K, this.view.vw, this.view.vh, this.viewMode, this.zoomOut);
    else this.previewCamera();
  }

  // AR projection from the camera's intrinsics K (video px). mode 'fill' crops the picture to fill the screen,
  // 'fit' shows all of it; zoomOut < 1 shrinks the picture on screen (the soft copy fills the rest).
  setProjection(K, vw, vh, mode = 'fill', zoomOut = 1) {
    Object.assign(this, { K, viewMode: mode, zoomOut });
    const W = this.canvas.width, H = this.canvas.height;
    if (!vw || !vh || !W || !H) return;
    const sFill = Math.max(W / vw, H / vh), sFit = Math.min(W / vw, H / vh);
    const s = (mode === 'fit' ? sFit : sFill) * zoomOut;
    const ox = (vw - W / s) / 2, oy = (vh - H / s) / 2;
    Object.assign(this.view, { W, H, vw, vh, s, ox, oy, mode });
    const fx = K.fx * s, fy = K.fy * s, cx = (K.cx - ox) * s, cy = (K.cy - oy) * s, n = 5, f = 20000;
    const P = this.camera.projectionMatrix;
    P.set(2 * fx / W, 0, 1 - 2 * cx / W, 0, 0, 2 * fy / H, 2 * cy / H - 1, 0, 0, 0, -(f + n) / (f - n), -2 * f * n / (f - n), 0, 0, -1, 0);
    this.camera.projectionMatrixInverse.copy(P).invert();
    this.camera.matrix.identity(); this.camera.matrixWorld.identity(); this.camera.matrixWorldInverse.identity();
    this.bgMesh.scale.set(vw * s / W, vh * s / H, 1);
    this.bgBlur.visible = vw * s < W - 2 || vh * s < H - 2;
    this.bgBlur.scale.set(vw * sFill / W * 1.06, vh * sFill / H * 1.06, 1);
  }

  // ---------------- poses ----------------
  // st: { q: [x,y,z,w], t: [x,y,z] } in OpenCV camera coordinates, or null
  setPose(key, st) {
    const a = this.anchors[key];
    if (!st || !st.q) { a.visible = false; return; }
    this._tmpQ.set(st.q[0], st.q[1], st.q[2], st.q[3]);
    this._tmpM.makeRotationFromQuaternion(this._tmpQ).setPosition(st.t[0], st.t[1], st.t[2]);
    a.matrix.multiplyMatrices(CV2GL, this._tmpM);
    a.matrixWorldNeedsUpdate = true;
    a.visible = true;
  }
  setTarget(key) {
    if (key === this.target) return;
    this.target = key;
    for (const [k, a] of Object.entries(this.anchors)) if (k !== key) a.visible = false;
    if (key) { if (key === 'card') { this.place.Q.identity(); this.place.from.identity(); this.place.to.identity(); this.place.dur = 0; } this.layoutHolder(); }
  }
  // base face: the holder's up = face normal N (cube frame)
  setBase(N, animate) {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(N[0], N[1], N[2]));
    const p = this.place;
    if (!animate) { p.Q.copy(q); p.from.copy(q); p.to.copy(q); p.dur = 0; return; }
    // roll along the shortest way from the current face
    const roll = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0).applyQuaternion(p.to), new THREE.Vector3(N[0], N[1], N[2]));
    p.from.copy(p.Q); p.to.premultiply(roll); p.t0 = now(); p.dur = 0.45;
  }
  // camera position in the holder frame (mm)
  cameraInHolder() {
    this.syncHolder();
    this.holder.updateWorldMatrix(true, true);
    return new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld).applyMatrix4(this._tmpM.copy(this.holder.matrixWorld).invert());
  }
  faceCamera(animate) {
    if (!this.target) return;
    const c = this.cameraInHolder();
    this.setYaw(Math.atan2(c.x, c.z), animate);
  }
  setYaw(y, animate) {
    const p = this.place;
    let d = y - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    p.yawFrom = p.yaw; p.yawTo = p.yaw + d; p.yt0 = animate ? now() : -10;
  }
  turnBy(a, animate = true) { const p = this.place; this.setYaw(p.yawTo + a, animate); }
  nudgeYaw(a) { const p = this.place; p.yaw += a; p.yawTo = p.yaw; p.yawFrom = p.yaw; p.yt0 = -10; }

  // ---------------- light matched to the room ----------------
  setLight(rgb) {
    if (!rgb) return;
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]);
    const k = clamp(lum / 125, 0.5, 1.25);
    this.lightK += 0.1 * (k - this.lightK);
    const m = Math.max(rgb[0], rgb[1], rgb[2], 1);
    const tint = new THREE.Color(0.65 + 0.35 * rgb[0] / m, 0.65 + 0.35 * rgb[1] / m, 0.65 + 0.35 * rgb[2] / m);
    this.tint.lerp(tint, 0.1);
  }

  // ---------------- per frame ----------------
  // place the holder on the base face of the pedestal (used before reading its world matrix)
  syncHolder() {
    const p = this.place, S = this.S;
    this.holder.quaternion.copy(p.Q);
    const top = this.target === 'card' ? 0.3 : this.hand ? 0 : (this.opts.plinth !== 'none' ? this.E / 2 + this.cap : S / 2 + 0.2);
    this.holder.position.set(0, top, 0).applyQuaternion(p.Q);
    this.yawGroup.rotation.y = p.yaw;
  }
  update(t) {
    const p = this.place;
    if (p.dur > 0) {
      const k = ease((t - p.t0) / p.dur);
      p.Q.slerpQuaternions(p.from, p.to, k);
      if (k >= 1) { p.from.copy(p.to); p.dur = 0; }
    } else p.Q.copy(p.to);
    if (p.yt0 > 0) {
      const ky = ease((t - p.yt0) / 0.55);
      p.yaw = p.yawFrom + (p.yawTo - p.yawFrom) * ky;
      if (ky >= 1) p.yt0 = -10;
    }
    if (p.spin) { p.yaw += p.spin * (t - (this._lastT || t)); p.yawTo = p.yaw; }
    this._lastT = t;
    this.syncHolder();
    // the name plate moves to the side that faces the camera: it sinks into the stone and comes out on the other side
    if (this.plateGroup.visible && (this.target || this.mode === 'preview')) {
      const c = this.cameraInHolder();
      const a = Math.atan2(c.x, c.z);
      let off = a - this.plateYaw; off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) > Math.PI / 4 + 0.18 && this.plateFade === 1) this.plateFadeDir = -1;   // clearly on another side
      const dt = Math.min(0.1, t - (this._plT || t)); this._plT = t;
      if (this.plateFadeDir) {
        this.plateFade = clamp(this.plateFade + this.plateFadeDir * dt * 5, 0, 1);
        if (this.plateFade === 0) { this.plateYaw = Math.round(a / (Math.PI / 2)) * (Math.PI / 2); this.plateFadeDir = 1; }
        else if (this.plateFade === 1) this.plateFadeDir = 0;
      }
      this.plateGroup.rotation.y = this.plateYaw;
      this.plate.scale.set(1, 1, 1).multiplyScalar(0.001 + 0.999 * ease(this.plateFade));
    }
    this.stepReveal(t);
    // light: from above the exhibit, a little from the camera's side and from the left
    this.holder.updateWorldMatrix(true, true);
    const hp = this._v.setFromMatrixPosition(this.holder.matrixWorld);
    const up = this._v2.set(0, 1, 0).transformDirection(this.holder.matrixWorld);
    const toCam = hp.clone().negate().normalize();
    this.sun.position.copy(hp).addScaledVector(up, 520).addScaledVector(toCam, 240).add(new THREE.Vector3(-170, 0, 0));
    this.sun.target.position.copy(hp); this.sun.target.updateMatrixWorld();
    const k = this.mode === 'ar' ? this.lightK : 1;
    this.sun.intensity = 2.3 * k; this.hemi.intensity = 0.5 * k; this.scene.environmentIntensity = this.envBase * (0.6 + 0.4 * k);
    this.sun.color.setRGB(1, 0.953, 0.878).multiply(this.tint); this.hemi.color.setRGB(1, 0.965, 0.918).multiply(this.tint);
  }

  render(t = now()) {
    if (this.mode === 'preview') this.previewStep(t);
    this.update(t);
    const r = this.renderer;
    r.clear();
    if (this.mode === 'ar' && this.bgMat.map) r.render(this.bgScene, this.bgCam);
    r.render(this.scene, this.camera);
  }

  // ---------------- start-screen turntable ----------------
  previewCamera() {
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    const cam = this.camera, aspect = W / H;
    cam.fov = 30; cam.aspect = aspect; cam.near = 5; cam.far = 20000;
    cam.updateProjectionMatrix();
    // frame the pedestal + exhibit in the upper part of the screen
    const tan = Math.tan(cam.fov * Math.PI / 360);
    const tall = (this.mH || 70) + this.E + this.cap, wide = Math.max(this.capW, this.mF || 0) * 1.35;
    const dist = Math.max(tall / (this.previewFill * 2 * tan), wide / (0.8 * aspect * 2 * tan));
    const off = this.previewOffset || 0;          // screen-space shift (fraction of height) to sit above the text
    cam.matrix.lookAt(new THREE.Vector3(0, dist * 0.42, dist), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    cam.matrix.setPosition(0, dist * 0.42, dist);
    cam.matrixWorld.copy(cam.matrix); cam.matrixWorldInverse.copy(cam.matrix).invert();
    // shift the picture up by `off` of the screen height (lens shift keeps the perspective natural)
    cam.projectionMatrix.elements[9] = -off * 2;
    cam.projectionMatrix.elements[8] = (this.previewOffsetX || 0) * 2;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.previewDist = dist;
  }
  startPreview(offset = 0.18, fill = 0.5, offX = 0) {
    this.mode = 'preview'; this.previewOffset = offset; this.previewFill = fill; this.previewOffsetX = offX;
    this.setTarget('cube');
    this.setBase([0, 1, 0], false);
    this.anchors.cube.visible = true;
    this.resize();
  }
  // the pedestal stands still, turned a little, and the exhibit turns slowly on it
  previewStep(t) {
    const a = this.anchors.cube;
    const h = (this.mH || 60);
    this._tmpM.makeRotationY(0.62).setPosition(0, -(h + this.cap) / 2, 0);
    a.matrix.copy(this._tmpM); a.matrixWorldNeedsUpdate = true; a.visible = true;
    if (this.previewDist === undefined || Math.abs((this._pvH || 0) - h) > 1) { this._pvH = h; this.previewCamera(); }
    const p = this.place;
    p.yaw = (this.model ? (this.exhibit.yaw || 0) * Math.PI / 180 : 0) - 0.62 + Math.sin((t - this.preview.t0) * 0.45) * 0.9 + this.preview.drag;
    p.yawTo = p.yaw; p.yt0 = -10;
  }
  startAR() {
    this.mode = 'ar';
    this.target = null;
    for (const a of Object.values(this.anchors)) a.visible = false;
    this.place.yaw = this.place.yawTo = 0; this.place.yt0 = -10;
    this.reveal.k = 0; this.reveal.t0 = -10;
    this.clip.set(new THREE.Vector3(0, -1, 0), -1e6);     // hidden until the cube is found
  }

  // ---------------- tapping the exhibit ----------------
  hitExhibit(clientX, clientY) {
    if (!this.model || !this.target) return false;
    const rect = this.canvas.getBoundingClientRect();
    const nd = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(nd, this.camera);
    this.scene.updateMatrixWorld(true);
    return this.raycaster.intersectObject(this.model, true).length > 0 || this.raycaster.intersectObject(this.plinth, false).length > 0;
  }

  // ---------------- photo ----------------
  // renders one frame and returns a 2D canvas copy of it
  snapshot() {
    this.render();
    const c = this._snap || (this._snap = document.createElement('canvas'));     // reused: iPhone limits canvas memory
    c.width = this.canvas.width; c.height = this.canvas.height;
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    return c;
  }
}

// ---------------- helpers ----------------
function prepareModel(obj, clip) {
  const wrap = new THREE.Group();
  obj.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.map) m.map.anisotropy = 4;
      m.clippingPlanes = [clip];
      m.shadowSide = THREE.DoubleSide;
    }
  });
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  wrap.add(obj);
  const foot = Math.max(size.x, size.z);
  wrap.userData = { foot, height: size.y, unit: 1 / Math.max(foot, 1e-6) };
  return wrap;
}
function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    const mats = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
    for (const m of mats) { for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[k]) m[k].dispose(); m.dispose(); }
  });
}

// a box with softly rounded edges: a rounded square extruded with a rounded bevel (centred, Y up)
function roundedBlock(w, h, d, r) {
  const rr = Math.min(r, w / 2 - 0.01, d / 2 - 0.01, h / 2 - 0.01);
  const shape = new THREE.Shape();
  const hw = w / 2 - rr, hd = d / 2 - rr, cr = rr * 0.6;   // corner radius of the outline
  shape.moveTo(-hw + cr, -hd);
  shape.lineTo(hw - cr, -hd); shape.quadraticCurveTo(hw, -hd, hw, -hd + cr);
  shape.lineTo(hw, hd - cr); shape.quadraticCurveTo(hw, hd, hw - cr, hd);
  shape.lineTo(-hw + cr, hd); shape.quadraticCurveTo(-hw, hd, -hw, hd - cr);
  shape.lineTo(-hw, -hd + cr); shape.quadraticCurveTo(-hw, -hd, -hw + cr, -hd);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, h - 2 * rr), bevelEnabled: true, bevelThickness: rr, bevelSize: rr, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -(h - 2 * rr) / 2);
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  // UVs over the block's own size, so textures are not stretched
  const pos = g.attributes.position, uv = g.attributes.uv, nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i));
    if (ay > 0.7) uv.setXY(i, px / 80 + 0.5, pz / 80 + 0.5); else if (ax > 0.7) uv.setXY(i, pz / 80 + 0.5, py / 80 + 0.5); else uv.setXY(i, px / 80 + 0.5, py / 80 + 0.5);
  }
  return g;
}

function canvasTex(size, draw, repeat = false) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function noise(g, n, base, vary, specks) {
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = (Math.random() - 0.5) * vary, sp = specks && Math.random() < specks ? -vary * 1.6 : 0;
    img.data[i * 4] = base[0] + v + sp; img.data[i * 4 + 1] = base[1] + v + sp; img.data[i * 4 + 2] = base[2] + v + sp; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.5; g.drawImage(g.canvas, 1, 0); g.drawImage(g.canvas, 0, 1); g.globalAlpha = 1;
}
// limestone of the Prokletije: warm grey, fine grain, a few fossil specks and faint bedding lines
function stoneTexture() {
  return canvasTex(512, (g, n) => {
    noise(g, n, [205, 196, 181], 16, 0.006);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * n, y = Math.random() * n, r = 6 + Math.random() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const c = Math.random() < 0.6 ? '255,250,240' : '150,135,115';
      gr.addColorStop(0, `rgba(${c},0.06)`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    g.strokeStyle = 'rgba(140,125,105,0.10)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) { const y = Math.random() * n; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= n; x += 32) g.lineTo(x, y + Math.sin(x / 90 + i) * 5); g.stroke(); }
  }, true);
}
// white marble with soft grey veins (each vein drawn blurred, then a sharp thread over it)
function marbleTexture() {
  return canvasTex(512, (g, n) => {
    noise(g, n, [234, 231, 225], 6, 0);
    const canBlur = (() => { g.filter = 'blur(1px)'; const ok = g.filter === 'blur(1px)'; g.filter = 'none'; return ok; })();   // not in older Safari
    const vein = (blur, width, alpha, col) => {
      if (blur && !canBlur) { width = Math.max(1.5, width / 4); alpha *= 0.8; blur = 0; }
      g.save(); g.filter = blur ? `blur(${blur}px)` : 'none';
      let x = Math.random() * n, y = -10, a = Math.PI / 2 + (Math.random() - 0.5) * 1.1;
      g.strokeStyle = `rgba(${col},${alpha})`; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(x, y);
      while (y < n + 10) { a += (Math.random() - 0.5) * 0.35; a = Math.max(0.5, Math.min(Math.PI - 0.5, a)); x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); }
      g.stroke(); g.restore();
    };
    for (let i = 0; i < 5; i++) vein(6, 14 + Math.random() * 14, 0.10, '140,135,128');
    for (let i = 0; i < 6; i++) vein(1.5, 2 + Math.random() * 2, 0.11, '120,114,106');
    for (let i = 0; i < 3; i++) vein(0, 0.8, 0.14, '150,128,90');
  }, true);
}
function woodTexture() {
  return canvasTex(512, (g, n) => {
    g.fillStyle = '#5a3a22'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 160; i++) {
      const y = Math.random() * n, l = 30 + Math.random() * 40;
      g.strokeStyle = `hsla(${22 + Math.random() * 10},${40 + Math.random() * 20}%,${l * 0.5}%,${0.12 + Math.random() * 0.2})`;
      g.lineWidth = 0.5 + Math.random() * 2.5; g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= n; x += 16) g.lineTo(x, y + Math.sin(x / 70 + i) * 4 + Math.sin(x / 13 + i * 3) * 0.8);
      g.stroke();
    }
  }, true);
}
function glassTexture() {
  return canvasTex(256, (g, n) => {
    g.fillStyle = 'rgba(255,255,255,0.32)'; g.fillRect(0, 0, n, n);
    const streak = (x, w, a) => {
      const gr = g.createLinearGradient(x - w, 0, x + w, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.save(); g.translate(n / 2, n / 2); g.rotate(-0.5); g.translate(-n / 2, -n / 2); g.fillStyle = gr; g.fillRect(x - w, -n, 2 * w, 3 * n); g.restore();
    };
    streak(n * 0.32, n * 0.09, 1); streak(n * 0.5, n * 0.025, 0.85); streak(n * 0.78, n * 0.05, 0.6);
  });
}
function blobTexture() {
  return canvasTex(128, (g, n) => {
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  });
}
function ringTexture() {
  return canvasTex(256, (g, n) => {
    const gr = g.createRadialGradient(n / 2, n / 2, n * 0.28, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.15)'); gr.addColorStop(0.78, 'rgba(255,255,255,1)'); gr.addColorStop(0.86, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  });
}
function beamTexture() {
  return canvasTex(64, (g, n) => {
    const gr = g.createLinearGradient(0, 0, 0, n);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  });
}
function dotTexture() {
  return canvasTex(64, (g, n) => {
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  });
}
