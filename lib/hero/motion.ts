'use client';

import {
  HERO_ARC_DISTANCE_RATIO,
  HERO_ARC_MAX_PX,
  HERO_BACKGROUND_SINK_Y_PX,
  HERO_DURATIONS,
  REVEAL_CONTENT_DURATION_MS,
  REVEAL_DELAY_MS,
  REVEAL_DISTANCE_PX,
  REVEAL_SURFACE_DELAY_MS,
  REVEAL_SURFACE_DURATION_MS,
} from './constants';
import {
  getHeroBackgroundSinkTransform,
  getNestedHeroCoverTransform,
  heroGeometryFrames,
  heroMotionFrames,
  interpolateHeroValue,
  writeHeroClipRadius,
  writeHeroFlyerFrame,
  type HeroRect,
} from './geometry';
import {
  screenRectToPlane,
  sizePlaneLayer,
  type HeroScrollPlane,
} from './anchor';
import type { FrameAsset, FrameLease } from './frameCache';
import type { HeroDirection } from './types';

type HeroFlightRole = 'foreground' | 'retiring';

type FlightPresentation = {
  imageTransform: string;
  radius: string;
};

export type HeroMotionPose = {
  rect: HeroRect;
  presentation: FlightPresentation;
  elapsed: number;
};

export type HeroFlight = {
  layer: HTMLElement;
  compensator: HTMLElement;
  flyer: HTMLElement;
  clip: HTMLElement;
  image: HTMLCanvasElement;
  frameLease: FrameLease;
  plane: HeroScrollPlane;
  base: HeroRect;
  sourceRadius: number;
  targetRadius: number;
  sessionId: number;
  imageId: number;
  role: HeroFlightRole;
  release: () => void;
};

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
  from: HeroRect;
  to: HeroRect;
  direction: HeroDirection;
  background: HTMLElement | null;
  overlay: HTMLElement | null;
  floatingBack: HTMLElement | null;
  continueBackground?: boolean;
};

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

function animationAt(
  element: HTMLElement,
  keyframes: Keyframe[],
  timing: KeyframeAnimationOptions,
  startTime: number,
) {
  const animation = element.animate(keyframes, { ...timing, fill: 'both' });
  try {
    animation.startTime = startTime;
  } catch {
    // Older WebKit still shares document.timeline when animations are created
    // in the same task; explicit startTime is an optimization, not correctness.
  }
  return { animation, element };
}

function settle(owners: AnimationOwner[], finish: boolean) {
  owners.forEach(({ animation }) => {
    try {
      if (finish) animation.finish();
      animation.cancel();
    } catch {
      // Animation may already have been canceled by a superseding session.
    }
  });
}

function zeroHost(flight: HeroFlight) {
  return {
    element: flight.layer,
    top: 0,
    left: 0,
    width: flight.plane.host.width,
    height: flight.plane.host.height,
  };
}

function pathArc(from: HeroRect, to: HeroRect, duration: number) {
  const chordX = (to.left + to.width / 2) - (from.left + from.width / 2);
  const chordY = (to.top + to.height / 2) - (from.top + from.height / 2);
  const distance = Math.hypot(chordX, chordY);
  // A screen-space ballistic arc: for a constant downward acceleration, a
  // launch that starts and lands on the chord reaches g·t²/8 above it halfway
  // through. Clamp only the visual extremes, never by device class.
  const seconds = Math.max(0.001, duration / 1000);
  const gravityLift = 2400 * seconds * seconds / 8;
  const distanceLift = Math.min(22, distance * HERO_ARC_DISTANCE_RATIO);
  return { height: Math.min(HERO_ARC_MAX_PX, Math.max(14, gravityLift + distanceLift)) };
}

function rectTravelDistance(from: HeroRect, to: HeroRect) {
  const fromCenterX = from.left + from.width / 2;
  const fromCenterY = from.top + from.height / 2;
  const toCenterX = to.left + to.width / 2;
  const toCenterY = to.top + to.height / 2;
  return Math.hypot(
    toCenterX - fromCenterX,
    toCenterY - fromCenterY,
    (to.width - from.width) / 2,
    (to.height - from.height) / 2,
  );
}

