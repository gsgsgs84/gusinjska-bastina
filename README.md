# Gusinjska kulturna baština

A 3D museum in your hand: buildings and objects of Gusinje and Prokletije that you can turn on screen, hold on a printed AR cube, or place at real size in the room. It is a static web app (no install, no server), in Montenegrin, Albanian and English.

## Pages
- `index.html`: the museum. Hash routes:
  - `#/` home
  - `#/g/<gallery>` a gallery
  - `#/e/<exhibit>` an exhibit (3D viewer, object card, *On the cube*, *In your room*, *Showcase*, *Share*)
  - `#/vitrina` the showcase, up to 6 exhibits, one per side of the cube
  - `#/kocka` how to get the cube
- `kocka.html`: *Muzej na kocki*, the AR cube (see below).
  - `?id=<exhibit>` starts with that exhibit (the whole collection can still be browsed).
  - `?ids=a,b,c` is the showcase: the side of the cube that points up chooses the exhibit.
  - `?place=hand|top`, `?lang=me|sq|en`, `?debug` (tracking details), `?det=own` (no OpenCV), `?fov=<deg>` (fix the camera angle).
- `kocka-stara.html`: the previous cube page (v0.x), kept for comparison; linked at the bottom of the new page's settings.
- QR codes for physical labels point at `…/#/e/<exhibit>`.
- `staze.html`: hiking trails around Gusinje in 3D, and in AR on a printed map or in front of you (see below).
- `soba-test.html`: room test for the *Mladina sehara* escape room (see below).
- `mace.html`: *Gdje su mace?*, a hide-and-seek game with kittens in your own room (see below). `?demo` opens the test room, `?debug` shows tracking details, points and occluders.

