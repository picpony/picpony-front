'use client';

import type { CSSProperties } from 'react';
import type { PonyImage } from '@/lib/types/image';
import {
  HERO_ARC_CROP_BUDGET,
  HERO_ARC_CONTAIN_SCAN,
  HERO_ARC_CONTAIN_SLACK,
  HERO_ARC_SOLVE_SAMPLES,
  HERO_ARC_SOLVE_STEPS,
  HERO_BACKGROUND_SINK_SCALE,
  HERO_MASK_RADIUS_STEP_PX,
  HERO_MAX_HEIGHT_DVH,
  HERO_MEDIA_VIEWPORT_CHROME_PX,
  HERO_MEDIA_BREAKPOINT_PX,
  HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX,
  HERO_MEDIA_MAX_WIDTH_PX,
  HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX,
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

type HeroMediaDimensions = Pick<PonyImage, 'width' | 'height'>;

// ---------------------------------------------------------------------------
// Media box sizing — single source shared by the Stage landing target and the
// routed detail media. Both MUST render pixel-identical boxes or the handoff
// visibly shifts.
// ---------------------------------------------------------------------------

function getHeroMediaDimensions(image: HeroMediaDimensions) {
  const width = Math.max(1, image.width || 1);
  const height = Math.max(1, image.height || 1);
  return { width, height, aspectRatio: width / height };
}

export function getHeroMediaResponsiveSizes(image: HeroMediaDimensions) {
  const { width, aspectRatio } = getHeroMediaDimensions(image);
  const mobilePaddingRem = HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX / 16;
  const desktopPaddingRem = HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX / 16;
  return `(max-width: ${HERO_MEDIA_BREAKPOINT_PX - 1}px) min(calc(100vw - ${mobilePaddingRem}rem), ${width}px, calc(${HERO_MAX_HEIGHT_DVH}dvh * ${aspectRatio})), min(calc(100vw - ${desktopPaddingRem}rem), ${HERO_MEDIA_MAX_WIDTH_PX}px, ${width}px, calc(${HERO_MAX_HEIGHT_DVH}dvh * ${aspectRatio}))`;
}

export function getHeroMediaPreviewSizes() {
  return `(max-width: ${HERO_MEDIA_BREAKPOINT_PX - 1}px) 100vw, ${HERO_MEDIA_MAX_WIDTH_PX}px`;
}

export function getHeroMediaRenderedWidth(
  image: HeroMediaDimensions,
  viewport: { width: number; height: number },
) {
  const { width, aspectRatio } = getHeroMediaDimensions(image);
  const horizontalPadding =
    viewport.width < HERO_MEDIA_BREAKPOINT_PX
      ? HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX
      : HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX;
  // Both terms of the height cap — the same expression the stylesheet's cap uses. Omitting
  // the chrome term makes this return a width the element never paints, and anything
  // measuring against this instead of the DOM places the landing box off.
  const heightCap = Math.min(
    viewport.height * (HERO_MAX_HEIGHT_DVH / 100),
    viewport.height - HERO_MEDIA_VIEWPORT_CHROME_PX,
  );
  return Math.min(
    width,
    HERO_MEDIA_MAX_WIDTH_PX,
    Math.max(1, viewport.width - horizontalPadding),
    Math.max(1, heightCap * aspectRatio),
  );
}

/** The media box's height cap, as one CSS expression both presentations share. */
const MEDIA_MAX_HEIGHT =
  `min(${HERO_MAX_HEIGHT_DVH}dvh, calc(100dvh - ${HERO_MEDIA_VIEWPORT_CHROME_PX}px))`;

export function getHeroMediaStyle(image: HeroMediaDimensions): CSSProperties {
  const { width, height, aspectRatio } = getHeroMediaDimensions(image);
  return {
    aspectRatio: `${width} / ${height}`,
    // The cap is the *smaller* of 80dvh and the viewport minus the chrome around the media
    // (see `HERO_MEDIA_VIEWPORT_CHROME_PX`); without the second term a portrait picture
    // lands in a box whose bottom is below the overlay's, and the flight clips it.
    width: `min(100%, ${width}px, calc(${MEDIA_MAX_HEIGHT} * ${aspectRatio}))`,
    maxWidth: '100%',
    maxHeight: MEDIA_MAX_HEIGHT,
  };
}

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
 * The isotropic scale the content is fitted at: **`max(sx, sy)`, i.e. cover.**
 *
 * Fitting to width instead leaves an unpainted horizontal band across the window whenever
 * `sx < sy` — the window's aspect mid-leg runs between the card's and the host's while the
 * uniformly-scaled content always has the host's — and because the flyer is contained by the
 * window rather than by the paint, it hangs past the surface over the grid. Wide-desktop
 * only: that is where a portrait card meets a landscape host. Cover clips the content on the
 * other axis instead — what the empty outer margin of the column is for.
 *
 * `max` cannot flip mid-leg in practice: both scales rise to exactly 1 at p=1 from the same
 * side of each other, so the axis is decided by the card's aspect against the host's and
 * holds; at the crossing the two agree, so the compensator stays continuous.
 */
export function heroContainerFitScale({ scaleX, scaleY }: HeroBoxTransform) {
  return Math.max(scaleX, scaleY);
}

/**
 * The counter-scale that makes the accumulated content transform isotropic.
 *
 * Written as a two-component `scale(f/sx, f/sy)` with one component exactly 1 — load-bearing,
 * not cosmetic: a single-axis `scaleY` keyframe beside a `scaleX` one is a transform-list
 * mismatch that drops WAAPI onto matrix interpolation, and the fit axis *can* change hands
 * inside one leg. Componentwise emission keeps the interpolation continuous through the
 * crossing, where both components are 1.
 */
export function formatHeroContainerCompensator(pose: HeroBoxTransform) {
  const fit = heroContainerFitScale(pose);
  return `scale(${fit / pose.scaleX}, ${fit / pose.scaleY})`;
}

/**
 * The exact inverse of the accumulated window transform, for a descendant that must stay in
 * screen space — the flight layer, on an opening leg only.
 *
 * The plane's anchor cannot leave the scroller (`sizePlaneLayer` puts it at the take-off
 * scroll offset inside a node that scrolls with the content — that is why the flyer follows
 * scrolling at zero per-frame cost), so the layer carries the inverse instead. Solving
 * `d + f*T(p) = p` with CSS's `scale(k) translate(a, b)` = `k*(p + (a, b))` gives
 * `k = 1/f, (a, b) = -d`, `f` being the fit scale, not `scaleX`.
 *
 * **Order matters and getting it backwards compiles** — `translate` before `scale` is a
 * different map, ~100px out of place on a phone; `npm run hero:path` asserts the composition
 * at the string level.
 *
 * Deliberately no scroll term: the landing target is inside the scaled subtree, so both it
 * and the flyer move by `f·Δ` and track each other for the whole leg.
 */
export function formatHeroContainerCounter(pose: HeroBoxTransform) {
  const fit = heroContainerFitScale(pose);
  return `scale(${1 / fit}) translate(${-pose.x}px, ${-pose.y}px)`;
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
 * Screen rect to the un-transformed host-sized space, i.e. the inverse of the accumulated
 * pair: `local = hostOrigin + (screen - boxOrigin)/f`. Both axes divide by the same `f`
 * because the accumulated map is isotropic — the property the compensator exists to
 * establish; `f` is the fit scale, so this follows the fit axis rather than assuming width.
 */
export function unprojectHeroContainerRect(
  rect: HeroRect,
  box: HeroRect,
  host: HeroRect,
): HeroRect {
  const scale = safeScale(heroContainerFitScale(getHeroContainerPose(box, host)));
  return {
    left: host.left + (rect.left - box.left) / scale,
    top: host.top + (rect.top - box.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
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
  if (t <= 0) return arc.from;
  if (t >= 1) return arc.to;
  const chordX = arc.from.x + (arc.to.x - arc.from.x) * t;
  const chordY = arc.from.y + (arc.to.y - arc.from.y) * t;
  if (!arc.center || !(bow > 0)) return { x: chordX, y: chordY };
  const angle = arc.beginAngle + (arc.endAngle - arc.beginAngle) * t;
  const arcX = arc.center.x + Math.cos(angle) * arc.radius;
  const arcY = arc.center.y + Math.sin(angle) * arc.radius;
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
  if (heroArcCropRetrace(arc, baseAspect) <= budget) return 1;
  let low = 0;
  let high = 1;
  for (let step = 0; step < HERO_ARC_SOLVE_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (heroArcCropRetrace({ ...arc, bow: mid }, baseAspect) <= budget) low = mid;
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
  const escapeAt = (innerBow: number, outerBow: number) => {
    const innerArc = createHeroRectArc(inner.from, inner.to, innerBow);
    const outerArc = createHeroRectArc(outer.from, outer.to, outerBow);
    let worst = -Infinity;
    for (let index = 0; index <= samples; index += 1) {
      const progress = index / samples;
      const seen = clip(lerpHeroRectArc(innerArc, progress));
      if (!(seen.width > 0) || !(seen.height > 0)) continue;
      worst = Math.max(worst, heroRectEscape(seen, lerpHeroRectArc(outerArc, progress)));
      if (worst > HERO_ARC_CONTAIN_SLACK) return worst;
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
    const escape = escapeAt(inner.bow, bow);
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