function currentPresentation(flight: HeroFlight): FlightPresentation {
  const radius = getComputedStyle(flight.clip).borderRadius;
  const imageTransform = getComputedStyle(flight.image).transform;
  return {
    radius,
    imageTransform: imageTransform === 'none' ? 'translate3d(0, 0, 0)' : imageTransform,
  };
}

function buildVisualAnimations(
  flight: HeroFlight,
  fromScreen: HeroRect,
  toScreen: HeroRect,
  direction: HeroDirection,
  duration: number,
  startTime: number,
  fromPresentation?: FlightPresentation,
) {
  const from = screenRectToPlane(fromScreen, flight.plane);
  const to = screenRectToPlane(toScreen, flight.plane);
  const host = zeroHost(flight);
  const progressFrames = heroGeometryFrames(direction);
  const arc = pathArc(from, to, duration);
  const fromRadius = fromPresentation
    ? Number.parseFloat(fromPresentation.radius) || 0
    : direction === 'forward' ? flight.sourceRadius : flight.targetRadius;
  const toRadius = direction === 'forward' ? flight.targetRadius : flight.sourceRadius;
  const computedFromImage = getNestedHeroCoverTransform(flight.base, from, host);
  const computedToImage = getNestedHeroCoverTransform(flight.base, to, host);
  const fromImage = fromPresentation?.imageTransform ??
    `translate3d(${computedFromImage.x}px, ${computedFromImage.y}px, 0) scale(${computedFromImage.scaleX}, ${computedFromImage.scaleY})`;
  const toImage = `translate3d(${computedToImage.x}px, ${computedToImage.y}px, 0) scale(${computedToImage.scaleX}, ${computedToImage.scaleY})`;

  const flyerFrames: Keyframe[] = [];
  const clipFrames: Keyframe[] = [];
  const imageFrames: Keyframe[] = [];
  const frameShape = { borderRadius: '', transform: '' };
  const radiusShape = { borderRadius: '' };

  progressFrames.forEach(({ offset, progress }) => {
    // The chord follows the damped response, while lift follows real timeline
    // time. That keeps the apex centered and gives the path a constant-gravity
    // ballistic silhouette instead of warping the parabola through easing.
    const bow = arc.height * 4 * offset * (1 - offset);
    const top = interpolateHeroValue(from.top, to.top, progress) - bow;
    const left = interpolateHeroValue(from.left, to.left, progress);
    const width = interpolateHeroValue(from.width, to.width, progress);
    const height = interpolateHeroValue(from.height, to.height, progress);
    const radius = interpolateHeroValue(fromRadius, toRadius, progress);
    writeHeroFlyerFrame(
      flight.base,
      top,
      left,
      width,
      height,
      host,
      radius,
      frameShape,
    );
    writeHeroClipRadius(flight.base, width, height, radius, radiusShape);
    flyerFrames.push({ offset, transform: frameShape.transform });
    clipFrames.push({ offset, borderRadius: radiusShape.borderRadius });
    imageFrames.push({
      offset,
      transform: progress === 0 && fromPresentation
        ? fromImage
        : progress === 1
          ? toImage
          : undefined,
    });
  });

  // WAAPI cannot interpolate through missing transform values consistently in
  // Firefox, so fill image transforms with numeric component interpolation.
  const parseTransform = (value: string) => {
    try {
      const matrix = new DOMMatrixReadOnly(value);
      return { x: matrix.m41, y: matrix.m42, sx: matrix.a, sy: matrix.d };
    } catch {
      return { x: 0, y: 0, sx: 1, sy: 1 };
    }
  };
  const imageStart = parseTransform(fromImage);
  const imageEnd = parseTransform(toImage);
  progressFrames.forEach(({ progress }, index) => {
    imageFrames[index].transform = `translate3d(${interpolateHeroValue(imageStart.x, imageEnd.x, progress)}px, ${interpolateHeroValue(imageStart.y, imageEnd.y, progress)}px, 0) scale(${interpolateHeroValue(imageStart.sx, imageEnd.sx, progress)}, ${interpolateHeroValue(imageStart.sy, imageEnd.sy, progress)})`;
  });

  const timing = { duration, easing: 'linear' } satisfies KeyframeAnimationOptions;
  const owners = [
    animationAt(flight.flyer, flyerFrames, timing, startTime),
    animationAt(flight.clip, clipFrames, timing, startTime),
    animationAt(flight.image, imageFrames, timing, startTime),
  ];
  return owners;
}

