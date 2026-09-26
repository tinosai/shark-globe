/**
 * The globe: camera, controls, terrain streaming, and the point you clicked.
 *
 * No hexagons. You click the sea, we tell you what's under that spot. The H3
 * grid was a layer of machinery between the finger and the answer — thousands of
 * cells rebuilt on every zoom to draw a lattice that carried no information the
 * click didn't already have.
 *
 * Terrain arrives as tiles whose zoom tracks the camera, so the coastline is as
 * sharp as you like. The tiles are handed to the GPU raw and decoded in the
 * fragment shader, which means the picture on screen and the depth we report
 * come from the same bytes.
 */

import { Renderer } from './gl/renderer.js';
import { elevationAt, tileColor, dropQueued, project, MAX_TILE_ZOOM } from './bathymetry.js';
import { landlocked } from './reach.js';


const POLE_LIMIT = 89.5;
const MAX_ZOOM = 12;
const TAP_SLOP_PX = 8;
const TAP_MS = 500;

/** Never ask for more terrain than this at once. */
const MAX_PATCHES = 64;

/**
 * The whole-planet basemap is 4096 px wide — ~9.8 km/px, which is what a zoom-4
 * tile gives. Streaming tiles at or below this would lay a blurrier image over a
 * sharper one, which is exactly what the globe was doing when zoomed out.
 */
const BASEMAP_EQUIV_Z = 4;

export class Globe {
  constructor(canvas, { onSelect, onViewChange, onProbe }) {
    this.onSelect = onSelect;
    this.onViewChange = onViewChange;
    this.onProbe = onProbe;
    this.canvas = canvas;

    this.gl = new Renderer(canvas, { maxPixelRatio: 1.5 });
    this.gl.buildSphere();

    this.marker = null;
    this.viewState = { longitude: -40, latitude: 18, zoom: 1.1 };
    this.gl.camera = { lon: -40, lat: 18, zoom: 1.1 };

    this.loadBasemap();
    this.bindControls(canvas);

    this._resize = () => {
      this.requestDraw();
      this.streamTerrain();
    };
    window.addEventListener('resize', this._resize);

    this.requestDraw();
    this.streamTerrain();
    this.onViewChange?.(this.viewState);
  }

  async loadBasemap() {
    try {
      const img = new Image();
      img.src = '/data/basemap.png';
      await img.decode();
      this.gl.setBasemap(img);
      this.requestDraw();
    } catch (err) {
      console.warn('basemap failed:', err);
    }
  }

  /* ────────────────────────────────────────────────────── terrain tiles */

  /**
   * The tile zoom that makes one tile pixel ≈ one screen pixel.
   *
   * A tile spans 360/2^z degrees across 256 px; the screen spans 360 degrees
   * across 512·2^zoom px. Setting those equal gives z = zoom + 1. Below that the
   * coastline is mush (which is exactly what a single global image gives you);
   * above it we'd be fetching detail no one can see.
   */
  tileZoom() {
    // One texel per DEVICE pixel, not per CSS pixel. A tile spans 256 texels over
    // 360/2^z degrees; the screen spans 360 degrees over 512·2^zoom·dpr device
    // pixels. Solving gives z = zoom + 1 + log2(dpr) — and dropping that log2
    // term (as I first did) fetches a zoom level too coarse on any retina screen
    // and then magnifies it, which is half of why the coast looked chunky.
    //
    // Capped at MAX_TILE_ZOOM (10): past it the ocean tiles are all zeros, and
    // elevation >= 0 is painted as land, so more zoom would turn the sea grey.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const ideal = this.viewState.zoom + 1 + Math.log2(dpr);
    return Math.max(2, Math.min(MAX_TILE_ZOOM, Math.round(ideal)));
  }

  /** Which tiles cover what's on screen, at zoom z. */
  tileRange(z) {
    const { width, height } = this.viewSize();
    const { longitude, latitude, zoom } = this.viewState;
    const n = 2 ** z;

    const kmPerPx = 40075 / (512 * 2 ** zoom);

    // Each axis from its own half-extent. Using the screen DIAGONAL for both —
    // which is what this did — inflates the box by ~1.4x in each direction, so
    // ~2x the tiles, which then tripped the budget and forced a step down to a
    // coarser zoom. The over-fetch was making the picture worse.
    const cos = Math.max(0.08, Math.cos((latitude * Math.PI) / 180));
    const dLat = Math.min(85, ((height / 2) * kmPerPx) / 110.6);
    const dLon = Math.min(180, ((width / 2) * kmPerPx) / (110.6 * cos));

    const toX = (lon) => Math.floor(((lon + 180) / 360) * n);
    const toY = (lat) => {
      const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
      return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n);
    };

