// Muzej na kocki (kocka.html): exhibits of Gusinjska kulturna baština on the printed AR cube.
// Works in Safari on iPhone and in Chrome on Android: no WebXR, only the camera picture, OpenCV marker
// tracking in a background worker, and three.js drawing over the same frame that was tracked.
import { Stage } from './stage.js';
import { CubeTracking } from './tracking.js';
import { Camera } from './camera.js';
import { S as STR } from './strings.js';
import { L, HTML_LANG } from '../i18n.js';
import { mulv } from '../cv/pose.js';

const VERSION = '2.0';
const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const D2R = Math.PI / 180;
const now = () => performance.now() / 1000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- language ----------------
function detectLang() {
  const n = (navigator.languages || [navigator.language || 'me']).map(x => x.toLowerCase());
  for (const l of n) { if (l.startsWith('sq')) return 'sq'; if (/^(sr|bs|hr|me|cnr|sh)/.test(l)) return 'me'; if (l.startsWith('en')) return 'en'; }
  return 'me';
}
let lang = params.get('lang') || (() => { try { return JSON.parse(localStorage.getItem('gkb.lang')); } catch { return null; } })() || detectLang();
if (!STR[lang]) lang = 'me';
const t = (k, vars) => { let s = STR[lang][k] ?? STR.me[k] ?? k; if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b); return s; };

// ---------------- settings (per viewer, in this browser) ----------------
const SKEY = 'gkb.cube2.settings';
const DEFAULTS = { plinth: 'stone', place: 'top', upright: true, shadows: true, vitrine: false, view: 'fill', zoomOut: 1, debug: false, camId: null, camManual: false, fovFix: 0, strip: true, spin: false };
const settings = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; } })() || {});
if (params.has('debug')) settings.debug = true;
if (params.has('fov')) settings.fovFix = +params.get('fov') || 0;
if (params.get('place') === 'hand' || params.get('place') === 'top') settings.place = params.get('place');
const save = () => { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch { /* private mode */ } };

// ---------------- state ----------------
const video = $('#cam'), gl = $('#gl'), dbgCanvas = $('#dbg'), dbg = dbgCanvas.getContext('2d');
let layout, data, exhibits = [], galleries = [], showList = [], current = null, galleryFilter = 'all';
let stage, tracking, camera;
let running = false, startedAt = 0;
const sensor = { ok: false, beta: 0, gamma: 0, t: 0 };
const ui = { foundAt: -10, lostAt: -10, firstFound: false, hintT: 0, tipI: 0, dirty: true, base: 0, lastRender: 0, renderMs: 0, frames: 0 };

// ---------------- boot ----------------
applyTexts();
boot();
async function boot() {
  try {
    [layout, data] = await Promise.all([fetch('data/layout.json').then(r => r.json()), fetch('data/exhibits.json').then(r => r.json())]);
  } catch (e) { fail(t('errData')); return; }
  galleries = data.galleries;
  exhibits = data.exhibits.map(e => ({ ...e, file: e.model }));
  const ids = (params.get('ids') || '').split(',').filter(Boolean);
  showList = ids.map(id => exhibits.find(e => e.id === id)).filter(Boolean);
  stage = new Stage(gl, layout);
  stage.setPlinth(settings.plinth); stage.opts.place = settings.place; stage.setShadows(settings.shadows); stage.opts.vitrine = settings.vitrine;
  stage.pixK = 1;
  addEventListener('resize', onResize); addEventListener('orientationchange', () => setTimeout(onResize, 300));
  video.addEventListener('resize', onResize);
  stage.startPreview(previewShift(), previewFill(), previewShiftX());
  buildCollection();
  const want = params.get('id') || params.get('model') || (showList[0] && showList[0].id) || pickOfTheDay();
  select(want, { quiet: true });
  bindUI();
  checkBrowser();
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__cube = api;
}
function pickOfTheDay() {
  const light = exhibits.filter(e => !e.heavy && e.featured);
  const pool = light.length ? light : exhibits.filter(e => !e.heavy);
  const d = Math.floor(Date.now() / 864e5);
  return (pool[d % pool.length] || exhibits[0]).id;
}
// frame the start-screen turntable inside the empty stage area above (or beside) the text
function stageBox() {
  const r = $('.st-stage').getBoundingClientRect(), W = innerWidth, H = innerHeight;
  const h = Math.max(120, r.height - 30), cy = r.top + h / 2, cx = r.left + r.width / 2;
  return { offY: (H / 2 - cy) / H, offX: (W / 2 - cx) / W, fill: clamp(h / H * 0.86, 0.2, 0.7) };
}
function previewShift() { return stageBox().offY; }
function previewFill() { return stageBox().fill; }
function previewShiftX() { return stageBox().offX; }
function onResize() {
  if (!stage) return;
  if (stage.mode === 'preview') { stage.previewOffset = previewShift(); stage.previewFill = previewFill(); stage.previewOffsetX = previewShiftX(); }
  stage.resize(); updateProjection();
  dbgCanvas.width = gl.width; dbgCanvas.height = gl.height;
  ui.dirty = true;
}

