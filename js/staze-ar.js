// Planinarske staze – camera AR on three.js, the same in Safari (iPhone) and Chrome (Android), no app and no
// Google AR services needed.
//  - On the printed AR map (print/staze/AR_mapa_staze_*.pdf): the 8 markers around the map give the map's exact
//    position, the relief rises out of the paper and stays on it while you walk around, lean in or tilt the phone.
//  - Without the map: the relief floats in front of you; the motion sensors keep it in place while you turn the phone.
// The phone's gyroscope is fused with the marker pose: turning the phone is followed instantly (no camera lag),
// and the map's position is smoothed in the room instead of on the screen, so the tall mountains don't shake.
import * as THREE from 'three';
import { OneEuro } from './cv/pose.js';

const D2R = Math.PI / 180;
const FREL_DEFAULT = 0.5 / Math.tan(33 * D2R);   // focal length / long side of the picture, ~66° across the long side
const FREL_MIN = 0.5 / Math.tan(50 * D2R), FREL_MAX = 0.5 / Math.tan(19 * D2R);
const LATENCY = 50;                              // ms between the motion sensor and the camera picture on screen
const PROC_LONG = 960;                           // long side of the frames searched for markers
const MAP_WIDTH = 0.186;                         // printed map width at A4 (m); any print size works
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };

// ---------------- motion sensor: phone orientation as a three.js camera quaternion, with a short history ----------------
const EUL = new THREE.Euler(), Q90 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2), QZ = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1);
export function screenAngle() {
  const a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : window.orientation;
  return Number(a) || 0;
}
class Motion {
  constructor() { this.hist = []; this.count = 0; this.on = e => this._on(e); this.t0 = 0; }
  start() { this.t0 = performance.now(); window.addEventListener('deviceorientation', this.on); }
  stop() { window.removeEventListener('deviceorientation', this.on); this.hist.length = 0; this.count = 0; }
  get ok() { return this.count > 3 && performance.now() - this.hist[this.hist.length - 1].t < 2000; }
  _on(e) {
    if (e.beta == null || e.gamma == null) return;
    const so = screenAngle() * D2R;
    EUL.set(e.beta * D2R, (e.alpha || 0) * D2R, -e.gamma * D2R, 'YXZ');
    const q = new THREE.Quaternion().setFromEuler(EUL).multiply(Q90).multiply(QZ.setFromAxisAngle(ZAX, -so));
    const last = this.hist[this.hist.length - 1];
    if (last && last.q.dot(q) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
    const t = performance.now();
    this.hist.push({ t, q });
    while (this.hist.length > 2 && t - this.hist[0].t > 1500) this.hist.shift();
    this.count++;
  }
  at(t, out) {             // orientation at time t (ms), interpolated
    const h = this.hist;
    if (!h.length) return out.identity();
    if (t >= h[h.length - 1].t) return out.copy(h[h.length - 1].q);
    if (t <= h[0].t) return out.copy(h[0].q);
    let i = h.length - 1;
    while (i > 0 && h[i - 1].t > t) i--;
    const a = h[i - 1], b = h[i];
    return out.copy(a.q).slerp(b.q, (t - a.t) / Math.max(1, b.t - a.t));
  }
}

// ---------------- the camera picture, marker search and pose ----------------
export class CameraAR {
  constructor({ layoutURL = 'data/staze-mapa.json', debug = false } = {}) {
    this.layoutURL = layoutURL; this.debug = debug;
    this.video = document.createElement('video');
    for (const a of ['playsinline', 'muted', 'autoplay']) this.video.setAttribute(a, '');
    this.video.muted = true; this.video.playsInline = true;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 30);
    this.grab = document.createElement('canvas');
    this.g2d = this.grab.getContext('2d', { willReadFrequently: true });
    this.motion = new Motion();
    this.fStore = store.get('gkb.staze.ar.f', {});
    this.fRel = FREL_DEFAULT; this.fKey = ''; this.fSamples = []; this.calibrated = false;
    this.map = null;                       // {matrix (room <- map), seen (ms), since, n, rms, fresh}
    this.stats = { fps: 0, ms: 0, n: 0, rms: 0, frames: 0, found: 0, mode: '' };
    this.lum = 0.5; this.viewW = 1; this.viewH = 1; this.badGyro = false;
    this.useGyro = !/[?&]nogyro\b/.test(location.search);
  }

  // container: element the video goes into (behind the 3D canvas). motionAnswer: promise from requestPermission()
  async start(container, motionAnswer) {
    this.container = container;
    container.prepend(this.video);
    const layoutP = fetch(this.layoutURL).then(r => r.json());
    await this.openCamera();
    if (motionAnswer) { try { await motionAnswer; } catch { /* refused: markers only */ } }
    this.motion.start();
    this.layout = await layoutP;
    this.startWorker();
    this.onVis = () => this.visibility();
    document.addEventListener('visibilitychange', this.onVis);
    this.running = true;
  }

  stop() {
    this.running = false;
    document.removeEventListener('visibilitychange', this.onVis);
    this.motion.stop();
    this.stream && this.stream.getTracks().forEach(t => t.stop());
    this.stream = null; this.video.srcObject = null; this.video.remove();
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    this.map = null; this.busy = false;
  }

