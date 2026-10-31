// Gdje su mace? – AR hide-and-seek in your own room.
// Room tracking (8th Wall XR Engine) follows the phone; a short scan collects tracked points, mace-room.js finds hiding
// spots in them, and nine kittens hide there: 5 white ones sit still, 3 grey ones keep walking, 1 black one dashes
// between hiding places and runs away from a fast-moving phone. Aim the cat-head reticle at a kitten and hold.
// Without a camera (computer) the same game runs in a furnished test room.
import * as THREE from 'three';
import { makeCat, KINDS, HEAD_PATH } from './mace-cat.js';
import { analyseRoom } from './mace-room.js';
import { makeSound } from './mace-sound.js';
import { logoSVG } from './logo.js';
import { detectLang } from './i18n.js';

const $ = s => document.querySelector(s);
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

// ---------------- texts ----------------
const STR = {
  me: {
    title: 'Gdje su mace?', kicker: 'Igra u vašoj sobi', museum: 'Muzej',
    lead: 'Devet maca se sakrilo po vašoj sobi: na stvarima, iza njih i ispod njih. Pronađite ih kamerom telefona!',
    k_white: '<b>5 bijelih</b> mirno sjede na svom mjestu', k_grey: '<b>3 sive</b> stalno šetaju po sobi', k_black: '<b>1 crna</b> je brza i plašljiva – pojavi se na kraju',
    how: 'Nanišanite mačjom glavom na macu i držite dok se glava ne napuni.',
    startAR: 'Pokreni kameru', demo: 'Probna soba (bez kamere)', demoFirst: 'Igraj u probnoj sobi', camToo: 'Probaj s kamerom',
    note: 'Treba vam oko 2 × 2 m slobodnog prostora. Gledajte oko sebe dok hodate. Slika s kamere ostaje na telefonu.',
    noteDesk: 'Na računaru igrate u probnoj sobi. Na telefonu se mace sakriju u vašoj pravoj sobi.',
    best: 'Najbolje vrijeme: {t}', foot: 'Gusinjska kulturna baština · Xplore Prokletije',
    loading: 'Pokrećem praćenje prostora…', init: 'Usmjerite telefon u pod i polako ga pomjerite u stranu',
    scan: 'Polako pređite telefonom po sobi: pod, namještaj, ćoškovi', scanMore: 'Još malo…', scanDone: 'Gotovo! Mace se kriju…',
    hideBtn: 'Sakrij mace', hidden: 'Mace su se sakrile! Pronađite svih 9.', hiddenDemo: 'Mace su se sakrile u sobi. Pronađite svih 9!',
    lost: 'Praćenje je izgubljeno – polako vratite telefon tamo gdje je bio', resumed: 'Opet vidim sobu',
    blackCome: 'Pojavila se crna maca! Plašljiva je: priđite joj polako.', bolt: 'Prebrzo! Crna maca je pobjegla.',
    meow: 'Mjau', meowHint: 'Slušajte odakle se javlja', fish: 'Riba', fishHint: 'Riba je na podu – crna maca dolazi da jede',
    fishNo: 'Nanišanite pod ili sto pa bacite ribu', fishWait: 'Sačekajte malo…',
    found: 'Pronađena: {name}', left: 'Još {n}',
    win: 'Sve mace su pronađene!', time: 'Vrijeme', hints: 'Mjaukanja', bestT: 'Najbolje',
    again: 'Igraj ponovo', rescan: 'Skeniraj ponovo', back: '← Nazad u muzej', newBest: 'Novi rekord!',
    sound: 'Zvuk', close: 'Zatvori',
    demoHelp: 'Prevucite mišem da gledate · W A S D za hodanje · Q / E dolje i gore',
    demoHelpTouch: 'Jednim prstom gledajte okolo, s dva prsta hodajte',
    arFail: 'Praćenje prostora se nije pokrenulo na ovom telefonu. Probajte u probnoj sobi.',
    camBlocked: 'Pristup kameri je blokiran. Dozvolite kameru u podešavanjima preglednika.',
    noCam: 'Kamera nije pronađena.', motionBlocked: 'Za praćenje prostora trebaju senzori pokreta telefona. Dozvolite ih, ili igrajte u probnoj sobi.', engineCredit: 'Praćenje prostora: 8th Wall XR Engine (© Niantic Spatial)',
    sneak: 'Polako…',
  },
  sq: {
    title: 'Ku janë macet?', kicker: 'Lojë në dhomën tuaj', museum: 'Muzeu',
    lead: 'Nëntë mace janë fshehur nëpër dhomën tuaj: mbi sende, pas tyre dhe poshtë tyre. Gjejini me kamerën e telefonit!',
    k_white: '<b>5 të bardha</b> rrinë urtë në vendin e tyre', k_grey: '<b>3 gri</b> ecin pa pushim nëpër dhomë', k_black: '<b>1 e zezë</b> është e shpejtë dhe e trembur – del në fund',
    how: 'Shenjoni macen me kokën e maces dhe mbajeni derisa koka të mbushet.',
    startAR: 'Ndizni kamerën', demo: 'Dhoma provë (pa kamerë)', demoFirst: 'Luani në dhomën provë', camToo: 'Provoni me kamerë',
    note: 'Ju duhen rreth 2 × 2 m hapësirë e lirë. Shikoni përreth kur ecni. Pamja e kamerës mbetet në telefon.',
    noteDesk: 'Në kompjuter luani në dhomën provë. Në telefon macet fshihen në dhomën tuaj të vërtetë.',
    best: 'Koha më e mirë: {t}', foot: 'Trashëgimia kulturore e Gucisë · Xplore Prokletije',
    loading: 'Po nis ndjekja e hapësirës…', init: 'Drejtojeni telefonin nga dyshemeja dhe lëvizeni ngadalë anash',
    scan: 'Kalojeni ngadalë telefonin nëpër dhomë: dysheme, mobilje, qoshe', scanMore: 'Edhe pak…', scanDone: 'Gati! Macet po fshihen…',
    hideBtn: 'Fshihi macet', hidden: 'Macet u fshehën! Gjeni të 9.', hiddenDemo: 'Macet u fshehën në dhomë. Gjeni të 9!',
    lost: 'Ndjekja humbi – ktheni ngadalë telefonin aty ku ishte', resumed: 'Po e shoh sërish dhomën',
    blackCome: 'U shfaq macja e zezë! Është e trembur: afrohuni ngadalë.', bolt: 'Shumë shpejt! Macja e zezë iku.',
    meow: 'Mjau', meowHint: 'Dëgjoni nga vjen zëri', fish: 'Peshk', fishHint: 'Peshku është në dysheme – macja e zezë vjen të hajë',
    fishNo: 'Shenjoni dyshemenë ose tavolinën dhe hidhni peshkun', fishWait: 'Prisni pak…',
    found: 'U gjet: {name}', left: 'Edhe {n}',
    win: 'Të gjitha macet u gjetën!', time: 'Koha', hints: 'Mjaullima', bestT: 'Më e mira',
    again: 'Luani përsëri', rescan: 'Skanoni përsëri', back: '← Kthehu te muzeu', newBest: 'Rekord i ri!',
    sound: 'Zëri', close: 'Mbyll',
    demoHelp: 'Tërhiqni me mi për të parë · W A S D për të ecur · Q / E poshtë dhe lart',
    demoHelpTouch: 'Me një gisht shikoni përreth, me dy gishta ecni',
    arFail: 'Ndjekja e hapësirës nuk u nis në këtë telefon. Provoni në dhomën provë.',
    camBlocked: 'Qasja në kamerë është bllokuar. Lejojeni kamerën te cilësimet e shfletuesit.',
    noCam: 'Nuk u gjet kamerë.', motionBlocked: 'Ndjekja e hapësirës ka nevojë për sensorët e lëvizjes së telefonit. Lejojini, ose luani në dhomën provë.', engineCredit: 'Ndjekja e hapësirës: 8th Wall XR Engine (© Niantic Spatial)',
    sneak: 'Ngadalë…',
  },
  en: {
    title: 'Where are the kittens?', kicker: 'A game in your room', museum: 'Museum',
    lead: 'Nine kittens are hiding around your room: on things, behind them and under them. Find them with your phone\'s camera!',
    k_white: '<b>5 white</b> ones sit still in their spot', k_grey: '<b>3 grey</b> ones keep walking around', k_black: '<b>1 black</b> one is fast and shy – she comes out last',
    how: 'Aim the cat head at a kitten and hold until the head fills up.',
    startAR: 'Start the camera', demo: 'Test room (no camera)', demoFirst: 'Play in the test room', camToo: 'Try with the camera',
    note: 'You need about 2 × 2 m of free space. Look around you as you walk. The camera picture stays on your phone.',
    noteDesk: 'On a computer you play in the test room. On a phone the kittens hide in your real room.',
    best: 'Best time: {t}', foot: 'Gusinje Cultural Heritage · Xplore Prokletije',
    loading: 'Starting room tracking…', init: 'Point the phone at the floor and move it slowly sideways',
    scan: 'Slowly sweep the phone around the room: floor, furniture, corners', scanMore: 'A little more…', scanDone: 'Done! The kittens are hiding…',
    hideBtn: 'Hide the kittens', hidden: 'The kittens have hidden! Find all 9.', hiddenDemo: 'The kittens are hiding in the room. Find all 9!',
    lost: 'Tracking lost – slowly point the phone back where it was', resumed: 'I can see the room again',
    blackCome: 'The black kitten is out! She is shy: approach slowly.', bolt: 'Too fast! The black kitten ran away.',
    meow: 'Meow', meowHint: 'Listen where it comes from', fish: 'Fish', fishHint: 'The fish is down – the black kitten comes to eat',
    fishNo: 'Aim at the floor or a table, then toss the fish', fishWait: 'Wait a moment…',
    found: 'Found: {name}', left: '{n} to go',
    win: 'All the kittens are found!', time: 'Time', hints: 'Meows', bestT: 'Best',
    again: 'Play again', rescan: 'Scan again', back: '← Back to the museum', newBest: 'New record!',
    sound: 'Sound', close: 'Close',
    demoHelp: 'Drag with the mouse to look · W A S D to walk · Q / E down and up',
    demoHelpTouch: 'One finger to look around, two fingers to walk',
    arFail: 'Room tracking did not start on this phone. Try the test room.',
    camBlocked: 'Camera access is blocked. Allow the camera in the browser settings.',
    noCam: 'No camera found.', motionBlocked: 'Room tracking needs the phone\'s motion sensors. Allow them, or play in the test room.', engineCredit: 'Room tracking: 8th Wall XR Engine (© Niantic Spatial)',
    sneak: 'Slowly…',
  },
};
let lang = store.get('gkb.lang', null) || detectLang();
if (!STR[lang]) lang = 'me';
const t = (k, v) => String(STR[lang][k] ?? STR.me[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? '');
const mmss = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const DEFS = [
  ['white', 'Mica'], ['white', 'Snješka'], ['white', 'Pahulja'], ['white', 'Bijelka'], ['white', 'Mrvica'],
  ['grey', 'Sivko'], ['grey', 'Dimko'], ['grey', 'Maza'], ['black', 'Noćka'],
].map(([kind, name], i) => ({ kind, name, i }));
const FILL = { white: 1.0, grey: 2.0, black: 1.5 };          // seconds of aiming to catch
const DRAIN = { white: 3, grey: 0.25, black: 1 };             // how fast the head empties when you lose the cat
const PITCH = { white: 1.18, grey: 1.0, black: 0.86 };

// ---------------- heads (reticle, checklist) ----------------
const headSVG = (cls = '') => `<svg viewBox="0 0 100 100" class="head ${cls}"><path d="${HEAD_PATH}"/></svg>`;
function reticleSVG() {
  return `<svg viewBox="0 0 100 100" class="ret-svg">
    <defs><clipPath id="retClip"><path d="${HEAD_PATH}"/></clipPath></defs>
    <g class="ret-head">
      <path class="ret-bg" d="${HEAD_PATH}"/>
      <rect class="ret-fill" id="retFill" x="0" y="100" width="100" height="100" clip-path="url(#retClip)"/>
      <path class="ret-edge-d" d="${HEAD_PATH}"/><path class="ret-edge" d="${HEAD_PATH}"/>
      <g class="ret-eyes" id="retEyes">
        <circle class="ret-eye" cx="37" cy="57" r="4.6"/><circle class="ret-eye" cx="63" cy="57" r="4.6"/>
        <path class="ret-happy" d="M31 59 Q37 51 43 59 M57 59 Q63 51 69 59"/>
      </g>
      <path class="ret-nose" d="M46.5 67 L53.5 67 L50 71.5 Z"/>
      <g class="ret-whisk"><path d="M33 70 L8 66 M33 74 L8 78 M67 70 L92 66 M67 74 L92 78"/></g>
    </g></svg>`;
}

// ---------------- three.js ----------------
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);
renderer.domElement.className = 'm-gl';
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xfffaf0, 0x8d8272, 1.9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(1.2, 3, 1.6); scene.add(sun); scene.add(sun.target);
const arCam = new THREE.PerspectiveCamera(60, 1, 0.02, 60);
const demoCam = new THREE.PerspectiveCamera(64, 1, 0.03, 60);
let cam = demoCam;
const catsGroup = new THREE.Group(); scene.add(catsGroup);
const fx = new THREE.Group(); scene.add(fx);
let occluders = null, demo = null, dots = null, debugGroup = null;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, G.mode === 'ar' ? 1.5 : 2));
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + 'px'; renderer.domElement.style.height = h + 'px';
  demoCam.aspect = w / h; demoCam.updateProjectionMatrix();
  if (G.mode === 'ar') {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    feed.width = Math.round(w * dpr); feed.height = Math.round(h * dpr);
  }
}
addEventListener('resize', () => resize());

