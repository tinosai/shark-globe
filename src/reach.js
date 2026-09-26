/**
 * Is this water part of the sea — and which water is?
 *
 * Below sea level is not the same thing as ocean. The Caspian sits at −29 m, the
 * Dead Sea at −415 m, the Salton Sea at −71 m, and a Dutch polder at −5 m, and
 * all of them used to be clickable as sea. Worse, the species search then widened
 * its box until the box reached real ocean: 100 km from the Dead Sea it finds the
 * Mediterranean, and the Dead Sea came back full of common dolphins.
 *
 * Two sources, each covering for the other's blind spot:
 *
 *   The terrain tiles (the same ones we sound depth from) see every fjord and
 *   inlet down to ~150 m — but not a dyke 90 m wide, so a polder runs straight
 *   into the sea, and not the edge of a basin too big to walk around.
 *
 *   A drawn map (src/water.js, Natural Earth at ~3.5 km) knows Flevoland is land
 *   and the Caspian a lake — but misses narrow water: 12% of Puget Sound is drawn
 *   as solid land, and Puget Sound has orcas.
 *
 * So: where the map says sea, it's sea; where it says lake, it's a lake. Where it
 * says land but the terrain says water, flood-fill through the terrain and see
 * whether the fill reaches drawn sea (see passes() for the rules).
 *
 *   landlocked()  — can the fill reach the sea? If not, land walls it in.
 *   searchArea()  — the part of the search box the fill can reach, so a record
 *                   on the far side of a landmass doesn't count as "near here".
 */

import { load, project, TILE } from './bathymetry.js';
import { loadWater, waterAt, seaWithin, SEA, LAND, LAKE } from './water.js';

/**
 * Deeper than any inland basin in the data, so reaching it means open ocean.
 * The Dead Sea bottoms out around −730 m; nothing on land comes close to this.
 */
const DEEP = -1500;

/**
 * The depth that separates the two things the map can't draw.
 *
 * Undrawn sea is real bathymetry — Puget Sound's missing channels run 18 to
 * 280 m deep. A polder is fields at −2 to −7 m (Lammefjord, the deepest, −7 m),
 * which would otherwise leak to the sea through every pixel of dyke too thin to
 * register. Inland of drawn sea, shallower water than this costs sill (SILL_M).
 */
const INLAND_MIN = -10;

/**
 * An enclosed pocket this close to drawn sea, and deeper than INLAND_MIN, is sea.
 *
 * The terrain tiles record some fjords' surfaces as a metre or two above zero, so
 * the channel is simply missing: Doubtful Sound's inner arm is a pocket 60 m deep
 * with dry land between it and the Tasman, and Chile's fjords are full of them.
 * Nothing that isn't sea looks like that: polders never get 10 m deep, the dry
 * basins are far inland (Qattara ~55 km, Danakil ~70 km), and the ones near a coast
 * — Assal, Enriquillo — are drawn lakes, settled before any fill runs.
 */
const POCKET_KM = 10;

/** The drawn map, or a stand-in that trusts the terrain alone if it won't load. */
let mapped = true;
const UNKNOWN = { kind: LAND, nearSea: true };

async function withMap() {
  try {
    await loadWater();
  } catch (err) {
    if (mapped) console.warn('water map unavailable; terrain only:', err);
    mapped = false;
  }
}

/**
 * How much shallow undrawn water one path may cross, in metres.
 *
 * A fjord's mouth is often a shallow sill, and a pixel-thin channel reads
 * shallow because it's averaged with its banks: Doubtful Sound's arm crosses
 * ~0–9 m water, well inland of any drawn sea, and a hard INLAND_MIN sealed a
 * real fiord off from the Tasman. A polder is the opposite shape — kilometres of
 * shallow ground in every direction — so a kilometre of allowance gets a fiord
 * over its sill and still leaves a polder nowhere to go.
 */
const SILL_M = 1000;

/** One terrain pixel's width on the ground, in metres. */
const pxMetres = (z, lat) => (40075e3 * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z);

