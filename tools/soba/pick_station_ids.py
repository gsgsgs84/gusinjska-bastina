"""Pick ArUco MIP_36h12 ids for the escape-room station cards (Mladina sehara).

6 stations x 3 test sizes = 18 ids. They must stay as far as possible (bit distance over all
rotations) from each other and from the 28 ids already used by the AR cube and the table card,
be clearly different from their own rotations, and have a balanced number of white cells.
Writes tools/soba/station_ids.json.  Run: python3 tools/soba/pick_station_ids.py
"""
import json, random
import cv2
import numpy as np

N_PICK = 18
d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_ARUCO_MIP_36h12)
N = d.bytesList.shape[0]
codes = np.array([(cv2.aruco.generateImageMarker(d, i, 8) >= 128).astype(int)[1:7, 1:7] for i in range(N)])  # 1 = white
flat = codes.reshape(N, -1)
rflat = np.stack([np.rot90(codes, k, axes=(1, 2)) for k in range(4)], 1).reshape(N, 4, -1)
D = np.array([(rflat != flat[i][None, None]).sum(-1).min(1) for i in range(N)])
np.fill_diagonal(D, 99)
selfrot = np.array([min((rflat[i, k] != flat[i]).sum() for k in (1, 2, 3)) for i in range(N)])
white = flat.sum(1)

lay = json.load(open('data/layout.json'))
used = [m['id'] for m in lay['markers']] + [m['id'] for m in lay['card']['markers']]
ok = [c for c in range(N) if c not in used and selfrot[c] >= 14 and abs(white[c] - 18) <= 4]


def score(sel):
    a = D[np.ix_(sel, sel)].min()
    b = D[np.ix_(sel, used)].min()
    m = min(a, b)
    return (m, a, -int((D[np.ix_(sel, sel + used)] == m).sum()))


best = None
rng = random.Random(7)
for trial in range(150):
    sel = [rng.choice(ok)]
    while len(sel) < N_PICK:
        rest = [c for c in ok if c not in sel]
        sel.append(max(rest, key=lambda c: (min(D[c, sel].min(), D[c, used].min()), -abs(white[c] - 18), rng.random())))
    s0 = score(sel)
    improved = True
    while improved:
        improved = False
        for a in range(N_PICK):
            for c in ok:
                if c in sel:
                    continue
                t = sel.copy(); t[a] = c
                s1 = score(t)
                if s1 > s0:
                    sel, s0, improved = t, s1, True
    if best is None or s0 > best[0]:
        best = (s0, sel)

(s, sel) = best
print('min distance to cube/card and each other:', s[0], ' among themselves:', s[1])
print('ids', sel)
json.dump({'dictionary': 'ARUCO_MIP_36h12', 'ids': [int(i) for i in sel],
           'min_distance': int(s[0]), 'min_distance_among': int(s[1]),
           'self_rotation': [int(selfrot[i]) for i in sel], 'white_cells': [int(white[i]) for i in sel]},
          open('tools/soba/station_ids.json', 'w'), indent=1)
