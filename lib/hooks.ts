'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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

/* Outside the hook: the React Compiler cannot lower a `??` inside a `try`, and with the read
   inline it skipped the whole hook — which the image viewer and the mascot render. */
function readStoredValue(key: string, fallback: string | null): string | null {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

/** A device preference with the same fallback during SSR and denied storage.
 * Both this tab's settings writer and another tab can change the value. */
export function useStoredValue(key: string, fallback: string | null = null): string | null {
  const subscribe = useCallback((listener: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === key) listener();
    };
    window.addEventListener('settings_updated', listener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('settings_updated', listener);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);

  return useSyncExternalStore(subscribe, () => readStoredValue(key, fallback), () => fallback);
}

export function useStoredBoolean(key: string, fallback = false): boolean {
  const value = useStoredValue(key, String(fallback));
  return value === 'true' ? true : value === 'false' ? false : fallback;
}

/**
 * The stored session, as a plain function: the one reader of the localStorage
 * user_info JSON, so nothing hand-parses it (and every call site gets the
 * window guard for free). A function rather than a hook because many call
 * sites read credentials at event time; rendering uses `useSession` below.
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

/**
 * The sentence a sign-in shows when the browser refuses to store it — private modes, a site
 * setting, a sandboxed frame. The session *is* the stored token, so there is nothing to fall
 * back to; saying so beats a generic network error.
 */
export const SESSION_STORAGE_BLOCKED = '浏览器禁用了本地存储，无法保持登录';

/** Publish a new login and its API key together before starting account reads.
 * Throws a readable Chinese `Error` when storage is refused, rather than the engine's
 * `SecurityError`. */
export function writeUserInfo(user: StoredUserInfo): void {
  const serialised = JSON.stringify(user);
  if (!parseSession(serialised)) throw new Error('登录信息无效');
  try {
    localStorage.setItem(LS_KEYS.userInfo, serialised);
    if (typeof user.api_key === 'string' && user.api_key) {
      localStorage.setItem(LS_KEYS.derpiApiKey, user.api_key);
    } else {
      localStorage.removeItem(LS_KEYS.derpiApiKey);
    }
  } catch (error) {
    throw new Error(SESSION_STORAGE_BLOCKED, { cause: error });
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

/** The expected token protects a new login from an older request's 401. Storage that
 * refuses the removal cannot hold a session either, so the event still goes out. */
export function clearUserInfo(expectedToken: string): boolean {
  if (readToken() !== expectedToken) return false;
  try {
    localStorage.removeItem(LS_KEYS.userInfo);
    localStorage.removeItem(LS_KEYS.derpiApiKey);
  } catch {
    /* Blocked mid-session: nothing further can be stored or removed; tell the app anyway. */
  }
  window.dispatchEvent(new Event('user_info_updated'));
  return true;
}

/** The token alone, which is what most call sites actually wanted. */
export function readToken(): string | null {
  return readUserInfo()?.token || null;
}

/* One shared clock for relative times, ticking on the minute while anything reads it. */
let clockNow = 0;
let clockTimer: ReturnType<typeof setTimeout> | undefined;
const clockListeners = new Set<() => void>();

function scheduleClockTick() {
  clockTimer = setTimeout(() => {
    clockNow = Date.now();
    for (const listener of clockListeners) listener();
    scheduleClockTick();
  }, 60_000 - (Date.now() % 60_000) + 50);
}

function subscribeClock(listener: () => void) {
  if (clockListeners.size === 0) {
    /* Stopped while nothing read it: the value it holds is stale by however long that was.
       React compares the snapshot again after subscribing, so this is picked up at once. */
    clockNow = Date.now();
    scheduleClockTick();
  }
  clockListeners.add(listener);
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== undefined) {
      clearTimeout(clockTimer);
      clockTimer = undefined;
    }
  };
}

const readClock = () => clockNow || (clockNow = Date.now());
const serverClock = () => null;

/**
 * "Now", for relative times (`12 分钟前`), as a value React can hydrate: `null` on the server
 * and in the hydration render, then the current time, re-read once a minute. Text that depends
 * on the moment it is rendered must not be in server HTML — the server and the browser render
 * it seconds apart, and a minute boundary (or the five-minute 在线 window) falling between them
 * is a hydration mismatch. Render an absolute date, or nothing, while this is `null`.
 */
export function useNow(): number | null {
  return useSyncExternalStore(subscribeClock, readClock, serverClock);
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

/** Input types that take typed text — where Escape belongs to the field, not the screen. */
const TEXT_ENTRY_TYPES = new Set([
  'text', 'search', 'email', 'url', 'tel', 'password', 'number',
  'date', 'datetime-local', 'month', 'time', 'week',
]);

/**
 * Whether keyboard focus is somewhere the user types: a text input, a textarea, a select, or
 * rich text (`contenteditable`, which is how the forum editor takes input). A checkbox or a
 * button is not — Escape from those still means "leave".
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_ENTRY_TYPES.has(target.type);
}

/**
 * Whether a key press asks the screen to close — `useEscapeBack`'s whole decision, kept pure so
 * it can be checked without a DOM. Not for an IME's composition-cancel, a press something nearer
 * already handled, or a press while the user types in a field (see `useEscapeBack`).
 */
export function escapeMeansBack(
  event: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'isComposing' | 'keyCode' | 'target'>,
): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  const focused = typeof document === 'undefined' ? null : document.activeElement;
  return !isEditableTarget(event.target) && !isEditableTarget(focused);
}

/**
 * Escape closes the screen — every full-screen view's second way out beside its
 * pinned back button. `enabled` stands the screen down while something layered on
 * top (dialog, lightbox, popover, combobox) owns Escape first: one press must not
 * close two levels. `defaultPrevented` covers the same hazard for handlers that
 * call preventDefault rather than being tracked in state, and the listener is
 * on window in the bubble phase so a nearer listener gets first refusal.
 *
 * **Escape inside a field is the field's.** People press it to dismiss an IME's candidate
 * list or to clear what they typed; treating it as "leave" closed a half-written message and
 * navigated away from a half-written reply, discarding both. So a press whose target (or the
 * focused element) takes text is ignored, as is any press during IME composition — a macOS
 * Chinese IME's composition-cancel arrives as `key: 'Escape'` with `isComposing` set, and
 * older engines report it as key code 229. A screen that wants Escape-to-clear handles it
 * inside the field.
 *
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
      if (!escapeMeansBack(event)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
