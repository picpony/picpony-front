'use client';

import type { FlightMotion } from './flight';
import type { HeroPhase } from './state';
import type { HeroRect } from './geometry';
import {
  HERO_BACKGROUND_SELECTOR,
  HERO_DETAIL_OVERLAY_SELECTOR,
  HERO_ROUTE_TIMEOUT_MS,
  createTransitionScrollNodes,
  getHeroRect,
  getRouteScroller,
  syncStageScroll,
} from './dom';

export type ScrollSync = {
  sync: () => void;
  flush: (preferRoute?: boolean) => void;
  waitForRelease: () => Promise<void>;
  stop: () => void;
};

const SCROLL_SMOOTHING_TAU_MS = 42;
const SCROLL_SETTLE_EPSILON_PX = 0.15;
const SCROLL_EVENT_EPSILON_PX = 0.5;
const SCROLL_RELEASE_WINDOW_MS = 72;
const TOUCH_AXIS_LOCK_PX = 6;

function heroNow() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export function bindOpeningScroll(
  motion: FlightMotion,
  waitForElement: (selector: string, timeout?: number) => Promise<HTMLElement | null>,
  getPhase: () => HeroPhase,
): ScrollSync {
  let disposed = false;
  let frame = 0;
  let initialized = false;
  let currentX = 0;
  let currentY = 0;
  let targetX = 0;
  let targetY = 0;
  let lastTime = heroNow();
  let stageScroller: HTMLElement | null = null;
  const backgroundScroller = document.querySelector<HTMLElement>(HERO_BACKGROUND_SELECTOR);
  const backgroundOriginX = backgroundScroller?.scrollLeft ?? 0;
  const backgroundOriginY = backgroundScroller?.scrollTop ?? 0;
  let backgroundX = backgroundOriginX;
  let backgroundY = backgroundOriginY;
  let backgroundBridge = false;
  let touchActive = false;
  let touchOwner: 'stage' | 'background' | null = null;
  let touchIdentifier: number | null = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let lastTouchY = 0;
  let touchAxis: 'pending' | 'vertical' | 'horizontal' = 'pending';
  let backgroundMaxY = backgroundScroller
    ? Math.max(0, backgroundScroller.scrollHeight - backgroundScroller.clientHeight)
    : 0;
  let lastNativeScroll = Number.NEGATIVE_INFINITY;
  let releaseTimer = 0;
  let stageMaxX = 0;
  let stageMaxY = 0;
  let stageResizeObserver: ResizeObserver | null = null;
  const releaseWaiters = new Set<() => void>();
  const nodes = createTransitionScrollNodes();

  // The stage is the stable scroll surface for the whole opening flight.
  // The route overlay can mount earlier than its content and briefly report a
  // zero scroll range; using it here would discard wheel intent during that
  // window. Handoff copies the final stage position to the real route.
  const getScroller = () => nodes.stageScroller ?? nodes.routeScroller;
  const clamp = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max));
  const resolveReleaseWaiters = () => {
    releaseWaiters.forEach((resolve) => resolve());
    releaseWaiters.clear();
  };
  const restoreBackgroundScroll = () => {
    if (!backgroundBridge || !backgroundScroller) return;
    backgroundBridge = false;
    backgroundX = backgroundOriginX;
    backgroundY = backgroundOriginY;
    backgroundScroller.scrollLeft = backgroundOriginX;
    backgroundScroller.scrollTop = backgroundOriginY;
  };
  const isReleaseReady = () =>
    !touchActive && !frame && heroNow() - lastNativeScroll >= SCROLL_RELEASE_WINDOW_MS;
  const scheduleReleaseCheck = () => {
    if (isReleaseReady()) {
      if (releaseTimer) window.clearTimeout(releaseTimer);
      releaseTimer = 0;
      restoreBackgroundScroll();
      touchOwner = null;
      resolveReleaseWaiters();
      return;
    }
    if (releaseTimer) {
      window.clearTimeout(releaseTimer);
      releaseTimer = 0;
    }
    // Touch end and the final smoothing frame are the only events that can
    // make this ready. Avoid polling every 16ms while either is still active.
    if (touchActive || frame) return;
    const remaining = Math.max(0, SCROLL_RELEASE_WINDOW_MS - (heroNow() - lastNativeScroll));
    releaseTimer = window.setTimeout(() => {
      releaseTimer = 0;
      scheduleReleaseCheck();
    }, Math.max(1, remaining));
  };
  const waitForRelease = () => {
    if (isReleaseReady()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      releaseWaiters.add(resolve);
      scheduleReleaseCheck();
    });
  };
  const sync = () => {
    if (disposed || !initialized) return;
    const scroller = getScroller();
    if (!scroller) return;
    scroller.scrollLeft = currentX;
    scroller.scrollTop = currentY;
    syncStageScroll(currentX, currentY, scroller, nodes);
    motion.retarget(-currentX, -currentY, 'to');
  };
  const tick = (time: number) => {
    frame = 0;
    if (disposed || !initialized) return;
    const scroller = getScroller();
    if (!scroller) return;
    const desiredX = clamp(targetX, scroller.scrollWidth - scroller.clientWidth);
    const desiredY = clamp(targetY, scroller.scrollHeight - scroller.clientHeight);
    const delta = Math.min(50, Math.max(1, time - lastTime));
    lastTime = time;
    const amount = 1 - Math.exp(-delta / SCROLL_SMOOTHING_TAU_MS);
    currentX += (desiredX - currentX) * amount;
    currentY += (desiredY - currentY) * amount;
    if (Math.abs(desiredX - currentX) < SCROLL_SETTLE_EPSILON_PX) currentX = desiredX;
    if (Math.abs(desiredY - currentY) < SCROLL_SETTLE_EPSILON_PX) currentY = desiredY;
    sync();
    if (Math.abs(desiredX - currentX) >= SCROLL_SETTLE_EPSILON_PX || Math.abs(desiredY - currentY) >= SCROLL_SETTLE_EPSILON_PX) {
      frame = requestAnimationFrame(tick);
    } else {
      scheduleReleaseCheck();
    }
  };
  const scheduleSync = () => {
    if (!frame) {
      lastTime = heroNow();
      frame = requestAnimationFrame(tick);
    }
  };
  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || getPhase() !== 'opening') return;
    const scale = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? window.innerHeight
        : 1;
    targetX += event.deltaX * scale;
    targetY += event.deltaY * scale;
    event.preventDefault();
    scheduleSync();
  };
  const syncNativeScroll = () => {
    if (disposed || !stageScroller) return;
    const nextX = stageScroller.scrollLeft;
    const nextY = stageScroller.scrollTop;
    if (Math.abs(nextX - currentX) < SCROLL_EVENT_EPSILON_PX && Math.abs(nextY - currentY) < SCROLL_EVENT_EPSILON_PX) {
      return;
    }
    currentX = nextX;
    currentY = nextY;
    targetX = nextX;
    targetY = nextY;
    lastNativeScroll = heroNow();
    // The routed detail is hidden until handoff and gets an exact final
    // position during `flush()`. Avoid re-scrolling that offscreen surface on
    // every native touch event: on mobile it adds work to the scroll frame
    // without contributing to the visible result.
    motion.retarget(-currentX, -currentY, 'to');
    scheduleReleaseCheck();
  };
  const handleNativeScroll = () => {
    // Native touch scrolling already advances on the compositor. Queueing this
    // transform compensation through another rAF makes the fixed Hero target
    // visibly trail the finger by one frame on coarse pointers. This path only
    // reads scroll offsets and writes composited transforms, so synchronizing
    // in the scroll callback avoids that latency without forcing layout.
    syncNativeScroll();
  };
  const handleBackgroundScroll = () => {
    if (disposed || !backgroundScroller ||
        (touchOwner !== 'background' && !backgroundBridge)) {
      return;
    }
    const nextX = backgroundScroller.scrollLeft;
    const nextY = backgroundScroller.scrollTop;
    const deltaX = nextX - backgroundX;
    const deltaY = nextY - backgroundY;
    backgroundX = nextX;
    backgroundY = nextY;
    if (Math.abs(deltaX) < SCROLL_EVENT_EPSILON_PX && Math.abs(deltaY) < SCROLL_EVENT_EPSILON_PX) return;

    backgroundBridge = true;
    lastNativeScroll = heroNow();
    if (stageScroller) {
      const nextStageX = clamp(
        stageScroller.scrollLeft + deltaX,
        stageMaxX,
      );
      const nextStageY = clamp(
        stageScroller.scrollTop + deltaY,
        stageMaxY,
      );
      stageScroller.scrollLeft = nextStageX;
      stageScroller.scrollTop = nextStageY;
      syncNativeScroll();
    } else {
      currentX = Math.max(0, currentX + deltaX);
      currentY = Math.max(0, currentY + deltaY);
      targetX = currentX;
      targetY = currentY;
      motion.retarget(-currentX, -currentY, 'to');
      scheduleReleaseCheck();
    }
  };
  const getTrackedTouch = (touches: TouchList) => {
    if (touchIdentifier === null) return null;
    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);
      if (touch?.identifier === touchIdentifier) return touch;
    }
    return null;
  };
  const syncResidualTouch = (touch: Touch) => {
    if (
      disposed ||
      !touchActive ||
      touchOwner !== 'background' ||
      !stageScroller ||
      !backgroundScroller
    ) {
      return;
    }
    const totalX = touch.clientX - touchStartX;
    const totalY = touch.clientY - touchStartY;
    if (touchAxis === 'pending') {
      if (Math.max(Math.abs(totalX), Math.abs(totalY)) < TOUCH_AXIS_LOCK_PX) return;
      touchAxis = Math.abs(totalX) >= Math.abs(totalY) ? 'horizontal' : 'vertical';
    }
    if (touchAxis !== 'vertical') return;

    const deltaY = lastTouchY - touch.clientY;
    lastTouchY = touch.clientY;
    if (Math.abs(deltaY) < SCROLL_EVENT_EPSILON_PX) return;

    const backgroundAvailable = deltaY > 0
      ? Math.max(0, backgroundMaxY - backgroundScroller.scrollTop)
      : Math.max(0, backgroundScroller.scrollTop);
    const residualY = deltaY > 0
      ? Math.max(0, deltaY - backgroundAvailable)
      : -Math.max(0, -deltaY - backgroundAvailable);
    if (Math.abs(residualY) < SCROLL_EVENT_EPSILON_PX) return;
    const stageCanMove = residualY > 0
      ? stageScroller.scrollTop < stageMaxY - SCROLL_EVENT_EPSILON_PX
      : stageScroller.scrollTop > SCROLL_EVENT_EPSILON_PX;
    if (!stageCanMove) return;

    // During forward the pointer-transparent Stage is driven by native scroll
    // deltas from the frozen gallery. At a gallery boundary there is no native
    // delta to bridge, even though the detail Stage may still have room. Touch
    // events continue after native pointer cancellation, so mirror only the
    // portion the gallery cannot consume. The default scroll still contributes
    // its available part through handleBackgroundScroll, preserving native
    // inertia without double-counting the crossing move. The listener stays
    // passive and pending downward dismiss keeps sole ownership of cancellation.
    const nextY = clamp(stageScroller.scrollTop + residualY, stageMaxY);
    if (Math.abs(nextY - stageScroller.scrollTop) < SCROLL_EVENT_EPSILON_PX) return;
    backgroundBridge = true;
    stageScroller.scrollTop = nextY;
    syncNativeScroll();
  };
  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    const touch = getTrackedTouch(event.touches);
    if (touch) syncResidualTouch(touch);
  };
  const handleTouchStart = (event: TouchEvent) => {
    touchActive = true;
    const path = event.composedPath();
    touchOwner = stageScroller && path.includes(stageScroller)
      ? 'stage'
      : backgroundScroller && path.includes(backgroundScroller)
        ? 'background'
        : stageScroller
          ? 'stage'
          : 'background';
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      touchIdentifier = touch.identifier;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      lastTouchY = touch.clientY;
      touchAxis = 'pending';
      if (backgroundScroller) {
        backgroundMaxY = Math.max(
          0,
          backgroundScroller.scrollHeight - backgroundScroller.clientHeight,
        );
      }
    } else {
      touchIdentifier = null;
      touchAxis = 'horizontal';
    }
    if (releaseTimer) window.clearTimeout(releaseTimer);
    releaseTimer = 0;
  };
  const handleTouchEnd = (event: TouchEvent) => {
    const endedTouch = getTrackedTouch(event.changedTouches);
    if (endedTouch && event.touches.length === 0) {
      // A busy main thread may receive the last physical movement only in the
      // release event. Sample that endpoint before clearing the identifier so
      // an opening scroll at the gallery boundary does not lose its final span.
      syncResidualTouch(endedTouch);
    }
    touchActive = event.touches.length > 0;
    if (endedTouch) {
      touchIdentifier = null;
      touchAxis = 'pending';
    }
    if (!touchActive) {
      touchIdentifier = null;
      touchAxis = 'pending';
      lastNativeScroll = heroNow();
    }
    scheduleReleaseCheck();
  };
  const handleTouchCancel = (event: TouchEvent) => {
    touchActive = event.touches.length > 0;
    touchIdentifier = null;
    touchAxis = 'pending';
    if (!touchActive) lastNativeScroll = heroNow();
    scheduleReleaseCheck();
  };
  window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  window.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
  window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });
  window.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
  window.addEventListener('touchcancel', handleTouchCancel, { capture: true, passive: true });
  backgroundScroller?.addEventListener('scroll', handleBackgroundScroll, { passive: true });
  void waitForElement(
    '[data-image-hero-stage] .image-detail-overlay-scroll',
    HERO_ROUTE_TIMEOUT_MS,
  ).then((element) => {
    if (disposed || !element) return;
    stageScroller = element;
    nodes.stageScroller = element;
    const updateStageBounds = () => {
      if (!stageScroller) return;
      stageMaxX = Math.max(0, stageScroller.scrollWidth - stageScroller.clientWidth);
      stageMaxY = Math.max(0, stageScroller.scrollHeight - stageScroller.clientHeight);
    };
    updateStageBounds();
    stageResizeObserver = new ResizeObserver(updateStageBounds);
    stageResizeObserver.observe(stageScroller);
    if (stageScroller.firstElementChild) stageResizeObserver.observe(stageScroller.firstElementChild);
    stageScroller.addEventListener('scroll', handleNativeScroll, { passive: true });
    if (backgroundBridge) {
      currentX = clamp(currentX, stageMaxX);
      currentY = clamp(currentY, stageMaxY);
      targetX = currentX;
      targetY = currentY;
    } else {
      currentX = stageScroller.scrollLeft;
      currentY = stageScroller.scrollTop;
      targetX += currentX;
      targetY += currentY;
    }
    initialized = true;
    sync();
    scheduleSync();
  });

  const stop = () => {
    if (disposed) return;
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    if (releaseTimer) window.clearTimeout(releaseTimer);
    window.removeEventListener('wheel', handleWheel, true);
    window.removeEventListener('touchstart', handleTouchStart, true);
    window.removeEventListener('touchmove', handleTouchMove, true);
    window.removeEventListener('touchend', handleTouchEnd, true);
    window.removeEventListener('touchcancel', handleTouchCancel, true);
    backgroundScroller?.removeEventListener('scroll', handleBackgroundScroll);
    stageScroller?.removeEventListener('scroll', handleNativeScroll);
    stageResizeObserver?.disconnect();
    stageResizeObserver = null;
    if (getPhase() !== 'closing') restoreBackgroundScroll();
    resolveReleaseWaiters();
  };
  const flush = (preferRoute = false) => {
    if (disposed || !initialized) return;
    if (preferRoute && (!nodes.routeScroller || !nodes.routeScroller.isConnected)) {
      nodes.routeScroller = getRouteScroller();
    }
    const scroller = preferRoute ? nodes.routeScroller ?? getScroller() : getScroller();
    if (!scroller) return;
    currentX = clamp(targetX, scroller.scrollWidth - scroller.clientWidth);
    currentY = clamp(targetY, scroller.scrollHeight - scroller.clientHeight);
    sync();
  };
  return { sync, flush, waitForRelease, stop };
}

