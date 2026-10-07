'use client';

import { motionTier } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';
import { RELEASE_SAMPLE_WINDOW_MS, TOUCH_AXIS_LOCK_PX } from './constants';
import { noteHeroInteraction } from './input';
import { relaunch, sampleProgress } from './progress';
import type { SpringResponse } from './spring';

/**
 * The detail's own half of 上一张 / 下一张 (decision 19): the shared axis X its content takes
 * from one picture to the next, and the horizontal swipe that pages it under a finger. The
 * engine's half — which picture is published, and the history ladder that names it — is
 * `HeroController.requestDetailStep`.
 *
 * **Sequential, and that is M3's shared axis rather than an approximation of it.**
 * `MaterialSharedAxis` fades the outgoing view out over the first stretch of the transition and
 * the incoming one in over the rest, so no instant shows both; what overlaps is only the
 * outgoing slide, after its content has already gone. So one tree carries both halves: the
 * outgoing picture leaves (FastEffects, sliding toward the side it leaves by), the content swaps
 * in a single commit while nothing is visible, and the incoming one arrives from the other side
 * (DefaultSpatial for the travel, DefaultEffects for the fade). No clone of the outgoing page is
 * taken, so nothing has to copy a page that holds a comment thread.
 *
 * Direction `1` is 下一张: the outgoing content leaves to the left and the incoming one enters
 * from the right, the way a list reads.
 */

export type StepDirection = 1 | -1;

/** A running step motion. `finished` is `true` when it ran to its end, `false` if cancelled. */
export type StepMotion = {
  readonly finished: Promise<boolean>;
  cancel(): void;
};

/** `MaterialSharedAxis`' slide distance, 30dp. The reduced tier's weak form is 8px. */
const STEP_TRAVEL_PX = 30;
const REDUCED_STEP_TRAVEL_PX = 8;

/* The two response families in normalised time, the same pair `PULL_RELEASE_RESPONSE` and the
   flight use: ζ0.9 for a release that travels (spatial), ζ1.0 for one that must not overshoot. */
const SPATIAL_RESPONSE: SpringResponse = { rate: 5.13, velocity: 0, damping: 0.9 };
const EFFECTS_RESPONSE: SpringResponse = { rate: 6.65, velocity: 0, damping: 1 };
/** Keyframes per released leg — the table size `sampleProgress` is tuned for. */
const RELEASE_SAMPLES = 24;

const DONE: StepMotion = { finished: Promise.resolve(true), cancel() {} };

const running = new WeakMap<HTMLElement, Animation[]>();
/**
 * The fade of a picture arriving — the incoming half's, or a return's — among what `running`
 * holds: a finger taking the content over lets it finish. A leaving fade is never kept, or the
 * content would stay invisible under the finger.
 */
const arrivals = new WeakMap<HTMLElement, Animation>();

function stepTravel() {
  const tier = motionTier();
  return tier === 'off' ? 0 : tier === 'reduced' ? REDUCED_STEP_TRAVEL_PX : STEP_TRAVEL_PX;
}

function translate(x: number) {
  return `translate3d(${x}px, 0, 0)`;
}

/** The rendered pose — the drag's inline offset, or wherever a running step motion has got to. */
function readPose(element: HTMLElement) {
  const style = getComputedStyle(element);
  let x = 0;
  if (style.transform && style.transform !== 'none') {
    try {
      x = new DOMMatrixReadOnly(style.transform).m41;
    } catch {
      x = 0;
    }
  }
  const parsedOpacity = Number.parseFloat(style.opacity);
  const opacity = Number.isFinite(parsedOpacity) ? parsedOpacity : 1;
  return { x, opacity };
}

/**
 * Where `element` is right now — a finger's offset, or wherever an interrupted step motion had
 * got to — with this module's animations on it cancelled and the drag's inline offset cleared.
 * Read before cancelling: the computed style is the rendered pose only while they still run.
 */
function takePose(element: HTMLElement) {
  const pose = readPose(element);
  running.get(element)?.forEach((animation) => animation.cancel());
  running.delete(element);
  arrivals.delete(element);
  element.style.transform = '';
  return pose;
}

