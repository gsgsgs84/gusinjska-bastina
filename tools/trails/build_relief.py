#!/usr/bin/env python3
"""Build the Gusinje trail relief: a terrain block (GLB with a painted map texture) plus trail and place data.

usage: python3 tools/trails/build_relief.py RAW_DIR [--preview]
  RAW_DIR is data-raw/ from the trails-data branch (Copernicus DEM, GPX files, OpenStreetMap extract).

Outputs (in the repo):
  models/staze/teren.glb   terrain block, true vertical scale, 1 unit = model width
  data/staze.json          trails (draped polylines), places, projection, credits

Model frame: x east, y up, z south. The area 19.74–19.95 E, 42.45–42.60 N spans x in [-0.5, 0.5].
Heights are true scale (y = (elevation - BASE) / WIDTH_M); the app applies vertical exaggeration.
"""
import json, math, os, re, struct, sys, io, xml.etree.ElementTree as ET
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import map_coordinates, gaussian_filter
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
RAW = ARGS[0] if ARGS else os.path.join(REPO, "data-raw")
CFG = json.load(open(os.path.join(HERE, "trails_config.json"), encoding="utf-8"))

W, S, E, N = CFG["bbox"]
LAT0 = (S + N) / 2
MX = 111412.84 * math.cos(math.radians(LAT0)) - 93.5 * math.cos(math.radians(3 * LAT0))   # m per degree lon
MZ = 111132.954 - 559.822 * math.cos(math.radians(2 * LAT0)) + 1.175 * math.cos(math.radians(4 * LAT0))
WIDTH_M, DEPTH_M = (E - W) * MX, (N - S) * MZ
D = DEPTH_M / WIDTH_M                       # model depth in units
NX = 257
NZ = round((NX - 1) * D) + 1
TEX = 2048

# ---------------------------------------------------------------- elevation
dem_meta = json.load(open(os.path.join(RAW, "dem_cop30.json")))
DEM = np.asarray(Image.open(os.path.join(RAW, "dem_cop30.png"))).astype(np.float32) / 10.0


def elev(lon, lat, dem=DEM, order=1):
    px = (np.asarray(lon) - dem_meta["west"]) / dem_meta["dx"] - 0.5
    py = (np.asarray(lat) - dem_meta["north"]) / dem_meta["dy"] - 0.5
    return map_coordinates(dem, [np.ravel(py), np.ravel(px)], order=order, mode="nearest").reshape(np.shape(lon))


def to_unit(lon, lat):
    x = (np.asarray(lon) - W) * MX / WIDTH_M - 0.5
    z = (N - np.asarray(lat)) * MZ / WIDTH_M - D / 2
    return x, z


def to_lonlat(x, z):
    lon = (np.asarray(x) + 0.5) * WIDTH_M / MX + W
    lat = N - (np.asarray(z) + D / 2) * WIDTH_M / MZ
    return lon, lat


# terrain grid (smoothed a little so the 67 m mesh does not alias the 30 m data)
DEM_SMOOTH = gaussian_filter(DEM, 0.9)
gx = np.linspace(-0.5, 0.5, NX)
gz = np.linspace(-D / 2, D / 2, NZ)
GX, GZ = np.meshgrid(gx, gz)
glon, glat = to_lonlat(GX, GZ)
HE = elev(glon, glat, DEM_SMOOTH)
BASE = math.floor((HE.min() - 150) / 10) * 10
HY = HY_MAIN = (HE - BASE) / WIDTH_M
print(f"area {WIDTH_M:.0f} x {DEPTH_M:.0f} m, grid {NX}x{NZ}, elevation {HE.min():.0f}-{HE.max():.0f} m, base {BASE} m")


def surface_y(x, z, HY=None):
    """Exact height of the triangulated terrain surface (same split as the mesh indices)."""
    HY = HY_MAIN if HY is None else HY
    NZ, NX = HY.shape
    fx = (np.asarray(x) + 0.5) * (NX - 1)
    fz = (np.asarray(z) + D / 2) / D * (NZ - 1)
    j = np.clip(np.floor(fx).astype(int), 0, NX - 2)
    i = np.clip(np.floor(fz).astype(int), 0, NZ - 2)
    u, v = np.clip(fx - j, 0, 1), np.clip(fz - i, 0, 1)
    h00, h10, h01, h11 = HY[i, j], HY[i, j + 1], HY[i + 1, j], HY[i + 1, j + 1]
    low = u + v <= 1
    a = h00 + u * (h10 - h00) + v * (h01 - h00)
    b = h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11)
    return np.where(low, a, b)


# ---------------------------------------------------------------- OpenStreetMap
OSM = json.load(open(os.path.join(RAW, "osm.json"), encoding="utf-8"))["elements"]
OSM_BY_ID = {(e["type"], e["id"]): e for e in OSM}


