"""Compare the poses the page showed with the truth from tools/tests/cube_video.py.

python3 -I tools/tests/kocka2_report.py VIDEO.json LOG.json
Prints: frames tracked, rotation error (deg) and position error (mm) of the raw and smoothed pose,
the learned field of view, and the reprojection error of the cube's corners in pixels (what you see).
"""
import json, sys, math
import numpy as np

gt = json.load(open(sys.argv[1])); log = json.load(open(sys.argv[2]))
K = gt['K']; fx = K['fx']
S = 70.0
corners = np.array([[x, y, z] for x in (-S / 2, S / 2) for y in (-S / 2, S / 2) for z in (-S / 2, S / 2)])


def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def proj(R, t, f):
    P = (R @ corners.T).T + t
    return np.stack([f * P[:, 0] / P[:, 2], f * P[:, 1] / P[:, 2]], 1)


rows = []
for e in log:
    k = e['code']
    if k >= len(gt['frames']) or not e.get('R'): continue
    Rg = np.array(gt['frames'][k]['R']).reshape(3, 3); tg = np.array(gt['frames'][k]['t'])
    R = np.array(e['R']).reshape(3, 3); t = np.array(e['t'])
    ang = math.degrees(math.acos(max(-1, min(1, (np.trace(R.T @ Rg) - 1) / 2))))
    f_page = (max(gt['W'], gt['H']) / 2) / math.tan(math.radians(e['fov'] / 2))
    rp = np.abs(proj(R, t, f_page) - proj(Rg, tg, fx)).max()
    row = {'k': k, 'rot': ang, 'pos': float(np.linalg.norm(t - tg)), 'z': float(t[2] - tg[2]), 'px': float(rp), 'fov': e['fov']}
    if e.get('q'):
        Rf = qmat(e['q']); tf = np.array(e['tf'])
        row['rot_f'] = math.degrees(math.acos(max(-1, min(1, (np.trace(Rf.T @ Rg) - 1) / 2))))
        row['px_f'] = float(np.abs(proj(Rf, tf, f_page) - proj(Rg, tg, fx)).max())
    rows.append(row)

n = len(log); found = sum(1 for e in log if e.get('active'))
print(f'results {n}, with cube {found} ({100 * found / max(1, n):.0f} %), checked against truth {len(rows)}')
if rows:
    med = lambda k: float(np.median([r[k] for r in rows if k in r]))
    p95 = lambda k: float(np.percentile([r[k] for r in rows if k in r], 95))
    print(f"raw pose:      rotation {med('rot'):.2f} deg (95 % {p95('rot'):.2f}), position {med('pos'):.1f} mm (95 % {p95('pos'):.1f}), corners {med('px'):.1f} px (95 % {p95('px'):.1f})")
    if any('rot_f' in r for r in rows):
        print(f"shown (smoothed): rotation {med('rot_f'):.2f} deg (95 % {p95('rot_f'):.2f}), corners {med('px_f'):.1f} px (95 % {p95('px_f'):.1f})")
    print(f"field of view: true {gt['fov']:.1f}, page first {rows[0]['fov']:.1f}, last {rows[-1]['fov']:.1f}")
    worst = sorted(rows, key=lambda r: -r['px'])[:3]
    print('worst frames:', ', '.join(f"#{r['k']} {r['px']:.1f}px {r['rot']:.1f}deg" for r in worst))
