'use client';

import type { PonyImage } from '@/lib/types/image';
import { readToken } from '@/lib/hooks';

/**
 * 以图搜图 result sets for this session, by the key their URL carries (`?image=`).
 *
 * The pictures came from an upload, so a URL cannot carry them — but an image search is a new
 * search and deserves its own history entry: Back from the results returns to the search before
 * it, and a picture opened from them comes back to them. Module scope, like `lib/screenState.ts`:
 * a reload genuinely forgets (the screen then says the results have expired), and nothing here is
 * worth persisting.
 */

export interface ImageSearchResult {
  /** Every result, in the service's order; the screen filters them by the current settings. */
  images: PonyImage[];
  /** How many the service found in all, before the content settings. */
  found: number;
  /** The picture that was searched with, as a data URL, for the results header. */
  preview: string | null;
}

/** A handful: each holds a preview picture, and Back rarely walks further than that. */
const MAX_ENTRIES = 6;

/** Each set remembers the session it was made in (review P4-O9): signing out or switching
 *  accounts leaves another person's search behind, so it reads as expired. */
const store = new Map<string, { result: ImageSearchResult; token: string | null }>();

function newKey(): string {
  let key = '';
  do {
    key = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  } while (store.has(key));
  return key;
}

export function saveImageSearch(result: ImageSearchResult): string {
  const key = newKey();
  store.set(key, { result, token: readToken() });
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
  return key;
}

export function readImageSearch(key: string | null): ImageSearchResult | undefined {
  const entry = key ? store.get(key) : undefined;
  if (!entry) return undefined;
  if (entry.token !== readToken()) {
    store.delete(key as string);
    return undefined;
  }
  return entry.result;
}
