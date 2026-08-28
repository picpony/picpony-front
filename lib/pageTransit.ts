'use client';

import { getAppScroller } from '@/lib/appScroller';

/**
 * Two pieces of page-transition bookkeeping that carry no animation at all.
 *
 * Both were in `lib/motion.ts`, which registers GSAP and five plugins at module scope, and both
 * are needed by `lib/routeCrossFade.ts` — the module `AppLayout` mounts on every route. So a
 * reference count and a callback slot were, between them, one of the two reasons the whole
 * animation engine was in the root shell of a page of text. Same reasoning as `lib/appScroller.ts`
 * and `lib/motionTokens.ts`; `lib/motion.ts` re-exports both.
 */

/**
 * Holds the incoming page's footer out until a move settles, so the mark never arrives before the
 * page it belongs to. Held out for the length of the move and faded in at settle. See
 * `[data-page-transit]` in globals.css.
 *
 * Armed for tab switches and route changes alike: the footer is below the panes in a tab switch
 * and inside the page in a route change, and in neither case should it arrive ahead of the
 * content.
 *
 * Reference-counted: two moves can be armed in the same tick, and the first to settle must not
 * un-flag the other.
 */
let transitDepth = 0;

export function beginPageTransit(): () => void {
  transitDepth += 1;
  getAppScroller()?.setAttribute('data-page-transit', '');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    transitDepth = Math.max(0, transitDepth - 1);
    if (transitDepth === 0) getAppScroller()?.removeAttribute('data-page-transit');
  };
}

/**
 * Set by whatever owns a transient overlay that must not be captured by the theme wipe — today
 * that is the route cross-fade, whose half-faded clone would be frozen into the wipe's snapshot.
 *
 * A registered callback rather than an import, so neither side has to depend on the other.
 */
let onThemeWipeStart: (() => void) | null = null;

export function setThemeWipeGuard(fn: (() => void) | null) {
  onThemeWipeStart = fn;
}

export function notifyThemeWipeStart() {
  onThemeWipeStart?.();
}
