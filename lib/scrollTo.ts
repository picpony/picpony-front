'use client';

import { getAppScroller } from '@/lib/appScroller';
import { motionTier, scaledMs } from '@/lib/appearance';
import { clamp } from '@/lib/utils';

/**
 * Programmatic scrolling, on rAF rather than GSAP's ScrollToPlugin.
 *
 * `scrollTop` is not a CSS property, so this is the one piece of motion in the app that Web
 * Animations cannot express — it has to be a per-frame write either way, and GSAP's plugin was
 * doing exactly that. What the plugin cost was its host: `components/Pagination.tsx` is on ten
 * screens and imported `lib/motion` for these two functions alone, and that module registers
 * GSAP and five plugins at module scope.
 *
 * The curve is the same one (`0.33, 0, 0, 1`), evaluated below, and so is the square-root
 * duration band. What is *not* kept is GSAP's `lagSmoothing`: a stalled frame here is charged to
 * the scroll rather than delaying it, which for a scroll is the better failure — the offset is a
 * destination, and arriving late at the right place beats arriving on time at the wrong one.
 */

/** `cubic-bezier(0.33, 0, 0, 1)` — `eases.scroll` in `lib/motion.ts`. Keep the two in step. */
const P1X = 0.33;
const P1Y = 0;
const P2X = 0;
const P2Y = 1;

/* Newton–Raphson on x, then evaluate y. Eight iterations is well past convergence for a curve
   this shallow, and the derivative can only vanish at the endpoints, which are exact. */
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
  /* Duration follows the square root of the distance, not the distance itself: perceived travel
     speed scales sub-linearly, so a linear map makes short hops feel sluggish and long ones feel
     frantic. The band keeps even a whole-page jump under about a second.

     There is deliberately no fixed-length escape hatch. One existed for a page turn, on the
     argument that a page turn has no distance of its own — it goes to the top of the list from
     wherever you were — and it is the wrong shape of answer: a fixed length makes the *speed*
     scale with the distance instead, so the turn is a whip-pan from the bottom of a long gallery
     and a crawl from near the top. This law is what keeps the rate sane across both. */
  const duration = scaledMs(clamp(280 * Math.sqrt(distance / 300), 360, 1100));

  /* Scroll anchoring is normally welcome here — it keeps the gallery steady as thumbnails decode
     above the viewport. During a deliberate programmatic scroll it fights us: the incoming page
     re-lays out mid-tween, the browser "corrects" scrollTop to preserve the anchored element, and
     the result is a visible lurch before the glide. Suspended for the length of the tween only. */
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
 * A tween rather than `scrollTo({ behavior: 'smooth' })`: native smooth scrolling over a long
 * masonry list janks while thumbnails decode, and this way the easing matches the rest of the
 * app's motion.
 *
 * Falls back to the window for any surface rendered outside the shell.
 *
 * A scroll offset is *state*, not decoration, so every tier still lands on it — only the travel
 * is dropped, and only by the tier that drops all travel. That distinction is the same one
 * `applyInstantTabScroll` makes and it is worth keeping in one sentence: the preference asks for
 * less movement, not for less positioning.
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
 * Paginating a gallery should land on the first row of the new page, not back above the featured
 * banner — you already chose to move past that, and replaying it on every page turn just adds a
 * scroll.
 *
 * `scroller` overrides which element is moved. It exists because not everything that scrolls is
 * the app scroller: an image-detail overlay brings its own, and the two calls that used to reach
 * for `element.scrollIntoView({ behavior: 'smooth' })` did so precisely because they could not
 * name it. That got them the browser's own smooth curve — symmetric, ~variable duration, and the
 * one scrolling motion in the app that did not match the rest — so a "reply to this comment" jump
 * felt different depending on whether you had opened the picture from the gallery or navigated to
 * it directly.
 *
 * The glide survives the reduced tier — a scroll is the one motion where the destination only
 * makes sense in terms of where you came from, and it costs nothing but a composited offset. Only
 * `off` teleports.
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
