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
 * The container transform's window, and the counter-scale under it.
 *
 * The window is a host-sized box carrying `overflow: clip`, a circular `border-radius` and the
 * leg's `transform`; the counter-scale is what makes the accumulated content transform isotropic.
 * Two nodes rather than one because the clipper's box has to be host-*shaped* — see the block
 * above `getHeroContainerPose` for the algebra and for why this replaced a `clip-path`.
 */
export const HERO_CLIP_SELECTOR = '[data-image-detail-clip]';
export const HERO_UNCLIP_SELECTOR = '[data-image-detail-unclip]';
/**
 * The block the container transform cross-fades.
 *
 * Material's container transform fades the closed and the open *children*, never the container's
 * own `Material` — so this is the open child, and it is one property: opacity.
 *
 * Deliberately not `.image-detail-overlay-content`: that node is the pull gesture's own transform
 * target (`--hero-pull-y` in globals.css) and the `minHeight` lease's node, and a CSS-variable
 * translate and a WAAPI animation cannot compose on one element — the animation wins.
 *
 * It used to carry the *fit* as well, a `translate` plus a uniform `scale`, which is where its
 * `data-image-detail-scale` name and its `origin-top-left` came from. The fit is gone: the
 * accumulated transform of `[data-image-detail-clip]` and `[data-image-detail-unclip]` **is**
 * `BoxFit.fitWidth` against the host. The node stayed because the cross-fade and the
 * `StatusView fill` flex chain both still want it.
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

/**
 * Overall budget for the input handover, after which the handoff proceeds anyway.
 *
 * `HERO_INPUT_TRANSFER_QUIET_MS` is a *quiet* window, and a wheel stream refreshes
 * `wheelActive` every 160ms — so a trackpad's inertial tail delivers events closer
 * together than 320ms and the quiet window never opens. Without a ceiling the session
 * parks in `opening.handoff` for as long as the finger keeps the stream alive, and that
 * phase withholds the detail body and comments (`isPublicationQuiet`), so the page
 * arrives visibly complete above the fold and permanently empty below it. Opening a
 * picture right after a fling reproduces it with no error involved.
 *
 * Losing the tail of one stream is the smaller defect: it is 160ms of momentum against
 * a page that never finishes. The budget is handed *to* the quiet wait rather than checked
 * around it — a deadline outside an `await` that never resolves is not a deadline.
 */
export const HERO_INPUT_TRANSFER_MAX_MS = 2000;

/**
 * Grace after the final media decodes before a still-silent preview is declared failed.
 *
 * The handoff needs a paintable preview, and the preview is the visual authority while
 * `heroActive` — so a decoded final image cannot simply stand in for it, or the handoff
 * frame lands on a box whose visible layer has not painted. But a preview request that
 * neither loads nor errors has no other terminal answer, and one that 404s only has one
 * because `onError` was added; this covers both. One step on M3's duration scale, and
 * longer than the 250ms leg plus a frame, so it can never fire while the flight is the
 * thing being waited on.
 */
export const HERO_PREVIEW_FALLBACK_MS = 320;

// ---------------------------------------------------------------------------
// Media box geometry — the Stage landing target and the routed detail media
// MUST render pixel-identical boxes, so both derive from these.
// ---------------------------------------------------------------------------

export const HERO_MAX_HEIGHT_DVH = 80;

/**
 * What the media box loses to chrome *above the viewport's own edge*, in px, so that a tall
 * picture actually fits the fold.
 *
 * **This was a real crop and it took fake data plus a per-frame trace to find.** `dvh` measures
 * the viewport; the media box does not live in the viewport, it lives inside
 * `[data-image-detail-overlay]`, which is shorter by the app bar, the dev banner and the host's
 * `sm:m-3` — and inside that it sits below the overlay offset, the page padding and the header.
 * So `80dvh` plus its own chrome exceeded the space available: measured on a 1440x900 window with
 * an 800x2000 image, the media's bottom landed at 941 against an overlay bottom of 888, and the
 * flight flew the picture to that box and had its last **53px** clipped. It read as "part of the
 * bottom is cut off when some images open", and only portrait images had it, because only they
 * are tall enough for the cap to bind at all.
 *
 * The terms, all from `AppLayout` and the overlay's own chain: app bar 64, dev banner 44, host
 * margin 12 x 2, overlay offset 24, `.image-detail-page` padding 24, header ~48, media well
 * padding 8 + 16.
 *
 * **264 rather than the 240 those sum to, and the margin is the point.** Measured in a browser at
 * five viewports with the tallest fixture image, the chrome above the media is a stable 101px on a
 * desktop and 118 on a phone — the difference being `--image-detail-header-height`, which is two
 * metadata lines below `sm` and one above it. Because the overlay is `100dvh` minus a fixed 132,
 * the slack left by a 240 cap is a constant **7px** at every desktop height, which is not enough
 * margin for a header that follows the type scale: one step up in `--text-body-m` and the picture
 * is cropped again. 264 buys ~31px, which covers a metadata line.
 *
 * The class of bug is still open, and this is a tuned constant rather than a structural fix. The
 * structural version is to cap against the overlay's own height instead of the viewport's — the
 * chain from the scroller down is all definite, so a percentage would resolve — and it is the right
 * answer if this drifts again.
 */