  async openCamera(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { const e = new Error('no camera API'); e.name = 'NoApi'; throw e; }
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    const v = { width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 }, frameRate: { ideal: 30 } };
    if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = { ideal: 'environment' };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: v }); }
    catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId } : { facingMode: 'environment' } });
    }
    this.stream = stream; this.track = stream.getVideoTracks()[0];
    const caps = (this.track.getCapabilities && this.track.getCapabilities()) || {};
    // digital zoom back to 1x (some phones start zoomed in) and continuous focus where the browser allows it
    if (caps.zoom) { try { await this.track.applyConstraints({ advanced: [{ zoom: Math.min(caps.zoom.max, Math.max(caps.zoom.min, 1)) }] }); } catch { /* ignore */ } }
    if (caps.focusMode && caps.focusMode.includes('continuous')) { try { await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* ignore */ } }
    this.video.srcObject = stream;
    try { await this.video.play(); } catch { /* plays on the next tap */ }
    this.watchFrames();
    await new Promise(res => { if (this.video.videoWidth) res(); else { this.video.onloadedmetadata = () => res(); setTimeout(res, 2500); } });
    this.loadFocal();
  }

  watchFrames() {
    const v = this.video;
    this.newFrame = true; this.frameAt = performance.now();
    if (typeof v.requestVideoFrameCallback !== 'function') { this.rvfc = false; return; }
    this.rvfc = true;
    const tick = () => { this.newFrame = true; this.frameAt = performance.now(); if (this.stream && v.srcObject === this.stream) v.requestVideoFrameCallback(tick); };
    v.requestVideoFrameCallback(tick);
  }

  async cameras() {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch { return []; }
  }
  async nextCamera() {          // cycles the cameras (phones may open a narrow telephoto lens)
    const list = await this.cameras();
    if (list.length < 2) return false;
    const cur = this.track && this.track.getSettings && this.track.getSettings().deviceId;
    const back = list.filter(d => !/front|user|face|prednj|selfie/i.test(d.label));
    const pool = back.length > 1 ? back : list;
    const i = pool.findIndex(d => d.deviceId === cur);
    await this.openCamera(pool[(i + 1) % pool.length].deviceId);
    this.map = null; this.fSamples = [];
    return true;
  }

  visibility() {
    if (document.visibilityState !== 'visible' || !this.running) return;
    if (!this.track || this.track.readyState === 'ended') this.openCamera().catch(() => {});
    else this.video.play().catch(() => {});
  }

  // ---- worker ----
  startWorker() {
    this.useMain = false; this.ready = false;
    let w;
    try { w = new Worker(new URL('./staze-ar-worker.js', import.meta.url), { type: 'module' }); }
    catch { this.mainThread(); return; }
    this.worker = w;
    const fail = () => { if (this.worker === w) { w.terminate(); this.worker = null; this.mainThread(); } };
    const timer = setTimeout(fail, 4000);
    w.onerror = () => { clearTimeout(timer); fail(); };
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'ready') { clearTimeout(timer); this.ready = true; return; }
      if (m.type === 'result') this.result(m);
      if (m.type === 'error') { this.busy = false; if (this.debug) console.warn('tracker', m.message); }
    };
    w.postMessage({ type: 'init', layout: this.layout });
  }
  async mainThread() {           // browsers without module workers: same search, smaller frames, on the page itself
    const { MapTracker } = await import('./staze-ar-track.js');
    this.local = new MapTracker(this.layout); this.useMain = true; this.ready = true;
  }

  loadFocal() {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const label = (this.track && this.track.label) || '';
    this.fKey = `${Math.max(vw, vh)}x${Math.min(vw, vh)}|${label}`;
    const f = this.fStore[this.fKey];
    this.fRel = f && f > FREL_MIN && f < FREL_MAX ? f : FREL_DEFAULT;
    this.calibrated = !!f; this.fSamples = [];
    this.projDirty = true;
  }
  focalSample(fRel) {
    if (!(fRel > FREL_MIN && fRel < FREL_MAX)) return;
    this.fSamples.push(fRel);
    if (this.fSamples.length > 40) this.fSamples.shift();
    if (this.fSamples.length < 12 || this.fSamples.length % 4) return;
    const s = this.fSamples.slice().sort((a, b) => a - b), med = s[s.length >> 1];
    const mad = s.map(x => Math.abs(x - med)).sort((a, b) => a - b)[s.length >> 1];
    if (mad / med > 0.05) return;                         // not consistent yet
    if (Math.abs(med - this.fRel) / this.fRel > 0.015) { this.fRel = med; this.projDirty = true; }
    if (!this.calibrated || Math.abs(med - (this.fStore[this.fKey] || 0)) / med > 0.02) {
      this.calibrated = true; this.fStore[this.fKey] = +med.toFixed(4); store.set('gkb.staze.ar.f', this.fStore);
    }
  }
  get fovLong() { return 2 * Math.atan(0.5 / this.fRel) / D2R; }

  // ---- per screen frame ----
  resize(w, h) { this.viewW = w; this.viewH = h; this.projDirty = true; }

  update(now) {
    const v = this.video;
    if (v.videoWidth && (v.videoWidth !== this.vw || v.videoHeight !== this.vh)) { this.vw = v.videoWidth; this.vh = v.videoHeight; this.loadFocal(); }
    if (this.projDirty && this.vw) this.projection();
    const gyro = this.gyroOn;
    if (gyro) this.motion.at(now - LATENCY, this.camera.quaternion); else this.camera.quaternion.identity();
    this.camera.position.set(0, 0, 0);
    this.camera.updateMatrixWorld(true);
    if (this.busy && this.job && now - this.job.time > 1500) this.busy = false;        // a reply got lost: carry on
    if (this.running && this.ready && !this.busy && v.readyState >= 2 && document.visibilityState === 'visible') this.send(now);
    if (this.map) this.map.fresh = now - this.map.seen < 260;
  }
  get gyroOn() { return this.useGyro && !this.badGyro && this.motion.ok; }

  projection() {
    const vw = this.vw, vh = this.vh, W = this.viewW, H = this.viewH;
    const s = Math.max(W / vw, H / vh);
    const f = this.fRel * Math.max(vw, vh);
    const n = 0.01, fa = 30;
    const P = this.camera.projectionMatrix;
    P.set(2 * s * f / W, 0, 0, 0,
      0, 2 * s * f / H, 0, 0,
      0, 0, -(fa + n) / (fa - n), -2 * fa * n / (fa - n),
      0, 0, -1, 0);
    this.camera.projectionMatrixInverse.copy(P).invert();
    this.projDirty = false;
    this.cover = { s, offx: (vw * s - W) / 2, offy: (vh * s - H) / 2 };
  }

  send(now) {
    const v = this.video;
    // only new camera frames (if the browser stops reporting them, carry on at ~30 per second)
    if (this.rvfc && !this.newFrame && now - this.frameAt < 200) return;
    if (!this.rvfc && now - (this.lastSend || 0) < 30) return;
    if (this.useMain && now - (this.lastMain || 0) < 90) return;
    this.newFrame = false; this.lastSend = now;
    const long = this.useMain ? 640 : PROC_LONG;
    const sc = Math.min(1, long / Math.max(this.vw, this.vh));
    const w = Math.round(this.vw * sc), h = Math.round(this.vh * sc);
    if (this.grab.width !== w || this.grab.height !== h) { this.grab.width = w; this.grab.height = h; }
    let img;
    try { this.g2d.drawImage(v, 0, 0, w, h); img = this.g2d.getImageData(0, 0, w, h); } catch { return; }
    if ((this.stats.frames & 7) === 0) this.lum = 0.85 * this.lum + 0.15 * luminance(img.data);
    const f = this.fRel * Math.max(w, h);
    const K = { fx: f, fy: f, cx: w / 2, cy: h / 2 };
    const job = { id: (this.jobId = (this.jobId || 0) + 1), time: now, w, h, sc, K };
    this.job = job; this.busy = true; this.stats.frames++;
    if (this.useMain) {
      this.lastMain = now;
      const r = this.local.process(img.data, w, h, K, now / 1000);
      r.id = job.id; this.result(r);
      return;
    }
    this.worker.postMessage({ type: 'frame', id: job.id, buf: img.data.buffer, w, h, K, time: now / 1000 }, [img.data.buffer]);
  }

  result(r) {
    this.busy = false;
    const job = this.job;
    if (!job || r.id !== job.id) return;
    const now = performance.now();
    const st = this.stats;
    st.ms = 0.8 * st.ms + 0.2 * r.ms; st.n = r.n || 0; st.rms = r.rms || 0;
    st.dt = now - (st.tPrev || now); st.tPrev = now; st.fps = 0.9 * st.fps + 0.1 * (st.dt > 0 ? 1000 / st.dt : 0);
    this.lastMarkers = { list: r.markers || [], sc: job.sc, time: now };
    if (r.f) this.focalSample(r.f / Math.max(r.w, r.h));
    if (!r.found) return;
    st.found++;
    // map pose: OpenCV camera frame -> three.js camera frame -> room (gyro) frame at the moment of the picture
    const R = r.R, t = r.t;
    const Mcb = TMP.m1.set(R[0], R[1], R[2], t[0], -R[3], -R[4], -R[5], -t[1], -R[6], -R[7], -R[8], -t[2], 0, 0, 0, 1);
    const gyro = this.gyroOn;
    if (gyro) this.motion.at(job.time - LATENCY, TMP.q); else TMP.q.identity();
    const Mwb = TMP.m2.makeRotationFromQuaternion(TMP.q).multiply(Mcb);
    Mwb.decompose(TMP.p, TMP.q2, TMP.s);
    this.filter(TMP.p, TMP.q2, r, job.time, gyro);
  }

  filter(p, q, r, time, gyro) {
    const ts = time / 1000;
    let m = this.map;
    const quality = r.ambiguous ? 0.3 : r.n >= 3 ? 1 : r.n === 2 ? 0.75 : 0.45;
    if (!m || m.gyro !== gyro) {
      m = this.map = { p: p.clone(), q: q.clone(), gyro, matrix: new THREE.Matrix4(), since: time, seen: time, n: r.n, rms: r.rms,
        fp: new OneEuro(3, gyro ? 1.6 : 2.2, gyro ? 30 : 40, 2), fq: new OneEuro(4, 2.0, 1.2, 2), fresh: true, jumps: [] };
      m.fp.filter([p.x, p.y, p.z], ts);
      if (!gyro) m.fq.filter([q.x, q.y, q.z, q.w], ts);
    } else {
      const gap = time - m.seen;
      if (gap > 500) { m.fp.reset(); m.fq.reset(); m.since = time; }      // back after a pause: start smoothing afresh
      const fp = m.fp.filter([p.x, p.y, p.z], ts);
      const ang = m.q.angleTo(q);
      if (gyro) {
        // In the room the map does not turn when the phone turns, so its orientation is smoothed strongly;
        // a big change (map picked up, or back after a pause) is followed quickly.
        const a = gap > 500 || ang > 0.25 ? 0.6 : ang > 0.1 ? 0.3 : 0.12 * quality;
        m.q.slerp(q, a);
        // gyroscope sanity check: steady markers but a jumping room orientation = unusable sensor
        if (r.n >= 2) { m.jumps.push(ang); if (m.jumps.length > 30) m.jumps.shift(); }
        if (m.jumps.length === 30) {
          const med = m.jumps.slice().sort((a2, b2) => a2 - b2)[15];
          m.bad = med > 0.12 ? (m.bad || 0) + 1 : 0;
          if (m.bad > 20) { this.badGyro = true; this.map = null; return; }
        }
      } else {
        if (m.q.dot(q) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
        const fq = m.fq.filter([q.x, q.y, q.z, q.w], ts);
        m.q.set(fq[0], fq[1], fq[2], fq[3]).normalize();
      }
      m.p.set(fp[0], fp[1], fp[2]);
    }
    m.seen = time; m.n = r.n; m.rms = r.rms;
    m.matrix.compose(m.p, m.q, TMP.one);
  }

  // marker outlines in screen pixels (debug view)
  debugMarkers() {
    const lm = this.lastMarkers, c = this.cover;
    if (!lm || !c) return [];
    return lm.list.map(m => ({ id: m.id, pts: m.c.map(([x, y]) => [x / lm.sc * c.s - c.offx, y / lm.sc * c.s - c.offy]) }));
  }
}
const TMP = { m1: new THREE.Matrix4(), m2: new THREE.Matrix4(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1) };