// ---------------- texts ----------------
function applyTexts() {
  document.documentElement.lang = HTML_LANG[lang] || 'sr-ME';
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
  for (const el of document.querySelectorAll('[data-t-title]')) el.title = t(el.dataset.tTitle);
  for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.l === lang));
  $('#ver').textContent = VERSION;
}
function setLang(l) {
  if (!STR[l] || l === lang) return;
  lang = l;
  try { localStorage.setItem('gkb.lang', JSON.stringify(l)); } catch { /* ignore */ }
  applyTexts();
  if (exhibits.length) { buildCollection(); paintExhibit(); if (current && stage) stage.drawPlate(plateFor(current)); }
  paintSettings(); paintStatus(true);
}

// ---------------- collection: galleries and the film strip ----------------
function galleryName(id) { const g = galleries.find(x => x.id === id); return g ? L(g.name, lang) : ''; }
function visibleList() {
  if (showList.length) return showList;
  return galleryFilter === 'all' ? exhibits : exhibits.filter(e => e.gallery === galleryFilter);
}
function buildCollection() {
  const chips = $('#galChips'); chips.innerHTML = '';
  if (showList.length) {
    chips.innerHTML = `<span class="chip on">${esc(t('showcase'))} (${showList.length})</span>`;
  } else {
    const mk = (id, label) => { const b = document.createElement('button'); b.className = 'chip'; b.dataset.g = id; b.textContent = label; b.setAttribute('aria-pressed', String(galleryFilter === id)); b.onclick = () => { galleryFilter = id; buildCollection(); scrollToCurrent(true); }; chips.append(b); };
    mk('all', t('all'));
    for (const g of galleries) if (exhibits.some(e => e.gallery === g.id)) mk(g.id, L(g.name, lang));
  }
  const strip = $('#strip'); strip.innerHTML = '';
  visibleList().forEach((e, i) => {
    const b = document.createElement('button');
    b.className = 'thumb'; b.dataset.id = e.id; b.setAttribute('aria-pressed', String(current && current.id === e.id));
    b.setAttribute('aria-label', L(e.name, lang));
    b.innerHTML = `<span class="ti"><img src="${esc(e.thumb)}" alt="" loading="lazy" decoding="async"></span><span class="tn">${showList.length ? `<b>${i + 1}</b> ` : ''}${esc(L(e.name, lang))}</span>`;
    b.onclick = () => select(e.id);
    strip.append(b);
  });
  scrollToCurrent(false);
}
function scrollToCurrent(smooth) {
  if (!current) return;
  const b = $(`#strip .thumb[data-id="${CSS.escape(current.id)}"]`);
  if (b) b.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'center', block: 'nearest' });
  const c = $(`#galChips .chip[aria-pressed="true"]`);
  if (c) c.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', inline: 'nearest', block: 'nearest' });
}
function plateFor(e) { return { name: L(e.name, lang), plateSub: (galleryName(e.gallery) || 'Gusinje').toUpperCase(), yaw: e.yaw, fit: e.fit }; }

async function select(id, opts = {}) {
  const e = exhibits.find(x => x.id === id) || exhibits[0];
  if (!e) return;
  current = e;
  for (const b of document.querySelectorAll('#strip .thumb')) b.setAttribute('aria-pressed', String(b.dataset.id === e.id));
  paintExhibit();
  scrollToCurrent(!opts.quiet);
  try { const u = new URL(location.href); u.searchParams.set(showList.length ? 'model' : 'id', e.id); history.replaceState(null, '', u); } catch { /* ignore */ }
  setLoading(0);
  try {
    const m = Object.assign(plateFor(e), { id: e.id, file: e.file });
    const ok = await stage.load(m, p => setLoading(p));
    if (ok === false) return;
  } catch (err) {
    toast(L(e.name, lang) + ': ' + (err && err.message || err));
  } finally { if (current === e) setLoading(null); }
  ui.dirty = true;
}
function step(dir) {
  const list = visibleList();
  const i = list.findIndex(e => current && e.id === current.id);
  const n = list[(i + dir + list.length) % list.length];
  if (n) select(n.id);
}
function paintExhibit() {
  if (!current) return;
  $('#exGallery').textContent = galleryName(current.gallery);
  $('#exName').textContent = L(current.name, lang);
  $('#exSub').textContent = L(current.subtitle, lang);
  $('#stName').textContent = L(current.name, lang);
}
function setLoading(p) {
  const bar = $('#loadBar');
  if (p == null) { bar.classList.remove('on'); bar.style.setProperty('--p', 1); $('#exSub').textContent = current ? L(current.subtitle, lang) : ''; return; }
  bar.classList.add('on'); bar.style.setProperty('--p', p.toFixed(3));
  $('#exSub').textContent = `${t('loading')} ${Math.round(p * 100)} %`;
}

