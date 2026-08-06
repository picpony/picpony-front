'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { MEDIA } from './constants';

/**
 * Subscribes to a media query.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: the server
 * snapshot is explicit, so a component branching on width renders the same
 * markup on both sides instead of hydrating desktop-first and then snapping.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

interface DisplayInfo {
  /** < 640px — 手机 */
  mobile: boolean;
  /** 640px ~ 1023px — 平板/小屏 */
  tablet: boolean;
  /** >= 1024px — 桌面 */
  desktop: boolean;
}

/**
 * Coarse device class.
 *
 * Was a `resize` listener with no debounce that called `setState` on every
 * single event, re-rendering whatever consumed it throughout a drag. Media
 * queries fire only when a threshold is actually crossed.
 *
 * The exact `width` this used to return is gone: nothing needed the number,
 * and exposing it invited more undebounced width branching.
 */
export function useDisplay(): DisplayInfo {
  const atLeastSm = useMediaQuery(MEDIA.sm, true);
  const atLeastLg = useMediaQuery(MEDIA.lg, true);
  return { mobile: !atLeastSm, tablet: atLeastSm && !atLeastLg, desktop: atLeastLg };
}

export function useMasonryColumns() {
  const atLeastMd = useMediaQuery(MEDIA.md, true);
  const atLeastLg = useMediaQuery(MEDIA.lg, true);
  return atLeastLg ? 4 : atLeastMd ? 3 : 2;
}

/**
 * Reads the stored session.
 *
 * Every member is memoised and so is the returned object. This is not a
 * micro-optimisation: the hook is read by components that put `getUserInfo` in
 * an effect's dependency array, and a fresh closure per render made that effect
 * re-run after every render — including the renders its own `setState` calls
 * caused. `/favorites` looped on exactly that, firing three requests per turn
 * until the upstream API rate-limited it.
 */
export function useAuth() {
  const getUserInfo = useCallback((): { token: string; [key: string]: unknown } | null => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem('user_info');
      if (!stored) return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }, []);

  const getToken = useCallback((): string | null => {
    const user = getUserInfo();
    return user?.token || null;
  }, [getUserInfo]);

  return useMemo(() => ({ getUserInfo, getToken }), [getUserInfo, getToken]);
}

export function useModalAnimation(onClose: () => void) {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200);
  };

  return { isClosing, handleClose };
}

/**
 * Smooths a loading flag so placeholders never flicker.
 *
 * Two failure modes, both of which the app had:
 *
 * - A cached or fast response resolves in ~80ms, so the skeleton appears and
 *   vanishes within a frame or two. That flash is more distracting than
 *   showing nothing, so nothing is shown until `delay` has passed.
 * - A response arrives just after the skeleton appears, so it is on screen for
 *   ~50ms. Once shown it therefore stays for at least `minDuration`.
 *
 * The defaults are the usual perceptual numbers: under ~200ms reads as
 * instant, and a state needs roughly 400ms on screen to register as
 * deliberate rather than as a glitch.
 */
export function useDeferredLoading(
  isLoading: boolean,
  { delay = 180, minDuration = 450 }: { delay?: number; minDuration?: number } = {},
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => {
        shownAt.current = performance.now();
        setVisible(true);
      }, delay);
      return () => clearTimeout(timer);
    }

    // Not loading any more: hide immediately if it never appeared, otherwise
    // hold until it has had its minimum time on screen.
    let cancelled = false;
    const elapsed = performance.now() - shownAt.current;
    const remaining = Math.max(0, minDuration - elapsed);
    if (remaining === 0) {
      queueMicrotask(() => {
        if (!cancelled) setVisible(false);
      });
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isLoading, delay, minDuration]);

  return visible;
}

/**
 * Escape closes the screen.
 *
 * Every full-screen view in the app owes the user two ways out — the pinned
 * back button and this — and they were being written one at a time: the image
 * detail had it, the forum post did not, search and messages did not, and the
 * one that existed spelled its own guard conditions inline. Same key, same
 * meaning, one implementation.
 *
 * `enabled` is how a screen stands down while something is layered on top of
 * it. A dialog, a lightbox, a share popover and an open combobox all own Escape
 * first, and if two handlers fire on one press the user loses two levels for
 * one keystroke. Pass `false` whenever any of those is open.
 *
 * `event.defaultPrevented` covers the same hazard for anything that calls
 * `preventDefault()` rather than being tracked in state, and the handler is
 * bound to `window` in the bubble phase so a nearer listener gets first refusal.
 *
 * The callback is held in a ref: a page that rebuilds its back handler every
 * render would otherwise re-bind on every render, and `handleBack` is usually a
 * closure over `router`. The ref is written from an effect rather than during
 * render — writing it inline is the shorter spelling and the one the lint rule
 * `react-hooks/refs` rejects, because a render that React discards would still
 * have mutated it.
 */
export function useEscapeBack(onBack: () => void, enabled = true) {
  const latest = useRef(onBack);

  useEffect(() => {
    latest.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
