"""Placeholder exhibits (clearly marked as such): copper ewer (ibrik) and a low round table (sofra). Metres, Y up, front +Z."""
import sys, math
import numpy as np
sys.path.insert(0, sys.path[0])
from glb import Mesh, write_glb, srgb2lin

SEG = 64
def lathe(m, prof, col, smooth=True):
    """Revolve a profile traced bottom-centre -> outwards -> up -> top-centre (outward normals)."""
    prof = np.asarray(prof, float)
    th = np.linspace(0, 2 * math.pi, SEG + 1)
    def ring(pr, n2):
        P = np.zeros((len(pr), SEG + 1, 3)); N = np.zeros_like(P)
        P[..., 0] = pr[:, 0, None] * np.sin(th); P[..., 1] = pr[:, 1, None]; P[..., 2] = pr[:, 0, None] * np.cos(th)
        N[..., 0] = n2[:, 0, None] * np.sin(th); N[..., 1] = n2[:, 1, None]; N[..., 2] = n2[:, 0, None] * np.cos(th)
        m.grid(P, N, np.asarray(col))
    if smooth:
        d = np.gradient(prof, axis=0)
        n2 = np.stack([d[:, 1], -d[:, 0]], 1); n2 /= np.linalg.norm(n2, axis=1)[:, None] + 1e-12
        ring(prof, n2)
    else:
        for a, b in zip(prof[:-1], prof[1:]):
            d = b - a; n = np.array([d[1], -d[0]]); n /= np.linalg.norm(n)
            ring(np.array([a, b]), np.array([n, n]))

def tube(m, path, radii, col, ring=24):
    path = np.asarray(path, float); T = np.gradient(path, axis=0); T /= np.linalg.norm(T, axis=1)[:, None]
    up = np.array([0, 1, 0.]) if abs(T[0, 1]) < 0.9 else np.array([1, 0, 0.])
    P = np.zeros((len(path), ring + 1, 3)); N = np.zeros_like(P)
    nprev = np.cross(T[0], up); nprev /= np.linalg.norm(nprev)
    th = np.linspace(0, 2 * math.pi, ring + 1)
    for i in range(len(path)):
        n = nprev - T[i] * (nprev @ T[i]); n /= np.linalg.norm(n); b = np.cross(T[i], n); nprev = n
        dirs = np.cos(th)[:, None] * n + np.sin(th)[:, None] * b
        P[i] = path[i] + radii[i] * dirs; N[i] = dirs
    m.grid(P, N, np.asarray(col))

def ibrik(path):
    m = Mesh(); cu = srgb2lin((184, 104, 62))
    prof = [(0.0, 0.0), (0.055, 0.0), (0.06, 0.006), (0.058, 0.02), (0.07, 0.05), (0.095, 0.10), (0.105, 0.14), (0.098, 0.18), (0.07, 0.22),
            (0.045, 0.25), (0.035, 0.28), (0.034, 0.31), (0.042, 0.33), (0.048, 0.345), (0.0485, 0.35)]
    lathe(m, prof, cu)
    lid = [(0.0485, 0.35), (0.046, 0.358), (0.03, 0.368), (0.012, 0.372), (0.011, 0.378), (0.016, 0.386), (0.012, 0.395), (0.0, 0.398)]
    lathe(m, lid, cu * 0.9)
    t = np.linspace(0, 1, 30)   # spout: from the belly forward and up (+Z)
    a, c, b = np.array([0, 0.13, 0.085]), np.array([0, 0.27, 0.13]), np.array([0, 0.33, 0.20])
    sp = (1 - t)[:, None] ** 2 * a + 2 * ((1 - t) * t)[:, None] * c + (t ** 2)[:, None] * b
    tube(m, sp, 0.016 - 0.009 * t, cu * 0.95)
    t = np.linspace(0, 1, 36)   # handle at the back (-Z)
    hp = np.stack([np.zeros_like(t), 0.30 - 0.17 * t, -(0.04 + 0.085 * np.sin(np.pi * t) + 0.04 * t)], 1)
    tube(m, hp, np.full(len(t), 0.007), cu * 0.85)
    P, N, I, C = m.done()
    write_glb(path, P, N, I, C, "Ibrik", metal=0.85, rough=0.38)
    return P

def sofra(path):
    m = Mesh(); wood = srgb2lin((128, 82, 50))
    R = 0.43
    outline = [(0.0, 0.27), (0.285, 0.27), (0.285, 0.0), (0.30, 0.0), (0.30, 0.27), (R - 0.01, 0.27), (R, 0.276),
               (R, 0.29), (R - 0.01, 0.298), (R - 0.03, 0.30), (0.0, 0.30)]
    lathe(m, outline, wood, smooth=False)
    P, N, I, C = m.done()
    # simple carved arches on the ring: darken vertices? keep plain
    write_glb(path, P, N, I, C, "Sofra", metal=0.0, rough=0.7)
    return P

if __name__ == "__main__":
    out = sys.argv[1]
    for name, fn in (("ibrik", ibrik), ("sofra", sofra)):
        P = fn(f"{out}/{name}.glb")
        print(name, "bbox", P.min(0).round(3), P.max(0).round(3))
