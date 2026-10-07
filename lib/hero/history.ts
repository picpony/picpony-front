'use client';

import {
  consumeHistoryLayerPop,
  historyLayerBeneath,
  setHistoryLayerGate,
  settleHistoryLayers,
} from '@/lib/historyLayers';
import type { ImageHeroBackgroundLocation, ImageHeroSnapshot } from './types';
import { randomId } from '@/lib/utils';

const HISTORY_STATE_KEY = '__picponyImageHero';
/** `lib/historyLayers.ts`'s marker, stripped from anything written here. */
const HISTORY_LAYER_KEY = '__picponyLayer';
const HISTORY_TIMEOUT_MS = 4000;
const LATE_POP_TTL_MS = 12000;
const MAX_MEMORY_RECORDS = 4;

type StableHistoryRole = 'base' | 'guard';
type HistoryRole = 'provisional' | StableHistoryRole;
type HistoryPosition = 'background' | HistoryRole | 'unknown';

/**
 * Normalized marker. Older deployments wrote a `version: 1` shape with `kind`
 * instead of `role`; it is translated on read so the protocol below only ever
 * deals with one form.
 */
export type HeroMarker = {
  token: string;
  role: HistoryRole;
  sessionId: number;
  imageId: number;
  detailHref: string;
  background: ImageHeroBackgroundLocation;
  /** History entries between the detail base and the gallery. */
  backgroundDepth: 1 | 2;
};

export type HeroHistoryRecord = {
  token: string;
  sessionId: number;
  imageId: number;
  detailHref: string;
  background: ImageHeroBackgroundLocation;
  snapshot: ImageHeroSnapshot;
  backgroundDepth: 1 | 2;
};

export type HeroHistoryNavigation = {
  previous: HistoryPosition;
  position: HistoryPosition;
  marker: HeroMarker | null;
  record: HeroHistoryRecord | null;
  /** This pop was caused by our own `history.go`, not by the user. */
  programmatic: boolean;
  programmaticToken: string | null;
  /** Arrived after its traversal had already timed out. */
  late: boolean;
  href: string;
};

type PopWaiter = {
  accept: (marker: HeroMarker | null, href: string) => boolean;
  ownerToken: string | null;
  /** `afterDispatch`: settle now, resolve once the popstate dispatch has finished. */
  finish: (matched: boolean, afterDispatch?: boolean) => void;
};

/**
 * Run `task` after the event being dispatched has reached **every** listener.
 *
 * A browser runs a microtask checkpoint after each listener callback, so a promise resolved
 * inside our (capture) popstate listener continues before Next's own `onPopState` has run. A
 * router call made there dispatched `ACTION_NAVIGATE` ahead of the `ACTION_RESTORE` Next was
 * about to dispatch for the same pop — and the router's queue discards whatever is pending when a
 * traversal arrives, so the navigation never committed (R10-001: 上一张 ejected the viewer and
 * parked the app in `recovering` for four seconds). A task posted during the dispatch runs after
 * it, so whatever the continuation does is ordered after the RESTORE, never under it.
 */
function afterDispatch(task: () => void) {
  if (typeof MessageChannel === 'undefined') {
    window.setTimeout(task, 0);
    return;
  }
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    task();
  };
  channel.port2.postMessage(null);
}

type LatePopWaiter = {
  accept: PopWaiter['accept'];
  ownerToken: string | null;
  expiresAt: number;
};

function normalizeHref(href: string) {
  try {
    const url = new URL(href, window.location.href);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return `${pathname}${url.search}`;
  } catch {
    return href;
  }
}

export function normalizeHeroHref(href: string) {
  return normalizeHref(href);
}

function isBackground(value: unknown): value is ImageHeroBackgroundLocation {
  if (!value || typeof value !== 'object') return false;
  const location = value as Partial<ImageHeroBackgroundLocation>;
  return typeof location.pathname === 'string' && typeof location.search === 'string';
}

function isRole(value: unknown, allowProvisional: boolean): value is HistoryRole {
  return value === 'base' || value === 'guard' || (allowProvisional && value === 'provisional');
}

