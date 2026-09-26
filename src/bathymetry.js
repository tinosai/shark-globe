/**
 * Bathymetry — depth and the land/ocean mask, from one source.
 *
 * Terrarium tiles encode elevation in the pixel colour:
 *     metres = (R * 256 + G + B / 256) - 32768
 *
 * Below sea level that number goes negative, which means the same lookup that
 * tells us "this is 4,200 m of water" also tells us "this is land, don't draw a
 * hexagon here". We decode each tile once into an Int16Array (metres, rounded)
 * and keep the most recent few hundred; a decoded tile is 128 KB.
 */

import { colorFor } from './palette.js';

export const TILE = 256;
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

/** Decoded tiles kept in memory (~50 MB). It used to be every tile ever seen. */
const MAX_GRIDS = 400;

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

/* -------------------------------------------------------------- scheduling */

/**
 * Tile requests go through one queue, most important first.
 *
 * The browser opens at most six connections to a host and serves requests in
 * the order they were made. Every step of a zoom asked for a full screen of
 * tiles, so one gesture from orbit to the coast queued 147 requests for a view
 * that needed 20 — and the view, and any click made meanwhile, waited behind all
 * the tiles for places already scrolled past. Twelve seconds, measured.
 *
 * So requests wait here instead, where we can reorder them: a click's depth
 * lookup jumps the queue (URGENT), view tiles go centre-first, and a tile the
 * view no longer wants is dropped before it's ever fetched (see dropQueued).
 */
export const URGENT = 0;
const MAX_INFLIGHT = 6; // the browser's own per-host limit; more would only queue there

const queue = new Map(); // "z/x/y" -> job, not yet started
let inflight = 0;

/** Returned by load() when a queued view tile is dropped. Not a failure. */
export const DROPPED = undefined;

function pump() {
  while (inflight < MAX_INFLIGHT && queue.size) {
    let job = null;
    for (const j of queue.values()) if (!job || j.priority < job.priority) job = j;
    queue.delete(job.key);
    inflight++;
    fetchGrid(job).then(job.resolve).finally(() => {
      inflight--;
      pump();
    });
  }
}

async function fetchGrid({ key, z, x, y }) {
  try {
    const res = await fetch(`/api/tile/${z}/${x}/${y}.png`);
    if (!res.ok) throw new Error(`tile ${key} → ${res.status}`);
    const grid = decode(await createImageBitmap(await res.blob()));
    remember(key, grid);
    return grid;
  } catch {
    tiles.set(key, null); // negative-cache: don't hammer a tile that 404s
    return null;
  }
}

/** Keep a decoded tile, forgetting the least recently used past MAX_GRIDS. */
function remember(key, grid) {
  tiles.delete(key);
  tiles.set(key, grid);
  if (tiles.size <= MAX_GRIDS) return;
  for (const [k, v] of tiles) {
    if (tiles.size <= MAX_GRIDS) break;
    if (!(v instanceof Promise)) tiles.delete(k); // never drop one being fetched
  }
}

/**
 * Drop every queued view tile that isn't in `keep`.
 *
 * Only view tiles: anything a click is waiting on is URGENT and stays. A dropped
 * tile resolves to DROPPED and is forgotten, so asking again fetches it afresh.
 */
export function dropQueued(keep) {
  for (const [key, job] of queue) {
    if (job.priority === URGENT || keep.has(key)) continue;
    queue.delete(key);
    tiles.delete(key);
    job.resolve(DROPPED);
  }
}

/**
 * A tile's elevations, decoded to metres.
 *
 * @param priority  URGENT for anything a person is waiting on; for view tiles,
 *                  1 + distance from the screen centre. Asking again for a tile
 *                  already queued can only raise its priority, never lower it.
 */
export function load(z, x, y, priority = URGENT) {
  const key = `${z}/${x}/${y}`;
  const hit = tiles.get(key);

  if (hit instanceof Promise) {
    const job = queue.get(key);
    if (job && priority < job.priority) job.priority = priority;
    return hit;
  }
  if (hit !== undefined) {
    if (hit) remember(key, hit); // most recently used
    return Promise.resolve(hit);
  }

  const promise = new Promise((resolve) => {
    queue.set(key, { key, z, x, y, priority, resolve });
  });
  tiles.set(key, promise);
  pump();
  return promise;
}

/* ---------------------------------------------------------------- colouring */

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
 *
 * Resolves to null if the tile failed or was dropped from the queue.
 */
const colored = new Map();

export function tileColor(z, x, y, priority = URGENT) {
  const key = `${z}/${x}/${y}`;
  if (colored.has(key)) {
    if (tiles.get(key) instanceof Promise) load(z, x, y, priority); // still queued: re-rank
    return colored.get(key);
  }

  const job = (async () => {
    const grid = await load(z, x, y, priority);
    if (grid === DROPPED) {
      if (colored.get(key) === job) colored.delete(key); // not a failure: ask again later
      return null;
    }
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
