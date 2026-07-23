'use client';

import type { HeroDirection } from './state';
import {
  HERO_BACKGROUND_SINK_Y_PX,
  HERO_DURATIONS,
  getHeroBackgroundSinkTransform,
  getHeroFlyerFrame,
  getLocalHeroRect,
  getNestedHeroCoverTransform,
  heroGeometryFrames,
  heroMotionFrames,
  heroPhysicalProgress,
  interpolateHeroValue,
  type HeroHost,
  type HeroRect,
} from './geometry';
import {
  HERO_BACKGROUND_SELECTOR,
  HERO_BACKGROUND_VISUAL_SELECTOR,
  HERO_DETAIL_OVERLAY_SELECTOR,
  getHeroRect,
  restoreHeroElement,
  syncStageScroll,
} from './dom';

type ShadeLayer = {
  element: HTMLElement;
};

export type Flight = {
  layer: HTMLElement;
  compensator: HTMLElement;
  flyer: HTMLElement;
  image: HTMLCanvasElement;
  shade: ShadeLayer | null;
  startRect: HeroRect;
  radius: string;
  host: HeroHost;
};

export type FlightMotion = {
  finished: Promise<void>;
  reverse: () => Promise<void>;
  finish: () => void;
  retarget: (x: number, y: number, endpoint?: 'from' | 'to') => void;
  cancel: () => void;
};

const MIN_REVERSIBLE_TIME_MS = 0.5;
const REVEAL_SURFACE_DELAY_MS = 16;
const REVEAL_SURFACE_DURATION_MS = 295;
const REVEAL_CONTENT_DURATION_MS = 255;
const REVEAL_DELAY_MS = { chrome: 30, body: 60, default: 40 } as const;
const REVEAL_DISTANCE_PX = { body: 12, default: 18 } as const;
const SUPERSEDE_FADE_MS = 160;
const HERO_ARC_DISTANCE_RATIO = 0.12;
const HERO_ARC_MAX_PX = 48;

function heroNow() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export function fadeOutFlightLayer(layer: HTMLElement, motion: FlightMotion) {
  const cleanup = () => {
    motion.cancel();
    layer.remove();
  };
  try {
    const fade = layer.animate(
      [{ opacity: '1' }, { opacity: '0' }],
      { duration: SUPERSEDE_FADE_MS, easing: 'ease-out', fill: 'forwards' },
    );
    fade.finished.then(cleanup, cleanup);
  } catch {
    cleanup();
  }
}

// Race a stage promise against both an interrupt (Esc/back 鈫?reverse) and a
// supersede (a newer transition 鈫?stand down). Re-checks both flags after the
// race so a signal landing in the same tick is never missed.

export function createLayer(host: HeroHost) {
  const layer = document.createElement('div');
  layer.className = 'image-hero-flight-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.top = `${host.top}px`;
  layer.style.left = `${host.left}px`;
  layer.style.width = `${host.width}px`;
  layer.style.height = `${host.height}px`;
  layer.style.borderRadius = window.getComputedStyle(host.element).borderRadius;
  document.body.appendChild(layer);
  return layer;
}

function createShade(
  flyer: HTMLElement,
  treatment: HTMLElement,
  direction: HeroDirection,
): ShadeLayer | null {
  const owner = treatment.closest<HTMLElement>('a');
  const shades = owner
    ? Array.from(owner.querySelectorAll<HTMLElement>('[data-image-hero-shade]'))
    : [];
  if (shades.length === 0) return null;

  const element = document.createElement('div');
  element.setAttribute('aria-hidden', 'true');
  element.style.position = 'absolute';
  element.style.zIndex = '3';
  element.style.inset = '0';
  element.style.pointerEvents = 'none';
  element.style.willChange = 'opacity';
  element.style.opacity = direction === 'back' ? '0' : '1';

  shades.forEach((shade) => {
    const clone = shade.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-image-hero-shade');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.pointerEvents = 'none';
    clone.style.inset = '0';
    clone.style.width = '100%';
    clone.style.height = '100%';
    clone.style.borderRadius = '0';
    clone.style.transform = 'none';
    element.appendChild(clone);
  });
  flyer.appendChild(element);
  return { element };
}

