// Planinarske staze – 3D relief of the Gusinje area with hiking trails: touch viewer and AR.
// AR (js/staze-ar.js): own three.js camera AR on the printed AR map or in front of you, in Safari and Chrome alike;
// WebXR (Chrome with Google's AR services) and Quick Look (iPhone) stay available as extras.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STR, detectLang, L, HTML_LANG, NUM_LOCALE } from './i18n.js';
import { TrailsAR, arText } from './staze-ar.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
let lang = store.get('gkb.lang', null) || detectLang();
if (!STR[lang]) lang = 'me';
const t = k => (PAGE[lang] && PAGE[lang][k]) ?? (STR[lang] && STR[lang][k]) ?? PAGE.me[k] ?? STR.me[k] ?? k;
const tx = o => L(o, lang);
const num = (v, d = 0, group = true) => Number(v).toLocaleString(NUM_LOCALE[lang] || 'en', { maximumFractionDigits: d, minimumFractionDigits: d, useGrouping: group });
const m0 = v => num(Math.round(v), 0, false);     // heights: 2534, not 2.534

const EXAGS = [1, 1.5, 2, 3];
const SIZES = [0.3, 0.45, 0.6, 0.8, 1.0, 1.5];       // table model width in metres
const R_TRAIL = 0.0021, R_SEL = 0.0036, R_PICK = 0.011;

const S = { data: null, exag: store.get('gkb.staze.exag', 1.5), labels: store.get('gkb.staze.labels', true), sel: null,
  walk: null, trails: new Map(), places: [], sizeIdx: 2, xr: null, arK: 1 };
if (!EXAGS.includes(S.exag)) S.exag = 1.5;

// texts of this page that are new or changed since the shared dictionary in i18n.js
const PAGE = {
  me: { s_ar: 'Pokreni AR', s_ctaSub: 'Usmjerite kameru na odštampanu AR mapu: teren izraste iz papira i možete ga obići. Bez mape se pojavi ispred vas.',
    s_mapH: 'AR mapa za štampu', s_mapP: 'Odštampajte je, stavite na sto i usmjerite kameru: Prokletije izrastu iz papira. Radi na iPhoneu i Androidu, u bilo kojoj veličini štampe.',
    s_mapA4: 'PDF A4', s_mapA3: 'PDF A3 (izložba)', s_room: 'Prostorni AR', s_roomSub: 'Teren u prostoru bez mape (Chrome sa Googleovim AR uslugama). Obiđite ga i dodirnite stazu.',
    s_camFail: 'Kamera se nije pokrenula.', s_inApp: 'Ovaj link je otvoren unutar druge aplikacije, koja ne daje kameru. Otvorite ga u Safariju (iPhone) ili Chromeu (Android).',
    s_helpTitle: 'AR ne može početi ovdje', s_optSafari: 'Otvori u Safariju', s_optSafariSub: 'Na iPhoneu: dodirnite ••• ili ikonu za dijeljenje, pa „Otvori u Safariju“.' },
  en: { s_ar: 'Start AR', s_ctaSub: 'Point the camera at the printed AR map: the terrain rises out of the paper and you can walk around it. Without the map it appears in front of you.',
    s_mapH: 'Printable AR map', s_mapP: 'Print it, put it on a table and point the camera at it: Prokletije rise out of the paper. Works on iPhone and Android, at any print size.',
    s_mapA4: 'PDF A4', s_mapA3: 'PDF A3 (exhibition)', s_room: 'Room AR', s_roomSub: 'The terrain in your room without the map (Chrome with Google’s AR services). Walk around it and tap a trail.',
    s_camFail: 'The camera did not start.', s_inApp: 'This link opened inside another app, which does not give the camera to pages. Open it in Safari (iPhone) or Chrome (Android).',
    s_helpTitle: 'AR cannot start here', s_optSafari: 'Open in Safari', s_optSafariSub: 'On iPhone: tap ••• or the share icon, then “Open in Safari”.' },
  sq: { s_ar: 'Nis AR', s_ctaSub: 'Drejtojeni kamerën nga harta AR e printuar: terreni ngrihet nga letra dhe mund të ecni rreth tij. Pa hartë shfaqet para jush.',
    s_mapH: 'Harta AR për printim', s_mapP: 'Printojeni, vendoseni në tavolinë dhe drejtoni kamerën: Bjeshkët e Nemuna ngrihen nga letra. Punon në iPhone dhe Android, në çdo madhësi printimi.',
    s_mapA4: 'PDF A4', s_mapA3: 'PDF A3 (ekspozitë)', s_room: 'AR në hapësirë', s_roomSub: 'Terreni në dhomën tuaj pa hartë (Chrome me shërbimet AR të Google). Ecni rreth tij dhe prekni një shteg.',
    s_camFail: 'Kamera nuk u nis.', s_inApp: 'Kjo lidhje u hap brenda një aplikacioni tjetër, që nuk ua jep kamerën faqeve. Hapeni në Safari (iPhone) ose Chrome (Android).',
    s_helpTitle: 'AR nuk mund të niset këtu', s_optSafari: 'Hape në Safari', s_optSafariSub: 'Në iPhone: prekni ••• ose ikonën e ndarjes, pastaj „Hape në Safari“.' },
};

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
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b5a45, 0.75));
const camera = new THREE.PerspectiveCamera(35, 1, 0.005, 20);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: Math.PI * 0.47, minDistance: 0.12, maxDistance: 2.6,
  screenSpacePanning: false, rotateSpeed: 0.75, panSpeed: 0.9 });
