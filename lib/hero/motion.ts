'use client';

import {
  HERO_CONTAINER_FADE,
  HERO_CONTAINER_SHAPE,
  HERO_CONTENT_FADE,
  HERO_CLIP_SELECTOR,
  HERO_CONTENT_SELECTOR,
  HERO_DURATIONS,
  HERO_PROGRESS_SAMPLES,
  HERO_REVERSE_BASE_RATIO,
  HERO_REVERSE_MIN_DURATION_MS,
  HERO_REVERSE_TRAVEL_RATIO,
  HERO_REVEAL_SELECTOR,
  HERO_REVEAL_WINDOW,
  HERO_SURFACE_SELECTOR,
  HERO_UNCLIP_SELECTOR,
  HIDE_DISTANCE_PX,
  HIDE_EASING,
  FLIGHT_REBUILD_MIN_MS,
  FLIGHT_RETIRE_MS,
  REVEAL_CONTENT_DURATION_MS,
  REVEAL_DISTANCE_PX,
  REVEAL_EASING,
  HERO_BACKGROUND_SINK_SCALE,
  HERO_BACKGROUND_SINK_WINDOW,
} from './constants';
import {
  createHeroRectArc,
  formatHeroContainerCompensator,
  formatHeroContainerCounter,
  formatHeroContainerCounterOrigin,
  formatHeroContainerRadius,
  formatHeroTransform,
  getHeroContainerPose,
  unprojectHeroContainerRect,
  getHeroBackgroundSinkTransform,
  heroRectCenterDistance,
  solveHeroArcContainBows,
  lerpHeroRectArc,
  lerpHeroRect as lerpRect,
  type HeroRect,
} from './geometry';

import {
  applyFlightPose,
  buildFlightKeyframes,
  createHeroLeg,
  evaluateLeg,
  getFlightRadii,
  moveFlightToPlane,
  setFlightRole,
  type HeroFlight,
  type HeroFlightRole,
  type HeroLeg,
  type HeroPose,
} from './flight';
import { planeRectToScreen, screenRectToPlane, type HeroScrollPlane } from './plane';
import { intervalProgress, progressAt, sampleProgress, type ProgressFrame } from './progress';
import { interpolate } from './spring';
import type { HeroChoreography, HeroDirection } from './types';
/* One reader for the app, and it is the attribute rather than the media query:
   `lib/appearance` resolves "follow the system" once and writes the result onto `<html>`,
   so a mid-session change to either the OS setting or the app's own is already reflected
   here; a private `matchMedia` cannot see the second of those. */
import { motionScale, motionTier, scaledMs } from '@/lib/appearance';
import { clamp01 } from '@/lib/utils';
import { heroProbeMark } from './probe';

type AnimationOwner = {
  animation: Animation;
  element: HTMLElement;
};

/** The three boxes a container transform needs, measured once at launch. */
export type HeroContainer = {
  /** The gallery card / thumbnail, in screen space. */
  card: HeroRect;
  /** The overlay's own box — what the window grows to or shrinks from. */
  host: HeroRect;
  /** The card's corner radius; a full-bleed overlay's is 0. */
  cardRadius: number;
};

/**
 * One leg of the container transform, with both ends stated rather than derived, so a
 * reversal can rebase it without re-deriving which direction meant what.
 */
type HeroContainerLeg = {
  clipFrom: HeroRect;
  clipTo: HeroRect;
  radiusFrom: number;
  radiusTo: number;
  host: HeroRect;
  /**
   * The window's own bow, which is **not** the flyer's.
   *
   * It answers containment — the window has to hold the picture — while `HeroLeg.bow` answers
   * the crop budget. They must not be one scalar: sharing it meant the picture paid for the
   * window's aspect excursion by flying a straight line. `solveHeroArcContainBows` has the
   * measurement; `settleBows` is the only place either is set once a leg exists.
   */
  bow: number;
};

/* `lerpRect` is `geometry.ts`'s `lerpHeroRect` — Flutter's `MaterialRectArcTween` — shared
   with the flyer rather than re-typed here, and used at the sites that need a single sample
   rather than a whole track. A loop builds its arc once with `createHeroRectArc` instead. */

function createContainerLeg(
  container: HeroContainer,
  direction: HeroDirection,
): HeroContainerLeg {
  const { card, host, cardRadius } = container;
  /* `bow: 1` is a starting point rather than an answer — `settleBows` overwrites it as soon as the
     flight leg exists, because the containment solve needs the picture's bow as its input. */
  return direction === 'forward'
    ? { clipFrom: card, clipTo: host, radiusFrom: cardRadius, radiusTo: 0, host, bow: 1 }
    : { clipFrom: host, clipTo: card, radiusFrom: 0, radiusTo: cardRadius, host, bow: 1 };
}

/**
 * Turn around from wherever the box currently is, so a reversal never snaps.
 *
 * The bow it re-reads the box at is the *container's* own (`previous.bow`), not the flyer's —
 * reading it off the leg being rebased is what makes sharing one scalar unrepresentable.
 */
function reverseContainerLeg(
  previous: HeroContainerLeg,
  direction: HeroDirection,
  progress: number,
  destination: HeroRect,
  radius: number,
  host: HeroRect,
): HeroContainerLeg {
  const shape = HERO_CONTAINER_SHAPE[direction];
  return {
    ...previous,
    clipFrom: lerpRect(previous.clipFrom, previous.clipTo, progress, previous.bow),
    // A viewport rebuild replaces clipFrom with a mid-flight pose. The endpoint must
    // still be the actual card/host, never that earlier rebase point.
    clipTo: destination,
    radiusFrom: interpolate(
      previous.radiusFrom,
      previous.radiusTo,
      intervalProgress(progress, shape.start, shape.end),
    ),
    radiusTo: radius,
    host,
  };
}


function readRect(element: HTMLElement): HeroRect {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
}

type Completion = {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
};

type HeroMotionOptions = {
  flight: HeroFlight;
  /** Screen-space source box. */
  from: HeroRect;
  /** Screen-space destination box. */
  to: HeroRect;
  direction: HeroDirection;
  background: HTMLElement | null;
  overlay: HTMLElement | null;
  floatingBack: HTMLElement | null;
  /** Continue the background sink from its current depth (parallel handoff). */
  continueBackground?: boolean;
  /** The card box the container transform grows from. Omit to skip it. */
  container?: Pick<HeroContainer, 'card' | 'cardRadius'> | null;
  /** `dismiss` keeps the gesture's own pose instead of running the container. */
  choreography?: HeroChoreography;
  /**
   * The overlay's live poses when this motion takes a surface over from another one mid-leg
   * (`HeroMotion.handOver`): the cross-fade, chrome and floating back start from them instead of
   * from their resting entrance values.
   */
  sharedFrom?: Map<HTMLElement, OverlayPose>;
  /** px/ms along the travel the leg leaves at (a released drag). Omit to launch from rest. */
  speed?: number;
};


/**
 * A second detail surface that wears the opening's shared tracks in lockstep with the Stage.
 *
 * **The early reveal.** The routed detail can be ready while the picture is still flying, and
 * Flutter shows a destination page *during* its route transition rather than after it. The route
 * is laid out exactly like the Stage (the handoff has always depended on that), so the same
 * keyframes drive the same window, fit, cross-fade and staircase on it; every mirror track is
 * pinned to the flyer's own `startTime`, so the two surfaces are one picture on the compositor.
 * The Stage keeps its tracks too: it still hosts the flyer (inside its window) and takes the
 * screen back, in the very pose the mirror was in, if the open is reversed.
 *
 * No background (one sink owns the gallery) and no floating back (the Stage's copy owns the
 * entrance; the route's own takes over at the handoff, as before).
 */
type HeroMirror = {
  overlay: HTMLElement;
  content: HTMLElement | null;
  clip: HTMLElement | null;
  unclip: HTMLElement | null;
  tracks: AnimationOwner[];
};

/**
 * Only one motion may own the shared gallery background at a time; a superseded
 * session must not reset a transform the new one is driving.
 */
const backgroundOwners = new WeakMap<HTMLElement, symbol>();

