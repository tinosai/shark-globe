/**
 * The bottom sheet.
 *
 * On a phone this is the whole interface — the globe is the backdrop and this is
 * where you actually read. Three resting positions:
 *
 *   peek  — depth, zone, a scrollable strip of what lives here
 *   half  — the water column
 *   full  — every species
 *
 * The hard part is sharing touch with the globe and with its own scrolling body.
 * Three rules, in order:
 *
 *   1. A drag that starts on the handle or header always moves the sheet.
 *   2. A drag inside the body moves the sheet only if the body is scrolled to the
 *      top and you're pulling down. Otherwise the body scrolls.
 *   3. The globe never sees any of it — the sheet stops the event.
 *
 * Without (2) the sheet fights its own scroll and the whole thing feels broken.
 */

const SNAPS = ['peek', 'half', 'full'];

export class Sheet {
  constructor(el, { onSnap } = {}) {
    this.el = el;
    this.body = el.querySelector('[data-sheet-body]');
    this.grip = el.querySelector('[data-sheet-grip]');
    this.onSnap = onSnap;

    this.snap = 'peek';
    this.y = 0;
    this.dragging = false;

    this.measure();
    this.applySnap('peek', { animate: false });

    // Pointer events cover touch, pen and mouse in one path.
    el.addEventListener('pointerdown', this.onDown, { passive: true });
    el.addEventListener('pointermove', this.onMove, { passive: false });
    el.addEventListener('pointerup', this.onUp, { passive: true });
    el.addEventListener('pointercancel', this.onUp, { passive: true });

    // Tapping the grip cycles up, which is what people try first.
    this.grip.addEventListener('click', () => {
      const i = SNAPS.indexOf(this.snap);
      this.to(SNAPS[Math.min(i + 1, SNAPS.length - 1)]);
    });

    this._resize = () => {
      this.measure();
      this.applySnap(this.snap, { animate: false });
    };
    window.addEventListener('resize', this._resize);
  }

  /** Visible height (px) at each snap. */
  measure() {
    const vh = window.innerHeight;
    this.height = this.el.offsetHeight; // fixed by CSS
    this.stops = {
      peek: Math.min(this.height, 156),
      half: Math.round(vh * 0.52),
      full: this.height,
    };
  }

  offsetFor(snap) {
    return this.height - this.stops[snap];
  }

  applySnap(snap, { animate = true } = {}) {
    this.snap = snap;
    this.y = this.offsetFor(snap);
    this.el.style.transition = animate
      ? 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)'
      : 'none';
    this.el.style.transform = `translate3d(0, ${this.y}px, 0)`;

    this.el.dataset.snap = snap;
    // Only scrollable once it's big enough to have somewhere to scroll.
    this.body.style.overflowY = snap === 'peek' ? 'hidden' : 'auto';
    this.onSnap?.(snap);
  }

  to(snap) {
    if (SNAPS.includes(snap)) this.applySnap(snap);
  }

  /** Rule 2: can this gesture move the sheet, or does the body own it? */
  canDrag(e, dy) {
    if (this.grip.contains(e.target) || e.target.closest('[data-sheet-header]')) return true;
    if (this.snap === 'peek') return true;
    // Inside the body: only a downward pull from the very top grabs the sheet.
    return this.body.scrollTop <= 0 && dy > 0;
  }

  onDown = (e) => {
    this.startY = e.clientY;
    this.startOffset = this.y;
    this.lastY = e.clientY;
    this.lastT = e.timeStamp;
    this.velocity = 0;
    this.dragging = false;
    this.decided = false;
  };

  onMove = (e) => {
    if (this.startY == null) return;
    const dy = e.clientY - this.startY;

    if (!this.decided) {
      if (Math.abs(dy) < 4) return; // let a tap stay a tap
      this.decided = true;
      this.dragging = this.canDrag(e, dy);
      if (this.dragging) {
        this.el.style.transition = 'none';
        this.el.setPointerCapture?.(e.pointerId);
      }
    }
    if (!this.dragging) return;

    e.preventDefault(); // we own this gesture now; don't scroll or rotate the globe

    const dt = e.timeStamp - this.lastT;
    if (dt > 0) this.velocity = (e.clientY - this.lastY) / dt; // px/ms
    this.lastY = e.clientY;
    this.lastT = e.timeStamp;

    const min = this.offsetFor('full');
    const max = this.offsetFor('peek');
    let next = this.startOffset + dy;

    // Rubber-band past the ends rather than stopping dead.
    if (next < min) next = min - (min - next) * 0.35;
    if (next > max) next = max + (next - max) * 0.35;

    this.y = next;
    this.el.style.transform = `translate3d(0, ${next}px, 0)`;
  };

  onUp = () => {
    this.startY = null;
    if (!this.dragging) return;
    this.dragging = false;

    // A decisive flick beats proximity — otherwise a fast short swipe snaps back
    // to where it came from, which feels like the sheet ignored you.
    const FLICK = 0.45; // px/ms
    const i = SNAPS.indexOf(this.snap);

    if (this.velocity < -FLICK) return this.applySnap(SNAPS[Math.min(i + 1, 2)]);
    if (this.velocity > FLICK) return this.applySnap(SNAPS[Math.max(i - 1, 0)]);

    // Otherwise: nearest resting position.
    let best = SNAPS[0];
    let bestDist = Infinity;
    for (const snap of SNAPS) {
      const dist = Math.abs(this.offsetFor(snap) - this.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = snap;
      }
    }
    this.applySnap(best);
  };

  destroy() {
    window.removeEventListener('resize', this._resize);
  }
}