function track(element: HTMLElement, animations: Animation[], arrival: Animation | null = null): StepMotion {
  running.set(element, animations);
  if (arrival) arrivals.set(element, arrival);
  else arrivals.delete(element);
  let cancelled = false;
  const finished = Promise.all(animations.map((animation) => animation.finished)).then(
    () => !cancelled,
    () => false,
  );
  return {
    finished,
    cancel() {
      cancelled = true;
      animations.forEach((animation) => animation.cancel());
      if (running.get(element) === animations) running.delete(element);
      if (arrival && arrivals.get(element) === arrival) arrivals.delete(element);
    },
  };
}

/** A spring leg from `from` to `to` that leaves at `speed` px/ms (along the travel), as keyframes. */
function releasedKeyframes(
  from: number,
  to: number,
  speed: number,
  duration: number,
  base: SpringResponse,
): Keyframe[] {
  const distance = Math.abs(to - from);
  const model = relaunch(base, speed, distance, duration);
  return sampleProgress(model, RELEASE_SAMPLES).map(({ offset, progress }) => ({
    offset,
    transform: translate(from + (to - from) * progress),
  }));
}

/**
 * The outgoing half: the content slides toward the side it leaves by and fades out, and holds
 * there (`fill: forwards`) until the swap replaces it. `speed` is a released finger's velocity in
 * px/ms (negative is leftward); the slide then leaves at that speed instead of from rest, and
 * reaches further for a fast flick so the first frame after the lift never slows the page down.
 *
 * Returns a finished motion when motion is off: the swap is then a cut.
 */
export function playStepExit(element: HTMLElement, direction: StepDirection, speed = 0): StepMotion {
  const pose = takePose(element);
  if (motionTier() === 'off') return DONE;
  const { duration, easing } = springTiming('fastEffects');
  const along = speed * -direction;
  const distance = Math.max(stepTravel(), (Math.max(0, along) * duration) / 2);
  const to = pose.x - direction * distance;
  const slide =
    along > 0
      ? element.animate(releasedKeyframes(pose.x, to, along, duration, EFFECTS_RESPONSE), {
          duration,
          easing: 'linear',
          fill: 'forwards',
        })
      : element.animate([{ transform: translate(pose.x) }, { transform: translate(to) }], {
          duration,
          easing,
          fill: 'forwards',
        });
  const fade = element.animate([{ opacity: pose.opacity }, { opacity: 0 }], {
    duration,
    easing,
    fill: 'forwards',
  });
  return track(element, [slide, fade]);
}

/** The incoming half: in from the side the step points to, on the default spatial/effects pair. */
export function playStepEnter(element: HTMLElement, direction: StepDirection): StepMotion {
  takePose(element);
  if (motionTier() === 'off') return DONE;
  const spatial = springTiming('defaultSpatial');
  const effects = springTiming('defaultEffects');
  const slide = element.animate(
    [{ transform: translate(direction * stepTravel()) }, { transform: translate(0) }],
    { duration: spatial.duration, easing: spatial.easing },
  );
  const fade = element.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: effects.duration,
    easing: effects.easing,
  });
  return track(element, [slide, fade], fade);
}

/**
 * A swipe that did not page: the content returns to rest from wherever the finger left it, at
 * the speed it left — FastSpatial, as the switch handle and every other small travel home. The
 * reduced tier takes the critically damped shape, so it stops where it arrives. A finger that took
 * over a picture still fading in (`takeOverStepMotion`) may lift before the fade ends; the rest of
 * it runs from where it is, on DefaultEffects, rather than snapping to full.
 */
export function playStepReturn(element: HTMLElement, speed = 0): StepMotion {
  const pose = takePose(element);
  element.style.opacity = '';
  if (motionTier() === 'off') return DONE;
  const animations: Animation[] = [];
  if (Math.abs(pose.x) >= 0.5) {
    const { duration } = springTiming('fastSpatial');
    const base = motionTier() === 'reduced' ? EFFECTS_RESPONSE : SPATIAL_RESPONSE;
    const along = pose.x > 0 ? -speed : speed;
    animations.push(
      element.animate(releasedKeyframes(pose.x, 0, along, duration, base), {
        duration,
        easing: 'linear',
      }),
    );
  }
  let fade: Animation | null = null;
  if (pose.opacity < 0.99) {
    const effects = springTiming('defaultEffects');
    fade = element.animate([{ opacity: pose.opacity }, { opacity: 1 }], {
      duration: effects.duration,
      easing: effects.easing,
    });
    animations.push(fade);
  }
  return animations.length ? track(element, animations, fade) : DONE;
}

