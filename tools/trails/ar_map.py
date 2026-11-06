#!/usr/bin/env python3
"""Printed AR trail map ("AR mapa") for staze.html.

The phone finds the 8 ArUco markers in the dark frame around the map and puts the 3D relief exactly on the
printed map. The layout is scale-free: the page can be printed at any size (A4, A3, fit to page), only its
proportions matter.

usage: python3 tools/trails/ar_map.py
  -> data/staze-mapa.json                 marker layout read by js/staze-ar.js (millimetres at A4 size)
  -> print/staze/build/ar_mapa_*.html     print pages, turned into PDFs by tools/trails/ar_map_pdf.cjs
  -> print/staze/build/karta_print.jpg    the painted map (same picture as on the 3D terrain)
Then: node tools/trails/ar_map_pdf.cjs   -> print/staze/AR_mapa_staze_A4.pdf, AR_mapa_staze_A3.pdf (+ preview PNG)
"""
import base64
import html
import io
import json
import os
import struct

import cv2
import numpy as np
from PIL import Image
from reportlab.graphics.barcode.qrencoder import QRCode, QRErrorCorrectLevel

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "print", "staze")
BUILD = os.path.join(OUT, "build")
SITE = "https://gsgsgs84.github.io/gusinjska-bastina/"
URL = SITE + "staze.html?ar=1"

# ---------------- geometry (mm, A4 portrait) ----------------
PAGE_W, PAGE_H = 210.0, 297.0
MAP_W = 186.0                          # printed map width; height follows the terrain's proportions
FRAME_SIDE = 4.0                       # dark frame left/right of the map
BAND = 32.0                            # dark band above and below the map, holding the markers
TILE, MARKER = 30.0, 24.0              # white tile around each marker (quiet zone = 1 cell of 3 mm)
COLS = 4                               # markers per band
FRAME_TOP = 35.0                       # page y of the frame's top edge


def pick_ids(n):
    """n ids from ARUCO_MIP_36h12 that differ as much as possible (also when turned) from every code already
    printed for this project (cube, museum card, escape-room cards) and from each other."""
    d = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_ARUCO_MIP_36H12)
    N = d.bytesList.shape[0]
    codes = np.array([(cv2.aruco.generateImageMarker(d, i, 8, borderBits=1)[1:7, 1:7] > 127).astype(int) for i in range(N)])
    flat = codes.reshape(N, -1)
    rot = np.stack([np.rot90(codes, k, axes=(1, 2)) for k in range(4)], 1).reshape(N, 4, -1)
    D = np.array([(rot != flat[i][None, None]).sum(-1).min(1) for i in range(N)])
    np.fill_diagonal(D, 99)
    selfrot = np.array([min((rot[i, k] != flat[i]).sum() for k in (1, 2, 3)) for i in range(N)])
    white = flat.sum(1)
    lay = json.load(open(os.path.join(ROOT, "data", "layout.json")))
    soba = json.load(open(os.path.join(ROOT, "data", "soba.json")))
    used = [m["id"] for m in lay["markers"]] + [m["id"] for m in lay["card"]["markers"]] + [m["id"] for m in soba["markers"]]
    sel, out = list(used), []
    for _ in range(n):
        # ids 0-52 are kept free for the project's other prints
        cand = [c for c in range(53, N) if c not in sel and selfrot[c] >= 14 and abs(white[c] - 18) <= 4]
        best = max(cand, key=lambda c: (D[c, sel].min(), -abs(white[c] - 18), -c))
        out.append(int(best)); sel.append(best)
    mind = min(int(D[c, [s for s in sel if s != c]].min()) for c in out)
    return out, mind, d


def cells_of(d, i):
    img = cv2.aruco.generateImageMarker(d, i, 8, borderBits=1)
    return (img < 128).astype(int).tolist()          # 1 = black, same convention as data/layout.json


