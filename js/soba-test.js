// Room test for the Mladina sehara escape room (step 0).
// Measures, at each station spot, how quickly and how steadily the phone recognises the station card,
// and from how far away. Uses the same marker detector as the AR cube (js/cv/detector.js), no room tracking.
// Nothing leaves the device: results stay in this browser until the user copies them.
import { MarkerDetector } from './cv/detector.js';

const VERSION = 'soba-test 1.0';
const $ = s => document.querySelector(s);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: keep in memory only */ } },
};

// ---------------------------------------------------------------- text
const STR = {
  me: {
    kicker: 'Mladina sehara · korak 0', title: 'Test sobe',
    lead: 'Provjera mjesta za kartice u Gusinjskoj sobi: koliko brzo i pouzdano telefon prepoznaje karticu, u kojoj veličini i na kojem svjetlu.',
    device: 'Naziv uređaja', devicePh: 'npr. moj telefon, tablet muzeja', light: 'Svjetlo u sobi',
    l_jutro: 'Jutro', l_dan: 'Dan', l_vece: 'Predveče', l_vjest: 'Vještačko',
    start: 'Uključi kameru', pdf: 'Test kartice (PDF)', lang: 'English',
    note: 'Slika s kamere se obrađuje samo na ovom uređaju. Ništa se ne šalje; rezultate kopirate sami.',
    errApi: 'Ovaj preglednik ovdje ne može otvoriti kameru. Otvorite stranicu u Chromeu (Android) ili Safariju (iPhone, iPad).',
    errBlocked: 'Pristup kameri je blokiran. Dozvolite kameru za ovu stranicu u podešavanjima preglednika i pokušajte ponovo.',
    errNoCam: 'Na ovom uređaju nije pronađena kamera.', errStart: 'Kamera se nije pokrenula',
    errData: 'Podaci se nisu učitali. Provjerite internet i osvježite stranicu.',
    see: 'Vidim', none: 'Ne vidim karticu', aim: 'Uperite kameru u karticu stanice',
    testSpot: 'Testiraj mjesto', range: 'Domet', results: 'Rezultati', close: 'Zatvori',
    st: 'Stanica', size: 'veličina',
    spotRun: 'Držite telefon kao posjetilac…', rangeRun: 'Polako se udaljavajte od kartice…', rangeWait: 'Priđite kartici dok je telefon ne prepozna…',
    cancel: 'Prekini', done: 'Gotovo', ok: 'U redu',
    pass: 'PROLAZI', weak: 'SLABO', fail: 'NE PROLAZI', rangeV: 'DOMET',
    first: 'Prepoznata za', steady: 'Stabilno', gap: 'Najduži prekid', dist: 'Udaljenost', px: 'Na slici', tilt: 'Ukoso',
    lightLbl: 'Svjetlo', glare: 'presvijetlo', dark: 'pretamno', notSeen: 'nije prepoznata',
    rSteady: 'Stabilno do', rAny: 'Povremeno do',
    t_none: 'Kartica nije prepoznata. Provjerite da li je prava kartica i veličina izabrana dolje, pa probajte veću karticu ili priđite bliže.',
    t_dark: 'Premalo svjetla na slici.', t_glare: 'Dio slike je presvijetao: moguć odsjaj prozora ili lampe na kartici.',
    t_small: 'Kartica je premala na slici: probajte veću karticu ili mjesto bliže posjetiocu.',
    t_tilt: 'Kartica se vidi jako ukoso: okrenite je više prema posjetiocu.', t_unsteady: 'Prepoznavanje se prekida: mirnije držanje, više svjetla ili veća kartica.',
    codeTitle: 'Upišite šifru s kartice', codeBad: 'Nepoznata šifra', codeOk: 'Otvara stanicu',
    copy: 'Kopiraj rezultate', copied: 'Kopirano. Zalijepite tekst u chat.', copyHand: 'Označite tekst ispod i kopirajte ga.',
    clear: 'Obriši sve', clearQ: 'Dodirnite ponovo za brisanje', cleared: 'Rezultati obrisani',
    empty: 'Još nema rezultata. Uperite telefon u karticu i dodirnite „Testiraj mjesto“.',
    sum: 'Pregled', sumSt: 'Stanica', sumRange: 'Domet', saved: 'Sačuvano',
    hdr: 'Mladina sehara – test sobe', devLbl: 'Uređaj', screen: 'ekran', camLbl: 'kamera', zoomLbl: 'zum',
  },
  en: {
    kicker: 'Mladina sehara · step 0', title: 'Room test',
    lead: 'Checks the card spots in the Gusinje room: how quickly and reliably the phone recognises each card, in which size and in which light.',
    device: 'Device name', devicePh: 'e.g. my phone, museum tablet', light: 'Light in the room',
    l_jutro: 'Morning', l_dan: 'Day', l_vece: 'Evening', l_vjest: 'Lamps',
    start: 'Turn on the camera', pdf: 'Test cards (PDF)', lang: 'Crnogorski',
    note: 'The camera picture is processed only on this device. Nothing is sent; you copy the results yourself.',
    errApi: 'This browser cannot open the camera here. Open the page in Chrome (Android) or Safari (iPhone, iPad).',
    errBlocked: 'Camera access is blocked. Allow the camera for this page in the browser settings and try again.',
    errNoCam: 'No camera was found on this device.', errStart: 'The camera did not start',
    errData: 'The data did not load. Check the internet connection and reload the page.',
    see: 'I see', none: 'No card in view', aim: 'Point the camera at a station card',
    testSpot: 'Test this spot', range: 'Range', results: 'Results', close: 'Close',
    st: 'Station', size: 'size',
    spotRun: 'Hold the phone like a visitor would…', rangeRun: 'Step back slowly from the card…', rangeWait: 'Move closer until the phone recognises the card…',
    cancel: 'Cancel', done: 'Done', ok: 'OK',
    pass: 'PASS', weak: 'WEAK', fail: 'FAIL', rangeV: 'RANGE',
    first: 'Recognised in', steady: 'Steady', gap: 'Longest dropout', dist: 'Distance', px: 'In the picture', tilt: 'Angle',
    lightLbl: 'Light', glare: 'too bright', dark: 'too dark', notSeen: 'not recognised',
    rSteady: 'Steady up to', rAny: 'Now and then up to',
    t_none: 'The card was not recognised. Check that the right card and size are selected below, then try a bigger card or come closer.',
    t_dark: 'Too little light in the picture.', t_glare: 'Part of the picture is blown out: a reflection of the window or a lamp on the card is likely.',
    t_small: 'The card is too small in the picture: try a bigger card or a spot closer to the visitor.',
    t_tilt: 'The card is seen at a steep angle: turn it more towards the visitor.', t_unsteady: 'Recognition keeps dropping out: hold steadier, add light or use a bigger card.',
    codeTitle: 'Type the code from the card', codeBad: 'Unknown code', codeOk: 'Opens station',
    copy: 'Copy results', copied: 'Copied. Paste the text into the chat.', copyHand: 'Select the text below and copy it.',
    clear: 'Clear all', clearQ: 'Tap again to clear', cleared: 'Results cleared',
    empty: 'No results yet. Point the phone at a card and tap “Test this spot”.',
    sum: 'Overview', sumSt: 'Station', sumRange: 'Range', saved: 'Saved',
    hdr: 'Mladina sehara – room test', devLbl: 'Device', screen: 'screen', camLbl: 'camera', zoomLbl: 'zoom',
  },
};
let lang = store.get('soba.lang', (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'me');
const t = k => (STR[lang] && STR[lang][k]) ?? STR.me[k] ?? k;
const LIGHTS = ['jutro', 'dan', 'vece', 'vjest'];

// ---------------------------------------------------------------- state
const S = {
  data: null, byId: new Map(), det: null,
  sel: store.get('soba.sel', { station: 0, size: 'S' }),
  light: store.get('soba.light', guessLight()),
  device: store.get('soba.device', ''),
  results: store.get('soba.results', []),
  seen: new Map(),          // marker id -> {t, corners, dist, px, tilt}
  run: null, frame: 0, fps: 0, procMs: 0, PROC: 720, lastT: 0,
  lum: null, fov: 66, zoom: 1, autoModel: '',
};
function guessLight() { const h = new Date().getHours(); return h < 11 ? 'jutro' : h < 16 ? 'dan' : h < 21 ? 'vece' : 'vjest'; }

const video = $('#cam'), ov = $('#ov'), octx = ov.getContext('2d');
const work = document.createElement('canvas'), wctx = work.getContext('2d', { willReadFrequently: true });
const tiny = document.createElement('canvas'); tiny.width = 64; tiny.height = 48;
const tctx = tiny.getContext('2d', { willReadFrequently: true });
const cam = { stream: null, track: null, caps: {} };

// ---------------------------------------------------------------- text on the page
function paintText() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'sr-ME';
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-lang]')) el.textContent = t('lang');
  $('#devName').placeholder = t('devicePh');
  $('#lightSeg').innerHTML = LIGHTS.map(l => `<button type="button" data-l="${l}" aria-pressed="${l === S.light}">${t('l_' + l)}</button>`).join('');
  $('#lightBtn').textContent = '☀ ' + t('l_' + S.light);
  $('#codeBtn').setAttribute('aria-label', t('codeTitle'));
  paintPicker(); paintResCount();
}
document.addEventListener('click', e => {
  const l = e.target.closest('[data-lang]');
  if (l) { lang = lang === 'en' ? 'me' : 'en'; store.set('soba.lang', lang); paintText(); if (!$('#resSheet').hidden) paintResults(); }
  const b = e.target.closest('#lightSeg button');
  if (b) { S.light = b.dataset.l; store.set('soba.light', S.light); paintText(); }
});
$('#lightBtn').addEventListener('click', () => {
  S.light = LIGHTS[(LIGHTS.indexOf(S.light) + 1) % LIGHTS.length]; store.set('soba.light', S.light);
  paintText(); toast(t('light') + ': ' + t('l_' + S.light));
});
$('#devName').value = S.device;
$('#devName').addEventListener('input', e => { S.device = e.target.value.trim(); store.set('soba.device', S.device); });

