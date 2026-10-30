// Planinarske staze – 3D relief of the Gusinje area with hiking trails: touch viewer and AR in front of you (WebXR, camera + motion sensors, Quick Look).
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
  if (renderer.xr.isPresenting || (S.xr && S.xr.kind !== 'webxr')) return;
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
  const qs = new URLSearchParams(location.search);
  if (qs.has('ar') && IS_ANDROID && !IS_CHROME) showChromeSheet();          // Android QR code opened outside Chrome
  else if (pre !== 'ar-pomoc' && !qs.has('pc') && (pre === 'ar' || qs.has('ar') || matchMedia('(pointer: coarse)').matches)) showCTA();
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
  $('#btnTable').textContent = t('s_ar');
  $('#ctaTxt').textContent = t('s_ar'); $('#ctaSub').textContent = t('s_ctaSub'); $('#ctaSkip').textContent = t('s_ctaSkip');
  $('#btnHeight').innerHTML = `${esc(t('s_height'))} <small>×${num(S.exag, S.exag % 1 ? 1 : 0)}</small>`;
  $('#btnLabels').textContent = t('s_labels');
  $('#btnLabels').setAttribute('aria-pressed', String(S.labels));
  $('#btnReset').textContent = t('s_reset');
  $('#legendH').textContent = t('s_legend');
  $('#note').textContent = t('s_note');
  $('#creditsH').textContent = t('s_credits');
  $('#northTxt').textContent = t('s_north');
  $('#xrClose').textContent = t('close');
  $('#xrFront').textContent = t('s_front'); $('#xrTable').textContent = t('s_toTable'); $('#xrQuick').textContent = t('s_moreAR');
  if (!S.data) return;
  const styles = S.data.styles, colors = S.data.colors;
  $('#legend').innerHTML = Object.keys(styles).map(k => `<li><span class="line" style="background:${colors[k]}"></span>${esc(tx(styles[k]))}</li>`).join('') +
    `<li><span class="line border-line"></span>${esc(lang === 'en' ? 'State border' : lang === 'sq' ? 'Kufiri shtetëror' : 'Državna granica')}</li>`;
  $('#credits').innerHTML = S.data.credits.map(c => `<li>${esc(c)}</li>`).join('') +
    `<li>${esc(t('s_engine'))} <a href="external/xr/LICENSE" target="_blank" rel="noopener">XR Engine License Agreement</a></li>`;
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
renderer.domElement.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), rot0: holder.rotation.y, moved: false };
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!down || !S.xr || S.xr.kind === 'webxr') return;     // camera AR: drag sideways to turn the terrain
  const dx = e.clientX - down.x;
  if (Math.abs(dx) > 8) down.moved = true;
  if (down.moved) holder.rotation.y = down.rot0 + dx / innerWidth * Math.PI * 1.5;
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || (S.xr && S.xr.kind === 'webxr')) { down = null; return; }
  const moved = down.moved || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8, dt = performance.now() - down.t; down = null;
  if (moved || dt > 500) return;
  if (S.xr && S.xr.kind === 'slam' && S.xr.mode === 'table') return slamPlace(e.clientX, e.clientY);
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), S.xr ? arCam : camera);
  const hits = ray.intersectObjects(pickGroup.children, false);
  if (hits.length) select(hits[0].object.userData.id);
  else if (S.sel && !S.xr) select(S.sel);   // tap on empty terrain clears the selection
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

function showCTA() { const c = $('#arCta'); if (c) c.hidden = false; }
function hideCTA() { const c = $('#arCta'); if (c) c.hidden = true; }
function wireUI() {
  $('#ctaStart').addEventListener('click', startAR);
  $('#arOpts').addEventListener('click', e => { const b = e.target.closest('[data-opt]'); if (b) helpChoice(b.dataset.opt); });
  $('#arHelpClose').addEventListener('click', hideHelp);
  $('#arHelp').addEventListener('click', e => { if (e.target.id === 'arHelp') hideHelp(); });
  if (location.hash === '#ar-pomoc') showHelp();
  $('#ctaSkip').addEventListener('click', hideCTA);
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
  const kind = S.xr && S.xr.kind;
  if (kind === 'webxr' && xrFrame) xrStep(xrFrame);
  else if (kind === 'cam') camStep();
  else if (kind === 'slam') slamStep();
  else if (!kind) { stepCamera(now); controls.update(); }
  stepWalk(now);
  const camLike = kind === 'cam' || kind === 'slam';
  const cam = renderer.xr.isPresenting ? (renderer.xr.getCamera().cameras[0] || renderer.xr.getCamera()) : camLike ? arCam : camera;
  layoutLabels(cam, kind ? innerHeight : stage.clientHeight, kind ? innerWidth : stage.clientWidth);
  if (!kind) $('#north').style.transform = `rotate(${THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())}deg)`;
  renderer.render(scene, camLike ? arCam : camera);
}

