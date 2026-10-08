/**
 * The gallery's masonry, placed by CSS — so the server's HTML is already the right layout.
 *
 * **Why not a column count.** The layout used to be chosen in JS (a media-query hook) and
 * rendered as one flex column per masonry column. A server cannot see the viewport, so the
 * hook's server answer was four columns for everybody: a phone painted four skinny columns
 * and reflowed to two after hydration — the largest layout shift measured anywhere in the app
 * (CLS 0.34–0.63 on a throttled phone), and the reflow moved every card to a different
 * parent, so React remounted them and their images were requested again. A cookie-mirrored
 * count only fixes a *returning* visitor, and rendering three distributions for a first one
 * triples the cards the server sends and the client hydrates.
 *
 * **What happens instead.** The placement is pure arithmetic on the rows' aspect ratios, so
 * it is computed here for every column count the layout can show (2 / 3 / 4) and handed to
 * CSS as custom properties; a media query picks the set for the current width. The cards are
 * one flat list, keyed on the image id, whose DOM never changes with the viewport — the first
 * paint is right on every device without a script, hydration renders exactly what the server
 * sent, and a breakpoint change moves boxes instead of remounting them. The hero flight reads
 * a card's `getBoundingClientRect` and is indifferent to how the box got there.
 *
 * DOM order is therefore feed order. Placement is shortest-column-first, so that is also,
 * near enough, the order a sighted reader scans the grid in — left to right, top to bottom —
 * which the old column-major DOM order was not.
 *
 * The CSS half is the masonry block in `app/globals.css`; the breakpoints there are
 * `BREAKPOINTS.md` / `BREAKPOINTS.lg` for the counts and `BREAKPOINTS.sm` for the gap.
 */

import { clamp } from '@/lib/utils';

/** The column counts the layout can show, narrowest first: phone, `md`, `lg`. */
export const MASONRY_COLUMN_COUNTS = [2, 3, 4] as const;

/* ---------------------------------------------------------------------------
 * How wide a card is — for `sizes`, and for picking a rendition the optimizer cannot resize
 *
 * The same numbers the CSS lays the page out with: the shell's page gutter (16px, 24px from
 * `sm`), the docked navigation drawer (288px from `md`), the gallery's `max-w-7xl` column
 * (1280px), and the masonry gap (8px, 16px from `sm`) and column counts above. `sizes` used to
 * say a third of the viewport at `md`, which counted the drawer's 288px as gallery: a 136px card
 * asked for 253px, 3.4× the pixels (R4-043).
 *
 * The drawer is assumed docked from `md` — its default, and the state in which the cards are
 * narrowest. Collapsed, a tablet card is up to 1.4× wider than this says and draws slightly soft.
 * ------------------------------------------------------------------------ */

const PAGE_GUTTER = { base: 16, sm: 24 } as const;
const DRAWER_WIDTH = 288;
const GALLERY_MAX_WIDTH = 1280;
const GAP = { base: 8, sm: 16 } as const;

/** The gallery column's width at a viewport width. */
function galleryWidth(viewport: number): number {
  if (viewport < 640) return viewport - 2 * PAGE_GUTTER.base;
  if (viewport < 768) return viewport - 2 * PAGE_GUTTER.sm;
  return Math.min(GALLERY_MAX_WIDTH, viewport - DRAWER_WIDTH - 2 * PAGE_GUTTER.sm);
}

/** A masonry card's CSS width at a viewport width. */
export function estimateCardWidth(viewport: number): number {
  const columns = viewport < 768 ? 2 : viewport < 1024 ? 3 : 4;
  const gap = viewport < 640 ? GAP.base : GAP.sm;
  return Math.max(0, (galleryWidth(viewport) - (columns - 1) * gap) / columns);
}

/** The viewport width from which the gallery column stops growing. */
const GALLERY_CAPPED_FROM = GALLERY_MAX_WIDTH + DRAWER_WIDTH + 2 * PAGE_GUTTER.sm;

/**
 * `sizes` for a masonry card, in the layout's own terms: two columns under `md` (the gap and
 * gutter step at `sm`), three to `lg`, four after — beside the docked drawer — until the column
 * caps at 1280px.
 */
export const MASONRY_CARD_SIZES = [
  `(max-width: 639px) calc((100vw - ${2 * PAGE_GUTTER.base + GAP.base}px) / 2)`,
  `(max-width: 767px) calc((100vw - ${2 * PAGE_GUTTER.sm + GAP.sm}px) / 2)`,
  `(max-width: 1023px) calc((100vw - ${DRAWER_WIDTH + 2 * PAGE_GUTTER.sm + 2 * GAP.sm}px) / 3)`,
  `(max-width: ${GALLERY_CAPPED_FROM - 1}px) calc((100vw - ${DRAWER_WIDTH + 2 * PAGE_GUTTER.sm + 3 * GAP.sm}px) / 4)`,
  `${(GALLERY_MAX_WIDTH - 3 * GAP.sm) / 4}px`,
].join(', ');