export function bindClosingScroll(
  motion: FlightMotion,
  target: HTMLElement,
  landingRect: HeroRect,
  endpoint: 'from' | 'to',
  getPhase: () => HeroPhase,
  measureTargetInitially = true,
): ScrollSync {
  const stageScroller = document.querySelector<HTMLElement>(
    '[data-image-hero-stage] .image-detail-overlay-scroll',
  );
  const overlays = Array.from(
    document.querySelectorAll<HTMLElement>(HERO_DETAIL_OVERLAY_SELECTOR),
  );
  const stageOverlay = stageScroller?.closest<HTMLElement>(
    '[data-image-hero-stage]',
  ) ?? null;
  const interactionLayers = Array.from(new Set<HTMLElement>([
    // Keep the Stage scroll surface alive on touch devices. A swipe that
    // starts while the opening transition is being interrupted remains bound
    // to that surface; `handleResidualStageScroll` below transfers its native
    // delta to the background gallery. Disabling the whole Stage makes that
    // continuation impossible and drops the gesture mid-flight.
    ...overlays.filter((overlay) => overlay !== stageOverlay),
    ...overlays.flatMap((overlay) => Array.from(
      overlay.querySelectorAll<HTMLElement>(
        '[data-image-hero-stage-foreground], [data-image-detail-back-button]',
      ),
    ).filter((element) => element !== stageScroller)),
    ...document.querySelectorAll<HTMLElement>('[data-image-detail-floating-back]'),
  ]));
  const pointerEvents = interactionLayers.map((element) => ({
    element,
    value: element.style.pointerEvents,
  }));
  // Closing gestures belong to the gallery scroller. The Hero Stage uses
  // explicit pointer-events:auto children while opening; disable those too or
  // touch scrolling is captured by the fading detail UI on coarse pointers.
  pointerEvents.forEach(({ element }) => { element.style.pointerEvents = 'none'; });

  let stopped = false;
  let frame = 0;
  let syncing = false;
  const scroller = document.querySelector<HTMLElement>(HERO_BACKGROUND_SELECTOR);
  let scrollerMaxX = scroller
    ? Math.max(0, scroller.scrollWidth - scroller.clientWidth)
    : 0;
  let scrollerMaxY = scroller
    ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    : 0;
  const updateScrollerBounds = () => {
    if (!scroller) return;
    scrollerMaxX = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scrollerMaxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  };
  const scrollerResizeObserver = scroller && typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(updateScrollerBounds)
    : null;
  if (scroller && scrollerResizeObserver) {
    scrollerResizeObserver.observe(scroller);
    if (scroller.firstElementChild) scrollerResizeObserver.observe(scroller.firstElementChild);
  }
  let currentX = scroller?.scrollLeft ?? 0;
  let currentY = scroller?.scrollTop ?? 0;
  let stageX = stageScroller?.scrollLeft ?? 0;
  let stageY = stageScroller?.scrollTop ?? 0;
  const initialX = currentX;
  const initialY = currentY;
  let targetX = currentX;
  let targetY = currentY;
  let lastTime = heroNow();
  const sync = (measureTarget = false) => {
    if (stopped || !target.isConnected) return;
    if (measureTarget) {
      const current = getHeroRect(target);
      motion.retarget(
        current.left - landingRect.left,
        current.top - landingRect.top,
        endpoint,
      );
      return;
    }
    motion.retarget(initialX - currentX, initialY - currentY, endpoint);
  };
  const scheduleTick = () => {
    if (!frame) {
      lastTime = heroNow();
      frame = requestAnimationFrame(tick);
    }
  };
  const handleWheel = (event: WheelEvent) => {
    if (event.ctrlKey || getPhase() !== 'closing' || !scroller) return;
    const scale = event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? window.innerHeight
        : 1;
    targetX += event.deltaX * scale;
    targetY += event.deltaY * scale;
    event.preventDefault();
    scheduleTick();
  };
  const handleScroll = () => {
    if (!scroller || syncing) return;
    if (Math.abs(scroller.scrollLeft - currentX) < SCROLL_EVENT_EPSILON_PX &&
        Math.abs(scroller.scrollTop - currentY) < SCROLL_EVENT_EPSILON_PX) {
      return;
    }
    currentX = scroller.scrollLeft;
    currentY = scroller.scrollTop;
    targetX = currentX;
    targetY = currentY;
    // Match native touch scrolling in the same event turn. The transform is
    // compositor-only, while a deferred rAF consistently made the return
    // flight lag behind a mobile swipe.
    sync();
  };
  const handleResidualStageScroll = () => {
    if (!stageScroller || !scroller) return;
    const nextStageX = stageScroller.scrollLeft;
    const nextStageY = stageScroller.scrollTop;
    const deltaX = nextStageX - stageX;
    const deltaY = nextStageY - stageY;
    stageX = nextStageX;
    stageY = nextStageY;
    if (Math.abs(deltaX) < SCROLL_EVENT_EPSILON_PX && Math.abs(deltaY) < SCROLL_EVENT_EPSILON_PX) return;

    currentX = Math.min(Math.max(0, scroller.scrollLeft + deltaX), scrollerMaxX);
    currentY = Math.min(Math.max(0, scroller.scrollTop + deltaY), scrollerMaxY);
    targetX = currentX;
    targetY = currentY;
    syncing = true;
    scroller.scrollLeft = currentX;
    scroller.scrollTop = currentY;
    syncing = false;
    sync();
  };
  const tick = (time: number) => {
    frame = 0;
    if (stopped || !scroller) return;
    targetX = Math.min(Math.max(0, targetX), scrollerMaxX);
    targetY = Math.min(Math.max(0, targetY), scrollerMaxY);
    const delta = Math.min(50, Math.max(1, time - lastTime));
    lastTime = time;
    const amount = 1 - Math.exp(-delta / SCROLL_SMOOTHING_TAU_MS);
    currentX += (targetX - currentX) * amount;
    currentY += (targetY - currentY) * amount;
    if (Math.abs(targetX - currentX) < SCROLL_SETTLE_EPSILON_PX) currentX = targetX;
    if (Math.abs(targetY - currentY) < SCROLL_SETTLE_EPSILON_PX) currentY = targetY;
    syncing = true;
    scroller.scrollLeft = currentX;
    scroller.scrollTop = currentY;
    syncing = false;
    sync();
    if (Math.abs(targetX - currentX) >= SCROLL_SETTLE_EPSILON_PX || Math.abs(targetY - currentY) >= SCROLL_SETTLE_EPSILON_PX) {
      frame = requestAnimationFrame(tick);
    }
  };
  window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
  scroller?.addEventListener('scroll', handleScroll, { passive: true });
  stageScroller?.addEventListener('scroll', handleResidualStageScroll, { passive: true });
  // During an interrupted open the thumbnail still inherits the forward
  // background sink transform. Measuring it here would bake that temporary
  // translate/scale into the return endpoint even though the background is
  // simultaneously animating back to flat. Scroll deltas are tracked
  // separately, so that path starts from the original click-time endpoint and
  // performs one exact geometry measurement only when it settles.
  sync(measureTargetInitially);

  const stop = () => {
    if (stopped) return;
    sync(true);
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('wheel', handleWheel, true);
    scroller?.removeEventListener('scroll', handleScroll);
    stageScroller?.removeEventListener('scroll', handleResidualStageScroll);
    scrollerResizeObserver?.disconnect();
    pointerEvents.forEach(({ element, value }) => {
      if (element.isConnected) element.style.pointerEvents = value;
    });
  };
  const flush = () => {
    if (stopped || !scroller) return;
    targetX = Math.min(Math.max(0, targetX), scrollerMaxX);
    targetY = Math.min(Math.max(0, targetY), scrollerMaxY);
    currentX = targetX;
    currentY = targetY;
    syncing = true;
    scroller.scrollLeft = currentX;
    scroller.scrollTop = currentY;
    syncing = false;
    sync(true);
  };
  return {
    sync,
    flush,
    waitForRelease: () => Promise.resolve(),
    stop,
  };
}
