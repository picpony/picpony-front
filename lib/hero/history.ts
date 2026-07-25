'use client';

import type {
  ImageHeroBackgroundLocation,
  ImageHeroSnapshot,
} from './types';

const HISTORY_STATE_KEY = '__picponyImageHero';
const HISTORY_TIMEOUT_MS = 4000;
const LATE_POP_TTL_MS = 12000;
const MAX_MEMORY_RECORDS = 4;

type StableHistoryRole = 'base' | 'guard';
type HistoryRole = 'provisional' | StableHistoryRole;
type HistoryPosition = 'background' | HistoryRole | 'unknown';

type HistoryMarkerV1 = {
  version: 1;
  token: string;
  kind: StableHistoryRole;
  imageId: number;
  detailHref: string;
  background: ImageHeroBackgroundLocation;
};

export type HistoryMarkerV2 = {
  version: 2;
  token: string;
  role: HistoryRole;
  sessionId: number;
  imageId: number;
  detailHref: string;
  background: ImageHeroBackgroundLocation;
  backgroundDepth?: 1 | 2;
};

type AnyHistoryMarker = HistoryMarkerV1 | HistoryMarkerV2;

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
  marker: AnyHistoryMarker | null;
  record: HeroHistoryRecord | null;
  programmatic: boolean;
  programmaticToken: string | null;
  late: boolean;
  href: string;
};

type PopWaiter = {
  accept: (marker: AnyHistoryMarker | null, href: string) => boolean;
  ownerToken: string | null;
  finish: (matched: boolean) => void;
};

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

function isBackground(value: unknown): value is ImageHeroBackgroundLocation {
  if (!value || typeof value !== 'object') return false;
  const location = value as Partial<ImageHeroBackgroundLocation>;
  return typeof location.pathname === 'string' && typeof location.search === 'string';
}

export function readHeroHistoryMarker(state: unknown): AnyHistoryMarker | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[HISTORY_STATE_KEY];
  if (!value || typeof value !== 'object') return null;
  const marker = value as Record<string, unknown>;
  const version = marker.version;
  const role = version === 1 ? marker.kind : marker.role;
  if (
    (version !== 1 && version !== 2) ||
    typeof marker.token !== 'string' ||
    (
      version === 1
        ? role !== 'base' && role !== 'guard'
        : role !== 'provisional' && role !== 'base' && role !== 'guard'
    ) ||
    typeof marker.imageId !== 'number' ||
    typeof marker.detailHref !== 'string' ||
    !isBackground(marker.background) ||
    (version === 2 && typeof marker.sessionId !== 'number')
  ) {
    return null;
  }
  return version === 1
    ? {
        version: 1,
        token: marker.token as string,
        kind: role as StableHistoryRole,
        imageId: marker.imageId as number,
        detailHref: marker.detailHref as string,
        background: marker.background as ImageHeroBackgroundLocation,
      }
    : {
        version: 2,
        token: marker.token as string,
        role: role as HistoryRole,
        sessionId: marker.sessionId as number,
        imageId: marker.imageId as number,
        detailHref: marker.detailHref as string,
        background: marker.background as ImageHeroBackgroundLocation,
        backgroundDepth: marker.backgroundDepth === 2 ? 2 : 1,
      };
}

function markerRole(marker: AnyHistoryMarker | null): HistoryRole | null {
  if (!marker) return null;
  return marker.version === 1 ? marker.kind : marker.role;
}

function stateWithMarker(marker: HistoryMarkerV2) {
  const current = window.history.state;
  const state = current && typeof current === 'object'
    ? current as Record<string, unknown>
    : {};
  return { ...state, [HISTORY_STATE_KEY]: marker };
}

function createToken(sessionId: number, imageId: number) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `v2:${sessionId}:${imageId}:${suffix}`;
}

class HeroHistoryDriver {
  private initialized = false;
  private listener: ((navigation: HeroHistoryNavigation) => void) | null = null;
  private position: HistoryPosition = 'unknown';
  private records = new Map<string, HeroHistoryRecord>();
  private activeRecord: HeroHistoryRecord | null = null;
  private waiters = new Set<PopWaiter>();
  private lateWaiters = new Set<LatePopWaiter>();
  private provisionalTokens = new Set<string>();
  private transaction: Promise<unknown> = Promise.resolve();
  private queuedTransactions = 0;
  private stabilityListeners = new Set<() => void>();

  initialize(listener: (navigation: HeroHistoryNavigation) => void) {
    this.listener = listener;
    if (!this.initialized) {
      this.initialized = true;
      window.addEventListener('popstate', this.handlePopState, { capture: true });
      const marker = readHeroHistoryMarker(window.history.state);
      this.position = markerRole(marker) ?? 'background';
    }
    return () => {
      if (this.listener === listener) this.listener = null;
    };
  }

  currentPosition() {
    return this.position;
  }

  currentMarker() {
    return readHeroHistoryMarker(window.history.state);
  }

  currentRole() {
    return markerRole(this.currentMarker());
  }

