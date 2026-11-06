#!/usr/bin/env python3
"""Synthetic phone-camera frames of the printed AR trail map with exact camera poses (for testing js/staze-ar*.js).

The map is flat, so each frame is a perspective warp of the printed page onto a table, plus what a phone camera adds:
defocus and motion blur, noise, uneven light, colour cast, JPEG compression, and sometimes a hand over the markers.

usage:
  python3 tools/tests/staze_ar_synth.py random OUT N [seed]     -> OUT/f0000.jpg ... + OUT/truth.json (random poses)
  python3 tools/tests/staze_ar_synth.py path OUT                -> OUT/p0000.jpg ... + OUT/path.json (stop-and-go walk around)
Frames are portrait 960x1280 (a phone held upright), map frame in metres: x east, y up, z south, origin at map centre.
"""
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
W, H = 960, 1280
DPI = 200
LAY = json.load(open(os.path.join(ROOT, "data", "staze-mapa.json")))
MAP_W, MAP_H = LAY["map"]
# page position of the map centre (mm from the page's top-left), from tools/trails/ar_map.py
MAP_CX, MAP_CY = 105.0, 35.0 + 32.0 + MAP_H / 2


def page_image(out):
    cache = os.path.join(out, "_page.png")
    if not os.path.exists(cache):
        subprocess.run(["pdftoppm", "-r", str(DPI), "-png", "-singlefile", os.path.join(ROOT, "print/staze/AR_mapa_staze_A4.pdf"), cache[:-4]],
                       check=True, stderr=subprocess.DEVNULL)
    return cv2.imread(cache)


def table_texture(rng, w=1600, h=1600):
    """wood-ish table with some clutter (cup, papers, pen) as distractors"""
    base = np.array(rng.choice([[96, 128, 160], [70, 90, 110], [150, 160, 170], [60, 70, 80], [180, 175, 168]]), np.float32)
    y = np.arange(h)[:, None].astype(np.float32)
    x = np.arange(w)[None, :].astype(np.float32)
    grain = np.sin(y / rng.uniform(6, 14) + 3 * np.sin(x / rng.uniform(90, 200))) * rng.uniform(6, 16)
    img = np.clip(base[None, None, :] + grain[..., None] + rng.normal(0, 4, (h, w, 1)), 0, 255).astype(np.uint8)
    for _ in range(rng.integers(2, 6)):        # papers / objects
        c = tuple(int(v) for v in rng.integers(30, 250, 3))
        cx, cy = int(rng.uniform(0, w)), int(rng.uniform(0, h))
        if rng.random() < 0.5:
            r = int(rng.uniform(30, 90)); cv2.circle(img, (cx, cy), r, c, -1); cv2.circle(img, (cx, cy), int(r * 0.7), tuple(int(v * 0.6) for v in c), -1)
        else:
            box = cv2.boxPoints(((cx, cy), (rng.uniform(60, 300), rng.uniform(40, 220)), rng.uniform(0, 180))).astype(np.int32)
            cv2.fillPoly(img, [box], c)
            for k in range(int(rng.integers(0, 8))):      # printed lines on papers
                p0 = box[0] + (box[1] - box[0]) * 0.1 + (box[3] - box[0]) * (0.1 + 0.1 * k)
                p1 = p0 + (box[1] - box[0]) * 0.8
                cv2.line(img, tuple(int(v) for v in p0), tuple(int(v) for v in p1), (40, 40, 40), 2)
    return img


def look_at(C, target, roll_deg=0.0, az=0.0):
    z = target - C; z /= np.linalg.norm(z)
    up = np.array([0, 1, 0.0])
    if abs(z @ up) > 0.985:                    # looking straight down: "up" on screen = away from the viewer's side
        up = np.array([-math.sin(az), 0, -math.cos(az)])
    x = np.cross(z, up); x /= np.linalg.norm(x)
    y = np.cross(z, x)
    R = np.stack([x, y, z])                    # world -> camera (OpenCV: x right, y down, z forward)
    if roll_deg:
        a = math.radians(roll_deg); c, s = math.cos(a), math.sin(a)
        R = np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]]) @ R
    t = -R @ C
    return R, t


def camera_K(fov_long_deg, w=W, h=H):
    f = (max(w, h) / 2) / math.tan(math.radians(fov_long_deg) / 2)
    return np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1.0]])


