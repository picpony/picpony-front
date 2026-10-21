import { motionTier, scaledMs } from '@/lib/appearance';
import type { MotionCategory } from '@/lib/motionPreferences';
import { SHAPE_SPEC, SPRING_MS, shapeOf, springToLinear, type SpringName, type SpringShape } from '@/lib/spring';

/**
 * The WAAPI face of the motion system (`lib/spring.ts`): a spring as a `{ duration, easing }` pair.
 *
 * **The duration is already scaled** by the user's speed for the category — GSAP scales through its
 * global timeline, WAAPI has no global, so an unscaled pair would be deaf to 快速 / 缓慢.
 *
 * The easing is a `linear()` string, not a CSS `var()`: a var() that fails to resolve inside a
 * WAAPI easing falls back to `ease` silently. It comes out of the same closed form that generates
 * the CSS tables, so the two renderers cannot drift.
 */
export interface SpringTiming {
  duration: number;
  easing: string;
}

/**
 * The shape a spring takes for a category's tier: under **reduced** every spatial spring keeps its
 * duration but loses its overshoot — it travels, and stops when it arrives — the same rule
 * globals.css states for the CSS tables.
 */
export function shapeFor(name: SpringName, category: MotionCategory = 'feedback'): SpringShape {
  return motionTier(category) === 'reduced' ? 'effects' : shapeOf(name);
}

export function springTiming(name: SpringName, category: MotionCategory = 'feedback'): SpringTiming {
  return { duration: scaledMs(SPRING_MS[name], category), easing: springToLinear(SHAPE_SPEC[shapeFor(name, category)]) };
}

/**
 * A surface arriving: its **transform** on the spatial role for its size, its **opacity** on the
 * effects spring of the same size (rule 5 in `lib/spring.ts`). `size` is the surface's, not the
 * distance it travels: `default` for a dialog, a sheet, a drawer, a popover, a toast; `fast` for a
 * menu, a tooltip, a control appearing; `slow` for the whole screen.
 */
export function surfaceArrival(
  size: 'fast' | 'default' | 'slow' = 'default',
  category: MotionCategory = 'overlay',
): { spatial: SpringTiming; effects: SpringTiming } {
  return {
    spatial: springTiming(`${size}Spatial`, category),
    effects: springTiming(`${size}Effects`, category),
  };
}

/**
 * A surface leaving: everything — opacity and transform — on one effects spring (rule 4), `fast`
 * for a control or a small surface, `default` for anything partial- or full-screen.
 */
export function surfaceDeparture(size: 'fast' | 'default' = 'default', category: MotionCategory = 'overlay'): SpringTiming {
  return springTiming(`${size}Effects`, category);
}
