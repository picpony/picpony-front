'use client';

import type { DomLease } from './dom';
import { heroFrameScheduler } from './scheduler';

export type Disposer = () => void;

type Releasable = Disposer | DomLease;

function toDisposer(value: Releasable): Disposer {
  return typeof value === 'function' ? value : value.release;
}

/**
 * Deterministic teardown for one session.
 *
 * Resources release in reverse acquisition order, and anything added after
 * disposal releases immediately — a late lease from an async step that lost its
 * race can never outlive the session that requested it.
 */
export class ResourceScope {
  private disposers = new Set<Disposer>();
  private disposed = false;

  add<T extends Releasable | null | undefined>(value: T): T {
    if (!value) return value;
    const dispose = toDisposer(value);
    if (this.disposed) {
      try {
        dispose();
      } catch {
        // A late resource is already outside the active session.
      }
    } else {
      this.disposers.add(dispose);
    }
    return value;
  }

  release(value: Releasable | null | undefined) {
    if (!value) return;
    const dispose = toDisposer(value);
    if (!this.disposers.delete(dispose)) return;
    try {
      dispose();
    } catch {
      // Best-effort for DOM that disconnected mid-frame.
    }
  }

  /** Detach without releasing, transferring ownership to the caller. */
  take(value: Releasable | null | undefined) {
    if (!value) return false;
    return this.disposers.delete(toDisposer(value));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const disposers = [...this.disposers].reverse();
    this.disposers.clear();
    disposers.forEach((dispose) => {
      try {
        dispose();
      } catch {
        // A disconnected route must not block the rest of the cleanup.
      }
    });
  }
}

/**
 * A listener set the controller pokes whenever observable state moves. Waiters
 * re-evaluate their own predicate rather than subscribing to specific events, so
 * there is exactly one notification path to reason about.
 */
export class HeroSignal {
  private listeners = new Set<() => void>();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // One stale waiter cannot stop the others from settling.
      }
    });
  }
}

export type WaitOptions<T> = {
  /** Return non-null to resolve; null means "keep waiting". */
  read: () => T | null;
  signal?: AbortSignal;
  timeout?: number;
};

/** Resolve as soon as `read()` yields a value, or null on abort/timeout. */
export function waitForSignal<T>(
  signal: HeroSignal,
  { read, signal: abortSignal, timeout }: WaitOptions<T>,
): Promise<T | null> {
  let immediate: T | null = null;
  try {
    immediate = read();
  } catch {
    return Promise.resolve(null);
  }
  if (immediate !== null) return Promise.resolve(immediate);
  if (abortSignal?.aborted) return Promise.resolve(null);

  return new Promise<T | null>((resolve) => {
    let timer = 0;
    let settled = false;
    let unsubscribe: Disposer = () => {};
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      unsubscribe();
      abortSignal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const check = () => {
      try {
        const value = read();
        if (value !== null) finish(value);
      } catch {
        finish(null);
      }
    };
    const abort = () => finish(null);
    unsubscribe = signal.subscribe(check);
    abortSignal?.addEventListener('abort', abort, { once: true });
    if (timeout !== undefined) timer = window.setTimeout(() => finish(null), timeout);
    check();
  });
}

/** Resolve after the next scheduler flush, or false if aborted first. */
export function waitForFrame(signals: AbortSignal[], timeout: number) {
  if (signals.some((signal) => signal.aborted)) return Promise.resolve(false);
  const owner = {};
  return new Promise<boolean>((resolve) => {
    let timer = 0;
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) window.clearTimeout(timer);
      signals.forEach((signal) => signal.removeEventListener('abort', abort));
      heroFrameScheduler.cancel(owner);
      resolve(value);
    };
    const abort = () => finish(false);
    signals.forEach((signal) => signal.addEventListener('abort', abort, { once: true }));
    timer = window.setTimeout(() => finish(false), timeout);
    heroFrameScheduler.request(owner, { read: () => undefined, write: () => finish(true) });
    if (signals.some((signal) => signal.aborted)) abort();
  });
}

/** Run one batched read/write pass, resolving false if the session aborted. */
export function runScheduledFrame<T>(
  abortSignal: AbortSignal,
  task: { read: () => T; write: (value: T) => void },
) {
  if (abortSignal.aborted) return Promise.resolve(false);
  const owner = {};
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      abortSignal.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = () => {
      heroFrameScheduler.cancel(owner);
      finish(false);
    };
    abortSignal.addEventListener('abort', abort, { once: true });
    heroFrameScheduler.request(owner, task);
    void heroFrameScheduler.settled().then(
      () => finish(!abortSignal.aborted),
      () => finish(false),
    );
    if (abortSignal.aborted) abort();
  });
}

/** Await a promise but give up (resolving null) the moment `signal` aborts. */
export function settleUnlessAborted<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve<T | null>(null);
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      resolve(value);
    };
    const abort = () => finish(null);
    signal.addEventListener('abort', abort, { once: true });
    void promise.then((value) => finish(value), () => finish(null));
    if (signal.aborted) abort();
  });
}