// ---------------- game state ----------------
const sound = makeSound();
sound.on = store.get('gkb.mace.sound', true);
const G = {
  mode: null, phase: 'start', room: null, points: new Map(), cams: [], sectors: new Set(), seed: 1,
  cats: [], time: 0, hints: 0, caught: 0, target: null, lastTarget: null,
  speed: 0, ang: 0, prevPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(), havePrev: false,
  track: { status: 'LIMITED', reason: 'INITIALIZING', ok: false, lostT: 0, pose: false },
  fish: null, fishCool: 0, meowCool: 0, look: null, lookT: 0, flinchT: 0, happyT: 0, msgT: 0, bolts: 0,
  exposure: 0, scanDoneT: 0,
};

function buildCats() {
  catsGroup.clear();
  G.cats = DEFS.map(d => {
    const cat = makeCat(d.kind, d.i + 1);
    cat.root.visible = false; catsGroup.add(cat.root);
    return { ...d, cat, state: 'hidden', fill: 0, path: null, seg: 0, s: 0, speed: 0, loop: false, rest: 0, mode: 'rest', spot: 0, bellT: 0, happyT: 0, yaw: 0, lens: null };
  });
}

// ---- paths: walk along a polyline; a step up or down becomes a little jump ----
function setPath(c, pts, speed, loop) {
  const path = pts.map(p => ({ x: p.x, y: p.y, z: p.z }));
  if (loop && path.length > 2) { const a = path[path.length - 1], b = path[0]; if (Math.hypot(b.x - a.x, b.z - a.z) > 0.03) path.push({ ...b }); }
  c.path = path; c.loop = loop; c.seg = 0; c.s = 0; c.speed = speed; c.lens = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1], hl = Math.hypot(b.x - a.x, b.z - a.z), dy = Math.abs(b.y - a.y);
    c.lens.push(Math.max(0.01, hl + (dy > 0.06 ? dy * 1.5 + 0.1 : 0)));
  }
}
const _p = new THREE.Vector3();
function stepPath(c, dt) {               // returns true at the end of a one-way path
  if (!c.path || c.path.length < 2) return true;
  c.s += c.speed * dt;
  while (c.s >= c.lens[c.seg]) {
    c.s -= c.lens[c.seg]; c.seg++;
    if (c.seg >= c.lens.length) { if (c.loop) c.seg = 0; else { c.seg = c.lens.length - 1; c.s = c.lens[c.seg]; placeOnPath(c); return true; } }
  }
  placeOnPath(c);
  return false;
}
function placeOnPath(c) {
  const a = c.path[c.seg], b = c.path[c.seg + 1], f = Math.min(1, c.s / c.lens[c.seg]);
  const dy = b.y - a.y;
  _p.set(a.x + (b.x - a.x) * f, a.y + dy * f, a.z + (b.z - a.z) * f);
  if (Math.abs(dy) > 0.06) _p.y += 4 * (0.08 + Math.max(0, dy) * 0.25) * f * (1 - f);    // hop
  c.cat.root.position.copy(_p);
  c.cat.jump = 0;
  const hl = Math.hypot(b.x - a.x, b.z - a.z);
  if (hl > 0.01) c.yaw = Math.atan2(b.x - a.x, b.z - a.z);
}
function turnTo(c, dt, rate = 8) {
  let d = c.yaw - c.cat.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
  c.cat.root.rotation.y += d * (1 - Math.exp(-dt * rate));
}