function buildBackgroundAnimation(
  element: HTMLElement,
  direction: HeroDirection,
  continueFromCurrent: boolean,
  startTime: number,
) {
  const from = continueFromCurrent
    ? readBackgroundAmount(element)
    : direction === 'forward' ? 0 : 1;
  const to = direction === 'forward' ? 1 : 0;
  element.style.transformOrigin = 'center top';
  element.style.willChange = 'transform';
  const keyframes = heroMotionFrames(direction).map(({ offset, progress }) => ({
    offset,
    transform: getHeroBackgroundSinkTransform(interpolateHeroValue(from, to, progress)),
  }));
  return animationAt(
    element,
    keyframes,
    { duration: HERO_DURATIONS[direction], easing: 'linear' },
    startTime,
  );
}

function buildOverlayAnimations(
  overlay: HTMLElement,
  floatingBack: HTMLElement | null,
  direction: HeroDirection,
  startTime: number,
) {
  const owners: AnimationOwner[] = [];
  const surface = overlay.querySelector<HTMLElement>('[data-image-detail-surface]');
  if (direction === 'forward') {
    if (surface) {
      owners.push(animationAt(
        surface,
        [{ opacity: 0 }, { opacity: 1 }],
        {
          duration: REVEAL_SURFACE_DURATION_MS,
          delay: REVEAL_SURFACE_DELAY_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
        startTime,
      ));
    }
    const reveal = new Set<HTMLElement>([
      ...overlay.querySelectorAll<HTMLElement>('[data-image-detail-reveal]'),
      ...(floatingBack ? [floatingBack] : []),
    ]);
    reveal.forEach((element) => {
      const role = element.dataset.imageDetailReveal;
      const distance = role === 'body' ? REVEAL_DISTANCE_PX.body : REVEAL_DISTANCE_PX.default;
      const delay = role === 'chrome'
        ? REVEAL_DELAY_MS.chrome
        : role === 'body'
          ? REVEAL_DELAY_MS.body
          : REVEAL_DELAY_MS.default;
      owners.push(animationAt(
        element,
        [
          { opacity: 0, transform: `translate3d(0, ${distance}px, 0)` },
          { opacity: 1, transform: 'translate3d(0, 0, 0)' },
        ],
        {
          duration: REVEAL_CONTENT_DURATION_MS,
          delay,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        },
        startTime,
      ));
    });
    return owners;
  }

  const fadeTargets = new Set<HTMLElement>([
    ...(surface ? [surface] : []),
    ...overlay.querySelectorAll<HTMLElement>('[data-image-detail-reveal]'),
    ...(floatingBack ? [floatingBack] : []),
  ]);
  fadeTargets.forEach((element) => {
    const opacity = numericOpacity(element);
    owners.push(animationAt(
      element,
      [
        { opacity, transform: 'translate3d(0, 0, 0)' },
        { opacity: 0, transform: 'translate3d(0, 10px, 0)' },
      ],
      { duration: HERO_DURATIONS.back, easing: 'cubic-bezier(0.4, 0, 1, 1)' },
      startTime,
    ));
  });
  return owners;
}

export function createHeroFlight({
  asset,
  treatment,
  plane,
  from,
  to,
  direction,
  sessionId,
  imageId,
}: {
  asset: FrameAsset;
  treatment: HTMLElement;
  plane: HeroScrollPlane;
  from: HeroRect;
  to: HeroRect;
  direction: HeroDirection;
  sessionId: number;
  imageId: number;
}): HeroFlight {
  const layer = document.createElement('div');
  layer.className = 'image-hero-flight-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.imageHeroSession = String(sessionId);
  layer.dataset.imageHeroImage = String(imageId);
  layer.dataset.imageHeroRole = 'foreground';

  const compensator = document.createElement('div');
  compensator.className = 'image-hero-flight-compensator';
  const flyer = document.createElement('div');
  flyer.className = 'image-hero-flyer';
  const clip = document.createElement('div');
  clip.className = 'image-hero-flyer-clip';
  const frameLease = asset.acquire();
  let constructed = false;
  try {
    const image = frameLease.canvas;
    image.className = 'image-hero-flyer-image';
    image.setAttribute('aria-hidden', 'true');
    clip.appendChild(image);
    flyer.appendChild(clip);
    compensator.appendChild(flyer);
    layer.appendChild(compensator);
    plane.anchor.appendChild(layer);
    sizePlaneLayer(layer, plane);

    const sourceStyle = getComputedStyle(treatment);
    const targetRadius = direction === 'forward'
      ? 8
      : Number.parseFloat(sourceStyle.borderRadius) || 0;
    const sourceRadius = direction === 'forward'
      ? Number.parseFloat(sourceStyle.borderRadius) || 0
      : 8;
    const baseScreen = direction === 'forward' ? to : from;
    const base = screenRectToPlane(baseScreen, plane);
    flyer.style.width = `${base.width}px`;
    flyer.style.height = `${base.height}px`;
    image.style.position = 'absolute';
    image.style.inset = '0 auto auto 0';
    image.style.display = 'block';
    image.style.width = `${base.width}px`;
    image.style.height = `${base.height}px`;
    image.style.transformOrigin = 'top left';
    image.style.willChange = 'transform';

    // Establish the exact source pose synchronously. Relying on the WAAPI
    // backwards fill for the first paint can expose the untransformed base box
    // while a slower compositor promotes/rasterizes the new canvas layer.
    const initial = screenRectToPlane(from, plane);
    const host = {
      element: layer,
      top: 0,
      left: 0,
      width: plane.host.width,
      height: plane.host.height,
    };
    const initialRadius = direction === 'forward' ? sourceRadius : targetRadius;
    const initialFrame = { borderRadius: '', transform: '' };
    const initialClip = { borderRadius: '' };
    writeHeroFlyerFrame(
      base,
      initial.top,
      initial.left,
      initial.width,
      initial.height,
      host,
      initialRadius,
      initialFrame,
    );
    writeHeroClipRadius(
      base,
      initial.width,
      initial.height,
      initialRadius,
      initialClip,
    );
    const initialImage = getNestedHeroCoverTransform(base, initial, host);
    flyer.style.transform = initialFrame.transform;
    clip.style.borderRadius = initialClip.borderRadius;
    image.style.transform = `translate3d(${initialImage.x}px, ${initialImage.y}px, 0) scale(${initialImage.scaleX}, ${initialImage.scaleY})`;

    let released = false;
    const flight: HeroFlight = {
      layer,
      compensator,
      flyer,
      clip,
      image,
      frameLease,
      plane,
      base,
      sourceRadius,
      targetRadius,
      sessionId,
      imageId,
      role: 'foreground',
      release() {
        if (released) return;
        released = true;
        layer.remove();
        frameLease.release();
      },
    };
    constructed = true;
    return flight;
  } finally {
    if (!constructed) {
      layer.remove();
      frameLease.release();
    }
  }
}

export class HeroMotion {
  readonly flight: HeroFlight;
  private readonly owner = Symbol('hero-motion');
  private readonly background: HTMLElement | null;
  private readonly overlay: HTMLElement | null;
  private readonly floatingBack: HTMLElement | null;
  private direction: HeroDirection;
  private from: HeroRect;
  private to: HeroRect;
  private visual: AnimationOwner[] = [];
  private shared: AnimationOwner[] = [];
  private duration: number;
  private startedAt = 0;
  private retired = false;
  private disposed = false;
  private visualRevision = 0;
  private sharedRevision = 0;
  private pullOffset = 0;
  private landedCompletion = createCompletion();
  private sharedCompletion = createCompletion();

  constructor(options: HeroMotionOptions) {
    this.flight = options.flight;
    this.background = options.background;
    this.overlay = options.overlay;
    this.floatingBack = options.floatingBack;
    this.direction = options.direction;
    this.from = options.from;
    this.to = options.to;
    this.duration = HERO_DURATIONS[options.direction];
    this.start(options.continueBackground ?? false);
  }

  get landed() {
    return this.landedCompletion.promise;
  }

  get finished() {
    return Promise.all([this.landedCompletion.promise, this.sharedCompletion.promise])
      .then(() => undefined);
  }

  currentScreenRect(): HeroRect {
    const rect = this.flight.flyer.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  }

  measurePose(): HeroMotionPose {
    const lead = this.visual[0]?.animation;
    return {
      rect: this.currentScreenRect(),
      presentation: currentPresentation(this.flight),
      elapsed: Number(lead?.currentTime ?? 0),
    };
  }

  setRole(role: HeroFlightRole) {
    this.flight.role = role;
    this.flight.layer.dataset.imageHeroRole = role;
  }

  setPullOffset(distance: number) {
    this.pullOffset = distance;
    this.writeCompensator();
  }

  async reverse(
    destination?: HeroRect,
    plane?: HeroScrollPlane,
    measured?: HeroMotionPose,
  ) {
    if (this.disposed || this.retired) return;
    const pose = measured ?? this.measurePose();
    const current = pose.rect;
    // Pull is expressed by the compensator, not the flight keyframes. Fold its
    // visible pose into `current` and clear it before rebuilding the reverse so
    // every subsequent frame (including the thumbnail landing) is not shifted
    // down by the stale gesture offset.
    if (this.pullOffset) {
      this.pullOffset = 0;
      this.writeCompensator();
    }
    const presentation = pose.presentation;
    this.landedCompletion.resolve();
    this.sharedCompletion.resolve();
    this.landedCompletion = createCompletion();
    this.sharedCompletion = createCompletion();
    this.cancelVisual(false);
    this.cancelShared(false, false);
    if (plane) this.moveToPlane(plane, current, presentation);
    const originalFrom = destination ?? this.from;
    const fullTravel = rectTravelDistance(this.from, this.to);
    const returnTravel = rectTravelDistance(current, originalFrom);
    const returnRatio = fullTravel > 0.5
      ? Math.min(1, Math.max(0, returnTravel / fullTravel))
      : 1;
    this.from = current;
    this.to = originalFrom;
    this.direction = this.direction === 'forward' ? 'back' : 'forward';
    this.duration = Math.max(
      90,
      Math.round(HERO_DURATIONS[this.direction] * (0.35 + 0.65 * Math.sqrt(returnRatio))),
    );
    this.startedAt = Number(document.timeline.currentTime ?? performance.now()) + 1;
    this.startVisual(current, originalFrom, presentation);
    this.startShared(true);
    await this.finished;
  }

  rebuild(
    destination: HeroRect,
    plane?: HeroScrollPlane,
    measured?: HeroMotionPose,
  ) {
    if (this.disposed || this.retired) return;
    const pose = measured ?? this.measurePose();
    const current = pose.rect;
    const presentation = pose.presentation;
    const elapsed = pose.elapsed;
    const remaining = Math.max(80, this.duration - Math.max(0, elapsed));
    this.cancelVisual(false);
    if (plane) this.moveToPlane(plane, current, presentation);
    this.from = current;
    this.to = destination;
    this.duration = remaining;
    this.startedAt = Number(document.timeline.currentTime ?? performance.now()) + 1;
    if (this.landedCompletion.settled) {
      this.applyPresentation(destination, presentation);
      return;
    }
    this.startVisual(current, destination, presentation);
  }

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

  private start(continueBackground: boolean) {
    this.startedAt = Number(document.timeline.currentTime ?? performance.now()) + 1;
    this.startVisual(this.from, this.to);
    this.startShared(continueBackground);
  }

  private writeCompensator() {
    const distance = this.pullOffset;
    this.flight.compensator.style.transform = distance
      ? `translate3d(0, ${distance}px, 0)`
      : '';
  }

  private startShared(continueBackground: boolean) {
    const owners: AnimationOwner[] = [];
    try {
      if (this.background) {
        backgroundOwners.set(this.background, this.owner);
        owners.push(buildBackgroundAnimation(
          this.background,
          this.direction,
          continueBackground,
          this.startedAt,
        ));
      }
      if (this.overlay) {
        owners.push(...buildOverlayAnimations(
          this.overlay,
          this.floatingBack,
          this.direction,
          this.startedAt,
        ));
      }
    } catch {
      settle(owners, false);
      if (this.background && backgroundOwners.get(this.background) === this.owner) {
        this.background.style.transform = '';
        this.background.style.transformOrigin = '';
        this.background.style.willChange = '';
        backgroundOwners.delete(this.background);
      }
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

  private startVisual(
    from: HeroRect,
    to: HeroRect,
    presentation?: FlightPresentation,
  ) {
    let owners: AnimationOwner[] = [];
    try {
      owners = buildVisualAnimations(
        this.flight,
        from,
        to,
        this.direction,
        this.duration,
        this.startedAt,
        presentation,
      );
    } catch {
      this.visual = [];
      this.landedCompletion.resolve();
      return;
    }
    this.visual = owners;
    const revision = ++this.visualRevision;
    if (owners.length === 0) {
      this.landedCompletion.resolve();
      return;
    }
    void Promise.allSettled(owners.map(({ animation }) => animation.finished)).then(() => {
      if (revision !== this.visualRevision) return;
      this.landedCompletion.resolve();
    });
  }

  private cancelVisual(finish: boolean) {
    this.visualRevision += 1;
    settle(this.visual, finish);
    this.visual = [];
  }

  private applyPresentation(screenRect: HeroRect, presentation: FlightPresentation) {
    const local = screenRectToPlane(screenRect, this.flight.plane);
    const host = zeroHost(this.flight);
    const frame = { borderRadius: '', transform: '' };
    writeHeroFlyerFrame(
      this.flight.base,
      local.top,
      local.left,
      local.width,
      local.height,
      host,
      Number.parseFloat(presentation.radius) || 0,
      frame,
    );
    this.flight.flyer.style.transform = frame.transform;
    this.flight.clip.style.borderRadius = presentation.radius;
    this.flight.image.style.transform = presentation.imageTransform;
  }

  private moveToPlane(
    plane: HeroScrollPlane,
    screenRect: HeroRect,
    presentation: FlightPresentation,
  ) {
    this.flight.layer.remove();
    this.flight.plane = plane;
    plane.anchor.appendChild(this.flight.layer);
    sizePlaneLayer(this.flight.layer, plane);
    this.applyPresentation(screenRect, presentation);
  }

  private cancelShared(clearBackground: boolean, settleCompletion: boolean) {
    this.sharedRevision += 1;
    if (this.background && backgroundOwners.get(this.background) === this.owner) {
      const transform = getComputedStyle(this.background).transform;
      this.background.style.transform = transform === 'none' ? 'none' : transform;
    }
    settle(this.shared, false);
    this.shared = [];
    if (settleCompletion) this.sharedCompletion.resolve();
    if (
      this.background &&
      backgroundOwners.get(this.background) === this.owner
    ) {
      if (clearBackground) {
        this.background.style.transform = '';
        this.background.style.transformOrigin = '';
        this.background.style.willChange = '';
      }
      backgroundOwners.delete(this.background);
    }
  }
}
