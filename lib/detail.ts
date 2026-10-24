'use client';

import { getImage } from '@/lib/api/derpi';
import type { ImagePreview, PonyImage } from '@/lib/types/image';
import { promoteLaneJob, scheduleLaneJob, unscheduleLaneJob } from '@/lib/resource';
import { imageHeroController } from './hero/controller';
import { completeDetailRow } from './detailRow';

export { completeDetailRow };

/**
 * The opened picture's record: a TTL'd, LRU cache of Derpibooru `images/<id>` reads with a
 * paint-bound, hero-gated publication (an answer landing mid-flight waits for the flight).
 *
 * The *requests* go through the resource layer's Derpibooru lane (`lib/resource.ts`) rather than a
 * queue of their own: a picture opened from the gallery and the gallery's page reads are the same
 * upstream, and two independent 4-slot queues meant up to eight concurrent Derpibooru requests —
 * more 429s — with neither side knowing the other was busy. An opened picture is an immediate job
 * and jumps the gallery's queued work; hover intent is a background job and cannot take the last
 * slot.
 *
 * A failed read is dropped from the cache (so the next request retries) but its error stays
 * readable through `peekImageDetailError` until then: an open overlay subscribed to a record that
 * failed used to see exactly what it saw while loading — `null` — and kept its skeletons forever.
 * The error is an `ApiError` (`lib/api/errors.ts`): `isNotFound` tells a deleted picture from an
 * outage, `isRetryable` whether to offer 重试.
 */

const CACHE_TTL = 2 * 60 * 1000;
/**
 * How long a record past its TTL is still *shown* while it is re-read (stale-while-revalidate).
 * Reopening a picture used to find its record evicted two minutes after it was read and dropped
 * the whole body back to skeletons until a fresh read landed; everything but the counts in a
 * record is effectively immutable, so a stale one is a far better first paint than a skeleton.
 */
const STALE_TTL = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 48;
const LANE = 'derpi' as const;

type DetailResult = { image: PonyImage };
export type DetailRequestPriority = 'background' | 'immediate';

type DetailEntry = {
  createdAt: number;
  promise: Promise<DetailResult>;
  resolve: (result: DetailResult) => void;
  reject: (error: unknown) => void;
  priority: DetailRequestPriority;
  status: 'queued' | 'loading' | 'resolved';
  controller?: AbortController;
  value?: DetailResult;
  publishedValue?: DetailResult;
  /** When a stale-while-watched refresh was last started (review P3-O2), so it runs once a TTL. */
  refreshedAt?: number;
  /** Installed from a list's row (`primeImageDetailFromRow`), not read from `images/<id>` yet. */
  provisional?: boolean;
};

const detailCache = new Map<number, DetailEntry>();
const detailErrors = new Map<number, unknown>();
const detailListeners = new Map<number, Set<() => void>>();
const pendingNotifications = new Set<number>();
let notificationFrame = 0;
let notificationVisibleFrames = 0;
let notificationVisibilityListenerInstalled = false;

const jobKey = (imageId: number) => `image-detail:${imageId}`;

function isExpired(entry: DetailEntry, timestamp = Date.now()) {
  return entry.status === 'resolved' && timestamp - entry.createdAt >= CACHE_TTL;
}

function isTooStale(entry: DetailEntry, timestamp = Date.now()) {
  return entry.status === 'resolved' && timestamp - entry.createdAt >= STALE_TTL;
}

function deleteExpiredEntries(timestamp = Date.now()) {
  detailCache.forEach((entry, imageId) => {
    if (isTooStale(entry, timestamp) && !detailListeners.has(imageId)) {
      detailCache.delete(imageId);
    }
  });
}

function touchEntry(imageId: number, entry: DetailEntry) {
  detailCache.delete(imageId);
  detailCache.set(imageId, entry);
}

function trimDetailCache(preserveId?: number) {
  deleteExpiredEntries();
  if (detailCache.size <= MAX_CACHE_ENTRIES) return;

  for (const [imageId, entry] of detailCache) {
    if (detailCache.size <= MAX_CACHE_ENTRIES) break;
    if (imageId === preserveId || detailListeners.has(imageId) || entry.value === undefined)
      continue;
    detailCache.delete(imageId);
  }
}

function normalizeId(id: number | string) {
  return typeof id === 'number' ? id : Number.parseInt(id, 10);
}

function flushDetailNotifications() {
  notificationFrame = 0;
  if (document.visibilityState !== 'visible') return;
  if (notificationVisibleFrames > 0) {
    notificationVisibleFrames -= 1;
    scheduleDetailNotifications();
    return;
  }
  const imageIds = Array.from(pendingNotifications).filter((imageId) =>
    imageHeroController.isDetailDataPublishable(imageId),
  );
  imageIds.forEach((imageId) => {
    pendingNotifications.delete(imageId);
    const entry = detailCache.get(imageId);
    if (entry?.status === 'resolved' && entry.value) {
      entry.publishedValue = entry.value;
    }
    detailListeners.get(imageId)?.forEach((listener) => listener());
  });
}

