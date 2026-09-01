'use client';

import { getDerpiTagCounts, TAG_COUNT_BATCH } from '@/lib/api/derpi';

/**
 * Image counts for the detail page's tag list, batched and cached — built out of
 * three things:
 *
 *   - **One request per fifty tags.** `name:a OR name:b OR …` against
 *     Derpibooru's tag search — the same idiom `searchImagesByIds` already uses
 *     for images. The response is fatter per tag (Philomena has no field
 *     selection), but the round trips beat per-tag requests by far more.
 *   - **A persistent cache.** Tag counts barely move, and tags repeat heavily
 *     across images, so after the first few images most of a tag list is already
 *     known and costs nothing.
 *   - **In-flight coalescing.** The overlay and the page under it can both be
 *     mounted, and "show more tags" re-asks for everything already on screen. A
 *     tag that is mid-request joins that request rather than starting another.
 *
 * Counts come from Derpibooru rather than our dictionary because that is where
 * the number is authoritative; it also means counts need no login token.
 */

/** Bumped if the stored shape ever changes; an old key is simply ignored. */
const CACHE_KEY = 'picpony_tag_counts_v1';

/** Same ceiling as the previous front-end, with the same crude FIFO eviction. */
const CACHE_LIMIT = 2000;
const CACHE_EVICT = 500;

/**
 * A week: counts drift slowly but "slowly" is not "never", so a number can be
 * wrong for at most a week while the cache still does its job across a session.
 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum spacing between two count requests. Not decoration: firing the batches
 * back to back earns a Cloudflare `error code: 1015` rate-limit penalty from
 * Derpibooru within a handful of requests, and it outlasts the page view — these
 * are background requests for a grey number, and a burst of them spends a rate
 * limit the images themselves need.
 */
const MIN_REQUEST_GAP_MS = 1000;

interface CacheEntry {
  /** The count. */
  c: number;
  /** When it was fetched, for the TTL above. */
  t: number;
}

let cache: Map<string, CacheEntry> | null = null;

function store(): Map<string, CacheEntry> {
  if (cache) return cache;
  cache = new Map();
  if (typeof window === 'undefined') return cache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const now = Date.now();
      for (const [tag, entry] of Object.entries(JSON.parse(raw) as Record<string, CacheEntry>)) {
        if (entry && typeof entry.c === 'number' && now - entry.t < CACHE_TTL_MS) {
          cache.set(tag, entry);
        }
      }
    }
  } catch {
    /* A corrupt or unreadable cache is just a cold one. */
  }
  return cache;
}

function persist() {
  const entries = store();
  /* Insertion order is oldest-first, so dropping from the front is FIFO.
     Deleting during iteration is well-defined for a Map. */
  if (entries.size > CACHE_LIMIT) {
    let toDrop = entries.size - CACHE_LIMIT + CACHE_EVICT;
    for (const key of entries.keys()) {
      if (toDrop-- <= 0) break;
      entries.delete(key);
    }
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* Out of quota. The cache is an optimisation, not state. */
  }
}

/** Tags whose request is on its way, so a second caller joins it. */
const inFlight = new Map<string, Promise<number | null>>();

let lastRequestAt = 0;
/** Serialises batches so `MIN_REQUEST_GAP_MS` means something. */
let queue: Promise<unknown> = Promise.resolve();

function runBatch(tags: string[]): Promise<Record<string, number>> {
  const request = queue.then(async () => {
    const wait = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return getDerpiTagCounts(tags);
  });
  // Swallowed here only to keep the chain alive; the caller still sees the throw.
  queue = request.catch(() => {});
  return request;
}

/**
 * Counts for `tags`, keyed by the exact strings passed in. `onPartial` is called
 * as each group of answers arrives — the cached ones on the next microtask, before
 * any request has gone out, then one call per batch — so waiting for the whole set
 * never holds an already-cached tag list hostage to the request pacing.
 *
 * A tag resolves to `null` when the lookup failed or the name came back with no
 * match. Neither is cached: a tag that is *on* an image always has a count of at
 * least one, so a miss means the query failed to match it (an alias, an escaping
 * corner) rather than that the answer is zero, and caching it would make a
 * transient failure permanent. The caller stores the `null` in its own state, so
 * it stops asking for this view but retries on the next visit.
 */
export async function loadTagCounts(
  tags: string[],
  onPartial?: (counts: Record<string, number | null>) => void,
): Promise<Record<string, number | null>> {
  const entries = store();
  const cached: Record<string, number | null> = {};
  const joined: { tag: string; count: Promise<number | null> }[] = [];
  const missing: string[] = [];
  const claimed = new Set<string>();

  for (const tag of tags) {
    const key = tag.toLowerCase();
    const hit = entries.get(key);
    if (hit) {
      cached[tag] = hit.c;
      continue;
    }
    const existing = inFlight.get(key);
    if (existing) {
      joined.push({ tag, count: existing });
      continue;
    }
    // A duplicate spelling within one call shares a slot rather than a query term.
    if (claimed.has(key)) continue;
    claimed.add(key);
    missing.push(tag);
  }

  /** Each entry resolves to one group of answers, reported as soon as it lands. */
  const groups: Promise<Record<string, number | null>>[] = [];

  if (Object.keys(cached).length > 0) groups.push(Promise.resolve(cached));

  if (joined.length > 0) {
    groups.push(
      Promise.all(joined.map(({ tag, count }) => count.then((c) => [tag, c] as const))).then(
        (pairs) => Object.fromEntries(pairs),
      ),
    );
  }

  for (let i = 0; i < missing.length; i += TAG_COUNT_BATCH) {
    const batch = missing.slice(i, i + TAG_COUNT_BATCH);
    const request = runBatch(batch);

    void request.then(
      (counts) => {
        const now = Date.now();
        let stored = false;
        for (const tag of batch) {
          const count = counts[tag.toLowerCase()];
          if (typeof count !== 'number') continue;
          entries.set(tag.toLowerCase(), { c: count, t: now });
          stored = true;
        }
        if (stored) persist();
      },
      () => {},
    );

    // Registered per tag so a *concurrent* caller joins this request rather
    // than opening a second one for the same names.
    for (const tag of batch) {
      const key = tag.toLowerCase();
      const settled = request.then(
        (counts) => (typeof counts[key] === 'number' ? counts[key] : null),
        () => null,
      );
      inFlight.set(key, settled);
      void settled.then(() => {
        if (inFlight.get(key) === settled) inFlight.delete(key);
      });
    }

    groups.push(
      request.then(
        (counts) =>
          Object.fromEntries(
            batch.map((tag) => {
              const count = counts[tag.toLowerCase()];
              return [tag, typeof count === 'number' ? count : null];
            }),
          ),
        () => Object.fromEntries(batch.map((tag) => [tag, null])),
      ),
    );
  }

  const result: Record<string, number | null> = {};
  const parts = await Promise.all(
    groups.map((group) =>
      group.then((part) => {
        onPartial?.(part);
        return part;
      }),
    ),
  );
  for (const part of parts) Object.assign(result, part);
  /* Every requested spelling gets an entry, including a duplicate that differed
     only by case and so was skipped above. */
  for (const tag of tags) {
    if (!(tag in result)) result[tag] = entries.get(tag.toLowerCase())?.c ?? null;
  }
  return result;
}
