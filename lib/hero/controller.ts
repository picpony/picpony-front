'use client';

import {
  HERO_BACKGROUND_VISUAL_SELECTOR,
  HERO_INPUT_TRANSFER_QUIET_MS,
  HERO_ROUTE_TIMEOUT_MS,
  SNAPSHOT_TTL,
} from './constants';
import { getHeroBackgroundSinkTransform } from './geometry';
import {
  getElementScrollPlane,
  getGalleryScrollPlane,
  heroFrameScheduler,
  initializeHeroFrameRuntime,
  hasActiveHeroInput,
  isHeroInteractionQuiet,
  subscribeHeroInteraction,
  subscribeHeroViewportInvalidation,
  waitForHeroInteractionQuiet,
  waitForHeroInputRelease,
} from './anchor';
import {
  findImageHeroThumbnail,
  getHeroRect,
  getHeroRectWithoutAncestorTransform,
  getVisualMedia,
  leaseAttribute,
  leaseHeroCardChrome,
  leaseHeroRouteSealed,
  leaseHeroVisibility,
  leaseInlineStyles,
  type DomLease,
} from './dom';
import { captureHeroFrame } from './frameCache';
import {
  imageHeroHistory,
  normalizeHeroHref,
  type HeroHistoryNavigation,
  type HeroHistoryRecord,
} from './history';
import { bindHeroDismissGesture, type HeroPullSample } from './gestures';
import {
  clearInactiveHeroBackground,
  createHeroFlight,
  HeroMotion,
} from './motion';
import { HeroScrollContinuity } from './scroll';
import type {
  HeroCloseIntent,
  HeroCloseNavigation,
  HeroControllerPhase,
  HeroDetailRouteChangeIntent,
  HeroMilestone,
  HeroOpenIntent,
  HeroOpenNavigation,
  HeroRouteRegistration,
  HeroStageNodes,
  ImageHeroBackgroundLocation,
  ImageHeroCloseOutcome,
  ImageHeroRuntimeState,
  ImageHeroSnapshot,
  ImageHeroStageState,
} from './types';

type Disposer = () => void;

class ResourceScope {
  private disposers = new Set<Disposer>();
  private disposed = false;

  add(value: Disposer | DomLease | null | undefined) {
    if (!value) return value;
    const dispose = typeof value === 'function' ? value : value.release;
    if (this.disposed) {
      try {
        dispose();
      } catch {
        // A late resource is already outside the active session.
      }
    } else this.disposers.add(dispose);
    return value;
  }

  release(value: Disposer | DomLease | null | undefined) {
    if (!value) return;
    const dispose = typeof value === 'function' ? value : value.release;
    if (!this.disposers.delete(dispose)) return;
    try {
      dispose();
    } catch {
      // Resource release is best-effort for DOM that disconnected mid-frame.
    }
  }

  take(value: Disposer | DomLease | null | undefined) {
    if (!value) return false;
    const dispose = typeof value === 'function' ? value : value.release;
    return this.disposers.delete(dispose);
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
        // A disconnected route must not prevent the rest of a session cleanup.
      }
    });
  }
}

type RegisteredRoute = HeroRouteRegistration & {
  epoch: number;
  href: string;
  seal: DomLease | null;
  sealOwner: symbol | null;
  interaction: DomLease | null;
  interactionOwner: symbol | null;
  targetSeal: RouteTargetSeal | null;
  pull: RoutePullState | null;
};

type RouteTargetSeal = DomLease & {
  owner: symbol;
  refresh: () => void;
};

type RoutePullState = {
  owner: symbol;
  thumbnailVisual: DomLease | null;
  animations: Set<Animation>;
  resetEpoch: number;
  contentTransform: string;
  contentWillChange: string;
  reveal: Array<{ element: HTMLElement; opacity: string; willChange: string }>;
  surfaceOpacity: string;
  surfaceWillChange: string;
  backOpacity: string;
  backWillChange: string;
  backgroundTransform: string;
  backgroundOrigin: string;
  backgroundWillChange: string;
};

type OpeningPullVisualState = {
  contentTransform: string;
  contentWillChange: string;
  reveal: Array<{ element: HTMLElement; opacity: string; willChange: string }>;
  surfaceOpacity: string;
  surfaceWillChange: string;
  backOpacity: string;
  backWillChange: string;
  animations: Set<Animation>;
  resetEpoch: number;
};

type OpeningScrollBridge = {
  addTarget: (scroller: HTMLElement, content?: HTMLElement) => void;
  sync: () => void;
  returnToGallery: (scroller: HTMLElement) => void;
  release: () => void;
};

type OpeningSession = HeroSession & {
  kind: 'opening';
  intent: HeroOpenIntent;
  skipFlight: boolean;
  sourceRect: ReturnType<typeof getHeroRect>;
  record: HeroHistoryRecord;
  routeFloor: number;
  routeNavigationStarted: boolean;
  provisionalClaimed: boolean;
  historyRestore: boolean;
  collapseRecord: HeroHistoryRecord | null;
  collapsePromise: Promise<boolean> | null;
  previousRoute: RegisteredRoute | null;
  previousRouteScroll: { left: number; top: number } | null;
  scrollBridge: OpeningScrollBridge | null;
  handoffRoute: RegisteredRoute | null;
  handoffVisual: DomLease | null;
  handoffCommitted: boolean;
  allowExistingRoute: boolean;
  backgroundRecovery: Promise<boolean> | null;
};

type ClosingSession = HeroSession & {
  kind: 'closing';
  intent: HeroCloseIntent;
  record: HeroHistoryRecord;
  route: RegisteredRoute;
  thumbnail: HTMLElement;
  closePromise: Promise<ImageHeroCloseOutcome>;
  resolveClose: ((outcome: ImageHeroCloseOutcome) => void) | null;
  retirement: Promise<void> | null;
  routeScroll: { left: number; top: number };
};

type HeroSession = {
  id: number;
  owner: symbol;
  kind: 'opening' | 'closing';
  snapshot: ImageHeroSnapshot;
  abort: AbortController;
  shared: ResourceScope;
  visual: ResourceScope;
  motion: HeroMotion | null;
  scrollContinuity: HeroScrollContinuity | null;
  retired: boolean;
  reversing: boolean;
  pullSeized: boolean;
};

type WaitOptions<T> = {
  read: () => T | null;
  signal?: AbortSignal;
  timeout?: number;
};

type ScheduledFrameTask<T> = {
  read: () => T;
  write: (value: T) => void;
};

const EMPTY_STAGE: ImageHeroStageState = {
  phase: 'idle',
  snapshot: null,
  sessionId: null,
};

const INITIAL_RUNTIME: ImageHeroRuntimeState = {
  phase: 'gallery-idle',
  sessionId: null,
  imageId: null,
  stage: EMPTY_STAGE,
  interactionQuiet: true,
  background: null,
};

function backgroundHref(background: ImageHeroBackgroundLocation) {
  return `${background.pathname}${background.search}`;
}

function currentBackground(): ImageHeroBackgroundLocation {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

function defaultNavigation(): HeroOpenNavigation & HeroCloseNavigation {
  return {
    push(href) {
      window.location.assign(href);
    },
    replace(href) {
      window.location.replace(href);
    },
  };
}

function clearBackgroundVisual() {
  const background = document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR);
  clearInactiveHeroBackground(background);
}

function combineDomLeases(...leases: Array<DomLease | null | undefined>): DomLease {
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      for (let index = leases.length - 1; index >= 0; index -= 1) {
        leases[index]?.release();
      }
    },
  };
}

function getGalleryLandingRect(element: HTMLElement) {
  const background = document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR);
  return getHeroRectWithoutAncestorTransform(element, background);
}

export class HeroController {
  private initialized = false;
  private sessionSequence = 0;
  private surfaceSequence = 0;
  private routeEpoch = 0;
  private runtime = INITIAL_RUNTIME;
  private runtimeListeners = new Set<() => void>();
  private eventListeners = new Set<() => void>();
  private routes = new Map<string, RegisteredRoute>();
  private stage: { sessionId: number; nodes: HeroStageNodes } | null = null;
  private retainedStageVisuals = new Map<number, DomLease>();
  private foreground: OpeningSession | ClosingSession | null = null;
  private retiring: HeroSession | null = null;
  private terminalSessions = new Set<number>();
  private sessionMilestones = new Map<number, Set<HeroMilestone>>();
  private pendingOpen: HeroOpenIntent | null = null;
  private detailRouteChange: Promise<boolean> | null = null;
  private detailRouteAbort: AbortController | null = null;
  private pendingDetailRouteChange: HeroDetailRouteChangeIntent | null = null;
  private routeChangeSequence = 0;
  private readonly idleRouteOwner = Symbol('hero-route-idle');
  private detailRecord: HeroHistoryRecord | null = null;
  private currentSnapshot: ImageHeroSnapshot | null = null;
  private observedHref = '';
  private router: (HeroOpenNavigation & HeroCloseNavigation) | null = null;
  private releaseHistory: Disposer | null = null;
  private releaseInteraction: Disposer | null = null;
  private releaseViewport: Disposer | null = null;
  private readonly viewportFrameOwner = {};
  private lifecycleAbort = new AbortController();

  initialize(router?: HeroOpenNavigation & HeroCloseNavigation) {
    if (router) this.router = router;
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;
    initializeHeroFrameRuntime();
    this.observedHref = normalizeHeroHref(window.location.href);
    this.releaseHistory = imageHeroHistory.initialize(this.handleHistoryNavigation);
    this.releaseInteraction = subscribeHeroInteraction(() => {
      this.updateRuntime({ interactionQuiet: isHeroInteractionQuiet() });
      this.notifyEvent();
    });
    this.releaseViewport = subscribeHeroViewportInvalidation(this.handleViewportInvalidation);
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('pageshow', this.handlePageShow);
    this.reconcileIdleLocation();
  }

  connectRouter(router: HeroOpenNavigation & HeroCloseNavigation) {
    this.router = router;
    this.initialize(router);
  }

  getRuntime = () => this.runtime;

  subscribeRuntime = (listener: () => void) => {
    this.runtimeListeners.add(listener);
    return () => this.runtimeListeners.delete(listener);
  };

  getStage = () => this.runtime.stage;

  subscribeStage = (listener: () => void) => this.subscribeRuntime(listener);

  createSurfaceId(imageId: number) {
    return `hero-route:${imageId}:${++this.surfaceSequence}`;
  }

  registerStage(sessionId: number, nodes: HeroStageNodes) {
    if (this.runtime.stage.sessionId !== sessionId) return () => {};
    const registration = { sessionId, nodes };
    this.stage = registration;
    this.notifyEvent();
    return () => {
      if (this.stage !== registration) return;
      this.stage = null;
      this.releaseRetainedStageVisual(sessionId);
      this.notifyEvent();
    };
  }