function ensureNotificationVisibilityListener() {
  if (notificationVisibilityListenerInstalled || typeof document === 'undefined') return;
  notificationVisibilityListenerInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') notificationVisibleFrames = 2;
    if (pendingNotifications.size > 0) scheduleDetailNotifications();
  });
  // Publication is a controller milestone (isDetailDataPublishable), not a DOM/data-attribute
  // convention: the opening route may get data mid-gesture; unrelated responses wait for their owner.
  imageHeroController.subscribeRuntime(() => {
    if (pendingNotifications.size > 0) scheduleDetailNotifications();
  });
}

function scheduleDetailNotifications() {
  ensureNotificationVisibilityListener();
  if (notificationFrame || typeof window === 'undefined' || pendingNotifications.size === 0) return;
  // One paint-bound dispatch keeps cache updates out of the flight's geometry frame; hidden
  // documents resume on visibilitychange, never a polling timeout that wakes a background tab.
  notificationFrame = window.requestAnimationFrame(flushDetailNotifications);
}

function notifyImageDetail(imageId: number) {
  if (typeof window === 'undefined') {
    detailListeners.get(imageId)?.forEach((listener) => listener());
    return;
  }
  pendingNotifications.add(imageId);
  scheduleDetailNotifications();
}

function createAbortError() {
  return new DOMException('Image detail prefetch was cancelled', 'AbortError');
}

function cancelQueuedEntry(imageId: number, entry: DetailEntry) {
  if (entry.status !== 'queued' || entry.priority !== 'background') return false;
  if (detailCache.get(imageId) !== entry || detailListeners.has(imageId)) return false;
  unscheduleLaneJob(LANE, jobKey(imageId));
  detailCache.delete(imageId);
  entry.reject(createAbortError());
  notifyImageDetail(imageId);
  return true;
}

function cancelLoadingEntry(imageId: number, entry: DetailEntry) {
  if (entry.status !== 'loading' || entry.priority !== 'background') return false;
  if (detailCache.get(imageId) !== entry || detailListeners.has(imageId)) return false;
  detailCache.delete(imageId);
  entry.controller?.abort();
  notifyImageDetail(imageId);
  return true;
}

async function runEntry(imageId: number, entry: DetailEntry) {
  /* Cancelled or replaced while it waited for a slot: nothing to send. */
  if (detailCache.get(imageId) !== entry || entry.status !== 'queued') return;
  const controller = new AbortController();
  entry.status = 'loading';
  entry.controller = controller;
  entry.createdAt = Date.now();
  try {
    const result = await getImage(String(imageId), controller.signal);
    if (detailCache.get(imageId) === entry) {
      entry.value = result;
      entry.status = 'resolved';
      entry.createdAt = Date.now();
      detailErrors.delete(imageId);
      touchEntry(imageId, entry);
      trimDetailCache(imageId);
      notifyImageDetail(imageId);
    }
    entry.resolve(result);
  } catch (error) {
    if (detailCache.get(imageId) === entry) {
      detailCache.delete(imageId);
      /* Kept for subscribers until the next request for this id clears it. A cancellation is
         not a failure anybody should be shown. */
      if (!(error instanceof Error && error.name === 'AbortError')) detailErrors.set(imageId, error);
      notifyImageDetail(imageId);
    }
    entry.reject(error);
  } finally {
    entry.controller = undefined;
  }
}

/**
 * Review P3-O2: the open picture's record went stale and stayed so — an entry somebody is watching
 * is never evicted, and `prefetchImageDetail` handed it back as it was, so votes and faves showed
 * the first read for as long as the picture stayed open. A watched, expired entry now gets one
 * background re-read per TTL **in place**: the record on screen stays until the answer lands, and
 * a failed refresh changes nothing (the user did not ask for it, and the old record is still
 * right about everything but the counts).
 */