export function readHeroHistoryMarker(state: unknown): HeroMarker | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[HISTORY_STATE_KEY];
  if (!value || typeof value !== 'object') return null;
  const marker = value as Record<string, unknown>;

  const legacy = marker.version === 1;
  if (!legacy && marker.version !== 2) return null;
  const role = legacy ? marker.kind : marker.role;
  if (
    typeof marker.token !== 'string' ||
    !isRole(role, !legacy) ||
    typeof marker.imageId !== 'number' ||
    typeof marker.detailHref !== 'string' ||
    !isBackground(marker.background) ||
    (!legacy && typeof marker.sessionId !== 'number')
  ) {
    return null;
  }
  return {
    token: marker.token,
    role,
    sessionId: legacy ? 0 : (marker.sessionId as number),
    imageId: marker.imageId,
    detailHref: marker.detailHref,
    background: marker.background,
    backgroundDepth: !legacy && marker.backgroundDepth === 2 ? 2 : 1,
  };
}

/**
 * A dialog, sheet or lightbox entry (`lib/historyLayers.ts`) is transparent to this
 * protocol: it stands on a ladder rung and carries that rung's marker aside, so reading
 * through it gives the rung. Pops between the two never reach this driver (the layer
 * module consumes them), and every traversal here starts on the rung itself, because
 * `enqueue` settles the layers first.
 */
function markerOf(state: unknown): HeroMarker | null {
  return readHeroHistoryMarker(state) ?? readHeroHistoryMarker(historyLayerBeneath(state));
}

function positionOf(state: unknown): HistoryPosition {
  return markerOf(state)?.role ?? 'background';
}

function stateWithMarker(marker: HeroMarker) {
  const current = window.history.state;
  const state = current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {};
  // A rung is never a layer entry.
  delete state[HISTORY_LAYER_KEY];
  return { ...state, [HISTORY_STATE_KEY]: { version: 2, ...marker } };
}

/**
 * Write the current entry at another URL **through Next's documented native path**.
 *
 * The state handed over carries our marker and nothing of the router's: without `__NA` the App
 * Router's patched `replaceState` copies its own `__NA` and tree into it and dispatches a restore
 * for the new URL, so `usePathname` follows while the tree — and so the mounted detail route —
 * stays exactly where it is (`dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`,
 * "`window.history.replaceState`"). With `__NA` it would take its internal fast path and never
 * learn the URL, and the next router commit would write the old one back.
 *
 * The router is always mounted in this app, so its patch is always there; the fix-up is for the
 * one way that could fail (a remount restoring the unpatched pair): an entry without `__NA` makes
 * Next reload the page when a later Back lands on it.
 */
function replaceEntryUrl(marker: HeroMarker, href: string) {
  const previous = window.history.state as Record<string, unknown> | null;
  window.history.replaceState({ [HISTORY_STATE_KEY]: { version: 2, ...marker } }, '', href);
  const written = window.history.state as Record<string, unknown> | null;
  if (previous && written && !written.__NA && previous.__NA) {
    window.history.replaceState(
      {
        ...written,
        __NA: previous.__NA,
        __PRIVATE_NEXTJS_INTERNALS_TREE: previous.__PRIVATE_NEXTJS_INTERNALS_TREE,
      },
      '',
      href,
    );
  }
}

function markerFor(record: HeroHistoryRecord, role: HistoryRole): HeroMarker {
  return {
    token: record.token,
    role,
    sessionId: record.sessionId,
    imageId: record.imageId,
    detailHref: record.detailHref,
    background: record.background,
    backgroundDepth: record.backgroundDepth,
  };
}

function createToken(sessionId: number, imageId: number) {
  return `v2:${sessionId}:${imageId}:${randomId()}`;
}