function isTransparent(color: string) {
  return color === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color);
}

function getFlightBackground(element: HTMLElement, host: HeroHost) {
  let current: HTMLElement | null = element;
  while (current) {
    const color = window.getComputedStyle(current).backgroundColor;
    if (!isTransparent(color)) return color;
    if (current === host.element) break;
    current = current.parentElement;
  }
  return window.getComputedStyle(host.element).backgroundColor;
}

export function createFlight(
  layer: HTMLElement,
  element: HTMLElement,
  previewFrame: HTMLCanvasElement,
  host: HeroHost,
  treatment: HTMLElement,
  direction: HeroDirection,
): Flight {
  const startRect = getHeroRect(element);
  const computed = window.getComputedStyle(element);
  const radius = Number.parseFloat(computed.borderRadius) || 0;
  const start = getLocalHeroRect(startRect, host);

  const compensator = document.createElement('div');
  compensator.className = 'image-hero-flight-compensator';
  compensator.style.transform = 'translate3d(0, 0, 0)';

  const flyer = document.createElement('div');
  flyer.className = 'image-hero-flyer';
  flyer.style.width = `${startRect.width}px`;
  flyer.style.height = `${startRect.height}px`;
  flyer.style.backgroundColor = getFlightBackground(element, host);
  flyer.style.borderRadius = `${radius}px`;
  flyer.style.transform = `translate3d(${start.left}px, ${start.top}px, 0)`;

  const flyerImage = previewFrame;
  flyerImage.style.position = 'absolute';
  flyerImage.style.left = '0';
  flyerImage.style.top = '0';
  flyerImage.style.width = `${startRect.width}px`;
  flyerImage.style.height = `${startRect.height}px`;
  flyerImage.style.transform = `translate3d(${start.left}px, ${start.top}px, 0)`;
  flyerImage.style.transformOrigin = 'top left';
  flyerImage.style.willChange = 'transform';
  flyerImage.style.display = 'block';
  flyerImage.style.backfaceVisibility = 'hidden';
  flyerImage.style.objectFit = 'fill';
  flyer.appendChild(flyerImage);

  const shade = createShade(flyer, treatment, direction);
  compensator.appendChild(flyer);
  layer.appendChild(compensator);
  return {
    layer,
    compensator,
    flyer,
    image: flyerImage,
    shade,
    startRect,
    radius: computed.borderRadius,
    host,
  };
}

