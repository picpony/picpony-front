import { cache } from 'react';
import { cacheSeconds, createServerMemo } from '@/lib/serverMemo';
import {
  parseBlockFilters,
  readWholeBlacklist,
  DEFAULT_BLOCK_FILTERS,
  PUBLIC_BLACKLIST_PAGE_LIMIT,
  type BlockFilters,
  type PublicBlacklist,
} from '@/lib/blockFilters';
import { upstreamOrigin } from '@/lib/upstream.server';

const REVALIDATE_SECONDS = 30 * 60;
/**
 * The public blacklist's lifetime. Shorter than the filter definitions': pulling a picture from
 * the site is an administrator reacting to something, and an accepted edit expires both caches
 * at once anyway (the `/api/v1` route handler), so this only bounds edits made elsewhere.
 */
const BLACKLIST_REVALIDATE_SECONDS = 5 * 60;
const UPSTREAM = upstreamOrigin();
export const BLOCK_FILTERS_CACHE_TAG = 'picpony-block-filters';
export const PUBLIC_BLACKLIST_CACHE_TAG = 'picpony-public-blacklist';
let generation = 0;
let blacklistGeneration = 0;

/** Public definitions shared by the layout policy and home feed. In-flight coalescing is
 * essential: the layout and page render concurrently, and both need the same rule version. */
const read = createServerMemo({
  ttlMs: REVALIDATE_SECONDS * 1000,
  keyOf: () => 'public-filters',
  load: async (): Promise<BlockFilters | null> => {
    try {
      const response = await fetch(`${UPSTREAM}/api/v1/filters/block-tags`, {
        signal: AbortSignal.timeout(1500),
        next: { revalidate: cacheSeconds(REVALIDATE_SECONDS), tags: [BLOCK_FILTERS_CACHE_TAG] },
      });
      if (!response.ok) return null;
      return parseBlockFilters(await response.json());
    } catch {
      return null;
    }
  },
});

async function readBlockFiltersFresh(): Promise<BlockFilters> {
  const started = generation;
  const result = await read();
  /* A read begun before a successful edit cannot seed the old rules after the edit. The retry
     calls this function, never the cached export: a cached call from inside its own pending
     promise would await itself. */
  return started === generation ? result ?? DEFAULT_BLOCK_FILTERS : readBlockFiltersFresh();
}

/**
 * **Once per request**, however many server components ask and whenever they ask. The memo's
 * in-flight coalescing only joins reads that overlap, and the layout's policy read and the home
 * page's feed read no longer do — the page streams behind its own Suspense fallback, after the
 * layout's read has settled — so on a cold memo (or the audit's zero TTL) one document read the
 * definitions twice. `cache` is scoped to the render, so it cannot carry anything between
 * visitors; the memo still does that.
 */
export const readBlockFilters = cache(readBlockFiltersFresh);

export function clearBlockFiltersMemo(): void {
  generation += 1;
  read.clear();
}

/**
 * The site's public image blacklist (`GET /api/v1/image-blocklist`, every page), read like the
 * filter definitions: anonymous, shared by every visitor, inlined into the document so the first
 * client key matches the server's seed. A failed read is an empty list — the feed must still
 * render — and is not retained (`createServerMemo` never keeps `null`).
 */
const readBlacklist = createServerMemo({
  ttlMs: BLACKLIST_REVALIDATE_SECONDS * 1000,
  keyOf: () => 'public-blacklist',
  load: async (): Promise<number[] | null> => {
    try {
      const signal = AbortSignal.timeout(1500);
      return await readWholeBlacklist(async (page) => {
        const response = await fetch(`${UPSTREAM}/api/v1/image-blocklist?page=${page}&limit=${PUBLIC_BLACKLIST_PAGE_LIMIT}`, {
          signal,
          next: { revalidate: cacheSeconds(BLACKLIST_REVALIDATE_SECONDS), tags: [PUBLIC_BLACKLIST_CACHE_TAG] },
        });
        return response.ok ? response.json() : null;
      });
    } catch {
      return null;
    }
  },
});

async function readPublicBlacklistFresh(): Promise<PublicBlacklist> {
  const started = blacklistGeneration;
  const result = await readBlacklist();
  return started === blacklistGeneration ? result ?? [] : readPublicBlacklistFresh();
}

/** Once per request, for the same reason as `readBlockFilters`. */
export const readPublicBlacklist = cache(readPublicBlacklistFresh);

export function clearPublicBlacklistMemo(): void {
  blacklistGeneration += 1;
  readBlacklist.clear();
}
