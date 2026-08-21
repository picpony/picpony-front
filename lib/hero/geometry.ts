'use client';

import type { CSSProperties } from 'react';
import type { PonyImage } from '@/lib/types/image';
import {
  HERO_BACKGROUND_SINK_Y_PX,
  HERO_BACKGROUND_SINK_SCALE_DELTA,
  HERO_MAX_HEIGHT_DVH,
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
  return Math.min(
    width,
    HERO_MEDIA_MAX_WIDTH_PX,
    Math.max(1, viewport.width - horizontalPadding),
    Math.max(1, viewport.height * (HERO_MAX_HEIGHT_DVH / 100) * aspectRatio),
  );
}

export function getHeroMediaStyle(image: HeroMediaDimensions): CSSProperties {
  const { width, height, aspectRatio } = getHeroMediaDimensions(image);
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, ${width}px, calc(${HERO_MAX_HEIGHT_DVH}dvh * ${aspectRatio}))`,
    maxWidth: '100%',
    maxHeight: `${HERO_MAX_HEIGHT_DVH}dvh`,
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
  host: HeroHost,
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
// One growing, clipping, rounded box with the destination content laid out at its
// final size and scaled to the box's current width. `MaterialContainerTransform`
// computes `currentEndBounds` from a `fitModeEvaluator` and masks it to the
// container; `open_container.dart` writes the same thing as
// `FittedBox(fit: BoxFit.fitWidth, alignment: Alignment.topLeft)` inside a `SizedBox`
// of the animated rect. These two functions are that pair in DOM terms: the mask is a
// `clip-path` on the overlay, the fit a transform on the content.
// ---------------------------------------------------------------------------

/**
 * The mask, in the host's own border-box coordinates.
 *
 * It carries Material's `shapeMask` corner, and the corner was taken out for a frame rate
 * that did not materialise. Worth recording, because the isolated benchmark is genuinely
 * damning and genuinely did not govern: with a CDP screencast on an otherwise idle page,
 * best of three, a full-viewport element measured `inset()` with no round at **56fps**, with
 * a fixed round at **46**, and with a varying round at **38** — Chromium composites the
 * first and repaints the whole clipped subtree for the last. Removing it end to end moved
 * the flight by **nothing** (32–37fps before and after), because the flight's ceiling is the
 * aggregate composite cost of two full-screen scenes rather than any one property. So the
 * corner is back: a visible Material threshold is not something to spend on a hypothesis.
 *
 * **The insets are not clamped, and that clamp was a bug you could watch.** They read
 * `Math.max(0, …)` on all four sides, so a box that is partly outside the host could not
 * be expressed — and because `right` and `bottom` are derived from the already-clamped
 * `left` and `top`, the error compounded into a *translation*: the box kept its size and
 * slid to the host's edge.
 *
 * Reproduced by scrolling the gallery down 260px and opening the featured banner, which
 * lives at the very top of the page and is therefore partly above the viewport by then.
 * On the way back the banner's rect is `top: −116`, and the closing mask ended at
 * `inset(0 34 273 24)` instead of `inset(-236 34 509 24)`: the top pinned to 0, the height
 * preserved, so the mask's bottom edge stopped **236px below the thumbnail it was
 * collapsing into** and that band of detail surface simply stayed on screen. Any source
 * scrolled past either edge has the same defect; the banner just makes it easy to hit,
 * being tall and at the top.
 *
 * Negative `inset()` values are valid CSS and Chromium honours them — verified with
 * `elementFromPoint` probes through a negative-inset clip: the shape extends past that
 * edge (so nothing is clipped there, which is what a box overflowing the host means) while
 * the other three sides clip normally.
 */
export function formatHeroContainerClip(box: HeroRect, host: HeroRect, radius: number) {
  const top = box.top - host.top;
  const left = box.left - host.left;
  const right = host.width - (left + box.width);
  const bottom = host.height - (top + box.height);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${Math.max(0, radius)}px)`;
}

/**
 * `BoxFit.fitWidth`, top-left aligned — so the content must carry `transform-origin: 0 0`.
 * Uniform scale, never per-axis: a page squashed on one axis is a different page, which is
 * why Flutter fits rather than stretches.
 */
export function formatHeroContentTransform(box: HeroRect, host: HeroRect) {
  const scale = host.width > 0 ? box.width / host.width : 1;
  return `translate3d(${box.left - host.left}px, ${box.top - host.top}px, 0) scale(${scale})`;
}

