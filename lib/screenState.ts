'use client';

/**
 * What a screen was *showing*, for the length of the session.
 *
 * The half of pageCache that is not a cache: what the server said is shared and keyed
 * by the arguments of the read (lib/resource.ts); which arguments this screen was last
 * using is private to the screen and lives here. Session-scoped on purpose — a reload
 * genuinely reloads, and signing out empties the store.
 */

import { useCallback, useState } from 'react';

const store = new Map<string, unknown>();

/**
 * Remembered state, restored on remount: like `useState`, but the initial value is
 * whatever this key was last set to in this session. The key must be unique across the
 * app (prefix it with the screen) and must not identify a record when records share a
 * screen — use `useScreenStateFor` for that.
 */
export function useScreenState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        // Written in the updater, not an effect: a navigation unmounting in the same
        // commit as the last `set` would otherwise lose it.
        store.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}

/**
 * The same thing, scoped to a record — keyed per record because unique is not the same
 * as sufficient: a flat key would carry page 4 of one profile into another (the same
 * leak the per-tab scroll memory had).
 */
export function useScreenStateFor<T>(
  key: string,
  id: string | number | null | undefined,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  return useScreenState(`${key}#${id ?? ''}`, initial);
}

/**
 * Empties the store, on sign-out (alongside `clearAllResources()`): a page number
 * surviving is harmless, but a selected contact or open thread id is the previous
 * account's business.
 */
export function clearScreenState() {
  store.clear();
}
