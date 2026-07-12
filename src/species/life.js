/**
 * Everything living in a hexagon.
 *
 * The server does the heavy join (OBIS occurrences × a 44,000-species depth
 * catalogue) and hands back only what's actually there. This module adds the one
 * thing the catalogue can't have: the hand-curated sharks, whose day/night
 * behaviour comes from tagging papers rather than from a rule of thumb.
 *
 * Curated always beats inferred. If we have read the literature on an animal, we
 * do not let a heuristic overwrite it.
 */

import { SHARKS } from './sharks.js';

/** Curated records, keyed by name, normalised into the catalogue's shape. */
const CURATED = new Map(
  SHARKS.map((s) => [
    s.scientificName,
    {
      sci: s.scientificName,
      common: s.common,
      class: 'Elasmobranchii',
      family: null,
      order: null,
      habitat: s.habitat,
      day: s.day,
      night: s.night,
      dvm: s.dvm,
      maxDepth: s.maxDepth,
      note: s.note,
      glow: s.glow,
      iucn: s.iucn,
      size: s.size,
      src: 'curated',
    },
  ]),
);

const cache = new Map();

/**
 * A box of `radiusKm` around a point, as WKT.
 *
 * OBIS wants a polygon, and a click is a point — so we ask "what lives near
 * here". The radius has to be a real area: a survey ship samples a station, not
 * a coordinate, and a box tighter than a few tens of km would come back empty
 * almost everywhere in the open ocean.
 */
function boxAround(lon, lat, radiusKm) {
  const dLat = radiusKm / 110.6;
  const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const dLon = Math.min(179, radiusKm / (110.6 * cos));

  const w = (lon - dLon).toFixed(4);
  const e = (lon + dLon).toFixed(4);
  const s = Math.max(-89.9, lat - dLat).toFixed(4);
  const n = Math.min(89.9, lat + dLat).toFixed(4);

  return `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
}

async function query(wkt) {
  const res = await fetch(`/api/life?geometry=${encodeURIComponent(wkt)}`);
  if (!res.ok) throw new Error(`life ${res.status}`);
  return res.json();
}

/** Search radii, in km. We widen until we find something worth showing. */
const RADII = [25, 100, 400];

/**
 * What lives near a point.
 *
 * @returns {{known: Array, unknown: Array, total: number, radiusKm: number}}
 *   known   — species with a depth profile, curated ones first
 *   unknown — recorded here, but nobody has published a depth range for them
 */
export function lifeAt(lon, lat) {
  const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
  if (cache.has(key)) return cache.get(key);

  const job = (async () => {
    let data = null;
    let radiusKm = RADII[0];

    // Most of the open ocean has never been surveyed. Rather than show an empty
    // panel and imply the sea is empty, widen the search until it isn't.
    for (const r of RADII) {
      radiusKm = r;
      data = await query(boxAround(lon, lat, r));
      if (data.total >= 3) break;
    }

    const known = [];
    const unknown = [];

    for (const s of data.known) {
      const curated = CURATED.get(s.sci);
      known.push(curated ? { ...curated, records: s.records, aphia: s.aphia } : s);
    }

    // A curated shark whose depth range FishBase never published still belongs
    // in the column — we know it from the tagging work, not the database.
    for (const s of data.unknown) {
      const curated = CURATED.get(s.sci);
      if (curated) known.push({ ...curated, records: s.records, aphia: s.aphia });
      else unknown.push(s);
    }

    // Ordered by how often it has actually been recorded here — which is the
    // best proxy we have for "what am I likely to meet". Sorting curated species
    // first (as this did) would float a goblin shark above a blue shark, which is
    // exactly backwards for that question.
    known.sort((a, b) => b.records - a.records);

    return { known, unknown, total: data.total, radiusKm };
  })();

  cache.set(key, job);
  return job;
}
