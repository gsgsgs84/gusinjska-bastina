// Gusinjska kulturna baština – museum app: galleries, exhibit viewer, life-size AR, showcase cube.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STR, detectLang, L } from './i18n.js';

const VERSION = '0.3';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };

let lang = store.get('gkb.lang', null) || detectLang();
const t = k => STR[lang][k] ?? STR.me[k] ?? k;
const tx = o => L(o, lang);
let DATA = null;
let showcase = store.get('gkb.vitrina', []);
const MAX_SHOW = 6;

// ---------------- boot ----------------
init();
async function init() {
  for (const b of document.querySelectorAll('.lang button')) b.addEventListener('click', () => setLang(b.dataset.lang));
  paintLang();
  try {
    DATA = await (await fetch('data/exhibits.json')).json();
  } catch (e) {
    $('#view').innerHTML = `<p class="empty">${esc(t('loadError'))}</p>`;
    return;
  }
  showcase = showcase.filter(id => DATA.exhibits.some(x => x.id === id));
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
function setLang(l) { lang = l; store.set('gkb.lang', l); paintLang(); route(); }
function paintLang() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'sr-ME';
  for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  $('#back').setAttribute('aria-label', t('back'));
}

// ---------------- routing ----------------
function route() {
  if (!DATA) return;
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [page, id] = parts;
  leaveViewer();
  const back = $('#back');
  back.hidden = !page;
  if (page === 'g') renderGallery(id);
  else if (page === 'e') renderExhibit(id);
  else if (page === 'vitrina') renderShowcase();
  else if (page === 'kocka') renderCubeInfo();
  else renderHome();
  window.scrollTo(0, 0);
  $('#view').focus({ preventScroll: true });
}
const ex = id => DATA.exhibits.find(x => x.id === id);
const inGallery = gid => DATA.exhibits.filter(x => x.gallery === gid);
const thumb = (e, cls = '') => e.thumb ? `<img class="${cls}" src="${esc(e.thumb)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '';

function renderHome() {
  document.title = DATA.museum.name;
  const feat = DATA.exhibits.find(x => x.featured) || DATA.exhibits[0];
  $('#view').innerHTML = `
    <section class="hero">
      <h1>${esc(DATA.museum.name)}</h1>
      <p class="tag">${esc(tx(DATA.museum.tagline))}</p>
      <p class="lede">${esc(tx(DATA.museum.intro))}</p>
    </section>
    ${feat ? `<a class="feature" href="#/e/${encodeURIComponent(feat.id)}">
      <div class="img">${thumb(feat)}</div>
      <div class="txt"><small>${esc(t('featured'))}</small><h2>${esc(tx(feat.name))}</h2><p>${esc(tx(feat.subtitle))}</p></div></a>` : ''}
    <div class="section-h"><h2>${esc(t('galleries'))}</h2></div>
    <div class="galleries">${DATA.galleries.map(g => {
      const items = inGallery(g.id);
      return `<a class="gal" href="#/g/${encodeURIComponent(g.id)}">
        <div class="thumbs${items.length < 4 ? ' one' : ''}">${(items.length < 4 ? items.slice(0, 1) : items.slice(0, 4)).map(e => thumb(e)).join('')}</div>
        <div><h3>${esc(tx(g.name))}</h3><p>${esc(tx(g.description))}</p><span class="count">${items.length} ${esc(t(items.length === 1 ? 'exhibit1' : 'exhibitN'))}</span></div></a>`;
    }).join('')}</div>
    <section class="cubebox">
      <h2>${esc(t('cubeTitle'))}</h2>
      <p>${esc(t('cubeText'))}</p>
      <div class="row">
        <a class="solid" href="kocka.html">${esc(t('openCube'))}</a>
        <a href="#/vitrina">${esc(t('showcase'))}${showcase.length ? ` (${showcase.length})` : ''}</a>
        <a href="#/kocka">${esc(t('getCube'))}</a>
      </div>
    </section>
    <p class="note">v${VERSION}</p>`;
}

function renderGallery(gid) {
  const g = DATA.galleries.find(x => x.id === gid);
  if (!g) return renderHome();
  document.title = `${tx(g.name)} – ${DATA.museum.name}`;
  $('#view').innerHTML = `
    <header class="page-h"><h1>${esc(tx(g.name))}</h1><p>${esc(tx(g.description))}</p></header>
    <div class="grid">${inGallery(gid).map(e => `
      <a class="tile" href="#/e/${encodeURIComponent(e.id)}">
        <div class="img">${thumb(e)}</div>
        <div class="t"><b>${esc(tx(e.name))}</b><small>${esc(tx(e.subtitle))}</small>${e.placeholder ? `<br><span class="badge">${esc(t('placeholder'))}</span>` : ''}</div>
      </a>`).join('')}</div>`;
}

const ICONS = {
  cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>',
  room: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3"/><path d="M12 7.5l4 2.3v4.4L12 16.5l-4-2.3V9.8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M12 9v6M9 12h6"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7h14v-7"/></svg>',
};

// size: {h: metres} (height) or {long: metres, label?: {me,en}} (longest dimension, e.g. a scythe or a wheel)
function sizeChip(e) {
  const s = e.size || {};
  if (s.h) return `<span class="size">${esc(t('height'))} ${esc(fmtSize(s.h))}</span>`;
  if (s.long) return `<span class="size">${esc(s.label ? tx(s.label) : t('length'))} ${esc(fmtSize(s.long))}</span>`;
  return '';
}
function fmtSize(m) {
  if (m >= 1) return (Math.round(m * 10) / 10).toLocaleString(lang === 'en' ? 'en' : 'sr-Latn-ME') + ' m';
  return Math.round(m * 100) + ' cm';
}

function renderExhibit(id) {
  const e = ex(id);
  if (!e) return renderHome();
  const g = DATA.galleries.find(x => x.id === e.gallery);
  document.title = `${tx(e.name)} – ${DATA.museum.name}`;
  $('#back').href = g ? `#/g/${encodeURIComponent(g.id)}` : '#/';
  const inShow = showcase.includes(e.id);
  $('#view').innerHTML = `
    <div class="stage" id="stage"><div class="loading">${esc(t('loading'))}</div>
      ${sizeChip(e)}
      <span class="hint" id="hint">${esc(t('dragHint'))}</span></div>
    <header class="ex-h">
      <h1>${esc(tx(e.name))}</h1>
      <p class="sub">${esc(tx(e.subtitle))}${g ? ` · ${esc(tx(g.name))}` : ''}</p>
      ${e.placeholder ? `<span class="badge">${esc(t('placeholder'))}</span>` : ''}
    </header>
    <div class="actions">
      <a class="btn primary" href="kocka.html?id=${encodeURIComponent(e.id)}">${ICONS.cube}${esc(t('onCube'))}</a>
      <button class="btn" id="btnRoom">${ICONS.room}${esc(t('inRoom'))}</button>
      <button class="btn" id="btnShow" aria-pressed="${inShow}">${ICONS.plus}<span>${esc(t(inShow ? 'inShowcase' : 'addShowcase'))}</span></button>
      <button class="btn" id="btnShare">${ICONS.share}${esc(t('share'))}</button>
    </div>
    <p class="story">${esc(tx(e.description))}</p>
    ${e.facts && e.facts.length ? `<dl class="facts">${e.facts.map(f => `<dt>${esc(tx(f.k))}</dt><dd>${esc(tx(f.v))}</dd>`).join('')}</dl>` : ''}`;
  $('#btnRoom').addEventListener('click', () => startLifeSize(e));
  $('#btnShow').addEventListener('click', () => toggleShowcase(e));
  $('#btnShare').addEventListener('click', () => shareExhibit(e));
  mountViewer($('#stage'), e);
}

