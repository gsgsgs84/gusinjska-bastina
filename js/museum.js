// Gusinjska kulturna baština – museum app: galleries, exhibit viewer, life-size AR, showcase cube.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STR, detectLang, L, HTML_LANG, NUM_LOCALE } from './i18n.js';

const VERSION = '0.7';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };

let lang = store.get('gkb.lang', null) || detectLang();
if (!STR[lang]) lang = 'me';
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
  document.documentElement.lang = HTML_LANG[lang] || 'sr-ME';
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

// ---------------- home ----------------
let SKY = null;
const skyData = () => (SKY ||= fetch('data/skyline.json').then(r => r.json()).catch(() => null));
const dayPool = () => DATA.exhibits.filter(e => !e.heavy && e.model);
const todayIdx = n => { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 6e4) / 864e5) % n; };
let dayI = null;
function dayLabel(d = new Date()) {
  const loc = NUM_LOCALE[lang] || 'sr-Latn-ME';
  if (lang === 'sq' && !Intl.DateTimeFormat.supportedLocalesOf(loc).length)
    return `${d.getDate()} ${['janar', 'shkurt', 'mars', 'prill', 'maj', 'qershor', 'korrik', 'gusht', 'shtator', 'tetor', 'nëntor', 'dhjetor'][d.getMonth()]}`;
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'long' });
}

