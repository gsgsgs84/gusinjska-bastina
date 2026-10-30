#!/usr/bin/env python3
"""QR codes for the hiking-trails page, with the Xplore Prokletije logo in the middle.

usage: python3 tools/qr/make_qr.py   ->  print/qr/staze_android.png, print/qr/staze_windows.png
Error correction H (30 %) keeps the codes readable with the logo covering the centre.
The logo's white background is removed and the code takes the logo's colours.
Each code is checked by decoding it again with OpenCV.
"""
import os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from reportlab.graphics.barcode.qrencoder import QRCode, QRErrorCorrectLevel

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "print", "qr")
SITE = "https://gsgsgs84.github.io/gusinjska-bastina/"
CODES = [
    ("staze_android", SITE + "staze.html?ar=1", "Android", "otvara se u Chromeu, spremno za AR"),
    ("staze_windows", SITE + "staze.html?pc=1", "Windows", "otvara se u pregledniku (Edge ili Chrome)"),
]
TITLE = "Planinarske staze u 3D"
# colours taken from the Xplore Prokletije logo
INK, BLUE, WHITE, GREY = (23, 33, 42), (0, 92, 248), (255, 255, 255), (96, 104, 114)
FONT_B = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/google-fonts/Poppins-Regular.ttf"
if not os.path.exists(FONT_R):
    FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
LOGO_SRC = os.path.join(HERE, "xplore_prokletije_logo.png")       # original logo on its white background
LOGO_OUT = os.path.join(OUT, "xplore_prokletije_logo_transparent.png")


def logo_rgba():
    """Remove the white background (soft edges, colours un-mixed from white) and crop to the logo."""
    a = np.asarray(Image.open(LOGO_SRC).convert("RGB")).astype(np.float32)
    border = np.concatenate([a[:16].reshape(-1, 3), a[-16:].reshape(-1, 3), a[:, :16].reshape(-1, 3), a[:, -16:].reshape(-1, 3)])
    bg = np.median(border, 0)
    dist = np.abs(a - bg).max(-1)
    alpha = np.clip((dist - 10) / 60, 0, 1)
    al = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip((a - (1 - al) * bg) / al, 0, 255)          # remove the white mixed into edge pixels
    # white areas closed inside the building (windows, door, the small QR mark) stay white;
    # only the background around the logo and inside the letters becomes transparent
    ys, xs = np.where(alpha > 0.04)
    x0, x1 = xs.min(), xs.max()
    n, lab, stats, cent = cv2.connectedComponentsWithStats((alpha < 0.5).astype(np.uint8), connectivity=4)
    h, w = alpha.shape
    for i in range(1, n):
        x, y, cw, ch, _ = stats[i]
        touches = x == 0 or y == 0 or x + cw == w or y + ch == h
        if not touches and cent[i][0] < x0 + 0.42 * (x1 - x0):
            m = lab == i
            m = cv2.dilate(m.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool) & (alpha < 1)
            rgb[m] = rgb[m] * alpha[m][:, None] + 255 * (1 - alpha[m][:, None])
            alpha[m] = 1
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    pad = 6
    return Image.fromarray(rgba, "RGBA").crop((xs.min() - pad, ys.min() - pad, xs.max() + pad + 1, ys.max() + pad + 1))


def matrix(text):
    for ver in range(1, 41):
        try:
            q = QRCode(ver, QRErrorCorrectLevel.H)
            q.addData(text)
            q.make()
            n = q.getModuleCount()
            return np.array([[q.isDark(r, c) for c in range(n)] for r in range(n)], bool)
        except Exception:
            continue
    raise ValueError("too long")


def make(name, url, platform, how):
    M = matrix(url)
    n = M.shape[0]
    quiet = 4
    mod = 1500 // (n + 2 * quiet)
    side = mod * (n + 2 * quiet)
    # clear a centred block for the logo: about 47 % x 21 % of the code, on a white plate
    logo = logo_rgba()
    bw = int(round(n * 0.47)) | 1
    bh = int(round(bw * logo.height / logo.width + 2)) | 1
    r0, c0 = (n - bh) // 2, (n - bw) // 2
    M = M.copy(); M[r0:r0 + bh, c0:c0 + bw] = False
    W, H = side + 160, side + 470
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    ox, oy = 80, 70
    finder = lambda r, c: (r < 7 and c < 7) or (r < 7 and c >= n - 7) or (r >= n - 7 and c < 7)
    for r in range(n):
        for c in range(n):
            if M[r, c]:
                x, y = ox + (c + quiet) * mod, oy + (r + quiet) * mod
                col = INK
                if finder(r, c):          # the three corner squares in the logo's blue, their centres dark
                    rr, cc = r % (n - 7) if r >= n - 7 else r, c % (n - 7) if c >= n - 7 else c
                    col = INK if (2 <= rr <= 4 and 2 <= cc <= 4) else BLUE
                d.rectangle([x, y, x + mod - 1, y + mod - 1], fill=col)
    # logo, scaled to the cleared block with a margin of one module
    px0, py0 = ox + (c0 + quiet) * mod, oy + (r0 + quiet) * mod
    pw, ph = bw * mod, bh * mod
    d.rounded_rectangle([px0, py0, px0 + pw - 1, py0 + ph - 1], radius=mod, fill=WHITE)
    lw = pw - 2 * mod; lh = round(lw * logo.height / logo.width)
    if lh > ph - 2 * mod:
        lh = ph - 2 * mod; lw = round(lh * logo.width / logo.height)
    lg = logo.resize((lw, lh), Image.LANCZOS)
    img.paste(lg, (px0 + (pw - lw) // 2, py0 + (ph - lh) // 2), lg)
    # name of the program and the platform below the code
    ty = oy + side + 10
    f1 = ImageFont.truetype(FONT_B, 92); f2 = ImageFont.truetype(FONT_B, 64); f3 = ImageFont.truetype(FONT_R, 40)
    d.text((W / 2, ty + 55), TITLE, font=f1, fill=INK, anchor="mm")
    tw = d.textlength(platform, font=f2) + 70
    d.rounded_rectangle([W / 2 - tw / 2, ty + 125, W / 2 + tw / 2, ty + 215], radius=45, fill=BLUE)
    d.text((W / 2, ty + 170), platform, font=f2, fill=WHITE, anchor="mm")
    d.text((W / 2, ty + 268), how, font=f3, fill=GREY, anchor="mm")
    d.text((W / 2, ty + 325), url.replace("https://", ""), font=ImageFont.truetype(FONT_R, 30), fill=(128, 136, 146), anchor="mm")
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + ".png")
    img.save(path, dpi=(300, 300))
    # check: decode it again
    gray = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2GRAY)
    small = cv2.resize(gray, None, fx=0.35, fy=0.35, interpolation=cv2.INTER_AREA)
    got = cv2.QRCodeDetector().detectAndDecode(small)[0]
    print(f"{name}: version {(n - 17) // 4}, {n}x{n} modules, decodes {'OK' if got == url else 'FAILED: ' + repr(got)}")
    return path


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    logo_rgba().save(LOGO_OUT)
    for c in CODES:
        make(*c)
