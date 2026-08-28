/**
 * The duration scale and the curve literals, with no engine attached.
 *
 * These were in `lib/motion.ts`, which registers GSAP and five plugins at module scope — so a
 * component that wanted nothing but "how long is a state layer" pulled ~180KB of animation
 * engine into its chunk. Three of the importers doing exactly that are mounted by the root
 * layout on every route.
 *
 * `lib/motion.ts` re-exports `DURATION`, so nothing that legitimately wants GSAP too has to
 * change. Reach for this module directly when the animation is WAAPI or CSS.
 *
 * No `'use client'`: these are constants, and marking them would make every server component
 * that transitively touched them a client boundary.
 */

/**
 * Durations, in **seconds** — the unit GSAP takes. Multiply by 1000 for WAAPI.
 *
 * Every value is a step on M3's own scale (50/100/150/200/…/500), and a duration outside it is
 * a bug. `state` is here because a state layer is the most frequent piece of motion in the app
 * and it was the only timing with no entry — which is how `ToggleSwitch`, whose switch track
 * cannot use the utility's `::before`, ended up hand-typing 150ms with nothing to point at.
 * The CSS twins live in globals.css; change one and change the other.
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
 * The M3 curves as literal `cubic-bezier()` strings, for the Web Animations API.
 *
 * A WAAPI `easing:` is a string the engine parses, not a CSS property declaration — so a
 * `var(--ease-standard)` in one does not resolve to the token, it silently falls back to
 * `ease`. Everything in this app that hands a curve to WAAPI therefore spells it out:
 * `app/layout.tsx` for the top loader, `lib/hero/` for the flight, `components/Popover.tsx`
 * for its panels. This is the shared copy. **The values are the tokens' — keep them in step
 * with globals.css and with `eases` in `lib/motion.ts`.**
 *
 * `emphasized` is deliberately absent: it is two cubic segments and has no four-number form,
 * which is why `lib/motion.ts` hands CustomEase the spec path instead. Anything needing it
 * needs GSAP.
 */
export const EASE = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  standardDecelerate: 'cubic-bezier(0, 0, 0, 1)',
  standardAccelerate: 'cubic-bezier(0.3, 0, 1, 1)',
  /** The *emphasized* decelerate — what every call site in this app means by "decelerate". */
  decelerate: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  /** The *emphasized* accelerate. */
  accelerate: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  /** Symmetric; eases at both ends. For a loop, which has no arrival. */
  loop: 'cubic-bezier(0.4, 0, 0.6, 1)',
} as const;
