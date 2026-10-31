"""Synthetic camera pictures of the station cards inside the real Gusinje room photos.

Used to check the room-test page and the detector before anyone stands in the room:
  python3 tools/soba/synth.py cards OUT            -> OUT/card_<id>.png, the printed cards at 11.3 px/mm
  python3 tools/soba/synth.py frames OUT PHOTOS... -> OUT/frames/*.gray + OUT/manifest.json (detection-range study)
  python3 tools/soba/synth.py walk OUT PHOTO ID    -> OUT/walk_<id>.mjpeg (fake camera: card from 0.4 m to 4 m and back)
  python3 tools/soba/synth.py hold OUT PHOTO ID D  -> OUT/hold_<id>.mjpeg (fake camera: hand-held at D metres)
Camera model: 1440 x 1080 picture, 66 degrees across the long side (what the page assumes).
"""
import json, math, os, sys, random
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
W, H, FOV = 1440, 1080, 66.0
F = (W / 2) / math.tan(math.radians(FOV / 2))
K = np.array([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1]])
PXMM = 96 * 3 / 25.4            # card render resolution
data = json.load(open(os.path.join(ROOT, 'data', 'soba.json'), encoding='utf-8'))
SIZE_OF = {}
for st in data['stations']:
    for k, i in st['markers'].items():
        SIZE_OF[i] = data['sizes'][k]


def render_cards(out):
    sys.path.insert(0, HERE)
    import make_cards
    from playwright.sync_api import sync_playwright
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(out, '_c.html')
    open(tmp, 'w', encoding='utf-8').write(make_cards.build_html())
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(device_scale_factor=3, viewport={'width': 1000, 'height': 1400})
        pg.goto('file://' + tmp)
        pg.evaluate('document.fonts.ready')
        # sideways M cards: screenshot the upright copies on the L/S pages only; M is rendered from a fresh upright copy
        pg.evaluate('''document.querySelectorAll('.slot').forEach(s => { s.style.transform = 'none'; s.style.position = 'static'; s.style.margin = '20px'; });
                       document.querySelectorAll('.sheet').forEach(s => { s.style.height = 'auto'; s.style.overflow = 'visible'; });''')
        for el in pg.query_selector_all('.card'):
            cid = el.get_attribute('data-id')
            el.screenshot(path=os.path.join(out, f'card_{cid}.png'))
        b.close()
    os.remove(tmp)


def card_marker_quad(card_img, mid):
    """Pixel corners of the marker inside the card picture (found by OpenCV) - gives the card's mm frame."""
    d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_ARUCO_MIP_36h12)
    det = cv2.aruco.ArucoDetector(d, cv2.aruco.DetectorParameters())
    corners, ids, _ = det.detectMarkers(cv2.cvtColor(card_img, cv2.COLOR_BGR2GRAY))
    for c, i in zip(corners, ids.flatten()):
        if i == mid:
            return c.reshape(4, 2)
    raise RuntimeError(f'marker {mid} not found in card picture')


def rot(yaw, pitch, roll):
    y, p, r = map(math.radians, (yaw, pitch, roll))
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    Rx = np.array([[1, 0, 0], [0, math.cos(p), -math.sin(p)], [0, math.sin(p), math.cos(p)]])
    Rz = np.array([[math.cos(r), -math.sin(r), 0], [math.sin(r), math.cos(r), 0], [0, 0, 1]])
    return Ry @ Rx @ Rz


class Card:
    def __init__(self, cards_dir, mid):
        self.mid = mid
        self.img = cv2.imread(os.path.join(cards_dir, f'card_{mid}.png'))
        q = card_marker_quad(self.img, mid)
        self.mm = SIZE_OF[mid]
        # card picture px -> card plane metres (marker centre = origin, x right, y down)
        c = q.mean(0)
        self.pxm = np.linalg.norm(q[1] - q[0]) / (self.mm / 1000)
        h, w = self.img.shape[:2]
        self.corners_m = np.array([[(x - c[0]) / self.pxm, (y - c[1]) / self.pxm, 0] for x, y in [(0, 0), (w, 0), (w, h), (0, h)]])
        self.marker_m = np.array([[(x - c[0]) / self.pxm, (y - c[1]) / self.pxm, 0] for x, y in q])

    def project(self, R, t, pts):
        P = (R @ pts.T).T + t
        uv = (K @ P.T).T
        return uv[:, :2] / uv[:, 2:3]

    def paste(self, bg, R, t, gain=1.0):
        h, w = self.img.shape[:2]
        dst = self.project(R, t, self.corners_m).astype(np.float32)
        # pre-shrink the card so the warp never minifies more than 2x (no aliasing)
        span = max(np.linalg.norm(dst[1] - dst[0]), np.linalg.norm(dst[3] - dst[0]) * w / h)
        k = min(1.0, 2.0 * span / w)
        src_img = cv2.resize(self.img, (max(8, int(w * k)), max(8, int(h * k))), interpolation=cv2.INTER_AREA) if k < 1 else self.img
        sh, sw = src_img.shape[:2]
        src = np.float32([[0, 0], [sw, 0], [sw, sh], [0, sh]])
        Hm = cv2.getPerspectiveTransform(src, dst)
        warped = cv2.warpPerspective((src_img.astype(np.float32) * gain).clip(0, 255).astype(np.uint8), Hm, (bg.shape[1], bg.shape[0]), flags=cv2.INTER_LINEAR)
        mask = cv2.warpPerspective(np.full((sh, sw), 255, np.uint8), Hm, (bg.shape[1], bg.shape[0]), flags=cv2.INTER_LINEAR)
        a = (mask.astype(np.float32) / 255)[..., None]
        out = bg.astype(np.float32) * (1 - a) + warped.astype(np.float32) * a
        return out.clip(0, 255).astype(np.uint8), self.project(R, t, self.marker_m)