function renderHome() {
  document.title = DATA.museum.name;
  const pool = dayPool();
  if (dayI === null) dayI = todayIdx(pool.length);
  const ways = [['cube', 'onCube', 'w1'], ['room', 'inRoom', 'w2'], ['touch', 'w3t', 'w3']];
  $('#view').innerHTML = `
    <section class="hero2" id="hero">
      <div class="sky" aria-hidden="true"><span class="moon"></span></div>
      <svg class="ridges" id="ridges" aria-hidden="true" preserveAspectRatio="xMidYMax slice"></svg>
      <div class="hero-txt">
        <p class="kicker">${esc(t('kicker'))}</p>
        <h1>${esc(DATA.museum.name)}</h1>
        <p class="tagline">${esc(tx(DATA.museum.tagline))}</p>
      </div>
      <div class="hero-cta">
        <a class="pill solid" href="#zbirka" id="goCollection">${esc(t('explore'))}</a>
        <a class="pill" href="kocka.html">${ICONS.cube}${esc(t('cubeTitle'))}</a>
      </div>
      <p class="sky-cap" id="skyCap"></p>
    </section>
    <p class="lede2">${esc(tx(DATA.museum.intro))}</p>
    ${pool.length ? `<section class="day" aria-labelledby="dayName">
      <div class="dstage" id="dstage" data-touch="pan-y">
        <span class="chip">${esc(t('dayEx'))} · ${esc(dayLabel())}</span>
        <button class="arrow prev" id="dayPrev" aria-label="${esc(t('prevEx'))}"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <button class="arrow next" id="dayNext" aria-label="${esc(t('nextEx'))}"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
      <a class="dbar" id="dayLink" href="#"><div><h2 id="dayName"></h2><p id="daySub"></p></div><span class="go">${esc(t('openEx'))} →</span></a>
    </section>` : ''}
    <section class="ways">
      <h2 class="sh">${esc(t('waysTitle'))}</h2>
      <div class="ways-row">${ways.map(([ic, a, b]) => `<div class="way"><span class="ic">${ICONS[ic]}</span><b>${esc(t(a))}</b><small>${esc(t(b))}</small></div>`).join('')}</div>
    </section>
    <div class="section-h" id="zbirka"><h2>${esc(t('collection'))}</h2><a href="#galerije" id="goGalleries">${esc(t('allGalleries'))}</a></div>
    <div class="strip">${DATA.exhibits.map(e => `<a class="card" href="#/e/${encodeURIComponent(e.id)}"><div class="img">${thumb(e)}</div><b>${esc(tx(e.name))}</b></a>`).join('')}</div>
    <div class="section-h" id="galerije"><h2>${esc(t('galleries'))}</h2></div>
    <div class="gals2">${DATA.galleries.map(g => {
      const items = inGallery(g.id), four = items.length >= 4;
      return `<a class="gal2" href="#/g/${encodeURIComponent(g.id)}">
        <div class="collage${four ? '' : ' n' + Math.min(items.length, 2)}">${items.slice(0, four ? 4 : 2).map(e => thumb(e)).join('')}</div>
        <div class="gt"><h3>${esc(tx(g.name))}</h3><span class="count">${items.length} ${esc(t(items.length === 1 ? 'exhibit1' : 'exhibitN'))}</span></div></a>`;
    }).join('')}</div>
    <a class="trail2" href="staze.html">
      <img src="thumbs/staze.jpg" alt="" loading="lazy" onerror="this.remove()">
      <div class="tt"><span class="tag2">3D · AR</span><h2>${esc(t('trailsTitle'))}</h2><p>${esc(t('trailsText'))}</p><span class="go">${esc(t('openTrails'))} →</span></div>
    </a>
    <section class="cube2">
      <div class="ct">
        <h2>${esc(t('cubeTitle'))}</h2>
        <p>${esc(t('cubeText'))}</p>
      </div>
      <div class="cubeart" aria-hidden="true">${CUBE_ART}</div>
      <div class="row">
        <a class="solid" href="kocka.html">${esc(t('openCube'))}</a>
        <a href="#/vitrina">${esc(t('showcase'))}${showcase.length ? ` (${showcase.length})` : ''}</a>
        <a href="#/kocka">${esc(t('getCube'))}</a>
      </div>
    </section>
    <footer class="foot"><b>${esc(DATA.museum.name)}</b><span>v${VERSION}</span><small>${esc(t('skyCredit'))}</small></footer>`;
  const jump = (a, id) => a && a.addEventListener('click', ev => { ev.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  jump($('#goCollection'), 'zbirka'); jump($('#goGalleries'), 'galerije');
  drawSky();
  if (pool.length) setupDay(pool);
}

// The panorama is the real skyline seen from 1.5 km north of Gusinje, 400 m up (tools/skyline), drawn in layers by distance.
const SKY_H = 420, SKY_K = 34, SKY_Y0 = 290, SKY_TOP = -120;   // SVG units: height, units per degree of elevation, horizon line
async function drawSky() {
  const svg = $('#ridges'); if (!svg) return;
  const S = await skyData();
  if (!S || svg !== $('#ridges')) return;
  const N = S.N, X = i => (i / (N - 1) * 1000).toFixed(1), Y = el => (SKY_Y0 - Math.max(el, -4) * SKY_K).toFixed(1);
  const smooth = a => a.map((v, i) => (a[Math.max(0, i - 1)] + 2 * v + a[Math.min(a.length - 1, i + 1)]) / 4);
  const path = a => `M0,${SKY_H} ` + a.map((el, i) => `L${X(i)},${Y(el)}`).join(' ') + ` L1000,${SKY_H} Z`;
  const layers = [3, 2, 1].map(b => smooth(S.prof[b]));          // far → near (band 0 is empty from this height)
  const azX = az => (az - S.A0) / (S.A1 - S.A0) * 1000;
  // peaks with a label: sit on the drawn skyline near their azimuth
  const labels = S.peaks.filter(p => ['zla-kolata', 'maja-rosit', 'karanfili', 'talijanka', 'trojan'].includes(p.id)).map(p => {
    const c = Math.round((p.az - S.A0) / (S.A1 - S.A0) * (N - 1));
    let top = -99; for (let i = Math.max(0, c - 4); i <= Math.min(N - 1, c + 4); i++) top = Math.max(top, layers[0][i], layers[1][i], layers[2][i]);
    return { p, x: azX(p.az), y: +Y(top) };
  });
  // stars (dark mode) – fixed pseudo-random so they don't jump between renders
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 70 }, () => `<circle cx="${(rnd() * 1000).toFixed(0)}" cy="${(rnd() * 230 - 120).toFixed(0)}" r="${(0.6 + rnd() * 1.3).toFixed(1)}" opacity="${(0.35 + rnd() * 0.6).toFixed(2)}"/>`).join('');
  // a few pines on the foreground meadow
  const pine = (x, y, h) => `<path d="M${x},${y - h} L${x - h * 0.28},${y - h * 0.45} L${x - h * 0.16},${y - h * 0.45} L${x - h * 0.36},${y} L${x + h * 0.36},${y} L${x + h * 0.16},${y - h * 0.45} L${x + h * 0.28},${y - h * 0.45} Z"/>`;
  const meadow = x => 382 + 8 * Math.sin(x / 70) + 4 * Math.sin(x / 23 + 1);
  const pines = [[0, 34], [22, 26], [40, 40], [62, 22], [80, 30], [905, 30], [925, 44], [948, 28], [966, 36], [986, 24]]
    .map(([x, h]) => pine(x, meadow(x) + 4, h)).join('');
  const sunX = azX(188);
  svg.innerHTML = `
    <defs>
      <linearGradient id="gFar" x1="0" y1="0" x2="0" y2="1"><stop offset="0.28" stop-color="var(--r3a)"/><stop offset="0.75" stop-color="var(--r3b)"/></linearGradient>
      <linearGradient id="gFog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--bg)" stop-opacity="0"/><stop offset="1" stop-color="var(--bg)" stop-opacity="0.95"/></linearGradient>
      <radialGradient id="gSun"><stop offset="0" stop-color="var(--sun)" stop-opacity="0.75"/><stop offset="0.25" stop-color="var(--sun)" stop-opacity="0.28"/><stop offset="1" stop-color="var(--sun)" stop-opacity="0"/></radialGradient>
    </defs>
    <g class="stars par" data-k="0.55">${stars}</g>
    <g class="sun par" data-k="0.5"><circle cx="${sunX}" cy="196" r="230" fill="url(#gSun)"/><circle cx="${sunX}" cy="196" r="38" fill="var(--sun)"/></g>
    <g class="par" data-k="0.42"><path class="ridge r3" d="${path(layers[0])}" fill="url(#gFar)"/></g>
    <g class="par" data-k="0.30"><path class="ridge r2" d="${path(layers[1])}"/></g>
    <g class="par" data-k="0.19"><rect x="-500" y="280" width="2000" height="160" fill="url(#gFog)" class="fog"/><path class="ridge r1" d="${path(layers[2])}"/></g>
    <g class="par" data-k="0.07"><path class="ridge r0" d="M-500,${SKY_H} L0,${meadow(0)} ${Array.from({ length: 51 }, (_, i) => `L${i * 20},${meadow(i * 20).toFixed(1)}`).join(' ')} L1500,${meadow(1000)} L1500,${SKY_H} Z"/><g class="pines">${pines}</g></g>
    <g class="peaks par" data-k="0.42">${labels.map(({ p, x, y }) => `<g class="pk" data-x="${x.toFixed(1)}" transform="translate(${x.toFixed(1)},${y})">
      <line y1="-5" y2="-15"/><text y="-36">${esc(tx(p.name))}</text><text class="ele" y="-21">${p.ele.toLocaleString(NUM_LOCALE[lang] || 'sr-Latn-ME')} m</text></g>`).join('')}</g>`;
  $('#skyCap').textContent = tx(S.view);
  fitSky();
  parallax();
}
// The SVG is drawn with "slice": it is scaled to the hero's height and cropped at the sides. Centre the crop a little right of
// the middle (between Maja Rosit and Karanfili) and anchor the labels near the visible edges inwards.
function fitSky() {
  const svg = $('#ridges'); if (!svg || !svg.firstElementChild) return;
  const hero = $('#hero'), txt = hero.querySelector('.hero-txt');
  hero.style.height = '';
  for (let k = 0; k < 2; k++) {
    const sw = svg.clientWidth, sh = svg.clientHeight, sc = Math.max(sw / 1000, sh / (SKY_H - SKY_TOP));
    const peakTop = hero.clientHeight - (SKY_H - (SKY_Y0 - 5.6 * SKY_K - 58)) * sc;    // highest label, px from hero top
    const need = txt.offsetTop + txt.offsetHeight + 14 - peakTop;
    if (need <= 1) break;
    hero.style.height = (hero.clientHeight + need) + 'px';
  }
  const w = svg.clientWidth, h = svg.clientHeight; if (!w || !h) return;
  const vh = SKY_H - SKY_TOP, vis = Math.min(1000, vh * w / h);        // SVG units visible across
  const cx = 500 + Math.min(40, (1000 - vis) / 2);
  const x0 = Math.max(0, Math.min(1000 - vis, cx - vis / 2));
  svg.setAttribute('viewBox', `${x0.toFixed(0)} ${SKY_TOP} ${vis.toFixed(0)} ${vh}`);
  for (const g of svg.querySelectorAll('.pk')) {
    const rel = (+g.dataset.x - x0) / vis;
    g.style.display = rel < 0.03 || rel > 0.97 ? 'none' : '';
    const a = rel < 0.16 ? 'start' : rel > 0.84 ? 'end' : 'middle';
    for (const tEl of g.querySelectorAll('text')) { tEl.setAttribute('text-anchor', a); tEl.setAttribute('x', a === 'start' ? -6 : a === 'end' ? 6 : 0); }
  }
}
function parallax() {
  const hero = $('#hero'); if (!hero) return;
  const y = Math.min(window.scrollY, hero.offsetHeight), svg = $('#ridges');
  const unit = (SKY_H - SKY_TOP) / Math.max(1, svg.clientHeight);     // px → SVG units
  for (const g of svg.querySelectorAll('.par')) g.setAttribute('transform', `translate(0,${(-y * (+g.dataset.k) * unit * -1).toFixed(1)})`);
}
let parT = 0;
window.addEventListener('scroll', () => { if (!parT && !matchMedia('(prefers-reduced-motion: reduce)').matches) parT = requestAnimationFrame(() => { parT = 0; parallax(); }); }, { passive: true });
window.addEventListener('resize', () => fitSky());