    const x0 = toX(longitude - dLon);
    const x1 = toX(longitude + dLon);
    const y0 = Math.max(0, toY(Math.min(85.05, latitude + dLat)));
    const y1 = Math.min(n - 1, toY(Math.max(-85.05, latitude - dLat)));

    return { n, x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
  }

  /**
   * Fetch and upload the terrain covering what's on screen.
   *
   * If the ideal zoom needs more tiles than we're willing to fetch, we step DOWN
   * a zoom and try again — we do not give up. The old code bailed out entirely in
   * that case, dropped every patch, and left the coarse 10 km/px basemap showing.
   * That's the blur: not a missing feature, a fallback that fired far too often.
   */
  async streamTerrain() {
    clearTimeout(this._stream);
    this._stream = setTimeout(async () => {
      let z = this.tileZoom();
      let range = this.tileRange(z);

      // Too many tiles for one view: take a coarser zoom rather than give up.
      while (range.count > MAX_PATCHES && z > BASEMAP_EQUIV_Z) {
        z--;
        range = this.tileRange(z);
      }

      // The whole-planet basemap is 4096px wide — about 9.8 km per pixel, which
      // is exactly a zoom-4 tile. Streaming tiles at or below that would cover a
      // sharp image with a blurrier one. Zoomed out, the basemap IS the right
      // answer; that's what it's for.
      if (z <= BASEMAP_EQUIV_Z || range.count <= 0) {
        dropQueued(new Set());
        this.gl.keepOnly(new Set());
        this._streamZ = 0;
        this.requestDraw();
        return;
      }

      const { n, x0, x1, y0, y1 } = range;
      const wanted = new Set();
      const missing = [];

      // Centre outward: the middle of the screen is where you're looking, and
      // where you're about to click.
      const c = project(this.viewState.longitude, this.viewState.latitude, z);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const tx = ((x % n) + n) % n;
          const key = `${z}/${tx}/${y}`;
          wanted.add(key);
          if (!this.gl.hasPatch(key)) {
            missing.push({ key, tx, y, d: Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y) });
          }
        }
      }
      missing.sort((a, b) => a.d - b.d);

      // Whatever the last view queued and this one doesn't need never gets
      // fetched. Without this, every step of a zoom left a screenful of tiles in
      // the queue ahead of the ones you're actually looking at.
      dropQueued(wanted);

      const jobs = missing.map(({ key, tx, y, d }) =>
        tileColor(z, tx, y, 1 + d).then((img) => {
          if (img && this._streamZ === z) {
            this.gl.addPatch(key, z, tx, y, img);
            this.requestDraw();
          }
        }),
      );

      this._streamZ = z;
      await Promise.all(jobs);