/** SILL_M in pixels at zoom z and latitude lat. */
function sillFor(z, lat) {
  return Math.max(1, Math.min(250, Math.ceil(SILL_M / pxMetres(z, lat))));
}

/**
 * Can the fill enter this pixel?
 *   0 = no, 1 = yes, 2 = yes and it's drawn sea, 3 = yes, but it spends sill.
 *
 *   drawn lake                      never: a lake is not a way to the sea
 *   drawn sea                       if the terrain agrees it's not dry land
 *   drawn land, beside drawn sea    at or below sea level — the coast is only
 *                                   drawn to a kilometre or two, and shallow
 *                                   water there is exactly where it's wrong
 *   drawn land, inland              deeper than INLAND_MIN freely; shallower
 *                                   only as part of a short crossing (SILL_M)
 *
 * Zero counts as water: it's how the terrain draws a shoreline, and a narrow
 * inlet can be nothing but shoreline — the channel into Lagoa dos Patos is
 * plugged with zeros at every zoom.
 */
function passes(s, x, y, e) {
  if (e > 0) return 0;
  const { kind, nearSea } = s.water(x, y);
  if (kind === LAKE) return 0;
  if (kind === SEA) return 2;
  if (!nearSea && e >= INLAND_MIN) return 3;
  return 1;
}

/* ─────────────────────────────────────────────────────────────── the fill */

/** Terrain pixels at zoom z, fetched once per tile and read synchronously. */
function sampler(z) {
  const n = 2 ** z;
  const W = n * TILE;
  const grids = new Map();

  const locate = (x, y) => {
    const gx = ((x % W) + W) % W;
    return { gx, key: ((y / TILE) | 0) * n + ((gx / TILE) | 0) };
  };

  const lats = new Map(); // row -> latitude of its centre

  return {
    W,
    /** What the drawn map says at a pixel's centre. */
    water(x, y) {
      if (!mapped) return UNKNOWN;
      let lat = lats.get(y);
      if (lat === undefined) lats.set(y, (lat = unmercator(y + 0.5, W)));
      return waterAt(((x + 0.5) / W) * 360 - 180, lat);
    },
    /** Metres, or undefined if the tile isn't loaded yet, or null if it failed. */
    get(x, y) {
      if (y < 0 || y >= W) return 1; // off the top or bottom of the map: not water
      const { gx, key } = locate(x, y);
      const g = grids.get(key);
      if (!g) return g;
      return g[(y % TILE) * TILE + (gx % TILE)];
    },
    /** Which tile a pixel falls in, as one number. */
    key: (x, y) => locate(x, y).key,
    async ensure(x, y) {
      if (y < 0 || y >= W) return;
      const { gx, key } = locate(x, y);
      if (!grids.has(key)) grids.set(key, await load(z, (gx / TILE) | 0, (y / TILE) | 0));
    },
    /** Every tile under a pixel rectangle, in parallel. */
    async prefetch(x0, y0, x1, y1) {
      const jobs = [];
      for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) {
        for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
          jobs.push(this.ensure(tx * TILE, ty * TILE));
        }
      }
      await Promise.all(jobs);
    },
  };
}