controls.addEventListener('start', () => { $('#hint').style.opacity = '0'; });

const holder = new THREE.Group();          // whole model; placed and scaled in AR
const rise = new THREE.Group();            // grows out of the paper when AR finds the map
const terrainWrap = new THREE.Group();      // vertical exaggeration
const trailGroup = new THREE.Group(), pickGroup = new THREE.Group(), pinGroup = new THREE.Group();
rise.add(terrainWrap, trailGroup, pickGroup, pinGroup);
holder.add(rise, sun, sun.target);          // the sun turns with the model, so its light always matches the painted shading
scene.add(holder);
const hiker = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 20, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff7a00, emissiveIntensity: 0.9, roughness: 0.4 }));
hiker.visible = false; rise.add(hiker);
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
  if (renderer.xr.isPresenting || S.xr) return;
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
  if (qs.has('ar') && IN_APP) showChromeSheet();          // QR code opened inside another app (no camera there)
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
  $('#mapH').textContent = t('s_mapH'); $('#mapP').textContent = t('s_mapP'); $('#ctaPdf').textContent = arText(lang, 'pdf');
  $('#xrTableTxt').textContent = t('s_toTable');
  paintXRTools();
  $('#mapA4').textContent = t('s_mapA4'); $('#mapA3').textContent = t('s_mapA3');
  if (S.ar) S.ar.paint();
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
    const r = (isSel ? R_SEL : R_TRAIL) * S.arK;
    const mat = new THREE.MeshStandardMaterial({ color: tr.color, roughness: 0.55, emissive: tr.color, emissiveIntensity: (isSel ? 0.35 : 0.12) + (S.arK > 1 ? 0.18 : 0),
      transparent: true, opacity: S.sel && !isSel ? (S.arK > 1 ? 0.6 : 0.45) : 1 });
    const mesh = new THREE.Mesh(tube(tr.segs, r, isSel ? 8 : 6, r * 0.55), mat);
    mesh.renderOrder = isSel ? 3 : 1;
    const pick = new THREE.Mesh(tube(tr.segs, R_PICK * (S.arK > 1 ? 1.6 : 1), 5, 0.002), new THREE.MeshBasicMaterial({ visible: false }));
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
  const rising = rise.scale.y < 0.9;           // AR: names appear once the relief has risen
  pinGroup.visible = !rising;
  if (rising) return;
  const k = 2 / (viewH * cam.projectionMatrix.elements[5]) / (holder.scale.x || 1);     // constant size on screen, whatever the model's scale
  const placed = [];
  const order = [...S.places].sort((a, b) => a.userData.rank - b.userData.rank);
  for (const s of order) {
    const hPx = s.userData.px * (S.xr ? 1.1 : 1);
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
  paintXRTrail();
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
function drawProfile(cursorKm = null, c = $('#prof')) {
  if (!c || !S.sel) return;
  const tr = S.trails.get(S.sel).tr, pr = profile(tr);
  const dpr = Math.min(devicePixelRatio || 1, 2), w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const ink = c.dataset.ink || css.getPropertyValue('--muted') || '#6e655a';
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
  paintWalkBtn();
}
function stopWalk() {
  S.walk = null; hiker.visible = false;
  const b = $('#btnWalk'); if (b) b.textContent = t('s_walk');
  drawProfile(); paintWalkBtn(); drawProfile(null, $('#xrProf'));
}
function stepWalk(now) {
  const w = S.walk; if (!w) return;
  const f = ((now - w.t0) % w.dur) / w.dur, km = f * w.pr[w.pr.length - 1][0];
  let k = w.pr.findIndex(p => p[0] >= km); if (k < 1) k = 1;
  const a = w.pr[k - 1], b = w.pr[k], u = b[0] > a[0] ? (km - a[0]) / (b[0] - a[0]) : 0;
  const pa = w.pts[k - 1], pb = w.pts[k];
  hiker.position.set(pa[0] + (pb[0] - pa[0]) * u, (pa[1] + (pb[1] - pa[1]) * u) * S.exag + 0.007, pa[2] + (pb[2] - pa[2]) * u);
  if ((now | 0) % 3 === 0) { if (!S.xr) drawProfile(km); else drawProfile(km, $('#xrProf')); }
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
  down = S.xr ? null : { x: e.clientX, y: e.clientY, t: performance.now() };
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || S.xr) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8, dt = performance.now() - down.t; down = null;
  if (moved || dt > 500) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hits = ray.intersectObjects(pickGroup.children, false);
  if (hits.length) select(hits[0].object.userData.id);
  else if (S.sel) select(S.sel);   // tap on empty terrain clears the selection
});
const pv = new THREE.Vector3();
function pickAt(ndc, cam) {
  ray.setFromCamera(ndc, cam);
  const ids = [...new Set(ray.intersectObjects(pickGroup.children, false).map(h => h.object.userData.id))];
  if (ids.length < 2) return ids[0] || null;
  // several trails under the finger (the touch area is wide in AR): the one whose line passes closest wins
  let best = null, bd = Infinity;
  rise.updateMatrixWorld(true);
  for (const id of ids) for (const sg of S.trails.get(id).tr.segs) for (let k = 0; k < sg.length; k += 3) {
    const d = ray.ray.distanceSqToPoint(pv.set(sg[k], sg[k + 1] * S.exag, sg[k + 2]).applyMatrix4(rise.matrixWorld));
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

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
function cycleHeight() {
  S.exag = EXAGS[(EXAGS.indexOf(S.exag) + 1) % EXAGS.length] || 1.5; store.set('gkb.staze.exag', S.exag);
  terrainWrap.scale.y = S.exag; buildTrails(); buildPlaces(); paintText();
  if (S.walk) startWalk();
}
function toggleLabels() {
  S.labels = !S.labels; store.set('gkb.staze.labels', S.labels); pinGroup.visible = S.labels; paintText();
}
function wireUI() {
  $('#ctaStart').addEventListener('click', startAR);
  $('#arOpts').addEventListener('click', e => { const b = e.target.closest('[data-opt]'); if (b) helpChoice(b.dataset.opt); });
  $('#arHelpClose').addEventListener('click', hideHelp);
  $('#arHelp').addEventListener('click', e => { if (e.target.id === 'arHelp') hideHelp(); });
  if (location.hash === '#ar-pomoc') showHelp();
  $('#ctaSkip').addEventListener('click', hideCTA);
  $('#btnHeight').addEventListener('click', cycleHeight);
  $('#btnLabels').addEventListener('click', toggleLabels);
  $('#btnReset').addEventListener('click', () => resetView());
  $('#btnTable').addEventListener('click', startAR);
  // AR screen
  $('#xrClose').addEventListener('click', stopAR);
  const ids = () => S.data.trails.map(x => x.id);
  const step = d => { const l = ids(), i = S.sel ? l.indexOf(S.sel) : (d > 0 ? -1 : 0); select(l[(i + d + l.length) % l.length]); };
  $('#xrPrev').addEventListener('click', () => step(-1));
  $('#xrNext').addEventListener('click', () => step(1));
  $('#xrTrail').addEventListener('click', () => { if (!S.sel) step(1); else $('#xrOverlay').classList.toggle('card-min'); });
  $('#xrHeight').addEventListener('click', cycleHeight);
  $('#xrLabels').addEventListener('click', toggleLabels);
  $('#xrPlace').addEventListener('click', () => {
    if (S.xr && S.xr.kind === 'webxr') { S.xr.mode = 'front'; S.xr.needFront = true; xrMsg('s_arFront'); }
    else if (S.ar) S.ar.togglePlace();
  });
  $('#xrTableBtn').addEventListener('click', () => {
    if (!S.xr || S.xr.kind !== 'webxr') return;
    if (!S.xr.hit) { toast(t('s_noTable')); return; }
    S.xr.mode = 'table'; S.xr.placed = false; holder.visible = false; xrMsg('s_arTable');
  });
  $('#xrMoreBtn').addEventListener('click', showMore);
  $('#coachFree').addEventListener('click', () => S.ar && S.ar.goFree(true));
  $('#coachRoom').addEventListener('click', e => helpChoice(e.currentTarget.dataset.opt));
  $('#xrCard').addEventListener('click', e => { if (e.target.closest('#xrWalk')) S.walk ? stopWalk() : startWalk(); });
  terrainWrap.scale.y = S.exag;
}

// ---------------- frame loop ----------------
function frame(now, xrFrame) {
  const kind = S.xr && S.xr.kind;
  let cam = camera, vw = stage.clientWidth, vh = stage.clientHeight;
  if (kind === 'webxr') {
    if (xrFrame) xrStep(xrFrame);
    cam = renderer.xr.isPresenting ? (renderer.xr.getCamera().cameras[0] || renderer.xr.getCamera()) : camera; vw = innerWidth; vh = innerHeight;
  } else if (kind === 'cam') {
    cam = S.ar.frame(now); vw = S.ar.w; vh = S.ar.h;
  } else { stepCamera(now); controls.update(); }
  stepWalk(now);
  layoutLabels(cam, vh, vw);
  if (!kind) $('#north').style.transform = `rotate(${THREE.MathUtils.radToDeg(controls.getAzimuthalAngle())}deg)`;
  renderer.render(scene, kind === 'cam' ? cam : camera);
}

let toastT;
function toast(m) { const el = $('#toast'); el.textContent = m; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3600); }

// ---------------- AR ----------------
// Camera AR (js/staze-ar.js) is the default on every phone: on the printed AR map, or in front of you without it.
// Extras: WebXR "room AR" where Chrome has Google's AR services, Quick Look on iPhone.
const UA = navigator.userAgent;
const IS_ANDROID = /Android/i.test(UA);
const IS_IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IN_APP = /; wv\)|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Telegram|Snapchat|Twitter|LinkedInApp|GSA\//i.test(UA);
const quickLookOK = (() => { const a = document.createElement('a'); return !!(a.relList && a.relList.supports && a.relList.supports('ar')); })();
const FRONT_SIZE = 1;                       // WebXR: 45 cm wide when floating in front of you
let webxrOK = false;
(async () => { try { webxrOK = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { webxrOK = false; } })();

const arCtx = {
  renderer, scene, holder, rise, t, toast, select,
  lang: () => lang,
  exagLabel: () => num(S.exag, S.exag % 1 ? 1 : 0),
  labels: () => S.labels,
  paintTrail: () => paintXRTrail(),
  pick: (ndc, cam) => pickAt(ndc, cam),
  onExit: () => leaveAR(),
  onCoach: () => { if (IS_IOS && quickLookOK) prepareUSDZ().catch(() => {}); },
};

function motionPermission() {      // iPhone asks for the motion sensors; the request must start inside the tap
  const E = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
  return E && typeof E.requestPermission === 'function' ? E.requestPermission().catch(() => 'denied') : null;
}
function enterAR(kind) {
  hideCTA(); hideHelp();
  S.xr = { kind, S0: { pos: holder.position.clone(), quat: holder.quaternion.clone(), scale: holder.scale.x } };
  controls.enabled = false;
  S.arK = 1.9; buildTrails(); hiker.scale.setScalar(2.2);
  const ov = $('#xrOverlay');
  ov.dataset.kind = kind; ov.dataset.mode = kind === 'webxr' ? 'webxr' : 'search'; ov.hidden = false; ov.classList.remove('card-min');
  $('#xrTableBtn').hidden = kind !== 'webxr';
  // without the print, room AR that you can walk around: Quick Look on iPhone, WebXR where Chrome has Google's AR services
  const room = $('#coachRoom'), roomKind = IS_IOS && quickLookOK ? 'quick' : webxrOK ? 'room' : '';
  room.hidden = !roomKind; room.dataset.opt = roomKind;
  room.textContent = roomKind === 'quick' ? arText(lang, 'quick') : t('s_room');
  document.body.classList.add('in-ar');
  paintXRTrail();
}
function leaveAR() {
  if (!S.xr) return;
  const s0 = S.xr.S0;
  S.xr = null; S.ar = null;
  holder.position.copy(s0.pos); holder.quaternion.copy(s0.quat); holder.scale.setScalar(s0.scale);
  holder.visible = true; rise.scale.y = 1; reticle.visible = false; if (shadowMesh) shadowMesh.visible = true;
  S.arK = 1; buildTrails(); hiker.scale.setScalar(1);
  renderer.toneMappingExposure = 1;
  $('#xrOverlay').hidden = true; $('#arRoot').hidden = true; document.body.classList.remove('in-ar');
  if (renderer.domElement.parentElement !== stage) stage.prepend(renderer.domElement);
  renderer.domElement.style.width = ''; renderer.domElement.style.height = '';
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  controls.enabled = true; resize();
}

function startAR() {
  const perm = motionPermission();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (webxrOK) { startWebXR(); return; }
    showHelp('noapi'); return;
  }
  enterAR('cam');
  S.ar = new TrailsAR(arCtx);
  S.ar.start(perm).catch(e => {
    console.warn('camera AR', e);
    const why = e && e.name === 'NotAllowedError' ? 'c_errBlocked' : e && e.name === 'NotFoundError' ? 'c_errNoCam' : IN_APP ? 's_inApp' : 's_camFail';
    leaveAR(); showHelp(why);
  });
}
function stopAR() {
  if (!S.xr) return;
  if (S.xr.kind === 'webxr') S.xr.session?.end();
  else if (S.ar) S.ar.stop();
}