export const HERO_MEDIA_VIEWPORT_CHROME_PX = 264;
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
 * **250ms, mirrored — M3's `medium1`, and off the spring ladder on purpose.**
 *
 * The two tiers either side of it were both tried and both wrong in the same session: `defaultSpatial`
 * (194ms) reads snatched and `slowSpatial` (296ms) reads slack. There is nothing between them on the
 * spring ladder, and that is the tell — **the ladder was never the right scale for this number.** A
 * from-rest leg flies `HERO_FLIGHT_CURVE`, a Bézier; the ladder's entries are *spring settle times*,
 * and the only spring here is the interruption model, whose `rate` is normalised so its shape is
 * independent of how long the leg runs (`HERO_FLIGHT_RESPONSE`). So the flight is a **transition**, its
 * shape is a curve, and its length is a step on M3's own duration scale — 50/100/150/200/250/300/…, of
 * which 250 is `medium1`. M3 pairs a container transform with `long2` (500) and this file already
 * records measuring that as too slow to live with here; 250 is the step that brackets the two the ear
 * rejected.
 *
 * One consequence to know rather than discover: an interrupted leg is now a ζ0.9 spatial spring that
 * settles in 250ms, which is a real member of that family but not one of its three named tiers. That is
 * fine and is not the hazard the "never split a shape from its duration" rule guards against — the
 * shape is still ζ0.9 spatial, `rate` still 5.13, and only the clock is interpolated.
 *
 * **The 194ms excursion is the useful part of the history.**
 * The argument for 194 was that the flight read slower than the rest of the app — component motion is
 * `defaultSpatial`, and a container transform that outlasts it by half again does not obviously belong
 * to the same system. What that missed is that the flight's *length* was never what made it read
 * slow: it was flat. The path was flying 2-5% of its chord (the crop budget and a shared containment
 * bow had eaten the arc), the content arrived with the box instead of following it, and the depth cue
 * peaked behind an opaque surface. Cutting 34% off the clock made a flat motion brief rather than a
 * curved motion quick, and once the arc, the choreography and the sink were fixed the same 194ms read
 * as snatched — which is what the previous version of this comment predicted in as many words: *if it
 * now reads snatched, the step above is where to go back to, and nothing else has to move with it.*
 * That held; nothing else moved.
 *
 * So the lesson is worth more than the number: **when a transition reads wrong, check what it is
 * doing before changing how long it takes.** A duration is the cheapest knob and the least likely to
 * be the fault.
 *
 * Couplings re-checked at 250: `HERO_PROGRESS_SAMPLES` is 48, so 250/48 is **5.21ms per segment**,
 * inside one frame at 120Hz and two at 240Hz; the gallery card's 200ms chrome fade finishes inside the
 * flight with 50ms to spare (at 194 it outlived it by 6ms); and `HERO_REVERSE_MIN_DURATION_MS`'s 90ms
 * floor is **reachable**, just — the shortest reverse is 250 x 0.35 = 87.5ms, so a reversal caught in
 * the last third of a leg clamps to 90. That is what the floor is for, and it was inert at 296.
 *
 * Flutter's Hero has no duration of its own: `_HeroFlight` rides the route's animation, so
 * a push and a pop are the same animation played forwards and backwards — one duration and
 * one curve, `Curves.fastOutSlowIn` with `fastOutSlowIn.flipped` as the reverse curve, which
 * is the same shape read backwards. Compose says the same from the other end —
 * `SharedTransitionDefaults.BoundsTransform` is a single spring with no direction argument.
 * `slowSpatial` (296ms) is this app's nearest tier to the 300ms that Flutter's page transition
 * runs, and the ladder is where a motion this size belongs.
 *
 * The *duration and the shape* mirror; **the path does not**, and that is worth stating
 * because the sentence above invites the opposite conclusion. `createHeroPointArc` puts the
 * circle's centre on an axis through whichever endpoint owns the larger delta, so swapping the
 * pair mirrors the arc rather than retracing it: measured on a masonry-tile pair, the forward
 * pose at `p` and the back pose at `1 − p` sit up to **170px** apart mid-flight. Flutter has
 * the identical property, since `MaterialApp` builds a fresh `MaterialRectArcTween(begin, end)`
 * per flight. Going out and coming back are the same gesture, not the same picture reversed.
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
 * - `HERO_PROGRESS_SAMPLES` is 32 per leg, so 296ms is 9.25ms per segment — under one frame
 *   at 60Hz and under two at 120Hz, which is what keeps the compositor's linear interpolation
 *   between samples invisible. At 500 with 24 samples it was 21ms, i.e. the curve's fastest
 *   region was being flattened across 1.3 frames.
 * - The gallery card's chrome fades on a 200ms CSS transition (`globals.css`), which has to
 *   finish inside the flight. 200 < 296.
 * - The reveal staircase is expressed as windows on this leg's own progress
 *   (`HERO_REVEAL_WINDOW`), so it cannot outlive the flight however this number moves. It
 *   used to be absolute milliseconds re-checked by hand against the duration in a comment.
 *
 * The swipe-down dismiss is deliberately not here: see `PULL_RELEASE_DURATION_MS`.
 */
