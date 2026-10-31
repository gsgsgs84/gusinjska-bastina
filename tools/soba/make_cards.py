"""Printable test cards for the Mladina sehara escape room (step 0: room test).

Output: print/soba/mladina_sehara_test_kartice.pdf (A4)
  page 1      instructions (ME | EN), scale bar, QR code to the test page, station table
  pages 2-3   size S cards (60 mm marker), 4 per page
  pages 4-6   size M cards (90 mm marker), 2 per page (turned sideways)
  pages 7-12  size L cards (120 mm marker), 1 per page
Run: python3 tools/soba/make_cards.py   (needs Python Playwright + the pre-installed Chromium)
Every card is checked after printing by tools/soba/check_pdf.py.
"""
import base64, json, os, html
from reportlab.graphics.barcode.qrencoder import QRCode, QRErrorCorrectLevel

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT_DIR = os.path.join(ROOT, 'print', 'soba')
OUT_PDF = os.path.join(OUT_DIR, 'mladina_sehara_test_kartice.pdf')
TEST_URL = 'https://gsgsgs84.github.io/gusinjska-bastina/soba-test.html'

data = json.load(open(os.path.join(ROOT, 'data', 'soba.json'), encoding='utf-8'))
CELLS = {m['id']: m['cells'] for m in data['markers']}
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()
FONT_M = b64(os.path.join(HERE, 'fonts', 'Marcellus-Regular.ttf'))
FONT_G = b64(os.path.join(HERE, 'fonts', 'GolosText-VF.ttf'))
LOGO = b64(os.path.join(HERE, 'logo_card.png'))

RED, GREEN, OCHRE, CREAM, INK, MUTED = '#a3202c', '#24533e', '#c98a2b', '#f4ecdb', '#221e19', '#6e655a'


# ---------------------------------------------------------------- pieces
def marker_svg(mid, size_mm):
    """8x8 marker as one filled path (no hairline seams between cells)."""
    d = []
    for i, row in enumerate(CELLS[mid]):
        for j, v in enumerate(row):
            if v:
                d.append(f'M{j} {i}h1v1h-1z')
    return (f'<svg class="marker" viewBox="0 0 8 8" style="width:{size_mm}mm;height:{size_mm}mm" '
            f'shape-rendering="crispEdges"><path d="{"".join(d)}" fill="#000"/></svg>')


