'use client';

import {
  HERO_BACKGROUND_SELECTOR,
  HERO_GALLERY_ANCHOR_SELECTOR,
} from './constants';
import type { HeroRect, HeroHost } from './geometry';

type FrameTask<T> = {
  read: () => T;
  write: (value: T) => void;
};

type PendingFrameTask = {
  read: () => unknown;
  write: (value: unknown) => void;
};

const FRAME_READ_FAILED = Symbol('image-hero-frame-read-failed');

class HeroFrameScheduler {
  private pending = new Map<object, PendingFrameTask>();
  private frame = 0;
  private afterFrame = new Set<() => void>();

  request<T>(owner: object, task: FrameTask<T>) {
    this.pending.set(owner, task as PendingFrameTask);
    if (!this.frame) this.frame = requestAnimationFrame(this.flush);
  }

  cancel(owner: object) {
    this.pending.delete(owner);
  }

  settled() {
    if (!this.frame && this.pending.size === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.afterFrame.add(resolve);
    });
  }

  dispose() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending.clear();
    const listeners = [...this.afterFrame];
    this.afterFrame.clear();
    listeners.forEach((resolve) => {
      try {
        resolve();
      } catch {
        // Keep disposing deterministic even when a caller callback is stale.
      }
    });
  }

  private flush = () => {
    this.frame = 0;
    const tasks = [...this.pending.values()];
    this.pending.clear();
    const values = new Array<unknown>(tasks.length);

    for (let index = 0; index < tasks.length; index += 1) {
      try {
        values[index] = tasks[index].read();
      } catch {
        // One disconnected node must not strand the scheduler (or unrelated
        // flight work) behind a rejected frame task.
        values[index] = FRAME_READ_FAILED;
      }
    }
    for (let index = 0; index < tasks.length; index += 1) {
      if (values[index] === FRAME_READ_FAILED) continue;
      try {
        tasks[index].write(values[index]);
      } catch {
        // Writes are best-effort. The owner will either schedule a fresh frame
        // or be disposed by its session; waiters must always be released.
      }
    }

    if (this.pending.size > 0 && !this.frame) {
      this.frame = requestAnimationFrame(this.flush);
      return;
    }
    const listeners = [...this.afterFrame];
    this.afterFrame.clear();
    listeners.forEach((resolve) => {
      try {
        resolve();
      } catch {
        // An observer must never prevent another waiter from settling.
      }
    });
  };
}

export const heroFrameScheduler = new HeroFrameScheduler();

const QUIET_AFTER_MS = 96;
// Wheel streams can have gaps well above one frame (especially trackpads and
// high-resolution wheels). Releasing a handoff after 48ms detached the latched
// scroller between two events and made the next part of the same stream vanish.
const WHEEL_RELEASE_MS = 160;
let activityInitialized = false;
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

function activeTouchCount() {
  return Math.max(legacyTouchCount, activeTouchPointers.size);
}

function notifyInputReleaseChange() {
  inputReleaseListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // One stale touch waiter cannot strand the active interaction stream.
    }
  });
}

function setLegacyTouchCount(next: number) {
  if (legacyTouchCount === next) return;
  legacyTouchCount = next;
  notifyInputReleaseChange();
}

function publishQuiet(next: boolean) {
  if (quiet === next) return;
  quiet = next;
  activityListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A stale subscriber cannot break the global interaction gate.
    }
  });
}