def layout():
    staze = json.load(open(os.path.join(ROOT, "data", "staze.json")))
    map_h = MAP_W * staze["depth"]
    ids, mind, d = pick_ids(2 * COLS)
    frame_w = MAP_W + 2 * FRAME_SIDE
    xs = [-(frame_w / 2) + FRAME_SIDE + TILE / 2 + k * (frame_w - 2 * FRAME_SIDE - TILE) / (COLS - 1) for k in range(COLS)]
    zt, zb = -(map_h / 2 + BAND / 2), map_h / 2 + BAND / 2
    markers = []
    for row, z in enumerate((zt, zb)):
        for k, x in enumerate(xs):
            i = ids[row * COLS + k]
            h = MARKER / 2
            markers.append({"id": i, "center": [round(x, 3), round(z, 3)],
                            "corners": [[round(x - h, 3), 0, round(z - h, 3)], [round(x + h, 3), 0, round(z - h, 3)],
                                        [round(x + h, 3), 0, round(z + h, 3)], [round(x - h, 3), 0, round(z + h, 3)]],
                            "cells": cells_of(d, i)})
    return {
        "name": "AR mapa planinarskih staza (Gusinje)",
        "dictionary": "ARUCO_MIP_36h12",
        "units": "mm at A4 size; the print may be any size (only proportions matter)",
        "frame": "map lies flat: plane Y = 0, normal +Y, page right = +X, page up (north) = -Z; origin at the map centre",
        "map": [MAP_W, round(map_h, 3)],
        "marker": MARKER, "tile": TILE, "cell": MARKER / 8,
        "minHamming": mind,
        "markers": markers,
    }, staze


