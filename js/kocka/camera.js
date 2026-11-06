// The phone's camera for the museum cube: the whole sensor picture at 1x, the right back lens, the camera's
// field of view learned from the cube, and recovery when Safari or Chrome stops the picture.
//
// Lens: some phones give the browser the telephoto lens (the user's Android: about 19 deg instead of about
// 66 deg). The field of view of each lens is measured on the cube (two or more faces in view) and, while a lens
// is narrower than LENS_MIN, the next back camera is tried by itself. Choosing a lens by hand stops the search.
import { estimateFov, median, intrinsicsFor } from '../cv/calib.js';

const LENS_KEY = 'gkb.cube.lenses', FOV_KEY = 'gkb.cube.fov', LENS_MIN = 40, LENS_WAIT = 7, FOV_DEFAULT = 66;
const now = () => performance.now() / 1000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } };
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class Camera {
  // video: the <video> element (it must stay on the page: Safari pauses muted videos that are not)
  // settings: shared settings object ({camId, camManual, fovFix}); save(): persist settings; on: event hooks
  constructor(video, settings, save, on = {}) {
    Object.assign(this, { video, settings, save, on });
    this.stream = null; this.track = null; this.caps = {}; this.zoom = 1; this.label = ''; this.list = []; this.devId = '';
    this.lensDb = read(LENS_KEY, {});
    this.lens = { searching: false, tried: new Set(), fail: new Set(), since: 0, switching: false, warned: false };
    this.fov = { value: settings.fovFix || FOV_DEFAULT, source: settings.fovFix ? 'set' : 'default', samples: [], tick: 0, savedAt: 0, key: '' };
    this.lastFrame = 0; this.stalled = false;
  }

  async open(deviceId) {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    // 4:3 is the sensor's own shape on almost every phone; a 16:9 request is served by cropping (= zoomed in)
    const v = { width: { ideal: 1440 }, height: { ideal: 1080 }, aspectRatio: { ideal: 4 / 3 }, frameRate: { ideal: 30 } };
    if (deviceId) v.deviceId = { exact: deviceId }; else v.facingMode = { ideal: 'environment' };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: v }); }
    catch (e) {
      if (!deviceId || e.name === 'NotAllowedError') throw e;
      delete v.deviceId; v.facingMode = { ideal: 'environment' };          // the saved camera is gone
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: v });
    }
    this.stream = stream; this.track = stream.getVideoTracks()[0];
    this.caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
    this.label = this.track.label || '';
    this.zoom = 1;
    if (this.caps.zoom) {
      const want = clamp(this.settings.zoomIn || 1, this.caps.zoom.min, this.caps.zoom.max);
      try { await this.track.applyConstraints({ advanced: [{ zoom: want }] }); } catch { /* no zoom control */ }
      this.zoom = (this.track.getSettings().zoom) || want;
    }
    if (this.caps.focusMode && this.caps.focusMode.includes('continuous')) {
      try { await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* ignore */ }
    }
    this.devId = (this.track.getSettings && this.track.getSettings().deviceId) || deviceId || '';
    this.track.addEventListener('ended', () => { if (this.track && this.track.readyState === 'ended') this.stalled = true; this.on.stall && this.on.stall(); });
    this.video.srcObject = stream;
    this.video.setAttribute('playsinline', ''); this.video.muted = true;
    await this.video.play();
    this.lastFrame = now(); this.stalled = false;
    this.fov.key = '';
    this.loadFov();
    this.on.change && this.on.change();
  }

  // ---------- back cameras ----------
  static isBack(d) {
    const l = d.label || '';
    if (/front|user|selfie|prednj|facetime/i.test(l)) return false;
    if (/back|rear|environment|zadnj|stra[žz]nj/i.test(l)) return true;
    try { const f = d.getCapabilities && d.getCapabilities().facingMode; if (f && f.length) return f.includes('environment'); } catch { /* not supported */ }
    return true;
  }
  async listCameras() {
    try {
      const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const back = all.filter(Camera.isBack);
      this.list = back.length ? back : all;
    } catch { this.list = []; }
    this.on.list && this.on.list();
  }
  lensFov(id) { return this.lensDb[id] ? this.lensDb[id].fov : this.lens.fail.has(id) ? 0 : null; }
  get number() { return Math.max(0, this.list.findIndex(d => d.deviceId === this.devId)) + 1; }
  // order to try: the phone's main wide camera first (Chrome: "camera2 0"; iPhone: "Back Camera", not the
  // virtual dual/triple cameras that switch lenses by themselves when the cube comes close)
  lensOrder() {
    const score = d => (/camera2 0\b/.test(d.label) || /^back camera$/i.test(d.label) ? 2 : /ultra|tele|dual|triple|macro/i.test(d.label) ? 0 : 1);
    return this.list.slice().sort((a, b) => score(b) - score(a));
  }
  async use(id, why) {
    if (this.lens.switching) return;
    this.lens.switching = true;
    try { await this.open(id); } catch { this.lens.fail.add(id); }
    this.lens.switching = false;
    this.lens.since = now();
    this.on.list && this.on.list();
    if (why && this.on.toast) this.on.toast(why);
  }
  async pickMain() {
    if (this.list.length < 2 || (this.settings.camManual && this.settings.camId)) return;
    const good = this.bestMeasured();
    if (good) { if (good.deviceId !== this.devId) await this.use(good.deviceId); return; }
    const first = this.lensOrder().find(d => this.lensFov(d.deviceId) == null);
    if (first && first.deviceId !== this.devId && this.lensFov(this.devId) == null && (IOS || /camera2/.test(first.label))) await this.use(first.deviceId);
    this.lens.since = now();
  }
  bestMeasured() {
    return this.lensOrder().filter(d => this.lensFov(d.deviceId) >= LENS_MIN)
      .sort((a, b) => Math.abs(this.lensFov(a.deviceId) - FOV_DEFAULT) - Math.abs(this.lensFov(b.deviceId) - FOV_DEFAULT))[0];
  }
  checkLens() {
    if (this.lens.switching || (this.settings.camManual && this.settings.camId)) return;
    const cur = this.lensFov(this.devId), tr = this.on.text || (k => k);
    if (this.list.length < 2) { if (cur != null && cur < LENS_MIN) this.widenOrWarn(); return; }
    if (cur == null) {
      if (this.lens.searching && now() - this.lens.since > LENS_WAIT) this.lens.fail.add(this.devId); else return;
    } else if (cur >= LENS_MIN) {
      if (this.settings.camId !== this.devId) { this.settings.camId = this.devId; this.save(); }
      if (this.lens.searching) { this.lens.searching = false; this.on.toast && this.on.toast(tr('lensOk', { n: this.number, fov: Math.round(cur) })); }
      return;
    }
    const next = this.lensOrder().find(d => this.lensFov(d.deviceId) == null && !this.lens.tried.has(d.deviceId) && d.deviceId !== this.devId);
    if (next) {
      this.lens.searching = true; this.lens.tried.add(next.deviceId);
      this.use(next.deviceId, tr('lensTry', { fov: Math.round(this.lensFov(this.devId) || 0) }));
      return;
    }
    const best = this.bestMeasured();
    this.lens.searching = false;
    if (best && best.deviceId !== this.devId) { this.use(best.deviceId, tr('lensOk', { n: this.list.indexOf(best) + 1, fov: Math.round(this.lensFov(best.deviceId)) })); return; }
    if (!best) this.widenOrWarn();
  }
  async widenOrWarn() {
    const z = this.caps.zoom;
    if (z && z.min < this.zoom - 0.05 && this.track) {
      try {
        await this.track.applyConstraints({ advanced: [{ zoom: z.min }] });
        this.zoom = this.track.getSettings().zoom || z.min; this.fov.key = ''; delete this.lensDb[this.devId]; write(LENS_KEY, this.lensDb); this.loadFov(); return;
      } catch { /* no */ }
    }
    if (!this.lens.warned) { this.lens.warned = true; this.on.narrow && this.on.narrow(Math.round(this.fov.value)); }
  }
  async next() {
    if (this.list.length < 2) return;
    const i = this.list.findIndex(d => d.deviceId === this.devId);
    const d = this.list[(i + 1) % this.list.length];
    this.settings.camId = d.deviceId; this.settings.camManual = true; this.save();
    this.lens.searching = false;
    await this.use(d.deviceId);
    return d;
  }
  auto() { this.settings.camManual = false; this.save(); this.lens.tried.clear(); this.checkLens(); }

  // ---------- field of view, learned from the cube ----------
  get fovKeyNow() { return `${(this.devId || 'cam').slice(0, 12)}|${this.video.videoWidth}x${this.video.videoHeight}|z${(+this.zoom).toFixed(2)}`; }
  loadFov() {
    const key = this.fovKeyNow;
    if (this.fov.key === key) return;
    this.fov.key = key; this.fov.samples = []; this.fov.savedAt = 0;
    if (this.settings.fovFix) return this.setFov(this.settings.fovFix, 'set');
    const saved = read(FOV_KEY, {});
    if (saved[key]) return this.setFov(saved[key], 'saved');
    // not measured yet: the main lens is about 66 deg; a hardware zoom narrows it
    this.setFov(2 * Math.atan(Math.tan(FOV_DEFAULT * Math.PI / 360) / Math.max(0.3, this.zoom || 1)) * 180 / Math.PI, 'default');
  }
  setFov(fov, source) {
    this.fov.source = source;
    if (Math.abs(fov - this.fov.value) < 0.3) return;
    const k = Math.tan(this.fov.value * Math.PI / 360) / Math.tan(fov * Math.PI / 360);   // new focal length / old
    this.fov.value = fov;
    this.on.fov && this.on.fov(k);
  }
  intrinsics() { return intrinsicsFor(this.fov.value, this.video.videoWidth, this.video.videoHeight); }
  // called with each frame's result: two or more faces of the rigid cube fix the field of view
  learn(res, K, target) {
    if (this.settings.fovFix) return;
    const p = res.poses.cube;
    if (!p || p.ambiguous || !p.faces || p.faces.length < 2 || p.n < 3) return;
    if (this.fov.samples.length >= 6 && this.fov.tick++ % 3) return;     // quickly at first, then now and then
    const used = res.markers.filter(m => p.ids.includes(m.id));
    const obj = used.flatMap(m => target.markers.get(m.id).corners), img = used.flatMap(m => m.corners);
    const e = estimateFov(p.R, p.t, K, obj, img);
    if (!e) return;
    const f = this.fov;
    f.samples.push(e.fov);
    if (f.samples.length > 25) f.samples.shift();
    if (f.samples.length >= 4) {
      this.setFov(median(f.samples), 'learned');
      if (this.devId && Math.abs((this.lensFov(this.devId) || 0) - f.value) > 1.5) {
        this.lensDb[this.devId] = { fov: Math.round(f.value * 10) / 10, z: this.zoom }; write(LENS_KEY, this.lensDb);
        this.on.list && this.on.list(); this.checkLens();
      }
      if (f.samples.length >= 6 && f.samples.length - f.savedAt >= 5) {
        f.savedAt = f.samples.length;
        const saved = read(FOV_KEY, {}); saved[f.key] = Math.round(f.value * 10) / 10; write(FOV_KEY, saved);
      }
    }
  }
  forgetFov() { write(FOV_KEY, {}); this.lensDb = {}; write(LENS_KEY, {}); this.fov.key = ''; this.loadFov(); }

  // ---------- the picture stopped (Safari pauses videos; a phone call or the app switcher ends the track) ----------
  frameArrived() { this.lastFrame = now(); if (this.stalled) { this.stalled = false; this.on.resume && this.on.resume(); } }
  checkStall() {
    if (document.visibilityState !== 'visible' || !this.stream) return false;
    const ended = this.track && this.track.readyState === 'ended';
    if ((ended || now() - this.lastFrame > 1.6) && !this.stalled) { this.stalled = true; this.on.stall && this.on.stall(); }
    return this.stalled;
  }
  async restart() {
    try {
      if (this.track && this.track.readyState === 'live') { await this.video.play(); this.lastFrame = now(); return true; }
      await this.open(this.devId || this.settings.camId || null); return true;
    } catch { return false; }
  }
}
