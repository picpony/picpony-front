'use client';

/**
 * Start fetching when someone looks like they are about to ask — an intent ladder (hover
 * ~70ms, focus ~120ms, a mouse or pen press immediately, a finger's press ~100ms later unless it
 * turns into a scroll, cancel on leave) gated by `isScrollLikelyActive`.
 *
 * The delays differ: a pointer that stops is intent, one sweeping past is not, so hover waits
 * 70ms; focus waits longer because arrowing passes through every item; touch has no hover, so
 * its press is the earliest signal — but the same press also starts every scroll, so it waits
 * one beat and is dropped by `pointercancel`. Guessing is safe: prefetches run at `background` priority and
 * `lib/resource.ts` caps background work at two of its four slots, so a guess cannot take the
 * slot a user is actually waiting on.
 */

import { useCallback, useEffect, useRef } from 'react';
import { isScrollLikelyActive } from '@/lib/hero/input';

/** The same two numbers `useHeroLink` uses — one ladder, not two. */
const HOVER_INTENT_DELAY_MS = 70;
const FOCUS_INTENT_DELAY_MS = 120;
/**
 * A finger's press is not yet a decision: the same `pointerdown` starts a scroll through a list
 * of drawer rows or pager buttons, and warming on it fetched the destination of whatever the
 * scroll happened to start on — speculation adding a request, which the data layer's rule
 * forbids. So under a finger the warm waits this long, is dropped by a `pointercancel` (what the
 * browser fires when the touch becomes a pan) and re-checks the scroll gate when it fires. A tap's
 * press-to-release is about this long, so a real tap still warms before its own click lands.
 */
const TOUCH_INTENT_DELAY_MS = 100;

export interface IntentPrefetchHandlers {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onPointerDown: (event?: { pointerType?: string }) => void;
  onPointerCancel: () => void;
}

/**
 * `warm` is called at most once per intent and may run again after a cancel; it is *not* called
 * on unmount cleanup — a link scrolling out of a list is not a decision to fetch. Cancel-on-leave
 * belongs in `onCancel`.
 */
export function useIntentPrefetch(
  warm: (() => void) | null | undefined,
  onCancel?: () => void,
): IntentPrefetchHandlers {
  const timer = useRef(0);
  /* Held in a ref and written from an effect: call sites pass inline arrows, so keying the
     handlers on `warm` would rebuild them every render, and `react-hooks/refs` rejects a
     render-phase write (a render React discards would still have mutated it). */
  const latest = useRef({ warm, onCancel });
  useEffect(() => {
    latest.current = { warm, onCancel };
  }, [warm, onCancel]);

  const cancel = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
    latest.current.onCancel?.();
  }, []);

  const schedule = useCallback((delay: number) => {
    if (timer.current || !latest.current.warm || isScrollLikelyActive()) return;
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      /* Re-checked on fire, not only on schedule: a scroll that starts inside the delay is
         exactly the case the gate is for. */
      if (!isScrollLikelyActive()) latest.current.warm?.();
    }, delay);
  }, []);

  const now = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
    latest.current.warm?.();
  }, []);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return {
    onPointerEnter: () => schedule(HOVER_INTENT_DELAY_MS),
    onPointerLeave: cancel,
    onFocus: () => schedule(FOCUS_INTENT_DELAY_MS),
    onBlur: cancel,
    onPointerDown: (event) => {
      if (event?.pointerType === 'touch') schedule(TOUCH_INTENT_DELAY_MS);
      else now();
    },
    onPointerCancel: cancel,
  };
}
