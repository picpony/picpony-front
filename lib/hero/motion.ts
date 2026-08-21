'use client';

import {
  HERO_CONTAINER_FADE,
  HERO_CONTAINER_SAMPLES,
  HERO_CONTAINER_SHAPE,
  HERO_CONTENT_SELECTOR,
  HERO_DURATIONS,
  HERO_FLIGHT_RESPONSE,
  HERO_REVERSE_BASE_RATIO,
  HERO_REVERSE_MIN_DURATION_MS,
  HERO_REVERSE_TRAVEL_RATIO,
  HERO_REVEAL_SELECTOR,
  HERO_SURFACE_SELECTOR,
  HIDE_DISTANCE_PX,
  HIDE_EASING,
  REVEAL_CONTENT_DURATION_MS,
  REVEAL_DELAY_MS,
  REVEAL_DISTANCE_PX,
  REVEAL_EASING,
  HERO_BACKGROUND_SINK_Y_PX,
} from './constants';
import {
  createHeroRectArc,
  formatHeroContainerClip,
  formatHeroContentTransform,
  getHeroBackgroundSinkTransform,
  heroRectCenterDistance,
  lerpHeroRectArc,
  lerpHeroRect as lerpRect,
  type HeroRect,
} from './geometry';

import {
  applyFlightPose,
  buildFlightKeyframes,
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
import { sampleSpring, springProgress, springVelocityFromSpeed, interpolate } from './spring';
import type { HeroChoreography, HeroDirection } from './types';
/* One `prefersReducedMotion` for the app, and it is the reactive form —
   `lib/motion`'s reads a live `matchMedia` listener, where the private copies
   these two files carried could not pick up a mid-session change. */
import { prefersReducedMotion } from '@/lib/motion';
import { clamp01 } from '@/lib/utils';

type AnimationOwner = {
  animation: Animation;
  element: HTMLElement;
};

/** The three boxes a container transform needs, measured once at launch. */
export type HeroContainer = {
  /** The gallery card / thumbnail, in screen space. */
  card: HeroRect;
  /** The overlay's own box — what the mask grows to or shrinks from. */
  host: HeroRect;
  /** The content wrapper's natural, untransformed box. */
  natural: HeroRect;
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
  contentFrom: HeroRect;
  contentTo: HeroRect;
  radiusFrom: number;
  radiusTo: number;
  host: HeroRect;
  natural: HeroRect;
};

/* `lerpRect` is `geometry.ts`'s `lerpHeroRect` — Flutter's `MaterialRectArcTween` — shared
   with the flyer rather than re-typed here, and used at the sites that need a single sample
   rather than a whole track. A loop builds its arc once with `createHeroRectArc` instead. */

/** Material's `ProgressThresholds`: a sub-timeline inside the leg's own progress. */
function intervalProgress(progress: number, start: number, end: number) {
  if (end <= start) return progress >= end ? 1 : 0;
  return clamp01((progress - start) / (end - start));
}

function createContainerLeg(
  container: HeroContainer,
  direction: HeroDirection,
): HeroContainerLeg {
  const { card, host, natural, cardRadius } = container;
  return direction === 'forward'
    ? {
        clipFrom: card,
        clipTo: host,
        contentFrom: card,
        contentTo: natural,
        radiusFrom: cardRadius,
        radiusTo: 0,
        host,
        natural,
      }
    : {
        clipFrom: host,
        clipTo: card,
        contentFrom: natural,
        contentTo: card,
        radiusFrom: 0,
        radiusTo: cardRadius,
        host,
        natural,
      };
}

/** Turn around from wherever the box currently is, so a reversal never snaps. */
function reverseContainerLeg(
  previous: HeroContainerLeg,
  direction: HeroDirection,
  progress: number,
): HeroContainerLeg {
  const shape = HERO_CONTAINER_SHAPE[direction];
  return {
    ...previous,
    clipFrom: lerpRect(previous.clipFrom, previous.clipTo, progress),
    clipTo: previous.clipFrom,
    contentFrom: lerpRect(previous.contentFrom, previous.contentTo, progress),
    contentTo: previous.contentFrom,
    radiusFrom: interpolate(
      previous.radiusFrom,
      previous.radiusTo,
      intervalProgress(progress, shape.start, shape.end),
    ),
    radiusTo: previous.radiusFrom,
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

function timelineNow() {
  return Number(document.timeline.currentTime ?? performance.now());
}

function animateAt(
  element: HTMLElement,
  keyframes: Keyframe[],
  timing: KeyframeAnimationOptions,
  startTime: number,
): AnimationOwner {
  const animation = element.animate(keyframes, { ...timing, fill: 'both' });
  try {
    animation.startTime = startTime;
  } catch {
    // Older WebKit shares document.timeline when animations are created in the
    // same task; an explicit startTime is an optimization, not correctness.
  }
  return { animation, element };
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
    return clamp01(matrix.m42 / HERO_BACKGROUND_SINK_Y_PX);
  } catch {
    return 0;
  }
}

function revealRole(element: HTMLElement) {
  const role = element.dataset.imageDetailReveal;
  return role === 'chrome' || role === 'header' || role === 'body' ? role : 'default';
}

/**
 * The detail side of a flight: a container transform, not a fade.
 *
 * This used to be one property on one node — `opacity` on the surface plane — while the
 * routed page became visible by having its seal lifted. So a full-screen page arrived by
 * fading a rectangle in and then un-hiding a page behind it, with the picture flying past
 * on a separate path: two objects for one gesture.
 *
 * Material's answer, in both of its own implementations, is one growing, clipping, rounded
 * box with the destination content laid out at its final size and scaled to the box's
 * current width. `MaterialContainerTransform` masks `currentEndBounds` to the container;
 * `open_container.dart` writes it as `FittedBox(fit: BoxFit.fitWidth, alignment: topLeft)`
 * inside a `SizedBox` of the animated rect, and grows that rect to the whole navigator
 * (`_rectTween.end = Offset.zero & navSize`) rather than to the picture's box.
 *
 * So: three tracks on one clock — mask, fit, cross-fade — plus the picture, which keeps its
 * own shared-element morph, because a cropped thumbnail becoming a contained photo is worth
 * more here than Material's plain cross-fade between the two. Both start at the card's width
 * and end at their own, so they stay coherent without being coupled.
 */
type OverlayContext = {
  overlay: HTMLElement;
  /** `[data-image-detail-scale]` — the full-width block the fit scales. */
  content: HTMLElement | null;
  floatingBack: HTMLElement | null;
  choreography: HeroChoreography;
};

/**
 * The mask and the fit, as their own pair of tracks.
 *
 * Separate from the rest of the overlay's animations because they are the only ones that a
 * mid-flight viewport change invalidates: the mask is expressed as insets *relative to the
 * host's border box*, so when the host resizes the same numbers land somewhere else. See
 * `HeroMotion.rebuildContainer`.
 */
function buildContainerAnimations(
  overlay: HTMLElement,
  content: HTMLElement | null,
  container: HeroContainerLeg,
  leg: HeroLeg,
): AnimationOwner[] {
  const { direction, response, duration, startedAt } = leg;
  const shape = HERO_CONTAINER_SHAPE[direction];
  const frames = sampleSpring(response, HERO_CONTAINER_SAMPLES);
  /* The mask and the fit get their own arcs, from their own endpoint pairs — the mask
     grows to the whole overlay, the fit to the content's natural box — rather than
     borrowing the flyer's. Both pairs share the card as their origin and both travel
     the same way, so `createHeroRectArc` picks the same diagonal for them and the three
     bow together; giving them the flyer's arc outright would aim them at the flyer's
     destination, which is not where either of them is going. */
  const clipArc = createHeroRectArc(container.clipFrom, container.clipTo);
  const fitArc = createHeroRectArc(container.contentFrom, container.contentTo);
  const clip: Keyframe[] = new Array(frames.length);
  const fit: Keyframe[] = new Array(frames.length);
  for (let index = 0; index < frames.length; index += 1) {
    const { offset, progress } = frames[index];
    clip[index] = {
      offset,
      clipPath: formatHeroContainerClip(
        lerpHeroRectArc(clipArc, progress),
        container.host,
        interpolate(
          container.radiusFrom,
          container.radiusTo,
          intervalProgress(progress, shape.start, shape.end),
        ),
      ),
    };
    fit[index] = {
      offset,
      transform: formatHeroContentTransform(lerpHeroRectArc(fitArc, progress), container.natural),
    };
  }
  const owners = [animateAt(overlay, clip, { duration, easing: 'linear' }, startedAt)];
  if (content) owners.push(animateAt(content, fit, { duration, easing: 'linear' }, startedAt));
  return owners;
}

function buildOverlayAnimations(ctx: OverlayContext, leg: HeroLeg) {
  const { overlay, content, floatingBack, choreography } = ctx;
  const { direction, duration, startedAt } = leg;
  const startTime = startedAt;
  const owners: AnimationOwner[] = [];
  const surface = overlay.querySelector<HTMLElement>(HERO_SURFACE_SELECTOR);
  if (choreography === 'dismiss') {
    return buildDismissAnimations(overlay, floatingBack, surface, leg);
  }
  const reduced = prefersReducedMotion();
  const fade = HERO_CONTAINER_FADE[direction];

  // --- the cross-fade, on LINEAR time ----------------------------------------
  // Both references evaluate the opacity tweens on the raw animation while the geometry
  // runs on the curve (`open_container.dart`: `_rectTween.evaluate(curvedAnimation)` but
  // `closedOpacityTween.animate(animation)`), so the thresholds are fractions of the leg's
  // wall clock, not of its travel.
  //
  // **The plane and the content no longer share a window on the way back.** Material's
  // return threshold (0.60 → 0.90) is tuned for a card-to-card transform, where the thing
  // shrinking is about the size of the thing it shrinks into. Here it is a full-screen page
  // going home to a thumbnail, and holding the page at full opacity for the first 60% of
  // that meant watching the whole article — heading, tags, description, comment list —
  // scale down and fly into the card behind the picture. The picture flying is the gesture;
  // the page following it in is a second object doing the same trip.
  //
  // So on the back leg the content takes the *enter* window (0 → 0.25) mirrored: it is gone
  // in the first quarter, the surface plane holds the 0.60 → 0.90 fade so there is still
  // something to shrink, and the picture keeps its own morph. Forward is unchanged — content
  // arriving late is the whole point of the enter threshold.
  const contentFade = direction === 'forward' ? fade : HERO_CONTAINER_FADE.forward;
  const fadeKeysFor = (interval: { start: number; end: number }) => {
    const keys: Keyframe[] = [];
    const [fadeFrom, fadeTo] = direction === 'forward' ? [0, 1] : [1, 0];
    (
      [
        [0, fadeFrom],
        [interval.start, fadeFrom],
        [interval.end, fadeTo],
        [1, fadeTo],
      ] as [number, number][]
    ).forEach(([offset, opacity]) => {
      const last = keys[keys.length - 1];
      if (last && last.offset === offset) last.opacity = opacity;
      else keys.push({ offset, opacity });
    });
    return keys;
  };
  if (surface) {
    owners.push(animateAt(surface, fadeKeysFor(fade), { duration, easing: 'linear' }, startTime));
  }
  if (content) {
    owners.push(
      animateAt(content, fadeKeysFor(contentFade), { duration, easing: 'linear' }, startTime),
    );
  }

  // --- the staircase: position only, because opacity is the container's now ----
  // Chrome, header and body still arrive in reading order — Flutter stages incoming content
  // the same way, from about a quarter of the way through the morph — but a second opacity
  // on nested nodes would multiply against the block fade above and read as two entrances.
  if (direction === 'forward' && !reduced) {
    overlay.querySelectorAll<HTMLElement>(HERO_REVEAL_SELECTOR).forEach((element) => {
      const role = revealRole(element);
      owners.push(
        animateAt(
          element,
          [
            { transform: `translate3d(0, ${REVEAL_DISTANCE_PX[role]}px, 0)` },
            { transform: 'none' },
          ],
          {
            duration: REVEAL_CONTENT_DURATION_MS,
            delay: REVEAL_DELAY_MS[role],
            easing: REVEAL_EASING,
          },
          startTime,
        ),
      );
    });
  }

  // The floating back button renders *outside* the overlay, so the mask never reaches
  // it and it carries its own entrance.
  if (floatingBack) {
    const distance = reduced ? 0 : REVEAL_DISTANCE_PX.chrome;
    const pose = `translate3d(0, ${distance}px, 0)`;
    owners.push(
      animateAt(
        floatingBack,
        direction === 'forward'
          ? [
              { opacity: 0, transform: pose },
              { opacity: 1, transform: 'none' },
            ]
          : [
              { opacity: numericOpacity(floatingBack), transform: 'none' },
              { opacity: 0, transform: pose },
            ],
        direction === 'forward'
          ? {
              duration: REVEAL_CONTENT_DURATION_MS,
              delay: REVEAL_DELAY_MS.chrome,
              easing: REVEAL_EASING,
            }
          : { duration: Math.min(duration, REVEAL_CONTENT_DURATION_MS), easing: HIDE_EASING },
        startTime,
      ),
    );
  }
  return owners;
}

/**
 * The swipe-down exit: a different motion, not a different duration.
 *
 * No mask and no fit. The finger has already put the surface where it is via
 * `--hero-pull-y` / `--hero-veil`, so this only continues what the gesture was doing —
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
  const distance = prefersReducedMotion() ? 0 : HIDE_DISTANCE_PX;
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
        // The leg's own duration, not `HERO_DURATIONS.back`: an interrupted reverse runs
        // as short as `HERO_REVERSE_MIN_DURATION_MS`, and a fade outliving its own flight
        // is what left the surface visibly settling after the flyer had landed.
        { duration: leg.duration, easing: HIDE_EASING },
        leg.startedAt,
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
  private readonly owner = Symbol('hero-motion');
  private readonly background: HTMLElement | null;
  private readonly overlay: HTMLElement | null;
  private readonly floatingBack: HTMLElement | null;
  private readonly content: HTMLElement | null;
  private readonly choreography: HeroChoreography;
  private containerLeg: HeroContainerLeg | null = null;
  private leg: HeroLeg;
  private visual: AnimationOwner[] = [];
  private shared: AnimationOwner[] = [];
  /**
   * The mask and the fit, held apart from `shared` because they are the two tracks a
   * mid-flight viewport change invalidates and therefore the two that have to be
   * replaceable on their own. See `rebuildContainer`.
   */
  private containerTracks: AnimationOwner[] = [];
  private visualRevision = 0;
  private sharedRevision = 0;
  private pullOffset = 0;
  private retired = false;
  private disposed = false;
  private landedCompletion = createCompletion();
  private sharedCompletion = createCompletion();

  constructor(options: HeroMotionOptions) {
    this.flight = options.flight;
    this.background = options.background;
    this.overlay = options.overlay;
    this.floatingBack = options.floatingBack;
    this.choreography = options.choreography ?? 'container';
    this.content =
      this.overlay?.querySelector<HTMLElement>(HERO_CONTENT_SELECTOR) ?? null;

    const { direction } = options;
    // Measured before any track starts, so `natural` is the untransformed pose the fit has
    // to resolve to at progress 1.
    if (this.overlay && this.content && options.container) {
      this.containerLeg = createContainerLeg(
        {
          card: options.container.card,
          cardRadius: options.container.cardRadius,
          host: readRect(this.overlay),
          natural: readRect(this.content),
        },
        direction,
      );
    }
    const from = screenRectToPlane(options.from, this.flight.plane);

    const to = screenRectToPlane(options.to, this.flight.plane);
    const radii = getFlightRadii(this.flight, direction);
    const duration = HERO_DURATIONS[direction];
    this.leg = {
      from,
      to,
      fromRadius: radii.from,
      toRadius: radii.to,
      direction,
      response: HERO_FLIGHT_RESPONSE[direction],
      duration,
      startedAt: timelineNow() + 1,
    };

    this.startVisual();
    this.startShared(options.continueBackground ?? false);
  }

  get landed() {
    return this.landedCompletion.promise;
  }

  get finished() {
    return Promise.all([this.landedCompletion.promise, this.sharedCompletion.promise]).then(
      () => undefined,
    );
  }

  /** Current visual state — analytic, so no forced layout and no DOM reads. */
  measurePose(): HeroPose {
    return { ...evaluateLeg(this.leg, timelineNow()), pullOffset: this.pullOffset };
  }

  setRole(role: HeroFlightRole) {
    setFlightRole(this.flight, role);
  }

  /**
   * Pull offset lives on the compensator rather than in the flight keyframes, so
   * a dismiss drag can move the flyer without invalidating its spring.
   */
  setPullOffset(distance: number) {
    this.pullOffset = distance;
    this.flight.compensator.style.transform = distance ? `translate3d(0, ${distance}px, 0)` : '';
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

    this.landedCompletion.resolve();
    this.sharedCompletion.resolve();
    this.landedCompletion = createCompletion();
    this.sharedCompletion = createCompletion();
    this.cancelVisual(false);
    this.cancelShared(false, false);

    const previous = this.leg;
    // The drag offset lives on the compensator, outside the flight keyframes.
    // Fold it into the starting box and clear the compensator so the reverse
    // begins exactly where the flyer visually is, and no later frame — including
    // the thumbnail landing — stays shifted down by a stale gesture.
    const posed: HeroRect = pose.pullOffset
      ? { ...pose.rect, top: pose.rect.top + pose.pullOffset }
      : pose.rect;
    if (this.pullOffset) this.setPullOffset(0);

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
      HERO_REVERSE_MIN_DURATION_MS,
      Math.round(
        HERO_DURATIONS[direction] *
          (HERO_REVERSE_BASE_RATIO + HERO_REVERSE_TRAVEL_RATIO * Math.sqrt(ratio)),
      ),
    );

    // Reversing flips the travel direction, so inherited speed is negative:
    // the spring dips slightly before recovering, which is the "catch".
    const base = HERO_FLIGHT_RESPONSE[direction];
    const velocity = springVelocityFromSpeed(
      -pose.speed,
      heroRectCenterDistance(from, to),
      duration,
      base,
    );

    // The container turns around from wherever it currently is, on the previous leg's own
    // progress — the same instant the flyer is being caught at.
    if (this.containerLeg) {
      const offset = previous.duration > 0 ? pose.elapsed / previous.duration : 1;
      this.containerLeg = reverseContainerLeg(
        this.containerLeg,
        previous.direction,
        springProgress(offset, previous.response),
      );
    }

    this.leg = {
      from,
      to,
      fromRadius: pose.radius,
      toRadius: getFlightRadii(this.flight, direction).to,
      direction,
      /* Spread, so the reversal keeps the whole response — damping included. Rebuilt field
         by field it dropped ζ back to 1, so every interrupted flight ran a critically damped
         curve while the constants claimed the ζ0.9 spatial one. */
      response: { ...base, velocity },

      duration,
      startedAt: timelineNow() + 1,
    };

    this.startVisual();
    this.startShared(true);
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
    const containerProgress = springProgress(
      previous.duration > 0 ? pose.elapsed / previous.duration : 1,
      previous.response,
    );

    // Preserve the current speed so a resize mid-flight is not a visible restart.
    const duration = Math.max(80, previous.duration - pose.elapsed);
    const velocity = springVelocityFromSpeed(
      pose.speed,
      heroRectCenterDistance(from, to),
      duration,
      previous.response,
    );
    this.leg = {
      ...previous,
      from,
      to,
      fromRadius: pose.radius,
      // Spread for the same reason as in `reverse`: a rebuilt response must keep its ζ.
      response: { ...previous.response, velocity },
      duration,
      startedAt: timelineNow() + 1,
    };
    this.startVisual();
    this.rebuildContainer(destination, containerProgress);
  }

  /**
   * Re-aim the mask and the fit at freshly measured boxes, from wherever they are now.
   *
   * **This is what `rebuild` used to skip, and skipping it was visible.** The mask is a
   * `clip-path: inset()` expressed against the *host's* border box, so when the host
   * resizes the same four numbers land somewhere else — and the keyframes were built
   * against the old box and aimed at the old box. Measured on a 400px-wide viewport with
   * the flight 90ms in and the height changed by 60px (which is a phone's address bar
   * collapsing, the one thing that fires this path on mobile): the flyer moved 19px in that
   * frame and **the mask jumped 682 → 784**, then converged on the pre-resize host and
   * finished 8px short of the new one. A one-frame jump of a full-screen mask is exactly
   * the artefact that reads worse the lower the refresh rate, because it *is* the
   * difference between two adjacent frames.
   *
   * The destinations: a forward leg grows to the overlay and to the content's natural box,
   * both re-measurable from the DOM; a back leg collapses to the card, which is the same
   * rect the flyer was just re-aimed at, so `destination` serves for both of its ends.
   */
  private rebuildContainer(destination: HeroRect, progress: number) {
    const previous = this.containerLeg;
    if (!previous || !this.overlay || this.choreography === 'dismiss') return;
    settle(this.containerTracks, false);
    this.containerTracks = [];
    if (prefersReducedMotion()) return;

    const host = readRect(this.overlay);
    const natural = this.content ? readRect(this.content) : previous.natural;
    const forward = this.leg.direction === 'forward';
    this.containerLeg = {
      ...previous,
      clipFrom: lerpRect(previous.clipFrom, previous.clipTo, progress),
      clipTo: forward ? host : destination,
      contentFrom: lerpRect(previous.contentFrom, previous.contentTo, progress),
      contentTo: forward ? natural : destination,
      radiusFrom: interpolate(
        previous.radiusFrom,
        previous.radiusTo,
        intervalProgress(progress, HERO_CONTAINER_SHAPE[this.leg.direction].start, HERO_CONTAINER_SHAPE[this.leg.direction].end),
      ),
      host,
      natural,
    };
    try {
      this.containerTracks = buildContainerAnimations(
        this.overlay,
        this.content,
        this.containerLeg,
        this.leg,
      );
    } catch {
      this.containerTracks = [];
    }
  }

  /**
   * Undo the container fit for a caller measuring a node inside the scaled block.
   *
   * The viewport-invalidation path re-reads the Stage's landing target to re-aim the flyer,
   * and that target now lives under the fit, so a mid-flight read is the scaled box. The fit
   * is our own animation, so its origin and scale are known exactly.
   */
  unprojectRect(rect: HeroRect): HeroRect {
    const container = this.containerLeg;
    if (!container || this.choreography === 'dismiss') return rect;
    const { natural } = container;
    if (natural.width <= 0) return rect;
    const elapsed = Math.min(
      this.leg.duration,
      Math.max(0, timelineNow() - this.leg.startedAt),
    );
    const offset = this.leg.duration > 0 ? elapsed / this.leg.duration : 1;
    const box = lerpRect(
      container.contentFrom,
      container.contentTo,
      springProgress(offset, this.leg.response),
    );
    const scale = box.width / natural.width;
    if (!(scale > 0.001)) return rect;
    // screen = box.topLeft + (local − natural.topLeft) · scale
    return {
      left: natural.left + (rect.left - box.left) / scale,
      top: natural.top + (rect.top - box.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    };
  }

  /** Demote to a background layer that will fade out under a newer flight. */
  retire() {
    if (this.retired || this.disposed) return;
    this.retired = true;
    this.setRole('retiring');
    this.cancelShared(false, true);
  }

  /**
   * Fade out a superseded flyer.
   *
   * 200ms is the motion table's "leaves the screen" row; it read 160, which is not a step on
   * M3's duration scale. Deliberately not pushed into `visual`/`shared` — it has to outlive
   * both tracks — and safe uncancelled because `dispose()` detaches the layer it paints.
   */
  fadeRetiring(duration = 200) {

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

  /** Hand the background + chrome tracks to a gesture. */
  releaseShared() {
    this.cancelShared(true, true);
  }

  finish() {
    settle(this.visual, true);
    settle([...this.shared, ...this.containerTracks], true);
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
      owners.push(animateAt(this.flight.flyer, keyframes.flyer, timing, this.leg.startedAt));
      owners.push(animateAt(this.flight.clip, keyframes.clip, timing, this.leg.startedAt));
      owners.push(animateAt(this.flight.image, keyframes.image, timing, this.leg.startedAt));
    } catch {
      settle(owners, false);
      this.visual = [];
      this.landedCompletion.resolve();
      return;
    }
    this.visual = owners;
    const revision = ++this.visualRevision;
    void Promise.allSettled(owners.map(({ animation }) => animation.finished)).then(() => {
      if (revision !== this.visualRevision) return;
      this.landedCompletion.resolve();
    });
  }

  private startShared(continueBackground: boolean) {
    const owners: AnimationOwner[] = [];
    /* Idempotent: every caller reaches here through `cancelShared`, but the container
       tracks live in their own array and only get *assigned* inside the branch below, so a
       run that produces none (reduced motion switched on mid-session) would otherwise leave
       the previous pair in the array to be settled twice. */
    settle(this.containerTracks, false);
    this.containerTracks = [];
    try {
      if (this.background) {
        backgroundOwners.set(this.background, this.owner);
        owners.push(this.buildBackgroundAnimation(continueBackground));
      }
      if (this.overlay) {
        owners.push(
          ...buildOverlayAnimations(
            {
              overlay: this.overlay,
              content: this.content,
              floatingBack: this.floatingBack,
              choreography: this.choreography,
            },
            this.leg,
          ),
        );
        if (this.containerLeg && this.choreography !== 'dismiss' && !prefersReducedMotion()) {
          this.containerTracks = buildContainerAnimations(
            this.overlay,
            this.content,
            this.containerLeg,
            this.leg,
          );
        }
      }
    } catch {
      settle([...owners, ...this.containerTracks], false);
      this.disownBackground(true);
      this.shared = [];
      this.containerTracks = [];
      this.sharedCompletion.resolve();
      return;
    }
    this.shared = owners;
    const all = [...owners, ...this.containerTracks];
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

  private buildBackgroundAnimation(continueFromCurrent: boolean) {
    const element = this.background!;
    const { direction, response, duration, startedAt } = this.leg;
    const from = continueFromCurrent
      ? readBackgroundAmount(element)
      : direction === 'forward'
        ? 0
        : 1;
    const to = direction === 'forward' ? 1 : 0;
    element.style.transformOrigin = 'center top';
    element.style.willChange = 'transform';
    // The sink shares the flight's response so depth and travel stay locked.
    const keyframes = sampleSpring(response, 24).map(({ offset, progress }) => ({
      offset,
      transform: getHeroBackgroundSinkTransform(from + (to - from) * progress),
    }));
    return animateAt(element, keyframes, { duration, easing: 'linear' }, startedAt);
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