export function clearInactiveHeroBackground(element: HTMLElement | null) {
  if (!element || backgroundOwners.has(element)) return false;
  element.getAnimations().forEach((animation) => {
    try {
      animation.cancel();
    } catch {
      // A detached animation is already visually inert.
    }
  });
  element.style.transform = '';
  element.style.transformOrigin = '';
  element.style.willChange = '';
  return true;
}

function createCompletion(): Completion {
  let resolvePromise!: () => void;
  const completion: Completion = {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: () => {},
    settled: false,
  };
  completion.resolve = () => {
    if (completion.settled) return;
    completion.settled = true;
    resolvePromise();
  };
  return completion;
}

/**
 * The clock every leg is timed against: **`performance.now()`, not
 * `document.timeline.currentTime`** — a `DocumentTimeline`'s current time is the time of the
 * last rendering update, not the time now. Opening a picture does heavy synchronous work in
 * the press handler, so that gap is routinely 100ms+ on a phone; anchoring a leg's
 * `startTime` to the stale value declared it had *started in the past*, and by the first
 * compositor frame the leg was already partway through — the opening transition appeared to
 * be missing, on slow devices only. `+ 1` at the call sites still means "next frame".
 */
function timelineNow() {
  return performance.now();
}

/** Animations created inside `holdHeroMotion`, paused at their first frame. */
let heldAnimations: Animation[] | null = null;

/**
 * Start an animation **now**, meaning at the next frame the compositor produces — never at a
 * wall-clock instant this code picks. Explicitly setting `animation.startTime` anchors a leg
 * to an instant that has already passed (see `timelineNow`): if the first frame after the
 * press lands 200ms later, 200ms of the leg are already spent and only its tail plays. Let
 * the browser assign the start time; animations created in one task share it anyway.
 * `startedAt` survives as the analytic reference for interruption, rebased from the real
 * animation in `startVisual` so the two cannot drift.
 */
function animateAt(
  element: HTMLElement,
  keyframes: Keyframe[],
  timing: KeyframeAnimationOptions,
): AnimationOwner {
  const animation = element.animate(keyframes, { ...timing, fill: 'both' });
  if (heldAnimations) {
    animation.pause();
    heldAnimations.push(animation);
  }
  return { animation, element };
}

/**
 * Build a motion without starting it: every track is created — keyframes parsed, effects
 * attached — and paused at its first frame, so `HeroMotion.release` later only has to `play()`
 * them. A press builds the opening this way inside its still-hidden Stage
 * (`HeroController.armOpen`), which takes the parse and the geometry off the click.
 */
export function holdHeroMotion(build: () => HeroMotion) {
  const previous = heldAnimations;
  heldAnimations = [];
  try {
    const motion = build();
    motion.held = heldAnimations;
    return motion;
  } finally {
    heldAnimations = previous;
  }
}

function settle(owners: AnimationOwner[], finish: boolean) {
  owners.forEach(({ animation }) => {
    try {
      if (finish) animation.finish();
      animation.cancel();
    } catch {
      // Already canceled by a superseding session.
    }
  });
}

function numericOpacity(element: HTMLElement) {
  const value = Number.parseFloat(getComputedStyle(element).opacity);
  return Number.isFinite(value) ? value : 1;
}

function readBackgroundAmount(element: HTMLElement) {
  const transform = getComputedStyle(element).transform;
  if (!transform || transform === 'none') return 0;
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    /* The cue is a scale now, so the amount comes off `a` rather than off the translation. A
       gesture that hands the sink over mid-flight reads it back through here, so this has to
       invert `getHeroBackgroundSinkTransform` exactly. */
    return clamp01((1 - matrix.a) / (1 - HERO_BACKGROUND_SINK_SCALE));
  } catch {
    return 0;
  }
}

/**
 * The sink's shape inside its window. A bare `intervalProgress` is linear in travel and clamps,
 * so the gallery stopped receding *at full speed* the instant the window closed (p 0.6 forward)
 * and started at full speed mid-flight on the way home (p 0.4 back): a velocity step on a layer
 * the size of the screen, which is what read as coarse. Shaped C1 at every window edge that lies
 * inside the leg — forward eases out (it begins with the leg, which is already moving, and
 * comes to rest at its end); back is a smoothstep (it starts mid-flight from rest and lands
 * with the leg). Same depth, same window, no kink.
 */
export function easeSinkWindow(amount: number, direction: HeroDirection) {
  const u = clamp01(amount);
  return direction === 'forward' ? 1 - (1 - u) * (1 - u) : u * u * (3 - 2 * u);
}

function revealRole(element: HTMLElement) {
  const role = element.dataset.imageDetailReveal;
  return role === 'chrome' || role === 'header' || role === 'body' ? role : 'default';
}

/**
 * The detail side of a flight: a container transform, not a fade — one growing, clipping,
 * rounded box with the destination content laid out at its final size and scaled to the
 * box's current width (`MaterialContainerTransform` / `open_container.dart`), grown to the
 * whole navigator rather than the picture's box. A fade of a rectangle plus a page revealed
 * behind it is two objects for one gesture.
 *
 * Three tracks on one clock — mask, fit, cross-fade — plus the picture, which keeps its own
 * shared-element morph (a cropped thumbnail becoming a contained photo is worth more than a
 * plain cross-fade). Both start at the card's width and end at their own, so they stay
 * coherent without being coupled.
 */
type OverlayContext = {
  overlay: HTMLElement;
  /** `[data-image-detail-crossfade]` — the full-width block the fit scales. */
  content: HTMLElement | null;
  floatingBack: HTMLElement | null;
  choreography: HeroChoreography;
  fromCurrent?: Map<HTMLElement, OverlayPose>;
};

type OverlayPose = { opacity: number; transform: string; rise: number };

/** Read all shared presentation before cancelling any track; one reversal, one pose. */
function readOverlayPoses(overlay: HTMLElement | null, floatingBack: HTMLElement | null) {
  const poses = new Map<HTMLElement, OverlayPose>();
  const targets = new Set<HTMLElement>(floatingBack ? [floatingBack] : []);
  overlay?.querySelectorAll<HTMLElement>(
    `${HERO_SURFACE_SELECTOR}, ${HERO_CONTENT_SELECTOR}, ${HERO_REVEAL_SELECTOR}`,
  ).forEach((element) => targets.add(element));
  targets.forEach((element) => {
    const style = getComputedStyle(element);
    const transform = style.transform;
    const rise = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
    poses.set(element, { opacity: Number.parseFloat(style.opacity), transform, rise });
  });
  return poses;
}

/**
 * The window, its corner, the counter-scale and the flight layer's inverse — one group.
 *
 * Held apart from the rest of the overlay's animations because they are the only tracks a
 * mid-flight viewport change invalidates: every one of them is expressed against the *host's*
 * box, so when the host resizes the same numbers land somewhere else. See
 * `HeroMotion.rebuildContainer`.
 *
 * **The corner is its own `animate()` call, and that is load-bearing.** The compositor checks
 * the property set for the animation as a whole, so a keyframe list mixing `transform` with
 * `borderRadius` would cost the *transform* its compositor too — forfeiting the whole
 * construction. Two animations on one element, one composited and one not, is the intended
 * arrangement: position rides the compositor and the corner is a paint-property update on a
 * single node.
 */
