'use client';

import { SPRING_MS } from '@/lib/spring';
import type { HeroProgressModel, ProgressCurve } from './progress';
import type { SpringResponse } from './spring';
import type { HeroDirection } from './types';

// ---------------------------------------------------------------------------
// DOM contracts
// ---------------------------------------------------------------------------

export const HERO_BACKGROUND_SELECTOR = '[data-image-detail-background]';
export const HERO_BACKGROUND_VISUAL_SELECTOR = '[data-image-detail-background-visual]';
/**
 * The container transform's window (`overflow: clip`, a circular radius, the leg's transform)
 * and the counter-scale under it, which makes the accumulated content transform isotropic.
 * Two nodes because the clipper's box has to be host-*shaped* — see `getHeroContainerPose`.
 */
export const HERO_CLIP_SELECTOR = '[data-image-detail-clip]';
export const HERO_UNCLIP_SELECTOR = '[data-image-detail-unclip]';
/**
 * The block the container transform cross-fades — the open child only, one property: opacity.
 * Deliberately not the overlay's content node: that is the pull gesture's transform target
 * (`--hero-pull-y`), and a CSS-variable translate and a WAAPI animation cannot compose on one
 * element — the animation wins. The node survived the fit's removal because the cross-fade and
 * the StatusView fill flex chain both still want it.
 */
export const HERO_CONTENT_SELECTOR = '[data-image-detail-crossfade]';
export const HERO_GALLERY_ANCHOR_SELECTOR = '[data-image-hero-gallery-anchor]';

export const HERO_REVEAL_SELECTOR = '[data-image-detail-reveal]';
export const HERO_SURFACE_SELECTOR = '[data-image-detail-surface]';

// ---------------------------------------------------------------------------
// Lifecycle timings
// ---------------------------------------------------------------------------

export const HERO_ROUTE_TIMEOUT_MS = 4000;

/**
 * Budget for acquiring the detail route *after the flight has landed*: far longer than
 * `HERO_ROUTE_TIMEOUT_MS`, because once the user is looking at the detail surface the
 * navigation has visibly happened and expiring would fly them back mid-read. Still bounded,
 * so a route that never publishes (deleted image, failed fetch) releases the session instead
 * of wedging the controller.
 */
export const HERO_DETAIL_ROUTE_TIMEOUT_MS = 30000;
export const SNAPSHOT_TTL = 2 * 60 * 1000;
/**
 * Browsers may keep a wheel/touch stream latched to its original scroller after the last
 * dispatched event. Keep the outgoing receiver alive until the stream has been quiet long
 * enough to make the next input a new native hit.
 */
export const HERO_INPUT_TRANSFER_QUIET_MS = 320;

/**
 * Overall ceiling on the input handover, after which it proceeds anyway. A trackpad's
 * inertial tail refreshes the stream faster than the quiet window opens (160ms against 320),
 * and the handoff phase withholds the detail body — without a ceiling a page could arrive
 * complete above the fold and empty below it. Losing 160ms of momentum is the smaller defect.
 * The budget is handed *to* the quiet wait rather than checked around it: a deadline outside
 * an `await` that never resolves is not a deadline.
 */
export const HERO_INPUT_TRANSFER_MAX_MS = 2000;

/**
 * Grace after the final media decodes before a still-silent preview is declared failed. The
 * preview is the visual authority while `heroActive`, so a decoded final image cannot stand
 * in for it — and a request that neither loads nor errors has no other terminal answer. One
 * step on M3's duration scale, and longer than the 250ms leg plus a frame, so it can never
 * fire while the flight is the thing being waited on.
 */
export const HERO_PREVIEW_FALLBACK_MS = 320;

// ---------------------------------------------------------------------------
// Media box geometry — the Stage landing target and the routed detail media
// MUST render pixel-identical boxes, so both derive from these.
// ---------------------------------------------------------------------------

export const HERO_MAX_HEIGHT_DVH = 80;

/**
 * What the media box loses to chrome *above the viewport's own edge*, in px, so a tall
 * picture fits the fold. `dvh` measures the viewport, but the media box lives inside the
 * detail overlay — shorter by the app bar, the dev banner and the host's margin — and sits
 * below the overlay offset, page padding and header; at a bare 80dvh the picture's bottom
 * was cropped, on portrait images only.
 *
 * 264 rather than the ~240 the chain sums to: the extra ~31px is margin for a header that
 * follows the type scale (it is one metadata line taller below the breakpoint). This is a
 * tuned constant, not a structural fix — the structural version caps against the overlay's
 * own height, whose chain is all definite, and is the right answer if this drifts again.
 */