// ---------------- start the camera ----------------
async function start() {
  const err = $('#err'); err.hidden = true;
  const sensorP = enableSensors();             // must run inside the tap (iOS asks for permission)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fail(t('errApi'));
  const go = $('#go'); go.disabled = true; go.querySelector('span').textContent = t('starting');
  camera = new Camera(video, settings, save, {
    toast, text: t,
    fov: k => { if (tracking) tracking.rescale(k); updateProjection(); paintSettings(); },
    change: () => { if (tracking) tracking.reset(); updateProjection(); paintCamera(); },
    list: paintCamera,
    narrow: fov => toast(t('lensNarrow', { fov })),
    stall: () => { $('#stall').hidden = false; },
    resume: () => { $('#stall').hidden = true; },
  });
  try {
    const saved = settings.camId && (settings.camManual || (camera.lensFov(settings.camId) || 0) >= 40) ? settings.camId : null;
    await camera.open(saved);
  } catch (e) {
    go.disabled = false; go.querySelector('span').textContent = t('start');
    const n = e && e.name;
    return fail(n === 'NotAllowedError' || n === 'SecurityError' ? t('errBlocked') : n === 'NotFoundError' || n === 'OverconstrainedError' ? t('errNoCam') : t('errStart') + ' (' + ((e && e.message) || e) + ')');
  }
  await sensorP;
  tracking = new CubeTracking(layout, {
    workerUrl: 'js/kocka/cv-worker.js', opencvUrl: '../vendor/opencv/opencv.js',
    useOpenCV: params.get('det') !== 'own',
    onLearn: (res, K) => camera.learn(res, K, tracking.tracker.targets.cube),
  });
  document.body.classList.add('ar');
  $('#start').hidden = true;
  for (const id of ['#hud', '#panel', '#side']) $(id).hidden = false;
  stage.startAR();
  onResize();
  running = true; startedAt = now(); ui.hintT = now();
  keepAwake();
  runVideoLoop();
  await camera.listCameras();
  camera.pickMain();
  paintStatus(true);
  if (!settings.seenGestures) setTimeout(() => { if (running) { toast(t('gestures'), 5200); settings.seenGestures = true; save(); } }, 9000);
}
function fail(msg) { const e = $('#err'); e.textContent = msg; e.hidden = false; }

async function enableSensors() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return;
    }
    addEventListener('deviceorientation', e => {
      if (e.beta == null || e.gamma == null) return;
      sensor.ok = true; sensor.beta = e.beta; sensor.gamma = e.gamma; sensor.t = performance.now();
    });
  } catch { /* no tilt sensor: the side facing up on screen is used */ }
}
let wakeLock = null;
async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ } }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !running) return;
  keepAwake();
  // iPhone ends the camera when the app goes to the background: start it again
  setTimeout(() => { if (camera && (camera.track?.readyState === 'ended' || video.paused)) camera.restart(); }, 300);
});

// ---------------- camera frames -> tracking -> picture ----------------
let slot = 0;
function runVideoLoop() {
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const cb = () => { try { onVideoFrame(); } catch (e) { console.error(e); } video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
    ui.loop = 'rvfc';
  } else {
    let last = -1;
    const raf = () => { if (video.currentTime !== last) { last = video.currentTime; try { onVideoFrame(); } catch (e) { console.error(e); } } requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    ui.loop = 'raf';
  }
}
function onVideoFrame() {
  camera.frameArrived();
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh || !tracking || tracking.busy) return;
  if (vw !== stage.view.vw || vh !== stage.view.vh) { camera.loadFov(); updateProjection(); }
  const s = slot; slot = 1 - slot;
  const g0 = performance.now();
  const src = stage.grab(video, s);
  ui.grabMs = (ui.grabMs || 0) * 0.85 + 0.15 * (performance.now() - g0);
  tracking.submit(src, vw, vh, camera.intrinsics(), now(), s, onResult);
}

function onResult(res) {
  stage.show(res.slot);
  stage.setLight(tracking.light);
  const tt = res.t, act = res.active;
  if (act !== stage.target) onTargetChange(act, res.prevActive, tt);
  for (const k of ['cube', 'card']) stage.setPose(k, k === act ? tracking.T[k] : null);
  if (act === 'cube') updateBase(tracking.T.cube, false);
  if (tracking.frameNo % 15 === 0 && camera.lens.searching) camera.checkLens();
  ui.dirty = true; ui.frames++;
  paintStatus();
  if (window.__cubeLog) testLog(res);
}
// automated tests: record which video frame was shown with which pose (frame number stamped by tools/tests/cube_video.py)
function testLog(res) {
  const c = stage.frames[res.slot].canvas.getContext('2d').getImageData(0, 0, 132, 18).data;
  let code = 0;
  for (let b = 0; b < 12; b++) code = (code << 1) | (c[(9 * 132 + 10 + b * 10) * 4] > 128 ? 1 : 0);
  const st = tracking.T.cube, p = res.poses.cube;
  window.__cubeLog.push({ code, active: res.active, n: p ? p.n : 0, rms: p ? p.rms : null, R: p ? p.R : null, t: p ? p.t : null, q: st.q, tf: st.t, fov: camera.fov.value, det: tracking.detector, ms: tracking.stats.latency });
}

