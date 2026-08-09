'use client';

import { getDerpiTagCounts, TAG_COUNT_BATCH } from '@/lib/api/derpi';

/**
 * Image counts for the detail page's tag list, batched and cached.
 *
 * The counts used to be fetched one tag at a time — `get_dictionary` with
 * `keyword: <tag>, limit: 1`, once per tag, fired as one big `Promise.allSettled`.
 * Eighty visible tags meant eighty requests to our own PHP backend every time an
 * image was opened, for a 12px grey number beside each chip; the browser's
 * six-per-host cap turned that into thirteen sequential rounds, and nothing was
 * remembered, so closing the image and opening it again paid the whole cost over.
 *
 * This is the old front-end's `TagManager` approach instead, which is built out
 * of three things:
 *
 *   - **One request per fifty tags.** `name:a OR name:b OR …` against
 *     Derpibooru's tag search — the same idiom `searchImagesByIds` already uses
 *     for images. Eighty tags become two requests. The response is fatter per
 *     tag (Philomena has no field selection, so every description and implied-by
 *     list comes along: measured at ~59 KB gzipped for a full batch of 50), but
 *     two round trips beat eighty by far more than the bytes cost.
 *   - **A persistent cache.** Tag counts barely move, and tags repeat heavily
 *     across images — `safe`, `pony`, `solo`, `female` are on a large fraction of
 *     the site. After the first few images most of a tag list is already known
 *     and costs nothing.
 *   - **In-flight coalescing.** The overlay and the page under it can both be
 *     mounted, and "show more tags" re-asks for everything already on screen. A
 *     tag that is mid-request joins that request rather than starting another.
 *
 * The count comes from Derpibooru rather than our dictionary because that is
 * where the number is authoritative, and it is what the old front-end read
 * (`exactTag.images`). It also means counts no longer require a login token —
 * the old code returned nothing at all to a signed-out reader who had the
 * setting on.
 */

/** Bumped if the stored shape ever changes; an old key is simply ignored. */
const CACHE_KEY = 'picpony_tag_counts_v1';

/** Same ceiling the old front-end used, and the same crude FIFO eviction. */
const CACHE_LIMIT = 2000;
const CACHE_EVICT = 500;

/**
 * Counts drift slowly — a tag gains a few images a week against a base in the
 * hundreds of thousands — but "slowly" is not "never", and the old cache had no
 * expiry at all, so a number could be years stale. A week is short enough that
 * nobody sees a wrong figure for long and long enough that the cache still does
 * its job across a session's worth of browsing.
 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Minimum spacing between two count requests, as in the old front-end.
 *
 * Not decoration: firing the batches back to back earns a Cloudflare `error
 * code: 1015` from Derpibooru within a handful of requests, and the penalty
 * outlasts the page view — measured while testing this, two unpaced 80-tag runs
 * were enough, and a paced run a minute later still hit it. These are background
 * requests for a grey number; a burst of them is the fastest way to spend a rate
 * limit that the images themselves need.
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
  /* Insertion order is oldest-first, so dropping from the front is the same
     FIFO the old front-end used. Deleting during iteration is well-defined for
     a Map. */
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
 * Counts for `tags`, keyed by the exact strings passed in.
 *
 * `onPartial` is called as each group of answers arrives — the cached ones on
 * the next microtask, before any request has gone out, then one call per batch.
 * Waiting for the whole set instead would hold a tag list that is entirely in
 * cache hostage to the request pacing, and would leave the first fifty counts
 * sitting in memory for a second while the second batch is spaced out. It is
 * the same thing the old front-end's `updateDOM`-per-batch did.
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