export function animateFlight(
  flight: Flight,
  from: HeroRect,
  to: HeroRect,
  toRadius: string,
  direction: HeroDirection,
): FlightMotion {
  const duration = HERO_DURATIONS[direction];
  const startRadius = Number.parseFloat(flight.radius) || 0;
  const endRadius = Number.parseFloat(toRadius) || 0;
  const base = direction === 'forward' ? to : from;
  const fromOuter = getHeroFlyerFrame(base, from, flight.host, startRadius);
  const fromImage = getNestedHeroCoverTransform(base, from, flight.host);
  const toImage = getNestedHeroCoverTransform(base, to, flight.host);
  const frames = heroGeometryFrames(direction);

  // The flight path as a function of eased progress (0 = source, 1 = target).
  // A normal-direction bow is folded into both axes; forward keyframes and an
  // interrupted reverse sample these so the flyer retraces the exact same
  // curve, radius and cover-crop when it turns back.
  const chordX = (to.left + to.width / 2) - (from.left + from.width / 2);
  const chordY = (to.top + to.height / 2) - (from.top + from.height / 2);
  const chordLength = Math.hypot(chordX, chordY) || 1;
  const arcHeight = Math.min(Math.abs(chordX) * HERO_ARC_DISTANCE_RATIO, HERO_ARC_MAX_PX);
  // Unit normal to the chord, flipped to carry an upward bias where the chord
  // is not vertical, so the bow bends with the geometry instead of always
  // lifting straight up.
  let normalX = -chordY / chordLength;
  let normalY = chordX / chordLength;
  if (normalY > 0) {
    normalX = -normalX;
    normalY = -normalY;
  }
  const arcBow = (progress: number) => arcHeight * 4 * progress * (1 - progress);
  const pathRect = (progress: number): HeroRect => {
    const bow = arcBow(progress);
    return {
      top: interpolateHeroValue(from.top, to.top, progress) + normalY * bow,
      left: interpolateHeroValue(from.left, to.left, progress) + normalX * bow,
      width: interpolateHeroValue(from.width, to.width, progress),
      height: interpolateHeroValue(from.height, to.height, progress),
    };
  };
  const pathRadius = (progress: number) => interpolateHeroValue(startRadius, endRadius, progress);
  const pathImageTransform = (progress: number) =>
    `translate3d(${interpolateHeroValue(fromImage.x, toImage.x, progress)}px, ${interpolateHeroValue(fromImage.y, toImage.y, progress)}px, 0) scale(${interpolateHeroValue(fromImage.scaleX, toImage.scaleX, progress)}, ${interpolateHeroValue(fromImage.scaleY, toImage.scaleY, progress)})`;
  const pathShade = (progress: number) => (direction === 'forward' ? 1 - progress : progress);

  flight.flyer.style.width = `${base.width}px`;
  flight.flyer.style.height = `${base.height}px`;
  flight.flyer.style.borderRadius = fromOuter.borderRadius;
  flight.flyer.style.transform = fromOuter.transform;
  flight.image.style.width = `${base.width}px`;
  flight.image.style.height = `${base.height}px`;
  flight.image.style.objectFit = 'cover';
  flight.image.style.objectPosition = '50% 50%';
  flight.image.style.transform = `translate3d(${fromImage.x}px, ${fromImage.y}px, 0) scale(${fromImage.scaleX}, ${fromImage.scaleY})`;

  const geometry = flight.flyer.animate(
    frames.map(({ offset, progress }) => ({
      offset,
      ...getHeroFlyerFrame(base, pathRect(progress), flight.host, pathRadius(progress)),
    })),
    { duration, easing: 'linear', fill: 'forwards' },
  );
  const imageMotion = flight.image.animate(
    frames.map(({ offset, progress }) => ({
      offset,
      transform: pathImageTransform(progress),
    })),
    { duration, easing: 'linear', fill: 'forwards' },
  );

  const shadeMotion = flight.shade
    ? flight.shade.element.animate(
          frames.map(({ offset, progress }) => ({
            offset,
            opacity: pathShade(progress),
          })),
          { duration, easing: 'linear', fill: 'forwards' },
        )
    : null;

  const animations = [geometry, imageMotion, ...(shadeMotion ? [shadeMotion] : [])];
  const offsets = {
    from: { x: 0, y: 0 },
    to: { x: 0, y: 0 },
  };
  const transient = { x: 0, y: 0, progress: 0 };
  let compensationFrame = 0;
  let endpoint: 'from' | 'to' = 'to';
  let reversing = false;
  let animationsCancelled = false;
  // The progress-carrying animation and its timing are swapped when the flight
  // reverses: a fresh 'back' spring replaces the forward one so the flyer
  // decelerates into the thumbnail instead of replaying the forward ease-out
  // backwards (which reads as an ease-in that accelerates and stops dead).
  let activeAnimations = animations;
  let progressAnimation: Animation = geometry;
  let progressDuration = duration;
  let progressSpring: HeroDirection = direction;
  let reverseStartProgress = 1;
  // Forward-flight progress in the original from鈫抰o space (0 at the source, 1
  // at the destination). During a reverse it walks reverseStartProgress鈫? as
  // the back spring plays, so scroll compensation keeps interpolating in the
  // same space regardless of which animation is currently driving the flyer.
  const currentProgress = () => {
    const raw = Math.min(
      1,
      Math.max(0, Number(progressAnimation.currentTime ?? 0) / progressDuration),
    );
    const eased = heroPhysicalProgress(raw, progressSpring);
    return reversing ? reverseStartProgress * (1 - eased) : eased;
  };
  const compensationAt = (progress: number) => {
    const baseX = interpolateHeroValue(offsets.from.x, offsets.to.x, progress);
    const baseY = interpolateHeroValue(offsets.from.y, offsets.to.y, progress);
    const denominator = reversing ? transient.progress : 1 - transient.progress;
    const distance = reversing ? progress : 1 - progress;
    const transientAmount = denominator <= 0.0001
      ? 0
      : Math.min(1, Math.max(0, distance / denominator));
    return {
      x: baseX + transient.x * transientAmount,
      y: baseY + transient.y * transientAmount,
    };
  };
  const rebaseTransient = (progress: number, x: number, y: number) => {
    transient.progress = progress;
    transient.x = x - interpolateHeroValue(offsets.from.x, offsets.to.x, progress);
    transient.y = y - interpolateHeroValue(offsets.from.y, offsets.to.y, progress);
  };
  let lastCompensationTransform = '';
  const syncCompensation = (progress = currentProgress()) => {
    const { x, y } = compensationAt(progress);
    const transform = `translate3d(${x}px, ${y}px, 0)`;
    if (transform === lastCompensationTransform) return;
    lastCompensationTransform = transform;
    flight.compensator.style.transform = transform;
  };
  const keepCompensationSynced = () => {
    compensationFrame = 0;
    syncCompensation();
    if (progressAnimation.playState === 'running' || progressAnimation.pending) {
      compensationFrame = requestAnimationFrame(keepCompensationSynced);
    }
  };
  const startCompensationSync = () => {
    if (!compensationFrame) {
      compensationFrame = requestAnimationFrame(keepCompensationSynced);
    }
  };
  const settleEndpoint = () => {
    const finalRect = endpoint === 'to' ? to : from;
    const finalRadius = endpoint === 'to' ? endRadius : startRadius;
    const finalImage = endpoint === 'to' ? toImage : fromImage;
    const finalOuter = getHeroFlyerFrame(base, finalRect, flight.host, finalRadius);
    flight.flyer.style.borderRadius = finalOuter.borderRadius;
    flight.flyer.style.transform = finalOuter.transform;
    flight.image.style.transform = `translate3d(${finalImage.x}px, ${finalImage.y}px, 0) scale(${finalImage.scaleX}, ${finalImage.scaleY})`;
    if (shadeMotion && flight.shade) {
      flight.shade.element.style.opacity = endpoint === 'to'
        ? direction === 'forward' ? '0' : '1'
        : direction === 'forward' ? '1' : '0';
    }
    syncCompensation(endpoint === 'to' ? 1 : 0);
  };
  const finished = Promise.allSettled([
    geometry.finished,
    imageMotion.finished,
    shadeMotion?.finished ?? Promise.resolve(),
  ]).then(() => {
    // A reverse cancels these forward animations (rejecting their finished
    // promises) and owns the final settle itself; don't double-settle here.
    if (!reversing) settleEndpoint();
  });

  return {
    finished,
    reverse() {
      endpoint = 'from';
      const currentTime = Math.min(duration, Math.max(0, Number(geometry.currentTime ?? 0)));
      const q = heroPhysicalProgress(currentTime / duration, direction);
      const currentOffset = compensationAt(q);
      reversing = true;
      reverseStartProgress = q;
      rebaseTransient(q, currentOffset.x, currentOffset.y);
      animations.forEach((animation) => animation.cancel());

      if (currentTime <= MIN_REVERSIBLE_TIME_MS) {
        animationsCancelled = true;
        settleEndpoint();
        return Promise.resolve();
      }

      // Retrace the exact forward path from the current progress `q` back to the
      // source, remapped through the 'back' spring so the flyer decelerates into
      // the thumbnail instead of accelerating (which a plain reversed playback
      // of the ease-out forward curve would do).
      const reverseDuration = Math.min(currentTime, HERO_DURATIONS.back);
      const backFrames = heroGeometryFrames('back');
      const geometryReverse = flight.flyer.animate(
        backFrames.map(({ offset, progress }) => {
          const traced = q * (1 - progress);
          return { offset, ...getHeroFlyerFrame(base, pathRect(traced), flight.host, pathRadius(traced)) };
        }),
        { duration: reverseDuration, easing: 'linear', fill: 'forwards' },
      );
      const imageReverse = flight.image.animate(
        backFrames.map(({ offset, progress }) => ({
          offset,
          transform: pathImageTransform(q * (1 - progress)),
        })),
        { duration: reverseDuration, easing: 'linear', fill: 'forwards' },
      );
      const shadeReverse = flight.shade
        ? flight.shade.element.animate(
            backFrames.map(({ offset, progress }) => ({
              offset,
              opacity: pathShade(q * (1 - progress)),
            })),
            { duration: reverseDuration, easing: 'linear', fill: 'forwards' },
          )
        : null;

      activeAnimations = [geometryReverse, imageReverse, ...(shadeReverse ? [shadeReverse] : [])];
      progressAnimation = geometryReverse;
      progressDuration = reverseDuration;
      progressSpring = 'back';
      startCompensationSync();
      return Promise.allSettled(
        activeAnimations.map((animation) => animation.finished),
      ).then(() => { settleEndpoint(); });
    },
    finish() {
      if (!animationsCancelled) {
        activeAnimations.forEach((animation) => animation.finish());
      }
      settleEndpoint();
    },
    retarget(x, y, targetEndpoint = 'to') {
      if (
        Math.abs(offsets[targetEndpoint].x - x) < 0.01 &&
        Math.abs(offsets[targetEndpoint].y - y) < 0.01
      ) {
        return;
      }
      offsets[targetEndpoint].x = x;
      offsets[targetEndpoint].y = y;
      const progress = currentProgress();
      rebaseTransient(progress, x, y);
      syncCompensation(progress);
      startCompensationSync();
    },
    cancel() {
      if (compensationFrame) cancelAnimationFrame(compensationFrame);
      animationsCancelled = true;
      activeAnimations.forEach((animation) => animation.cancel());
    },
  };
}

