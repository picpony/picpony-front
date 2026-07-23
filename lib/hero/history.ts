'use client';

import {
  findImageHeroThumbnail,
  normalizePathSearch,
} from './dom';
import type {
  HeroPhase,
  ImageHeroBackgroundLocation,
  ImageHeroSnapshot,
} from './state';

const HISTORY_STATE_KEY = '__picponyImageHero';
const HISTORY_ROUTE_TIMEOUT_MS = 4000;

type ImageHeroHistoryMarker = {
  version: 1;
  token: string;
  kind: 'base' | 'guard';
  imageId: number;
  detailHref: string;
  background: ImageHeroBackgroundLocation;
};

export type ImageHeroHistoryRecord = {
  token: string;
  imageId: number;
  detailHref: string;
  background: ImageHeroBackgroundLocation;
  snapshot: ImageHeroSnapshot;
};

type ImageHeroHistoryPosition = 'unknown' | 'background' | 'base' | 'guard';
export type ClosingHistoryOutcome = 'commit' | 'handled' | 'restore-detail';

type PendingHistoryCollapse = {
  expectedHref: string;
  token: string;
  finish: (collapsed: boolean) => void;
};

export type ImageHeroHistoryCallbacks = {
  getPhase: () => HeroPhase;
  interruptOpening: (navigationHandled: boolean) => void;
  closeFromHistory: (record: ImageHeroHistoryRecord) => void | Promise<void>;
  restoreFromHistory: (
    record: ImageHeroHistoryRecord,
    source: HTMLElement,
  ) => void | Promise<unknown>;
};

