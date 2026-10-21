/**
 * The motion system's *geometry* — how far, how small, how staggered — with no engine attached.
 * The *timing* of every motion is a spring (`lib/spring.ts`); there is no duration scale and no
 * bezier curve to pick from here any more, on purpose: a duration and a curve chosen independently
 * at a call site is exactly how the old system drifted into 14 different clocks.
 *
 * No `'use client'`: these are constants, and marking them would make every server component that
 * transitively touched them a client boundary.
 */

import { SPRING_MS } from '@/lib/spring';

/**
 * Entrance cascades (the gallery grid's first paint, `Reveal`): one step between neighbours and
 * one ceiling on the whole spread, in seconds. Each item itself arrives on `surfaceArrival`.
 */
export const STAGGER = {
  step: 0.03,
  max: 0.25,
} as const;

/**
 * Travel, px on the 4dp grid, for anything that arrives or leaves by sliding a short way:
 * `standard` is an entrance (a dialog, a toast, a page, a cascade), `small` is the reduced tier's
 * weak form and every in-place swap or hide. CSS twins: `--motion-travel` / `--motion-travel-small`.
 */
export const TRAVEL_PX = {
  standard: 16,
  small: 8,
} as const;

/**
 * The scale a thing grows from as it arrives (and shrinks to as it leaves): `surface` for a large
 * surface, `surfaceReduced` its reduced-tier form, `item` for one entry joining or leaving a grid,
 * `menu` for an anchored menu unfolding from its anchor (Compose's `DropdownMenu` grows from 0.8).
 * CSS twin: `--motion-enter-scale`.
 */
export const ENTER_SCALE = {
  surface: 0.95,
  surfaceReduced: 0.98,
  item: 0.92,
  menu: 0.8,
} as const;

/**
 * The hand-off, ms: how long a follower waits for its leader — the arriving page for the leaving
 * one (Material's *fade through*, so the two are never both half-visible), a check mark for the
 * box it is drawn in. Half of a fast-effects fade, the point at which that spring is ~90% of the
 * way there, rather than a number of its own. CSS twin: `--motion-base-handoff` (generated).
 */
export const HANDOFF_MS = Math.round(SPRING_MS.fastEffects / 2);

/**
 * A checkbox's mark, unchecking, disappears in one step after this delay while the box empties —
 * `Checkbox.kt`'s `snap(delayMillis = SnapAnimationDelay)`, 100ms, verbatim. A hold, not a motion,
 * so it is not a spring; it scales with the user's speed like every delay.
 */
export const CHECK_SNAP_DELAY_MS = 100;

/**
 * Curves that are **not** motion to a target and so are not springs: an indeterminate loop has no
 * arrival (symmetric, eases at both ends), and a skeleton sweep is a constant drift. These are the
 * only cubic-béziers left in the app. CSS twins: `--ease-loop`, `--ease-sweep`.
 */
export const LOOP_EASE = {
  loop: 'cubic-bezier(0.4, 0, 0.6, 1)',
  sweep: 'cubic-bezier(0, 0, 0.58, 1)',
} as const;
