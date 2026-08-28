'use client';

/**
 * The app scroller, and the "is a hero flight on screen" gate.
 *
 * Both of these lived in `lib/motion.ts`, and neither of them touches GSAP — `getAppScroller`
 * is one `querySelector` and `heroOwnsScreen` reads a registered predicate. That mattered
 * more than it looks: `lib/motion.ts` registers GSAP and its plugins at module scope, so
 * importing it for either of these pulled the whole animation engine into the importer's
 * chunk. Two of the three importers are mounted by the root layout on every route
 * (`lib/scrollMemory.ts` via `<RouteScrollMemory>`, `lib/overlay.ts` via the dialogs), so
 * that was ~180KB of GSAP arriving on `/policy` to answer "which element scrolls".
 *
 * `lib/motion.ts` re-exports both, so the call sites that legitimately do want GSAP too keep
 * importing from one place.
 */

/**
 * The element that actually scrolls the page.
 *
 * `<body>` is `overflow: hidden` and the scroller is the `<main>` inside the app shell, so
 * every `window.scrollTo({ top: 0 })` in the app was a no-op — which is why paginating never
 * returned you to the top of the list. There were ~25 of those calls across the pages.
 */
export function getAppScroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>('[data-image-hero-gallery-scroll]');
}

/**
 * A registered predicate rather than an import: `lib/hero` is a large module and this one is
 * imported nearly everywhere, so importing it here would pull the hero controller into every
 * bundle that wanted to know whether a flight was running.
 */
let isHeroBusy: (() => boolean) | null = null;

export function setHeroBusyCheck(fn: (() => boolean) | null) {
  isHeroBusy = fn;
}

/**
 * Whether a shared-element flight owns the screen.
 *
 * Four page-level transitions need this: the theme wipe and the tab shared axis consult it,
 * the route cross-fade gates equivalently by reading the runtime it already imports, and
 * `lib/forumTransition` consulted nothing at all until it was given this.
 */
export function heroOwnsScreen(): boolean {
  return isHeroBusy?.() ?? false;
}