function buildContainerAnimations(
  nodes: {
    clip: HTMLElement;
    unclip: HTMLElement;
    /** The opening leg's flyer, iff it is inside the window. */
    flightLayer: HTMLElement | null;
    /** The flight layer's box origin relative to the window's; see
     *  `formatHeroContainerCounterOrigin`. */
    flightLayerOffset: { x: number; y: number };
  },
  container: HeroContainerLeg,
  leg: HeroLeg,
): AnimationOwner[] {
  const { direction, duration } = leg;
  const shape = HERO_CONTAINER_SHAPE[direction];
  const frames = sampleProgress(leg.progress, HERO_PROGRESS_SAMPLES);
  /* One arc, from the container's own endpoint pair — the window grows to the whole overlay,
     not to the flyer's destination — and at the container's **own** bow: the window's aspect
     excursion is what breaks containment, so a shared scalar flattened the *picture* to fit
     a frame that was the one misbehaving. `solveHeroArcContainBows` has the numbers. */
  const clipArc = createHeroRectArc(container.clipFrom, container.clipTo, container.bow);
  const clip: Keyframe[] = new Array(frames.length);
  const corner: Keyframe[] = new Array(frames.length);
  const counter: Keyframe[] = new Array(frames.length);
  const flight: Keyframe[] = new Array(frames.length);

  for (let index = 0; index < frames.length; index += 1) {
    const { offset, progress } = frames[index];
    const pose = getHeroContainerPose(lerpHeroRectArc(clipArc, progress), container.host);
    clip[index] = { offset, transform: formatHeroTransform(pose) };
    corner[index] = {
      offset,
      borderRadius: formatHeroContainerRadius(
        pose,
        container.host,
        interpolate(
          container.radiusFrom,
          container.radiusTo,
          intervalProgress(progress, shape.start, shape.end),
        ),
      ),
    };
    counter[index] = { offset, transform: formatHeroContainerCompensator(pose) };
    flight[index] = { offset, transform: formatHeroContainerCounter(pose) };
  }

  const timing = { duration, easing: 'linear' } satisfies KeyframeAnimationOptions;
  const owners = [
    animateAt(nodes.clip, clip, timing),
    animateAt(nodes.clip, corner, timing),
    animateAt(nodes.unclip, counter, timing),
  ];
  if (nodes.flightLayer) {
    /* Before the track starts, or its first frame is a whole gutter times (1 - f) out. */
    nodes.flightLayer.style.transformOrigin = formatHeroContainerCounterOrigin(
      nodes.flightLayerOffset,
    );
    owners.push(animateAt(nodes.flightLayer, flight, timing));
  }
  return owners;
}

/**
 * **A scalar track is two keyframes and a `linear()` easing, not a keyframe per sample.** Every
 * track below is one number driven through the leg's progress table (an opacity, a translate
 * distance, a scale), and both interpolate that number linearly between the same samples — so
 * the two forms draw the same frames. What differs is the press: Blink parses each keyframe's
 * value on `animate()`, 0.29ms for 49 transform keyframes against 0.04ms for one `linear()`
 * string (1×, measured), and a press creates ten of these. `linear()` easings run on the
 * compositor like any other timing function.
 *
 * `fraction(progress)` is where the track is between its two keyframes at that point of travel.
 */
type ScalarTrack = { keyframes: Keyframe[]; easing: string };

function linearEasing(frames: readonly ProgressFrame[], fraction: (progress: number) => number) {
  let points = '';
  for (let index = 0; index < frames.length; index += 1) {
    const { offset, progress } = frames[index];
    if (index) points += ',';
    points += `${round5(fraction(progress))} ${round5(offset * 100)}%`;
  }
  return `linear(${points})`;
}

function round5(value: number) {
  return Math.round(value * 1e5) / 1e5;
}

function animateScalar(element: HTMLElement, track: ScalarTrack, duration: number): AnimationOwner {
  return animateAt(element, track.keyframes, { duration, easing: track.easing });
}

/**
 * An opacity threshold on the leg's **travel**, not on its wall clock —
 * `MaterialContainerTransform` applies `ProgressThresholds` to the animator's interpolated
 * fraction, so "0.60" means "when the box is 60% home". Every fade window must be sampled
 * this way or one gesture is measured on two clocks.
 */
function fadeTrack(
  frames: readonly ProgressFrame[],
  interval: { start: number; end: number },
  from: number,
  to: number,
): ScalarTrack {
  return {
    keyframes: [{ opacity: from }, { opacity: to }],
    easing: linearEasing(frames, (progress) =>
      intervalProgress(progress, interval.start, interval.end),
    ),
  };
}

/**
 * The staircase, position only, on the same table as everything else.
 *
 * Opacity belongs to the container's block fade above — two nested opacities multiply and read
 * as two entrances — so this is a rise and nothing else. See `HERO_REVEAL_WINDOW` for why the
 * steps are fractions of the leg rather than milliseconds behind a decelerate curve.
 */
function revealTrack(
  frames: readonly ProgressFrame[],
  role: keyof typeof HERO_REVEAL_WINDOW,
  continuedDistance?: number,
): ScalarTrack {
  const distance = continuedDistance ?? REVEAL_DISTANCE_PX[role];
  const { end } = HERO_REVEAL_WINDOW[role];
  const start = continuedDistance === undefined ? HERO_REVEAL_WINDOW[role].start : 0;
  return {
    // `none` at the far end, never a resting translate: an identity transform still makes the
    // node a containing block for fixed-position descendants.
    keyframes: [{ transform: `translate3d(0, ${distance.toFixed(3)}px, 0)` }, { transform: 'none' }],
    easing: linearEasing(frames, (progress) => {
      const interval = intervalProgress(progress, start, end);
      // The body starts after the content is already partly visible. Ease the local
      // gate into motion instead of switching straight from rest to full flight speed.
      // This is a C1 blend of the shared travel, not a second clock/easing token.
      // A resumed reveal already has momentum, so it keeps its continuous interval.
      return role === 'body' && continuedDistance === undefined
        ? interval * interval * (3 - 2 * interval)
        : interval;
    }),
  };
}

function buildOverlayAnimations(ctx: OverlayContext, leg: HeroLeg) {
  const { overlay, content, floatingBack, choreography, fromCurrent } = ctx;
  const { direction, duration } = leg;
  const owners: AnimationOwner[] = [];
  const surface = overlay.querySelector<HTMLElement>(HERO_SURFACE_SELECTOR);
  if (choreography === 'dismiss') {
    return buildDismissAnimations(overlay, floatingBack, surface, leg);
  }
  const reduced = motionTier('image') !== 'standard';
  const fade = HERO_CONTAINER_FADE[direction];
  /* One table for the whole leg. The LRU in `progress.ts` keys on the model, so the mask, the
     fit, both fades, the staircase and the sink all get the same array for free. */
  const frames = sampleProgress(leg.progress, HERO_PROGRESS_SAMPLES);
  const timing = { duration, easing: 'linear' } satisfies KeyframeAnimationOptions;

  /* The plane and the content do not share a window: see `HERO_CONTENT_FADE` for why the
     content leaves from the first frame on the way back, and why its window now ends exactly
     where the plane's begins. */
  const contentFade = HERO_CONTENT_FADE[direction];
  const [fadeFrom, fadeTo] = direction === 'forward' ? [0, 1] : [1, 0];
  /* **The plane does not fade in, and that was a real defect on a phone.** A cross-fade keeps
     the destination's *layout* from popping into a container too small to hold it — a statement
     about content, which a flat surface rectangle has none of — and fading it hid the first
     quarter of the mask's growth, by a fraction that is breakpoint-dependent: the enter
     threshold is a fraction of travel, but how much screen the card already covers is not
     (0.23 of the width on a 1440 desktop against 0.45 on a 390 phone), so on mobile the blank
     page appeared already most of the way open.

     `open_container.dart` is unambiguous: the container's own `Material` carries **no opacity**;
     only the closed and open *children* cross-fade. The mask is the reveal. The back leg keeps
     `HERO_CONTAINER_FADE.back`'s 0.60 → 0.90, which hands the plane over to the thumbnail late
     instead of blinking it out and letting the picture travel alone. */
  if (surface && (direction === 'back' || fromCurrent)) {
    const from = fromCurrent?.get(surface)?.opacity ?? 1;
    owners.push(animateScalar(surface, fadeTrack(frames, fade, from, fadeTo), duration));
  }
  if (content) {
    owners.push(
      animateScalar(content, fadeTrack(
        frames,
        fromCurrent ? { ...contentFade, start: 0 } : contentFade,
        fromCurrent?.get(content)?.opacity ?? fadeFrom,
        fadeTo,
      ), duration),
    );
  }

  // Chrome, header and body still arrive in reading order — Flutter stages incoming content the
  // same way, from about a quarter of the way through the morph.
  // A closing reverse fades the current copy out; moving its already-partially-entered
  // descendants a second time creates a counter-motion inside the shrinking container.
  // Only a forward leg owns the reveal staircase, while a forward re-open may continue from
  // the captured rise instead of restarting it.
  if (direction === 'forward' && !reduced) {
    overlay.querySelectorAll<HTMLElement>(HERO_REVEAL_SELECTOR).forEach((element) => {
      owners.push(animateScalar(element, revealTrack(
        frames, revealRole(element), fromCurrent?.get(element)?.rise,
      ), duration));
    });
  } else if (fromCurrent && !reduced) {
    // Hold the already-present pose while its parent fades. Cancelling the entrance
    // without replacing this transform snaps a still-visible header/body to y=0.
    overlay.querySelectorAll<HTMLElement>(HERO_REVEAL_SELECTOR).forEach((element) => {
      const pose = fromCurrent.get(element);
      if (pose) owners.push(animateAt(element, [
        { transform: pose.transform }, { transform: pose.transform },
      ], timing));
    });
  }

  /* The floating back button renders *outside* the overlay, so the mask never reaches it and
     the container's parameter has no claim on it: it keeps the motion table's "small thing
     entering" row. Do not "finish the job" by moving it onto the leg's progress. */
  if (floatingBack) {
    /* Unconditional, not zeroed on the reduced tier: 8px *is* the weak form every other
       control keeps, and zeroing it made this the only control that faded in with no travel
       at all on that tier. Under `off` the clock is 0 and the distance never renders. */
    const distance = REVEAL_DISTANCE_PX.chrome;
    const pose = `translate3d(0, ${distance}px, 0)`;
    const current = fromCurrent?.get(floatingBack);
    owners.push(
      animateAt(
        floatingBack,
        direction === 'forward'
          ? [
              { opacity: current?.opacity ?? 0, transform: current?.transform ?? pose },
              { opacity: 1, transform: 'none' },
            ]
          : [
              {
                opacity: current?.opacity ?? numericOpacity(floatingBack),
                transform: current?.transform ?? 'none',
              },
              { opacity: 0, transform: pose },
            ],
        direction === 'forward'
          ? { duration: Math.min(duration, scaledMs(REVEAL_CONTENT_DURATION_MS, 'image')), easing: REVEAL_EASING }
          : {
              duration: Math.min(duration, scaledMs(REVEAL_CONTENT_DURATION_MS, 'image')),
              easing: HIDE_EASING,
            },
      ),
    );
  }
  return owners;
}

