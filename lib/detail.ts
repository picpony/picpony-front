'use client';

import { getImage } from '@/lib/api/derpi';
import type { PonyImage } from '@/lib/types/image';
import { promoteLaneJob, scheduleLaneJob, unscheduleLaneJob } from '@/lib/resource';
import { imageHeroController } from './hero/controller';

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

function deleteExpiredEntries(timestamp = Date.now()) {
  detailCache.forEach((entry, imageId) => {
    if (isExpired(entry, timestamp) && !detailListeners.has(imageId)) {
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