// ---------------- AR: the terrain appears in front of you ----------------
// 1. WebXR (Chrome on Android with Google Play Services for AR): world-tracked. The terrain floats in front of you at once;
//    "On a table" puts it down on a real surface. Drag across the screen to turn it, tap a trail to select it.
// 2. Camera + motion sensors (any phone, also iPhone): the camera picture is shown behind the 3D and the terrain stays
//    in front of you while you turn the phone (rotation only). iPhone also offers Quick Look (world-tracked, no names).
let toastT;
function toast(m) { const el = $('#toast'); el.textContent = m; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3600); }
const FRONT_SIZE = 1;                       // index into SIZES: 45 cm wide when floating in front of you
const arCam = new THREE.PerspectiveCamera(60, 1, 0.01, 50);
let shadowMesh = null;
holder.traverse(o => { if (o.isMesh && o.material?.map && o.renderOrder === -1) shadowMesh = o; });
const quickLookOK = (() => { const a = document.createElement('a'); return !!(a.relList && a.relList.supports && a.relList.supports('ar')); })();

const UA = navigator.userAgent;
const IS_ANDROID = /Android/i.test(UA);
const IS_IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IN_APP = IS_ANDROID && /; wv\)|FBAN|FBAV|Instagram|Line\/|MicroMessenger|Telegram|Snapchat|Twitter|GSA\//i.test(UA);
const IS_CHROME = /Chrome\/\d/.test(UA) && !/SamsungBrowser|EdgA|OPR\/|Firefox|YaBrowser|MiuiBrowser|UCBrowser|HuaweiBrowser|; wv\)|Version\/[\d.]+ Chrome/i.test(UA);
// Real AR (you can walk around it) in this order: WebXR in Chrome -> Google's AR viewer (Android) -> Quick Look (iPhone).
// Only if none works: a help sheet with the other ways (open in Chrome, install AR services, the printed cube/card, camera only).
function startAR() {
  hideCTA();
  const perms = motionPermissions();      // iPhone: must be asked inside the tap, before anything is awaited
  (async () => {
    let ok = false;
    try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { ok = false; }
    if (ok && await startWebXR()) return;
    await perms;
    if (await startSlamAR()) return;     // world tracking from the camera image: works without Google's AR services
    showHelp();
  })();
}
function motionPermissions() {
  const ask = [];
  for (const E of [typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent, typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent]) {
    if (E && typeof E.requestPermission === 'function') ask.push(E.requestPermission().catch(() => 'denied'));
  }
  return Promise.all(ask);
}
function arModelURL() { return new URL(S.data.arModel, location.href).href; }
function pageURL(hash = '') { return location.href.split('#')[0] + hash; }
function sceneViewer() {
  const q = `file=${encodeURIComponent(arModelURL())}&mode=ar_preferred&resizable=true` +
    `&title=${encodeURIComponent(t('s_title') + ' – Gusinje')}&link=${encodeURIComponent(pageURL())}`;
  const url = `intent://arvr.google.com/scene-viewer/1.0?${q}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;` +
    `action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(pageURL('#ar-pomoc'))};end;`;
  toast(t('s_opening'));
  location.href = url;
  // if nothing opened (blocked, or no Google app), offer the other ways
  setTimeout(() => { if (document.visibilityState === 'visible' && !S.xr) showHelp(); }, 2500);
}
// QR code for Android (staze.html?ar=1): AR is best in Chrome, so other browsers first offer to reopen it there
function showChromeSheet() {
  $('#arHelpH').textContent = t('s_chromeTitle');
  $('#arHelpWhy').textContent = t('s_chromeWhy');
  $('#arOpts').innerHTML = `<button class="opt first" data-opt="chrome"><b>${esc(t('s_optChrome'))}</b><small>${esc(t('s_chromeSub'))}</small></button>` +
    `<button class="opt" data-opt="here"><b>${esc(t('s_stayHere'))}</b><small>${esc(t('s_stayHereSub'))}</small></button>`;
  $('#arHelpClose').textContent = t('close');
  $('#arHelp').hidden = false;
}
function showHelp() {
  const opts = [];
  if (!slamFailed) opts.push(['slam', 's_optSlam', 's_optSlamSub']);
  if (IS_ANDROID && !IN_APP) opts.push(['scene', 's_optScene', 's_optSceneSub']);
  if (IS_ANDROID) opts.push(['chrome', 's_optChrome', 's_optChromeSub'], ['arcore', 's_optArcore', 's_optArcoreSub']);
  if (IS_IOS && quickLookOK) opts.push(['quick', 's_optQuick', 's_optQuickSub']);
  opts.push(['cube', 's_optCube', 's_optCubeSub'], ['cam', 's_optCam', 's_optCamSub']);
  $('#arHelpH').textContent = t('s_helpTitle');
  $('#arHelpWhy').textContent = t(IN_APP ? 's_helpInApp' : 's_helpWhy');
  $('#arOpts').innerHTML = opts.map(([id, h, sub], i) => `<button class="opt${i ? '' : ' first'}" data-opt="${id}"><b>${esc(t(h))}</b><small>${esc(t(sub))}</small></button>`).join('');
  $('#arHelpClose').textContent = t('close');
  $('#arHelp').hidden = false;
}
function hideHelp() { $('#arHelp').hidden = true; if (location.hash === '#ar-pomoc') history.replaceState(null, '', pageURL()); }
function helpChoice(id) {
  hideHelp();
  if (id === 'here') { showCTA(); return; }
  if (id === 'slam') { motionPermissions(); startSlamAR().then(ok => { if (!ok) { toast(t('s_slamFail')); } }); return; }
  if (id === 'scene') return sceneViewer();
  if (id === 'quick') return quickLook();
  if (id === 'chrome') { location.href = `intent://${location.host}${location.pathname}?ar=1#Intent;scheme=https;package=com.android.chrome;end`; return; }
  if (id === 'arcore') { location.href = 'https://play.google.com/store/apps/details?id=com.google.ar.core'; return; }
  if (id === 'cube') { location.href = 'kocka.html?id=staze-teren'; return; }
  if (id === 'cam') {
    // iPhone asks for motion-sensor permission; the request must start inside the tap
    const perm = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'
      ? DeviceOrientationEvent.requestPermission().catch(() => 'denied') : null;
    startCamAR(perm);
  }
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
function msg(k) { $('#xrMsg').textContent = t(k); }

// shared overlay (buttons work the same in both kinds of AR)
function openOverlay(kind) {
  const ov = $('#xrOverlay');
  S.xr = { kind, S0: { pos: holder.position.clone(), rot: holder.rotation.y, scale: holder.scale.x, size: S.sizeIdx }, mode: 'front', placed: false,
    needFront: true, drag: null };
  controls.enabled = false;
  S.sizeIdx = FRONT_SIZE; applySize(); updateXRTrail();
  holder.visible = false;
  ov.hidden = false; msg('s_starting');
  $('#xrClose').onclick = () => stopAR();
  $('#xrSmaller').onclick = () => { S.sizeIdx = Math.max(0, S.sizeIdx - 1); applySize(); };
  $('#xrBigger').onclick = () => { S.sizeIdx = Math.min(SIZES.length - 1, S.sizeIdx + 1); applySize(); };
  $('#xrRotL').onclick = () => { holder.rotation.y += Math.PI / 6; };
  $('#xrRotR').onclick = () => { holder.rotation.y -= Math.PI / 6; };
  $('#xrFront').onclick = () => { S.xr.mode = 'front'; S.xr.needFront = true; msg(kind === 'cam' ? 's_arCam' : kind === 'slam' ? 's_slamPlaced' : 's_arFront'); };
  $('#xrTable').onclick = () => {
    if (kind === 'slam') { S.xr.mode = 'table'; msg('s_slamTable'); return; }
    if (!S.xr.hit) { toast(t('s_noTable')); return; }
    S.xr.mode = 'table'; S.xr.placed = false; holder.visible = false; msg('s_arTable');
  };
  $('#xrQuick').onclick = () => { stopAR(); showHelp(); };
  $('#xrTable').hidden = kind === 'cam';
  $('#xrPowered').hidden = kind !== 'slam';
  $('#xrQuick').hidden = kind !== 'cam';
  const ids = S.data.trails.map(x => x.id);
  const step = d => { const i = S.sel ? ids.indexOf(S.sel) : (d > 0 ? -1 : 0); select(ids[(i + d + ids.length) % ids.length]); };
  $('#xrPrev').onclick = () => step(-1); $('#xrNext').onclick = () => step(1);
  document.body.classList.add('in-ar');
  return ov;
}
function closeOverlay() {
  const s0 = S.xr && S.xr.S0;
  S.xr = null; $('#xrOverlay').hidden = true; reticle.visible = false; document.body.classList.remove('in-ar');
  if (s0) { holder.position.copy(s0.pos); holder.rotation.y = s0.rot; holder.scale.setScalar(s0.scale); S.sizeIdx = s0.size; }
  holder.visible = true; if (shadowMesh) shadowMesh.visible = true;
  controls.enabled = true; resize();
}
function stopAR() {
  if (!S.xr) return;
  if (S.xr.kind === 'webxr') S.xr.session?.end();
  else if (S.xr.kind === 'slam') stopSlamAR();
  else stopCamAR();
}

// put the terrain in front of the viewer, a little below the eyes, south edge towards them, at a distance where it fits the view
const fwd = new THREE.Vector3(), eye = new THREE.Vector3();
function placeInFront(camMatrix, proj) {
  eye.setFromMatrixPosition(camMatrix);
  fwd.set(0, 0, -1).transformDirection(camMatrix); fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const e = proj ? proj.elements : null;
  const half = e ? Math.atan(1 / Math.max(e[0], e[5])) : THREE.MathUtils.degToRad(15);   // narrower half-angle of the view
  const size = SIZES[S.sizeIdx], radius = size * 0.5 * Math.hypot(1, S.data.depth) * 0.8;
  const dist = Math.min(2.5, Math.max(0.45, radius / Math.tan(half)));
  holder.position.copy(eye).addScaledVector(fwd, dist); holder.position.y -= dist * 0.42;    // about 23° below eye level
  holder.rotation.set(0, Math.atan2(eye.x - holder.position.x, eye.z - holder.position.z), 0);
  holder.visible = true; if (shadowMesh) shadowMesh.visible = false;
  S.xr.placed = true; S.xr.needFront = false;
}

// ---- 1. WebXR ----
async function startWebXR() {
  const ov = openOverlay('webxr');
  for (const el of ov.querySelectorAll('.xr-top, .xr-panel')) el.addEventListener('beforexrselect', ev => ev.preventDefault());
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['hit-test', 'dom-overlay'], domOverlay: { root: ov } });
  } catch (e) {
    console.warn('WebXR session failed', e); closeOverlay(); return false;
  }
  S.xr.session = session;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  try { S.xr.hit = await session.requestHitTestSource({ space: await session.requestReferenceSpace('viewer') }); } catch { S.xr.hit = null; }
  session.addEventListener('selectstart', e => { if (S.xr) S.xr.drag = { source: e.inputSource, yaw0: null, rot0: holder.rotation.y, moved: false }; });
  session.addEventListener('select', xrSelect);
  session.addEventListener('selectend', () => { if (S.xr) S.xr.drag = null; });
  session.addEventListener('end', () => closeOverlay());
  msg('s_arFront');
  return true;
}
const rayM = new THREE.Matrix4(), rayO = new THREE.Vector3(), rayD = new THREE.Vector3();
function xrStep(xrFrame) {
  const ref = renderer.xr.getReferenceSpace();
  if (S.xr.needFront) {
    const vp = xrFrame.getViewerPose(ref);
    if (vp) placeInFront(rayM.fromArray(vp.transform.matrix), (renderer.xr.getCamera().cameras[0] || arCam).projectionMatrix);
  }
  if (S.xr.mode === 'table' && !S.xr.placed && S.xr.hit) {
    const hits = xrFrame.getHitTestResults(S.xr.hit);
    reticle.visible = hits.length > 0;
    if (hits.length) reticle.matrix.fromArray(hits[0].getPose(ref).transform.matrix);
  } else reticle.visible = false;
  const d = S.xr.drag;                   // one-finger drag across the screen turns the terrain
  if (d && S.xr.placed) {
    const pose = xrFrame.getPose(d.source.targetRaySpace, ref);
    if (pose) {
      rayD.set(0, 0, -1).transformDirection(rayM.fromArray(pose.transform.matrix));
      const yaw = Math.atan2(rayD.x, rayD.z);
      if (d.yaw0 == null) d.yaw0 = yaw;
      let dy = yaw - d.yaw0; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
      if (Math.abs(dy) > 0.035) d.moved = true;
      if (d.moved) holder.rotation.y = d.rot0 + dy * 3;
    }
  }
}
const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), camP = new THREE.Vector3();
function xrSelect(e) {
  if (!S.xr || S.xr.drag?.moved) return;
  if (S.xr.mode === 'table' && !S.xr.placed) {
    if (!reticle.visible) return;
    reticle.matrix.decompose(tmpP, tmpQ, tmpS);
    holder.position.copy(tmpP);
    renderer.xr.getCamera().getWorldPosition(camP);
    holder.rotation.set(0, Math.atan2(camP.x - tmpP.x, camP.z - tmpP.z), 0);     // south edge towards the visitor, north away
    holder.visible = true; if (shadowMesh) shadowMesh.visible = true; S.xr.placed = true;
    msg('s_xrPlaced');
    return;
  }
  const pose = e.frame.getPose(e.inputSource.targetRaySpace, renderer.xr.getReferenceSpace());
  if (!pose) return;
  rayM.fromArray(pose.transform.matrix);
  const id = pickTrail(rayO.setFromMatrixPosition(rayM), rayD.set(0, 0, -1).transformDirection(rayM));
  if (id) select(id);
}

