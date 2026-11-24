// Shortest-column masonry that renders in batches. Column heights are estimated from each
// item's known aspect ratio, so placing a card never forces a layout read, and the newest
// items land across the first row instead of down the first column.

const DENSITY_MIN_WIDTH = { compact: 132, standard: 200, large: 300 };
const BATCH = 48;
const GAP = 12;

export function columnCountFor(width, density) {
  const min = DENSITY_MIN_WIDTH[density] || DENSITY_MIN_WIDTH.standard;
  return Math.max(1, Math.floor((Math.max(0, width) + GAP) / (min + GAP)));
}

/** Image height / width, clamped so extreme long images do not swallow a column. */
export function aspectOf(item) {
  if (!item.width || !item.height) return 1;
  return Math.min(3, Math.max(0.25, item.height / item.width));
}

export class MasonryGrid {
  /**
   * @param {HTMLElement} scrollEl scrolling container
   * @param {(item, parent: HTMLElement) => HTMLElement} renderCard
   */
  constructor(scrollEl, renderCard) {
    this.scrollEl = scrollEl;
    this.renderCard = renderCard;
    this.items = [];
    this.rendered = 0;
    this.density = 'standard';
    this.footerEstimate = 0.18;
    this.columns = [];
    this.heights = [];
    this.root = null;
    this.sentinel = null;
    this.width = 0;

    const win = scrollEl.ownerDocument?.defaultView || globalThis;
    this.resizeObserver = win.ResizeObserver ? new win.ResizeObserver(() => this.onResize()) : null;
    this.resizeObserver?.observe(scrollEl);
    this.intersection = win.IntersectionObserver
      ? new win.IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) this.appendBatch();
      }, { root: scrollEl, rootMargin: '1200px 0px' })
      : null;
  }

  /** Replaces the item list. `keep` re-renders at least as many cards as were showing. */
  setItems(items, { density, keep = false } = {}) {
    const previous = this.rendered;
    this.items = items;
    if (density) this.density = density;
    this.layout(keep ? Math.max(BATCH, previous) : BATCH);
  }

  layout(target = BATCH) {
    const width = this.scrollEl.clientWidth - 24;
    this.width = width;
    const count = columnCountFor(width, this.density);
    this.root?.remove();
    this.intersection?.disconnect();
    this.root = this.scrollEl.createDiv({ cls: `crisp-visual-masonry density-${this.density}` });
    this.columns = [];
    this.heights = new Array(count).fill(0);
    for (let i = 0; i < count; i++) this.columns.push(this.root.createDiv({ cls: 'crisp-visual-column' }));
    this.sentinel = this.scrollEl.createDiv({ cls: 'crisp-visual-sentinel' });
    this.root.after(this.sentinel);
    this.rendered = 0;
    this.appendUpTo(Math.min(target, this.items.length));
    this.intersection?.observe(this.sentinel);
  }

  appendUpTo(end) {
    for (let i = this.rendered; i < end; i++) {
      const item = this.items[i];
      let shortest = 0;
      for (let c = 1; c < this.heights.length; c++) if (this.heights[c] < this.heights[shortest] - 0.01) shortest = c;
      this.renderCard(item, this.columns[shortest]);
      this.heights[shortest] += aspectOf(item) + this.footerEstimate;
    }
    this.rendered = Math.max(this.rendered, end);
  }

  appendBatch() {
    if (this.rendered >= this.items.length) return;
    this.appendUpTo(Math.min(this.items.length, this.rendered + BATCH));
  }

  onResize() {
    const width = this.scrollEl.clientWidth - 24;
    if (Math.abs(width - this.width) < 1) return;
    const before = columnCountFor(this.width, this.density);
    const after = columnCountFor(width, this.density);
    this.width = width;
    if (before === after && this.root) return;
    const scrollTop = this.scrollEl.scrollTop;
    this.layout(Math.max(BATCH, this.rendered));
    this.scrollEl.scrollTop = scrollTop;
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    this.root?.remove();
    this.sentinel?.remove();
  }
}