export const HERO_DURATIONS: Record<HeroDirection, number> = {
  forward: 250,
  back: 250,
};


/**
 * **The flight's shape: `Curves.fastOutSlowIn`, which is what Flutter's Hero flies.**
 *
 * `_HeroFlightManifest.animation` wraps the route's animation in
 * `CurvedAnimation(curve: Curves.fastOutSlowIn, reverseCurve: Curves.fastOutSlowIn.flipped)`,
 * and `FlippedCurve` is `1 − curve(1 − t)`, so a pop presents the same profile as a push.
 * Per tenth of the leg:
 *
 *     fastOutSlowIn   2.6 10.8 23.3 24.6 16.2 10.0 6.2 3.7 1.9 0.6   peak 30%, half 35%, 41:1
 *     ζ0.9 spring     9.8 19.2 19.7 16.6 12.6  8.9 5.9 3.7 2.2 1.3   peak 20%, half 31%, 15:1
 *
 * The whole difference is the first fifth: the curve hangs back — 2.6% of the travel in its
 * first tenth against the spring's 9.8% — and then goes. That is what reads as one considered
 * motion rather than as a step response, and it is the recognisable thing about a Flutter
 * hero.
 *
 * **A spring cannot be given that shape, which is why this is a curve and not a tier.** A
 * spring released from rest has its peak velocity at `arccos(ζ)/ω_d`; normalised by settle
 * time that lands at 15–20% for every tier this app ships (ζ1.0 at 15%, ζ0.9 at 20%), and
 * *lowering* ζ moves it earlier rather than later, because a longer settle window stretches
 * the tail more than the head. So "almost still, then away" is not reachable by retuning ζ.
 *
 * What the previous ζ0.9 answer got right and this keeps: it leaves from rest and arrives at
 * rest. `y'(0) = 3·y1 = 0` and `y'(1) = 3·(1 − y2) = 0` exactly, both asserted by
 * `npm run hero:path`. Before either of them the constants read `{ rate: 7.0, velocity: 0.9 }`
 * forward and `{ rate: 7.4, velocity: 1.05 }` back — the flyer already travelling at the whole
 * flight's average speed in its first frame, fastest tenth carrying 46x (forward) and 64x
 * (back) what its last one did. That is the one-sided profile this codebase spent three passes
 * removing from the navigation drawer, and the hero was the last place still doing it.
 *
 * Spelled as an object with a `css` twin rather than only as a string, because the sampled
 * tracks need the coefficients and the two-keyframe tracks need the string, and one of those
 * being derived from the other is what stops them drifting.
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
 * **The interruption spring — and only that.** A from-rest leg flies `HERO_FLIGHT_CURVE`;
 * this is the response every leg that has to leave at a speed something is *already*
 * travelling at gets instead: a reversal, a mid-flight rebuild, a drag release. A cubic
 * Bézier cannot do that job — its launch slope is `y1/x1`, fixed by its own shape — while
 * `solveSpringVelocity` is exact in both damping regimes.
 *
 * **ζ0.9, the spatial family.** The app's rule for picking a family decides it: *spatial* is
 * "it moves or resizes", *effects* is "it fades or recolours, and must not overshoot". A
 * container transform moves **and** resizes. It was ζ1.0 for a while on the strength of
 * Compose's `SharedTransitionDefaults.BoundsTransform` being `DampingRatioNoBouncy` — a real
 * citation, but not an aesthetic one: Compose picks a spring for a shared element because a
 * shared element must be interruptible, and no-bouncy is a safe default for arbitrary user
 * content. Per tenth of the leg the two differ plainly:
 *
 *     ζ1.0 rate 6.65   14.5 24.2 21.1 15.3 10.1 6.4 3.9 2.3 1.3 0.8   peak 2nd tenth, 31:1
 *     ζ0.9 rate 5.13    9.8 19.2 19.7 16.6 12.6 8.9 5.9 3.7 2.2 1.3   peak 3rd tenth, 15:1
 *
 * `rate` is ω in *normalised* time — the physical natural frequency times the leg's duration —
 * so the shape is independent of how long the leg runs, and within one family that product is
 * a constant:
 *
 *     ζ0.9 spatial   √300 × 0.296 = √700 × 0.194 = 5.13
 *     ζ1.0 effects   √1600 × 0.166 = √800 × 0.235 = 6.64
 *
 * which is what lets a reversal pick its own duration without picking a different curve.
 * Measured against the token springs the app ships, the ζ0.9 row matches
 * `StandardMotionTokens` `DefaultSpatial` (9.7 19.0 19.5 16.5 12.5 8.8 5.8 3.7 2.2 1.3) to
 * within 0.2 of a point.
 *
 * `velocity: 0` here is only the from-rest default the solver starts from; `relaunch()` in
 * `progress.ts` overwrites it on every interrupted leg, and it is the single place that does.
 * An interrupted leg *can* then overshoot — a reversal launched with a negative velocity dips
 * before it recovers, and that dip is the catch.
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
 * The *content's* windows, which are not the plane's, and the back row is a divergence.
 *
 * Material's return threshold holds the outgoing view to 60% and then fades it over the next
 * 30%. Here the outgoing view is a full-screen article going home to a thumbnail, and holding it
 * opaque that long meant watching the heading, tags, description and comment list scale down and
 * fly into the card behind the picture — a second object making the same trip. So it leaves from
 * the first frame.
 *
 * **What it must not do is finish early and leave a gap.** At `0 → 0.25` the text was gone while
 * the box was still at 86% of its width, and the plane does not start leaving until 0.60 — so
 * for two thirds of the return the screen held a *blank* rectangle shrinking on its own, which
 * is the thing that reads as "the animation ended at four fifths and then something else
 * happened". Ending exactly where the plane's window starts is what closes that: the copy thins
 * out while the box does most of its shrinking, and the plane takes over the instant the copy is
 * gone. One object leaving, not two.
 */