function toggleShowcase(e) {
  const i = showcase.indexOf(e.id);
  if (i >= 0) showcase.splice(i, 1);
  else {
    if (showcase.length >= MAX_SHOW) return toast(t('showcaseFull'));
    showcase.push(e.id);
  }
  store.set('gkb.vitrina', showcase);
  const on = showcase.includes(e.id), b = $('#btnShow');
  b.setAttribute('aria-pressed', String(on));
  b.querySelector('span').textContent = t(on ? 'inShowcase' : 'addShowcase');
  toast(t(on ? 'addedShowcase' : 'removedShowcase'));
}

async function shareExhibit(e) {
  const url = location.href.split('#')[0] + '#/e/' + encodeURIComponent(e.id);
  try {
    if (navigator.share) { await navigator.share({ title: tx(e.name), text: DATA.museum.name, url }); return; }
    await navigator.clipboard.writeText(url); toast(t('linkCopied'));
  } catch { /* cancelled */ }
}

function renderShowcase() {
  document.title = `${t('showcase')} – ${DATA.museum.name}`;
  const items = showcase.map(ex).filter(Boolean);
  $('#view').innerHTML = `
    <header class="page-h"><h1>${esc(t('showcase'))}</h1><p>${esc(t('showcaseText'))}</p></header>
    ${items.length ? `<ol class="show-list">${items.map((e, i) => `
      <li><span class="face" title="${esc(t('face'))} ${i + 1}">${i + 1}</span>${thumb(e)}<b>${esc(tx(e.name))}</b>
      <button data-rm="${esc(e.id)}" aria-label="${esc(t('remove'))}">×</button></li>`).join('')}</ol>
      <div class="actions"><a class="btn primary wide" href="kocka.html?ids=${items.map(e => encodeURIComponent(e.id)).join(',')}">${ICONS.cube}${esc(t('openShowcase'))}</a></div>`
      : `<div class="empty">${esc(t('showcaseEmpty'))}</div>`}
    <div class="section-h"><h2>${esc(t('addFrom'))}</h2></div>
    <div class="grid">${DATA.exhibits.filter(e => !showcase.includes(e.id)).map(e => `
      <button class="tile" data-add="${esc(e.id)}" style="border:0;cursor:pointer;text-align:left;padding:0">
        <div class="img">${thumb(e)}</div><div class="t"><b>${esc(tx(e.name))}</b><small>+ ${esc(t('add'))}</small></div></button>`).join('')}</div>`;
  for (const b of document.querySelectorAll('[data-rm]')) b.addEventListener('click', () => { showcase = showcase.filter(x => x !== b.dataset.rm); store.set('gkb.vitrina', showcase); renderShowcase(); });
  for (const b of document.querySelectorAll('[data-add]')) b.addEventListener('click', () => {
    if (showcase.length >= MAX_SHOW) return toast(t('showcaseFull'));
    showcase.push(b.dataset.add); store.set('gkb.vitrina', showcase); renderShowcase();
  });
}

