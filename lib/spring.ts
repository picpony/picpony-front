/**
 * Material 3 Expressive motion springs.
 *
 * *Transitions* — something entering, leaving or crossing the screen — are easing plus duration
 * (`lib/motion.ts`, globals.css). *Component* motion is spring physics since the 2025 Expressive
 * update: a damping ratio and a stiffness, per MotionScheme. This module is that second system,
 * one source of truth for both renderers; the nine responses are M3's own values.
 *
 *                        damping  stiffness          damping  stiffness
 *   standard spatial fast   0.9      1400   expressive fast     0.6      800
 *                    def    0.9       700              def      0.8      380
 *                    slow   0.9       300              slow     0.8      200
 *   standard effects fast   1.0      3800   expressive effects — identical
 *                    def    1.0      1600
 *                    slow   1.0       800
 *
 * **spatial** for anything that moves or changes size: damping below 1, so it may overshoot,
 * and that overshoot reads as mass. **effects** for anything that only fades or recolours:
 * damping exactly 1 — an overshooting colour is a flash and an overshooting opacity is CLIPPED
 * (a linear() value above 1 caps, so the fade reaches full early and stalls).
 *
 * There are nine springs and only **four shapes** — arithmetic, not a shortcut: normalise the
 * timeline by the settle time and the curve depends only on the damping ratio, with stiffness
 * deciding duration alone. Verified across every stiffness sharing a damping ratio at 1e-4
 * tolerance. Both renderers derive from one closed form: CSS gets 32-point `linear()` samples
 * (globals.css ships four tables and nine durations), GSAP gets the function itself registered
 * as an ease, so no sampling error there. Shape and duration must never be split at a call site.
 *
 * `lib/hero/spring.ts` is the same physics solved for a different unknown: a critically damped
 * response parameterised by launch velocity, so it trades the damping axis for a velocity axis.
 * Neither subsumes the other.
 */

/**
 * Where a spring is considered arrived: within 1% of its target, Compose's own
 * displacement threshold for a normalised float. Everything past it is sub-pixel.
 */
const SETTLE_THRESHOLD = 0.01;

export interface SpringSpec {
  /** Damping ratio ζ. Below 1 overshoots; exactly 1 is critically damped. */
  damping: number;
  /** Stiffness k. M3 assumes unit mass, so the natural frequency is √k. */
  stiffness: number;
}

/**
 * The nine M3 motion-scheme springs, by the names the spec uses. `effects` is deliberately not
 * duplicated per scheme — M3's expressive effects springs are the same three values as
 * standard's, because the argument for a flourish applies to movement, not to a fade.
 */
export const SPRINGS = {
  fastSpatial: { damping: 0.9, stiffness: 1400 },
  defaultSpatial: { damping: 0.9, stiffness: 700 },
  slowSpatial: { damping: 0.9, stiffness: 300 },
  fastEffects: { damping: 1.0, stiffness: 3800 },
  defaultEffects: { damping: 1.0, stiffness: 1600 },
  slowEffects: { damping: 1.0, stiffness: 800 },
  expressiveFastSpatial: { damping: 0.6, stiffness: 800 },
  expressiveDefaultSpatial: { damping: 0.8, stiffness: 380 },
  expressiveSlowSpatial: { damping: 0.8, stiffness: 200 },
} as const satisfies Record<string, SpringSpec>;

export type SpringName = keyof typeof SPRINGS;

/**
 * Unnormalised displacement of a unit-mass spring released from rest at 0 and
 * pulled to 1, at time `t` **in seconds**.
 *
 *   ζ < 1   p(t) = 1 − e^(−ζωt)·[cos(ω_d t) + (ζω/ω_d)·sin(ω_d t)]
 *   ζ = 1   p(t) = 1 − e^(−ωt)·(1 + ωt)
 *
 * with ω = √k and ω_d = ω√(1−ζ²).
 */
function displacement({ damping, stiffness }: SpringSpec): (seconds: number) => number {
  const omega = Math.sqrt(stiffness);
  if (Math.abs(damping - 1) < 1e-9) {
    return (t) => 1 - Math.exp(-omega * t) * (1 + omega * t);
  }
  const damped = omega * Math.sqrt(1 - damping * damping);
  return (t) =>
    1 -
    Math.exp(-damping * omega * t) *
      (Math.cos(damped * t) + ((damping * omega) / damped) * Math.sin(damped * t));
}