def way_coords(g):
    return [(p["lon"], p["lat"]) for p in g if p]


def chain(lines, tol=1e-6):
    """Join polylines that share end points into longer lines (greedy)."""
    lines = [list(l) for l in lines if len(l) > 1]
    out = []
    while lines:
        cur = lines.pop(0)
        grown = True
        while grown:
            grown = False
            for k, l in enumerate(lines):
                if abs(l[0][0] - cur[-1][0]) < tol and abs(l[0][1] - cur[-1][1]) < tol:
                    cur += l[1:]
                elif abs(l[-1][0] - cur[-1][0]) < tol and abs(l[-1][1] - cur[-1][1]) < tol:
                    cur += l[::-1][1:]
                elif abs(l[-1][0] - cur[0][0]) < tol and abs(l[-1][1] - cur[0][1]) < tol:
                    cur = l + cur[1:]
                elif abs(l[0][0] - cur[0][0]) < tol and abs(l[0][1] - cur[0][1]) < tol:
                    cur = l[::-1] + cur[1:]
                else:
                    continue
                lines.pop(k)
                grown = True
                break
        out.append(cur)
    return out


def relation_lines(rid, roles=("",)):
    rel = OSM_BY_ID[("relation", rid)]
    segs = [way_coords(m["geometry"]) for m in rel["members"]
            if m["type"] == "way" and "geometry" in m and m.get("role", "") in roles]
    return chain(segs)


def gpx_lines(path):
    root = ET.parse(path).getroot()
    out = []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag in ("trkseg", "rte"):
            pts = [(float(p.get("lon")), float(p.get("lat"))) for p in el if p.tag.split("}")[-1] in ("trkpt", "rtept")]
            if len(pts) > 1:
                out.append(pts)
    return out


# ---------------------------------------------------------------- geometry helpers
def metres(lines):
    return [np.c_[(np.array(l)[:, 0] - W) * MX, (N - np.array(l)[:, 1]) * MZ] for l in lines]


def clip_runs(pm, margin=60.0):
    """Split a metre polyline into runs inside the model area (minus a margin)."""
    inside = (pm[:, 0] > margin) & (pm[:, 0] < WIDTH_M - margin) & (pm[:, 1] > margin) & (pm[:, 1] < DEPTH_M - margin)
    runs, cur = [], []
    for p, ok in zip(pm, inside):
        if ok:
            cur.append(p)
        elif cur:
            runs.append(np.array(cur)); cur = []
    if cur:
        runs.append(np.array(cur))
    return [r for r in runs if len(r) > 1]


def resample(pm, step):
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(pm, axis=0).T))]
    if d[-1] < step:
        return pm
    t = np.linspace(0, d[-1], int(math.ceil(d[-1] / step)) + 1)
    return np.c_[np.interp(t, d, pm[:, 0]), np.interp(t, d, pm[:, 1])]