function setupDay(pool) {
  const stage = $('#dstage');
  let mounted = false;
  const show = () => {
    const e = pool[((dayI % pool.length) + pool.length) % pool.length];
    $('#dayName').textContent = tx(e.name);
    $('#daySub').textContent = tx(e.subtitle);
    $('#dayLink').href = '#/e/' + encodeURIComponent(e.id);
    stage.querySelector('.ph')?.remove();
    stage.insertAdjacentHTML('afterbegin', e.thumb ? `<img class="ph loading" src="${esc(e.thumb)}" alt="">` : '');
    if (mounted) mountViewer(stage, e);
    return e;
  };
  show();
  const mount = () => { if (mounted) return; mounted = true; stage.classList.remove('tap'); mountViewer(stage, pool[((dayI % pool.length) + pool.length) % pool.length]); };
  const saveData = navigator.connection && navigator.connection.saveData;
  if (saveData) { stage.classList.add('tap'); stage.insertAdjacentHTML('beforeend', `<span class="tap3d">${esc(t('tap3d'))}</span>`); stage.addEventListener('click', ev => { if (!ev.target.closest('.arrow')) mount(); }); }
  else if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); mount(); } }, { rootMargin: '250px' });
    io.observe(stage);
  } else mount();
  $('#dayPrev').addEventListener('click', () => { dayI--; show(); });
  $('#dayNext').addEventListener('click', () => { dayI++; show(); });
}