function toast(msg, ms = 2200) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), ms);
}

// ---------------------------------------------------------------- data
async function loadData() {
  const r = await fetch('data/soba.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(r.status);
  S.data = await r.json();
  const mm = S.data.sizes;
  for (const st of S.data.stations) for (const [size, id] of Object.entries(st.markers)) S.byId.set(id, { st, size, mm: mm[size] });
  S.det = new MarkerDetector(S.data.markers.map(m => ({ id: m.id, cells: m.cells })));
  if (!S.data.stations[S.sel.station]) S.sel.station = 0;
  if (!mm[S.sel.size]) S.sel.size = 'S';
}
const stationName = st => st.name[lang === 'en' ? 'en' : 'me'];

// ---------------------------------------------------------------- picker (station + size)
function paintPicker() {
  if (!S.data) return;
  const now = S.lastT || performance.now() / 1000;
  const seenSt = new Set([...S.seen.entries()].filter(([, v]) => now - v.t < 0.6).map(([id]) => S.byId.get(id).st.nr));
  // buttons are built once and then only updated, so a tap is never lost to a rebuild
  const box = $('#stations'), seg = $('#sizeSeg');
  if (box.children.length !== S.data.stations.length) {
    box.innerHTML = S.data.stations.map((st, i) => `<button type="button" data-i="${i}">${st.nr}</button>`).join('');
    seg.innerHTML = Object.entries(S.data.sizes).map(([k, v]) => `<button type="button" data-s="${k}" title="${v} mm">${k}</button>`).join('');
  }
  S.data.stations.forEach((st, i) => {
    const b = box.children[i];
    b.setAttribute('aria-pressed', i === S.sel.station); b.classList.toggle('seen', seenSt.has(st.nr)); b.title = stationName(st);
  });
  for (const b of seg.children) b.setAttribute('aria-pressed', b.dataset.s === S.sel.size);
  const st = S.data.stations[S.sel.station];
  $('#stName').textContent = `${t('st')} ${st.nr} · ${stationName(st)} · ${S.sel.size} (${S.data.sizes[S.sel.size]} mm)`;
}
$('#stations').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || S.run) return; S.sel.station = +b.dataset.i; S.sel.manual = performance.now(); store.set('soba.sel', S.sel); paintPicker(); });
$('#sizeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || S.run) return; S.sel.size = b.dataset.s; S.sel.manual = performance.now(); store.set('soba.sel', S.sel); paintPicker(); });

// ---------------------------------------------------------------- camera
$('#go').addEventListener('click', start);
async function start() {
  const err = $('#err'); err.style.display = 'none';
  const fail = m => { err.textContent = m; err.style.display = 'block'; $('#go').disabled = false; $('#go').textContent = t('start'); };
  if (!navigator.mediaDevices?.getUserMedia) return fail(t('errApi'));
  $('#go').disabled = true; $('#go').textContent = '…';
  try { if (!S.data) await loadData(); } catch { return fail(t('errData')); }
  try { await openCamera(); }
  catch (e) {
    const n = e && e.name;
    return fail(n === 'NotAllowedError' ? t('errBlocked') : n === 'NotFoundError' ? t('errNoCam') : `${t('errStart')} (${(e && e.message) || e}).`);
  }
  $('#start').hidden = true;
  for (const id of ['#top', '#dock', '#hint']) $(id).hidden = false;
  paintText();
  paintLive(performance.now() / 1000);       // no empty pills before the first frames arrive
  keepAwake();
  resize();
  loop();
}
async function openCamera() {
  // 4:3 is the sensor's own shape on almost every phone and tablet; 16:9 requests are served by cropping.
  const v = { facingMode: { ideal: 'environment' }, width: { ideal: 1440 }, height: { ideal: 1080 }, aspectRatio: { ideal: 4 / 3 }, frameRate: { ideal: 30 } };
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: v }); }
  catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'NotFoundError') throw e;
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });   // camera refused the size
  }
  cam.stream = stream; cam.track = stream.getVideoTracks()[0];
  cam.caps = cam.track.getCapabilities ? cam.track.getCapabilities() : {};
  // the main camera at 1x, the way visitors will hold it (some phones open on the wide-angle lens)
  if (cam.caps.zoom && cam.caps.zoom.min <= 1 && cam.caps.zoom.max >= 1) {
    try { await cam.track.applyConstraints({ advanced: [{ zoom: 1 }] }); } catch { /* not supported */ }
  }
  if (cam.caps.focusMode && cam.caps.focusMode.includes('continuous')) {
    try { await cam.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* ignore */ }
  }
  S.zoom = (cam.track.getSettings && cam.track.getSettings().zoom) || 1;
  video.srcObject = stream;
  await video.play();
}
let wakeLock = null;
async function keepAwake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && video.srcObject) keepAwake(); });
window.addEventListener('resize', resize);
video.addEventListener('resize', resize);
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ov.width = Math.round(innerWidth * dpr); ov.height = Math.round(innerHeight * dpr);
}
// focal length in video pixels: horizontal angle of view of a typical phone main camera (~66° on the long side)
function focal() { const L = Math.max(video.videoWidth, video.videoHeight); return (L / 2) / Math.tan(S.fov * Math.PI / 360) * (S.zoom || 1); }