/** `sizes` for a block as wide as the gallery column (the 近日推荐 banner). */
export const GALLERY_BLOCK_SIZES = [
  `(max-width: 639px) calc(100vw - ${2 * PAGE_GUTTER.base}px)`,
  `(max-width: 767px) calc(100vw - ${2 * PAGE_GUTTER.sm}px)`,
  `(max-width: ${GALLERY_CAPPED_FROM - 1}px) calc(100vw - ${DRAWER_WIDTH + 2 * PAGE_GUTTER.sm}px)`,
  `${GALLERY_MAX_WIDTH}px`,
].join(', ');

interface Sized {
  width?: number;
  height?: number;
}

/** Height over width, with the same fallback the card itself renders (a square). */
function aspectOf(item: Sized): number {
  const width = item.width || 1;
  const height = item.height || 1;
  return height / width;
}

/** Four decimals: well under a device pixel at any realistic column width, and a string, so the
 *  server and the client serialise the identical value. */
const num = (value: number) => String(Math.round(value * 10000) / 10000);

export interface MasonryLayout {
  /** Custom properties for the grid element: its height for each column count. */
  grid: Record<string, string>;
  /** Custom properties per item, in input order: its own aspect (`--mr`, height over width), and
   *  column, aspect sum above it and the number of cards above it, for each column count. */
  items: Record<string, string>[];
}

/**
 * Places `items` for every column count. Each item goes to the column whose aspect sum is
 * smallest (ties to the leftmost) — the gallery's own rule, unchanged, so the pictures sit
 * where they always did.
 *
 * An item's top is `a · w + k · g`: the aspect ratios above it times the column width, plus one
 * gap per card above it. A column's height is `A · w + (K − 1) · g`, and the grid is as tall as
 * its tallest column — a `max()` over the columns, because which column is tallest depends on
 * the ratio between the column width and the gap, which only the browser knows.
 */
export function masonryLayout(items: readonly Sized[]): MasonryLayout {
  const grid: Record<string, string> = {};
  /* The slot's own height, so the slot can be a relayout boundary (see `.masonry-item`). */
  const placed: Record<string, string>[] = items.map((item) => ({ '--mr': num(aspectOf(item)) }));

  for (const count of MASONRY_COLUMN_COUNTS) {
    const sums = new Array<number>(count).fill(0);
    const counts = new Array<number>(count).fill(0);
    items.forEach((item, index) => {
      let column = 0;
      for (let c = 1; c < count; c += 1) if (sums[c] < sums[column]) column = c;
      const style = placed[index];
      style[`--mc${count}`] = String(column);
      style[`--ma${count}`] = num(sums[column]);
      style[`--mk${count}`] = String(counts[column]);
      sums[column] += aspectOf(item);
      counts[column] += 1;
    });
    const heights = sums
      .map((sum, column) =>
        counts[column] === 0
          ? null
          : `calc(${num(sum)} * var(--masonry-w) + ${counts[column] - 1} * var(--masonry-gap))`,
      )
      .filter((height): height is string => height !== null);
    grid[`--mh${count}`] =
      heights.length === 0 ? '0px' : heights.length === 1 ? heights[0] : `max(${heights.join(', ')})`;
  }

  return { grid, items: placed };
}

/** A CSS length as the grid declares it (`1rem`, `8px`), in pixels. */
function cssPixels(value: string): number {
  const raw = value.trim();
  if (raw.endsWith('rem')) return parseFloat(raw) * parseFloat(getComputedStyle(document.documentElement).fontSize || '16');
  return parseFloat(raw) || 0;
}

/* ---------------------------------------------------------------------------
 * The placement in pixels, for script
 *
 * Read back from the custom properties above rather than kept beside them: the layout's shape is
 * what the server serialises, and four decimals of an aspect is a thirtieth of a pixel at any
 * column width this grid has. Every number here comes from the placement and from the grid's
 * own geometry — one box, one computed style — so no card has to be measured, or even mounted.
 * ------------------------------------------------------------------------ */

type ColumnCount = (typeof MASONRY_COLUMN_COUNTS)[number];

/**
 * Which column count the stylesheet chose for this grid. Not a free read: the grid sits inside a
 * size container (`.masonry`, for its `cqw`), and Chrome resolves a style read under one by laying
 * the page out first. `MasonryGrid` once wrote its height hold after this and found the page laid
 * out — and the reader's offset clamped — before the hold existed (see `heldGrid` there).
 */
function columnCountOf(grid: HTMLElement): ColumnCount {
  const count = Number(getComputedStyle(grid).getPropertyValue('--masonry-n'));
  return (MASONRY_COLUMN_COUNTS as readonly number[]).includes(count) ? (count as ColumnCount) : MASONRY_COLUMN_COUNTS[0];
}

/** A grid's live geometry: its box, and its column count, column width and gap as resolved. */
export interface GridGeometry {
  rect: DOMRect;
  count: ColumnCount;
  width: number;
  gap: number;
}

/** `null` when the grid has no box (an inactive pane). One layout read. */
export function gridGeometry(grid: HTMLElement): GridGeometry | null {
  const rect = grid.getBoundingClientRect();
  if (rect.width === 0) return null;
  const count = columnCountOf(grid);
  const gap = cssPixels(getComputedStyle(grid).getPropertyValue('--masonry-gap'));
  return { rect, count, gap, width: (rect.width - (count - 1) * gap) / count };
}