/**
 * An upper bound on the settle time, from the analytic envelope — used only to bound the sweep
 * below. For ζ < 1 the oscillation is contained by `e^(−ζωt) / √(1 − ζ²)`; for ζ = 1 the fixed
 * point of `x = ln((1 + x) / threshold)` is iterated. It exists for cost, not correctness: it
 * only removes iterations provably past the answer, and the 1.25 margin keeps a rounding
 * difference from truncating a real crossing.
 */
function settleBoundSeconds({ damping, stiffness }: SpringSpec): number {
  const omega = Math.sqrt(stiffness);
  if (Math.abs(damping - 1) < 1e-9) {
    let x = Math.log(1 / SETTLE_THRESHOLD);
    for (let i = 0; i < 8; i += 1) x = Math.log((1 + x) / SETTLE_THRESHOLD);
    return Math.min(4, (1.25 * x) / omega);
  }
  const amplitude = 1 / Math.sqrt(1 - damping * damping);
  return Math.min(4, (1.25 * Math.log(amplitude / SETTLE_THRESHOLD)) / (damping * omega));
}

/**
 * Settle time in seconds: the last moment the spring is still further than
 * `SETTLE_THRESHOLD` from its target.
 *
 * Swept rather than solved because the underdamped case crosses the threshold several times on
 * the way in — the envelope gives an upper bound, not the answer, and the difference is up to
 * 40% of the duration. Resolution is finer than a frame; bounded by the envelope (see above)
 * and memoised per spec, so the table costs a few milliseconds once.
 */
const settleCache = new WeakMap<SpringSpec, number>();

function settleSeconds(spec: SpringSpec): number {
  const cached = settleCache.get(spec);
  if (cached !== undefined) return cached;
  const p = displacement(spec);
  const step = 0.00005;
  const bound = settleBoundSeconds(spec);
  let last = 0;
  for (let t = 0; t <= bound; t += step) {
    if (Math.abs(1 - p(t)) > SETTLE_THRESHOLD) last = t;
  }
  const settled = last + step;
  settleCache.set(spec, settled);
  return settled;
}

/**
 * The spring as an easing function on `t ∈ [0, 1]`, which is what both GSAP and CSS want:
 * progress against a duration rather than against real time.
 *
 * Normalised by its own value at the settle time so the last frame is exactly 1 — without it,
 * truncating at the 1% threshold leaves a 1% step at the end. A uniform scale, so it preserves
 * the shape and scales the overshoot with it.
 */
export function springEase(spec: SpringSpec): (progress: number) => number {
  const settle = settleSeconds(spec);
  const p = displacement(spec);
  const end = p(settle);
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return p(progress * settle) / end;
  };
}

/** Settle time in **milliseconds**, rounded — the duration to pair with the ease. */
export function springDurationMs(spec: SpringSpec): number {
  return Math.round(settleSeconds(spec) * 1000);
}

/** Settle time in **seconds**, GSAP's unit. */
export function springDuration(spec: SpringSpec): number {
  return settleSeconds(spec);
}

/**
 * Milliseconds for each named spring, matching the --duration-spring-* tokens in globals.css
 * exactly (both derive from the same closed form).
 *
 *   fastSpatial 137 · defaultSpatial 194 · slowSpatial 296
 *   fastEffects 108 · defaultEffects 166 · slowEffects 235
 *   expressiveFast 221 · expressiveDefault 326 · expressiveSlow 449
 */
export const SPRING_MS = Object.fromEntries(
  Object.entries(SPRINGS).map(([name, spec]) => [name, springDurationMs(spec)]),
) as Record<SpringName, number>;

/** Seconds for each named spring, for GSAP's `duration`. */
export const SPRING_DURATION = Object.fromEntries(
  Object.entries(SPRINGS).map(([name, spec]) => [name, springDuration(spec)]),
) as Record<SpringName, number>;

/**
 * A linear() easing string, for the one place CSS needs a value this module did not already
 * put in globals.css — an inline style or a WAAPI easing, where a failed var() would silently
 * fall back to `ease`. Prefer the token or the spring utility everywhere else.
 */
export function springToLinear(spec: SpringSpec, samples = 32): string {
  const ease = springEase(spec);
  const stops: string[] = [];
  for (let i = 0; i < samples; i += 1) {
    const at = i / (samples - 1);
    const value = i === samples - 1 ? 1 : ease(at);
    stops.push(`${Number(value.toFixed(4))} ${Number((at * 100).toFixed(2))}%`);
  }
  return `linear(${stops.join(', ')})`;
}
