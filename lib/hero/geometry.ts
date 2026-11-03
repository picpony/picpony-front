'use client';

import {
  HERO_ARC_CROP_BUDGET,
  HERO_ARC_CONTAIN_SCAN,
  HERO_ARC_CONTAIN_SLACK,
  HERO_ARC_SOLVE_SAMPLES,
  HERO_ARC_SOLVE_STEPS,
  HERO_BACKGROUND_SINK_SCALE,
  HERO_MASK_RADIUS_STEP_PX,
} from './constants';
import { clamp01 } from '@/lib/utils';

export type HeroRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type HeroHost = HeroRect & { element: HTMLElement };

/** Outer box transform: translate + scale relative to a fixed base size. */
export type HeroBoxTransform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
};

/* The media box sizing lives in `./mediaBox`, which the Stage (rendered by the shell on every
   route) can import without this module's solver. Re-exported for the detail's media. */
export {
  getHeroMediaPreviewSizes,
  getHeroMediaRenderedWidth,
  getHeroMediaResponsiveSizes,
  getHeroMediaStyle,
} from './mediaBox';

// ---------------------------------------------------------------------------
// Flyer geometry
//
// The flyer is sized once to its destination box (`base`) and then only ever
// transformed, so the browser never relayouts mid-flight. The clip child
// carries the corner radius pre-divided by the parent's scale, which keeps the
// painted radius constant in screen space.
// ---------------------------------------------------------------------------

export function getHeroBoxTransform(
  base: HeroRect,
  display: HeroRect,
  // Takes a plain rect, not a host: the container transform expresses its own
  // window as the pose of a host-sized box and reuses this function.
  host: HeroRect,
): HeroBoxTransform {
  return {
    x: display.left - host.left,
    y: display.top - host.top,
    scaleX: display.width / base.width,
    scaleY: display.height / base.height,
  };
}

/**
 * Transform for the media inside the flyer. The gallery thumbnail is
 * `object-cover` (cropped) while the detail media is `object-contain`, so the
 * inner layer must morph its own crop as the outer box changes aspect ratio.
 * Expressed relative to the already-scaled outer box.
 */
export function getHeroCoverTransform(
  base: HeroRect,
  display: HeroRect,
  host: HeroHost,
): HeroBoxTransform {
  const outer = getHeroBoxTransform(base, display, host);
  const localLeft = display.left - host.left;
  const localTop = display.top - host.top;
  const cover = Math.max(display.width / base.width, display.height / base.height);
  const coverX = localLeft + (display.width - base.width * cover) / 2;
  const coverY = localTop + (display.height - base.height * cover) / 2;
  return {
    x: (coverX - outer.x) / outer.scaleX,
    y: (coverY - outer.y) / outer.scaleY,
    scaleX: cover / outer.scaleX,
    scaleY: cover / outer.scaleY,
  };
}

export function formatHeroTransform({ x, y, scaleX, scaleY }: HeroBoxTransform) {
  return `translate3d(${x}px, ${y}px, 0) scale(${scaleX}, ${scaleY})`;
}

/** Local-space radius for the clip child, whose parent carries the scale. */
export function formatHeroClipRadius(
  base: HeroRect,
  width: number,
  height: number,
  radius: number,
) {
  const scaleX = width / base.width;
  const scaleY = height / base.height;
  return `${radius / scaleX}px / ${radius / scaleY}px`;
}

