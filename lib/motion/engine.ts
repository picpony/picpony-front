'use client';

import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { CustomEase } from 'gsap/CustomEase';
import { Flip } from 'gsap/Flip';
import { Observer } from 'gsap/Observer';
import { motionTier, setMotionScaleListener } from '@/lib/appearance';
import { DURATION, EASE } from '@/lib/motionTokens';
import { SPRINGS, SPRING_DURATION, springEase, type SpringName } from '@/lib/spring';
import { SPRING_EFFECTS_FOR } from '@/lib/springTiming';

gsap.registerPlugin(useGSAP, CustomEase, Flip, Observer);

/* One line reaches every GSAP tween in the app. `off` is *not* a scale of 0 —
 * `timeScale(0)` freezes every tween at its first frame, where `off` means the tween
 * should be over — so the scale is clamped here and the JS branches skip outright.
 * Registering also applies it once, so a cold load does not start at 1x. */
setMotionScaleListener((scale) => {
  gsap.globalTimeline.timeScale(scale > 0 ? 1 / scale : 1);
});


/**
 * Motion tokens for GSAP-driven animation; the same curves live in globals.css
 * (`--ease-*`), keep the two in sync. These are M3's **transition** curves; component
 * motion is spring physics below. The short `decelerate` / `accelerate` names are
 * the *emphasized* pair, not standard.
 */
export const eases = {
  standard: CustomEase.create('standard', '0.2, 0, 0, 1'),
  standardDecelerate: CustomEase.create('standard-decelerate', '0, 0, 0, 1'),
  standardAccelerate: CustomEase.create('standard-accelerate', '0.3, 0, 1, 1'),
  decelerate: CustomEase.create('decelerate', '0.05, 0.7, 0.1, 1'),
  accelerate: CustomEase.create('accelerate', '0.3, 0, 0.8, 0.15'),
  /**
   * M3's emphasized curve — two cubic segments, no cubic-bezier form exists;
   * CustomEase takes the spec path as-is.
   */
  emphasized: CustomEase.create(
    'emphasized',
    'M0,0 C0.05,0 0.133333,0.06 0.166666,0.4 C0.208333,0.82 0.25,1 1,1',
  ),
  /**
   * Symmetric — eases in as well as out. Every curve above is one-sided, leaving
   * two motions with no token: a repeating one (velocity discontinuous per cycle)
   * and a panel travelling in place. The CSS twin is `--ease-symmetric`.
   */
  symmetric: CustomEase.create('symmetric', '0.4, 0, 0.6, 1'),
  /** Alias of `symmetric`, kept because "loop" is the role at its call sites. */
  loop: CustomEase.create('loop', '0.4, 0, 0.6, 1'),
} as const;

/**
 * The nine M3 Expressive component springs, registered as GSAP eases named
 * `spring-<name>`, as closed-form functions (no interpolation error). Always pair
 * with `SPRING.<name>`: shape and settle time are one spring — splitting them at a
 * call site puts the curve on the wrong clock.
 */
for (const [name, spec] of Object.entries(SPRINGS)) {
  gsap.registerEase(`spring-${name}`, springEase(spec));
}

/** Settle times in seconds, keyed the same way. */
export const SPRING = SPRING_DURATION;

/**
 * A spring as a ready-made `{ duration, ease }` pair, so the two cannot drift apart.
 * Under the reduced tier it substitutes shapes (`SPRING_EFFECTS_FOR`: under-damped →
 * critically damped, mirroring the CSS rule); the table lives in `lib/springTiming.ts`
 * so both renderers share it.
 */
export function spring(name: SpringName): { duration: number; ease: string } {
  const shape = motionTier() === 'reduced' ? (SPRING_EFFECTS_FOR[name] ?? name) : name;
  return { duration: SPRING_DURATION[name], ease: `spring-${shape}` };
}


/* Never let a stalled frame be charged to an animation: GSAP advances tweens by
 * real elapsed time, so blocking work is paid out of the animation. `lagSmoothing`
 * pretends the frame took the adjusted lag; 100ms is above a dropped frame and
 * below this app's stalls. */
gsap.ticker.lagSmoothing(100, 33);

/**
 * Re-export so GSAP call sites keep one import. Deliberately NOT consolidated here:
 * this module registers GSAP at module scope, so a token-only import through it
 * would pull the whole engine into any importer's chunk (root layout included).
 */
export { DURATION, EASE };

/* Matches the CSS safety net. No `motionScale()` here: `gsap.globalTimeline.timeScale`
   above already scales every tween; scaling the default as well would apply it twice. */
gsap.defaults({ ease: eases.standard, duration: DURATION.short, overwrite: 'auto' });

/** One registration shared by every motion consumer. */
export { Flip, gsap, useGSAP, Observer };
