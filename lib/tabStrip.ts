/**
 * The tab strip's motion: the pure half of `playSharedAxis` (`lib/motion.ts`), a module of its
 * own so the numbers it is argued by are a test (`scripts/testShell.mjs`) rather than a comment.
 *
 * **The strip is thrown by the tap and caught by a critically damped spring**, not eased along
 * `emphasized` — a stated divergence from MaterialSharedAxis's easing (AGENTS.md, "Transitions
 * between screens"). Per 60 Hz frame, as a percentage of the window:
 *
 *     emphasized, 500ms       0.9  2.9  5.6 10.0 20.7 23.6 …   50% at  89ms  90% at 189ms
 *     launch 2, 400ms         9.5 10.8 10.9 10.3  9.4  8.3 …   50% at  82ms  90% at 210ms
 *     launch 4.5, 300ms      22.7 18.2 14.4 11.2  8.6  6.5 …   50% at  44ms  90% at 133ms
 *     this, 350ms            15.5 14.5 12.9 11.1  9.3  7.7 …   50% at  60ms  90% at 170ms
 *
 * `emphasized` hangs back for its first 50ms and then lurches. The launch-2 strip that replaced it
 * left at twice a switch's average speed and *gained* speed for its first 34ms: an even, unhurried
 * glide that took 82ms to reach halfway and 210ms to look arrived, which on a phone read as the
 * page dragging behind the finger. Thrown at 4.5 over 300ms instead, it covered nearly a quarter
 * of the way in its first frame and was all but over in 130ms — a lunge, then a crawl. Most of what had read as dragging was
 * the time before the first frame, which the press now pays for (`primeTabTransition`), so the
 * curve need not lunge to keep up with the finger.
 *
 * **Caught by Compose's pager spring.** The strip *is* a pager — two adjacent panes, one window —
 * so it settles on the spring Compose gives `HorizontalPager`'s snap: the layout spring
 * (`PAGER_SPRING`, ζ1 k400 — Compose's own pager snap, kept off `layout`'s k700 because a launched spring's first frame scales with its stiffness; `lib/spring.ts`). Critically damped because the two sides are
 * adjacent and an overshoot would open a sliver of bare panel past the strip's end.
 *
 * **Launched at half the spring's rate, which is the one launch with no jerk:** a critically
 * damped response launched below it gains speed after it leaves (the glide), above it starts
 * shedding speed at once (the throw), and at it holds its launch speed for the first instant and
 * only then slows — the smoothest start a launched spring has. Below a launch of `rate` a
 * critically damped response cannot overshoot, and every launch here stays under it.
 *
 * `p` is the strip's position: 0 rests on the pane being left, 1 on the one arriving.
 */
import { PAGER_SPRING, springDurationMs, springRate } from '@/lib/spring';
import { clamp01 } from '@/lib/utils';

/** ω in a leg's own normalised time — the layout spring's. */
export const STRIP_RATE = springRate(PAGER_SPRING);
/** A full switch at the default speed, ms: the layout spring's settle time. Scaled by the motion
 *  speed like every duration. */
export const STRIP_DURATION_MS = springDurationMs(PAGER_SPRING);
/** The tap's launch, in a full switch's normalised units: progress per unit of its duration. Half
 *  of `STRIP_RATE`, where the response leaves at its top speed with no jerk. */
export const STRIP_LAUNCH = STRIP_RATE / 2;
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
export function freshStripLeg(full: number, launch: number = STRIP_LAUNCH): StripLeg {
  return { from: 0, to: 1, duration: full, launch: stripLaunchFor(launch) };
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
 * a velocity-continuous turn does): the reader has just sent the strip the other way. `launch` is
 * a fresh tap's, for a caller on a clock of its own (the forum's container transform).
 */
export function turnStrip(
  leg: StripLeg,
  elapsed: number,
  full: number,
  launch: number = STRIP_LAUNCH,
): StripLeg {
  const { p, speed } = stripPose(leg, elapsed);
  const to = leg.to === 1 ? 0 : 1;
  const remaining = Math.abs(to - p);
  const duration = full * Math.min(1, Math.max(STRIP_MIN_LEG, Math.sqrt(remaining)));
  const launchSpeed = launch / full;
  const slope = remaining > 1e-4 ? (Math.max(launchSpeed, speed) * duration) / remaining : 0;
  return { from: p, to, duration, launch: stripLaunchFor(slope) };
}