  registerRoute(registration: HeroRouteRegistration) {
    this.initialize();
    const existing = this.routes.get(registration.surfaceId);
    if (existing) this.unregisterRoute(existing);
    const route: RegisteredRoute = {
      ...registration,
      epoch: ++this.routeEpoch,
      href: normalizeHeroHref(window.location.href),
      seal: null,
      sealOwner: null,
      interaction: null,
      interactionOwner: null,
      targetSeal: null,
      pull: null,
    };
    this.routes.set(route.surfaceId, route);

    const foreground = this.foreground;
    if (foreground?.kind === 'opening') {
      this.sealRoute(route, foreground.owner);
    } else if (this.runtime.phase === 'detail-idle') {
      const activeId = this.runtime.imageId;
      if (activeId !== null && route.imageId !== activeId) {
        this.sealRoute(route, this.idleRouteOwner);
      }
    } else {
      this.sealRoute(route, this.idleRouteOwner);
    }
    if (foreground?.kind === 'opening') {
      if (this.findOpeningRoute(foreground, false)) {
        this.recordSessionMilestone(foreground, 'route-registered');
      }
      if (this.findOpeningRoute(foreground, true)) {
        this.recordSessionMilestone(foreground, 'preview-paintable');
      }
    }
    this.notifyEvent();
    return () => this.unregisterRoute(route);
  }

  updateRouteTarget(surfaceId: string, target: HTMLElement | null) {
    const route = this.routes.get(surfaceId);
    if (!route) return;
    route.target = target;
    route.targetSeal?.refresh();
    this.notifyEvent();
  }

  markRoutePreviewPaintable(surfaceId: string, target?: HTMLElement | null) {
    const route = this.routes.get(surfaceId);
    if (!route) return;
    if (target) {
      route.target = target;
      route.targetSeal?.refresh();
    }
    route.previewPaintable = true;
    route.overlay.dataset.imageHeroPreview = 'paintable';
    const foreground = this.foreground;
    if (
      foreground?.kind === 'opening' &&
      this.findOpeningRoute(foreground, true)
    ) {
      this.recordSessionMilestone(foreground, 'preview-paintable');
    }
    this.notifyEvent();
  }

  observeRoute(href: string) {
    this.initialize();
    const normalized = normalizeHeroHref(href);
    if (normalized === this.observedHref) return;
    this.observedHref = normalized;
    this.routeEpoch += 1;
    this.notifyEvent();

    if (this.detailRouteChange) return;
    const foreground = this.foreground;
    if (!foreground) {
      this.reconcileIdleLocation();
      return;
    }
    if (foreground.kind === 'opening') {
      const expected = normalizeHeroHref(foreground.intent.detailHref);
      const background = normalizeHeroHref(backgroundHref(foreground.intent.background!));
      if (normalized === expected) return;
      if (normalized === background) {
        // A close-A/open-B handoff deliberately traverses to the gallery before
        // pushing B. Every other route observation of the opening background is
        // a user Back (including Safari's interactive edge swipe) and owns the
        // current flyer reverse even if popstate is delayed or coalesced.
        if (foreground.collapseRecord && !foreground.routeNavigationStarted) return;
        void this.reverseOpening(foreground, true);
        return;
      }
      void this.reverseOpening(foreground, true);
      return;
    }
    if (foreground.kind === 'closing') {
      const detail = foreground.record.detailHref;
      const background = normalizeHeroHref(backgroundHref(foreground.record.background));
      if (normalized === detail || normalized === background) return;
      this.abandonClosing(foreground);
    }
  }

  requestOpen(intent: HeroOpenIntent) {
    this.initialize();
    this.router = intent.navigation;
    if (!intent.snapshot.canAnimate || !intent.source.isConnected) return false;
    if (this.detailRouteChange) {
      this.pendingOpen = intent;
      const operation = this.detailRouteChange;
      void operation.then(() => undefined, () => undefined).then(() => {
        if (this.pendingOpen !== intent) return;
        this.pendingOpen = null;
        if (this.runtime.phase === 'gallery-idle') this.startOpening(intent);
      });
      return true;
    }
    const phase = this.runtime.phase;
    if (phase === 'opening.flight' || phase === 'opening.landed' || phase === 'opening.handoff') {
      const opening = this.foreground;
      if (opening?.kind === 'opening') {
        intent.background = opening.intent.background;
      }
      this.pendingOpen = intent;
      if (opening?.kind === 'opening' && !opening.reversing) {
        void this.reverseOpening(opening, false);
      }
      return true;
    }
    if (phase === 'reversing' || phase === 'recovering') {
      if (this.runtime.background) intent.background = this.runtime.background;
      this.pendingOpen = intent;
      return true;
    }
    if (phase === 'closing.flight') {
      const closing = this.foreground;
      if (closing?.kind !== 'closing') {
        this.pendingOpen = intent;
        return true;
      }
      const collapseRecord = closing.record;
      const previousRoute = closing.route;
      const previousRouteScroll = closing.routeScroll;
      const scrollContinuity = closing.scrollContinuity;
      closing.scrollContinuity = null;
      intent.background = collapseRecord.background;
      this.retireClosing(closing);
      this.startOpening(intent, {
        collapseRecord,
        previousRoute,
        previousRouteScroll,
        scrollContinuity,
      });
      return true;
    }
    if (phase !== 'gallery-idle') return false;
    this.startOpening(intent);
    return true;
  }

  requestClose(intent: HeroCloseIntent): Promise<ImageHeroCloseOutcome> {
    this.initialize();
    this.router = intent.navigation;
    if (this.detailRouteChange) {
      const routeChange = this.detailRouteChange;
      const retry = () => this.requestClose({
        ...intent,
        imageId: this.runtime.imageId ?? intent.imageId,
      });
      return routeChange.then(retry, retry);
    }
    const foreground = this.foreground;
    if (foreground?.kind === 'opening') {
      void this.reverseOpening(foreground, false);
      return Promise.resolve('handled');
    }
    if (foreground?.kind === 'closing') return foreground.closePromise;
    if (this.runtime.phase !== 'detail-idle') return Promise.resolve('handled');
    return this.startClosing(intent);
  }

  requestDetailRouteChange(intent: HeroDetailRouteChangeIntent): Promise<boolean> {
    this.initialize();
    this.router = intent.navigation;
    if (this.detailRouteChange) {
      this.pendingDetailRouteChange = intent;
      const active = this.detailRouteChange;
      return active.then(
        () => {
          if (this.pendingDetailRouteChange !== intent) return false;
          this.pendingDetailRouteChange = null;
          return this.requestDetailRouteChange(intent);
        },
        () => false,
      );
    }
    if (this.foreground || this.runtime.phase !== 'detail-idle') {
      return Promise.resolve(false);
    }

    const abort = new AbortController();
    this.detailRouteAbort = abort;
    const operation = this.runDetailRouteChange(intent, abort.signal).catch((error) => {
      console.error('[hero] detail route reconciliation failed', error);
      return false;
    });
    this.detailRouteChange = operation;
    this.notifyEvent();
    void operation.then(() => undefined, () => undefined).then(() => {
      if (this.detailRouteChange !== operation) return;
      this.detailRouteChange = null;
      if (this.detailRouteAbort === abort) this.detailRouteAbort = null;
      this.notifyEvent();
    });
    return operation;
  }

  interrupt(navigationHandled = false) {
    if (this.detailRouteChange) return false;
    const foreground = this.foreground;
    if (!foreground) return false;
    if (foreground.kind === 'opening') {
      void this.reverseOpening(foreground, navigationHandled);
      return true;
    }
    if (foreground.kind === 'closing') {
      void this.reverseClosing(foreground);
      return true;
    }
    return false;
  }

  bindRouteDismiss(
    surfaceId: string,
    canStart: () => boolean,
    navigation: HeroCloseNavigation,
  ) {
    const route = this.routes.get(surfaceId);
    if (!route) return () => {};
    const pullOwner = Symbol(`hero-pull:${surfaceId}`);
    return bindHeroDismissGesture({
      target: route.scroller,
      scroller: route.scroller,
      canStart: () => this.prepareRouteDismiss(route) && canStart(),
      onPull: (sample) => this.applyRoutePull(route, sample, pullOwner),
      onCancel: (sample) => this.resetRoutePull(route, sample, pullOwner),
      onCommit: () => {
        void this.requestClose({
          imageId: route.imageId,
          navigation,
          backgroundMode: 'continue',
          cause: 'dismiss',
        });
      },
    });
  }

  private prepareRouteDismiss(route: RegisteredRoute) {
    if (
      this.runtime.phase === 'opening.handoff' &&
      this.foreground?.kind === 'opening' &&
      this.foreground.handoffRoute === route
    ) {
      this.completeOpeningHandoff(this.foreground);
    }
    return this.runtime.phase === 'detail-idle' && this.runtime.imageId === route.imageId;
  }

  getOrigin(imageId: number) {
    const snapshot = this.currentSnapshot;
    if (!snapshot || snapshot.image.id !== imageId) return null;
    return Date.now() - snapshot.createdAt < SNAPSHOT_TTL ? snapshot : null;
  }

  getBackground() {
    return this.runtime.background ?? this.detailRecord?.background ?? null;
  }

  isRunning() {
    return Boolean(this.foreground || this.detailRouteChange);
  }

  getActiveKind() {
    return this.foreground?.kind ?? (this.detailRouteChange ? 'opening' : null);
  }

  canSupersedeClose() {
    return this.foreground?.kind === 'closing' && !this.foreground.reversing;
  }

  waitForIdle(signal?: AbortSignal) {
    return this.waitFor({
      signal,
      read: () => (
        this.foreground === null &&
        this.detailRouteChange === null &&
        (this.runtime.phase === 'gallery-idle' || this.runtime.phase === 'detail-idle')
      ) ? true : null,
    }).then(Boolean);
  }

  waitForMilestone(milestone: HeroMilestone, sessionId?: number, signal?: AbortSignal) {
    return this.waitFor({
      signal,
      read: () => {
        if (this.hasMilestone(milestone, sessionId)) return true;
        return sessionId !== undefined && this.terminalSessions.has(sessionId)
          ? false
          : null;
      },
    }).then(Boolean);
  }

  isPublicationQuiet() {
    // Once a Hero transaction has handed off, ordinary wheel/touch scrolling
    // must not hold detail data or the final media behind the transition gate.
    // The flight itself still waits on `waitForHeroInteractionQuiet`; this
    // predicate only gates publication after the route is stable.
    return !this.detailRouteChange && (
      this.runtime.phase === 'detail-idle' || this.runtime.phase === 'gallery-idle'
    );
  }

  isDetailDataPublishable(imageId: number) {
    if (this.detailRouteChange) return false;
    if (this.runtime.phase === 'gallery-idle') return true;
    if (this.runtime.phase === 'detail-idle') {
      return this.runtime.imageId === imageId;
    }
    return this.runtime.phase.startsWith('opening.') &&
      this.foreground?.kind === 'opening' &&
      this.foreground.snapshot.image.id === imageId;
  }

  diagnostics() {
    return {
      state: this.runtime,
      foreground: this.foreground ? {
        id: this.foreground.id,
        kind: this.foreground.kind,
        imageId: this.foreground.snapshot.image.id,
      } : null,
      retiring: this.retiring ? {
        id: this.retiring.id,
        kind: this.retiring.kind,
        imageId: this.retiring.snapshot.image.id,
      } : null,
      routes: [...this.routes.values()].map((route) => ({
        surfaceId: route.surfaceId,
        imageId: route.imageId,
        epoch: route.epoch,
        sealed: Boolean(route.seal),
        previewPaintable: route.previewPaintable,
      })),
      history: imageHeroHistory.reconcileLocation(),
    };
  }

