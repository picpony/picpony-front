'use client';

import { getAppScroller } from '@/lib/appScroller';

/**
 * The route owns its whole incoming page, including any mount-time entrances.
 * Mark the persistent scroller before React attaches that page, so a gallery
 * never starts fifty child tweens only to have the route move their parent too.
 * A dialog portalled outside the scroller is a separate surface and stays free
 * to run its own entrance.
 */
export function setRouteTransit(active: boolean): void {
  getAppScroller()?.toggleAttribute('data-route-transit', active);
}

export function routeTransitActive(element: HTMLElement): boolean {
  const scroller = getAppScroller();
  return Boolean(scroller?.hasAttribute('data-route-transit') && scroller.contains(element));
}

/**
 * Page-transition bookkeeping without an animation engine. The route marker,
 * tab-footer hold and theme-wipe guard live here so their callers do not need a
 * static import of `lib/motion.ts` and its module-scope GSAP registration.
 */

/**
 * Holds the footer aside during a tab switch, while the panes above it change
 * their final height. At settle it returns on the 166ms DefaultEffects opacity
 * response in globals.css. Route changes carry the footer inside the whole page
 * instead, so they do not use this hold. Reference-counted: two tab moves can be
 * armed in the same tick, and the first to settle must not un-flag the other.
 *
 * **The flag goes on the footer itself**, registered by its own ref. On the scroller,
 * under a `[data-page-transit] .page-chrome` rule, each flip sent the engine through
 * every element of the page looking for the footer — at both ends of every switch.
 */
let transitDepth = 0;
const footers = new Set<HTMLElement>();

/** The page footer, on mount; returns the unregister. See `lib/pageLoadingHold.ts`. */
export function registerPageFooter(footer: HTMLElement): () => void {
  footers.add(footer);
  footer.toggleAttribute('data-page-transit', transitDepth > 0);
  return () => {
    footers.delete(footer);
  };
}

export function beginPageTransit(): () => void {
  transitDepth += 1;
  if (transitDepth === 1) for (const footer of footers) footer.setAttribute('data-page-transit', '');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    transitDepth = Math.max(0, transitDepth - 1);
    if (transitDepth === 0) for (const footer of footers) footer.removeAttribute('data-page-transit');
  };
}

/**
 * Set by whatever owns a transient overlay that must not be captured by the theme wipe (it
 * freezes rendering to snapshot a frame) — today the route cross-fade, whose half-faded
 * clone would be frozen into the wipe's snapshot. A registered callback rather than an
 * import, so neither side has to depend on the other.
 */
let onThemeWipeStart: (() => void) | null = null;

export function setThemeWipeGuard(fn: (() => void) | null) {
  onThemeWipeStart = fn;
}

export function notifyThemeWipeStart() {
  onThemeWipeStart?.();
}