// ---- place the cats in the analysed room ----
function placeAll() {
  const R = G.room;
  G.caught = 0; G.time = 0; G.hints = 0; G.bolts = 0; G.target = G.lastTarget = null; removeFish();
  for (const c of G.cats) {
    c.fill = 0; c.happyT = 0; c.cat.jump = 0; c.path = null; c.cat.root.visible = false; c.state = 'hidden';
  }
  const whites = G.cats.filter(c => c.kind === 'white'), greys = G.cats.filter(c => c.kind === 'grey'), black = G.cats.find(c => c.kind === 'black');
  whites.forEach((c, i) => {
    const s = R.whites[i];
    c.cat.root.position.set(s.x, s.y, s.z); c.cat.root.rotation.y = c.yaw = s.yaw; c.cat.pose = s.pose; c.spotType = s.type;
    c.state = 'active'; c.cat.root.visible = true;
  });
  greys.forEach((c, i) => {
    const g = R.greys[i % R.greys.length];
    setPath(c, g.path, 0.27 + 0.05 * i, true);
    c.s = 0.4 * i; stepPath(c, 0);
    c.cat.root.rotation.y = c.yaw; c.cat.pose = 'walk'; c.cat.speed = c.speed;
    c.state = 'active'; c.cat.root.visible = true;
  });
  black.state = 'waiting'; black.mode = 'rest'; black.spot = 0;
  for (const c of G.cats) c.cat.update(0.5);
  paintList();
  if (DEBUG) debugRoom();
}
function activateBlack() {
  const c = G.cats.find(k => k.kind === 'black');
  if (!c || c.state !== 'waiting') return;
  const sp = G.room.blackSpots[0];
  c.cat.root.position.set(sp.x, sp.y, sp.z); c.cat.root.rotation.y = c.yaw = sp.yaw;
  c.state = 'active'; c.mode = 'rest'; c.rest = 4; c.spot = 0; c.cat.pose = sp.type === 'under' ? 'loaf' : 'sit'; c.cat.root.visible = true;
  $('#btnFish').hidden = false;
  showMsg(t('blackCome'), 5);
  sound.meow(c.cat.center(new THREE.Vector3()), PITCH.black);
  paintList();
}
function blackDash(c, to, speed = 1.9) {
  const from = c.cat.root.position.clone();
  const pts = G.room.route({ x: from.x, y: from.y, z: from.z }, to);
  setPath(c, pts, speed, false);
  c.mode = 'dash'; c.cat.pose = 'run'; c.cat.speed = speed; c.fill = 0; c.dest = to;
}
function blackNext(c, scared) {
  const spots = G.room.blackSpots, cp = cam.getWorldPosition(new THREE.Vector3());
  let best = -1, bd = -1;
  spots.forEach((s, i) => {
    if (i === c.spot) return;
    const d = Math.hypot(s.x - cp.x, s.z - cp.z) * (scared ? 1 : 0.4) + Math.random() * 1.2;
    if (d > bd) { bd = d; best = i; }
  });
  c.spot = best < 0 ? (c.spot + 1) % spots.length : best;
  blackDash(c, spots[c.spot], scared ? 2.3 : 1.7);
}

// ---------------- frame loop ----------------
let lastT = performance.now();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), camPos = new THREE.Vector3(), camFwd = new THREE.Vector3(), camUp = new THREE.Vector3();
const samples = [];
const ray = new THREE.Raycaster(), rayDir = new THREE.Vector3();
let demoSolids = [];

function blocked(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, d = Math.hypot(dx, dy, dz);
  if (G.mode === 'demo') {
    ray.set(from, rayDir.set(dx / d, dy / d, dz / d)); ray.near = 0; ray.far = d - 0.06;
    return ray.intersectObjects(demoSolids, false).length > 0;
  }
  return G.room ? G.room.rayHit(from.x, from.y, from.z, dx, dy, dz, d - 0.07) < d - 0.07 : false;
}
// screen-space info about a cat: is any of it visible, and how close is it to the reticle?
function aimInfo(c, W, H, retR) {
  const ctr = c.cat.center(tmpV);
  const dist = ctr.distanceTo(camPos);
  if (dist > 7) return null;
  const cs = tmpV2.copy(ctr).applyMatrix4(cam.matrixWorldInverse);
  if (cs.z > -0.05) return null;                               // behind the phone
  const pts = c.cat.samples(samples);
  let best = Infinity, vis = 0, onScreen = 0;
  for (const p of pts) {
    const q = p.clone().project(cam);
    if (q.z > 1 || Math.abs(q.x) > 1.1 || Math.abs(q.y) > 1.1) continue;
    onScreen++;
    if (blocked(camPos, p)) continue;
    vis++;
    const sx = (q.x + 1) / 2 * W, sy = (1 - q.y) / 2 * H, d = Math.hypot(sx - W / 2, sy - H / 2);
    if (d < best) best = d;
  }
  if (!vis) return { vis: 0, onScreen, dist };
  const rpx = 0.085 * c.cat.size / -cs.z * cam.projectionMatrix.elements[5] * H / 2;
  const reach = rpx * 1.1 + retR * (c.kind === 'grey' ? 0.75 : 0.5);
  return { vis: vis / pts.length, onScreen, dist, d: best, rpx, reach, hit: best < reach, score: best / reach };
}