/** Where a placed item sits inside its grid, in pixels: its slot's top left and its height. */
export function slotBox(item: Record<string, string> | undefined, geometry: GridGeometry): { x: number; y: number; height: number } {
  if (!item) return { x: 0, y: 0, height: 0 };
  const { count, width, gap } = geometry;
  return {
    x: Number(item[`--mc${count}`]) * (width + gap),
    y: Number(item[`--ma${count}`]) * width + Number(item[`--mk${count}`]) * gap,
    height: Number(item['--mr']) * width,
  };
}

/** The height a placement gives its grid at `geometry` — the `--mh` the stylesheet resolves. */
export function placedHeight(items: readonly Record<string, string>[], geometry: GridGeometry): number {
  let height = 0;
  for (const item of items) {
    const slot = slotBox(item, geometry);
    height = Math.max(height, slot.y + slot.height);
  }
  return height;
}

/**
 * The run of `items` whose slots meet the band `[top, bottom]`, in viewport coordinates — the
 * cards a grid that is arriving has to show first. Read from the placement and the grid's live
 * geometry (its box, its column count and its gap, as the stylesheet resolved them), so no slot
 * has to exist yet. `null` when no slot meets it, or the grid has no box (an inactive pane).
 */
export function slotsInBand(
  items: readonly Record<string, string>[],
  grid: HTMLElement,
  top: number,
  bottom: number,
): { from: number; to: number } | null {
  const geometry = gridGeometry(grid);
  if (!geometry) return null;
  let from = -1;
  let to = -1;
  items.forEach((item, index) => {
    const slot = slotBox(item, geometry);
    const y = geometry.rect.top + slot.y;
    if (y < bottom && y + slot.height > top) {
      if (from < 0) from = index;
      to = index + 1;
    }
  });
  return from < 0 ? null : { from, to };
}

/* ---------------------------------------------------------------------------
 * "The grid replaced a placeholder that was on screen"
 *
 * The entrance cascade exists for a grid *arriving*. When the grid takes over from its own
 * skeleton, the skeleton already said "arriving" for as long as it was up, and a cascade on top
 * is the same news twice — the judgement AGENTS.md makes for a page turn. The skeleton reports
 * its own unmount; the grid that mounts in the same commit reads it. Commit-scoped rather than
 * timed: React runs every removed component's layout cleanup before any new layout effect in
 * the same commit, and the flag is cleared on the next microtask, after that commit.
 * ------------------------------------------------------------------------ */

let skeletonJustLeft = false;

/** Called by `ImageGridSkeleton` as it unmounts. */
export function noteSkeletonReplaced(): void {
  skeletonJustLeft = true;
  queueMicrotask(() => {
    skeletonJustLeft = false;
  });
}

/** Whether a grid skeleton left the screen in the commit that is mounting the caller. */
export function replacedSkeleton(): boolean {
  return skeletonJustLeft;
}

/* ---------------------------------------------------------------------------
 * Bringing a card into view — for a list's `reveal` (`lib/imageSequence.ts`)
 *
 * The detail steps through the list while the list sits behind it, so the card the viewer ends
 * on can be pages or screens away from where the list was left. Before the return flight looks
 * for its thumbnail, the list turns to that card's page (its own business) and these put the
 * card on screen: instantly, under the overlay, where the move cannot be seen.
 * ------------------------------------------------------------------------ */

/** The card for picture `id` inside `root`, or null. */
export function findCard(root: ParentNode | null | undefined, id: number): HTMLElement | null {
  if (!root) return null;
  return root.querySelector<HTMLElement>(`[data-image-hero-role='thumbnail'][data-image-hero-id='${id}']`);
}

/**
 * Resolves with the card once it is in the DOM — a page turn mounts it a render or two later —
 * or null after `timeoutMs`. Frame-polled: the wait is at most a few frames, and a
 * MutationObserver over a fifty-card subtree would fire for every attribute the cards write.
 */
export function waitForCard(
  root: () => ParentNode | null | undefined,
  id: number,
  timeoutMs = 3000,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      const card = findCard(root(), id);
      if (card) {
        resolve(card);
        return;
      }
      if (performance.now() - started > timeoutMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * Scrolls the card's own scroller — the app scroller, or a dialog's body — so the card is fully
 * visible, centred where it fits. Instant: this runs under the detail overlay, and a glide there
 * would only delay the return flight. A card already in view is left where it is.
 */
export function scrollCardIntoView(card: HTMLElement): void {
  const scroller =
    card.closest<HTMLElement>('[data-app-scroll-container]') ??
    document.querySelector<HTMLElement>('[data-image-hero-gallery-scroll]');
  if (!scroller) return;
  const view = scroller.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  if (box.top >= view.top && box.bottom <= view.bottom) return;
  const offset = box.height >= view.height ? 8 : (view.height - box.height) / 2;
  const max = scroller.scrollHeight - scroller.clientHeight;
  scroller.scrollTop = clamp(scroller.scrollTop + box.top - view.top - offset, 0, Math.max(0, max));
}