function currentBackgroundSinkAmount(element: HTMLElement) {
  const transform = window.getComputedStyle(element).transform;
  if (!transform || transform === 'none') return 0;
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    return Math.min(1, Math.max(0, matrix.m42 / HERO_BACKGROUND_SINK_Y_PX));
  } catch {
    return 0;
  }
}

export function animateBackground(direction: HeroDirection, continueFromCurrent = false) {
  const element = document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR) ??
    document.querySelector<HTMLElement>(HERO_BACKGROUND_SELECTOR);
  if (!element) return null;

  const toAmount = direction === 'forward' ? 1 : 0;
  // A preempt hands the background over mid-motion: start from wherever it is
  // now so B's sink continues seamlessly from A's rise. Otherwise a close
  // starts sunk (behind the detail) and rises; an open starts flat and sinks.
  const fromAmount = continueFromCurrent
    ? currentBackgroundSinkAmount(element)
    : direction === 'forward' ? 0 : 1;
  element.style.transformOrigin = 'center center';
  element.style.willChange = 'transform';
  element.style.transform = getHeroBackgroundSinkTransform(fromAmount);
  const frames = heroMotionFrames(direction).map(({ offset, progress }) => ({
    offset,
    transform: getHeroBackgroundSinkTransform(interpolateHeroValue(fromAmount, toAmount, progress)),
  }));
  const animation = element.animate(frames, {
    duration: HERO_DURATIONS[direction],
    easing: 'linear',
    fill: 'forwards',
  });
  return { element, animation };
}

