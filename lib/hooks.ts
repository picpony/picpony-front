'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { LS_KEYS, MEDIA } from './constants';

/**
 * Subscribes to a media query. useSyncExternalStore over useState + an
 * effect: the server snapshot is explicit, so a component branching on width
 * renders the same markup on both sides of hydration.
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
 * Coarse device class, from media queries rather than a `resize` listener:
 * queries fire only when a threshold is actually crossed, so consumers do not
 * re-render throughout a drag.
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
 * The stored session, as a plain function: the one reader of the localStorage
 * user_info JSON, so nothing hand-parses it (and every call site gets the
 * window guard for free). A function rather than a hook because many call
 * sites are not in hook position; `useAuth` wraps it for the effect-dependency case.
 */
export function readUserInfo(): { token: string; [key: string]: unknown } | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(LS_KEYS.userInfo);
    if (!stored) return null;
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/** The token alone, which is what most call sites actually wanted. */
export function readToken(): string | null {
  return readUserInfo()?.token || null;
}

/**
 * Reads the stored session. Every member and the returned object are memoised,
 * so `useAuth` is safe in dependency arrays: a fresh closure per render made
 * effects re-run every render — a dependency-identity cascade that once
 * rate-limited /favorites.
 */
export function useAuth() {
  return useMemo(() => ({ getUserInfo: readUserInfo, getToken: readToken }), []);
}

/**
 * Smooths a loading flag so placeholders never flicker. Nothing is shown until
 * `delay` passes — a skeleton that appears and vanishes within a frame is more
 * distracting than showing nothing — and once shown it stays at least
 * `minDuration`.
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

    // Hide immediately if it never appeared; otherwise hold its minimum time on screen.
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
 * Escape closes the screen — every full-screen view's second way out beside its
 * pinned back button. `enabled` stands the screen down while something layered on
 * top (dialog, lightbox, popover, combobox) owns Escape first: one press must not
 * close two levels. `defaultPrevented` covers the same hazard for handlers that
 * call preventDefault rather than being tracked in state, and the listener is
 * on window in the bubble phase so a nearer listener gets first refusal.
 * `onBack` is held in a ref written from an effect: pages rebuild their handler
 * every render, and a render React discards must not mutate it.
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