function refreshWatchedEntry(
  imageId: number,
  entry: DetailEntry,
  priority: DetailRequestPriority = 'background',
) {
  const now = Date.now();
  if (entry.status !== 'resolved') return;
  if (entry.controller) {
    /* Already re-reading: an open of this picture takes the refresh to the front of the lane. */
    if (priority === 'immediate') promoteLaneJob(LANE, `${jobKey(imageId)}:refresh`);
    return;
  }
  if (entry.refreshedAt !== undefined && now - entry.refreshedAt < CACHE_TTL) return;
  entry.refreshedAt = now;
  const controller = new AbortController();
  entry.controller = controller;
  scheduleLaneJob(LANE, {
    key: `${jobKey(imageId)}:refresh`,
    priority,
    keep: true,
    cancel: () => {
      controller.abort();
      if (entry.controller === controller) entry.controller = undefined;
    },
    run: async () => {
      try {
        if (detailCache.get(imageId) !== entry || controller.signal.aborted) return;
        const result = await getImage(String(imageId), controller.signal);
        if (detailCache.get(imageId) !== entry || controller.signal.aborted) return;
        entry.value = result;
        entry.promise = Promise.resolve(result);
        entry.createdAt = Date.now();
        entry.provisional = false;
        detailErrors.delete(imageId);
        notifyImageDetail(imageId);
      } catch {
        /* Left as it was. */
      } finally {
        if (entry.controller === controller) entry.controller = undefined;
      }
    },
  });
}

function scheduleEntry(imageId: number, entry: DetailEntry) {
  scheduleLaneJob(LANE, {
    key: jobKey(imageId),
    priority: entry.priority,
    run: () => runEntry(imageId, entry),
    /* The lane drops its oldest queued guess once too many pile up. A guess somebody is now
       watching is not a guess any more: it goes back in as a real activation. */
    cancel: () => {
      if (detailCache.get(imageId) !== entry || entry.status !== 'queued') return;
      if (detailListeners.has(imageId)) {
        entry.priority = 'immediate';
        scheduleEntry(imageId, entry);
        return;
      }
      detailCache.delete(imageId);
      entry.reject(createAbortError());
      notifyImageDetail(imageId);
    },
  });
}