// ---------------------------------------------------------------- frame loop
function loop() {
  const step = (now) => { onFrame(now); schedule(); };
  const schedule = () => video.requestVideoFrameCallback ? video.requestVideoFrameCallback(step) : requestAnimationFrame(step);
  schedule();
}
function chooseRegion(tNow) {
  const vw = video.videoWidth, vh = video.videoHeight, L = Math.max(vw, vh);
  // follow the card being tested, or the card seen last, with a sharper crop around it
  const want = S.run ? S.run.id : null;
  let tgt = null;
  for (const [id, s] of S.seen) {
    if (tNow - s.t > 0.3) continue;
    if (want != null ? id === want : (!tgt || s.px > tgt.px)) tgt = s;
  }
  if (tgt && S.frame % 5 !== 0) {
    const xs = tgt.corners.map(p => p[0]), ys = tgt.corners.map(p => p[1]);
    const side = tgt.px, pad = 0.7 * side + 24;
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad)), y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
    const x1 = Math.min(vw, Math.ceil(Math.max(...xs) + pad)), y1 = Math.min(vh, Math.ceil(Math.max(...ys) + pad));
    if (x1 - x0 >= 32 && y1 - y0 >= 32) {
      const scale = Math.min(1, S.PROC / Math.max(x1 - x0, y1 - y0));
      const cell = side / 8 * scale;
      return { sx: x0, sy: y0, sw: x1 - x0, sh: y1 - y0, scale, radius: clamp(Math.round(cell * 0.9), 2, 7), mode: 'track' };
    }
  }
  // searching: whole picture (near cards) and a sharp centre crop (far cards) in turn
  if (S.frame % 2 === 0) {
    const scale = Math.min(1, S.PROC / L);
    return { sx: 0, sy: 0, sw: vw, sh: vh, scale, radius: [2, 3, 5][(S.frame >> 1) % 3], mode: 'full' };
  }
  const cw = Math.round(vw / 2), ch = Math.round(vh / 2);
  return { sx: Math.round((vw - cw) / 2), sy: Math.round((vh - ch) / 2), sw: cw, sh: ch, scale: Math.min(1, S.PROC / Math.max(cw, ch)), radius: [2, 3][(S.frame >> 1) % 2], mode: 'centre' };
}
function onFrame(nowMs) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !S.det) return;
  S.frame++;
  const tNow = nowMs / 1000;
  if (S.lastT) S.fps = S.fps * 0.9 + 0.1 / Math.max(1e-3, tNow - S.lastT);
  S.lastT = tNow;
  const p0 = performance.now();
  const R = chooseRegion(tNow);
  const w = Math.max(16, Math.round(R.sw * R.scale)), h = Math.max(16, Math.round(R.sh * R.scale));
  if (work.width < w || work.height < h) { work.width = Math.max(work.width, w + 64); work.height = Math.max(work.height, h + 64); }
  wctx.drawImage(video, R.sx, R.sy, R.sw, R.sh, 0, 0, w, h);
  const img = wctx.getImageData(0, 0, w, h);
  const found = S.det.detect(img.data, w, h, { radius: R.radius });
  const f = focal();
  const hits = new Map();
  for (const m of found) {
    const info = S.byId.get(m.id);
    if (!info) continue;
    const c = m.corners.map(p => [R.sx + p.x / R.scale, R.sy + p.y / R.scale]);
    const e = [0, 1, 2, 3].map(k => Math.hypot(c[(k + 1) % 4][0] - c[k][0], c[(k + 1) % 4][1] - c[k][1]));
    const a = (e[0] + e[2]) / 2, b = (e[1] + e[3]) / 2, px = Math.max(a, b);
    const tilt = Math.acos(clamp(Math.min(a, b) / px, 0, 1)) * 180 / Math.PI;
    const rec = { t: tNow, corners: c, px, dist: f * info.mm / 1000 / px, tilt };
    hits.set(m.id, rec); S.seen.set(m.id, rec);
  }
  const ms = performance.now() - p0;
  S.procMs = S.procMs * 0.85 + 0.15 * ms;
  if (S.frame % 15 === 0) {             // keep the processing size within what this phone manages
    if (S.procMs > 32 && S.PROC > 480) S.PROC = Math.round(S.PROC * 0.88);
    else if (S.procMs < 16 && S.PROC < 960) S.PROC = Math.min(960, Math.round(S.PROC * 1.08));
  }
  if (S.frame % 6 === 0) measureLight();
  // the biggest card in view selects itself in the picker (unless the user just picked by hand)
  if (!S.run && hits.size && !(S.sel.manual && performance.now() - S.sel.manual < 4000)) {
    let best = null; for (const [id, r] of hits) if (!best || r.px > best[1].px) best = [id, r];
    const info = S.byId.get(best[0]);
    const i = S.data.stations.indexOf(info.st);
    if (i !== S.sel.station || info.size !== S.sel.size) { S.sel.station = i; S.sel.size = info.size; store.set('soba.sel', S.sel); }
  }
  if (S.run) S.run.frame(tNow, hits);
  draw(tNow, hits);
  if (S.frame % 4 === 0) paintLive(tNow);
}
function measureLight() {
  tctx.drawImage(video, 0, 0, tiny.width, tiny.height);
  const d = tctx.getImageData(0, 0, tiny.width, tiny.height).data;
  let sum = 0, clip = 0, dark = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    sum += y; if (y >= 245) clip++; if (y <= 12) dark++;
  }
  S.lum = { mean: sum / n / 255, clip: clip / n, dark: dark / n };
}