function onTargetChange(next, prev, tt) {
  stage.setTarget(next);
  if (next) {
    const away = tt - (tracking.T[next].lostAt || -10);
    if (next === 'cube' && (prev !== 'cube' || away > 1.5)) chooseBase(tracking.T.cube);
    if (away > 1.5) {
      stage.setPose(next, tracking.T[next]);
      stage.faceCamera(false);
      stage.startReveal(1);
      if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* ignore */ }
    }
    ui.foundAt = tt;
    if (!ui.firstFound) { ui.firstFound = true; }
  } else ui.lostAt = tt;
}

// ---------------- which side of the cube is "up" ----------------
// world up in OpenCV camera coordinates (x right, y down, z forward), from the tilt sensor
function upInCamera() {
  if (!sensor.ok || performance.now() - sensor.t > 1500) return null;
  const b = sensor.beta * D2R, g = sensor.gamma * D2R;
  const ux = -Math.cos(b) * Math.sin(g), uy = Math.sin(b), uz = Math.cos(b) * Math.cos(g);
  const th = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * D2R;
  const sx = ux * Math.cos(th) - uy * Math.sin(th), sy = ux * Math.sin(th) + uy * Math.cos(th);
  return [sx, -sy, -uz];
}
function faceScores(R) {
  const up = settings.upright ? upInCamera() : null;
  return layout.faces.map(f => { const n = mulv(R, f.N); return up ? n[0] * up[0] + n[1] * up[1] + n[2] * up[2] : (n[2] < 0.15 ? -n[1] : -9); });
}
function chooseBase(st) {
  if (!st.raw) return;
  const sc = faceScores(st.raw.R);
  let best = 0; for (let i = 1; i < 6; i++) if (sc[i] > sc[best]) best = i;
  if (!settings.upright && !showList.length) best = 0;
  ui.base = best;
  stage.setBase(layout.faces[best].N, false);
  onBaseChange(best);
}
function updateBase(st) {
  if (!st.raw || (!settings.upright && !showList.length)) return;
  if (settings.upright && !upInCamera() && !showList.length) return;
  const sc = faceScores(st.raw.R);
  let best = 0; for (let i = 1; i < 6; i++) if (sc[i] > sc[best]) best = i;
  if (best !== ui.base && sc[best] > sc[ui.base] + 0.3) {
    ui.base = best;
    stage.setBase(layout.faces[best].N, true);
    onBaseChange(best);
  }
}
function onBaseChange(face) {
  if (showList.length < 2) return;
  const e = showList[face % showList.length];
  if (!current || current.id !== e.id) { select(e.id); toast(`${t('side')} ${face % showList.length + 1}: ${L(e.name, lang)}`); }
}

// ---------------- projection ----------------
function updateProjection() {
  if (!stage || stage.mode !== 'ar' || !camera || !video.videoWidth) return;
  stage.setProjection(camera.intrinsics(), video.videoWidth, video.videoHeight, settings.view, settings.zoomOut);
  ui.dirty = true;
}

// ---------------- the draw loop (display rate) ----------------
let lastT = now(), slowFrames = 0, fastFrames = 0, stallCheck = 0;
function frame() {
  requestAnimationFrame(frame);
  if (!stage) return;
  const tt = now(), dt = Math.min(0.1, tt - lastT); lastT = tt;
  if (stage.mode === 'preview') {
    if (document.visibilityState === 'visible' && !$('#start').hidden) { stage.render(tt); }
    return;
  }
  // spin: auto-turn, or the flick of a finger slowing down
  const p = stage.place;
  if (settings.spin && !drag.on) p.spin = 0.55;
  else if (!drag.on && p.spin) { p.spin *= Math.exp(-dt * 2.6); if (Math.abs(p.spin) < 0.03) p.spin = 0; }
  const anim = p.spin || p.dur > 0 || p.yt0 > 0 || stage.reveal.t0 >= 0 || stage.plateFadeDir;
  if (ui.dirty || anim) {
    const r0 = performance.now();
    stage.render(tt);
    const ms = performance.now() - r0;
    ui.renderMs = ui.renderMs * 0.9 + ms * 0.1;
    ui.dirty = false;
    // drawing too slow for this phone: draw fewer pixels (and more again when there is room)
    if (ui.renderMs > 22) { if (++slowFrames > 40 && stage.pixK > 0.6) { stage.pixK = Math.max(0.6, stage.pixK - 0.15); onResize(); slowFrames = 0; } } else slowFrames = 0;
    if (ui.renderMs < 8) { if (++fastFrames > 240 && stage.pixK < 1) { stage.pixK = Math.min(1, stage.pixK + 0.1); onResize(); fastFrames = 0; } } else fastFrames = 0;
  }
  drawDebug();
  if (tt - stallCheck > 0.5) { stallCheck = tt; if (camera) camera.checkStall(); paintStatus(); }
}

