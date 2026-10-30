#!/usr/bin/env python3
"""QR codes for the hiking-trails page, with the Xplore Prokletije mark in the middle.

usage: python3 tools/qr/make_qr.py   ->  print/qr/staze_android.png, print/qr/staze_windows.png
Error correction H (30 %) keeps the codes readable with the badge covering the centre.
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
PINE, INK, CREAM, OCHRE = (47, 67, 55), (22, 32, 26), (244, 239, 230), (164, 100, 31)
FONT_B = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/google-fonts/Poppins-Regular.ttf"
if not os.path.exists(FONT_R):
    FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


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


def badge(w, h):
    """The Xplore Prokletije mark: pine rounded box, mountain with an ochre snow cap, two lines of text."""
    s = 4                                            # draw large, scale down for smooth edges
    im = Image.new("RGBA", (w * s, h * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, w * s - 1, h * s - 1], radius=int(h * s * 0.16), fill=PINE + (255,))
    # mountain (same shape as the brand line on the museum home page, viewBox 32 x 20)
    mw = w * s * 0.30; mh = mw * 20 / 32; mx = (w * s - mw) / 2; my = h * s * 0.10
    P = lambda x, y: (mx + x / 32 * mw, my + y / 20 * mh)
    d.polygon([P(1, 19), P(11, 5), P(15, 10), P(20, 2), P(31, 19)], fill=CREAM)
    d.polygon([P(18.3, 4.6), P(20, 2), P(21.8, 4.8), P(20.6, 6), P(19.6, 5.1)], fill=OCHRE)
    for txt, frac, yfrac in (("XPLORE", 0.17, 0.50), ("PROKLETIJE", 0.155, 0.75)):
        size = int(h * s * frac)
        f = ImageFont.truetype(FONT_B, size)
        spacing = size * 0.10
        widths = [f.getlength(ch) for ch in txt]
        total = sum(widths) + spacing * (len(txt) - 1)
        while total > w * s * 0.86:                   # keep inside the box
            size -= 2; f = ImageFont.truetype(FONT_B, size); spacing = size * 0.10
            widths = [f.getlength(ch) for ch in txt]; total = sum(widths) + spacing * (len(txt) - 1)
        x = (w * s - total) / 2
        for ch, cw in zip(txt, widths):
            d.text((x, h * s * yfrac), ch, font=f, fill=CREAM, anchor="lm")
            x += cw + spacing
    return im.resize((w, h), Image.LANCZOS)


def make(name, url, platform, how):
    M = matrix(url)
    n = M.shape[0]
    quiet = 4
    mod = 1500 // (n + 2 * quiet)
    side = mod * (n + 2 * quiet)
    # clear a centred block of modules for the badge (about 30 % x 21 % of the code: ~6 % of its area)
    bw = int(round(n * 0.32)) | 1; bh = int(round(n * 0.22)) | 1
    r0, c0 = (n - bh) // 2, (n - bw) // 2
    M = M.copy(); M[r0 - 1:r0 + bh + 1, c0 - 1:c0 + bw + 1] = False
    W, H = side + 160, side + 470
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    ox, oy = 80, 70
    for r in range(n):
        for c in range(n):
            if M[r, c]:
                x, y = ox + (c + quiet) * mod, oy + (r + quiet) * mod
                d.rectangle([x, y, x + mod - 1, y + mod - 1], fill=INK)
    b = badge(bw * mod, bh * mod)
    img.paste(b, (ox + (c0 + quiet) * mod, oy + (r0 + quiet) * mod), b)
    # name of the program and the platform below the code
    ty = oy + side + 10
    f1 = ImageFont.truetype(FONT_B, 92); f2 = ImageFont.truetype(FONT_B, 64); f3 = ImageFont.truetype(FONT_R, 40)
    d.text((W / 2, ty + 55), TITLE, font=f1, fill=INK, anchor="mm")
    pw = d.textlength(platform, font=f2) + 70
    d.rounded_rectangle([W / 2 - pw / 2, ty + 125, W / 2 + pw / 2, ty + 215], radius=45, fill=PINE)
    d.text((W / 2, ty + 170), platform, font=f2, fill=CREAM, anchor="mm")
    d.text((W / 2, ty + 268), how, font=f3, fill=(90, 84, 76), anchor="mm")
    d.text((W / 2, ty + 325), url.replace("https://", ""), font=ImageFont.truetype(FONT_R, 30), fill=(120, 114, 106), anchor="mm")
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
    for c in CODES:
        make(*c)