/**
 * The swipe-down exit: a different motion, not a different duration.
 *
 * No mask and no fit. The finger has already put the surface where it is via
 * its live transform / opacity, so this only continues what the gesture was doing —
 * from the live opacity, which is why `numericOpacity` is read rather than assumed — while
 * the picture flies home on its own release ladder.
 */
function buildDismissAnimations(
  overlay: HTMLElement,
  floatingBack: HTMLElement | null,
  surface: HTMLElement | null,
  leg: HeroLeg,
) {
  const owners: AnimationOwner[] = [];
  /* 8px at every tier that animates: it is already the weak form, so the tier has nothing
     to weaken. `off` collapses the clock instead, which is where a dismiss stops moving. */
  const distance = HIDE_DISTANCE_PX;
  const targets = new Set<HTMLElement>([
    ...(surface ? [surface] : []),
    ...overlay.querySelectorAll<HTMLElement>(HERO_REVEAL_SELECTOR),
    ...(floatingBack ? [floatingBack] : []),
  ]);
  targets.forEach((element) => {
    owners.push(
      animateAt(
        element,
        [
          { opacity: numericOpacity(element), transform: 'none' },
          { opacity: 0, transform: `translate3d(0, ${distance}px, 0)` },
        ],
        // The leg's own duration, not the closing constant: an interrupted reverse runs
        // short, and a fade outliving its own flight left the surface visibly settling
        // after the flyer had landed.
        { duration: leg.duration, easing: HIDE_EASING },
      ),
    );
  });
  return owners;
}

/**
 * Owns one hero flight from launch through any number of interruptions.
 *
 * The visual track (the flyer) and the shared track (background sink + detail
 * chrome) settle independently: a pull gesture can take over the shared track
 * while the flyer keeps flying.
 */
export class HeroMotion {
  readonly flight: HeroFlight;
  /** Tracks built by `holdHeroMotion` and not yet released. */
  held: Animation[] | null = null;
  private readonly owner = Symbol('hero-motion');
  private readonly background: HTMLElement | null;
  private readonly overlay: HTMLElement | null;
  private readonly floatingBack: HTMLElement | null;
  private readonly content: HTMLElement | null;
  private choreography: HeroChoreography;
  private containerLeg: HeroContainerLeg | null = null;
  private leg: HeroLeg;
  private visual: AnimationOwner[] = [];
  private shared: AnimationOwner[] = [];
  private readonly clip: HTMLElement | null;
  private readonly unclip: HTMLElement | null;
  /**
   * The window, its corner, the counter-scale and the flight layer's inverse, held apart from
   * `shared` because they are the tracks a mid-flight viewport change invalidates and therefore
   * the ones that have to be replaceable on their own. See `rebuildContainer`.
   */
  private containerTracks: AnimationOwner[] = [];
  /** Surfaces mirroring the shared tracks — see `HeroMirror`. */
  private mirrors: HeroMirror[] = [];
  private visualRevision = 0;
  private sharedRevision = 0;
  private sharedReleased = false;
  private pullOffset = 0;
  private pullOffsetX = 0;
  private retired = false;
  private disposed = false;
  private landedCompletion = createCompletion();
  private sharedCompletion = createCompletion();
  /** The leg the shared tracks were built on, once a `retreat` gave the flyer a leg of its own. */
  private sharedLeg: HeroLeg | null = null;

  constructor(options: HeroMotionOptions) {
    this.flight = options.flight;
    this.background = options.background;
    this.overlay = options.overlay;
    this.floatingBack = options.floatingBack;
    this.choreography = options.choreography ?? 'container';
    this.content =
      this.overlay?.querySelector<HTMLElement>(HERO_CONTENT_SELECTOR) ?? null;
    this.clip = this.overlay?.querySelector<HTMLElement>(HERO_CLIP_SELECTOR) ?? null;
    this.unclip = this.overlay?.querySelector<HTMLElement>(HERO_UNCLIP_SELECTOR) ?? null;

    const { direction } = options;
    /* Gated on the two window nodes rather than on the content node, which is the correction to
       what this used to require: the leg no longer measures the content, so a tree without the
       cross-fade block would have lost the whole container transform for nothing. The host is
       read before any track starts, and it is the one box in the chain that is never
       transformed — which is also why `rebuildContainer` can re-read it safely. */
    if (this.overlay && this.clip && this.unclip && options.container) {
      this.containerLeg = createContainerLeg(
        {
          card: options.container.card,
          cardRadius: options.container.cardRadius,
          host: readRect(this.overlay),
        },
        direction,
      );
    }
    const from = screenRectToPlane(options.from, this.flight.plane);

    const to = screenRectToPlane(options.to, this.flight.plane);
    const radii = getFlightRadii(this.flight, direction);
    /* The animation speed reaches the flight here rather than in `constants.ts`, and it must:
       `scripts/heroPath.mjs` imports that file directly and cannot resolve `lib/appearance`
       (it needs `matchMedia`). The scale also has to be applied at all, because the gallery
       card's chrome fade is asserted to stay inside the flight's clock. Sample count stays
       safe across the range (308ms at 缓慢 / 47 intervals = 6.55ms), and the reverse floor is
       scaled with it, so it binds at the same point at every speed. */
    const duration = Math.round(HERO_DURATIONS[direction] * motionScale('image'));
    this.leg = createHeroLeg({
      from,
      to,
      fromRadius: radii.from,
      toRadius: radii.to,
      direction,
      duration,
      startedAt: timelineNow() + 1,
      baseAspect: this.baseAspect,
      speed: options.speed,
    });
    this.settleBows();

    heroProbeMark('hx:t:leg');
    this.startVisual();
    if (!heldAnimations) heroProbeMark(`hx:respond:${direction}`);
    this.startShared(options.continueBackground ?? false, options.sharedFrom);
    heroProbeMark('hx:t:shared');
  }

  get landed() {
    return this.landedCompletion.promise;
  }

  get finished() {
    return Promise.all([this.landedCompletion.promise, this.sharedCompletion.promise]).then(
      () => undefined,
    );
  }