/**
 * Hero's history protocol.
 *
 * An open builds a three-entry ladder above the gallery:
 *
 *     [gallery] → [provisional @gallery] → [base @detail] → [guard @detail]
 *
 * The provisional entry is pushed synchronously at click time so that a Back
 * pressed before the App Router commits still lands on us instead of leaving the
 * site. The guard entry is what makes closing animatable: Back from `guard` to
 * `base` changes nothing visible, which gives the closing flight somewhere to
 * run before the URL actually returns to the gallery.
 *
 * Every traversal is serialized through `enqueue` and confirmed by observing the
 * resulting popstate, because `history.go` is asynchronous and may be coalesced,
 * delayed, or dropped entirely.
 */
class HeroHistoryDriver {
  private initialized = false;
  private listener: ((navigation: HeroHistoryNavigation) => void) | null = null;
  private position: HistoryPosition = 'unknown';
  private records = new Map<string, HeroHistoryRecord>();
  private activeRecord: HeroHistoryRecord | null = null;
  private waiters = new Set<PopWaiter>();
  /** Traversals that timed out but may still arrive. */
  private lateWaiters = new Set<LatePopWaiter>();
  private provisionalTokens = new Set<string>();
  private transaction: Promise<unknown> = Promise.resolve();
  private queuedTransactions = 0;
  private stabilityListeners = new Set<() => void>();
  /** Counts every pop that reaches this driver: a write that waited proves nothing moved since. */
  private popSerial = 0;