export function finishBackground(motion: ReturnType<typeof animateBackground>) {
  if (!motion) return;
  motion.animation.cancel();
  motion.element.style.transform = '';
  motion.element.style.transformOrigin = '';
  motion.element.style.willChange = '';
}

export function cancelBackgroundAnimation(motion: ReturnType<typeof animateBackground>) {
  motion?.animation.cancel();
}

export function reverseAnimation(animation: Animation | null | undefined) {
  if (!animation) return Promise.resolve();
  try {
    const timing = animation.effect?.getComputedTiming();
    const duration = Math.max(1, Number(timing?.duration ?? HERO_DURATIONS.forward));
    const currentTime = Math.min(duration, Math.max(0, Number(animation.currentTime ?? 0)));
    animation.pause();
    animation.currentTime = currentTime;
    if (currentTime <= MIN_REVERSIBLE_TIME_MS) return Promise.resolve();
    animation.playbackRate = -(currentTime / Math.min(currentTime, HERO_DURATIONS.back));
    animation.play();
    return animation.finished.then(() => undefined).catch(() => undefined);
  } catch {
    return Promise.resolve();
  }
}

function settleAnimation(animation: Animation | null | undefined) {
  if (!animation) return;
  try {
    animation.finish();
  } catch {
    // Cleanup may have already canceled the animation.
  }
}

