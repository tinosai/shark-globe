/**
 * Shark Globe.
 *
 * Click the sea → we sound the seafloor at that exact point → ask OBIS what has
 * been recorded near it → draw the water column. Day/night is a pure re-render
 * of the same data.
 */

import { Globe } from './globe.js';
import { lifeAt } from './species/life.js';
import { drawColumn, setPhase } from './ui/watercolumn.js';
import { articleFor } from './ui/wiki.js';
import { Sheet } from './ui/sheet.js';
import { zoneAt, DVM_LABEL, IUCN, migrates } from './species/sharks.js';
import { GROUPS, groupOf, colorOf } from './species/groups.js';


const $ = (s) => document.querySelector(s);
const isPhone = () => window.innerWidth < 860;

const dom = {
  sheet: $('#sheet'),
  body: $('#sheet-body'),
  depth: $('#depth'),
  unit: $('#depth-unit'),
  zone: $('#zone'),
  coords: $('#coords'),
  tally: $('#tally'),
  tallyN: $('#tally-n'),
  tallyMig: $('#tally-mig'),
  status: $('#status'),
  spinner: $('#spinner'),
  svg: $('#watercolumn'),
  filters: $('#filters'),
  list: $('#species-list'),
  rare: $('#rare'),
  rareCount: $('#rare-count'),
  rareList: $('#rare-list'),
  others: $('#others'),
  hint: $('#hint'),
  ping: $('#ping'),
  wiki: $('#wiki'),
  wikiBody: $('#wiki-body'),
  wikiBack: $('#wiki-back'),
  phases: document.querySelectorAll('[data-phase] > button, #phase button'),
};

const state = {
  phase: 'day',
  point: null,
  seafloor: null,
  life: null,
  group: 'all',
  view: null,
};

/* ─────────────────────────────────────────────────────────────── formatting */

/** Depth as an instrument reading: value and unit split so the unit can shrink. */
function fmtDepth(m) {
  return m >= 1000
    ? { value: (m / 1000).toFixed(2), unit: 'km' }
    : { value: String(Math.round(m)), unit: 'm' };
}

const fmtCoord = (lat, lon) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;

/** How many get the headline treatment. The rest go in the drawer. */
const TOP_N = 10;

/** Habitat codes that mean "lives on the bottom", not "swims over it". */
const BOTTOM = new Set([
  'demersal', 'bathydemersal', 'reef-associated', 'benthic', 'sessile', 'host',
]);

/**
 * Could this animal actually be at THIS point?
 *
 * The search widens when a spot is sparsely surveyed, and off Sydney a 100 km box
 * reaches back over the continental shelf. That dragged coastal reef species into
 * 4 km of open ocean — and a spotted wobbegong, a bottom-dweller that tops out
 * around 110 m, cannot live on an abyssal plain. It was recorded *in the box*,
 * not *at the point*.
 *
 * Bottom-dwellers must be able to reach the bottom. Pelagic animals are exempt:
 * a whale shark over a 4 km trench is simply swimming above it, which is fine.
 */
function reachable(s, seafloor) {
  if (!BOTTOM.has((s.habitat ?? '').toLowerCase())) return true;
  return (s.maxDepth ?? Infinity) >= seafloor * 0.9;
}

const visible = () => {
  const all = (state.life?.known ?? []).filter((s) => reachable(s, state.seafloor));
  return state.group === 'all' ? all : all.filter((s) => groupOf(s) === state.group);
};

/** The ones you're most likely to meet, and the long tail. */
const split = () => {
  const rows = visible();
  return { likely: rows.slice(0, TOP_N), rest: rows.slice(TOP_N) };
};

/* ────────────────────────────────────────────────────────────────── filters */

function renderFilters() {
  // Count what we'd actually show, not what OBIS returned — the two differ once
  // bottom-dwellers that can't reach this seafloor are dropped.
  const shownAll = state.life.known.filter((s) => reachable(s, state.seafloor));

  const counts = new Map();
  for (const s of shownAll) {
    const g = groupOf(s);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }

  dom.filters.replaceChildren();

  const add = (id, label, color, n) => {
    const b = document.createElement('button');
    b.className = 'chip' + (state.group === id ? ' is-on' : '');
    b.innerHTML =
      (color ? `<i style="--c:${color}"></i>` : '') +
      `<span>${label}</span><b>${n}</b>`;
    b.addEventListener('click', () => {
      state.group = id;
      renderFilters();
      rebuild();
    });
    dom.filters.append(b);
  };

  add('all', 'All', null, shownAll.length);
  for (const [id, g] of Object.entries(GROUPS)) {
    const n = counts.get(id);
    if (n) add(id, g.label, g.color, n);
  }
}