/** The nearest pixel within r of (x, y) that `ok(x, y, metres)` accepts, or null. */
async function nearestWater(s, x, y, r, ok) {
  for (let d = 0; d <= r; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue; // the ring only
        await s.ensure(x + dx, y + dy);
        const v = s.get(x + dx, y + dy);
        if (v != null && ok(x + dx, y + dy, v)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

/**
 * Breadth-first through connected water (see passes), inside a window.
 *
 * Each path carries a sill allowance: pixels of shallow undrawn water it may
 * still cross. A pixel is revisited if a later path reaches it with more left,
 * since that path may get further.
 *
 * Tiles are fetched in waves. When the fill reaches a tile it doesn't have, the
 * cell waits and the fill carries on with what it does have; once it runs dry,
 * every tile it's waiting on is fetched at once. Awaiting each tile the moment
 * it was needed made a cold fill one round trip per tile — 17 s for the Dead Sea.
 *
 * @param escape  true: stop at the first sign of open sea — drawn sea, deep
 *                water, the window's edge, or a tile we couldn't get. false: the
 *                window is the world; fill all of it that's reachable.
 * @param sill    the allowance each seed starts with (see sillFor)
 * @param mapSea  cross drawn sea even where the terrain says dry. For the
 *                species search only: off western Scotland whole stretches of
 *                the Firth of Lorn read as land in the tiles, and a search that
 *                spills over a small undrawn island costs nothing. landlocked()
 *                stays strict, or a coastal polder could leak out through a dune
 *                the map happens to draw as sea.
 * @returns {{result: 'enclosed'|'budget'|'sea'|'deep'|'edge'|'nodata',
 *            seen: Uint8Array, deepest: number}}  seen: 1 = water reached
 */
async function flood(s, seeds, win, { budget = Infinity, escape = true, sill = 0, mapSea = false } = {}) {
  const { x0, y0, w, h } = win;
  const seen = new Uint8Array(w * h); // 1 = water, reached; 2 = never water; 3 = waiting on a tile
  const left = new Uint8Array(w * h); // sill allowance a reached pixel still has
  const queue = [];
  let waiting = new Map(); // pixel -> the most allowance anything arrived with
  let head = 0;
  let count = 0;
  let deepest = 0;

  const out = (result) => ({ result, seen, deepest });

  /** Try to reach a pixel with `allow` sill left. A string = stop now. */
  const visit = (j, x, y, e, allow) => {
    if (e === undefined) {
      seen[j] = 3;
      waiting.set(j, Math.max(allow, waiting.get(j) ?? 0));
      return null;
    }
    if (e === null) {
      // A tile we couldn't fetch. Unknown is not land: never call water
      // walled-in because a request failed.
      seen[j] = 2;
      return escape ? 'nodata' : null;
    }
    const p = mapSea && e > 0 && s.water(x, y).kind === SEA ? 1 : passes(s, x, y, e);
    if (!p) {
      seen[j] = 2;
      return null;
    }
    if (escape && p === 2) return 'sea';

    const rest = p === 3 ? allow - 1 : allow;
    if (rest < 0) return null; // out of sill here; a path with more may come later
    if (seen[j] === 1) {
      if (rest <= left[j]) return null;
    } else {
      if (count >= budget) return 'budget';
      count++;
    }
    seen[j] = 1;
    left[j] = rest;
    queue.push(j);
    return null;
  };

  for (const { x, y } of seeds) {
    if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h) continue;
    const j = (y - y0) * w + (x - x0);
    if (seen[j]) continue;
    seen[j] = 1;
    left[j] = sill;
    queue.push(j);
    count++;
  }

  for (;;) {
    while (head < queue.length) {
      const i = queue[head++];
      const x = x0 + (i % w);
      const y = y0 + ((i / w) | 0);
      const allow = left[i];
      const here = s.get(x, y);
      if (here < deepest) deepest = here;
      if (escape && here < DEEP) return out('deep');

      for (let k = 0; k < 4; k++) {
        const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x;
        const ny = k === 2 ? y + 1 : k === 3 ? y - 1 : y;

        if (nx < x0 || nx >= x0 + w || ny < y0 || ny >= y0 + h) {
          if (escape) return out('edge');
          continue;
        }
        const j = (ny - y0) * w + (nx - x0);
        const was = seen[j];
        if (was === 2) continue;
        if (was === 3) {
          if (allow > waiting.get(j)) waiting.set(j, allow);
          continue;
        }
        if (was === 1 && allow <= left[j]) continue;
        const stop = visit(j, nx, ny, s.get(nx, ny), allow);
        if (stop) return out(stop);
      }
    }

    if (!waiting.size) return out('enclosed');

    const cells = waiting;
    waiting = new Map();
    const tiles = new Map();
    for (const j of cells.keys()) {
      const x = x0 + (j % w);
      const y = y0 + ((j / w) | 0);
      tiles.set(s.key(x, y), [x, y]);
    }
    await Promise.all([...tiles.values()].map(([x, y]) => s.ensure(x, y)));

    for (const [j, allow] of cells) {
      const x = x0 + (j % w);
      const y = y0 + ((j / w) | 0);
      seen[j] = 0;
      const stop = visit(j, x, y, s.get(x, y), allow);
      if (stop) return out(stop);
    }
  }
}

/** Fill outward from a point, in a square window of 2·half pixels. */
async function fillAt(lon, lat, z, budget, half) {
  const s = sampler(z);
  const p = project(lon, lat, z);
  const seed = await nearestWater(s, Math.floor(p.x * TILE), Math.floor(p.y * TILE), 2, (x, y, e) => e < 0);
  if (!seed) return { result: 'noseed' };

  const y0 = Math.max(0, seed.y - half);
  const win = { x0: seed.x - half, y0, w: 2 * half, h: Math.min(s.W, seed.y + half) - y0 };
  return flood(s, [seed], win, { budget, sill: sillFor(z, lat) });
}

/* ─────────────────────────────────────────────────────────── landlocked */

/**
 * Is this below-sea-level point cut off from the ocean?
 *
 * @param elevation  metres at the point, as already sounded.
 *
 * Almost every click is settled by the map alone, with no tiles fetched: it's
 * drawn sea, or deeper than any inland basin, or a drawn lake. The fill only runs
 * where the map says land and the terrain says water — polders, dry basins,
 * undrawn fjords, and the coastal fringe the map generalises away.
 *
 * The fill has to *reach drawn sea*. Running out of water (the Dead Sea's valley,
 * a polder whose inland rule leaves it nowhere to go) or out of budget (Qattara,
 * 19,600 km² of desert basin with no sea anywhere in it) both mean cut off.
 *
 * Zoom 9 first: one pixel is ~300 m, and 150k cells cover ~13,000 km² for a
 * quarter of zoom 10's tiles. But zoom 9 can seal a narrow inlet, so "cut off" at
 * zoom 9 is only a suspicion, and zoom 10 has the final word.
 */
export async function landlocked(lon, lat, elevation) {
  if (elevation < DEEP) return false;

  await withMap();
  if (mapped) {
    const { kind } = waterAt(lon, lat);
    if (kind === SEA) return false;
    if (kind === LAKE) return true;
  }

  // Without the map there is no drawn sea to reach, so running out of budget
  // proves nothing — only a fill that closes completely counts.
  const cutOff = (f) => f.result === 'enclosed' || (mapped && f.result === 'budget');

  const coarse = await fillAt(lon, lat, 9, 150_000, 1024);
  if (!cutOff(coarse) && coarse.result !== 'noseed') return false;

  const fine = await fillAt(lon, lat, 10, 600_000, 1536);
  if (!cutOff(fine)) return false;
  if (mapped && fine.result === 'enclosed' && fine.deepest < INLAND_MIN && seaWithin(lon, lat, POCKET_KM)) {
    return false; // a fjord whose channel the terrain misses (see POCKET_KM)
  }
  return true;
}

/* ─────────────────────────────────────────────────────────── searchArea */

/** Pixels across the search box. Enough to see a peninsula; cheap to fill. */
const SEARCH_PX = 320;

/** Blocks per side of the grid the reachable water is snapped to for OBIS. */
const BLOCKS = 10;

const unmercator = (y, W) =>
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / W))) * 180) / Math.PI;

