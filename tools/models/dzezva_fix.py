"""Fix the džezva model (models/dzezva.glb) as the user asked on 7 Nov 2026:
1) a pouring spout (kljun): the rim is pulled out into a pointed lip, on the left of the pot when you look
   from the handle (as on the user's own džezva, about 100 deg from the handle);
2) the round knob at the end of the handle is removed: the knob is flattened to the bar's own thickness,
   so the flat handle simply ends in a rounded tip.

python3 tools/models/dzezva_fix.py RAW_IN.glb RAW_OUT.glb [spout_amount] [spout_halfwidth_deg] [spout_angle_deg]
RAW_IN is the uncompressed original model (gltfpack -i dzezva.glb -o raw.glb -noq, from the commit before this fix);
then gltfpack -i RAW_OUT.glb -o models/dzezva.glb -noq -cc. Defaults: 0.085, 34 deg, 100 deg.
"""
import sys, math
import numpy as np
from scipy.spatial import cKDTree
import glbio

src, dst = sys.argv[1], sys.argv[2]
A = float(sys.argv[3]) if len(sys.argv) > 3 else 0.085         # how far the lip tip comes out (model units; rim radius 0.245)
WDEG = float(sys.argv[4]) if len(sys.argv) > 4 else 34.0       # half-width of the spout around the rim
ANG = float(sys.argv[5]) if len(sys.argv) > 5 else 100.0       # spout direction, degrees from the handle
j, m, images = glbio.read(src)
P = m['POSITION'].astype(np.float64)
P0 = P.copy()
F = m['indices']

# ---------------- 1) spout ----------------
C = np.array([-0.5135, 0.0, -0.0005])           # pot axis (vertical), measured at the rim
Y0, Y1 = 0.165, 0.33                             # collar: from the start of the flare to the rim
d = P - C
r = np.hypot(d[:, 0], d[:, 2])
az = np.arctan2(d[:, 2], d[:, 0])                # 0 = towards the handle (+x)
th = math.radians(ANG)                           # +z side = left, looking from the handle towards the pot
s = np.array([math.cos(th), 0.0, math.sin(th)])  # spout direction
dth = np.angle(np.exp(1j * (az - th)))
w = math.radians(WDEG)
f = np.clip(1 - np.abs(dth) / w, 0, 1) ** 2      # pointed in top view
g = np.clip((P[:, 1] - Y0) / (Y1 - Y0), 0, 1) ** 2
k = (r < 0.32) & (P[:, 1] > Y0) & (f > 0)
amt = (A * f * g)[k]
P[k] += amt[:, None] * s[None, :]
P[k, 1] -= 0.35 * amt                             # the lip dips a little as it comes out
print('spout: moved', int(k.sum()), 'vertices, max', round(float(amt.max()), 4))

# ---------------- 2) knob at the end of the handle ----------------
c0 = np.array([3.3758408e-01, 4.5145708e-01, -1.3161960e-04])
ax = np.array([0.9075088, 0.42001703, 0.00368011]); ax /= np.linalg.norm(ax)
zz = np.array([0, 0, 1.0]); nn = np.cross(zz, ax); nn /= np.linalg.norm(nn); zz = np.cross(ax, nn)
dh = P - c0
t = dh @ ax; on = dh @ nn; oz = dh @ zz
handle = (P[:, 0] > -0.2) & (P[:, 1] > 0.12) & (np.abs(oz) < 0.09) & (np.abs(on) < 0.09)
# the flat bar just before the knob (between the last slot and the knob)
bar = handle & (t > 0.46) & (t < 0.545)
cb = (on[bar].max() + on[bar].min()) / 2; hb = (on[bar].max() - on[bar].min()) / 2
print('bar: centre', round(float(cb), 4), 'half thickness', round(float(hb), 4))
# slice the knob off above and below the bar's own faces: what sticks out is pressed onto the bar's top and
# bottom planes, the knob's middle band stays as the rounded edge, so the bar ends in a flat rounded tip
knob = handle & (t > 0.548)
newn = np.clip(on, cb - hb, cb + hb)
P[knob] += ((newn - on)[knob])[:, None] * nn[None, :]
print('knob: moved', int((np.abs(newn - on)[knob] > 1e-7).sum()), 'vertices; thickness now', round(float(newn[knob].max() - newn[knob].min()), 4), 'was', round(float(on[knob].max() - on[knob].min()), 4))

# ---------------- normals and tangents where the shape changed ----------------
moved = np.linalg.norm(P - P0, axis=1) > 1e-7
# weld by position so UV seams don't show as shading seams
key = np.round(P0 / 1e-5).astype(np.int64)
_, weld = np.unique(key, axis=0, return_inverse=True)
weld = weld.reshape(-1)
fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])          # area-weighted face normals
acc = np.zeros((weld.max() + 1, 3))
for c in range(3): np.add.at(acc, weld[F[:, c]], fn)
newN = acc[weld]; newN /= np.maximum(np.linalg.norm(newN, axis=1, keepdims=True), 1e-12)
# only replace normals of moved vertices and their direct neighbours (keep the rest exactly as it was)
touch = np.zeros(len(P), bool); touch[moved] = True
fm = touch[F].any(1)
near = np.zeros(len(P), bool); near[F[fm].reshape(-1)] = True
near_w = np.zeros(weld.max() + 1, bool); near_w[weld[near]] = True; near = near_w[weld]
N = m['NORMAL'].astype(np.float64)
# keep the sign convention of the original normals (Meshy surfaces are outward)
flip = np.sum(newN[near] * N[near], 1) < -0.2
print('normals replaced', int(near.sum()), 'opposite before', int(flip.sum()))
N[near] = newN[near]
m['NORMAL'] = N.astype(np.float32)
if 'TANGENT' in m:
    Tg = m['TANGENT'].astype(np.float64)
    tv = Tg[:, :3] - np.sum(Tg[:, :3] * N, 1, keepdims=True) * N
    ok = np.linalg.norm(tv, axis=1) > 1e-6
    tv[ok] /= np.linalg.norm(tv[ok], axis=1, keepdims=True)
    Tg[near & ok, :3] = tv[near & ok]
    m['TANGENT'] = Tg.astype(np.float32)
m['POSITION'] = P.astype(np.float32)
glbio.write(dst, j, m, images)
print('written', dst)
