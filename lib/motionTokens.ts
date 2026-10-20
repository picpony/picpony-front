/**
 * The duration scale and the curve literals, with no engine attached. Split out of
 * `lib/motion.ts` so components that only want a duration do not pull GSAP into their chunk;
 * `lib/motion.ts` re-exports `DURATION`. Reach for this module directly for WAAPI or CSS.
 *
 * No `'use client'`: these are constants, and marking them would make every server component
 * that transitively touched them a client boundary.
 */

/**
 * Durations, in **seconds** — the unit GSAP takes; multiply by 1000 for WAAPI. Every value is a
 * step on M3's own scale (50/100/150/…/500), and a duration outside it is a bug. The CSS twins
 * live in globals.css (`--motion-base-*`); change one and change the other.
 *
 * `container` and `axis` are the two navigation clocks that are not a plain enter or exit: the
 * forum/folder container transform (M3 `medium1`, 250ms) and the tab strip's shared-axis switch
 * (M3 `medium3`, 350ms). The image hero flight is `short` (200ms, `short4`). They used to be
 * spelled as 220/260/350 in their own modules, two of them off M3's scale.
 */
export const DURATION = {
  state: 0.15,
  press: 0.1,
  short: 0.2,
  container: 0.25,
  medium: 0.3,
  axis: 0.35,
  long: 0.4,
  emphasized: 0.5,
} as const;

/**
 * Entrance cascades (the gallery grid's first paint, `Reveal`): one step between neighbours and
 * one ceiling on the whole spread, in seconds. The ceiling is what keeps a full screen of cards
 * inside M3's "not sluggish" envelope — the last card lands at `max + DURATION.long` (650ms),
 * where the old 0.9s cap left it settling 1.3s after the first.
 */
export const STAGGER = {
  step: 0.03,
  max: 0.25,
} as const;

/**
 * Travel, px on the 4dp grid, for anything that arrives or leaves by sliding a short way:
 * `standard` is an entrance (a dialog, a toast, a page leaving, a cascade), `small` is the
 * reduced tier's weak form and every in-place swap or hide. The tab strip's reduced shift (24px)
 * and the hero detail's header/body rises are their own, larger, on purpose. CSS twins:
 * `--motion-travel` / `--motion-travel-small`.
 */
export const TRAVEL_PX = {
  standard: 16,
  small: 8,
} as const;

/**
 * The scale a thing grows from as it arrives (and shrinks to as it leaves): `surface` for a
 * large surface (the dialog, the picture viewer's slide), `surfaceReduced` its reduced-tier form,
 * `item` for one entry joining or leaving a grid (masonry, presence lists). Micro-interactions
 * (a control popping in, an icon swap, a reaction) keep their own keyframes. CSS twin:
 * `--motion-enter-scale`.
 */
export const ENTER_SCALE = {
  surface: 0.95,
  surfaceReduced: 0.98,
  item: 0.92,
} as const;

/**
 * The page fade is one enter duration, including its overlap delay. Keep this
 * split in step with the page-transition token in globals.css: adding the delay
 * to a full enter leg made client navigation take 480ms while a cold mount took
 * 400ms. Values are seconds, like DURATION.
 */
export const PAGE_FADE_TIMING = {
  delay: 0.08,
  duration: DURATION.long - 0.08,
} as const;
/* CSS twins: `--motion-base-page-delay` (80ms) and `--motion-base-page-fade` (320ms) in
   globals.css, read by the page-transition token, the home navigation pill and the mascot's
   lift. */

/**
 * The M3 curves as literal cubic-bezier() strings, for the Web Animations API.
 *
 * A WAAPI easing is a string the engine parses, not a CSS property — a failed var() would
 * silently fall back to `ease`, so every WAAPI call site spells the curve out. This is the
 * shared copy: keep it in step with globals.css and with `eases` in `lib/motion.ts`.
 *
 * `emphasized` is deliberately absent: it is two cubic segments with no four-number form, so
 * it needs GSAP's CustomEase and lib/motion.ts.
 */
export const EASE = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  standardDecelerate: 'cubic-bezier(0, 0, 0, 1)',
  standardAccelerate: 'cubic-bezier(0.3, 0, 1, 1)',
  /** The emphasized decelerate — what call sites mean by "decelerate". */
  decelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  /** The *emphasized* accelerate. */
  accelerate: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  /** Symmetric, eases at both ends; for a loop, which has no arrival. */
  loop: 'cubic-bezier(0.4, 0, 0.6, 1)',
} as const;

/**
 * Vuetify's VMenu/VDialogTransition supplies the anchored expansion pattern; its arrival uses this
 * app's short step and standard decelerate. It is every **small surface's** arrival — the menu,
 * the toast, an in-place content swap (`SwapContent`) — as `surfaceEnterTiming` is every large
 * one's. It leaves on FastEffects (`springTiming`), as every
 * small surface does — `springTiming('fastEffects', …)`, which is why there is no `exit` here: the
 * one this object carried (150ms standard-accelerate) disagreed with both `Popover` and the CSS twin
 * `menu-exit`. CSS arrow twins live in globals.css. Durations here are milliseconds for WAAPI.
 * https://github.com/vuetifyjs/vuetify/blob/01c9e9115898118535865197660dd7399ae1626c/packages/vuetify/src/components/transitions/dialog-transition.tsx
 */
export const MENU_TRANSITION = {
  enter: { duration: DURATION.short * 1000, easing: EASE.standardDecelerate },
} as const;