/* --- the window ---------------------------------------------------------------------------- */

/**
 * **On a wide screen the strip slides past the content column and a margin, not the whole
 * scroller, and each side fades out at the window's edges.** Sliding the scroller's width, a list
 * column on a 1920 desktop crossed 356px of blank margin on either side and was cut off at the
 * drawer's edge and at the scrollbar: content flying the width of the screen, sliced mid-glyph at
 * both ends. The window is the column, `STRIP_EDGE_CLEAR` past it on either side — the page gutter, so nothing a pane
 * draws at rest is dimmed when a run starts — and a fade of up to `STRIP_EDGE_FADE` beyond that.
 * The strip travels the window's width, so each side starts and ends a fade's width past the
 * window, out of sight, and the pages stay a fixed distance apart as before.
 *
 * The fade takes the room the scroller leaves, up to its full width: where the column leaves less
 * (a 1440 desktop's list column), the fade ends at the scroller's edge; where it leaves less than
 * the gutter and `STRIP_EDGE_FADE_MIN` (a phone, whose column is the scroller less its gutter), the
 * scroller is the window, which clips, as before.
 */
export const STRIP_EDGE_CLEAR = 24;
export const STRIP_EDGE_FADE = 96;
/** The narrowest fade worth drawing: the edge fade a scrolled row wears (2rem). */
export const STRIP_EDGE_FADE_MIN = 32;

/** The window for a column in a scroller whose inner box runs from `inner.left` to `inner.right`:
 *  its width, which is the strip's travel, how far it reaches past the column on either side, and
 *  the fade at its edges — or null where the scroller is the window. */
export function columnWindow(
  column: { left: number; right: number },
  inner: { left: number; right: number },
): { width: number; reach: number; fade: number } | null {
  const room = Math.min(column.left - inner.left, inner.right - column.right);
  const fade = Math.min(STRIP_EDGE_FADE, Math.floor(room - STRIP_EDGE_CLEAR));
  if (!(fade >= STRIP_EDGE_FADE_MIN)) return null;
  const reach = STRIP_EDGE_CLEAR + fade;
  return { width: column.right - column.left + 2 * reach, reach, fade };
}

/* --- the lean ------------------------------------------------------------------------------ */

/**
 * **The layered departure: each block eases after its pane.** A block on screen follows the strip
 * by plain exponential smoothing — every instant it closes the same share of the distance to where
 * its pane is — with a time constant of 15ms one view height below the top of the leaning panel and
 * less in proportion above it, so the top band rides its pane and every row below trails a little
 * further than the one above. Nothing else: no mass, no springiness, one number. The page leans
 * while it moves, 12% of the window at the bottom of the view at its peak, about 40ms in; the lean
 * shrinks as the strip slows, and every block lands on its pane from behind, never past it, the
 * bottom of the view within a pixel of its pane as the strip settles.
 *
 * It was a delay — each block where the strip had been up to 15ms earlier — which read as dead:
 * with a strip that leaves at its top speed, the bottom of the view stood still for its first frame
 * and then jumped to full speed. Then it was a spring per block, which moved from the first frame
 * but carried the lower rows past their pane and back while the top was already still — a wobble,
 * and a more complicated answer than the question needed. Smoothing moves from
 * the first frame and has nothing to overshoot with: a row speeds up as the gap to its pane opens
 * and slows as it closes, which is what a row being pulled along looks like. A 48ms delay, 31% of
 * the window, read as exaggerated; 24ms, 16%, did not. Heights are quantised to 64px first, so
 * masonry cards that read as one row, whose tops sit tens of pixels apart, move together.
 */
/** The smoothing time constant one view height below the panel's top, ms at the default speed;
 *  less in proportion higher up. */
export const LEAN_LAG_MS = 15;
export const LEAN_BAND_PX = 64;

