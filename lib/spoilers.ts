'use client';

/**
 * The device's spoiler tags, as one value every covered picture reads — gallery cards and the
 * 近日推荐 banner alike (C2: one cover, one rule).
 *
 * **Two sources, one answer per render.** The list lives in `localStorage`, which the server
 * cannot read, so it is mirrored into a cookie (`COOKIE_KEYS.spoilerTags`) and `app/layout.tsx`
 * hands the cookie's list down through `SpoilerTagsProvider`. The hydrating render uses that
 * list, so the server's cover and the client's agree; after hydration the live list wins.
 *
 * The store's value is a **canonical string** (sorted, de-duplicated, comma-joined), not a Set:
 * `useSyncExternalStore` compares snapshots by identity, and after hydration it compares the
 * client snapshot with the server's — two equal lists as two objects re-rendered every card on
 * the page for nothing.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { COOKIE_KEYS, LS_KEYS } from '@/lib/constants';
import { useSsrSpoilerTags } from '@/components/ImageLineProvider';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function canonical(values: readonly unknown[]): string {
  const tags = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const tag = value.trim().toLowerCase();
    /* A comma is the separator of the canonical form and of the cookie, and no Derpibooru tag
       contains one. */
    if (tag && !tag.includes(',')) tags.add(tag);
  }
  return [...tags].sort().join(',');
}

let rawSeen: string | null | undefined;
let current = '';
let mirrored: string | null = null;

function readLocal(): string {
  if (typeof window === 'undefined') return '';
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LS_KEYS.activeSpoileredTags);
  } catch {
    raw = null;
  }
  if (raw === rawSeen) return current;
  rawSeen = raw;
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    current = Array.isArray(parsed) ? canonical(parsed) : '';
  } catch {
    current = '';
  }
  mirror(current);
  return current;
}

/**
 * Mirrored for the *next* document, so the server can draw the cover before hydration. Written
 * only when the list differs from what was last written: `document.cookie` is a parse and a
 * serialise per assignment.
 */
function mirror(value: string) {
  if (mirrored === value) return;
  mirrored = value;
  try {
    document.cookie = `${COOKIE_KEYS.spoilerTags}=${encodeURIComponent(value)};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
  } catch {
    /* Cookies blocked: the live list still covers every card; only a cold load's first frame
       goes uncovered. */
  }
}

/* One pair of window listeners for every subscriber: each gallery card reads this store, and a
   page turn used to add and remove two listeners per card. */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key === null || event.key === LS_KEYS.activeSpoileredTags) notify();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener('settings_updated', notify);
    window.addEventListener('storage', onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('settings_updated', notify);
      window.removeEventListener('storage', onStorage);
    }
  };
}

/**
 * The spoiler tags among `tags`, in the picture's own spelling and order — what a cover names.
 * Empty when nothing on the picture is spoilered.
 */
export function useSpoilerMatch(tags: readonly string[] | undefined): string[] {
  const ssrTags = useSsrSpoilerTags();
  const serverValue = useMemo(() => canonical(ssrTags), [ssrTags]);
  const value = useSyncExternalStore(subscribe, readLocal, () => serverValue);
  return useMemo(() => {
    if (!value || !tags?.length) return [];
    const active = new Set(value.split(','));
    return tags.filter((tag) => typeof tag === 'string' && active.has(tag.trim().toLowerCase()));
  }, [value, tags]);
}