export const HERO_MEDIA_VIEWPORT_CHROME_PX = 264;
export const HERO_MEDIA_BREAKPOINT_PX = 640;
/**
 * What the viewport loses to chrome before the media well begins, per breakpoint: the detail
 * page's own horizontal padding (16 / 32 total) plus the media well's (32 / 48 total),
 * measured through the overlay's chain — the one the geometry contract is written against.
 * The overlay renders outside the page shell, so the shell's padding is not in it; the
 * `/pic/[id]` page presentation *is*, and under-promises ~3% at wide viewports as a result.
 */
export const HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX = 48;
export const HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX = 80;
/**
 * The widest the media can ever paint, a property of the column, not the viewport:
 * 1024px column − 32px overlay gutter − 48px well padding = 944. Every srcset candidate
 * derives from this, so it must track the real layout.
 */
export const HERO_MEDIA_MAX_WIDTH_PX = 944;


// ---------------------------------------------------------------------------
// Flight motion
// ---------------------------------------------------------------------------

/**
 * **250ms, mirrored — M3's `medium1`.**
 *
 * Deliberately off the spring ladder: the ladder's entries are spring settle times, but a
 * from-rest leg flies `HERO_FLIGHT_CURVE` (a Bézier), so this is a *transition* whose length
 * is a step on M3's duration scale. Both neighbours read wrong (`defaultSpatial` 194ms
 * snatched, `slowSpatial` 296ms slack) and 500ms measured too slow. An interrupted leg
 * becomes a ζ0.9 spatial spring settling in 250ms — same shape, interpolated clock.
 *
 * The duration and the shape mirror; the *path* does not — `createHeroPointArc` mirrors the
 * arc rather than retracing it — and the rest of the direction asymmetry lives in the
 * thresholds (`HERO_CONTAINER_FADE` / `HERO_CONTAINER_SHAPE`), where Material keeps it.
 *
 * When a transition reads wrong, check what it is doing before changing how long it takes —
 * a duration is the cheapest knob and the least likely to be the fault.
 *
 * Couplings: 48 samples → 5.21ms per segment; the gallery card's 200ms chrome fade must
 * finish inside the leg; the reveal windows are progress fractions, so they cannot outlive
 * it. The swipe-down dismiss is deliberately not here — see `PULL_RELEASE_DURATION_MS`.
 */
export const HERO_DURATIONS: Record<HeroDirection, number> = {
  forward: 250,
  back: 250,
};


/**
 * The flight's shape: `Curves.fastOutSlowIn`, which is what Flutter's Hero flies — the
 * reverse curve is the same shape read backwards. A spring cannot take this shape: the curve
 * hangs back ~2.6% of the travel in its first tenth, and no ζ puts a from-rest spring's peak
 * velocity that late. It leaves and arrives exactly at rest (`y'(0) = y'(1) = 0`, asserted by
 * `npm run hero:path`).
 *
 * Spelled as an object with a `css` twin rather than only a string: sampled tracks need the
 * coefficients, two-keyframe tracks need the string, and deriving one from the other is what
 * stops them drifting.
 */
export const HERO_FLIGHT_CURVE: ProgressCurve = {
  x1: 0.4,
  y1: 0,
  x2: 0.2,
  y2: 1,
  css: 'cubic-bezier(0.4, 0, 0.2, 1)',
};

/** The shape a leg gets when it leaves from rest, which is every leg the user starts. */
export const HERO_FLIGHT_PROGRESS: Record<HeroDirection, HeroProgressModel> = {
  forward: { kind: 'curve', curve: HERO_FLIGHT_CURVE },
  back: { kind: 'curve', curve: HERO_FLIGHT_CURVE },
};

/**
 * The interruption spring, and only that: every leg that has to leave at a speed something is
 * *already* travelling at (a reversal, a mid-flight rebuild, a drag release) gets this
 * instead of the curve — a Bézier's launch slope is fixed by its own shape, while
 * `solveSpringVelocity` is exact in both damping regimes. ζ0.9 because a container transform
 * moves *and* resizes → the spatial family by the app's own rule.
 *
 * `rate` is ω in *normalised* time, so the shape is independent of the leg's length and a
 * reversal can pick its own duration without picking a different curve. `velocity: 0` is only
 * the from-rest default; `relaunch()` in `progress.ts` — the single place a launch velocity is
 * solved — overwrites it on every interrupted leg, which may then overshoot: a reversal dips
 * before it recovers.
 */
