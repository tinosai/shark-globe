#!/usr/bin/env python3
"""
Bake the globe's surface into one image.

Land and sea both come from the same elevation data, so they can never disagree
— no coastline polygon to drift out of step with the depth mask, and no polygon
to sag through the sphere it's wrapped around.

    python3 -m pip install --user Pillow numpy
    python3 scripts/build_basemap.py

Output: data/basemap.png — an equirectangular image of the whole planet.
  elevation >= 0  → flat grey. Land is context; it gets no detail and no shading.
  elevation <  0  → the bathymetric ramp. Depth is the subject.

Source is the same terrarium elevation tile set the app already uses for depth,
so the picture and the numbers come from one place.
"""

import io
import math
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "basemap.png")

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# z=5 is 32x32 tiles: an 8192px mercator mosaic, ~5 km per pixel at the equator.
# Resampled to 4096x2048 that's ~9.8 km per pixel — plenty for a silhouette and a
# depth wash, and it keeps the download to about 90 MB, once, on this machine.
ZOOM = 5
OUT_W, OUT_H = 4096, 2048

LAND = (141, 139, 132)

# Must match RAMP in src/globe.js, or the globe and the hexagons disagree.
RAMP = [
    (0, (138, 222, 238)),
    (200, (86, 182, 222)),
    (1000, (52, 128, 194)),
    (3000, (32, 80, 152)),
    (5000, (22, 50, 112)),
    (11000, (11, 24, 62)),
]


def fetch_tile(args):
    z, x, y = args
    url = TILE_URL.format(z=z, x=x, y=y)
    for attempt in range(3):
        try:
            raw = urllib.request.urlopen(url, timeout=40).read()
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            return x, y, np.asarray(img, dtype=np.float32)
        except Exception:
            if attempt == 2:
                return x, y, None
    return x, y, None


def main():
    span = 2 ** ZOOM
    size = span * 256
    print(f"  fetching {span * span} tiles at z={ZOOM} …")

    # Mercator elevation mosaic.
    merc = np.zeros((size, size), dtype=np.float32)

    jobs = [(ZOOM, x, y) for x in range(span) for y in range(span)]
    done = 0
    with ThreadPoolExecutor(max_workers=16) as pool:
        for x, y, rgb in pool.map(fetch_tile, jobs):
            done += 1
            if rgb is None:
                print(f"    tile {x}/{y} failed — leaving as sea level")
                continue
            # terrarium: metres = R*256 + G + B/256 - 32768
            elev = rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768
            merc[y * 256:(y + 1) * 256, x * 256:(x + 1) * 256] = elev
            if done % 128 == 0:
                print(f"    {done}/{len(jobs)}")

    print("  resampling mercator → equirectangular …")

    # Every output row is one latitude; find the mercator row it came from.
    lat = 90.0 - (np.arange(OUT_H) + 0.5) * (180.0 / OUT_H)
    lat_c = np.clip(lat, -85.05112878, 85.05112878)
    rad = np.radians(lat_c)
    ymerc = (1 - np.arcsinh(np.tan(rad)) / math.pi) / 2 * size
    rows = np.clip(ymerc.astype(np.int32), 0, size - 1)

    # Longitude is linear in both projections, so columns are a simple stretch.
    cols = np.clip(
        ((np.arange(OUT_W) + 0.5) / OUT_W * size).astype(np.int32), 0, size - 1
    )

    grid = merc[rows[:, None], cols[None, :]]  # (OUT_H, OUT_W) elevation

    print("  colouring …")

    # Discrete depth contours, not a continuous wash.
    #
    # Two reasons, and they agree. It's what a bathymetric chart actually is —
    # you can read the shelf break and the abyssal plain as distinct steps rather
    # than squinting at a gradient. And an image made of ~20 flat colours
    # palettises to a fraction of the size, with a hard coastline: a JPEG of the
    # same picture rings badly along the grey/blue edge, because that edge is
    # exactly the discontinuity JPEG is worst at.
    #
    # Bands are sqrt-spaced, matching the water-column chart: the shallows get
    # the resolution, because that's where the sea changes fastest.
    BANDS = 20
    edges = [ (i / BANDS) ** 2 * 11000 for i in range(BANDS + 1) ]

    out = np.zeros((OUT_H, OUT_W, 3), dtype=np.uint8)
    land = grid >= 0
    out[land] = LAND

    depth = np.where(land, 0.0, -grid)

    def ramp_at(d):
        i = 0
        while i < len(RAMP) - 2 and d > RAMP[i + 1][0]:
            i += 1
        d0, c0 = RAMP[i]
        d1, c1 = RAMP[i + 1]
        t = min(1.0, max(0.0, (d - d0) / (d1 - d0)))
        return tuple(int(round(c0[k] + (c1[k] - c0[k]) * t)) for k in range(3))

    for i in range(BANDS):
        lo, hi = edges[i], edges[i + 1]
        sel = (~land) & (depth >= lo) & ((depth < hi) if i < BANDS - 1 else True)
        if sel.any():
            out[sel] = ramp_at((lo + hi) / 2)

    img = Image.fromarray(out).convert("P", palette=Image.ADAPTIVE, colors=BANDS + 4)
    img.save(OUT, optimize=True)

    mb = os.path.getsize(OUT) / 1e6
    ocean = float((~land).mean()) * 100
    print(f"\n  wrote {OUT}  ({OUT_W}x{OUT_H}, {len(img.getcolors(999))} colours, {mb:.2f} MB)")
    print(f"  {ocean:.1f}% ocean — expect ~71%")


if __name__ == "__main__":
    main()