function loop() {
  const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (G.mode === 'demo') demoStep(dt);
  else if (G.mode === 'ar') arStep(dt);
  cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  cam.getWorldPosition(camPos);
  camFwd.set(0, 0, -1).applyQuaternion(cam.quaternion); camUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
  sound.listener(camPos, camFwd, camUp);
  // how fast is the phone moving / turning? (the black cat runs from a fast phone)
  if (G.havePrev && dt > 0) {
    const v = camPos.distanceTo(G.prevPos) / dt, w = G.prevQuat.angleTo(cam.quaternion) / dt;
    const a = 1 - Math.exp(-dt * 7);
    G.speed += (Math.min(v, 5) - G.speed) * a; G.ang += (Math.min(w, 10) - G.ang) * a;
  }
  G.prevPos.copy(camPos); G.prevQuat.copy(cam.quaternion); G.havePrev = true;

  if (G.phase === 'play') playStep(dt);
  for (const c of G.cats) if (c.cat.root.visible) c.cat.update(dt);
  fxStep(dt);
  renderer.render(scene, cam);
  if (DEBUG) debugText();
}

function playStep(dt) {
  const tracking = G.mode !== 'ar' || G.track.ok;
  if (tracking && !document.hidden) G.time += dt;
  $('#timer').textContent = mmss(G.time);
  G.meowCool = Math.max(0, G.meowCool - dt); G.fishCool = Math.max(0, G.fishCool - dt);
  G.lookT = Math.max(0, G.lookT - dt); G.flinchT = Math.max(0, G.flinchT - dt); G.happyT = Math.max(0, G.happyT - dt);
  if (G.msgT > 0 && (G.msgT -= dt) <= 0) showMsg('');

  // movement
  for (const c of G.cats) {
    if (c.state === 'caught') {
      if (c.happyT > 0) {
        c.happyT -= dt;
        const k = 1.3 - c.happyT;
        c.cat.jump = k < 0.7 ? Math.max(0, Math.sin(k / 0.7 * Math.PI)) * 0.1 : 0;
        if (c.happyT <= 0) { c.cat.pose = 'sit'; c.cat.jump = 0; }
      }
      c.yaw = Math.atan2(camPos.x - c.cat.root.position.x, camPos.z - c.cat.root.position.z);
      turnTo(c, dt, 3);
      continue;
    }
    if (c.state !== 'active') continue;
    if (c.kind === 'grey') { stepPath(c, dt); turnTo(c, dt, 6); }
    if (c.kind === 'black') blackStep(c, dt);
  }

  // aiming
  const W = innerWidth, H = innerHeight, retR = retEl.getBoundingClientRect().width / 2 || 34;
  let target = null, ts = Infinity, near = false;
  const infos = new Map();
  if (tracking) for (const c of G.cats) {
    if (c.state !== 'active') continue;
    const inf = aimInfo(c, W, H, retR);
    if (!inf) continue;
    infos.set(c, inf);
    if (inf.vis && inf.d < inf.reach * 3) near = true;
    if (inf.hit && inf.score < ts) { ts = inf.score; target = c; }
  }
  const slow = G.speed < 0.32 && G.ang < 1.1;
  for (const c of G.cats) {
    if (c.state !== 'active') continue;
    if (c === target) {
      if (c.kind === 'black' && !slow) { c.fill = Math.max(0, c.fill - dt * DRAIN.black); continue; }
      c.fill += dt / FILL[c.kind];
      if (c.fill >= 1) { catchCat(c); target = null; }
    } else c.fill = Math.max(0, c.fill - dt * DRAIN[c.kind]);
  }
  // the black cat runs away from a phone that moves fast near her
  const black = G.cats.find(c => c.kind === 'black');
  if (black && black.state === 'active' && black.mode !== 'dash') {
    const inf = infos.get(black);
    black.boltCool = Math.max(0, (black.boltCool || 0) - dt);
    if (inf && inf.vis && inf.dist < 2.6 && (G.speed > 0.5 || G.ang > 1.7) && !black.boltCool) bolt(black);
  }
  G.target = target; if (target) G.lastTarget = target;
  sound.purr(target ? 0.4 + target.fill * 0.6 : 0);
  paintReticle(near);
}

function blackStep(c, dt) {
  if (c.mode === 'dash') {
    c.bellT -= dt;
    if (c.bellT <= 0) { c.bellT = 0.2; sound.bell(c.cat.root.position); }
    if (stepPath(c, dt)) {
      const atFish = G.fish && c.dest === G.fish.spot;
      c.mode = atFish ? 'eat' : 'rest';
      c.rest = atFish ? 7 : 3.2 + Math.random() * 1.2;
      c.cat.pose = atFish ? 'loaf' : (c.dest && c.dest.type === 'under') ? 'loaf' : 'sit';
      if (!atFish && c.dest && c.dest.yaw != null) c.yaw = c.dest.yaw;
      if (atFish) c.yaw = Math.atan2(G.fish.spot.x - c.cat.root.position.x + 1e-4, G.fish.spot.z - c.cat.root.position.z);
    }
    turnTo(c, dt, 12);
    return;
  }
  // resting or eating: she stays while someone is gently petting her
  const petting = G.target === c && c.fill > 0;
  if (!petting) c.rest -= dt;
  turnTo(c, dt, 4);
  if (c.mode === 'eat' && G.fish) G.fish.mesh.scale.setScalar(Math.max(0.2, c.rest / 7));
  if (c.rest <= 0) {
    if (c.mode === 'eat') removeFish();
    blackNext(c, false);
  }
}
function bolt(c) {
  c.boltCool = 1.2; G.bolts++;
  sound.hiss(c.cat.center(new THREE.Vector3()));
  G.flinchT = 0.6;
  if (c.mode === 'eat') removeFish();
  blackNext(c, true);
  // the reticle's eyes look where she ran
  const p = c.dest ? tmpV.set(c.dest.x, c.dest.y + 0.1, c.dest.z) : c.cat.center(tmpV);
  lookToward(p);
  if (G.bolts <= 3) showMsg(t('bolt'), 2.5);
  if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
}

function catchCat(c) {
  c.state = 'caught'; c.fill = 1; G.caught++;
  c.cat.pose = 'happy'; c.happyT = 1.3; c.path = null;
  G.happyT = 1.2;
  hearts(c.cat.center(new THREE.Vector3()));
  sound.chime(G.caught); sound.purr(0);
  if (navigator.vibrate) navigator.vibrate(45);
  const left = 9 - G.caught;
  showMsg(t('found', { name: c.name }) + (left ? ' · ' + t('left', { n: left }) : ''), 2.4);
  paintList(c);
  if (G.cats.filter(k => k.kind === 'white').every(k => k.state === 'caught')) setTimeout(activateBlack, 1400);
  if (c.kind === 'black') { $('#btnFish').hidden = true; removeFish(); }
  if (G.caught === 9) setTimeout(win, 1900);
}