// ---------------------------------------------------------------------------
// Container transform
//
// One growing, clipping, rounded box with the destination content laid out at
// its final size and scaled to the box's current width — `MaterialContainerTransform`
// masked to the container; `open_container.dart` writes it as a fitWidth
// `FittedBox` inside a `SizedBox` of the animated rect.
//
// **In DOM terms that is a composited `transform` on a clipping wrapper, and it must not
// be an animated `clip-path`.** Chromium composites `clip-path` only through a Finch-gated
// paint-worklet path — without it the property falls to the main thread, and the
// property-tree manager forces a render surface on *any* clip node carrying a `clip-path`,
// animated or not. A circular radius instead yields a fast rounded-corner mask with no
// render surface. Two corollaries: the clip must be `overflow: clip` on **both** axes
// (a single-axis clip silently squares the corner), and the corner must be **one circular
// value** (an elliptical radius costs a mask layer).
//
// The content pair:
//
//     clip:        translate3d(dx, dy, 0) scale(sx, sy)   // the window
//     compensator: scale(f/sx, f/sy), f = max(sx, sy)     // back to isotropic
//
// A point in host-sized space lands at `d + f*p` — **the accumulated content transform is a
// uniform `scale(f)` with a top-left translate, i.e. the pair *is* the fit**, with the axis
// chosen per leg (`FIT_MODE_AUTO`). There is no separate fit track.
//
// Invariant: the window's insets must not be clamped to 0 — a box partly outside the host
// is expressible only with negative insets, and clamping them compounded into a translation
// that left a band of detail surface stranded on screen. A transform has no inset to clamp,
// so the bug is unrepresentable here; `npm run hero:path` keeps the case.
// ---------------------------------------------------------------------------

/** Scales are divided by; a degenerate box must not produce a non-finite transform. */
const MIN_CONTAINER_SCALE = 1e-3;

function safeScale(value: number) {
  return value > MIN_CONTAINER_SCALE ? value : MIN_CONTAINER_SCALE;
}

/**
 * The window, as the pose of a host-sized box.
 *
 * Deliberately the flyer's own function: the container's outer transform *is*
 * `getHeroBoxTransform` with the host standing in for the base, so both halves of the
 * flight share one piece of arithmetic. Emit with `formatHeroTransform`.
 */
export function getHeroContainerPose(box: HeroRect, host: HeroRect): HeroBoxTransform {
  const pose = getHeroBoxTransform(host, box, host);
  return {
    x: pose.x,
    y: pose.y,
    scaleX: safeScale(pose.scaleX),
    scaleY: safeScale(pose.scaleY),
  };
}

/**
 * The counter-transform that **holds the destination still**: the window grows over a page that
 * is already at its final size and position, exactly as a theme switch's circular reveal grows
 * over a page that never moves.
 *
 * It is the exact inverse of the window's own transform, so the pair composes to the identity:
 * a block inside the window is painted where it will sit when the window is the whole screen,
 * and the window's edge is the only thing that travels. The earlier form scaled the content to
 * a *cover fit* (`max(sx, sy)`), which made the page ride the window — the header slid and grew
 * with the box — and needed the flight layer's separate counter to put the picture back in
 * screen space.
 *
 * Written componentwise on purpose: a single-axis `scaleY` keyframe beside a `scaleX` one is a
 * transform-list mismatch that drops WAAPI onto matrix interpolation.
 */
export function formatHeroContainerCompensator(pose: HeroBoxTransform) {
  return `scale(${1 / pose.scaleX}, ${1 / pose.scaleY}) translate(${-pose.x}px, ${-pose.y}px)`;
}

/**
 * The window's own corner, in its local space: **one circular value, divided by
 * `min(sx, sy)`, rounded up, capped.**
 *
 * Dividing by the smaller scale keeps both screen radii ≥ `R`, so the window's cut provably
 * contains the flyer's circular-`R` cut; dividing by `sx` alone under-cuts and leaves
 * surface slivers outside the picture's corner at take-off. Rounding **up** keeps the 1px
 * quantisation from landing half a step under `R` — same sliver. The cap is the browser's:
 * CSS rescales all radii when adjacent radii exceed a side, so capping here keeps our
 * arithmetic equal to what is painted; `npm run hero:path` asserts the cap never binds.
 */
export function formatHeroContainerRadius(
  pose: HeroBoxTransform,
  host: HeroRect,
  radius: number,
) {
  if (!(radius > 0)) return '0px';
  const wanted = radius / Math.min(pose.scaleX, pose.scaleY);
  const stepped = Math.ceil(wanted / HERO_MASK_RADIUS_STEP_PX) * HERO_MASK_RADIUS_STEP_PX;
  const ceiling = Math.max(0, Math.min(host.width, host.height) / 2);
  return `${Math.min(stepped, ceiling)}px`;
}