  /** Current visual state — sampled from the emitted tracks, with no layout reads. */
  measurePose(): HeroPose {
    const currentTime = this.visual[0]?.animation.currentTime;
    // WAAPI's currentTime describes the presented timeline, including a pending first
    // frame. performance.now() can be a whole task ahead and made an interruption jump.
    const time = typeof currentTime === 'number'
      ? this.leg.startedAt + currentTime
      : timelineNow();
    return {
      ...evaluateLeg(this.leg, time),
      pullOffset: this.pullOffset,
      pullOffsetX: this.pullOffsetX,
    };
  }

  /**
   * Settle the two bows against each other: the picture keeps its arc, the window gives way.
   *
   * The one place either bow is decided once both legs exist — the flight leg arrives holding
   * only the crop answer, the container leg a placeholder — and it runs before `startVisual`
   * at every call site because the flyer's keyframes read `leg.bow`. The two arcs live in
   * different spaces, so the window's pair goes through the same `screenRectToPlane` the
   * flyer's did; at capture time the scroll terms cancel and the comparison is exact.
   *
   * **Where the window does not clip the picture there is nothing to solve, and the two
   * share.** A dismiss builds no window, and a closing leg's flyer is planted in the gallery
   * plane, outside both overlays — neither arc constrains the other, and the shrinking surface
   * and the picture have to read as one object. The gate is `containedFlightLayer`, the same
   * DOM question the counter track asks (a direction test goes stale).
   */
  private settleBows() {
    const container = this.containerLeg;
    if (!container) return;
    if (this.choreography === 'dismiss' || !this.containedFlightLayer()) {
      this.containerLeg = { ...container, bow: this.leg.bow };
      return;
    }
    const bows = solveHeroArcContainBows(
      { from: this.leg.from, to: this.leg.to, bow: this.leg.bow },
      {
        from: screenRectToPlane(container.clipFrom, this.flight.plane),
        to: screenRectToPlane(container.clipTo, this.flight.plane),
      },
      screenRectToPlane(container.host, this.flight.plane),
    );
    if (bows.inner !== this.leg.bow) this.leg = { ...this.leg, bow: bows.inner };
    this.containerLeg = { ...container, bow: bows.outer };
  }

  /** The canvas's fixed aspect; moving between scroll planes never resizes its base. */
  private get baseAspect() {
    const { width, height } = this.flight.base;
    return height > 0 ? width / height : 1;
  }

  /**
   * Put a second surface on the shared tracks, from wherever the leg is now. Returns the
   * disposer that takes them off again (its nodes then show their resting CSS, so the caller
   * seals or hands over the surface in the same task).
   *
   * Only while the shared tracks are the leg's own: after a pull has taken them
   * (`releaseShared`) or once the motion is retiring there is nothing to mirror, and the caller
   * keeps the old handoff.
   */
  attachMirror(overlay: HTMLElement): (() => void) | null {
    if (this.disposed || this.retired || this.sharedReleased || this.choreography === 'dismiss') {
      return null;
    }
    if (this.mirrors.some((mirror) => mirror.overlay === overlay)) return null;
    const mirror: HeroMirror = {
      overlay,
      content: overlay.querySelector<HTMLElement>(HERO_CONTENT_SELECTOR),
      clip: overlay.querySelector<HTMLElement>(HERO_CLIP_SELECTOR),
      unclip: overlay.querySelector<HTMLElement>(HERO_UNCLIP_SELECTOR),
      tracks: [],
    };
    this.mirrors.push(mirror);
    /* Only while the shared tracks are running: a mirror attached after they finished has
       nothing to follow — the Stage is at rest in the pose the route's CSS already has. */
    if (!this.sharedCompletion.settled) {
      try {
        mirror.tracks = this.buildMirrorTracks(mirror);
      } catch {
        settle(mirror.tracks, false);
        mirror.tracks = [];
      }
      this.syncToFlight(mirror.tracks);
    }
    return () => this.detachMirror(mirror);
  }

  private detachMirror(mirror: HeroMirror) {
    const index = this.mirrors.indexOf(mirror);
    if (index < 0) return;
    this.mirrors.splice(index, 1);
    settle(mirror.tracks, false);
    mirror.tracks = [];
  }

  /** The mirror's overlay and container tracks on the current leg, built like the Stage's. */
  private buildMirrorTracks(mirror: HeroMirror, fromCurrent?: Map<HTMLElement, OverlayPose>) {
    const owners = buildOverlayAnimations(
      {
        overlay: mirror.overlay,
        content: mirror.content,
        floatingBack: null,
        choreography: this.choreography,
        fromCurrent,
      },
      this.leg,
    );
    if (
      this.containerLeg &&
      this.containerTracks.length > 0 &&
      mirror.clip &&
      mirror.unclip &&
      this.choreography !== 'dismiss'
    ) {
      owners.push(
        ...buildContainerAnimations(
          {
            clip: mirror.clip,
            unclip: mirror.unclip,
            // A flyer replanted into the route's plane takes its counter track from this window.
            flightLayer: this.flightLayerIn(mirror.clip),
            flightLayerOffset: this.flightLayerOffset(),
          },
          this.containerLeg,
          this.leg,
        ),
      );
    }
    return owners;
  }

  /**
   * Pin tracks created mid-leg to the flyer's clock. A fresh `animate()` would start at its
   * own next frame — i.e. at offset 0, a whole leg behind the Stage it has to match.
   */
  private syncToFlight(owners: AnimationOwner[]) {
    const reference = this.visual[0]?.animation;
    if (!reference || owners.length === 0) return;
    const apply = () => {
      const start = reference.startTime;
      owners.forEach(({ animation }) => {
        try {
          if (start !== null) animation.startTime = start;
          else if (reference.currentTime !== null) animation.currentTime = reference.currentTime;
        } catch {
          // A cancelled track is already visually inert.
        }
      });
    };
    apply();
    if (reference.startTime === null) void reference.ready.then(apply, () => {});
  }

  /** Every shared surface's presentation, read before any track is cancelled. */
  private readSharedPoses() {
    const poses = readOverlayPoses(this.overlay, this.floatingBack);
    this.mirrors.forEach((mirror) => {
      readOverlayPoses(mirror.overlay, null).forEach((pose, element) => poses.set(element, pose));
    });
    return poses;
  }

  setRole(role: HeroFlightRole) {
    setFlightRole(this.flight, role);
  }

  /**
   * Pull offset lives on the compensator rather than in the flight keyframes, so
   * a dismiss drag can move the flyer without invalidating its spring.
   */
  setPullOffset(distance: number, x = 0) {
    this.pullOffset = distance;
    this.pullOffsetX = x;
    this.flight.compensator.style.transform =
      distance || x ? `translate3d(${x}px, ${distance}px, 0)` : '';
  }