## Muzej na kocki (`kocka.html`, v2)
The exhibit stands on the printed cube in the phone's own browser: Safari on iPhone and Chrome on Android, no app and no WebXR. Code in `js/kocka/`, styles in `css/ar-kocka.css`.
- **Tracking:** each camera frame is drawn into one of two buffers; markers are found by OpenCV's ArUco detector (`js/kocka/cv-worker.js`, OpenCV.js 5 WebAssembly in a background worker, `js/vendor/opencv/opencv.js`, 13 MB, about 3.7 MB downloaded the first time); the cube's pose is solved on the page from all visible markers (`js/cv/tracker.js` `solveAll`, `js/cv/pose.js`) and smoothed (One Euro). The frame and the pose found in it are shown together, so the exhibit never lags behind the picture. While OpenCV loads, or if it cannot load or stops answering, the museum's own detector (`js/cv/detector.js`) runs on the page. Search: the whole picture and a sharper centre crop in turn; once found, only the area around the cube at higher resolution. Mirror flips of one face are only accepted when the next frame agrees; poses are judged relative to the cube's size on screen (a paper cube is a little off-square).
- **Camera** (`js/kocka/camera.js`): 4:3 sensor picture at 1×, continuous focus. The camera's field of view is learned from the cube whenever two faces are in view (`js/cv/calib.js`, from Gusinjska kocka) and saved per camera. If the browser opened a lens narrower than 40° (Chrome on the user's Android opened the telephoto), the next back camera is tried by itself; a lens picked by hand stops the search. On iPhone the plain "Back Camera" is preferred over the virtual dual/triple cameras, which switch lenses by themselves near the cube. If the picture stops (Safari pauses videos; a call or the app switcher ends the camera), the page says so and a tap restarts it; coming back to the page restarts it by itself. In-app browsers (Instagram, Facebook, …) get a note to open the page in Safari/Chrome (and an *Open in Chrome* link on Android).
- **Scene** (`js/kocka/stage.js`, three.js r184): a pedestal covers the cube (limestone, marble, wood or none) with a dark top slab on whichever side points up (tilt sensor) and a brass name plate on the side facing you (it sinks into the stone and comes out on the other side when you walk around). Optional glass case. The exhibit rises out of the slab with a ring of light (a clipping plane moving up). Light follows the room: the camera picture's average brightness and colour set the strength and tint of the lights. Soft shadow plus a contact shadow. *In hand* puts the exhibit in place of the cube.
- **Interface:** start screen with the exhibit turning on its pedestal (drag to turn it); camera view with the collection by gallery (swipe the label for the next exhibit), story sheet, settings, help, and a photo of the scene with the exhibit's name (share or save). Drag on the picture turns the exhibit, two fingers enlarge it, a double tap resets, a tap on the exhibit opens its story. ME / SQ / EN (`js/kocka/strings.js`; Albanian to be checked by a native speaker).
- **Look:** jelek velvet, undyed wool, the madder and indigo of a Gusinje kilim (the woven band is also the loading bar), zlatovez gold. Fonts: Marcellus and Golos Text (SIL OFL, `css/fonts/`, latin subsets as WOFF).
- **Tests:** `python3 -I tools/tests/cube_video.py OUT.y4m [--fov 23] [--light 0.4 --noise 8] [--dist 1.5]` renders a hand-held cube video with the frame number stamped in the corner and the true pose of every frame; `node tools/tests/kocka2.cjs OUTDIR OUT.y4m "?id=dzezva" 14` runs the page in Chromium on it and logs every tracked frame (`TOUR=1` / `SHEETS=1` take screenshots, `BLOCK_OPENCV=1` tests the fallback); `python3 -I tools/tests/kocka2_report.py OUT.json OUTDIR/log.json` compares the shown poses with the truth.

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
- **AR** (*Pokreni AR / Nis AR / Start AR*; offered automatically on phones, or open `staze.html#ar` / `staze.html?ar=1`). Our own camera AR on three.js (`js/staze-ar.js`), the same in Safari on iPhone and Chrome on Android, with no app and no Google AR services:
  - **On the printed AR map** (`print/staze/AR_mapa_staze_A4.pdf`, `…_A3.pdf`): 8 ArUco markers (MIP_36h12, ids 53 56 59 61 71 73 81 93, layout in `data/staze-mapa.json`) in the dark bands above and below the map give its exact position. The relief rises out of the paper exactly over the printed map and stays on it while you walk around, lean in or tilt the phone; tap a trail on it. Any print size works (only the proportions matter).
  - **In front of you** (*Nemam mapu – prikaži ispred mene*): without a print the relief floats in front of you and the motion sensors keep it in place while you turn the phone (you can't walk around it). Drag to turn it, pinch to resize, double-tap to bring it back; an arrow points to it when it is out of view. *Ispred mene / Na mapu* switches between the two.
  - How it tracks: the markers are searched in a background thread (`js/staze-ar-worker.js` → `js/staze-ar-track.js`, the detector and pose solver from `js/cv/`, plus a half-size second try for blurred frames). The gyroscope (`deviceorientation`) is fused with the marker pose: turning the phone is followed at once, the map's position is smoothed in the room rather than on the screen (so the tall peaks don't shake), and when the map leaves the view the relief stays where it was (*Mapa nije u kadru*). Without motion sensors it follows the markers only. The camera's focal length is measured from the tilted map itself and remembered per camera (`localStorage` `gkb.staze.ar.f`), so the 3D matches on every phone. `?debug` (or *Još → Detalji praćenja*) shows the markers and numbers; `?nogyro` turns the gyroscope off.
  - *Još / More*: another back camera (if the browser picked a zoomed-in lens), *Room AR* = WebXR where Chrome has Google's AR services (in front of you or *On a table*, walk around it), Quick Look on iPhone (Apple's AR viewer with `teren_ar.glb`), the map PDFs, tracking details. If the camera can't start (blocked, opened inside another app): a sheet with *Open in Chrome / Safari*, the other ways and the cube (`kocka.html?id=staze-teren`).
  - Rebuild the map print: `python3 tools/trails/ar_map.py && node tools/trails/ar_map_pdf.cjs` (marker ids are picked to differ by at least 13 bits from every other code printed for this project; the page thumbnail is made too).
  - Tests: `python3 tools/tests/staze_ar_synth.py random DIR 400` + `node tools/tests/staze_ar_track.mjs DIR [--trueK]` (tracker accuracy on synthetic phone frames with blur, noise, light, hands); `python3 tools/tests/staze_ar_synth.py path DIR` + `node tools/tests/staze_ar_e2e.cjs DIR OUT gyro|nogyro|free` (whole page with a simulated camera and gyroscope, overlay compared with the true map position).
- `models/staze/teren_ar.glb`: one self-contained real-size model (60 cm wide, heights ×1.5) with the trails as tubes and the place names on small two-sided signs (about 97k triangles, 9 materials, 2.8 MB), used by Quick Look. It is also the museum exhibit `staze-teren` (gallery *Priroda i staze*), so it works on the AR cube and with the museum's *In your room*.
- **Height** button: vertical exaggeration ×1, ×1.5 (default), ×2, ×3.

Files: `models/staze/teren.glb` (terrain block with a painted map texture), `data/staze.json` (trails, places, credits), `data/staze-mapa.json` (AR map markers), `js/staze.js`, `js/staze-ar.js`, `js/staze-ar-track.js`, `js/staze-ar-worker.js`, `css/staze.css`, `print/staze/`.

Rebuilding: the raw inputs live on the `trails-data` branch (`data-raw/`: Copernicus GLO-30 elevation, GPX files, an OpenStreetMap extract). Its GitHub Action downloads them; run it again from the Actions tab to refresh. Then:
```
git worktree add ../trails-data trails-data
python3 tools/trails/build_relief.py ../trails-data/data-raw
```
Which trails, names, colours and labelled places are used is set in `tools/trails/trails_config.json`. Tracks marked `match_osm` are replaced by the OpenStreetMap ways they follow when at least 85 % of their length is mapped.