/** Cancel whatever step motion is on `element`, leaving it at rest. */
export function settleStepMotion(element: HTMLElement | null) {
  if (element) takePose(element);
}

/**
 * A finger taking the content over mid-step — a second swipe while the incoming half is still
 * arriving, or while a swipe that did not page is still springing home. The travel stops where
 * it is and becomes the drag's origin, so nothing jumps under the finger, as a native pager takes
 * a new drag from its in-flight pose; the fade runs on to its end on its own clock, since how far
 * a picture has faded in says nothing about where the finger holds it. Returns the origin.
 */
export function takeOverStepMotion(element: HTMLElement | null): number {
  if (!element) return 0;
  const { x } = readPose(element);
  const arrival = arrivals.get(element);
  const keep = arrival && arrival.playState === 'running' ? arrival : null;
  running.get(element)?.forEach((animation) => {
    if (animation !== keep) animation.cancel();
  });
  if (keep) {
    // Still tracked, so the next leg (the release's exit or return) reads it and replaces it.
    running.set(element, [keep]);
  } else {
    running.delete(element);
    arrivals.delete(element);
  }
  // Hold the pose until the drag's first frame writes its own.
  element.style.transform = Math.abs(x) >= 0.5 ? translate(x) : '';
  return x;
}

/**
 * A finger past an end: the content follows at a diminishing rate instead of stopping dead
 * (the resistance curve iOS popularised — the constant 0.55 is its own). `dimension` is the
 * width the pull is measured against.
 */
export function rubberBand(offset: number, dimension: number) {
  const size = Math.max(1, dimension);
  return Math.sign(offset) * size * (1 - 1 / ((Math.abs(offset) * 0.55) / size + 1));
}

export type StepSwipeRelease = {
  /** The page's offset at the lift, after any rubber-banding. */
  offset: number;
  /** px/ms over the trailing sample window; negative is leftward. */
  speed: number;
  /** The step the swipe asked for, or `null` to return to rest. */
  direction: StepDirection | null;
};

export type StepSwipeOptions = {
  /** Where a swipe may start: the picture. */
  target: HTMLElement;
  canStart(): boolean;
  /** Whether a step that way can go anywhere — a neighbour, or a page still to load. */
  canStep(direction: StepDirection): boolean;
  /**
   * Whether the drag meets resistance that way — nothing loaded there yet, whether a page is
   * still to come or the list has ended. Defaults to "no step that way".
   */
  resists?(direction: StepDirection): boolean;
  onStart(): void;
  onDrag(offset: number): void;
  onRelease(release: StepSwipeRelease): void;
};

/** A swipe pages once it has carried the content a quarter of the picture, or 96px… */
const SWIPE_COMMIT_FRACTION = 0.25;
const SWIPE_COMMIT_MAX_PX = 96;
/** …or is a flick: this fast, this far, and still moving the way it was dragged. */
const SWIPE_FLING_PX_PER_MS = 0.3;
const SWIPE_MIN_FLING_PX = 24;
/** The click a drag leaves behind lands a few ms after the lift. */
const SWIPE_CLICK_SUPPRESSION_MS = 400;
/**
 * The band along a video's bottom edge where its native controls sit — the timeline, which a
 * horizontal drag scrubs. A swipe does not start there; anywhere else on a video it pages, as on
 * a still.
 */
const MEDIA_CONTROLS_BAND_PX = 64;

function startsOnMediaControls(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof HTMLVideoElement) || !target.controls) return false;
  return event.clientY >= target.getBoundingClientRect().bottom - MEDIA_CONTROLS_BAND_PX;
}

/**
 * The horizontal pager on the picture. Touch only — a mouse has the arrows and the keys.
 *
 * It shares its first events with the pull-down dismiss and the browser's own pinch and
 * vertical scroll, and the axis is what arbitrates: both recognisers decide on the same
 * `TOUCH_AXIS_LOCK_PX` move — this one takes a horizontal lead, the dismiss a downward one, and
 * each walks away from the other's. The picture's `touch-action` leaves `pan-x` out, so the
 * browser never claims the horizontal drag first; a second finger is a pinch, never a page.
 */
