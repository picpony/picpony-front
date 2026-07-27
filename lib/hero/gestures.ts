'use client';

import {
  DISMISS_DISTANCE_PX,
  DISMISS_MIN_FLING_DISTANCE_PX,
  DISMISS_VELOCITY_PX_PER_MS,
  DRAG_ACTIVATION_PX,
  RELEASE_SAMPLE_WINDOW_MS,
  TOUCH_AXIS_LOCK_PX,
} from './constants';
import { createPullSample, PULL_REST, type HeroPullSample } from './pull';
import { heroFrameScheduler } from './scheduler';
import { noteHeroInteraction } from './input';

/** How the gesture ended, plus the fling speed that ended it. */
export type HeroPullRelease = {
  sample: HeroPullSample;
  /** px/ms of raw finger travel over the trailing sample window. */
  velocity: number;
};

export type HeroDismissGestureOptions = {
  /** Geometry bounds for hit testing. */
  target: HTMLElement;
  /**
   * Event surface, when the visual target is intentionally pointer-transparent
   * (the opening Stage/flyer). Capture here while bounds still come from
   * `target`.
   */
  listenTarget?: EventTarget;
  scroller: HTMLElement;
  canStart: () => boolean;
  onPull: (sample: HeroPullSample) => void;
  onCancel: (release: HeroPullRelease) => void | Promise<void>;
  onCommit: (release: HeroPullRelease) => void | Promise<void>;
};

type DistanceSample = {
  distance: number;
  time: number;
};

type ReleasedClick = {
  x: number;
  y: number;
  committed: boolean;
  expiresAt: number;
};

const POINTER_WATCHDOG_MS = 2000;
const CLICK_SUPPRESSION_MS = 1200;
const CLICK_SUPPRESSION_RADIUS_PX = 24;
/**
 * A browser emits its click a few ms after the pointerup we already acted on.
 * Long enough to cover that gap, short enough that a deliberate second tap is
 * never eaten.
 */
const NATIVE_CLICK_SUPPRESSION_MS = 350;

/**
 * Pull-to-dismiss recognizer.
 *
 * Only reports intent; the visual response belongs to `HeroPullSurface`. Guards
 * a number of real mobile behaviours: touch-action is declared before
 * pointerdown so the compositor decision is not a race, the synthetic click
 * that follows a drag is swallowed, and a release that lands on the
 * just-dismissed (now transparent) route is forwarded to the gallery card
 * underneath, because some compositors keep the old hit-test target for one
 * more touch.
 */
