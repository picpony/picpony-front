'use client';

import { getHeroBackgroundSinkTransform } from './geometry';

const BACKGROUND_SELECTOR = '[data-image-detail-background]';
const BACKGROUND_VISUAL_SELECTOR = '[data-image-detail-background-visual]';
const DRAG_ACTIVATION_PX = 6;
const DISMISS_DISTANCE_PX = 120;
const DISMISS_MIN_FLING_DISTANCE_PX = 48;
const DISMISS_VELOCITY_PX_PER_MS = 0.5;
const DRAG_RESISTANCE_PX = 360;
const BACKGROUND_REVEAL_DISTANCE_PX = 260;
const SURFACE_FADE_DISTANCE_PX = 300;
const RELEASE_SAMPLE_WINDOW_MS = 120;

type DragSample = {
  distance: number;
  time: number;
};

type SavedInlineStyles = {
  contentTransform: string;
  contentWillChange: string;
  surfaceOpacity: string;
  surfaceWillChange: string;
  backgroundTransform: string;
  backgroundTransformOrigin: string;
  backgroundWillChange: string;
};

export type ImageHeroDismissGestureOptions = {
  scroller: HTMLElement;
  content: HTMLElement;
  surface: HTMLElement;
  canStart: () => boolean;
  dismiss: () => Promise<void>;
};

export type PendingImageHeroDismissGestureOptions = {
  canStart: () => boolean;
  dismiss: () => Promise<void>;
};

function resistedDistance(distance: number) {
  const positive = Math.max(0, distance);
  return positive / (1 + positive / DRAG_RESISTANCE_PX);
}

function waitForAnimations(animations: Animation[]) {
  return Promise.allSettled(animations.map((animation) => animation.finished));
}

