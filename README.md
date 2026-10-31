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
- `soba-test.html`: room test for the *Mladina sehara* escape room (see below).

## Mladina sehara escape room: room test (`soba-test.html`)
An AR escape room in the Gusinje ethno room is planned. It uses no room tracking: every station has its own printed card with an ArUco marker (MIP_36h12, the same detector as the AR cube), placed next to its object, plus a 3-digit code to type if the camera fails. Step 0 measures every card spot in the real room before any puzzle is built.
- **Cards:** `print/soba/mladina_sehara_test_kartice.pdf` (A4, print at 100 % on matte paper). Page 1: instructions (ME | EN), 100 mm scale, QR code to the test page, station table. Then all six stations in three sizes: S (60 mm black square, pages 2–3), M (90 mm, 4–6), L (120 mm, 7–12).
- **Stations and ids:** `data/soba.json` (names ME/SQ/EN, codes, marker ids per size, marker cells). Ids picked by `tools/soba/pick_station_ids.py`: at least 14 bits from each other and from the cube and table-card ids.
- **Test page:** the card in view selects itself (station + size). *Testiraj mjesto / Test this spot* measures for about 4 s: time to a fresh recognition, share of frames recognised, longest dropout, distance, size in the picture, angle, light. Verdict: PASS (recognised within 1 s, ≥ 85 % of frames, no dropout over 0.5 s), WEAK (within 3 s, ≥ 50 %), FAIL. *Domet / Range* records how far the card stays recognised while stepping back. The ⌨ button checks the fallback codes. Light condition (morning, day, evening, lamps) and a device name go with every result. *Rezultati / Results* shows an overview per station and size and copies everything as text. Results stay in the browser (localStorage).
- Distances assume a 66° camera angle across the long side (about ±15 % on real phones).
- Rebuild: `python3 tools/soba/build_data.py`, `python3 tools/soba/make_cards.py`, check with `python3 tools/soba/check_pdf.py` (every marker found once, right page, right size).
- Simulation (`tools/soba/synth.py`, `synth_detect.mjs`, `synth_report.py`): the printed cards projected into the room photos with blur, noise, video compression, evening light and shake. End-to-end: `node tools/tests/soba_test.cjs VIDEO.mjpeg OUT spot|range [WxH] [me|en]` with a fake camera.
- Fonts in `tools/soba/fonts/` (Marcellus, Golos Text) are under the SIL Open Font License (licence files next to them).

## Hiking trails (`staze.html`)
A 3D relief of the Gusinje area (19.74–19.95 E, 42.45–42.60 N, about 17 × 17 km) with 18 hiking and cycling routes.
- **Touch viewer:** drag to turn, pinch to zoom, tap a trail (on the terrain or in the list) for its card, elevation profile and a walking marker. `staze.html#<trail-id>` opens a trail directly, e.g. for a QR code.
- **AR in front of me** (big button; offered automatically on phones, or open `staze.html#ar` / `staze.html?ar=1`). It always uses room-tracked AR, so you can walk around the terrain:
  1. Chrome on Android with Google Play Services for AR: WebXR (`immersive-ar`). The terrain appears in front of you at once (45 cm, sized to fit the view); drag across the screen to turn it, tap a trail to select it, ± 30–150 cm, *On a table* puts it on a detected surface.
  2. Every other phone (no Google AR services, iPhone Safari): world tracking from the camera image with the 8th Wall XR Engine (`external/xr/`, see below). Move the phone slowly until it knows the room; the terrain then appears in front of you and stays in place. *On a table* + tap puts it on a tracked point of the table or floor.
  3. If that does not start (`#ar-pomoc`): a sheet with Google's AR viewer (Scene Viewer), Quick Look on iPhone, *Open in Chrome*, *Install Google Play Services for AR*, *On the AR cube or card* (`kocka.html?id=staze-teren`) and *Camera only* (rotation only; you cannot walk around it).
- `models/staze/teren_ar.glb`: one self-contained real-size model (60 cm wide, heights ×1.5) with the trails as tubes and the place names on small two-sided signs, within Scene Viewer's limits (about 97k triangles, 9 materials, 2.8 MB). It is also the museum exhibit `staze-teren` (gallery *Priroda i staze*), so it works on the AR cube and with the museum's *In your room*.
- **Height** button: vertical exaggeration ×1, ×1.5 (default), ×2.

Files: `models/staze/teren.glb` (terrain block with a painted map texture), `data/staze.json` (trails, places, credits), `js/staze.js`, `css/staze.css`.

Rebuilding: the raw inputs live on the `trails-data` branch (`data-raw/`: Copernicus GLO-30 elevation, GPX files, an OpenStreetMap extract). Its GitHub Action downloads them; run it again from the Actions tab to refresh. Then:
```
git worktree add ../trails-data trails-data
python3 tools/trails/build_relief.py ../trails-data/data-raw
```
Which trails, names, colours and labelled places are used is set in `tools/trails/trails_config.json`. Tracks marked `match_osm` are replaced by the OpenStreetMap ways they follow when at least 85 % of their length is mapped.

Data rights: OpenStreetMap (ODbL) and Copernicus DEM (free with credit) are credited on the page. The "Tri vrha" loop still uses a track from peaksofthebalkans.info (all rights reserved) because only half of it is mapped in OpenStreetMap; ask them, record our own track, or map the missing paths before a public launch.

## QR codes
`print/qr/staze_android.png` and `print/qr/staze_windows.png` (made by `tools/qr/make_qr.py`, Xplore Prokletije mark in the middle, error correction H, each decoded again as a check):
- **Android** → `staze.html?ar=1`: opens with the AR prompt; if the phone opens it in another browser (Samsung Internet, an app's built-in browser…), it first offers to reopen it in Chrome.
- **Windows** → `staze.html?pc=1`: the 3D viewer in the browser, without the AR prompt.

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

Third-party code: three.js (MIT); the 8th Wall XR Engine in `external/xr/` (© 2026 Niantic Spatial, Inc., used unmodified under the XR Engine License Agreement in `external/xr/LICENSE`, provided without warranty; it is credited on the trails page and with a "powered by 8th Wall" mark in AR; update it by copying `dist/` of the npm package `@8thwall/engine-binary`); the marker contour code is adapted from js-aruco / js-aruco2 (MIT, `js/cv/LICENSE-js-aruco.txt`).
