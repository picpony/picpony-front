'use client';

import { SPRING_MS } from '@/lib/spring';
import type { SpringResponse } from './spring';
import type { HeroDirection } from './types';

// ---------------------------------------------------------------------------
// DOM contracts
// ---------------------------------------------------------------------------

export const HERO_BACKGROUND_SELECTOR = '[data-image-detail-background]';
export const HERO_BACKGROUND_VISUAL_SELECTOR = '[data-image-detail-background-visual]';
/**
 * The full-width block the container transform's fit scales.
 *
 * Deliberately not `.image-detail-overlay-content`: that node is the pull gesture's own
 * transform target (`--hero-pull-y` in globals.css), and a CSS-variable translate and a WAAPI
 * scale cannot compose on one element — the animation wins. One node each, composing by
 * nesting, keeps a drag that starts mid-flight coherent.
 */
export const HERO_CONTENT_SELECTOR = '[data-image-detail-scale]';
export const HERO_GALLERY_ANCHOR_SELECTOR = '[data-image-hero-gallery-anchor]';

export const HERO_REVEAL_SELECTOR = '[data-image-detail-reveal]';
export const HERO_SURFACE_SELECTOR = '[data-image-detail-surface]';

// ---------------------------------------------------------------------------
// Lifecycle timings
// ---------------------------------------------------------------------------

export const HERO_ROUTE_TIMEOUT_MS = 4000;

/**
 * Budget for acquiring the detail route *after the flight has already landed*.
 *
 * Deliberately far longer than `HERO_ROUTE_TIMEOUT_MS`. Once the flyer has
 * landed the user is looking at the detail surface — the navigation has visibly
 * happened — so expiring here and reversing means the app spontaneously flies
 * back to the gallery while they are reading a loading skeleton. On a slow
 * connection that was reproducible every time.
 *
 * Still bounded rather than infinite: a route that genuinely never publishes
 * (a deleted image, a failed fetch with no error path) has to release the
 * session eventually instead of wedging the controller.
 */
export const HERO_DETAIL_ROUTE_TIMEOUT_MS = 30000;
export const SNAPSHOT_TTL = 2 * 60 * 1000;
/**
 * Browsers may keep a wheel/touch stream latched to its original scroller after
 * the last dispatched event. Keep the outgoing receiver alive until the stream
 * has been quiet long enough to make the next input a new native hit.
 */
export const HERO_INPUT_TRANSFER_QUIET_MS = 320;

// ---------------------------------------------------------------------------
// Media box geometry — the Stage landing target and the routed detail media
// MUST render pixel-identical boxes, so both derive from these.
// ---------------------------------------------------------------------------

export const HERO_MAX_HEIGHT_DVH = 80;
export const HERO_MEDIA_BREAKPOINT_PX = 640;
/**
 * What the viewport loses to chrome before the media well begins, per breakpoint.
 *
 * Measured through the overlay's own chain, which is the one the geometry contract is
 * written against: `.image-detail-page`'s `px-2 sm:px-4` (16 / 32 total) plus the media
 * well's `px-4 sm:px-6` (32 / 48 total). The overlay is a parallel route rendered outside
 * `[data-page-content]`, so the shell's `p-4 sm:p-6` is not in it.
 *
 * The desktop figure read **128**, which is what the chain came to before
 * `HERO_MEDIA_MAX_WIDTH_PX` was corrected from 1248 to 944 — it double-counted the shell
 * gutter that the overlay does not have. Between 640 and ~1104 CSS px the viewport term is
 * the binding one, so the estimate was 48px short there and `sizes` asked for a smaller
 * candidate than the element paints.
 *
 * The `page` presentation (`/pic/[id]` on a cold load) *is* inside the shell, so its chain
 * is 96 / 64 and its cap is 976. One model cannot describe both; this one describes the
 * overlay, and the difference costs the page presentation a 3% under-promise at wide
 * viewports. Unifying the two chains means moving the overlay's gutter outside its
 * `max-w-5xl` in both `PicDetail` and `HeroStage` in one commit.
 */
export const HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX = 48;
export const HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX = 80;
/**
 * The widest the media can ever paint, and it is a property of the column rather than of the
 * viewport: `max-w-5xl` (1024) − the overlay gutter `px-2 sm:px-4` (32) − the media well's
 * `px-4 sm:px-6` (48) = 944.
 *
 * It read 1248, which is not a width anything in this app has, so the `sizes` attribute
 * promised the browser a box 32% wider than the element paints at 1920 and
 * `getHeroMediaRenderedWidth` picked its srcset candidate against the same figure.
 * `getHeroMediaStyle` was always right because it clamps by `100%`.
 */