def simplify(pm, tol):
    if len(pm) < 3:
        return pm
    keep = np.zeros(len(pm), bool); keep[0] = keep[-1] = True
    stack = [(0, len(pm) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pm[a], pm[b]
        seg = q - p; L = np.hypot(*seg)
        r = pm[a + 1:b] - p
        dist = np.abs(r[:, 0] * seg[1] - r[:, 1] * seg[0]) / L if L > 1e-6 else np.hypot(r[:, 0], r[:, 1])   # closed loop
        k = int(np.argmax(dist))
        if dist[k] > tol:
            keep[a + 1 + k] = True
            stack += [(a, a + 1 + k), (a + 1 + k, b)]
    return pm[keep]


def length_m(pm):
    return float(np.hypot(*np.diff(pm, axis=0).T).sum()) if len(pm) > 1 else 0.0


# ---------------------------------------------------------------- map-matching to OSM paths
NET_TYPES = {"path", "footway", "bridleway", "track", "unclassified", "residential", "tertiary", "secondary", "steps"}
NET = []
for e in OSM:
    if e["type"] == "way" and e.get("tags", {}).get("highway") in NET_TYPES and "geometry" in e:
        pm = metres([way_coords(e["geometry"])])[0]
        if len(pm) > 1:
            NET.append(resample(pm, 8.0))


def osm_match(lines_m, radius=30.0, min_run=40.0):
    """Follow a third-party track along the OpenStreetMap ways it uses.

    Returns one continuous line per input line: OpenStreetMap geometry wherever a mapped way runs
    within `radius` of the track, and the track itself only across the gaps. Also returns the share
    of the length that comes from OpenStreetMap."""
    out, osm_len, all_len = [], 0.0, 0.0
    for line in lines_m:
        track = resample(line, 8.0)
        kd = cKDTree(track)
        pieces = []
        for w in NET:
            d, idx = kd.query(w, distance_upper_bound=radius)
            ok = np.isfinite(d)
            if not ok.any():
                continue
            start = None
            for k in range(len(w) + 1):
                if k < len(w) and ok[k]:
                    if start is None:
                        start = k
                elif start is not None:
                    run, ti = w[start:k], idx[start:k]
                    if length_m(run) >= min_run:
                        if ti[-1] < ti[0]:
                            run, ti = run[::-1], ti[::-1]
                        pieces.append((int(ti[0]), int(ti[-1]), run, ti))
                    start = None
        pieces.sort(key=lambda p: p[0])
        pts, last = [], -1
        for t0, t1, run, ti in pieces:
            if t1 <= last + 2:
                continue                       # already covered (duplicate or parallel way)
            keep = ti > last
            run, ti = run[keep], ti[keep]
            if len(run) < 2:
                continue
            if ti[0] > last + 1:              # gap: use the track itself
                pts.extend(track[last + 1:ti[0]])
            pts.extend(run)
            osm_len += length_m(run)
            last = int(ti[-1])
        if last < len(track) - 1:
            pts.extend(track[last + 1:])
        pts = np.array(pts)
        all_len += length_m(pts)
        out.append(pts)
    return out, (osm_len / all_len if all_len else 0.0)


# ---------------------------------------------------------------- trails
COLORS = CFG["colors"]
trails_out, credits = [], set()
for t in CFG["trails"]:
    src = t["geometry"]
    if src.startswith("osm:"):
        lines = relation_lines(int(src[4:]), tuple(t.get("roles", [""])))
        lines_m = metres(lines)
        note = "OpenStreetMap relation " + src[4:]
    else:
        lines_m = metres(gpx_lines(os.path.join(RAW, "gpx", src)))
        note = "GPX " + src
    if t.get("match_osm"):
        matched, cov = osm_match(lines_m)
        print(f"  {t['id']}: OpenStreetMap covers {cov:.0%} of the track")
        if cov >= t.get("min_coverage", 0.85):
            lines_m = matched
            note = f"OpenStreetMap ways matched to {src} ({cov:.0%})"
            t = dict(t, source="OpenStreetMap")
        else:
            note += f" (OpenStreetMap only covers {cov:.0%})"
    segs, total = [], 0.0
    for l in lines_m:
        for run in clip_runs(l):
            run = simplify(run, 4.0)
            run = resample(run, 22.0)
            if length_m(run) < (40 if t.get("match_osm") else 150):
                continue
            total += length_m(run)
            x = run[:, 0] / WIDTH_M - 0.5
            z = run[:, 1] / WIDTH_M - D / 2
            y = surface_y(x, z)
            segs.append(np.round(np.c_[x, y, z].ravel(), 5).tolist())
    if not segs:
        print("  skipped (outside the area):", t["id"]); continue
    if not t.get("match_osm"):
        segs.sort(key=len, reverse=True)   # longest first; matched tracks keep their walking order
    out = {k: t[k] for k in t if k not in ("geometry", "match_osm", "min_coverage", "roles")}
    out["color"] = COLORS[t["style"]]
    out["mapKm"] = round(total / 1000, 1)
    out["segs"] = segs
    out["geomNote"] = note
    trails_out.append(out)
    credits.add(t["source"])
    print(f"  {t['id']}: {len(segs)} segment(s), {total / 1000:.1f} km in the area")

# ---------------------------------------------------------------- places
places_out = []
for p in CFG["places"]:
    if "osm" in p:
        typ, oid = p["osm"].split("/")
        e = OSM_BY_ID[(typ, int(oid))]
        if typ == "node":
            lon, lat = e["lon"], e["lat"]
        else:
            g = e.get("geometry") or [pt for m in e.get("members", []) for pt in m.get("geometry", [])]
            lon = float(np.mean([q["lon"] for q in g])); lat = float(np.mean([q["lat"] for q in g]))
    else:
        lon, lat = p["lon"], p["lat"]
    x, z = to_unit(lon, lat)
    if abs(x) > 0.5 or abs(z) > D / 2:
        print("  place outside the area:", p["id"]); continue
    q = {k: p[k] for k in p if k not in ("osm", "lon", "lat")}
    q["pos"] = [round(float(x), 5), round(float(surface_y(x, z)), 5), round(float(z), 5)]
    if p["kind"] == "peak" and "ele" not in p:
        q["ele"] = int(round(float(elev(lon, lat))))
    places_out.append(q)

# ---------------------------------------------------------------- texture
print("painting the map texture…")
tu = (np.arange(TEX) + 0.5) / TEX
TX, TZ = np.meshgrid(tu - 0.5, tu * D - D / 2)
tlon, tlat = to_lonlat(TX, TZ)
TH = elev(tlon, tlat, gaussian_filter(DEM, 0.6), order=3)
px_m = WIDTH_M / TEX, DEPTH_M / TEX
dzdy, dzdx = np.gradient(TH, px_m[1], px_m[0])


def shade(az, alt, ex=2.0):
    az, alt = math.radians(az), math.radians(alt)
    nx_, nz_ = -dzdx * ex, -dzdy * ex
    n = np.sqrt(nx_ ** 2 + nz_ ** 2 + 1)
    # light direction: azimuth from north, clockwise; image y grows southwards
    lx, ly, lz = math.sin(az) * math.cos(alt), -math.cos(az) * math.cos(alt), math.sin(alt)
    return np.clip((nx_ * lx + nz_ * ly + lz) / n, 0, 1)


hs = 0.62 * shade(315, 40) + 0.2 * shade(270, 55) + 0.18 * shade(0, 60)
slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
stops = np.array(CFG["hypso"], float)          # [elevation, r, g, b]
col = np.stack([np.interp(TH, stops[:, 0], stops[:, c]) for c in (1, 2, 3)], -1)
rock = np.array(CFG["rock"], float)
rk = np.clip((slope - 32) / 16, 0, 1)[..., None] * np.clip((TH - 1250) / 400, 0, 1)[..., None]
col = col * (1 - rk) + rock * rk
light = (0.5 + 0.72 * hs)[..., None]
base = np.clip(col * light, 0, 255).astype(np.uint8)
img = Image.fromarray(base, "RGB").convert("RGBA")

# overlays drawn at 2x and scaled down for smooth lines
SS = 2
ov = Image.new("RGBA", (TEX * SS, TEX * SS), (0, 0, 0, 0))
dr = ImageDraw.Draw(ov)


def tex_xy(coords):
    a = np.array(coords)
    x, z = to_unit(a[:, 0], a[:, 1])
    return list(zip(((x + 0.5) * TEX * SS).tolist(), ((z + D / 2) / D * TEX * SS).tolist()))


def dashed(pts, width, color, on, off):
    pts = np.array(pts)
    if len(pts) < 2:
        return
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    t, period = 0.0, on + off
    while t < d[-1]:
        a, b = t, min(t + on, d[-1])
        idx = (d > a) & (d < b)
        seg = [tuple(np.interp([a], d, pts[:, k])[0] for k in (0, 1))] + [tuple(p) for p in pts[idx]] + \
              [tuple(np.interp([b], d, pts[:, k])[0] for k in (0, 1))]
        dr.line(seg, fill=color, width=width, joint="curve")
        t += period


def ways(pred):
    for e in OSM:
        if e["type"] == "way" and pred(e.get("tags", {})) and "geometry" in e:
            yield way_coords(e["geometry"])


ST = CFG["map_style"]
for e in OSM:            # lakes
    tg = e.get("tags", {})
    if tg.get("natural") != "water":
        continue
    if e["type"] == "way" and "geometry" in e:
        dr.polygon(tex_xy(way_coords(e["geometry"])), fill=tuple(ST["water"]))
    elif e["type"] == "relation":
        for ring in chain([way_coords(m["geometry"]) for m in e["members"] if m.get("role") == "outer" and "geometry" in m]):
            dr.polygon(tex_xy(ring), fill=tuple(ST["water"]))
for c in ways(lambda t: t.get("waterway") == "stream"):
    dr.line(tex_xy(c), fill=tuple(ST["stream"]), width=3, joint="curve")
for c in ways(lambda t: t.get("waterway") == "river"):
    dr.line(tex_xy(c), fill=tuple(ST["river"]), width=7, joint="curve")
for c in ways(lambda t: t.get("highway") in ("path", "footway", "bridleway")):
    dashed(tex_xy(c), 2, tuple(ST["path"]), 7, 7)
for c in ways(lambda t: t.get("highway") == "track"):
    dashed(tex_xy(c), 3, tuple(ST["track"]), 16, 8)
for c in ways(lambda t: t.get("highway") in ("secondary", "tertiary", "unclassified")):
    dr.line(tex_xy(c), fill=tuple(ST["road_case"]), width=9, joint="curve")
for c in ways(lambda t: t.get("highway") == "residential"):
    dr.line(tex_xy(c), fill=tuple(ST["road_case"]), width=6, joint="curve")
for c in ways(lambda t: t.get("highway") == "residential"):
    dr.line(tex_xy(c), fill=tuple(ST["road"]), width=3, joint="curve")
for c in ways(lambda t: t.get("highway") in ("secondary", "tertiary", "unclassified")):
    dr.line(tex_xy(c), fill=tuple(ST["road"]), width=5, joint="curve")
for c in ways(lambda t: t.get("boundary") == "administrative" and t.get("admin_level") == "2"):
    dashed(tex_xy(c), 9, tuple(ST["border_halo"]), 40, 18)
    dashed(tex_xy(c), 5, tuple(ST["border"]), 40, 18)
ov = ov.resize((TEX, TEX), Image.LANCZOS)
img = Image.alpha_composite(img, ov).convert("RGB")
buf = io.BytesIO()
img.save(buf, "JPEG", quality=86, optimize=True, progressive=False)
JPEG = buf.getvalue()
if "--preview" in sys.argv:
    img.resize((900, 900), Image.LANCZOS).save("texture_preview.jpg", quality=85)
print(f"texture {len(JPEG) / 1e6:.2f} MB")

# ---------------------------------------------------------------- mesh
P = np.stack([GX, HY, GZ], -1).astype(np.float32)
dx_u, dz_u = 1 / (NX - 1), D / (NZ - 1)
dhz, dhx = np.gradient(HY, dz_u, dx_u)
Nrm = np.stack([-dhx, np.ones_like(HY), -dhz], -1)
Nrm /= np.linalg.norm(Nrm, axis=-1, keepdims=True)
UV = np.stack([(GX + 0.5), (GZ + D / 2) / D], -1)
ii, jj = np.meshgrid(np.arange(NZ - 1), np.arange(NX - 1), indexing="ij")
a = (ii * NX + jj).ravel()
top_idx = np.stack([a, a + NX, a + 1, a + 1, a + NX, a + NX + 1], -1).ravel()   # counter-clockwise seen from above
top = dict(pos=P.reshape(-1, 3), nrm=Nrm.reshape(-1, 3).astype(np.float32), uv=UV.reshape(-1, 2).astype(np.float32),
           idx=top_idx.astype(np.uint32), material=0)

# side walls and bottom
wp, wn, wi = [], [], []


def wall(edge, normal):
    b = len(wp)
    for p in edge:
        wp.extend([[p[0], p[1], p[2]], [p[0], 0.0, p[2]]]); wn.extend([normal, normal])
    for k in range(len(edge) - 1):
        q = b + 2 * k
        wi.extend([q, q + 1, q + 2, q + 2, q + 1, q + 3])


wall(P[0, ::-1], [0, 0, -1])            # north edge, walked east->west so it faces outward
wall(P[-1, :], [0, 0, 1])               # south
wall(P[:, 0], [-1, 0, 0])               # west, north->south
wall(P[::-1, -1], [1, 0, 0])            # east, south->north
# fix winding so every wall faces outward
wp_a, wn_a, wi_a = np.array(wp, np.float32), np.array(wn, np.float32), np.array(wi, np.uint32).reshape(-1, 3)
tri = wp_a[wi_a]
fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
flip = (fn * wn_a[wi_a[:, 0]]).sum(1) < 0
wi_a[flip] = wi_a[flip][:, [0, 2, 1]]
b0 = len(wp_a)
x0, x1, z0, z1 = -0.5, 0.5, -D / 2, D / 2
bottom_p = np.array([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], np.float32)
bottom_i = np.array([[b0, b0 + 1, b0 + 2], [b0, b0 + 2, b0 + 3]], np.uint32)
sides = dict(pos=np.vstack([wp_a, bottom_p]), nrm=np.vstack([wn_a, np.tile([[0, -1, 0]], (4, 1))]).astype(np.float32),
             uv=None, idx=np.vstack([wi_a, bottom_i]).ravel(), material=1)


def write_glb(path, prims, materials, images, extensions=()):
    """prims: dicts with pos, nrm, uv (or None), idx, material. images: [(bytes, mime)], one texture each."""
    bufs, views, acc = [], [], []

    def add_view(data, target=None):
        off = sum(len(b) for b in bufs)
        pad = (4 - len(data) % 4) % 4
        bufs.append(data + b"\0" * pad)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            v["target"] = target
        views.append(v)
        return len(views) - 1

    def add_acc(arr, typ, ctype, target, minmax=False):
        v = add_view(arr.tobytes(), target)
        a = {"bufferView": v, "componentType": ctype, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = arr.min(0).tolist(); a["max"] = arr.max(0).tolist()
        acc.append(a)
        return len(acc) - 1

    meshes = []
    for pr in prims:
        attrs = {"POSITION": add_acc(pr["pos"].astype(np.float32), "VEC3", 5126, 34962, True),
                 "NORMAL": add_acc(pr["nrm"].astype(np.float32), "VEC3", 5126, 34962)}
        if pr["uv"] is not None:
            attrs["TEXCOORD_0"] = add_acc(pr["uv"].astype(np.float32), "VEC2", 5126, 34962)
        idx = pr["idx"].astype(np.uint16 if pr["pos"].shape[0] < 65535 else np.uint32)
        ia = add_acc(idx.reshape(-1, 1), "SCALAR", 5123 if idx.dtype == np.uint16 else 5125, 34963)
        meshes.append({"attributes": attrs, "indices": ia, "material": pr["material"]})
    imgs = [{"bufferView": add_view(data), "mimeType": mime} for data, mime in images]
    g = {"asset": {"version": "2.0", "generator": "gusinjska-bastina trails relief"},
         "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "teren"}],
         "meshes": [{"name": "teren", "primitives": meshes}], "materials": materials,
         "textures": [{"source": k, "sampler": 0} for k in range(len(imgs))],
         "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
         "images": imgs, "buffers": [{"byteLength": sum(len(b) for b in bufs)}], "bufferViews": views, "accessors": acc}
    if extensions:
        g["extensionsUsed"] = list(extensions)
    js = json.dumps(g, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    blob = b"".join(bufs)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 28 + len(js) + len(blob)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(blob), 0x004E4942)); f.write(blob)


mats = [{"name": "karta", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.95}},
        {"name": "zemlja", "pbrMetallicRoughness": {"baseColorFactor": CFG["side_color"], "metallicFactor": 0, "roughnessFactor": 1}}]
os.makedirs(os.path.join(REPO, "models", "staze"), exist_ok=True)
glb_path = os.path.join(REPO, "models", "staze", "teren.glb")
write_glb(glb_path, [top, sides], mats, [(JPEG, "image/jpeg")])
print(f"terrain {os.path.getsize(glb_path) / 1e6:.2f} MB")

# ---------------------------------------------------------------- AR model (Scene Viewer, Quick Look, AR cube)
# One self-contained GLB at real size: 60 cm wide, heights ×1.5, trails as tubes, names on small signs.
# Scene Viewer limits: 1 unit = 1 m, about 100k triangles, ≤10 materials, one mesh per material, no vertex colours.
from PIL import ImageFont
AR_W, AR_EX = CFG.get("ar_width", 0.6), CFG.get("ar_exaggeration", 1.5)
NXA = 161
NZA = round((NXA - 1) * D) + 1
GXA, GZA = np.meshgrid(np.linspace(-0.5, 0.5, NXA), np.linspace(-D / 2, D / 2, NZA))
alon, alat = to_lonlat(GXA, GZA)
HYA = (elev(alon, alat, gaussian_filter(DEM, 1.4)) - BASE) / WIDTH_M


def fin(x, y, z):                          # model units -> metres in the AR model
    return np.stack([np.asarray(x) * AR_W, np.asarray(y) * AR_EX * AR_W, np.asarray(z) * AR_W], -1)


def grid_mesh(HYg, material):
    nz, nx = HYg.shape
    gx, gz = np.meshgrid(np.linspace(-0.5, 0.5, nx), np.linspace(-D / 2, D / 2, nz))
    Pg = fin(gx, HYg, gz)
    dyz, dyx = np.gradient(Pg[..., 1], D * AR_W / (nz - 1), AR_W / (nx - 1))
    Ng = np.stack([-dyx, np.ones_like(dyx), -dyz], -1); Ng /= np.linalg.norm(Ng, axis=-1, keepdims=True)
    UVg = np.stack([gx + 0.5, (gz + D / 2) / D], -1)
    ii, jj = np.meshgrid(np.arange(nz - 1), np.arange(nx - 1), indexing="ij")
    a = (ii * nx + jj).ravel()
    idx = np.stack([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], -1).ravel()
    return Pg, dict(pos=Pg.reshape(-1, 3), nrm=Ng.reshape(-1, 3), uv=UVg.reshape(-1, 2), idx=idx, material=material)


def block_sides(Pg, material):
    pos, nrm, idx = [], [], []
    def wall_(edge, normal):
        b = len(pos)
        for p in edge:
            pos.extend([[p[0], p[1], p[2]], [p[0], 0.0, p[2]]]); nrm.extend([normal, normal])
        for k in range(len(edge) - 1):
            q = b + 2 * k
            idx.extend([q, q + 1, q + 2, q + 2, q + 1, q + 3])
    wall_(Pg[0, ::-1], [0, 0, -1]); wall_(Pg[-1, :], [0, 0, 1]); wall_(Pg[:, 0], [-1, 0, 0]); wall_(Pg[::-1, -1], [1, 0, 0])
    pos, nrm, idx = np.array(pos, np.float32), np.array(nrm, np.float32), np.array(idx, np.uint32).reshape(-1, 3)
    tri = pos[idx]; fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    flip = (fn * nrm[idx[:, 0]]).sum(1) < 0
    idx[flip] = idx[flip][:, [0, 2, 1]]
    hx, hz = AR_W / 2, D * AR_W / 2
    b0 = len(pos)
    pos = np.vstack([pos, [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]]])
    nrm = np.vstack([nrm, np.tile([[0, -1, 0]], (4, 1))])
    idx = np.vstack([idx, [[b0, b0 + 1, b0 + 2], [b0, b0 + 2, b0 + 3]]])
    return dict(pos=pos, nrm=nrm, uv=None, idx=idx.ravel(), material=material)


