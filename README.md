# Gusinjska kulturna baština

A 3D museum in your hand: buildings and objects of Gusinje and Prokletije that you can turn on screen, hold on a printed AR cube, or place at real size in the room. It is a static web app (no install, no server), in Montenegrin, Albanian and English.

## Pages
- `index.html`: the museum. Hash routes:
  - `#/` home
  - `#/g/<gallery>` a gallery
  - `#/e/<exhibit>` an exhibit (3D viewer, object card, *On the cube*, *In your room*, *Showcase*, *Share*)
  - `#/vitrina` the showcase, up to 6 exhibits, one per side of the cube
  - `#/kocka` how to get the cube
- `kocka.html`: the AR cube camera view.
  - `?id=<exhibit>` shows one exhibit.
  - `?ids=a,b,c` is the showcase: the side of the cube that points up chooses the exhibit.
- QR codes for physical labels point at `…/#/e/<exhibit>`.

## Adding an exhibit
1. Put the model in `models/<id>.glb`. Use real height, origin at the bottom, front facing +Z; ideally 2–8 MB.
2. Add an entry to `data/exhibits.json`:
   - `id`, `gallery`, `model`, `thumb`
   - `size.h` (real height in metres)
   - `kind` (`building` or `object`)
   - `name`, `subtitle`, `description`, `facts`, each with `me` and `en` text
3. Make thumbnails: serve the repo on port 8130 and run `node tools/thumbs/make_thumbs.cjs`.
4. Bump `VERSION` in `sw.js` so phones refresh their offline copy.

## How it works
- The 3D viewer uses three.js r184 (vendored in `js/vendor/three`) with OrbitControls.
- *In your room*:
  - Android Chrome: WebXR `immersive-ar` with hit-test. Buildings start as a 1:50 model and can switch to real size.
  - iPhone: AR Quick Look, with a USDZ made on the phone.
- AR cube: `js/cv/` holds the marker detector and pose solver (ArUco MIP_36h12, 2×2 markers per face). Layout is in `data/layout.json`; print files are in `print/`.
- Offline: `sw.js` caches the app shell, plus each model and thumbnail once it has been opened.

## Tests (tools/tests)
- `ui.cjs` screenshots every page.
- `e2e_cube.cjs` runs the cube page in Chromium with a fake camera video.

Third-party code: three.js (MIT); the marker contour code is adapted from js-aruco / js-aruco2 (MIT, `js/cv/LICENSE-js-aruco.txt`).