  /**
   * Turn around, leaving at the speed the flyer is already travelling.
   *
   * The current chord speed is projected onto the new leg's direction and used
   * to solve the replacement spring's launch velocity, so a reversal reads as
   * the flyer being caught and thrown back rather than teleported and restarted.
   */
  async reverse(destination?: HeroRect, plane?: HeroScrollPlane, measured?: HeroPose) {
    if (this.disposed || this.retired) return;
    const pose = measured ?? this.measurePose();
    const sharedPose = this.readSharedPoses();
    // The hand has already removed the mask/fit and placed the full surface. Returning
    // through its stale half-open container would apply a second, discontinuous motion.
    if (this.sharedReleased && this.leg.direction === 'forward') this.choreography = 'dismiss';
    this.sharedReleased = false;

    this.landedCompletion.resolve();
    this.sharedCompletion.resolve();
    this.landedCompletion = createCompletion();
    this.sharedCompletion = createCompletion();
    this.cancelVisual(false);
    this.cancelShared(false, false);

    const previous = this.leg;
    // The drag offset lives on the compensator, outside the flight keyframes: fold it
    // into the starting box and clear the compensator so the reverse begins exactly
    // where the flyer visually is, and no later frame stays shifted by a stale gesture.
    const posed: HeroRect = pose.pullOffset || pose.pullOffsetX
      ? {
          ...pose.rect,
          top: pose.rect.top + pose.pullOffset,
          left: pose.rect.left + (pose.pullOffsetX ?? 0),
        }
      : pose.rect;
    if (this.pullOffset || this.pullOffsetX) this.setPullOffset(0, 0);

    // Capture screen space before any plane change; plane rects are relative to
    // their own scroller's captured origin and are not comparable across planes.
    const currentScreen = planeRectToScreen(posed, this.flight.plane);
    const originScreen = planeRectToScreen(previous.from, this.flight.plane);
    if (plane) {
      moveFlightToPlane(this.flight, plane, screenRectToPlane(currentScreen, plane), pose.radius);
    }
    const from = screenRectToPlane(currentScreen, this.flight.plane);
    const to = screenRectToPlane(destination ?? originScreen, this.flight.plane);

    // Shorter trips home get proportionally shorter durations.
    const direction: HeroDirection = previous.direction === 'forward' ? 'back' : 'forward';
    const fullTravel = heroRectCenterDistance(previous.from, previous.to);
    const returnTravel = heroRectCenterDistance(from, to);
    const ratio = fullTravel > 0.5 ? clamp01(returnTravel / fullTravel) : 1;
    const duration = Math.max(
      /* Scaled with the product it floors. Absolute, it stopped flooring the *proportion* of
         the leg and became a wall-clock minimum: at 快速 the shortest reverse is 61ms, so an
         unscaled 90 would make a fast reversal *longer* than the same one at default speed. */
      scaledMs(HERO_REVERSE_MIN_DURATION_MS, 'image'),
      Math.round(
        HERO_DURATIONS[direction] *
          motionScale('image') *
          (HERO_REVERSE_BASE_RATIO + HERO_REVERSE_TRAVEL_RATIO * Math.sqrt(ratio)),
      ),
    );

    // The container turns around from wherever it currently is, on the previous leg's own
    // progress — the same instant the flyer is being caught at.
    if (this.containerLeg) {
      const offset = previous.duration > 0 ? pose.elapsed / previous.duration : 1;
      const host = this.overlay ? readRect(this.overlay) : this.containerLeg.host;
      this.containerLeg = reverseContainerLeg(
        this.containerLeg,
        previous.direction,
        progressAt(previous.progress, offset),
        direction === 'forward' ? host : destination ?? originScreen,
        direction === 'forward' ? 0 : this.flight.sourceRadius,
        host,
      );
    }

    /* Reversing flips the travel direction, so the inherited speed goes in negative and the
       replacement leg is a spring rather than the curve — a Bézier's launch slope is fixed by
       its own shape, so it cannot be told to leave at a given speed. The spring dips slightly
       before recovering, and that dip is what reads as the flyer being caught. */
    this.leg = createHeroLeg({
      from,
      to,
      fromRadius: pose.radius,
      toRadius: getFlightRadii(this.flight, direction).to,
      direction,
      duration,
      startedAt: timelineNow() + 1,
      baseAspect: this.baseAspect,
      speed: -pose.speed,
    });
    this.settleBows();

    this.startVisual();
    heroProbeMark(`hx:respond:reverse-${direction}`);
    this.startShared(true, sharedPose);
    await this.finished;
  }

  /**
   * Re-aim at a moved destination without restarting the motion. Called when the
   * viewport actually changes size, so the landing box is still correct.
   */
  rebuild(destination: HeroRect, plane?: HeroScrollPlane, measured?: HeroPose) {
    if (this.disposed || this.retired) return;
    const pose = measured ?? this.measurePose();
    const previous = this.leg;
    const sharedPose = this.landedCompletion.settled || this.sharedReleased
      ? undefined : this.readSharedPoses();
    this.cancelVisual(false);

    const currentScreen = planeRectToScreen(pose.rect, this.flight.plane);
    if (plane) {
      moveFlightToPlane(this.flight, plane, screenRectToPlane(currentScreen, plane), pose.radius);
    }
    const from = screenRectToPlane(currentScreen, this.flight.plane);
    const to = screenRectToPlane(destination, this.flight.plane);

    if (this.landedCompletion.settled) {
      // Already landed: just sit on the corrected destination.
      applyFlightPose(this.flight, to, previous.toRadius);
      this.leg = { ...previous, from: to, to, duration: 0, startedAt: timelineNow() };
      return;
    }

    // The progress the container is at, read off the leg that is being replaced.
    const containerProgress = progressAt(
      previous.progress,
      previous.duration > 0 ? pose.elapsed / previous.duration : 1,
    );
    if (!this.sharedReleased) this.cancelShared(false, false);

    /* Preserve the current speed so a resize mid-flight is not a visible restart — which
       also converts an uninterrupted leg from the curve to a spring here, forced rather
       than chosen: only a spring can be solved for a launch slope. The floor is scaled
       like everything else: "too short to sample" is a fraction of the flight's own clock,
       not a wall-clock figure. */
    const duration = Math.max(scaledMs(FLIGHT_REBUILD_MIN_MS, 'image'), previous.duration - pose.elapsed);
    this.leg = createHeroLeg({
      from,
      to,
      fromRadius: pose.radius,
      toRadius: previous.toRadius,
      direction: previous.direction,
      duration,
      startedAt: timelineNow() + 1,
      baseAspect: this.baseAspect,
      speed: pose.speed,
    });
    /* Before `startVisual`: the window is rebased and both bows settled in there, and the
       flyer's keyframes read `leg.bow`. One forced layout ahead of the first frame, in the
       same task, so nothing is painted in between. */
    if (!this.sharedReleased) this.rebuildContainer(destination, containerProgress);
    this.startVisual();
    if (!this.sharedReleased) this.startShared(true, sharedPose);
  }

  /**
   * Re-aim the window at a freshly measured host, from wherever it is now.
   *
   * **A viewport change mid-flight has to re-aim the container, not just the flyer.** The
   * window is a pose *relative to the host's box*, so when the host resizes the same numbers
   * land somewhere else and keyframes built against the old box finish short of the new one
   * (measured: the mask jumping ~100px in one frame on an address-bar collapse). A one-frame
   * jump of a full-screen window is the artefact that reads worse the lower the refresh rate,
   * because it *is* the difference between two adjacent frames.
   *
   * Re-reading the host is safe because the overlay is the one node in this chain that never
   * carries a transform.
   */
  private rebuildContainer(destination: HeroRect, progress: number) {
    const previous = this.containerLeg;
    if (!previous || !this.overlay || this.choreography === 'dismiss') return;
    settle(this.containerTracks, false);
    this.containerTracks = [];
    if (motionTier('image') !== 'standard') return;

    if (!this.clip || !this.unclip) return;
    const host = readRect(this.overlay);
    const forward = this.leg.direction === 'forward';
    const shape = HERO_CONTAINER_SHAPE[this.leg.direction];
    this.containerLeg = {
      ...previous,
      clipFrom: lerpRect(previous.clipFrom, previous.clipTo, progress, previous.bow),
      clipTo: forward ? host : destination,
      radiusFrom: interpolate(
        previous.radiusFrom,
        previous.radiusTo,
        intervalProgress(progress, shape.start, shape.end),
      ),
      host,
    };
    /* The window's endpoints just moved, so its bow is a stale answer to a question about a
       box that no longer exists — and so is the picture's, since the two are solved together. */
    this.settleBows();
  }

  /**
   * The flight layer, iff the window is one of its ancestors.
   *
   * **Containment, not direction, and that is deliberate.** A direction test would encode the
   * planes' arrangement indirectly and go stale the moment a plane moves; asking the DOM is
   * self-correcting for both legs, for every `moveFlightToPlane`, and for the reduced and
   * dismiss paths — where no container track exists, so the layer correctly gets no transform.
   * Both `reverse` and `rebuild` re-plant the layer *before* rebuilding these tracks, so this
   * always sees the final parent.
   */
  /** The flyer's layer when a window clips it — the Stage's, or a mirror's once replanted. */
  private containedFlightLayer(): HTMLElement | null {
    const layer = this.flight.layer;
    if (!layer) return null;
    if (this.clip?.contains(layer)) return layer;
    return this.mirrors.some((mirror) => mirror.clip?.contains(layer)) ? layer : null;
  }

  /** The flyer's layer when this particular window clips it; the counter track goes there. */
  private flightLayerIn(clip: HTMLElement | null) {
    const layer = this.flight.layer;
    return clip && layer && clip.contains(layer) ? layer : null;
  }