export const HERO_CONTENT_FADE: Record<HeroDirection, { start: number; end: number }> = {
  forward: { start: 0.15, end: 0.85 },
  back: { start: 0, end: 0.6 },
};

/*
 * The forward row is a second, deliberate divergence from Material's enter thresholds, and it is
 * the answer to "the flight looks stiff".
 *
 * At `0 -> 0.25` the page was fully opaque by the time the box was a quarter of the way home —
 * which, on `fastOutSlowIn`, is **98ms of a 250ms leg**. Every other track finishes early too (the
 * corner by 0.75, the depth sink with the box), so the whole transition was one event: box, page and
 * chrome all arriving together, with nothing left but a 16px rise. That is what reads as monotone.
 * `0.15 -> 0.85` lets the box lead and the page follow it in — two events instead of one — and it
 * costs nothing structurally, because the window is opaque behind the content the whole way.
 *
 * Measured rather than assumed, since the curve's front-loading makes travel and time diverge: the
 * fade now spans p 0.15 to 0.85, which is t 0.22 to 0.62, i.e. **55ms to 155ms**.
 *
 * The path, for the record, was *not* where the whole of the stiffness was — but the sentence that
 * stood here said it was not where *any* of it was, and that was wrong, from a measurement taken on
 * the wrong pairs. Sampling the flyer's centre per frame in a browser gave 1.2-2.1% deviation from
 * its own chord across four aspect ratios, and the conclusion drawn was that
 * `MaterialRectArcTween`'s radius makes its arcs shallow by construction. It does not:
 * `r = |AB|^2 / (2 * shorter delta)` gives 4-21% of the chord at full bow on the same matrix. The
 * four pairs happened to be ones where the bow had already been solved away — by the crop budget on
 * two of them and by a *shared* containment bow on the others — so what was measured was the
 * solver's output being read as the construction's ceiling. Both levers moved once that was clear:
 * see `HERO_ARC_CROP_BUDGET` and `solveHeroArcContainBows`. The liveliness still needs the
 * choreography; it just is not only the choreography.
 */
/**
 * `MaterialContainerTransform`'s `shapeMask` thresholds, which are what let the corner
 * resolve ahead of the box. Taken out once so the window's clip could be composited, and put
 * back when that bought no frames — see the block above `getHeroContainerPose`, which also
 * records why the clip is a transform now and why that makes the corner cheap rather than free.
 *
 * The flyer's own corner reads the same row, so the picture and the container square off on one
 * schedule in **both** directions. It used to hold the enter row's reciprocal as a separate
 * constant and apply it either way, which meant a closing flight ran the two on different
 * windows; see the note where that constant used to live.
 */