export function bindStepSwipe({
  target,
  canStart,
  canStep,
  resists = (direction) => !canStep(direction),
  onStart,
  onDrag,
  onRelease,
}: StepSwipeOptions) {
  let pointerId: number | null = null;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let width = 1;
  let offset = 0;
  let frame = 0;
  let samples: Array<{ x: number; time: number }> = [];
  let suppressClickUntil = 0;
  let listening = false;

  const speed = () => {
    const first = samples[0];
    const last = samples.at(-1);
    if (!first || !last || last === first) return 0;
    return (last.x - first.x) / Math.max(1, last.time - first.time);
  };

  const offsetFor = (dx: number) => {
    if (dx === 0) return 0;
    return resists(dx < 0 ? 1 : -1) ? rubberBand(dx, width) : dx;
  };

  const flush = () => {
    frame = 0;
    onDrag(offset);
  };

  const stopListening = () => {
    if (!listening) return;
    listening = false;
    window.removeEventListener('pointermove', handleMove, true);
    window.removeEventListener('pointerup', handleUp, true);
    window.removeEventListener('pointercancel', handleCancel, true);
  };

  const reset = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pointerId = null;
    dragging = false;
    samples = [];
    stopListening();
  };

  const release = (direction: StepDirection | null, releaseSpeed: number) => {
    const last = offset;
    reset();
    onRelease({ offset: last, speed: releaseSpeed, direction });
  };

  function handleDown(event: PointerEvent) {
    if (pointerId !== null) {
      // A second finger is a pinch: hand the gesture back to the browser.
      if (event.pointerId === pointerId) return;
      if (dragging) release(null, 0);
      else reset();
      return;
    }
    if (event.pointerType !== 'touch' || !event.isPrimary || startsOnMediaControls(event) || !canStart()) {
      return;
    }
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    width = target.getBoundingClientRect().width || 1;
    offset = 0;
    samples = [{ x: 0, time: event.timeStamp }];
    listening = true;
    window.addEventListener('pointermove', handleMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handleUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', handleCancel, { capture: true, passive: true });
  }

  function handleMove(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < TOUCH_AXIS_LOCK_PX) return;
      if (Math.abs(dx) <= Math.abs(dy) || !canStart()) {
        reset();
        return;
      }
      dragging = true;
      onStart();
      noteHeroInteraction();
    }
    if (event.cancelable) event.preventDefault();
    samples.push({ x: dx, time: event.timeStamp });
    const cutoff = event.timeStamp - RELEASE_SAMPLE_WINDOW_MS;
    while (samples.length > 2 && samples[1].time < cutoff) samples.shift();
    offset = offsetFor(dx);
    if (!frame) frame = requestAnimationFrame(flush);
  }

  function handleUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    if (!dragging) {
      reset();
      return;
    }
    if (event.cancelable) event.preventDefault();
    const dx = event.clientX - startX;
    samples.push({ x: dx, time: event.timeStamp });
    offset = offsetFor(dx);
    const releaseSpeed = speed();
    const direction: StepDirection = dx < 0 ? 1 : -1;
    const far = Math.abs(dx) >= Math.min(width * SWIPE_COMMIT_FRACTION, SWIPE_COMMIT_MAX_PX);
    const flung =
      Math.abs(dx) >= SWIPE_MIN_FLING_PX &&
      Math.abs(releaseSpeed) >= SWIPE_FLING_PX_PER_MS &&
      Math.sign(releaseSpeed) === Math.sign(dx);
    suppressClickUntil = performance.now() + SWIPE_CLICK_SUPPRESSION_MS;
    release(canStep(direction) && (far || flung) ? direction : null, releaseSpeed);
  }

  function handleCancel(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    if (dragging) release(null, 0);
    else reset();
  }

  /* The picture's own click opens the lightbox; the one a drag leaves behind must not. */
  const handleClick = (event: MouseEvent) => {
    if (performance.now() > suppressClickUntil) return;
    suppressClickUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  };

  target.addEventListener('pointerdown', handleDown, { capture: true, passive: true });
  target.addEventListener('click', handleClick, { capture: true });
  return () => {
    const wasDragging = dragging;
    reset();
    if (wasDragging) onRelease({ offset: 0, speed: 0, direction: null });
    target.removeEventListener('pointerdown', handleDown, true);
    target.removeEventListener('click', handleClick, true);
  };
}