// trail chip and card on the AR screen
function paintXRTrail() {
  const chip = $('#xrTrail'), card = $('#xrCard'); if (!chip) return;
  const tr = S.sel && S.trails.get(S.sel) && S.trails.get(S.sel).tr;
  chip.innerHTML = tr ? `<span class="dot" style="background:${tr.color}"></span><span class="nm">${esc(tx(tr.name))}</span>`
    : `<span class="nm muted">${esc(t('s_noTrail'))}</span>`;
  if (!tr) { card.hidden = true; card.innerHTML = ''; return; }
  card.hidden = false;
  const time = lang === 'me' ? tr.time : tr.time.replace('dana', lang === 'sq' ? 'ditë' : 'days');
  card.innerHTML = `<div class="stats"><span>${num(tr.km, tr.km < 20 ? 1 : 0)} km</span><span>↑ ${m0(tr.up)} m</span><span>${esc(time)}</span>
      <span class="chip" style="background:${tr.color}">${esc(tx(S.data.styles[tr.style]))}</span></div>
    ${tr.style !== 'long' ? `<canvas id="xrProf" data-ink="rgba(246,241,231,.75)" aria-label="${esc(t('s_profile'))}"></canvas>
    <button class="ar-walk" id="xrWalk" aria-pressed="${!!S.walk}"></button>` : ''}`;
  paintWalkBtn();
  requestAnimationFrame(() => drawProfile(null, $('#xrProf')));
}
function paintWalkBtn() {
  const b = $('#xrWalk'); if (!b) return;
  b.setAttribute('aria-pressed', String(!!S.walk));
  b.innerHTML = S.walk ? `<svg viewBox="0 0 24 24"><rect x="7" y="6" width="3.5" height="12" rx="1"/><rect x="13.5" y="6" width="3.5" height="12" rx="1"/></svg>${esc(t('s_stop'))}`
    : `<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>${esc(t('s_walk'))}`;
}
function paintXRTools() {
  $('#xrHeight span').textContent = `${arText(lang, 'height')} ×${num(S.exag, S.exag % 1 ? 1 : 0)}`;
  $('#xrLabels span').textContent = arText(lang, 'labels'); $('#xrLabels').setAttribute('aria-pressed', String(S.labels));
  if (!S.ar) $('#xrPlace span').textContent = arText(lang, 'place');
}
function xrMsg(k) { $('#xrMsg').textContent = t(k); $('#xrHint').textContent = ''; }