export function animateDetailExit(duration: number) {
  const frames = heroMotionFrames('back');
  const animations: Animation[] = [];
  const overlays = Array.from(
    document.querySelectorAll<HTMLElement>(HERO_DETAIL_OVERLAY_SELECTOR),
  );
  const pointerEvents = overlays.map((overlay) => ({
    overlay,
    value: overlay.style.pointerEvents,
  }));

  overlays.forEach((overlay) => {
    overlay.style.pointerEvents = 'none';
    const surface = overlay.querySelector<HTMLElement>('[data-image-detail-surface]');
    if (surface) {
      const opacity = Number.parseFloat(getComputedStyle(surface).opacity) || 0;
      animations.push(surface.animate(
        frames.map(({ offset, progress }) => {
          const value = Math.min(1, Math.max(0, progress));
          return { offset, opacity: opacity * (1 - value) };
        }),
        { duration, easing: 'linear', fill: 'forwards' },
      ));
    }

    const floatingOwner = overlay.hasAttribute('data-image-hero-stage') ? 'stage' : 'route';
    const foregrounds = [
      overlay.querySelector<HTMLElement>('.image-detail-overlay-scroll'),
      overlay.querySelector<HTMLElement>('[data-image-detail-back-button]'),
      document.querySelector<HTMLElement>(
        `[data-image-detail-floating-back="${floatingOwner}"]`,
      ),
    ].filter((element): element is HTMLElement => Boolean(element));
    foregrounds.forEach((element) => {
      const computed = getComputedStyle(element);
      const opacity = Number.parseFloat(computed.opacity) || 0;
      const transform = computed.transform === 'none' ? 'translate3d(0, 0, 0)' : computed.transform;
      animations.push(element.animate(
        frames.map(({ offset, progress }) => {
          const value = Math.min(1, Math.max(0, progress));
          return {
            offset,
            opacity: opacity * (1 - value),
            transform: value === 0
              ? transform
              : `translate3d(0, ${10 * value}px, 0) scale(${1 - 0.002 * value})`,
          };
        }),
        { duration, easing: 'linear', fill: 'forwards' },
      ));
    });
  });

  return {
    finished: Promise.allSettled(animations.map((animation) => animation.finished)),
    finish() {
      animations.forEach(settleAnimation);
    },
    restore() {
      animations.forEach((animation) => animation.cancel());
      pointerEvents.forEach(({ overlay, value }) => {
        if (overlay.isConnected) overlay.style.pointerEvents = value;
      });
    },
  };
}

function syncedAnimation(
  element: HTMLElement,
  keyframes: Keyframe[],
  startedAt: number,
  startAt: number,
  duration: number,
) {
  const elapsed = heroNow() - startedAt;
  const animation = element.animate(keyframes, {
    duration,
    delay: Math.max(0, startAt - elapsed),
    easing: 'linear',
    fill: 'both',
  });
  if (elapsed > startAt) {
    animation.currentTime = Math.min(duration, elapsed - startAt);
  }
  return animation;
}

