/**
 * The tab strip's motion: the pure half of `playSharedAxis` (`lib/motion.ts`), a module of its
 * own so the numbers it is argued by are a test (`scripts/testShell.mjs`) rather than a comment.
 *
 * **The strip is thrown by the tap and caught by a critically damped spring**, not eased along
 * `emphasized` — a stated divergence from MaterialSharedAxis's easing (AGENTS.md, "Transitions
 * between screens"). Per 60 Hz frame, as a percentage of the window:
 *
 *     emphasized, 500ms       0.9  2.9  5.6 10.0 20.7 23.6 …   10% at 52ms   90% at 189ms
 *     this, 400ms             9.5 10.8 10.9 10.3  9.4  8.3 …   10% at 18ms   90% at 209ms
 *
 * `emphasized` hangs back for its first 50ms and then covers 60% of the way in the next 50: a
 * tap showed almost nothing, then lurched — the slow stretch at the start of a quick switch. The
 * strip here leaves at twice a switch's average speed, peaks 30% faster than that 34ms later, and
 * settles by 341ms; no frame carries more than 11% of the way where `emphasized` puts 24% into
 * one. Critically damped — the effects family, whose normalised rate is the same at every
 * stiffness — because the two sides are adjacent and an overshoot would open a sliver of bare
 * panel past the strip's end: the case the family rule gives to the effects springs. Below a
 * launch of `rate` a critically damped response cannot overshoot, and every launch here stays
 * under it.
 *
 * `p` is the strip's position: 0 rests on the pane being left, 1 on the one arriving.
 */
import { SPRINGS, SPRING_DURATION } from '@/lib/spring';
import { clamp01 } from '@/lib/utils';

/** ω in a leg's own normalised time — the effects family's, 6.65 at every stiffness. */
export const STRIP_RATE = Math.sqrt(SPRINGS.defaultEffects.stiffness) * SPRING_DURATION.defaultEffects;
/** A full switch at the default speed, ms. Scaled by the motion speed like every duration. */
export const STRIP_DURATION_MS = 400;
/** The tap's launch, in a full switch's normalised units: progress per unit of its duration. */
export const STRIP_LAUNCH = 2;
/** At or above `rate` the response overshoots; stay half a unit under it. */
export const STRIP_MAX_LAUNCH = STRIP_RATE - 0.5;
/** A relaunched leg's shortest duration, as a fraction of a full switch's. */
export const STRIP_MIN_LEG = 0.6;

/** One leg: `p` from `from` to `to` over `duration` ms, launched at `launch` (normalised). */
export type StripLeg = { from: number; to: number; duration: number; launch: number };

const raw = (launch: number, t: number) =>
  1 - (1 + (STRIP_RATE - launch) * t) * Math.exp(-STRIP_RATE * t);

/** A leg's progress on `t ∈ [0, 1]`, normalised so it ends exactly at 1. */
export function stripProgress(launch: number): (t: number) => number {
  const end = raw(launch, 1);
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : raw(launch, t) / end);
}

/** Its slope, in progress per unit of the leg's own duration. */
export function stripSlope(launch: number, t: number): number {
  const u = clamp01(t);
  const lift = launch + STRIP_RATE * (STRIP_RATE - launch) * u;
  return (Math.exp(-STRIP_RATE * u) * lift) / raw(launch, 1);
}

/**
 * The launch whose leg leaves at `slope`. `p'(0) = v / raw(1)` and `raw(1)` is affine in `v`,
 * so it solves directly — the equation `lib/hero/spring.ts` solves for the hero's caught legs,
 * with this family's own ceiling rather than the hero's.
 */
export function stripLaunchFor(slope: number): number {
  if (!(slope > 0)) return 0;
  const decay = Math.exp(-STRIP_RATE);
  if (slope * decay >= 1) return STRIP_MAX_LAUNCH;
  const launch = (slope * (1 - (1 + STRIP_RATE) * decay)) / (1 - slope * decay);
  return Math.min(STRIP_MAX_LAUNCH, launch);
}

/** A tap from rest, for a full switch of `full` ms (already scaled by the motion speed). */
export function freshStripLeg(full: number): StripLeg {
  return { from: 0, to: 1, duration: full, launch: stripLaunchFor(STRIP_LAUNCH) };
}

/** Where the strip is `elapsed` ms into `leg`, and its speed then (window per ms, unsigned). */
export function stripPose(leg: StripLeg, elapsed: number): { p: number; speed: number } {
  const t = leg.duration > 0 ? clamp01(elapsed / leg.duration) : 1;
  const span = leg.to - leg.from;
  return {
    p: leg.from + span * stripProgress(leg.launch)(t),
    speed: leg.duration > 0 ? (Math.abs(span) * stripSlope(leg.launch, t)) / leg.duration : 0,
  };
}