def render(page, table, R, t, K, rng, opts):
    # page px -> map frame metres (x, z) on y = 0
    ppm = DPI / 25.4 * 1000                   # page pixels per metre
    A = np.array([[1 / ppm, 0, -MAP_CX / 1000], [0, 1 / ppm, -MAP_CY / 1000], [0, 0, 1]])
    P = K @ np.column_stack([R[:, 0], R[:, 2], t])        # (x, z, 1) -> image
    Hp = P @ A
    # table: 1.6 m square texture centred under the map, 1 px = 1 mm
    At = np.array([[1 / 1000, 0, -0.8], [0, 1 / 1000, -0.8], [0, 0, 1]])
    Ht = P @ At
    img = cv2.warpPerspective(table, Ht, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    pg = cv2.warpPerspective(page, Hp, (W, H), flags=cv2.INTER_AREA if opts.get("far") else cv2.INTER_LINEAR)
    mask = cv2.warpPerspective(np.full(page.shape[:2], 255, np.uint8), Hp, (W, H))
    m = (mask.astype(np.float32) / 255)[..., None]
    img = (img * (1 - m) + pg * m)
    # light: gradient + shadow, colour cast, exposure
    g = opts.get("light", 1.0)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    ang = rng.uniform(0, 2 * math.pi)
    grad = 1 + opts.get("grad", 0.25) * ((xx - W / 2) * math.cos(ang) + (yy - H / 2) * math.sin(ang)) / (W / 2)
    vign = 1 - 0.25 * (((xx - W / 2) / W) ** 2 + ((yy - H / 2) / H) ** 2) * 2
    img = img * (g * grad * vign)[..., None]
    if opts.get("shadow"):
        sh = np.zeros((H, W), np.float32)
        cv2.fillPoly(sh, [np.array([[rng.uniform(0, W), 0], [rng.uniform(0, W), H], [W, H], [W, 0]], np.int32)], 1.0)
        sh = cv2.GaussianBlur(sh, (0, 0), 25)
        img = img * (1 - 0.35 * sh[..., None])
    cast = np.array(opts.get("cast", [1, 1, 1]), np.float32)
    img = np.clip(img * cast[None, None, :], 0, 255)
    if opts.get("hand"):                      # a hand / arm reaching over part of the map
        side = rng.integers(0, 4)
        pts = np.array(opts["hand"], np.float32) if isinstance(opts["hand"], list) else None
        if pts is None:
            cx, cy = rng.uniform(0.2, 0.8) * W, rng.uniform(0.2, 0.8) * H
            edge = [(cx, H + 50), (W + 50, cy), (cx, -50), (-50, cy)][side]
            d = np.array([cx - edge[0], cy - edge[1]]); d /= np.linalg.norm(d); n = np.array([-d[1], d[0]])
            wdt = rng.uniform(90, 170)
            pts = np.array([np.array(edge) + n * wdt, np.array(edge) - n * wdt, np.array([cx, cy]) - n * wdt * 0.8, np.array([cx, cy]) + d * wdt * 0.6, np.array([cx, cy]) + n * wdt * 0.8])
        skin = np.array([rng.uniform(120, 170), rng.uniform(150, 190), rng.uniform(190, 230)])
        cv2.fillPoly(img, [pts.astype(np.int32)], tuple(float(v) for v in skin))
    # optics: defocus and motion blur
    if opts.get("defocus", 0) > 0:
        img = cv2.GaussianBlur(img, (0, 0), opts["defocus"])
    mb = opts.get("motion", 0)
    if mb >= 1:
        k = np.zeros((int(mb) * 2 + 1, int(mb) * 2 + 1), np.float32)
        a = rng.uniform(0, math.pi); c = int(mb)
        cv2.line(k, (int(c - mb * math.cos(a)), int(c - mb * math.sin(a))), (int(c + mb * math.cos(a)), int(c + mb * math.sin(a))), 1.0, 1)
        k /= k.sum(); img = cv2.filter2D(img, -1, k)
    img = img + rng.normal(0, opts.get("noise", 3), img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def project(R, t, K, X):
    p = K @ (R @ np.asarray(X, float) + t)
    return p[:2] / p[2]


def pose_from(dist, elev_deg, az_deg, look=(0, 0, 0), roll=0.0, turn=0.0):
    e, a = math.radians(elev_deg), math.radians(az_deg)
    # azimuth 0 = standing at the south edge (z+) looking north
    C = np.array([math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)]) * dist + np.array(look, float)
    R, t = look_at(C, np.array(look, float), roll, a)
    if turn:                                  # turn the phone sideways (about the vertical through the camera)
        c, s = math.cos(math.radians(turn)), math.sin(math.radians(turn))
        Ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
        R = R @ Ry.T; t = -R @ C
    return R, t


def random_set(out, n, seed=1):
    rng = np.random.default_rng(seed)
    os.makedirs(out, exist_ok=True)
    page = page_image(out)
    tables = [table_texture(rng) for _ in range(4)]
    truth = []
    i = 0
    while i < n:
        dist = rng.uniform(0.2, 0.9)
        elev = rng.uniform(28, 90)
        az = rng.uniform(0, 360)
        look = (rng.uniform(-0.06, 0.06), 0, rng.uniform(-0.06, 0.06))
        roll = rng.normal(0, 12)
        fov = float(rng.choice([58, 63, 66, 72, 78]))
        R, t = pose_from(dist, elev, az, look, roll)
        if t[2] <= 0.05: continue
        K = camera_K(fov)
        opts = {"light": rng.uniform(0.45, 1.15), "grad": rng.uniform(0, 0.4), "shadow": rng.random() < 0.3,
                "cast": [rng.uniform(0.85, 1.1), 1, rng.uniform(0.85, 1.15)], "defocus": rng.choice([0, 0, 0.6, 1.0, 1.6]),
                "motion": rng.choice([0, 0, 0, 2, 4, 7]), "noise": rng.uniform(1.5, 7), "hand": rng.random() < 0.2, "far": dist > 0.6}
        img = render(page, tables[i % 4], R, t, K, rng, opts)
        q = int(rng.uniform(55, 92))
        cv2.imwrite(os.path.join(out, f"f{i:04d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, q])
        corners = [project(R, t, K, [sx * MAP_W / 2000, 0, sz * MAP_H / 2000]).tolist() for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        truth.append({"file": f"f{i:04d}.jpg", "R": R.flatten().tolist(), "t": t.tolist(), "fov": fov, "K": [K[0, 0], K[0, 2], K[1, 2]],
                      "dist": dist, "elev": elev, "az": az, "opts": {k: (bool(v) if isinstance(v, (bool, np.bool_)) else float(v)) for k, v in opts.items() if k != "cast"},
                      "jpeg": q, "corners": corners})
        i += 1
    json.dump({"w": W, "h": H, "frames": truth}, open(os.path.join(out, "truth.json"), "w"))


# stop-and-go walk for the browser test: (seconds to move there, seconds to hold, pose)
WALK = [
    (0.0, 3.2, dict(dist=0.46, elev=55, az=0, turn=-125), "table only: map out of view"),
    (1.0, 3.6, dict(dist=0.46, elev=55, az=0, turn=0), "map from the south edge"),
    (1.2, 2.4, dict(dist=0.40, elev=48, az=40), "orbit to the south-east"),
    (1.4, 2.4, dict(dist=0.36, elev=38, az=115, turn=0), "from the east side"),
    (1.2, 2.4, dict(dist=0.20, elev=50, az=120, look=(0.045, 0.01, 0.048)), "lean in close to Zla Kolata"),
    (1.0, 2.6, dict(dist=0.36, elev=38, az=115, turn=80), "turn away: map out of view"),
    (1.0, 2.4, dict(dist=0.42, elev=60, az=200, turn=0), "back: from the south-west"),
    (0.8, 2.4, dict(dist=0.42, elev=60, az=200, hand=True), "a hand over the markers"),
    (1.2, 2.4, dict(dist=0.40, elev=86, az=270), "straight down"),
]


def path_set(out, fps=12, seed=3, fov=63.0):
    rng = np.random.default_rng(seed)
    os.makedirs(out, exist_ok=True)
    page = page_image(out); table = table_texture(np.random.default_rng(7))
    K = camera_K(fov)
    keys = []
    t = 0.0
    for mv, hold, p, note in WALK:
        keys.append({"t0": t, "t1": t + mv, "t2": t + mv + hold, "pose": p, "note": note})
        t += mv + hold
    total = t
    hand_pts = None

    def pose_at(time):
        prev = keys[0]["pose"]
        for k in keys:
            if time < k["t1"]:
                u = 0 if k["t1"] == k["t0"] else (time - k["t0"]) / (k["t1"] - k["t0"])
                u = u * u * (3 - 2 * u)
                q = {}
                for key in ("dist", "elev", "az", "turn"):
                    a0, a1 = prev.get(key, 0), k["pose"].get(key, 0)
                    q[key] = a0 + (a1 - a0) * u
                l0, l1 = np.array(prev.get("look", (0, 0, 0)), float), np.array(k["pose"].get("look", (0, 0, 0)), float)
                q["look"] = tuple(l0 + (l1 - l0) * u)
                return q, False, k
            if time < k["t2"]:
                return dict(k["pose"]), k["pose"].get("hand", False), k
            prev = k["pose"]
        return dict(keys[-1]["pose"]), False, keys[-1]

    frames = []
    n = int(total * fps)
    for i in range(n):
        tm = i / fps
        q, hand, k = pose_at(tm)
        R, tv = pose_from(q["dist"], q["elev"], q["az"], q.get("look", (0, 0, 0)), 0, q.get("turn", 0))
        moving = tm < k["t1"]
        opts = {"light": 0.95, "grad": 0.18, "noise": 3.0, "motion": 3 if moving else 0, "defocus": 0.5}
        if hand:
            if hand_pts is None:
                hand_pts = [[W * 0.62, H + 40], [W + 40, H * 0.55], [W * 0.70, H * 0.62], [W * 0.48, H * 0.66], [W * 0.40, H + 40]]
            opts["hand"] = hand_pts
        img = render(page, table, R, tv, K, rng, opts)
        cv2.imwrite(os.path.join(out, f"p{i:04d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 82])
        frames.append({"t": tm, "R": R.flatten().tolist(), "t_": tv.tolist(), "hold": not moving, "note": k["note"]})
    json.dump({"w": W, "h": H, "fps": fps, "K": [K[0, 0], K[0, 2], K[1, 2]], "fov": fov, "frames": frames, "keys": keys,
               "map": [MAP_W, MAP_H]}, open(os.path.join(out, "path.json"), "w"))
    print("frames", n, "seconds", total)


if __name__ == "__main__":
    mode, out = sys.argv[1], sys.argv[2]
    if mode == "random":
        random_set(out, int(sys.argv[3]), int(sys.argv[4]) if len(sys.argv) > 4 else 1)
    else:
        path_set(out)
