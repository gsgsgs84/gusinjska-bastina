// Background thread for room tracking on the trails page (classic worker: jsfeat is a plain script).
self.window = self;                  // jsfeat's build registers itself on window
importScripts('vendor/jsfeat/jsfeat-min.js', 'staze-room-track.js');
let tracker = null;
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'start') {
      if (!tracker || tracker.w !== m.w || tracker.h !== m.h) tracker = new self.RoomTracker(m.w, m.h);
      const r = tracker.start(new Uint8ClampedArray(m.buf), m.K, m.R, m.C, m.planeY, m.time, m.Rs);
      self.postMessage({ type: 'room', id: m.id, start: true, ok: r.ok, n: r.n, R: m.R, C: m.C, inl: r.n, ms: 0 });
    } else if (m.type === 'frame') {
      if (!tracker || !tracker.started || tracker.w !== m.w || tracker.h !== m.h) { self.postMessage({ type: 'room', id: m.id, ok: false, idle: true }); return; }
      // no gyroscope: the rotation comes from the picture, m.grav (accelerometer) keeps it level
      const r = tracker.track(new Uint8ClampedArray(m.buf), m.K, m.R, m.time, m.vision ? { vision: true, grav: m.grav } : undefined);
      r.type = 'room'; r.id = m.id;
      self.postMessage(r);
    } else if (m.type === 'stop') { if (tracker) tracker.started = false; }
  } catch (err) {
    self.postMessage({ type: 'room', id: m && m.id, ok: false, error: String(err && err.message || err) });
  }
};
self.postMessage({ type: 'ready' });
