'use client';

/**
 * The app scroller, and the "is a hero flight on screen" gate. Neither touches GSAP, and
 * neither may live in `lib/motion.ts` — that module registers GSAP and its plugins at module
 * scope, and two of the three importers are mounted by the root layout on every route, which
 * would pull the whole engine into every route's first document just to answer "which element
 * scrolls". `lib/motion.ts` re-exports both, so call sites that want GSAP too keep one import.
 */

/**
 * The element that actually scrolls the page: `<body>` cannot scroll (the shell disables its
 * overflow) and the scroller is the `<main>` inside it, so `window.scrollTo` is a no-op in
 * this app — the page scroller is the app scroller, never the document element.
 */
export function getAppScroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>('[data-image-hero-gallery-scroll]');
}

/**
 * A registered predicate rather than an import: `lib/hero` is large and this module is
 * imported nearly everywhere — importing it here would pull the hero controller into every
 * bundle that wanted to know whether a flight was running.
 */
let isHeroBusy: (() => boolean) | null = null;

export function setHeroBusyCheck(fn: (() => boolean) | null) {
  isHeroBusy = fn;
}

/**
 * Whether a shared-element flight owns the screen. The theme wipe and the tab shared axis
 * consult it; the route cross-fade gates equivalently by reading the runtime it already
 * imports; `lib/forumTransition` was given this after consulting nothing at all.
 */
export function heroOwnsScreen(): boolean {
  return isHeroBusy?.() ?? false;
}