const CUBE_ART = (() => {   // isometric marker cube, faces drawn as 4×4 cell patterns like the real markers
  const pat = ['1001011001101001', '0110100110010110', '1010010110100101'];
  const face = (o, u, v, bits, shade) => {
    let d = `<path d="M${o[0]},${o[1]} l${u[0]},${u[1]} l${v[0]},${v[1]} l${-u[0]},${-u[1]} Z" fill="var(--cf${shade})"/>`;
    for (let i = 0; i < 16; i++) if (bits[i] === '1') {
      const a = (i % 4 + 0.5) / 5.6 + 0.08, b = (Math.floor(i / 4) + 0.5) / 5.6 + 0.08, s = 1 / 5.6;
      const p = [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b];
      d += `<path d="M${p[0].toFixed(1)},${p[1].toFixed(1)} l${(u[0] * s).toFixed(1)},${(u[1] * s).toFixed(1)} l${(v[0] * s).toFixed(1)},${(v[1] * s).toFixed(1)} l${(-u[0] * s).toFixed(1)},${(-u[1] * s).toFixed(1)} Z" fill="#1d1a16"/>`;
    }
    return d;
  };
  return `<svg viewBox="0 0 120 130"><ellipse cx="60" cy="122" rx="34" ry="6" fill="rgba(0,0,0,.22)" class="cshadow"/><g class="cbody">
    ${face([60, 10], [44, 24], [-44, 24], pat[0], 1)}${face([16, 34], [44, 24], [0, 50], pat[1], 2)}${face([60, 58], [44, -24], [0, 50], pat[2], 3)}</g></svg>`;
})();

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
  touch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V5.5a1.5 1.5 0 013 0V10"/><path d="M12 9.5a1.5 1.5 0 013 0v1a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-.5a5.5 5.5 0 01-4.6-2.5L5 15.5a1.6 1.6 0 012.6-1.8L9 15"/><path d="M5 6.5a5 5 0 0111 0" opacity=".5"/></svg>',
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
  if (m >= 1) return (Math.round(m * 10) / 10).toLocaleString(NUM_LOCALE[lang] || 'sr-Latn-ME') + ' m';
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

const V = { visible: true, io: null, renderer: null, scene: null, camera: null, controls: null, item: null, host: null, ro: null, ground: null, sun: null, interacted: false };
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
  if (V.host && V.host !== host) V.ro.unobserve(V.host);
  V.renderer.domElement.style.touchAction = host.dataset.touch || 'none';   // home card: vertical swipes still scroll the page
  V.host = host; host.appendChild(V.renderer.domElement); V.ro.observe(host); sizeViewer();
  if ('IntersectionObserver' in window) {
    V.io ||= new IntersectionObserver(es => { for (const x of es) if (x.target === V.host) V.visible = x.isIntersecting; });
    V.io.disconnect(); V.visible = true; V.io.observe(host);
  }
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
  if (!V.host || !V.visible) return;
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
