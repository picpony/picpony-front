'use client';

import { clamp01 } from '@/lib/utils';
import {
  springProgress,
  springVelocity,
  springVelocityFromSpeed,
  type SpringResponse,
} from './spring';

/**
 * A leg's progress function, in one of two kinds.
 *
 * Everything the hero animates is a normalized response `p(t)` on `t ∈ [0, 1]` with
 * `p(0) = 0` and `p(1) = 1`, so a leg's *shape* is independent of how long it lasts. What
 * changed is that there are now two shapes rather than one, and which one a leg gets is
 * decided by how it starts:
 *
 * - **From rest — a curve.** `Curves.fastOutSlowIn`, which is what Flutter's Hero actually
 *   flies: `_HeroFlightManifest.animation` wraps the route's animation in a
 *   `CurvedAnimation(curve: Curves.fastOutSlowIn, reverseCurve: fastOutSlowIn.flipped)`, and
 *   the flipped variant is the same shape read backwards, so a push and a pop present
 *   identically. Per tenth of the leg it travels 2.6 10.8 23.3 24.6 16.2 10.0 6.2 3.7 1.9 0.6
 *   — it hangs back, peaks at 30%, reaches half travel at 35%, and its fastest tenth carries
 *   41x its last.
 * - **At a speed something already has — a spring.** A reversal, a mid-flight rebuild and the
 *   drag release all have to leave at the speed the flyer is visibly travelling, and a Bézier
 *   cannot: its launch slope is `y1/x1`, fixed by its own shape. `HERO_FLIGHT_RESPONSE`'s
 *   ζ0.9 spring is solvable for a target slope, which is the whole reason it is still here.
 *
 * **Why the curve rather than the spring for a from-rest leg**, given the spring is the app's
 * own ladder: a spring cannot hang back. Its peak velocity is at `arccos(ζ)/ω_d`, and swept
 * across every tier this app ships that lands at 15–20% of the leg — ζ1.0 at 15%, ζ0.9 at
 * 20%, and *lower* ζ moves it earlier rather than later, because a longer settle window
 * stretches the tail more than the head. So "starts almost still, then goes" is not reachable
 * by retuning ζ, and it is the one property that reads as a considered motion rather than as
 * a step response.
 *
 * Both kinds are differentiable, which is what keeps velocity-continuous interruption and
 * DOM-read-free pose measurement working across the split: `velocityAt` returns progress per
 * unit of normalized time for either, so `evaluateLeg`'s chord-speed calculation and
 * `springVelocityFromSpeed` did not change.
 */

export type ProgressCurve = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /**
   * The same curve as a CSS / WAAPI `easing` string. Spelled out rather than a `var()`,
   * because a failed custom property in an `easing:` position falls back to `ease` in
   * silence. Only for the two-keyframe tracks that hand the shape to the compositor
   * instead of sampling it.
   */
  readonly css: string;
};

export type HeroProgressModel =
  | { readonly kind: 'curve'; readonly curve: ProgressCurve }
  | { readonly kind: 'spring'; readonly response: SpringResponse };

export type ProgressFrame = {
  offset: number;
  progress: number;
};

type CubicCoefficients = { a: number; b: number; c: number };

/** CSS's parameterisation: `P0 = (0,0)`, `P3 = (1,1)`, so one axis needs three terms. */
function coefficients(p1: number, p2: number): CubicCoefficients {
  const c = 3 * p1;
  const b = 3 * (p2 - p1) - c;
  return { a: 1 - c - b, b, c };
}

function cubic({ a, b, c }: CubicCoefficients, t: number) {
  return ((a * t + b) * t + c) * t;
}

function cubicSlope({ a, b, c }: CubicCoefficients, t: number) {
  return (3 * a * t + 2 * b) * t + c;
}

const NEWTON_STEPS = 8;
const NEWTON_EPSILON = 1e-10;
const BISECTION_STEPS = 30;

/**
 * Invert `x(u) = time` for the curve's own parameter.
 *
 * Newton from `u = time`, which for a curve of this family is within a few hundredths to
 * begin with, then **bisection as a total fallback** whenever a Newton step leaves [0, 1] or
 * the slope vanishes. `(0.4, 0, 0.2, 1)` never needs it — `x'`'s discriminant is
 * `12.96 − 23.04 < 0`, so the slope is positive across the whole span — but the fallback is
 * what makes this function total for any curve a constant might come to hold, including the
 * degenerate `x1 = x2 = 0`.
 */
function solveCurveParam(x: CubicCoefficients, time: number) {
  let u = time;
  for (let step = 0; step < NEWTON_STEPS; step += 1) {
    const error = cubic(x, u) - time;
    if (Math.abs(error) < NEWTON_EPSILON) return u;
    const slope = cubicSlope(x, u);
    if (!(Math.abs(slope) > 1e-9)) break;
    const next = u - error / slope;
    if (!(next >= 0) || !(next <= 1)) break;
    u = next;
  }
  let low = 0;
  let high = 1;
  u = time;
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    u = (low + high) / 2;
    if (cubic(x, u) < time) low = u;
    else high = u;
  }
  return u;
}

export function curveProgress(curve: ProgressCurve, time: number) {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  const x = coefficients(curve.x1, curve.x2);
  const y = coefficients(curve.y1, curve.y2);
  return cubic(y, solveCurveParam(x, time));
}