export const HERO_MEDIA_MAX_WIDTH_PX = 944;


// ---------------------------------------------------------------------------
// Flight motion
// ---------------------------------------------------------------------------

/**
 * **296ms, mirrored — `slowSpatial` both ways, which is Flutter's arrangement.**
 *
 * Flutter's Hero has no duration of its own: `_HeroFlight` rides the route's animation, so
 * a push and a pop are the *same* animation played forwards and backwards, one duration and
 * one curve (`Curves.fastOutSlowIn`). Compose says the same from the other end —
 * `SharedTransitionDefaults.BoundsTransform` is a single spring with no direction argument.
 * `slowSpatial` (296ms) is this app's nearest tier to the 300ms that Flutter's older default
 * page transition ran, and the ladder is where a motion this size belongs.
 *
 * Three wrong answers came before it and the sequence is the point:
 *
 * - 296/166, from `NavigationDrawer.kt` — but a drawer *leaves* where this *returns*.
 * - 500/400, which are `MaterialContainerTransform`'s real durations
 *   (`entering ? motionDurationLong2 : motionDurationMedium4`, and not the "300ms either
 *   way" this file claimed before that). Correct citation, wrong subject: that is Android's
 *   *activity-level* transform, a gesture that happens once per app launch. 500ms measured
 *   as too slow to live with here.
 * - 296/194, taking that 500:400 asymmetry down to the nearest tiers. The open was right and
 *   the return read as snatched — 194ms is `defaultSpatial`, the tier for a switch handle,
 *   and this is a full-screen box collapsing to a thumbnail.
 *
 * So the asymmetry is gone and the direction difference lives entirely in
 * `HERO_CONTAINER_FADE` / `HERO_CONTAINER_SHAPE`, which is where Material keeps it too.
 *
 * Three couplings the length has to respect, all checked:
 * - `HERO_FLIGHT_SAMPLES` is 24 per leg, so 296ms is 12.3ms per segment — under one frame,
 *   which is what keeps the compositor's linear interpolation between samples invisible.
 *   At 500 it was 21ms, i.e. the curve's fastest region was being flattened across 1.3
 *   frames.
 * - The gallery card's chrome fades on a 200ms CSS transition (`globals.css`), which has to
 *   finish inside the flight. 200 < 296.
 * - The reveal staircase's last step lands at 300ms (`REVEAL_DELAY_MS.body` + 200), so the
 *   picture and the text stop moving together.
 *
 * The swipe-down dismiss is deliberately not here: see `PULL_RELEASE_DURATION_MS`.
 */
export const HERO_DURATIONS: Record<HeroDirection, number> = {
  forward: SPRING_MS.slowSpatial,
  back: SPRING_MS.slowSpatial,
};


