'use client';

import { clamp01 } from '@/lib/utils';

/**
 * Analytic spring, damped or critically damped.
 *
 * One normalized response `p(t)` on `t ∈ [0, 1]` with `p(0) = 0` and `p(1) = 1`, so a leg's
 * *shape* is independent of how long it lasts and the duration is a separate decision. The
 * sampling, the table cache and the choice between this and a curve all live in
 * `progress.ts`; this file is the closed form and nothing else.
 *
 * The model is a unit-mass spring released from 0 toward 1 with an initial speed:
 *
 *     under-damped (ζ < 1)   raw(t) = 1 - e^(-ζω t) · [cos(ω_d t) + ((ζω - v)/ω_d) · sin(ω_d t)]
 *     critically damped (ζ=1) raw(t) = 1 - (1 + (ω - v) t) · e^(-ω t)
 *     p(t) = raw(t) / raw(1)
 *
 * where `ω_d = ω√(1 - ζ²)`. `rate` is ω in *normalized* time — i.e. the physical ω times the
 * leg's duration — so setting it to a token spring's `√k × settle` makes the leg reproduce
 * that spring's curve over its own window. `velocity` is the normalized launch speed and
 * `damping` is ζ, defaulting to 1.
 *
 * **What it is for, now that a from-rest leg flies `HERO_FLIGHT_CURVE` instead.** A spring is
 * the only one of the two models that can be *solved* for a launch slope — a cubic Bézier's
 * is `y1/x1`, fixed by its shape — so every leg that has to leave at a speed something is
 * already travelling at is a spring: a reversal, a mid-flight rebuild, a drag release. ζ0.9
 * remains the right ratio for those, and the argument is in `HERO_FLIGHT_RESPONSE`.
 *
 * ζ < 1 was the addition that made it possible to reference the `MotionScheme` springs the
 * rest of the app runs on: every spatial token in `StandardMotionTokens` is ζ0.9, and ζ was
 * exactly the parameter that was missing. The two forms agree in the limit, and both are
 * differentiable, which is what makes velocity-continuous interruption and DOM-read-free pose
 * measurement possible.
 *
 * Note ζ0.9 overshoots by `e^(-ζπ/√(1-ζ²))` ≈ 0.15%, which on a 600px flight is under a
 * pixel: enough to be a settle rather than a stop, not enough to read as the picture missing
 * its landing box. That is the whole reason the spatial tier is ζ0.9 and not ζ0.8.
 */

export type SpringResponse = {
  /** ω in normalized time: the physical natural frequency times the duration. */
  rate: number;
  /** Normalized launch speed, in progress units per unit of normalized time. */
  velocity: number;
  /** Damping ratio. Absent means 1 — critically damped, so it cannot overshoot. */
  damping?: number;
};

/** Launch speeds outside this band either stall or visibly overshoot. */
const MIN_VELOCITY = -0.5;
const MAX_VELOCITY = 2.5;

export function clampSpringVelocity(velocity: number) {
  if (!Number.isFinite(velocity)) return 0;
  return Math.min(MAX_VELOCITY, Math.max(MIN_VELOCITY, velocity));
}

/** Damped natural frequency, or 0 when the response is critically damped. */
function damped(response: SpringResponse) {
  const zeta = response.damping ?? 1;
  return zeta < 1 ? response.rate * Math.sqrt(1 - zeta * zeta) : 0;
}

function rawResponse(time: number, response: SpringResponse) {
  const { rate, velocity } = response;
  const wd = damped(response);
  if (wd <= 0) return 1 - (1 + (rate - velocity) * time) * Math.exp(-rate * time);
  const a = (response.damping ?? 1) * rate;
  return (
    1 -
    Math.exp(-a * time) *
      (Math.cos(wd * time) + ((a - velocity) / wd) * Math.sin(wd * time))
  );
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
  const clamped = clamp01(time);
  const end = rawResponse(1, response);
  if (Math.abs(end) < 1e-9) return 1;
  const wd = damped(response);
  if (wd <= 0) {
    const slope =
      Math.exp(-rate * clamped) * (rate * (1 + (rate - velocity) * clamped) - (rate - velocity));
    return slope / end;
  }
  /* raw'(t) = e^(-a t) · [v · cos(ω_d t) + (a·C + ω_d) · sin(ω_d t)],  C = (a - v)/ω_d.
     At t = 0 that is exactly `v`, which is the property the interruption solver
     below depends on. */
  const a = (response.damping ?? 1) * rate;
  const c = (a - velocity) / wd;
  const slope =
    Math.exp(-a * clamped) *
    (velocity * Math.cos(wd * clamped) + (a * c + wd) * Math.sin(wd * clamped));
  return slope / end;
}

/**
 * Solve for the launch velocity that makes a new spring leave at the speed the
 * previous motion was already travelling — the core of a "caught mid-air"
 * interruption rather than a teleport-and-restart.
 *
 * `p'(0) = velocity / raw(1)`, and `raw(1)` itself depends on `velocity` — but only
 * *affinely*, in both damping regimes, so the same expansion solves it:
 *
 *     raw(1) = A + v · E
 *     target · (A + v · E) = v   →   v = target · A / (1 - target · E)
 *
 *     ζ = 1   A = 1 - (1 + ω) e^-ω          E = e^-ω
 *     ζ < 1   A = 1 - e^-a (cos ω_d + (a/ω_d) sin ω_d)   E = e^-a · sin(ω_d)/ω_d
 *
 * where `a = ζω`. The two agree in the limit ω_d → 0, since `sin(x)/x → 1`.
 *
 * @param target desired `p'(0)`, in progress units per normalized time unit
 */
export function solveSpringVelocity(target: number, response: SpringResponse) {
  if (!Number.isFinite(target) || target <= 0) return clampSpringVelocity(target);
  const { rate } = response;
  const wd = damped(response);
  let base: number;
  let decay: number;
  if (wd <= 0) {
    decay = Math.exp(-rate);
    base = 1 - (1 + rate) * decay;
  } else {
    const a = (response.damping ?? 1) * rate;
    const envelope = Math.exp(-a);
    base = 1 - envelope * (Math.cos(wd) + (a / wd) * Math.sin(wd));
    decay = (envelope * Math.sin(wd)) / wd;
  }
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
  response: SpringResponse,
) {
  if (!Number.isFinite(speed) || distance <= 0.5 || duration <= 0) return 0;
  // px/ms → progress per normalized time unit.
  return solveSpringVelocity((speed * duration) / distance, response);
}

export function interpolate(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}