  isGuard(record: HeroHistoryRecord) {
    const marker = this.currentMarker();
    return Boolean(
      marker &&
      marker.token === record.token &&
      markerRole(marker) === 'guard' &&
      normalizeHref(window.location.href) === record.detailHref &&
      !this.hasLateTraversal(),
    );
  }

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

  currentRecord() {
    const marker = this.currentMarker();
    return marker ? this.recordForToken(marker.token) : this.activeRecord;
  }

  recordForToken(token: string) {
    return this.records.get(token) ?? null;
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

  claim(record: HeroHistoryRecord) {
    if (!this.isStableForWrite()) return false;
    const expected = normalizeHref(
      `${record.background.pathname}${record.background.search}`,
    );
    if (normalizeHref(window.location.href) !== expected) return false;
    const current = this.currentMarker();
    const reuseCurrent = markerRole(current) === 'provisional' || (
      !current && this.position === 'provisional'
    );
    if (current && !reuseCurrent) return false;
    const marker: HistoryMarkerV2 = {
      version: 2,
      token: record.token,
      role: 'provisional',
      sessionId: record.sessionId,
      imageId: record.imageId,
      detailHref: record.detailHref,
      background: record.background,
      backgroundDepth: 2,
    };
    try {
      // This same-URL entry is a synchronous browser Back barrier while the
      // App Router is still preparing its asynchronous route commit.
      if (reuseCurrent) {
        if (current) this.provisionalTokens.delete(current.token);
        window.history.replaceState(stateWithMarker(marker), '', window.location.href);
      } else {
        window.history.pushState(stateWithMarker(marker), '', window.location.href);
      }
    } catch {
      return false;
    }
    this.records.set(record.token, record);
    record.backgroundDepth = 2;
    this.activeRecord = record;
    this.provisionalTokens.add(record.token);
    this.position = 'provisional';
    this.trimRecords(record.token);
    return true;
  }

  install(record: HeroHistoryRecord) {
    if (!this.isStableForWrite()) return false;
    if (normalizeHref(window.location.href) !== record.detailHref) return false;
    const shared = {
      version: 2 as const,
      token: record.token,
      sessionId: record.sessionId,
      imageId: record.imageId,
      detailHref: record.detailHref,
      background: record.background,
      backgroundDepth: record.backgroundDepth,
    };
    const base: HistoryMarkerV2 = { ...shared, role: 'base' };
    try {
      window.history.replaceState(stateWithMarker(base), '', window.location.href);
      const guard: HistoryMarkerV2 = { ...shared, role: 'guard' };
      window.history.pushState(stateWithMarker(guard), '', window.location.href);
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

  ensureBackground(record: HeroHistoryRecord) {
    return this.enqueue(async () => {
      const expectedHref = normalizeHref(
        `${record.background.pathname}${record.background.search}`,
      );
      const currentHref = normalizeHref(window.location.href);
      const current = this.currentMarker();
      const ownsUnmarkedProvisional = !current &&
        this.position === 'provisional' &&
        this.provisionalTokens.has(record.token);
      if (currentHref === expectedHref && !current && !ownsUnmarkedProvisional) {
        this.position = 'background';
        return true;
      }
      if (this.hasLateTraversal()) return false;
      if (current && current.token !== record.token) return false;

      const role = markerRole(current) ?? (ownsUnmarkedProvisional ? 'provisional' : null);
      const routedProvisional = role === 'provisional' && currentHref === record.detailHref;
      const steps = role === 'guard'
        ? -(record.backgroundDepth + 1)
        : role === 'base'
          ? -record.backgroundDepth
          : role === 'provisional'
            ? routedProvisional ? -2 : -1
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

  returnUnmarkedToBackground(
    background: ImageHeroBackgroundLocation,
    ownerToken: string | null = null,
  ) {
    return this.enqueue(async () => {
      const expected = normalizeHref(`${background.pathname}${background.search}`);
      if (normalizeHref(window.location.href) === expected) {
        this.position = 'background';
        return true;
      }
      if (this.hasLateTraversal()) return false;
      if (this.currentMarker()) return false;
      const confirmed = await this.goAndConfirm(
        -1,
        (marker, href) => !marker && href === expected,
        ownerToken,
      );
      if (confirmed) this.position = 'background';
      return confirmed;
    });
  }

  recoverSkippedBackground(record: HeroHistoryRecord) {
    return this.enqueue(async () => {
      const expected = normalizeHref(
        `${record.background.pathname}${record.background.search}`,
      );
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

  restoreGuard(record: HeroHistoryRecord) {
    return this.enqueue(async () => {
      if (this.hasLateTraversal()) return false;
      let marker = this.currentMarker();
      if (!marker || marker.token !== record.token) {
        const expectedBackground = normalizeHref(
          `${record.background.pathname}${record.background.search}`,
        );
        if (normalizeHref(window.location.href) !== expectedBackground) return false;
        const restoredBase = await this.goAndConfirm(
          record.backgroundDepth,
          (next) => next?.token === record.token && markerRole(next) === 'base',
          record.token,
        );
        if (!restoredBase) return false;
        marker = this.currentMarker();
      }
      if (!marker || marker.token !== record.token) return false;
      if (markerRole(marker) === 'guard') {
        this.position = 'guard';
        return true;
      }
      if (markerRole(marker) !== 'base') return false;

      const restored = await this.goAndConfirm(
        1,
        (next) => next?.token === record.token && markerRole(next) === 'guard',
        record.token,
      );
      if (restored) {
        this.position = 'guard';
        return true;
      }

      // A timed-out history.go(1) may still arrive. Pushing another guard in
      // that indeterminate window would permanently duplicate the guard pair.
      if (this.hasLateTraversal()) return false;

      const stillBase = this.currentMarker();
      if (
        !stillBase ||
        stillBase.token !== record.token ||
        markerRole(stillBase) !== 'base' ||
        normalizeHref(window.location.href) !== record.detailHref
      ) {
        return false;
      }
      const guard: HistoryMarkerV2 = {
        version: 2,
        token: record.token,
        role: 'guard',
        sessionId: record.sessionId,
        imageId: record.imageId,
        detailHref: record.detailHref,
        background: record.background,
        backgroundDepth: record.backgroundDepth,
      };
      window.history.pushState(stateWithMarker(guard), '', window.location.href);
      this.position = 'guard';
      return true;
    });
  }

  collapseLegacyMarker(marker: AnyHistoryMarker) {
    return this.enqueue(async () => {
      if (this.hasLateTraversal()) return false;
      const role = markerRole(marker);
      const depth = marker.version === 2 && marker.backgroundDepth === 2 ? 2 : 1;
      const steps = role === 'guard'
        ? -(depth + 1)
        : role === 'base'
          ? -depth
          : role === 'provisional'
            ? -1
            : 0;
      if (!steps) return false;
      const expected = normalizeHref(
        `${marker.background.pathname}${marker.background.search}`,
      );
      return this.goAndConfirm(
        steps,
        (next, href) => href === expected && !next,
        marker.token,
      );
    });
  }

  reconcileLocation() {
    const marker = this.currentMarker();
    const href = normalizeHref(window.location.href);
    this.consumeLateTraversal(marker, href);
    this.position = markerRole(marker) ?? 'background';
    if (marker) {
      this.activeRecord = this.records.get(marker.token) ?? this.activeRecord;
    }
    return {
      marker,
      position: this.position,
      href,
      stable: this.isStableForWrite(),
    };
  }

  private enqueue(work: () => Promise<boolean>) {
    this.queuedTransactions += 1;
    const run = this.transaction.then(work, work).catch(() => false);
    const observed = run.then(
      (value) => {
        this.queuedTransactions = Math.max(0, this.queuedTransactions - 1);
        this.notifyStability();
        return value;
      },
      () => {
        this.queuedTransactions = Math.max(0, this.queuedTransactions - 1);
        this.notifyStability();
        return false;
      },
    );
    this.transaction = observed.then(() => undefined, () => undefined);
    return observed;
  }

  private goAndConfirm(
    delta: number,
    accept: (marker: AnyHistoryMarker | null, href: string) => boolean,
    ownerToken: string | null,
  ) {
    return new Promise<boolean>((resolve) => {
      let timeout = 0;
      let settled = false;
      const waiter: PopWaiter = {
        accept,
        ownerToken,
        finish: (matched) => {
          if (settled) return;
          settled = true;
          if (timeout) window.clearTimeout(timeout);
          this.waiters.delete(waiter);
          resolve(matched);
        },
      };
      this.waiters.add(waiter);
      timeout = window.setTimeout(() => {
        const marker = this.currentMarker();
        const href = normalizeHref(window.location.href);
        const matched = this.accepts(accept, marker, href);
        if (!matched) {
          this.lateWaiters.add({
            accept,
            ownerToken,
            expiresAt: Date.now() + LATE_POP_TTL_MS,
          });
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
    const previous = this.position;
    const marker = readHeroHistoryMarker(event.state);
    const href = normalizeHref(window.location.href);
    this.position = markerRole(marker) ?? 'background';
    const lateTokens = this.consumeLateTraversal(marker, href);
    let programmatic = lateTokens.matched;
    let programmaticToken = lateTokens.ownerToken;

    for (const waiter of [...this.waiters]) {
      if (!this.accepts(waiter.accept, marker, href)) continue;
      programmatic = true;
      programmaticToken ??= waiter.ownerToken;
      waiter.finish(true);
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
        late: lateTokens.matched,
        href,
      });
    } catch {
      // A route listener is advisory; history bookkeeping must stay usable.
    }
    this.notifyStability();
  };

  private consumeLateTraversal(marker: AnyHistoryMarker | null, href: string) {
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

  private accepts(
    accept: PopWaiter['accept'],
    marker: AnyHistoryMarker | null,
    href: string,
  ) {
    try {
      return accept(marker, href);
    } catch {
      return false;
    }
  }

  private isStableForWrite() {
    return (
      this.queuedTransactions === 0 &&
      this.waiters.size === 0 &&
      !this.hasLateTraversal()
    );
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

export function normalizeHeroHref(href: string) {
  return normalizeHref(href);
}