  initialize(listener: (navigation: HeroHistoryNavigation) => void) {
    this.listener = listener;
    if (!this.initialized) {
      this.initialized = true;
      window.addEventListener('popstate', this.handlePopState, { capture: true });
      this.position = positionOf(window.history.state);
      // Layer entries are pushed only between this queue's transactions.
      setHistoryLayerGate(() => this.isStableForWrite());
    }
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  currentMarker() {
    return markerOf(window.history.state);
  }

  currentRole() {
    return this.currentMarker()?.role ?? null;
  }

  currentRecord() {
    const marker = this.currentMarker();
    return marker ? this.recordForToken(marker.token) : this.activeRecord;
  }

  recordForToken(token: string) {
    return this.records.get(token) ?? null;
  }

  isGuard(record: HeroHistoryRecord) {
    const marker = this.currentMarker();
    return Boolean(
      marker &&
      marker.token === record.token &&
      marker.role === 'guard' &&
      normalizeHref(window.location.href) === record.detailHref &&
      !this.hasLateTraversal(),
    );
  }

  createRecord(
    snapshot: ImageHeroSnapshot,
    background: ImageHeroBackgroundLocation,
    detailHref: string,
    sessionId: number,
  ): HeroHistoryRecord {
    return {
      token: createToken(sessionId, snapshot.image.id),
      sessionId,
      imageId: snapshot.image.id,
      detailHref: normalizeHref(detailHref),
      background,
      snapshot,
      backgroundDepth: 1,
    };
  }

  remember(record: HeroHistoryRecord) {
    this.records.set(record.token, record);
    this.activeRecord = record;
    this.trimRecords(record.token);
  }

  forget(record: HeroHistoryRecord) {
    this.records.delete(record.token);
    this.provisionalTokens.delete(record.token);
    if (this.activeRecord?.token === record.token) this.activeRecord = null;
  }

  /**
   * Push the synchronous Back barrier at the gallery URL, before the router has
   * begun committing the detail route.
   */
  claim(record: HeroHistoryRecord) {
    if (!this.isStableForWrite()) return false;
    const expected = normalizeHref(`${record.background.pathname}${record.background.search}`);
    if (normalizeHref(window.location.href) !== expected) return false;

    const current = this.currentMarker();
    const reuseCurrent =
      current?.role === 'provisional' || (!current && this.position === 'provisional');
    if (current && !reuseCurrent) return false;

    record.backgroundDepth = 2;
    const marker = markerFor(record, 'provisional');
    try {
      if (reuseCurrent) {
        if (current) this.provisionalTokens.delete(current.token);
        window.history.replaceState(stateWithMarker(marker), '', window.location.href);
      } else {
        window.history.pushState(stateWithMarker(marker), '', window.location.href);
      }
    } catch {
      record.backgroundDepth = 1;
      return false;
    }
    this.records.set(record.token, record);
    this.activeRecord = record;
    this.provisionalTokens.add(record.token);
    this.position = 'provisional';
    this.trimRecords(record.token);
    return true;
  }

  /** Convert the committed detail entry into the base/guard pair. */
  install(record: HeroHistoryRecord) {
    if (!this.isStableForWrite()) return false;
    if (normalizeHref(window.location.href) !== record.detailHref) return false;
    try {
      window.history.replaceState(
        stateWithMarker(markerFor(record, 'base')),
        '',
        window.location.href,
      );
      window.history.pushState(
        stateWithMarker(markerFor(record, 'guard')),
        '',
        window.location.href,
      );
    } catch {
      return false;
    }
    this.records.set(record.token, record);
    this.provisionalTokens.delete(record.token);
    this.activeRecord = record;
    this.position = 'guard';
    this.trimRecords(record.token);
    return true;
  }

  /** Collapse this record's whole ladder and land back on the gallery. */
  ensureBackground(record: HeroHistoryRecord) {
    return this.enqueue(false, async () => {
      const expectedHref = normalizeHref(
        `${record.background.pathname}${record.background.search}`,
      );
      const currentHref = normalizeHref(window.location.href);
      const current = this.currentMarker();
      const ownsUnmarkedProvisional =
        !current && this.position === 'provisional' && this.provisionalTokens.has(record.token);

      if (currentHref === expectedHref && !current && !ownsUnmarkedProvisional) {
        this.position = 'background';
        return true;
      }
      if (this.hasLateTraversal()) return false;
      if (current && current.token !== record.token) return false;

      const role = current?.role ?? (ownsUnmarkedProvisional ? 'provisional' : null);
      // A provisional entry that already routed sits one level deeper.
      const routedProvisional = role === 'provisional' && currentHref === record.detailHref;
      const steps =
        role === 'guard'
          ? -(record.backgroundDepth + 1)
          : role === 'base'
            ? -record.backgroundDepth
            : role === 'provisional'
              ? routedProvisional
                ? -2
                : -1
              : 0;
      if (!steps) return false;

      const confirmed = await this.goAndConfirm(
        steps,
        (marker, href) => href === expectedHref && !marker,
        record.token,
      );
      if (confirmed) this.position = 'background';
      return confirmed;
    });
  }

  /** Step back off an entry we never managed to mark. */
  returnUnmarkedToBackground(
    background: ImageHeroBackgroundLocation,
    ownerToken: string | null = null,
  ) {
    return this.enqueue(false, async () => {
      const expected = normalizeHref(`${background.pathname}${background.search}`);
      if (normalizeHref(window.location.href) === expected) {
        this.position = 'background';
        return true;
      }
      if (this.hasLateTraversal() || this.currentMarker()) return false;
      const confirmed = await this.goAndConfirm(
        -1,
        (marker, href) => !marker && href === expected,
        ownerToken,
      );
      if (confirmed) this.position = 'background';
      return confirmed;
    });
  }

  /** Back overshot past the gallery entry; step forward onto it. */
  recoverSkippedBackground(record: HeroHistoryRecord) {
    return this.enqueue(false, async () => {
      const expected = normalizeHref(`${record.background.pathname}${record.background.search}`);
      if (normalizeHref(window.location.href) === expected && !this.currentMarker()) {
        this.position = 'background';
        return true;
      }
      if (this.hasLateTraversal() || this.currentMarker()) return false;
      const confirmed = await this.goAndConfirm(
        1,
        (marker, href) => !marker && href === expected,
        record.token,
      );
      if (confirmed) this.position = 'background';
      return confirmed;
    });
  }

  /** Put the guard entry back so this detail view is closable again. */
  restoreGuard(record: HeroHistoryRecord) {
    return this.enqueue(false, async () => {
      if (this.hasLateTraversal()) return false;
      let marker = this.currentMarker();

      if (!marker || marker.token !== record.token) {
        const expectedBackground = normalizeHref(
          `${record.background.pathname}${record.background.search}`,
        );
        if (normalizeHref(window.location.href) !== expectedBackground) return false;
        const restoredBase = await this.goAndConfirm(
          record.backgroundDepth,
          (next) => next?.token === record.token && next.role === 'base',
          record.token,
        );
        if (!restoredBase) return false;
        marker = this.currentMarker();
      }
      if (!marker || marker.token !== record.token) return false;
      if (marker.role === 'guard') {
        this.position = 'guard';
        return true;
      }
      if (marker.role !== 'base') return false;

      if (
        await this.goAndConfirm(
          1,
          (next) => next?.token === record.token && next.role === 'guard',
          record.token,
        )
      ) {
        this.position = 'guard';
        return true;
      }

      // A timed-out `history.go(1)` may still arrive; pushing another guard in
      // that window would permanently duplicate the pair.
      if (this.hasLateTraversal()) return false;

      const stillBase = this.currentMarker();
      if (
        stillBase?.token !== record.token ||
        stillBase.role !== 'base' ||
        normalizeHref(window.location.href) !== record.detailHref
      ) {
        return false;
      }
      window.history.pushState(
        stateWithMarker(markerFor(record, 'guard')),
        '',
        window.location.href,
      );
      this.position = 'guard';
      return true;
    });
  }

  /**
   * Point this ladder at another picture, **in place** — 上一张 / 下一张:
   *
   *     [gallery] [provisional] [base A] [guard A]   →   [gallery] [provisional] [base B] [guard B]
   *
   * A step is not a navigation: no entry is added, Back still closes the viewer to the list it
   * was opened from, and the overlay never unmounts. From the guard, step onto the base (nothing
   * visible changes: same URL, same tree — Next's restore of it is a no-op), write the base at
   * the new URL through the router's native path (`replaceEntryUrl`), then push a fresh guard,
   * which also truncates the stale guard ahead of it. The provisional entry keeps its token, and
   * the record keeps it too: one ladder, one token, whose picture changed — so a later Forward
   * onto the provisional replays the picture the ladder now shows.
   *
   * Resolves the rewritten record, or `null` when the ladder was not where it should be (the
   * caller reconciles from the location). The traversal is confirmed only after its dispatch has
   * finished (`afterDispatch`), so nothing here runs under Next's restore of that pop.
   *
   * **The base is written only where this rewrite's own step left the ladder.** A traversal of
   * the user's can land between that step's popstate and the writes: on a busy main thread the
   * Back's commit queues up behind the step's own, and Chromium dispatches both popstates before
   * the continuation posted during the first. Written anyway, the new URL went onto whatever
   * entry the Back had reached — the list's own: the list on screen under `/pic/<id>`, a guard
   * pushed over it, and a reload opening the picture again. So no pop may have landed since the
   * step's, the base must still be current, and the caller must not have abandoned the step
   * (`signal`: the user's traversal overtook it) — otherwise nothing is written, and the
   * traversal that got there first decides what comes next.
   */
  retarget(
    record: HeroHistoryRecord,
    next: Pick<HeroHistoryRecord, 'imageId' | 'detailHref' | 'snapshot'>,
    signal?: AbortSignal,
  ): Promise<HeroHistoryRecord | null> {
    return this.enqueue<HeroHistoryRecord | null>(null, async () => {
      if (signal?.aborted || !this.isGuard(record)) return null;
      const onBase = (marker: HeroMarker | null, href: string) =>
        marker?.token === record.token && marker.role === 'base' && href === record.detailHref;
      const landedAt = await this.goAndConfirmAt(-1, onBase, record.token);
      if (
        landedAt === null ||
        signal?.aborted ||
        landedAt !== this.popSerial ||
        this.hasLateTraversal() ||
        !onBase(this.currentMarker(), normalizeHref(window.location.href))
      ) {
        return null;
      }
      this.position = 'base';
      const updated: HeroHistoryRecord = {
        ...record,
        imageId: next.imageId,
        detailHref: normalizeHref(next.detailHref),
        snapshot: next.snapshot,
      };
      try {
        replaceEntryUrl(markerFor(updated, 'base'), updated.detailHref);
        window.history.pushState(
          stateWithMarker(markerFor(updated, 'guard')),
          '',
          window.location.href,
        );
      } catch {
        return null;
      }
      this.records.set(updated.token, updated);
      if (this.activeRecord?.token === updated.token) this.activeRecord = updated;
      this.position = 'guard';
      this.trimRecords(updated.token);
      return updated;
    });
  }

  /**
   * The same step for a detail with no ladder — opened without a flight (the two motion tiers
   * that do not fly), so its entry is the router's own: rewrite it at the new URL. Only while
   * that entry is still current (`fromHref`, the picture the step left) and the step still wanted:
   * a Back that landed first leaves the list's entry current, which is not this write's to take.
   */
  replaceUnownedDetail(detailHref: string, fromHref: string, signal?: AbortSignal) {
    return this.enqueue(false, async () => {
      if (
        signal?.aborted ||
        this.currentMarker() ||
        normalizeHref(window.location.href) !== normalizeHref(fromHref)
      ) {
        return false;
      }
      window.history.replaceState(null, '', normalizeHref(detailHref));
      return true;
    });
  }

  /**
   * A marker with no live record — left by a refresh or a BFCache restore.
   * Collapse its ladder as ordinary navigation; never invent an animation.
   */
  collapseOrphanMarker(marker: HeroMarker) {
    return this.enqueue(false, async () => {
      if (this.hasLateTraversal()) return false;
      const steps =
        marker.role === 'guard'
          ? -(marker.backgroundDepth + 1)
          : marker.role === 'base'
            ? -marker.backgroundDepth
            : -1;
      const expected = normalizeHref(`${marker.background.pathname}${marker.background.search}`);
      return this.goAndConfirm(steps, (next, href) => href === expected && !next, marker.token);
    });
  }

  reconcileLocation() {
    const marker = this.currentMarker();
    const href = normalizeHref(window.location.href);
    this.consumeLateTraversal(marker, href);
    this.position = positionOf(window.history.state);
    if (marker) this.activeRecord = this.records.get(marker.token) ?? this.activeRecord;
    return { marker, position: this.position, href, stable: this.isStableForWrite() };
  }

  /** Resolves when no traversal is in flight, so a write cannot interleave. */
  waitForStable(timeout = HISTORY_TIMEOUT_MS) {
    if (this.isStableForWrite()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let timer = 0;
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        this.stabilityListeners.delete(check);
        resolve(value);
      };
      const check = () => {
        if (this.isStableForWrite()) finish(true);
      };
      this.stabilityListeners.add(check);
      timer = window.setTimeout(() => finish(this.isStableForWrite()), timeout);
      check();
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Serialize traversals; two concurrent `history.go` calls are unorderable. `fallback` is what
   * a transaction that threw resolves with.
   */
  private enqueue<T>(fallback: T, work: () => Promise<T>): Promise<T> {
    this.queuedTransactions += 1;
    // Step counts assume a ladder rung is current: unwind any dialog above it first.
    const run = this.transaction.then(settleHistoryLayers).then(work, work).catch(() => fallback);
    const observed = run.then(
      (value) => {
        this.queuedTransactions = Math.max(0, this.queuedTransactions - 1);
        this.notifyStability();
        return value;
      },
      () => {
        this.queuedTransactions = Math.max(0, this.queuedTransactions - 1);
        this.notifyStability();
        return fallback;
      },
    );
    this.transaction = observed.then(
      () => undefined,
      () => undefined,
    );
    return observed;
  }

  /** `history.go` plus proof that it actually landed where we asked. */
  private goAndConfirm(
    delta: number,
    accept: (marker: HeroMarker | null, href: string) => boolean,
    ownerToken: string | null,
  ) {
    return this.goAndConfirmAt(delta, accept, ownerToken).then((at) => at !== null);
  }

  /**
   * `goAndConfirm`, resolving the pop count at which it landed (`null` if it did not): a caller
   * that writes after the confirmation compares it with `popSerial` to prove no traversal has
   * landed in between.
   */
  private goAndConfirmAt(
    delta: number,
    accept: (marker: HeroMarker | null, href: string) => boolean,
    ownerToken: string | null,
  ) {
    return new Promise<number | null>((resolve) => {
      let timeout = 0;
      let settled = false;
      const waiter: PopWaiter = {
        accept,
        ownerToken,
        finish: (matched, deferred = false) => {
          if (settled) return;
          settled = true;
          if (timeout) window.clearTimeout(timeout);
          this.waiters.delete(waiter);
          const at = matched ? this.popSerial : null;
          if (deferred) afterDispatch(() => resolve(at));
          else resolve(at);
        },
      };
      this.waiters.add(waiter);
      timeout = window.setTimeout(() => {
        const marker = this.currentMarker();
        const href = normalizeHref(window.location.href);
        const matched = this.accepts(accept, marker, href);
        // Still pending: remember it so a very late arrival is not mistaken for
        // a fresh user gesture.
        if (!matched) {
          this.lateWaiters.add({ accept, ownerToken, expiresAt: Date.now() + LATE_POP_TTL_MS });
        }
        waiter.finish(matched);
      }, HISTORY_TIMEOUT_MS);
      try {
        window.history.go(delta);
      } catch {
        waiter.finish(false);
      }
    });
  }

  private handlePopState = (event: PopStateEvent) => {
    // A pop between a layer entry and the rung beneath it is not a ladder move.
    if (consumeHistoryLayerPop(event)) return;
    this.popSerial += 1;
    const previous = this.position;
    const marker = markerOf(event.state);
    const href = normalizeHref(window.location.href);
    this.position = positionOf(event.state);

    const late = this.consumeLateTraversal(marker, href);
    let programmatic = late.matched;
    let programmaticToken = late.ownerToken;
    for (const waiter of [...this.waiters]) {
      if (!this.accepts(waiter.accept, marker, href)) continue;
      programmatic = true;
      programmaticToken ??= waiter.ownerToken;
      // Settled now (the pop is ours), resolved after the dispatch — see `afterDispatch`.
      waiter.finish(true, true);
    }

    const record = marker ? this.recordForToken(marker.token) : null;
    if (record) this.activeRecord = record;
    try {
      this.listener?.({
        previous,
        position: this.position,
        marker,
        record,
        programmatic,
        programmaticToken,
        late: late.matched,
        href,
      });
    } catch {
      // A route listener is advisory; history bookkeeping must stay usable.
    }
    this.notifyStability();
  };

  private consumeLateTraversal(marker: HeroMarker | null, href: string) {
    const now = Date.now();
    let matched = false;
    let ownerToken: string | null = null;
    for (const waiter of [...this.lateWaiters]) {
      if (waiter.expiresAt <= now) {
        this.lateWaiters.delete(waiter);
        continue;
      }
      if (!this.accepts(waiter.accept, marker, href)) continue;
      this.lateWaiters.delete(waiter);
      matched = true;
      ownerToken ??= waiter.ownerToken;
    }
    return { matched, ownerToken };
  }

  private hasLateTraversal() {
    const now = Date.now();
    for (const waiter of [...this.lateWaiters]) {
      if (waiter.expiresAt <= now) this.lateWaiters.delete(waiter);
    }
    return this.lateWaiters.size > 0;
  }

  private accepts(accept: PopWaiter['accept'], marker: HeroMarker | null, href: string) {
    try {
      return accept(marker, href);
    } catch {
      return false;
    }
  }

  private isStableForWrite() {
    return this.queuedTransactions === 0 && this.waiters.size === 0 && !this.hasLateTraversal();
  }

  private notifyStability() {
    this.stabilityListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // A stale observer cannot block the serialized history queue.
      }
    });
  }

  /** Bounded memory; the active token is always kept. */
  private trimRecords(preserveToken: string) {
    while (this.records.size > MAX_MEMORY_RECORDS) {
      const oldest = this.records.keys().next().value as string | undefined;
      if (!oldest) break;
      if (oldest === preserveToken) {
        const current = this.records.get(oldest)!;
        this.records.delete(oldest);
        this.records.set(oldest, current);
        continue;
      }
      this.records.delete(oldest);
    }
  }
}

export const imageHeroHistory = new HeroHistoryDriver();
