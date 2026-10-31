"""Check the printed test cards: every marker is found by OpenCV, on the right page, at the right size.

Run: python3 tools/soba/check_pdf.py   (renders print/soba/mladina_sehara_test_kartice.pdf at 300 dpi)
"""
import json, os, subprocess, tempfile
import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PDF = os.path.join(ROOT, 'print', 'soba', 'mladina_sehara_test_kartice.pdf')
data = json.load(open(os.path.join(ROOT, 'data', 'soba.json'), encoding='utf-8'))
DPI = 300
expect = {}                       # id -> (page, size mm)
for n, st in enumerate(data['stations']):
    expect[st['markers']['S']] = (2 + n // 4, 60)
    expect[st['markers']['M']] = (4 + n // 2, 90)
    expect[st['markers']['L']] = (7 + n, 120)

d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_ARUCO_MIP_36h12)
params = cv2.aruco.DetectorParameters()
params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
det = cv2.aruco.ArucoDetector(d, params)
found, problems = {}, []
with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['pdftoppm', '-r', str(DPI), '-gray', '-png', PDF, os.path.join(tmp, 'p')], check=True)
    for f in sorted(os.listdir(tmp)):
        page = int(f.split('-')[1].split('.')[0])
        img = cv2.imread(os.path.join(tmp, f), cv2.IMREAD_GRAYSCALE)
        corners, ids, _ = det.detectMarkers(img)
        for c, i in zip(corners, (ids.flatten() if ids is not None else [])):
            q = c.reshape(4, 2)
            side = np.mean([np.linalg.norm(q[k] - q[(k + 1) % 4]) for k in range(4)]) / DPI * 25.4
            found.setdefault(int(i), []).append((page, side))
for i, (page, mm) in sorted(expect.items()):
    hits = found.get(i, [])
    ok = [h for h in hits if h[0] == page and abs(h[1] - mm) < 0.4]
    if len(hits) != 1 or not ok:
        problems.append(f'id {i}: expected page {page} at {mm} mm, found {hits}')
    else:
        print(f'id {i:3d}  page {page:2d}  {ok[0][1]:6.2f} mm  (expected {mm})')
extra = {i: h for i, h in found.items() if i not in expect}
if extra:
    problems.append(f'unexpected markers: {extra}')
print('PROBLEMS:\n' + '\n'.join(problems) if problems else f'all {len(expect)} markers found once, right page, right size; no extra markers')
raise SystemExit(1 if problems else 0)
