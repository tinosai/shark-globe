#!/usr/bin/env python3
"""
Bake a world map of what is sea, what is land and what is lake.

The elevation tiles can't tell these apart everywhere, and it matters:

  - A Dutch polder is farmland 5 m below sea level. Its dykes are narrower than
    a terrain pixel, so in the elevation data it runs straight into the sea.
  - Qattara is a desert basin 133 m below sea level, too big to prove enclosed.
  - The Caspian's surface is 29 m below sea level and reads just like shallow sea.

A drawn map settles all three: Flevoland is land, the Caspian is a lake. So the
app asks this map first, and the elevation data only where the map is unsure
(see src/reach.js for exactly how the two are combined).

    python3 -m pip install --user Pillow numpy
    python3 scripts/build_water.py

Source: Natural Earth 1:10m land, minor islands and lakes (public domain).

Output: data/water.bin — the planet at 1/32° (~3.5 km at the equator), one
class per cell: 0 sea, 1 land, 2 lake. Run-length encoded by row:

    "WMSK"  uint16 width  uint16 height  uint16 cells-per-degree  uint16 0
    uint32 × (height + 1)   where each row's runs start, counted in runs
    uint16 × runs           (class << 14) | x where the run ends (exclusive)

All little-endian. ~430 KB. Width is capped at 16,384 by the 14 bits a run end
gets, which is why this is 1/32° and not 1/64°.
"""

import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "water.bin")
CACHE = os.path.join(ROOT, ".cache", "naturalearth")

NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{}.geojson"

RES = 32
W, H = 360 * RES, 180 * RES

SEA, LAND, LAKE = 0, 1, 2


def geojson(name: str) -> dict:
    path = os.path.join(CACHE, f"{name}.geojson")
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        print(f"  downloading {name}…")
        urllib.request.urlretrieve(NE_URL.format(name), path + ".part")
        os.replace(path + ".part", path)
    with open(path) as fh:
        return json.load(fh)


def polygons(doc: dict):
    for feature in doc["features"]:
        g = feature["geometry"]
        yield from g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]


def to_px(ring):
    return [((lon + 180) * RES, (90 - lat) * RES) for lon, lat in ring]


def rasterize() -> np.ndarray:
    img = Image.new("L", (W, H), SEA)
    draw = ImageDraw.Draw(img)

    # Land, with its holes drawn as LAKE, not sea. There is exactly one hole in
    # the whole of Natural Earth's land: the Caspian, which sits inside Eurasia
    # and is otherwise indistinguishable from ocean. The Black Sea is not a hole
    # (it reaches the Mediterranean through a drawn Bosporus), so it stays sea.
    for name in ("ne_10m_land", "ne_10m_minor_islands"):
        for poly in polygons(geojson(name)):
            draw.polygon(to_px(poly[0]), fill=LAND)
            for hole in poly[1:]:
                draw.polygon(to_px(hole), fill=LAKE)

    # Lakes on top, and islands within lakes back to land.
    for poly in polygons(geojson("ne_10m_lakes")):
        draw.polygon(to_px(poly[0]), fill=LAKE)
        for island in poly[1:]:
            draw.polygon(to_px(island), fill=LAND)

    return np.asarray(img)


def encode(grid: np.ndarray) -> bytes:
    starts = [0]
    runs = []
    for row in grid:
        ends = np.append(np.flatnonzero(row[1:] != row[:-1]) + 1, len(row))
        classes = row[ends - 1].astype(np.uint16)
        runs.append((classes << 14) | ends.astype(np.uint16))
        starts.append(starts[-1] + len(ends))

    header = b"WMSK" + np.array([W, H, RES, 0], dtype="<u2").tobytes()
    return (
        header
        + np.array(starts, dtype="<u4").tobytes()
        + np.concatenate(runs).astype("<u2").tobytes()
    )


def main():
    grid = rasterize()
    blob = encode(grid)
    with open(OUT, "wb") as fh:
        fh.write(blob)

    share = np.bincount(grid.ravel(), minlength=3) / grid.size
    print(f"  wrote {os.path.relpath(OUT, ROOT)}  {len(blob) / 1024:.0f} KB  "
          f"(sea {share[SEA]:.0%}, land {share[LAND]:.0%}, lake {share[LAKE]:.1%})")


if __name__ == "__main__":
    sys.exit(main())