// ---------------------------------------------------------------- drawing
function toScreen() {
  const W = innerWidth, H = innerHeight, vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.max(W / vw, H / vh);
  return { s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2 };
}
function draw(tNow, hits) {
  const dpr = ov.width / innerWidth;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, ov.width, ov.height);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { s, ox, oy } = toScreen();
  for (const [id, r] of S.seen) {
    const age = tNow - r.t;
    if (age > 0.35) continue;
    const info = S.byId.get(id);
    const testing = S.run && S.run.id === id;
    const pts = r.corners.map(p => [p[0] * s + ox, p[1] * s + oy]);
    octx.globalAlpha = hits.has(id) ? 1 : 0.45;
    octx.lineWidth = testing ? 5 : 3.5; octx.lineJoin = 'round';
    octx.strokeStyle = testing ? '#e0a24e' : '#3ccf6e';
    octx.beginPath(); pts.forEach((p, k) => k ? octx.lineTo(p[0], p[1]) : octx.moveTo(p[0], p[1])); octx.closePath(); octx.stroke();
    const cx = pts.reduce((a, p) => a + p[0], 0) / 4, top = Math.min(...pts.map(p => p[1]));
    const label = `${info.st.nr} · ${info.size} · ~${r.dist.toFixed(1)} m`;
    octx.font = '600 14px system-ui, sans-serif';
    const tw = octx.measureText(label).width + 16;
    const ly = Math.max(70, top - 12);
    octx.fillStyle = 'rgba(20,18,15,.78)';
    roundRect(octx, cx - tw / 2, ly - 22, tw, 26, 9); octx.fill();
    octx.fillStyle = '#fff'; octx.textAlign = 'center'; octx.fillText(label, cx, ly - 4);
  }
  octx.globalAlpha = 1;
}
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