function scheduleQuietCheck() {
  if (quietTimer) window.clearTimeout(quietTimer);
  const remaining = Math.max(0, QUIET_AFTER_MS - (now() - lastActivityAt));
  quietTimer = window.setTimeout(() => {
    quietTimer = 0;
    if (activeTouchCount() > 0 || wheelActive) return;
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

function resetInteraction() {
  const hadActiveInput = activeTouchCount() > 0 || wheelActive;
  legacyTouchCount = 0;
  activeTouchPointers.clear();
  wheelActive = false;
  if (wheelReleaseTimer) window.clearTimeout(wheelReleaseTimer);
  wheelReleaseTimer = 0;
  if (hadActiveInput) notifyInputReleaseChange();
  if (touchSafetyTimer) window.clearTimeout(touchSafetyTimer);
  touchSafetyTimer = 0;
  if (quietTimer) window.clearTimeout(quietTimer);
  quietTimer = 0;
  lastActivityAt = now();
  publishQuiet(true);
}

const handleScrollActivity = () => markActivity();
const handleWheelActivity = () => {
  if (!wheelActive) {
    wheelActive = true;
    notifyInputReleaseChange();
  }
  if (wheelReleaseTimer) window.clearTimeout(wheelReleaseTimer);
  wheelReleaseTimer = window.setTimeout(() => {
    wheelReleaseTimer = 0;
    if (!wheelActive) return;
    wheelActive = false;
    notifyInputReleaseChange();
    scheduleQuietCheck();
  }, WHEEL_RELEASE_MS);
  markActivity();
};
const armTouchSafety = () => {
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
    if (hadTouches) notifyInputReleaseChange();
    markActivity();
  }, 4000);
};
const handleTouchStartActivity = (event: TouchEvent) => {
  setLegacyTouchCount(event.touches.length);
  armTouchSafety();
  markActivity();
};
const handleTouchMoveActivity = (event: TouchEvent) => {
  setLegacyTouchCount(event.touches.length);
  armTouchSafety();
  markActivity();
};
const handleTouchEndActivity = (event: TouchEvent) => {
  setLegacyTouchCount(event.touches.length);
  armTouchSafety();
  markActivity();
};
const handleTouchCancelActivity = (event: TouchEvent) => {
  setLegacyTouchCount(event.touches.length);
  armTouchSafety();
  markActivity();
};
const handlePointerStartActivity = (event: PointerEvent) => {
  if (event.pointerType !== 'touch') return;
  const size = activeTouchPointers.size;
  activeTouchPointers.add(event.pointerId);
  if (activeTouchPointers.size !== size) notifyInputReleaseChange();
  armTouchSafety();
  markActivity();
};
const handlePointerEndActivity = (event: PointerEvent) => {
  if (event.pointerType !== 'touch') return;
  if (activeTouchPointers.delete(event.pointerId)) notifyInputReleaseChange();
  armTouchSafety();
  markActivity();
};
const handleVisibilityActivity = () => {
  if (document.visibilityState === 'hidden') resetInteraction();
};

function notifyViewportInvalidated() {
  viewportListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Viewport invalidation remains available to the remaining sessions.
    }
  });
}

export function initializeHeroFrameRuntime() {
  if (activityInitialized || typeof window === 'undefined') return;
  activityInitialized = true;

  window.addEventListener('scroll', handleScrollActivity, { capture: true, passive: true });
  window.addEventListener('wheel', handleWheelActivity, { capture: true, passive: true });
  window.addEventListener('touchstart', handleTouchStartActivity, {
    capture: true,
    passive: true,
  });
  window.addEventListener('touchmove', handleTouchMoveActivity, {
    capture: true,
    passive: true,
  });
  window.addEventListener('touchend', handleTouchEndActivity, {
    capture: true,
    passive: true,
  });
  window.addEventListener('touchcancel', handleTouchCancelActivity, {
    capture: true,
    passive: true,
  });
  window.addEventListener('pointerdown', handlePointerStartActivity, {
    capture: true,
    passive: true,
  });
  window.addEventListener('pointerup', handlePointerEndActivity, {
    capture: true,
    passive: true,
  });
  window.addEventListener('pointercancel', handlePointerEndActivity, {
    capture: true,
    passive: true,
  });
  window.addEventListener('blur', resetInteraction);
  window.addEventListener('pagehide', resetInteraction);
  document.addEventListener('visibilitychange', handleVisibilityActivity);
  window.addEventListener('resize', notifyViewportInvalidated, { passive: true });
  window.addEventListener('orientationchange', notifyViewportInvalidated, { passive: true });
  window.visualViewport?.addEventListener('resize', notifyViewportInvalidated, { passive: true });
  window.visualViewport?.addEventListener('scroll', notifyViewportInvalidated, { passive: true });
}

