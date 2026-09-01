'use client';

/**
 * One keyed, deduplicated, revalidating read — for every screen in the app.
 *
 * Shared answer to "have we already asked for this": per-field fetch state duplicated across the
 * screens caused double requests on cold load, re-reads on remount, and serial reads that could
 * have been parallel.
 *
 * `lib/detail.ts` had the machinery for exactly one resource — TTL, LRU, priority queue,
 * concurrency cap, cancellation, paint-bound publication — and this is that machinery with the
 * endpoint made a parameter.
 *
 * What it deliberately is not:
 * - **Not a router cache.** It holds what the server said, keyed by the read's arguments; what a
 *   screen is *showing* (page, tab) belongs to `useScreenState` in `lib/screenState.ts`.
 * - **Not persistent.** A reload genuinely reloads. The long-TTL localStorage caches
 *   (`lib/tagCounts.ts`, `lib/tagTranslations.ts`) solve a different problem.
 * - **Not a mutation library.** Writes still go through `lib/api/*`; `write()` only corrects the
 *   cached answer in place.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export type Priority = 'immediate' | 'background';

/**
 * How much of the network the app may occupy, and how much of that a *guess* may occupy.
 *
 * The background cap is what makes prefetching safe: a background read can never take the last
 * slot, so speculation can never delay a request a user is actually waiting for.
 */
const MAX_CONCURRENT = 4;
const MAX_CONCURRENT_BACKGROUND = 2;
/** Past this, queued guesses are dropped oldest-first rather than allowed to accumulate. */
const MAX_BACKGROUND_QUEUE = 8;

type Job = {
  run: () => Promise<void>;
  priority: Priority;
  key: string;
  cancel: () => void;
};

const immediateQueue: Job[] = [];
const backgroundQueue: Job[] = [];
let active = 0;
let activeBackground = 0;

function pump() {
  while (active < MAX_CONCURRENT) {
    const job =
      immediateQueue.shift() ??
      (activeBackground < MAX_CONCURRENT_BACKGROUND ? backgroundQueue.shift() : undefined);
    if (!job) return;
    const background = job.priority === 'background';
    active += 1;
    if (background) activeBackground += 1;
    void job.run().finally(() => {
      active -= 1;
      if (background) activeBackground -= 1;
      pump();
    });
  }
}

function enqueue(job: Job) {
  if (job.priority === 'immediate') {
    /* A real activation owns the next slot, ahead of waiting intent — and jumps other immediate
       work too: the most recent activation is the one the user is looking at. */
    immediateQueue.unshift(job);
  } else {
    if (backgroundQueue.length >= MAX_BACKGROUND_QUEUE) backgroundQueue.shift()?.cancel();
    backgroundQueue.push(job);
  }
  pump();
}

/**
 * Whether the device is willing to pay for a guess.
 *
 * The concurrency cap protects *latency*; this protects **bytes** — on a metered or slow
 * connection, a speculative fetch is a real charge. `saveData` and the two slowest effective
 * types switch speculation off entirely; only `prefetch` is gated, reads a screen asked for are
 * untouched.
 *
 * Read per call, not cached: `effectiveType` changes as the connection does. Chromium-only API —
 * `undefined` (no information) is treated as willing, the default every other browser has.
 */
function speculationAllowed(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== 'slow-2g' && connection.effectiveType !== '2g';
}