// ---------------- status, hints ----------------
let lastStatus = '';
function paintStatus(force) {
  if (!running) return;
  const tt = now(), act = tracking && tracking.active;
  const key = (act ? 'on:' + (current && current.id) : 'off') + lang + (tracking ? tracking.detector : '');
  const hint = $('#hint');
  if (act) hint.classList.add('off');
  else if (tt - Math.max(ui.lostAt, ui.hintT) > 1.0) hint.classList.remove('off');
  // rotating tips while searching
  if (!act && tt - ui.tipT > 3.6) { ui.tipT = tt; ui.tipI = (ui.tipI + 1) % 3; $('#tip').textContent = t('tip' + (ui.tipI + 1)); }
  if (!force && key === lastStatus) return;
  lastStatus = key;
  const pill = $('#status');
  pill.classList.toggle('ok', !!act);
  $('#statusText').textContent = act ? '' : t('looking');
  pill.setAttribute('aria-label', act ? t('found') : t('looking'));
  if (!ui.tipT) { ui.tipT = tt; $('#tip').textContent = t('tip1'); }
}

// ---------------- gestures on the camera view ----------------
const drag = { on: false, id: null, x: 0, y: 0, x0: 0, y0: 0, t0: 0, moved: false, vx: 0, lastX: 0, lastT: 0 };
const pinch = { on: false, d0: 0, s0: 1 };
const pointers = new Map();
let lastTap = { t: 0, x: 0, y: 0 }, tapTimer = 0;
function bindGestures() {
  const el = gl;
  // start screen: drag to turn the exhibit on its pedestal
  let pv = null;
  el.addEventListener('pointerdown', e => { if (stage.mode === 'preview') pv = e.clientX; });
  el.addEventListener('pointermove', e => { if (pv != null && stage.mode === 'preview') { stage.preview.drag += (e.clientX - pv) * 0.012; pv = e.clientX; } });
  el.addEventListener('pointerup', () => { pv = null; });
  el.addEventListener('pointerdown', e => {
    if (stage.mode !== 'ar') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch.on = true; pinch.d0 = Math.hypot(a.x - b.x, a.y - b.y); pinch.s0 = stage.opts.size; drag.on = false;
      return;
    }
    Object.assign(drag, { on: true, id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: now(), moved: false, vx: 0, lastX: e.clientX, lastT: now() });
    stage.place.spin = 0;
  });
  el.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.on && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      stage.opts.size = clamp(pinch.s0 * d / Math.max(10, pinch.d0), 0.4, 3);
      stage.fitModel(); ui.dirty = true;
      badge(t('sizeX', { x: stage.opts.size.toFixed(1) }));
      return;
    }
    if (!drag.on || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 8) drag.moved = true;
    if (drag.moved) {
      settings.spin = false; paintActions();
      stage.nudgeYaw(dx * 0.011);
      const tt = now(), dtt = Math.max(1 / 120, tt - drag.lastT);
      drag.vx = 0.7 * drag.vx + 0.3 * ((e.clientX - drag.lastX) * 0.011 / dtt);
      drag.lastX = e.clientX; drag.lastT = tt;
      ui.dirty = true;
    }
    drag.x = e.clientX;
  });
  const up = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch.on) { if (pointers.size < 2) pinch.on = false; return; }
    if (!drag.on || e.pointerId !== drag.id) return;
    drag.on = false;
    if (drag.moved) { if (now() - drag.lastT < 0.08) stage.place.spin = clamp(drag.vx, -8, 8); return; }
    // a tap: double tap resets; a single tap on the exhibit opens its story
    const tt = now(), x = e.clientX, y = e.clientY;
    if (tt - lastTap.t < 0.32 && Math.hypot(x - lastTap.x, y - lastTap.y) < 40) {
      clearTimeout(tapTimer); lastTap.t = 0;
      stage.opts.size = 1; stage.fitModel(); stage.faceCamera(true); settings.spin = false; paintActions(); ui.dirty = true;
      return;
    }
    lastTap = { t: tt, x, y };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { if (stage.hitExhibit(x, y)) openSheet('sheetInfo'); }, 330);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); drag.on = false; pinch.on = false; });
  // swipe the exhibit card for the next / previous exhibit
  const card = $('#exCard');
  let sx = 0, sy = 0, st = 0;
  card.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = now(); }, { passive: true });
  card.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy) && now() - st < 0.6) step(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---------------- photo ----------------
let photoCanvas = null, photoUrl = null;
async function takePhoto() {
  if (!stage || stage.mode !== 'ar') return;
  $('#flash').classList.remove('go'); void $('#flash').offsetWidth; $('#flash').classList.add('go');
  try {
    const shot = stage.snapshot();
    const W = shot.width, H = shot.height, c = photoCanvas || (photoCanvas = document.createElement('canvas'));
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(shot, 0, 0);
    const u = Math.max(W, H) / 900;
    const band = 120 * u, grad = g.createLinearGradient(0, H - band * 1.6, 0, H);
    grad.addColorStop(0, 'rgba(14,12,10,0)'); grad.addColorStop(1, 'rgba(14,12,10,0.78)');
    g.fillStyle = grad; g.fillRect(0, H - band * 1.6, W, band * 1.6);
    const serif = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Noto Serif", serif';
    g.fillStyle = '#f3ede3'; g.textBaseline = 'alphabetic';
    g.font = `600 ${38 * u}px ${serif}`; g.fillText(current ? L(current.name, lang) : '', 28 * u, H - 62 * u);
    g.fillStyle = 'rgba(243,237,227,0.78)'; g.font = `500 ${17 * u}px system-ui, -apple-system, sans-serif`;
    g.fillText(t('kicker'), 28 * u, H - 30 * u);
    try {
      const logo = await loadImg('icons/xplore-prokletije-light.png');
      const lh = 40 * u, lw = lh * logo.width / logo.height;
      g.globalAlpha = 0.92; g.drawImage(logo, W - lw - 24 * u, H - lh - 24 * u, lw, lh); g.globalAlpha = 1;
    } catch { /* no logo */ }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) throw new Error('blob');
    const name = `kocka-${current ? current.id : 'foto'}-${new Date().toISOString().slice(0, 10)}.jpg`;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    const url = photoUrl = URL.createObjectURL(blob);
    $('#photoImg').src = url;
    const a = $('#photoSave'); a.href = url; a.download = name;
    const file = new File([blob], name, { type: 'image/jpeg' });
    const sh = $('#photoShare');
    sh.hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    sh.onclick = async () => { try { await navigator.share({ files: [file], title: current ? L(current.name, lang) : '' }); } catch { /* cancelled */ } };
    openSheet('sheetPhoto');
  } catch (e) { toast(t('photoErr')); }
}
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