/**
 * The flight's shape — **one of the app's four, not a fitted curve.**
 *
 * **ζ0.9, the spatial family, and the round trip through ζ1.0 is the argument for it.**
 * The app's own rule for picking a family is what is changing: *spatial* is "it moves or
 * resizes", *effects* is "it fades or recolours, and must not overshoot". A container
 * transform moves **and** resizes, so it is spatial by that rule, and the flight is the
 * largest spatial motion in the app.
 *
 * It was moved to ζ1.0 on the strength of Compose's default —
 * `SharedTransitionDefaults.BoundsTransform` is `spring(dampingRatio = DampingRatioNoBouncy)`
 * — and that citation is real but it is not about aesthetics: Compose picks a spring for a
 * shared element because a shared element must be *interruptible*, and it picks the
 * no-bouncy ratio as a safe default for arbitrary user content. `MaterialContainerTransform`
 * on Views, which is the same object with a fixed choreography, does not use a spring at all
 * — it uses `motionEasingEmphasizedInterpolator`, and `emphasized` hangs back before it
 * runs. Within this app's four shapes, the one that hangs back is ζ0.9.
 *
 * The difference is not subtle, per tenth of the leg:
 *
 *     ζ1.0 rate 6.65   14.5 24.2 21.1 15.3 10.1 6.4 3.9 2.3 1.3 0.8   peak 2nd tenth, 31:1
 *     ζ0.9 rate 5.13    9.8 19.2 19.7 16.6 12.6 8.9 5.9 3.7 2.2 1.3   peak 3rd tenth, 15:1
 *
 * ζ1.0 puts 14.5% of the travel in its first tenth and its fastest tenth carries 31× its
 * last: it starts abruptly and then crawls. ζ0.9 starts at 9.8%, peaks a tenth later, and
 * halves that ratio — a leg that reads as having mass rather than as a step response.
 *
 * **And it does not overshoot inside the leg.** The objection this replaces was that ζ0.9's
 * monotonicity is "a property of where the window stops rather than of the motion". Both
 * halves of that are now checked rather than argued: the raw spring's first peak is at
 * `π/ω_d` = 1.40 in normalised time, past the end of any leg, and `springProgress`
 * normalises by `raw(1)`, so `p` is monotone on [0, 1] and lands on exactly 1 — swept at
 * 200 points, `max = 1.00000`, `p(1) = 1.00000`. An *interrupted* leg re-solves from a
 * measured velocity and can then overshoot, which is true, deliberate, and the same
 * behaviour `PULL_RELEASE_RESPONSE` has always had: a reversal launched with a negative
 * velocity dips before it recovers, and that dip is the catch.
 *
 * A side effect worth having: the flight and the drag release are now the same shape
 * (ζ0.9, rate 5.13) and differ only in duration, so the two ways of leaving a picture stop
 * disagreeing about what kind of object it is.
 *
 * `rate` is ω in *normalised* time — the physical natural frequency times the leg's
 * duration — so the shape is independent of how long the leg runs, and within one family
 * that product is a constant:
 *
 *     ζ0.9 spatial   √300 × 0.296 = √700 × 0.194 = 5.13
 *     ζ1.0 effects   √1600 × 0.166 = √800 × 0.235 = 6.64
 *
 * which is why `HERO_DURATIONS` can be re-timed without touching this, and why both legs
 * can share one shape while running different clocks. Measured against the token springs
 * the app ships, the ζ0.9 row above matches `StandardMotionTokens` `DefaultSpatial`
 * (9.7 19.0 19.5 16.5 12.5 8.8 5.8 3.7 2.2 1.3) to within 0.2 of a point.
 *
 * **It leaves from rest.** This read `{ rate: 7.0, velocity: 0.9 }` forward and
 * `{ rate: 7.4, velocity: 1.05 }` back, i.e. the flyer was already travelling at the
 * whole flight's average speed in its first frame, and its fastest tenth then carried
 * 46x (forward) and 64x (back) what its last one did. That is the one-sided profile
 * this codebase spent three passes removing from the navigation drawer, and the hero
 * was the last place still doing it. A spring's whole virtue is that it leaves *and*
 * arrives at rest.
 *
 * `velocity` is still the interruption mechanism: a reversal, a resize or a drag
 * release re-solves it from the measured speed via `springVelocityFromSpeed`, and that
 * solver is exact in both damping regimes. 0 is only the from-rest launch.
 */
export const HERO_FLIGHT_RESPONSE: Record<HeroDirection, SpringResponse> = {
  forward: { rate: 5.13, velocity: 0, damping: 0.9 },
  back: { rate: 5.13, velocity: 0, damping: 0.9 },
};

/**
 * Material's container-transform thresholds, and the whole of the direction asymmetry.
 *
 * `MaterialContainerTransform.DEFAULT_ENTER_THRESHOLDS` / `DEFAULT_RETURN_THRESHOLDS` give the
 * incoming content's cross-fade `0 → 0.25` in and `0.60 → 0.90` back, and the shape mask
 * `0 → 0.75` in and `0.30 → 0.90` back. `open_container.dart` encodes the same intervals as
 * `TweenSequence` weights evaluated on linear time while the geometry runs on the curve.
 *
 * The return interval is the one that changes how the exit reads: holding the outgoing content
 * to 60% keeps the page fully there while the container shrinks, so the hand-off to the
 * thumbnail happens late. It used to fade from the first frame over a fixed 166ms, which made
 * the page leave and the picture travel read as two events.
 */