function luminance(d) {
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 97) { s += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; n++; }
  return n ? s / n / 255 : 0.5;
}

// =====================================================================================================
// Controller: where the relief is (on the map / in front of you), gestures, animations and the AR screen.
// =====================================================================================================
const TXT = {
  me: {
    scan: 'Tražim AR mapu', scanSub: 'Usmjerite kameru na odštampanu mapu – teren će izrasti iz papira.',
    map: 'Na mapi', mapSub: 'Obiđite mapu, priđite bliže ili dodirnite stazu.',
    front: 'Ispred vas', frontSub: 'Okrećite telefon da ga razgledate. Prevucite prstom da ga okrenete, raširite dva prsta za veličinu.',
    frontNoGyro: 'Prevucite prstom da okrenete teren, raširite dva prsta za veličinu.',
    held: 'Mapa nije u kadru', heldSub: 'Teren drže senzori telefona. Vratite mapu u kadar za tačan položaj.',
    lost: 'Mapa je izgubljena', lostSub: 'Usmjerite kameru na mapu.',
    coachH: 'Gusinje na vašem stolu', coachP: 'Odštampajte AR mapu i usmjerite kameru na nju: 3D teren izraste iz papira i ostaje na njemu dok ga obilazite. Radi i na iPhoneu i na Androidu.',
    noMap: 'Nemam mapu – prikaži ispred mene', pdf: 'Mapa za štampu (PDF)', pdfA3: 'A3 za izložbu',
    place: 'Ispred mene', toMap: 'Na mapu', height: 'Visina', labels: 'Nazivi', walk: 'Prošetaj', stop: 'Zaustavi', room: 'Prostorni AR', more: 'Još',
    pick: 'Dodirnite stazu na terenu', moreH: 'AR podešavanja', camera: 'Druga kamera', cameraSub: 'Ako je slika previše uvećana, probajte drugu zadnju kameru.',
    quick: 'Quick Look (iPhone)', quickSub: 'Appleov AR prikaz: teren stoji u prostoru, bez naziva i dodira.',
    roomSub: 'Prava AR u prostoru, bez mape (Chrome sa Googleovim AR uslugama).',
    pdfSub: 'A4 za kuću, A3 za muzej – štampa u bilo kojoj veličini radi.',
    debug: 'Detalji praćenja', debugSub: 'Prikazuje markere i brojke; pošaljite snimak ekrana ako nešto ne radi.',
    narrow: 'Kamera je uska (uvećana). U „Još“ izaberite drugu kameru.',
    motionOff: 'Senzori pokreta nisu dozvoljeni: teren prati samo mapu.',
    calibrated: 'Kamera izmjerena', here: 'Teren je ovdje',
  },
  sq: {
    scan: 'Po kërkoj hartën AR', scanSub: 'Drejtojeni kamerën nga harta e printuar – terreni do të ngrihet nga letra.',
    map: 'Në hartë', mapSub: 'Ecni rreth hartës, afrohuni ose prekni një shteg.',
    front: 'Para jush', frontSub: 'Rrotulloni telefonin për ta parë. Rrëshqitni gishtin për ta kthyer, hapni dy gishta për madhësinë.',
    frontNoGyro: 'Rrëshqitni gishtin për ta kthyer terrenin, hapni dy gishta për madhësinë.',
    held: 'Harta nuk është në kuadër', heldSub: 'Terrenin e mbajnë sensorët e telefonit. Kthejeni hartën në kuadër për vendin e saktë.',
    lost: 'Harta humbi', lostSub: 'Drejtojeni kamerën nga harta.',
    coachH: 'Gucia në tavolinën tuaj', coachP: 'Printoni hartën AR dhe drejtojeni kamerën nga ajo: terreni 3D ngrihet nga letra dhe qëndron mbi të ndërsa ecni rreth saj. Punon në iPhone dhe në Android.',
    noMap: 'Nuk kam hartë – shfaqe para meje', pdf: 'Harta për printim (PDF)', pdfA3: 'A3 për ekspozitë',
    place: 'Para meje', toMap: 'Në hartë', height: 'Lartësia', labels: 'Emrat', walk: 'Ec', stop: 'Ndalo', room: 'AR në hapësirë', more: 'Më shumë',
    pick: 'Prekni një shteg në terren', moreH: 'Cilësimet AR', camera: 'Kamera tjetër', cameraSub: 'Nëse pamja është shumë e zmadhuar, provoni një kamerë tjetër të pasme.',
    quick: 'Quick Look (iPhone)', quickSub: 'Pamja AR e Apple: terreni qëndron në hapësirë, pa emra dhe pa prekje.',
    roomSub: 'AR e vërtetë në hapësirë, pa hartë (Chrome me shërbimet AR të Google).',
    pdfSub: 'A4 për shtëpi, A3 për muze – çdo madhësi printimi punon.',
    debug: 'Detajet e ndjekjes', debugSub: 'Shfaq shënjuesit dhe numrat; dërgoni një pamje ekrani nëse diçka nuk punon.',
    narrow: 'Kamera është e ngushtë (e zmadhuar). Te „Më shumë“ zgjidhni një kamerë tjetër.',
    motionOff: 'Sensorët e lëvizjes nuk lejohen: terreni ndjek vetëm hartën.',
    calibrated: 'Kamera u mat', here: 'Terreni është këtu',
  },
  en: {
    scan: 'Looking for the AR map', scanSub: 'Point the camera at the printed map – the terrain will rise out of the paper.',
    map: 'On the map', mapSub: 'Walk around the map, lean in or tap a trail.',
    front: 'In front of you', frontSub: 'Turn the phone to look around it. Drag to rotate it, pinch to resize.',
    frontNoGyro: 'Drag to rotate the terrain, pinch to resize.',
    held: 'Map out of view', heldSub: 'The phone’s motion sensors hold the terrain. Bring the map back into view for the exact position.',
    lost: 'Map lost', lostSub: 'Point the camera at the map.',
    coachH: 'Gusinje on your table', coachP: 'Print the AR map and point the camera at it: the 3D terrain rises out of the paper and stays on it while you walk around. Works on iPhone and Android.',
    noMap: 'No map – show it in front of me', pdf: 'Printable map (PDF)', pdfA3: 'A3 for exhibitions',
    place: 'In front of me', toMap: 'On the map', height: 'Height', labels: 'Names', walk: 'Walk', stop: 'Stop', room: 'Room AR', more: 'More',
    pick: 'Tap a trail on the terrain', moreH: 'AR settings', camera: 'Other camera', cameraSub: 'If the picture looks zoomed in, try another back camera.',
    quick: 'Quick Look (iPhone)', quickSub: 'Apple’s AR view: the terrain stands in the room, without names or taps.',
    roomSub: 'True room AR without the map (Chrome with Google’s AR services).',
    pdfSub: 'A4 for home, A3 for the museum – any print size works.',
    debug: 'Tracking details', debugSub: 'Shows the markers and numbers; send a screenshot if something doesn’t work.',
    narrow: 'This camera is narrow (zoomed in). Choose another camera under “More”.',
    motionOff: 'Motion sensors are not allowed: the terrain follows the map only.',
    calibrated: 'Camera measured', here: 'The terrain is here',
  },
};

