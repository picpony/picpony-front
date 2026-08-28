import { motionTier, scaledMs } from '@/lib/appearance';
import { SPRINGS, SPRING_MS, springToLinear, type SpringName } from '@/lib/spring';

/**
 * A spring as a Web Animations `{ duration, easing }` pair — the twin of `spring()` in
 * `lib/motion.ts`, for the call sites that do not want GSAP.
 *
 * The two differ in exactly one thing and it is not cosmetic: **this one is already scaled.**
 * GSAP's version returns the unscaled duration because `gsap.globalTimeline.timeScale` applies
 * the 快速 / 缓慢 preference to every tween in one place; WAAPI has no such global, so a helper
 * that did not scale would hand every caller the same trap — a duration written against the
 * 默认 speed and silently deaf to the other two. `lib/ripple.ts` documents having hit it.
 *
 * The easing is spelled as a `linear()` string rather than read from a CSS token, for the
 * documented reason `Popover` and the hero flight give: a `var()` that fails to resolve inside a
 * WAAPI `easing:` string falls back to `ease` silently. Both come out of `lib/spring.ts`'s closed
 * form, which is what generates the CSS tables too, so they cannot drift.
 */
export function springTiming(name: SpringName): { duration: number; easing: string } {
  const shape = motionTier() === 'reduced' ? (SPRING_EFFECTS_FOR[name] ?? name) : name;
  return { duration: scaledMs(SPRING_MS[name]), easing: springToLinear(SPRINGS[shape]) };
}

/**
 * Under the **reduced** tier the three under-damped shapes are swapped for the critically damped
 * one — the same three-line rule globals.css states in CSS: a handle still travels, it just stops
 * when it arrives instead of passing the target and coming back. The *duration* stays the
 * requested tier's, so nothing changes length; nine springs share four shapes precisely because
 * the shape depends on ζ alone.
 *
 * Each spatial tier maps onto the effects tier with the nearest settle time, so a `fastSpatial`
 * does not come out a `slowEffects`.
 *
 * It lives here rather than in `lib/motion.ts` because both renderers need it and this module is
 * the one of the two that does not drag GSAP in.
 */
export const SPRING_EFFECTS_FOR: Partial<Record<SpringName, SpringName>> = {
  fastSpatial: 'fastEffects',
  defaultSpatial: 'defaultEffects',
  slowSpatial: 'slowEffects',
  expressiveFastSpatial: 'fastEffects',
  expressiveDefaultSpatial: 'defaultEffects',
  expressiveSlowSpatial: 'slowEffects',
};
