'use client';

/**
 * What a screen was *showing*, for the length of the session.
 *
 * ## The half of `pageCache` that is not a cache
 *
 * `lib/pageCache.ts` existed because navigating away unmounts a page — `[data-page-content]` is
 * keyed on the pathname — so coming back re-ran every effect and the screen arrived empty. It
 * solved that by storing the component's whole render in one object, and its docstring is explicit
 * about why it was not a request cache: *"including the page number, which a plain request cache
 * would lose."*
 *
 * That is exactly right, and it is two problems wearing one coat. **What the server said** is
 * shared, keyed by the arguments of the read, and belongs to `lib/resource.ts`. **Which arguments
 * this screen was last using** is private to the screen, is not a cache of anything, and belongs
 * here. Conflating them is why `pageCache` could only be adopted by a component willing to lift
 * its entire state into one snapshot object — which is why, in the end, only three did.
 *
 * Split apart, both get easier. A remount reads its page number from here and its data from the
 * resource cache, and paints in the first frame with neither a skeleton nor a request.
 *
 * ## Session-scoped, and deliberately so
 *
 * A `Map` in module scope. A reload genuinely reloads — `pageCache`'s rule, kept — and signing out
 * empties it, because a page number is harmless but a selected contact id is not.
 */

import { useCallback, useState } from 'react';

const store = new Map<string, unknown>();

/**
 * Remembered state, restored on remount.
 *
 * Reads exactly like `useState` and differs in one way: the initial value is whatever this key was
 * last set to in this session. So a screen writes `useScreenState('history:page', 1)` and gets 1
 * the first time and 4 when it comes back from page 4.
 *
 * The key is a string the caller picks and it has to be **unique across the app**, because the
 * store is flat. Prefix it with the screen: `'history:page'`, `'search:query'`. It must *not*
 * include anything that identifies a record if two records share a screen — see
 * `useScreenStateFor`.
 */
export function useScreenState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => (store.has(key) ? (store.get(key) as T) : initial));

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        /* Written during the updater rather than from an effect, so a navigation that unmounts in
           the same commit as the last `set` still records it. An effect would not have run. */
        store.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}

/**
 * The same thing, scoped to a record.
 *
 * Two profiles are two screens that happen to share a component, and a flat key would carry page 4
 * of one into the other. That is not hypothetical — AGENTS.md records the identical bug in the
 * per-tab scroll memory, where `posts`/`uploads`/`faves`/`comments` offsets leaked from one profile
 * to the next because the map was keyed on the tab name and tab names are unique app-wide. Unique
 * is not the same as sufficient.
 */
export function useScreenStateFor<T>(
  key: string,
  id: string | number | null | undefined,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  return useScreenState(`${key}#${id ?? ''}`, initial);
}

/**
 * Empties the store.
 *
 * Signing out, alongside `clearAllResources()`. A page number surviving a sign-out is harmless; a
 * selected contact, a search query or an open thread id is the previous account's business.
 */
export function clearScreenState() {
  store.clear();
}
