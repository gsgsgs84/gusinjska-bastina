// Planinarske staze – 3D relief of the Gusinje area with hiking trails: touch viewer, "on the table" AR (WebXR / Quick Look).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STR, detectLang, L, HTML_LANG, NUM_LOCALE } from './i18n.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
let lang = store.get('gkb.lang', null) || detectLang();
if (!STR[lang]) lang = 'me';
const t = k => STR[lang][k] ?? STR.me[k] ?? k;
const tx = o => L(o, lang);
const num = (v, d = 0, group = true) => Number(v).toLocaleString(NUM_LOCALE[lang] || 'en', { maximumFractionDigits: d, minimumFractionDigits: d, useGrouping: group });
const m0 = v => num(Math.round(v), 0, false);     // heights: 2534, not 2.534

const EXAGS = [1, 1.5, 2];
const SIZES = [0.3, 0.45, 0.6, 0.8, 1.0, 1.5];       // table model width in metres
const R_TRAIL = 0.0021, R_SEL = 0.0036, R_PICK = 0.011;

const S = { data: null, exag: store.get('gkb.staze.exag', 1.5), labels: store.get('gkb.staze.labels', true), sel: null,
  walk: null, trails: new Map(), places: [], sizeIdx: 2, xr: null };

// ---------------- three.js scene ----------------
const stage = $('#stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch { $('#loading').textContent = t('s_error'); }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.xr.enabled = true;
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const sun = new THREE.DirectionalLight(0xfff4e6, 1.7); sun.position.set(-1, 1.6, -0.9);      // from the north-west, like the painted shading
scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x6b5a45, 0.75));
const camera = new THREE.PerspectiveCamera(35, 1, 0.005, 20);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: Math.PI * 0.47, minDistance: 0.12, maxDistance: 2.6,
  screenSpacePanning: false, rotateSpeed: 0.75, panSpeed: 0.9 });
controls.addEventListener('start', () => { $('#hint').style.opacity = '0'; });

const holder = new THREE.Group();          // whole model; scaled to table size in AR
const terrainWrap = new THREE.Group();      // vertical exaggeration
const trailGroup = new THREE.Group(), pickGroup = new THREE.Group(), pinGroup = new THREE.Group();
holder.add(terrainWrap, trailGroup, pickGroup, pinGroup);
scene.add(holder);
const hiker = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 20, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff7a00, emissiveIntensity: 0.9, roughness: 0.4 }));
hiker.visible = false; holder.add(hiker);
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.085, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

// soft shadow under the block
{
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.38)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sh.position.y = 0.0004; sh.renderOrder = -1; holder.add(sh);
}