export function bindImageHeroDismissGesture({
  scroller,
  content,
  surface,
  canStart,
  dismiss,
}: ImageHeroDismissGestureOptions) {
  const coarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!coarsePointer.matches || reducedMotion.matches) return () => {};

  const background = document.querySelector<HTMLElement>(BACKGROUND_VISUAL_SELECTOR)
    ?? document.querySelector<HTMLElement>(BACKGROUND_SELECTOR);
  if (!background) return () => {};

  // Directional touch-action + Pointer Events is not reliable across all
  // mobile engines: a browser may cancel the downward pointer stream before
  // our handler can claim it, or keep a stale direction for one stream after a
  // programmatic scroll handoff. Track only touches that start at the top and
  // attach the non-passive move listener for that one stream. An upward/sideways
  // intent detaches immediately and remains compositor-native; only a downward
  // pull is cancelled and converted into the dismiss gesture.
  let tracking = false;
  let touchIdentifier: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  let settling = false;
  let suppressClick = false;
  let distance = 0;
  let samples: DragSample[] = [];
  let styles: SavedInlineStyles | null = null;
  let releaseAnimation: Animation[] = [];
  let disposed = false;
  let candidateListenersAttached = false;

  const saveStyles = () => {
    if (styles) return;
    styles = {
      contentTransform: content.style.transform,
      contentWillChange: content.style.willChange,
      surfaceOpacity: surface.style.opacity,
      surfaceWillChange: surface.style.willChange,
      backgroundTransform: background.style.transform,
      backgroundTransformOrigin: background.style.transformOrigin,
      backgroundWillChange: background.style.willChange,
    };
  };

  const restoreStyles = () => {
    if (!styles) return;
    releaseAnimation.forEach((animation) => animation.cancel());
    releaseAnimation = [];
    content.style.transform = styles.contentTransform;
    content.style.willChange = styles.contentWillChange;
    surface.style.opacity = styles.surfaceOpacity;
    surface.style.willChange = styles.surfaceWillChange;
    background.style.transform = styles.backgroundTransform;
    background.style.transformOrigin = styles.backgroundTransformOrigin;
    background.style.willChange = styles.backgroundWillChange;
    styles = null;
    delete document.documentElement.dataset.imageHeroDismissGesture;
  };

  const resetTouch = () => {
    tracking = false;
    touchIdentifier = null;
    dragging = false;
    distance = 0;
    samples = [];
  };

  const detachCandidateListeners = () => {
    if (!candidateListenersAttached) return;
    candidateListenersAttached = false;
    window.removeEventListener('touchmove', handleTouchMove, true);
    window.removeEventListener('touchend', finishTouch, true);
    window.removeEventListener('touchcancel', handleTouchCancel, true);
  };

  const attachCandidateListeners = () => {
    if (candidateListenersAttached || disposed) return;
    candidateListenersAttached = true;
    window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    window.addEventListener('touchend', finishTouch, { capture: true, passive: false });
    window.addEventListener('touchcancel', handleTouchCancel, { capture: true, passive: true });
  };

  const getTrackedTouch = (touches: TouchList) => {
    if (touchIdentifier === null) return null;
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);
      if (touch?.identifier === touchIdentifier) return touch;
    }
    return null;
  };

  const applyDistance = (nextDistance: number) => {
    distance = resistedDistance(nextDistance);
    const surfaceOpacity = Math.max(0.2, 1 - distance / SURFACE_FADE_DISTANCE_PX);
    const backgroundAmount = Math.max(0, 1 - distance / BACKGROUND_REVEAL_DISTANCE_PX);
    content.style.transform = `translate3d(0, ${distance}px, 0)`;
    surface.style.opacity = `${surfaceOpacity}`;
    background.style.transform = getHeroBackgroundSinkTransform(backgroundAmount);
  };

  const recordDistance = (nextDistance: number, time: number) => {
    applyDistance(nextDistance);
    samples.push({ distance, time });
    const cutoff = time - RELEASE_SAMPLE_WINDOW_MS;
    while (samples.length > 2 && samples[1].time < cutoff) samples.shift();
  };

  const beginDrag = () => {
    saveStyles();
    dragging = true;
    suppressClick = true;
    content.style.willChange = 'transform';
    surface.style.willChange = 'opacity';
    background.style.transformOrigin = 'center center';
    background.style.willChange = 'transform';
    background.style.transform = getHeroBackgroundSinkTransform(1);
    document.documentElement.dataset.imageHeroDismissGesture = 'dragging';
  };

  const springBack = async () => {
    if (!styles) return;
    settling = true;
    document.documentElement.dataset.imageHeroDismissGesture = 'settling';
    const contentFrom = content.style.transform || 'translate3d(0, 0, 0)';
    const surfaceFrom = surface.style.opacity || getComputedStyle(surface).opacity;
    const backgroundFrom = background.style.transform || getHeroBackgroundSinkTransform(1);
    try {
      releaseAnimation = [
        content.animate(
          [{ transform: contentFrom }, { transform: 'translate3d(0, 0, 0)' }],
          { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        ),
        surface.animate(
          [{ opacity: surfaceFrom }, { opacity: '1' }],
          { duration: 220, easing: 'ease-out', fill: 'forwards' },
        ),
        background.animate(
          [{ transform: backgroundFrom }, { transform: getHeroBackgroundSinkTransform(1) }],
          { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        ),
      ];
      await waitForAnimations(releaseAnimation);
    } finally {
      if (!disposed) restoreStyles();
      settling = false;
    }
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (tracking) {
      if (event.touches.length !== 1 || !getTrackedTouch(event.touches)) {
        handleTouchCancel();
      }
      return;
    }
    if (
      settling ||
      event.touches.length !== 1 ||
      scroller.scrollTop > 0.5 ||
      !canStart()
    ) {
      return;
    }
    const touch = event.touches[0];
    tracking = true;
    touchIdentifier = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
    samples = [{ distance: 0, time: event.timeStamp }];
    attachCandidateListeners();
  };

  function handleTouchMove(event: TouchEvent) {
    if (!tracking || settling) return;
    if (event.touches.length !== 1) {
      handleTouchCancel();
      return;
    }
    const touch = getTrackedTouch(event.touches);
    if (!touch) {
      handleTouchCancel();
      return;
    }
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;

    if (!dragging) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DRAG_ACTIVATION_PX) return;
      if (deltaY <= 0 || Math.abs(deltaX) >= deltaY || scroller.scrollTop > 0.5 || !canStart()) {
        resetTouch();
        detachCandidateListeners();
        return;
      }
      if (!event.cancelable) {
        resetTouch();
        detachCandidateListeners();
        return;
      }
      beginDrag();
    }

    if (!event.cancelable) {
      handleTouchCancel();
      return;
    }
    event.preventDefault();
    recordDistance(deltaY, event.timeStamp);
  }

  const finishTouch = (event: TouchEvent) => {
    if (!tracking) return;
    const touch = getTrackedTouch(event.changedTouches);
    if (!touch) return;
    if (event.touches.length > 0) {
      handleTouchCancel();
      return;
    }
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (!dragging) {
      const canActivate = deltaY > DRAG_ACTIVATION_PX &&
        Math.abs(deltaX) < deltaY &&
        scroller.scrollTop <= 0.5 &&
        canStart();
      if (!canActivate) {
        resetTouch();
        detachCandidateListeners();
        return;
      }
      beginDrag();
    }

    if (event.cancelable) event.preventDefault();
    // Under a busy main thread browsers may coalesce or skip the final move.
    // Always sample the actual release point so a sufficiently long pull does
    // not degrade into a short spring-back on low-end devices.
    recordDistance(deltaY, event.timeStamp);
    const first = samples[0];
    const last = samples.at(-1) ?? first;
    const elapsed = Math.max(1, last.time - first.time);
    const velocity = (last.distance - first.distance) / elapsed;
    const shouldDismiss = distance >= DISMISS_DISTANCE_PX || (
      distance >= DISMISS_MIN_FLING_DISTANCE_PX &&
      velocity >= DISMISS_VELOCITY_PX_PER_MS
    );
    resetTouch();
    detachCandidateListeners();

    if (!shouldDismiss || !canStart()) {
      void springBack();
      return;
    }

    settling = true;
    document.documentElement.dataset.imageHeroDismissGesture = 'dismissing';
    // `dismiss()` enters the Hero close synchronously up to createFlight(), so
    // the source rect is measured while the content still carries this drag
    // transform. Cleanup can then safely happen on route unmount, Forward
    // recovery, or a superseding open without introducing a first-frame jump.
    void dismiss().finally(() => {
      settling = false;
      if (!disposed && content.isConnected) void springBack();
    });
  };

  const handleTouchCancel = () => {
    if (!tracking) return;
    const wasDragging = dragging;
    resetTouch();
    detachCandidateListeners();
    if (wasDragging) void springBack();
  };

  const handleClick = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  scroller.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
  scroller.addEventListener('click', handleClick, { capture: true });

  return () => {
    disposed = true;
    scroller.removeEventListener('touchstart', handleTouchStart, true);
    detachCandidateListeners();
    scroller.removeEventListener('click', handleClick, true);
    resetTouch();
    restoreStyles();
  };
}