def load_bg(path, rng, crop=True):
    img = cv2.imread(path)
    img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)        # the room photos are stored sideways
    h, w = img.shape[:2]
    s = max(W / w, H / h) * (rng.uniform(1.0, 1.6) if crop else 1.0)
    img = cv2.resize(img, (int(w * s) + 1, int(h * s) + 1), interpolation=cv2.INTER_AREA)
    y0 = rng.randint(0, img.shape[0] - H); x0 = rng.randint(0, img.shape[1] - W)
    return img[y0:y0 + H, x0:x0 + W].copy()


COND = {   # name: (gain, gamma, noise sigma, blur sigma range, motion px range)
    'good': (1.0, 1.0, 2.5, (0.5, 1.0), (0, 2)),
    'evening': (0.42, 1.15, 6.0, (0.7, 1.3), (1, 5)),
    'shaky': (0.85, 1.0, 3.5, (0.8, 1.6), (4, 9)),
}


def camera_effects(img, cond, rng):
    gain, gamma, noise, (b0, b1), (m0, m1) = COND[cond]
    f = img.astype(np.float32) / 255
    f = np.power(f * gain, gamma)
    m = rng.uniform(m0, m1)
    if m >= 1.5:
        L = int(round(m)); kern = np.zeros((L, L), np.float32)
        ang = rng.uniform(0, math.pi)
        for i in range(L):
            x = int(round((L - 1) / 2 + math.cos(ang) * (i - (L - 1) / 2))); y = int(round((L - 1) / 2 + math.sin(ang) * (i - (L - 1) / 2)))
            kern[y, x] = 1
        f = cv2.filter2D(f, -1, kern / kern.sum())
    f = cv2.GaussianBlur(f, (0, 0), rng.uniform(b0, b1))
    f = f * 255 + np.random.default_rng(rng.randint(0, 10**9)).normal(0, noise, f.shape)
    f = f.clip(0, 255).astype(np.uint8)
    ok, enc = cv2.imencode('.jpg', f, [cv2.IMWRITE_JPEG_QUALITY, 82])           # video compression
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