export const HERO_CONTAINER_SHAPE: Record<HeroDirection, { start: number; end: number }> = {
  forward: { start: 0, end: 0.75 },
  back: { start: 0.3, end: 0.9 },
};
/**
 * One sample count for every track on a leg — the flyer's three, the mask, the fit, both
 * fades, the reveal staircase and the background sink. WAAPI interpolates between these fixed
 * offsets at the display's refresh rate, so it is a fidelity constant and never scaled by
 * device class.
 *
 * **48, and the binding constraint is not the curve.** The largest error a linear interpolation
 * between offsets makes, swept at 20 001 points:
 *
 *                          24 samples   32 samples
 *     HERO_FLIGHT_CURVE        0.332%       0.189%
 *     ζ0.9 spring, v = 0       0.512%       0.297%
 *     ζ0.9 spring, v = −0.5    0.609%       0.353%
 *
 * The spring is the harder curve to table and −0.5 is the launch velocity a reversal saturates to, so
 * the worst case is the reverse leg. 32 was chosen against that table and would still be enough for
 * it. What moved it to 48 is the container's *anisotropy*: WAAPI lerps `scale(sx, sy)` and the
 * compensator's `scale(fx, fy)` independently, so between two keyframes the accumulated content scale
 * is not isotropic, and the error goes as the square of the spacing — 0.99% at 32 against 0.441% at
 * 48, measured between the real keyframes on the real geometry matrix. 250/48 is 5.21ms per segment,
 * inside a frame at 120Hz. The cost is sixteen more keyframes on each of about ten tracks, i.e. ~480
 * formatted strings per leg instead of 320, measured under 0.15ms at launch.
 *
 * It was two constants, one for the flyer and one for the container, both 24 — and
 * `buildBackgroundAnimation` read neither, having its own literal, so the sink would have
 * silently forked off the mask's cached table the moment either moved.
 */
export const HERO_PROGRESS_SAMPLES = 48;

/**
 * Corner radius resolves ahead of position: the shape has already become the
 * destination's shape while the box is still travelling. Reads as deliberate
 * rather than as a rectangle that morphs on arrival.
 *
 * The value is `1 / 0.75`, the reciprocal of `MaterialContainerTransform`'s enter `shapeMask`
 * threshold (`ProgressThresholds(0f, 0.75f)`). It read 1.45, which finished the corner at 69%
 * for no stated reason.
 */
/* `HERO_RADIUS_LEAD` stood here at `4 / 3`, the reciprocal of the enter `shapeMask` threshold,
   and the flyer's corner used it in *both* directions — so on the way back the picture squared
   off over 0 → 0.75 while the container's mask ran `HERO_CONTAINER_SHAPE.back`'s 0.3 → 0.9,
   which is not what the comment beside it claimed. Both now read the same row of
   `HERO_CONTAINER_SHAPE`, and the constant is gone rather than left as a second way to say
   `1 / 0.75`. Note this is invisible today: `ImageCard` and `FeaturedBanner` both treat their
   thumbnail with `rounded-lg`, which is `HERO_TARGET_RADIUS_PX`, so the flyer's radius track
   interpolates 16 to 16 and has no visible effect in either direction. It is correct for the
   day the shape scale moves them apart, not a fix you can watch. */