function dropQueued(key: string) {
  for (const queue of [immediateQueue, backgroundQueue]) {
    const index = queue.findIndex((job) => job.key === key);
    if (index !== -1) {
      const [job] = queue.splice(index, 1);
      job.cancel();
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

/**
 * Responses reach React on a paint boundary, and a resource may hold its answer back until its
 * owner says it is safe.
 *
 * A `setState` landing in the frame the hero flight reads geometry in is visible jank, so
 * publication is rAF-bound; a background tab is held off two frames after becoming visible —
 * the first frames after a resume are the busiest. Prefetching makes responses arrive at moments
 * nobody chose, so every screen gets this property.
 */
const pendingPublish = new Set<() => void>();
let publishFrame = 0;
let resumeFramesLeft = 0;
let visibilityBound = false;

function bindVisibility() {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') resumeFramesLeft = 2;
    if (pendingPublish.size > 0) schedulePublish();
  });
}

function flushPublish() {
  publishFrame = 0;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  if (resumeFramesLeft > 0) {
    resumeFramesLeft -= 1;
    schedulePublish();
    return;
  }
  for (const publish of Array.from(pendingPublish)) publish();
  /* Anything a gate held back is still in the set, so keep a frame booked for it — otherwise a
     gated commit waits for some unrelated publish to schedule the next flush, which on a screen
     with one resource is never. */
  if (pendingPublish.size > 0) schedulePublish();
}

function schedulePublish() {
  bindVisibility();
  if (publishFrame || typeof window === 'undefined' || pendingPublish.size === 0) return;
  publishFrame = window.requestAnimationFrame(flushPublish);
}

/** Lets an owner wake publication when its own gate opens. Used by the hero controller. */
const gateListeners = new Set<() => void>();
export function notifyResourceGates() {
  if (pendingPublish.size > 0) schedulePublish();
  for (const listener of gateListeners) listener();
}

// ---------------------------------------------------------------------------
// One entry
// ---------------------------------------------------------------------------

/**
 * What a component sees.
 *
 * One frozen object, rebuilt only when something actually changed: `useSyncExternalStore`
 * compares snapshots by identity — a fresh object per read is an infinite render loop.
 *
 * `data` and `isLoading` are independent on purpose: a stale value being refreshed underneath has
 * *both*, and the screen must show the data, not a skeleton. Only `data === undefined &&
 * isLoading` is a screen with nothing to draw — the placeholder branches on `data === undefined`.
 */
export interface ResourceSnapshot<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  /** Served, but past its TTL — the caller shows it while it is refreshed underneath. */
  isStale: boolean;
}

const EMPTY: ResourceSnapshot<never> = Object.freeze({
  data: undefined,
  error: undefined,
  isLoading: false,
  isStale: false,
});

type Entry<T> = {
  key: string;
  /**
   * The arguments this entry was read with, kept so a refresh can start *itself*.
   *
   * `expire()` must kick the revalidation, not only mark stale: nothing re-renders when a value
   * goes stale (the read effect is keyed on resource and key, neither changes), so a tab left open
   * for an hour would be marked stale and fetch nothing without these.
   */
  args?: unknown;
  status: 'queued' | 'loading' | 'resolved' | 'error';
  /**
   * A slot holding listeners for a key nothing has read yet — not a request.
   *
   * `useSyncExternalStore` subscribes *before* the effect that reads, so this is created a tick
   * before the real entry. `read` must not mistake it for a queued request: it would return the
   * placeholder's already-resolved, value-less promise and every screen would go silent.
   */
  placeholder?: boolean;
  /** The latest answer, which may not yet have been published. */
  value?: T;
  error?: unknown;
  fetchedAt: number;
  priority: Priority;
  promise: Promise<T>;
  settle: { resolve: (value: T) => void; reject: (error: unknown) => void };
  controller?: AbortController;
  /** What `peek` returns. Only ever written inside a publish flush. */
  snapshot: ResourceSnapshot<T>;
  /** The commit already queued for this entry, so repeat publishes collapse into one. */
  pendingCommit?: () => void;
  listeners: Set<() => void>;
};

export interface ResourceOptions<Args, T> {
  /** Namespaces the cache and names the resource in a ledger. */
  name: string;
  /** Everything the answer depends on, as a string. Same key means same answer. */
  key: (args: Args) => string;
  fetch: (args: Args, signal: AbortSignal) => Promise<T>;
  /** After this a cached value is still served but refreshed underneath. Default 60s. */
  ttl?: number;
  /** LRU cap. Default 32 — a paged list of 50 held at 32 keys is more history than anyone scrolls. */
  maxEntries?: number;
  /**
   * Return false to hold a landed answer back from React.
   *
   * The image detail's gate is why this exists: an answer arriving mid-flight must wait for the
   * flight, or the `setState` lands in the frame the geometry is being read in.
   */
  publishGate?: (key: string) => boolean;
}