/**
 * **The leg a tap sends the strip on, `elapsed` ms into `leg`:** towards the other side, from the
 * pose on screen, at a fresh tap's launch speed — or at the speed it already had, if that is
 * faster — over `full · clamp(√remaining, 0.6, 1)`. Never from rest and never back through the
 * old leg's tail (what `Animation.reverse` did), and it does not coast on the old way first (what
 * a velocity-continuous turn does): the reader has just sent the strip the other way.
 */
export function turnStrip(leg: StripLeg, elapsed: number, full: number): StripLeg {
  const { p, speed } = stripPose(leg, elapsed);
  const to = leg.to === 1 ? 0 : 1;
  const remaining = Math.abs(to - p);
  const duration = full * Math.min(1, Math.max(STRIP_MIN_LEG, Math.sqrt(remaining)));
  const launchSpeed = STRIP_LAUNCH / full;
  const slope = remaining > 1e-4 ? (Math.max(launchSpeed, speed) * duration) / remaining : 0;
  return { from: p, to, duration, launch: stripLaunchFor(slope) };
}

/* --- the lean ------------------------------------------------------------------------------ */

/**
 * **The layered departure.** Each block on screen follows the strip a little late, by a small,
 * continuous function of its height: the top leads and the page leaves on a shear, the seam
 * between the two panes leaning over as it sweeps across. At a block's height the leaving and the
 * arriving side share one delay, so they stay exactly one window apart there too.
 *
 * 24ms at the bottom of the viewport puts the peak lean at 16% of the window, 48ms in — about 60px
 * on a phone — and the bottom lands 24ms after the top, a frame and a half. It was 48ms, a peak of
 * 31% (120px on a phone, 370 on a desktop), which filled the old lean's whole budget (0.32 of a
 * window; past it the top finishes before the bottom has started, a shredded page) and read as
 * exaggerated: the owner asked for it to look more natural. The lag is time-based, so the lean is
 * the same share of the travel at every width. Heights are quantised to 64px first, so masonry
 * cards that read as one row, whose tops sit tens of pixels apart, set off together.
 */
export const LEAN_MAX_MS = 24;
export const LEAN_BAND_PX = 64;

/** The delay of a block whose top is at `top`, in a viewport from `viewTop`, `viewHeight` tall. */
export function leanDelay(top: number, viewTop: number, viewHeight: number, maxMs = LEAN_MAX_MS): number {
  if (!(viewHeight > 0)) return 0;
  const row = Math.round((top - viewTop) / LEAN_BAND_PX) * LEAN_BAND_PX;
  return maxMs * clamp01(row / viewHeight);
}

/** A leg and the moment it started, on the caller's clock (ms). */
export type StripSegment = { leg: StripLeg; start: number };

/** Where the strip is at `t`: on the last segment started by then; before the first, at its start. */
export function stripAt(history: readonly StripSegment[], t: number): number {
  const first = history[0];
  if (!first) return 0;
  if (t < first.start) return first.leg.from;
  let current = first;
  for (const segment of history) if (segment.start <= t) current = segment;
  return stripPose(current.leg, t - current.start).p;
}

/**
 * A block `delay` ms late sits `S(t) − S(t − delay)` behind the strip (in windows) — this, from
 * `from` until it is back to zero, as `[time, lag]` pairs where straight segments stay within
 * `tolerance` of it. The corners (every segment's start and end, and each of those `delay` later)
 * are always samples, so a turn is exact rather than cut off. Every block of one delay shares one
 * set, which is why this is keyed on the delay and not on the block.
 */
export function lagSamples(
  history: readonly StripSegment[],
  delay: number,
  from: number,
  tolerance: number,
): Array<[number, number]> {
  const last = history.at(-1);
  if (!last) return [[from, 0]];
  const until = last.start + last.leg.duration + delay;
  const lag = (t: number) => stripAt(history, t) - stripAt(history, t - delay);
  const corners = new Set<number>([from, until]);
  for (const { start, leg } of history) {
    for (const at of [start, start + leg.duration, start + delay, start + leg.duration + delay]) {
      if (at > from && at < until) corners.add(at);
    }
  }
  const stops = [...corners].sort((a, b) => a - b);
  const out: Array<[number, number]> = [[from, lag(from)]];
  const split = (t0: number, v0: number, t1: number, v1: number, depth: number) => {
    const mid = (t0 + t1) / 2;
    const value = lag(mid);
    if (depth < 2 || (depth < 10 && Math.abs(value - (v0 + v1) / 2) > tolerance)) {
      split(t0, v0, mid, value, depth + 1);
      split(mid, value, t1, v1, depth + 1);
      return;
    }
    out.push([t1, v1]);
  };
  for (let i = 1; i < stops.length; i += 1) {
    const t0 = stops[i - 1];
    const t1 = stops[i];
    split(t0, out[out.length - 1][1], t1, lag(t1), 0);
  }
  return out;
}
