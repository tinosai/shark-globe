/**
 * The one place that turns an elevation into a colour.
 *
 * It used to live in three: a JS ramp for the hexagons, a GLSL ramp in the
 * shader, and a Python ramp in the basemap baker. Three copies of the same
 * numbers is three chances for the globe and the chart to disagree.
 */

/** Land is context, not content: one flat warm grey, no blue in it. */
const LAND = [141, 139, 132];

/**
 * Bathymetric ramp. Stops sit where the sea actually changes — the shelf break
 * at 200 m, the abyssal plain past 3 km — so the globe reads as a depth chart.
 * Keep in step with RAMP in scripts/build_basemap.py.
 */
const RAMP = [
  [0, [138, 222, 238]],
  [200, [86, 182, 222]],
  [1000, [52, 128, 194]],
  [3000, [32, 80, 152]],
  [5000, [22, 50, 112]],
  [11000, [11, 24, 62]],
];

function depthColor(depth, alpha = 255) {
  let i = 0;
  while (i < RAMP.length - 2 && depth > RAMP[i + 1][0]) i++;
  const [d0, c0] = RAMP[i];
  const [d1, c1] = RAMP[i + 1];
  const t = Math.max(0, Math.min(1, (depth - d0) / (d1 - d0)));
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * t),
    Math.round(c0[1] + (c1[1] - c0[1]) * t),
    Math.round(c0[2] + (c1[2] - c0[2]) * t),
    alpha,
  ];
}

/** Elevation in metres → RGB. Above water is land; below it is depth. */
export function colorFor(elevation) {
  return elevation >= 0 ? LAND : depthColor(-elevation);
}