def tube_mesh(lines, r, radial, material):
    pos, nrm, idx = [], [], []
    up = np.array([0.0, 1.0, 0.0])
    ang = np.linspace(0, 2 * np.pi, radial, endpoint=False)
    for P in lines:
        n = len(P)
        if n < 2:
            continue
        tng = np.gradient(P, axis=0); tng /= np.linalg.norm(tng, axis=1, keepdims=True) + 1e-12
        side = np.cross(tng, up); side /= np.linalg.norm(side, axis=1, keepdims=True) + 1e-12
        nup = np.cross(side, tng)
        off = np.cos(ang)[None, :, None] * side[:, None, :] + np.sin(ang)[None, :, None] * nup[:, None, :]
        b = sum(len(p) for p in pos)
        pos.append((P[:, None, :] + r * off).reshape(-1, 3)); nrm.append(off.reshape(-1, 3))
        k = np.arange(n - 1)[:, None]; rr = np.arange(radial)[None, :]
        a0 = b + k * radial + rr; a1 = b + k * radial + (rr + 1) % radial
        idx.append(np.stack([a0, a0 + radial, a1, a1, a0 + radial, a1 + radial], -1).reshape(-1))
    return dict(pos=np.vstack(pos), nrm=np.vstack(nrm), uv=None, idx=np.concatenate(idx), material=material)