/* ─────────────────────────────────────────────────────────── species list */

const shown = new Map();

/**
 * How many times OBIS has recorded this animal near here.
 *
 * Shown because the ranking is built on it, and without it a species backed by a
 * single sighting looks exactly like one backed by a thousand. In the open ocean
 * a point may hold only four sharks on record — so "4th most likely" can rest on
 * one observation, and the reader deserves to see that.
 */
function fmtRecords(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function speciesRow(s) {
  {
    const band = state.phase === 'night' ? s.night : s.day;
    const from = Math.round(Math.min(band[0], state.seafloor));
    const to = Math.round(Math.min(band[1], state.seafloor));
    const thin = (s.records ?? 0) < 5;

    const li = document.createElement('li');
    li.className = 'species';
    li.dataset.name = s.sci;
    li.tabIndex = 0;
    li.style.setProperty('--c', colorOf(s));
    li.innerHTML = `
      <span class="sp-dot"></span>
      <span class="sp-main">
        <span class="sp-name">${s.common ?? s.sci}</span>
        <span class="sp-sci">${s.sci}</span>
      </span>
      <span class="sp-right">
        ${migrates(s) ? '<span class="sp-tag sp-tag--mig">migrates</span>' : ''}
        <span class="sp-band">${from}–${to}m</span>
        <span class="sp-obs${thin ? ' is-thin' : ''}"
              title="${s.records} OBIS record${s.records === 1 ? '' : 's'} near this point — the evidence this ranking rests on">${fmtRecords(s.records ?? 0)}</span>
        <span class="sp-chev">›</span>
      </span>`;
    return li;
  }
}

function renderList() {
  const { likely, rest } = split();
  shown.clear();

  const top = document.createDocumentFragment();
  for (const s of likely) {
    shown.set(s.sci, s);
    top.append(speciesRow(s));
  }
  dom.list.replaceChildren(top);

  // The long tail, behind a disclosure. Recorded here, but you'd be lucky.
  if (!rest.length) {
    dom.rare.hidden = true;
    return;
  }
  dom.rare.hidden = false;
  dom.rareCount.textContent = rest.length;

  const tail = document.createDocumentFragment();
  for (const s of rest) {
    shown.set(s.sci, s);
    tail.append(speciesRow(s));
  }
  dom.rareList.replaceChildren(tail);
}

// Delegated: a busy patch of sea holds 500 rows, and binding listeners to each
// one meant ~1,500 listeners rebuilt on every click.
for (const list of [dom.list, dom.rareList]) {
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.species');
    const sp = li && shown.get(li.dataset.name);
    if (sp) openWiki(sp);
  });
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const li = e.target.closest('.species');
    const sp = li && shown.get(li.dataset.name);
    if (sp) openWiki(sp);
  });
}

function renderOthers() {
  const others = state.life.unknown;
  if (!others.length) {
    dom.others.hidden = true;
    return;
  }
  dom.others.hidden = false;
  dom.others.innerHTML = `
    <h3>Recorded, but undescribed · ${others.length}</h3>
    <p>Seen here, but no published depth range exists — so they can't be placed
      in the water column.</p>
    <ul class="others-list">
      ${others.slice(0, 120).map((o) => `<li>${o.sci}</li>`).join('')}
    </ul>`;
}

/* ─────────────────────────────────────────────────────────── water column */

function rebuild() {
  if (state.seafloor == null || !state.life) return;
  dom.svg.hidden = false;
  // The water column charts the ten you'd most likely meet. Charting 40 would
  // make it a thicket of bars nobody can read.
  state.view = drawColumn(dom.svg, {
    seafloor: state.seafloor,
    species: split().likely,
    onPick: openWiki,
  });
  setPhase(state.view, state.phase);
  renderList();
}

function applyPhase() {
  setPhase(state.view, state.phase);
  for (const s of visible()) {
    const band = state.phase === 'night' ? s.night : s.day;
    const chip = document.querySelector(
      `.species-list [data-name="${CSS.escape(s.sci)}"] .sp-band`,
    );
    if (chip) {
      chip.textContent =
        `${Math.round(Math.min(band[0], state.seafloor))}–` +
        `${Math.round(Math.min(band[1], state.seafloor))}m`;
    }
  }
}

/* ───────────────────────────────────────────────────────────────── wiki */

