'use client';

/**
 * Analytic critically-damped spring.
 *
 * Every Hero motion — flight, reverse, pull release — is a normalized response
 * `p(t)` on `t ∈ [0, 1]` with `p(0) = 0` and `p(1) = 1`:
 *
 *     raw(t) = 1 - (1 + (rate - velocity) * t) * e^(-rate * t)
 *     p(t)   = raw(t) / raw(1)
 *
 * `rate` is stiffness (how hard it converges), `velocity` is the normalized
 * launch speed. Because the closed form is differentiable, the current progress
 * AND its instantaneous rate of change are available at any time without
 * touching the DOM. That is what makes velocity-continuous interruption and
 * DOM-read-free pose measurement possible.
 */

export type SpringResponse = {
  rate: number;
  velocity: number;
};

export type SpringFrame = {
  offset: number;
  progress: number;
};

/** Launch speeds outside this band either stall or visibly overshoot. */
const MIN_VELOCITY = -0.5;
const MAX_VELOCITY = 2.5;

/** Velocity is quantized before caching so live gestures reuse sample tables. */
const VELOCITY_QUANTUM = 100;

export function clampSpringVelocity(velocity: number) {
  if (!Number.isFinite(velocity)) return 0;
  return Math.min(MAX_VELOCITY, Math.max(MIN_VELOCITY, velocity));
}

function rawResponse(time: number, { rate, velocity }: SpringResponse) {
  return 1 - (1 + (rate - velocity) * time) * Math.exp(-rate * time);
}

/** Normalized progress: exactly 0 at t=0 and exactly 1 at t=1. */
export function springProgress(time: number, response: SpringResponse) {
  if (time <= 0) return 0;
  if (time >= 1) return 1;
  const end = rawResponse(1, response);
  // A degenerate response would divide by ~0; fall back to linear travel.
  if (Math.abs(end) < 1e-9) return time;
  return rawResponse(time, response) / end;
}

/**
 * d/dt of `springProgress`, in progress units per unit of normalized time.
 *
 *     raw'(t) = e^(-rate * t) * (rate * (1 + (rate - velocity) * t) - (rate - velocity))
 */
export function springVelocity(time: number, response: SpringResponse) {
  const { rate, velocity } = response;
  const clamped = Math.min(1, Math.max(0, time));
  const end = rawResponse(1, response);
  if (Math.abs(end) < 1e-9) return 1;
  const slope = Math.exp(-rate * clamped) *
    (rate * (1 + (rate - velocity) * clamped) - (rate - velocity));
  return slope / end;
}

/**
 * Solve for the launch velocity that makes a new spring leave at the speed the
 * previous motion was already travelling — the core of a "caught mid-air"
 * interruption rather than a teleport-and-restart.
 *
 * `p'(0) = velocity / raw(1)`, and `raw(1)` itself depends on `velocity`, so
 * expand and solve directly:
 *
 *     target = v / (1 - (1 + rate - v) * e^-rate)
 *     let E = e^-rate,  A = 1 - (1 + rate) * E
 *     target * (A + v * E) = v
 *     v = target * A / (1 - target * E)
 *
 * @param target desired `p'(0)`, in progress units per normalized time unit
 */
export function solveSpringVelocity(target: number, rate: number) {
  if (!Number.isFinite(target) || target <= 0) return clampSpringVelocity(target);
  const decay = Math.exp(-rate);
  const base = 1 - (1 + rate) * decay;
  const denominator = 1 - target * decay;
  // Near the asymptote the required launch speed diverges; take the ceiling.
  if (Math.abs(denominator) < 1e-6) return MAX_VELOCITY;
  return clampSpringVelocity((target * base) / denominator);
}

/**
 * Convert a real screen-space speed into this spring's normalized launch
 * velocity, given how long the new motion lasts and how far it travels.
 *
 * @param speed    signed px/ms along the new travel direction
 * @param distance total px the new motion covers
 * @param duration new motion duration in ms
 */
export function springVelocityFromSpeed(
  speed: number,
  distance: number,
  duration: number,
  rate: number,
) {
  if (!Number.isFinite(speed) || distance <= 0.5 || duration <= 0) return 0;
  // px/ms → progress per normalized time unit.
  return solveSpringVelocity((speed * duration) / distance, rate);
}

const frameCache = new Map<string, readonly SpringFrame[]>();
const MAX_CACHED_TABLES = 64;

/**
 * Sampled progress table for WAAPI. The compositor interpolates between these
 * fixed offsets at whatever refresh rate the display runs, so the sample count
 * is a fidelity constant — never scaled by device class.
 */
export function sampleSpring(
  response: SpringResponse,
  count: number,
): readonly SpringFrame[] {
  const samples = Math.max(2, Math.round(count));
  const velocity = Math.round(response.velocity * VELOCITY_QUANTUM) / VELOCITY_QUANTUM;
  const quantized: SpringResponse = { rate: response.rate, velocity };
  const key = `${quantized.rate}:${velocity}:${samples}`;
  const cached = frameCache.get(key);
  if (cached) {
    // LRU touch so live gesture tables outlive one-off flights.
    frameCache.delete(key);
    frameCache.set(key, cached);
    return cached;
  }

  const frames: SpringFrame[] = new Array(samples);
  for (let index = 0; index < samples; index += 1) {
    const offset = index / (samples - 1);
    frames[index] = { offset, progress: springProgress(offset, quantized) };
  }
  const table = frames as readonly SpringFrame[];
  frameCache.set(key, table);
  while (frameCache.size > MAX_CACHED_TABLES) {
    const oldest = frameCache.keys().next().value;
    if (oldest === undefined) break;
    frameCache.delete(oldest);
  }
  return table;
}

export function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}
