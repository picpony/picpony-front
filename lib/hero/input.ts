'use client';

/**
 * The single source of truth for "is the user currently touching the page".
 *
 * Every Hero decision that must not fight live input — handing a scroll stream
 * to a new scroller, publishing detail data, capturing a warm frame — reads
 * this one signal. No component installs its own scroll observer or settling
 * timer, so nothing can compete with an active gesture.
 */

const QUIET_AFTER_MS = 96;
/**
 * Wheel streams can gap well above one frame (trackpads and high-resolution
 * wheels especially). Releasing a handoff after ~48ms detached the latched
 * scroller between two events of the same stream and the rest of that stream
 * appeared to vanish.
 */
const WHEEL_RELEASE_MS = 160;
/** A touch that never reports an end (tab switch mid-drag) must not latch. */
const TOUCH_SAFETY_MS = 4000;

let initialized = false;
let legacyTouchCount = 0;
const activeTouchPointers = new Set<number>();
let wheelActive = false;
let wheelReleaseTimer = 0;
let lastActivityAt = 0;
let quietTimer = 0;
let touchSafetyTimer = 0;
let quiet = true;

const activityListeners = new Set<() => void>();
const inputReleaseListeners = new Set<() => void>();
const viewportListeners = new Set<() => void>();

function now() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function notify(listeners: Set<() => void>) {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // One stale waiter cannot strand the active interaction stream.
    }
  });
}

function activeTouchCount() {
  return Math.max(legacyTouchCount, activeTouchPointers.size);
}

export function hasActiveHeroInput() {
  return activeTouchCount() > 0 || wheelActive;
}

export function isHeroInteractionQuiet() {
  return quiet && !hasActiveHeroInput();
}

function publishQuiet(next: boolean) {
  if (quiet === next) return;
  quiet = next;
  notify(activityListeners);
}

function scheduleQuietCheck() {
  if (quietTimer) window.clearTimeout(quietTimer);
  const remaining = Math.max(0, QUIET_AFTER_MS - (now() - lastActivityAt));
  quietTimer = window.setTimeout(() => {
    quietTimer = 0;
    if (hasActiveHeroInput()) return;
    if (now() - lastActivityAt < QUIET_AFTER_MS) {
      scheduleQuietCheck();
      return;
    }
    publishQuiet(true);
  }, remaining + 1);
}

function markActivity() {
  lastActivityAt = now();
  publishQuiet(false);
  scheduleQuietCheck();
}

function setLegacyTouchCount(next: number) {
  if (legacyTouchCount === next) return;
  legacyTouchCount = next;
  notify(inputReleaseListeners);
}

function armTouchSafety() {
  if (touchSafetyTimer) window.clearTimeout(touchSafetyTimer);
  if (activeTouchCount() <= 0) {
    touchSafetyTimer = 0;
    return;
  }
  touchSafetyTimer = window.setTimeout(() => {
    touchSafetyTimer = 0;
    const hadTouches = activeTouchCount() > 0;
    legacyTouchCount = 0;
    activeTouchPointers.clear();
    if (hadTouches) notify(inputReleaseListeners);
    markActivity();
  }, TOUCH_SAFETY_MS);
}

function resetInteraction() {
  const hadInput = hasActiveHeroInput();
  legacyTouchCount = 0;
  activeTouchPointers.clear();
  wheelActive = false;
  if (wheelReleaseTimer) window.clearTimeout(wheelReleaseTimer);
  wheelReleaseTimer = 0;
  if (hadInput) notify(inputReleaseListeners);
  if (touchSafetyTimer) window.clearTimeout(touchSafetyTimer);
  touchSafetyTimer = 0;
  if (quietTimer) window.clearTimeout(quietTimer);
  quietTimer = 0;
  lastActivityAt = now();
  publishQuiet(true);
}

const handleScroll = () => markActivity();

const handleWheel = () => {
  if (!wheelActive) {
    wheelActive = true;
    notify(inputReleaseListeners);
  }
  if (wheelReleaseTimer) window.clearTimeout(wheelReleaseTimer);
  wheelReleaseTimer = window.setTimeout(() => {
    wheelReleaseTimer = 0;
    if (!wheelActive) return;
    wheelActive = false;
    notify(inputReleaseListeners);
    scheduleQuietCheck();
  }, WHEEL_RELEASE_MS);
  markActivity();
};

const handleTouch = (event: TouchEvent) => {
  setLegacyTouchCount(event.touches.length);
  armTouchSafety();
  markActivity();
};

const handlePointerStart = (event: PointerEvent) => {
  if (event.pointerType !== 'touch') return;
  const size = activeTouchPointers.size;
  activeTouchPointers.add(event.pointerId);
  if (activeTouchPointers.size !== size) notify(inputReleaseListeners);
  armTouchSafety();
  markActivity();
};