// ---------------- fish (lure for the black cat) ----------------
function fishMesh() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x8fb4c8, roughness: 0.35, metalness: 0.3 });
  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), m); b.scale.set(0.022, 0.016, 0.06); b.position.y = 0.016; g.add(b);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.03, 4), m); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.016, -0.07); tail.scale.x = 0.3; g.add(tail);
  const e = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), new THREE.MeshBasicMaterial({ color: 0x111111 })); e.position.set(0.016, 0.022, 0.035); g.add(e);
  return g;
}
function tossFish() {
  sound.init();
  const black = G.cats.find(c => c.kind === 'black');
  if (!black || black.state !== 'active') return;
  if (G.fishCool > 0) { showMsg(t('fishWait'), 1.5); return; }
  const dir = camFwd.clone();
  let spot = null;
  if (G.mode === 'demo') {
    ray.set(camPos, dir); ray.near = 0; ray.far = 6;
    const hit = ray.intersectObjects(demoSolids.concat(demo.floor ? [demo.floor] : []), false)[0];
    if (hit && hit.face && hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y > 0.6) spot = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
  } else if (G.room) spot = G.room.land(camPos, dir);
  if (!spot) { showMsg(t('fishNo'), 2); return; }
  removeFish();
  const mesh = fishMesh(); mesh.position.set(spot.x, spot.y, spot.z); mesh.rotation.y = Math.random() * 6; fx.add(mesh);
  G.fish = { spot: { ...spot, type: 'fish' }, mesh };
  G.fishCool = 8;
  sound.plop(spot);
  showMsg(t('fishHint'), 2.5);
  if (black.mode !== 'dash' || black.dest !== G.fish.spot) {
    // she comes to eat, a little to the side of the fish
    const p = black.cat.root.position, d = Math.hypot(spot.x - p.x, spot.z - p.z) || 1;
    const to = { x: spot.x - (spot.x - p.x) / d * 0.12, y: spot.y, z: spot.z - (spot.z - p.z) / d * 0.12, type: 'fish' };
    G.fish.spot = to;
    blackDash(black, to, 1.5);
  }
}
function removeFish() { if (G.fish) { fx.remove(G.fish.mesh); G.fish = null; } }

// ---------------- meow hint ----------------
function meowHint() {
  sound.init();
  if (G.phase !== 'play' || G.meowCool > 0) return;
  const W = innerWidth, H = innerHeight;
  let pick = null, pd = Infinity;
  for (const c of G.cats) {
    if (c.state !== 'active') continue;
    const inf = aimInfo(c, W, H, 34);
    const d = c.cat.center(tmpV).distanceTo(camPos) + (inf && inf.vis ? 4 : 0);   // prefer cats you cannot see yet
    if (d < pd) { pd = d; pick = c; }
  }
  if (!pick) return;
  G.meowCool = 4; G.hints++;
  const p = pick.cat.center(new THREE.Vector3());
  sound.meow(p, PITCH[pick.kind] * (0.95 + Math.random() * 0.1));
  pick.cat.look = 0;
  lookToward(p);
  showMsg(t('meowHint'), 2);
}
function lookToward(p) {
  const v = p.clone().applyMatrix4(cam.matrixWorldInverse);       // in the camera's frame: x right, y up, z back
  let x = v.x, y = v.y;
  if (v.z > 0) { x = x === 0 ? 1 : Math.sign(x) * 3; y = 0; }   // behind you: look to the side
  const l = Math.hypot(x, y) || 1;
  G.look = { x: x / l, y: -y / l }; G.lookT = 2.6;
}

// ---------------- hearts ----------------
let heartTex = null;
function hearts(p) {
  if (!heartTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#ff6f8f'; g.font = '56px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♥', 32, 36);
    heartTex = new THREE.CanvasTexture(c); heartTex.colorSpace = THREE.SRGBColorSpace;
  }
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false, depthTest: false }));
    s.position.copy(p); s.scale.setScalar(0.05 + Math.random() * 0.03);
    s.userData = { life: 1.5, v: new THREE.Vector3((Math.random() - 0.5) * 0.35, 0.35 + Math.random() * 0.3, (Math.random() - 0.5) * 0.35) };
    fx.add(s);
  }
}
function fxStep(dt) {
  for (let i = fx.children.length - 1; i >= 0; i--) {
    const s = fx.children[i];
    if (!s.isSprite) continue;
    const u = s.userData; u.life -= dt;
    s.position.addScaledVector(u.v, dt); u.v.y -= dt * 0.15;
    s.material.opacity = Math.min(1, u.life / 0.6);
    if (u.life <= 0) { fx.remove(s); s.material.dispose(); }
  }
  if (dots && dots.userData.fade) {
    dots.material.opacity -= dt * 0.6;
    if (dots.material.opacity <= 0) { scene.remove(dots); dots = null; }
  }
}

// ---------------- HUD ----------------
const retEl = $('#ret');
retEl.innerHTML = reticleSVG();
const retFill = $('#retFill'), retEyes = $('#retEyes');
const FILL_COL = { white: '#fffdf8', grey: '#9ba1aa', black: '#2a282f' };
let eyeX = 0, eyeY = 0;
function paintReticle(near) {
  const c = G.target || (G.lastTarget && G.lastTarget.state === 'active' && G.lastTarget.fill > 0.01 ? G.lastTarget : null);
  const f = c ? Math.min(1, c.fill) : 0;
  retFill.setAttribute('y', String(93 - f * 86));
  if (c) retEl.style.setProperty('--fill', FILL_COL[c.kind]);
  retEl.classList.toggle('on', !!G.target);
  retEl.classList.toggle('near', near && !G.target);
  retEl.classList.toggle('happy', G.happyT > 0);
  retEl.classList.toggle('flinch', G.flinchT > 0);
  retEl.classList.toggle('sneak', !!(G.target && G.target.kind === 'black'));
  let tx = 0, ty = 0;
  if (G.lookT > 0 && G.look) { tx = G.look.x * 3.6; ty = G.look.y * 3.2; }
  eyeX += (tx - eyeX) * 0.2; eyeY += (ty - eyeY) * 0.2;
  retEyes.setAttribute('transform', `translate(${eyeX.toFixed(2)} ${eyeY.toFixed(2)})`);
}
function paintList(just) {
  const el = $('#list');
  if (!el.children.length) el.innerHTML = DEFS.map(d => `<span class="li ${d.kind}" data-i="${d.i}" title="${d.name}">${headSVG()}</span>`).join('');
  for (const c of G.cats) {
    const s = el.querySelector(`[data-i="${c.i}"]`);
    s.classList.toggle('caught', c.state === 'caught');
    s.classList.toggle('locked', c.state === 'waiting');
    if (just === c) { s.classList.remove('pop'); void s.offsetWidth; s.classList.add('pop'); }
  }
}
let msgKey = '';
function showMsg(m, secs = 0) { const el = $('#msg'); if (m !== msgKey) { el.textContent = m; el.classList.toggle('show', !!m); msgKey = m; } G.msgT = secs; }
let toastT;
function toast(m) { const el = $('#toast'); el.textContent = m; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 3800); }