      // Only drop the old tiles once the new ones are up, or the globe blinks
      // back to the coarse basemap between every zoom step.
      if (this._streamZ === z) {
        this.gl.keepOnly(wanted);
        this.requestDraw();
      }
    }, 90);
  }

  /* ────────────────────────────────────────────────────────────── camera */

  viewSize() {
    return {
      width: Math.max(280, this.canvas.clientWidth),
      height: Math.max(280, this.canvas.clientHeight),
    };
  }

  setView(next) {
    const lat = Math.max(-POLE_LIMIT, Math.min(POLE_LIMIT, next.latitude));
    let lon = next.longitude;
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;

    this.viewState = {
      longitude: lon,
      latitude: lat,
      zoom: Math.max(0, Math.min(MAX_ZOOM, next.zoom)),
    };
    this.gl.camera = { lon, lat, zoom: this.viewState.zoom };
    this.requestDraw();
    this.onViewChange?.(this.viewState);
    this.streamTerrain();
  }

  zoomBy(dz) {
    this.setView({ ...this.viewState, zoom: this.viewState.zoom + dz });
  }

  toPole(which) {
    this.setView({
      ...this.viewState,
      latitude: which === 'north' ? POLE_LIMIT : -POLE_LIMIT,
      zoom: 1.6,
    });
  }

  reset() {
    this.setView({ longitude: -40, latitude: 18, zoom: 1.1 });
  }

  /* ─────────────────────────────────────────────────────────── controls */

  bindControls(canvas) {
    const pointers = new Map();
    let dragged = 0;
    let downAt = 0;
    let pinchDist = 0;
    let lastTap = 0;
    this.velocity = { lon: 0, lat: 0 };

    const degPerPx = () => 360 / (512 * 2 ** this.viewState.zoom);

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragged = 0;
        downAt = e.timeStamp;
        this.velocity = { lon: 0, lat: 0 };
        cancelAnimationFrame(this._coast);
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && dist > 0) {
          this.setView({
            ...this.viewState,
            zoom: this.viewState.zoom + Math.log2(dist / pinchDist),
          });
        }
        pinchDist = dist;
        dragged += 99;
        return;
      }

      dragged += Math.abs(dx) + Math.abs(dy);
      const k = degPerPx();
      this.velocity = { lon: -dx * k, lat: dy * k };
      this.setView({
        longitude: this.viewState.longitude - dx * k,
        latitude: this.viewState.latitude + dy * k,
        zoom: this.viewState.zoom,
      });
    });

    canvas.addEventListener('pointerup', (e) => {
      const wasTap = dragged < TAP_SLOP_PX && e.timeStamp - downAt < TAP_MS;
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size > 0) return;

      if (!wasTap) {
        this.coast();
        return;
      }

      this.velocity = { lon: 0, lat: 0 };
      if (e.timeStamp - lastTap < 300) {
        lastTap = 0;
        this.zoomBy(1);
      } else {
        lastTap = e.timeStamp;
        this.click(e);
      }
    });

    canvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
    });

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setView({ ...this.viewState, zoom: this.viewState.zoom - e.deltaY * 0.003 });
      },
      { passive: false },
    );

    // Safari reports a pinch as its own gesture events and can swallow the
    // second pointer, which left the iPhone unable to zoom at all.
    let gestureZoom = 0;
    canvas.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      gestureZoom = this.viewState.zoom;
    });
    canvas.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      if (e.scale > 0) this.setView({ ...this.viewState, zoom: gestureZoom + Math.log2(e.scale) });
    });
    canvas.addEventListener('gestureend', (e) => e.preventDefault());
  }

  coast() {
    const step = () => {
      const v = this.velocity;
      if (Math.abs(v.lon) < 0.002 && Math.abs(v.lat) < 0.002) return;
      this.setView({
        longitude: this.viewState.longitude + v.lon,
        latitude: this.viewState.latitude + v.lat,
        zoom: this.viewState.zoom,
      });
      this.velocity = { lon: v.lon * 0.92, lat: v.lat * 0.92 };
      this._coast = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this._coast);
    this._coast = requestAnimationFrame(step);
  }

  /* ─────────────────────────────────────────────────────────────── click */

  /**
   * Ray → sphere → lon/lat → how deep is it there?
   *
   * That's the whole interaction. If the point is above sea level, or below it
   * but walled off from the ocean, we say so rather than silently doing nothing — a click that produces no response is
   * indistinguishable from a broken app.
   */
  async click(e) {
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.gl.pick(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;

    const [lon, lat] = hit;
    const token = (this._token = Symbol('click'));
    this.onProbe?.({ lon, lat });

    const elevation = await elevationAt(lon, lat, MAX_TILE_ZOOM);
    if (this._token !== token) return; // clicked again while we waited

    if (elevation == null) {
      this.onSelect?.({ lon, lat, depth: null, reason: 'nodata' });
      return;
    }
    if (elevation >= 0) {
      this.onSelect?.({ lon, lat, depth: null, elevation, reason: 'land' });
      return;
    }

    // Below sea level isn't the same as sea: the Caspian, the Dead Sea and the
    // Salton Sea all are, and so is a Dutch polder. Only water land doesn't wall
    // in counts.
    const enclosed = await landlocked(lon, lat, elevation);
    if (this._token !== token) return;
    if (enclosed) {
      this.onSelect?.({ lon, lat, depth: null, elevation, reason: 'landlocked' });
      return;
    }

    const depth = -elevation;
    this.marker = { lon, lat };
    this.requestDraw();

    this.onSelect?.({ lon, lat, depth });
  }

  clearSelection() {
    this.marker = null;
    this.onMarker?.(null);
    this.requestDraw();
  }

  /**
   * Draw on the next frame, once.
   *
   * Not a permanent rAF loop. The old one called requestAnimationFrame every
   * frame forever, whether or not anything had changed — which repaints 60x a
   * second while the globe sits perfectly still, drains a phone battery for
   * nothing, and means the page never goes idle (a headless browser can't even
   * tell when it has finished loading).
   */
  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.gl.draw();

      // The pin lives in the DOM, so all we owe it is a screen position. Null
      // when the point has rotated round the back of the planet.
      if (this.marker) {
        const { lon, lat } = this.marker;
        this.onMarker?.(this.gl.project(lon, lat));
      }
    });
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._coast);
    clearTimeout(this._stream);
    window.removeEventListener('resize', this._resize);
  }
}
