'use client';

/**
 * Start fetching when someone looks like they are about to ask.
 *
 * ## Where this comes from
 *
 * `lib/useHero.ts` has had this ladder for the gallery card since the flight was built — hover at
 * 70ms, focus at 120ms, press immediately, cancel on leave — and it is the reason opening a
 * picture feels instant while every other navigation in the app feels like a page load. Nothing
 * else had it. The thirteen sidebar links, the forum rows, the contact rows and the pagination
 * controls all started their work in the destination's first effect, which is the latest possible
 * moment.
 *
 * So this is that ladder with the gallery card taken out of it.
 *
 * ## The three rungs, and why they are three
 *
 * - **Hover, after 70ms.** A pointer crossing a list of links is not intent; a pointer that stops
 *   is. 70ms is short enough to buy most of the round trip and long enough that sweeping the mouse
 *   down a sidebar does not fire thirteen requests.
 * - **Focus, after 120ms.** Longer, because arrowing through a list passes focus through every item
 *   on the way and a keyboard user moves faster than a pointer does.
 * - **Press, immediately.** On a touch screen there is no hover at all, so this is the earliest
 *   honest signal — and it still lands typically 100ms or more before the click does.
 *
 * ## Why guessing is safe here
 *
 * Every prefetch goes out at `background` priority, and `lib/resource.ts` caps background work at
 * two of its four slots. A guess therefore cannot take the last slot from the request a user is
 * actually waiting for — which is the property that makes it defensible to add this to every link
 * in the app rather than to the one screen somebody measured.
 *
 * `isScrollLikelyActive()` is the other guard, and it is not about the network: a finger dragging
 * the page past a link is not hovering it, and treating it as intent would fire a request per row
 * of a flung list.
 */

import { useCallback, useEffect, useRef } from 'react';
import { isScrollLikelyActive } from '@/lib/hero';

/** The same two numbers `useHeroLink` uses. They are one ladder, not two. */
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
 * `warm` is called at most once per intent, and may be called again after a cancel.
 *
 * It is *not* called on unmount cleanup — a link scrolling out of a list is not a decision to
 * fetch. Callers that want a request cancelled on leave should do it inside `onCancel`, which is
 * where the gallery card cancels its own background detail read.
 */
export function useIntentPrefetch(
  warm: (() => void) | null | undefined,
  onCancel?: () => void,
): IntentPrefetchHandlers {
  const timer = useRef(0);
  /* Held in a ref and written from an effect rather than during render: a call site almost always
     passes an inline arrow, and keying the handlers on it would rebuild them every render. Written
     from an effect because `react-hooks/refs` rejects a render-phase write — a render React
     discards would still have mutated it. */
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
      /* Re-checked on fire, not only on schedule. A scroll that starts inside the delay is exactly
         the case the gate is for. */
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