// ---- 2. camera picture + motion sensors ----
const camEl = document.createElement('div'); camEl.className = 'cam-ar'; camEl.hidden = true;
const video = document.createElement('video'); video.playsInline = true; video.muted = true; video.setAttribute('playsinline', '');
camEl.appendChild(video); document.body.appendChild(camEl);
const orient = { q: new THREE.Quaternion(), have: false, alpha0: null };
const EUL = new THREE.Euler(), Q90 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2), QZ = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1);
function onOrient(e) {
  if (e.alpha == null && e.beta == null) return;
  const d2r = Math.PI / 180, so = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * d2r;
  EUL.set((e.beta || 0) * d2r, (e.alpha || 0) * d2r, -(e.gamma || 0) * d2r, 'YXZ');
  orient.q.setFromEuler(EUL).multiply(Q90).multiply(QZ.setFromAxisAngle(ZAX, -so));
  if (!orient.have && S.xr && S.xr.kind === 'cam') { S.xr.needFront = true; msg('s_arCam'); }   // sensor came late: place again
  orient.have = true;
}
async function startCamAR(orientPerm) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast(quickLookOK ? t('preparing') : t('s_noAR')); if (quickLookOK) quickLook(); return;
  }
  openOverlay('cam');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    closeOverlay();
    toast(e && e.name === 'NotAllowedError' ? t('c_errBlocked') : e && e.name === 'NotFoundError' ? t('c_errNoCam') : t('c_errStart'));
    return;
  }
  video.srcObject = stream; camEl.hidden = false;
  try { await video.play(); } catch { /* starts on the next tap */ }
  camEl.appendChild(renderer.domElement);
  S.xr.stream = stream;
  orient.have = false;
  if (orientPerm) await orientPerm;          // iPhone: wait for the motion-sensor answer (no events if refused)
  window.addEventListener('deviceorientation', onOrient);
  sizeCam();
  window.addEventListener('resize', sizeCam);
  arCam.position.set(0, 0, 0); arCam.quaternion.identity();
  setTimeout(() => { if (S.xr && S.xr.kind === 'cam') msg(orient.have ? 's_arCam' : 's_arCamDrag'); }, 1200);
  msg('s_arCam');
}
function sizeCam() {
  if (!S.xr || S.xr.kind === 'webxr') return;
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
  if (S.xr.kind === 'slam') {                  // the engine's camera picture; the projection comes from the engine
    const dpr = Math.min(devicePixelRatio || 1, 2);
    feed.width = Math.round(innerWidth * dpr); feed.height = Math.round(innerHeight * dpr);
    return;
  }
  arCam.aspect = innerWidth / innerHeight;
  arCam.fov = arCam.aspect < 1 ? 62 : 42;      // roughly a phone's main camera, after the picture is cropped to fill the screen
  arCam.updateProjectionMatrix();
}
function camStep() {
  if (orient.have) arCam.quaternion.copy(orient.q);
  else arCam.quaternion.setFromEuler(EUL.set(-0.45, 0, 0, 'YXZ'));     // no sensor: look a little downwards
  arCam.updateMatrixWorld();
  if (S.xr.needFront && (orient.have || performance.now() - (S.xr.t0 ||= performance.now()) > 900)) placeInFront(arCam.matrixWorld, arCam.projectionMatrix);
}
function stopCamAR() {
  window.removeEventListener('deviceorientation', onOrient);
  window.removeEventListener('resize', sizeCam);
  S.xr.stream?.getTracks().forEach(tr => tr.stop());
  video.srcObject = null; camEl.hidden = true;
  stage.prepend(renderer.domElement); renderer.domElement.style.width = ''; renderer.domElement.style.height = '';
  closeOverlay();
}