export function subscribeImageDetail(id: number | string, listener: () => void) {
  const imageId = normalizeId(id);
  let listeners = detailListeners.get(imageId);
  if (!listeners) {
    listeners = new Set();
    detailListeners.set(imageId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detailListeners.delete(imageId);
  };
}

export function prefetchImageDetail(
  id: number | string,
  { priority = 'immediate' }: { priority?: DetailRequestPriority } = {},
) {
  const imageId = normalizeId(id);
  deleteExpiredEntries();
  const cached = detailCache.get(imageId);
  if (cached) {
    if (
      priority === 'immediate' &&
      cached.status !== 'resolved' &&
      cached.priority === 'background'
    ) {
      cached.priority = 'immediate';
      if (cached.status === 'queued') promoteLaneJob(LANE, jobKey(imageId));
    }
    /* Stale-while-revalidate: an expired (or list-provided) record is handed back as it is and
       re-read in place; the screen never drops to a skeleton for a picture it has seen. */
    if (isExpired(cached) || cached.provisional) refreshWatchedEntry(imageId, cached, priority);
    touchEntry(imageId, cached);
    return cached.promise;
  }

  let resolve!: (result: DetailResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<DetailResult>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  const entry: DetailEntry = {
    createdAt: Date.now(),
    promise,
    resolve,
    reject,
    priority,
    status: 'queued',
  };
  detailCache.set(imageId, entry);
  /* A new attempt supersedes the failure a subscriber may be showing. */
  detailErrors.delete(imageId);
  notifyImageDetail(imageId);
  scheduleEntry(imageId, entry);
  return promise;
}

/**
 * Install a record the server read (`lib/detail.server.ts`, a direct `/pic/:id`) as a resolved
 * entry, so the page's own read finds it and sends nothing, and a step back to the picture later
 * paints from it. Published at once — the component renders the same record from its props on
 * the hydrating pass, so there is nothing to hold back. An entry already present (a read the page
 * started, a record from earlier in the session) is left alone: it is at least as fresh.
 *
 * Browser only, like `resource.seed`: this module is evaluated during SSR too, where the store
 * would be shared across concurrent requests.
 */
export function seedImageDetail(image: PonyImage, fetchedAt: number) {
  if (typeof window === 'undefined') return;
  const imageId = image.id;
  if (detailCache.has(imageId)) return;
  const value: DetailResult = { image };
  const noop = () => {};
  detailCache.set(imageId, {
    /* Never newer than now: an RSC payload can be minutes old, and "just fetched" would pin it. */
    createdAt: Math.min(fetchedAt, Date.now()),
    promise: Promise.resolve(value),
    resolve: noop,
    reject: noop,
    priority: 'immediate',
    status: 'resolved',
    value,
    publishedValue: value,
  });
  detailErrors.delete(imageId);
  trimDetailCache(imageId);
}

/**
 * **The detail paints from the list's row at once.** Opening a picture used to show the header's
 * placeholders, the vote skeleton and the tag skeleton for the whole flight and then some — a
 * round trip to Derpibooru through a relay, 0.4–2s — although the card the user tapped already
 * held every one of those fields. A complete row is installed as a *provisional* record:
 * published immediately, so the Stage, the header, the votes, the tags and the description are
 * all there from the first frame, and re-read in place by the open's own `prefetchImageDetail`
 * (stale-while-revalidate), which only ever corrects the counts. An entry already present is left
 * alone: it came from `images/<id>` and is at least as good.
 */
export function primeImageDetailFromRow(image: ImagePreview | null | undefined) {
  if (typeof window === 'undefined') return false;
  const row = completeDetailRow(image);
  if (!row) return false;
  const imageId = row.id;
  if (detailCache.has(imageId)) return true;
  const value: DetailResult = { image: row };
  const noop = () => {};
  detailCache.set(imageId, {
    /* Already past its TTL (but well inside `STALE_TTL`), so the first request revalidates it. */
    createdAt: Date.now() - CACHE_TTL,
    promise: Promise.resolve(value),
    resolve: noop,
    reject: noop,
    priority: 'immediate',
    status: 'resolved',
    value,
    publishedValue: value,
    provisional: true,
  });
  detailErrors.delete(imageId);
  trimDetailCache(imageId);
  return true;
}

export function cancelImageDetailPrefetch(id: number | string) {
  const imageId = normalizeId(id);
  const entry = detailCache.get(imageId);
  return entry ? cancelQueuedEntry(imageId, entry) || cancelLoadingEntry(imageId, entry) : false;
}

/**
 * Cancel background detail work for every image except `preserveId`.
 * Immediate/activated targets and entries with live UI subscribers are kept.
 * Call when a real open starts so mid-flight network slots stay on the flyer id.
 */
export function cancelOtherBackgroundImageDetailPrefetch(preserveId: number | string) {
  const keepId = normalizeId(preserveId);
  let cancelled = 0;
  const imageIds = Array.from(detailCache.keys());
  for (const imageId of imageIds) {
    if (imageId === keepId) continue;
    const entry = detailCache.get(imageId);
    if (!entry) continue;
    if (cancelQueuedEntry(imageId, entry) || cancelLoadingEntry(imageId, entry)) {
      cancelled += 1;
    } else if (entry.status === 'resolved' && entry.controller && !detailListeners.has(imageId)) {
      /* A hover's background re-read of a record we can already show: the opened picture's
         slot matters more. The record stays; the next request re-reads it. */
      unscheduleLaneJob(LANE, `${jobKey(imageId)}:refresh`);
      entry.controller.abort();
      entry.controller = undefined;
      entry.refreshedAt = undefined;
      cancelled += 1;
    }
  }
  return cancelled;
}

export function peekImageDetail(id: number | string) {
  const imageId = normalizeId(id);
  const cached = detailCache.get(imageId);
  if (!cached) return null;
  // useSyncExternalStore snapshots must be pure; TTL eviction happens on request/trim paths, never in render.
  return cached.publishedValue ?? null;
}

/**
 * The failure of the last read for this picture, if it failed and nothing has retried it yet —
 * an `ApiError` carrying the HTTP status (`isNotFound` for a deleted picture). Pure, like
 * `peekImageDetail`; subscribers are notified when it appears and when a retry clears it.
 */
export function peekImageDetailError(id: number | string): unknown {
  return detailErrors.get(normalizeId(id)) ?? null;
}

/** The picture's own record over the list's row, and a row that is a video over one that is not. */
export function mediaFacts(image: ImagePreview) {
  const reps = image.representations ?? {};
  const preferMedium = (image.size || 0) > 16 * 1024 * 1024 || (image.width || 0) * (image.height || 0) > 40_000_000;
  const imageSrc =
    (preferMedium ? reps.medium : undefined) || reps.large || reps.medium || reps.full || image.view_url || '';
  const format = (image.format || imageSrc.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  const isVideo = format === 'webm' || format === 'mp4';
  const videoSrc = reps.medium || reps.large || reps.full || image.view_url || '';
  const fullSrc = reps.full || image.view_url || '';
  return { reps, imageSrc, format, isVideo, videoSrc, fullSrc };
}

/**
 * The still the detail shows first when no card lent it a bitmap: the record's thumbnail, already
 * on the visitor's image line — never for a video, a GIF or an animated picture, whose thumbnail
 * would restart the motion. One rule for `PicDetail` and for a row that opens the picture, which
 * decodes it ahead of the open so the overlay mounts with it painted (`app/history/page.tsx`).
 */
export function detailStillPreview(image: ImagePreview): string | undefined {
  const facts = mediaFacts(image);
  return !facts.isVideo && facts.format !== 'gif' && !image.animated ? facts.reps.thumb || undefined : undefined;
}
