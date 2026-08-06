'use client';

/**
 * A snapshot of what a page had already loaded, kept for the length of the
 * session.
 *
 * Navigating away unmounts a page — `[data-page-content]` is keyed on the
 * pathname — so coming back re-ran every `useEffect`, which meant an empty list,
 * a skeleton, a request, and a layout that jumped when the data landed. On the
 * way *into* a route that reads as a flash; on the way back to one you were
 * just looking at it reads as the app reloading, and it undoes the point of
 * animating between them at all.
 *
 * This is deliberately not a request cache. It stores what a component had in
 * state, so a remount can start from the same render it was showing rather than
 * from nothing — including the page number, which a plain request cache would
 * lose. Anything past `STALE_MS` is still handed back; the caller shows it and
 * refetches underneath, so the screen is never empty and never wrong for long.
 *
 * Session-scoped on purpose. A reload should genuinely reload.
 */

const store = new Map<string, { value: unknown; at: number }>();

/** Past this, a snapshot is still worth showing but no longer worth trusting. */
const STALE_MS = 120_000;

export interface Snapshot<T> {
  value: T;
  stale: boolean;
}

export function readSnapshot<T>(key: string): Snapshot<T> | null {
  const entry = store.get(key);
  if (!entry) return null;
  return { value: entry.value as T, stale: performance.now() - entry.at > STALE_MS };
}

export function writeSnapshot<T>(key: string, value: T) {
  store.set(key, { value, at: performance.now() });
}

/** Drops a snapshot so the next mount loads from scratch — after a post, a
 *  deletion, anything that makes what we kept a lie. */
export function dropSnapshot(key: string) {
  store.delete(key);
}

/**
 * Empties the store.
 *
 * Signing out is the case this exists for. It does not reload the document, so
 * without this the previous account's private messages and contacts would sit
 * in memory and be handed straight back to whoever signs in next.
 */
export function clearSnapshots() {
  store.clear();
}