def hex_rgb(h):
    return [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]


PA, ar_top = grid_mesh(HYA, 0)
ar_prims = [ar_top]
ar_mats = [{"name": "karta", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.95}},
           {"name": "zemlja", "pbrMetallicRoughness": {"baseColorFactor": CFG["side_color"], "metallicFactor": 0, "roughnessFactor": 1}}]
# trails, one mesh per difficulty colour
R_AR = 0.0017
for style, col in COLORS.items():
    lines = []
    for tr in trails_out:
        if tr["style"] != style:
            continue
        for sgm in tr["segs"]:
            a3 = np.array(sgm).reshape(-1, 3)
            pm = np.c_[(a3[:, 0] + 0.5) * WIDTH_M, (a3[:, 2] + D / 2) * WIDTH_M]
            pm = resample(pm, 40.0)
            x = pm[:, 0] / WIDTH_M - 0.5; z = pm[:, 1] / WIDTH_M - D / 2
            P3 = fin(x, surface_y(x, z, HYA), z); P3[:, 1] += R_AR * 0.55
            lines.append(P3)
    if not lines:
        continue
    rgb = hex_rgb(col)
    ar_mats.append({"name": "staza-" + style, "pbrMetallicRoughness": {"baseColorFactor": rgb + [1], "metallicFactor": 0, "roughnessFactor": 0.5},
                    "emissiveFactor": [c * 0.3 for c in rgb]})
    ar_prims.append(tube_mesh(lines, R_AR, 5, len(ar_mats) - 1))

