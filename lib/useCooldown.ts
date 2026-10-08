'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * A resend countdown — 「重新发送（58 秒）」 — for any action that sends a one-time code.
 *
 *     const cooldown = useCooldown(`register:${userId}`);
 *     <Button disabled={cooldown.active} onClick={resend}>
 *       {cooldown.active ? `重新发送（${cooldown.remaining} 秒）` : '重新发送验证码'}
 *     </Button>
 *     // after the send is accepted: cooldown.start()
 *
 * The deadline is a wall-clock time, not a counter: a backgrounded tab's timers are throttled
 * (or frozen, on a phone), and a counter decremented once a second came back reading whatever
 * it had reached when the tab left. It is also kept per `key` outside the component, so a
 * dialog closed and reopened — or a form re-keyed — within the window resumes the countdown
 * rather than offering a fresh send the server would refuse.
 *
 * `start()` once the send has been *accepted*: a send that failed has nothing to wait for.
 */

const deadlines = new Map<string, number>();
/** Whole seconds left per key, recomputed only on a tick — a snapshot must be stable between reads. */
const remaining = new Map<string, number>();
const listeners = new Set<() => void>();
let ticker = 0;

function recompute() {
  const now = Date.now();
  for (const [key, deadline] of deadlines) {
    const left = Math.max(0, Math.ceil((deadline - now) / 1000));
    if (left > 0) {
      remaining.set(key, left);
    } else {
      deadlines.delete(key);
      remaining.delete(key);
    }
  }
  listeners.forEach((listener) => listener());
  if (!deadlines.size && ticker) {
    window.clearInterval(ticker);
    ticker = 0;
  }
}

function ensureTicker() {
  if (ticker || typeof window === 'undefined' || !deadlines.size) return;
  /* Twice a second, so the label changes within half a second of the true boundary rather
     than drifting up to a whole second behind a timer that started between two ticks. */
  ticker = window.setInterval(recompute, 500);
}

function onVisible() {
  // A tab that comes back reads the true remainder at once, not on the next tick.
  if (document.visibilityState === 'visible') recompute();
}

function subscribe(listener: () => void) {
  if (!listeners.size) document.addEventListener('visibilitychange', onVisible);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) document.removeEventListener('visibilitychange', onVisible);
  };
}

/**
 * Begin (or restart) a countdown from anywhere — including before the component that shows
 * it has mounted: a registration's first code is sent by the sign-up request itself, and the
 * step with the resend control appears only once that request has answered.
 */
export function startCooldown(key: string, seconds = 60): void {
  deadlines.set(key, Date.now() + seconds * 1000);
  recompute();
  ensureTicker();
}

export interface Cooldown {
  /** Whole seconds until the action is allowed again; 0 when it is. */
  remaining: number;
  active: boolean;
  /** Begin (or restart) the wait. */
  start: () => void;
  /** Forget the wait, e.g. once the code has been used. */
  reset: () => void;
}

/**
 * @param key what is being waited for — one countdown per recipient, so a different address
 *   is not held back by the last one. `null` while there is nothing to count down for.
 * @param seconds the wait, 60 by default (the backend's own resend window).
 */
export function useCooldown(key: string | null, seconds = 60): Cooldown {
  const left = useSyncExternalStore(
    subscribe,
    () => (key ? (remaining.get(key) ?? 0) : 0),
    () => 0,
  );

  // A countdown resumed by a remount needs the shared ticker running again.
  useEffect(() => {
    if (key && deadlines.has(key)) {
      recompute();
      ensureTicker();
    }
  }, [key]);

  const start = useCallback(() => {
    if (key) startCooldown(key, seconds);
  }, [key, seconds]);

  const reset = useCallback(() => {
    if (!key) return;
    deadlines.delete(key);
    remaining.delete(key);
    listeners.forEach((listener) => listener());
  }, [key]);

  return { remaining: left, active: left > 0, start, reset };
}