// ---- 3. world tracking from the camera image (8th Wall engine): any phone, no Google AR services needed ----
// The XR Engine (© Niantic Spatial, Inc., used unmodified under its licence, external/xr/LICENSE) runs SLAM on the
// camera picture and gives the phone's position and turn in the room; our own three.js canvas is drawn on top.
const feed = document.createElement('canvas'); feed.className = 'xr8-feed';
let xr8Loading = null, slamFailed = false;
function loadXR8() {
  if (window.XR8) return Promise.resolve(window.XR8);
  if (!xr8Loading) xr8Loading = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'external/xr/xr.js'; sc.async = true; sc.crossOrigin = 'anonymous';
    sc.setAttribute('data-preload-chunks', 'slam');
    const to = setTimeout(() => reject(new Error('XR engine timeout')), 60000);
    window.addEventListener('xrloaded', () => { clearTimeout(to); resolve(window.XR8); }, { once: true });
    sc.onerror = () => { clearTimeout(to); xr8Loading = null; reject(new Error('XR engine did not load')); };
    document.head.appendChild(sc);
  });
  return xr8Loading;
}
async function startSlamAR() {
  openOverlay('slam');
  msg('s_slamLoading');
  let XR8;
  try {
    XR8 = await loadXR8();
    if (typeof XR8.loadChunk === 'function') await XR8.loadChunk('slam');
  } catch (e) {
    console.warn(e); slamFailed = true; closeOverlay(); return false;
  }
  if (!S.xr || S.xr.kind !== 'slam') return true;          // closed while loading
  video.hidden = true; camEl.prepend(feed); camEl.hidden = false; camEl.appendChild(renderer.domElement);
  S.xr.slam = { status: 'LIMITED', reason: 'INITIALIZING', pose: false, wasNormal: false, t0: performance.now(), failed: false };
  sizeCam(); window.addEventListener('resize', sizeCam);
  const fail = why => {
    if (!S.xr || S.xr.kind !== 'slam' || S.xr.slam.failed) return;
    console.warn('XR engine:', why); S.xr.slam.failed = true; slamFailed = true;
    stopSlamAR(); toast(t('s_slamFail')); showHelp();
  };
  try {
    XR8.clearCameraPipelineModules();
    XR8.XrController.configure({ disableWorldTracking: false, scale: 'responsive' });
    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),          // draws the camera picture
      XR8.XrController.pipelineModule(),               // world tracking (SLAM)
      {
        name: 'gkb-staze',
        onStart: () => {
          // the floor is y = 0 and the phone starts 1.4 units above it, so one unit is about a metre
          XR8.XrController.updateCameraProjectionMatrix({ origin: { x: 0, y: 1.4, z: 0 }, facing: { w: 1, x: 0, y: 0, z: 0 } });
        },
        onUpdate: ({ processCpuResult }) => {
          const r = processCpuResult && processCpuResult.reality;
          if (!r || !S.xr || S.xr.kind !== 'slam') return;
          if (r.position) arCam.position.set(r.position.x, r.position.y, r.position.z);
          if (r.rotation) arCam.quaternion.set(r.rotation.x, r.rotation.y, r.rotation.z, r.rotation.w);
          if (r.intrinsics) { arCam.projectionMatrix.fromArray(r.intrinsics); arCam.projectionMatrixInverse.copy(arCam.projectionMatrix).invert(); }
          if (r.trackingStatus) S.xr.slam.status = r.trackingStatus;
          if (r.trackingReason) S.xr.slam.reason = r.trackingReason;
          S.xr.slam.pose = true;
        },
        onCameraStatusChange: st => { if (st && st.status === 'failed') fail(st); },
        onException: e => fail(e),
        listeners: [{ event: 'reality.trackingstatus', process: ({ detail }) => {
          if (S.xr && S.xr.slam && detail) { S.xr.slam.status = detail.status; S.xr.slam.reason = detail.reason; }
        } }],
      },
    ]);
    XR8.run({ canvas: feed, allowedDevices: XR8.XrConfig.device().ANY });
  } catch (e) { fail(e); return true; }
  return true;
}
let slamMsg = '';
function slamStep() {
  const sl = S.xr.slam;
  arCam.updateMatrixWorld();
  if (!sl || !sl.pose) return;
  const normal = sl.status === 'NORMAL';
  if (normal) sl.wasNormal = true;
  if (S.xr.needFront && (normal || performance.now() - sl.t0 > 6000)) placeInFront(arCam.matrixWorld, arCam.projectionMatrix);
  const k = !S.xr.placed ? 's_slamInit' : S.xr.mode === 'table' ? 's_slamTable' : (!normal && sl.wasNormal) ? 's_slamLost' : 's_slamPlaced';
  if (k !== slamMsg) { slamMsg = k; msg(k); }
}
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitV = new THREE.Vector3();
function slamPlace(cx, cy) {
  // put the terrain where the user tapped: a tracked point on the table or floor, else the floor (y = 0)
  let p = null;
  try {
    const hits = window.XR8.XrController.hitTest(cx / innerWidth, cy / innerHeight, ['FEATURE_POINT']) || [];
    if (hits.length) p = new THREE.Vector3(hits[0].position.x, hits[0].position.y, hits[0].position.z);
  } catch { p = null; }
  if (!p) {
    ray.setFromCamera(new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1), arCam);
    if (ray.ray.intersectPlane(groundPlane, hitV)) p = hitV.clone();
  }
  if (!p) return;
  holder.position.copy(p);
  arCam.getWorldPosition(camP);
  holder.rotation.set(0, Math.atan2(camP.x - p.x, camP.z - p.z), 0);
  holder.visible = true; if (shadowMesh) shadowMesh.visible = true;
  S.xr.placed = true; S.xr.needFront = false; S.xr.mode = 'placed';
}
function stopSlamAR() {
  try { window.XR8 && window.XR8.stop(); } catch (e) { console.warn(e); }
  try { window.XR8 && window.XR8.clearCameraPipelineModules(); } catch (e) { console.warn(e); }
  window.removeEventListener('resize', sizeCam);
  feed.remove(); video.hidden = false; camEl.hidden = true; slamMsg = '';
  stage.prepend(renderer.domElement); renderer.domElement.style.width = ''; renderer.domElement.style.height = '';
  closeOverlay();
}