export const HERO_FLIGHT_RESPONSE: Record<HeroDirection, SpringResponse> = {
  forward: { rate: 5.13, velocity: 0, damping: 0.9 },
  back: { rate: 5.13, velocity: 0, damping: 0.9 },
};

/**
 * Material's container-transform thresholds — the whole of the direction asymmetry. The back
 * row holds the outgoing surface to 60%, so the plane stays fully there while the container
 * shrinks and hands over to the thumbnail late, instead of blinking out first.
 */
export const HERO_CONTAINER_FADE: Record<HeroDirection, { start: number; end: number }> = {
  forward: { start: 0, end: 0.25 },
  back: { start: 0.6, end: 0.9 },
};

/**
 * The *content's* windows — a deliberate divergence from Material's return thresholds, which
 * are tuned for card-to-card: held opaque that long, a full-screen article scales down and
 * flies into the card behind the picture. Back fades 0 → 0.6 so the copy is gone just as the
 * plane's fade starts — ending earlier left a blank shrinking rectangle for the rest of the
 * return. One object leaving, not two.
 */
export const HERO_CONTENT_FADE: Record<HeroDirection, { start: number; end: number }> = {
  forward: { start: 0.15, end: 0.85 },
  back: { start: 0, end: 0.6 },
};

/*
 * The forward row is a second deliberate divergence from Material's enter thresholds, and it
 * is the answer to "the flight looks stiff": at 0 → 0.25 every track finished within the
 * first ~98ms, so box, page and chrome arrived as one event. 0.15 → 0.85 lets the box lead
 * and the page follow — two events instead of one — spanning 55–155ms of the leg.
 */
/**
 * `MaterialContainerTransform`'s `shapeMask` thresholds, which let the corner resolve ahead
 * of the box. The flyer's own corner reads the same row in *both* directions, so picture and
 * container square off on one schedule. The enter row's 0.75 is also where the radius lead
 * (`1 / 0.75`) comes from — not a fitted number.
 */
export const HERO_CONTAINER_SHAPE: Record<HeroDirection, { start: number; end: number }> = {
  forward: { start: 0, end: 0.75 },
  back: { start: 0.3, end: 0.9 },
};
/**
 * One sample count for every track on a leg — the flyer's three, the mask, the fit, both
 * fades, the reveal staircase and the background sink. WAAPI interpolates between these
 * offsets at the display's refresh rate, so this is a fidelity constant, never scaled by
 * device class.
 *
 * 48 because the container's anisotropy is the binding constraint: WAAPI lerps the window's
 * `scale(sx, sy)` and the compensator's `scale(fx, fy)` independently, and that between-sample
 * error goes as the square of the spacing — 0.99% at 32 against 0.441% at 48, measured on the
 * real geometry matrix. 250/48 is 5.21ms per segment, inside a frame at 120Hz.
 */
export const HERO_PROGRESS_SAMPLES = 48;

/**
 * How many points of the picture's visible fraction the flight may hand back mid-air — the
 * price of the arc, and a 1:1 trade for the outer columns of a masonry grid: the card's aspect
 * *is* the picture's there, so any mid-flight aspect excursion retraces itself, and with two
 * corner arcs that excursion *is* the bow. Swept on the real wide grids, the outer columns are
 * budget-bound on every case and their peak deviation tracks the budget nearly linearly
 * (24% → 5–9%). `npm run hero:path` prints the per-leg table.
 */
export const HERO_ARC_CROP_BUDGET = 0.24;
/** Solver sampling for the excursion: 65 lands within a third of a point on an eight-point
 *  budget, once per leg. The residual is real, hence `HERO_ARC_CROP_TOLERANCE` and the
 *  401-point audit in `npm run hero:path`. */
export const HERO_ARC_SOLVE_SAMPLES = 65;
/**
 * Snap step for the container window's corner, in px, **rounded up**. Rounding up is
 * load-bearing, not tidy: the emitted radius is `R / min(sx, sy)`, and rounding down can put
 * the *screen* radius under `R`, leaving a sliver of surface outside the picture's own corner
 * at take-off (`formatHeroContainerRadius` has the containment argument). 4 is a multiple of
 * every step on the shape scale, so the snap is exact at both ends of a leg.
 */