// "More" on the AR screen and the help sheet when AR cannot start
function sheet(title, why, opts) {
  $('#arHelpH').textContent = title;
  $('#arHelpWhy').textContent = why || '';
  $('#arHelpWhy').hidden = !why;
  $('#arOpts').innerHTML = opts.map(([id, h, sub, href], i) => href
    ? `<a class="opt${i ? '' : ' first'}" href="${esc(href)}" target="_blank" rel="noopener"><b>${esc(h)}</b><small>${esc(sub)}</small></a>`
    : `<button class="opt${i ? '' : ' first'}" data-opt="${id}"><b>${esc(h)}</b><small>${esc(sub)}</small></button>`).join('');
  $('#arHelpClose').textContent = t('close');
  $('#arHelp').hidden = false;
}
const ART = k => arText(lang, k);
function pdfOpts() {
  const T = ART;
  return [['pdf', `${t('s_mapH')} · A4`, T('pdfSub'), 'print/staze/AR_mapa_staze_A4.pdf'], ['pdf3', `${t('s_mapH')} · A3`, T('pdfA3'), 'print/staze/AR_mapa_staze_A3.pdf']];
}
function showMore() {
  arCtx.onCoach();
  const opts = [];
  if (S.xr && S.xr.kind === 'cam') opts.push(['camera', ART('camera'), ART('cameraSub')]);
  if (webxrOK) opts.push(['room', t('s_room'), t('s_roomSub')]);
  if (IS_IOS && quickLookOK) opts.push(['quick', ART('quick'), ART('quickSub')]);
  opts.push(...pdfOpts());
  if (S.xr && S.xr.kind === 'cam') opts.push(['debug', ART('debug'), ART('debugSub')]);
  sheet(ART('moreH'), '', opts);
}
function showHelp(why) {
  const opts = [];
  if (IN_APP && IS_ANDROID) opts.push(['chrome', t('s_optChrome'), t('s_optChromeSub')]);
  if (IN_APP && IS_IOS) opts.push(['safari', t('s_optSafari'), t('s_optSafariSub')]);
  opts.push(['retry', t('s_ar'), t('s_ctaSub')]);
  if (webxrOK) opts.push(['room', t('s_room'), t('s_roomSub')]);
  if (IS_IOS && quickLookOK) opts.push(['quick', t('s_optQuick'), t('s_optQuickSub')]);
  opts.push(['cube', t('s_optCube'), t('s_optCubeSub')], ...pdfOpts());
  sheet(t('s_helpTitle'), why ? t(why) : (IN_APP ? t('s_inApp') : ''), opts);
}
function showChromeSheet() {
  sheet(t('s_chromeTitle'), t('s_inApp'), [IS_IOS ? ['safari', t('s_optSafari'), t('s_optSafariSub')] : ['chrome', t('s_optChrome'), t('s_chromeSub')],
    ['here', t('s_stayHere'), t('s_stayHereSub')]]);
}
function hideHelp() { $('#arHelp').hidden = true; if (location.hash === '#ar-pomoc') history.replaceState(null, '', pageURL()); }
function helpChoice(id) {
  hideHelp();
  if (id === 'here') { showCTA(); return; }
  if (id === 'retry') { startAR(); return; }
  if (id === 'safari') { toast(t('s_optSafariSub')); return; }
  if (id === 'camera') { S.ar && S.ar.engine.nextCamera().then(ok => { if (!ok) toast('1 camera'); }); return; }
  if (id === 'debug') { if (S.ar) { S.ar.debug = !S.ar.debug; if (!S.ar.debug && S.ar.debugCanvas) { S.ar.debugCanvas.remove(); S.ar.debugCanvas = null; } } return; }
  if (id === 'room') { if (S.xr) { const go = () => startWebXR(); if (S.ar) { S.ar.stop(); setTimeout(go, 50); } else go(); } else startWebXR(); return; }
  if (id === 'quick') { if (S.ar) S.ar.stop(); quickLook(); return; }
  if (id === 'chrome') { location.href = `intent://${location.host}${location.pathname}?ar=1#Intent;scheme=https;package=com.android.chrome;end`; return; }
  if (id === 'cube') { location.href = 'kocka.html?id=staze-teren'; return; }
}
function pageURL(hash = '') { return location.href.split('#')[0] + hash; }