def band_svg(w, h, nr):
    """Kilim-style band: red field, green edge stripes, a row of stepped lozenges, number medallion."""
    s = []
    s.append(f'<rect width="{w}" height="{h}" fill="{RED}"/>')
    e = h * 0.11
    s.append(f'<rect width="{w}" height="{e}" fill="{GREEN}"/><rect y="{h - e}" width="{w}" height="{e}" fill="{GREEN}"/>')
    s.append(f'<rect y="{e}" width="{w}" height="{e * 0.35}" fill="{CREAM}"/><rect y="{h - e * 1.35}" width="{w}" height="{e * 0.35}" fill="{CREAM}"/>')
    cy = h / 2; r = h * 0.27                       # lozenge half-height
    step = r / 3
    pitch = r * 2.5
    n = int(w / pitch) + 2
    x0 = w / 2 - (n // 2) * pitch
    med_r = h * 0.40
    for k in range(n):
        cx = x0 + k * pitch
        if abs(cx - w / 2) < med_r + r * 0.9:
            continue
        col = OCHRE if k % 2 else CREAM
        # stepped diamond (woven look): left half from the top point down to the bottom point, then mirrored
        top = [(cx, cy - r)]
        for t in range(1, 3):
            top += [(cx - t * step, cy - r + (t - 1) * step), (cx - t * step, cy - r + t * step)]
        top += [(cx - 3 * step, cy - r + 2 * step)]
        bottom = [(px, 2 * cy - py) for (px, py) in reversed(top)]
        left = top + bottom
        right = [(2 * cx - px, py) for (px, py) in reversed(left[1:-1])]
        poly = left + right
        s.append('<polygon points="' + ' '.join(f'{px:.3f},{py:.3f}' for px, py in poly) + f'" fill="{col}"/>')
        s.append(f'<rect x="{cx - step * 0.5:.3f}" y="{cy - step * 0.5:.3f}" width="{step:.3f}" height="{step:.3f}" fill="{INK}"/>')
    s.append(f'<circle cx="{w / 2}" cy="{cy}" r="{med_r}" fill="{CREAM}" stroke="{INK}" stroke-width="{h * 0.03}"/>')
    s.append(f'<text x="{w / 2}" y="{cy}" dy="0.36em" text-anchor="middle" font-family="Marcellus" font-size="{h * 0.52}" fill="{INK}">{nr}</text>')
    return f'<svg class="band" viewBox="0 0 {w} {h}" style="width:{w}mm;height:{h}mm">{"".join(s)}</svg>'


ICONS = {
    'radio': f'''<path d="M7 39V20a6 6 0 0 1 6-6h22a6 6 0 0 1 6 6v19z"/>
      <path d="M12 21h11M12 25h11M12 29h11M12 33h11"/>
      <rect x="27" y="19" width="9.5" height="7" rx="1.2"/><path d="M31 19v7" stroke="{RED}"/>
      <circle cx="29" cy="33" r="2.4"/><circle cx="35" cy="33" r="2.4"/><path d="M11 39v3.5M37 39v3.5"/>''',
    'vez': f'''<circle cx="24" cy="25" r="16"/><circle cx="24" cy="25" r="12.6" stroke-width="1.4"/>
      <path d="M21 9.2V6h6v3.2"/>
      <g fill="{RED}" stroke="none"><circle cx="24" cy="18.6" r="3.4"/><circle cx="30.1" cy="23" r="3.4"/><circle cx="27.8" cy="30.2" r="3.4"/>
      <circle cx="20.2" cy="30.2" r="3.4"/><circle cx="17.9" cy="23" r="3.4"/></g><circle cx="24" cy="25" r="2.6" fill="{OCHRE}"/>''',
    'dzezva': f'''<path d="M14 15h12l-1.6 4.4C29 22.6 31 27.5 31 33a5 5 0 0 1-5 5H14a5 5 0 0 1-5-5c0-5.5 2-10.4 6.6-13.6z"/>
      <path d="M14 15l-3.5-2.6"/><path d="M26.4 18.5L42 11" stroke-width="3.2"/>
      <path d="M33.5 31.5h9l-1.3 6.5h-6.4z" fill="{RED}" stroke="{INK}"/><path d="M31 41h14"/>''',
    'razboj': f'''<path d="M9 6v36M39 6v36M6 9.5h36M6 37.5h36"/>
      <path d="M14 9.5v28M19 9.5v28M24 9.5v28M29 9.5v28M34 9.5v28" stroke-width="1.3"/>
      <path d="M9 32.5l5-3.2 5 3.2 5-3.2 5 3.2 5-3.2 5 3.2" stroke="{RED}" stroke-width="2.4"/>
      <path d="M13 21l6-2.8h10l6 2.8-6 2.8H19z" fill="{OCHRE}"/>''',
    'mlatilica': f'''<path d="M24 13V3"/><path d="M20 3.5h8"/>
      <path d="M16 14l2.2 30h11.6L32 14z"/><path d="M14.5 14h19"/>
      <path d="M16.9 22h14.2M17.8 36h12.4" stroke="{RED}" stroke-width="2.6"/>
      <path d="M33.5 41h9l-1-5.5h-7z" fill="{OCHRE}"/><path d="M35.5 35.5c0-3 5-3 5 0"/>''',
    'sehara': f'''<path d="M5 19.5L7.5 12h33l2.5 7.5z"/><rect x="6" y="19.5" width="36" height="20" rx="1.8"/>
      <path d="M10 39.5v3.5M38 39.5v3.5"/>
      <circle cx="24" cy="30" r="5.2"/><path d="M24 24.8v10.4M19.5 27.4l9 5.2M19.5 32.6l9-5.2" stroke-width="1.3"/>
      <circle cx="13" cy="30" r="2.6" fill="{RED}" stroke="none"/><circle cx="35" cy="30" r="2.6" fill="{RED}" stroke="none"/>
      <rect x="21.6" y="16" width="4.8" height="6" rx="1" fill="{OCHRE}"/>''',
}


def icon_svg(key):
    return (f'<svg class="icon" viewBox="0 0 48 48" fill="none" stroke="{INK}" stroke-width="2.4" '
            f'stroke-linecap="round" stroke-linejoin="round">{ICONS[key]}</svg>')


def card_dims(m):
    c = m / 8
    P = 10 * c                       # marker + one cell of white on every side
    f = (P / 75) ** 0.55
    sm = 5.5 * f
    W = P + 2 * sm
    H = 57 * f + P
    return c, P, f, sm, W, H


def card_html(st, size):
    m = data['sizes'][size]
    mid = st['markers'][size]
    c, P, f, sm, W, H = card_dims(m)
    n = st['name']
    e = html.escape
    band_h = 10 * f
    return f'''
<div class="card" style="--f:{f};width:{W}mm;height:{H}mm" data-id="{mid}" data-size="{size}">
  {band_svg(W, band_h, st['nr'])}
  <div class="title" style="left:{sm}mm;right:{sm}mm;top:{band_h + 4 * f}mm;height:{18 * f}mm">
    <div class="ic" style="width:{16 * f}mm;height:{16 * f}mm">{icon_svg(st['icon'])}</div>
    <div class="names"><div class="me">{e(n['me'])}</div><div class="sq">{e(n['sq'])}</div><div class="en">{e(n['en'])}</div></div>
  </div>
  <div class="mk" style="left:{sm + c}mm;top:{band_h + 25 * f + c}mm">{marker_svg(mid, m)}</div>
  <div class="foot" style="left:{sm}mm;right:{sm}mm;top:{band_h + 27 * f + P}mm;height:{12 * f}mm">
    <div><div class="lbl">Šifra · Kodi · Code</div><div class="code">{st['code']}</div></div>
    <img class="logo" src="data:image/png;base64,{LOGO}" style="height:{8.5 * f}mm">
  </div>
  <div class="test" style="left:{sm}mm;right:{sm}mm;bottom:{2.6 * f}mm">TEST · {size} · crni kvadrat = {m} mm · ID {mid}</div>
</div>'''


def qr_svg(text, size_mm):
    for ver in range(1, 41):          # smallest version that holds the text
        try:
            q = QRCode(ver, QRErrorCorrectLevel.M)
            q.addData(text); q.make()
            break
        except Exception:
            continue
    n = q.getModuleCount()
    d = ''.join(f'M{j + 4} {i + 4}h1v1h-1z' for i in range(n) for j in range(n) if q.isDark(i, j))
    return (f'<svg viewBox="0 0 {n + 8} {n + 8}" style="width:{size_mm}mm;height:{size_mm}mm" shape-rendering="crispEdges">'
            f'<rect width="{n + 8}" height="{n + 8}" fill="#fff"/><path d="{d}" fill="{INK}"/></svg>')


def ruler_svg():
    """100 mm scale with 10 mm ticks, to check the print scale."""
    t = ''.join(f'<path d="M{x} 0v{4 if x % 50 == 0 else 2.4}"/>' for x in range(0, 101, 10))
    n = ''.join(f'<text x="{x}" y="7.6" text-anchor="middle">{x}</text>' for x in (0, 50, 100))
    return (f'<svg viewBox="-3 -0.5 106 9" style="width:106mm;height:9mm" fill="none" stroke="{INK}" stroke-width="0.3">'
            f'<path d="M0 0h100"/>{t}<g fill="{MUTED}" stroke="none" font-size="2.6" font-family="Golos">{n}</g></svg>')


# ---------------------------------------------------------------- pages
def page(inner, label):
    return f'<section class="sheet"><div class="plabel">{label}</div>{inner}</section>'


def intro_page():
    rows = ''.join(
        f'<tr><td>{s["nr"]}</td><td>{html.escape(s["name"]["me"])}</td><td><b>{s["code"]}</b></td>'
        f'<td>{s["markers"]["S"]}</td><td>{s["markers"]["M"]}</td><td>{s["markers"]["L"]}</td></tr>'
        for s in data['stations'])
    me = '''
<h3>Crnogorski</h3>
<ol>
<li><b>Štampa na 100 %</b> („Stvarna veličina“, ne „Prilagodi stranici“), na <b>mat</b> papir ili karton. Bez sjajne plastifikacije: odsijava prozor. Linija ispod mora imati tačno 100 mm.</li>
<li>Isijecite kartice po sivim linijama.</li>
<li>Počnite sa <b>S</b> karticama. Postavite po jednu pored svake stanice, tamo gdje bi stajala prava kartica: uspravno (oslonjena) ili položena, vidljiva s mjesta na kojem stoji posjetilac. Ne iza stakla, ne u dubokoj sjeni, ne na direktnom suncu.</li>
<li>Na telefonu otvorite stranicu (QR kod desno) u Chromeu ili Safariju i dozvolite kameru.</li>
<li>Kod svake stanice stanite gdje bi stao posjetilac, dodirnite <b>Testiraj mjesto</b> i 5 sekundi držite telefon prirodno, kao posjetilac. Zatim <b>Domet</b>: počnite blizu kartice i polako se udaljavajte dok je telefon ne izgubi.</li>
<li>Ako S ne prođe, probajte <b>M</b>, pa <b>L</b> na istom mjestu.</li>
<li>Ponovite <b>ujutro i predveče</b>, na svom telefonu, na <b>tabletu muzeja</b> i na bar jednom starijem telefonu.</li>
<li>Na kraju dodirnite <b>Kopiraj rezultate</b> i pošaljite tekst u chat.</li>
</ol>'''
    en = '''
<h3>English</h3>
<ol>
<li><b>Print at 100 %</b> (“Actual size”, not “Fit to page”) on <b>matte</b> paper or card. No glossy lamination: it reflects the window. The line below must measure exactly 100 mm.</li>
<li>Cut the cards along the grey lines.</li>
<li>Start with the <b>S</b> cards. Put one next to each station, where the real card would go: standing (leaned) or lying flat, visible from where a visitor stands. Not behind glass, not in deep shadow, not in direct sun.</li>
<li>Open the page on the phone (QR code on the right) in Chrome or Safari and allow the camera.</li>
<li>At each station stand where a visitor would, tap <b>Test this spot</b> and hold the phone naturally for 5 seconds. Then <b>Range</b>: start close to the card and step back slowly until the phone loses it.</li>
<li>If S fails, try <b>M</b>, then <b>L</b> at the same spot.</li>
<li>Repeat <b>in the morning and in the evening</b>, on your phone, on the <b>museum tablet</b> and on at least one older phone.</li>
<li>Finally tap <b>Copy results</b> and paste the text into the chat.</li>
</ol>'''
    inner = f'''
<div class="intro">
  <div class="kick">Mladina sehara · AR escape room · korak 0 / step 0</div>
  <h1>Test kartice za sobu</h1>
  <p class="lead">Room-test cards: which spots in the Gusinje room the phone recognises quickly and reliably, in which card size and light.</p>
  <div class="cols">
    <div class="col">{me}</div>
    <div class="col">{en}</div>
  </div>
  <div class="bottom">
    <div class="bar">{ruler_svg()}<div class="rl">Mora imati tačno 100 mm · must measure exactly 100 mm</div></div>
    <div class="qr">{qr_svg(TEST_URL, 34)}<div class="ql">{TEST_URL.replace("https://", "")}</div></div>
  </div>
  <table class="st"><thead><tr><th>#</th><th>Stanica / Station</th><th>Šifra / Code</th><th>ID S 60 mm</th><th>ID M 90 mm</th><th>ID L 120 mm</th></tr></thead>
  <tbody>{rows}</tbody></table>
  <p class="small">Stranice 2–3: S (60 mm) · 4–6: M (90 mm) · 7–12: L (120 mm). Kartice su probne; konačne kartice dobijaju veličinu koja prođe test. · Pages 2–3: S · 4–6: M · 7–12: L. These are test cards; the final cards get the size that passes.</p>
</div>'''
    return page(inner, 'Mladina sehara · test kartice · str. 1/12')


def build_html():
    st = data['stations']
    pages = [intro_page()]
    pno = 2
    # S: 2 x 2 per page
    _, _, _, _, W, H = card_dims(60)
    gx, gy = 8, 8
    x0, y0 = (210 - 2 * W - gx) / 2, (297 - 2 * H - gy) / 2
    for p in range(2):
        inner = ''
        for k in range(4):
            i = p * 4 + k
            if i >= len(st):
                break
            x = x0 + (k % 2) * (W + gx); y = y0 + (k // 2) * (H + gy)
            inner += f'<div class="slot" style="left:{x}mm;top:{y}mm">{card_html(st[i], "S")}</div>'
        if p == 1:
            inner += f'''<div class="note" style="left:{x0 + W + gx}mm;top:{y0 + H + gy}mm;width:{W}mm;height:{H}mm">
              <div>Rezervno mjesto: ovdje možete odštampati dodatnu karticu kasnije.<br><br>Spare slot.</div></div>'''
        pages.append(page(inner, f'Mladina sehara · S · crni kvadrat 60 mm · str. {pno}/12')); pno += 1
    # M: 2 per page, turned sideways
    _, _, _, _, W, H = card_dims(90)
    gy = 10
    x0 = (210 - H) / 2; y0 = (297 - 2 * W - gy) / 2
    for p in range(3):
        inner = ''
        for k in range(2):
            i = p * 2 + k
            y = y0 + k * (W + gy)
            # The card is laid out upright at the top of the page and only moved by the transform:
            # Chrome splits pages by the untransformed box, so a box reaching past the page bottom
            # would push half of the card onto the next page.
            inner += (f'<div class="slot" style="left:0;top:0;transform-origin:0 0;'
                      f'transform:translate({x0 + H}mm,{y}mm) rotate(90deg)">{card_html(st[i], "M")}</div>')
        pages.append(page(inner, f'Mladina sehara · M · crni kvadrat 90 mm · str. {pno}/12')); pno += 1
    # L: 1 per page
    _, _, _, _, W, H = card_dims(120)
    for i in range(6):
        inner = f'<div class="slot" style="left:{(210 - W) / 2}mm;top:{(297 - H) / 2}mm">{card_html(st[i], "L")}</div>'
        pages.append(page(inner, f'Mladina sehara · L · crni kvadrat 120 mm · str. {pno}/12')); pno += 1

    css = f'''
@font-face {{ font-family: Marcellus; src: url(data:font/ttf;base64,{FONT_M}) format("truetype"); }}
@font-face {{ font-family: Golos; src: url(data:font/ttf;base64,{FONT_G}) format("truetype"); font-weight: 400 900; }}
@page {{ size: A4; margin: 0; }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; padding: 0; }}
body {{ font-family: Golos, sans-serif; color: {INK}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.sheet {{ position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }}
.sheet:last-child {{ page-break-after: auto; break-after: auto; }}
.plabel {{ position: absolute; top: 4.2mm; left: 0; right: 0; text-align: center; font-size: 6.5pt; color: #8a8278; letter-spacing: .04em; }}
.slot {{ position: absolute; }}
.card {{ position: relative; background: #fff; outline: 0.2mm solid #b9b3aa; }}
.card .band {{ position: absolute; left: 0; top: 0; display: block; }}
.card .title {{ position: absolute; display: flex; align-items: center; gap: calc(var(--f) * 3mm); }}
.card .ic {{ flex: none; border-radius: 50%; background: {CREAM}; display: grid; place-items: center; }}
.card .ic svg {{ width: 78%; height: 78%; }}
.card .names {{ min-width: 0; flex: 1; line-height: 1.12; }}
.card .me {{ font-family: Marcellus; font-size: calc(var(--f) * 15.5pt); white-space: nowrap; }}
.card .sq, .card .en {{ font-size: calc(var(--f) * 7.8pt); color: {MUTED}; white-space: nowrap; margin-top: calc(var(--f) * 0.6mm); }}
.card .mk {{ position: absolute; }}
.card .marker {{ display: block; }}
.card .foot {{ position: absolute; display: flex; align-items: center; justify-content: space-between; border-top: calc(var(--f) * 0.3mm) solid {RED}; padding-top: calc(var(--f) * 1.6mm); }}
.card .lbl {{ font-size: calc(var(--f) * 5.6pt); letter-spacing: .12em; text-transform: uppercase; color: {MUTED}; }}
.card .code {{ font-size: calc(var(--f) * 15pt); font-weight: 680; letter-spacing: .16em; line-height: 1.1; }}
.card .logo {{ display: block; }}
.card .test {{ position: absolute; font-size: calc(var(--f) * 5.2pt); color: #9a9288; letter-spacing: .03em; }}
.note {{ position: absolute; border: 0.25mm dashed #cfc8bd; display: grid; place-items: center; text-align: center; font-size: 8pt; color: #a29a8f; padding: 10mm; }}
.intro {{ position: absolute; left: 16mm; right: 16mm; top: 14mm; bottom: 12mm; }}
.intro .kick {{ font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: {RED}; font-weight: 600; }}
.intro h1 {{ font-family: Marcellus; font-weight: 400; font-size: 25pt; margin: 2mm 0 1mm; }}
.intro .lead {{ margin: 0 0 4mm; font-size: 9.5pt; color: {MUTED}; }}
.intro .cols {{ display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; }}
.intro h3 {{ font-family: Marcellus; font-weight: 400; font-size: 12pt; margin: 0 0 1.5mm; color: {GREEN}; }}
.intro ol {{ margin: 0; padding-left: 4.6mm; font-size: 8.4pt; line-height: 1.38; }}
.intro li {{ margin-bottom: 1.4mm; }}
.intro .bottom {{ display: flex; justify-content: space-between; align-items: flex-end; margin: 5mm 0 4mm; }}
.intro .bar svg {{ display: block; }}
.intro .rl {{ font-size: 7.5pt; color: {MUTED}; margin-top: 1mm; }}
.intro .qr {{ text-align: center; }}
.intro .ql {{ font-size: 6.8pt; color: {MUTED}; }}
.intro table.st {{ width: 100%; border-collapse: collapse; font-size: 8.4pt; }}
.intro .st th {{ text-align: left; font-weight: 600; font-size: 7pt; letter-spacing: .06em; text-transform: uppercase; color: {MUTED}; border-bottom: 0.3mm solid {INK}; padding: 1.2mm 1.5mm; }}
.intro .st td {{ border-bottom: 0.2mm solid #ddd6cb; padding: 1.3mm 1.5mm; }}
.intro .small {{ font-size: 7pt; color: {MUTED}; margin-top: 3mm; }}
'''
    return f'<!doctype html><html lang="sr-Latn-ME"><head><meta charset="utf-8"><style>{css}</style></head><body>{"".join(pages)}</body></html>'


if __name__ == '__main__':
    from playwright.sync_api import sync_playwright
    os.makedirs(OUT_DIR, exist_ok=True)
    doc = build_html()
    tmp = os.path.join(OUT_DIR, '_cards.html')
    open(tmp, 'w', encoding='utf-8').write(doc)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto('file://' + tmp)
        pg.evaluate('document.fonts.ready')
        # any name that does not fit its line?
        over = pg.evaluate('''[...document.querySelectorAll('.card .names > div, .card .test')]
            .filter(el => el.scrollWidth > el.clientWidth + 0.5).map(el => el.textContent)''')
        fonts = pg.evaluate('[...document.fonts].map(f => f.family + ":" + f.status)')
        pg.pdf(path=OUT_PDF, prefer_css_page_size=True, print_background=True)
        b.close()
    os.remove(tmp)
    print('fonts', fonts)
    print('overflowing text:', over or 'none')
    print('wrote', OUT_PDF)