export function revealOverlay(
  overlay: HTMLElement,
  startedAt: number,
  isCurrent: () => boolean = () => true,
) {
  const frames = heroMotionFrames('forward');
  const animations: Array<{ element: HTMLElement; animation: Animation }> = [];
  const surface = overlay.querySelector<HTMLElement>('[data-image-detail-surface]');
  if (surface) {
    animations.push({
      element: surface,
      animation: syncedAnimation(
        surface,
        frames.map(({ offset, progress }) => ({
          offset,
          opacity: Math.min(1, progress * 1.12),
        })),
        startedAt,
        REVEAL_SURFACE_DELAY_MS,
        REVEAL_SURFACE_DURATION_MS,
      ),
    });
  }

  const floatingOwner = overlay.hasAttribute('data-image-hero-stage') ? 'stage' : 'route';
  const revealElements = new Set<HTMLElement>([
    ...overlay.querySelectorAll<HTMLElement>('[data-image-detail-reveal]'),
    ...document.querySelectorAll<HTMLElement>(
      `[data-image-detail-floating-back="${floatingOwner}"][data-image-detail-reveal]`,
    ),
  ]);
  revealElements.forEach((element) => {
    const role = element.dataset.imageDetailReveal;
    const startAt = role === 'chrome'
      ? REVEAL_DELAY_MS.chrome
      : role === 'body'
        ? REVEAL_DELAY_MS.body
        : REVEAL_DELAY_MS.default;
    const distance = role === 'body' ? REVEAL_DISTANCE_PX.body : REVEAL_DISTANCE_PX.default;
    animations.push({
      element,
      animation: syncedAnimation(
        element,
        frames.map(({ offset, progress }) => ({
          offset,
          opacity: Math.min(1, progress * 1.18),
          transform: `translate3d(0, ${distance * (1 - progress)}px, 0)`,
        })),
        startedAt,
        startAt,
        REVEAL_CONTENT_DURATION_MS,
      ),
    });
  });

  return Promise.allSettled(animations.map(({ animation }) => animation.finished)).then(() => {
    animations.forEach(({ element, animation }) => {
      if (isCurrent()) {
        element.style.opacity = '1';
        element.style.transform = 'none';
      }
      animation.cancel();
    });
  });
}

export function revealRouteOverlay(
  overlay: HTMLElement,
  startedAt: number,
  isCurrent: () => boolean,
) {
  if (!isCurrent()) return Promise.resolve();
  const revealed = revealOverlay(overlay, startedAt, isCurrent);
  requestAnimationFrame(() => {
    // A superseded opening can leave this callback queued while the next
    // opening has already claimed the shared `opening` phase. The owner check
    // prevents that stale callback from copying scroll into the new route.
    if (!isCurrent()) return;
    const stage = document.querySelector<HTMLElement>('[data-image-hero-stage]');
    const stageScroller = stage?.querySelector<HTMLElement>('.image-detail-overlay-scroll');
    const routeScroller = overlay.querySelector<HTMLElement>('.image-detail-overlay-scroll');
    if (stageScroller && routeScroller) {
      routeScroller.scrollLeft = stageScroller.scrollLeft;
      routeScroller.scrollTop = stageScroller.scrollTop;
      syncStageScroll(routeScroller.scrollLeft, routeScroller.scrollTop);
    }
  });
  return revealed;
}

export async function settleRevealAnimations(overlay: HTMLElement) {
  const floatingOwner = overlay.hasAttribute('data-image-hero-stage') ? 'stage' : 'route';
  const elements = new Set<HTMLElement>([
    ...overlay.querySelectorAll<HTMLElement>(
      '[data-image-detail-surface], [data-image-detail-reveal]',
    ),
    ...document.querySelectorAll<HTMLElement>(
      `[data-image-detail-floating-back="${floatingOwner}"][data-image-detail-reveal]`,
    ),
  ]);
  const animations = Array.from(elements).flatMap((element) => element.getAnimations());
  animations.forEach(settleAnimation);
  await Promise.allSettled(animations.map((animation) => animation.finished));
}