function paintLive(tNow) {
  let best = null;
  for (const [id, r] of S.seen) if (tNow - r.t < 0.35 && (!best || r.px > best.r.px)) best = { id, r };
  const live = $('#live');
  if (best) {
    const info = S.byId.get(best.id);
    live.textContent = `${t('see')}: ${info.st.nr} ${stationName(info.st)} · ${info.size} · ~${best.r.dist.toFixed(1)} m · ${Math.round(best.r.px)} px`;
    live.classList.add('on');
  } else { live.textContent = t('none'); live.classList.remove('on'); }
  $('#hint').hidden = !!best || !!S.run;
  $('#hint').textContent = t('aim');
  const L = S.lum;
  $('#meter').textContent = (L ? `${t('lightLbl')} ${Math.round(L.mean * 100)} %` + (L.clip > 0.04 ? ` · ${t('glare')} ${Math.round(L.clip * 100)} %` : '') +
    (L.mean < 0.16 ? ` · ${t('dark')}` : '') + ' · ' : '') + `${video.videoWidth}×${video.videoHeight} · ${Math.round(S.fps)} fps · ${Math.round(S.procMs)} ms`;
  paintPicker();
}

// ---------------------------------------------------------------- tests
const selected = () => { const st = S.data.stations[S.sel.station]; return { st, size: S.sel.size, id: st.markers[S.sel.size], mm: S.data.sizes[S.sel.size] }; };
function common(sel) {
  return { at: new Date().toISOString(), light: S.light, station: sel.st.id, nr: sel.st.nr, size: sel.size, id: sel.id,
    lum: S.lum ? Math.round(S.lum.mean * 100) : null, clip: S.lum ? Math.round(S.lum.clip * 100) : null, vw: video.videoWidth, vh: video.videoHeight, zoom: S.zoom };
}
$('#spotBtn').addEventListener('click', () => startSpot());
$('#rangeBtn').addEventListener('click', () => startRange());
$('#runCancel').addEventListener('click', () => { S.run = null; $('#run').hidden = true; showDock(true); });
$('#runDone').addEventListener('click', () => S.run && S.run.finish());
function showDock(on) { $('#dock').hidden = !on; }