Data rights: OpenStreetMap (ODbL) and Copernicus DEM (free with credit) are credited on the page. The "Tri vrha" loop still uses a track from peaksofthebalkans.info (all rights reserved) because only half of it is mapped in OpenStreetMap; ask them, record our own track, or map the missing paths before a public launch.

## Kitten game (`mace.html`)
*Gdje su mace? / Ku janë macet? / Where are the kittens?* Nine kittens hide around the player's real room: 5 white ones sit still, 3 grey ones keep walking, and 1 black one comes out after the white ones are found, dashes between hiding places and runs away from a fast-moving phone.
- **Room tracking:** the 8th Wall XR Engine (`external/xr/`), so it works without Google's AR services and on iPhone Safari. `enableWorldPoints` gives the tracked feature points.
- **Scan:** after tracking starts, the player sweeps the phone around the room. The game keeps every tracked point (by id) and the camera path, until about 650 points and 5 of 12 directions are covered (*Sakrij mace* is allowed earlier).
- **Hiding spots** (`js/mace-room.js`, plain JS, no three.js): floor height from the lowest dense layer of points; 10 cm voxels; flat layers with free space above (*on* a table or seat, *high* on a shelf or cupboard); floor next to things (*beside*); floor under a flat surface where floor points were seen (*under*); spots mostly hidden from where the player stood (*behind*). Walls and corners are rejected as surfaces, cats are nudged off nearby points, and a spot nobody could see from the scan path is dropped. Grey cats get walking loops found by a grid search on free floor; the black cat gets four resting places far apart.
- **Hiding behind real things:** every occupied voxel becomes an invisible depth-only box around its own points, stretched to the voxel side where the neighbour is occupied too (so a table top is a thin slab and a wall a thin sheet). The same boxes decide in code whether a cat can be seen. On a phone without depth sensing this is approximate: edges can be a few centimetres off.
- **Catching:** the cat-head reticle in the middle fills in the cat's colour while it is on a visible part of a cat: white 1 s, grey 2 s in total (it drains slowly when the cat slips away), black 1.5 s and only while the phone moves slowly. A fast phone within 2.6 m of the black cat makes her bolt; the reticle's eyes look where she ran. *Riba* (fish) lands where the reticle points and she comes to eat for 7 s. *Mjau* plays a meow from the nearest cat you cannot see yet (3D sound).
- **Test room:** on a computer (or `?demo`) the same game runs in a furnished room (`js/mace-demo.js`) that produces tracked-like points for the same hiding-spot code. Mouse drag to look, W A S D to walk, Q / E down and up; on touch, one finger looks and two fingers walk.
- Cats are built from simple shapes in `js/mace-cat.js` (poses: sit, loaf, sleep, peek, walk, run, happy); sounds are synthesised in `js/mace-sound.js`. Best time is kept in `localStorage` (`gkb.mace.best`).

## QR codes
`print/qr/staze_android.png` and `print/qr/staze_windows.png` (made by `tools/qr/make_qr.py`, Xplore Prokletije mark in the middle, error correction H, each decoded again as a check):
- **Android** → `staze.html?ar=1`: opens with the AR prompt (works on iPhone too); if it opens inside another app's built-in browser, which gives pages no camera, it first offers to reopen it in Chrome or Safari.
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
- AR cube: `js/cv/` holds the museum's own marker detector and the pose solver (ArUco MIP_36h12, 2×2 markers per face); `kocka.html` uses OpenCV.js for detection (see *Muzej na kocki*). Layout is in `data/layout.json`; print files are in `print/`.
- Offline: `sw.js` caches the app shell, plus each model and thumbnail once it has been opened.

## Tests (tools/tests)
- `ui.cjs` screenshots every page.
- `e2e_cube.cjs` runs the cube page in Chromium with a fake camera video.
- `mace.cjs` plays the kitten game in the test room (each white cat, the grey ones, the black cat's bolt, the fish, the win card).
- `mace_video.cjs` films the test room as a phone video (`mace_film.html`), feeds it to Chromium as the camera, with matching motion-sensor events, and runs the real room-tracking engine: tracking, scan, hiding spots and cats over the picture.

Third-party code: three.js (MIT); OpenCV.js 5 in `js/vendor/opencv/` (Apache 2.0, WebAssembly build from TechStark/opencv-js, licence next to it); fonts Marcellus and Golos Text in `css/fonts/` (SIL Open Font License); the 8th Wall XR Engine in `external/xr/` (© 2026 Niantic Spatial, Inc., used unmodified under the XR Engine License Agreement in `external/xr/LICENSE`, provided without warranty; it is credited with a "powered by 8th Wall" mark in AR on the kitten page; update it by copying `dist/` of the npm package `@8thwall/engine-binary`); the marker contour code is adapted from js-aruco / js-aruco2 (MIT, `js/cv/LICENSE-js-aruco.txt`).
