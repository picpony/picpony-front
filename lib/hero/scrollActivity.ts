'use client';

import {
  initializeHeroFrameRuntime,
  isHeroInteractionQuiet,
  noteHeroInteraction,
} from './anchor';

/**
 * Compatibility surface for callers that only need to defer optional work
 * while a real scroll, wheel, or touch sequence is active. The controller's
 * single interaction signal owns this now: no DOM observer, dataset flag, or
 * independent settling timer is allowed to compete with Hero gestures.
 */
export function ensureScrollActivityListeners() {
  initializeHeroFrameRuntime();
}

/**
 * Scroll events are captured once at window level by `anchor.ts`, including
 * nested overlay scrollers. Keeping this function makes older call sites
 * harmless while avoiding per-scroller listeners and lifetime leaks.
 */
export function bindScrollActivityRoot(element: HTMLElement | null | undefined) {
  void element;
  initializeHeroFrameRuntime();
}

export function isScrollLikelyActive() {
  initializeHeroFrameRuntime();
  return !isHeroInteractionQuiet();
}

export function markScrollActivity() {
  noteHeroInteraction();
}