// ---------------- screens ----------------
function paintStart() {
  document.documentElement.lang = { me: 'sr-ME', sq: 'sq', en: 'en' }[lang];
  document.title = t('title') + ' – Gusinjska kulturna baština';
  for (const b of document.querySelectorAll('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  $('#museumTxt').textContent = t('museum');
  $('#kicker').textContent = t('kicker'); $('#title').textContent = t('title'); $('#lead').textContent = t('lead');
  $('#kinds').innerHTML = ['white', 'grey', 'black'].map(k => `<li class="${k}">${headSVG()}<span>${t('k_' + k)}</span></li>`).join('');
  $('#how').textContent = t('how');
  $('#btnAR').textContent = IS_MOBILE ? t('startAR') : t('demoFirst');
  $('#btnDemo').textContent = IS_MOBILE ? t('demo') : t('camToo');
  $('#note').textContent = IS_MOBILE ? t('note') : t('noteDesk');
  const best = store.get('gkb.mace.best', null);
  $('#best').hidden = !best; if (best) $('#best').textContent = t('best', { t: mmss(best) });
  $('#foot').textContent = t('foot');
  $('#btnHide').textContent = t('hideBtn');
  $('#meowTxt').textContent = t('meow'); $('#fishTxt').textContent = t('fish');
  $('#btnClose').setAttribute('aria-label', t('close')); $('#btnSound').setAttribute('aria-label', t('sound'));
  $('#winTitle').textContent = t('win'); $('#btnAgain').textContent = t('again'); $('#btnRescan').textContent = t('rescan'); $('#winMuseum').textContent = t('back');
}
$('#logo').innerHTML = logoSVG('m');
$('#introHeads').innerHTML = DEFS.map(d => `<span class="li ${d.kind}">${headSVG()}</span>`).join('');
$('#howRet').innerHTML = headSVG('ret-mini');
for (const b of document.querySelectorAll('.lang button')) b.onclick = () => { lang = b.dataset.lang; store.set('gkb.lang', lang); paintStart(); };
paintStart();
paintSound();
function paintSound() {
  const b = $('#btnSound');
  b.setAttribute('aria-pressed', String(sound.on));
  b.innerHTML = sound.on
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>';
}
$('#btnSound').onclick = () => { sound.init(); sound.on = !sound.on; store.set('gkb.mace.sound', sound.on); paintSound(); };
$('#btnMeow').onclick = meowHint;
$('#btnFish').onclick = tossFish;
$('#btnClose').onclick = () => quit();
$('#btnAgain').onclick = () => again();
$('#btnRescan').onclick = () => rescan();
$('#btnHide').onclick = () => finishScan();
$('#btnAR').onclick = () => (IS_MOBILE ? startAR() : startDemo());
$('#btnDemo').onclick = () => (IS_MOBILE ? startDemo() : startAR());
addEventListener('keydown', e => { if (e.key === 'm' && G.phase === 'play') meowHint(); if (e.key === 'f' && G.phase === 'play') tossFish(); });

function openHud(mode) {
  G.mode = mode; G.phase = mode === 'ar' ? 'init' : 'play';
  document.body.classList.add('playing'); document.body.classList.toggle('ar', mode === 'ar'); document.body.classList.toggle('demo', mode === 'demo');
  $('#start').hidden = true; $('#win').hidden = true; $('#hud').hidden = false;
  $('#actions').hidden = true; $('#btnFish').hidden = true; $('#scan').hidden = true;
  $('#list').innerHTML = ''; paintList();
  $('#powered').hidden = mode !== 'ar';
  $('#debug').hidden = !DEBUG;
  G.havePrev = false; G.speed = G.ang = 0;
  resize();
}
function quit() {
  stopAR(); stopDemo();
  G.phase = 'start'; G.mode = null; G.room = null;
  for (const c of G.cats) c.cat.root.visible = false;
  removeFish(); clearOccluders(); if (dots) { scene.remove(dots); dots = null; } if (debugGroup) { scene.remove(debugGroup); debugGroup = null; }
  sound.purr(0);
  document.body.classList.remove('playing', 'ar', 'demo');
  $('#hud').hidden = true; $('#win').hidden = true; $('#start').hidden = false;
  showMsg('');
  paintStart();
}
function beginPlay() {
  G.phase = 'play';
  $('#actions').hidden = false; $('#scan').hidden = true;
  showMsg(t(G.mode === 'demo' ? 'hiddenDemo' : 'hidden'), 4);
  sound.meow(null, 1.1);
}
function win() {
  G.phase = 'win';
  sound.purr(0); sound.fanfare();
  const time = G.time, best = store.get('gkb.mace.best', null), isBest = !best || time < best;
  if (isBest) store.set('gkb.mace.best', Math.round(time));
  const stars = time < 150 ? 3 : time < 300 ? 2 : 1;
  $('#stars').innerHTML = [1, 2, 3].map(i => `<span class="${i <= stars ? 'on' : ''}">★</span>`).join('');
  $('#winHeads').innerHTML = DEFS.map(d => `<span class="li ${d.kind} caught">${headSVG()}</span>`).join('');
  $('#stats').innerHTML = `<div><dt>${t('time')}</dt><dd>${mmss(time)}</dd></div><div><dt>${t('hints')}</dt><dd>${G.hints}</dd></div>` +
    `<div><dt>${t('bestT')}</dt><dd>${mmss(isBest ? time : best)}${isBest ? ` <small>${t('newBest')}</small>` : ''}</dd></div>`;
  $('#btnRescan').hidden = G.mode !== 'ar';
  paintStart();
  $('#win').hidden = false;
  $('#actions').hidden = true;
}
function again() {
  $('#win').hidden = true;
  G.seed++;
  G.room = analyse();
  placeAll(); beginPlay();
}
function rescan() {
  $('#win').hidden = true;
  if (G.mode !== 'ar') return again();
  for (const c of G.cats) c.cat.root.visible = false;
  clearOccluders(); G.points.clear(); G.cams.length = 0; G.sectors.clear();
  G.phase = 'scan'; startScanUI();
}
function analyse() {
  if (G.mode === 'demo') return analyseRoom(demo.points, demo.cams, { seed: G.seed, floorY: 0 });
  return analyseRoom([...G.points.values()], G.cams, { seed: G.seed });
}

// ---------------- test room (no camera) ----------------
const ctl = { yaw: 0, pitch: -0.35, keys: new Set(), drag: null, touches: new Map(), move: { x: 0, z: 0 } };
async function startDemo() {
  sound.init();
  openHud('demo');
  G.phase = 'loading';
  if (!demo) {
    const { buildDemoRoom } = await import('./mace-demo.js');
    demo = buildDemoRoom();
    demo.floor = demo.meshes.find(m => m.userData.floor);
    const c0 = demo.start.pos;
    demo.cams = [c0, c0.clone().add(new THREE.Vector3(-0.5, 0, -0.2)), c0.clone().add(new THREE.Vector3(0.5, 0, -0.2)), c0.clone().add(new THREE.Vector3(0, -0.1, -0.7))];
    demo.points = demo.makePoints(demo.cams, 5);
  }
  scene.add(demo.group);
  demoSolids = demo.meshes.filter(m => m.userData.solid);
  scene.background = new THREE.Color(0xcfc6b8);
  renderer.shadowMap.enabled = true; sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 8 }); sun.shadow.camera.updateProjectionMatrix();
  sun.position.set(1.5, 3.2, 1.0); hemi.intensity = 1.5; sun.intensity = 1.9;
  for (const c of G.cats) c.cat.root.traverse(o => { if (o.isMesh && !o.material.transparent) o.castShadow = true; });
  cam = demoCam;
  demoCam.position.copy(demo.start.pos); ctl.yaw = 0; ctl.pitch = -0.35;
  G.room = analyse();
  placeAll();
  $('#demoHelp').hidden = false; $('#demoHelp').textContent = matchMedia('(pointer: coarse)').matches ? t('demoHelpTouch') : t('demoHelp');
  setTimeout(() => { $('#demoHelp').classList.add('fade'); }, 7000);
  beginPlay();
}
function stopDemo() {
  if (demo) scene.remove(demo.group);
  scene.background = null; renderer.shadowMap.enabled = false; sun.castShadow = false;
  $('#demoHelp').hidden = true; $('#demoHelp').classList.remove('fade');
}
function demoStep(dt) {
  const k = ctl.keys, sp = (k.has('shift') ? 2.2 : 1.1) * dt;
  let fx_ = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + ctl.move.x;
  let fz = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0) + ctl.move.z;
  const cy = Math.cos(ctl.yaw), sy = Math.sin(ctl.yaw);
  demoCam.position.x += (fx_ * cy + fz * sy) * sp;
  demoCam.position.z += (-fx_ * sy + fz * cy) * sp;
  if (k.has('q')) demoCam.position.y -= dt * 0.9;
  if (k.has('e')) demoCam.position.y += dt * 0.9;
  if (demo) {
    const b = demo.bounds;
    demoCam.position.x = Math.max(b.x0, Math.min(b.x1, demoCam.position.x));
    demoCam.position.z = Math.max(b.z0, Math.min(b.z1, demoCam.position.z));
  }
  demoCam.position.y = Math.max(0.25, Math.min(1.9, demoCam.position.y));
  demoCam.rotation.set(ctl.pitch, ctl.yaw, 0, 'YXZ');
}
addEventListener('keydown', e => { if (G.mode === 'demo') ctl.keys.add(e.key.toLowerCase()); });
addEventListener('keyup', e => ctl.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => ctl.keys.clear());
const cv = renderer.domElement;
cv.addEventListener('pointerdown', e => {
  if (G.mode !== 'demo') return;
  cv.setPointerCapture(e.pointerId);
  ctl.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
cv.addEventListener('pointermove', e => {
  if (G.mode !== 'demo' || !ctl.touches.has(e.pointerId)) return;
  const p = ctl.touches.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (ctl.touches.size >= 2) {                 // two fingers: walk
    ctl.move.x = Math.max(-1, Math.min(1, ctl.move.x + dx * 0.02)); ctl.move.z = Math.max(-1, Math.min(1, ctl.move.z + dy * 0.02));
  } else {
    const k = e.pointerType === 'mouse' ? 0.0045 : 0.006;
    ctl.yaw -= dx * k; ctl.pitch = Math.max(-1.45, Math.min(1.2, ctl.pitch - dy * k));
  }
});
const endPtr = e => { ctl.touches.delete(e.pointerId); if (ctl.touches.size < 2) ctl.move.x = ctl.move.z = 0; };
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);

// ---------------- room tracking (8th Wall engine) ----------------
// The XR Engine (© Niantic Spatial, Inc., used unmodified under its licence, external/xr/LICENSE) runs SLAM on the
// camera picture: it gives the phone's position and turn in the room, and the tracked points we scan for hiding spots.
const feed = document.createElement('canvas'); feed.className = 'm-feed';
let xr8Loading = null, gumPatched = false, lastR = null;
function softenCamera() {        // the engine asks for an exact 960x720 back camera; some phones refuse that
  if (gumPatched || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  gumPatched = true;
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = c => orig(c).catch(e => {
    if (!(e && /Overconstrained|NotReadable|NotFound/.test(e.name)) || !c || typeof c.video !== 'object') throw e;
    const v = { facingMode: { ideal: 'environment' } };
    for (const k of ['width', 'height']) if (c.video[k] != null) { const x = c.video[k]; v[k] = { ideal: typeof x === 'object' ? (x.exact ?? x.ideal ?? x.min) : x }; }
    return orig({ ...c, video: v });
  });
}
function loadXR8() {
  if (window.XR8) return Promise.resolve(window.XR8);
  if (!xr8Loading) xr8Loading = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'external/xr/xr.js'; sc.async = true; sc.crossOrigin = 'anonymous'; sc.setAttribute('data-preload-chunks', 'slam');
    const to = setTimeout(() => reject(new Error('XR engine timeout')), 60000);
    window.addEventListener('xrloaded', () => { clearTimeout(to); resolve(window.XR8); }, { once: true });
    sc.onerror = () => { clearTimeout(to); xr8Loading = null; reject(new Error('XR engine did not load')); };
    document.head.appendChild(sc);
  });
  return xr8Loading;
}
function motionPermissions() {      // iPhone: must be asked inside the tap
  const ask = [];
  for (const E of [typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent, typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent]) {
    if (E && typeof E.requestPermission === 'function') ask.push(E.requestPermission().catch(() => 'denied'));
  }
  return Promise.all(ask);
}
async function startAR() {
  sound.init();
  const perms = motionPermissions();
  openHud('ar');
  cam = arCam;
  stage.prepend(feed);
  resize();
  showMsg(t('loading'));
  let XR8;
  try {
    await perms;
    XR8 = await loadXR8();
    if (typeof XR8.loadChunk === 'function') await XR8.loadChunk('slam');
  } catch (e) { console.warn(e); arFailed(e); return; }
  if (G.mode !== 'ar') return;
  G.points.clear(); G.cams.length = 0; G.sectors.clear();
  G.track = { status: 'LIMITED', reason: 'INITIALIZING', ok: false, lostT: 0, pose: false, wasNormal: false };
  try {
    XR8.clearCameraPipelineModules();
    XR8.XrController.configure({ disableWorldTracking: false, scale: 'responsive', enableLighting: true, enableWorldPoints: true });
    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.XrController.pipelineModule(),
      {
        name: 'gkb-mace',
        onStart: () => {
          // the floor is y = 0 and the phone starts 1.4 units above it, so one unit is about a metre
          XR8.XrController.updateCameraProjectionMatrix({ origin: { x: 0, y: 1.4, z: 0 }, facing: { w: 1, x: 0, y: 0, z: 0 } });
        },
        onUpdate: ({ processCpuResult }) => {
          const r = processCpuResult && processCpuResult.reality;
          if (!r || G.mode !== 'ar') return;
          lastR = r;
          if (r.position) arCam.position.set(r.position.x, r.position.y, r.position.z);
          if (r.rotation) arCam.quaternion.set(r.rotation.x, r.rotation.y, r.rotation.z, r.rotation.w);
          if (r.intrinsics) { arCam.projectionMatrix.fromArray(r.intrinsics); arCam.projectionMatrixInverse.copy(arCam.projectionMatrix).invert(); }
          if (r.trackingStatus) G.track.status = r.trackingStatus;
          if (r.trackingReason) G.track.reason = r.trackingReason;
          if (r.lighting && Number.isFinite(r.lighting.exposure)) G.exposure += (r.lighting.exposure - G.exposure) * 0.1;
          G.track.pose = true;
          if (G.phase === 'scan' && G.track.status === 'NORMAL') collect(r);
        },
        onCameraStatusChange: st => { if (st && st.status === 'failed') arFailed(st); },
        onException: e => arFailed(e),
        listeners: [{ event: 'reality.trackingstatus', process: ({ detail }) => { if (detail) { G.track.status = detail.status; G.track.reason = detail.reason; } } }],
      },
    ]);
    softenCamera();
    XR8.run({ canvas: feed, allowedDevices: XR8.XrConfig.device().ANY });
  } catch (e) { arFailed(e); }
}
function arFailed(e) {
  if (G.mode !== 'ar') return;
  console.warn('AR failed:', e && (e.message || e.name || JSON.stringify(e)), e);
  const name = e && (e.name || (e.error && e.error.name)) || '';
  stopAR();
  quit();
  const motion = e && e.type === 'permission' && /device/.test(e.permission || '');
  toast(motion ? t('motionBlocked') : /NotAllowed|Permission/.test(name) || (e && e.type === 'permission') ? t('camBlocked') : /NotFound/.test(name) ? t('noCam') : t('arFail'));
}
function stopAR() {
  if (G.mode !== 'ar') return;
  try { window.XR8 && window.XR8.stop(); } catch (e) { console.warn(e); }
  try { window.XR8 && window.XR8.clearCameraPipelineModules(); } catch (e) { console.warn(e); }
  feed.remove(); cam = demoCam;
}
let camT = 0;
function collect(r) {
  if (r.worldPoints) for (const w of r.worldPoints) G.points.set(w.id, { x: w.position.x, y: w.position.y, z: w.position.z });
  const now = performance.now();
  if (now - camT > 200) {
    camT = now;
    G.cams.push({ x: arCam.position.x, y: arCam.position.y, z: arCam.position.z });
    const f = camFwd.set(0, 0, -1).applyQuaternion(arCam.quaternion);
    if (Math.abs(f.y) < 0.92) G.sectors.add(Math.floor(((Math.atan2(f.x, f.z) + Math.PI) / (Math.PI * 2)) * 12) % 12);
  }
}
function scanProgress() { return Math.min(1, 0.65 * Math.min(1, G.points.size / 650) + 0.35 * Math.min(1, G.sectors.size / 5)); }
function startScanUI() {
  $('#scan').hidden = false; $('#actions').hidden = true;
  $('#btnHide').disabled = true; G.scanDoneT = 0;
  showMsg(t('scan'));
}
function arStep(dt) {
  const tr = G.track, normal = tr.status === 'NORMAL';
  if (normal) tr.wasNormal = true;
  // lighting: the engine's exposure estimate dims or brightens the kittens with the room
  const ex = Math.max(-0.8, Math.min(0.8, G.exposure || 0));
  hemi.intensity = 1.9 * (1 + ex * 0.9); sun.intensity = 1.5 * (1 + ex * 0.9);
  if (G.phase === 'init') {
    showMsg(tr.pose ? t('init') : t('loading'));
    if (normal) { G.phase = 'scan'; startScanUI(); }
    return;
  }
  if (G.phase === 'scan') {
    const p = scanProgress();
    $('#scanRing').style.strokeDashoffset = String(119.4 * (1 - p));
    $('#scanPct').textContent = Math.round(p * 100) + '%';
    $('#btnHide').disabled = !(G.points.size >= 120 && G.sectors.size >= 2);
    showMsg(normal ? (p > 0.75 ? t('scanMore') : t('scan')) : t('init'));
    updateDots();
    if (p >= 1) { G.scanDoneT += dt; showMsg(t('scanDone')); if (G.scanDoneT > 1.2) finishScan(); }
    return;
  }
  if (G.phase === 'play') {
    tr.ok = normal || tr.lostT < 0.6;
    tr.lostT = normal ? 0 : tr.lostT + dt;
    if (!normal && tr.lostT > 0.6) { showMsg(t('lost')); tr.wasLost = true; }
    else if (normal && tr.wasLost) { tr.wasLost = false; showMsg(t('resumed'), 1.5); }
  }
}
let dotsT = 0;
function updateDots() {
  const now = performance.now(); if (now - dotsT < 250) return; dotsT = now;
  if (!dots) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6000 * 3), 3));
    dots = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd38a, size: 0.016, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }));
    dots.frustumCulled = false; scene.add(dots);
  }
  const a = dots.geometry.attributes.position; let i = 0;
  for (const p of G.points.values()) { if (i >= 6000) break; a.setXYZ(i++, p.x, p.y, p.z); }
  dots.geometry.setDrawRange(0, i); a.needsUpdate = true;
}
function finishScan() {
  if (G.phase !== 'scan') return;
  G.room = analyse();
  buildOccluders(G.room.occ);
  if (dots) dots.userData.fade = true;
  placeAll();
  beginPlay();
}
function buildOccluders(boxes) {
  clearOccluders();
  if (!boxes.length) return;
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ colorWrite: false }), boxes.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  boxes.forEach((b, i) => { p.set((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2); s.set(b[1] - b[0], b[3] - b[2], b[5] - b[4]); m.setMatrixAt(i, M.compose(p, q, s)); });
  m.renderOrder = -1; m.frustumCulled = false;
  occluders = m; scene.add(m);
}
function clearOccluders() { if (occluders) { scene.remove(occluders); occluders.geometry.dispose(); occluders = null; } }