  private async runDetailRouteChange(
    intent: HeroDetailRouteChangeIntent,
    signal: AbortSignal,
  ) {
    const sequence = ++this.routeChangeSequence;
    const record = this.detailRecord ?? imageHeroHistory.currentRecord();
    const currentImageId = this.runtime.imageId;
    const targetHref = normalizeHeroHref(intent.detailHref);
    if (signal.aborted) return false;
    if (normalizeHeroHref(window.location.href) !== this.observedHref) return false;
    if (
      currentImageId === intent.imageId &&
      normalizeHeroHref(window.location.href) === targetHref
    ) {
      return true;
    }

    if (!record || record.imageId !== currentImageId) {
      // An unowned detail route has no base/guard pair to reconcile. Preserve
      // the browser's ordinary in-place previous/next semantics.
      if (signal.aborted) return false;
      intent.navigation.replace(intent.detailHref);
      const observed = await this.waitFor({
        signal,
        timeout: HERO_ROUTE_TIMEOUT_MS,
        read: () => this.observedHref === targetHref ? true : null,
      });
      return Boolean(observed);
    }

    const currentRoute = this.findRouteByImage(record.imageId);
    const collapsed = await this.settleUnlessAborted(
      imageHeroHistory.ensureBackground(record),
      signal,
    );
    if (signal.aborted) return false;
    if (!collapsed || !this.isRecordBackground(record)) {
      const restored = await this.restoreGuardStrict(record);
      if (signal.aborted) return false;
      if (restored) {
        this.detailRecord = record;
        this.currentSnapshot = record.snapshot;
        if (currentRoute) this.revealRoute(currentRoute, currentRoute.sealOwner);
        this.setPhase('detail-idle', null, record.background, record.imageId);
      } else {
        if (currentRoute) this.sealRoute(currentRoute, this.idleRouteOwner);
        this.reconcileIdleLocation();
      }
      return false;
    }

    try {
      if (signal.aborted) return false;
      intent.navigation.replace(intent.detailHref);
    } catch {
      const restored = await this.restoreGuardStrict(record);
      if (restored) {
        if (currentRoute) this.revealRoute(currentRoute, currentRoute.sealOwner);
        this.detailRecord = record;
        this.currentSnapshot = record.snapshot;
        this.setPhase('detail-idle', null, record.background, record.imageId);
      } else {
        if (currentRoute) this.sealRoute(currentRoute, this.idleRouteOwner);
        this.reconcileIdleLocation();
      }
      return false;
    }
    this.sealRoutesExcept(null, this.idleRouteOwner);
    this.setPhase('recovering', null, record.background, record.imageId);
    const observed = await this.waitFor({
      signal,
      timeout: HERO_ROUTE_TIMEOUT_MS,
      read: () => this.observedHref === targetHref ? true : null,
    });
    if (!observed || signal.aborted || sequence !== this.routeChangeSequence) {
      const activeRoute = this.findRouteByImage(intent.imageId);
      if (activeRoute) this.revealRoute(activeRoute, activeRoute.sealOwner);
      this.reconcileIdleLocation();
      return false;
    }
    imageHeroHistory.forget(record);
    this.detailRecord = null;
    this.currentSnapshot = null;
    const route = this.findRouteByImage(intent.imageId);
    if (route) this.revealRoute(route, route.sealOwner);
    this.setPhase('detail-idle', null, record.background, intent.imageId);
    return true;
  }

  private startOpening(
    intent: HeroOpenIntent,
    options: {
      collapseRecord?: HeroHistoryRecord;
      previousRoute?: RegisteredRoute;
      historyRecord?: HeroHistoryRecord;
      provisionalClaimed?: boolean;
      routeNavigationStarted?: boolean;
      allowExistingRoute?: boolean;
      skipFlight?: boolean;
      previousRouteScroll?: { left: number; top: number };
      scrollContinuity?: HeroScrollContinuity | null;
    } = {},
  ) {
    const background = intent.background ?? this.runtime.background ?? currentBackground();
    intent.background = background;
    const id = ++this.sessionSequence;
    const record = options.historyRecord ?? imageHeroHistory.createRecord(
      intent.snapshot,
      background,
      intent.detailHref,
      id,
    );
    if (options.historyRecord) imageHeroHistory.remember(record);
    const session: OpeningSession = {
      id,
      owner: Symbol(`hero-opening:${id}`),
      kind: 'opening',
      snapshot: intent.snapshot,
      intent,
      skipFlight: Boolean(options.skipFlight),
      abort: new AbortController(),
      shared: new ResourceScope(),
      visual: new ResourceScope(),
      motion: null,
      scrollContinuity: options.scrollContinuity ?? null,
      retired: false,
      reversing: false,
      pullSeized: false,
      sourceRect: getHeroRect(intent.source),
      record,
      routeFloor: this.routeEpoch,
      routeNavigationStarted: options.routeNavigationStarted ?? Boolean(intent.historyRestore),
      provisionalClaimed: Boolean(options.provisionalClaimed),
      historyRestore: Boolean(intent.historyRestore),
      collapseRecord: options.collapseRecord ?? null,
      collapsePromise: null,
      previousRoute: options.previousRoute ?? null,
      previousRouteScroll: options.previousRouteScroll ?? null,
      scrollBridge: null,
      handoffRoute: null,
      handoffVisual: null,
      handoffCommitted: false,
      allowExistingRoute: Boolean(options.allowExistingRoute),
      backgroundRecovery: null,
    };
    if (!session.historyRestore && !session.collapseRecord && !session.provisionalClaimed) {
      session.provisionalClaimed = imageHeroHistory.claim(record);
    }
    this.foreground = session;
    this.sealRoutesExcept(null, session.owner);
    this.currentSnapshot = intent.snapshot;
    if (session.skipFlight) {
      this.setStage('idle', null);
      this.setPhase('recovering', session, background);
    } else {
      this.setStage('opening', session);
      this.setPhase('opening.flight', session, background);
    }
    void this.runOpening(session);
  }