function renderCubeInfo() {
  document.title = `${t('getCube')} – ${DATA.museum.name}`;
  $('#view').innerHTML = `
    <header class="page-h"><h1>${esc(t('getCube'))}</h1><p>${esc(t('cubeInfo'))}</p></header>
    <div class="facts" style="grid-template-columns:1fr">
      <div><b>${esc(t('print3d'))}</b><br><span class="note">${esc(t('print3dText'))}</span><br>
        <a href="print/AR_cube_70mm_2colour.3mf" download>3MF</a> · <a href="print/AR_cube_70mm_STL.zip" download>STL (zip)</a></div>
      <div><b>${esc(t('printPaper'))}</b><br><span class="note">${esc(t('printPaperText'))}</span><br>
        <a href="print/AR_cube_paper_test.pdf" target="_blank" rel="noopener">PDF</a></div>
    </div>
    <div class="actions"><a class="btn primary wide" href="kocka.html">${ICONS.cube}${esc(t('openCube'))}</a></div>`;
}

let toastT = 0;
function toast(m) { const el = $('#toast'); el.textContent = m; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600); }

// ---------------- 3D viewer ----------------
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const modelCache = new Map();
function loadModel(url) {
  if (!modelCache.has(url)) modelCache.set(url, loader.loadAsync(url).then(g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g.scene;
  }));
  return modelCache.get(url);
}
// wrap a model so its base sits on y=0, centred, with a known height; returns {group, height}
function normalise(src) {
  const obj = src.clone(true);
  const g = new THREE.Group(); g.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  const size = box.getSize(new THREE.Vector3());
  return { group: g, size };
}