# ---------------- painted map (the terrain texture) ----------------
def map_image(staze, px_w=2600):
    b = open(os.path.join(ROOT, staze["model"]), "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    bin0 = 20 + n + 8
    bv = j["bufferViews"][j["images"][0]["bufferView"]]
    im = Image.open(io.BytesIO(b[bin0 + bv.get("byteOffset", 0): bin0 + bv.get("byteOffset", 0) + bv["byteLength"]])).convert("RGB")
    # the 2048x2048 texture spans the whole map (u: west->east, v: north->south); give it the map's proportions
    w = px_w; h = round(px_w * staze["depth"])
    im = im.resize((w, h), Image.LANCZOS)
    path = os.path.join(BUILD, "karta_print.jpg")
    im.save(path, quality=90, optimize=True, progressive=True)
    return path


def qr_svg(text, size_mm):
    for ver in range(1, 15):              # smallest version that holds the text
        try:
            q = QRCode(ver, QRErrorCorrectLevel.M); q.addData(text); q.make()
            break
        except Exception:
            continue
    n = q.getModuleCount(); quiet = 3; tot = n + 2 * quiet
    rects = []
    for r in range(n):
        c = 0
        while c < n:
            if q.isDark(r, c):
                c1 = c
                while c1 < n and q.isDark(r, c1): c1 += 1
                rects.append(f'<rect x="{c + quiet}" y="{r + quiet}" width="{c1 - c}" height="1.02"/>')
                c = c1
            else:
                c += 1
    return (f'<svg class="qr" viewBox="0 0 {tot} {tot}" width="{size_mm}mm" height="{size_mm}mm" shape-rendering="crispEdges">'
            f'<rect width="{tot}" height="{tot}" fill="#fff"/><g fill="#17212a">{"".join(rects)}</g></svg>')


def marker_svg(cells):
    rects = []
    for i in range(8):
        j = 0
        while j < 8:
            if cells[i][j]:
                j1 = j
                while j1 < 8 and cells[i][j1]: j1 += 1
                rects.append(f'<rect x="{j}" y="{i}" width="{j1 - j}" height="1.01"/>')
                j = j1
            else:
                j += 1
    return f'<svg viewBox="0 0 8 8" shape-rendering="crispEdges"><g fill="#000">{"".join(rects)}</g></svg>'


T = {
    "title": "Planinarske staze Gusinja",
    "sub": [("ME", "AR mapa · teren izraste iz papira"), ("SQ", "Harta AR · terreni ngrihet nga letra"), ("EN", "AR map · the terrain rises from the paper")],
    "steps": [("1", "Skeniraj", "Skanoni", "Scan"), ("2", "Usmjeri", "Drejtoni", "Point"), ("3", "Istraži", "Eksploroni", "Explore")],
    "north": "SJEVER<br>VERI · NORTH",
    "legend_h": "Staze",
    "support": "Uz podršku: Turistička organizacija Gusinje · Ministarstvo turizma Crne Gore",
    "print": "Štampajte u bilo kojoj veličini (A4, A3…), bez sjenčenja i bez mijenjanja proporcija. Mat papir radi najbolje.",
}


def page_html(lay, staze, img_path, page="A4"):
    k = 1.0 if page == "A4" else 2 ** 0.5
    map_w, map_h = lay["map"]
    frame_w = map_w + 2 * FRAME_SIDE
    frame_h = map_h + 2 * BAND
    fx = (PAGE_W - frame_w) / 2
    W = staze["widthM"]
    # trails and labels in map millimetres (x: 0..map_w east, y: 0..map_h south)
    X = lambda x: (x + 0.5) * map_w
    Y = lambda z: (z / staze["depth"] + 0.5) * map_h
    paths = []
    order = sorted(staze["trails"], key=lambda t: {"bike": 0, "long": 1}.get(t["style"], 2))
    for t in order:
        for s in t["segs"]:
            pts = " ".join(f"{X(s[i]):.2f},{Y(s[i + 2]):.2f}" for i in range(0, len(s), 3))
            dash = ' stroke-dasharray="2.2 1.2"' if t["style"] == "long" else ""
            paths.append(f'<polyline class="cas" points="{pts}"/><polyline points="{pts}" stroke="{t["color"]}"{dash}/>')
    labels, boxes = [], []
    for p in sorted(staze["places"], key=lambda q: q.get("rank", 3)):
        x, z = X(p["pos"][0]), Y(p["pos"][2])
        name = p["name"]["me"]
        if p["kind"] == "peak" or p["kind"] == "pass":
            txt = f'▲ {name} {p["ele"]}' if p.get("ele") else f"▲ {name}"
            cls = "pk"
        elif p["kind"] == "town":
            txt, cls = name, "town"
        elif p["kind"] == "valley":
            txt, cls = name, "val"
        elif p["kind"] == "sight":
            txt, cls = "◆ " + name, "sight"
        else:
            txt, cls = name, "vil"
        anchor = "end" if x > map_w - 26 else "start" if x < 26 else "middle"
        dx = -1.2 if anchor == "end" else 1.2 if anchor == "start" else 0
        fs = {"town": 3.5, "vil": 2.5, "val": 2.6, "sight": 2.05}.get(cls, 2.2)
        w = len(txt) * fs * 0.58 + 1.0
        x0 = x + dx - (w if anchor == "end" else w / 2 if anchor == "middle" else 0)
        box = (x0, z - 1.2 - fs, x0 + w, z - 0.6)
        if any(box[0] < q[2] and box[2] > q[0] and box[1] < q[3] and box[3] > q[1] for q in boxes):
            continue
        boxes.append(box)
        labels.append(f'<text class="{cls}" x="{x + dx:.2f}" y="{z - 1.2:.2f}" text-anchor="{anchor}">{html.escape(txt)}</text>'
                      + (f'<circle cx="{x:.2f}" cy="{z:.2f}" r="0.7" class="pin"/>' if cls in ("town", "vil") else ""))
    # scale bar: 5 km
    km5 = 5000 / W * map_w
    tiles = []
    for m in lay["markers"]:
        cx = m["center"][0] + frame_w / 2
        cz = m["center"][1] + frame_h / 2
        tiles.append(f'<div class="tile" style="left:{(cx - TILE / 2) * k:.3f}mm;top:{(cz - TILE / 2) * k:.3f}mm">'
                     f'<div class="mk">{marker_svg(m["cells"])}</div></div>')
    colors, styles = staze["colors"], staze["styles"]
    legend = "".join(f'<span class="li"><i style="background:{colors[s]}{";background:repeating-linear-gradient(90deg," + colors[s] + " 0 2.2mm,transparent 2.2mm 3.4mm)" if s == "long" else ""}"></i>'
                     f'{html.escape(styles[s]["me"])}<em>{html.escape(styles[s]["en"])}</em></span>' for s in colors)
    xs_gap = [(lay["markers"][i]["center"][0] + lay["markers"][i + 1]["center"][0]) / 2 + frame_w / 2 for i in range(COLS - 1)]
    steps = "".join(
        f'<div class="step" style="left:{(x - 11) * k:.3f}mm;top:{(frame_h - BAND / 2 - 9.5) * k:.3f}mm"><b>{n}</b><span>{a}</span><small>{s} · {e}</small></div>'
        for x, (n, a, s, e) in zip(xs_gap, T["steps"]))
    north = (f'<div class="nlab" style="left:{(xs_gap[1] - 14) * k:.3f}mm;top:{(BAND / 2 - 5) * k:.3f}mm">'
             f'<svg viewBox="0 0 10 12"><path d="M5 0 L9 11 L5 8.4 L1 11 Z"/></svg><span>{T["north"]}</span></div>')
    img_b64 = base64.b64encode(open(img_path, "rb").read()).decode()
    sub = "".join(f'<span><b>{c}</b> {html.escape(s)}</span>' for c, s in T["sub"])
    logo = open(os.path.join(ROOT, "icons", "xplore-prokletije.svg"), encoding="utf-8").read()
    logo = logo[logo.index("<svg"):]
    css = f"""
@page {{ size: {page}; margin: 0; }}
* {{ box-sizing: border-box; }}
html, body {{ margin: 0; padding: 0; }}
body {{ width: {PAGE_W * k}mm; height: {PAGE_H * k}mm; position: relative; background: #f6f1e7; color: #221e19;
  font-family: Poppins, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; overflow: hidden; }}
.hd {{ position: absolute; left: {fx * k}mm; right: {fx * k}mm; top: {9 * k}mm; height: {24 * k}mm; display: flex; align-items: center; gap: {5 * k}mm; }}
.hd .t {{ flex: 1; min-width: 0; }}
.hd h1 {{ font: 700 {25 * k}pt/1.0 Caladea, serif; margin: 0 0 {1.6 * k}mm; letter-spacing: -0.01em; }}
.hd .sub {{ display: flex; flex-wrap: wrap; gap: {0.4 * k}mm {3.2 * k}mm; font-size: {7.4 * k}pt; color: #5b5248; }}
.hd .sub b {{ color: #a4641f; font-weight: 700; letter-spacing: .04em; margin-right: {0.6 * k}mm; }}
.hd .logo {{ width: {32 * k}mm; height: {13.1 * k}mm; flex: none; }}
.hd .logo svg {{ width: 100%; height: 100%; }}
.hd .q {{ flex: none; text-align: center; font-size: {6 * k}pt; color: #5b5248; line-height: 1.15; }}
.hd .q svg {{ display: block; margin: 0 auto {0.6 * k}mm; border-radius: {1 * k}mm; }}
.fr {{ position: absolute; left: {fx * k}mm; top: {FRAME_TOP * k}mm; width: {frame_w * k}mm; height: {frame_h * k}mm;
  background: #24352b; border-radius: {3.5 * k}mm; }}
.map {{ position: absolute; left: {FRAME_SIDE * k}mm; top: {BAND * k}mm; width: {map_w * k}mm; height: {map_h * k}mm; overflow: hidden; }}
.map img, .map svg {{ position: absolute; inset: 0; width: 100%; height: 100%; display: block; }}
.map polyline {{ fill: none; stroke-width: 0.62; stroke-linejoin: round; stroke-linecap: round; }}
.map polyline.cas {{ stroke: rgba(255,255,255,.85); stroke-width: 1.15; }}
.map text {{ font-family: Poppins, sans-serif; font-size: 2.2px; font-weight: 500; fill: #221e19; paint-order: stroke; stroke: rgba(255,252,246,.92); stroke-width: .75px; stroke-linejoin: round; }}
.map text.town {{ font-size: 3.5px; font-weight: 700; }}
.map text.vil {{ font-size: 2.5px; font-weight: 700; }}
.map text.val {{ font-style: italic; font-weight: 500; fill: #2c3b33; font-size: 2.6px; }}
.map text.pk {{ fill: #4e3217; }}
.map text.sight {{ fill: #1f5f8b; font-size: 2.05px; }}
.map .pin {{ fill: #221e19; stroke: #fff; stroke-width: .35; }}
.scale {{ position: absolute; left: {4 * k}mm; bottom: {3.5 * k}mm; font-size: {6 * k}pt; font-weight: 500; color: #221e19;
  background: rgba(255,252,246,.86); border-radius: {1 * k}mm; padding: {0.8 * k}mm {1.6 * k}mm {1 * k}mm; }}
.scale i {{ display: block; width: {km5 * k}mm; height: {1.1 * k}mm; margin-top: {0.6 * k}mm; background: linear-gradient(90deg,#221e19 0 20%,#fff 20% 40%,#221e19 40% 60%,#fff 60% 80%,#221e19 80%); border: {0.15 * k}mm solid #221e19; }}
.tile {{ position: absolute; width: {TILE * k}mm; height: {TILE * k}mm; background: #fff; border-radius: {1.6 * k}mm; }}
.tile .mk {{ position: absolute; inset: {(TILE - MARKER) / 2 * k}mm; }}
.tile svg {{ width: 100%; height: 100%; display: block; }}
.step {{ position: absolute; width: {22 * k}mm; height: {19 * k}mm; color: #f3ede3; text-align: center; line-height: 1.12; }}
.step b {{ display: grid; place-items: center; width: {6.2 * k}mm; height: {6.2 * k}mm; margin: 0 auto {1 * k}mm; border-radius: 50%; background: #d89a4e; color: #24352b; font-size: {8.5 * k}pt; font-weight: 700; }}
.step span {{ display: block; font-size: {8.2 * k}pt; font-weight: 700; }}
.step small {{ display: block; font-size: {5.6 * k}pt; opacity: .8; margin-top: {0.4 * k}mm; }}
.nlab {{ position: absolute; width: {28 * k}mm; height: {10 * k}mm; display: flex; align-items: center; justify-content: center; gap: {1.6 * k}mm; color: #f3ede3; font-size: {6.4 * k}pt; font-weight: 500; letter-spacing: .05em; line-height: 1.2; }}
.nlab svg {{ width: {3.4 * k}mm; height: {4.2 * k}mm; fill: #d89a4e; }}
.ft {{ position: absolute; left: {fx * k}mm; right: {fx * k}mm; top: {(FRAME_TOP + frame_h + 2.6) * k}mm; font-size: {6.6 * k}pt; color: #4b433a; }}
.ft .lg {{ display: flex; flex-wrap: wrap; gap: {0.8 * k}mm {3.4 * k}mm; align-items: center; }}
.ft .lg h4 {{ margin: 0 {1 * k}mm 0 0; font: 700 {7.6 * k}pt Caladea, serif; color: #221e19; }}
.ft .li {{ display: inline-flex; align-items: center; gap: {1.2 * k}mm; font-weight: 500; }}
.ft .li em {{ font-style: normal; font-weight: 400; color: #7a7064; }}
.ft .li i {{ display: inline-block; width: {5.5 * k}mm; height: {1.3 * k}mm; border-radius: {0.65 * k}mm; }}
.ft p {{ margin: {1.2 * k}mm 0 0; font-size: {5.6 * k}pt; color: #7a7064; line-height: 1.35; }}
"""
    return f"""<!doctype html><html lang="sr-ME"><head><meta charset="utf-8"><title>AR mapa planinarskih staza – {page}</title>
<style>{css}</style></head><body>
<header class="hd"><div class="logo">{logo}</div><div class="t"><h1>{html.escape(T["title"])}</h1><div class="sub">{sub}</div></div>
<div class="q">{qr_svg(URL, round(20 * k, 2))}gsgsgs84.github.io<br>/gusinjska-bastina/staze.html</div></header>
<div class="fr">
  <div class="map"><img src="data:image/jpeg;base64,{img_b64}" alt="">
    <svg viewBox="0 0 {map_w:.3f} {map_h:.3f}" preserveAspectRatio="none">{''.join(paths)}{''.join(labels)}</svg>
    <div class="scale">5 km<i></i></div>
  </div>
  {''.join(tiles)}{north}{steps}
</div>
<footer class="ft"><div class="lg"><h4>{T["legend_h"]}</h4>{legend}</div>
<p>{html.escape(T["print"])} Podaci: © OpenStreetMap contributors (ODbL); Copernicus DEM GLO-30 © DLR e.V. 2010–2014 i © Airbus Defence and Space GmbH 2014–2018, COPERNICUS (EU i ESA); staza Tri vrha: peaksofthebalkans.info. {html.escape(T["support"])}</p></footer>
</body></html>"""


def main():
    os.makedirs(BUILD, exist_ok=True)
    lay, staze = layout()
    json.dump(lay, open(os.path.join(ROOT, "data", "staze-mapa.json"), "w"), separators=(",", ":"))
    print("marker ids", [m["id"] for m in lay["markers"]], "min Hamming distance to all project codes", lay["minHamming"])
    img = map_image(staze)
    for page in ("A4", "A3"):
        p = os.path.join(BUILD, f"ar_mapa_{page}.html")
        open(p, "w", encoding="utf-8").write(page_html(lay, staze, img, page))
        print("wrote", p)


if __name__ == "__main__":
    main()