export const HERO_MASK_RADIUS_STEP_PX = 4;
export const HERO_ARC_SOLVE_STEPS = 10;
/**
 * Grid points for the containment solve's scan, before it refines. Scanning rather than
 * bisecting: escape is **not monotone** in the window's bow — the feasible band can be an
 * interior interval — and 10 gives a 0.1 step against a narrowest measured band of 0.2, so
 * the scan cannot step over one.
 */
export const HERO_ARC_CONTAIN_SCAN = 10;

/**
 * How far the flyer may poke outside the container's window before a bow is reduced, in CSS
 * px. 1, not 0: both rects are floating-point interpolations of corner arcs, so a sub-pixel
 * escape is arithmetic rather than a crop, and 1 CSS px is half a device pixel at 2dpr.
 */
export const HERO_ARC_CONTAIN_SLACK = 1;
/** The sampling residual above, rounded up. Only `npm run hero:path` reads it. */
export const HERO_ARC_CROP_TOLERANCE = 0.005;

/**
 * The radius the flyer lands on — the detail media's own corner. The source (gallery card)
 * radius is measured from the DOM in flight.ts; the destination is only mounted mid-flight,
 * so it is pinned here. Must equal the 16px large-corner token in app/globals.css that
 * DetailImage/DetailVideo resolve, or the corner pops on arrival.
 */
export const HERO_TARGET_RADIUS_PX = 16;

/**
 * Reverse duration scales with how much of the trip is left to undo. The 90ms floor is for a
 * reversal caught late in a leg: at 250ms the ratio bottoms out at 0.35 (87.5ms), so the last
 * third of a leg clamps to 90.
 */
export const HERO_REVERSE_MIN_DURATION_MS = 90;
export const HERO_REVERSE_BASE_RATIO = 0.35;
export const HERO_REVERSE_TRAVEL_RATIO = 0.65;

/**
 * Depth cue on the gallery behind the detail surface: it **recedes** to 0.95, it does not
 * translate — a translate slid the grid down the screen and pushed the top row out of the
 * fold. The number is cited rather than picked: the captcha dialog over AuthModal recedes its
 * panel to 0.95. The timing is the other half — see `HERO_BACKGROUND_SINK_WINDOW`.
 */
export const HERO_BACKGROUND_SINK_SCALE = 0.95;

/**
 * When the sink happens, as a window on the leg's own travel: the depth cue must finish while
 * there is still gallery on screen to read it against (the window covers about half the host
 * by p 0.5), so 0 → 0.6 forward. The back row is mirrored, not shared: on the way home the
 * gallery is *revealed* rather than covered, so the cue must run late or it arrives before
 * there is anything to see it in.
 */
export const HERO_BACKGROUND_SINK_WINDOW: Record<
  HeroDirection,
  { start: number; end: number }
> = {
  forward: { start: 0, end: 0.6 },
  back: { start: 0.4, end: 1 },
};

// ---------------------------------------------------------------------------
// Content reveal cascade — chrome, then header, then body. The surface is driven
// by the flight's own clock now; see the note on `buildOverlayAnimations`.
// ---------------------------------------------------------------------------

/**
 * The reveal staircase as windows on the flight's own progress, not milliseconds: each step
 * starts and stops with the flyer and cannot drift when `HERO_DURATIONS` moves. (Absolute
 * delays overran the leg and left a residual transform on the node at the exact frame the
 * handoff swaps the Stage's copy for the route's.)
 *
 * `chrome` is unreachable, kept for symmetry: the cascade is a descendant query on the overlay
 * and both back buttons render as its *siblings* — their entrance is the `floatingBack`
 * branch of `buildOverlayAnimations`, which legitimately keeps its own clock.
 */
export const HERO_REVEAL_WINDOW: Record<
  'chrome' | 'header' | 'body' | 'default',
  { start: number; end: number }
> = {
  chrome: { start: 0, end: 0.926 },
  header: { start: 0.088, end: 0.986 },
  body: { start: 0.469, end: 1 },
  default: { start: 0.088, end: 0.986 },
};

/**
 * The one entrance still measured in milliseconds, and the one that should be: `floatingBack`
 * renders *outside* the overlay, so the container's parameters make no claim on it. 200ms on
 * `standard-decelerate` — the motion table's "small thing entering" row.
 *
 * Spelled as a literal like the file's other easings: it is handed to a Web Animations
 * `easing:` string, where a failed `var()` falls back to `ease` in silence.
 */
export const REVEAL_CONTENT_DURATION_MS = 200;