/**
 * How many points of the picture's visible fraction the flight may hand back mid-air.
 *
 * The measured table on the current geometry matrix, at bow 1 — i.e. Flutter's arc, untouched
 * — as `npm run hero:path` prints it. Opening leg, then closing:
 *
 *     masonry mid-column   24.9%  13.9%      banner, in view       0.0%   0.0%
 *     masonry below fold   32.4%  25.9%      banner, above fold    0.0%   0.0%
 *     tile far right low   12.0%   0.0%      square to portrait    1.9%  10.7%
 *     tile top-left tall    0.0%   0.0%      portrait tile        10.2%  15.2%
 *     tall tile far left    0.0%   0.0%      square tile          29.4%  29.3%
 *     same row, sideways   26.0%  21.1%      phone tile           23.1%  15.4%
 *                                            phone tile, tall     17.3%  19.3%
 *
 * Half the realistic flights un-crop, re-crop by a quarter of the frame, and un-crop again
 * inside 300ms. Per decile on the masonry pair the visible fraction runs
 * `81 → 98 → 79 → 76 → 81 → 86 → 91 → 95 → 98 → 99 → 100` — the eye reads the 98 → 76, and
 * that is the whole of what "the flight is not coherent" turned out to mean.
 *
 * **24%, and the number is the price of the arc on a wide screen.** The measured constraint is not
 * the geometry, it is this budget: swept over the real 1920×1080 and 2560×1440 grids, the flights
 * from the two *outer* columns are budget-bound on every single case, and their peak deviation from
 * their own chord tracks the budget almost linearly —
 *
 *     budget          8%    12%    18%    24%    32%
 *     outer columns  ~2%   2.5-4.6%  3.8-7.0%  5.1-9.4%  5.9-12.3%
 *     middle columns       6.5-16.1%
 *
 * — which is exactly the "on a wide screen the two columns near the edges have too weak a parabola"
 * report. 24 doubles them and brings them into the middle columns' range.
 *
 * **Why the outer columns pay the most, and why this trade is 1:1 for them.** In a masonry grid the
 * card's aspect *is* the picture's, so the cover fraction is 1 at both ends of the flight and any
 * mid-flight aspect excursion is a pure there-and-back — the retrace equals the whole excursion. And
 * with two corner arcs the excursion *is* the bow: the lead and trail arcs have different radii, and
 * the difference between their bows is precisely a size change. So for the commonest geometry in the
 * app you cannot buy arc without buying pump; they are the same quantity measured two ways. The
 * construction that separates them is a centre arc with the size on the lerp, where a constant aspect
 * makes the retrace identically zero — measured, it is: 0.0% on all nineteen wide-screen pairs. It
 * was not taken because its own limiter, edge monotonicity, is harsher and less predictable: on the
 * same nineteen it lands between 0.3% and 16.7% and is *flatter* than the corner form on nine of
 * them. Two constructions selected per pair would beat both and is the open option.
 *
 * 24 is also, honestly, at the level that produced the original "the flight is not coherent" report
 * (24.9-32.4% at bow 1), and that attribution was never verified — the pump was the suspect, not the
 * convict. Nothing has been reported since 8 became 12. This constant is the whole revert.
 */
export const HERO_ARC_CROP_BUDGET = 0.24;
/**
 * How finely the solver samples the excursion, and how many bisection steps it takes.
 *
 * The excursion is smooth and single-peaked, so the sample count only decides how close the
 * solver's estimate is to a dense one. Measured against a 2001-point audit over the geometry
 * matrix, worst overshoot of the budget and cost per solve:
 *
 *      33 samples   0.96 points   0.062ms
 *      65 samples   0.33 points   0.098ms
 *     129 samples   0.22 points   0.202ms
 *     257 samples   0.10 points   0.404ms
 *
 * 65 for a third of a point on an eight-point budget, once per leg. The residual is real
 * rather than rounded away, which is why `HERO_ARC_CROP_TOLERANCE` exists and why
 * `npm run hero:path` audits at 401 points instead of trusting the solver's own view.
 */
export const HERO_ARC_SOLVE_SAMPLES = 65;
/**
 * The step the container window's corner is snapped to, in px, **rounded up**.
 *
 * Snapping means two adjacent samples often emit the same string, and an identical value on a
 * `linear` track is a frame with no paint-property change at all. 4 because every step on the
 * app's shape scale is a multiple of it, so the snap is exact at both ends of a leg — and
 * because coarsening it is visibly wrong late in a leg, where a 12px step would lift a 16px
 * corner to 24 while the window is nearly full size.
 *
 * Rounding up rather than to nearest is load-bearing, not tidy: the emitted radius is
 * `R / min(sx, sy)`, and rounding down can put the *screen* radius under `R`, which is a sliver
 * of `bg-surface` outside the picture's own corner at take-off. `formatHeroContainerRadius` has
 * the containment argument.
 */
export const HERO_MASK_RADIUS_STEP_PX = 4;
export const HERO_ARC_SOLVE_STEPS = 10;
/**
 * How many grid points the containment solve scans for the window's bow, before refining.
 *
 * A bisection would be wrong rather than coarse here: escape is **not monotone** in the window's
 * bow, and on two of the thirteen shipped pairs the feasible band is an interior interval — see the
 * measured rows on `solveHeroArcContainBows`. 10 gives a 0.1 step against a narrowest measured band
 * of 0.2, so the scan cannot step over one. It costs at most ten extra escape evaluations on a
 * solve that runs once per leg.
 */
export const HERO_ARC_CONTAIN_SCAN = 10;

