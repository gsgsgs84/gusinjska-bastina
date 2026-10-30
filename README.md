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
- `staze.html`: hiking trails around Gusinje in 3D, also in AR in front of you (see below).

## Hiking trails (`staze.html`)
A 3D relief of the Gusinje area (19.74–19.95 E, 42.45–42.60 N, about 17 × 17 km) with 18 hiking and cycling routes.
- **Touch viewer:** drag to turn, pinch to zoom, tap a trail (on the terrain or in the list) for its card, elevation profile and a walking marker. `staze.html#<trail-id>` opens a trail directly, e.g. for a QR code.
- **AR in front of me** (big button; offered automatically on phones, or open `staze.html#ar`): the terrain appears about a metre in front of you, a little below eye level, sized to fit the view.
  - Android Chrome with Google Play Services for AR: WebXR (`immersive-ar`, optional hit-test and dom-overlay). Walk around it, drag across the screen to turn it, tap a trail to select it, ± to resize (30–150 cm, scale shown), *On a table* puts it down on a real surface.
  - Other phones, including iPhone: the camera picture is shown behind the 3D and the motion sensors keep the terrain in front of you as you turn the phone (rotation only, no walking around). Without a motion sensor, drag to turn it. On iPhone a *Quick Look* button opens Apple's world-tracked AR (terrain and trails, no names).
- **Height** button: vertical exaggeration ×1, ×1.5 (default), ×2.

Files: `models/staze/teren.glb` (terrain block with a painted map texture), `data/staze.json` (trails, places, credits), `js/staze.js`, `css/staze.css`.

Rebuilding: the raw inputs live on the `trails-data` branch (`data-raw/`: Copernicus GLO-30 elevation, GPX files, an OpenStreetMap extract). Its GitHub Action downloads them; run it again from the Actions tab to refresh. Then:
```
git worktree add ../trails-data trails-data
python3 tools/trails/build_relief.py ../trails-data/data-raw
```
Which trails, names, colours and labelled places are used is set in `tools/trails/trails_config.json`. Tracks marked `match_osm` are replaced by the OpenStreetMap ways they follow when at least 85 % of their length is mapped.

Data rights: OpenStreetMap (ODbL) and Copernicus DEM (free with credit) are credited on the page. The "Tri vrha" loop still uses a track from peaksofthebalkans.info (all rights reserved) because only half of it is mapped in OpenStreetMap; ask them, record our own track, or map the missing paths before a public launch.

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