function startSpot() {
  const sel = selected();
  S.seen.clear();          // forget the card the page is following, so "recognised in" is a real fresh recognition
  const r = { kind: 'spot', id: sel.id, sel, t0: null, first: null, after: 0, hits: 0, lastHit: null, maxGap: 0, d: [], px: [], tilt: [], lum: [], clip: [] };
  r.frame = (tNow, hits) => {
    if (r.t0 == null) r.t0 = tNow;
    r.tLast = tNow;
    const h = hits.get(r.id);
    if (S.lum) { r.lum.push(S.lum.mean); r.clip.push(S.lum.clip); }
    if (h) {
      if (r.first == null) r.first = tNow;
      if (r.lastHit != null) r.maxGap = Math.max(r.maxGap, tNow - r.lastHit);
      r.lastHit = tNow; r.hits++; r.d.push(h.dist); r.px.push(h.px); r.tilt.push(h.tilt);
    }
    if (r.first != null) r.after++;
    const el = tNow - r.t0;
    const total = r.first != null ? Math.min(8, (r.first - r.t0) + 4) : 8;
    $('#runBar').style.width = Math.min(100, el / total * 100) + '%';
    $('#runBig').textContent = r.first == null ? '…' : `${Math.round(r.hits / Math.max(1, r.after) * 100)} %`;
    $('#runSub').textContent = r.first == null ? t('aim') : `${t('first')} ${(r.first - r.t0).toFixed(1)} s · ~${median(r.d).toFixed(1)} m`;
    if (el >= total) r.finish();
  };
  r.finish = () => {
    if (S.run !== r) return;
    S.run = null;
    if (r.lastHit != null) r.maxGap = Math.max(r.maxGap, r.tLast - r.lastHit);
    const res = { ...common(r.sel), kind: 'spot', lum: r.lum.length ? Math.round(median(r.lum) * 100) : null, clip: r.clip.length ? Math.round(median(r.clip) * 100) : null };
    if (r.first == null) { res.v = 'fail'; res.seen = false; }
    else {
      res.seen = true; res.first = +(r.first - r.t0).toFixed(2); res.rate = +(r.hits / Math.max(1, r.after)).toFixed(2);
      res.gap = +r.maxGap.toFixed(2); res.dist = +median(r.d).toFixed(2); res.px = Math.round(median(r.px)); res.tilt = Math.round(median(r.tilt));
      res.v = res.first <= 1.0 && res.rate >= 0.85 && res.gap <= 0.5 ? 'pass' : res.first <= 3 && res.rate >= 0.5 ? 'weak' : 'fail';
    }
    saveResult(res);
    $('#run').hidden = true; showVerdict(res);
  };
  S.run = r;
  $('#runTitle').textContent = `${t('testSpot')} · ${sel.st.nr} ${stationName(sel.st)} · ${sel.size}`;
  $('#runBig').textContent = '…'; $('#runSub').textContent = t('spotRun'); $('#runBar').style.width = '0%';
  $('#runDone').hidden = true; $('#run').hidden = false; showDock(false);
}

function startRange() {
  const sel = selected();
  const r = { kind: 'range', id: sel.id, sel, t0: null, win: [], best: 0, any: 0, lastHit: null, started: false, lum: [] };
  r.frame = (tNow, hits) => {
    if (r.t0 == null) r.t0 = tNow;
    const h = hits.get(r.id);
    r.win.push(h ? h.dist : null); if (r.win.length > 6) r.win.shift();
    if (S.lum) r.lum.push(S.lum.mean);
    if (h) {
      r.started = true; r.lastHit = tNow; r.any = Math.max(r.any, h.dist);
      const ok = r.win.filter(x => x != null);
      if (r.win.length >= 6 && ok.length >= 5) r.best = Math.max(r.best, Math.min(...ok));   // steady: 5 of the last 6 frames
    }
    $('#runBig').textContent = h ? `~${h.dist.toFixed(2)} m` : '—';
    $('#runSub').textContent = r.started ? `${t('rSteady')} ${r.best.toFixed(2)} m · ${t('rAny')} ${r.any.toFixed(2)} m` : t('rangeWait');
    $('#runBar').style.width = Math.min(100, r.best / 4 * 100) + '%';
    if ((r.started && tNow - r.lastHit > 2.0) || tNow - r.t0 > 90) r.finish();
  };
  r.finish = () => {
    if (S.run !== r) return;
    S.run = null;
    const res = { ...common(r.sel), kind: 'range', v: 'range', seen: r.started, best: +r.best.toFixed(2), any: +r.any.toFixed(2), lum: r.lum.length ? Math.round(median(r.lum) * 100) : null };
    saveResult(res);
    $('#run').hidden = true; showVerdict(res);
  };
  S.run = r;
  $('#runTitle').textContent = `${t('range')} · ${sel.st.nr} ${stationName(sel.st)} · ${sel.size}`;
  $('#runBig').textContent = '—'; $('#runSub').textContent = t('rangeRun'); $('#runBar').style.width = '0%';
  $('#runDone').hidden = false; $('#run').hidden = false; showDock(false);
}

