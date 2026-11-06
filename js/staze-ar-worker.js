// Background thread for the trails AR: finds the printed map in camera frames so the 3D view never waits for it.
import { MapTracker } from './staze-ar-track.js';

let tracker = null;
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'init') { tracker = new MapTracker(m.layout); self.postMessage({ type: 'ready' }); return; }
    if (m.type === 'frame' && tracker) {
      const res = tracker.process(new Uint8ClampedArray(m.buf), m.w, m.h, m.K, m.time);
      res.type = 'result'; res.id = m.id;
      self.postMessage(res);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m && m.id, message: String(err && err.message || err) });
  }
};