async function openWiki(s) {
  dom.wiki.hidden = false;
  requestAnimationFrame(() => dom.wiki.classList.add('is-open'));
  dom.wiki.scrollTop = 0;

  const head = `
    <div class="wk-head">
      <span class="wk-dot" style="--c:${colorOf(s)}"></span>
      <div>
        <h2>${s.common ?? s.sci}</h2>
        <p class="wk-sci">${s.sci}</p>
      </div>
    </div>`;

  dom.wikiBody.innerHTML = head + '<p class="wk-quiet">Looking this animal up…</p>';

  const article = await articleFor(s);

  dom.wikiBody.innerHTML = `
    ${head}
    ${article?.image ? `<img class="wk-img" src="${article.image}" alt="${s.sci}" loading="lazy">` : ''}
    ${article ? `<p class="wk-text">${article.extract}</p>` : ''}
    ${s.note ? `<p class="wk-note">${s.note}</p>` : ''}
    <dl class="wk-facts">
      <div><dt>Group</dt><dd>${GROUPS[groupOf(s)].label}</dd></div>
      ${s.family ? `<div><dt>Family</dt><dd>${s.family}</dd></div>` : ''}
      ${s.habitat ? `<div><dt>Habitat</dt><dd>${s.habitat}</dd></div>` : ''}
      <div><dt>Depth by day</dt><dd>${s.day[0]}–${s.day[1]} m</dd></div>
      <div><dt>Depth by night</dt><dd>${s.night[0]}–${s.night[1]} m</dd></div>
      <div><dt>Daily rhythm</dt><dd>${DVM_LABEL[s.dvm] ?? '—'}</dd></div>
      ${s.maxDepth ? `<div><dt>Deepest record</dt><dd>${s.maxDepth} m</dd></div>` : ''}
      ${s.iucn ? `<div><dt>Status</dt><dd>${IUCN[s.iucn]?.label ?? s.iucn}</dd></div>` : ''}
      ${s.records ? `<div><dt>Records here</dt><dd>${s.records}</dd></div>` : ''}
    </dl>
    <p class="wk-prov">${
      s.src === 'curated'
        ? 'Day/night depths hand-curated from tagging and survey literature.'
        : 'Depth range from FishBase / SeaLifeBase. The day/night split is <strong>inferred</strong> from habitat and depth — a reasonable guess, not an observation.'
    }</p>
    ${article?.url ? `<a class="wk-link" href="${article.url}" target="_blank" rel="noopener">Read on Wikipedia →</a>` : '<p class="wk-quiet">No Wikipedia article for this species. Most of the ocean is like this.</p>'}`;
}

function closeWiki() {
  dom.wiki.classList.remove('is-open');
  setTimeout(() => {
    if (!dom.wiki.classList.contains('is-open')) dom.wiki.hidden = true;
  }, 360);
}

/* ──────────────────────────────────────────────────────────────── select */

/** Wipe the panel back to a clean slate. */
function clearPanel() {
  dom.tally.hidden = true;
  dom.rare.hidden = true;
  dom.rare.open = false;
  dom.rareList.replaceChildren();
  dom.list.replaceChildren();
  dom.filters.replaceChildren();
  dom.others.hidden = true;
  dom.svg.hidden = true;
}

async function select(point) {
  const { lon, lat, depth, reason } = point;
  state.point = `${lon.toFixed(4)},${lat.toFixed(4)}`;
  state.group = 'all';
  closeWiki();

  dom.hint.classList.add('is-gone');
  dom.coords.textContent = fmtCoord(lat, lon);

  // Clicking land used to do nothing at all, which is indistinguishable from a
  // broken app. Say what happened.
  if (reason) {
    clearPanel();
    dom.spinner.hidden = true;
    dom.depth.textContent = '—';
    dom.unit.textContent = '';
    dom.zone.textContent = reason === 'land' ? 'Dry land' : 'No data';
    dom.status.textContent =
      reason === 'land'
        ? 'That point is above sea level. Only the ocean is clickable.'
        : 'No elevation data for that point.';
    return;
  }

  if (isPhone() && sheet.snap === 'peek') sheet.to('half');

  state.seafloor = depth;
  const { value, unit } = fmtDepth(depth);
  dom.depth.textContent = value;
  dom.unit.textContent = unit;
  dom.zone.textContent = zoneAt(depth).sub;

  clearPanel();
  dom.spinner.hidden = false;
  dom.status.textContent = 'Asking OBIS what lives here…';

  try {
    const life = await lifeAt(lon, lat);
    if (state.point !== `${lon.toFixed(4)},${lat.toFixed(4)}`) return; // clicked elsewhere
    state.life = life;
    dom.spinner.hidden = true;

    const shownAll = life.known.filter((s) => reachable(s, state.seafloor));
    const mig = shownAll.filter(migrates).length;
    dom.tally.hidden = false;
    dom.tallyN.textContent = shownAll.length;
    dom.tallyMig.textContent = mig ? `${mig} migrate` : '';

    if (!life.total) {
      dom.status.textContent =
        'No records within 400 km. Much of the open ocean has never been surveyed — absence of data is not absence of life.';
      return;
    }

    // "Most likely" is only meaningful if there's enough evidence to rank on.
    // Out in the open ocean a point may hold four species on record, one of them
    // seen exactly once — and then the order is noise, not likelihood. Say so
    // rather than let the list imply a confidence it hasn't got.
    // Warn only when the RANKING is untrustworthy — when the ones we call "most
    // likely" rest on almost nothing. Counting thin species across the whole list
    // flagged Sydney, where the top species has 2,199 records; a sparse long tail
    // is normal, a sparse HEAD is the problem.
    const head = shownAll.slice(0, TOP_N);
    const thinHead = head.filter((s) => (s.records ?? 0) < 5).length;
    const sparse = shownAll.length <= 6 || thinHead >= Math.ceil(head.length / 2);

    dom.status.innerHTML =
      `Recorded within ${life.radiusKm} km of this point, ordered by how often. ` +
      `Tap any species to read about it.` +
      (sparse
        ? `<span class="caveat">The open sea is barely surveyed, and most of these
           rest on a handful of sightings. The counts on the right are the evidence —
           where they're small, the order means little. And they measure how often
           people <em>looked</em>, not how many are there: most open-ocean shark
           records come from fishing boats, not from anyone watching.</span>`
        : '');

    renderFilters();
    rebuild();
    renderOthers();
  } catch (err) {
    dom.spinner.hidden = true;
    dom.status.textContent = `Could not reach OBIS: ${err.message}`;
  }
}