  /** Where the flyer's layer sits relative to a window's untransformed box. */
  private flightLayerOffset() {
    const container = this.containerLeg;
    return container
      ? {
          x: this.flight.plane.host.left - container.host.left,
          y: this.flight.plane.host.top - container.host.top,
        }
      : { x: 0, y: 0 };
  }

  /**
   * Move the flyer into another scroller's plane **without touching its animations**: the plane
   * passed in must describe the same screen geometry as the current one — the same host box and
   * origin, the new scroller at the old one's offset — so every keyframe already written stays
   * true. The open's route taking over the Stage's scroll is that case
   * (`HeroController.promoteAdoption`): the two scrollers are identical boxes, aligned in the
   * same write. The layer keeps its inline top/left (the origin) and its counter track; the
   * window it now sits in wears the same container transform as the one it left.
   */
  replant(plane: HeroScrollPlane) {
    if (this.disposed) return;
    const layer = this.flight.layer;
    if (layer.parentElement !== plane.anchor) plane.anchor.appendChild(layer);
    this.flight.plane = plane;
  }

  /**
   * Undo the accumulated window transform for a caller measuring a node inside it — the
   * viewport-invalidation path re-reads the Stage's landing target, which lives under the
   * window, so a mid-flight read is the scaled box. The transform is our own animation, so
   * its origin and scale are known exactly (`unprojectHeroContainerRect`).
   *
   * The `containerTracks` guard matters below the standard tier: the flight is built for
   * tiers that cannot fly, but these tracks are never created there, so without it this
   * would divide by a transform that is not on screen.
   */
  unprojectRect(rect: HeroRect): HeroRect {
    const container = this.containerLeg;
    if (!container || this.choreography === 'dismiss' || this.containerTracks.length === 0) {
      return rect;
    }
    const elapsed = this.measurePose().elapsed;
    const offset = this.leg.duration > 0 ? elapsed / this.leg.duration : 1;
    const box = lerpRect(
      container.clipFrom,
      container.clipTo,
      progressAt(this.leg.progress, offset),
      container.bow,
    );
    return unprojectHeroContainerRect(rect, box, container.host);
  }

  /** Demote to a background layer that will fade out under a newer flight. */
  retire() {
    if (this.retired || this.disposed) return;
    this.retired = true;
    this.setRole('retiring');
    this.cancelShared(false, true);
  }

