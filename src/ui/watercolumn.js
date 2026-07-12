/**
 * The water column.
 *
 * A cross-section of the sea beneath one hexagon, surface to seafloor. Each
 * animal is a vertical bar spanning the depths it occupies; flip day/night and
 * the bars move. That movement is the whole app.
 *
 * Two passes, deliberately:
 *   drawColumn() — builds the SVG. Once per hexagon.
 *   setPhase()   — moves the existing bars. Every day/night toggle.
 *
 * Rebuilding on a phase change would defeat the point: fresh <rect>s have no
 * previous `y` to animate from, so the CSS transition never fires and the bars
 * teleport. Mutating the same nodes is both cheaper and the only way the
 * migration reads as movement.
 *
 * Depth is on a sqrt scale. Linear would squash the top 200 m — where most of
 * the life is — into a hairline and hand half the chart to featureless abyss.
 */

import { ZONES, DVM_LABEL, migrates } from '../species/sharks.js';
import { colorOf } from '../species/groups.js';

const NS = 'http://www.w3.org/2000/svg';

/** Zone id → the short class the stylesheet uses. */
const ZONE_CLASS = {
  epipelagic: 'sun',
  mesopelagic: 'twi',
  bathypelagic: 'mid',
  abyssopelagic: 'abyss',
  hadal: 'hadal',
};

const PAD = { top: 16, right: 10, bottom: 14, left: 40 };

/** A phone is ~360px wide. More than eight bars and they're too thin to hit. */
const MAX_LANES = () => (window.innerWidth < 700 ? 8 : 12);

const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

function makeScale(seafloor, height) {
  const usable = height - PAD.top - PAD.bottom;
  const max = Math.sqrt(Math.max(seafloor, 1));
  return (depth) =>
    PAD.top + (Math.sqrt(Math.max(0, Math.min(depth, seafloor))) / max) * usable;
}

/** Where an animal sits right now, clamped to the seabed above it. */
function bandOf(sp, phase, seafloor) {
  const [a, b] = phase === 'night' ? sp.night : sp.day;
  return [Math.min(a, seafloor), Math.min(b, seafloor)];
}

/**
 * Pack species into columns so no two bars overlap.
 *
 * Lanes come from the UNION of each animal's day and night bands, not the band
 * it happens to occupy now. Packing per-phase would make a bar hop sideways when
 * the sun went down — and the vertical movement is the story.
 */
function assignLanes(species, seafloor, maxLanes) {
  const spans = species.map((sp, index) => {
    const [d0, d1] = bandOf(sp, 'day', seafloor);
    const [n0, n1] = bandOf(sp, 'night', seafloor);
    return { sp, index, top: Math.min(d0, n0), bottom: Math.max(d1, n1) };
  });

  spans.sort((a, b) => a.top - b.top);

  const laneEnds = [];
  for (const span of spans) {
    let lane = laneEnds.findIndex((end) => end < span.top);
    if (lane === -1) {
      if (laneEnds.length < maxLanes) {
        lane = laneEnds.length;
        laneEnds.push(0);
      } else {
        lane = span.index % maxLanes; // overlap beats hair-thin bars
      }
    }
    laneEnds[lane] = span.bottom;
    span.lane = lane;
  }

  return { spans, lanes: Math.max(1, laneEnds.length) };
}

/* ─────────────────────────────────────────────────────────────── structure */