let usdzURL = null;
async function quickLook() {
  // Apple's AR viewer: the same real-size model as Google's (terrain, trails and name signs), converted on the phone
  toast(t('preparing'));
  try {
    if (!usdzURL) {
      const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
      const gltf = await new GLTFLoader().loadAsync(S.data.arModel);
      gltf.scene.traverse(o => {
        if (o.isMesh && o.material.isMeshBasicMaterial) {     // the unlit name signs -> a material Quick Look accepts
          const m = o.material;
          o.material = new THREE.MeshStandardMaterial({ map: m.map, emissiveMap: m.map, emissive: 0xffffff, transparent: true, roughness: 1, metalness: 0 });
        }
      });
      const s = new THREE.Scene(); s.add(gltf.scene); s.updateMatrixWorld(true);
      const buf = await new USDZExporter().parseAsync(s, { quickLookCompatible: true, maxTextureSize: 2048 });
      usdzURL = URL.createObjectURL(new Blob([buf], { type: 'model/vnd.usdz+zip' }));
    }
    const a = document.createElement('a'); a.rel = 'ar'; a.href = usdzURL; a.appendChild(document.createElement('img'));
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { console.warn(e); showHelp(); }
}

window.__staze = { S, scene, camera, controls, renderer, holder, select, arCam, startAR, stopAR, orient };   // for tests
