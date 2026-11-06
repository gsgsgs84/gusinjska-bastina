// Marker detection in the background (a classic Web Worker), so the camera picture and the 3D stay smooth.
// It runs OpenCV's ArUco detector (OpenCV.js 5, WebAssembly, Apache 2.0), which reads the cube's
// ARUCO_MIP_36h12 markers the same way in Safari on iPhone and Chrome on Android.
//
// in:  { type: 'init', url, ids }                       -> { type: 'ready', ms } | { type: 'error', message }
//      { type: 'detect', id, buf, w, h, mode, scale }    -> { type: 'result', id, markers, light, ms, buf }
//      buf = RGBA pixels (transferred and sent back so the page can reuse it)
// markers: [{ id, c: [x0, y0, x1, y1, x2, y2, x3, y3] }] in processing px, OpenCV corner order
// (top-left, top-right, bottom-right, bottom-left of the marker = the corner order of data/layout.json).
/* eslint-env worker */
/* global cv, importScripts */
'use strict';

let ready = false, known = null, det = {}, mat = null, mw = 0, mh = 0, corners = null, ids = null, rej = null;

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') return init(m);
    if (m.type === 'detect') return detect(m);
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e && e.message) || e), id: m.id, buf: m.buf }, m.buf ? [m.buf] : []);
  }
};

async function init(m) {
  const t0 = performance.now();
  importScripts(m.url);
  let mod = self.cv;
  if (mod && typeof mod.then === 'function') mod = await mod;
  else if (mod && !mod.Mat) await new Promise((res) => { mod.onRuntimeInitialized = res; });
  self.cv = mod;
  known = new Set(m.ids);
  const dict = cv.getPredefinedDictionary(cv.DICT_ARUCO_MIP_36h12);
  // Threshold windows from fine to coarse: small windows keep the 4 mm gaps between a face's markers apart,
  // large ones survive dim light and soft focus. 'track' looks at a sharp crop around the cube.
  det.search = make(dict, 5, 21, 8);
  det.track = make(dict, 3, 23, 5);
  corners = new cv.MatVector(); ids = new cv.Mat(); rej = new cv.MatVector();
  ready = true;
  self.postMessage({ type: 'ready', ms: Math.round(performance.now() - t0) });
}

function make(dict, winMin, winMax, winStep) {
  const p = new cv.aruco_DetectorParameters();
  p.adaptiveThreshWinSizeMin = winMin; p.adaptiveThreshWinSizeMax = winMax; p.adaptiveThreshWinSizeStep = winStep;
  p.minMarkerPerimeterRate = 0.02;       // markers down to ~3 % of the picture (cube far away)
  p.minMarkerDistanceRate = 0.025;       // the four markers on one face are close together
  p.minDistanceToBorder = 1;
  p.errorCorrectionRate = 0.6;
  p.perspectiveRemovePixelPerCell = 4;
  p.cornerRefinementMethod = cv.CORNER_REFINE_SUBPIX;
  p.cornerRefinementWinSize = 3;
  return new cv.aruco_ArucoDetector(dict, p, new cv.aruco_RefineParameters(10, 3, true));
}

function detect(m) {
  if (!ready) throw new Error('not ready');
  const t0 = performance.now();
  const { w, h } = m, rgba = new Uint8Array(m.buf);
  if (!mat || w !== mw || h !== mh) {
    if (mat) mat.delete();
    mat = new cv.Mat(h, w, cv.CV_8UC1); mw = w; mh = h;
  }
  // grey picture + average colour of the scene (for matching the 3D lighting to the room)
  const g = mat.data, n = w * h;
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const r = rgba[i], gg = rgba[i + 1], b = rgba[i + 2];
    g[j] = (r * 77 + gg * 150 + b * 29) >> 8;
    if ((j & 15) === 0) { sr += r; sg += gg; sb += b; cnt++; }
  }
  det[m.mode === 'track' ? 'track' : 'search'].detectMarkers(mat, corners, ids, rej);
  // OpenCV puts pixel centres on whole numbers; the page maps corners back with x0 + x / scale,
  // so shift them by half a pixel to land on the same centres.
  const sh = 0.5 - 0.5 * (m.scale || 1);
  const k = ids.rows * ids.cols, out = [], seen = new Set();
  for (let i = 0; i < k; i++) {
    const id = ids.data32S[i];
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    const c = corners.get(i), d = c.data32F;
    out.push({ id, c: [d[0] + sh, d[1] + sh, d[2] + sh, d[3] + sh, d[4] + sh, d[5] + sh, d[6] + sh, d[7] + sh] });
    c.delete();
  }
  const light = cnt ? [sr / cnt, sg / cnt, sb / cnt] : null;
  self.postMessage({ type: 'result', id: m.id, markers: out, light, cand: k + rej.size(), ms: performance.now() - t0, buf: m.buf }, [m.buf]);
}
