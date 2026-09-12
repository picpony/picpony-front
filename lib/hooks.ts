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
export type StoredUserInfo = { token: string; [key: string]: unknown };

function readSessionText(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(LS_KEYS.userInfo);
  } catch {
    return null;
  }
}

function parseSession(stored: string | null): StoredUserInfo | null {
  if (!stored) return null;
  try {
    const user: unknown = JSON.parse(stored);
    return user !== null && typeof user === 'object' && !Array.isArray(user) &&
      'token' in user && typeof user.token === 'string' && user.token.length > 0
      ? user as StoredUserInfo
      : null;
  } catch {
    return null;
  }
}

export function readUserInfo(): StoredUserInfo | null {
  return parseSession(readSessionText());
}

/** A profile response may omit credentials. Only an explicit empty string
 * clears a binding; absent/null fields retain the current account's values. */
export function resolveDerpiCredentials(
  incoming: Record<string, unknown>,
  current: Record<string, unknown> | null,
): { api_key: string; derpi_user_id: string; derpi_username: string } {
  const key = incoming.api_key ?? current?.api_key;
  const id = incoming.derpi_user_id ?? current?.derpi_user_id;
  const username = incoming.derpi_username ?? current?.derpi_username;
  return {
    api_key: typeof key === 'string' ? key : '',
    derpi_user_id: typeof id === 'string' || typeof id === 'number' ? String(id) : '',
    derpi_username: typeof username === 'string' ? username : '',
  };
}

function subscribeSession(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LS_KEYS.userInfo) listener();
  };
  window.addEventListener('user_info_updated', listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('user_info_updated', listener);
    window.removeEventListener('storage', onStorage);
  };
}

const noSession = () => null;
const subscribeHydration = () => () => {};
const hydrated = () => true;
const serverHydrated = () => false;

/** Reactive device session. SSR and hydration both start signed out; the raw string
 * is the stable external-store snapshot, so JSON parsing cannot cause render loops.
 * `ready` distinguishes hydration from a genuinely signed-out visitor. */
export function useSession() {
  const stored = useSyncExternalStore(subscribeSession, readSessionText, noSession);
  const ready = useSyncExternalStore(subscribeHydration, hydrated, serverHydrated);
  const user = useMemo(() => parseSession(stored), [stored]);
  return useMemo(() => ({ user, token: user?.token ?? null, ready }), [user, ready]);
}

/** Publish a new login and its API key together before starting account reads. */
export function writeUserInfo(user: StoredUserInfo): void {
  const serialised = JSON.stringify(user);
  if (!parseSession(serialised)) throw new Error('登录信息无效');
  localStorage.setItem(LS_KEYS.userInfo, serialised);
  if (typeof user.api_key === 'string' && user.api_key) {
    localStorage.setItem(LS_KEYS.derpiApiKey, user.api_key);
  } else {
    localStorage.removeItem(LS_KEYS.derpiApiKey);
  }
  window.dispatchEvent(new Event('user_info_updated'));
}

/** Merge a response into the current account only. */
export function updateUserInfo(token: string, patch: Record<string, unknown>): boolean {
  const current = readUserInfo();
  if (!current || current.token !== token) return false;
  const next = { ...current, ...patch, token };
  const serialised = JSON.stringify(next);
  if (serialised === readSessionText()) return true;
  writeUserInfo(next);
  return true;
}

/** The expected token protects a new login from an older request's 401. */
export function clearUserInfo(expectedToken: string): boolean {
  if (readToken() !== expectedToken) return false;
  localStorage.removeItem(LS_KEYS.userInfo);
  localStorage.removeItem(LS_KEYS.derpiApiKey);
  window.dispatchEvent(new Event('user_info_updated'));
  return true;
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