// ---------------- debug view (?debug) ----------------
function debugRoom() {
  if (debugGroup) scene.remove(debugGroup);
  debugGroup = new THREE.Group(); scene.add(debugGroup);
  const R = G.room;
  const pts = G.mode === 'demo' ? demo.points : [...G.points.values()];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(p => [p.x, p.y, p.z]), 3));
  debugGroup.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x33aaff, size: 0.012 })));
  if (R.occ.length) {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff7a00, wireframe: true, transparent: true, opacity: 0.35 }), R.occ.length);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion();
    R.occ.forEach((b, i) => m.setMatrixAt(i, M.compose(new THREE.Vector3((b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2), q, new THREE.Vector3(b[1] - b[0], b[3] - b[2], b[5] - b[4]))));
    debugGroup.add(m);
  }
  for (const gr of R.greys) {
    const lg = new THREE.BufferGeometry().setFromPoints(gr.path.map(p => new THREE.Vector3(p.x, p.y + 0.01, p.z)));
    debugGroup.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x888888 })));
  }
  for (const s of R.blackSpots) { const o = new THREE.Mesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0x000000 })); o.position.set(s.x, s.y + 0.03, s.z); debugGroup.add(o); }
}
function debugText() {
  const R = G.room, tr = G.track;
  $('#debug').textContent = [
    `mode ${G.mode} · phase ${G.phase}`,
    G.mode === 'ar' ? `tracking ${tr.status}/${tr.reason} · points ${G.points.size} · sectors ${G.sectors.size} · exposure ${(G.exposure || 0).toFixed(2)}` : '',
    R ? `floor ${R.floorY.toFixed(2)} · voxels ${R.stats.voxels} · spots ${JSON.stringify(R.stats.types)}${R.stats.fallback ? ' · FALLBACK' : ''}` : '',
    R ? `whites ${R.whites.map(w => w.type + '/' + w.pose).join(', ')}` : '',
    `speed ${G.speed.toFixed(2)} m/s · turn ${G.ang.toFixed(2)} rad/s · target ${G.target ? G.target.name + ' ' + G.target.fill.toFixed(2) : '-'}`,
  ].filter(Boolean).join('\n');
}