// While an opening Hero is waiting for detail data, the visible UI belongs to
// the Stage and the real route is intentionally pointer-transparent. Listen at
// window capture level so a pull can still interrupt that wait immediately.
export function bindPendingImageHeroDismissGesture({
  canStart,
  dismiss,
}: PendingImageHeroDismissGestureOptions) {
  if (
    !window.matchMedia('(hover: none) and (pointer: coarse)').matches ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return () => {};
  }

  const host = document.querySelector<HTMLElement>('[data-image-detail-host]');
  if (!host) return () => {};

  let tracking = false;
  let touchIdentifier: number | null = null;
  let dragging = false;
  let settling = false;
  let startX = 0;
  let startY = 0;
  let distance = 0;
  let samples: DragSample[] = [];
  let content: HTMLElement | null = null;
  let surface: HTMLElement | null = null;
  let savedContentTransform = '';
  let savedContentWillChange = '';
  let savedSurfaceOpacity = '';
  let savedSurfaceWillChange = '';
  let releaseAnimations: Animation[] = [];
  let disposed = false;
  let suppressClick = false;
  let moveListenerAttached = false;

  const findStageElements = () => {
    const stage = document.querySelector<HTMLElement>('[data-image-hero-stage]');
    const stageScroller = stage?.querySelector<HTMLElement>('.image-detail-overlay-scroll');
    const stageContent = stage?.querySelector<HTMLElement>('.image-detail-overlay-content');
    const stageSurface = stage?.querySelector<HTMLElement>('[data-image-detail-surface]');
    if (!stage || !stageScroller || !stageContent || !stageSurface || stageScroller.scrollTop > 0.5) {
      return null;
    }
    return { content: stageContent, surface: stageSurface };
  };

  const restore = () => {
    releaseAnimations.forEach((animation) => animation.cancel());
    releaseAnimations = [];
    if (content) {
      content.style.transform = savedContentTransform;
      content.style.willChange = savedContentWillChange;
    }
    if (surface) {
      surface.style.opacity = savedSurfaceOpacity;
      surface.style.willChange = savedSurfaceWillChange;
    }
    content = null;
    surface = null;
    delete document.documentElement.dataset.imageHeroDismissGesture;
  };

  const resetTouch = () => {
    tracking = false;
    touchIdentifier = null;
    dragging = false;
    distance = 0;
    samples = [];
  };

  const getTrackedTouch = (touches: TouchList) => {
    if (touchIdentifier === null) return null;
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);
      if (touch?.identifier === touchIdentifier) return touch;
    }
    return null;
  };

  const attachMoveListener = () => {
    if (moveListenerAttached || disposed) return;
    moveListenerAttached = true;
    window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
  };

  const detachMoveListener = () => {
    if (!moveListenerAttached) return;
    moveListenerAttached = false;
    window.removeEventListener('touchmove', handleTouchMove, true);
  };

  const applyDistance = (nextDistance: number, time: number) => {
    if (!content || !surface) return;
    distance = resistedDistance(nextDistance);
    content.style.transform = `translate3d(0, ${distance}px, 0)`;
    surface.style.opacity = `${Math.max(0.2, 1 - distance / SURFACE_FADE_DISTANCE_PX)}`;
    samples.push({ distance, time });
    const cutoff = time - RELEASE_SAMPLE_WINDOW_MS;
    while (samples.length > 2 && samples[1].time < cutoff) samples.shift();
  };

  const springBack = async () => {
    if (!content || !surface) return;
    settling = true;
    document.documentElement.dataset.imageHeroDismissGesture = 'settling';
    try {
      releaseAnimations = [
        content.animate(
          [
            { transform: content.style.transform || 'translate3d(0, 0, 0)' },
            { transform: 'translate3d(0, 0, 0)' },
          ],
          { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        ),
        surface.animate(
          [
            { opacity: surface.style.opacity || getComputedStyle(surface).opacity },
            { opacity: '1' },
          ],
          { duration: 200, easing: 'ease-out', fill: 'forwards' },
        ),
      ];
      await waitForAnimations(releaseAnimations);
    } finally {
      if (!disposed) restore();
      settling = false;
    }
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (tracking) {
      if (event.touches.length !== 1 || !getTrackedTouch(event.touches)) {
        handleTouchCancel();
      }
      return;
    }
    if (settling || event.touches.length !== 1 || !canStart()) return;
    const elements = findStageElements();
    if (!elements) return;
    const touch = event.touches[0];
    const hostRect = host.getBoundingClientRect();
    if (
      touch.clientX < hostRect.left ||
      touch.clientX > hostRect.right ||
      touch.clientY < hostRect.top ||
      touch.clientY > hostRect.bottom
    ) {
      return;
    }
    tracking = true;
    touchIdentifier = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
    content = elements.content;
    surface = elements.surface;
    savedContentTransform = content.style.transform;
    savedContentWillChange = content.style.willChange;
    savedSurfaceOpacity = surface.style.opacity;
    savedSurfaceWillChange = surface.style.willChange;
    samples = [{ distance: 0, time: event.timeStamp }];
    attachMoveListener();
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (!tracking || settling || !content || !surface) return;
    if (event.touches.length !== 1) {
      handleTouchCancel();
      return;
    }
    const touch = getTrackedTouch(event.touches);
    if (!touch) {
      handleTouchCancel();
      return;
    }
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (!dragging) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DRAG_ACTIVATION_PX) return;
      if (deltaY <= 0 || Math.abs(deltaX) >= deltaY || !canStart()) {
        resetTouch();
        detachMoveListener();
        restore();
        return;
      }
      if (!event.cancelable) {
        resetTouch();
        detachMoveListener();
        restore();
        return;
      }
      dragging = true;
      suppressClick = true;
      content.style.willChange = 'transform';
      surface.style.willChange = 'opacity';
      document.documentElement.dataset.imageHeroDismissGesture = 'dragging';
    }

    if (!event.cancelable) {
      handleTouchCancel();
      return;
    }
    event.preventDefault();
    applyDistance(deltaY, event.timeStamp);
  };

  const finishTouch = (event: TouchEvent) => {
    if (!tracking) return;
    const touch = getTrackedTouch(event.changedTouches);
    if (!touch) return;
    if (event.touches.length > 0) {
      handleTouchCancel();
      return;
    }
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (!dragging) {
      const canActivate = deltaY > DRAG_ACTIVATION_PX &&
        Math.abs(deltaX) < deltaY &&
        canStart();
      if (!canActivate || !content || !surface) {
        resetTouch();
        detachMoveListener();
        restore();
        return;
      }
      dragging = true;
      suppressClick = true;
      content.style.willChange = 'transform';
      surface.style.willChange = 'opacity';
      document.documentElement.dataset.imageHeroDismissGesture = 'dragging';
    }
    if (event.cancelable) event.preventDefault();
    applyDistance(deltaY, event.timeStamp);
    const first = samples[0];
    const last = samples.at(-1) ?? first;
    const velocity = (last.distance - first.distance) / Math.max(1, last.time - first.time);
    const shouldDismiss = distance >= DISMISS_DISTANCE_PX || (
      distance >= DISMISS_MIN_FLING_DISTANCE_PX &&
      velocity >= DISMISS_VELOCITY_PX_PER_MS
    );
    resetTouch();
    detachMoveListener();
    if (!shouldDismiss || !canStart()) {
      void springBack();
      return;
    }

    settling = true;
    document.documentElement.dataset.imageHeroDismissGesture = 'dismissing';
    void dismiss().finally(() => {
      settling = false;
      if (!disposed && content?.isConnected) void springBack();
    });
  };

  const handleTouchCancel = () => {
    if (!tracking) return;
    const wasDragging = dragging;
    resetTouch();
    detachMoveListener();
    if (wasDragging) {
      void springBack();
    } else {
      restore();
    }
  };

  const handleClick = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  window.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
  window.addEventListener('touchend', finishTouch, { capture: true, passive: false });
  window.addEventListener('touchcancel', handleTouchCancel, { capture: true, passive: true });
  window.addEventListener('click', handleClick, { capture: true });

  return () => {
    disposed = true;
    window.removeEventListener('touchstart', handleTouchStart, true);
    detachMoveListener();
    window.removeEventListener('touchend', finishTouch, true);
    window.removeEventListener('touchcancel', handleTouchCancel, true);
    window.removeEventListener('click', handleClick, true);
    resetTouch();
    restore();
  };
}