export async function handoffStage(
  target: HTMLElement | null,
  targetOpacity: string,
  beforeCommit?: () => Promise<void>,
  shouldAbort: () => boolean = () => false,
) {
  if (shouldAbort()) return false;
  const stage = document.querySelector<HTMLElement>('[data-image-hero-stage]');
  const targetOverlay = target?.closest<HTMLElement>(HERO_DETAIL_OVERLAY_SELECTOR);
  const routeOverlay = targetOverlay && !targetOverlay.hasAttribute('data-image-hero-stage')
    ? targetOverlay
    : Array.from(document.querySelectorAll<HTMLElement>(HERO_DETAIL_OVERLAY_SELECTOR))
        .find((element) => !element.hasAttribute('data-image-hero-stage')) ?? null;

  if (stage && routeOverlay) {
    await settleRevealAnimations(routeOverlay);
    if (shouldAbort()) return false;
    await beforeCommit?.();
    if (shouldAbort()) return false;
    const routeScroller = routeOverlay.querySelector<HTMLElement>('.image-detail-overlay-scroll');
    const routeScrollerWillChange = routeScroller?.style.willChange;
    if (routeScroller) routeScroller.style.willChange = 'opacity, transform';
    const routeElements = new Set<HTMLElement>([
      ...routeOverlay.querySelectorAll<HTMLElement>(
        '[data-image-detail-surface], [data-image-detail-reveal]',
      ),
      ...document.querySelectorAll<HTMLElement>(
        '[data-image-detail-floating-back="route"][data-image-detail-reveal]',
      ),
      ...(target ? [target] : []),
    ]);
    const previousStyles = Array.from(routeElements, (element) => ({
      element,
      opacity: element.style.opacity,
      transform: element.style.transform,
      transition: element.style.transition,
      visibility: element.style.visibility,
    }));

    previousStyles.forEach(({ element }) => {
      element.style.opacity = '1';
      element.style.transform = 'none';
      element.style.transition = 'none';
      element.style.visibility = 'visible';
    });

    if (shouldAbort()) {
      previousStyles.forEach(({ element, opacity, transform, transition, visibility }) => {
        element.style.opacity = opacity;
        element.style.transform = transform;
        element.style.transition = transition;
        element.style.visibility = visibility;
      });
      if (routeScroller) routeScroller.style.willChange = routeScrollerWillChange ?? '';
      return false;
    }

    const stageSurface = stage.querySelector<HTMLElement>('[data-image-detail-surface]');
    if (stageSurface) stageSurface.style.visibility = 'hidden';
    delete document.documentElement.dataset.imageHeroTransition;

    stage.querySelectorAll<HTMLElement>('[data-image-hero-stage-foreground]')
      .forEach((element) => { element.style.visibility = 'hidden'; });
    document.querySelectorAll<HTMLElement>('[data-image-detail-floating-back="stage"]')
      .forEach((element) => { element.style.visibility = 'hidden'; });

    previousStyles.forEach(({ element, opacity, transform, transition, visibility }) => {
      element.style.opacity = opacity;
      element.style.transform = transform;
      element.style.transition = transition;
      element.style.visibility = visibility;
    });
    if (target) restoreHeroElement(target, targetOpacity);
    // Keep the composited handoff for the frame that swaps Stage for the
    // routed detail, then release it. Leaving `will-change` here keeps an
    // otherwise static scroll surface promoted for the rest of the detail view.
    if (routeScroller) {
      requestAnimationFrame(() => {
        if (routeScroller.isConnected) routeScroller.style.willChange = routeScrollerWillChange ?? '';
      });
    }
    return true;
  }

  await beforeCommit?.();
  if (shouldAbort()) return false;
  if (target) restoreHeroElement(target, targetOpacity);
  delete document.documentElement.dataset.imageHeroTransition;
  return true;
}
