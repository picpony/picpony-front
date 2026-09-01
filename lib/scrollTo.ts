'use client';

import { getAppScroller } from '@/lib/appScroller';
import { motionTier, scaledMs } from '@/lib/appearance';
import { clamp } from '@/lib/utils';

/**
 * Programmatic scrolling, on rAF rather than GSAP's ScrollToPlugin.
 *
 * `scrollTop` is not a CSS property, so this is the one motion Web Animations cannot express —
 * it is a per-frame write either way. The plugin's cost was its host: `components/Pagination.tsx`
 * is on ten screens and imported `lib/motion` for these two functions alone, pulling GSAP into
 * every route's first document. Same curve (`0.33, 0, 0, 1`, below) and square-root duration
 * band; GSAP's `lagSmoothing` is deliberately not kept — a stalled frame is charged to the
 * scroll rather than delaying it, and arriving late at the right place beats arriving on time
 * at the wrong one.
 */

/** `cubic-bezier(0.33, 0, 0, 1)` — `eases.scroll` in `lib/motion.ts`. Keep the two in step. */
const P1X = 0.33;
const P1Y = 0;
const P2X = 0;
const P2Y = 1;

/* Newton–Raphson on x, then evaluate y. Eight iterations is well past convergence for a curve
   this shallow; the derivative only vanishes at the endpoints, which are exact. */
function bezier(t: number): number {
  const cx = 3 * P1X;
  const bx = 3 * (P2X - P1X) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * P1Y;
  const by = 3 * (P2Y - P1Y) - cy;
  const ay = 1 - cy - by;

  let x = t;
  for (let i = 0; i < 8; i += 1) {
    const error = ((ax * x + bx) * x + cx) * x - t;
    if (Math.abs(error) < 1e-6) break;
    const slope = (3 * ax * x + 2 * bx) * x + cx;
    if (Math.abs(slope) < 1e-6) break;
    x -= error / slope;
  }
  return ((ay * x + by) * x + cy) * x;
}

/** One tween at a time per scroller, so a second call overwrites rather than fights. */
const running = new WeakMap<HTMLElement, number>();

function runScroll(scroller: HTMLElement, to: number, jump: boolean) {
  const previous = running.get(scroller);
  if (previous !== undefined) cancelAnimationFrame(previous);

  if (jump) {
    running.delete(scroller);
    scroller.style.overflowAnchor = '';
    scroller.scrollTop = to;
    return;
  }

  const from = scroller.scrollTop;
  const distance = Math.abs(from - to);
  /* Duration follows the square root of the distance (distance law): perceived travel speed
     scales sub-linearly, so a linear map makes short hops sluggish and long ones frantic —
     a fixed length would instead make the *speed* scale with distance, a whip-pan from the
     bottom of a long gallery and a crawl from near the top. The band keeps even a whole-page
     jump under about a second. There is deliberately no fixed-length escape hatch. */
  const duration = scaledMs(clamp(280 * Math.sqrt(distance / 300), 360, 1100));

  /* Scroll anchoring normally keeps the gallery steady as thumbnails decode above the
     viewport; during a deliberate programmatic scroll it fights us — the incoming page
     re-lays out mid-tween, the browser "corrects" scrollTop, and the result is a visible
     lurch. Suspended for the length of the tween only. */
  scroller.style.overflowAnchor = 'none';

  const start = performance.now();
  const step = (now: number) => {
    const p = duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
    scroller.scrollTop = from + (to - from) * bezier(p);
    if (p < 1) {
      running.set(scroller, requestAnimationFrame(step));
      return;
    }
    running.delete(scroller);
    scroller.style.overflowAnchor = '';
  };
  running.set(scroller, requestAnimationFrame(step));
}

/**
 * Scrolls the app's real scroll container back to the top.
 *
 * A tween rather than `scrollTo({ behavior: 'smooth' })`: native smooth scrolling janks over
 * a long masonry list while thumbnails decode, and this way the easing matches the rest of
 * the app's motion. Falls back to the window for any surface rendered outside the shell.
 *
 * A scroll offset is *state*, not decoration: every tier still lands on it — only the travel
 * is dropped, and only by the tier that drops all travel. Same distinction as
 * `applyInstantTabScroll` — the preference asks for less movement, not for less positioning.
 */
export function scrollAppToTop({ smooth = true }: { smooth?: boolean } = {}) {
  const scroller = getAppScroller();
  const jump = !smooth || motionTier() === 'off';

  if (!scroller) {
    window.scrollTo(jump ? { top: 0 } : { top: 0, behavior: 'smooth' });
    return;
  }

  if (scroller.scrollTop === 0) return;
  runScroll(scroller, 0, jump);
}

/**
 * Scrolls so that `target`'s top edge sits at the top of the viewport.
 *
 * Paginating should land on the first row of the new page, not back above the featured banner —
 * you already chose to move past it.
 *
 * `scroller` overrides which element is moved: not everything that scrolls is the app scroller
 * (an image-detail overlay brings its own), and the callers that reach for this could not name
 * it — `element.scrollIntoView({ behavior: 'smooth' })` got the browser's own curve, the one
 * scrolling motion that did not match the rest.
 *
 * The glide survives the reduced tier — a scroll's destination only makes sense in terms of
 * where you came from, and it costs nothing but a composited offset. Only `off` teleports.
 */
export function scrollAppToElement(
  target: Element | null,
  {
    smooth = true,
    offset = 8,
    scroller: override,
  }: {
    smooth?: boolean;
    offset?: number;
    scroller?: HTMLElement | null;
  } = {},
) {
  if (!target) return;
  const scroller = override ?? getAppScroller();
  const jump = !smooth || motionTier() === 'off';

  if (!scroller) {
    const top = window.scrollY + target.getBoundingClientRect().top - offset;
    window.scrollTo(jump ? { top } : { top, behavior: 'smooth' });
    return;
  }

  const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const next = Math.max(0, scroller.scrollTop + delta - offset);
  // Already within a few pixels — moving would read as a twitch.
  if (Math.abs(next - scroller.scrollTop) < 4) return;
  runScroll(scroller, next, jump);
}