// ---- WebXR (Chrome with Google's AR services): the terrain floats in front of you; "On a table" puts it on a surface ----
const SIZES_XR = [0.3, 0.45, 0.6, 0.8];
const fwd = new THREE.Vector3(), eye = new THREE.Vector3();
function placeInFront(camMatrix, proj) {
  eye.setFromMatrixPosition(camMatrix);
  fwd.set(0, 0, -1).transformDirection(camMatrix); fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const e = proj ? proj.elements : null;
  const half = e ? Math.atan(1 / Math.max(e[0], e[5])) : THREE.MathUtils.degToRad(15);
  const size = SIZES_XR[FRONT_SIZE], radius = size * 0.5 * Math.hypot(1, S.data.depth) * 0.8;
  const dist = Math.min(2.5, Math.max(0.45, radius / Math.tan(half)));
  holder.scale.setScalar(size);
  holder.position.copy(eye).addScaledVector(fwd, dist); holder.position.y -= dist * 0.42;    // about 23° below eye level
  holder.rotation.set(0, Math.atan2(eye.x - holder.position.x, eye.z - holder.position.z), 0);
  holder.visible = true; if (shadowMesh) shadowMesh.visible = false;
  S.xr.placed = true; S.xr.needFront = false;
}
let shadowMesh = null;
holder.traverse(o => { if (o.isMesh && o.material?.map && o.renderOrder === -1) shadowMesh = o; });
async function startWebXR() {
  enterAR('webxr');
  const ov = $('#xrOverlay');
  Object.assign(S.xr, { mode: 'front', placed: false, needFront: true, drag: null });
  holder.visible = false;
  for (const el of ov.querySelectorAll('.ar-top, .ar-dock')) el.addEventListener('beforexrselect', ev => ev.preventDefault());
  xrMsg('s_starting');
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['hit-test', 'dom-overlay'], domOverlay: { root: ov } });
  } catch (e) {
    console.warn('WebXR session failed', e); leaveAR(); showHelp('s_camFail'); return false;
  }
  S.xr.session = session;
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  try { S.xr.hit = await session.requestHitTestSource({ space: await session.requestReferenceSpace('viewer') }); } catch { S.xr.hit = null; }
  session.addEventListener('selectstart', e => { if (S.xr) S.xr.drag = { source: e.inputSource, yaw0: null, rot0: holder.rotation.y, moved: false }; });
  session.addEventListener('select', xrSelect);
  session.addEventListener('selectend', () => { if (S.xr) S.xr.drag = null; });
  session.addEventListener('end', () => leaveAR());
  xrMsg('s_arFront');
  return true;
}
const rayM = new THREE.Matrix4(), rayO = new THREE.Vector3(), rayD = new THREE.Vector3();
function xrStep(xrFrame) {
  const ref = renderer.xr.getReferenceSpace();
  if (S.xr.needFront) {
    const vp = xrFrame.getViewerPose(ref);
    if (vp) placeInFront(rayM.fromArray(vp.transform.matrix), (renderer.xr.getCamera().cameras[0] || camera).projectionMatrix);
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
    xrMsg('s_xrPlaced');
    return;
  }
  const pose = e.frame.getPose(e.inputSource.targetRaySpace, renderer.xr.getReferenceSpace());
  if (!pose) return;
  rayM.fromArray(pose.transform.matrix);
  ray.set(rayO.setFromMatrixPosition(rayM), rayD.set(0, 0, -1).transformDirection(rayM));
  const hits = ray.intersectObjects(pickGroup.children, false);
  if (hits.length) select(hits[0].object.userData.id);
}