export interface Resource<Args, T> {
  readonly name: string;
  keyOf: (args: Args) => string;
  /** Send it if we do not have it, share the promise if it is already going. */
  read: (args: Args, options?: { priority?: Priority; force?: boolean }) => Promise<T>;
  /** Start it and do not wait. Errors are swallowed — a guess that fails is not an event. */
  prefetch: (args: Args, options?: { priority?: Priority }) => void;
  /** Pure and synchronous, for `useSyncExternalStore`. Never mutates the store. */
  peek: (args: Args) => ResourceSnapshot<T>;
  subscribe: (args: Args, listener: () => void) => () => void;
  /**
   * `useResource` uses these rather than the `args` forms: `useSyncExternalStore` calls
   * `getSnapshot`/`subscribe` *during render*, and a hook needing the caller's `args` object
   * there would have to stash it in a ref and write it during render — which `react-hooks/refs`
   * rejects. A key is a string computed during render, so there is nothing to stash.
   */
  peekKey: (key: string) => ResourceSnapshot<T>;
  subscribeKey: (key: string, listener: () => void) => () => void;
  /** Drop one entry, or every entry of this resource. The next read is a real request. */
  invalidate: (args?: Args) => void;
  /** Mark stale without dropping, so the value is still shown while it is re-read. */
  expire: (args?: Args) => void;
  /** Correct the answer in place — an optimistic write, or a response to a mutation. */
  write: (args: Args, update: T | ((previous: T | undefined) => T)) => void;
  /**
   * Install a server-rendered answer as if it had been fetched at `fetchedAt` — the SSR seam.
   *
   * A Server Component hands the first page to the client island as a prop; seeding it before the
   * first `read` means the effect finds a fresh entry and sends nothing.
   *
   * **Not `write`.** `write`'s cold-key branch runs `create` → `enqueue` → `pump` → `job.run()`
   * synchronously — firing the very request the seed exists to prevent — and the `dropQueued`
   * after it may cancel an entry, leaving `write` to populate an entry no longer in the store
   * (`peekKey` then returns EMPTY for that key forever).
   *
   * **Browser only.** This is a `'use client'` module still evaluated in Node during SSR, where
   * the module-scope `store` is shared across concurrent requests: seeding server-side would leak
   * one visitor's data into another's render. Call sites must guard on `typeof window`.
   */
  seed: (args: Args, value: T, fetchedAt: number) => void;
  /** Abort a *background* read for these args. An immediate one is somebody's screen. */
  cancelBackground: (args: Args) => boolean;
}

const registry = new Set<{ clear: () => void; expireAll: () => void }>();

/**
 * Forget everything — signing out is the case this exists for.
 *
 * The store is a module-level `Map` and signing out does not reload the document; without this,
 * the previous account's data sits in memory and is handed to whoever signs in next.
 */
export function clearAllResources() {
  for (const entry of registry) entry.clear();
}

/**
 * Mark everything stale without dropping it.
 *
 * What a tab regaining focus wants: every mounted screen re-reads underneath what it is showing
 * and nothing shows a loading state. Dropping instead would empty every screen in one frame.
 */
export function expireAllResources() {
  for (const entry of registry) entry.expireAll();
}