export function drawColumn(svg, { seafloor, species, onPick }) {
  const width = svg.clientWidth || 340;
  const height = svg.clientHeight || 340;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const y = makeScale(seafloor, height);
  const plotLeft = PAD.left;
  const plotWidth = width - PAD.right - plotLeft;

  /* zones */
  const zones = el('g');
  for (const zone of ZONES) {
    if (zone.min >= seafloor) break;
    const top = y(zone.min);
    const h = y(Math.min(zone.max, seafloor)) - top;
    if (h < 0.5) continue;

    zones.append(
      el('rect', { x: 0, y: top, width, height: h, class: `wc-zone wc-zone--${ZONE_CLASS[zone.id]}` }),
    );
    if (h > 22) {
      const label = el('text', { x: plotLeft + 5, y: top + 12, class: 'wc-label' });
      label.textContent = zone.sub.toUpperCase();
      zones.append(label);
    }
  }
  svg.append(zones);

  /* depth axis */
  const axis = el('g');
  const ticks = [0, 50, 100, 200, 500, 1000, 2000, 4000, 6000, 8000, 10000].filter((d) => d < seafloor);
  ticks.push(seafloor);

  let lastY = -Infinity;
  for (const depth of ticks) {
    const ty = y(depth);
    if (ty - lastY < 14) continue;
    lastY = ty;
    axis.append(el('line', { x1: plotLeft - 3, x2: width - PAD.right, y1: ty, y2: ty, class: 'wc-grid' }));
    const t = el('text', { x: plotLeft - 7, y: ty + 3, class: 'wc-tick' });
    t.textContent = depth >= 1000 ? `${Math.round(depth / 1000)}k` : Math.round(depth);
    axis.append(t);
  }
  svg.append(axis);

  /* seabed — a jagged silhouette reads as seafloor; a straight line reads as a chart */
  const floorY = y(seafloor);
  const teeth = [];
  for (let i = 0; i <= 22; i++) {
    const fx = (i / 22) * width;
    teeth.push(`${fx},${floorY + Math.sin(i * 2.3) * 2 + Math.sin(i * 0.7) * 3}`);
  }
  const floor = el('g');
  floor.append(el('polygon', { points: `0,${height} ${teeth.join(' ')} ${width},${height}`, class: 'wc-seabed' }));
  floor.append(el('polyline', { points: teeth.join(' '), class: 'wc-seabed-line' }));
  svg.append(floor);

  /* bars */
  const maxLanes = MAX_LANES();
  const featured = species.slice(0, maxLanes);
  const { spans, lanes } = assignLanes(featured, seafloor, maxLanes);
  const laneWidth = plotWidth / lanes;
  const barWidth = Math.max(9, Math.min(30, laneWidth - 6));

  const group = el('g');
  const layout = [];

  for (const span of spans) {
    const { sp } = span;
    const cx = plotLeft + span.lane * laneWidth + laneWidth / 2;

    const g = el('g', {
      class: `wc-sp ${sp.src === 'curated' ? 'is-curated' : 'is-inferred'}`,
      'data-name': sp.sci,
      tabindex: '0',
      role: 'button',
      style: 'cursor:pointer',
    });

    // Where it will be at the other time of day. Standing still, it already
    // tells you the animal is going somewhere.
    const ghost = el('rect', {
      x: cx - barWidth / 2, width: barWidth, rx: Math.min(barWidth / 2, 6),
      class: 'wc-ghost', y: 0, height: 0,
    });
    const bar = el('rect', {
      x: cx - barWidth / 2, width: barWidth, rx: Math.min(barWidth / 2, 6),
      class: 'wc-bar', y: 0, height: 0,
      style: `--c:${colorOf(sp)}`,
    });

    // An invisible fat target over the bar. The bar can be 9px wide; a finger
    // is 44. Without this the chart is decoration, not a control.
    const hit = el('rect', {
      x: cx - Math.max(barWidth, 34) / 2, width: Math.max(barWidth, 34),
      y: PAD.top, height: height - PAD.top - PAD.bottom,
      fill: 'transparent',
    });

    const glow = sp.glow ? el('circle', { cx, r: 2.6, cy: 0, class: 'wc-glow' }) : null;
    const caret = migrates(sp) ? el('path', { d: '', class: 'wc-migrate' }) : null;

    const title = el('title');

    g.append(ghost, bar);
    if (glow) g.append(glow);
    if (caret) g.append(caret);
    g.append(hit, title);

    g.addEventListener('click', () => onPick?.(sp));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onPick?.(sp);
    });

    group.append(g);
    layout.push({ sp, cx, bar, ghost, glow, caret, title });
  }
  svg.append(group);

  return { y, seafloor, layout };
}

/* ─────────────────────────────────────────────────────────────── movement */

export function setPhase(view, phase) {
  if (!view) return;
  const { y, seafloor, layout } = view;
  const other = phase === 'day' ? 'night' : 'day';

  for (const { sp, cx, bar, ghost, glow, caret, title } of layout) {
    const [from, to] = bandOf(sp, phase, seafloor);
    const top = y(from);
    const bottom = Math.max(y(to), top + 3); // never thinner than a visible sliver

    bar.setAttribute('y', top);
    bar.setAttribute('height', bottom - top);

    const [oFrom, oTo] = bandOf(sp, other, seafloor);
    const oTop = y(oFrom);
    const oBottom = Math.max(y(oTo), oTop + 3);
    const moves = Math.abs(oTop - top) > 4;

    ghost.setAttribute('y', oTop);
    ghost.setAttribute('height', oBottom - oTop);
    ghost.style.opacity = moves ? '' : '0';

    if (glow) glow.setAttribute('cy', top - 6);

    if (caret) {
      const up = oTop < top;
      const ay = up ? top - 13 : bottom + 13;
      const dir = up ? -1 : 1;
      caret.setAttribute('d', `M${cx - 4},${ay - dir * 4} L${cx},${ay + dir * 4} L${cx + 4},${ay - dir * 4}`);
    }

    title.textContent =
      `${sp.common ?? sp.sci}\n${phase}: ${Math.round(from)}–${Math.round(to)} m\n` +
      `${DVM_LABEL[sp.dvm] ?? ''}` +
      (sp.src === 'inferred' ? '\n(inferred, not observed)' : '');
  }
}