// ---- Quick Look (iPhone): Apple's AR viewer with the real-size model (terrain, trails and name signs) ----
let usdzURL = null, usdzBusy = null;
function prepareUSDZ() { return usdzBusy ||= makeUSDZ().catch(e => { usdzBusy = null; throw e; }); }
// Safari opens Quick Look only straight from a tap, so the model is prepared in advance (when AR starts on iPhone)
function quickLook() {
  if (usdzURL) { openQuickLook(); return; }
  toast(t('preparing'));
  prepareUSDZ().then(openQuickLook).catch(e => { console.warn(e); showHelp(); });
}
function openQuickLook() {
  const a = document.createElement('a'); a.rel = 'ar'; a.href = usdzURL; a.appendChild(document.createElement('img'));
  document.body.appendChild(a); a.click(); a.remove();
}
async function makeUSDZ() {
  if (usdzURL) return;
  const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
  const gltf = await new GLTFLoader().loadAsync(S.data.arModel);
  gltf.scene.traverse(o => {
    if (o.isMesh && o.material.isMeshBasicMaterial) {     // the unlit name signs -> a material Quick Look accepts
      const m = o.material;
      o.material = new THREE.MeshStandardMaterial({ map: m.map, emissiveMap: m.map, emissive: 0xffffff, transparent: true, roughness: 1, metalness: 0 });
    }
  });
  const sc = new THREE.Scene(); sc.add(gltf.scene); sc.updateMatrixWorld(true);
  const buf = await new USDZExporter().parseAsync(sc, { quickLookCompatible: true, maxTextureSize: 2048 });
  usdzURL = URL.createObjectURL(new Blob([buf], { type: 'model/vnd.usdz+zip' }));
}

window.__staze = { S, scene, camera, controls, renderer, holder, rise, select, startAR, stopAR };   // for tests