export function defineResource<Args, T>(options: ResourceOptions<Args, T>): Resource<Args, T> {
  const { name, key: keyOf, fetch: fetcher, ttl = 60_000, maxEntries = 32, publishGate } = options;
  const store = new Map<string, Entry<T>>();

  const isStale = (entry: Entry<T>) =>
    entry.status === 'resolved' && Date.now() - entry.fetchedAt >= ttl;

  function buildSnapshot(entry: Entry<T>): ResourceSnapshot<T> {
    return Object.freeze({
      data: entry.value,
      error: entry.status === 'error' ? entry.error : undefined,
      isLoading: entry.status === 'queued' || entry.status === 'loading',
      isStale: isStale(entry),
    });
  }

  /**
   * Queue the entry's next snapshot for the coming paint, subject to the gate.
   *
   * One queued commit per entry, not one per call: the closure rebuilds the snapshot from the
   * entry when it runs, so a second publish in the same frame has nothing to add. Without the
   * guard, an entry resolved and written to in one tick notified its listeners twice.
   */
  function publish(entry: Entry<T>) {
    if (entry.pendingCommit) {
      schedulePublish();
      return;
    }
    const commit = () => {
      /* A gated commit stays queued rather than dropped — the flush re-schedules while anything
         is still waiting, and `notifyResourceGates` wakes it when a gate opens. */
      if (publishGate && !publishGate(entry.key)) return;
      pendingPublish.delete(commit);
      entry.pendingCommit = undefined;
      /* Rebuilt here rather than at the call site: a paint-bound publish changes `isLoading` and
         `data` together, in one render, at a moment nothing else owns. */
      entry.snapshot = buildSnapshot(entry);
      for (const listener of entry.listeners) listener();
    };
    entry.pendingCommit = commit;
    pendingPublish.add(commit);
    schedulePublish();
  }

  function touch(key: string, entry: Entry<T>) {
    store.delete(key);
    store.set(key, entry);
  }

  function trim(preserve?: string) {
    if (store.size <= maxEntries) return;
    for (const [key, entry] of store) {
      if (store.size <= maxEntries) break;
      /* Never evict a key a mounted component is reading, nor an entry with no answer yet —
         dropping an in-flight one would restart it on the next render. */
      if (key === preserve || entry.listeners.size > 0 || entry.value === undefined) continue;
      entry.controller?.abort();
      store.delete(key);
    }
  }

  function create(key: string, args: Args, priority: Priority): Entry<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    /* The rejection is always consumed: a caller (a prefetch) may ignore the promise, and an
       unhandled rejection would reach the console as an app error. */
    promise.catch(() => {});

    const entry: Entry<T> = {
      key,
      args,
      status: 'queued',
      fetchedAt: 0,
      priority,
      promise,
      settle: { resolve, reject },
      snapshot: Object.freeze({ data: undefined, error: undefined, isLoading: true, isStale: false }),
      listeners: new Set(),
    };
    store.set(key, entry);

    const controller = new AbortController();
    entry.controller = controller;

    enqueue({
      key: `${name}:${key}`,
      priority,
      cancel: () => {
        if (store.get(key) !== entry) return;
        store.delete(key);
        entry.status = 'error';
        entry.error = new DOMException(`${name} read was cancelled`, 'AbortError');
        entry.settle.reject(entry.error);
        publish(entry);
      },
      run: async () => {
        if (store.get(key) !== entry) return;
        entry.status = 'loading';
        try {
          const value = await fetcher(args, controller.signal);
          if (store.get(key) === entry) {
            entry.value = value;
            entry.error = undefined;
            entry.status = 'resolved';
            entry.fetchedAt = Date.now();
            touch(key, entry);
            trim(key);
            publish(entry);
          }
          entry.settle.resolve(value);
        } catch (error) {
          if (store.get(key) === entry) {
            entry.status = 'error';
            entry.error = error;
            /* The last good value is kept: a failed refresh of something already on screen must
               not empty the screen — the caller decides how to show the error. */
            publish(entry);
          }
          entry.settle.reject(error);
        } finally {
          entry.controller = undefined;
        }
      },
    });

    return entry;
  }

  function read(args: Args, { priority = 'immediate', force = false }: { priority?: Priority; force?: boolean } = {}) {
    const key = keyOf(args);
    const stored = store.get(key);
    /* A placeholder is not an answer and not a request — see `Entry.placeholder`. It is replaced
       below, its listeners carried over, exactly as a `force` would. */
    const existing = stored && !stored.placeholder ? stored : undefined;

    if (existing && !force) {
      /* A guess that turns into a real activation is promoted, not re-sent: if queued it moves to
         the front, if already in flight there is nothing to do but wait. */
      if (priority === 'immediate' && existing.priority === 'background' && existing.status === 'queued') {
        existing.priority = 'immediate';
        if (dropQueued(`${name}:${key}`)) {
          store.delete(key);
          const promoted = create(key, args, 'immediate');
          promoted.listeners = existing.listeners;
          existing.promise.catch(() => {});
          return promoted.promise;
        }
      }
      touch(key, existing);
      if (existing.status === 'resolved' && isStale(existing)) {
        /* Stale-while-revalidate: the current value stays on screen and stays returned; the
           refresh runs underneath with no loading state — this layer's point over a plain cache. */
        void revalidate(args, key, existing);
      }
      if (existing.status !== 'error') return existing.promise;
      /* A previous failure is not a cached answer. Retry, keeping any value it had. */
      const previous = existing.value;
      store.delete(key);
      const retried = create(key, args, priority);
      retried.value = previous;
      retried.listeners = existing.listeners;
      return retried.promise;
    }

    if (stored) {
      stored.controller?.abort();
      dropQueued(`${name}:${key}`);
      store.delete(key);
    }
    const entry = create(key, args, priority);
    /* Carried over from whatever was there, placeholder or not. Losing them is how a component
       that already subscribed never hears that its own request landed. */
    if (stored) entry.listeners = stored.listeners;
    return entry.promise;
  }

  /** A refresh that never shows a loading state and never replaces a good value with an error. */
  function revalidate(args: Args, key: string, stale: Entry<T>) {
    if (stale.status !== 'resolved') return;
    /* Marked resolved-but-refreshing by moving `fetchedAt` forward, so a second render in the
       same second does not start a second refresh. */
    stale.fetchedAt = Date.now();
    const controller = new AbortController();
    enqueue({
      key: `${name}:${key}:revalidate`,
      priority: 'background',
      cancel: () => controller.abort(),
      run: async () => {
        try {
          const value = await fetcher(args, controller.signal);
          const current = store.get(key);
          if (current !== stale) return;
          current.value = value;
          current.error = undefined;
          current.fetchedAt = Date.now();
          publish(current);
        } catch {
          /* A failed background refresh leaves the screen alone — the user did not ask for it. */
        }
      },
    });
  }

  const resource: Resource<Args, T> = {
    name,
    keyOf,
    read,
    prefetch(args, { priority = 'background' } = {}) {
      if (!speculationAllowed()) return;
      void read(args, { priority }).catch(() => {});
    },
    peek(args) {
      return resource.peekKey(keyOf(args));
    },
    peekKey(key) {
      const entry = store.get(key);
      /* Pure: no eviction, no `touch`, no scheduling. `useSyncExternalStore` calls this during
         render, possibly more than once — it must not have effects. */
      return entry ? entry.snapshot : (EMPTY as ResourceSnapshot<T>);
    },
    subscribe(args, listener) {
      return resource.subscribeKey(keyOf(args), listener);
    },
    subscribeKey(key, listener) {
      let entry = store.get(key);
      if (!entry) {
        /* A subscriber before any read: a slot to hold the listener so the read that follows a
           tick later can hand its answer back. Not enqueued, not an answer — `placeholder` is
           what stops `read` from mistaking it for one. */
        entry = {
          key,
          status: 'queued',
          placeholder: true,
          fetchedAt: 0,
          priority: 'background',
          promise: Promise.resolve(undefined as unknown as T),
          settle: { resolve: () => {}, reject: () => {} },
          snapshot: EMPTY as ResourceSnapshot<T>,
          listeners: new Set(),
        };
        entry.promise.catch(() => {});
        store.set(key, entry);
      }
      entry.listeners.add(listener);
      return () => {
        const current = store.get(key);
        current?.listeners.delete(listener);
      };
    },
    invalidate(args) {
      const drop = (key: string, entry: Entry<T>) => {
        entry.controller?.abort();
        dropQueued(`${name}:${key}`);
        store.delete(key);
        /* A queued commit would run on the next paint and hand the dropped value straight back
           to the listeners still attached. */
        if (entry.pendingCommit) {
          pendingPublish.delete(entry.pendingCommit);
          entry.pendingCommit = undefined;
        }
        entry.snapshot = EMPTY as ResourceSnapshot<T>;
        for (const listener of entry.listeners) listener();
      };
      if (args === undefined) {
        for (const [key, entry] of Array.from(store)) drop(key, entry);
        return;
      }
      const key = keyOf(args);
      const entry = store.get(key);
      if (entry) drop(key, entry);
    },
    expire(args) {
      const mark = (entry: Entry<T>) => {
        if (entry.status !== 'resolved') return;
        /* Two different things, depending on whether anyone is looking.
           **On screen** — re-read now, underneath, with no loading state. `revalidate` moves
           `fetchedAt` forward itself, which also stops a second call a moment later from starting
           a second request.
           **Not on screen** — mark it and stop; it costs nothing until a screen mounts against
           it, and then that mount gets the cached value immediately with a refresh behind it. */
        if (entry.listeners.size > 0 && entry.args !== undefined) {
          revalidate(entry.args as Args, entry.key, entry);
          return;
        }
        entry.fetchedAt = 0;
        entry.snapshot = buildSnapshot(entry);
        for (const listener of entry.listeners) listener();
      };
      if (args === undefined) {
        for (const entry of Array.from(store.values())) mark(entry);
        return;
      }
      const entry = store.get(keyOf(args));
      if (entry) mark(entry);
    },
    seed(args, value, fetchedAt) {
      /* See the interface docstring: the store is shared across requests on the server. */
      if (typeof window === 'undefined') return;

      const key = keyOf(args);
      const stored = store.get(key);

      /* Never clobber a client value that is at least as fresh: makes a remount from the router
         cache harmless, and stops a stale RSC payload overwriting a refreshed value. */
      if (
        stored &&
        !stored.placeholder &&
        stored.status === 'resolved' &&
        stored.fetchedAt >= fetchedAt
      ) {
        return;
      }

      /* Built literally rather than through `create()`, which would enqueue a real request. */
      let resolve!: (v: T) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      promise.catch(() => {});

      const entry: Entry<T> = {
        key,
        /* `args` matters: `expire()` and `bindResourceRefresh` start their revalidation from it,
           so a seeded entry without it is invisible to the tab-return refresh. */
        args,
        status: 'resolved',
        value,
        /* Clamped to never be in the future: Math.min(generatedAt, Date.now()). An RSC payload can
           be minutes old, and a fresh-now stamp would pin stale HTML for a full TTL. A server
           clock ahead clamps to now (safe); a clock behind makes the entry immediately stale — one
           silent background revalidation. It can only ever err toward stale. */
        fetchedAt: Math.min(fetchedAt, Date.now()),
        priority: 'immediate',
        promise,
        settle: { resolve, reject },
        snapshot: EMPTY as ResourceSnapshot<T>,
        /* Carried over as `read`/`write` do: `subscribeKey` runs during render and may already
           have created a placeholder holding this key's listeners. */
        listeners: stored?.listeners ?? new Set(),
      };
      entry.settle.resolve(value);

      /* Written synchronously, *not* through `publish()`: publish is rAF-bound and the hydration
         render happens before the next frame, so a published seed would arrive one frame after
         React already rendered EMPTY — the skeleton flash this exists to remove. */
      entry.snapshot = buildSnapshot(entry);

      /* `touch` is delete-then-set, so it also inserts — the LRU-correct way to place a new entry
         at the most-recent end. `trim` preserves this key: a seed is the one entry we know a
         component is about to read. */
      touch(key, entry);
      trim(key);
    },
    write(args, update) {
      const key = keyOf(args);
      const stored = store.get(key);
      /* A placeholder holds listeners and nothing else — no previous value to update from; the
         flag must come off or the next `read` would discard the written value. */
      const entry = stored && !stored.placeholder ? stored : undefined;
      const next =
        typeof update === 'function'
          ? (update as (previous: T | undefined) => T)(entry?.value)
          : update;
      if (!entry) {
        /* Writing to something never read is legitimate — a mutation's response is an answer, so
           the next screen does not have to ask. Marked fresh so it is not immediately re-read. */
        if (stored) store.delete(key);
        const seeded = create(key, args, 'background');
        if (stored) seeded.listeners = stored.listeners;
        dropQueued(`${name}:${key}`);
        seeded.controller?.abort();
        seeded.controller = undefined;
        seeded.value = next;
        seeded.status = 'resolved';
        seeded.fetchedAt = Date.now();
        seeded.settle.resolve(next);
        publish(seeded);
        return;
      }
      entry.value = next;
      entry.error = undefined;
      entry.status = 'resolved';
      /* `fetchedAt` is *not* moved forward: an optimistic value is the caller's guess at what the
         server will say, so it stays as stale as what it replaced and is confirmed by the next
         revalidation rather than trusted for a full TTL. */
      publish(entry);
    },
    cancelBackground(args) {
      const key = keyOf(args);
      const entry = store.get(key);
      if (!entry || entry.priority !== 'background' || entry.listeners.size > 0) return false;
      if (entry.status === 'queued' && dropQueued(`${name}:${key}`)) return true;
      if (entry.status === 'loading') {
        store.delete(key);
        entry.controller?.abort();
        return true;
      }
      return false;
    },
  };

  registry.add({
    clear: () => resource.invalidate(),
    expireAll: () => resource.expire(),
  });

  return resource;
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** Args that mean "not yet" — no key, no request, an empty snapshot. */
export const SKIP = Symbol('resource.skip');
export type MaybeArgs<Args> = Args | typeof SKIP;

