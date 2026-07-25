'use client';

import {
  BACKGROUND_REVEAL_DISTANCE_PX,
  DISMISS_DISTANCE_PX,
  DISMISS_MIN_FLING_DISTANCE_PX,
  DISMISS_VELOCITY_PX_PER_MS,
  DRAG_ACTIVATION_PX,
  DRAG_RESISTANCE_PX,
  RELEASE_SAMPLE_WINDOW_MS,
  SURFACE_FADE_DISTANCE_PX,
  TOUCH_AXIS_LOCK_PX,
} from './constants';
import { heroFrameScheduler, noteHeroInteraction } from './anchor';

export type HeroPullSample = {
  raw: number;
  distance: number;
  opacity: number;
  backgroundAmount: number;
};

export type HeroDismissGestureOptions = {
  target: HTMLElement;
  /**
   * Optional event surface used when the visual target is intentionally
   * pointer-transparent (the opening Stage/flyer). Capture there while the
   * geometry bounds still come from `target`.
   */
  listenTarget?: EventTarget;
  scroller: HTMLElement;
  canStart: () => boolean;
  onPull: (sample: HeroPullSample) => void;
  onCancel: (sample: HeroPullSample) => void | Promise<void>;
  onCommit: (sample: HeroPullSample) => void | Promise<void>;
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

function resistedDistance(raw: number) {
  const positive = Math.max(0, raw);
  return positive / (1 + positive / DRAG_RESISTANCE_PX);
}

function pullSample(rawDistance: number): HeroPullSample {
  const raw = Math.max(0, rawDistance);
  return {
    raw,
    distance: resistedDistance(raw),
    opacity: Math.max(0, 1 - raw / SURFACE_FADE_DISTANCE_PX),
    backgroundAmount: Math.max(0, 1 - raw / BACKGROUND_REVEAL_DISTANCE_PX),
  };
}

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
  let disposed = false;
  let tracking = false;
  let dragging = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let latest = pullSample(0);
  let samples: DistanceSample[] = [];
  let releasedClick: ReleasedClick | null = null;
  let postCommitBridgeUntil = 0;
  let pointerWatchdog = 0;
  let settleGeneration = 0;
  let candidateListenersAttached = false;
  const frameOwner = {};

  // At the top edge, scrolling down remains compositor-native (finger moves
  // upward) while the opposite direction is reserved for dismiss. Declaring
  // this before pointerdown avoids the device-dependent cancelability race.
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

  const settleCallback = (
    callback: (sample: HeroPullSample) => void | Promise<void>,
    sample: HeroPullSample,
  ) => {
    const generation = ++settleGeneration;
    // The final touch sample may have been queued in this frame. Let the
    // scheduler commit it before starting a spring/close transaction so the
    // first reverse frame never jumps from the old DOM position.
    void heroFrameScheduler.settled()
      .then(() => callback(sample))
      .catch(() => undefined)
      .finally(() => {
        if (generation !== settleGeneration) return;
        if (!disposed) {
          latest = pullSample(0);
          clearGestureState();
        }
      });
  };

  const commitCallback = (
    callback: (sample: HeroPullSample) => void | Promise<void>,
    sample: HeroPullSample,
  ) => {
    const generation = ++settleGeneration;
    // Commit the release pose and create the closing session in this pointerup
    // task. Waiting for the next frame left the outgoing route interactive for
    // one extra mobile tap, unlike button/History closes.
    heroFrameScheduler.cancel(frameOwner);
    try {
      onPull(sample);
    } catch {
      // The controller will reconcile a detached surface through the commit.
    }
    void Promise.resolve(callback(sample))
      .catch(() => undefined)
      .finally(() => {
        if (generation !== settleGeneration) return;
        if (!disposed) {
          latest = pullSample(0);
          clearGestureState();
        }
      });
  };

  const publish = (sample: HeroPullSample) => {
    latest = sample;
    heroFrameScheduler.request(frameOwner, {
      read: () => latest,
      write: onPull,
    });
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
    window.addEventListener('pointermove', handlePointerMove, {
      capture: true,
      passive: false,
    });
    window.addEventListener('pointerup', handlePointerUp, {
      capture: true,
      passive: false,
    });
    window.addEventListener('pointercancel', handlePointerCancel, {
      capture: true,
      passive: true,
    });
  };

  const armPointerWatchdog = () => {
    if (pointerWatchdog) window.clearTimeout(pointerWatchdog);
    pointerWatchdog = window.setTimeout(() => {
      pointerWatchdog = 0;
      if (tracking) handlePointerCancel();
    }, 2000);
  };

  const record = (raw: number, time: number) => {
    const sample = pullSample(raw);
    publish(sample);
    samples.push({ distance: sample.raw, time });
    const cutoff = time - RELEASE_SAMPLE_WINDOW_MS;
    while (samples.length > 2 && samples[1].time < cutoff) samples.shift();
  };

  const beginDrag = () => {
    // A fresh pull owns any older reset animation. Controller-side pull state
    // uses the new sample as its generation token and cancels the old spring.
    settleGeneration += 1;
    dragging = true;
    setGestureState('dragging');
    noteHeroInteraction();
  };

  const cancelGesture = () => {
    const sample = latest;
    resetPointer();
    setGestureState('settling');
    settleCallback(onCancel, sample);
  };

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
    latest = pullSample(0);
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
        if (deltaY > 0 && Math.abs(deltaY) >= Math.abs(deltaX) && event.cancelable) {
          event.preventDefault();
        }
        return;
      }
      if (
        deltaY <= 0 ||
        Math.abs(deltaX) >= deltaY ||
        scroller.scrollTop > 0.5 ||
        !canStart()
      ) {
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
      if (
        deltaY <= DRAG_ACTIVATION_PX ||
        Math.abs(deltaX) >= deltaY ||
        scroller.scrollTop > 0.5 ||
        !canStart()
      ) {
        resetPointer();
        detachCandidateListeners();
        return;
      }
      beginDrag();
    }
    if (event.cancelable) event.preventDefault();
    record(deltaY, event.timeStamp);
    const first = samples[0];
    const last = samples.at(-1) ?? first;
    const velocity = (last.distance - first.distance) / Math.max(1, last.time - first.time);
    const shouldDismiss = latest.raw >= DISMISS_DISTANCE_PX || (
      latest.raw >= DISMISS_MIN_FLING_DISTANCE_PX &&
      velocity >= DISMISS_VELOCITY_PX_PER_MS
    );
    const shouldCommit = shouldDismiss && canStart();
    releasedClick = {
      x: event.clientX,
      y: event.clientY,
      committed: shouldCommit,
      expiresAt: performance.now() + 1200,
    };
    postCommitBridgeUntil = shouldCommit ? performance.now() + 1200 : 0;
    const committedSample = latest;
    resetPointer();
    detachCandidateListeners();
    if (!shouldCommit) {
      setGestureState('settling');
      settleCallback(onCancel, committedSample);
      return;
    }
    setGestureState('dismissing');
    commitCallback(onCommit, committedSample);
  }

  function handlePointerCancel(event?: PointerEvent) {
    if (!tracking || (event && event.pointerId !== pointerId)) return;
    if (dragging) cancelGesture();
    else resetPointer();
    detachCandidateListeners();
  }

  const findGalleryCard = (x: number, y: number) => {
    for (const element of document.elementsFromPoint(x, y)) {
      const card = element.closest<HTMLAnchorElement>('a.image-hero-card-link');
      if (card && !target.contains(card)) return card;
    }
    return null;
  };

  // Some mobile compositors keep the just-dismissed route as the hit-test
  // target for one more touch even after it becomes pointer-transparent. If a
  // fresh release lands there, transfer that activation to the actual gallery
  // card under the same screen point. Native hits on a card are left alone.
  const handlePostCommitPointerUp = (event: PointerEvent) => {
    if (
      performance.now() > postCommitBridgeUntil ||
      document.documentElement.dataset.imageHeroState !== 'closing.flight' ||
      event.pointerType !== 'touch' ||
      !(event.target instanceof Node) ||
      !target.contains(event.target)
    ) {
      return;
    }
    const card = findGalleryCard(event.clientX, event.clientY);
    if (!card) return;
    releasedClick = null;
    postCommitBridgeUntil = 0;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    queueMicrotask(() => {
      if (card.isConnected) card.click();
    });
  };

  const handleClick = (event: MouseEvent) => {
    const released = releasedClick;
    if (released && performance.now() > released.expiresAt) {
      releasedClick = null;
    }
    const currentRelease = releasedClick;
    const isGestureClick = currentRelease && Math.hypot(
      event.clientX - currentRelease.x,
      event.clientY - currentRelease.y,
    ) <= 24;
    if (currentRelease && isGestureClick) {
      releasedClick = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (currentRelease && !currentRelease.committed) {
      releasedClick = null;
      return;
    }
    if (
      performance.now() > postCommitBridgeUntil ||
      document.documentElement.dataset.imageHeroState !== 'closing.flight'
    ) return;
    const card = findGalleryCard(event.clientX, event.clientY);
    if (!card) return;
    releasedClick = null;
    postCommitBridgeUntil = 0;
    event.preventDefault();
    event.stopPropagation();
    queueMicrotask(() => {
      if (card.isConnected) card.click();
    });
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
  target.addEventListener('click', handleClick, { capture: true });
  window.addEventListener('blur', handlePageExit);
  window.addEventListener('pagehide', handlePageExit);

  return () => {
    disposed = true;
    settleGeneration += 1;
    pointerSurface.removeEventListener('pointerdown', handlePointerDown as EventListener, true);
    window.removeEventListener('pointerup', handlePostCommitPointerUp, true);
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
    clearGestureState();
  };
}
