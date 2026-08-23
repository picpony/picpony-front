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
  /* Both terms of the height cap, which is what `MEDIA_MAX_HEIGHT` puts in the stylesheet — this
     read `HERO_MAX_HEIGHT_DVH` alone, so for a tall picture it returned a width the element never
     paints. At 1920x1080 with an 800x2000 image that was 346px against a painted 326: `sizes`
     promised a candidate 6% too wide, and anything measuring against this instead of against the DOM
     (the path harness, for one) placed the landing box 20px off. */
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
    /* The cap is the *smaller* of `HERO_MAX_HEIGHT_DVH` and what is left of the viewport once the
       chrome around the media is taken off — see `HERO_MEDIA_VIEWPORT_CHROME_PX`. Without the
       second term a portrait picture lands in a box whose bottom is below the overlay's, and the
       flight flies it there and gets clipped. */
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
  /* `HeroRect` rather than `HeroHost`, and only `left`/`top` are read: the container transform
     expresses its own window as the pose of a host-sized box, so it needs this function with a
     plain rect. `HeroHost extends HeroRect`, so every existing caller is unaffected. */
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
// One growing, clipping, rounded box with the destination content laid out at its
// final size and scaled to the box's current width. `MaterialContainerTransform`
// computes `currentEndBounds` from a `fitModeEvaluator` and masks it to the
// container; `open_container.dart` writes the same thing as
// `FittedBox(fit: BoxFit.fitWidth, alignment: Alignment.topLeft)` inside a `SizedBox`
// of the animated rect.
//
// **In DOM terms that is a composited `transform` on a clipping wrapper, and it used to
// be an animated `clip-path` on the overlay.** The swap is not a tuning change, and the
// reason is in Chromium's source rather than in a benchmark:
//
//   - `core/animation/compositor_animations.cc:79-84` lists the compositable properties.
//     `clip-path` is in that list only as a *native paint worklet* property, and the branch
//     at `:354-368` needs `RuntimeEnabledFeatures::CompositeClipPathAnimationEnabled()` and
//     a generator or it falls to `DefaultToUnsupportedProperty`. That feature is Finch-gated,
//     which is what made two recent Chromiums on one device disagree: one dropped most of the
//     transition, the other ran it on the main thread and froze while React rendered the route.
//   - `platform/graphics/compositing/property_tree_manager.cc:984-1035` — `ShaderBasedRRect`
//     returns `nullopt` for **any** clip node carrying a `clip-path`, animated or not, and
//     `:1183-1187` turns that into `RenderSurfaceReason::kClipPath`. Returning an rrect instead
//     gives `mask_filter_info` with `is_fast_rounded_corner` and no render surface at all.
//
// So the window is `overflow: clip` plus a circular `border-radius` on a host-sized node, and
// the pose below is what moves it. The content pair is:
//
//     clip:        translate3d(dx, dy, 0) scale(sx, sy)      // the window
//     compensator: scaleY(sx / sy)  or  scaleX(sy / sx)      // back to isotropic, at max(sx, sy)
//
// A point `p` in the host-sized space lands at `d + f*p` where `f = max(sx, sy)`, i.e. **the
// accumulated content transform is a uniform `scale(f)` with a top-left translate** — a `FittedBox`,
// with the *axis chosen per leg* the way `MaterialContainerTransform`'s `FIT_MODE_AUTO` chooses it.
// Fitting always to width leaves an unpainted band across the window whenever `sx < sy`, which is a
// measured artefact and not a theoretical one; `heroContainerFitScale` has the numbers. Either way
// the pair *is* the fit, which is why there is no separate fit track any more.
// `formatHeroContentTransform` and its `[data-image-detail-scale]` target are gone; the node
// survives as the content cross-fade's, under a name that says so.
//
// Two tombstones, because both were real and neither can recur:
//
//   - **The insets were clamped**, `Math.max(0, ...)` on all four sides, so a box partly outside
//     the host could not be expressed — and because `right`/`bottom` derived from the clamped
//     `left`/`top` the error compounded into a *translation*: the box kept its size and slid to
//     the host's edge. Reproduced by scrolling the gallery 260px and opening the featured
//     banner, whose rect is then `top: -116`: the closing mask ended at `inset(0 34 273 24)`
//     rather than `inset(-236 34 509 24)`, so its bottom edge stopped 236px below the thumbnail
//     and that band of detail surface stayed on screen. A transform has no inset to clamp, so
//     the bug is now unrepresentable rather than fixed. `npm run hero:path` keeps the case.
//   - **The corner was taken out once for a frame rate that did not materialise.** Measured in
//     isolation with a CDP screencast, best of three, a full-viewport `inset()`: no round 56fps,
//     fixed round 46, varying round 38. Removing it end to end moved the flight by *nothing*
//     (32-37fps either way). It is back, and on the new construction it is not even the same
//     trade: a circular `border-radius` is a `MaskFilterInfo`, so a change costs a paint-property
//     update on one node rather than a raster of the clipped subtree.
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
 * `getHeroBoxTransform` with the host standing in for the base, so the two halves of the
 * flight share one piece of arithmetic rather than paraphrasing each other. Emit it with
 * `formatHeroTransform`.
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
 * `MaterialContainerTransform` has this as `FIT_MODE_AUTO` and picks the axis per transition rather
 * than fixing it, and the reason is a defect you can watch. The window's aspect mid-leg runs between
 * the card's and the host's, while the content inside it is uniformly scaled and therefore always
 * has the host's — so fitting to width whenever `sx < sy` leaves a horizontal band of the window with
 * nothing painted in it. Measured in a browser at 1920x1080 on a 800x2000 picture, at p 0.4: window
 * 1234x866, content 1234x**728**, so **138px** of the window's bottom was transparent and you saw the
 * gallery through it — and because the flyer is contained by the *window* rather than by the paint, it
 * hung **111px** past the bottom of the white surface, over the grid. That is the "part of the bottom
 * is cut off, only on a wide desktop" report: the picture was not being cropped, the surface behind it
 * was ending early. It is wide-desktop-only because the band is `host.height * (sy - sx)` and a
 * portrait card against a landscape host is where the two scales separate — a phone's overlay is
 * nearly the picture's own shape, and a landscape card on a wide desktop matches the host's aspect to
 * within a few percent.
 *
 * Cover is the fix rather than painting the band, because the band is not the only thing wrong with it:
 * the content also has to *reach* the window's edge or the container is visibly not the thing that
 * grew. Fitting to the larger scale means the content is clipped on the other axis instead, which is
 * what `overflow: clip` is for and what Material means by masking the content to the container. What
 * gets clipped is the centred `max-w-5xl` column's outer margin, which is empty.
 *
 * `max` cannot flip mid-leg in practice: both scales rise to exactly 1 at p=1 from the same side of
 * each other, so the axis is decided by the card's aspect against the host's and then holds. At the
 * crossing point the two agree, so the compensator is continuous there even if it did.
 */
