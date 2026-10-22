/**
 * Release velocity, the way Flutter's `VelocityTracker` estimates it.
 *
 * The recognizers used to divide the travel across a 120ms window by its duration: a chord.
 * A chord averages the start of a flick with its end, so a flick that accelerated reported a
 * speed it no longer had, a finger turning back reported the motion it was undoing, and a
 * finger that *stopped* before lifting still reported most of the motion it made before
 * stopping — a pull that paused at the threshold and was then let go flew off as if flung.
 *
 * - **A horizon** (`HORIZON_MS`): only the last 100ms counts.
 * - **A stop rule** (`ASSUME_STOPPED_MS`): a 40ms gap between samples — or between the last
 *   sample and the release — means the finger rested; nothing before it describes the release.
 * - **A least-squares quadratic** (a line with fewer than three samples), whose slope at the
 *   newest sample is the velocity *at release*, not the average over the window.
 * - **A pointerup that did not move is a time, not a position.** It arrives a few ms after the
 *   last move at the same coordinates; fitted as a sample it bent the curve flat and read an
 *   ordinary constant-speed flick as a finger moving back. It only feeds the stop rule.
 *
 * Pure: no DOM, so it is unit-testable and shared by both recognizers.
 */

const HORIZON_MS = 100;
const ASSUME_STOPPED_MS = 40;
const MAX_SAMPLES = 20;
const SAME_POSITION_PX = 0.5;

export type VelocitySample = { time: number; x: number; y: number };

export class HeroVelocityTracker {
  private samples: VelocitySample[] = [];

  reset() {
    this.samples = [];
  }

  add(time: number, x: number, y: number) {
    const last = this.samples.at(-1);
    // Coalesced events can share a timestamp; the newer position wins.
    if (last && time <= last.time) {
      last.x = x;
      last.y = y;
      return;
    }
    this.samples.push({ time, x, y });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /**
   * px/ms on each axis at release; zero when the finger had come to rest.
   * @param releaseTime the pointerup's timestamp, when there is one.
   * @param releaseX the pointerup's position on each axis, in the samples' coordinates.
   */
  velocity(release?: VelocitySample): { x: number; y: number } {
    let samples = this.samples;
    if (release) {
      const last = samples.at(-1);
      const moved =
        !last ||
        Math.abs(release.x - last.x) > SAME_POSITION_PX ||
        Math.abs(release.y - last.y) > SAME_POSITION_PX;
      if (last && release.time - last.time > ASSUME_STOPPED_MS && !moved) return { x: 0, y: 0 };
      if (moved && (!last || release.time > last.time)) samples = [...samples, release];
    }
    const window = recent(samples);
    if (window.length < 2) return { x: 0, y: 0 };
    const newest = window[window.length - 1].time;
    const times = window.map((sample) => sample.time - newest);
    return {
      x: slopeAtZero(times, window.map((sample) => sample.x)),
      y: slopeAtZero(times, window.map((sample) => sample.y)),
    };
  }
}

/** The samples that still describe the release, oldest first. */
function recent(samples: VelocitySample[]) {
  const out: VelocitySample[] = [];
  const newest = samples.at(-1);
  let previous: VelocitySample | null = null;
  for (let index = samples.length - 1; index >= 0 && newest; index -= 1) {
    const sample = samples[index];
    if (newest.time - sample.time > HORIZON_MS) break;
    if (previous && previous.time - sample.time > ASSUME_STOPPED_MS) break;
    out.push(sample);
    previous = sample;
  }
  return out.reverse();
}

/** Derivative at t = 0 of the least-squares polynomial (degree 2 when it can be, else 1). */
export function slopeAtZero(times: number[], values: number[]) {
  const n = times.length;
  if (n < 2) return 0;
  if (n >= 3) {
    const quadratic = fitQuadraticSlope(times, values);
    if (quadratic !== null) return quadratic;
  }
  let st = 0;
  let sv = 0;
  for (let index = 0; index < n; index += 1) {
    st += times[index];
    sv += values[index];
  }
  const mt = st / n;
  const mv = sv / n;
  let num = 0;
  let den = 0;
  for (let index = 0; index < n; index += 1) {
    num += (times[index] - mt) * (values[index] - mv);
    den += (times[index] - mt) ** 2;
  }
  return den > 1e-9 ? num / den : 0;
}

/** v(t) ≈ a + b·t + c·t²: solve the 3×3 normal equations, return b. */
function fitQuadraticSlope(times: number[], values: number[]) {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let r0 = 0;
  let r1 = 0;
  let r2 = 0;
  for (let index = 0; index < times.length; index += 1) {
    const t = times[index];
    const v = values[index];
    const t2 = t * t;
    s0 += 1;
    s1 += t;
    s2 += t2;
    s3 += t2 * t;
    s4 += t2 * t2;
    r0 += v;
    r1 += v * t;
    r2 += v * t2;
  }
  // Cramer's rule on [[s0 s1 s2] [s1 s2 s3] [s2 s3 s4]] · [a b c] = [r0 r1 r2].
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (Math.abs(det) < 1e-6) return null;
  const detB = s0 * (r1 * s4 - s3 * r2) - r0 * (s1 * s4 - s3 * s2) + s2 * (s1 * r2 - r1 * s2);
  return detB / det;
}