# name signs: a label atlas on upright two-sided cards, with a thin post
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
labels = []
for p in places_out:
    big = p["kind"] == "town"
    pre = "▲ " if p["kind"] in ("peak", "pass") else "◆ " if p["kind"] == "sight" else ""
    txt = pre + p["name"]["me"] + (f" {p['ele']}" if p.get("ele") else "")
    font = ImageFont.truetype(FONT_B, 54 if big else 44)
    w = int(font.getlength(txt)) + 36; h = (54 if big else 44) + 26
    labels.append((p, txt, font, w, h))
AW = 2048
x_, y_, rowh, slots = 0, 0, 0, []
for (p, txt, font, w, h) in labels:
    if x_ + w > AW:
        x_, y_ = 0, y_ + rowh + 4; rowh = 0
    slots.append((x_, y_)); x_ += w + 4; rowh = max(rowh, h)
AH = 1 << int(math.ceil(math.log2(y_ + rowh + 4)))
atlas = Image.new("RGBA", (AW, AH), (0, 0, 0, 0))
da = ImageDraw.Draw(atlas)
INK = {"town": (34, 30, 25), "village": (34, 30, 25), "valley": (44, 59, 51), "sight": (31, 95, 139), "peak": (90, 58, 26), "pass": (90, 58, 26)}
lp, ln, lu, li, sp, sn, si = [], [], [], [], [], [], []
for (p, txt, font, w, h), (ax, ay) in zip(labels, slots):
    da.rounded_rectangle([ax, ay, ax + w - 1, ay + h - 1], radius=h // 2, fill=(255, 252, 246, 238) if p["kind"] != "valley" else (255, 255, 255, 170))
    da.text((ax + 18, ay + h / 2), txt, font=font, fill=INK.get(p["kind"], (34, 30, 25)) + (255,), anchor="lm")
    u0, u1, v0, v1 = ax / AW, (ax + w) / AW, ay / AH, (ay + h) / AH
    x, yu, z = p["pos"]
    base = fin(x, surface_y(x, z, HYA), z)
    hm = 0.016 if p["kind"] == "town" else 0.012
    post = {"town": 0.028, "valley": 0.006}.get(p["kind"], 0.02)
    wm = hm * w / h
    yb = base[1] + post
    cx, cz = base[0], base[2]
    b = len(lp)
    quad = [[cx - wm / 2, yb, cz], [cx + wm / 2, yb, cz], [cx + wm / 2, yb + hm, cz], [cx - wm / 2, yb + hm, cz]]
    lp += quad + quad
    ln += [[0, 0, 1]] * 4 + [[0, 0, -1]] * 4
    lu += [[u0, v1], [u1, v1], [u1, v0], [u0, v0]] + [[u1, v1], [u0, v1], [u0, v0], [u1, v0]]
    li += [b, b + 1, b + 2, b, b + 2, b + 3, b + 4, b + 6, b + 5, b + 4, b + 7, b + 6]
    if p["kind"] != "valley":                 # post: a thin square stick
        t = 0.0006
        corners = [(-t, -t), (t, -t), (t, t), (-t, t)]
        for k in range(4):
            (ax0, az0), (ax1, az1) = corners[k], corners[(k + 1) % 4]
            nrm_ = np.array([az1 - az0, 0, -(ax1 - ax0)]); nrm_ = (nrm_ / np.linalg.norm(nrm_)).tolist()
            q = len(sp)
            sp += [[cx + ax0, base[1] - 0.002, cz + az0], [cx + ax1, base[1] - 0.002, cz + az1], [cx + ax1, yb, cz + az1], [cx + ax0, yb, cz + az0]]
            sn += [nrm_] * 4
            si += [q, q + 2, q + 1, q, q + 3, q + 2]
buf = io.BytesIO(); atlas.save(buf, "PNG", optimize=True); LABEL_PNG = buf.getvalue()
ar_mats.append({"name": "nazivi", "pbrMetallicRoughness": {"baseColorTexture": {"index": 1}, "metallicFactor": 0, "roughnessFactor": 1},
                "alphaMode": "BLEND", "extensions": {"KHR_materials_unlit": {}}})
ar_prims.append(dict(pos=np.array(lp, np.float32), nrm=np.array(ln, np.float32), uv=np.array(lu, np.float32), idx=np.array(li, np.uint32), material=len(ar_mats) - 1))
sides_ar = block_sides(PA, 1)
off = len(sides_ar["pos"])
sides_ar = dict(pos=np.vstack([sides_ar["pos"], np.array(sp, np.float32)]), nrm=np.vstack([sides_ar["nrm"], np.array(sn, np.float32)]), uv=None,
                idx=np.concatenate([sides_ar["idx"], np.array(si, np.uint32) + off]), material=1)
ar_prims.insert(1, sides_ar)
ar_path = os.path.join(REPO, "models", "staze", "teren_ar.glb")
write_glb(ar_path, ar_prims, ar_mats, [(JPEG, "image/jpeg"), (LABEL_PNG, "image/png")], extensions=["KHR_materials_unlit"])
ntri = sum(len(pr["idx"]) for pr in ar_prims) // 3
print(f"AR model {os.path.getsize(ar_path) / 1e6:.2f} MB, {ntri} triangles, {len(ar_mats)} materials")

meta = {"version": 1, "bbox": [W, S, E, N], "widthM": round(WIDTH_M, 1), "depthM": round(DEPTH_M, 1), "depth": round(D, 5),
        "base": BASE, "minEle": round(float(HE.min())), "maxEle": round(float(HE.max())),
        "model": "models/staze/teren.glb", "arModel": "models/staze/teren_ar.glb", "arWidth": AR_W, "arExaggeration": AR_EX, "colors": COLORS, "groups": CFG["groups"], "styles": CFG["styles"],
        "trails": trails_out, "places": places_out,
        "credits": CFG["credits_always"] + [f"{src}: {', '.join(x['name']['me'] for x in trails_out if x['source'] == src)}"
                                            for src in sorted(credits) if src != "OpenStreetMap"]}
with open(os.path.join(REPO, "data", "staze.json"), "w", encoding="utf-8") as f:
    json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
print(f"data/staze.json {os.path.getsize(os.path.join(REPO, 'data', 'staze.json')) / 1e3:.0f} kB, {len(trails_out)} trails, {len(places_out)} places")
