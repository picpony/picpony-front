import { motionTier, scaledMs } from '@/lib/appearance';
import { SPRINGS, SPRING_MS, springToLinear, type SpringName } from '@/lib/spring';

/**
 * A spring as a Web Animations `{ duration, easing }` pair — the twin of `spring()` in
 * `lib/motion.ts`, for WAAPI call sites that want spring timing without lib/motion.
 *
 * It differs from the GSAP twin in one way: **this duration is already scaled.** GSAP applies
 * the speed preference globally through `gsap.globalTimeline.timeScale`; WAAPI has no global,
 * so an unscaled helper would hand every caller a duration deaf to the 快速 / 缓慢 preference.
 *
 * The easing is a linear() string, not a CSS var(): a var() that fails to resolve inside a WAAPI
 * easing string falls back to `ease` silently. Both values come out of `lib/spring.ts`'s one
 * closed form — the same form that generates the CSS tables — so they cannot drift.
 */
export function springTiming(name: SpringName): { duration: number; easing: string } {
  const shape = motionTier() === 'reduced' ? (SPRING_EFFECTS_FOR[name] ?? name) : name;
  return { duration: scaledMs(SPRING_MS[name]), easing: springToLinear(SPRINGS[shape]) };
}

/**
 * Under the **reduced** tier the three under-damped shapes resolve to the critically damped
 * one — the same rule globals.css states in CSS: a handle still travels, it just stops when it
 * arrives instead of overshooting. Each spatial shape maps onto the effects shape with the
 * nearest settle time; the *duration* stays the requested one, since nine springs share four
 * shapes precisely because shape depends on ζ alone.
 *
 * Lives here rather than in `lib/motion.ts` because both renderers need it and this module is
 * the one that does not drag GSAP in.
 */
export const SPRING_EFFECTS_FOR: Partial<Record<SpringName, SpringName>> = {
  fastSpatial: 'fastEffects',
  defaultSpatial: 'defaultEffects',
  slowSpatial: 'slowEffects',
  expressiveFastSpatial: 'fastEffects',
  expressiveDefaultSpatial: 'defaultEffects',
  expressiveSlowSpatial: 'slowEffects',
};