export function bindHeroDismissGesture({
  target,
  listenTarget,
  scroller,
  canStart,
  onPull,
  onCancel,
  onCommit,
}: HeroDismissGestureOptions) {
  const gestureOwner = `hero-dismiss:${Math.random().toString(36).slice(2)}`;
  const frameOwner = {};
  let disposed = false;
  let tracking = false;
  let dragging = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let latest = PULL_REST;
  let samples: DistanceSample[] = [];
  let releasedClick: ReleasedClick | null = null;
  let postCommitBridgeUntil = 0;
  /** Set when we synthesized a click, to swallow the browser's own duplicate. */
  let suppressNativeClickUntil = 0;
  let pointerWatchdog = 0;
  let settleGeneration = 0;
  let candidateListenersAttached = false;

  // At the top edge, scrolling down stays compositor-native (the finger moves
  // up) while the opposite direction is reserved for dismiss. Declaring this
  // before pointerdown avoids a device-dependent cancelability race.
  const originalTouchAction = scroller.style.touchAction;
  let writtenTouchAction = '';
  const syncTouchAction = () => {
    const next = scroller.scrollTop <= 0.5
      ? 'pan-x pan-down pinch-zoom'
      : 'pan-x pan-y pinch-zoom';
    if (next === writtenTouchAction) return;
    writtenTouchAction = next;
    scroller.style.touchAction = next;
  };

  const setGestureState = (state: 'dragging' | 'settling' | 'dismissing') => {
    const root = document.documentElement;
    root.dataset.imageHeroDismissGesture = state;
    root.dataset.imageHeroDismissOwner = gestureOwner;
  };

  const clearGestureState = () => {
    const root = document.documentElement;
    if (root.dataset.imageHeroDismissOwner !== gestureOwner) return;
    delete root.dataset.imageHeroDismissGesture;
    delete root.dataset.imageHeroDismissOwner;
  };

  const releaseVelocity = () => {
    const first = samples[0];
    const last = samples.at(-1) ?? first;
    if (!first || !last) return 0;
    return (last.distance - first.distance) / Math.max(1, last.time - first.time);
  };

  const finishGesture = (
    callback: (release: HeroPullRelease) => void | Promise<void>,
    release: HeroPullRelease,
    immediate: boolean,
  ) => {
    const generation = ++settleGeneration;
    const run = () => Promise.resolve(callback(release))
      .catch(() => undefined)
      .finally(() => {
        if (generation !== settleGeneration || disposed) return;
        latest = PULL_REST;
        clearGestureState();
      });

    if (immediate) {
      // Commit the release pose and open the closing transaction inside this
      // pointerup task. Waiting a frame left the outgoing route interactive for
      // one extra mobile tap, unlike button and History closes.
      heroFrameScheduler.cancel(frameOwner);
      try {
        onPull(release.sample);
      } catch {
        // The controller reconciles a detached surface through the commit.
      }
      void run();
      return;
    }
    // The final touch sample may still be queued for this frame; let it commit
    // before the spring starts, so the first settle frame never jumps.
    void heroFrameScheduler.settled().then(run, run);
  };

  const publish = (sample: HeroPullSample) => {
    latest = sample;
    heroFrameScheduler.request(frameOwner, { read: () => latest, write: onPull });
  };

  const record = (raw: number, time: number) => {
    const sample = createPullSample(raw);
    publish(sample);
    samples.push({ distance: sample.raw, time });
    const cutoff = time - RELEASE_SAMPLE_WINDOW_MS;
    while (samples.length > 2 && samples[1].time < cutoff) samples.shift();
  };

  const resetPointer = () => {
    if (pointerWatchdog) window.clearTimeout(pointerWatchdog);
    pointerWatchdog = 0;
    tracking = false;
    dragging = false;
    pointerId = null;
    samples = [];
  };

  const detachCandidateListeners = () => {
    if (!candidateListenersAttached) return;
    candidateListenersAttached = false;
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', handlePointerUp, true);
    window.removeEventListener('pointercancel', handlePointerCancel, true);
  };

  const attachCandidateListeners = () => {
    if (candidateListenersAttached || disposed) return;
    candidateListenersAttached = true;
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handlePointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerCancel, { capture: true, passive: true });
  };

  const armPointerWatchdog = () => {
    if (pointerWatchdog) window.clearTimeout(pointerWatchdog);
    pointerWatchdog = window.setTimeout(() => {
      pointerWatchdog = 0;
      if (tracking) handlePointerCancel();
    }, POINTER_WATCHDOG_MS);
  };

  const beginDrag = () => {
    // A fresh pull owns any in-progress settle; bumping the generation retires
    // the previous callback so it cannot clear this gesture's state.
    settleGeneration += 1;
    dragging = true;
    setGestureState('dragging');
    noteHeroInteraction();
  };

  /** Drag can only continue while the surface is at its top edge. */
  const dragStillValid = (deltaX: number, deltaY: number) => (
    deltaY > 0 &&
    Math.abs(deltaX) < deltaY &&
    scroller.scrollTop <= 0.5 &&
    canStart()
  );

  function handlePointerDown(event: PointerEvent) {
    if (
      disposed ||
      tracking ||
      event.pointerType !== 'touch' ||
      !event.isPrimary ||
      scroller.scrollTop > 0.5 ||
      !canStart()
    ) {
      return;
    }
    const bounds = target.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      return;
    }
    tracking = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    latest = PULL_REST;
    samples = [{ distance: 0, time: event.timeStamp }];
    armPointerWatchdog();
    attachCandidateListeners();
  }

  function handlePointerMove(event: PointerEvent) {
    if (!tracking || event.pointerId !== pointerId) return;
    armPointerWatchdog();
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (!dragging) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < TOUCH_AXIS_LOCK_PX) {
        // Hold the axis open until the direction is unambiguous.
        if (deltaY > 0 && Math.abs(deltaY) >= Math.abs(deltaX) && event.cancelable) {
          event.preventDefault();
        }
        return;
      }
      if (!dragStillValid(deltaX, deltaY)) {
        resetPointer();
        detachCandidateListeners();
        return;
      }
      beginDrag();
    }
    if (event.cancelable) event.preventDefault();
    record(deltaY, event.timeStamp);
  }

  function handlePointerUp(event: PointerEvent) {
    if (!tracking || event.pointerId !== pointerId) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (!dragging) {
      if (deltaY <= DRAG_ACTIVATION_PX || !dragStillValid(deltaX, deltaY)) {
        resetPointer();
        detachCandidateListeners();
        return;
      }
      beginDrag();
    }
    if (event.cancelable) event.preventDefault();
    record(deltaY, event.timeStamp);

    const velocity = releaseVelocity();
    const shouldCommit = canStart() && (
      latest.raw >= DISMISS_DISTANCE_PX || (
        latest.raw >= DISMISS_MIN_FLING_DISTANCE_PX &&
        velocity >= DISMISS_VELOCITY_PX_PER_MS
      )
    );
    releasedClick = {
      x: event.clientX,
      y: event.clientY,
      committed: shouldCommit,
      expiresAt: performance.now() + CLICK_SUPPRESSION_MS,
    };
    postCommitBridgeUntil = shouldCommit ? performance.now() + CLICK_SUPPRESSION_MS : 0;

    const release: HeroPullRelease = { sample: latest, velocity };
    resetPointer();
    detachCandidateListeners();
    setGestureState(shouldCommit ? 'dismissing' : 'settling');
    finishGesture(shouldCommit ? onCommit : onCancel, release, shouldCommit);
  }

  function handlePointerCancel(event?: PointerEvent) {
    if (!tracking || (event && event.pointerId !== pointerId)) return;
    if (dragging) {
      const release: HeroPullRelease = { sample: latest, velocity: releaseVelocity() };
      resetPointer();
      setGestureState('settling');
      finishGesture(onCancel, release, false);
    } else {
      resetPointer();
    }
    detachCandidateListeners();
  }

  const findGalleryCard = (x: number, y: number) => {
    for (const element of document.elementsFromPoint(x, y)) {
      const card = element.closest<HTMLAnchorElement>('a.image-hero-card-link');
      if (card && !target.contains(card)) return card;
    }
    return null;
  };

  const forwardToGalleryCard = (x: number, y: number) => {
    const card = findGalleryCard(x, y);
    if (!card) return false;
    releasedClick = null;
    postCommitBridgeUntil = 0;
    queueMicrotask(() => {
      if (!card.isConnected) return;
      card.click();
      // Arm only after our own dispatch has been delivered, or the guard would
      // swallow the very click it exists to substitute for. The browser's
      // duplicate for this same tap arrives in a later task, once hit testing
      // has refreshed onto the card, and that one must not activate again.
      suppressNativeClickUntil = performance.now() + NATIVE_CLICK_SUPPRESSION_MS;
    });
    return true;
  };

  const isClosing = () => document.documentElement.dataset.imageHeroState === 'closing.flight';

  // Some mobile compositors keep the just-dismissed route as the hit-test target
  // for one more touch even after it becomes pointer-transparent. Transfer that
  // activation to the gallery card actually under the finger.
  const handlePostCommitPointerUp = (event: PointerEvent) => {
    if (
      performance.now() > postCommitBridgeUntil ||
      !isClosing() ||
      event.pointerType !== 'touch' ||
      !(event.target instanceof Node) ||
      !target.contains(event.target)
    ) {
      return;
    }
    if (!forwardToGalleryCard(event.clientX, event.clientY)) return;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
  };

  /**
   * Swallow the browser's native click for a tap we already forwarded.
   *
   * Listens at the document rather than on `target`, because the duplicate lands
   * on the gallery card — outside the dismissed route — once hit testing
   * refreshes. Without this, the same tap activates twice and the second
   * activation reverses the flight the first one started.
   */
  const handleDuplicateClick = (event: MouseEvent) => {
    if (performance.now() > suppressNativeClickUntil) return;
    suppressNativeClickUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const handleClick = (event: MouseEvent) => {
    if (releasedClick && performance.now() > releasedClick.expiresAt) releasedClick = null;
    const release = releasedClick;
    if (release) {
      const isGestureClick = Math.hypot(
        event.clientX - release.x,
        event.clientY - release.y,
      ) <= CLICK_SUPPRESSION_RADIUS_PX;
      releasedClick = null;
      if (isGestureClick) {
        // Swallow the synthetic click a drag leaves behind.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!release.committed) return;
    }
    if (performance.now() > postCommitBridgeUntil || !isClosing()) return;
    if (!forwardToGalleryCard(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePageExit = () => {
    if (tracking) handlePointerCancel();
  };

  const pointerSurface = listenTarget ?? target;
  syncTouchAction();
  scroller.addEventListener('scroll', syncTouchAction, { passive: true });
  pointerSurface.addEventListener('pointerdown', handlePointerDown as EventListener, {
    capture: true,
    passive: true,
  });
  window.addEventListener('pointerup', handlePostCommitPointerUp, {
    capture: true,
    passive: false,
  });
  window.addEventListener('click', handleDuplicateClick, { capture: true });
  target.addEventListener('click', handleClick, { capture: true });
  window.addEventListener('blur', handlePageExit);
  window.addEventListener('pagehide', handlePageExit);

  return () => {
    disposed = true;
    settleGeneration += 1;
    pointerSurface.removeEventListener('pointerdown', handlePointerDown as EventListener, true);
    window.removeEventListener('pointerup', handlePostCommitPointerUp, true);
    window.removeEventListener('click', handleDuplicateClick, true);
    detachCandidateListeners();
    target.removeEventListener('click', handleClick, true);
    window.removeEventListener('blur', handlePageExit);
    window.removeEventListener('pagehide', handlePageExit);
    scroller.removeEventListener('scroll', syncTouchAction);
    if (scroller.style.touchAction === writtenTouchAction) {
      scroller.style.touchAction = originalTouchAction;
    }
    heroFrameScheduler.cancel(frameOwner);
    resetPointer();
    releasedClick = null;
    postCommitBridgeUntil = 0;
    suppressNativeClickUntil = 0;
    clearGestureState();
  };
}