export function createImageHeroHistory(callbacks: ImageHeroHistoryCallbacks) {
  let historyNavigationListenerInstalled = false;
  let transitionPopStateHook: ((event: PopStateEvent) => void) | null = null;
  let pendingHistoryCollapsePromise: Promise<boolean> | null = null;
  let pendingHistoryCollapse: PendingHistoryCollapse | null = null;
  let imageHeroHistoryRecord: ImageHeroHistoryRecord | null = null;
  let imageHeroHistoryPosition: ImageHeroHistoryPosition = 'unknown';
  let closingHistoryRestoreRequested = false;
  let notifyClosingHistoryRestore: (() => void) | null = null;

  const readImageHeroHistoryMarker = (state: unknown): ImageHeroHistoryMarker | null => {
    if (!state || typeof state !== 'object') return null;
    const value = (state as Record<string, unknown>)[HISTORY_STATE_KEY];
    if (!value || typeof value !== 'object') return null;
    const marker = value as Partial<ImageHeroHistoryMarker>;
    if (
      marker.version !== 1 ||
      typeof marker.token !== 'string' ||
      (marker.kind !== 'base' && marker.kind !== 'guard') ||
      typeof marker.imageId !== 'number' ||
      typeof marker.detailHref !== 'string' ||
      !marker.background ||
      typeof marker.background.pathname !== 'string' ||
      typeof marker.background.search !== 'string'
    ) {
      return null;
    }
    return marker as ImageHeroHistoryMarker;
  };

  const currentImageHeroHistoryMarker = () =>
    readImageHeroHistoryMarker(window.history.state);

  const isCurrentImageHeroHistoryMarker = (
    marker: ImageHeroHistoryMarker | null,
    kind?: ImageHeroHistoryMarker['kind'],
  ) => Boolean(
    marker &&
    imageHeroHistoryRecord &&
    marker.token === imageHeroHistoryRecord.token &&
    (!kind || marker.kind === kind),
  );

  const installGuard = (
    value: ImageHeroSnapshot,
    backgroundLocation: ImageHeroBackgroundLocation | null,
  ) => {
    if (!backgroundLocation || !/^\/pic\/[^/]+\/?$/.test(window.location.pathname)) return;
    const detailHref = `${window.location.pathname}${window.location.search}`;
    const token = `${value.image.id}:${value.createdAt}:${Math.random().toString(36).slice(2)}`;
    const shared = {
      version: 1 as const,
      token,
      imageId: value.image.id,
      detailHref,
      background: backgroundLocation,
    };
    const state = window.history.state && typeof window.history.state === 'object'
      ? window.history.state as Record<string, unknown>
      : {};
    const baseMarker: ImageHeroHistoryMarker = { ...shared, kind: 'base' };
    window.history.replaceState({ ...state, [HISTORY_STATE_KEY]: baseMarker }, '', window.location.href);
    const guardState = window.history.state && typeof window.history.state === 'object'
      ? window.history.state as Record<string, unknown>
      : state;
    const guardMarker: ImageHeroHistoryMarker = { ...shared, kind: 'guard' };
    window.history.pushState({ ...guardState, [HISTORY_STATE_KEY]: guardMarker }, '', window.location.href);
    imageHeroHistoryRecord = {
      token,
      imageId: value.image.id,
      detailHref,
      background: backgroundLocation,
      snapshot: value,
    };
    imageHeroHistoryPosition = 'guard';
  };

  const commitBack = (fallback: () => void) => {
    const marker = currentImageHeroHistoryMarker();
    if (isCurrentImageHeroHistoryMarker(marker, 'guard')) {
      imageHeroHistoryPosition = 'background';
      window.history.go(-2);
      return;
    }
    if (isCurrentImageHeroHistoryMarker(marker, 'base')) {
      imageHeroHistoryPosition = 'background';
      window.history.back();
      return;
    }
    fallback();
  };

  const resolveClosingOutcome = (
    imageId: number,
    popStateCount: number,
  ): ClosingHistoryOutcome => {
    if (closingHistoryRestoreRequested) return 'restore-detail';
    if (popStateCount === 0) return 'commit';
    const marker = currentImageHeroHistoryMarker();
    if (isCurrentImageHeroHistoryMarker(marker, 'base')) return 'commit';
    if (isCurrentImageHeroHistoryMarker(marker, 'guard')) return 'restore-detail';
    // Query parameters and a server-normalized trailing slash are not part of
    // the image route identity. Treat either form as still being on detail so
    // a failed/late popstate can restore the route instead of clearing it.
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    return pathname === `/pic/${imageId}`
      ? 'restore-detail'
      : 'handled';
  };

  const restoreGuard = (record: ImageHeroHistoryRecord) => {
    const marker = currentImageHeroHistoryMarker();
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (
      imageHeroHistoryPosition !== 'base' ||
      !marker ||
      marker.kind !== 'base' ||
      marker.token !== record.token ||
      currentHref !== record.detailHref
    ) {
      return;
    }
    imageHeroHistoryPosition = 'guard';
    window.history.forward();
  };

  const restoreFromHistory = async (record: ImageHeroHistoryRecord) => {
    const source = findImageHeroThumbnail(record.imageId, record.snapshot.sourceKey);
    if (source?.isConnected) {
      await callbacks.restoreFromHistory(record, source);
    }
    restoreGuard(record);
  };

  const handleImageHeroHistoryNavigation = (event: PopStateEvent) => {
    const previousPosition = imageHeroHistoryPosition;
    const marker = readImageHeroHistoryMarker(event.state);
    imageHeroHistoryPosition = marker?.kind ?? 'background';
    const record = imageHeroHistoryRecord;
    if (!marker || marker.kind !== 'base') return;

    if (!record || marker.token !== record.token) {
      // A reload can leave same-URL base/guard entries without the in-memory
      // frame needed by Hero. Continue to the true background entry.
      if (previousPosition === 'guard') {
        imageHeroHistoryPosition = 'background';
        window.history.back();
      }
      return;
    }

    if (
      callbacks.getPhase() === 'closing' &&
      previousPosition === 'background' &&
      marker.kind === 'base'
    ) {
      closingHistoryRestoreRequested = true;
      notifyClosingHistoryRestore?.();
      return;
    }

    if (previousPosition === 'guard') {
      if (callbacks.getPhase() === 'opening') {
        callbacks.interruptOpening(true);
        return;
      }
      if (callbacks.getPhase() !== 'idle') return;
      void callbacks.closeFromHistory(record);
      return;
    }

    if (previousPosition === 'background' || previousPosition === 'unknown') {
      if (callbacks.getPhase() !== 'idle') return;
      void restoreFromHistory(record);
    }
  };

  const dispatchImageHeroPopState = (event: PopStateEvent) => {
    const collapse = pendingHistoryCollapse;
    if (
      collapse &&
      normalizePathSearch(window.location.href) === collapse.expectedHref
    ) {
      const marker = readImageHeroHistoryMarker(event.state);
      if (!marker || marker.token !== collapse.token) {
        // Skip Hero's handlers for the exact gallery landing, but keep the
        // event propagating so Next can reconcile its parallel route slot.
        collapse.finish(true);
        return;
      }
    }
    handleImageHeroHistoryNavigation(event);
    transitionPopStateHook?.(event);
  };

  const ensureListener = () => {
    if (historyNavigationListenerInstalled) return;
    historyNavigationListenerInstalled = true;
    window.addEventListener('popstate', dispatchImageHeroPopState, { capture: true });
  };

  const collapseSuperseded = (): Promise<boolean> => {
    if (pendingHistoryCollapsePromise) return pendingHistoryCollapsePromise;
    const marker = currentImageHeroHistoryMarker();
    if (!marker || !isCurrentImageHeroHistoryMarker(marker)) return Promise.resolve(false);
    const steps = marker.kind === 'guard' ? 2 : marker.kind === 'base' ? 1 : 0;
    if (steps === 0) return Promise.resolve(false);

    let timeout = 0;
    const promise = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (collapsed: boolean) => {
        if (settled) return;
        settled = true;
        if (timeout) window.clearTimeout(timeout);
        if (pendingHistoryCollapse?.finish === finish) pendingHistoryCollapse = null;
        if (pendingHistoryCollapsePromise === promise) pendingHistoryCollapsePromise = null;
        if (collapsed) {
          imageHeroHistoryPosition = 'background';
          imageHeroHistoryRecord = null;
        }
        resolve(collapsed);
      };

      pendingHistoryCollapse = {
        expectedHref: normalizePathSearch(
          `${marker.background.pathname}${marker.background.search}`,
        ),
        token: marker.token,
        finish,
      };
      imageHeroHistoryPosition = 'background';
      timeout = window.setTimeout(() => finish(false), HISTORY_ROUTE_TIMEOUT_MS);
      window.history.go(-steps);
    });
    pendingHistoryCollapsePromise = promise;
    return promise;
  };

  const initialize = () => {
    ensureListener();
    const marker = currentImageHeroHistoryMarker();
    imageHeroHistoryPosition = marker?.kind ?? 'background';
  };

  const registerTransitionPopStateHook = (
    hook: (event: PopStateEvent) => void,
  ) => {
    transitionPopStateHook = hook;
    return () => {
      if (transitionPopStateHook === hook) transitionPopStateHook = null;
    };
  };

  const resetClosingRestoreRequested = () => {
    closingHistoryRestoreRequested = false;
  };

  const createClosingRestoreWaiter = () => {
    let resolveRestore!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolveRestore = resolve;
      notifyClosingHistoryRestore = resolve;
    });
    return {
      promise,
      dispose() {
        if (notifyClosingHistoryRestore === resolveRestore) {
          notifyClosingHistoryRestore = null;
        }
      },
    };
  };

  return {
    initialize,
    ensureListener,
    installGuard,
    commitBack,
    collapseSuperseded,
    resolveClosingOutcome,
    restoreCurrentGuard() {
      if (imageHeroHistoryRecord) restoreGuard(imageHeroHistoryRecord);
    },
    registerTransitionPopStateHook,
    resetClosingRestoreRequested,
    isClosingRestoreRequested: () => closingHistoryRestoreRequested,
    createClosingRestoreWaiter,
  };
}