export function heroContainerFitScale({ scaleX, scaleY }: HeroBoxTransform) {
  return Math.max(scaleX, scaleY);
}

/**
 * The counter-scale that makes the accumulated content transform isotropic.
 *
 * One node, the window's child, with `transform-origin: 0 0`. Written as `scale(f/sx, f/sy)` so that
 * **the emitted function is the same shape whichever axis the fit takes** — one component is exactly
 * 1 and the other carries the lift. That is not cosmetic. A `scaleY(k)` keyframe next to a
 * `scaleX(k')` one is a transform-list mismatch, which drops WAAPI onto matrix interpolation for that
 * segment; and the window's aspect *does* excurse past the host's mid-leg (24-59% on the shipped
 * matrix), so the fit axis can genuinely change hands inside one leg. Emitting both components keeps
 * the interpolation componentwise and continuous through the crossing, where both are 1.
 */
export function formatHeroContainerCompensator(pose: HeroBoxTransform) {
  const fit = heroContainerFitScale(pose);
  return `scale(${fit / pose.scaleX}, ${fit / pose.scaleY})`;
}

/**
 * The exact inverse of the accumulated window transform, for a descendant that must stay in
 * screen space — which is the flight layer, and only on an opening leg.
 *
 * The plane's anchor cannot leave the scroller: `sizePlaneLayer` puts the layer at the scroll
 * offset captured at take-off, inside a node that scrolls with the content, and that is the whole
 * of why the flyer follows ordinary and inertial scrolling at zero per-frame cost. So the layer
 * gets the inverse instead. Solving `d + f*T(p) = p` gives `T(p) = (p - d)/f`, and CSS's
 * `scale(k) translate(a, b)` maps `p` to `k*(p + (a, b))`, so `k = 1/f` and `(a, b) = -d`, where
 * `f` is the accumulated content scale — `heroContainerFitScale`, not `scaleX`, since the fit axis
 * is chosen per leg.
 *
 * **Order matters and getting it backwards compiles.** `translate` before `scale` is a different
 * map and leaves the opening flyer up to `(1 - f)*|d|` out of place — about 100px on a phone.
 * `npm run hero:path` asserts the composition at the string level for that reason.
 *
 * There is deliberately no scroll term. With one, the flyer would hold still in screen space
 * while the landing target — which is inside the scaled subtree — moved by `f*delta`. Without
 * it, both move by `f*delta`, so the flyer tracks the visually scaled target for the whole leg
 * and 1:1 on arrival. Today's behaviour is the former: they separate mid-flight and only
 * reconverge at landing.
 */
