'use client';

import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Flip } from 'gsap/Flip';
import { Observer } from 'gsap/Observer';
import { motionRatio, setMotionScaleListener } from '@/lib/appearance';
import type { MotionCategory } from '@/lib/motionPreferences';
import { SHAPE_SPEC, SPRING_DURATION, springEase, type SpringName } from '@/lib/spring';
import { shapeFor } from '@/lib/springTiming';

gsap.registerPlugin(useGSAP, Flip, Observer);

/* The global clock carries feedback's speed, independently of its effect gate.
 * Category springs/timelines compensate with motionRatio; an off category skips
 * its animation. Registering applies it once, including on a cold custom load. */
setMotionScaleListener((scale) => {
  gsap.globalTimeline.timeScale(scale > 0 ? 1 / scale : 1);
});


/**
 * The motion system's GSAP face (`lib/spring.ts`). There are no bezier curves here any more: every
 * motion is one of the seven springs, registered as GSAP eases by **shape** — `spring-effects`,
 * `spring-spatial`, `spring-spatialFast` — and always paired with its own settle time through
 * `spring()`, so shape and clock cannot be split at a call site.
 */
for (const [shape, spec] of Object.entries(SHAPE_SPEC)) {
  gsap.registerEase(`spring-${shape}`, springEase(spec));
}

/** Settle times in seconds, keyed by spring name. */
export const SPRING = SPRING_DURATION;

/**
 * A spring as a ready-made `{ duration, ease }` pair. Under the reduced tier a spatial spring keeps
 * its duration and takes the critically damped shape (`shapeFor`), mirroring the CSS rule.
 * The duration compensates for the global clock with `motionRatio`, as every category spring does.
 */
export function spring(name: SpringName, category: MotionCategory = 'feedback'): { duration: number; ease: string } {
  return { duration: SPRING_DURATION[name] * motionRatio(category), ease: `spring-${shapeFor(name, category)}` };
}

/**
 * A surface arriving, as two GSAP vars: transform on the spatial role for its size, opacity on the
 * effects spring of the same size — the twin of `surfaceArrival` in `lib/springTiming.ts`.
 */
export function surfaceArrival(
  size: 'fast' | 'default' | 'slow' = 'default',
  category: MotionCategory = 'overlay',
): { spatial: { duration: number; ease: string }; effects: { duration: number; ease: string } } {
  return { spatial: spring(`${size}Spatial`, category), effects: spring(`${size}Effects`, category) };
}

/** A surface leaving: everything on one effects spring (rule 4 in `lib/spring.ts`). */
export function surfaceDeparture(size: 'fast' | 'default' = 'default', category: MotionCategory = 'overlay') {
  return spring(`${size}Effects`, category);
}

/* Never let a stalled frame be charged to an animation: GSAP advances tweens by
 * real elapsed time, so blocking work is paid out of the animation. `lagSmoothing`
 * pretends the frame took the adjusted lag; 100ms is above a dropped frame and
 * below this app's stalls. */
gsap.ticker.lagSmoothing(100, 33);

/* Matches the CSS safety net: a tween that names no motion is a default-effects spring. No
   `motionScale()` here: `gsap.globalTimeline.timeScale` above already scales every tween. */
gsap.defaults({ ease: 'spring-effects', duration: SPRING_DURATION.defaultEffects, overwrite: 'auto' });

/** One registration shared by every motion consumer. */
export { Flip, gsap, useGSAP, Observer };