function tipsFor(r) {
  const out = [];
  if (r.kind === 'spot' && !r.seen) out.push(t('t_none'));
  if (r.lum != null && r.lum < 16) out.push(t('t_dark'));
  if (r.clip > 6) out.push(t('t_glare'));
  if (r.seen && r.px && r.px < 45) out.push(t('t_small'));
  if (r.seen && r.tilt > 60) out.push(t('t_tilt'));
  if (r.kind === 'spot' && r.seen && (r.rate < 0.85 || r.gap > 0.5)) out.push(t('t_unsteady'));
  return out;
}
const lumTxt = r => r.lum == null ? '—' : `${r.lum} %` + (r.clip > 4 ? ` · ${t('glare')} ${r.clip} %` : '');
function kvFor(r) {
  if (r.kind === 'range') return [[t('rSteady'), r.seen ? `~${r.best.toFixed(2)} m` : t('notSeen')], [t('rAny'), r.seen ? `~${r.any.toFixed(2)} m` : '—'], [t('lightLbl'), lumTxt(r)]];
  if (!r.seen) return [[t('first'), t('notSeen')], [t('lightLbl'), lumTxt(r)]];
  return [[t('first'), `${r.first.toFixed(1)} s`], [t('steady'), `${Math.round(r.rate * 100)} %`], [t('gap'), `${r.gap.toFixed(1)} s`],
    [t('dist'), `~${r.dist.toFixed(1)} m`], [t('px'), `${r.px} px`], [t('tilt'), `${r.tilt}°`],
    [t('lightLbl'), lumTxt(r)]];
}
function showVerdict(r) {
  const st = S.data.stations.find(s => s.id === r.station);
  $('#vBadge').className = 'v-badge ' + r.v;
  $('#vBadge').textContent = r.kind === 'range' ? t('rangeV') : t(r.v);
  $('#vSt').textContent = `${st.nr} ${stationName(st)} · ${r.size} (${S.data.sizes[r.size]} mm) · ${t('l_' + r.light)}`;
  $('#vKv').innerHTML = kvFor(r).map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
  $('#vTips').innerHTML = tipsFor(r).map(x => `<li>${x}</li>`).join('');
  $('#verdict').hidden = false;
}
$('#vOk').addEventListener('click', () => { $('#verdict').hidden = true; showDock(true); toast(t('saved')); });

function saveResult(r) {
  r.dev = S.device || S.autoModel || '';
  S.results.push(r); store.set('soba.results', S.results); paintResCount();
}
function paintResCount() { $('#resBtn').textContent = `${t('results')} (${S.results.length})`; }

// ---------------------------------------------------------------- code entry (the fallback when the camera fails)
$('#codeBtn').addEventListener('click', () => { $('#codeSheet').hidden = false; $('#codeIn').value = ''; $('#codeOut').textContent = ''; showDock(false); setTimeout(() => $('#codeIn').focus(), 50); });
$('#codeClose').addEventListener('click', () => { $('#codeSheet').hidden = true; showDock(true); });
$('#codeIn').addEventListener('input', e => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 3); e.target.value = v;
  const out = $('#codeOut');
  if (v.length < 3) { out.textContent = ''; out.className = ''; return; }
  const st = S.data.stations.find(s => s.code === v);
  out.textContent = st ? `${t('codeOk')} ${st.nr}: ${stationName(st)}` : t('codeBad');
  out.className = st ? 'ok' : 'bad';
});