  private async runOpening(session: OpeningSession) {
    const { intent } = session;
    try {
      let collapse: Promise<boolean> | null = null;
      if (session.collapseRecord) {
        collapse = imageHeroHistory.ensureBackground(session.collapseRecord);
        session.collapsePromise = collapse;
      } else if (!session.historyRestore && !session.routeNavigationStarted) {
        if (!session.provisionalClaimed) {
          await this.reverseOpening(session, false);
          return;
        }
        session.routeNavigationStarted = true;
        intent.navigation.push(intent.detailHref);
      }

      if (session.skipFlight) {
        await this.recoverOpeningWithoutFlight(session, collapse);
        return;
      }

      const stage = await this.waitFor<HeroStageNodes>({
        signal: session.abort.signal,
        timeout: 1000,
        read: () => this.stage?.sessionId === session.id ? this.stage.nodes : null,
      });
      if (!this.owns(session)) return;
      if (!stage) {
        await this.recoverOpeningWithoutFlight(session, collapse);
        return;
      }

      if (!intent.source.isConnected) {
        await this.recoverOpeningWithoutFlight(session, collapse);
        return;
      }
      const plane = getElementScrollPlane(stage.anchor, stage.scroller);
      const targetRect = getHeroRect(stage.target);
      const flight = createHeroFlight({
        asset: session.snapshot.previewFrame,
        treatment: intent.source,
        plane,
        from: session.sourceRect,
        to: targetRect,
        direction: 'forward',
        sessionId: session.id,
        imageId: session.snapshot.image.id,
      });
      session.visual.add(flight.release);
      session.visual.add(leaseHeroCardChrome(intent.source));
      session.visual.add(leaseHeroVisibility(intent.source, false));
      const background = document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR);
      const motion = new HeroMotion({
        flight,
        from: session.sourceRect,
        to: targetRect,
        direction: 'forward',
        background,
        overlay: stage.overlay,
        floatingBack: stage.floatingBack,
        continueBackground: Boolean(session.collapseRecord),
      });
      session.motion = motion;
      this.bindOpeningScroll(session, stage);
      this.bindOpeningDismiss(session, stage, background);

      await motion.landed;
      if (!this.owns(session)) return;
      this.recordSessionMilestone(session, 'landed');
      this.setStage('landed', session);
      this.setPhase('opening.landed', session, intent.background!);

      if (collapse) {
        const collapsed = await collapse;
        if (!this.owns(session)) return;
        if (!collapsed) {
          await this.failParallelOpen(session);
          return;
        }
        if (!await this.waitForRouterCommit(
          backgroundHref(session.collapseRecord!.background),
          session.abort.signal,
        )) {
          await this.failParallelOpen(session);
          return;
        }
        if (!this.owns(session)) return;
        imageHeroHistory.forget(session.collapseRecord!);
        session.routeFloor = this.routeEpoch;
        session.provisionalClaimed = imageHeroHistory.claim(session.record);
        if (!session.provisionalClaimed) {
          await this.failParallelOpen(session);
          return;
        }
        session.routeNavigationStarted = true;
        intent.navigation.push(intent.detailHref);
      }

      const routePromise = this.waitFor<RegisteredRoute>({
        signal: session.abort.signal,
        timeout: HERO_ROUTE_TIMEOUT_MS,
        read: () => this.findOpeningRoute(session, true),
      });
      const route = await routePromise;
      if (!this.owns(session)) return;
      if (!route) {
        await this.reverseOpening(session, false);
        return;
      }
      await this.handoffOpening(session, route, stage);
    } catch (error) {
      if (session.abort.signal.aborted || !this.owns(session)) return;
      console.error('[hero] opening transaction failed', error);
      await this.reverseOpening(session, false);
    }
  }

  private async handoffOpening(
    session: OpeningSession,
    route: RegisteredRoute,
    stage: HeroStageNodes,
  ) {
    if (!this.owns(session) || !session.motion) return;
    this.setPhase('opening.handoff', session, session.intent.background!);

    if (session.pullSeized) {
      const pullSettled = await this.waitFor({
        signal: session.abort.signal,
        read: () => session.pullSeized ? null : true,
      });
      if (!pullSettled || !this.owns(session) || !session.motion) return;
    }

    const historyReady = await this.establishOpeningGuard(session);
    if (!this.owns(session)) return;
    if (!historyReady) {
      await this.reverseOpening(session, false);
      return;
    }

    session.scrollBridge?.addTarget(route.scroller, route.content);
    session.scrollBridge?.sync();

    let routeRevealed = false;
    await this.runScheduledFrame(session, {
      read: () => stage.scroller.scrollTop,
      write: (scrollTop) => {
        if (!this.owns(session)) return;
        route.scroller.scrollTop = scrollTop;
        if (!this.revealRoute(route, session.owner)) return;
        session.handoffRoute = route;
        routeRevealed = true;
        const visual = combineDomLeases(
          leaseInlineStyles(stage.overlay, { pointerEvents: 'none' }),
          leaseInlineStyles(stage.scroller, { pointerEvents: 'none' }),
          leaseInlineStyles(stage.surface, { visibility: 'hidden' }),
          leaseInlineStyles(stage.content, { visibility: 'hidden' }),
          session.motion
            ? leaseInlineStyles(session.motion.flight.layer, { visibility: 'hidden' })
            : null,
          stage.floatingBack
            ? leaseInlineStyles(stage.floatingBack, {
                visibility: 'hidden',
                pointerEvents: 'none',
              })
            : null,
        );
        session.handoffVisual = visual;
        session.shared.add(visual);
      },
    });
    if (!this.owns(session)) return;
    if (!routeRevealed) {
      await this.reverseOpening(session, false);
      return;
    }

    const transferred = await this.waitForInputTransfer(
      session,
      () => session.scrollBridge?.sync(),
    );
    if (!transferred) return;
    this.completeOpeningHandoff(session);
  }

  private completeOpeningHandoff(session: OpeningSession) {
    if (
      session.handoffCommitted ||
      this.foreground !== session ||
      session.reversing ||
      !session.handoffRoute
    ) return false;
    session.handoffCommitted = true;
    session.abort.abort();
    session.scrollBridge?.release();
    session.handoffRoute = null;
    session.motion?.dispose();
    session.motion = null;
    session.visual.dispose();
    clearBackgroundVisual();
    if (session.handoffVisual && session.shared.take(session.handoffVisual)) {
      this.retainedStageVisuals.get(session.id)?.release();
      this.retainedStageVisuals.set(session.id, session.handoffVisual);
    }
    session.handoffVisual = null;
    this.detailRecord = session.record;
    this.currentSnapshot = session.snapshot;
    this.foreground = null;
    this.setStage('idle', null);
    session.shared.dispose();
    this.recordSessionMilestone(session, 'handoff-complete');
    this.setPhase('detail-idle', null, session.intent.background!, session.snapshot.image.id);
    this.markSessionTerminal(session);
    this.notifyEvent();
    return true;
  }

  private async establishOpeningGuard(session: OpeningSession) {
    let ready = session.historyRestore
      ? await this.restoreGuardStrict(session.record)
      : imageHeroHistory.install(session.record);
    if (!this.owns(session)) return false;
    if (!ready || !imageHeroHistory.isGuard(session.record)) {
      this.setPhase('recovering', session, session.intent.background!);
      const stable = await imageHeroHistory.waitForStable();
      if (!this.owns(session) || !stable) return false;
      ready = session.historyRestore
        ? await this.restoreGuardStrict(session.record)
        : imageHeroHistory.install(session.record);
    }
    const confirmed = this.owns(session) && ready && imageHeroHistory.isGuard(session.record);
    if (confirmed && this.runtime.phase === 'recovering') {
      this.setPhase('opening.handoff', session, session.intent.background!);
    }
    return confirmed;
  }

  private async recoverOpeningWithoutFlight(
    session: OpeningSession,
    collapse: Promise<boolean> | null,
  ) {
    if (!this.owns(session)) return;
    this.setPhase('recovering', session, session.intent.background!);

    if (collapse) {
      const collapsed = await collapse;
      if (!this.owns(session)) return;
      if (!collapsed) {
        await this.failParallelOpen(session);
        return;
      }
      if (!await this.waitForRouterCommit(
        backgroundHref(session.collapseRecord!.background),
        session.abort.signal,
      )) {
        await this.failParallelOpen(session);
        return;
      }
      if (!this.owns(session)) return;
      imageHeroHistory.forget(session.collapseRecord!);
      session.routeFloor = this.routeEpoch;
      session.provisionalClaimed = imageHeroHistory.claim(session.record);
      if (!session.provisionalClaimed) {
        await this.failParallelOpen(session);
        return;
      }
      session.routeNavigationStarted = true;
      session.intent.navigation.push(session.intent.detailHref);
    } else if (!session.routeNavigationStarted) {
      if (!session.provisionalClaimed) {
        await this.reverseOpening(session, false);
        return;
      }
      session.routeNavigationStarted = true;
      session.intent.navigation.push(session.intent.detailHref);
    }

    const routeCommitted = await this.waitFor({
      signal: session.abort.signal,
      timeout: HERO_ROUTE_TIMEOUT_MS,
      read: () => this.observedHref === normalizeHeroHref(session.intent.detailHref) ? true : null,
    });
    if (!this.owns(session)) return;
    if (!routeCommitted) {
      await this.reverseOpening(session, false);
      return;
    }
    session.scrollBridge?.release();
    session.scrollContinuity?.release();
    session.scrollContinuity = null;
    session.shared.dispose();
    session.visual.dispose();
    const onDetail = normalizeHeroHref(window.location.href) === session.record.detailHref;
    const historyReady = onDetail && await this.establishOpeningGuard(session);
    if (!this.owns(session)) return;
    if (!historyReady) {
      await this.reverseOpening(session, false);
      return;
    }
    const route = this.findOpeningRoute(session, false) ??
      this.findRouteByImage(session.snapshot.image.id);
    if (route) this.revealRoute(route, route.sealOwner);
    this.retainStagePointerShield(session.id);
    this.detailRecord = session.record;
    this.currentSnapshot = session.snapshot;
    this.foreground = null;
    this.setStage('idle', null);
    this.setPhase('detail-idle', null, session.intent.background!, session.snapshot.image.id);
    this.markSessionTerminal(session);
  }

  private async failParallelOpen(session: OpeningSession) {
    const reconciliation = imageHeroHistory.reconcileLocation();
    const oldDetail = session.collapseRecord?.detailHref;
    if (oldDetail && reconciliation.href === normalizeHeroHref(oldDetail)) {
      await this.reverseOpening(session, true, session.collapseRecord ?? undefined);
      return;
    }
    await this.reverseOpening(session, true);
  }

  private async reverseOpening(
    session: OpeningSession,
    navigationHandled: boolean,
    restoreRecord?: HeroHistoryRecord,
  ) {
    if (session.reversing || !this.owns(session)) return;
    const source = session.intent.source.isConnected
      ? session.intent.source
      : findImageHeroThumbnail(session.snapshot.image.id, session.snapshot.sourceKey);
    const reverseMeasurement = session.motion && source ? {
      destination: getGalleryLandingRect(source),
      plane: getGalleryScrollPlane() ?? undefined,
      pose: session.motion.measurePose(),
    } : null;
    session.reversing = true;
    session.abort.abort();
    if (session.handoffRoute) {
      if (session.handoffVisual) {
        session.shared.release(session.handoffVisual);
        session.handoffVisual = null;
      }
      this.sealRoute(session.handoffRoute, session.owner);
      session.handoffRoute = null;
    }
    const expectedBackground = normalizeHeroHref(backgroundHref(session.intent.background!));
    const currentHref = normalizeHeroHref(window.location.href);
    if (
      session.provisionalClaimed &&
      session.routeNavigationStarted &&
      navigationHandled &&
      (currentHref === expectedBackground || currentHref === session.record.detailHref)
    ) {
      // Supersede the still-pending App Router replace immediately. Waiting
      // for the visual reverse would let a late detail commit win on WebKit.
      session.intent.navigation.replace(backgroundHref(session.intent.background!));
    }
    const galleryScroller = reverseMeasurement?.plane?.scroller ?? getGalleryScrollPlane()?.scroller;
    if (galleryScroller) session.scrollBridge?.returnToGallery(galleryScroller);
    this.setPhase('reversing', session, session.intent.background!);
    session.shared.dispose();
    try {
      if (session.motion && reverseMeasurement) {
        await session.motion.reverse(
          reverseMeasurement.destination,
          reverseMeasurement.plane,
          reverseMeasurement.pose,
        );
      }
    } catch {
      // A canceled reverse still proceeds through deterministic cleanup.
    }
    if (this.foreground !== session) return;

    let onBackground = session.backgroundRecovery
      ? await session.backgroundRecovery
      : navigationHandled && this.isRecordBackground(session.record);
    if (!onBackground && session.backgroundRecovery) {
      session.intent.navigation.replace(backgroundHref(session.intent.background!));
      onBackground = await this.waitForRouterCommit(backgroundHref(session.intent.background!));
    }
    if (!onBackground && session.collapseRecord && !session.routeNavigationStarted) {
      onBackground = await (
        session.collapsePromise ?? imageHeroHistory.ensureBackground(session.collapseRecord)
      );
      if (onBackground) imageHeroHistory.forget(session.collapseRecord);
    } else if (navigationHandled && session.provisionalClaimed) {
      onBackground = await imageHeroHistory.ensureBackground(session.record);
    } else if (!navigationHandled && session.routeNavigationStarted) {
      onBackground = session.historyRestore
        ? await imageHeroHistory.ensureBackground(session.record)
        : session.provisionalClaimed
          ? await imageHeroHistory.ensureBackground(session.record)
          : await imageHeroHistory.returnUnmarkedToBackground(
              session.intent.background!,
              session.record.token,
            );
    }
    if (this.foreground !== session) return;

    const inputReleased = await waitForHeroInputRelease(this.lifecycleAbort.signal);
    if (!inputReleased || this.foreground !== session) return;
    this.retainStagePointerShield(session.id);
    session.motion?.dispose();
    session.motion = null;
    session.scrollBridge?.release();
    session.scrollContinuity?.release();
    session.scrollContinuity = null;
    session.visual.dispose();
    clearBackgroundVisual();
    const recordToRestore = restoreRecord ?? (
      session.collapseRecord &&
      normalizeHeroHref(window.location.href) === session.collapseRecord.detailHref
        ? session.collapseRecord
        : null
    );
    if (recordToRestore) {
      const route = session.previousRoute?.overlay.isConnected
        ? session.previousRoute
        : this.findRouteByImage(recordToRestore.imageId);
      if (route) await this.resetRoutePull(route);
      const restored = await this.restoreGuardStrict(recordToRestore);
      if (this.foreground !== session) return;
      if (!restored) {
        if (route) this.sealRoute(route, this.idleRouteOwner);
        this.foreground = null;
        this.pendingOpen = null;
        this.setStage('idle', null);
        this.markSessionTerminal(session);
        this.reconcileIdleLocation();
        return;
      }
      if (route) {
        if (session.previousRouteScroll) {
          route.scroller.scrollLeft = session.previousRouteScroll.left;
          route.scroller.scrollTop = session.previousRouteScroll.top;
        }
        this.revealRoute(route, route.sealOwner);
      }
      this.detailRecord = recordToRestore;
      this.currentSnapshot = recordToRestore.snapshot;
      this.foreground = null;
      this.pendingOpen = null;
      this.setStage('idle', null);
      this.setPhase('detail-idle', null, recordToRestore.background, recordToRestore.imageId);
      this.markSessionTerminal(session);
      return;
    }

    if (this.foreground === session) this.foreground = null;
    this.setStage('idle', null);
    this.markSessionTerminal(session);
    if (onBackground) this.setPhase('gallery-idle', null, null);
    else this.reconcileIdleLocation();
    const pending = this.pendingOpen;
    this.pendingOpen = null;
    if (pending && onBackground) {
      if (!await this.waitForRouterCommit(
        backgroundHref(session.intent.background!),
      )) return;
      if (!this.foreground && this.runtime.phase === 'gallery-idle') {
        this.startOpening(pending);
      }
    }
  }

  private async startClosing(intent: HeroCloseIntent): Promise<ImageHeroCloseOutcome> {
    const record = this.currentDetailRecord(intent.imageId, true);
    const route = this.findRouteByImage(intent.imageId);
    if (!record) {
      this.detailRecord = null;
      this.currentSnapshot = null;
      window.history.back();
      return 'handled';
    }
    if (!route?.target) {
      const closed = await imageHeroHistory.ensureBackground(record);
      if (closed && this.isRecordBackground(record)) return 'closed';
      return await this.restoreGuardStrict(record) ? 'restored' : 'handled';
    }
    const thumbnail = findImageHeroThumbnail(intent.imageId, record.snapshot.sourceKey)
      ?? findImageHeroThumbnail(intent.imageId);
    const plane = getGalleryScrollPlane();
    if (!thumbnail || !plane) {
      const closed = await imageHeroHistory.ensureBackground(record);
      if (closed && this.isRecordBackground(record)) return 'closed';
      return await this.restoreGuardStrict(record) ? 'restored' : 'handled';
    }

    const liveAsset = captureHeroFrame(getVisualMedia(route.target))
      ?? record.snapshot.previewFrame;
    const snapshot = { ...record.snapshot, previewFrame: liveAsset, createdAt: Date.now() };
    const id = ++this.sessionSequence;
    let resolveClose!: (outcome: ImageHeroCloseOutcome) => void;
    const closePromise = new Promise<ImageHeroCloseOutcome>((resolve) => {
      resolveClose = resolve;
    });
    const session: ClosingSession = {
      id,
      owner: Symbol(`hero-closing:${id}`),
      kind: 'closing',
      snapshot,
      intent,
      abort: new AbortController(),
      shared: new ResourceScope(),
      visual: new ResourceScope(),
      motion: null,
      scrollContinuity: null,
      retired: false,
      reversing: false,
      pullSeized: false,
      record,
      route,
      thumbnail,
      closePromise,
      resolveClose,
      retirement: null,
      routeScroll: {
        left: route.scroller.scrollLeft,
        top: route.scroller.scrollTop,
      },
    };
    this.foreground = session;
    this.setPhase('closing.flight', session, record.background);
    void this.runClosing(session);
    return closePromise;
  }

  private async runClosing(session: ClosingSession) {
    const { route, thumbnail } = session;
    if (session.retired || !this.owns(session)) {
      this.resolveClosing(session, 'handled');
      return;
    }
    try {
      const from = getHeroRect(route.target!);
      const to = getGalleryLandingRect(thumbnail);
      const plane = getGalleryScrollPlane();
      if (!plane) throw new Error('Gallery scroll plane is unavailable');
      const scrollContinuity = new HeroScrollContinuity(plane.scroller);
      scrollContinuity.addDeltaSource(route.scroller);
      session.scrollContinuity = scrollContinuity;
      const flight = createHeroFlight({
        asset: session.snapshot.previewFrame,
        treatment: thumbnail,
        plane,
        from,
        to,
        direction: 'back',
        sessionId: session.id,
        imageId: session.snapshot.image.id,
      });
      session.visual.add(flight.release);
      session.visual.add(this.sealRouteTarget(route, session.owner));
      session.visual.add(leaseHeroCardChrome(thumbnail));
      session.visual.add(leaseHeroVisibility(thumbnail, false));
      route.interaction?.release();
      const interaction = leaseAttribute(route.overlay, 'inert', '');
      route.interaction = interaction;
      route.interactionOwner = session.owner;
      session.shared.add(() => {
        if (
          route.interaction !== interaction ||
          route.interactionOwner !== session.owner
        ) return;
        interaction.release();
        route.interaction = null;
        route.interactionOwner = null;
      });
      session.shared.add(leaseInlineStyles(route.overlay, { pointerEvents: 'none' }));
      const background = document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR);
      const motion = new HeroMotion({
        flight,
        from,
        to,
        direction: 'back',
        background,
        overlay: route.overlay,
        floatingBack: route.floatingBack,
        continueBackground: session.intent.backgroundMode === 'continue',
      });
      session.motion = motion;
      await motion.landed;
      if (session.retired) {
        await this.ensureRetirement(session);
        this.resolveClosing(session, 'handled');
        return;
      }
      if (!this.owns(session)) {
        if (session.retired) await this.ensureRetirement(session);
        return;
      }
      const transferReady = await this.waitForInputTransfer(session);
      if (!transferReady) {
        if (session.retired) await this.ensureRetirement(session);
        return;
      }
      const closed = this.isRecordBackground(session.record) ||
        await imageHeroHistory.ensureBackground(session.record);
      if (!this.owns(session)) {
        if (session.retired) await this.ensureRetirement(session);
        return;
      }
      if (!closed || !this.isRecordBackground(session.record)) {
        await this.reverseClosing(session);
        return;
      }
      const routeCommitted = await this.waitForRouterCommit(
        backgroundHref(session.record.background),
        session.abort.signal,
      );
      if (!this.owns(session)) {
        if (session.retired) await this.ensureRetirement(session);
        return;
      }
      if (!routeCommitted) {
        await this.reverseClosing(session);
        return;
      }
      const committedTransferReady = await this.waitForInputTransfer(session);
      if (!committedTransferReady) {
        if (session.retired) await this.ensureRetirement(session);
        return;
      }
      if (session.route.pull) {
        this.restoreRoutePull(session.route.pull, session.route);
        session.route.pull = null;
      }
      motion.dispose();
      session.motion = null;
      session.scrollContinuity?.release();
      session.scrollContinuity = null;
      session.shared.dispose();
      session.visual.dispose();
      this.sealRoute(route, session.owner);
      clearBackgroundVisual();
      this.foreground = null;
      this.currentSnapshot = null;
      this.detailRecord = session.record;
      this.setPhase('gallery-idle', null, null);
      this.markSessionTerminal(session);
      this.resolveClosing(session, 'closed');
    } catch (error) {
      if (session.retired || session.abort.signal.aborted || !this.owns(session)) {
        this.resolveClosing(session, 'handled');
        return;
      }
      console.error('[hero] closing transaction failed', error);
      await this.reverseClosing(session);
    }
  }

  private async reverseClosing(session: ClosingSession) {
    if (session.retired || session.reversing || !this.owns(session)) {
      if (session.retired) this.resolveClosing(session, 'handled');
      return;
    }
    const routeTarget = session.route.target;
    const reverseMeasurement = session.motion && routeTarget?.isConnected ? {
      destination: getHeroRect(routeTarget),
      pose: session.motion.measurePose(),
    } : null;
    session.reversing = true;
    session.abort.abort();
    this.setPhase('reversing', session, session.record.background);
    try {
      if (session.motion && reverseMeasurement) {
        await session.motion.reverse(
          reverseMeasurement.destination,
          undefined,
          reverseMeasurement.pose,
        );
      }
    } catch {
      // Continue to restore the real route even if visual reverse was canceled.
    }
    if (this.foreground !== session) {
      this.resolveClosing(session, 'handled');
      return;
    }
    const restored = await this.restoreGuardStrict(session.record);
    if (this.foreground !== session) {
      this.resolveClosing(session, 'handled');
      return;
    }
    await this.resetRoutePull(session.route);
    session.motion?.dispose();
    session.motion = null;
    session.scrollContinuity?.release();
    session.scrollContinuity = null;
    session.shared.dispose();
    session.visual.dispose();
    clearBackgroundVisual();
    if (this.foreground === session) this.foreground = null;
    this.markSessionTerminal(session);
    if (restored) {
      session.route.scroller.scrollLeft = session.routeScroll.left;
      session.route.scroller.scrollTop = session.routeScroll.top;
      this.revealRoute(session.route, session.owner);
      this.currentSnapshot = session.record.snapshot;
      this.detailRecord = session.record;
      this.setPhase('detail-idle', null, session.record.background, session.record.imageId);
      this.resolveClosing(session, 'restored');
      return;
    }
    this.sealRoute(session.route, this.idleRouteOwner);
    this.reconcileIdleLocation();
    this.resolveClosing(session, 'handled');
  }

  private retireClosing(session: ClosingSession) {
    if (!this.owns(session)) return;
    if (this.retiring) this.disposeRetiring(this.retiring);
    session.retired = true;
    session.abort.abort();
    session.shared.dispose();
    this.sealRoute(session.route, session.owner);
    session.motion?.retire();
    if (session.route.pull) {
      this.restoreRoutePull(session.route.pull, session.route, false);
      session.route.pull = null;
    }
    this.retiring = session;
    this.foreground = null;
    this.markSessionTerminal(session);
    this.resolveClosing(session, 'handled');
    void this.ensureRetirement(session);
  }

  private finishRetiring(session: HeroSession) {
    session.motion?.dispose();
    session.motion = null;
    session.scrollContinuity?.release();
    session.scrollContinuity = null;
    session.visual.dispose();
    session.shared.dispose();
    if (this.retiring === session) this.retiring = null;
  }

  private ensureRetirement(session: ClosingSession) {
    if (session.retirement) return session.retirement;
    const motion = session.motion;
    session.retirement = (motion
      ? motion.landed.then(() => motion.fadeRetiring())
      : Promise.resolve()
    ).catch(() => undefined).then(() => {
      this.finishRetiring(session);
    });
    return session.retirement;
  }

  private disposeRetiring(session: HeroSession) {
    session.abort.abort();
    if (session.kind === 'closing') this.resolveClosing(session as ClosingSession, 'handled');
    this.finishRetiring(session);
  }

  private abandonClosing(session: ClosingSession) {
    if (this.foreground !== session) return;
    session.abort.abort();
    session.motion?.dispose();
    session.motion = null;
    session.scrollContinuity?.release();
    session.scrollContinuity = null;
    session.shared.dispose();
    session.visual.dispose();
    if (session.route.pull) {
      this.restoreRoutePull(session.route.pull, session.route);
      session.route.pull = null;
    }
    this.sealRoute(session.route, this.idleRouteOwner);
    this.foreground = null;
    this.markSessionTerminal(session);
    this.resolveClosing(session, 'handled');
    clearBackgroundVisual();
    this.reconcileIdleLocation();
  }

  private bindOpeningScroll(
    session: OpeningSession,
    stage: HeroStageNodes,
  ) {
    const sizeOwner = {};
    const continuity = session.scrollContinuity ?? new HeroScrollContinuity(stage.scroller);
    continuity.replacePeers(stage.scroller);
    session.scrollContinuity = continuity;
    let targetScroller: HTMLElement | null = null;
    let targetContent: HTMLElement | null = null;
    let heightLease: DomLease | null = null;
    let released = false;
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => syncHeight());

    const sync = () => {
      if (released || !this.owns(session)) return;
      continuity.sync();
    };
    const syncHeight = () => {
      if (released || !this.owns(session) || !targetContent) return;
      heroFrameScheduler.request(sizeOwner, {
        read: () => targetContent?.scrollHeight ?? 0,
        write: (height) => {
          if (released || !this.owns(session) || !targetContent || height <= 0) return;
          const next = leaseInlineStyles(stage.content, {
            minHeight: `${Math.ceil(height)}px`,
          });
          const previous = heightLease;
          heightLease = next;
          previous?.release();
          sync();
        },
      });
    };
    const bridge: OpeningScrollBridge = {
      addTarget: (target, content) => {
        if (released || targetScroller === target) return;
        if (targetContent) resizeObserver?.unobserve(targetContent);
        if (targetScroller) continuity.removePeer(targetScroller);
        targetScroller = target;
        targetContent = content ?? null;
        if (targetContent) resizeObserver?.observe(targetContent);
        continuity.addPeer(target);
        syncHeight();
        sync();
      },
      sync,
      returnToGallery: (galleryScroller) => {
        if (released) return;
        const outgoing = [stage.scroller, targetScroller].filter(
          (element): element is HTMLElement => Boolean(element && element !== galleryScroller),
        );
        continuity.replacePeers(galleryScroller);
        outgoing.forEach((element) => continuity.addDeltaSource(element));
      },
      release: () => {
        if (released) return;
        released = true;
        heroFrameScheduler.cancel(sizeOwner);
        resizeObserver?.disconnect();
        heightLease?.release();
        heightLease = null;
        targetScroller = null;
        targetContent = null;
        continuity.release();
        if (session.scrollContinuity === continuity) session.scrollContinuity = null;
        if (session.scrollBridge === bridge) session.scrollBridge = null;
      },
    };

    session.scrollBridge = bridge;
  }

  private bindOpeningDismiss(
    session: OpeningSession,
    stage: HeroStageNodes,
    background: HTMLElement | null,
  ) {
    let pullState: OpeningPullVisualState | null = null;
    const ensurePullState = () => {
      if (pullState) return pullState;
      pullState = {
        contentTransform: stage.content.style.transform,
        contentWillChange: stage.content.style.willChange,
        reveal: Array.from(
          stage.overlay.querySelectorAll<HTMLElement>('[data-image-detail-reveal]'),
        ).map((element) => ({
          element,
          opacity: element.style.opacity,
          willChange: element.style.willChange,
        })),
        surfaceOpacity: stage.surface.style.opacity,
        surfaceWillChange: stage.surface.style.willChange,
        backOpacity: stage.floatingBack?.style.opacity ?? '',
        backWillChange: stage.floatingBack?.style.willChange ?? '',
        animations: new Set(),
        resetEpoch: 0,
      };
      return pullState;
    };
    const release = bindHeroDismissGesture({
      target: stage.overlay,
      listenTarget: window,
      scroller: stage.scroller,
      canStart: () => this.owns(session) && !session.reversing,
      onPull: (sample) => {
        if (!this.owns(session)) return;
        if (!session.pullSeized) {
          session.pullSeized = true;
          session.motion?.releaseShared();
        }
        const state = ensurePullState();
        state.resetEpoch += 1;
        this.cancelOpeningPullAnimations(state);
        stage.content.style.willChange = 'transform';
        stage.content.style.transform = `translate3d(0, ${sample.distance}px, 0)`;
        state.reveal.forEach(({ element }) => {
          element.style.willChange = 'opacity';
          element.style.opacity = String(sample.opacity);
        });
        stage.surface.style.willChange = 'opacity';
        stage.surface.style.opacity = String(sample.opacity);
        if (stage.floatingBack) {
          stage.floatingBack.style.willChange = 'opacity';
          stage.floatingBack.style.opacity = String(sample.opacity);
        }
        session.motion?.setPullOffset(sample.distance);
        if (background) {
          background.style.transformOrigin = 'center top';
          background.style.willChange = 'transform';
          background.style.transform = getHeroBackgroundSinkTransform(sample.backgroundAmount);
        }
      },
      onCancel: (sample) => this.resetOpeningPull(
        session,
        stage,
        background,
        sample,
        ensurePullState(),
      ),
      onCommit: () => {
        void this.reverseOpening(session, false);
      },
    });
    session.shared.add(() => {
      release();
      if (!pullState) return;
      this.cancelOpeningPullAnimations(pullState);
      this.restoreOpeningPullVisuals(stage, pullState);
      session.pullSeized = false;
    });
  }

  private async resetOpeningPull(
    session: OpeningSession,
    stage: HeroStageNodes,
    background: HTMLElement | null,
    sample: HeroPullSample,
    state: OpeningPullVisualState,
  ) {
    const resetEpoch = ++state.resetEpoch;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 260;
    const animations: Animation[] = [];
    try {
      animations.push(
        stage.content.animate(
          [
            { transform: `translate3d(0, ${sample.distance}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' },
          ],
          { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        ),
        stage.surface.animate(
          [{ opacity: sample.opacity }, { opacity: 1 }],
          { duration, easing: 'ease-out', fill: 'forwards' },
        ),
      );
      state.reveal.forEach(({ element, opacity }) => {
        animations.push(element.animate(
          [{ opacity: element.style.opacity || 1 }, { opacity: opacity || 1 }],
          { duration, easing: 'ease-out', fill: 'forwards' },
        ));
      });
      if (background) {
        animations.push(background.animate(
          [
            { transform: getHeroBackgroundSinkTransform(sample.backgroundAmount) },
            { transform: getHeroBackgroundSinkTransform(1) },
          ],
          { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        ));
      }
      if (stage.floatingBack) {
        animations.push(stage.floatingBack.animate(
          [{ opacity: sample.opacity }, { opacity: 1 }],
          { duration, easing: 'ease-out', fill: 'forwards' },
        ));
      }
      animations.forEach((animation) => state.animations.add(animation));
      await Promise.allSettled(animations.map((animation) => animation.finished));
    } catch {
      // Fall through to the same deterministic inline-style restoration.
    }
    animations.forEach((animation) => {
      state.animations.delete(animation);
      try {
        animation.cancel();
      } catch {
        // Detached animations no longer own visible state.
      }
    });
    if (!this.owns(session) || state.resetEpoch !== resetEpoch) return;
    this.restoreOpeningPullVisuals(stage, state);
    session.motion?.setPullOffset(0);
    if (background) background.style.transform = getHeroBackgroundSinkTransform(1);
    session.pullSeized = false;
    this.notifyEvent();
  }

  private cancelOpeningPullAnimations(state: OpeningPullVisualState) {
    state.animations.forEach((animation) => {
      try {
        animation.cancel();
      } catch {
        // Detached Stage animations no longer own visible state.
      }
    });
    state.animations.clear();
  }

  private restoreOpeningPullVisuals(
    stage: HeroStageNodes,
    state: OpeningPullVisualState,
  ) {
    stage.content.style.transform = state.contentTransform;
    stage.content.style.willChange = state.contentWillChange;
    state.reveal.forEach(({ element, opacity, willChange }) => {
      element.style.opacity = opacity;
      element.style.willChange = willChange;
    });
    stage.surface.style.opacity = state.surfaceOpacity;
    stage.surface.style.willChange = state.surfaceWillChange;
    if (stage.floatingBack) {
      stage.floatingBack.style.opacity = state.backOpacity;
      stage.floatingBack.style.willChange = state.backWillChange;
    }
  }

  private applyRoutePull(route: RegisteredRoute, sample: HeroPullSample, owner: symbol) {
    if (
      this.runtime.phase !== 'detail-idle' ||
      this.runtime.imageId !== route.imageId
    ) return;
    const background = document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR);
    if (route.pull && route.pull.owner !== owner) return;
    if (!route.pull) {
      const record = this.detailRecord;
      const thumbnail = findImageHeroThumbnail(
        route.imageId,
        record?.imageId === route.imageId ? record.snapshot.sourceKey : undefined,
      ) ?? findImageHeroThumbnail(route.imageId);
      route.pull = {
        owner,
        thumbnailVisual: thumbnail
          ? combineDomLeases(
              leaseHeroCardChrome(thumbnail),
              leaseHeroVisibility(thumbnail, false),
            )
          : null,
        animations: new Set(),
        resetEpoch: 0,
        contentTransform: route.content.style.transform,
        contentWillChange: route.content.style.willChange,
        reveal: Array.from(
          route.overlay.querySelectorAll<HTMLElement>('[data-image-detail-reveal]'),
        ).map((element) => ({
          element,
          opacity: element.style.opacity,
          willChange: element.style.willChange,
        })),
        surfaceOpacity: route.surface.style.opacity,
        surfaceWillChange: route.surface.style.willChange,
        backOpacity: route.floatingBack?.style.opacity ?? '',
        backWillChange: route.floatingBack?.style.willChange ?? '',
        backgroundTransform: background?.style.transform ?? '',
        backgroundOrigin: background?.style.transformOrigin ?? '',
        backgroundWillChange: background?.style.willChange ?? '',
      };
    }
    route.pull.resetEpoch += 1;
    this.cancelRoutePullAnimations(route.pull);
    route.content.style.willChange = 'transform';
    route.content.style.transform = `translate3d(0, ${sample.distance}px, 0)`;
    route.pull.reveal.forEach(({ element }) => {
      element.style.willChange = 'opacity';
      element.style.opacity = String(sample.opacity);
    });
    route.surface.style.willChange = 'opacity';
    route.surface.style.opacity = String(sample.opacity);
    if (route.floatingBack) {
      route.floatingBack.style.willChange = 'opacity';
      route.floatingBack.style.opacity = String(sample.opacity);
    }
    if (background) {
      background.style.transformOrigin = 'center top';
      background.style.willChange = 'transform';
      background.style.transform = getHeroBackgroundSinkTransform(sample.backgroundAmount);
    }
  }

  private async resetRoutePull(
    route: RegisteredRoute,
    sample?: HeroPullSample,
    owner?: symbol,
  ) {
    const saved = route.pull;
    if (!saved || (owner && saved.owner !== owner)) return;
    const resetEpoch = ++saved.resetEpoch;
    try {
      const background = document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR);
      const currentDistance = sample?.distance ?? 0;
      const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 280;
      const animations = [
        route.content.animate(
          [
            {
              transform: route.content.style.transform ||
                `translate3d(0, ${currentDistance}px, 0)`,
            },
            { transform: saved.contentTransform || 'translate3d(0, 0, 0)' },
          ],
          { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        ),
        route.surface.animate(
          [
            { opacity: route.surface.style.opacity || 1 },
            { opacity: saved.surfaceOpacity || 1 },
          ],
          { duration, easing: 'ease-out', fill: 'forwards' },
        ),
      ];
      saved.reveal.forEach(({ element, opacity }) => {
        animations.push(element.animate(
          [{ opacity: element.style.opacity || 1 }, { opacity: opacity || 1 }],
          { duration, easing: 'ease-out', fill: 'forwards' },
        ));
      });
      if (route.floatingBack) {
        animations.push(route.floatingBack.animate(
          [
            { opacity: route.floatingBack.style.opacity || 1 },
            { opacity: saved.backOpacity || 1 },
          ],
          { duration, easing: 'ease-out', fill: 'forwards' },
        ));
      }
      if (background) {
        animations.push(background.animate(
          [
            { transform: background.style.transform || getHeroBackgroundSinkTransform(0) },
            { transform: saved.backgroundTransform || 'none' },
          ],
          { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        ));
      }
      animations.forEach((animation) => saved.animations.add(animation));
      await Promise.allSettled(animations.map((animation) => animation.finished));
      animations.forEach((animation) => {
        saved.animations.delete(animation);
        try {
          animation.cancel();
        } catch {
          // Detached route animations are already visually inert.
        }
      });
      if (route.pull !== saved || saved.resetEpoch !== resetEpoch) return;
      this.restoreRoutePull(saved, route);
      route.pull = null;
    } catch {
      if (route.pull !== saved || saved.resetEpoch !== resetEpoch) return;
      this.restoreRoutePull(saved, route);
      route.pull = null;
    }
  }

  private cancelRoutePullAnimations(saved: RoutePullState) {
    saved.animations.forEach((animation) => {
      try {
        animation.cancel();
      } catch {
        // A replaced detail subtree no longer owns a visible animation.
      }
    });
    saved.animations.clear();
  }

  private restoreRoutePull(
    saved: RoutePullState,
    route: RegisteredRoute,
    restoreBackground = true,
  ) {
    saved.resetEpoch += 1;
    this.cancelRoutePullAnimations(saved);
    route.content.style.transform = saved.contentTransform;
    route.content.style.willChange = saved.contentWillChange;
    saved.reveal.forEach(({ element, opacity, willChange }) => {
      element.style.opacity = opacity;
      element.style.willChange = willChange;
    });
    route.surface.style.opacity = saved.surfaceOpacity;
    route.surface.style.willChange = saved.surfaceWillChange;
    if (route.floatingBack) {
      route.floatingBack.style.opacity = saved.backOpacity;
      route.floatingBack.style.willChange = saved.backWillChange;
    }
    const background = restoreBackground
      ? document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR)
      : null;
    if (background) {
      background.style.transform = saved.backgroundTransform;
      background.style.transformOrigin = saved.backgroundOrigin;
      background.style.willChange = saved.backgroundWillChange;
    }
    saved.thumbnailVisual?.release();
  }

  private findOpeningRoute(session: OpeningSession, requirePreview: boolean) {
    const expected = normalizeHeroHref(session.intent.detailHref);
    let candidate: RegisteredRoute | null = null;
    for (const route of this.routes.values()) {
      if (
        route.imageId !== session.snapshot.image.id ||
        route.href !== expected ||
        (!session.allowExistingRoute && route.epoch <= session.routeFloor) ||
        !route.overlay.isConnected
      ) {
        continue;
      }
      if (requirePreview && (!route.previewPaintable || !route.target)) continue;
      if (!candidate || route.epoch > candidate.epoch) candidate = route;
    }
    return candidate;
  }

  private findRouteByImage(imageId: number) {
    const href = normalizeHeroHref(window.location.href);
    let candidate: RegisteredRoute | null = null;
    for (const route of this.routes.values()) {
      if (route.imageId !== imageId || !route.overlay.isConnected) continue;
      if (route.href !== href) continue;
      if (!candidate || route.epoch > candidate.epoch) candidate = route;
    }
    return candidate;
  }

  private sealRouteTarget(route: RegisteredRoute, owner: symbol): DomLease {
    route.targetSeal?.release();
    let element: HTMLElement | null = null;
    let visibility: DomLease | null = null;
    let released = false;
    const seal: RouteTargetSeal = {
      owner,
      refresh: () => {
        if (released || route.targetSeal !== seal || route.target === element) return;
        visibility?.release();
        element = route.target;
        visibility = leaseHeroVisibility(element, false);
      },
      release: () => {
        if (released) return;
        released = true;
        visibility?.release();
        visibility = null;
        element = null;
        if (route.targetSeal === seal) route.targetSeal = null;
      },
    };
    route.targetSeal = seal;
    seal.refresh();
    return seal;
  }

  private sealRoute(route: RegisteredRoute, owner: symbol) {
    if (route.sealOwner === owner && route.seal) return;
    route.interaction?.release();
    route.interaction = null;
    route.interactionOwner = null;
    route.seal?.release();
    route.seal = leaseHeroRouteSealed(route);
    route.sealOwner = owner;
  }

  private revealRoute(route: RegisteredRoute, owner: symbol | null = null) {
    if (route.seal && owner !== null && route.sealOwner !== owner) return false;
    if (
      route.interaction &&
      owner !== null &&
      route.interactionOwner !== owner
    ) return false;
    route.seal?.release();
    route.seal = null;
    route.sealOwner = null;
    route.interaction?.release();
    route.interaction = null;
    route.interactionOwner = null;
    route.overlay.dataset.imageHeroRouteState = 'active';
    route.overlay.style.opacity = '';
    route.overlay.style.visibility = '';
    route.overlay.style.pointerEvents = '';
    if (route.floatingBack) {
      route.floatingBack.style.opacity = '';
      route.floatingBack.style.visibility = '';
      route.floatingBack.style.pointerEvents = '';
    }
    return true;
  }

  private sealRoutesExcept(keep: RegisteredRoute | null, owner: symbol = this.idleRouteOwner) {
    this.routes.forEach((route) => {
      if (route !== keep) this.sealRoute(route, owner);
    });
  }

  private unregisterRoute(route: RegisteredRoute) {
    if (this.routes.get(route.surfaceId) !== route) return;
    this.routes.delete(route.surfaceId);
    if (route.pull) {
      this.restoreRoutePull(route.pull, route);
      route.pull = null;
    }
    route.targetSeal?.release();
    route.seal?.release();
    route.interaction?.release();
    route.targetSeal = null;
    route.seal = null;
    route.sealOwner = null;
    route.interaction = null;
    route.interactionOwner = null;
    this.notifyEvent();
  }

  private handleHistoryNavigation = (navigation: HeroHistoryNavigation) => {
    const foreground = this.foreground;
    if (foreground?.kind === 'opening') {
      const background = normalizeHeroHref(backgroundHref(foreground.intent.background!));
      if (navigation.href === background) {
        const ownsParallelCollapse = Boolean(
          navigation.programmatic &&
          foreground.collapseRecord &&
          !foreground.routeNavigationStarted &&
          navigation.programmaticToken === foreground.collapseRecord.token
        );
        if (!ownsParallelCollapse) void this.reverseOpening(foreground, true);
        return;
      }
      if (!navigation.programmatic) {
        if (
          navigation.previous === 'provisional' &&
          navigation.position === 'background' &&
          navigation.href !== foreground.record.detailHref
        ) {
          foreground.backgroundRecovery ??=
            imageHeroHistory.recoverSkippedBackground(foreground.record);
        }
        void this.reverseOpening(foreground, true);
      }
      return;
    }
    if (navigation.programmatic) {
      // A timed-out traversal can arrive after its session finalized. Reconcile
      // the observable location instead of leaving a stale detail-idle runtime
      // on the gallery (which otherwise poisons the next rapid open).
      if (navigation.late && !this.detailRouteChange) this.reconcileIdleLocation();
      return;
    }
    if (this.detailRouteChange) return;
    if (foreground?.kind === 'closing') {
      const sameRecord = navigation.record?.token === foreground.record.token;
      if (sameRecord && navigation.position === 'guard') {
        void this.reverseClosing(foreground);
        return;
      }
      if (
        navigation.position === 'background' &&
        navigation.href === normalizeHeroHref(backgroundHref(foreground.record.background))
      ) {
        return;
      }
      if (sameRecord && navigation.position === 'base') return;
      this.abandonClosing(foreground);
      return;
    }
    if (!navigation.record && navigation.marker) {
      // Refresh/BFCache can retain v1/v2 marker state without a live frame.
      // Collapse the pair as ordinary navigation; never invent an animation.
      if (navigation.previous === 'guard' && navigation.position === 'base') {
        void imageHeroHistory.collapseLegacyMarker(navigation.marker);
      }
      return;
    }
    if (!navigation.record) {
      this.reconcileIdleLocation();
      return;
    }
    if (navigation.previous === 'guard' && navigation.position === 'base') {
      this.detailRecord = navigation.record;
      this.currentSnapshot = navigation.record.snapshot;
      void this.startClosing({
        imageId: navigation.record.imageId,
        navigation: this.router ?? defaultNavigation(),
        cause: 'history',
      });
      return;
    }
    if (
      (navigation.previous === 'background' || navigation.previous === 'unknown') &&
      (
        navigation.position === 'base' ||
        navigation.position === 'guard' ||
        navigation.position === 'provisional'
      )
    ) {
      if (navigation.position === 'guard') {
        this.reconcileIdleLocation();
        return;
      }
      const source = findImageHeroThumbnail(
        navigation.record.imageId,
        navigation.record.snapshot.sourceKey,
      ) ?? findImageHeroThumbnail(navigation.record.imageId);
      const skipFlight = !source;
      const provisional = navigation.position === 'provisional';
      const intent: HeroOpenIntent = {
        snapshot: navigation.record.snapshot,
        source: source ?? document.documentElement,
        detailHref: navigation.record.detailHref,
        background: navigation.record.background,
        navigation: this.router ?? defaultNavigation(),
        historyRestore: provisional ? undefined : true,
      };
      const options = {
        historyRecord: navigation.record,
        provisionalClaimed: provisional,
        allowExistingRoute: true,
        skipFlight,
      };
      if (!provisional) {
        this.startOpening(intent, options);
        return;
      }
      void this.waitForRouterCommit(navigation.href).then((committed) => {
        if (!committed) return;
        const marker = imageHeroHistory.currentMarker();
        if (
          this.foreground ||
          this.detailRouteChange ||
          marker?.token !== navigation.record?.token
        ) return;
        const role = imageHeroHistory.currentRole();
        const href = normalizeHeroHref(window.location.href);
        const detailHref = navigation.record!.detailHref;
        const galleryHref = normalizeHeroHref(backgroundHref(navigation.record!.background));
        if (role === 'guard') {
          this.reconcileIdleLocation();
          return;
        }
        if (role === 'base' && href === detailHref) {
          this.startOpening(
            { ...intent, historyRestore: true },
            { ...options, provisionalClaimed: false, routeNavigationStarted: true },
          );
          return;
        }
        if (role !== 'provisional' || (href !== galleryHref && href !== detailHref)) return;
        this.startOpening(intent, {
          ...options,
          routeNavigationStarted: href === detailHref,
        });
      });
    }
  };

  private handleViewportInvalidation = () => {
    const session = this.foreground;
    if (!session?.motion) return;
    heroFrameScheduler.request(this.viewportFrameOwner, {
      read: () => {
        const motion = session.motion;
        if (!motion) return null;
        if (session.kind === 'opening') {
          const stage = this.stage?.sessionId === session.id ? this.stage.nodes : null;
          return stage?.target.isConnected ? {
            destination: getHeroRect(stage.target),
            plane: getElementScrollPlane(stage.anchor, stage.scroller),
            pose: motion.measurePose(),
          } : null;
        }
        const plane = getGalleryScrollPlane();
        return session.thumbnail.isConnected && plane ? {
          destination: getGalleryLandingRect(session.thumbnail),
          plane,
          pose: motion.measurePose(),
        } : null;
      },
      write: (measurement) => {
        if (!measurement || !this.owns(session) || !session.motion) return;
        session.motion.rebuild(
          measurement.destination,
          measurement.plane,
          measurement.pose,
        );
      },
    });
  };

  private handlePageHide = () => {
    this.lifecycleAbort.abort();
    const foreground = this.foreground;
    if (foreground) {
      foreground.abort.abort();
      foreground.motion?.dispose();
      if (foreground.kind === 'opening') foreground.scrollBridge?.release();
      foreground.scrollContinuity?.release();
      foreground.scrollContinuity = null;
      foreground.shared.dispose();
      foreground.visual.dispose();
      if (foreground.kind === 'closing') this.resolveClosing(foreground, 'handled');
    }
    if (this.retiring) this.disposeRetiring(this.retiring);
    this.retainedStageVisuals.forEach((visual) => visual.release());
    this.retainedStageVisuals.clear();
    this.routes.forEach((route) => {
      if (!route.pull) return;
      this.restoreRoutePull(route.pull, route);
      route.pull = null;
    });
    this.foreground = null;
    this.stage = null;
    this.detailRouteAbort?.abort();
    this.detailRouteAbort = null;
    this.detailRouteChange = null;
    this.pendingDetailRouteChange = null;
    this.setStage('idle', null);
    this.setPhase('gallery-idle', null, null);
    if (foreground) this.markSessionTerminal(foreground);
    heroFrameScheduler.cancel(this.viewportFrameOwner);
    heroFrameScheduler.dispose();
    clearBackgroundVisual();
  };

  private handlePageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    this.lifecycleAbort = new AbortController();
    initializeHeroFrameRuntime();
    this.observedHref = normalizeHeroHref(window.location.href);
    this.reconcileIdleLocation();
  };

  private reconcileIdleLocation() {
    const detailMatch = window.location.pathname.match(/^\/pic\/(\d+)\/?$/);
    if (detailMatch) {
      const activeId = Number(detailMatch[1]);
      const record = this.currentDetailRecord(activeId);
      if (record?.imageId === activeId && !imageHeroHistory.isGuard(record)) {
        this.detailRecord = record;
        this.currentSnapshot = record.snapshot;
        this.sealRoutesExcept(null);
        this.setPhase('recovering', null, record.background, activeId);
        return;
      }
      if (record?.imageId === activeId) {
        this.detailRecord = record;
        this.currentSnapshot = record.snapshot;
      } else {
        this.detailRecord = null;
        this.currentSnapshot = null;
      }
      const activeRoute = this.findRouteByImage(activeId);
      if (activeRoute) this.revealRoute(activeRoute, activeRoute.sealOwner);
      this.sealRoutesExcept(activeRoute);
      this.setPhase(
        'detail-idle',
        null,
        record?.background ?? null,
        activeId,
      );
      return;
    }
    this.detailRecord = null;
    this.currentSnapshot = null;
    this.sealRoutesExcept(null);
    this.setPhase('gallery-idle', null, null);
  }

  private owns(session: HeroSession) {
    return this.foreground === session && !session.retired && !session.reversing;
  }

  private releaseRetainedStageVisual(sessionId: number) {
    const visual = this.retainedStageVisuals.get(sessionId);
    if (!visual) return;
    this.retainedStageVisuals.delete(sessionId);
    visual.release();
  }

  private retainStagePointerShield(sessionId: number) {
    const stage = this.stage?.sessionId === sessionId ? this.stage.nodes : null;
    if (!stage) return;
    const shield = combineDomLeases(
      leaseInlineStyles(stage.overlay, { pointerEvents: 'none' }),
      leaseInlineStyles(stage.scroller, { pointerEvents: 'none' }),
    );
    this.retainedStageVisuals.get(sessionId)?.release();
    this.retainedStageVisuals.set(sessionId, shield);
  }

  private isRecordBackground(record: HeroHistoryRecord) {
    return (
      normalizeHeroHref(window.location.href) ===
        normalizeHeroHref(backgroundHref(record.background)) &&
      imageHeroHistory.currentMarker() === null
    );
  }

  private currentDetailRecord(imageId: number, stableOnly = false) {
    const marker = imageHeroHistory.currentMarker();
    if (!marker || marker.imageId !== imageId) return null;
    const record = imageHeroHistory.recordForToken(marker.token);
    if (
      !record ||
      record.imageId !== imageId ||
      normalizeHeroHref(marker.detailHref) !== record.detailHref ||
      normalizeHeroHref(window.location.href) !== record.detailHref
    ) {
      return null;
    }
    if (stableOnly) {
      const role = imageHeroHistory.currentRole();
      if (role !== 'base' && role !== 'guard') return null;
    }
    return record;
  }

  private async restoreGuardStrict(record: HeroHistoryRecord) {
    if (imageHeroHistory.isGuard(record)) return true;
    const restored = await imageHeroHistory.restoreGuard(record);
    if (restored && imageHeroHistory.isGuard(record)) return true;
    const stable = await imageHeroHistory.waitForStable();
    if (!stable) return false;
    if (imageHeroHistory.isGuard(record)) return true;
    return await imageHeroHistory.restoreGuard(record) && imageHeroHistory.isGuard(record);
  }

  private markSessionTerminal(session: HeroSession) {
    this.terminalSessions.add(session.id);
    while (this.terminalSessions.size > 16) {
      const oldest = this.terminalSessions.values().next().value as number | undefined;
      if (oldest === undefined) break;
      this.terminalSessions.delete(oldest);
      this.sessionMilestones.delete(oldest);
    }
    this.notifyEvent();
  }

  private recordSessionMilestone(session: HeroSession, milestone: HeroMilestone) {
    const milestones = this.sessionMilestones.get(session.id) ?? new Set<HeroMilestone>();
    milestones.add(milestone);
    this.sessionMilestones.set(session.id, milestones);
  }

  private setStage(phase: ImageHeroStageState['phase'], session: OpeningSession | null) {
    const stage: ImageHeroStageState = session
      ? { phase, snapshot: session.snapshot, sessionId: session.id }
      : EMPTY_STAGE;
    this.updateRuntime({ stage });
  }

  private setPhase(
    phase: HeroControllerPhase,
    session: HeroSession | null,
    background: ImageHeroBackgroundLocation | null,
    imageId = session?.snapshot.image.id ?? null,
  ) {
    this.updateRuntime({
      phase,
      sessionId: session?.id ?? null,
      imageId,
      background,
    });
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (phase.startsWith('opening')) root.dataset.imageHeroTransition = 'forward';
      else if (phase === 'closing.flight' || phase === 'reversing') {
        root.dataset.imageHeroTransition = 'back';
      } else {
        delete root.dataset.imageHeroTransition;
      }
      root.dataset.imageHeroState = phase;
    }
    this.notifyEvent();
  }

  private updateRuntime(patch: Partial<ImageHeroRuntimeState>) {
    const next = { ...this.runtime, ...patch };
    if (
      next.phase === this.runtime.phase &&
      next.sessionId === this.runtime.sessionId &&
      next.imageId === this.runtime.imageId &&
      next.stage === this.runtime.stage &&
      next.interactionQuiet === this.runtime.interactionQuiet &&
      next.background === this.runtime.background
    ) {
      return;
    }
    this.runtime = next;
    this.runtimeListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Runtime subscriptions are external; keep controller state coherent.
      }
    });
  }

  private notifyEvent() {
    this.eventListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // A stale waiter must not prevent other lifecycle observers settling.
      }
    });
  }

  private waitFor<T>({ read, signal, timeout }: WaitOptions<T>) {
    let immediate: T | null = null;
    try {
      immediate = read();
    } catch {
      return Promise.resolve(null);
    }
    if (immediate !== null) return Promise.resolve(immediate);
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise<T | null>((resolve) => {
      let timer = 0;
      let settled = false;
      const finish = (value: T | null) => {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        this.eventListeners.delete(check);
        signal?.removeEventListener('abort', abort);
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
      this.eventListeners.add(check);
      signal?.addEventListener('abort', abort, { once: true });
      if (timeout !== undefined) timer = window.setTimeout(() => finish(null), timeout);
      check();
    });
  }

  private runScheduledFrame<T>(session: HeroSession, task: ScheduledFrameTask<T>) {
    if (session.abort.signal.aborted) return Promise.resolve(false);
    const owner = {};
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        session.abort.signal.removeEventListener('abort', abort);
        resolve(value);
      };
      const abort = () => {
        heroFrameScheduler.cancel(owner);
        finish(false);
      };
      session.abort.signal.addEventListener('abort', abort, { once: true });
      heroFrameScheduler.request(owner, task);
      void heroFrameScheduler.settled().then(
        () => finish(!session.abort.signal.aborted),
        () => finish(false),
      );
      if (session.abort.signal.aborted) abort();
    });
  }

  private waitForFrame(signal?: AbortSignal, timeout = HERO_ROUTE_TIMEOUT_MS) {
    const lifecycleSignal = this.lifecycleAbort.signal;
    if (signal?.aborted || lifecycleSignal.aborted) return Promise.resolve(false);
    const owner = {};
    return new Promise<boolean>((resolve) => {
      let timer = 0;
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) window.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        lifecycleSignal.removeEventListener('abort', abort);
        heroFrameScheduler.cancel(owner);
        resolve(value);
      };
      const abort = () => finish(false);
      signal?.addEventListener('abort', abort, { once: true });
      lifecycleSignal.addEventListener('abort', abort, { once: true });
      timer = window.setTimeout(() => finish(false), timeout);
      heroFrameScheduler.request(owner, {
        read: () => undefined,
        write: () => finish(true),
      });
      if (signal?.aborted || lifecycleSignal.aborted) abort();
    });
  }

  private async waitForInputTransfer(
    session: HeroSession,
    sync?: () => void,
  ) {
    while (this.owns(session)) {
      const quiet = await waitForHeroInteractionQuiet(
        session.abort.signal,
        HERO_INPUT_TRANSFER_QUIET_MS,
      );
      if (!quiet || !this.owns(session)) return false;
      sync?.();
      if (!await this.waitForFrame(session.abort.signal)) return false;
      if (isHeroInteractionQuiet() && !hasActiveHeroInput()) return true;
    }
    return false;
  }

  private async waitForRouterCommit(expectedHref: string, signal?: AbortSignal) {
    const expected = normalizeHeroHref(expectedHref);
    const lifecycleSignal = this.lifecycleAbort.signal;
    const observed = await this.waitFor({
      signal,
      timeout: HERO_ROUTE_TIMEOUT_MS,
      read: () => lifecycleSignal.aborted
        ? false
        : this.observedHref === expected ? true : null,
    });
    if (observed !== true || lifecycleSignal.aborted) return false;
    for (let frame = 0; frame < 2; frame += 1) {
      if (!await this.waitForFrame(signal)) return false;
    }
    return !lifecycleSignal.aborted && !signal?.aborted && this.observedHref === expected;
  }

  private settleUnlessAborted<T>(promise: Promise<T>, signal: AbortSignal) {
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

  private hasMilestone(milestone: HeroMilestone, sessionId?: number) {
    if (sessionId !== undefined && this.sessionMilestones.get(sessionId)?.has(milestone)) {
      return true;
    }
    if (sessionId !== undefined && this.runtime.sessionId !== sessionId) {
      if (milestone !== 'idle') return false;
    }
    switch (milestone) {
      case 'route-registered':
        return Boolean(this.foreground?.kind === 'opening' && this.findOpeningRoute(this.foreground, false));
      case 'preview-paintable':
        return Boolean(this.foreground?.kind === 'opening' && this.findOpeningRoute(this.foreground, true));
      case 'landed':
        return this.runtime.phase === 'opening.landed' || this.runtime.phase === 'opening.handoff' || this.runtime.phase === 'detail-idle';
      case 'handoff-complete':
        return this.runtime.phase === 'detail-idle';
      case 'interaction-quiet':
        return this.runtime.interactionQuiet;
      case 'idle':
        return this.foreground === null && (
          this.runtime.phase === 'gallery-idle' || this.runtime.phase === 'detail-idle'
        );
    }
  }

  private resolveClosing(session: ClosingSession, outcome: ImageHeroCloseOutcome) {
    if (!session.resolveClose) return;
    const resolve = session.resolveClose;
    session.resolveClose = null;
    resolve(outcome);
  }
}

export const imageHeroController = new HeroController();
