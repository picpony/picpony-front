'use client';

import { getImage } from '@/lib/api/derpi';
import type { PonyImage } from '@/lib/types/image';
import { imageHeroController } from './hero/controller';

const CACHE_TTL = 2 * 60 * 1000;
const MAX_CACHE_ENTRIES = 48;
const MAX_CONCURRENT_REQUESTS = 4;
const MAX_CONCURRENT_BACKGROUND_REQUESTS = 2;
const MAX_BACKGROUND_QUEUE = 8;

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
const detailListeners = new Map<number, Set<() => void>>();
const immediateQueue: number[] = [];
const backgroundQueue: number[] = [];
let activeRequests = 0;
let activeBackgroundRequests = 0;
const pendingNotifications = new Set<number>();
let notificationFrame = 0;
let notificationVisibleFrames = 0;
let notificationVisibilityListenerInstalled = false;

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
  // Publication is a controller milestone rather than a DOM/data-attribute
  // convention. The active opening route can receive its data while input is
  // still moving; unrelated responses remain queued until their owner is safe.
  imageHeroController.subscribeRuntime(() => {
    if (pendingNotifications.size > 0) scheduleDetailNotifications();
  });
}

function scheduleDetailNotifications() {
  ensureNotificationVisibilityListener();
  if (notificationFrame || typeof window === 'undefined' || pendingNotifications.size === 0) return;
  // A single paint-bound dispatch keeps cache updates out of the flight's
  // geometry frame. Hidden documents are resumed by visibilitychange, not a
  // polling timeout that can wake a background tab.
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

function removeQueuedId(queue: number[], imageId: number) {
  const index = queue.indexOf(imageId);
  if (index !== -1) queue.splice(index, 1);
}

function enqueueImmediate(imageId: number) {
  removeQueuedId(immediateQueue, imageId);
  removeQueuedId(backgroundQueue, imageId);
  // A real activation should own the next available slot, ahead of stale
  // focus or hover intent that may already be queued.
  immediateQueue.unshift(imageId);
}

function cancelQueuedEntry(imageId: number, entry: DetailEntry) {
  if (entry.status !== 'queued' || entry.priority !== 'background') return false;
  if (detailCache.get(imageId) !== entry || detailListeners.has(imageId)) return false;
  removeQueuedId(backgroundQueue, imageId);
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

function dequeue(queue: number[], priority: DetailRequestPriority) {
  while (queue.length > 0) {
    const imageId = queue.shift()!;
    const entry = detailCache.get(imageId);
    if (entry?.status === 'queued' && entry.priority === priority) {
      return { imageId, entry };
    }
  }
  return null;
}

function runDetailQueue() {
  while (activeRequests < MAX_CONCURRENT_REQUESTS) {
    const immediate = dequeue(immediateQueue, 'immediate');
    const queued =
      immediate ??
      (activeBackgroundRequests < MAX_CONCURRENT_BACKGROUND_REQUESTS
        ? dequeue(backgroundQueue, 'background')
        : null);
    if (!queued) return;

    const { imageId, entry } = queued;
    const startedAsBackground = entry.priority === 'background';
    const controller = new AbortController();
    entry.status = 'loading';
    entry.controller = controller;
    entry.createdAt = Date.now();
    activeRequests += 1;
    if (startedAsBackground) activeBackgroundRequests += 1;

    void getImage(String(imageId), controller.signal)
      .then((result) => {
        if (detailCache.get(imageId) === entry) {
          entry.value = result;
          entry.status = 'resolved';
          entry.createdAt = Date.now();
          touchEntry(imageId, entry);
          trimDetailCache(imageId);
          notifyImageDetail(imageId);
        }
        entry.resolve(result);
      })
      .catch((error) => {
        if (detailCache.get(imageId) === entry) {
          detailCache.delete(imageId);
          notifyImageDetail(imageId);
        }
        entry.reject(error);
      })
      .finally(() => {
        entry.controller = undefined;
        activeRequests -= 1;
        if (startedAsBackground) activeBackgroundRequests -= 1;
        runDetailQueue();
      });
  }
}

function dropOldestBackgroundRequest() {
  for (let index = 0; index < backgroundQueue.length;) {
    const imageId = backgroundQueue[index];
    const entry = detailCache.get(imageId);
    if (!entry || entry.status !== 'queued' || entry.priority !== 'background') {
      backgroundQueue.splice(index, 1);
      continue;
    }
    if (detailListeners.has(imageId)) {
      index += 1;
      continue;
    }
    backgroundQueue.splice(index, 1);
    return cancelQueuedEntry(imageId, entry);
  }
  return false;
}

function enqueueDetail(imageId: number, entry: DetailEntry) {
  if (entry.priority === 'immediate') {
    enqueueImmediate(imageId);
  } else {
    let queuedBackgroundCount = 0;
    for (const candidate of detailCache.values()) {
      if (candidate.status === 'queued' && candidate.priority === 'background') {
        queuedBackgroundCount += 1;
      }
    }
    if (queuedBackgroundCount >= MAX_BACKGROUND_QUEUE) dropOldestBackgroundRequest();
    backgroundQueue.push(imageId);
  }
  runDetailQueue();
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
      if (cached.status === 'queued') {
        enqueueImmediate(imageId);
        runDetailQueue();
      }
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
  notifyImageDetail(imageId);
  enqueueDetail(imageId, entry);
  return promise;
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
  if (cancelled > 0) runDetailQueue();
  return cancelled;
}

export function peekImageDetail(id: number | string) {
  const imageId = normalizeId(id);
  const cached = detailCache.get(imageId);
  if (!cached) return null;
  // useSyncExternalStore snapshots must be pure. TTL eviction happens on
  // request/trim paths, never during render.
  return cached.publishedValue ?? null;
}