// ---------------------------------------------------------------- results
$('#resBtn').addEventListener('click', () => { paintResults(); $('#resSheet').hidden = false; showDock(false); });
$('#resClose').addEventListener('click', () => { $('#resSheet').hidden = true; $('#copyArea').hidden = true; showDock(true); });
function fmtTime(iso) { const d = new Date(iso); return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'sr-Latn-ME', { day: 'numeric', month: 'numeric' }) + ' ' + d.toTimeString().slice(0, 5); }
function lineFor(r) {
  const st = S.data.stations.find(s => s.id === r.station);
  const head = `${fmtTime(r.at)} · ${t('l_' + r.light)} · ${st.nr} ${stationName(st)} · ${r.size} (${S.data.sizes[r.size]} mm)`;
  const verdict = r.kind === 'range' ? t('rangeV') : t(r.v);
  const kv = kvFor(r).map(([k, v]) => `${k} ${v}`).join(' · ');
  return { head, verdict, kv, dev: r.dev };
}
function summaryRows() {
  return S.data.stations.map(st => {
    const cell = size => {
      const rs = S.results.filter(r => r.station === st.id && r.size === size && r.kind === 'spot');
      const n = v => rs.filter(r => r.v === v).length;
      return { pass: n('pass'), weak: n('weak'), fail: n('fail') };
    };
    const ranges = S.results.filter(r => r.station === st.id && r.kind === 'range' && r.seen);
    const rng = Object.keys(S.data.sizes).map(sz => { const b = ranges.filter(r => r.size === sz).map(r => r.best); return b.length ? `${sz} ${Math.max(...b).toFixed(1)} m` : null; }).filter(Boolean);
    return { st, cells: Object.fromEntries(Object.keys(S.data.sizes).map(sz => [sz, cell(sz)])), rng };
  });
}
function paintResults() {
  const rows = summaryRows();
  const dots = c => (c.pass + c.weak + c.fail === 0) ? '<span class="dot none">–</span>' :
    ['pass', 'weak', 'fail'].filter(v => c[v]).map(v => `<span class="dot ${v}" title="${t(v)}">${c[v]}</span>`).join('');
  $('#sumBox').innerHTML = S.results.length ? `<table><thead><tr><th>${t('sumSt')}</th>${Object.keys(S.data.sizes).map(s => `<th>${s}</th>`).join('')}<th>${t('sumRange')}</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td>${r.st.nr} ${stationName(r.st)}</td>${Object.keys(S.data.sizes).map(s => `<td>${dots(r.cells[s])}</td>`).join('')}<td>${r.rng.join('<br>') || '–'}</td></tr>`).join('') +
    '</tbody></table>' : '';
  $('#resList').innerHTML = S.results.length ? [...S.results].reverse().map(r => {
    const l = lineFor(r);
    return `<div class="res"><span class="dot ${r.v === 'range' ? 'pass' : r.v}">${l.verdict}</span> <b>${l.head}</b><div class="m">${l.kv}${l.dev ? ' · ' + l.dev : ''}</div></div>`;
  }).join('') : `<div class="empty">${t('empty')}</div>`;
  $('#clearBtn').textContent = t('clear'); clearArm = false;
}
function copyText() {
  const ua = navigator.userAgent;
  const out = [`${t('hdr')} (${VERSION}) · ${new Date().toISOString().slice(0, 10)}`,
    `${t('devLbl')}: ${S.device || '—'}${S.autoModel ? ' · ' + S.autoModel : ''} · ${t('screen')} ${screen.width}×${screen.height}@${devicePixelRatio} · ${t('camLbl')} ${video.videoWidth}×${video.videoHeight} · ${t('zoomLbl')} ${S.zoom}× · fov ${S.fov}°`,
    `UA: ${ua}`, '', `${t('sum')}:`];
  for (const r of summaryRows()) {
    const c = Object.entries(r.cells).map(([sz, x]) => `${sz} ${x.pass}/${x.weak}/${x.fail}`).join('  ');
    out.push(`  ${r.st.nr} ${stationName(r.st)}: ${c}${r.rng.length ? '  · ' + t('sumRange') + ' ' + r.rng.join(', ') : ''}`);
  }
  out.push(`  (${t('pass')}/${t('weak')}/${t('fail')})`, '');
  for (const r of S.results) { const l = lineFor(r); out.push(`${l.head} · ${l.verdict} · ${l.kv}${l.dev ? ' · ' + l.dev : ''}`); }
  return out.join('\n');
}
$('#copyBtn').addEventListener('click', async () => {
  const txt = copyText();
  try { await navigator.clipboard.writeText(txt); toast(t('copied')); $('#copyArea').hidden = true; }
  catch { const a = $('#copyArea'); a.value = txt; a.hidden = false; a.focus(); a.select(); toast(t('copyHand'), 3500); }
});
let clearArm = false;
$('#clearBtn').addEventListener('click', () => {
  if (!clearArm) { clearArm = true; $('#clearBtn').textContent = t('clearQ'); setTimeout(() => { clearArm = false; $('#clearBtn').textContent = t('clear'); }, 3000); return; }
  S.results = []; store.set('soba.results', S.results); paintResults(); paintResCount(); toast(t('cleared'));
});

// ---------------------------------------------------------------- boot
(async () => {
  paintText();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});   // works offline in the room
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const h = await navigator.userAgentData.getHighEntropyValues(['model']);
      if (h.model) S.autoModel = h.model;
    }
  } catch { /* not available */ }
  try { await loadData(); paintText(); } catch { /* retried on start */ }
})();
window.__soba = { S, copyText, get results() { return S.results; } };