/**
 * Read a resource in a component.
 *
 * The first render already has the answer if the cache does, which is the whole point: a screen
 * you have seen before paints its content in frame one instead of an empty box, a skeleton and a
 * request. A stale answer paints too, and the refresh happens underneath with `isLoading` true and
 * `data` present — so a screen that draws a skeleton on `isLoading` alone would undo the benefit.
 * Branch on `data === undefined` for the placeholder and use `isLoading` only to dim.
 *
 * Pass `SKIP` for a read that should not happen yet — an unselected tab, a signed-out visitor, a
 * list whose id has not resolved. That is the mechanism that stops a screen paying for content
 * nobody asked for, which the profile page was doing twice over.
 */
export function useResource<Args, T>(
  resource: Resource<Args, T>,
  args: MaybeArgs<Args>,
  options?: {
    /**
     * Keep showing the previous key's answer until the new one lands.
     *
     * **A paged list needs this and the failure without it is not subtle.** Changing the page
     * changes the key, and a key with nothing cached yet reports `data === undefined` — so the list
     * unmounts for the length of one round trip. That collapses the scroll container, the browser
     * clamps `scrollTop` to the new (tiny) maximum, and the page snaps to the very top; the
     * pager's own scroll-to-the-list has already run by then and is undone. `app/page.tsx` carried
     * a comment about exactly this before it used a cache at all, and the first version of this
     * hook reintroduced it.
     *
     * Off by default, because for a screen that is not paged it is wrong: showing the *previous*
     * profile while the next one loads is worse than showing a skeleton.
     */
    keepPrevious?: boolean;
    /**
     * A server-rendered answer for this exact key.
     *
     * Both halves matter. `getServerSnapshot` returns it so the SSR pass renders content rather
     * than a skeleton; the render-phase `seed` below installs it so the effect's `read` finds a
     * fresh entry and sends nothing. Without the first there is no content in the HTML; without
     * the second the hydration render paints content and then immediately re-fetches it.
     *
     * `key` is checked against the key this render computed, and that check is the single gate
     * for both. It is what makes a disagreement safe: the server and the client can compute
     * different keys (a cleared cookie, a setting changed in another tab), and when they do the
     * seed simply does not apply and the screen behaves exactly as it does today — one request,
     * no hydration mismatch, because *both* the SSR pass and the hydration render used the
     * server's value.
     */
    initial?: { key: string; data: T; generatedAt: number };
  },
): ResourceSnapshot<T> & { refresh: () => void } {
  const key = args === SKIP ? null : resource.keyOf(args as Args);
  const keepPrevious = options?.keepPrevious ?? false;
  const initial = options?.initial;
  const initialApplies = initial !== undefined && initial.key === key;

  /* Installed during render, before `useSyncExternalStore` reads.
   *
   * Render-phase mutation of a module-scope `Map` has precedent in this file — `subscribeKey`
   * inserts a placeholder entry into the same store during render — and `seed` is idempotent by
   * key with a `fetchedAt` guard, so a discarded render costs nothing and a double invoke in
   * development is a no-op the second time. An effect would be one frame too late: the first
   * committed frame is exactly the one that must not be a skeleton.
   *
   * `seed` no-ops on the server, so this cannot leak one request's data into another's render. */
  if (initialApplies) {
    resource.seed(args as Args, initial.data, initial.generatedAt);
  }

  /* Render-phase reads go through the *key*, which is a string computed here from `args`. The
     effect below closes over `args` itself, which is safe for the same reason: it re-runs whenever
     the key changes, so the closure it keeps always came from a render whose args produce the
     current key — and same key means same answer.
     `args` is deliberately absent from the dependency lists. It is a literal at almost every call
     site, so a new identity every render; keying on it would re-subscribe and re-request on each
     one, which is the failure `useAuth`'s docstring records `/favorites` hitting a rate limit on. */

  const subscribe = useCallback(
    (listener: () => void) => (key === null ? () => {} : resource.subscribeKey(key, listener)),
    [resource, key],
  );

  const getSnapshot = useCallback(
    () => (key === null ? (EMPTY as ResourceSnapshot<T>) : resource.peekKey(key)),
    [resource, key],
  );

  /* Must be a *stable* object, and not merely for tidiness: react-dom throws
     "The result of getServerSnapshot should be cached to avoid an infinite loop" if it returns a
     fresh one each call. `EMPTY` is a frozen module constant; the seeded branch builds its
     snapshot once per distinct payload.

     Split into a memoised value and a callback returning it, rather than one `useCallback` that
     builds the object inline, so the dependencies the React Compiler infers match the ones
     written down — it refuses to optimise a component whose manual memoization it cannot
     preserve, and `initial?.data` reads as less specific than the `initial` it infers. */
  const initialData = initialApplies ? initial.data : undefined;
  const serverSnapshot = useMemo(
    () =>
      initialData === undefined
        ? (EMPTY as ResourceSnapshot<T>)
        : (Object.freeze({
            data: initialData,
            error: undefined,
            isLoading: false,
            isStale: false,
          }) as ResourceSnapshot<T>),
    [initialData],
  );
  const getServerSnapshot = useCallback(() => serverSnapshot, [serverSnapshot]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (key === null) return;
    void resource.read(args as Args).catch(() => {
      /* The error is in the snapshot; the promise rejection is not this hook's to report. */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource, key]);

  const refresh = useCallback(
    () => {
      if (key === null) return;
      void resource.read(args as Args, { force: true }).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource, key],
  );

  /* The last answer this component actually rendered.
   *
   * Adjusted during render rather than from an effect, which is React's own pattern for derived
   * state and the one `AppLayout` already uses for the overlay drawer. Both alternatives are
   * rejected here for stated reasons: a ref written during render trips `react-hooks/refs`
   * (a render React discards would still have mutated it), and an effect trips
   * `react-hooks/set-state-in-effect` *and* lags a render — which on a page turn is one frame of
   * exactly the empty list this exists to prevent. */
  const [retained, setRetained] = useState<T | undefined>(undefined);
  if (keepPrevious && snapshot.data !== undefined && retained !== snapshot.data) {
    setRetained(snapshot.data);
  } else if (key === null && retained !== undefined) {
    /* Dropped when the read is switched off entirely, or a signed-out visitor keeps seeing the
       list they were signed in for. */
    setRetained(undefined);
  }

  return useMemo(() => {
    if (!keepPrevious || snapshot.data !== undefined || key === null || retained === undefined) {
      return { ...snapshot, refresh };
    }
    /* `isLoading` stays whatever the *new* key reports — the caller dims on it — while `data` is
       the old page, so the list keeps its box and the scroller keeps its height. */
    return { ...snapshot, data: retained, refresh };
  }, [keepPrevious, snapshot, retained, key, refresh]);
}

/** Registers a gate-change notifier, so an owner can wake held-back publications. */
export function subscribeResourceGate(listener: () => void) {
  gateListeners.add(listener);
  return () => gateListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Coming back
// ---------------------------------------------------------------------------

/**
 * How long a tab has to have been away before returning to it is worth a re-read.
 *
 * Alt-tabbing to check something and coming straight back is not an event, and treating it as one
 * would put a burst of requests behind every window switch. A minute is roughly the point past
 * which "what I am looking at might be old" starts being true for the shortest TTL in the
 * catalogue.
 */
const STALE_AFTER_HIDDEN_MS = 60_000;

let hiddenAt = 0;
let returnBound = false;

/**
 * Re-read what is on screen when the tab comes back, and when the network does.
 *
 * This is the half of "no interruption" that a TTL cannot buy on its own. A TTL only decides what
 * happens the *next* time something reads; a screen you left open for an hour has read nothing
 * since, so it sits there showing an hour-old answer with no reason to ask again. Every native app
 * refreshes on foreground, and until now nothing in this app did — `lib/detail.ts` had the only
 * `visibilitychange` listener in the codebase, and it was about publication timing rather than
 * freshness.
 *
 * It **expires rather than invalidates**, which is the entire difference between a refresh and a
 * reload: every mounted screen keeps exactly what it is showing and re-reads underneath, with no
 * loading state and nothing removed. Dropping the entries instead would empty every screen in the
 * app in one frame — the interruption this is supposed to prevent, delivered by the mechanism meant
 * to prevent it.
 *
 * Nothing actually goes out until something reads: `expire` only marks, and the mounted components
 * are what turn that into a request on their next render. A screen nobody is looking at costs
 * nothing.
 *
 * Called once, from the app shell.
 */
export function bindResourceRefresh() {
  if (returnBound || typeof document === 'undefined') return () => {};
  returnBound = true;

  const onVisibility = () => {
    if (document.visibilityState !== 'visible') {
      hiddenAt = Date.now();
      return;
    }
    if (hiddenAt && Date.now() - hiddenAt >= STALE_AFTER_HIDDEN_MS) expireAllResources();
    hiddenAt = 0;
  };
  /* Reconnecting has no threshold. Whatever failed while the connection was down failed for that
     reason, and the answers that did arrive were from before it. */
  const onOnline = () => expireAllResources();

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
    returnBound = false;
  };
}
