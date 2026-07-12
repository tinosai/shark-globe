/**
 * Bathymetry — depth and the land/ocean mask, from one source.
 *
 * Terrarium tiles encode elevation in the pixel colour:
 *     metres = (R * 256 + G + B / 256) - 32768
 *
 * Below sea level that number goes negative, which means the same lookup that
 * tells us "this is 4,200 m of water" also tells us "this is land, don't draw a
 * hexagon here". We decode each tile once into an Int16Array (metres, rounded)
 * and keep it; a decoded tile is 128 KB and there are rarely more than a few
 * dozen live at once.
 */

import { colorFor } from './palette.js';

const TILE = 256;
const NODATA = 32767;

/**
 * The deepest tile zoom that actually carries bathymetry.
 *
 * Measured, not guessed. At 40°W 18°N — 4,700 m of open Atlantic — the tiles read:
 *
 *     z=8   -4696      z=10  -4703
 *     z=9   -4698      z=11      0   ← every pixel in the tile is zero
 *
 * Past zoom 10 the ocean tiles are simply empty: GEBCO has no bathymetry at that
 * resolution, so the source fills them with sea level rather than upsampling.
 *
 * This was doing real damage in two places. Depth was sampled at zoom 11, so
 * every click on the open ocean read 0 m, was judged to be dry land, and did
 * nothing — the bug that made the app look completely broken. And the renderer
 * paints elevation >= 0 as land, so zooming in far enough would have turned the
 * whole ocean grey.
 */
export const MAX_TILE_ZOOM = 10;

const tiles = new Map(); // "z/x/y" -> Int16Array | Promise | null(failed)

/* ---------------------------------------------------------------- projection */

/** Web Mercator, in fractional tile units at zoom z. */
export function project(lon, lat, z) {
  const n = 2 ** z;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const rad = (clamped * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n,
  };
}

/* -------------------------------------------------------------------- tiles */

function decode(bitmap) {
  const canvas = new OffscreenCanvas(TILE, TILE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, TILE, TILE);

  const out = new Int16Array(TILE * TILE);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    // Round to the metre. Int16 spans -32768..32767, and Earth's relief fits in
    // roughly -11000..9000, so there is plenty of headroom.
    out[i] = Math.round(data[p] * 256 + data[p + 1] + data[p + 2] / 256 - 32768);
  }
  return out;
}

/**
 * A terrain tile, decoded and coloured, ready to be a texture.
 *
 * We used to hand the raw terrarium PNG to the GPU and decode elevation in the
 * fragment shader. Elegant — but it forced NEAREST filtering, because you cannot
 * linearly blend two terrarium pixels: the average of two elevation *codes* is
 * not the elevation between them, it's nonsense. So every texel rendered as a
 * hard square and the coastline came out as a staircase.
 *
 * Decoding here, on the CPU, turns the tile into ordinary colour — which the GPU
 * can then filter smoothly. It costs ~65k pixels of work per tile, once.
 */
const colored = new Map();

export function tileColor(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (colored.has(key)) return colored.get(key);

  const job = (async () => {
    const grid = await load(z, x, y);
    if (!grid) return null;

    const px = new Uint8ClampedArray(TILE * TILE * 4);
    for (let i = 0; i < grid.length; i++) {
      const [r, g, b] = colorFor(grid[i]);
      const p = i * 4;
      px[p] = r;
      px[p + 1] = g;
      px[p + 2] = b;
      px[p + 3] = 255;
    }
    return new ImageData(px, TILE, TILE);
  })();

  colored.set(key, job);
  if (colored.size > 300) colored.delete(colored.keys().next().value);
  return job;
}

async function load(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const hit = tiles.get(key);
  if (hit !== undefined) return hit;

  const promise = (async () => {
    try {
      const res = await fetch(`/api/tile/${z}/${x}/${y}.png`);
      if (!res.ok) throw new Error(`tile ${key} → ${res.status}`);
      const grid = decode(await createImageBitmap(await res.blob()));
      tiles.set(key, grid);
      return grid;
    } catch {
      tiles.set(key, null); // negative-cache: don't hammer a tile that 404s
      return null;
    }
  })();

  tiles.set(key, promise);
  return promise;
}

/**
 * Point → tile + pixel within it.
 *
 * Web Mercator can't reach past ±85.05°, so project() clamps there and the
 * poles sample the nearest row of real data. That is the right answer for both
 * caps: at 85°N almost every longitude is Arctic Ocean, and at 85°S almost
 * every longitude is Antarctic rock. Beyond the clamp we'd have no data at all,
 * and a hole in the grid reads as a bug.
 *
 * The clamping below is load-bearing, not defensive. At the north edge the
 * projection lands on y = -1e-15, which floors to -1; at the south edge it
 * lands exactly on `span`. Both fall outside the tile range, so every cell
 * poleward of ±85° used to resolve to null and render nothing.
 */
function tileIndex(lon, lat, z) {
  const span = 2 ** z;
  const { x, y } = project(lon, lat, z);

  const tx = ((Math.floor(x) % span) + span) % span;
  const ty = Math.min(span - 1, Math.max(0, Math.floor(y)));

  const px = Math.min(TILE - 1, Math.max(0, Math.floor((x - Math.floor(x)) * TILE)));
  const py = Math.min(TILE - 1, Math.max(0, Math.floor((y - ty) * TILE)));

  return { tx, ty, px, py };
}

/* ------------------------------------------------------------------ sampling */

/**
 * Elevation in metres at a point, or null if unknown.
 * Negative = below sea level. Awaits the tile if it isn't loaded yet.
 */
export async function elevationAt(lon, lat, z = 8) {
  for (let zz = Math.min(z, MAX_TILE_ZOOM); zz >= 5; zz--) {
    const idx = tileIndex(lon, lat, zz);
    const grid = await load(zz, idx.tx, idx.ty);
    if (!grid) continue;

    const v = grid[idx.py * TILE + idx.px];
    if (v === NODATA) continue;

    // Exactly zero, offshore, is the source saying "I have nothing here" — the
    // deep-ocean tiles it can't fill are flat sea level, not sea level. Drop a
    // zoom and ask again. A genuine shoreline reads ~0 at every zoom, so this
    // costs nothing there and rescues the open ocean.
    if (v === 0 && zz > 5) continue;

    return v;
  }
  return null;
}

/**
 * A box this big isn't worth prefetching — we'd be asking for more tiles than
 * the whole prefetch is meant to save. Near the poles the longitude span goes
 * to infinity (cos(lat) → 0), so without this a warm-up at high latitude could
 * try to fetch the entire planet at full detail.
 */
const MAX_PRELOAD_TILES = 180;