// ---------------- sheets, buttons, settings ----------------
function openSheet(id) {
  if (id === 'sheetInfo') paintInfo();
  if (id === 'sheetSettings') paintSettings();
  for (const s of document.querySelectorAll('.sheet')) { const on = s.id === id; s.classList.toggle('open', on); s.setAttribute('aria-hidden', String(!on)); }
  $('#scrim').classList.toggle('open', !!id);
}
function paintInfo() {
  if (!current) return;
  $('#infoGallery').textContent = galleryName(current.gallery);
  $('#infoTitle').textContent = L(current.name, lang);
  $('#infoSub').textContent = L(current.subtitle, lang);
  $('#infoDesc').textContent = L(current.description, lang);
  const kv = $('#infoKv'); kv.innerHTML = '';
  for (const f of (current.facts || [])) { const dt = document.createElement('dt'); dt.textContent = L(f.k, lang); const dd = document.createElement('dd'); dd.textContent = L(f.v, lang); kv.append(dt, dd); }
  $('#infoThumb').src = current.thumb;
  $('#infoLink').href = `index.html#/e/${encodeURIComponent(current.id)}`;
}
const ICON = {
  spin: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
  top: '<svg viewBox="0 0 24 24"><path d="M12 3l7 4v4l-7 4-7-4V7z"/><path d="M5 15l7 4 7-4"/></svg>',
  hand: '<svg viewBox="0 0 24 24"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L5 15.5a1.6 1.6 0 0 1 2.5-2L8 14"/></svg>',
  vitrine: '<svg viewBox="0 0 24 24"><path d="M5 20V8h14v12"/><path d="M3 20h18M5 8l2-4h10l2 4"/><path d="M9 11v5M15 11v5" opacity=".5"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/></svg>',
};
function paintActions() {
  const set = (id, on, icon, label) => { const b = $(id); b.setAttribute('aria-pressed', String(!!on)); b.querySelector('i').innerHTML = icon; b.setAttribute('aria-label', label); b.title = label; };
  set('#btnSpin', settings.spin, ICON.spin, t('turn'));
  const hand = settings.place === 'hand';
  set('#btnPlace', hand, hand ? ICON.hand : ICON.top, hand ? t('inHand') : t('onCube'));
  set('#btnVitrine', settings.vitrine, ICON.vitrine, t('vitrine'));
  $('#btnPhoto').setAttribute('aria-label', t('photo'));
  $('#btnVitrine').disabled = hand;
}
function paintSettings() {
  const seg = (id, v) => { for (const b of document.querySelectorAll(`#${id} button`)) b.setAttribute('aria-pressed', String(b.dataset.v === String(v))); };
  seg('segPlinth', settings.plinth); seg('segPlace', settings.place); seg('segView', settings.view); seg('segZoom', settings.zoomOut);
  $('#chkUpright').checked = settings.upright; $('#chkShadow').checked = settings.shadows; $('#chkDebug').checked = settings.debug;
  if (camera) {
    const f = camera.fov;
    $('#fovVal').textContent = `${Math.round(f.value)}° · ${t({ learned: 'fovLearned', saved: 'fovSaved', set: 'fovSet' }[f.source] || 'fovDefault')}`;
  } else $('#fovVal').textContent = '';
  $('#detVal').textContent = tracking ? (tracking.detector === 'opencv' ? 'OpenCV ArUco' : 'JS') + (tracking.workerState === 'loading' ? ' …' : '') : '';
  paintCamera();
}
function paintCamera() {
  if (!camera) return;
  const b = $('#btnCam');
  b.hidden = camera.list.length < 2;
  $('#camNo').textContent = String(camera.number);
  const row = $('#rowCam'), segc = $('#segCam');
  row.hidden = camera.list.length < 2;
  segc.innerHTML = '';
  const auto = document.createElement('button'); auto.textContent = t('auto');
  auto.setAttribute('aria-pressed', String(!settings.camManual));
  auto.onclick = () => { camera.auto(); paintCamera(); };
  segc.append(auto);
  camera.list.forEach((d, i) => {
    const f = camera.lensFov(d.deviceId), btn = document.createElement('button');
    btn.textContent = String(i + 1) + (f ? ` · ${Math.round(f)}°` : '');
    btn.title = d.label || '';
    btn.setAttribute('aria-pressed', String(!!settings.camManual && d.deviceId === camera.devId));
    btn.onclick = async () => { settings.camId = d.deviceId; settings.camManual = true; save(); await camera.use(d.deviceId); paintCamera(); };
    segc.append(btn);
  });
}
function bindUI() {
  $('#go').addEventListener('click', start);
  for (const b of document.querySelectorAll('.lang button')) b.addEventListener('click', () => setLang(b.dataset.l));
  $('#btnNoCube').addEventListener('click', () => openSheet('sheetPrint'));
  $('#scrim').addEventListener('click', () => openSheet(null));
  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => openSheet(null));
  $('#btnHelp').addEventListener('click', () => openSheet('sheetHelp'));
  $('#btnSettings').addEventListener('click', () => openSheet('sheetSettings'));
  $('#btnInfo').addEventListener('click', () => openSheet('sheetInfo'));
  $('#exText').addEventListener('click', () => openSheet('sheetInfo'));
  $('#btnPrev').addEventListener('click', () => step(-1));
  $('#btnNext').addEventListener('click', () => step(1));
  $('#btnSpin').addEventListener('click', () => { settings.spin = !settings.spin; if (!settings.spin) stage.place.spin = 0; save(); paintActions(); badge((settings.spin ? '● ' : '○ ') + t('turn')); ui.dirty = true; });
  $('#btnPlace').addEventListener('click', () => { setPlace(settings.place === 'hand' ? 'top' : 'hand'); badge(t(settings.place === 'hand' ? 'inHand' : 'onCube')); });
  $('#btnVitrine').addEventListener('click', () => { settings.vitrine = !settings.vitrine; save(); stage.setVitrine(settings.vitrine); stage.layoutHolder(); paintActions(); badge((settings.vitrine ? '● ' : '○ ') + t('vitrine')); ui.dirty = true; });
  $('#btnPhoto').addEventListener('click', takePhoto);
  $('#btnStrip').addEventListener('click', () => { settings.strip = !settings.strip; save(); paintStrip(); });
  $('#btnCam').addEventListener('click', async () => {
    const d = camera && await camera.next();
    if (d) { const f = camera.lensFov(d.deviceId); toast(t('camNo', { n: camera.number, all: camera.list.length }) + (f ? ` · ${Math.round(f)}°` : '')); }
    paintCamera();
  });
  $('#btnZoom').addEventListener('click', () => { const z = [1, 0.7, 0.5]; settings.zoomOut = z[(z.indexOf(settings.zoomOut) + 1) % z.length] ?? 1; save(); paintZoom(); updateProjection(); });
  $('#stall').addEventListener('click', async () => { $('#stall').hidden = true; if (camera && !(await camera.restart())) $('#stall').hidden = false; });
  const segc = (id, fn) => $('#' + id).addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) { fn(b.dataset.v); paintSettings(); } });
  segc('segPlinth', v => { settings.plinth = v; save(); stage.setPlinth(v); ui.dirty = true; });
  segc('segPlace', v => setPlace(v));
  segc('segView', v => { settings.view = v; save(); updateProjection(); });
  segc('segZoom', v => { settings.zoomOut = +v; save(); paintZoom(); updateProjection(); });
  $('#chkUpright').addEventListener('change', e => { settings.upright = e.target.checked; save(); });
  $('#chkShadow').addEventListener('change', e => { settings.shadows = e.target.checked; save(); stage.setShadows(settings.shadows); ui.dirty = true; });
  $('#chkDebug').addEventListener('change', e => { settings.debug = e.target.checked; save(); });
  $('#btnFovReset').addEventListener('click', () => { if (camera) { settings.fovFix = 0; save(); camera.forgetFov(); paintSettings(); } });
  $('#btnCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(location.href); toast(t('copied')); } catch { prompt('', location.href); } });
  bindGestures();
  paintActions(); paintStrip(); paintZoom(); paintSettings();
}
function setPlace(v) { settings.place = v; save(); stage.setPlace(v); paintActions(); paintSettings(); ui.dirty = true; }
function paintStrip() { $('#panel').classList.toggle('mini', !settings.strip); document.body.classList.toggle('mini', !settings.strip); $('#btnStrip').setAttribute('aria-expanded', String(!!settings.strip)); $('#btnStrip').setAttribute('aria-label', t(settings.strip ? 'less' : 'more')); }
function paintZoom() { $('#btnZoom').textContent = (settings.zoomOut === 1 ? '1' : String(settings.zoomOut).replace(/^0/, '')) + '×'; $('#btnZoom').setAttribute('aria-pressed', String(settings.zoomOut !== 1)); }

