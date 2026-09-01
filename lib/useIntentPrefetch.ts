'use client';

/**
 * Start fetching when someone looks like they are about to ask — an intent ladder (hover
 * ~70ms, focus ~120ms, press immediately, cancel on leave) gated by `isScrollLikelyActive`.
 *
 * The delays differ: a pointer that stops is intent, one sweeping past is not, so hover waits
 * 70ms; focus waits longer because arrowing passes through every item; touch has no hover, so
 * press is the earliest signal. Guessing is safe: prefetches run at `background` priority and
 * `lib/resource.ts` caps background work at two of its four slots, so a guess cannot take the
 * slot a user is actually waiting on.
 */

import { useCallback, useEffect, useRef } from 'react';
import { isScrollLikelyActive } from '@/lib/hero';

/** The same two numbers `useHeroLink` uses — one ladder, not two. */
const HOVER_INTENT_DELAY_MS = 70;
const FOCUS_INTENT_DELAY_MS = 120;

export interface IntentPrefetchHandlers {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onPointerDown: () => void;
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
    onPointerDown: now,
  };
}