export function noteHeroInteraction() {
  initializeHeroFrameRuntime();
  markActivity();
}

export function isHeroInteractionQuiet() {
  return quiet && !hasActiveHeroInput();
}

export function hasActiveHeroInput() {
  return activeTouchCount() > 0 || wheelActive;
}

export function subscribeHeroInteraction(listener: () => void) {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function subscribeHeroViewportInvalidation(listener: () => void) {
  viewportListeners.add(listener);
  return () => viewportListeners.delete(listener);
}

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
      // is active starves the very scroll events this waiter is observing.
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

export type HeroScrollPlane = {
  anchor: HTMLElement;
  scroller: HTMLElement;
  host: HeroHost;
  originLeft: number;
  originTop: number;
  scrollLeft: number;
  scrollTop: number;
  viewportWidth: number;
  viewportHeight: number;
  maxScrollLeft: number;
  maxScrollTop: number;
};

function hostFromScroller(scroller: HTMLElement): HeroHost {
  const rect = scroller.getBoundingClientRect();
  return {
    element: scroller,
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function getGalleryScrollPlane(): HeroScrollPlane | null {
  const anchor = document.querySelector<HTMLElement>(HERO_GALLERY_ANCHOR_SELECTOR);
  const scroller = document.querySelector<HTMLElement>(HERO_BACKGROUND_SELECTOR);
  if (!anchor || !scroller) return null;
  const scrollLeft = scroller.scrollLeft;
  const scrollTop = scroller.scrollTop;
  const viewportWidth = scroller.clientWidth;
  const viewportHeight = scroller.clientHeight;
  return {
    anchor,
    scroller,
    host: hostFromScroller(scroller),
    originLeft: scrollLeft,
    originTop: scrollTop,
    scrollLeft,
    scrollTop,
    viewportWidth,
    viewportHeight,
    maxScrollLeft: Math.max(0, scroller.scrollWidth - viewportWidth),
    maxScrollTop: Math.max(0, scroller.scrollHeight - viewportHeight),
  };
}

export function getElementScrollPlane(
  anchor: HTMLElement,
  scroller: HTMLElement,
): HeroScrollPlane {
  const scrollLeft = scroller.scrollLeft;
  const scrollTop = scroller.scrollTop;
  const viewportWidth = scroller.clientWidth;
  const viewportHeight = scroller.clientHeight;
  return {
    anchor,
    scroller,
    host: hostFromScroller(scroller),
    originLeft: scrollLeft,
    originTop: scrollTop,
    scrollLeft,
    scrollTop,
    viewportWidth,
    viewportHeight,
    maxScrollLeft: Math.max(0, scroller.scrollWidth - viewportWidth),
    maxScrollTop: Math.max(0, scroller.scrollHeight - viewportHeight),
  };
}

export function screenRectToPlane(rect: HeroRect, plane: HeroScrollPlane): HeroRect {
  return {
    top: rect.top - plane.host.top + plane.scrollTop - plane.originTop,
    left: rect.left - plane.host.left + plane.scrollLeft - plane.originLeft,
    width: rect.width,
    height: rect.height,
  };
}

export function planeRectToScreen(rect: HeroRect, plane: HeroScrollPlane): HeroRect {
  return {
    top: plane.host.top + rect.top - (plane.scroller.scrollTop - plane.originTop),
    left: plane.host.left + rect.left - (plane.scroller.scrollLeft - plane.originLeft),
    width: rect.width,
    height: rect.height,
  };
}

export function sizePlaneLayer(layer: HTMLElement, plane: HeroScrollPlane) {
  plane.originTop = Math.min(plane.maxScrollTop, Math.max(0, plane.originTop));
  plane.originLeft = Math.min(plane.maxScrollLeft, Math.max(0, plane.originLeft));
  layer.style.top = `${plane.originTop}px`;
  layer.style.left = `${plane.originLeft}px`;
  layer.style.width = `${plane.viewportWidth}px`;
  layer.style.height = `${plane.viewportHeight}px`;
}