// in-app browsers (Instagram, Facebook, some QR scanners) often block the camera
function checkBrowser() {
  const ua = navigator.userAgent || '';
  const inApp = /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|TikTok|MicroMessenger|; wv\)/i.test(ua);
  if (!inApp) return;
  $('#inapp').hidden = false;
  if (/Android/i.test(ua)) {
    const a = $('#openChrome'); a.hidden = false;
    a.href = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`;
  }
}

// ---------------- toasts ----------------
let toastT = 0, badgeT = 0;
function toast(msg, ms = 3200) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), ms); }
function badge(msg) { const el = $('#badge'); el.textContent = msg; el.classList.add('show'); clearTimeout(badgeT); badgeT = setTimeout(() => el.classList.remove('show'), 900); }

// ---------------- debug overlay ----------------
function drawDebug() {
  const W = dbgCanvas.width, H = dbgCanvas.height;
  if (!settings.debug || !tracking) { if (dbgCanvas.dataset.on) { dbg.clearRect(0, 0, W, H); delete dbgCanvas.dataset.on; } return; }
  dbgCanvas.dataset.on = '1';
  dbg.clearRect(0, 0, W, H);
  const v = stage.view, res = tracking.lastRes, map = p => [(p[0] - v.ox) * v.s, (p[1] - v.oy) * v.s];
  const dpr = W / (gl.clientWidth || W);
  dbg.lineWidth = 2 * dpr; dbg.font = `${11 * dpr}px ui-monospace, Menlo, monospace`;
  if (res) for (const m of res.markers) {
    const c = m.corners.map(map);
    dbg.strokeStyle = '#6fcf97'; dbg.beginPath(); dbg.moveTo(c[0][0], c[0][1]); for (let i = 1; i < 4; i++) dbg.lineTo(c[i][0], c[i][1]); dbg.closePath(); dbg.stroke();
    dbg.fillStyle = '#ff5aa5'; dbg.fillRect(c[0][0] - 3 * dpr, c[0][1] - 3 * dpr, 6 * dpr, 6 * dpr);
    dbg.fillStyle = '#fff'; dbg.fillText(String(m.id), (c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2);
  }
  const r = tracking.region;
  if (r) { const a = map([r.sx, r.sy]), b = map([r.sx + r.sw, r.sy + r.sh]); dbg.strokeStyle = 'rgba(255,255,255,.4)'; dbg.setLineDash([6 * dpr, 6 * dpr]); dbg.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); dbg.setLineDash([]); }
  const s = tracking.stats, act = tracking.active, p = act && tracking.T[act].raw;
  const lines = [
    `${tracking.detector}${tracking.workerState === 'loading' ? ' (opencv loading)' : tracking.workerState === 'failed' ? ' (opencv failed: ' + s.error + ')' : ''}  ${ui.loop}  fps ${tracking.fps.toFixed(0)}  latency ${s.latency.toFixed(0)} ms`,
    `detect ${s.det.toFixed(1)}  grab ${(ui.grabMs || 0).toFixed(1)}  read ${s.read.toFixed(1)}  solve ${s.solve.toFixed(1)}  draw ${ui.renderMs.toFixed(1)} ms  px ${stage.pixK.toFixed(2)}  proc ${tracking.PROC}`,
    `video ${video.videoWidth}x${video.videoHeight}${video.paused ? ' PAUSED' : ''}  ${stage.view.mode}  zoom ${(+camera.zoom).toFixed(2)}  fov ${camera.fov.value.toFixed(1)}° ${camera.fov.source}`,
    `cam ${camera.number}/${camera.list.length} ${(camera.label || '').slice(0, 26)}  tilt ${sensor.ok ? 'on' : 'off'}`,
    p ? `${act}: markers ${p.n} faces ${p.faces ? p.faces.length : 1}  rms ${p.rms.toFixed(2)} px  z ${p.t[2].toFixed(0)} mm  side ${ui.base}` : `searching ${r ? r.mode : ''}  found ${s.found}/${s.frames}`,
  ];
  const lh = 15 * dpr, y0 = (gl.clientHeight > 600 ? 120 : 70) * dpr;
  dbg.fillStyle = 'rgba(0,0,0,.6)'; dbg.fillRect(6 * dpr, y0 - lh, Math.min(W - 12 * dpr, 440 * dpr), lh * (lines.length + 0.5));
  dbg.fillStyle = '#fff'; lines.forEach((l, i) => dbg.fillText(l, 12 * dpr, y0 + i * lh));
}

// ---------------- for automated tests ----------------
const api = {
  get stage() { return stage; }, get tracking() { return tracking; }, get camera() { return camera; }, get current() { return current; },
  settings, ui, select, setLang, takePhoto, openSheet, version: VERSION,
};