/**
 * `dp/dt = y'(u) / x'(u)`, in progress units per unit of normalized time — the same units
 * `springVelocity` returns, which is what lets one call site seed either model.
 *
 * Checked against a central difference at 999 points: max error 8.1e-8. At `t = 0` and
 * `t = 1` it is exactly 0 for `(0.4, 0, 0.2, 1)`, since `y'(0) = 3·y1 = 0` and
 * `y'(1) = 3·(1 − y2) = 0`. Leaving and arriving at rest is the property the whole shape
 * argument rests on, and `npm run hero:path` asserts it rather than trusting this comment.
 */
export function curveVelocity(curve: ProgressCurve, time: number) {
  const x = coefficients(curve.x1, curve.x2);
  const y = coefficients(curve.y1, curve.y2);
  const u = solveCurveParam(x, clamp01(time));
  const slope = cubicSlope(x, u);
  if (!(Math.abs(slope) > 1e-9)) return 0;
  return cubicSlope(y, u) / slope;
}

export function progressAt(model: HeroProgressModel, time: number) {
  return model.kind === 'curve'
    ? curveProgress(model.curve, time)
    : springProgress(time, model.response);
}

export function velocityAt(model: HeroProgressModel, time: number) {
  return model.kind === 'curve'
    ? curveVelocity(model.curve, time)
    : springVelocity(time, model.response);
}

/** Material's `ProgressThresholds`: a sub-timeline inside the leg's own progress. */
export function intervalProgress(progress: number, start: number, end: number) {
  if (end <= start) return progress >= end ? 1 : 0;
  return clamp01((progress - start) / (end - start));
}

/**
 * The model for a leg that has to leave at a speed the object already has. Always a spring,
 * for the reason in this file's header, and this is the **only** place a launch velocity is
 * solved.
 *
 * That matters beyond tidiness. The three sites this replaces each wrote
 * `{ ...base, velocity }`, and each carried a comment warning that rebuilding the response
 * field by field silently drops ζ back to 1 — which had shipped once, so every interrupted
 * flight ran a critically damped curve while the constants claimed the ζ0.9 spatial one.
 * A spread that must not be forgotten is a hazard; a function that owns the spread is not.
 */
export function relaunch(
  base: SpringResponse,
  speed: number,
  distance: number,
  duration: number,
): HeroProgressModel {
  return {
    kind: 'spring',
    response: {
      ...base,
      velocity: springVelocityFromSpeed(speed, distance, duration, base),
    },
  };
}

/** Velocity is quantized before caching so a live gesture reuses sample tables. */
const VELOCITY_QUANTUM = 100;
const MAX_CACHED_TABLES = 64;
const frameCache = new Map<string, readonly ProgressFrame[]>();

/**
 * Cache key. The `c:` / `s:` prefixes are what keep a curve and a spring out of one bucket,
 * and `damping` is inside the spring's half for the same class of reason: without it a ζ0.9
 * leg and a ζ1.0 leg of the same rate shared a table and the second one drawn wore the
 * first one's curve, which showed up as the close animation having the open's shape.
 */
function progressKey(model: HeroProgressModel, samples: number) {
  if (model.kind === 'curve') {
    const { x1, y1, x2, y2 } = model.curve;
    return `c:${x1},${y1},${x2},${y2}:${samples}`;
  }
  const { rate, velocity, damping } = model.response;
  return `s:${rate}:${velocity}:${damping ?? 1}:${samples}`;
}

function quantize(model: HeroProgressModel): HeroProgressModel {
  if (model.kind === 'curve') return model;
  const velocity = Math.round(model.response.velocity * VELOCITY_QUANTUM) / VELOCITY_QUANTUM;
  return { kind: 'spring', response: { ...model.response, velocity } };
}

/**
 * Sampled progress table for WAAPI. The compositor interpolates between these fixed offsets
 * at whatever refresh rate the display runs, so the sample count is a fidelity constant —
 * never scaled by device class.
 *
 * Worth knowing which model the count is sized for: at 24 samples the largest error a linear
 * interpolation between offsets makes is 0.332% for `HERO_FLIGHT_CURVE` but **0.512%** for the
 * ζ0.9 spring at rest and **0.609%** at the −0.5 launch velocity a reversal saturates to. The
 * spring is the harder curve to table, and the reverse leg is its worst case. At 32 those are
 * 0.189% / 0.297% / 0.353%. See `HERO_PROGRESS_SAMPLES`.
 */
export function sampleProgress(
  model: HeroProgressModel,
  count: number,
): readonly ProgressFrame[] {
  const samples = Math.max(2, Math.round(count));
  const quantized = quantize(model);
  const key = progressKey(quantized, samples);
  const cached = frameCache.get(key);
  if (cached) {
    // LRU touch so live gesture tables outlive one-off flights.
    frameCache.delete(key);
    frameCache.set(key, cached);
    return cached;
  }

  const frames: ProgressFrame[] = new Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const offset = index / (samples - 1);
    frames[index] = { offset, progress: progressAt(quantized, offset) };
  }
  const table = frames as readonly ProgressFrame[];
  frameCache.set(key, table);
  while (frameCache.size > MAX_CACHED_TABLES) {
    const oldest = frameCache.keys().next().value;
    if (oldest === undefined) break;
    frameCache.delete(oldest);
  }
  return table;
}