def frames(out, photos, cards_dir, per=8, seed=1):
    rng = random.Random(seed)
    os.makedirs(os.path.join(out, 'frames'), exist_ok=True)
    ids = [st['markers'][k] for st in data['stations'] for k in ('S', 'M', 'L')]
    cards = {i: Card(cards_dir, i) for i in ids}
    man = []
    n = 0
    dists = [0.4, 0.6, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.5, 4.0, 4.5, 5.0]
    for cond in COND:
        for d in dists:
            for k in range(per):
                for size in ('S', 'M', 'L'):
                    st = rng.choice(data['stations'])
                    mid = st['markers'][size]
                    if d < 0.06 * 0 + data['sizes'][size] / 1000 * 4.5:       # card would not fit in the picture
                        continue
                    bg = load_bg(rng.choice(photos), rng)
                    ang = rng.choice([(0, 0), (25, 0), (-35, 10), (0, 35), (20, -30), (45, 0), (0, 55)])
                    R = rot(ang[0] + rng.uniform(-5, 5), ang[1] + rng.uniform(-5, 5), rng.uniform(-12, 12))
                    # card somewhere near the middle third: the visitor aims at it
                    ox = rng.uniform(-0.12, 0.12) * d * W / F; oy = rng.uniform(-0.1, 0.1) * d * W / F
                    t = np.array([ox * 2, oy * 2, d])
                    img, quad = cards[mid].paste(bg, R, t, gain=rng.uniform(0.85, 1.0))
                    img = camera_effects(img, cond, rng)
                    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                    full = cv2.resize(g, (720, 540), interpolation=cv2.INTER_LINEAR)       # whole picture at the page's 720 px
                    centre = g[270:810, 360:1080]                                          # centre crop, native pixels
                    name = f'{n:05d}'
                    full.tofile(os.path.join(out, 'frames', name + '_full.gray'))
                    centre.tofile(os.path.join(out, 'frames', name + '_centre.gray'))
                    side = float(np.mean([np.linalg.norm(quad[(j + 1) % 4] - quad[j]) for j in range(4)]))
                    man.append({'name': name, 'id': mid, 'size': size, 'd': d, 'cond': cond, 'yaw': ang[0], 'pitch': ang[1], 'px': round(side, 1),
                                'inCentre': bool(((quad[:, 0] > 360) & (quad[:, 0] < 1080) & (quad[:, 1] > 270) & (quad[:, 1] < 810)).all())})
                    n += 1
    # pictures with no card at all, to catch false detections in the embroidery
    for k in range(120):
        bg = camera_effects(load_bg(rng.choice(photos), rng), rng.choice(list(COND)), rng)
        g = cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY)
        name = f'{n:05d}'
        cv2.resize(g, (720, 540), interpolation=cv2.INTER_LINEAR).tofile(os.path.join(out, 'frames', name + '_full.gray'))
        g[270:810, 360:1080].tofile(os.path.join(out, 'frames', name + '_centre.gray'))
        man.append({'name': name, 'id': None}); n += 1
    json.dump({'w_full': 720, 'h_full': 540, 'w_centre': 720, 'h_centre': 540, 'frames': man}, open(os.path.join(out, 'manifest.json'), 'w'))
    print('frames', n)


def write_mjpeg(path, pics):
    with open(path, 'wb') as f:
        for p in pics:
            ok, enc = cv2.imencode('.jpg', p, [cv2.IMWRITE_JPEG_QUALITY, 88])
            f.write(enc.tobytes())


def walk(out, photo, mid, cards_dir, fps=15, secs=16, seed=3):
    """Hand-held walk: start 0.4 m from the card, step back to 4 m, come back; mild shake."""
    rng = random.Random(seed)
    card = Card(cards_dir, int(mid))
    bg0 = load_bg(photo, rng, crop=False)
    pics, truth = [], []
    N = fps * secs
    for i in range(N):
        u = i / (N - 1)
        d = 0.4 + 3.6 * (1 - abs(1 - 2 * u))           # 0.4 -> 4.0 -> 0.4
        R = rot(15 + 3 * math.sin(i * 0.4), 8 + 2 * math.sin(i * 0.31), 4 * math.sin(i * 0.23))
        t = np.array([0.02 * math.sin(i * 0.27) * d, 0.015 * math.sin(i * 0.19) * d, d])
        img, quad = card.paste(bg0, R, t)
        pics.append(camera_effects(img, 'good', rng)); truth.append(round(d, 3))
    p = os.path.join(out, f'walk_{mid}.mjpeg'); write_mjpeg(p, pics)
    json.dump(truth, open(p + '.json', 'w'))
    print('wrote', p, len(pics), 'frames')


def hold(out, photo, mid, dist, cards_dir, fps=15, secs=10, cond='good', seed=5):
    rng = random.Random(seed)
    card = Card(cards_dir, int(mid))
    bg0 = load_bg(photo, rng, crop=False)
    pics = []
    for i in range(fps * secs):
        R = rot(20 + 2 * math.sin(i * 0.5), 10 + 1.5 * math.sin(i * 0.37), 3 * math.sin(i * 0.29))
        t = np.array([0.03 * math.sin(i * 0.21), 0.02 * math.sin(i * 0.33), float(dist)])
        img, _ = card.paste(bg0, R, t)
        pics.append(camera_effects(img, cond, rng))
    p = os.path.join(out, f'hold_{mid}_{dist}_{cond}.mjpeg'); write_mjpeg(p, pics)
    print('wrote', p)


if __name__ == '__main__':
    cmd, out = sys.argv[1], sys.argv[2]
    cards_dir = os.path.join(out, 'cards')
    if cmd == 'cards':
        render_cards(cards_dir)
    elif cmd == 'frames':
        frames(out, sys.argv[3:], cards_dir)
    elif cmd == 'walk':
        walk(out, sys.argv[3], sys.argv[4], cards_dir)
    elif cmd == 'hold':
        hold(out, sys.argv[3], sys.argv[4], sys.argv[5], cards_dir, cond=(sys.argv[6] if len(sys.argv) > 6 else 'good'))