const V = { renderer: null, scene: null, camera: null, controls: null, item: null, host: null, ro: null, ground: null, sun: null, interacted: false };
function ensureViewer() {
  if (V.renderer) return;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
  r.xr.enabled = true;
  V.renderer = r;
  V.scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(r);
  V.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  V.scene.environment = V.env; V.scene.environmentIntensity = 0.8;
  V.sun = new THREE.DirectionalLight(0xfff3e2, 1.6); V.sun.position.set(-1.2, 2.4, 1.6); V.sun.castShadow = true;
  V.sun.shadow.mapSize.set(1024, 1024);
  V.scene.add(V.sun, V.sun.target, new THREE.HemisphereLight(0xffffff, 0x8a7d6a, 0.5));
  V.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.22 }));
  V.ground.rotation.x = -Math.PI / 2; V.ground.receiveShadow = true; V.scene.add(V.ground);
  V.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  V.controls = new OrbitControls(V.camera, r.domElement);
  Object.assign(V.controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, autoRotate: true, autoRotateSpeed: 0.9, rotateSpeed: 0.8 });
  V.controls.addEventListener('start', () => { V.interacted = true; V.controls.autoRotate = false; const h = $('#hint'); if (h) h.style.opacity = '0'; });
  V.ro = new ResizeObserver(() => sizeViewer());
  r.setAnimationLoop(frameLoop);
}
function sizeViewer() {
  if (!V.host || V.renderer.xr.isPresenting) return;
  const w = V.host.clientWidth, h = V.host.clientHeight;
  if (!w || !h) return;
  V.renderer.setSize(w, h, false);
  V.camera.aspect = w / h; V.camera.updateProjectionMatrix();
}
async function mountViewer(host, e) {
  ensureViewer();
  V.host = host; host.appendChild(V.renderer.domElement); V.ro.observe(host); sizeViewer();
  V.interacted = false; V.controls.autoRotate = true;
  const token = (V.token = {});
  try {
    const src = await loadModel(e.model);
    if (V.token !== token) return;
    if (V.item) V.scene.remove(V.item);
    const { group, size } = normalise(src);
    const k = 1 / Math.max(size.x, size.y, size.z);   // viewer works in a unit box
    group.scale.setScalar(k);
    V.item = group; V.scene.add(group);
    const h = size.y * k, r = 0.5 * Math.hypot(size.x, size.y, size.z) * k;
    V.ground.scale.setScalar(Math.max(size.x, size.z) * k * 0.9);
    V.controls.target.set(0, h * 0.45, 0);
    // fit the bounding sphere into the narrower of the two view angles
    const vf = THREE.MathUtils.degToRad(V.camera.fov / 2), hf = Math.atan(Math.tan(vf) * Math.max(0.3, V.camera.aspect || 1));
    const dist = r / Math.sin(Math.min(vf, hf)) * 1.02;
    // flat objects (lying tools) are shown from higher up
    const flat = h / Math.max(size.x * k, size.z * k) < 0.25;
    const el = flat ? 0.95 : 0.32, fw = Math.sqrt(Math.max(0.05, 1 - el * el));
    V.camera.position.set(dist * 0.58 * fw, h * 0.45 + dist * el, dist * 0.81 * fw);
    V.camera.near = dist / 50; V.camera.far = dist * 20; V.camera.updateProjectionMatrix();
    V.controls.minDistance = dist * 0.35; V.controls.maxDistance = dist * 2.5;
    V.controls.update();
    host.querySelector('.loading')?.remove();
  } catch (err) {
    const l = host.querySelector('.loading'); if (l) l.textContent = t('modelError');
  }
}
function leaveViewer() {
  if (!V.renderer || V.renderer.xr.isPresenting) return;
  V.token = null;
  if (V.host) { V.ro.unobserve(V.host); V.renderer.domElement.remove(); V.host = null; }
}
function frameLoop(time, frame) {
  if (V.renderer.xr.isPresenting && XR.session) return xrFrame(frame);
  if (!V.host) return;
  V.controls.update();
  V.renderer.render(V.scene, V.camera);
}