/**
 * The gallery's depth cue: **a scale, and nothing else** — a recede, not a displacement. A
 * translate slid the grid down the screen and pushed the top row out of the fold.
 *
 * Its origin must be the *viewport's* centre, not the element's: this node's box is the whole
 * scrollable content, several viewports tall, and an element-centred origin would fling the
 * visible rows. `buildBackgroundAnimation` writes `transform-origin` from the scroller's live
 * scroll offset once per leg — fixed for the length of a flight, since the gallery scroller
 * is hidden while the detail is open.
 *
 * Scaling *down* does not re-raster: the raster scale is taken from the maximum the animation
 * reaches, which is 1 here, so the shrink is a GPU downscale. Still wants a check on a phone
 * before being treated as free.
 *
 * `getHeroRectWithoutAncestorTransform` inverts whatever is here, so the flight still reads
 * honest card rects on press.
 */
export function getHeroBackgroundSinkTransform(amount: number) {
  if (amount <= 0.001) return 'none';
  return `scale(${1 - (1 - HERO_BACKGROUND_SINK_SCALE) * clamp01(amount)})`;
}

export function heroRectCenterDistance(from: HeroRect, to: HeroRect) {
  return Math.hypot(
    to.left + to.width / 2 - (from.left + from.width / 2),
    to.top + to.height / 2 - (from.top + from.height / 2),
    (to.width - from.width) / 2,
    (to.height - from.height) / 2,
  );
}

// ---------------------------------------------------------------------------
// The path — Flutter's `MaterialRectArcTween`
// ---------------------------------------------------------------------------

type HeroPoint = { x: number; y: number };

/**
 * One corner's path: a circular arc, or a straight line when the two points share a row
 * or a column. `_kOnAxisDelta` in `arc.dart`, and the reason a purely horizontal move
 * does not bow.
 */
type HeroPointArc = {
  from: HeroPoint;
  to: HeroPoint;
  center: HeroPoint | null;
  radius: number;
  beginAngle: number;
  endAngle: number;
};

const HERO_ON_AXIS_DELTA_PX = 2;

/**
 * `MaterialPointArcTween`, transcribed.
 *
 * The circle's centre sits on an axis-aligned line through *one* of the endpoints, so the
 * corner leaves along one axis and arrives along the other; which endpoint owns the tangent
 * depends on which delta is larger, so the arc bows away from the shorter side.
 *
 * `r = |AB|² / (2·Δshort)` bounds every sweep under 90°, so each edge is one coordinate of
 * one monotone arc for any pair of boxes — a property of the construction, not of a
 * particular pair.
 */
function createHeroPointArc(from: HeroPoint, to: HeroPoint): HeroPointArc {
  const deltaX = Math.abs(to.x - from.x);
  const deltaY = Math.abs(to.y - from.y);
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  const arc: HeroPointArc = {
    from,
    to,
    center: null,
    radius: 0,
    beginAngle: 0,
    endAngle: 0,
  };
  if (deltaX <= HERO_ON_AXIS_DELTA_PX || deltaY <= HERO_ON_AXIS_DELTA_PX) return arc;

  if (deltaX < deltaY) {
    arc.radius = (chord * chord) / deltaX / 2;
    arc.center = { x: to.x + arc.radius * Math.sign(from.x - to.x), y: to.y };
    const sweep = 2 * Math.asin(chord / (2 * arc.radius));
    if (from.x < to.x) {
      arc.beginAngle = sweep * Math.sign(from.y - to.y);
      arc.endAngle = 0;
    } else {
      arc.beginAngle = Math.PI + sweep * Math.sign(to.y - from.y);
      arc.endAngle = Math.PI;
    }
  } else {
    arc.radius = (chord * chord) / deltaY / 2;
    arc.center = { x: from.x, y: from.y + Math.sign(to.y - from.y) * arc.radius };
    const sweep = 2 * Math.asin(chord / (2 * arc.radius));
    if (from.y < to.y) {
      arc.beginAngle = -Math.PI / 2;
      arc.endAngle = arc.beginAngle + sweep * Math.sign(to.x - from.x);
    } else {
      arc.beginAngle = Math.PI / 2;
      arc.endAngle = arc.beginAngle + sweep * Math.sign(from.x - to.x);
    }
  }
  return arc;
}