buildCats();
resize();
renderer.setAnimationLoop(loop);
document.addEventListener('visibilitychange', () => { if (document.hidden) sound.purr(0); });
if (params.has('demo')) startDemo();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

window.__mace = { G, THREE, demoPoints: () => demo && demo.points, scene, get cam() { return cam; }, demoCam, ctl, startDemo, startAR, finishScan, catchCat, activateBlack, meowHint, tossFish, aimInfo, analyse,
  vantage(i, r = 1.2) {      // test helper: put the test-room camera where cat i can be seen
    const c = G.cats[i], pts = c.cat.samples([]).map(v => v.clone()), ctr = c.cat.center(new THREE.Vector3());
    const boxes = demoSolids.filter(m => !m.userData.floor).map(m => new THREE.Box3().setFromObject(m)), b = demo.bounds;
    for (const r2 of [r, r * 1.6, r * 0.7]) for (const h of [0.45, 0.85, 1.3]) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, p = new THREE.Vector3(ctr.x + Math.sin(a) * r2, c.cat.root.position.y + h, ctr.z + Math.cos(a) * r2);
      if (p.x < b.x0 || p.x > b.x1 || p.z < b.z0 || p.z > b.z1 || p.y > 1.9 || boxes.some(bx => bx.containsPoint(p))) continue;
      if (pts.filter(s => !blocked(p, s)).length >= 3) { demoCam.position.copy(p); this.aimAt(i); G.havePrev = false; G.speed = G.ang = 0; return true; }
    }
    return false;
  },
  aimAt(i) {        // test helper: turn the test-room camera towards cat i
    const c = G.cats[i], p = c.cat.center(new THREE.Vector3()), d = p.clone().sub(demoCam.position);
    ctl.yaw = Math.atan2(-d.x, -d.z); ctl.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  } };