export const HERO_CONTAINER_FADE: Record<HeroDirection, { start: number; end: number }> = {
  forward: { start: 0, end: 0.25 },
  back: { start: 0.6, end: 0.9 },
};
/**
 * `MaterialContainerTransform`'s `shapeMask` thresholds, which are what let the corner
 * resolve ahead of the box. Taken out once so the mask's `clip-path` could be composited,
 * and put back when that bought no frames — see `formatHeroContainerClip`.
 *
 * `HERO_RADIUS_LEAD` is the enter row's reciprocal and drives the flyer's own corner, so the
 * picture and the container square off on the same schedule.
 */
export const HERO_CONTAINER_SHAPE: Record<HeroDirection, { start: number; end: number }> = {
  forward: { start: 0, end: 0.75 },
  back: { start: 0.3, end: 0.9 },
};
/** Sample count for the container clip / content scale tracks. */
export const HERO_CONTAINER_SAMPLES = 24;

/**
 * WAAPI interpolates between these fixed samples at the display refresh rate.
 * Denser than needed for visual fidelity and far cheaper than rebuilding a
 * 120fps table on every reverse.
 */
export const HERO_FLIGHT_SAMPLES: Record<HeroDirection, number> = {
  forward: 24,
  back: 24,
};

/**
 * Corner radius resolves ahead of position: the shape has already become the
 * destination's shape while the box is still travelling. Reads as deliberate
 * rather than as a rectangle that morphs on arrival.
 *
 * The value is `1 / 0.75`, the reciprocal of `MaterialContainerTransform`'s enter `shapeMask`
 * threshold (`ProgressThresholds(0f, 0.75f)`). It read 1.45, which finished the corner at 69%
 * for no stated reason.
 */
export const HERO_RADIUS_LEAD = 4 / 3;

/**
 * The radius the flyer lands on, i.e. the detail media's own corner. The source
 * (gallery card) radius is measured from the DOM in flight.ts, but the
 * destination is only mounted mid-flight, so it is pinned here.
 *
 * Must equal `--radius-lg` from app/globals.css in px — that is what
 * `rounded-lg` on DetailImage/DetailVideo resolves to. If the shape scale
 * moves, this moves with it or the corner pops on arrival.
 */
export const HERO_TARGET_RADIUS_PX = 16;

/* The five ballistic-lift constants that stood here are gone with the lift they fed — a
   gravity term, a chord-length term, two clamps and a per-direction scale, all in service
   of a parabola that made the picture sink onto its landing box after it had already
   arrived. The path and the reasoning are in `flight.ts`, above `evaluateLeg`. */

/**
 * Reverse duration scales with how much of the trip is left to undo.
 *
 * The 90ms floor has never bound: the ratio bottoms out at `HERO_REVERSE_BASE_RATIO`, so it
 * needs a leg under 90 / 0.35 ≈ 257ms to reach. At 296 both ways the shortest reverse is
 * 104ms and the floor stays dead — worth knowing before trusting the comment in `motion.ts`
 * that says an interrupted reverse can run this short.
 */
export const HERO_REVERSE_MIN_DURATION_MS = 90;
export const HERO_REVERSE_BASE_RATIO = 0.35;
export const HERO_REVERSE_TRAVEL_RATIO = 0.65;

/** Depth cue applied to the gallery behind the detail surface. */
export const HERO_BACKGROUND_SINK_Y_PX = 8;
export const HERO_BACKGROUND_SINK_SCALE_DELTA = 0.015;

// ---------------------------------------------------------------------------
// Content reveal cascade — chrome, then header, then body.
//
// The *surface* is no longer part of it. It had `REVEAL_SURFACE_DELAY_MS = 0` and
// `REVEAL_SURFACE_DURATION_MS = 270` against a 340ms flight, so the plane behind the
// picture finished arriving ~70ms before the picture did; it is driven by the flight's
// own sampled spring now, over the flight's own duration. See the note on
// `buildOverlayAnimations`. Both constants are gone rather than left unused, so
// nothing can reach for a second clock for it by accident.
// ---------------------------------------------------------------------------