/**
 * How far the flyer may poke outside the container's window before a bow is reduced, in CSS px.
 *
 * **One CSS pixel, and the proportional version of this was a mistake worth recording.** It was
 * briefly 3% of the flyer's shorter side, on the theory that buying containment with the bow was
 * what had flattened the path. Two measurements killed that: relaxing it moved the path's deviation
 * from its own chord by *nothing* on the pairs it was measured against, while the escape it
 * permitted went straight to the screen. On a tall image 3% of the short side is 7-8px, and all
 * three portrait fixtures came back cropped by exactly that: 8.5px at 0.56, 8.1 at 0.42, 7.4 at
 * 0.40, against zero for every landscape one. So the trade bought no curvature and cost the bug.
 *
 * The half of that diagnosis which held up is that the *slack* is not the lever; the half that did
 * not is "buying containment with the bow was not flattening the path" — it was, badly, just not on
 * the pairs that were sampled. `solveHeroArcContainBows` is where that was found and fixed, by
 * making the window pay instead of the picture.
 *
 * 1px rather than 0: both rects are floating-point interpolations of corner arcs, so a sub-pixel
 * escape is arithmetic rather than a crop, and 1 CSS px is half a device pixel at 2dpr.
 */
export const HERO_ARC_CONTAIN_SLACK = 1;
/** The sampling residual above, rounded up. Only `npm run hero:path` reads it. */
export const HERO_ARC_CROP_TOLERANCE = 0.005;

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

/**
 * Depth cue applied to the gallery behind the detail surface: **it recedes to 95%.**
 *
 * It was a translate — 8px down, then 24 — and a translate is the wrong verb. A sink is a recede, not
 * a displacement: a translate slid the grid down the screen and pushed the top row out of the fold,
 * which is a shift with the depth read into it rather than depth. The app already had the right
 * gesture in exactly one place — `AuthModal` shrinks its own panel to `scale-95` on
 * `spring-default-spatial` when the captcha dialog opens over it — so this is 0.95, that number,
 * cited rather than picked.
 *
 * **The magnitude was never the reason it read as nothing, though; the timing was.** The cue tracked
 * the leg 1:1, so it reached full depth exactly when the window had grown over the whole host and
 * there was nothing left to see it against — measured in a browser, the grid was 5.3px down at 155ms
 * of a 194ms leg — the length it ran at then — and 8px down at 310ms, behind an opaque surface. A cue whose peak is occluded is a
 * cue that does not exist. `HERO_BACKGROUND_SINK_WINDOW` is that half of the fix.
 *
 * `getHeroBackgroundSinkTransform` has why a shrink does not cost what the old note claimed a scale
 * would, and where the transform origin comes from.
 */
export const HERO_BACKGROUND_SINK_SCALE = 0.95;

/**
 * When the sink happens, as a window on the leg's own travel.
 *
 * The gallery is being covered by the window as the leg runs, so the depth cue has to finish while
 * there is still gallery on screen to read it against — which is the same argument
 * `MaterialContainerTransform` makes for every one of its own thresholds, and it is why this is a
 * window rather than the whole leg. At the shipped geometry the window covers roughly a quarter of
 * the host by p 0.3 and half by p 0.5, so 0.45 spends the cue while about 60% of the grid is still
 * visible.
 *
 * 0.6 rather than 0.45, which was the first answer and ended too early — the recede was over while the
 * box was still visibly growing, so the two halves of one gesture stopped at different times. Later
 * still is not free: the window has covered most of the host by 0.75, and a cue that finishes behind it
 * is the defect this window exists to fix.
 *
 * The return row is the mirror, not the same numbers: on the way home the gallery is *revealed* as
 * the window shrinks, so it has to come back late or it arrives before there is anything to see it
 * in. Same shape as `HERO_CONTAINER_FADE`, for the same reason.
 */
export const HERO_BACKGROUND_SINK_WINDOW: Record<
  HeroDirection,
  { start: number; end: number }
> = {
  forward: { start: 0, end: 0.6 },
  back: { start: 0.4, end: 1 },
};

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
 * **The staircase, as windows on the flight's own progress rather than as milliseconds.**
 *
 * It ran `REVEAL_CONTENT_DURATION_MS` (200) on `standard-decelerate` behind delays of
 * 0 / 50 / 100, and both halves of that were a problem. The delays had to be re-checked
 * against the leg by hand — this file carried the arithmetic in a comment, and the comment
 * said "the last step lands at 300ms" against a 296ms flight, so the body's window actually
 * ended at 1.0135 of the leg and left a residual transform on the node at the exact frame the
 * handoff swaps the Stage's copy for the route's. And the curve was a second shape inside one
 * gesture: a positional rise is spatial by the app's own family rule, so it belongs on the
 * thing the box is already doing rather than on a transition-table bezier.
 *
 * The values are today's timing translated into travel, not new timing: `p(50/296) = 0.088`,
 * `p(250/296) = 0.986`, `p(100/296) = 0.469`. So each step still starts and stops within a
 * millisecond of where it did, the body now ends exactly with the flyer instead of 4ms after
 * it, and none of it can drift when `HERO_DURATIONS` moves.
 *
 * `chrome` is unreachable and kept for symmetry: the cascade is a descendant query on the
 * overlay and both back buttons render as its *siblings*, so no element in the app carries
 * `data-image-detail-reveal="chrome"`. Their entrance is the `floatingBack` branch of
 * `buildOverlayAnimations`, which legitimately keeps its own clock.
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
 * The one entrance that is still measured in milliseconds, and the one that should be.
 *
 * `floatingBack` renders *outside* the overlay, so the container mask never reaches it and the
 * container's parameter has no claim on it — it is a control appearing beside the surface
 * rather than a block inside the box. 200ms on `standard-decelerate` is the motion table's
 * "a small thing entering" row, and its 8px rise is exactly that.
 *
 * Spelled as a literal for the reason the file's other easings are: it is handed to a Web
 * Animations `easing:` string, where a failed `var()` falls back to `ease` in silence.
 */