/**
 * The gallery's depth cue: 8px down and 1.5% in.
 *
 * The scale was removed once, for frames, and put back: cancelling the sink mid-flight
 * measured +5fps in a probe, but shipping the translate-only version moved the flight by
 * nothing (32–35fps either way) — the probe had cancelled the whole animation, layer
 * promotion included, so it was measuring something else. A scale on a composited layer
 * does make Chromium re-raster it, and this layer is the whole gallery; if the flight's
 * ceiling ever turns out to be raster rather than aggregate composite cost, this is the
 * first place to look. Until then it is 17px of shrink at the edges of a 1118px grid that
 * costs nothing measurable.
 */
export function getHeroBackgroundSinkTransform(amount: number) {
  // The visual is isolated in its own compositor layer, so the depth cue costs
  // no layout work.
  if (amount <= 0.001) return 'none';
  const clamped = clamp01(amount);
  return `translate3d(0, ${HERO_BACKGROUND_SINK_Y_PX * clamped}px, 0) scale(${1 - HERO_BACKGROUND_SINK_SCALE_DELTA * clamped})`;
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
 * arc is tangent to that axis there: the corner leaves along one axis and arrives along
 * the other. Which endpoint owns the tangent depends on which delta is larger, so the arc
 * always bows away from the shorter side rather than through it.
 *
 * The radius comes out of the chord and the shorter delta — `r = |AB|² / (2·Δshort)` — and
 * that is what bounds the sweep. In the `Δx < Δy` branch `|AB| > √2·Δx`, so
 * `r > |AB|/√2`, so `sweep = 2·asin(|AB| / 2r) < π/2`: **every corner arc turns through
 * less than a quarter circle, which is why it is monotone in both axes.** That is the
 * property the two earlier attempts at a curved path did not have, and it is a property of
 * the construction rather than of a particular pair of boxes.
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
function heroPointArcAt(arc: HeroPointArc, t: number): HeroPoint {
  if (t <= 0) return arc.from;
  if (t >= 1) return arc.to;
  if (!arc.center) {
    return {
      x: arc.from.x + (arc.to.x - arc.from.x) * t,
      y: arc.from.y + (arc.to.y - arc.from.y) * t,
    };
  }
  const angle = arc.beginAngle + (arc.endAngle - arc.beginAngle) * t;
  return {
    x: arc.center.x + Math.cos(angle) * arc.radius,
    y: arc.center.y + Math.sin(angle) * arc.radius,
  };
}

export type HeroRectArc = { lead: HeroPointArc; trail: HeroPointArc };

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
 * `MaterialRectArcTween` — **Flutter's Hero path, and the default one.** `MaterialApp`
 * installs `createRectTween: (a, b) => MaterialRectArcTween(a, b)`, so every Material
 * Flutter app's shared element flies this way unless a call site opts out.
 *
 * It is not a curve applied to a rect lerp. It picks the *diagonal* whose direction best
 * matches the travel — the dot product of the centre vector with each of the four ordered
 * corner-to-corner directions — and sends **those two opposite corners along two circular
 * arcs**, rebuilding the rect from them each frame. So the box's leading and trailing
 * corners each bow, together, in the same direction.
 *
 * That structure is what the two earlier attempts here got wrong, in both possible ways.
 * Arcing the *centre* while the size ran on the plain progress drove the left edge 38px
 * past its landing column and back, because the size term fought the position term.
 * Pairing each axis's whole extent onto its own quadratic fixed the edges and put the
 * aspect ratio on the leading axis instead — measured mid-flight at 2.95 against endpoints
 * of 2.0 and 1.78, a hard crop through a shape more extreme than either end. Two corners
 * on two arcs has neither failure: each edge is one coordinate of one monotone arc, and
 * the aspect is whatever the two corners jointly describe, which is close to the lerp
 * because both arcs bow the same way by construction.
 */
export function createHeroRectArc(from: HeroRect, to: HeroRect): HeroRectArc {
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
  };
}

/** `Rect.fromPoints`, i.e. normalised, so the two corners may cross without inverting. */
export function lerpHeroRectArc(arc: HeroRectArc, progress: number): HeroRect {
  const a = heroPointArcAt(arc.lead, progress);
  const b = heroPointArcAt(arc.trail, progress);
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return { left, top, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/**
 * Convenience for the call sites that need one sample rather than a whole track. The arc is
 * a property of the pair, so a loop should build it once with `createHeroRectArc` instead.
 */
export function lerpHeroRect(from: HeroRect, to: HeroRect, progress: number): HeroRect {
  return lerpHeroRectArc(createHeroRectArc(from, to), progress);
}

export function heroRectsEqual(a: HeroRect, b: HeroRect, epsilon: number) {
  return (
    Math.abs(a.top - b.top) < epsilon &&
    Math.abs(a.left - b.left) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}
