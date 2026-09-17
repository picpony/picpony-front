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
 * live in globals.css; change one and change the other.
 */
export const DURATION = {
  state: 0.15,
  press: 0.1,
  short: 0.2,
  medium: 0.3,
  long: 0.4,
  emphasized: 0.5,
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
 * Vuetify's VMenu/VDialogTransition supplies the anchored expansion pattern;
 * its clock uses this app's existing short/state steps and standard curve family.
 * CSS arrow twins live in globals.css. Durations here are milliseconds for WAAPI.
 * https://github.com/vuetifyjs/vuetify/blob/01c9e9115898118535865197660dd7399ae1626c/packages/vuetify/src/components/transitions/dialog-transition.tsx
 */
export const MENU_TRANSITION = {
  enter: { duration: DURATION.short * 1000, easing: EASE.standardDecelerate },
  exit: { duration: DURATION.state * 1000, easing: EASE.standardAccelerate },
} as const;
