'use client';

import { clamp01 } from '@/lib/utils';
import {
  springProgress,
  springVelocity,
  springVelocityFromSpeed,
  type SpringResponse,
} from './spring';

/**
 * A leg's progress function, in one of two kinds — the shape is independent of the leg's
 * duration, and which kind a leg gets is decided by how it starts:
 *
 * - **From rest — a curve** (`HERO_FLIGHT_CURVE`): it moves on the first frame, crests a few
 *   frames in and lands at rest. A curve, because a curve can land: a spring's last tenth of
 *   travel creeps for as long again as the rest, and the flight flew one for a round that read
 *   slow for exactly that.
 * - **At a speed something already has — a spring solved for it.** A reversal, a mid-flight
 *   rebuild and the drag release have to leave at the flyer's visible speed, and a Bézier's
 *   launch slope is fixed by its own shape.
 *
 * Both kinds are differentiable in the same units, which is what keeps velocity-continuous
 * interruption and DOM-read-free pose measurement working across the split.
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
 * solved — a response field rebuilt field by field at a call site silently drops ζ back to
 * 1, which had shipped once. A spread that must not be forgotten is a hazard; a function
 * that owns the spread is not.
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

/** Resolution of the measure a table's samples are spaced on. 256 places them as well as 2048
 *  did (`hero:path` reads the same to 0.005%) at a ninth of the cost — 0.1ms a table, which a
 *  reversal pays at its tap. */
const SPACING_STEPS = 256;
/** How strongly a leg's travel draws samples to itself, against a floor of time (`sampleOffsets`). */
const SPACING_TRAVEL = 1.5;
/** How strongly a leg's bend draws samples to itself, against the same floor. */
const SPACING_BEND = 1.5;

/**
 * Where a table's samples fall. Three things make a straight line between two samples wrong, and
 * each draws the samples to itself: **travel**, because whatever is computed from the progress errs
 * by the square of a segment's step — the window's scale pair and its compensator, which WAAPI lerps
 * independently, most of all; **bend**, because the progress itself errs by a segment's bend times
 * its length squared; and **time**, so that no segment is long. The density is whichever asks most,
 * `max(1, SPACING_BEND · √|p''|, SPACING_TRAVEL · |p'|)` in normalised time, and the samples cut it
 * into equal shares.
 *
 * Spaced evenly in time, a leg that leaves moving puts a long stretch of travel in its first
 * segments, just where a tall card's window is narrowest and its width changes fastest, and the
 * content under the compensator comes out squashed between samples: 0.499% for the shipped curve
 * at 48 samples against `hero:path`'s 0.6%, and 4.5% for the launched response the flight flew
 * for a round. Spaced on travel and bend too, the same 48 hold it to 0.332%, and every table —
 * the fastest reversal's dip included — to under 0.04% of the way.
 */
function sampleOffsets(model: HeroProgressModel, samples: number): number[] {
  const step = 1 / SPACING_STEPS;
  const values = new Float64Array(SPACING_STEPS + 1);
  for (let index = 0; index <= SPACING_STEPS; index += 1) values[index] = progressAt(model, index * step);
  const measure = new Float64Array(SPACING_STEPS + 1);
  let bend = 0;
  for (let index = 1; index <= SPACING_STEPS; index += 1) {
    const slope = Math.abs(values[index] - values[index - 1]) / step;
    if (index < SPACING_STEPS) {
      bend = Math.sqrt(Math.abs(values[index + 1] - 2 * values[index] + values[index - 1])) / step;
    }
    measure[index] = measure[index - 1] + Math.max(1, SPACING_BEND * bend, SPACING_TRAVEL * slope) * step;
  }
  const total = measure[SPACING_STEPS];
  const offsets = [0];
  let index = 1;
  for (let sample = 1; sample < samples - 1; sample += 1) {
    const target = (sample / (samples - 1)) * total;
    while (measure[index] < target) index += 1;
    const share = (target - measure[index - 1]) / (measure[index] - measure[index - 1]);
    offsets.push((index - 1 + share) * step);
  }
  offsets.push(1);
  return offsets;
}

/**
 * Sampled progress table for WAAPI. The compositor interpolates between these fixed offsets
 * at whatever refresh rate the display runs, so the sample count is a fidelity constant —
 * never scaled by device class. The offsets are spaced on time, travel and bend together
 * (`sampleOffsets`).
 *
 * Worth knowing which model the count is sized for: at 24 samples the largest error a linear
 * interpolation between offsets makes is 0.096% for `HERO_FLIGHT_CURVE`, 0.087% for the ζ0.9
 * spring at rest and **0.142%** at the −3 launch velocity a reversal may leave at (the floor in
 * `spring.ts`) — a fast reversal's dip is the hardest leg to table. At 48 those are 0.023% /
 * 0.021% / 0.034%, a tenth of the 0.4% `hero:path` tolerance; what sizes the count is the
 * container's anisotropy, not the progress. See `HERO_PROGRESS_SAMPLES`.
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

  const offsets = sampleOffsets(quantized, samples);
  const frames: ProgressFrame[] = offsets.map((offset) => ({ offset, progress: progressAt(quantized, offset) }));
  const table = frames as readonly ProgressFrame[];
  frameCache.set(key, table);
  while (frameCache.size > MAX_CACHED_TABLES) {
    const oldest = frameCache.keys().next().value;
    if (oldest === undefined) break;
    frameCache.delete(oldest);
  }
  return table;
}
