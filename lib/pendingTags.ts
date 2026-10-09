'use client';

import { useSyncExternalStore } from 'react';
import { LS_KEYS } from '@/lib/constants';

/**
 * 待定标签库 — tags set aside to put into a group later, the original front end's feature and
 * storage (`localStorage.pending_tags`, a JSON array of names), so a library collected there
 * carries over. Both group editors offer it (`components/groups/PendingTagsPicker.tsx`): pick some,
 * add them to the group in one go, or prune the library.
 *
 * Device-local, like the original: it is a scratch list, not account data.
 */

/** The original's own bound, applied on read so a hand-edited value cannot flood an editor. */
export const MAX_PENDING = 200;

const EMPTY: readonly string[] = Object.freeze([]);
const listeners = new Set<() => void>();
let cache: { raw: string | null; tags: readonly string[] } = { raw: null, tags: EMPTY };

function parse(raw: string | null): readonly string[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      const tag = item.trim().toLowerCase();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
      if (out.length >= MAX_PENDING) break;
    }
    return out;
  } catch {
    return EMPTY;
  }
}

/** The library now. Stable between changes, so it can be a `useSyncExternalStore` snapshot. */
export function readPendingTags(): readonly string[] {
  if (typeof window === 'undefined') return EMPTY;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LS_KEYS.pendingTags);
  } catch {
    raw = null;
  }
  if (raw !== cache.raw) cache = { raw, tags: parse(raw) };
  return cache.tags;
}

function write(tags: readonly string[]): boolean {
  try {
    if (tags.length === 0) localStorage.removeItem(LS_KEYS.pendingTags);
    else localStorage.setItem(LS_KEYS.pendingTags, JSON.stringify(tags));
  } catch {
    return false;
  }
  for (const listener of listeners) listener();
  return true;
}

/**
 * Set a tag aside. `exists` when it already is; `full` when the library holds `MAX_PENDING` tags
 * (review P4-O11 — the oldest used to be dropped without a word while the answer said `added`);
 * `failed` when this browser blocks storage.
 */
export function addPendingTag(tag: string): 'added' | 'exists' | 'full' | 'failed' {
  const name = tag.trim().toLowerCase();
  if (!name) return 'failed';
  const current = readPendingTags();
  if (current.includes(name)) return 'exists';
  if (current.length >= MAX_PENDING) return 'full';
  return write([...current, name]) ? 'added' : 'failed';
}

/**
 * Take tags out of the library. `false` when this browser refused the write — the library is then
 * unchanged, and the caller says so rather than acting as if it had worked (G4-028).
 */
export function removePendingTags(tags: Iterable<string>): boolean {
  const gone = new Set([...tags].map((tag) => tag.trim().toLowerCase()));
  return write(readPendingTags().filter((tag) => !gone.has(tag)));
}

/** Empty the library; `false` when this browser refused the write, as `removePendingTags`. */
export function clearPendingTags(): boolean {
  return write([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  /* Another tab's change arrives as a storage event; this tab's own writes notify directly. */
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LS_KEYS.pendingTags) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** The library, kept current across this tab and others. Empty during SSR and hydration. */
export function usePendingTags(): readonly string[] {
  return useSyncExternalStore(subscribe, readPendingTags, () => EMPTY);
}