export function formatHeroContainerCounter(pose: HeroBoxTransform) {
  const fit = heroContainerFitScale(pose);
  return `scale(${1 / fit}) translate(${-pose.x}px, ${-pose.y}px)`;
}

/**
 * The window's own corner, in its local space: **one circular value, rounded up, capped.**
 *
 * Circular is not a preference. `ui/gfx/geometry/rounded_corners_f.h` is four scalars, and
 * `ShaderBasedRRect` (`:998-1006`) rejects any corner whose radii differ per axis — so the
 * elliptical `Rx / Ry` form that would be exactly circular on screen costs a mask layer, giving
 * back the render surface this whole construction exists to avoid.
 *
 * Dividing by `min(sx, sy)` rather than by `sx` is what keeps the surface out of the picture's
 * corners. Both screen radii are then at least `R`, and for `a >= R` and `x >= 0`,
 * `(a - x)/a >= (R - x)/R`, so the window's corner cut provably contains the flyer's
 * circular-`R` cut: at progress 0 the window *is* the card and the opaque flyer covers it, so
 * the excess is invisible. Dividing by `sx` under-cuts vertically instead and leaves slivers of
 * `bg-surface` outside the picture's corner — at take-off, where the eye is.
 *
 * Rounding **up** is what makes the 4px quantisation safe: rounding to nearest can land the
 * screen radius up to half a step under `R`, which is the same sliver. The step stays at 4
 * because coarsening it is visibly wrong late in a leg — at 12, `R = 16` would be lifted to 24
 * while `sx` is near 1 — and because the payoff changed: with `is_fast_rounded_corner` a radius
 * change is a paint-property update on one node, so quantising buys frame reuse rather than
 * rescuing a subtree raster.
 *
 * The cap is the browser's. CSS scales *all* radii by one factor when adjacent radii exceed a
 * side, so an uncapped value would silently shrink and take the containment argument with it.
 * Capping here makes our arithmetic match what is painted, and `npm run hero:path` asserts the
 * cap never binds on the shipped matrix — so a card aspect extreme enough to need it surfaces as
 * a failing check rather than as a hairline nobody reports.
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
 * Screen rect to the un-transformed host-sized space, i.e. the inverse of the accumulated pair.
 *
 * `screen = boxOrigin + (local - hostOrigin)*f`, so `local = hostOrigin + (screen - boxOrigin)/f`.
 * Both axes divide by the same `f` because the accumulated map is isotropic — that is the property
 * the compensator exists to establish, and this function is where it pays for itself. `f` is
 * `heroContainerFitScale`, so this follows the fit axis rather than assuming width.
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
 * The gallery's depth cue: **a scale, and nothing else.**
 *
 * It was a translate, and a translate is the wrong verb. "下沉" is a recede, not a displacement —
 * asked for plainly, *it should not shift up or down, it should just sink* — and a translate is
 * exactly a shift: the grid slid 24px down the screen and the top row's cards left the fold. The app
 * already had the right gesture in one place, `AuthModal` shrinking its panel to `scale-95` when the
 * captcha dialog opens over it, so this is that gesture rather than a new one.
 *
 * Its origin has to be the *viewport's* centre, not the element's: this node is
 * `[data-image-detail-background-visual]`, whose box is the whole scrollable content and can be
 * several viewports tall, so scaling about its own centre would fling the visible rows. See
 * `buildBackgroundAnimation`, which writes `transform-origin` from the scroller's live scroll offset
 * once per leg — a scroll position is fixed for the length of a flight, because the gallery scroller
 * takes `data-scroll-hidden` while the detail is open.
 *
 * A translate was chosen originally to keep the layer off the raster path, and the note said a scale
 * "makes Chromium re-raster it". That is true of scaling *up*: `cc` picks the raster scale from the
 * maximum the animation reaches, and this animation's maximum is 1 — the identity it starts from — so
 * the existing raster stands and the shrink is a GPU downscale. What is left is a slight softening of
 * the grid while it is receding, which is what receding looks like. It still wants a check on a phone
 * before this is treated as free.
 *
 * `getHeroRectWithoutAncestorTransform` inverts whatever is here — full axis-aligned matrix, origin
 * read from the computed style — so the flight still reads honest card rects on press.
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
   * A convex combination of two functions that are monotone in the same direction, so every
   * rendered edge stays monotone and lands on exactly its endpoint for **any** value — the
   * endpoints are returned literally at `t ≤ 0` and `t ≥ 1`, and an on-axis corner has no
   * centre so bow is a no-op there without a special case. Blending the two corners
   * componentwise is the same thing as blending `left`/`top`/`width`/`height`, as long as the
   * corners do not cross, which `lerpHeroRectArc`'s normalisation covers anyway.
   *
   * `solveHeroArcBow` is what fills it in, and why it is not simply 1 is in that function.
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
 * Convenience for the call sites that need one sample rather than a whole track. The arc is
 * a property of the pair, so a loop should build it once with `createHeroRectArc` instead.
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
 * The fraction of the flyer's frame that is on screen: `min(a / aBase, aBase / a)`.
 *
 * Falls straight out of `getHeroCoverTransform`. The canvas is object-cover inside the box, so
 * `cover = max(w / bw, h / bh)` and the visible area is `(w · h) / (bw · cover · bh · cover)`,
 * which reduces to the expression above — **a function of the box's aspect alone**, and of
 * nothing else. Which is why the crop is the thing to measure rather than the aspect: it says
 * what the viewer actually sees.
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
 * **The direction comes from the endpoints**, which is what lets one definition read both legs:
 * an opening leg un-crops, so a defect is the fraction falling back from its running maximum,
 * and a closing leg crops monotonically all the way down to whatever the card's aspect allows,
 * so its defect is a *rise* from the running minimum. Measured against a running maximum in
 * both directions, every closing leg reports its entire legitimate travel as a fault.
 *
 * **Invariant under the progress function.** The value sequence is the same set traversed in
 * the same order under any monotone reparameterisation, so the largest backward step does not
 * depend on whether the leg runs the curve or a spring — which is what keeps this file
 * independent of `progress.ts` and makes the solver's answer good for either.
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
 * **The two standing checks are in tension, and this is where the tension is resolved.** Two
 * corner arcs keep every edge inside its own interval but change the box's aspect, because the
 * lead and trail arcs have different radii and sweeps and the difference between their bows
 * *is* a size change. Putting the aspect back on the lerp — Flutter's own
 * `MaterialRectCenterArcTween`, i.e. arcing the centre and lerping the size — fixes the crop
 * and drives an edge past its landing column instead: measured at 49px on a tile travelling
 * leftward across the grid, which is the 38px artefact this file's history already records.
 * There is no construction that has neither, so the bow is the free parameter and the crop
 * budget is what sets it.
 *
 * Bisection is exact rather than heuristic here: retrace at bow 0 is 0 by construction (the
 * chord's aspect is a Möbius function of progress, hence monotone), and retrace is monotone
 * non-decreasing in bow, so a feasible point always exists and the interval always brackets.
 *
 * Runs **once per leg**, not per frame — `buildFlightKeyframes` and `buildContainerAnimations`
 * take `leg.bow`. 10 steps over 33 samples measured at ~0.08ms, and the early-out at ~0.025ms.
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
 * The two bows at which the flyer stays inside the container's window: **the window gives way,
 * not the picture.**
 *
 * The defect is real and was measured in a browser. The window interpolates card → host and the
 * flyer card → media well, and `createHeroPointArc` puts each circle's centre on an axis through
 * whichever endpoint owns the larger delta — so the two bow differently, and for a portrait-ish
 * destination the flyer swings *outside* the window and the window clips it. Sampled on a 1440x900
 * viewport with a 1000x1300 image: the flyer's bottom edge was 4px past the window's at 110ms and
 * **28px past at 200ms**, which is the "part of the bottom is cut off when some images open"
 * report. Landscape destinations measure zero, which is why it was only *some* images.
 *
 * **Which arc pays was the whole question, and the first answer was the wrong one.** One shared
 * scalar looked like the principled choice — both arcs keep the same fraction of their own bow, so
 * they still bow together — and it turned the reported crop into a reported *flatness*: on the
 * three destination shapes where containment binds, the shared bow solved to **0.020 / 0.079 /
 * 0.233**, i.e. the picture flew a straight line. Measured as the flyer centre's peak deviation
 * from its own chord, those pairs ran 0.3% / 1.6% / 2.9% of the chord against 12–21% at full bow.
 * That is "the parabola is very weak, and only on some image sizes".
 *
 * Solving the *window* instead, with the picture at its own bow, gives 0.271 / 0.440 / 0.765 —
 * every pair on the shipped matrix keeps the full Flutter arc on the picture, and no pair gets a
 * flatter window than the shared scalar was already giving it. The reason it works is that the
 * window is the arc at fault: from a 240x240 card to a 1312x780 host its aspect excursion at full
 * bow is 24–59% past its own endpoints — mid-flight it is a far wider, flatter box than either end
 * — so it is too short to hold the picture. The flyer's excursion is capped at
 * `HERO_ARC_CROP_BUDGET` by `solveHeroArcBow`; the window never had such a bound, and this is it.
 *
 * The allocation also puts each criterion on the arc it is about. The crop budget is a property of
 * the *picture* (`heroArcCoverFraction` reads the canvas's box), and containment is a property of
 * the *frame*. Flattening the subject to fit a frame that is the one misbehaving is backwards.
 *
 * **The search scans rather than bisects, and that is not a refinement — a bisection finds nothing
 * on two of the thirteen shipped pairs.** Escape as a function of the *window's* bow is not
 * monotone. Measured, with the picture at its own bow, in px per tenth of window bow:
 *
 *     masonry below fold   13.0  3.3  0.0  0.0  0.0  4.3  12.5  21.9  31.7  41.8  52.1
 *     tile far right low   53.3 43.3 33.3 23.4 13.8  5.0   0.0   0.0   0.0   2.0  12.2
 *
 * The feasible band is an *interior interval* — flattening the window past it makes the escape
 * worse again, because a flat window is a plain corner-chord interpolation whose own aspect no
 * longer tracks the picture's. A bisection anchored at 0 therefore rejects the whole interval and
 * falls through to flattening the picture, which is the defect this function exists to remove: it
 * cost `tile far right low` its bow, 0.84 down to 0.20. So the window's bow is scanned downward
 * from 1 for the largest feasible grid point and then refined upward inside the one cell that is
 * known to bracket the boundary. The narrowest band on the matrix is 0.2 wide, against a grid step
 * of `1 / HERO_ARC_CONTAIN_SCAN`.
 *
 * **The picture only gives way if no window holds it at all**, and then against a flat window,
 * where feasibility is provable: both arcs collapse to chords, every edge is an affine
 * interpolation between the card's edge and its own destination's, and the well is inside the host
 * — so `lerp(card.b, well.b, p)` cannot exceed `lerp(card.b, host.b, p)`. That branch does not fire
 * anywhere on the shipped matrix and `npm run hero:path` fails if it starts to.
 */
export function solveHeroArcContainBows(
  inner: { from: HeroRect; to: HeroRect; bow: number },
  outer: { from: HeroRect; to: HeroRect },
  /**
   * The visible region, i.e. the overlay's own box. An escape outside it is not a crop anybody can
   * see — the overlay and `[data-image-detail-host]` are both `overflow: hidden` on the same box, so
   * the window and the picture are clipped together there — and refusing to notice that is worth
   * real bow: a card 488px below the fold spends almost its whole early flight outside this box.
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

  /* The picture has to give, and *which window it gives against* is worth getting right: the escape
     is not monotone in the window's bow, so the friendliest window is sometimes the full arc and
     sometimes a middle value. Measured on a 1920x1080 grid with a 1080x2560 picture opened from the
     bottom row — the case that found this branch — the escape runs 74.6px at window bow 0 down to
     63.1px at bow 1, so reducing the picture against a *flat* window (the only one where feasibility
     is provable) throws away most of its arc for nothing. Pick the minimum, keep bow 0 as the
     backstop, then re-scan the window against the reduced picture. */
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