  /**
   * Fade out a superseded flyer: the motion table's "leaves the screen" row, on M3's
   * duration scale. Deliberately not pushed into `visual`/`shared` — it has to outlive both
   * tracks — and safe uncancelled because `dispose()` detaches the layer it paints.
   */
  fadeRetiring(duration = scaledMs(FLIGHT_RETIRE_MS, 'image')) {

    if (this.disposed) return Promise.resolve();
    try {
      const fade = this.flight.layer.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration,
        easing: HIDE_EASING,
        fill: 'forwards',
      });
      return fade.finished.catch(() => undefined).then(() => this.dispose());
    } catch {
      this.dispose();
      return Promise.resolve();
    }
  }

  /**
   * Give the surface to a successor opening, mid-leg: the window's live box and corner, and the
   * overlay's live poses, read **before** this motion lets go of them — then this motion retires
   * (its shared tracks frozen where they are, the background sink released) in the same task, so
   * the successor's tracks, built next, start from exactly what is on screen. Null fields where
   * nothing is running: the successor then starts from the resting pose.
   */
  handOver(): { window: { rect: HeroRect; radius: number } | null; shared: Map<HTMLElement, OverlayPose> | undefined } {
    if (this.disposed) return { window: null, shared: undefined };
    const shared = this.retired ? undefined : this.readSharedPoses();
    let window: { rect: HeroRect; radius: number } | null = null;
    const container = this.containerLeg;
    if (container && !this.retired) {
      const running = this.containerTracks.length > 0 && !this.sharedCompletion.settled;
      if (running) {
        // The leg the window runs on — not a retreat's, which replaced the flyer's alone.
        const leg = this.sharedLeg ?? this.leg;
        const current = this.containerTracks[0]?.animation.currentTime;
        const elapsed = typeof current === 'number' ? current : this.measurePose().elapsed;
        const offset = leg.duration > 0 ? elapsed / leg.duration : 1;
        const progress = progressAt(leg.progress, Math.min(1, Math.max(0, offset)));
        const shape = HERO_CONTAINER_SHAPE[leg.direction];
        window = {
          rect: lerpRect(container.clipFrom, container.clipTo, progress, container.bow),
          radius: interpolate(
            container.radiusFrom,
            container.radiusTo,
            intervalProgress(progress, shape.start, shape.end),
          ),
        };
      } else {
        // At rest where its leg ended: full for an open, the card for a reversal.
        window = { rect: container.clipTo, radius: container.radiusTo };
      }
    }
    this.retire();
    return { window, shared };
  }

  /**
   * Fly the picture home on its own, after `handOver`/`retire` gave its surface away: the
   * reversal's flight leg — caught from its live pose, replanted into the gallery's plane, a
   * spring home — with no window, overlay or background tracks of its own.
   */
  retreat(destination: HeroRect, plane: HeroScrollPlane | undefined, measured: HeroPose) {
    if (this.disposed) return Promise.resolve();
    this.landedCompletion = createCompletion();
    this.cancelVisual(false);
    /* The window's counter-scale rides the flyer's layer; the window is no longer this motion's,
       and outside it (in the gallery plane) the counter would distort the picture. */
    this.flight.layer.getAnimations().forEach((animation) => animation.cancel());
    this.flight.layer.style.transformOrigin = '';
    const previous = this.leg;
    const posed: HeroRect = measured.pullOffset || measured.pullOffsetX
      ? {
          ...measured.rect,
          top: measured.rect.top + measured.pullOffset,
          left: measured.rect.left + (measured.pullOffsetX ?? 0),
        }
      : measured.rect;
    if (this.pullOffset || this.pullOffsetX) this.setPullOffset(0, 0);
    const currentScreen = planeRectToScreen(posed, this.flight.plane);
    if (plane) {
      moveFlightToPlane(this.flight, plane, screenRectToPlane(currentScreen, plane), measured.radius);
    }
    const from = screenRectToPlane(currentScreen, this.flight.plane);
    const to = screenRectToPlane(destination, this.flight.plane);
    const direction: HeroDirection = 'back';
    const fullTravel = heroRectCenterDistance(previous.from, previous.to);
    const ratio = fullTravel > 0.5 ? clamp01(heroRectCenterDistance(from, to) / fullTravel) : 1;
    const duration = Math.max(
      scaledMs(HERO_REVERSE_MIN_DURATION_MS, 'image'),
      Math.round(
        HERO_DURATIONS[direction] *
          motionScale('image') *
          (HERO_REVERSE_BASE_RATIO + HERO_REVERSE_TRAVEL_RATIO * Math.sqrt(ratio)),
      ),
    );
    // The window keeps running on the leg it was built for, until a successor takes it over.
    if (!this.retired) this.sharedLeg ??= previous;
    this.leg = createHeroLeg({
      from,
      to,
      fromRadius: measured.radius,
      toRadius: getFlightRadii(this.flight, direction).to,
      direction,
      duration,
      startedAt: timelineNow() + 1,
      baseAspect: this.baseAspect,
      speed: -measured.speed,
    });
    this.startVisual();
    heroProbeMark('hx:respond:retreat');
    return this.landed;
  }

  /** Hand the background + chrome tracks to a gesture. */
  releaseShared() {
    this.sharedReleased = true;
    this.cancelShared(true, true);
  }

  /**
   * Start a motion `holdHeroMotion` built: the leg's analytic clock restarts now and is
   * rebased onto the flyer's real start time the moment the compositor reports it, exactly as
   * for a motion started on construction. Every track resumes from offset 0 in one task, so
   * they share a start time.
   */
  release() {
    const held = this.held;
    if (!held || this.disposed) return;
    this.held = null;
    this.leg = { ...this.leg, startedAt: timelineNow() + 1 };
    held.forEach((animation) => {
      if (animation.playState === 'paused') animation.play();
    });
    heroProbeMark(`hx:respond:${this.leg.direction}`);
    this.rebaseOnStart(this.visual[0]?.animation, this.visualRevision);
  }

  finish() {
    settle(this.visual, true);
    settle([...this.shared, ...this.containerTracks, ...this.mirrorTracks()], true);
    this.landedCompletion.resolve();
    this.sharedCompletion.resolve();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.landedCompletion.resolve();
    this.sharedCompletion.resolve();
    this.cancelVisual(false);
    this.cancelShared(true, false);
    this.mirrors = [];
    this.flight.release();
  }

  private startVisual() {
    const owners: AnimationOwner[] = [];
    try {
      const keyframes = buildFlightKeyframes(this.flight, this.leg);
      const timing = {
        duration: this.leg.duration,
        easing: 'linear',
      } satisfies KeyframeAnimationOptions;
      // Pushed one at a time and settled in the catch: built as one array literal, a throw
      // on the second or third call orphaned the animations the first had created.
      owners.push(animateAt(this.flight.flyer, keyframes.flyer, timing));
      owners.push(animateAt(this.flight.clip, keyframes.clip, timing));
      owners.push(animateAt(this.flight.image, keyframes.image, timing));
    } catch {
      settle(owners, false);
      this.visual = [];
      this.landedCompletion.resolve();
      return;
    }
    this.visual = owners;
    const revision = ++this.visualRevision;
    /* Rebase the analytic clock onto the real one. `startedAt` is what `evaluateLeg` measures
       elapsed time against, and nothing sets an animation's start time by hand — the browser
       assigns it when the leg's first frame runs, which may be well after this task on a busy
       device. Reading it back is what keeps a pose measured for an interruption agreeing with
       what is on screen, and `ready` is the only point at which `startTime` is non-null. */
    this.rebaseOnStart(owners[0]?.animation, revision);
    void Promise.allSettled(owners.map(({ animation }) => animation.finished)).then(() => {
      if (revision !== this.visualRevision) return;
      this.landedCompletion.resolve();
    });
  }

  private rebaseOnStart(flyer: Animation | undefined, revision: number) {
    void flyer?.ready.then(() => {
      // A held track is ready while paused, with no start time: `release` hooks it again.
      if (revision !== this.visualRevision || flyer.startTime === null) return;
      const started = Number(flyer.startTime);
      if (Number.isFinite(started)) this.leg = { ...this.leg, startedAt: started };
    }, () => {});
  }

  private startShared(continueBackground: boolean, fromCurrent?: Map<HTMLElement, OverlayPose>) {
    const owners: AnimationOwner[] = [];
    /* Idempotent: every caller reaches here through `cancelShared`, but the container tracks
       live in their own array and are only *assigned* inside the branch below, so a run that
       produces none would otherwise leave the previous pair in the array to be settled twice. */
    settle(this.containerTracks, false);
    this.containerTracks = [];
    this.clearMirrorTracks();
    try {
      if (this.background) {
        backgroundOwners.set(this.background, this.owner);
        owners.push(this.buildBackgroundAnimation(continueBackground));
        heroProbeMark('hx:t:s-background');
      }
      if (this.overlay) {
        owners.push(
          ...buildOverlayAnimations(
            {
              overlay: this.overlay,
              content: this.content,
              floatingBack: this.floatingBack,
              choreography: this.choreography,
              fromCurrent,
            },
            this.leg,
          ),
        );
        heroProbeMark('hx:t:s-overlay');
        if (
          this.containerLeg &&
          this.clip &&
          this.unclip &&
          this.choreography !== 'dismiss' &&
          motionTier('image') === 'standard'
        ) {
          this.containerTracks = buildContainerAnimations(
            {
              clip: this.clip,
              unclip: this.unclip,
              flightLayer: this.flightLayerIn(this.clip),
              /* The plane host is the scroller's padding box (`createPlane`); the container
                 host is the overlay, the window's untransformed box. */
              flightLayerOffset: this.flightLayerOffset(),
            },
            this.containerLeg,
            this.leg,
          );
        }
        /* Same task as the Stage's tracks, so the browser gives them one start time. */
        if (this.choreography !== 'dismiss') {
          this.mirrors.forEach((mirror) => {
            mirror.tracks = this.buildMirrorTracks(mirror, fromCurrent);
          });
        }
      }
    } catch {
      this.clearMirrorTracks();
      settle([...owners, ...this.containerTracks], false);
      this.disownBackground(true);
      this.shared = [];
      this.containerTracks = [];
      this.sharedCompletion.resolve();
      return;
    }
    this.shared = owners;
    const all = [...owners, ...this.containerTracks, ...this.mirrorTracks()];
    const revision = ++this.sharedRevision;
    if (all.length === 0) {
      this.sharedCompletion.resolve();
      return;
    }
    void Promise.allSettled(all.map(({ animation }) => animation.finished)).then(() => {
      if (revision !== this.sharedRevision) return;
      this.sharedCompletion.resolve();
    });
  }

  private mirrorTracks() {
    return this.mirrors.flatMap((mirror) => mirror.tracks);
  }

  private clearMirrorTracks() {
    this.mirrors.forEach((mirror) => {
      settle(mirror.tracks, false);
      mirror.tracks = [];
    });
  }

  private buildBackgroundAnimation(continueFromCurrent: boolean) {
    const element = this.background!;
    const { direction, duration } = this.leg;
    const from = continueFromCurrent
      ? readBackgroundAmount(element)
      : direction === 'forward'
        ? 0
        : 1;
    const to = direction === 'forward' ? 1 : 0;
    /* The origin is the *viewport's* centre inside the scroller, not the element's: this
       node's box is the whole scrollable content, several viewports tall, and an
       element-centred origin would fling the visible rows. Read once — the gallery scroller
       is hidden while the detail is open, so the offset cannot move under the leg. */
    const scroller = element.parentElement;
    const centre = scroller ? scroller.scrollTop + scroller.clientHeight / 2 : 0;
    // A scale matrix excludes transform-origin. Moving the pivot while continuing from
    // s<1 moves the grid by (1-s) * pivotDelta even though the scale did not change.
    if (!continueFromCurrent || from <= 0.001 || !element.style.transformOrigin) {
      element.style.transformOrigin = `center ${centre}px`;
    }
    element.style.willChange = 'transform';
    /* The sink shares the leg's own table, so depth and travel stay locked — a literal
       sample count here would have forked off the mask's the moment either number moved.
       It does not share the leg's whole *interval*: the window grows over the gallery as the
       leg runs, so a cue that peaked at p=1 peaked behind an opaque surface. See
       `HERO_BACKGROUND_SINK_WINDOW`. */
    const window = HERO_BACKGROUND_SINK_WINDOW[direction];
    // Scale is linear in the amount, so the amount's curve is the easing (`ScalarTrack`).
    return animateScalar(element, {
      keyframes: [
        { transform: getHeroBackgroundSinkTransform(from) },
        { transform: getHeroBackgroundSinkTransform(to) },
      ],
      easing: linearEasing(
        sampleProgress(this.leg.progress, HERO_PROGRESS_SAMPLES),
        (progress) =>
          easeSinkWindow(intervalProgress(progress, window.start, window.end), direction),
      ),
    }, duration);
  }

  private cancelVisual(finish: boolean) {
    this.visualRevision += 1;
    settle(this.visual, finish);
    this.visual = [];
  }

  private cancelShared(clearBackground: boolean, settleCompletion: boolean) {
    this.sharedRevision += 1;
    if (this.background && backgroundOwners.get(this.background) === this.owner) {
      // Freeze the sink where it is so releasing to a gesture never snaps.
      const transform = getComputedStyle(this.background).transform;
      this.background.style.transform = transform === 'none' ? 'none' : transform;
    }
    settle([...this.shared, ...this.containerTracks], false);
    this.shared = [];
    this.containerTracks = [];
    this.clearMirrorTracks();
    if (settleCompletion) this.sharedCompletion.resolve();
    this.disownBackground(clearBackground);
  }

  private disownBackground(clear: boolean) {
    const element = this.background;
    if (!element || backgroundOwners.get(element) !== this.owner) return;
    if (clear) {
      element.style.transform = '';
      element.style.transformOrigin = '';
      element.style.willChange = '';
    }
    backgroundOwners.delete(element);
  }
}