export const REVEAL_CONTENT_DURATION_MS = 200;

/**
 * How long a superseded flyer takes to fade out.
 *
 * A new flight has already taken the screen when this runs, so it is a leave rather than a
 * transition: the motion table's "leaves the screen" row, 200ms. It was a default parameter
 * value written as a bare `200` at the one call site that omits the argument, which is the
 * shape a duration should never take — nothing scaled it, so at 缓慢 the retiring flyer
 * finished before the flight replacing it had started moving.
 */
export const FLIGHT_RETIRE_MS = 200;

/**
 * Floor on the leg a mid-flight rebuild produces.
 *
 * A viewport change in the last few frames of a flight would otherwise re-aim the box over a
 * span too short to sample — `HERO_PROGRESS_SAMPLES` divides whatever it is given — and the
 * result is a jump rather than a correction. 80ms is under a third of the flight's own clock,
 * so the rebuild still reads as continuing rather than as restarting.
 *
 * Like every other figure here it is a *base* value: `lib/hero/motion.ts` multiplies by
 * `motionScale()` at the point of use, because this file is imported directly by
 * `scripts/heroPath.mjs` and cannot reach `lib/appearance` without pulling `matchMedia` into
 * a Node script.
 */
export const FLIGHT_REBUILD_MIN_MS = 80;
/** On the 4dp grid. Were 10 / 16 / 22 — the same slip `REVEAL_SHIFT` was fixed for. */
export const REVEAL_DISTANCE_PX = {
  chrome: 8,
  /* 24 and 40 rather than 16 and 24. At these durations a 16px rise over most of the leg is a fraction of
     a pixel per frame — present in the code and absent from the screen, which is half of why the
     entrance read as flat. These are still under the 48px M3 uses for a full-screen enter, and the
     staircase's own windows keep them from arriving together. */
  header: 24,
  body: 40,
  default: 24,
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
 * - a close runs `HERO_DURATIONS.back` (250ms) from rest;
 * - a release slides down the spatial ladder with how far it still has to travel — 296ms
 *   (slow) at a full drag, floored at 137ms (fast) for a flick from near the top — and
 *   starts at the speed the finger left.
 *
 * **Its ceiling stays on the spring ladder while the flight's own clock has left it, and that is the
 * distinction rather than an oversight.** A release genuinely *is* a spring — it continues a speed the
 * hand put on the surface — so a spring settle time is the right unit for it, where a from-rest leg
 * flies a Bézier and takes M3's duration scale (see `HERO_DURATIONS`). The two exits therefore differ
 * by 46ms at their longest, which is the difference between a tap and a full drag.
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
/* `PULL_RELEASE_SAMPLES = 20` stood here with no consumer anywhere in the repo: the release
   is evaluated analytically once per frame through the shared scheduler rather than handed to
   WAAPI as a table, so there is nothing to sample. */

// ---------------------------------------------------------------------------
// Frame capture
// ---------------------------------------------------------------------------

/**
 * How many captured frames the LRU holds.
 *
 * Memory is bounded separately, by `HERO_FRAME_CACHE_MAX_PIXELS` — so this is a *count* limit,
 * and the count is what evicts for a small capture: at 4, scrolling past five warmed cards
 * guaranteed that the one you then tapped had to be re-captured synchronously in the press
 * handler, which is the mechanism behind the press-time spike being intermittent rather than
 * constant.
 *
 * **6 is not always reachable, and the arithmetic is worth having here.** The pixel budget is
 * 2,654,208 (`HERO_FRAME_MAX_DIMENSION²·2`), so it holds six frames only while each stays under
 * ~442k pixels: 13 frames of a 400×500 capture, but only 5 of a 640×800 one. Raising the count
 * therefore helps the 1x srcset picks it was measured on and is capped by memory on the 2x ones —
 * which is the correct order of priority, since the budget is the thing protecting a phone.
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
