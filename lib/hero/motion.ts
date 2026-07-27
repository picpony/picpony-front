'use client';

import {
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
  REVEAL_SURFACE_DELAY_MS,
  REVEAL_SURFACE_DURATION_MS,
  HERO_BACKGROUND_SINK_Y_PX,
} from './constants';
import {
  getHeroBackgroundSinkTransform,
  heroRectCenterDistance,
  type HeroRect,
} from './geometry';
import {
  applyFlightPose,
  buildFlightKeyframes,
  evaluateLeg,
  getFlightArc,
  getFlightRadii,
  moveFlightToPlane,
  setFlightRole,
  type HeroFlight,
  type HeroFlightRole,
  type HeroLeg,
  type HeroPose,
} from './flight';
import { planeRectToScreen, screenRectToPlane, type HeroScrollPlane } from './plane';
import { sampleSpring, springVelocityFromSpeed } from './spring';
import type { HeroDirection } from './types';

type AnimationOwner = {
  animation: Animation;
  element: HTMLElement;
};

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
    return Math.min(1, Math.max(0, matrix.m42 / HERO_BACKGROUND_SINK_Y_PX));
  } catch {
    return 0;
  }
}

function revealRole(element: HTMLElement) {
  const role = element.dataset.imageDetailReveal;
  return role === 'chrome' || role === 'header' || role === 'body' ? role : 'default';
}

/**
 * Detail chrome cascade. The surface establishes the plane, then chrome, header
 * and body arrive in reading order — a clean staircase rather than one blur.
 */