function resize() {
  if (renderer.xr.isPresenting) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---------------- boot ----------------
init();
async function init() {
  for (const b of document.querySelectorAll('.lang button')) b.addEventListener('click', () => setLang(b.dataset.lang));
  $('#loading').textContent = t('s_loading');
  paintText();
  try {
    S.data = await (await fetch('data/staze.json')).json();
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(S.data.model);
    gltf.scene.traverse(o => { if (o.isMesh && o.material.map) { o.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy(); } });
    terrainWrap.add(gltf.scene);
  } catch (e) {
    console.error(e);
    $('#loading').textContent = t('s_error');
    return;
  }
  $('#loading').remove();
  buildTrails(); buildPlaces(); renderLists(); paintText();
  resetView(true);
  const pre = decodeURIComponent(location.hash.slice(1));
  if (S.trails.has(pre)) select(pre, false);
  renderer.setAnimationLoop(frame);
  wireUI();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

function setLang(l) {
  lang = l; store.set('gkb.lang', l);
  paintText();
  if (S.data) { buildPlaces(); renderLists(); if (S.sel) renderCard(); }
}
function paintText() {
  document.documentElement.lang = HTML_LANG[lang] || 'sr-ME';
  for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  document.title = `${t('s_title')} – Gusinjska kulturna baština`;
  $('#back').setAttribute('aria-label', t('back'));
  $('#title').textContent = t('s_title');
  $('#lead').textContent = t('s_lead');
  $('#hint').textContent = t('s_hint');
  $('#btnTable').textContent = t('s_table');
  $('#btnHeight').innerHTML = `${esc(t('s_height'))} <small>×${num(S.exag, S.exag % 1 ? 1 : 0)}</small>`;
  $('#btnLabels').textContent = t('s_labels');
  $('#btnLabels').setAttribute('aria-pressed', String(S.labels));
  $('#btnReset').textContent = t('s_reset');
  $('#legendH').textContent = t('s_legend');
  $('#note').textContent = t('s_note');
  $('#creditsH').textContent = t('s_credits');
  $('#northTxt').textContent = t('s_north');
  $('#xrClose').textContent = t('close');
  $('#xrMove').textContent = t('s_move');
  if (!S.data) return;
  const styles = S.data.styles, colors = S.data.colors;
  $('#legend').innerHTML = Object.keys(styles).map(k => `<li><span class="line" style="background:${colors[k]}"></span>${esc(tx(styles[k]))}</li>`).join('') +
    `<li><span class="line border-line"></span>${esc(lang === 'en' ? 'State border' : lang === 'sq' ? 'Kufiri shtetëror' : 'Državna granica')}</li>`;
  $('#credits').innerHTML = S.data.credits.map(c => `<li>${esc(c)}</li>`).join('');
}

// ---------------- geometry ----------------
function tube(segs, radius, radial, lift) {
  const pos = [], nrm = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0), tng = new THREE.Vector3(), side = new THREE.Vector3(), nup = new THREE.Vector3(), off = new THREE.Vector3();
  for (const s of segs) {
    const n = s.length / 3;
    if (n < 2) continue;
    const base = pos.length / 3;
    const P = k => new THREE.Vector3(s[3 * k], s[3 * k + 1] * S.exag + lift, s[3 * k + 2]);
    for (let k = 0; k < n; k++) {
      const a = P(Math.max(0, k - 1)), b = P(Math.min(n - 1, k + 1)), p = P(k);
      tng.subVectors(b, a).normalize();
      side.crossVectors(tng, up); if (side.lengthSq() < 1e-8) side.set(1, 0, 0); side.normalize();
      nup.crossVectors(side, tng).normalize();
      for (let r = 0; r < radial; r++) {
        const ang = (r / radial) * Math.PI * 2;
        off.copy(side).multiplyScalar(Math.cos(ang)).addScaledVector(nup, Math.sin(ang));
        pos.push(p.x + off.x * radius, p.y + off.y * radius, p.z + off.z * radius);
        nrm.push(off.x, off.y, off.z);
      }
      if (k < n - 1) for (let r = 0; r < radial; r++) {
        const a0 = base + k * radial + r, a1 = base + k * radial + (r + 1) % radial, b0 = a0 + radial, b1 = a1 + radial;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

function buildTrails() {
  for (const o of [...trailGroup.children, ...pickGroup.children]) o.geometry.dispose();
  trailGroup.clear(); pickGroup.clear();
  for (const tr of S.data.trails) {
    const isSel = S.sel === tr.id;
    const r = isSel ? R_SEL : R_TRAIL;
    const mat = new THREE.MeshStandardMaterial({ color: tr.color, roughness: 0.55, emissive: tr.color, emissiveIntensity: isSel ? 0.35 : 0.12,
      transparent: true, opacity: S.sel && !isSel ? 0.45 : 1 });
    const mesh = new THREE.Mesh(tube(tr.segs, r, isSel ? 8 : 6, r * 0.55), mat);
    mesh.renderOrder = isSel ? 3 : 1;
    const pick = new THREE.Mesh(tube(tr.segs, R_PICK, 5, 0.002), new THREE.MeshBasicMaterial({ visible: false }));
    pick.userData.id = mesh.userData.id = tr.id;
    trailGroup.add(mesh); pickGroup.add(pick);
    S.trails.set(tr.id, { tr, mesh, pick });
  }
}

// labels: sprites with a constant on-screen size, culled when they overlap
function labelTexture(p) {
  const peak = p.kind === 'peak' || p.kind === 'pass';
  const name = tx(p.name), ele = p.ele ? ` ${m0(p.ele)}` : '';
  const big = p.kind === 'town';
  const c = document.createElement('canvas'), g = c.getContext('2d');
  const fs = big ? 40 : 32, pad = 14;
  const font = `${big ? 750 : p.kind === 'valley' ? 600 : 650} ${p.kind === 'valley' ? 'italic ' : ''}${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.font = font;
  const prefix = peak ? '▲ ' : p.kind === 'sight' ? '◆ ' : '';
  const text = prefix + name + ele;
  const w = Math.ceil(g.measureText(text).width) + pad * 2, h = fs + 18;
  c.width = w; c.height = h;
  g.font = font;
  g.fillStyle = p.kind === 'valley' ? 'rgba(255,255,255,0.55)' : 'rgba(255,252,246,0.92)';
  const r = h / 2;
  g.beginPath(); g.moveTo(r, 0); g.lineTo(w - r, 0); g.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(r, h); g.arc(r, r, r, Math.PI / 2, Math.PI * 1.5); g.fill();
  g.fillStyle = p.kind === 'sight' ? '#1f5f8b' : peak ? '#5a3a1a' : p.kind === 'valley' ? '#2c3b33' : '#221e19';
  g.textBaseline = 'middle';
  g.fillText(text, pad, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return { tex, aspect: w / h, px: big ? 26 : p.kind === 'valley' ? 21 : 20 };
}
function buildPlaces() {
  for (const o of pinGroup.children) { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }
  pinGroup.clear(); S.places = [];
  for (const p of S.data.places) {
    const [x, y, z] = p.pos;
    const ys = y * S.exag, top = ys + (p.kind === 'town' ? 0.03 : p.kind === 'valley' ? 0.012 : 0.022);
    const { tex, aspect, px } = labelTexture(p);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, transparent: true }));
    spr.center.set(0.5, 0); spr.position.set(x, top, z); spr.renderOrder = 10;
    spr.userData = { aspect, px, rank: p.rank || 3, id: p.id };
    pinGroup.add(spr);
    if (p.kind !== 'valley') {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, ys, z), new THREE.Vector3(x, top, z)]),
        new THREE.LineBasicMaterial({ color: 0x2a2520, transparent: true, opacity: 0.7 }));
      line.userData.pinOf = spr; pinGroup.add(line);
    }
    S.places.push(spr);
  }
  pinGroup.visible = S.labels;
}
const v3 = new THREE.Vector3();
function layoutLabels(cam, viewH, viewW) {
  if (!S.labels) return;
  const k = 2 / (viewH * cam.projectionMatrix.elements[5]);
  const placed = [];
  const order = [...S.places].sort((a, b) => a.userData.rank - b.userData.rank);
  for (const s of order) {
    const hPx = s.userData.px * (S.xr ? 1.15 : 1);
    s.scale.set(hPx * s.userData.aspect * k, hPx * k, 1);
    s.getWorldPosition(v3).project(cam);
    let ok = v3.z < 1 && v3.z > -1;
    if (ok) {
      const cx = (v3.x + 1) / 2 * viewW, by = (1 - v3.y) / 2 * viewH, w = hPx * s.userData.aspect, h = hPx;
      const r = [cx - w / 2 - 3, by - h - 3, cx + w / 2 + 3, by + 3];
      ok = r[0] > 0 && r[2] < viewW && r[1] > 0 && r[3] < viewH && !placed.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
      if (ok) placed.push(r);
    }
    s.visible = ok;
  }
  for (const o of pinGroup.children) if (o.userData.pinOf) o.visible = o.userData.pinOf.visible;
}

// ---------------- selection, card, profile ----------------
function select(id, focus = true) {
  if (S.sel === id) id = null;
  S.sel = id; stopWalk();
  buildTrails();
  for (const b of document.querySelectorAll('.trails button')) b.setAttribute('aria-pressed', String(b.dataset.id === id));
  history.replaceState(null, '', id ? '#' + encodeURIComponent(id) : location.pathname + location.search);
  renderCard();
  updateXRTrail();
  if (id && focus && !S.xr) focusTrail(id);
}
function trailPoints(tr) {       // all points; `gap` marks the first point of each further segment
  const pts = [];
  for (const s of tr.segs) for (let k = 0; k < s.length; k += 3) pts.push([s[k], s[k + 1], s[k + 2], k === 0 && pts.length > 0]);
  return pts;
}
function profile(tr) {             // [km along the trail, elevation m]; jumps between segments are not counted
  const W = S.data.widthM, pts = trailPoints(tr);
  let d = 0; const out = [];
  pts.forEach((p, i) => {
    if (i && !p[3]) d += Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]) * W;
    out.push([d / 1000, p[1] * W + S.data.base]);
  });
  return out;
}
function renderCard() {
  const card = $('#card');
  if (!S.sel) { card.hidden = true; card.innerHTML = ''; return; }
  const tr = S.trails.get(S.sel).tr;
  const style = tx(S.data.styles[tr.style]);
  const mapNote = Math.abs(tr.mapKm - tr.km) / tr.km > 0.15 ? ` <small>(${num(tr.mapKm, 1)} ${esc(t('s_onMap'))})</small>` : '';
  card.hidden = false;
  card.innerHTML = `
    <h2><span class="dot" style="background:${tr.color}"></span><span>${esc(tx(tr.name))}</span></h2>
    <p class="from">${esc(t('s_start'))}: ${esc(tx(tr.from))}</p>
    <dl>
      <div><dt>${esc(t('s_length'))}</dt><dd>${num(tr.km, tr.km < 20 ? 1 : 0)} km${mapNote}</dd></div>
      <div><dt>${esc(t('s_climb'))}</dt><dd>${m0(tr.up)} m</dd></div>
      <div><dt>${esc(t('s_time'))}</dt><dd>${esc(lang === 'me' ? tr.time : tr.time.replace('dana', lang === 'sq' ? 'ditë' : 'days'))}</dd></div>
      <div><dt>&nbsp;</dt><dd><span class="chip" style="background:${tr.color}">${esc(style)}</span></dd></div>
    </dl>
    ${tr.note ? `<p>${esc(tx(tr.note))}</p>` : ''}
    ${tr.style !== 'long' ? `<canvas id="prof" aria-label="${esc(t('s_profile'))}"></canvas>` : ''}
    <div class="row">
      ${tr.style !== 'long' ? `<button class="btn" id="btnWalk">${esc(t('s_walk'))}</button>` : ''}
      <span class="src">${esc(t('s_source'))}: <a href="${esc(tr.url)}" target="_blank" rel="noopener">${esc(tr.source)}</a></span>
    </div>`;
  $('#btnWalk')?.addEventListener('click', () => S.walk ? stopWalk() : startWalk());
  drawProfile();
}
function drawProfile(cursorKm = null) {
  const c = $('#prof'); if (!c || !S.sel) return;
  const tr = S.trails.get(S.sel).tr, pr = profile(tr);
  const dpr = Math.min(devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--muted') || '#6e655a';
  const maxD = pr[pr.length - 1][0] || 1, eles = pr.map(p => p[1]);
  let lo = Math.min(...eles), hi = Math.max(...eles); const pad = Math.max(40, (hi - lo) * 0.12); lo -= pad; hi += pad;
  const X = d => 46 + (d / maxD) * (w - 50), Y = e => 6 + (1 - (e - lo) / (hi - lo)) * (h - 22);
  g.beginPath(); g.moveTo(X(0), h - 16);
  for (const [d, e] of pr) g.lineTo(X(d), Y(e));
  g.lineTo(X(maxD), h - 16); g.closePath();
  g.fillStyle = tr.color + '33'; g.fill();
  g.beginPath(); pr.forEach(([d, e], i) => i ? g.lineTo(X(d), Y(e)) : g.moveTo(X(d), Y(e)));
  g.strokeStyle = tr.color; g.lineWidth = 2; g.stroke();
  g.fillStyle = ink; g.font = '11px system-ui, sans-serif';
  const mx = Math.max(...eles), mn = Math.min(...eles);
  g.fillText(`${m0(mx)} m`, 0, Y(mx) + 4); g.fillText(`${m0(mn)} m`, 0, Y(mn) + 4);
  g.textAlign = 'right'; g.fillText(`${num(maxD, 1)} km`, w, h - 3);
  if (cursorKm != null) {
    let k = pr.findIndex(p => p[0] >= cursorKm); if (k < 0) k = pr.length - 1;
    g.strokeStyle = '#ff7a00'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(pr[k][0]), 4); g.lineTo(X(pr[k][0]), h - 16); g.stroke();
    g.fillStyle = '#ff7a00'; g.beginPath(); g.arc(X(pr[k][0]), Y(pr[k][1]), 3.5, 0, Math.PI * 2); g.fill();
  }
}
function startWalk() {
  const tr = S.trails.get(S.sel).tr, pr = profile(tr), pts = trailPoints(tr);
  S.walk = { pts, pr, t0: performance.now(), dur: Math.min(30, Math.max(8, pr[pr.length - 1][0] * 2.2)) * 1000 };
  hiker.visible = true;
  const b = $('#btnWalk'); if (b) b.textContent = t('s_stop');
}
function stopWalk() {
  S.walk = null; hiker.visible = false;
  const b = $('#btnWalk'); if (b) b.textContent = t('s_walk');
  drawProfile();
}
function stepWalk(now) {
  const w = S.walk; if (!w) return;
  const f = ((now - w.t0) % w.dur) / w.dur, km = f * w.pr[w.pr.length - 1][0];
  let k = w.pr.findIndex(p => p[0] >= km); if (k < 1) k = 1;
  const a = w.pr[k - 1], b = w.pr[k], u = b[0] > a[0] ? (km - a[0]) / (b[0] - a[0]) : 0;
  const pa = w.pts[k - 1], pb = w.pts[k];
  hiker.position.set(pa[0] + (pb[0] - pa[0]) * u, (pa[1] + (pb[1] - pa[1]) * u) * S.exag + 0.007, pa[2] + (pb[2] - pa[2]) * u);
  if (!S.xr && (now | 0) % 3 === 0) drawProfile(km);
}

// ---------------- camera ----------------
const anim = { from: null, to: null, t0: 0, dur: 900 };
function flyTo(target, pos, instant = false) {
  if (instant) { controls.target.copy(target); camera.position.copy(pos); controls.update(); return; }
  anim.from = { t: controls.target.clone(), p: camera.position.clone() }; anim.to = { t: target, p: pos }; anim.t0 = performance.now();
}
function fitDistance(radius) {    // distance at which a sphere of this radius fits the narrower view angle
  const vf = THREE.MathUtils.degToRad(camera.fov / 2), hf = Math.atan(Math.tan(vf) * (camera.aspect || 1));
  return radius / Math.sin(Math.min(vf, hf));
}
function resetView(instant = false) {
  const dist = fitDistance(0.56) * 0.93;
  flyTo(new THREE.Vector3(0, 0.02, -0.03), new THREE.Vector3(0, dist * 0.8, dist * 0.6 - 0.03), instant);
}
function focusTrail(id) {
  const { mesh } = S.trails.get(id);
  const box = new THREE.Box3().setFromObject(mesh), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const r = Math.max(0.05, 0.5 * Math.hypot(size.x, size.z)) * 1.25;
  const dir = camera.position.clone().sub(controls.target).normalize();
  dir.y = Math.max(dir.y, 0.6); dir.normalize();
  flyTo(c, c.clone().addScaledVector(dir, Math.max(fitDistance(r), 0.22)));
}
function stepCamera(now) {
  if (!anim.to) return;
  const u = Math.min(1, (now - anim.t0) / anim.dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  controls.target.lerpVectors(anim.from.t, anim.to.t, e); camera.position.lerpVectors(anim.from.p, anim.to.p, e);
  if (u >= 1) anim.to = null;
}

// ---------------- picking ----------------
const ray = new THREE.Raycaster();
function pickTrail(origin, dir) {
  ray.set(origin, dir);
  const hits = ray.intersectObjects(pickGroup.children, false);
  return hits.length ? hits[0].object.userData.id : null;
}
let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || S.xr) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
  if (moved > 8 || dt > 500) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hits = ray.intersectObjects(pickGroup.children, false);
  if (hits.length) select(hits[0].object.userData.id);
  else if (S.sel) select(S.sel);   // tap on empty terrain clears the selection
});

// ---------------- lists ----------------
function renderLists() {
  const byGroup = S.data.groups.map(g => ({ g, items: S.data.trails.filter(x => x.group === g.id) })).filter(x => x.items.length);
  $('#groups').innerHTML = `<h2 class="sr">${esc(t('s_trails'))}</h2>` + byGroup.map(({ g, items }) => `
    <section class="group"><h3>${esc(tx(g.name))}</h3><ul class="trails">${items.map(tr => `
      <li><button data-id="${esc(tr.id)}" aria-pressed="${S.sel === tr.id}">
        <span class="dot" style="background:${tr.color}"></span>
        <span class="txt"><b>${esc(tx(tr.name))}</b><small>${num(tr.km, tr.km < 20 ? 1 : 0)} km · ↑ ${m0(tr.up)} m · ${esc(tx(S.data.styles[tr.style]))}</small></span>
      </button></li>`).join('')}</ul></section>`).join('');
  for (const b of document.querySelectorAll('.trails button')) b.addEventListener('click', () => {
    select(b.dataset.id);
    if (S.sel) stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function wireUI() {
  $('#btnHeight').addEventListener('click', () => {
    S.exag = EXAGS[(EXAGS.indexOf(S.exag) + 1) % EXAGS.length] || 1.5; store.set('gkb.staze.exag', S.exag);
    terrainWrap.scale.y = S.exag; buildTrails(); buildPlaces(); paintText();
  });
  $('#btnLabels').addEventListener('click', () => {
    S.labels = !S.labels; store.set('gkb.staze.labels', S.labels); pinGroup.visible = S.labels; paintText();
  });
  $('#btnReset').addEventListener('click', () => resetView());
  $('#btnTable').addEventListener('click', startAR);
  terrainWrap.scale.y = S.exag;
}

// ---------------- frame loop ----------------
function frame(now, xrFrame) {
  if (S.xr && xrFrame) xrStep(xrFrame);
  else { stepCamera(now); controls.update(); }
  stepWalk(now);
  const cam = renderer.xr.isPresenting ? (renderer.xr.getCamera().cameras[0] || renderer.xr.getCamera()) : camera;
  layoutLabels(cam, S.xr ? innerHeight : stage.clientHeight, S.xr ? innerWidth : stage.clientWidth);
  if (!S.xr) $('#north').style.transform = `rotate(${THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())}deg)`;
  renderer.render(scene, camera);
}

// ---------------- on the table: WebXR (Android) or Quick Look (iPhone) ----------------
let toastT;
function toast(m) { const el = $('#toast'); el.textContent = m; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3200); }
async function startAR() {
  let ok = false;
  try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { ok = false; }
  if (ok) return startWebXR();
  const a = document.createElement('a');
  if (a.relList && a.relList.supports && a.relList.supports('ar')) return quickLook();
  toast(t('s_noAR'));
}
function sizeLabel() {
  const m = SIZES[S.sizeIdx], scale = Math.round(S.data.widthM / m / 100) * 100;
  return `${num(m * 100)} cm · 1:${num(scale)}`;
}
function applySize() { holder.scale.setScalar(SIZES[S.sizeIdx]); $('#xrSize').textContent = sizeLabel(); }
function updateXRTrail() {
  const el = $('#xrTrail'); if (!el) return;
  const tr = S.sel && S.trails.get(S.sel).tr;
  el.innerHTML = tr ? `<span class="dot" style="background:${tr.color}"></span>${esc(tx(tr.name))}` : esc(t('s_noTrail'));
}
async function startWebXR() {
  const ov = $('#xrOverlay');
  const S0 = { pos: holder.position.clone(), rot: holder.rotation.y, scale: holder.scale.x };
  S.xr = { session: null, hit: null, placed: false, S0 };
  holder.visible = false; applySize(); updateXRTrail();
  ov.hidden = false; $('#xrMsg').textContent = t('s_xrFind');
  for (const el of ov.querySelectorAll('.xr-top, .xr-panel')) el.addEventListener('beforexrselect', ev => ev.preventDefault());
  $('#xrClose').onclick = () => S.xr?.session?.end();
  $('#xrSmaller').onclick = () => { S.sizeIdx = Math.max(0, S.sizeIdx - 1); applySize(); };
  $('#xrBigger').onclick = () => { S.sizeIdx = Math.min(SIZES.length - 1, S.sizeIdx + 1); applySize(); };
  $('#xrRotL').onclick = () => { holder.rotation.y += Math.PI / 6; };
  $('#xrRotR').onclick = () => { holder.rotation.y -= Math.PI / 6; };
  $('#xrMove').onclick = () => { S.xr.placed = false; holder.visible = false; $('#xrMsg').textContent = t('s_xrFind'); };
  const ids = S.data.trails.map(x => x.id);
  const step = d => { const i = S.sel ? ids.indexOf(S.sel) : (d > 0 ? -1 : 0); select(ids[(i + d + ids.length) % ids.length]); };
  $('#xrPrev').onclick = () => step(-1); $('#xrNext').onclick = () => step(1);
  try {
    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: ov } });
    S.xr.session = session;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
    S.xr.hit = await session.requestHitTestSource({ space: await session.requestReferenceSpace('viewer') });
    session.addEventListener('select', xrSelect);
    session.addEventListener('end', () => {
      const s0 = S.xr.S0; S.xr = null; ov.hidden = true; reticle.visible = false;
      holder.position.copy(s0.pos); holder.rotation.y = s0.rot; holder.scale.setScalar(s0.scale); holder.visible = true;
      resize();
    });
  } catch (e) {
    console.warn(e); ov.hidden = true; S.xr = null; holder.visible = true; holder.scale.setScalar(1); toast(t('s_noAR'));
  }
}
function xrStep(xrFrame) {
  const ref = renderer.xr.getReferenceSpace();
  if (S.xr.hit && !S.xr.placed) {
    const hits = xrFrame.getHitTestResults(S.xr.hit);
    if (hits.length) {
      reticle.visible = true; reticle.matrix.fromArray(hits[0].getPose(ref).transform.matrix);
      $('#xrMsg').textContent = t('s_xrTap');
    } else reticle.visible = false;
  } else reticle.visible = false;
}
const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), camP = new THREE.Vector3();
function xrSelect(e) {
  if (!S.xr) return;
  if (!S.xr.placed) {
    if (!reticle.visible) return;
    reticle.matrix.decompose(tmpP, tmpQ, tmpS);
    holder.position.copy(tmpP);
    renderer.xr.getCamera().getWorldPosition(camP);
    holder.rotation.set(0, Math.atan2(camP.x - tmpP.x, camP.z - tmpP.z), 0);     // south edge towards the visitor, north away
    holder.visible = true; S.xr.placed = true;
    $('#xrMsg').textContent = t('s_xrPlaced');
    return;
  }
  const pose = e.frame.getPose(e.inputSource.targetRaySpace, renderer.xr.getReferenceSpace());
  if (!pose) return;
  const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
  const o = new THREE.Vector3().setFromMatrixPosition(m), d = new THREE.Vector3(0, 0, -1).transformDirection(m);
  const id = pickTrail(o, d);
  if (id) select(id);
}
async function quickLook() {
  toast(t('preparing'));
  try {
    const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
    const g = new THREE.Group();
    const terr = terrainWrap.clone(true); g.add(terr);
    for (const { mesh } of S.trails.values()) {
      const m = new THREE.Mesh(mesh.geometry, new THREE.MeshStandardMaterial({ color: mesh.material.color, roughness: 0.55 }));
      g.add(m);
    }
    g.scale.setScalar(SIZES[S.sizeIdx]);
    const s = new THREE.Scene(); s.add(g); s.updateMatrixWorld(true);
    const buf = await new USDZExporter().parseAsync(s, { quickLookCompatible: true, maxTextureSize: 2048 });
    const url = URL.createObjectURL(new Blob([buf], { type: 'model/vnd.usdz+zip' }));
    const a = document.createElement('a'); a.rel = 'ar'; a.href = url; a.appendChild(document.createElement('img'));
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { console.warn(e); toast(t('s_noAR')); }
}

window.__staze = { S, scene, camera, controls, renderer, holder, select };