export const arText = (lang, k) => (TXT[lang] && TXT[lang][k]) ?? TXT.me[k] ?? k;

export class TrailsAR {
  // ctx: { renderer, scene, holder, rise, pickGroup, select, sel, trail(id), lang(), t(key), onExit, layoutLabels, exagSteps, setExag, setLabels, labels(), walk, ... }
  constructor(ctx) {
    this.ctx = ctx;
    this.debug = /[?&]debug\b/.test(location.search);
    this.engine = new CameraAR({ debug: this.debug });
    this.mode = 'search';        // search | free | map | held | lost
    this.free = { pos: new THREE.Vector3(), yaw: 0, scale: 0.4, tilt: 0 };
    this.anim = null; this.riseT = null; this.ripple = null;
    this.pointers = new Map();
    this.target = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: 1 };
  }
  T(k) { return arText(this.ctx.lang(), k); }

  async start(motionAnswer) {
    const c = this.ctx, $ = s => document.querySelector(s);
    this.root = $('#arRoot');
    this.ov = $('#xrOverlay');
    this.root.hidden = false;
    this.root.appendChild(c.renderer.domElement);
    document.body.classList.add('in-ar');
    this.ov.hidden = false; this.ov.dataset.kind = 'cam';
    c.holder.visible = false; this.shown = false;
    this.paint(); this.setMode('search');
    this.size();
    this.onResize = () => this.size();
    window.addEventListener('resize', this.onResize);
    if (window.visualViewport) visualViewport.addEventListener('resize', this.onResize);
    this.bindInput();
    try {
      await this.engine.start(this.root, motionAnswer);
    } catch (e) {
      this.stop(true);
      throw e;
    }
    this.size();
    this.t0 = performance.now();
    // no map in view after a moment: explain the map and offer the relief in front of you
    this.freeTimer = setTimeout(() => { if (this.mode === 'search' && !this.engine.map) this.showCoach(true); }, 1600);
    setTimeout(() => { if (this.engine.running && !this.engine.motion.count && this.engine.useGyro) this.toastOnce(this.T('motionOff')); }, 2500);
    return true;
  }

  stop(silent) {
    clearTimeout(this.freeTimer);
    window.removeEventListener('resize', this.onResize);
    if (window.visualViewport) visualViewport.removeEventListener('resize', this.onResize);
    this.unbindInput();
    this.engine.stop();
    this.root.hidden = true; this.ov.hidden = true;
    document.body.classList.remove('in-ar');
    this.debugCanvas && this.debugCanvas.remove(); this.debugCanvas = null;
    this.ripple && this.ripple.removeFromParent();
    if (!silent) this.ctx.onExit();
  }

  size() {
    const w = this.root.clientWidth || innerWidth, h = this.root.clientHeight || innerHeight;
    const r = this.ctx.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, this.pxCap || 2));
    r.setSize(w, h, false);
    r.domElement.style.width = '100%'; r.domElement.style.height = '100%';
    this.engine.resize(w, h);
    this.w = w; this.h = h;
    if (this.debugCanvas) { this.debugCanvas.width = w; this.debugCanvas.height = h; }
  }

  // ---------------- per frame ----------------
  frame(now) {
    const e = this.engine, c = this.ctx;
    if (!e.running) return e.camera;
    e.update(now);
    const m = e.map;
    // state machine (enter the map at once, leave it only after a longer gap, so a missed frame does not flicker)
    const age = m ? now - m.seen : Infinity;
    if (age < 220 && this.mode !== 'map' && !this.detached) this.enterMap(now);
    else if (this.mode === 'map' && age > 650) { this.setMode(e.gyroOn ? 'held' : 'lost'); this.lostAt = now; }
    if (this.mode === 'held' && !e.gyroOn) { this.setMode('lost'); this.lostAt = now; }
    // where the relief should be
    const H = c.holder;
    if (this.mode === 'map' || this.mode === 'held') {
      if (m) { m.matrix.decompose(this.target.p, this.target.q, TMP.s); this.target.s = MAP_WIDTH; }
    } else if (this.mode === 'free') this.freeTarget();
    if (this.mode === 'lost') H.visible = now - this.lostAt < 350;        // no motion sensor: nothing can hold it
    else if (this.mode !== 'search') H.visible = true;
    if (this.anim) {
      const u = Math.min(1, (now - this.anim.t0) / this.anim.dur), k = easeInOut(u);
      H.position.lerpVectors(this.anim.p0, this.target.p, k);
      H.quaternion.slerpQuaternions(this.anim.q0, this.target.q, k);
      H.scale.setScalar(this.anim.s0 + (this.target.s - this.anim.s0) * k);
      if (u >= 1) this.anim = null;
    } else if (this.mode !== 'search' && this.mode !== 'lost') {
      H.position.copy(this.target.p); H.quaternion.copy(this.target.q); H.scale.setScalar(this.target.s);
    }
    // rise out of the paper
    if (this.riseT != null) {
      const u = Math.min(1, (now - this.riseT) / 1500);
      c.rise.scale.y = Math.max(0.002, easeOutBack(u));
      if (u >= 1) this.riseT = null;
    }
    if (this.ripple) this.stepRipple(now);
    // light follows the room brightness a little
    const exp = THREE.MathUtils.clamp(0.72 + 0.7 * e.lum, 0.78, 1.18);
    c.renderer.toneMappingExposure += (exp - c.renderer.toneMappingExposure) * 0.05;
    this.arrow();
    if (this.debug) this.drawDebug(now);
    this.perf(now);
    return e.camera;
  }

  enterMap(now) {
    const c = this.ctx, H = c.holder, first = this.mode === 'search' || this.mode === 'lost';
    clearTimeout(this.freeTimer);
    this.hideCoach();
    this.engine.map.matrix.decompose(this.target.p, this.target.q, TMP.s); this.target.s = MAP_WIDTH;
    if (first) {
      H.position.copy(this.target.p); H.quaternion.copy(this.target.q); H.scale.setScalar(MAP_WIDTH);
      if (!this.shown) { this.riseT = now; c.rise.scale.y = 0.002; this.shown = true; }      // first time: rise out of the paper
      this.anim = null;
    } else if (this.mode === 'free') {
      this.anim = { t0: now, dur: 900, p0: H.position.clone(), q0: H.quaternion.clone(), s0: H.scale.x };   // fly onto the paper
    } else {
      this.anim = { t0: now, dur: 260, p0: H.position.clone(), q0: H.quaternion.clone(), s0: H.scale.x };   // small correction after "held"
    }
    if (this.mode !== 'held') this.startRipple(now);
    H.visible = true;
    this.setMode('map');
  }

  // the "In front of me" / "On the map" button
  togglePlace() {
    if (this.mode === 'free' && this.detached) { this.detached = false; this.engine.map = null; this.setMode('free'); return; }   // the map takes it again when seen
    this.detached = this.mode === 'map' || this.mode === 'held';
    this.goFree(true);
  }
  goFree(recenter = true) {
    const c = this.ctx, H = c.holder, now = performance.now(), wasHidden = this.mode === 'search' || this.mode === 'lost' || !H.visible;
    clearTimeout(this.freeTimer);
    this.hideCoach();
    if (recenter) this.placeFree();
    this.freeTarget();
    if (wasHidden) {
      H.position.copy(this.target.p); H.quaternion.copy(this.target.q); H.scale.setScalar(this.target.s);
      this.riseT = now; c.rise.scale.y = 0.002; this.anim = null; this.shown = true;
    } else this.anim = { t0: now, dur: 700, p0: H.position.clone(), q0: H.quaternion.clone(), s0: H.scale.x };
    this.engine.map = null;             // the map, if it comes into view, takes the relief again
    H.visible = true;
    this.setMode('free');
  }
  placeFree() {
    const cam = this.engine.camera, f = this.free;
    const d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    if (this.engine.gyroOn) {
      const pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      const fh = new THREE.Vector3(d.x, 0, d.z); if (fh.lengthSq() < 1e-4) fh.set(0, 0, -1); fh.normalize();
      const phi = Math.min(pitch, -24 * D2R), dist = this.fitDist(f.scale);
      f.pos.copy(fh).multiplyScalar(Math.cos(phi) * dist); f.pos.y = Math.sin(phi) * dist;
      f.yaw = Math.atan2(-fh.x, -fh.z);           // south edge towards you
      f.tilt = 0;
    } else {                                     // no motion sensor: fixed in the view, tipped towards you
      const dist = this.fitDist(f.scale);
      f.pos.set(0, -0.05 * dist, -dist); f.yaw = 0; f.tilt = 38 * D2R;
    }
  }
  fitDist(scale) {
    const P = this.engine.camera.projectionMatrix.elements;
    const half = Math.atan(1 / Math.max(P[0], P[5]));        // the narrower half-angle of the view
    return THREE.MathUtils.clamp(scale * 0.62 / Math.tan(half), 0.3, 2.5);
  }
  freeTarget() {
    const f = this.free;
    this.target.p.copy(f.pos);
    this.target.q.setFromEuler(TMP.e.set(f.tilt, f.yaw, 0, 'YXZ'));
    this.target.s = f.scale;
  }

  // ---------------- screen ----------------
  setMode(mode) {
    this.mode = mode;
    const ov = this.ov;
    ov.dataset.mode = mode;
    const key = { search: ['scan', 'scanSub'], map: ['map', 'mapSub'], free: ['front', this.engine.gyroOn ? 'frontSub' : 'frontNoGyro'], held: ['held', 'heldSub'], lost: ['lost', 'lostSub'] }[mode];
    document.querySelector('#xrMsg').textContent = this.T(key[0]);
    const hint = document.querySelector('#xrHint');
    hint.textContent = this.T(key[1]);
    hint.classList.remove('gone'); clearTimeout(this.hintT);
    if (mode !== 'search' && mode !== 'lost') this.hintT = setTimeout(() => hint.classList.add('gone'), 5200);
    document.querySelector('#xrScan').hidden = !(mode === 'search' || mode === 'lost');
    const pl = document.querySelector('#xrPlace span');
    if (pl) pl.textContent = this.T(mode === 'free' && this.detached ? 'toMap' : 'place');
  }
  paint() {
    const $ = s => document.querySelector(s), T = k => this.T(k);
    $('#coachH').textContent = T('coachH'); $('#coachP').textContent = T('coachP');
    $('#coachFree').textContent = T('noMap'); $('#coachPdf').textContent = T('pdf');
    $('#xrMoreBtn').setAttribute('aria-label', T('more'));
    $('#xrClose').setAttribute('aria-label', this.ctx.t('close'));
    $('#xrArrow').setAttribute('aria-label', T('here'));
    this.ctx.paintTrail();
    if (this.mode) this.setMode(this.mode);
  }
  showCoach(auto) {
    const el = document.querySelector('#xrCoach');
    el.hidden = false; this.coachAuto = auto;
    if (this.ctx.onCoach) this.ctx.onCoach();
  }
  hideCoach() { const el = document.querySelector('#xrCoach'); if (el) el.hidden = true; }
  toastOnce(msg) { if (this.toasted && this.toasted.has(msg)) return; (this.toasted ||= new Set()).add(msg); this.ctx.toast(msg); }

  arrow() {            // edge arrow pointing to the relief when it is out of view
    const el = document.querySelector('#xrArrow'), H = this.ctx.holder;
    const show = (this.mode === 'free' || this.mode === 'held') && H.visible;
    if (!show) { el.hidden = true; return; }
    // hidden while any corner of the relief is on screen
    const cam = this.engine.camera;
    for (const [x, z] of [[-0.5, -0.48], [0.5, -0.48], [0.5, 0.48], [-0.5, 0.48]]) {
      TMP.p.set(x, 0, z).applyMatrix4(H.matrixWorld).project(cam);
      if (TMP.p.z < 1 && Math.abs(TMP.p.x) < 0.95 && Math.abs(TMP.p.y) < 0.95) { el.hidden = true; return; }
    }
    TMP.p.setFromMatrixPosition(H.matrixWorld).project(cam);
    const behind = TMP.p.z > 1;
    let x = TMP.p.x, y = TMP.p.y;
    if (behind) { x = -x; y = -y; }
    const inside = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.92;
    el.hidden = inside;
    if (inside) return;
    const ang = Math.atan2(-y, x), k = 0.86 / Math.max(Math.abs(x), Math.abs(y), 1e-3);
    const px = (x * k + 1) / 2 * this.w, py = (1 - y * k) / 2 * this.h;
    el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) rotate(${(ang / D2R).toFixed(1)}deg)`;
  }

  startRipple(now) {
    if (!this.rippleMesh) {
      const g = new THREE.RingGeometry(0.5, 0.53, 96).rotateX(-Math.PI / 2);
      this.rippleMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, depthWrite: false, opacity: 0.9 }));
      this.rippleMesh.renderOrder = 5;
    }
    this.ripple = this.rippleMesh; this.ripple.userData.t0 = now;
    this.ctx.holder.add(this.ripple);
  }
  stepRipple(now) {
    const u = (now - this.ripple.userData.t0) / 1100;
    if (u >= 1) { this.ripple.removeFromParent(); this.ripple = null; return; }
    this.ripple.scale.setScalar(0.35 + 1.0 * easeOut(u)); this.ripple.position.y = 0.002;
    this.ripple.material.opacity = 0.85 * (1 - u);
  }

  perf(now) {          // lower the drawing resolution on slow phones
    const p = this.perfS ||= { t: now, n: 0 };
    p.n++;
    if (now - p.t > 2000) {
      const fps = p.n * 1000 / (now - p.t);
      p.t = now; p.n = 0;
      const cap = this.pxCap || 2;
      if (fps < 40 && cap > 1) { this.pxCap = Math.max(1, cap - 0.5); this.size(); }
    }
  }

  // ---------------- touch ----------------
  bindInput() {
    const el = this.ctx.renderer.domElement;
    this.h_down = e => this.down(e); this.h_move = e => this.move(e); this.h_up = e => this.up(e);
    el.addEventListener('pointerdown', this.h_down); el.addEventListener('pointermove', this.h_move);
    el.addEventListener('pointerup', this.h_up); el.addEventListener('pointercancel', this.h_up);
    this.h_gesture = e => e.preventDefault();          // iPhone: a pinch on the AR view must not zoom the page
    document.addEventListener('gesturestart', this.h_gesture, { passive: false });
    document.addEventListener('gesturechange', this.h_gesture, { passive: false });
  }
  unbindInput() {
    const el = this.ctx.renderer.domElement;
    el.removeEventListener('pointerdown', this.h_down); el.removeEventListener('pointermove', this.h_move);
    el.removeEventListener('pointerup', this.h_up); el.removeEventListener('pointercancel', this.h_up);
    document.removeEventListener('gesturestart', this.h_gesture); document.removeEventListener('gesturechange', this.h_gesture);
    this.pointers.clear();
  }
  down(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    try { e.target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.g = { yaw0: this.free.yaw, scale0: this.free.scale, moved: false, two: this.pointers.size >= 2 ? this.pair() : null };
  }
  pair() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  move(e) {
    const p = this.pointers.get(e.pointerId); if (!p || !this.g) return;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 9) this.g.moved = true;
    if (this.mode !== 'free') return;
    if (this.pointers.size >= 2) {
      if (!this.g.two) { this.g.two = this.pair(); this.g.yaw0 = this.free.yaw; this.g.scale0 = this.free.scale; }
      const now2 = this.pair();
      this.free.scale = THREE.MathUtils.clamp(this.g.scale0 * now2.d / Math.max(20, this.g.two.d), 0.15, 2.0);
      this.free.yaw = this.g.yaw0 - (now2.ang - this.g.two.ang);
    } else if (this.g.moved && !this.g.two) {
      this.free.yaw = this.g.yaw0 + (p.x - p.x0) / this.w * Math.PI * 1.6;
    }
  }
  up(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p || !this.g) return;
    const tap = !this.g.moved && !this.g.two && performance.now() - p.t0 < 450;
    if (this.pointers.size === 0) this.g = null;
    if (!tap) return;
    const now = performance.now();
    if (this.mode === 'free' && this.lastTap && now - this.lastTap < 320) { this.lastTap = 0; this.goFree(true); return; }   // double tap: back in front of me
    this.lastTap = now;
    const r = this.ctx.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((p.x - r.left) / r.width * 2 - 1, -((p.y - r.top) / r.height) * 2 + 1);
    const id = this.ctx.pick(ndc, this.engine.camera);
    if (id) this.ctx.select(id);
  }

  // ---------------- debug view (?debug) ----------------
  drawDebug(now) {
    if (!this.debugCanvas) {
      const c = this.debugCanvas = document.createElement('canvas');
      c.className = 'ar-debug'; c.width = this.w; c.height = this.h;
      this.root.appendChild(c);
    }
    const g = this.debugCanvas.getContext('2d'), e = this.engine, st = e.stats;
    g.clearRect(0, 0, this.w, this.h);
    g.lineWidth = 2; g.font = '600 12px system-ui, sans-serif';
    const lm = e.lastMarkers;
    if (lm && now - lm.time < 400) for (const m of e.debugMarkers()) {
      g.strokeStyle = '#3df59a'; g.beginPath(); m.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke();
      g.fillStyle = '#ff3b6b'; g.fillRect(m.pts[0][0] - 3, m.pts[0][1] - 3, 6, 6);
      g.fillStyle = '#3df59a'; g.fillText(String(m.id), m.pts[0][0] + 5, m.pts[0][1] - 5);
    }
    const s = e.video, mm = e.map;
    const lines = [
      `mode ${this.mode}  gyro ${e.gyroOn ? 'on' : e.badGyro ? 'BAD' : e.motion.count ? 'stale' : 'none'}  worker ${e.useMain ? 'main' : e.worker ? 'yes' : '-'}`,
      `video ${s.videoWidth}×${s.videoHeight}  ${s.paused ? 'PAUSED' : 'playing'}  ready ${s.readyState}`,
      `markers ${st.n}  rms ${st.rms.toFixed(2)}px  detect ${st.ms.toFixed(0)} ms  ${st.fps.toFixed(1)} /s`,
      `fov ${e.fovLong.toFixed(1)}° ${e.calibrated ? '(measured)' : '(guess)'}  samples ${e.fSamples.length}  lum ${e.lum.toFixed(2)}`,
      mm ? `map ${(mm.p.length() * 100).toFixed(1)} cm  seen ${(now - mm.seen).toFixed(0)} ms ago` : 'map -',
      `px ${(this.ctx.renderer.getPixelRatio()).toFixed(2)}`,
    ];
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(8, this.h * 0.18, 330, lines.length * 16 + 10);
    g.fillStyle = '#fff'; lines.forEach((l, i) => g.fillText(l, 14, this.h * 0.18 + 18 + i * 16));
  }
}

const easeInOut = u => u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const easeOut = u => 1 - Math.pow(1 - u, 3);
const easeOutBack = u => { const c1 = 1.25, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };
TMP.e = new THREE.Euler();