/** Linear in the *angle*, so the corner's speed along its own arc is uniform in `t`. */
function heroPointArcAt(arc: HeroPointArc, t: number, bow: number): HeroPoint {
  if (t === 0) return arc.from;
  /* Before the start — a reversal whose spring leaves at the speed the flyer was caught at dips
     below zero before it recovers. The corner keeps going the way it was heading, along the
     path's own tangent: clamped to the endpoint, the dip was erased and the caught flyer stood
     still for the frames it should have spent carrying on (R10-007). */
  if (t < 0) {
    const tangent = heroPointArcTangent(arc, bow);
    return { x: arc.from.x + tangent.x * t, y: arc.from.y + tangent.y * t };
  }
  if (t >= 1) return arc.to;
  const chordX = arc.from.x + (arc.to.x - arc.from.x) * t;
  const chordY = arc.from.y + (arc.to.y - arc.from.y) * t;
  if (!arc.center || !(bow > 0)) return { x: chordX, y: chordY };
  const angle = arc.beginAngle + (arc.endAngle - arc.beginAngle) * t;
  const arcX = arc.center.x + Math.cos(angle) * arc.radius;
  const arcY = arc.center.y + Math.sin(angle) * arc.radius;
  return { x: chordX + (arcX - chordX) * bow, y: chordY + (arcY - chordY) * bow };
}

/** d/dt of `heroPointArcAt` at t = 0: the chord's direction bent toward the arc's by `bow`. */
function heroPointArcTangent(arc: HeroPointArc, bow: number): HeroPoint {
  const chordX = arc.to.x - arc.from.x;
  const chordY = arc.to.y - arc.from.y;
  if (!arc.center || !(bow > 0)) return { x: chordX, y: chordY };
  const sweep = arc.endAngle - arc.beginAngle;
  const arcX = -Math.sin(arc.beginAngle) * arc.radius * sweep;
  const arcY = Math.cos(arc.beginAngle) * arc.radius * sweep;
  return { x: chordX + (arcX - chordX) * bow, y: chordY + (arcY - chordY) * bow };
}

export type HeroRectArc = {
  lead: HeroPointArc;
  trail: HeroPointArc;
  /**
   * How much of each corner's own bow survives. 1 is Flutter's arc, 0 the chord.
   *
   * A convex combination of two same-direction monotone functions is monotone, so every
   * rendered edge stays monotone and lands exactly on its endpoint for **any** value —
   * endpoints are returned literally, and an on-axis corner has no centre so bow is a no-op
   * there without a special case. `solveHeroArcBow` fills it in.
   */
  bow: number;
};

const HERO_DIAGONALS = [
  ['topLeft', 'bottomRight'],
  ['bottomRight', 'topLeft'],
  ['topRight', 'bottomLeft'],
  ['bottomLeft', 'topRight'],
] as const;

function heroCorner(rect: HeroRect, id: (typeof HERO_DIAGONALS)[number][number]): HeroPoint {
  switch (id) {
    case 'topLeft':
      return { x: rect.left, y: rect.top };
    case 'topRight':
      return { x: rect.left + rect.width, y: rect.top };
    case 'bottomLeft':
      return { x: rect.left, y: rect.top + rect.height };
    default:
      return { x: rect.left + rect.width, y: rect.top + rect.height };
  }
}

/**
 * `MaterialRectArcTween` — **Flutter's Hero path, and the default one**: `MaterialApp`
 * installs it as `createRectTween` for every Material shared element.
 *
 * Not a curve applied to a rect lerp: it picks the diagonal best matching the travel and
 * sends **two opposite corners along two circular arcs**, rebuilding the rect from them each
 * frame. That structure is what keeps the two measured failure modes of the alternatives out:
 * arcing the centre while the size runs on plain progress sends an edge past its landing
 * column and back; pairing each axis onto its own quadratic puts the aspect ratio on the
 * leading axis — mid-flight shapes far more extreme than either endpoint. Two corners on two
 * arcs: each edge is one coordinate of one monotone arc.
 */