const handlePointerEnd = (event: PointerEvent) => {
  if (event.pointerType !== 'touch') return;
  if (activeTouchPointers.delete(event.pointerId)) notify(inputReleaseListeners);
  armTouchSafety();
  markActivity();
};

const handleVisibility = () => {
  if (document.visibilityState === 'hidden') resetInteraction();
};

// ---------------------------------------------------------------------------
// Viewport invalidation
//
// Only a change in the visible box matters. iOS fires continuous
// `visualViewport` scroll while the address bar collapses; treating those as
// invalidation restarted the flight spring on every frame of the collapse.
// ---------------------------------------------------------------------------

let viewportWidth = 0;
let viewportHeight = 0;

function readViewportSize() {
  const visual = window.visualViewport;
  return {
    width: Math.round(visual?.width ?? window.innerWidth),
    height: Math.round(visual?.height ?? window.innerHeight),
  };
}

const handleViewportChange = () => {
  const { width, height } = readViewportSize();
  if (width === viewportWidth && height === viewportHeight) return;
  viewportWidth = width;
  viewportHeight = height;
  notify(viewportListeners);
};

/** Orientation changes may report the old size synchronously. */
const handleOrientationChange = () => {
  viewportWidth = 0;
  viewportHeight = 0;
  notify(viewportListeners);
};

export function initializeHeroInput() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const passiveCapture = { capture: true, passive: true } as const;
  window.addEventListener('scroll', handleScroll, passiveCapture);
  window.addEventListener('wheel', handleWheel, passiveCapture);
  window.addEventListener('touchstart', handleTouch, passiveCapture);
  window.addEventListener('touchmove', handleTouch, passiveCapture);
  window.addEventListener('touchend', handleTouch, passiveCapture);
  window.addEventListener('touchcancel', handleTouch, passiveCapture);
  window.addEventListener('pointerdown', handlePointerStart, passiveCapture);
  window.addEventListener('pointerup', handlePointerEnd, passiveCapture);
  window.addEventListener('pointercancel', handlePointerEnd, passiveCapture);
  window.addEventListener('blur', resetInteraction);
  window.addEventListener('pagehide', resetInteraction);
  document.addEventListener('visibilitychange', handleVisibility);

  ({ width: viewportWidth, height: viewportHeight } = readViewportSize());
  window.addEventListener('resize', handleViewportChange, { passive: true });
  window.addEventListener('orientationchange', handleOrientationChange, { passive: true });
  window.visualViewport?.addEventListener('resize', handleViewportChange, { passive: true });
}

export function noteHeroInteraction() {
  initializeHeroInput();
  markActivity();
}

/** True while a real scroll/wheel/touch sequence is in flight. */
export function isScrollLikelyActive() {
  initializeHeroInput();
  return !isHeroInteractionQuiet();
}

export function subscribeHeroInteraction(listener: () => void) {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function subscribeHeroViewportInvalidation(listener: () => void) {
  viewportListeners.add(listener);
  return () => viewportListeners.delete(listener);
}

/** Resolves once no finger or wheel stream is holding the page. */
export function waitForHeroInputRelease(signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve(false);
  if (!hasActiveHeroInput()) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let finished = false;
    const finish = (value: boolean) => {
      if (finished) return;
      finished = true;
      inputReleaseListeners.delete(check);
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const check = () => {
      if (!hasActiveHeroInput()) finish(true);
    };
    const abort = () => finish(false);
    inputReleaseListeners.add(check);
    signal?.addEventListener('abort', abort, { once: true });
    check();
  });
}

/** Resolves once input has been quiet continuously for `quietFor` ms. */
export function waitForHeroInteractionQuiet(signal?: AbortSignal, quietFor = QUIET_AFTER_MS) {
  if (signal?.aborted) return Promise.resolve(false);
  if (isHeroInteractionQuiet() && now() - lastActivityAt >= quietFor) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let timer = 0;
    let finished = false;
    const finish = (value: boolean) => {
      if (finished) return;
      finished = true;
      if (timer) window.clearTimeout(timer);
      activityListeners.delete(check);
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const check = () => {
      if (signal?.aborted) {
        finish(false);
        return;
      }
      const remaining = quietFor - (now() - lastActivityAt);
      if (isHeroInteractionQuiet() && remaining <= 0) {
        finish(true);
        return;
      }
      if (timer) window.clearTimeout(timer);
      // Active input is released through `scheduleQuietCheck`, which publishes
      // the next quiet-state change. Spinning a 1ms timer while a wheel stream
      // is live starves the very scroll events this waiter observes.
      timer = hasActiveHeroInput()
        ? 0
        : window.setTimeout(check, Math.max(1, remaining));
    };
    const abort = () => finish(false);
    activityListeners.add(check);
    signal?.addEventListener('abort', abort, { once: true });
    check();
  });
}