function buildOverlayAnimations(
  overlay: HTMLElement,
  floatingBack: HTMLElement | null,
  direction: HeroDirection,
  startTime: number,
) {
  const owners: AnimationOwner[] = [];
  const surface = overlay.querySelector<HTMLElement>(HERO_SURFACE_SELECTOR);

  if (direction === 'forward') {
    if (surface) {
      owners.push(animateAt(
        surface,
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: REVEAL_SURFACE_DURATION_MS,
          delay: REVEAL_SURFACE_DELAY_MS,
          easing: REVEAL_EASING,
        },
        startTime,
      ));
    }
    const reveal = new Set<HTMLElement>([
      ...overlay.querySelectorAll<HTMLElement>(HERO_REVEAL_SELECTOR),
      ...(floatingBack ? [floatingBack] : []),
    ]);
    reveal.forEach((element) => {
      const role = revealRole(element);
      owners.push(animateAt(
        element,
        [
          { opacity: 0, transform: `translate3d(0, ${REVEAL_DISTANCE_PX[role]}px, 0)` },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: REVEAL_CONTENT_DURATION_MS,
          delay: REVEAL_DELAY_MS[role],
          easing: REVEAL_EASING,
        },
        startTime,
      ));
    });
    return owners;
  }

  // Leaving: everything sinks together so the flyer is the only focus.
  const fadeTargets = new Set<HTMLElement>([
    ...(surface ? [surface] : []),
    ...overlay.querySelectorAll<HTMLElement>(HERO_REVEAL_SELECTOR),
    ...(floatingBack ? [floatingBack] : []),
  ]);
  fadeTargets.forEach((element) => {
    owners.push(animateAt(
      element,
      [
        { opacity: numericOpacity(element), transform: 'translate3d(0, 0, 0)' },
        { opacity: 0, transform: `translate3d(0, ${HIDE_DISTANCE_PX}px, 0)` },
      ],
      { duration: HERO_DURATIONS.back, easing: HIDE_EASING },
      startTime,
    ));
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
  private leg: HeroLeg;
  private visual: AnimationOwner[] = [];
  private shared: AnimationOwner[] = [];
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

    const { direction } = options;
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
      arc: getFlightArc(from, to, duration, direction),
      startedAt: timelineNow() + 1,
    };

    this.startVisual();
    this.startShared(options.continueBackground ?? false);
  }

  get landed() {
    return this.landedCompletion.promise;
  }

  get finished() {
    return Promise.all([this.landedCompletion.promise, this.sharedCompletion.promise])
      .then(() => undefined);
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
    this.flight.compensator.style.transform = distance
      ? `translate3d(0, ${distance}px, 0)`
      : '';
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
      moveFlightToPlane(
        this.flight,
        plane,
        screenRectToPlane(currentScreen, plane),
        pose.radius,
      );
    }
    const from = screenRectToPlane(currentScreen, this.flight.plane);
    const to = screenRectToPlane(destination ?? originScreen, this.flight.plane);

    // Shorter trips home get proportionally shorter durations.
    const direction: HeroDirection = previous.direction === 'forward' ? 'back' : 'forward';
    const fullTravel = heroRectCenterDistance(previous.from, previous.to);
    const returnTravel = heroRectCenterDistance(from, to);
    const ratio = fullTravel > 0.5
      ? Math.min(1, Math.max(0, returnTravel / fullTravel))
      : 1;
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
      base.rate,
    );

    this.leg = {
      from,
      to,
      fromRadius: pose.radius,
      toRadius: getFlightRadii(this.flight, direction).to,
      direction,
      response: { rate: base.rate, velocity },
      duration,
      arc: getFlightArc(from, to, duration, direction),
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
      moveFlightToPlane(
        this.flight,
        plane,
        screenRectToPlane(currentScreen, plane),
        pose.radius,
      );
    }
    const from = screenRectToPlane(currentScreen, this.flight.plane);
    const to = screenRectToPlane(destination, this.flight.plane);

    if (this.landedCompletion.settled) {
      // Already landed: just sit on the corrected destination.
      applyFlightPose(this.flight, to, previous.toRadius);
      this.leg = { ...previous, from: to, to, duration: 0, arc: 0, startedAt: timelineNow() };
      return;
    }

    // Preserve the current speed so a resize mid-flight is not a visible restart.
    const duration = Math.max(80, previous.duration - pose.elapsed);
    const velocity = springVelocityFromSpeed(
      pose.speed,
      heroRectCenterDistance(from, to),
      duration,
      previous.response.rate,
    );
    this.leg = {
      ...previous,
      from,
      to,
      fromRadius: pose.radius,
      response: { rate: previous.response.rate, velocity },
      duration,
      arc: getFlightArc(from, to, duration, previous.direction),
      startedAt: timelineNow() + 1,
    };
    this.startVisual();
  }

  /** Demote to a background layer that will fade out under a newer flight. */
  retire() {
    if (this.retired || this.disposed) return;
    this.retired = true;
    this.setRole('retiring');
    this.cancelShared(false, true);
  }

  fadeRetiring(duration = 160) {
    if (this.disposed) return Promise.resolve();
    try {
      const fade = this.flight.layer.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration, easing: 'ease-out', fill: 'forwards' },
      );
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
    settle(this.shared, true);
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
    let owners: AnimationOwner[] = [];
    try {
      const keyframes = buildFlightKeyframes(this.flight, this.leg);
      const timing = {
        duration: this.leg.duration,
        easing: 'linear',
      } satisfies KeyframeAnimationOptions;
      owners = [
        animateAt(this.flight.flyer, keyframes.flyer, timing, this.leg.startedAt),
        animateAt(this.flight.clip, keyframes.clip, timing, this.leg.startedAt),
        animateAt(this.flight.image, keyframes.image, timing, this.leg.startedAt),
      ];
    } catch {
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
    try {
      if (this.background) {
        backgroundOwners.set(this.background, this.owner);
        owners.push(this.buildBackgroundAnimation(continueBackground));
      }
      if (this.overlay) {
        owners.push(...buildOverlayAnimations(
          this.overlay,
          this.floatingBack,
          this.leg.direction,
          this.leg.startedAt,
        ));
      }
    } catch {
      settle(owners, false);
      this.disownBackground(true);
      this.shared = [];
      this.sharedCompletion.resolve();
      return;
    }
    this.shared = owners;
    const revision = ++this.sharedRevision;
    if (owners.length === 0) {
      this.sharedCompletion.resolve();
      return;
    }
    void Promise.allSettled(owners.map(({ animation }) => animation.finished)).then(() => {
      if (revision !== this.sharedRevision) return;
      this.sharedCompletion.resolve();
    });
  }

  private buildBackgroundAnimation(continueFromCurrent: boolean) {
    const element = this.background!;
    const { direction, response, duration, startedAt } = this.leg;
    const from = continueFromCurrent
      ? readBackgroundAmount(element)
      : direction === 'forward' ? 0 : 1;
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
    settle(this.shared, false);
    this.shared = [];
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
