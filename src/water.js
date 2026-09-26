/**
 * Sea, land or lake, from a drawn map — the one thing elevation can't say.
 *
 * data/water.bin is Natural Earth at 1/32° (~3.5 km), baked by
 * scripts/build_water.py. It exists for the places where "below sea level" and
 * "sea" part company: a Dutch polder whose dykes are narrower than a terrain
 * pixel, the Qattara basin, the Caspian. src/reach.js decides how much to trust
 * it; this module only answers "what's drawn here?".
 *
 * Kept run-length encoded (~430 KB) and decoded a row at a time on demand.
 */

export const SEA = 0;
export const LAND = 1;
export const LAKE = 2;

let map = null;
let loading = null;
const rows = new Map(); // row index -> Uint8Array of classes

/** Fetch the map once. Everything else here is synchronous after this. */
export function loadWater() {
  loading ??= (async () => {
    const res = await fetch('/data/water.bin');
    if (!res.ok) throw new Error(`water map → ${res.status}`);
    const buf = await res.arrayBuffer();
    const head = new DataView(buf);
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
    if (magic !== 'WMSK') throw new Error('water map: bad header');

    const width = head.getUint16(4, true);
    const height = head.getUint16(6, true);
    const res_ = head.getUint16(8, true);
    const starts = new Uint32Array(buf.slice(12, 12 + 4 * (height + 1)));
    const runs = new Uint16Array(buf.slice(12 + 4 * (height + 1)));
    map = { width, height, res: res_, starts, runs };
  })();
  return loading;
}

function row(y) {
  let r = rows.get(y);
  if (r) return r;
  const { width, starts, runs } = map;
  r = new Uint8Array(width);
  let x = 0;
  for (let i = starts[y]; i < starts[y + 1]; i++) {
    const end = runs[i] & 0x3fff;
    r.fill(runs[i] >> 14, x, end);
    x = end;
  }
  if (rows.size > 1024) rows.clear(); // ~12 MB; a fill touches a few hundred rows
  rows.set(y, r);
  return r;
}

/** Map cell under a point. */
function cell(lon, lat) {
  const { width, height, res } = map;
  return {
    x: ((Math.floor((lon + 180) * res) % width) + width) % width,
    y: Math.min(height - 1, Math.max(0, Math.floor((90 - lat) * res))),
  };
}

/**
 * What's drawn at a point, and whether sea is drawn within one cell of it.
 *
 * "Near sea" is what lets a coast be a coast: Natural Earth's shoreline is
 * generalised by a kilometre or two, so a cell drawn as land right beside the
 * sea may well be water. Only land away from any drawn sea is trusted as land.
 */
export function waterAt(lon, lat) {
  const { width, height } = map;
  const c = cell(lon, lat);
  const kind = row(c.y)[c.x];

  let nearSea = kind === SEA;
  for (let dy = -1; dy <= 1 && !nearSea; dy++) {
    const yy = c.y + dy;
    if (yy < 0 || yy >= height) continue;
    const r = row(yy);
    for (let dx = -1; dx <= 1; dx++) {
      if (r[(c.x + dx + width) % width] === SEA) {
        nearSea = true;
        break;
      }
    }
  }
  return { kind, nearSea };
}

/**
 * Is sea drawn anywhere within `km` of a point? A square search, which is all
 * the precision a 3.5 km map can offer anyway.
 */
export function seaWithin(lon, lat, km) {
  const { width, height, res } = map;
  const c = cell(lon, lat);
  const cellKm = 111.32 / res;
  const ry = Math.ceil(km / cellKm);
  const rx = Math.min(width >> 1, Math.ceil(km / (cellKm * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))));
  for (let dy = -ry; dy <= ry; dy++) {
    const yy = c.y + dy;
    if (yy < 0 || yy >= height) continue;
    const r = row(yy);
    for (let dx = -rx; dx <= rx; dx++) {
      if (r[(((c.x + dx) % width) + width) % width] === SEA) return true;
    }
  }
  return false;
}