export function createHeroRectArc(from: HeroRect, to: HeroRect, bow: number): HeroRectArc {
  const centers: HeroPoint = {
    x: to.left + to.width / 2 - (from.left + from.width / 2),
    y: to.top + to.height / 2 - (from.top + from.height / 2),
  };
  let best: (typeof HERO_DIAGONALS)[number] = HERO_DIAGONALS[0];
  let bestSupport = -Infinity;
  for (const diagonal of HERO_DIAGONALS) {
    const a = heroCorner(from, diagonal[0]);
    const b = heroCorner(from, diagonal[1]);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(length > 0)) continue;
    const support = (centers.x * (b.x - a.x)) / length + (centers.y * (b.y - a.y)) / length;
    if (support > bestSupport) {
      bestSupport = support;
      best = diagonal;
    }
  }
  return {
    lead: createHeroPointArc(heroCorner(from, best[0]), heroCorner(to, best[0])),
    trail: createHeroPointArc(heroCorner(from, best[1]), heroCorner(to, best[1])),
    bow,
  };
}

/** `Rect.fromPoints`, i.e. normalised, so the two corners may cross without inverting. */
export function lerpHeroRectArc(arc: HeroRectArc, progress: number): HeroRect {
  const a = heroPointArcAt(arc.lead, progress, arc.bow);
  const b = heroPointArcAt(arc.trail, progress, arc.bow);
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return { left, top, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Convenience for call sites needing one sample rather than a whole track. The arc is a
 * property of the pair — build it once with `createHeroRectArc` in a loop.
 */
export function lerpHeroRect(
  from: HeroRect,
  to: HeroRect,
  progress: number,
  bow: number,
): HeroRect {
  return lerpHeroRectArc(createHeroRectArc(from, to, bow), progress);
}

/**
 * **One corner arc, sampled once for every bow.** `heroPointArcAt` is a convex combination of
 * the chord point and the circular-arc point, and only the combination depends on the bow — so
 * a solver that tries a hundred bows on one pair need not re-run the trigonometry, or allocate
 * a point, a hundred times. Every value comes from the very expressions `heroPointArcAt`
 * evaluates, in the same order, so a sampled answer is bit-identical to the direct one (the
 * endpoint literals included). Traced at 1× CPU, `solveHeroArcContainBows` alone was 10–40ms of
 * the press that builds an opening; it is now a few hundred microseconds.
 */
type HeroPointArcSamples = {
  /** Chord point per sample (the endpoint literal at t = 0 and t = 1). */
  chordX: Float64Array;
  chordY: Float64Array;
  /** Circle point per sample; only read where `bends` is set. */
  arcX: Float64Array;
  arcY: Float64Array;
  /** Whether the bow applies at the sample: an interior t on a corner that has a centre. */
  bends: Uint8Array;
};

function sampleHeroPointArc(arc: HeroPointArc, samples: number): HeroPointArcSamples {
  const count = samples + 1;
  const out: HeroPointArcSamples = {
    chordX: new Float64Array(count),
    chordY: new Float64Array(count),
    arcX: new Float64Array(count),
    arcY: new Float64Array(count),
    bends: new Uint8Array(count),
  };
  for (let index = 0; index < count; index += 1) {
    const t = index / samples;
    if (t === 0) {
      out.chordX[index] = arc.from.x;
      out.chordY[index] = arc.from.y;
      continue;
    }
    if (t >= 1) {
      out.chordX[index] = arc.to.x;
      out.chordY[index] = arc.to.y;
      continue;
    }
    out.chordX[index] = arc.from.x + (arc.to.x - arc.from.x) * t;
    out.chordY[index] = arc.from.y + (arc.to.y - arc.from.y) * t;
    if (!arc.center) continue;
    const angle = arc.beginAngle + (arc.endAngle - arc.beginAngle) * t;
    out.arcX[index] = arc.center.x + Math.cos(angle) * arc.radius;
    out.arcY[index] = arc.center.y + Math.sin(angle) * arc.radius;
    out.bends[index] = 1;
  }
  return out;
}

/** A `HeroRectArc` sampled once (`sampleHeroPointArc`); `rectAt` is `lerpHeroRectArc`. */
type HeroRectArcSamples = { lead: HeroPointArcSamples; trail: HeroPointArcSamples };

function sampleHeroRectArc(arc: HeroRectArc, samples: number): HeroRectArcSamples {
  return { lead: sampleHeroPointArc(arc.lead, samples), trail: sampleHeroPointArc(arc.trail, samples) };
}

/** Writes `lerpHeroRectArc(arc @ bow, index / samples)` into `out` (no allocation). */
function sampledRectAt(arc: HeroRectArcSamples, index: number, bow: number, out: HeroRect) {
  const { lead, trail } = arc;
  let ax = lead.chordX[index];
  let ay = lead.chordY[index];
  if (lead.bends[index] && bow > 0) {
    ax = ax + (lead.arcX[index] - ax) * bow;
    ay = ay + (lead.arcY[index] - ay) * bow;
  }
  let bx = trail.chordX[index];
  let by = trail.chordY[index];
  if (trail.bends[index] && bow > 0) {
    bx = bx + (trail.arcX[index] - bx) * bow;
    by = by + (trail.arcY[index] - by) * bow;
  }
  out.left = Math.min(ax, bx);
  out.top = Math.min(ay, by);
  out.width = Math.abs(bx - ax);
  out.height = Math.abs(by - ay);
  return out;
}

/**
 * The fraction of the flyer's frame that is on screen: `min(a / aBase, aBase / a)`. Falls out
 * of `getHeroCoverTransform` — the canvas is object-cover, so it reduces to a function of the
 * box's aspect alone. This is what to measure: it is what the viewer actually sees.
 */
export function heroArcCoverFraction(rect: HeroRect, baseAspect: number) {
  if (!(rect.height > 0) || !(baseAspect > 0)) return 1;
  const aspect = rect.width / rect.height;
  if (!(aspect > 0)) return 1;
  return Math.min(aspect / baseAspect, baseAspect / aspect);
}

/**
 * Largest backward step of the cover fraction, in fraction points.
 *
 * The direction comes from the endpoints, which lets one definition read both legs: opening
 * un-crops (defect = falling back from the running max), closing crops monotonically (defect
 * = rising from the running min). Invariant under the progress function: the value sequence
 * is the same under any monotone reparameterisation, so this file stays independent of
 * `progress.ts` and the solver's answer is good for either clock.
 */
export function heroArcCropRetrace(
  arc: HeroRectArc,
  baseAspect: number,
  samples = HERO_ARC_SOLVE_SAMPLES,
) {
  const first = heroArcCoverFraction(lerpHeroRectArc(arc, 0), baseAspect);
  const last = heroArcCoverFraction(lerpHeroRectArc(arc, 1), baseAspect);
  const rising = last >= first;
  let extreme = first;
  let worst = 0;
  for (let index = 1; index <= samples; index += 1) {
    const value = heroArcCoverFraction(lerpHeroRectArc(arc, index / samples), baseAspect);
    if (rising ? value > extreme : value < extreme) extreme = value;
    else worst = Math.max(worst, Math.abs(extreme - value));
  }
  return worst;
}

/**
 * How much of Flutter's arc this pair can afford.
 *
 * **The two standing checks are in tension and this is where it is resolved.** Two corner
 * arcs keep every edge monotone but change the box's aspect (the two arcs have different
 * radii, and the difference between their bows *is* a size change); arcing the centre and
 * lerping the size fixes the crop but drives an edge past its landing column. No construction
 * has neither, so the bow is the free parameter and the crop budget sets it.
 *
 * Bisection is exact, not heuristic: retrace at bow 0 is 0 by construction (the chord's aspect
 * is a Möbius function of progress, hence monotone), and retrace is monotone non-decreasing
 * in bow, so a feasible point always exists and the interval always brackets.
 *
 * Runs **once per leg** — `buildFlightKeyframes` and `buildContainerAnimations` take
 * `leg.bow` — not per frame.
 */
export function solveHeroArcBow(
  from: HeroRect,
  to: HeroRect,
  baseAspect: number,
  budget = HERO_ARC_CROP_BUDGET,
) {
  const arc = createHeroRectArc(from, to, 1);
  // Nothing bows: both corners are on an axis, so there is no arc to give back.
  if (!arc.lead.center && !arc.trail.center) return 1;
  // A degenerate box makes the criterion meaningless rather than false.
  if (Math.min(from.width, from.height, to.width, to.height) < 1) return 1;
  /* `heroArcCropRetrace` over one sampling of the pair, re-weighted per bow. */
  const samples = HERO_ARC_SOLVE_SAMPLES;
  const sampled = sampleHeroRectArc(arc, samples);
  const rect: HeroRect = { left: 0, top: 0, width: 0, height: 0 };
  const retrace = (bow: number) => {
    const first = heroArcCoverFraction(sampledRectAt(sampled, 0, bow, rect), baseAspect);
    const last = heroArcCoverFraction(sampledRectAt(sampled, samples, bow, rect), baseAspect);
    const rising = last >= first;
    let extreme = first;
    let worst = 0;
    for (let index = 1; index <= samples; index += 1) {
      const value = heroArcCoverFraction(sampledRectAt(sampled, index, bow, rect), baseAspect);
      if (rising ? value > extreme : value < extreme) extreme = value;
      else worst = Math.max(worst, Math.abs(extreme - value));
    }
    return worst;
  };
  if (retrace(1) <= budget) return 1;
  let low = 0;
  let high = 1;
  for (let step = 0; step < HERO_ARC_SOLVE_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (retrace(mid) <= budget) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * How far the inner rect pokes outside the outer one, in px, worst side. Exported so
 * `npm run hero:path` asserts containment against the same definition the solver uses.
 */
export function heroRectEscape(inner: HeroRect, outer: HeroRect) {
  return Math.max(
    outer.left - inner.left,
    outer.top - inner.top,
    inner.left + inner.width - (outer.left + outer.width),
    inner.top + inner.height - (outer.top + outer.height),
  );
}

/**
 * The two bows at which the flyer stays inside the container's window: **the window gives
 * way, not the picture.** The window is the arc at fault — its aspect excursion mid-leg runs
 * 24–59% past its own endpoints, so it is too flat and short to hold the picture, while the
 * picture's excursion is already capped by `solveHeroArcBow`. Allocating each criterion to
 * the arc it is about also puts the crop budget (a property of the picture) on the picture
 * and containment (a property of the frame) on the window.
 *
 * **The search scans and then refines; a bisection is wrong, not coarse.** Escape is not
 * monotone in the window's bow: flattening it past the feasible band makes the escape worse
 * again, because a flat window stops tracking the picture's aspect. On some pairs the
 * feasible band is an interior interval, which a bisection anchored at 0 would reject
 * wholesale, flattening the picture instead. So the window's bow is scanned downward from 1
 * and refined upward inside the bracketing cell (`HERO_ARC_CONTAIN_SCAN` gives a step fine
 * enough not to step over the narrowest band).
 *
 * **The picture only gives way if no window holds it at all**, and then against the
 * *friendliest* window rather than a flat one — the escape can be smaller at full bow than at
 * bow 0, so reducing against the flat window throws away arc for nothing. Pick the
 * minimum-escape window, keep bow 0 as the backstop (the only case where feasibility is
 * provable), then re-scan the window against the reduced picture. `npm run hero:path` fails
 * if that branch starts to fire.
 */
export function solveHeroArcContainBows(
  inner: { from: HeroRect; to: HeroRect; bow: number },
  outer: { from: HeroRect; to: HeroRect },
  /**
   * The visible region (the overlay's own box). An escape outside it is not a crop anybody
   * can see — window and picture are clipped together there — and noticing that is worth real
   * bow: a card far below the fold spends almost its whole early flight outside this box.
   */
  visible?: HeroRect,
  samples = HERO_ARC_SOLVE_SAMPLES,
) {
  const clip = (rect: HeroRect): HeroRect => {
    if (!visible) return rect;
    const left = Math.max(rect.left, visible.left);
    const top = Math.max(rect.top, visible.top);
    return {
      left,
      top,
      width: Math.max(0, Math.min(rect.left + rect.width, visible.left + visible.width) - left),
      height: Math.max(0, Math.min(rect.top + rect.height, visible.top + visible.height) - top),
    };
  };
  /**
   * The worst visible escape over the leg. `settle` stops at the first sample over the slack,
   * which is all a yes/no feasibility test needs; ranking windows against each other needs the
   * whole leg, or every infeasible window reports whichever early sample first crossed the line
   * and the "friendliest" choice below is made between truncated numbers (R10-012).
   */
  /* Both pairs sampled once; every bow below re-weights the same samples (see
     `sampleHeroPointArc` — the results are bit-identical to rebuilding the arcs). */
  const innerSamples = sampleHeroRectArc(createHeroRectArc(inner.from, inner.to, 1), samples);
  const outerSamples = sampleHeroRectArc(createHeroRectArc(outer.from, outer.to, 1), samples);
  const innerRect: HeroRect = { left: 0, top: 0, width: 0, height: 0 };
  const outerRect: HeroRect = { left: 0, top: 0, width: 0, height: 0 };
  const escapeAt = (innerBow: number, outerBow: number, settle = true) => {
    let worst = -Infinity;
    for (let index = 0; index <= samples; index += 1) {
      const seen = clip(sampledRectAt(innerSamples, index, innerBow, innerRect));
      if (!(seen.width > 0) || !(seen.height > 0)) continue;
      worst = Math.max(
        worst,
        heroRectEscape(seen, sampledRectAt(outerSamples, index, outerBow, outerRect)),
      );
      if (settle && worst > HERO_ARC_CONTAIN_SLACK) return worst;
    }
    return worst;
  };
  const holds = (innerBow: number, outerBow: number) =>
    escapeAt(innerBow, outerBow) <= HERO_ARC_CONTAIN_SLACK;
  /** Largest feasible outer bow, or null when no grid point holds. */
  const scanOuter = (innerBow: number) => {
    if (holds(innerBow, 1)) return 1;
    const step = 1 / HERO_ARC_CONTAIN_SCAN;
    for (let index = HERO_ARC_CONTAIN_SCAN - 1; index >= 0; index -= 1) {
      let low = index * step;
      if (!holds(innerBow, low)) continue;
      // The cell above `low` was already rejected, so this interval brackets the boundary.
      let high = low + step;
      for (let refine = 0; refine < HERO_ARC_SOLVE_STEPS; refine += 1) {
        const mid = (low + high) / 2;
        if (holds(innerBow, mid)) low = mid;
        else high = mid;
      }
      return low;
    }
    return null;
  };

  const found = scanOuter(inner.bow);
  if (found !== null) return { inner: inner.bow, outer: found };

  // No window holds the picture: find the friendliest window, then reduce the picture
  // against it, with bow 0 as the provable backstop.
  let outerBow = 0;
  let least = Infinity;
  for (let index = 0; index <= HERO_ARC_CONTAIN_SCAN; index += 1) {
    const bow = index / HERO_ARC_CONTAIN_SCAN;
    const escape = escapeAt(inner.bow, bow, false);
    if (escape < least) {
      least = escape;
      outerBow = bow;
    }
  }
  if (!holds(0, outerBow)) outerBow = 0;
  let low = 0;
  let high = inner.bow;
  for (let step = 0; step < HERO_ARC_SOLVE_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (holds(mid, outerBow)) low = mid;
    else high = mid;
  }
  return { inner: low, outer: scanOuter(low) ?? outerBow };
}

export function heroRectsEqual(a: HeroRect, b: HeroRect, epsilon: number) {
  return (
    Math.abs(a.top - b.top) < epsilon &&
    Math.abs(a.left - b.left) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}

/** Below this, a release is a let-go rather than a throw: the leg launches from rest. */
const MIN_RELEASE_SPEED_PX_PER_MS = 0.15;
/** A flick can be far faster than the leg can carry without overshooting the card. */
const MAX_RELEASE_SPEED_PX_PER_MS = 4;

/**
 * The finger's speed at release along the flight's own travel (centre to centre), in px/ms —
 * the speed a dismissed picture leaves at, the way Flutter hands a drag's fling velocity to the
 * route's controller. Only the component heading *towards* the card counts: a sideways or
 * backwards component would launch the picture away from where it is going.
 */
export function releaseSpeedAlong(
  velocity: { x: number; y: number } | undefined,
  from: HeroRect,
  to: HeroRect,
) {
  if (!velocity) return undefined;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const length = Math.hypot(dx, dy);
  if (length < 1) return undefined;
  const along = (velocity.x * dx + velocity.y * dy) / length;
  if (!Number.isFinite(along) || along < MIN_RELEASE_SPEED_PX_PER_MS) return undefined;
  return Math.min(along, MAX_RELEASE_SPEED_PX_PER_MS);
}
