# Branded QR cards: "Xplore Prokletije" badge in the middle, program name below.
# usage: python3 tools/qr/make_museum_qr.py OUTDIR (museum app; tools/qr/make_qr.py is the trails page)   -> OUTDIR/qr_android.svg, qr_windows.svg, cards.html, print.html
import cv2, json, sys, os
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
BASE = 'https://gsgsgs84.github.io/gusinjska-bastina/'
PLAT = {
  'android': {'url': BASE + '?app=android', 'label': 'Android', 'sub': 'Skenirajte telefonom · Skanoni me telefon · Scan with your phone'},
  'windows': {'url': BASE + '?app=windows', 'label': 'Windows', 'sub': 'Za računar · Për kompjuter · For your PC'},
}
RF = float(os.environ.get('RF', '0'))    # finder corner rounding (modules)
INK, PINE, OCHRE, PAPER = '#1b2620', '#2f4337', '#c47b2a', '#fbf7f0'

def matrix(url):
    p = cv2.QRCodeEncoder.Params(); p.correction_level = cv2.QRCodeEncoder_CORRECT_LEVEL_H
    q = cv2.QRCodeEncoder.create(p).encode(url)
    d = (q == 0)
    import numpy as np
    ys, xs = np.where(d)
    d = d[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    return d.tolist()

# decorative skyline from the site's panorama data (far + middle layer)
sky = json.load(open(os.path.join(os.path.dirname(__file__), '../../data/skyline.json')))
def ridge(prof, w, h, y0, k):
    n = len(prof); pts = ' '.join(f'L{i / (n - 1) * w:.1f},{y0 - max(v, -3) * k:.1f}' for i, v in enumerate(prof))
    return f'M0,{h} {pts} L{w},{h} Z'

def card(key):
    P = PLAT[key]; M = matrix(P['url']); N = len(M)
    W, H = 1000, 1360
    m = 18                                 # module size (px); 4 light modules of quiet zone all round
    Q = N * m; qx = (W - Q) / 2; qy = 120
    # badge: centred, about 19 x 9 modules, with one module of white around it
    bw, bh = 19, 9
    bx0, by0 = (N - bw) // 2, (N - bh) // 2
    clear = lambda r, c: by0 - 1 <= r < by0 + bh + 1 and bx0 - 1 <= c < bx0 + bw + 1
    finder = lambda r, c: (r < 7 and c < 7) or (r < 7 and c >= N - 7) or (r >= N - 7 and c < 7)
    rects = []
    for r in range(N):
        for c in range(N):
            if M[r][c] and not clear(r, c) and not finder(r, c):
                rects.append(f'<rect x="{qx + c * m:.1f}" y="{qy + r * m:.1f}" width="{m + 0.5}" height="{m + 0.5}"/>')
    fins = ''
    for (r, c) in [(0, 0), (0, N - 7), (N - 7, 0)]:
        x, y = qx + c * m, qy + r * m
        fins += (f'<rect x="{x + m / 2:.1f}" y="{y + m / 2:.1f}" width="{6 * m}" height="{6 * m}" rx="{RF * m}" fill="none" stroke="{INK}" stroke-width="{m}"/>'
                 f'<rect x="{x + 2 * m:.1f}" y="{y + 2 * m:.1f}" width="{3 * m}" height="{3 * m}" rx="{RF * 0.6 * m}" fill="{INK}"/>')
    bx, by, bW, bH = qx + bx0 * m, qy + by0 * m, bw * m, bh * m
    cx = W / 2
    mountain = (f'<g transform="translate({cx - 29},{by + 16}) scale(1.8)"><path d="M1 19 L11 5 L15 10 L20 2 L31 19 Z" fill="#f4efe6"/>'
                f'<path d="M18.3 4.6 L20 2 L21.8 4.8 L20.6 6 L19.6 5.1 Z" fill="{OCHRE}"/></g>')
    badge = (f'<rect x="{bx}" y="{by}" width="{bW}" height="{bH}" rx="28" fill="{PINE}"/>'
             f'<rect x="{bx + 6}" y="{by + 6}" width="{bW - 12}" height="{bH - 12}" rx="23" fill="none" stroke="#f4efe6" stroke-opacity=".22" stroke-width="2"/>'
             + mountain +
             f'<text x="{cx + 4}" y="{by + 105}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="51" letter-spacing="7.5" fill="#f4efe6">XPLORE</text>'
             f'<text x="{cx + 3}" y="{by + 136}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="22" letter-spacing="6.4" fill="{OCHRE}">PROKLETIJE</text>')
    ty = qy + Q + 4 * m + 92
    far, mid = sky['prof'][3], sky['prof'][2]
    rid = (f'<g transform="translate(0,{H - 150})"><path d="{ridge(far, W, 150, 112, 9)}" fill="#c9cfc9"/>'
           f'<path d="{ridge(mid, W, 150, 120, 9)}" fill="#8fa196"/></g>')
    icon = ('<rect x="-13" y="-22" width="26" height="44" rx="5" fill="none" stroke="#fff" stroke-width="3.4"/><circle cx="0" cy="15" r="2.6" fill="#fff"/>'
            if key == 'android' else
            '<rect x="-20" y="-17" width="40" height="27" rx="3" fill="none" stroke="#fff" stroke-width="3.4"/><path d="M-26 16 H26" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/>')
    pillW = 356
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
  <defs><clipPath id="cc"><rect width="{W}" height="{H}" rx="56"/></clipPath></defs>
  <g clip-path="url(#cc)">
    <rect width="{W}" height="{H}" fill="{PAPER}"/>
    <rect x="{qx - 4 * m}" y="{qy - 4 * m}" width="{Q + 8 * m}" height="{Q + 8 * m}" rx="40" fill="#fff"/>
    <g fill="{INK}">{''.join(rects)}</g>{fins}{badge}
    <text x="{cx}" y="{ty}" text-anchor="middle" font-family="Lora" font-weight="700" font-size="66" fill="{INK}">Gusinjska kulturna baština</text>
    <g transform="translate({cx - pillW / 2},{ty + 34})"><rect width="{pillW}" height="76" rx="38" fill="{PINE}"/>
      <g transform="translate(62,38)">{icon}</g>
      <text x="{pillW / 2 + 28}" y="51" text-anchor="middle" font-family="Inter" font-weight="800" font-size="36" letter-spacing="3" fill="#fff">{P["label"].upper()}</text></g>
    <text x="{cx}" y="{ty + 160}" text-anchor="middle" font-family="Inter" font-weight="500" font-size="24" fill="#6e655a">{P["sub"]}</text>
    <text x="{cx}" y="{ty + 198}" text-anchor="middle" font-family="DejaVu Sans Mono" font-size="21" fill="#8a8073">gsgsgs84.github.io/gusinjska-bastina</text>
    {rid}
  </g>
  <rect x="1.5" y="1.5" width="{W - 3}" height="{H - 3}" rx="55" fill="none" stroke="#2f4337" stroke-opacity=".18" stroke-width="3"/>
</svg>'''

for k in PLAT:
    open(os.path.join(OUT, f'qr_{k}.svg'), 'w').write(card(k))
# one page per card for PNG export, and an A4 print sheet with both (9 cm wide each)
open(os.path.join(OUT, 'cards.html'), 'w').write('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff}img{display:block}</style>'
    + ''.join(f'<img id="{k}" src="qr_{k}.svg" width="1000" height="1360">' for k in PLAT))
open(os.path.join(OUT, 'print.html'), 'w').write('''<!doctype html><meta charset="utf-8"><style>
@page { size: A4; margin: 0 } body { margin: 0; font-family: Inter }
.page { width: 210mm; height: 297mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8mm }
.row { display: flex; gap: 10mm } .row img { width: 90mm; height: auto }
p { font-size: 9pt; color: #6e655a; margin: 0 } </style>
<div class="page"><div class="row"><img src="qr_android.svg"><img src="qr_windows.svg"></div>
<p>Gusinjska kulturna baština · Xplore Prokletije — QR kodovi za štampu (širina kartice 9 cm)</p></div>''')
print('ok')