// ---------------- life-size AR ----------------
const XR = { session: null, hitSource: null, scene: null, reticle: null, model: null, placed: false, real: 1, mini: false, kind: 'object', ex: null };
async function startLifeSize(e) {
  let xrOK = false;
  try { xrOK = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { xrOK = false; }
  if (xrOK) return startWebXR(e);
  const a = document.createElement('a');
  if (a.relList && a.relList.supports && a.relList.supports('ar')) return quickLook(e);
  toast(t('noAR'));
}

async function realScaleModel(e) {
  const src = await loadModel(e.model);
  const { group, size } = normalise(src);
  const s = e.size || {};
  const k = s.h ? s.h / size.y : s.long ? s.long / Math.max(size.x, size.y, size.z) : 1;   // model units -> metres
  group.scale.setScalar(k);
  return { group, metres: size.clone().multiplyScalar(k) };
}

async function startWebXR(e) {
  ensureViewer();
  const { group, metres } = await realScaleModel(e);
  XR.ex = e; XR.kind = e.kind || 'object';
  XR.mini = XR.kind === 'building' && metres.y > 3;           // buildings start as a 1:50 model
  XR.real = group.scale.x;
  const holder = new THREE.Group(); holder.add(group); holder.visible = false;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(Math.max(metres.x, metres.z) * 0.75, 48), new THREE.ShadowMaterial({ opacity: 0.3 }));
  shadow.rotation.x = -Math.PI / 2; shadow.receiveShadow = true; group.add(shadow); shadow.scale.setScalar(1 / XR.real);
  XR.model = holder;
  const s = new THREE.Scene();
  s.environment = V.env; s.environmentIntensity = 0.9;
  const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(-2, 6, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  const r = Math.max(metres.x, metres.y, metres.z);
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: 50 });
  sun.target = holder;
  s.add(sun, new THREE.HemisphereLight(0xffffff, 0x777777, 0.6), holder);
  const ret = new THREE.Mesh(new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ret.matrixAutoUpdate = false; ret.visible = false; s.add(ret);
  XR.scene = s; XR.reticle = ret; XR.placed = false;
  applyXRScale();
  const ov = $('#xrOverlay');
  ov.hidden = false;
  $('#xrMsg').textContent = t('xrFind');
  $('#xrClose').textContent = t('close');
  for (const b of ov.querySelectorAll('button')) b.addEventListener('beforexrselect', ev => ev.preventDefault());
  $('#xrClose').onclick = () => XR.session && XR.session.end();
  $('#xrScale').onclick = () => { XR.mini = !XR.mini; applyXRScale(); };
  $('#xrScale').hidden = XR.kind !== 'building';
  try {
    const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: ov } });
    XR.session = session;
    V.renderer.xr.setReferenceSpaceType('local');
    await V.renderer.xr.setSession(session);
    const viewerSpace = await session.requestReferenceSpace('viewer');
    XR.hitSource = await session.requestHitTestSource({ space: viewerSpace });
    session.addEventListener('select', placeModel);
    session.addEventListener('end', () => {
      XR.session = null; XR.hitSource = null; ov.hidden = true;
      XR.scene = null; sizeViewer();
    });
  } catch (err) {
    ov.hidden = true; toast(t('noAR'));
  }
}
function applyXRScale() {
  const g = XR.model && XR.model.children[0];
  if (!g) return;
  g.scale.setScalar(XR.real * (XR.mini ? 1 / 50 : 1));
  $('#xrScale').textContent = XR.mini ? t('xrRealSize') : t('xrModelSize');
}
const tmpV = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
function placeModel() {
  if (!XR.reticle.visible) return;
  XR.reticle.matrix.decompose(tmpP, tmpQ, tmpS);
  XR.model.position.copy(tmpP);
  const cam = V.renderer.xr.getCamera();
  cam.getWorldPosition(tmpV);
  XR.model.rotation.set(0, Math.atan2(tmpV.x - tmpP.x, tmpV.z - tmpP.z), 0);   // front (+Z) faces the visitor
  XR.model.visible = true; XR.placed = true;
  $('#xrMsg').textContent = t('xrPlaced');
}
function xrFrame(frame) {
  if (!frame || !XR.scene) return;
  const ref = V.renderer.xr.getReferenceSpace();
  if (XR.hitSource) {
    const hits = frame.getHitTestResults(XR.hitSource);
    if (hits.length) {
      const pose = hits[0].getPose(ref);
      XR.reticle.visible = true; XR.reticle.matrix.fromArray(pose.transform.matrix);
      if (!XR.placed) $('#xrMsg').textContent = t('xrTap');
    } else XR.reticle.visible = false;
  }
  V.renderer.render(XR.scene, V.camera);
}

async function quickLook(e) {
  toast(t('preparing'));
  try {
    const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js');
    const { group } = await realScaleModel(e);
    const s = new THREE.Scene(); s.add(group); s.updateMatrixWorld(true);
    const buf = await new USDZExporter().parseAsync(s, { quickLookCompatible: true });
    const url = URL.createObjectURL(new Blob([buf], { type: 'model/vnd.usdz+zip' }));
    const a = document.createElement('a'); a.rel = 'ar'; a.href = url;
    a.appendChild(document.createElement('img'));
    document.body.appendChild(a); a.click(); a.remove();
  } catch { toast(t('noAR')); }
}

window.__gkb = { V, XR, get lang() { return lang; } };
