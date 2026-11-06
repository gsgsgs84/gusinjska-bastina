"""Synthetic phone video of the printed AR cube held in a hand, for testing kocka.html end to end.

python3 -I tools/tests/cube_video.py OUT.y4m [--size 720x960] [--fps 24] [--fov 66] [--light 1.0]
                                     [--noise 3] [--dist 1.0] [--seconds 10] [--seed 1]

Writes OUT.y4m (Chrome's fake camera reads it) and OUT.json with the true pose of every frame
(X_cam = R X_cube + t, OpenCV camera, mm) and the intrinsics. The frame number is stamped as a 12-bit
code in the top-left corner (10 px squares on a grey strip, most significant bit first), so a test can
tell which frame the page showed with a pose.
"""
import json, math, os, sys
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
lay = json.load(open(os.path.join(HERE, '..', '..', 'data', 'layout.json')))
S = lay['edge']


def arg(name, default, cast=str):
    return cast(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def face_tex(fi, ppmm=10):
    n = int(round(S * ppmm)); img = np.full((n, n), 238, np.uint8); cell = lay['cell']
    for m in lay['markers']:
        if m['face'] != fi: continue
        cu, cv_ = m['center_uv']
        for i in range(8):
            for j in range(8):
                if not m['cells'][i][j]: continue
                u0 = cu - 4 * cell + j * cell; v1 = cv_ + 4 * cell - i * cell
                x0 = int(round((u0 + S / 2) * ppmm)); x1 = int(round((u0 + cell + S / 2) * ppmm))
                y0 = int(round((S / 2 - v1) * ppmm)); y1 = int(round((S / 2 - v1 + cell) * ppmm))
                img[y0:y1, x0:x1] = 24
    return img


def rot(axis, deg):
    return cv2.Rodrigues(np.array(axis, float) * math.radians(deg))[0]


def smooth(x):
    x = min(1, max(0, x)); return x * x * (3 - 2 * x)


def pose_at(time, dist):
    """Hand-held cube: still, slow turn, still, closer + tilt, quick flick, still."""
    yaw = 25 + 90 * smooth((time - 2) / 3) + 55 * smooth((time - 8.6) / 0.5)
    pitch = 28 + 14 * smooth((time - 6.5) / 2)              # cube tipped towards the camera: top face visible
    roll = 4 * math.sin(time * 0.7)
    z = (300 - 90 * smooth((time - 6.5) / 2)) * dist
    x = 8 * math.sin(time * 0.5); y = 22 - 6 * smooth((time - 6.5) / 2)
    # in a y-up view frame the upright cube facing the camera is the identity; tipping its top towards the camera
    # is +pitch about x. OpenCV's camera has y down and z forward.
    R = np.diag([1, -1, -1.0]) @ (rot([1, 0, 0], pitch) @ rot([0, 1, 0], yaw) @ rot([0, 0, 1], roll))
    return R, np.array([x, y, z], float)


def main():
    out = sys.argv[1]
    W, H = (int(v) for v in arg('--size', '720x960').split('x'))
    fps = arg('--fps', 24, int); secs = arg('--seconds', 10.0, float)
    fov = arg('--fov', 66.0, float); light = arg('--light', 1.0, float); noise = arg('--noise', 3.0, float)
    dist = arg('--dist', 1.0, float); seed = arg('--seed', 1, int)
    rng = np.random.default_rng(seed)
    f = (max(W, H) / 2) / math.tan(math.radians(fov / 2))
    K = np.array([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]])
    tex = [face_tex(i) for i in range(6)]
    # background: a table and a wall, soft shapes, a window glow
    bg = np.zeros((H, W, 3), np.float32)
    yy = np.linspace(0, 1, H)[:, None]
    bg[:] = (np.array([150, 160, 170]) * (1 - yy) + np.array([90, 110, 135]) * yy)[:, None, :].reshape(H, 1, 3)
    bg[int(H * .62):] = np.array([70, 95, 125])                      # wooden table (BGR)
    for _ in range(40):
        x0, y0 = int(rng.uniform(0, W)), int(rng.uniform(0, H))
        cv2.rectangle(bg, (x0, y0), (x0 + int(rng.uniform(20, 220)), y0 + int(rng.uniform(10, 160))), tuple(float(c) for c in rng.uniform(40, 220, 3)), -1)
    for _ in range(60):
        x0, y0 = int(rng.uniform(0, W)), int(rng.uniform(0, H))
        cv2.line(bg, (x0, y0), (x0 + int(rng.uniform(-120, 120)), y0 + int(rng.uniform(-120, 120))), tuple(float(c) for c in rng.uniform(20, 240, 3)), int(rng.uniform(1, 3)))
    bg = cv2.GaussianBlur(bg, (0, 0), 6)
    Ldir = np.array([0.3, -0.8, -0.5]); Ldir /= np.linalg.norm(Ldir)        # light from above-left (camera coords, y down)
    n = int(round(fps * secs))
    hdr = f'YUV4MPEG2 W{W} H{H} F{fps}:1 Ip A1:1 C420jpeg\n'.encode()
    gt = {'W': W, 'H': H, 'fps': fps, 'K': {'fx': f, 'fy': f, 'cx': W / 2, 'cy': H / 2}, 'fov': fov, 'frames': []}
    shake_r = np.zeros(3); shake_t = np.zeros(3)
    with open(out, 'wb') as fo:
        fo.write(hdr)
        for k in range(n):
            tm = k / fps
            R, t = pose_at(tm, dist)
            shake_r = 0.85 * shake_r + rng.normal(0, 0.12, 3); shake_t = 0.85 * shake_t + rng.normal(0, 0.18, 3)
            R = cv2.Rodrigues(np.radians(shake_r))[0] @ R; t = t + shake_t
            img = bg.copy()
            faces = []
            for fi, fc in enumerate(lay['faces']):
                N = np.array(fc['N'], float); U = np.array(fc['U'], float); V = np.array(fc['V'], float)
                c = N * S / 2
                nc = R @ N; pc = R @ c + t
                if nc @ pc >= 0: continue
                corners3 = [c - U * S / 2 + V * S / 2, c + U * S / 2 + V * S / 2, c + U * S / 2 - V * S / 2, c - U * S / 2 - V * S / 2]
                P = [(K @ (R @ X + t)) for X in corners3]; P = np.array([[p[0] / p[2], p[1] / p[2]] for p in P], np.float32)
                shade = light * (0.55 + 0.45 * max(0, -nc @ Ldir))
                faces.append((pc[2], fi, P, shade))
            for _, fi, P, shade in sorted(faces, key=lambda x: -x[0]):
                tx = tex[fi]; m = tx.shape[0]
                src = np.array([[0, 0], [m, 0], [m, m], [0, m]], np.float32)
                Hm = cv2.getPerspectiveTransform(src, P)
                warped = cv2.warpPerspective(tx.astype(np.float32), Hm, (W, H), flags=cv2.INTER_AREA)
                mask = cv2.warpPerspective(np.ones((m, m), np.float32), Hm, (W, H), flags=cv2.INTER_LINEAR)
                col = np.stack([warped * shade * 0.97, warped * shade * 0.99, warped * shade], -1)
                img = img * (1 - mask[..., None]) + col * mask[..., None]
            # a thumb holding the cube from below for part of the video
            if 3.5 < tm < 7.5:
                cc = K @ (R @ np.array([0, -S / 2, S / 2]) + t); cx, cy = cc[0] / cc[2], cc[1] / cc[2]
                cv2.ellipse(img, (int(cx + 18), int(cy + 26)), (46, 28), -25, 0, 360, (120, 150, 200), -1)
            blur = 0.6 + (2.2 if 8.6 < tm < 9.1 else 0)
            img = cv2.GaussianBlur(img, (0, 0), blur)
            img = img + rng.normal(0, noise, img.shape)
            img = np.clip(img, 0, 255).astype(np.uint8)
            ok, jpg = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 82]); img = cv2.imdecode(jpg, 1)
            # frame number, 12 bits
            img[0:18, 0:132] = 128
            for b in range(12):
                v = 255 if (k >> (11 - b)) & 1 else 0
                img[4:14, 6 + b * 10:14 + b * 10] = v
            yuv = cv2.cvtColor(img, cv2.COLOR_BGR2YUV_I420)
            fo.write(b'FRAME\n'); fo.write(yuv.tobytes())
            gt['frames'].append({'R': R.flatten().tolist(), 't': t.tolist()})
    json.dump(gt, open(out.rsplit('.', 1)[0] + '.json', 'w'))
    print('frames', n, 'f', round(f, 1))


if __name__ == '__main__':
    main()