/**
 * **200ms on `standard-decelerate`, and the pairing is the whole point.**
 *
 * It read 400ms on `emphasized-decelerate`, which is a correct pairing — that curve covers
 * 62% of its travel in the first tenth and only 400 gives it room, which is why the 285ms
 * version before it was over in 28ms and why `--animate-pop-in` and `--animate-fade-in`
 * were both fixed for the identical mismatch. What was wrong was the *row*: 400 +
 * `emphasized-decelerate` is the **page entering** row, and this staircase moves 8, 16 and
 * 24px. A 16px rise is a small thing entering, which is 200ms on `standard-decelerate`
 * (`EasingStandardDecelerateCubicBezier` = `cubic-bezier(0, 0, 0, 1)`, matching the app's
 * own `--ease-standard-decelerate`).
 *
 * The measurable consequence is that the opening now **stops moving all at once.** With
 * delays of 0/50/100 the last step ends at 300ms against a 296ms flight; at 400 + 150 it
 * ended at 550, so the text kept sliding for a quarter of a second after the picture had
 * landed — the same defect this section already records fixing for the surface plane, which
 * used to finish 70ms *before* the picture. One gesture, one clock, both ends.
 *
 * Spelled as a literal for the reason the file's other easings are: it is handed to a Web
 * Animations `easing:` string, where a failed `var()` falls back to `ease` in silence.
 */
export const REVEAL_CONTENT_DURATION_MS = 200;
/**
 * Steps on M3's 50-based scale, and they have to leave room for the duration inside the
 * leg: `body` + 200 = 300 against a 296ms flight. Were 50/100/150 against 400, i.e. 550.
 */
export const REVEAL_DELAY_MS = {
  chrome: 0,
  header: 50,
  body: 100,
  default: 50,
} as const;
/** On the 4dp grid. Were 10 / 16 / 22 — the same slip `REVEAL_SHIFT` was fixed for. */
export const REVEAL_DISTANCE_PX = {
  chrome: 8,
  header: 16,
  body: 24,
  default: 16,
} as const;
/* Were `cubic-bezier(0.22, 1, 0.36, 1)` and `cubic-bezier(0.4, 0, 1, 1)` —
   easeOutQuint and easeIn, neither of which is in the design system. The first
   is a near-miss for M3 decelerate; the second is Material *2*'s accelerate,
   which coasts through its whole second half and made the detail content
   dissolve rather than leave. */
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
 * **The swipe-down dismiss is its own motion — but no longer its own *shape*.**
 *
 * The distinction this used to draw was between families: a tap-to-close took the effects
 * shape because "a close is a dismissal and wants the critically damped one that simply
 * leaves", while a drag release took the spatial one because it continues something the hand
 * was already doing. `NavigationDrawer.kt` does exactly that — `FastEffects` to close,
 * `DefaultSpatial` to settle a drag.
 *
 * A drawer earns that split because closing it and flinging it shut are two different
 * *events*. The hero's two exits are not: both are the same container transform running
 * backwards, and one of them merely starts with a speed already on it. So both are ζ0.9
 * spatial now (`HERO_FLIGHT_RESPONSE`), and what still separates them is the clock and the
 * launch velocity:
 *
 * - a close runs `HERO_DURATIONS.back` (296ms) from rest;
 * - a release slides down the spatial ladder with how far it still has to travel — 296ms
 *   (slow) at a full drag, floored at 137ms (fast) for a flick from near the top — and
 *   starts at the speed the finger left.
 *
 * Because `rate` is normalised, the *shape* is identical at every duration in that
 * band — the release gets faster without getting a different curve, which is what a
 * fixed bezier could never give it. It read `{ rate: 7.2, velocity: 0.6 }` with a
 * 170ms floor, none of which was on a tier.
 *
 * `velocity` here is only the from-rest default; `pull.ts` overwrites it with the
 * measured fling speed on every release, which is why a fast flick snaps home and a
 * slow one sinks.
 */
export const PULL_RELEASE_DURATION_MS = SPRING_MS.slowSpatial;
export const PULL_RELEASE_MIN_DURATION_MS = SPRING_MS.fastSpatial;
export const PULL_RELEASE_RESPONSE: SpringResponse = {
  rate: 5.13,
  velocity: 0,
  damping: 0.9,
};
export const PULL_RELEASE_SAMPLES = 20;

// ---------------------------------------------------------------------------
// Frame capture
// ---------------------------------------------------------------------------

export const HERO_FRAME_CACHE_LIMIT = 4;
export const HERO_FRAME_MAX_DIMENSION = 1152;
export const HERO_FRAME_MAX_DPR = 1.875;

/**
 * Viewport changes below this many pixels are ignored. iOS reports continuous
 * `visualViewport` scroll while the address bar collapses; rebuilding the
 * flight on each of those events restarts the spring every frame.
 */
export const HERO_VIEWPORT_REBUILD_EPSILON_PX = 1;
