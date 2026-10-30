#!/usr/bin/env python3
"""Download raw data for the Gusinje trail relief (runs in GitHub Actions, which has open internet).

Writes into data-raw/:
  dem_cop30.png + dem_cop30.json   Copernicus GLO-30 elevation, cropped to the area, 16-bit PNG in decimetres
  terrarium/<z>_<x>_<y>.png        AWS Terrain Tiles (fallback elevation)
  gpx/<id>.gpx                     trail tracks listed in tools/gusinje_trails.csv
  osm.json                         OpenStreetMap features: peaks, places, water, roads, paths, hiking routes, border
  report.json                      what worked and what failed
"""
import csv, json, math, os, sys, time, urllib.parse, urllib.request

W, S, E, N = 19.70, 42.43, 19.99, 42.62          # a little larger than the model area
OUT = "data-raw"
UA = "gusinjska-bastina trail relief (github.com/gsgsgs84/gusinjska-bastina)"
report = {"ok": [], "failed": []}


def get(url, data=None, timeout=120, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as exc:  # retry on network trouble
            last = exc
            time.sleep(3 * (i + 1))
    raise last


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def copernicus():
    import numpy as np
    import rasterio
    from rasterio.windows import from_bounds
    from PIL import Image
    name = "Copernicus_DSM_COG_10_N42_00_E019_00_DEM"
    if os.path.exists(f"{OUT}/dem_cop30.png"):
        return
    tmp = "/tmp/cop30.tif"
    save(tmp, get(f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif", timeout=300))
    with rasterio.open(tmp) as src:
        win = from_bounds(W, S, E, N, src.transform).round_offsets().round_lengths()
        a = src.read(1, window=win).astype("float32")
        tr = src.window_transform(win)
    a = np.clip(np.nan_to_num(a, nan=0.0), 0, 6000)
    Image.fromarray(np.round(a * 10).astype("uint16")).save(f"{OUT}/dem_cop30.png")
    meta = {"west": tr.c, "north": tr.f, "dx": tr.a, "dy": tr.e, "width": a.shape[1], "height": a.shape[0],
            "units": "decimetres", "source": name,
            "credit": "Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA"}
    json.dump(meta, open(f"{OUT}/dem_cop30.json", "w"), indent=1)
    report["ok"].append(f"copernicus {a.shape} min {a.min():.0f} max {a.max():.0f}")


def tile_xy(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def terrarium(z=13):
    x0, y0 = tile_xy(W, N, z)
    x1, y1 = tile_xy(E, S, z)
    n = 0
    for x in range(int(x0), int(x1) + 1):
        for y in range(int(y0), int(y1) + 1):
            p = f"{OUT}/terrarium/{z}_{x}_{y}.png"
            if os.path.exists(p):
                continue
            save(p, get(f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"))
            n += 1
    report["ok"].append(f"terrarium z{z}: {n} tiles")


def gpx():
    with open("tools/gusinje_trails.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            url = row["gpx_url"].strip()
            if not url.startswith("http") or os.path.exists(f"{OUT}/gpx/{row['id']}.gpx"):
                continue
            try:
                data = get(url, timeout=60)
                if b"<gpx" not in data[:2000]:
                    raise ValueError("not a GPX file: " + data[:80].decode("utf-8", "replace"))
                save(f"{OUT}/gpx/{row['id']}.gpx", data)
                report["ok"].append(f"gpx {row['id']} {len(data)} bytes")
            except Exception as exc:
                report["failed"].append(f"gpx {row['id']}: {exc}")


def osm():
    if os.path.exists(f"{OUT}/osm.json"):
        return
    b = f"{S},{W},{N},{E}"
    q = f"""[out:json][timeout:180];
(
  node["natural"~"^(peak|saddle|spring|cave_entrance)$"]({b});
  node["place"~"^(town|village|hamlet|isolated_dwelling|locality)$"]({b});
  node["waterway"="waterfall"]({b});
  node["tourism"~"^(viewpoint|alpine_hut|wilderness_hut|camp_site|information)$"]["name"]({b});
  node["mountain_pass"="yes"]({b});
  node["historic"]["name"]({b});
  way["natural"="water"]({b});
  relation["natural"="water"]({b});
  way["waterway"~"^(river|stream)$"]({b});
  way["highway"~"^(primary|secondary|tertiary|unclassified|residential|track)$"]({b});
  way["highway"~"^(path|footway|bridleway)$"]({b});
  way["boundary"="administrative"]["admin_level"="2"]({b});
  relation["route"~"^(hiking|foot|bicycle|mtb)$"]({b});
);
out geom;"""
    for host in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
                 "https://overpass.private.coffee/api/interpreter"):
        try:
            data = get(host, data=urllib.parse.urlencode({"data": q}).encode(), timeout=240, tries=2)
            js = json.loads(data)
            save(f"{OUT}/osm.json", data)
            report["ok"].append(f"osm {len(js.get('elements', []))} elements from {host}")
            return
        except Exception as exc:
            report["failed"].append(f"osm {host}: {exc}")


if os.path.exists(f"{OUT}/report.json"):
    report["previous"] = json.load(open(f"{OUT}/report.json"))
for step in (copernicus, terrarium, gpx, osm):
    try:
        step()
    except Exception as exc:
        report["failed"].append(f"{step.__name__}: {exc!r}")
os.makedirs(OUT, exist_ok=True)
json.dump(report, open(f"{OUT}/report.json", "w"), indent=1)
print(json.dumps(report, indent=1))
