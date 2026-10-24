'use client';

/**
 * **The gallery under an open detail skips its off-screen cards' style work.**
 *
 * `inert` on `<main>` is what keeps the list out of reach while a detail covers it (the overlay
 * lets Tab out to the app bar, see `lib/overlay.ts`), and toggling it restyles the whole subtree:
 * lifting it on a return was 1,818 elements and 176ms of one task at 4× CPU on a phone-sized
 * home page (traced on dev.picpony.top), the largest single cost of a close, and arming it after an
 * open's landing nearly as much. Most of those elements are cards nobody can see.
 *
 * So while a detail covers the gallery (and until a return has fully settled), every masonry slot
 * takes `content-visibility: auto` (`app/globals.css`): a slot far from the viewport is skipped,
 * and the inheritance change `inert` makes waits inside it instead of running in the close. Traced
 * the same way, the lift drops to ~1,000 elements and ~89ms — what is left is the cards the
 * engine still counts as near the viewport, the detail itself and the page chrome.
 *
 * Not permanently: `content-visibility: auto` on the slots was measured slower for scrolling
 * (see the note above `.image-card` in `app/globals.css`), so after the return the slots are let
 * go a few at a time in idle slices — each paying its own deferred restyle, ~3ms — and the
 * gallery is back to plain slots within a second or so.
 */

const COVERED = 'data-gallery-covered';
const LIVE = 'data-gallery-live';
const RELEASE_CHUNK = 4;

type Idle = (callback: () => void) => number;
type CancelIdle = (handle: number) => void;

function scheduler(): { schedule: Idle; cancel: CancelIdle } {
  const w = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    return {
      schedule: (callback) => w.requestIdleCallback!(callback, { timeout: 500 }),
      cancel: (handle) => w.cancelIdleCallback!(handle),
    };
  }
  return {
    schedule: (callback) => window.setTimeout(callback, 50),
    cancel: (handle) => window.clearTimeout(handle),
  };
}

/** A detail covers the gallery: skip what is off screen (idempotent). */
export function coverGallery(main: HTMLElement) {
  main.querySelectorAll(`[${LIVE}]`).forEach((slot) => slot.removeAttribute(LIVE));
  if (!main.hasAttribute(COVERED)) main.setAttribute(COVERED, '');
}

/**
 * The gallery is settled and in front again: give the slots back a few per idle slice, then drop
 * the marker. Returns a cancel, for a detail that covers the gallery again meanwhile.
 */
export function uncoverGallery(main: HTMLElement): () => void {
  if (!main.hasAttribute(COVERED)) return () => {};
  const { schedule, cancel } = scheduler();
  const slots = [...main.querySelectorAll<HTMLElement>(`.masonry-item:not([${LIVE}])`)];
  let index = 0;
  let handle = 0;
  const step = () => {
    handle = 0;
    if (!main.isConnected || !main.hasAttribute(COVERED)) return;
    const end = Math.min(slots.length, index + RELEASE_CHUNK);
    for (; index < end; index += 1) slots[index].setAttribute(LIVE, '');
    if (index < slots.length) {
      handle = schedule(step);
      return;
    }
    main.removeAttribute(COVERED);
    main.querySelectorAll(`[${LIVE}]`).forEach((slot) => slot.removeAttribute(LIVE));
  };
  handle = schedule(step);
  return () => {
    if (handle) cancel(handle);
    handle = 0;
  };
}