/** How deep a block whose top is at `top` sits in the lean, in a viewport from `viewTop`,
 *  `viewHeight` tall: 0 in the top band, 1 a view height below it, in 64px bands. */
export function leanDepth(top: number, viewTop: number, viewHeight: number): number {
  if (!(viewHeight > 0)) return 0;
  const row = Math.round((top - viewTop) / LEAN_BAND_PX) * LEAN_BAND_PX;
  return clamp01(row / viewHeight);
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

/** The step the strip is sampled at, ms. Smoothing is solved exactly over each step, the strip
 *  taken as straight between samples, so the step is only how finely the strip is read. */
const LEAN_STEP_MS = 1;

/**
 * **How far behind its pane a block at each depth is**, in windows, from `from` until it has
 * landed: `lagSampler(history, from, scale)(depth, tolerance)` gives `[time, lag]` pairs where
 * straight segments stay within `tolerance` of it, the last one at zero. The block starts on its
 * pane where the first segment starts and follows every segment after it — a turn included, which
 * it meets from where it is, so a lean that reverses does so top first, as a wave. `scale` is the
 * motion speed's, which stretches the smoothing with every other duration. The strip is sampled
 * once for every depth.
 */
export function lagSampler(
  history: readonly StripSegment[],
  from: number,
  scale = 1,
): (depth: number, tolerance: number) => Array<[number, number]> {
  const first = history[0];
  if (!first) return () => [[from, 0]];
  /* A grid with `from` on it, from the first segment's start to the last one's end. */
  const before = Math.max(0, Math.ceil((from - first.start) / LEAN_STEP_MS));
  const start = from - before * LEAN_STEP_MS;
  const end = Math.max(...history.map((segment) => segment.start + segment.leg.duration));
  const count = before + Math.max(0, Math.ceil((end - from) / LEAN_STEP_MS));
  const place = new Float64Array(count + 1);
  for (let i = 0; i <= count; i += 1) place[i] = stripAt(history, start + i * LEAN_STEP_MS);
  const rest = place[count];

  return (depth, tolerance) => {
    if (!(depth > 0)) return [[from, 0]];
    const lagMs = LEAN_LAG_MS * depth * Math.max(scale, 1e-3);
    const decay = Math.exp(-LEAN_STEP_MS / lagMs);
    /* Landed at a third of the tolerance: half a pixel, for the pixel and a half the run samples at. */
    const landed = tolerance / 3;
    const limit = count + Math.ceil((lagMs * Math.log(1 / landed)) / LEAN_STEP_MS);
    const lags = new Float64Array(limit - before + 1);
    let n = 0;
    let position = place[0];
    for (let i = 0; i <= limit; i += 1) {
      const here = i <= count ? place[i] : rest;
      if (i >= before) {
        lags[n] = here - position;
        n += 1;
        if (i > count && Math.abs(here - position) < landed) break;
      }
      /* Exponential smoothing towards a target moving in a straight line, solved exactly: on a ramp
         the block settles a time constant's worth of travel behind it. */
      const next = i < count ? place[i + 1] : rest;
      const behind = ((next - here) / LEAN_STEP_MS) * lagMs;
      position = next - behind + (position - here + behind) * decay;
    }
    lags[n - 1] = 0;
    return simplify(lags, n, tolerance).map(
      (i) => [from + i * LEAN_STEP_MS, lags[i]] as [number, number],
    );
  };
}

/** The fewest of `n` evenly spaced points whose straight segments stay within `tolerance` of the
 *  rest (Ramer–Douglas–Peucker, vertical distance), as indices. */
function simplify(values: Float64Array, n: number, tolerance: number): number[] {
  if (n <= 2) return n === 2 ? [0, 1] : [0];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [0, n - 1];
  while (stack.length > 0) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const slope = (values[b] - values[a]) / (b - a);
    let worst = -1;
    let far = tolerance;
    for (let i = a + 1; i < b; i += 1) {
      const off = Math.abs(values[i] - (values[a] + slope * (i - a)));
      if (off > far) {
        far = off;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) if (keep[i]) out.push(i);
  return out;
}
