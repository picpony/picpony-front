'use client';

/**
 * A snapshot of what a page had already loaded, kept for the length of the session.
 *
 * Superseded — the /messages page's three list reads are its last consumer; do not
 * adopt it for a new screen. This module deliberately conflates "what the server said"
 * (now lib/resource.ts) with "what this screen was showing" (now lib/screenState.ts) —
 * its per-pane loading/error/silent system is why it survives. It is not a request
 * cache: a remount starts from the render it was showing, including the page number a
 * request cache would lose. Past STALE_MS a snapshot is still handed back; the caller
 * shows it and refetches underneath, so the screen is never empty and never wrong for
 * long. Session-scoped on purpose: a reload should genuinely reload.
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

/**
 * Empties the store — the sign-out case. Signing out does not reload the document,
 * so without this the previous account's private messages and contacts would be
 * handed straight back to whoever signs in next.
 */
export function clearSnapshots() {
  store.clear();
}