/**
 * How long a superseded flyer takes to fade out: a leave, not a transition — the motion
 * table's "leaves the screen" row, 200ms. A base value: `lib/hero/motion.ts` applies
 * `motionScale()` at the point of use, so it still honours the speed tiers.
 */
export const FLIGHT_RETIRE_MS = 200;

/**
 * Floor on the leg a mid-flight rebuild produces: a viewport change in the last few frames
 * would otherwise re-aim the box over too short a span to sample, reading as a jump rather
 * than a correction. 80ms is under a third of the flight's own clock, so the rebuild still
 * reads as continuing. A base value scaled at the point of use — this file is imported
 * directly by `scripts/heroPath.mjs` and cannot reach `lib/appearance` without pulling
 * `matchMedia` into a Node script.
 */
export const FLIGHT_REBUILD_MIN_MS = 80;
/** On the 4dp grid. header/body rise 24/40 so the motion is visible at these durations —
 *  under the 48px M3 uses for a full-screen enter; the reveal windows keep them from
 *  arriving together. */
export const REVEAL_DISTANCE_PX = {
  chrome: 8,
  header: 24,
  body: 40,
  default: 24,
} as const;
/* Spelled literally like every WAAPI easing string here: a failed `var()` falls back to
   `ease` in silence. The values are the token values — keep them in sync. */
export const REVEAL_EASING = 'cubic-bezier(0, 0, 0, 1)';
export const HIDE_EASING = 'cubic-bezier(0.3, 0, 0.8, 0.15)';
export const HIDE_DISTANCE_PX = 8;

// ---------------------------------------------------------------------------
// Pull-to-dismiss gesture
// ---------------------------------------------------------------------------

export const TOUCH_AXIS_LOCK_PX = 6;
export const DRAG_ACTIVATION_PX = 6;
export const DISMISS_DISTANCE_PX = 120;
export const DISMISS_MIN_FLING_DISTANCE_PX = 48;
export const DISMISS_VELOCITY_PX_PER_MS = 0.5;
export const DRAG_RESISTANCE_PX = 360;
export const BACKGROUND_REVEAL_DISTANCE_PX = 260;
export const SURFACE_FADE_DISTANCE_PX = 140;
export const RELEASE_SAMPLE_WINDOW_MS = 120;

/**
 * The swipe-down dismiss: no motion shape of its own. Both exits are the same container
 * transform running backwards, so both are ζ0.9 spatial (`HERO_FLIGHT_RESPONSE`); what
 * separates them is the clock and the launch velocity — a tap-close runs `HERO_DURATIONS.back`
 * from rest, while a release slides down the spatial ladder with the travel left
 * (`slowSpatial` at a full drag, floored at `fastSpatial` for a flick from near the top) and
 * starts at the speed the finger left.
 *
 * A spring settle time is the right unit here, unlike the flight's own clock: a release
 * genuinely *is* a spring — it continues a speed the hand put on the surface. Because `rate`
 * is normalised, the shape is identical at every duration in that band. `velocity: 0` is only
 * the from-rest default; `pull.ts` overwrites it with the measured fling speed on every
 * release, which is why a fast flick snaps home and a slow one sinks.
 */
export const PULL_RELEASE_DURATION_MS = SPRING_MS.slowSpatial;
export const PULL_RELEASE_MIN_DURATION_MS = SPRING_MS.fastSpatial;
export const PULL_RELEASE_RESPONSE: SpringResponse = {
  rate: 5.13,
  velocity: 0,
  damping: 0.9,
};

// ---------------------------------------------------------------------------
// Frame capture
// ---------------------------------------------------------------------------

/**
 * How many captured frames the LRU holds; memory is bounded separately by
 * `HERO_FRAME_CACHE_MAX_PIXELS`. 6, not fewer: at 4, scrolling past five warmed cards
 * guaranteed the next tap re-captured synchronously in the press handler — the mechanism
 * behind the press-time spike being intermittent rather than constant. The count is reachable
 * only while frames stay under ~442k pixels each; on larger captures the pixel budget evicts,
 * which is the correct priority since it is the thing protecting a phone.
 */
export const HERO_FRAME_CACHE_LIMIT = 6;
export const HERO_FRAME_MAX_DIMENSION = 1152;
export const HERO_FRAME_MAX_DPR = 1.875;

/**
 * Viewport changes below this many pixels are ignored. iOS reports continuous
 * `visualViewport` scroll while the address bar collapses; rebuilding the
 * flight on each of those events restarts the spring every frame.
 */
export const HERO_VIEWPORT_REBUILD_EPSILON_PX = 1;