/* ─────────────────────────────────────────────────────────────────── boot */

const sheet = new Sheet(dom.sheet);

// The canvas is already sized to the space beside/above the sheet (see the CSS),
// so the globe simply fills it.
const hud = $('#hud');

const globe = new Globe($('#deck'), {
  onSelect: select,
  onViewChange: (vs) => {
    // km per screen pixel — a plain statement of how much detail you're seeing.
    const kmPerPx = 40075 / (512 * 2 ** vs.zoom);
    const scale = kmPerPx >= 1 ? `${kmPerPx.toFixed(1)} km/px` : `${Math.round(kmPerPx * 1000)} m/px`;
    hud.textContent = `z${vs.zoom.toFixed(1)} · ${scale}`;
  },
});

// The globe sounds the seafloor before it can know whether a tap was water.
// That's a network round-trip on a cold tile, so say so.
globe.onProbe = () => {
  dom.spinner.hidden = false;
  dom.status.textContent = 'Sounding the seafloor…';
};

// The pin follows the point as the globe turns, and hides when it rotates round
// the back. Position only — the glow and the pulse are CSS.
globe.onMarker = (screen) => {
  if (!screen) {
    dom.ping.hidden = true;
    return;
  }
  dom.ping.hidden = false;
  dom.ping.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
};

for (const btn of dom.phases) {
  btn.addEventListener('click', () => {
    if (state.phase === btn.dataset.phase) return;
    state.phase = btn.dataset.phase;
    document.body.dataset.phase = state.phase;

// Handles for the console, and for scripts/capture.py + scripts/verify.py. The
// app never reads these — they exist so a person (or a headless browser) can
// drive it from outside.
Object.assign(globalThis, { globe, sheet, state });
    for (const b of dom.phases) {
      const on = b === btn;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    applyPhase();
  });
}

dom.wikiBack.addEventListener('click', closeWiki);

const CAMERA = {
  in: () => globe.zoomBy(1),
  out: () => globe.zoomBy(-1),
  north: () => globe.toPole('north'),
  south: () => globe.toPole('south'),
  reset: () => globe.reset(),
};
for (const btn of document.querySelectorAll('[data-cam]')) {
  btn.addEventListener('click', () => CAMERA[btn.dataset.cam]());
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeWiki();
  if (e.key === 'd') document.querySelector('#phase [data-phase="day"]').click();
  if (e.key === 'n') document.querySelector('#phase [data-phase="night"]').click();
});

// Re-lay the column when the sheet or window changes its width. Guarded: the
// rebuild re-renders the list, which can add a scrollbar, which changes the
// width — and would call us straight back.
let lastW = 0;
let queued = false;
new ResizeObserver(([entry]) => {
  const w = Math.round(entry.contentRect.width);
  if (w === lastW || w === 0 || queued || dom.svg.hidden) return;
  lastW = w;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    rebuild();
  });
}).observe(dom.svg);

document.body.dataset.phase = state.phase;

// Handles for the console, and for scripts/capture.py + scripts/verify.py. The
// app never reads these — they exist so a person (or a headless browser) can
// drive it from outside.
Object.assign(globalThis, { globe, sheet, state });