const ring = ([w, s, e, n]) =>
  `((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;

const fmt = (v) => v.toFixed(4);

/**
 * Follow water too narrow for the search zoom until it's wide enough to see.
 *
 * At 400 km a search pixel is ~2.4 km, and a fjord a kilometre wide simply isn't
 * there — this used to fall back to the plain box, searching straight over the
 * mountains either side. So fill at 8× the resolution from the click, inside the
 * box, and hand back the coarse pixels that fine fill touched: the ones that are
 * water at the coarse zoom become seeds, and all of them count as reached, so the
 * fjord itself is part of the search.
 *
 * @returns {{seeds: Array<{x, y}>, narrow: number[]}}  narrow: window indices
 */
async function liftNarrow(lon, lat, z, win, wet) {
  const none = { seeds: [], narrow: [] };
  if (z >= 10) return none;

  const zf = Math.min(10, z + 3);
  const k = 2 ** (zf - z);
  const f = sampler(zf);
  const p = project(lon, lat, zf);
  const seed = await nearestWater(f, Math.floor(p.x * TILE), Math.floor(p.y * TILE), 2, wet(f));
  if (!seed) return none;

  const HALF = 768;
  const fx0 = Math.max(win.x0 * k, seed.x - HALF);
  const fy0 = Math.max(win.y0 * k, seed.y - HALF);
  const fx1 = Math.min((win.x0 + win.w) * k, seed.x + HALF);
  const fy1 = Math.min((win.y0 + win.h) * k, seed.y + HALF);
  if (fx1 <= fx0 || fy1 <= fy0) return none;

  const fw = fx1 - fx0;
  const { seen } = await flood(f, [seed], { x0: fx0, y0: fy0, w: fw, h: fy1 - fy0 }, {
    escape: false,
    budget: 300_000,
    sill: sillFor(zf, lat),
    mapSea: true,
  });

  const coarse = sampler(z);
  const touched = new Set();
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] !== 1) continue;
    const cx = Math.floor((fx0 + (i % fw)) / k) - win.x0;
    const cy = Math.floor((fy0 + ((i / fw) | 0)) / k) - win.y0;
    if (cx >= 0 && cx < win.w && cy >= 0 && cy < win.h) touched.add(cy * win.w + cx);
  }

  const seeds = [];
  for (const i of touched) {
    const x = win.x0 + (i % win.w);
    const y = win.y0 + ((i / win.w) | 0);
    await coarse.ensure(x, y);
    if (wet(coarse)(x, y, coarse.get(x, y))) seeds.push({ x, y });
  }
  return { seeds, narrow: [...touched] };
}

/**
 * The search box, cut down to the water connected to the click, as WKT.
 *
 * The fill runs at whatever zoom puts ~320 pixels across the box — zoom 10 for
 * 25 km, zoom 6 for 400 km — so every radius costs about the same. The reached
 * water is snapped to a 10×10 grid and sent to OBIS as a MULTIPOLYGON of the
 * blocks it touches, merged into rectangles.
 *
 * Straits narrower than a pixel close at the coarse zooms, which only makes the
 * search more conservative: a 400 km search from the Black Sea stays in the
 * Black Sea. Water narrower than a pixel *at the click* — a fjord at 400 km
 * scale — is followed at a finer zoom until it opens out (see liftNarrow). When
 * the whole box is reachable, the plain box is returned, so the query — and its
 * cache entry on the server — is exactly what it always was.
 *
 * @param box  {w, s, e, n} in degrees
 */
export async function searchArea(lon, lat, radiusKm, box) {
  const plain = `POLYGON${ring([box.w, box.s, box.e, box.n].map(fmt))}`;

  // Web Mercator stops at ±85°, and well before that the box stops being square.
  if (Math.abs(lat) > 80) return plain;

  const kmPerPx0 = (40075 * Math.cos((lat * Math.PI) / 180)) / TILE;
  const z = Math.max(3, Math.min(10, Math.round(Math.log2((SEARCH_PX * kmPerPx0) / (2 * radiusKm)))));
  const s = sampler(z);

  const nw = project(box.w, box.n, z);
  const se = project(box.e, box.s, z);
  const x0 = Math.floor(nw.x * TILE);
  const y0 = Math.max(0, Math.floor(nw.y * TILE));
  const x1 = Math.ceil(se.x * TILE);
  const y1 = Math.min(s.W, Math.ceil(se.y * TILE));
  const win = { x0, y0, w: x1 - x0, h: y1 - y0 };
  if (win.w <= 0 || win.h <= 0) return plain;

  await Promise.all([withMap(), s.prefetch(x0, y0, x1 - 1, y1 - 1)]);

  const inWin = ({ x, y }) => x >= x0 && x < x1 && y >= y0 && y < y1;
  const wet = (f) => (x, y, e) => e < 0 && passes(f, x, y, e) > 0;

  const p = project(lon, lat, z);
  const seed = await nearestWater(s, Math.floor(p.x * TILE), Math.floor(p.y * TILE), 3, wet(s));

  const fill = (from) => flood(s, from, win, { escape: false, sill: sillFor(z, lat), mapSea: true });
  let seeds = seed && inWin(seed) ? [seed] : [];
  let narrow = []; // box pixels holding water only a finer fill could see
  let { seen } = await fill(seeds);

  // Hardly anywhere reached: the click's water doesn't join up at this zoom. A
  // sea loch's coast averages to dry land at 2.7 km a pixel, leaving the seed an
  // island of one; a fjord the terrain misses (see POCKET_KM) has no channel at
  // all. Two ways out, both taken:
  //
  //   Follow the water at a finer zoom until it opens out (liftNarrow).
  //
  //   Start from any drawn sea within POCKET_KM too, as the animals would —
  //   landlocked() already accepted the click as sea on exactly that basis. All
  //   of it, not the nearest: the nearest is often the fjord's own drawn mouth,
  //   which at this zoom is just another sealed pocket.
  if (seen.reduce((n, v) => n + (v === 1), 0) < 0.01 * seen.length) {
    const lifted = await liftNarrow(lon, lat, z, win, wet);
    seeds = [...seeds, ...lifted.seeds];
    narrow = lifted.narrow;
    // Plus a few pixels: at this zoom the coast itself is blurred into land.
    const r = Math.ceil((POCKET_KM * 1000) / pxMetres(z, lat)) + 3;
    const cx = Math.floor(p.x * TILE);
    const cy = Math.floor(p.y * TILE);
    for (let y = cy - r; y <= cy + r && mapped; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (inWin({ x, y }) && s.get(x, y) != null && s.water(x, y).kind === SEA) seeds.push({ x, y });
      }
    }
    ({ seen } = await fill(seeds));
  }

  for (const i of narrow) seen[i] = 1;
  if (!seen.includes(1)) return plain; // nothing to go on

  // Which blocks of the grid hold any reachable water?
  const hit = new Uint8Array(BLOCKS * BLOCKS);
  for (let j = 0; j < win.h; j++) {
    const row = Math.min(BLOCKS - 1, Math.floor((j * BLOCKS) / win.h));
    for (let i = 0; i < win.w; i++) {
      if (seen[j * win.w + i] === 1) {
        hit[row * BLOCKS + Math.min(BLOCKS - 1, Math.floor((i * BLOCKS) / win.w))] = 1;
      }
    }
  }
  if (hit.every(Boolean)) return plain;

  // Runs along each row, then stacked down while the next row repeats them.
  const rects = [];
  let open = new Map(); // "c0,c1" → rect still growing downward
  for (let r = 0; r < BLOCKS; r++) {
    const next = new Map();
    for (let c = 0; c < BLOCKS; c++) {
      if (!hit[r * BLOCKS + c]) continue;
      const c0 = c;
      while (c + 1 < BLOCKS && hit[r * BLOCKS + c + 1]) c++;
      const key = `${c0},${c}`;
      const rect = open.get(key) ?? { c0, c1: c, r0: r, r1: r };
      rect.r1 = r;
      if (!open.has(key)) rects.push(rect);
      next.set(key, rect);
    }
    open = next;
  }

  // Block edges back to degrees. The outer edges are the box's own numbers, so
  // nothing drifts outside the area we meant to search.
  const lonAt = (c) =>
    c === 0 ? box.w : c === BLOCKS ? box.e : ((x0 + (c * win.w) / BLOCKS) / s.W) * 360 - 180;
  const latAt = (r) =>
    r === 0 ? box.n : r === BLOCKS ? box.s : unmercator(y0 + (r * win.h) / BLOCKS, s.W);

  const polys = rects.map((q) =>
    ring([lonAt(q.c0), latAt(q.r1 + 1), lonAt(q.c1 + 1), latAt(q.r0)].map(fmt)),
  );
  return polys.length === 1 ? `POLYGON${polys[0]}` : `MULTIPOLYGON(${polys.join(', ')})`;
}
