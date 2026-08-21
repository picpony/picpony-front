'use client';

import {
  HERO_DETAIL_ROUTE_TIMEOUT_MS,
  HERO_INPUT_TRANSFER_QUIET_MS,
  HERO_ROUTE_TIMEOUT_MS,
  HERO_VIEWPORT_REBUILD_EPSILON_PX,
  SNAPSHOT_TTL,
} from './constants';
import {
  combineHeroLeases,
  findImageHeroThumbnail,
  getHeroBackgroundVisual,
  getHeroCornerRadius,
  getHeroRect,
  getHeroRectWithoutAncestorTransform,
  getVisualMedia,
  leaseHeroCardChrome,
  leaseHeroVisibility,
  leaseInlineStyles,
  type DomLease,
} from './dom';
import { captureHeroFrame } from './frameCache';
import { heroRectsEqual, type HeroRect } from './geometry';
import { bindHeroDismissGesture, type HeroPullRelease } from './gestures';
import {
  imageHeroHistory,
  normalizeHeroHref,
  type HeroHistoryNavigation,
  type HeroHistoryRecord,
} from './history';
import {
  hasActiveHeroInput,
  initializeHeroInput,
  isHeroInteractionQuiet,
  subscribeHeroInteraction,
  subscribeHeroViewportInvalidation,
  waitForHeroInputRelease,
  waitForHeroInteractionQuiet,
} from './input';
import { clearInactiveHeroBackground, HeroMotion } from './motion';
import { getElementScrollPlane, getGalleryScrollPlane, type HeroScrollPlane } from './plane';
import { createHeroFlight } from './flight';
import { HeroPullSurface } from './pull';
import { HeroRouteRegistry, type HeroRoute } from './routes';
import { heroFrameScheduler } from './scheduler';
import { HeroScrollContinuity } from './scroll';
import {
  HeroSignal,
  ResourceScope,
  runScheduledFrame,
  settleUnlessAborted,
  waitForFrame,
  waitForSignal,
  type Disposer,
} from './session';
import type {
  HeroCloseIntent,
  HeroControllerPhase,
  HeroDetailRouteChangeIntent,
  HeroNavigation,
  HeroOpenIntent,
  HeroRouteRegistration,
  HeroStageNodes,
  ImageHeroBackgroundLocation,
  ImageHeroCloseOutcome,
  ImageHeroRuntimeState,
  ImageHeroSnapshot,
  ImageHeroStageState,
} from './types';

/** Keeps the Stage scroller and the routed scroller at the same offset. */
type OpeningScrollBridge = {
  addTarget: (scroller: HTMLElement, content?: HTMLElement) => void;
  sync: () => void;
  returnToGallery: (scroller: HTMLElement) => void;
  release: () => void;
};

type ViewportBaseline = {
  destination: HeroRect;
  planeWidth: number;
  planeHeight: number;
};

type HeroSessionBase = {
  id: number;
  owner: symbol;
  kind: 'opening' | 'closing';
  snapshot: ImageHeroSnapshot;
  abort: AbortController;
  /** Released when the transaction ends, successfully or not. */
  shared: ResourceScope;
  /** Released only once the flyer is gone; outlives `shared` on a handoff. */
  visual: ResourceScope;
  motion: HeroMotion | null;
  scrollContinuity: HeroScrollContinuity | null;
  retired: boolean;
  reversing: boolean;
  pull: HeroPullSurface | null;
  pullSeized: boolean;
  viewportBaseline: ViewportBaseline | null;
};

type OpeningSession = HeroSessionBase & {
  kind: 'opening';
  intent: HeroOpenIntent;
  /** No flyer available; reconcile the URL only. */
  skipFlight: boolean;
  sourceRect: HeroRect;
  record: HeroHistoryRecord;
  /** Routes registered at or below this epoch predate the session. */
  routeFloor: number;
  routeNavigationStarted: boolean;
  provisionalClaimed: boolean;
  historyRestore: boolean;
  /** A detail view being closed as part of this same open (parallel handoff). */
  collapseRecord: HeroHistoryRecord | null;
  collapsePromise: Promise<boolean> | null;
  previousRoute: HeroRoute | null;
  previousRouteScroll: { left: number; top: number } | null;
  scrollBridge: OpeningScrollBridge | null;
  handoffRoute: HeroRoute | null;
  handoffVisual: DomLease | null;
  handoffCommitted: boolean;
  allowExistingRoute: boolean;
  backgroundRecovery: Promise<boolean> | null;
};

type ClosingSession = HeroSessionBase & {
  kind: 'closing';
  intent: HeroCloseIntent;
  record: HeroHistoryRecord;
  route: HeroRoute;
  thumbnail: HTMLElement;
  closePromise: Promise<ImageHeroCloseOutcome>;
  resolveClose: ((outcome: ImageHeroCloseOutcome) => void) | null;
  retirement: Promise<void> | null;
  routeScroll: { left: number; top: number };
};

type HeroSession = OpeningSession | ClosingSession;

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

const DETAIL_PATHNAME = /^\/pic\/(\d+)\/?$/;

function backgroundHref(background: ImageHeroBackgroundLocation) {
  return `${background.pathname}${background.search}`;
}

function currentBackground(): ImageHeroBackgroundLocation {
  return { pathname: window.location.pathname, search: window.location.search };
}

function defaultNavigation(): HeroNavigation {
  return {
    push: (href) => window.location.assign(href),
    replace: (href) => window.location.replace(href),
  };
}

/**
 * Measure a gallery element as if the background sink were at rest, so the
 * flyer lands on the box the thumbnail will occupy once the sink unwinds.
 */
function getGalleryLandingRect(element: HTMLElement) {
  return getHeroRectWithoutAncestorTransform(element, getHeroBackgroundVisual());
}

/**
 * Owns every Hero transaction.
 *
 * At most one transaction is in the foreground; a superseded close may linger as
 * `retiring` so its flyer can fade under the new one. Each transaction runs as
 * an async flow that re-checks `owns()` after every await, so losing ownership
 * at any suspension point unwinds cleanly rather than racing the winner.
 */
export class HeroController {
  private initialized = false;
  private sessionSequence = 0;
  private runtime = INITIAL_RUNTIME;
  private runtimeListeners = new Set<() => void>();
  private readonly events = new HeroSignal();
  private readonly routes = new HeroRouteRegistry(() => this.events.notify());
  private stage: { sessionId: number; nodes: HeroStageNodes } | null = null;
  private retainedStageVisuals = new Map<number, DomLease>();
  private foreground: HeroSession | null = null;
  private retiring: HeroSession | null = null;
  private pendingOpen: HeroOpenIntent | null = null;
  private detailRouteChange: Promise<boolean> | null = null;
  private detailRouteAbort: AbortController | null = null;
  private pendingDetailRouteChange: HeroDetailRouteChangeIntent | null = null;
  private routeChangeSequence = 0;
  private detailRecord: HeroHistoryRecord | null = null;
  private currentSnapshot: ImageHeroSnapshot | null = null;
  private observedHref = '';
  private router: HeroNavigation | null = null;
  private releaseHistory: Disposer | null = null;
  private releaseInteraction: Disposer | null = null;
  private releaseViewport: Disposer | null = null;
  private readonly viewportFrameOwner = {};
  private lifecycleAbort = new AbortController();

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  initialize(router?: HeroNavigation) {
    if (router) this.router = router;
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;
    initializeHeroInput();
    this.observedHref = normalizeHeroHref(window.location.href);
    this.releaseHistory = imageHeroHistory.initialize(this.handleHistoryNavigation);
    this.releaseInteraction = subscribeHeroInteraction(() => {
      this.updateRuntime({ interactionQuiet: isHeroInteractionQuiet() });
      this.events.notify();
    });
    this.releaseViewport = subscribeHeroViewportInvalidation(this.handleViewportInvalidation);
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('pageshow', this.handlePageShow);
    this.reconcileIdleLocation();
  }

  /** Test/HMR seam; production keeps one controller for the document's life. */
  destroy() {
    this.releaseHistory?.();
    this.releaseInteraction?.();
    this.releaseViewport?.();
    window.removeEventListener('pagehide', this.handlePageHide);
    window.removeEventListener('pageshow', this.handlePageShow);
    this.initialized = false;
  }

  // -------------------------------------------------------------------------
  // Observable state
  // -------------------------------------------------------------------------

  getRuntime = () => this.runtime;

  subscribeRuntime = (listener: () => void) => {
    this.runtimeListeners.add(listener);
    return () => this.runtimeListeners.delete(listener);
  };

  getStage = () => this.runtime.stage;

  subscribeStage = (listener: () => void) => this.subscribeRuntime(listener);

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

  waitForIdle(signal?: AbortSignal) {
    return waitForSignal(this.events, {
      signal,
      read: () =>
        this.foreground === null &&
        this.detailRouteChange === null &&
        (this.runtime.phase === 'gallery-idle' || this.runtime.phase === 'detail-idle')
          ? true
          : null,
    }).then(Boolean);
  }

  /**
   * Once a transaction has handed off, ordinary scrolling must not hold detail
   * data behind the transition gate. The flight itself still waits on input
   * quiet; this only gates publication after the route is stable.
   */
  isPublicationQuiet() {
    return (
      !this.detailRouteChange &&
      (this.runtime.phase === 'detail-idle' || this.runtime.phase === 'gallery-idle')
    );
  }

  isDetailDataPublishable(imageId: number) {
    if (this.detailRouteChange) return false;
    if (this.runtime.phase === 'gallery-idle') return true;
    if (this.runtime.phase === 'detail-idle') return this.runtime.imageId === imageId;
    return (
      this.runtime.phase.startsWith('opening.') &&
      this.foreground?.kind === 'opening' &&
      this.foreground.snapshot.image.id === imageId
    );
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  registerStage(sessionId: number, nodes: HeroStageNodes) {
    if (this.runtime.stage.sessionId !== sessionId) return () => {};
    const registration = { sessionId, nodes };
    this.stage = registration;
    this.events.notify();
    return () => {
      if (this.stage !== registration) return;
      this.stage = null;
      this.releaseRetainedStageVisual(sessionId);
      this.events.notify();
    };
  }

  registerRoute(registration: HeroRouteRegistration) {
    this.initialize();
    const route = this.routes.register(registration, normalizeHeroHref(window.location.href));

    const foreground = this.foreground;
    if (foreground?.kind === 'opening') {
      this.routes.seal(route, foreground.owner);
    } else if (this.runtime.phase === 'detail-idle') {
      const activeId = this.runtime.imageId;
      if (activeId !== null && route.imageId !== activeId) {
        this.routes.seal(route, this.routes.idleOwner);
      }
    } else {
      this.routes.seal(route, this.routes.idleOwner);
    }
    this.events.notify();
    return () => this.routes.unregister(route);
  }

  updateRouteTarget(surfaceId: string, target: HTMLElement | null) {
    const route = this.routes.get(surfaceId);
    if (!route) return;
    this.routes.setTarget(route, target);
    this.events.notify();
  }

  markRouteResolvedWithoutMedia(surfaceId: string) {
    const route = this.routes.get(surfaceId);
    if (!route || route.resolvedWithoutMedia) return;
    route.resolvedWithoutMedia = true;
    this.events.notify();
  }

  markRoutePreviewPaintable(surfaceId: string, target?: HTMLElement | null) {
    const route = this.routes.get(surfaceId);
    if (!route) return;
    if (target) this.routes.setTarget(route, target);
    route.previewPaintable = true;
    route.overlay.dataset.imageHeroPreview = 'paintable';
    this.events.notify();
  }

  observeRoute(href: string) {
    this.initialize();
    const normalized = normalizeHeroHref(href);
    if (normalized === this.observedHref) return;
    this.observedHref = normalized;
    this.routes.bumpEpoch();
    this.events.notify();

    if (this.detailRouteChange) return;
    const foreground = this.foreground;
    if (!foreground) {
      this.reconcileIdleLocation();
      return;
    }
    if (foreground.kind === 'opening') {
      const expected = normalizeHeroHref(foreground.intent.detailHref);
      if (normalized === expected) return;
      const background = normalizeHeroHref(backgroundHref(foreground.intent.background!));
      if (normalized === background) {
        // A close-A/open-B handoff deliberately traverses to the gallery before
        // pushing B. Every other observation of the opening background is a user
        // Back (including Safari's interactive edge swipe) and owns the reverse
        // even if popstate is delayed or coalesced.
        if (foreground.collapseRecord && !foreground.routeNavigationStarted) return;
      }
      void this.reverseOpening(foreground, true);
      return;
    }
    const detail = foreground.record.detailHref;
    const background = normalizeHeroHref(backgroundHref(foreground.record.background));
    if (normalized === detail || normalized === background) return;
    this.abandonClosing(foreground);
  }

  // -------------------------------------------------------------------------
  // Intents
  // -------------------------------------------------------------------------

  requestOpen(intent: HeroOpenIntent) {
    this.initialize();
    this.router = intent.navigation;
    if (!intent.snapshot.canAnimate || !intent.source.isConnected) return false;

    if (this.detailRouteChange) {
      this.queuePendingOpen(intent, this.detailRouteChange);
      return true;
    }

    const phase = this.runtime.phase;
    if (phase === 'opening.flight' || phase === 'opening.landed' || phase === 'opening.handoff') {
      const opening = this.foreground;
      if (opening?.kind === 'opening') {
        // One physical tap can arrive twice: the dismiss bridge synthesizes a
        // click from a pointerup whose hit test still pointed at the dead route,
        // and the browser then dispatches its own click once hit testing
        // refreshes onto the card. Re-activating the image that is already
        // flying must therefore be idempotent — treating the duplicate as
        // "open something else" reverses the very flight it just started, and
        // the unwind drops the queued intent, so the tap does nothing at all.
        if (opening.snapshot.image.id === intent.snapshot.image.id && !opening.reversing) {
          return true;
        }
        intent.background = opening.intent.background;
      }
      this.pendingOpen = intent;
      if (opening?.kind === 'opening' && !opening.reversing) {
        void this.reverseOpening(opening, false);
      }
      return true;
    }
    if (phase === 'reversing' || phase === 'recovering') {
      // The same duplicate can land mid-unwind; the queued intent already covers
      // it, so do not replace a pending open for this image with a second copy.
      if (this.pendingOpen?.snapshot.image.id === intent.snapshot.image.id) return true;
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
      // Hand the outgoing close's history record, route and scroll continuity to
      // the new open so B can start flying while A is still on screen.
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
      const retry = () =>
        this.requestClose({
          ...intent,
          imageId: this.runtime.imageId ?? intent.imageId,
        });
      return this.detailRouteChange.then(retry, retry);
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
      return this.detailRouteChange.then(
        () => {
          if (this.pendingDetailRouteChange !== intent) return false;
          this.pendingDetailRouteChange = null;
          return this.requestDetailRouteChange(intent);
        },
        () => false,
      );
    }
    if (this.foreground || this.runtime.phase !== 'detail-idle') return Promise.resolve(false);

    const abort = new AbortController();
    this.detailRouteAbort = abort;
    const operation = this.runDetailRouteChange(intent, abort.signal).catch((error) => {
      console.error('[hero] detail route reconciliation failed', error);
      return false;
    });
    this.detailRouteChange = operation;
    this.events.notify();
    void operation
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        if (this.detailRouteChange !== operation) return;
        this.detailRouteChange = null;
        if (this.detailRouteAbort === abort) this.detailRouteAbort = null;
        this.events.notify();
      });
    return operation;
  }

  interrupt(navigationHandled = false) {
    if (this.detailRouteChange) return false;
    const foreground = this.foreground;
    if (!foreground) return false;
    if (foreground.kind === 'opening') {
      void this.reverseOpening(foreground, navigationHandled);
    } else {
      void this.reverseClosing(foreground);
    }
    return true;
  }

  private queuePendingOpen(intent: HeroOpenIntent, gate: Promise<unknown>) {
    this.pendingOpen = intent;
    void gate
      .then(
        () => undefined,
        () => undefined,
      )
      .then(async () => {
        if (this.pendingOpen !== intent) return;
        /* The gate opening is not the same as the gallery being ready. A route
           commit can land a frame before the unwind finishes releasing the
           foreground, and a queued tap discarded there is a tap that did
           nothing — so wait the rest of the way out rather than testing once. */
        if (this.runtime.phase !== 'gallery-idle' || this.foreground) {
          if (!(await this.waitForGalleryIdle())) {
            if (this.pendingOpen === intent) this.pendingOpen = null;
            return;
          }
        }
        if (this.pendingOpen !== intent) return;
        this.pendingOpen = null;
        if (!intent.source.isConnected) return;
        this.startOpening(intent);
      });
  }

  // -------------------------------------------------------------------------
  // Dismiss gestures
  // -------------------------------------------------------------------------

  bindRouteDismiss(surfaceId: string, canStart: () => boolean, navigation: HeroNavigation) {
    const route = this.routes.get(surfaceId);
    if (!route) return () => {};

    const pull = new HeroPullSurface(
      { overlay: route.overlay, floatingBack: route.floatingBack },
      { acquireLease: () => this.leaseRouteThumbnail(route) },
    );
    route.pull = pull;

    const active = () =>
      this.runtime.phase === 'detail-idle' && this.runtime.imageId === route.imageId;
    const release = bindHeroDismissGesture({
      target: route.scroller,
      scroller: route.scroller,
      canStart: () => this.prepareRouteDismiss(route) && canStart(),
      onPull: (sample) => {
        if (active()) pull.apply(sample);
      },
      onCancel: ({ sample, velocity }: HeroPullRelease) => pull.settle(sample, velocity),
      onCommit: ({ sample }: HeroPullRelease) => {
        pull.commit(sample);
        void this.requestClose({
          imageId: route.imageId,
          navigation,
          backgroundMode: 'continue',
          cause: 'dismiss',
        });
      },
    });

    return () => {
      release();
      pull.dispose();
      if (route.pull === pull) route.pull = null;
    };
  }

  /** Hide the gallery card the detail will collapse back into. */
  private leaseRouteThumbnail(route: HeroRoute) {
    const record = this.detailRecord;
    const thumbnail =
      findImageHeroThumbnail(
        route.imageId,
        record?.imageId === route.imageId ? record.snapshot.sourceKey : undefined,
      ) ?? findImageHeroThumbnail(route.imageId);
    if (!thumbnail) return null;
    return combineHeroLeases(leaseHeroCardChrome(thumbnail), leaseHeroVisibility(thumbnail, false));
  }

  /**
   * A drag on a route that is still mid-handoff means the user has already
   * accepted it; commit the handoff so the gesture acts on a settled surface.
   */
  private prepareRouteDismiss(route: HeroRoute) {
    const foreground = this.foreground;
    if (
      this.runtime.phase === 'opening.handoff' &&
      foreground?.kind === 'opening' &&
      foreground.handoffRoute === route
    ) {
      this.completeOpeningHandoff(foreground);
    }
    return this.runtime.phase === 'detail-idle' && this.runtime.imageId === route.imageId;
  }

  private bindOpeningDismiss(session: OpeningSession, stage: HeroStageNodes) {
    const pull = new HeroPullSurface(
      { overlay: stage.overlay, floatingBack: stage.floatingBack },
      {
        onOffset: (distance) => session.motion?.setPullOffset(distance),
        onSeize: () => {
          session.pullSeized = true;
          // Hand the background sink and reveal cascade to the gesture.
          session.motion?.releaseShared();
        },
      },
    );
    session.pull = pull;

    const release = bindHeroDismissGesture({
      target: stage.overlay,
      // The Stage overlay is pointer-transparent by design, so listen wider.
      listenTarget: window,
      scroller: stage.scroller,
      canStart: () => this.owns(session) && !session.reversing,
      onPull: (sample) => {
        if (this.owns(session)) pull.apply(sample);
      },
      onCancel: async ({ sample, velocity }: HeroPullRelease) => {
        await pull.settle(sample, velocity);
        // A fresh drag during the settle keeps the surface claimed.
        if (!pull.isActive) session.pullSeized = false;
        this.events.notify();
      },
      onCommit: ({ sample }: HeroPullRelease) => {
        pull.commit(sample);
        void this.reverseOpening(session, false);
      },
    });

    session.shared.add(() => {
      release();
      session.pullSeized = false;
    });
    // The gesture presentation is torn down with the flyer, not with the
    // listeners. Holding it through a committed dismiss lets the closing fade
    // start from the opacity the finger left behind instead of snapping back to
    // fully opaque for one frame first.
    session.visual.add(() => {
      pull.dispose();
      if (session.pull === pull) session.pull = null;
    });
  }

  // -------------------------------------------------------------------------
  // Opening
  // -------------------------------------------------------------------------

  private startOpening(
    intent: HeroOpenIntent,
    options: {
      collapseRecord?: HeroHistoryRecord;
      previousRoute?: HeroRoute;
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
    const record =
      options.historyRecord ??
      imageHeroHistory.createRecord(intent.snapshot, background, intent.detailHref, id);
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
      pull: null,
      pullSeized: false,
      viewportBaseline: null,
      sourceRect: getHeroRect(intent.source),
      record,
      routeFloor: this.routes.currentEpoch,
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

    // Plant a same-URL history entry now: it is a synchronous Back barrier while
    // the App Router is still preparing its asynchronous route commit.
    if (!session.historyRestore && !session.collapseRecord && !session.provisionalClaimed) {
      session.provisionalClaimed = imageHeroHistory.claim(record);
    }

    this.foreground = session;
    this.routes.sealAllExcept(null, session.owner);
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
        if (!this.startRouteNavigation(session)) {
          await this.reverseOpening(session, false);
          return;
        }
      }

      if (session.skipFlight) {
        await this.recoverOpeningWithoutFlight(session, collapse);
        return;
      }

      const stage = await waitForSignal<HeroStageNodes>(this.events, {
        signal: session.abort.signal,
        timeout: 1000,
        read: () => (this.stage?.sessionId === session.id ? this.stage.nodes : null),
      });
      if (!this.owns(session)) return;
      if (!stage || !intent.source.isConnected) {
        await this.recoverOpeningWithoutFlight(session, collapse);
        return;
      }

      this.launchFlight(session, stage);

      await session.motion!.landed;
      if (!this.owns(session)) return;
      this.setStage('landed', session);
      this.setPhase('opening.landed', session, intent.background!);

      if (collapse && !(await this.commitParallelCollapse(session, collapse))) return;

      const route = await waitForSignal<HeroRoute>(this.events, {
        signal: session.abort.signal,
        // Post-landing: see HERO_DETAIL_ROUTE_TIMEOUT_MS. Reversing here would
        // undo a navigation the user has already seen complete.
        timeout: HERO_DETAIL_ROUTE_TIMEOUT_MS,
        read: () => this.findOpeningRoute(session, true),
      });
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

  private launchFlight(session: OpeningSession, stage: HeroStageNodes) {
    const { intent } = session;
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

    session.motion = new HeroMotion({
      flight,
      from: session.sourceRect,
      to: targetRect,
      direction: 'forward',
      background: getHeroBackgroundVisual(),
      overlay: stage.overlay,
      floatingBack: stage.floatingBack,
      continueBackground: Boolean(session.collapseRecord),
      // The container grows from the card itself, not from the picture's landing box:
      // `_rectTween.end = Offset.zero & navSize` — the whole surface, not the media slot.
      container: {
        card: session.sourceRect,
        cardRadius: getHeroCornerRadius(intent.source),
      },
      choreography: 'container',
    });

    session.viewportBaseline = {
      destination: targetRect,
      planeWidth: plane.viewportWidth,
      planeHeight: plane.viewportHeight,
    };
    this.bindOpeningScroll(session, stage);
    this.bindOpeningDismiss(session, stage);
  }

  /** Push the detail URL, guarded by the provisional history barrier. */
  private startRouteNavigation(session: OpeningSession) {
    if (!session.provisionalClaimed) return false;
    session.routeNavigationStarted = true;
    session.intent.navigation.push(session.intent.detailHref);
    return true;
  }

  /**
   * Finish collapsing the previously-open detail, then claim history for this
   * one. Shared by the flying and the flightless recovery paths.
   */
  private async commitParallelCollapse(session: OpeningSession, collapse: Promise<boolean>) {
    const collapsed = await collapse;
    if (!this.owns(session)) return false;
    if (!collapsed) {
      await this.failParallelOpen(session);
      return false;
    }
    if (
      !(await this.waitForRouterCommit(
        backgroundHref(session.collapseRecord!.background),
        session.abort.signal,
      ))
    ) {
      await this.failParallelOpen(session);
      return false;
    }
    if (!this.owns(session)) return false;

    imageHeroHistory.forget(session.collapseRecord!);
    session.routeFloor = this.routes.currentEpoch;
    session.provisionalClaimed = imageHeroHistory.claim(session.record);
    if (!this.startRouteNavigation(session)) {
      await this.failParallelOpen(session);
      return false;
    }
    return true;
  }

  /**
   * Swap the Stage for the real route in a single frame.
   *
   * The route's scroll position is written and the Stage is hidden inside one
   * batched read/write pass so no frame can show both or neither.
   */
  private async handoffOpening(session: OpeningSession, route: HeroRoute, stage: HeroStageNodes) {
    if (!this.owns(session) || !session.motion) return;
    this.setPhase('opening.handoff', session, session.intent.background!);

    if (session.pullSeized) {
      const settled = await waitForSignal(this.events, {
        signal: session.abort.signal,
        read: () => (session.pullSeized ? null : true),
      });
      if (!settled || !this.owns(session) || !session.motion) return;
    }

    if (!(await this.establishOpeningGuard(session))) {
      if (this.owns(session)) await this.reverseOpening(session, false);
      return;
    }

    session.scrollBridge?.addTarget(route.scroller, route.content);
    session.scrollBridge?.sync();

    let routeRevealed = false;
    await runScheduledFrame(session.abort.signal, {
      read: () => stage.scroller.scrollTop,
      write: (scrollTop) => {
        if (!this.owns(session)) return;
        route.scroller.scrollTop = scrollTop;
        if (!this.routes.reveal(route, session.owner)) return;
        session.handoffRoute = route;
        routeRevealed = true;
        const visual = combineHeroLeases(
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

    if (!(await this.waitForInputTransfer(session, () => session.scrollBridge?.sync()))) return;
    this.completeOpeningHandoff(session);
  }

  private completeOpeningHandoff(session: OpeningSession) {
    if (
      session.handoffCommitted ||
      this.foreground !== session ||
      session.reversing ||
      !session.handoffRoute
    ) {
      return false;
    }
    session.handoffCommitted = true;
    session.abort.abort();
    session.scrollBridge?.release();
    session.handoffRoute = null;
    session.motion?.dispose();
    session.motion = null;
    session.visual.dispose();
    this.clearBackgroundVisual();

    // The pointer shield outlives the transaction: it keeps the unmounting Stage
    // from swallowing the first tap on the freshly revealed route.
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
    this.setPhase('detail-idle', null, session.intent.background!, session.snapshot.image.id);
    this.events.notify();
    return true;
  }

  /**
   * Install the base/guard history pair for this detail view. The guard entry is
   * what lets a browser Back run the closing animation before the URL changes.
   */
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

  /** No flyer (no stage, disconnected source, or a history restore): URL only. */
  private async recoverOpeningWithoutFlight(
    session: OpeningSession,
    collapse: Promise<boolean> | null,
  ) {
    if (!this.owns(session)) return;
    this.setPhase('recovering', session, session.intent.background!);

    if (collapse) {
      if (!(await this.commitParallelCollapse(session, collapse))) return;
    } else if (!session.routeNavigationStarted && !this.startRouteNavigation(session)) {
      await this.reverseOpening(session, false);
      return;
    }

    const committed = await waitForSignal(this.events, {
      signal: session.abort.signal,
      timeout: HERO_ROUTE_TIMEOUT_MS,
      read: () =>
        this.observedHref === normalizeHeroHref(session.intent.detailHref) ? true : null,
    });
    if (!this.owns(session)) return;
    if (!committed) {
      await this.reverseOpening(session, false);
      return;
    }

    session.scrollBridge?.release();
    session.scrollContinuity?.release();
    session.scrollContinuity = null;
    session.shared.dispose();
    session.visual.dispose();

    const onDetail = normalizeHeroHref(window.location.href) === session.record.detailHref;
    if (!(onDetail && (await this.establishOpeningGuard(session)))) {
      if (this.owns(session)) await this.reverseOpening(session, false);
      return;
    }

    const route =
      this.findOpeningRoute(session, false) ??
      this.routes.findByImage(session.snapshot.image.id, normalizeHeroHref(window.location.href));
    if (route) this.routes.reveal(route, route.sealOwner);
    this.retainStagePointerShield(session.id);
    this.detailRecord = session.record;
    this.currentSnapshot = session.snapshot;
    this.foreground = null;
    this.setStage('idle', null);
    this.setPhase('detail-idle', null, session.intent.background!, session.snapshot.image.id);
    this.events.notify();
  }

  /** The parallel collapse failed; fall back to whichever view still exists. */
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

    // Measure before flipping any state; the pose must reflect what is on screen
    // at the instant of the interruption for the reverse to be continuous.
    const source = session.intent.source.isConnected
      ? session.intent.source
      : findImageHeroThumbnail(session.snapshot.image.id, session.snapshot.sourceKey);
    const measurement =
      session.motion && source
        ? {
            destination: getGalleryLandingRect(source),
            plane: getGalleryScrollPlane() ?? undefined,
            pose: session.motion.measurePose(),
          }
        : null;

    session.reversing = true;
    session.abort.abort();

    if (session.handoffRoute) {
      if (session.handoffVisual) {
        session.shared.release(session.handoffVisual);
        session.handoffVisual = null;
      }
      this.routes.seal(session.handoffRoute, session.owner);
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
      // Supersede the still-pending App Router replace immediately. Waiting for
      // the visual reverse would let a late detail commit win on WebKit.
      session.intent.navigation.replace(backgroundHref(session.intent.background!));
    }

    const galleryScroller = measurement?.plane?.scroller ?? getGalleryScrollPlane()?.scroller;
    if (galleryScroller) session.scrollBridge?.returnToGallery(galleryScroller);
    this.setPhase('reversing', session, session.intent.background!);
    session.shared.dispose();

    try {
      if (session.motion && measurement) {
        await session.motion.reverse(measurement.destination, measurement.plane, measurement.pose);
      }
    } catch {
      // A canceled reverse still proceeds through deterministic cleanup.
    }
    if (this.foreground !== session) return;

    const onBackground = await this.returnToBackground(session, navigationHandled);
    if (this.foreground !== session) return;

    // Never tear down the flyer while a finger is still down: the user would see
    // the thumbnail reappear under their own touch.
    const released = await waitForHeroInputRelease(this.lifecycleAbort.signal);
    if (!released || this.foreground !== session) return;

    this.retainStagePointerShield(session.id);
    session.motion?.dispose();
    session.motion = null;
    session.scrollBridge?.release();
    session.scrollContinuity?.release();
    session.scrollContinuity = null;
    session.visual.dispose();
    this.clearBackgroundVisual();

    const recordToRestore =
      restoreRecord ??
      (session.collapseRecord &&
      normalizeHeroHref(window.location.href) === session.collapseRecord.detailHref
        ? session.collapseRecord
        : null);
    if (recordToRestore) {
      await this.restorePreviousDetail(session, recordToRestore);
      return;
    }

    if (this.foreground === session) this.foreground = null;
    this.setStage('idle', null);
    this.events.notify();
    if (onBackground) this.setPhase('gallery-idle', null, null);
    else this.reconcileIdleLocation();

    const pending = this.pendingOpen;
    this.pendingOpen = null;
    if (!pending) return;
    /* Wait for the gallery to be idle rather than testing for it once.
     *
     * The queued tap used to be dropped on any of three single-shot conditions:
     * `onBackground` false, the router commit not confirming inside its window,
     * or `gallery-idle` not happening to hold at that instant. Tapping a second
     * image while the first was flying home therefore did nothing at all about
     * a third of the time — the flight unwound, the queue was cleared, and the
     * tap vanished. Which is why it read as "it plays a little of the animation
     * and then just goes back".
     *
     * `queuePendingOpen` already owns the "start it once the gate opens" shape,
     * so this hands the intent straight to it instead of arbitrating again. */
    if (!onBackground) {
      this.queuePendingOpen(pending, this.waitForGalleryIdle());
      return;
    }
    this.queuePendingOpen(
      pending,
      this.waitForRouterCommit(backgroundHref(session.intent.background!)),
    );
  }

  /** Resolves as soon as nothing is flying and the gallery is the live view. */
  private waitForGalleryIdle() {
    return waitForSignal(this.events, {
      timeout: HERO_ROUTE_TIMEOUT_MS,
      read: () =>
        this.lifecycleAbort.signal.aborted
          ? false
          : !this.foreground && this.runtime.phase === 'gallery-idle'
            ? true
            : null,
    });
  }

  /**
   * Walk history back to the gallery. Which traversal applies depends on how far
   * the open actually got before it was interrupted, so each fallback is tried
   * in turn until one confirms we are standing on the background entry.
   */
  private async returnToBackground(session: OpeningSession, navigationHandled: boolean) {
    let onBackground = session.backgroundRecovery
      ? await session.backgroundRecovery
      : navigationHandled && this.isRecordBackground(session.record);

    // Recovery ran but did not land: force the URL back and confirm the commit.
    if (!onBackground && session.backgroundRecovery) {
      const href = backgroundHref(session.intent.background!);
      session.intent.navigation.replace(href);
      onBackground = await this.waitForRouterCommit(href);
    }

    if (!onBackground && session.collapseRecord && !session.routeNavigationStarted) {
      // Never navigated: the only thing to undo is the collapse already started.
      onBackground = await (session.collapsePromise ??
        imageHeroHistory.ensureBackground(session.collapseRecord));
      if (onBackground) imageHeroHistory.forget(session.collapseRecord);
    } else if (navigationHandled && session.provisionalClaimed) {
      // The browser moved us; collapse whatever ladder we managed to build.
      onBackground = await imageHeroHistory.ensureBackground(session.record);
    } else if (!navigationHandled && session.routeNavigationStarted) {
      // We moved ourselves and must undo it.
      onBackground =
        session.historyRestore || session.provisionalClaimed
          ? await imageHeroHistory.ensureBackground(session.record)
          : await imageHeroHistory.returnUnmarkedToBackground(
              session.intent.background!,
              session.record.token,
            );
    }
    return onBackground;
  }

  /** A parallel open failed: put the detail view it was replacing back. */
  private async restorePreviousDetail(session: OpeningSession, record: HeroHistoryRecord) {
    const route = session.previousRoute?.overlay.isConnected
      ? session.previousRoute
      : this.routes.findByImage(record.imageId, normalizeHeroHref(window.location.href));
    route?.pull?.reset();

    const restored = await this.restoreGuardStrict(record);
    if (this.foreground !== session) return;

    this.foreground = null;
    this.pendingOpen = null;
    this.setStage('idle', null);
    this.events.notify();

    if (!restored) {
      if (route) this.routes.seal(route, this.routes.idleOwner);
      this.reconcileIdleLocation();
      return;
    }
    if (route) {
      if (session.previousRouteScroll) {
        route.scroller.scrollLeft = session.previousRouteScroll.left;
        route.scroller.scrollTop = session.previousRouteScroll.top;
      }
      this.routes.reveal(route, route.sealOwner);
    }
    this.detailRecord = record;
    this.currentSnapshot = record.snapshot;
    this.setPhase('detail-idle', null, record.background, record.imageId);
  }

  // -------------------------------------------------------------------------
  // Closing
  // -------------------------------------------------------------------------

  private async startClosing(intent: HeroCloseIntent): Promise<ImageHeroCloseOutcome> {
    const record = this.currentDetailRecord(intent.imageId, true);
    if (!record) {
      this.detailRecord = null;
      this.currentSnapshot = null;
      window.history.back();
      return 'handled';
    }

    const route = this.routes.findByImage(intent.imageId, normalizeHeroHref(window.location.href));
    const thumbnail = route?.target
      ? (findImageHeroThumbnail(intent.imageId, record.snapshot.sourceKey) ??
        findImageHeroThumbnail(intent.imageId))
      : null;
    const plane = thumbnail ? getGalleryScrollPlane() : null;

    // Nothing to fly between: fall back to an ordinary history collapse.
    if (!route?.target || !thumbnail || !plane) {
      const closed = await imageHeroHistory.ensureBackground(record);
      if (closed && this.isRecordBackground(record)) return 'closed';
      return (await this.restoreGuardStrict(record)) ? 'restored' : 'handled';
    }

    // Capture what the detail is showing right now, so the return flight starts
    // from the real pixels rather than the stale activation snapshot.
    const liveAsset =
      captureHeroFrame(getVisualMedia(route.target)) ?? record.snapshot.previewFrame;
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
      pull: null,
      pullSeized: false,
      viewportBaseline: null,
      record,
      route,
      thumbnail,
      closePromise,
      resolveClose,
      retirement: null,
      routeScroll: { left: route.scroller.scrollLeft, top: route.scroller.scrollTop },
    };
    this.foreground = session;
    this.setPhase('closing.flight', session, record.background);
    void this.runClosing(session, plane);
    return closePromise;
  }

  private async runClosing(session: ClosingSession, plane: HeroScrollPlane) {
    const { route, thumbnail } = session;
    if (session.retired || !this.owns(session)) {
      this.resolveClosing(session, 'handled');
      return;
    }
    try {
      const from = getHeroRect(route.target!);
      const to = getGalleryLandingRect(thumbnail);

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
      session.visual.add(this.routes.sealTarget(route));
      session.visual.add(leaseHeroCardChrome(thumbnail));
      session.visual.add(leaseHeroVisibility(thumbnail, false));
      session.shared.add(this.routes.freeze(route, session.owner));

      session.motion = new HeroMotion({
        flight,
        from,
        to,
        direction: 'back',
        background: getHeroBackgroundVisual(),
        overlay: route.overlay,
        floatingBack: route.floatingBack,
        continueBackground: session.intent.backgroundMode === 'continue',
        container: { card: to, cardRadius: getHeroCornerRadius(thumbnail) },
        // A swipe-down is already a motion the hand started, so it keeps the gesture's pose
        // instead of the container return.
        choreography: session.intent.cause === 'dismiss' ? 'dismiss' : 'container',
      });

      session.viewportBaseline = {
        destination: to,
        planeWidth: plane.viewportWidth,
        planeHeight: plane.viewportHeight,
      };

      await session.motion.landed;
      if (!(await this.guardClosing(session))) return;

      if (!(await this.waitForInputTransfer(session))) {
        if (session.retired) await this.ensureRetirement(session);
        return;
      }

      const closed =
        this.isRecordBackground(session.record) ||
        (await imageHeroHistory.ensureBackground(session.record));
      if (!(await this.guardClosing(session))) return;
      if (!closed || !this.isRecordBackground(session.record)) {
        await this.reverseClosing(session);
        return;
      }

      const committed = await this.waitForRouterCommit(
        backgroundHref(session.record.background),
        session.abort.signal,
      );
      if (!(await this.guardClosing(session))) return;
      if (!committed) {
        await this.reverseClosing(session);
        return;
      }
      if (!(await this.waitForInputTransfer(session))) {
        if (session.retired) await this.ensureRetirement(session);
        return;
      }

      session.route.pull?.reset();
      session.motion.dispose();
      session.motion = null;
      session.scrollContinuity?.release();
      session.scrollContinuity = null;
      session.shared.dispose();
      session.visual.dispose();
      this.routes.seal(route, session.owner);
      this.clearBackgroundVisual();

      this.foreground = null;
      this.currentSnapshot = null;
      this.detailRecord = session.record;
      this.setPhase('gallery-idle', null, null);
      this.events.notify();
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

  /** True while the close may still proceed; handles retirement bookkeeping. */
  private async guardClosing(session: ClosingSession) {
    if (session.retired) {
      await this.ensureRetirement(session);
      this.resolveClosing(session, 'handled');
      return false;
    }
    if (!this.owns(session)) return false;
    return true;
  }

  private async reverseClosing(session: ClosingSession) {
    if (session.retired || session.reversing || !this.owns(session)) {
      if (session.retired) this.resolveClosing(session, 'handled');
      return;
    }
    const routeTarget = session.route.target;
    const measurement =
      session.motion && routeTarget?.isConnected
        ? {
            destination: getHeroRect(routeTarget),
            pose: session.motion.measurePose(),
          }
        : null;

    session.reversing = true;
    session.abort.abort();
    this.setPhase('reversing', session, session.record.background);

    try {
      if (session.motion && measurement) {
        await session.motion.reverse(measurement.destination, undefined, measurement.pose);
      }
    } catch {
      // Continue restoring the real route even if the visual reverse was cut.
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

    session.route.pull?.reset();
    session.motion?.dispose();
    session.motion = null;
    session.scrollContinuity?.release();
    session.scrollContinuity = null;
    session.shared.dispose();
    session.visual.dispose();
    this.clearBackgroundVisual();
    if (this.foreground === session) this.foreground = null;
    this.events.notify();

    if (restored) {
      session.route.scroller.scrollLeft = session.routeScroll.left;
      session.route.scroller.scrollTop = session.routeScroll.top;
      this.routes.reveal(session.route, session.owner);
      this.currentSnapshot = session.record.snapshot;
      this.detailRecord = session.record;
      this.setPhase('detail-idle', null, session.record.background, session.record.imageId);
      this.resolveClosing(session, 'restored');
      return;
    }
    this.routes.seal(session.route, this.routes.idleOwner);
    this.reconcileIdleLocation();
    this.resolveClosing(session, 'handled');
  }

  /**
   * Demote a close so a new open can start immediately. The old flyer keeps
   * flying underneath and fades out; both are on screen at once by design.
   */
  private retireClosing(session: ClosingSession) {
    if (!this.owns(session)) return;
    if (this.retiring) this.disposeRetiring(this.retiring);
    session.retired = true;
    session.abort.abort();
    session.shared.dispose();
    this.routes.seal(session.route, session.owner);
    session.motion?.retire();
    // The incoming open owns the background sink now.
    session.route.pull?.reset(false);
    this.retiring = session;
    this.foreground = null;
    this.events.notify();
    this.resolveClosing(session, 'handled');
    void this.ensureRetirement(session);
  }

  private ensureRetirement(session: ClosingSession) {
    if (session.retirement) return session.retirement;
    const motion = session.motion;
    session.retirement = (
      motion ? motion.landed.then(() => motion.fadeRetiring()) : Promise.resolve()
    )
      .catch(() => undefined)
      .then(() => this.finishRetiring(session));
    return session.retirement;
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

  private disposeRetiring(session: HeroSession) {
    session.abort.abort();
    if (session.kind === 'closing') this.resolveClosing(session, 'handled');
    this.finishRetiring(session);
  }

  /** The location moved somewhere unrelated; drop the close without animating. */
  private abandonClosing(session: ClosingSession) {
    if (this.foreground !== session) return;
    session.abort.abort();
    session.motion?.dispose();
    session.motion = null;
    session.scrollContinuity?.release();
    session.scrollContinuity = null;
    session.shared.dispose();
    session.visual.dispose();
    session.route.pull?.reset();
    this.routes.seal(session.route, this.routes.idleOwner);
    this.foreground = null;
    this.events.notify();
    this.resolveClosing(session, 'handled');
    this.clearBackgroundVisual();
    this.reconcileIdleLocation();
  }

  private resolveClosing(session: ClosingSession, outcome: ImageHeroCloseOutcome) {
    const resolve = session.resolveClose;
    if (!resolve) return;
    session.resolveClose = null;
    resolve(outcome);
  }

  // -------------------------------------------------------------------------
  // Scroll bridging
  // -------------------------------------------------------------------------

  /**
   * Keep the Stage and the routed scroller in lockstep across the handoff, and
   * grow the Stage to the real content height so a scroll started on the Stage
   * does not hit a shorter bottom than the route it becomes.
   */
  private bindOpeningScroll(session: OpeningSession, stage: HeroStageNodes) {
    const sizeOwner = {};
    const continuity = session.scrollContinuity ?? new HeroScrollContinuity(stage.scroller);
    continuity.replacePeers(stage.scroller);
    session.scrollContinuity = continuity;

    let targetScroller: HTMLElement | null = null;
    let targetContent: HTMLElement | null = null;
    let heightLease: DomLease | null = null;
    let released = false;
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => syncHeight());

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
          const next = leaseInlineStyles(stage.content, { minHeight: `${Math.ceil(height)}px` });
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
        // The browser may still be delivering a wheel stream to the old
        // scroller; keep it as a delta source so that momentum is not lost.
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

  // -------------------------------------------------------------------------
  // Detail ↔ detail navigation
  // -------------------------------------------------------------------------

  private async runDetailRouteChange(intent: HeroDetailRouteChangeIntent, signal: AbortSignal) {
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
      // An unowned detail route has no base/guard pair to reconcile; preserve
      // the browser's ordinary in-place previous/next semantics.
      if (signal.aborted) return false;
      intent.navigation.replace(intent.detailHref);
      const observed = await waitForSignal(this.events, {
        signal,
        timeout: HERO_ROUTE_TIMEOUT_MS,
        read: () => (this.observedHref === targetHref ? true : null),
      });
      return Boolean(observed);
    }

    const currentRoute = this.routes.findByImage(
      record.imageId,
      normalizeHeroHref(window.location.href),
    );
    const collapsed = await settleUnlessAborted(imageHeroHistory.ensureBackground(record), signal);
    if (signal.aborted) return false;
    if (!collapsed || !this.isRecordBackground(record)) {
      await this.restoreDetailAfterFailedChange(record, currentRoute, signal);
      return false;
    }

    try {
      if (signal.aborted) return false;
      intent.navigation.replace(intent.detailHref);
    } catch {
      await this.restoreDetailAfterFailedChange(record, currentRoute, signal);
      return false;
    }

    this.routes.sealAllExcept(null, this.routes.idleOwner);
    this.setPhase('recovering', null, record.background, record.imageId);
    const observed = await waitForSignal(this.events, {
      signal,
      timeout: HERO_ROUTE_TIMEOUT_MS,
      read: () => (this.observedHref === targetHref ? true : null),
    });
    if (!observed || signal.aborted || sequence !== this.routeChangeSequence) {
      const activeRoute = this.routes.findByImage(
        intent.imageId,
        normalizeHeroHref(window.location.href),
      );
      if (activeRoute) this.routes.reveal(activeRoute, activeRoute.sealOwner);
      this.reconcileIdleLocation();
      return false;
    }

    imageHeroHistory.forget(record);
    this.detailRecord = null;
    this.currentSnapshot = null;
    const route = this.routes.findByImage(intent.imageId, normalizeHeroHref(window.location.href));
    if (route) this.routes.reveal(route, route.sealOwner);
    this.setPhase('detail-idle', null, record.background, intent.imageId);
    return true;
  }

  private async restoreDetailAfterFailedChange(
    record: HeroHistoryRecord,
    route: HeroRoute | null,
    signal: AbortSignal,
  ) {
    const restored = await this.restoreGuardStrict(record);
    if (signal.aborted) return;
    if (restored) {
      this.detailRecord = record;
      this.currentSnapshot = record.snapshot;
      if (route) this.routes.reveal(route, route.sealOwner);
      this.setPhase('detail-idle', null, record.background, record.imageId);
      return;
    }
    if (route) this.routes.seal(route, this.routes.idleOwner);
    this.reconcileIdleLocation();
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  private handleHistoryNavigation = (navigation: HeroHistoryNavigation) => {
    const foreground = this.foreground;

    if (foreground?.kind === 'opening') {
      const background = normalizeHeroHref(backgroundHref(foreground.intent.background!));
      if (navigation.href === background) {
        const ownsParallelCollapse = Boolean(
          navigation.programmatic &&
          foreground.collapseRecord &&
          !foreground.routeNavigationStarted &&
          navigation.programmaticToken === foreground.collapseRecord.token,
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
          // Back skipped past the provisional barrier; recover the gallery entry.
          foreground.backgroundRecovery ??= imageHeroHistory.recoverSkippedBackground(
            foreground.record,
          );
        }
        void this.reverseOpening(foreground, true);
      }
      return;
    }

    if (navigation.programmatic) {
      // A timed-out traversal can land after its session finalized. Reconcile the
      // observable location rather than leaving a stale detail-idle runtime on
      // the gallery, which would poison the next rapid open.
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

    if (!navigation.record) {
      // Refresh/BFCache can retain marker state without a live record. Collapse
      // the pair as ordinary navigation; never invent an animation for it.
      if (navigation.marker) {
        if (navigation.previous === 'guard' && navigation.position === 'base') {
          void imageHeroHistory.collapseOrphanMarker(navigation.marker);
        }
        return;
      }
      this.reconcileIdleLocation();
      return;
    }

    // Back from the guard entry: the user asked to close, so animate it.
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

    // Forward into a detail entry: replay the open.
    const arrivingFromGallery =
      navigation.previous === 'background' || navigation.previous === 'unknown';
    const enteringDetail =
      navigation.position === 'base' ||
      navigation.position === 'guard' ||
      navigation.position === 'provisional';
    if (!arrivingFromGallery || !enteringDetail) return;
    if (navigation.position === 'guard') {
      this.reconcileIdleLocation();
      return;
    }
    this.replayHistoryOpen(navigation);
  };

  private replayHistoryOpen(navigation: HeroHistoryNavigation) {
    const record = navigation.record!;
    const source =
      findImageHeroThumbnail(record.imageId, record.snapshot.sourceKey) ??
      findImageHeroThumbnail(record.imageId);
    const provisional = navigation.position === 'provisional';
    const intent: HeroOpenIntent = {
      snapshot: record.snapshot,
      source: source ?? document.documentElement,
      detailHref: record.detailHref,
      background: record.background,
      navigation: this.router ?? defaultNavigation(),
      historyRestore: provisional ? undefined : true,
    };
    const options = {
      historyRecord: record,
      provisionalClaimed: provisional,
      allowExistingRoute: true,
      // Without a thumbnail there is nothing to fly from.
      skipFlight: !source,
    };

    if (!provisional) {
      this.startOpening(intent, options);
      return;
    }

    // A provisional entry is only half a navigation; wait for the router to
    // settle before deciding which way this actually went.
    void this.waitForRouterCommit(navigation.href).then((committed) => {
      if (!committed) return;
      const marker = imageHeroHistory.currentMarker();
      if (this.foreground || this.detailRouteChange || marker?.token !== record.token) return;

      const role = imageHeroHistory.currentRole();
      const href = normalizeHeroHref(window.location.href);
      const galleryHref = normalizeHeroHref(backgroundHref(record.background));
      if (role === 'guard') {
        this.reconcileIdleLocation();
        return;
      }
      if (role === 'base' && href === record.detailHref) {
        this.startOpening(
          { ...intent, historyRestore: true },
          { ...options, provisionalClaimed: false, routeNavigationStarted: true },
        );
        return;
      }
      if (role !== 'provisional' || (href !== galleryHref && href !== record.detailHref)) return;
      this.startOpening(intent, {
        ...options,
        routeNavigationStarted: href === record.detailHref,
      });
    });
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

  /** Reinstate the guard entry, retrying once history settles. */
  private async restoreGuardStrict(record: HeroHistoryRecord) {
    if (imageHeroHistory.isGuard(record)) return true;
    if ((await imageHeroHistory.restoreGuard(record)) && imageHeroHistory.isGuard(record)) {
      return true;
    }
    if (!(await imageHeroHistory.waitForStable())) return false;
    if (imageHeroHistory.isGuard(record)) return true;
    return (await imageHeroHistory.restoreGuard(record)) && imageHeroHistory.isGuard(record);
  }

  /** Derive phase purely from the observable location, with no session running. */
  private reconcileIdleLocation() {
    const detailMatch = window.location.pathname.match(DETAIL_PATHNAME);
    if (!detailMatch) {
      this.detailRecord = null;
      this.currentSnapshot = null;
      this.routes.sealAllExcept(null);
      this.setPhase('gallery-idle', null, null);
      return;
    }

    const activeId = Number(detailMatch[1]);
    const record = this.currentDetailRecord(activeId);
    if (record?.imageId === activeId && !imageHeroHistory.isGuard(record)) {
      // On a detail URL but without the guard entry: a transaction is still
      // reconciling, so do not present this as a settled detail view.
      this.detailRecord = record;
      this.currentSnapshot = record.snapshot;
      this.routes.sealAllExcept(null);
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
    const activeRoute = this.routes.findByImage(activeId, normalizeHeroHref(window.location.href));
    if (activeRoute) this.routes.reveal(activeRoute, activeRoute.sealOwner);
    this.routes.sealAllExcept(activeRoute);
    this.setPhase('detail-idle', null, record?.background ?? null, activeId);
  }

  // -------------------------------------------------------------------------
  // Page lifecycle
  // -------------------------------------------------------------------------

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
    for (const route of this.routes.values()) route.pull?.reset();

    this.foreground = null;
    this.stage = null;
    this.detailRouteAbort?.abort();
    this.detailRouteAbort = null;
    this.detailRouteChange = null;
    this.pendingDetailRouteChange = null;
    this.pendingOpen = null;
    this.setStage('idle', null);
    this.setPhase('gallery-idle', null, null);
    this.events.notify();
    heroFrameScheduler.cancel(this.viewportFrameOwner);
    heroFrameScheduler.dispose();
    this.clearBackgroundVisual();
  };

  private handlePageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    this.lifecycleAbort = new AbortController();
    initializeHeroInput();
    this.observedHref = normalizeHeroHref(window.location.href);
    this.reconcileIdleLocation();
  };

  /**
   * Re-aim a live flight after a real viewport size change.
   *
   * Measurement happens in the scheduler's read phase and the rebuild in its
   * write phase, and an unchanged destination is skipped entirely, so a resize
   * storm cannot turn into a per-frame spring restart.
   */
  private handleViewportInvalidation = () => {
    const session = this.foreground;
    if (!session?.motion) return;
    heroFrameScheduler.request(this.viewportFrameOwner, {
      read: () => {
        const motion = session.motion;
        if (!motion) return null;
        if (session.kind === 'opening') {
          const stage = this.stage?.sessionId === session.id ? this.stage.nodes : null;
          if (!stage?.target.isConnected) return null;
          return {
            // The Stage's landing target sits inside the container transform's fit, so a
            // mid-flight read is the scaled box; undo the fit before re-aiming.
            destination: motion.unprojectRect(getHeroRect(stage.target)),
            plane: getElementScrollPlane(stage.anchor, stage.scroller),
            pose: motion.measurePose(),
          };
        }
        const plane = getGalleryScrollPlane();
        if (!session.thumbnail.isConnected || !plane) return null;
        return {
          destination: getGalleryLandingRect(session.thumbnail),
          plane,
          pose: motion.measurePose(),
        };
      },
      write: (measurement) => {
        if (!measurement || !this.owns(session) || !session.motion) return;
        const baseline = session.viewportBaseline;
        if (
          baseline &&
          baseline.planeWidth === measurement.plane.viewportWidth &&
          baseline.planeHeight === measurement.plane.viewportHeight &&
          heroRectsEqual(
            baseline.destination,
            measurement.destination,
            HERO_VIEWPORT_REBUILD_EPSILON_PX,
          )
        ) {
          return;
        }
        session.viewportBaseline = {
          destination: measurement.destination,
          planeWidth: measurement.plane.viewportWidth,
          planeHeight: measurement.plane.viewportHeight,
        };
        session.motion.rebuild(measurement.destination, measurement.plane, measurement.pose);
      },
    });
  };

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  private owns(session: HeroSession) {
    return this.foreground === session && !session.retired && !session.reversing;
  }

  private findOpeningRoute(session: OpeningSession, requirePreview: boolean) {
    return this.routes.findForSession(
      session.snapshot.image.id,
      normalizeHeroHref(session.intent.detailHref),
      {
        floor: session.routeFloor,
        requirePreview,
        allowExisting: session.allowExistingRoute,
      },
    );
  }

  private clearBackgroundVisual() {
    clearInactiveHeroBackground(getHeroBackgroundVisual());
  }

  private releaseRetainedStageVisual(sessionId: number) {
    const visual = this.retainedStageVisuals.get(sessionId);
    if (!visual) return;
    this.retainedStageVisuals.delete(sessionId);
    visual.release();
  }

  /**
   * Keep the outgoing Stage from eating the first tap meant for the route that
   * replaced it. Released when the Stage actually unmounts.
   */
  private retainStagePointerShield(sessionId: number) {
    const stage = this.stage?.sessionId === sessionId ? this.stage.nodes : null;
    if (!stage) return;
    const shield = combineHeroLeases(
      leaseInlineStyles(stage.overlay, { pointerEvents: 'none' }),
      leaseInlineStyles(stage.scroller, { pointerEvents: 'none' }),
    );
    this.retainedStageVisuals.get(sessionId)?.release();
    this.retainedStageVisuals.set(sessionId, shield);
  }

  /**
   * Wait until the browser has genuinely stopped delivering input to the old
   * scroller, then confirm across a frame. A wheel stream stays latched to its
   * original receiver, so releasing early makes the rest of that stream vanish.
   */
  private async waitForInputTransfer(session: HeroSession, sync?: () => void) {
    while (this.owns(session)) {
      const quiet = await waitForHeroInteractionQuiet(
        session.abort.signal,
        HERO_INPUT_TRANSFER_QUIET_MS,
      );
      if (!quiet || !this.owns(session)) return false;
      sync?.();
      if (
        !(await waitForFrame(
          [session.abort.signal, this.lifecycleAbort.signal],
          HERO_ROUTE_TIMEOUT_MS,
        ))
      )
        return false;
      if (isHeroInteractionQuiet() && !hasActiveHeroInput()) return true;
    }
    return false;
  }

  /** Resolve once the App Router has actually painted the expected location. */
  private async waitForRouterCommit(expectedHref: string, signal?: AbortSignal) {
    const expected = normalizeHeroHref(expectedHref);
    const lifecycleSignal = this.lifecycleAbort.signal;
    const observed = await waitForSignal(this.events, {
      signal,
      timeout: HERO_ROUTE_TIMEOUT_MS,
      read: () => (lifecycleSignal.aborted ? false : this.observedHref === expected ? true : null),
    });
    if (observed !== true || lifecycleSignal.aborted) return false;
    // Two frames: one for the commit, one for the resulting paint.
    const signals = signal ? [signal, lifecycleSignal] : [lifecycleSignal];
    for (let frame = 0; frame < 2; frame += 1) {
      if (!(await waitForFrame(signals, HERO_ROUTE_TIMEOUT_MS))) return false;
    }
    return !lifecycleSignal.aborted && !signal?.aborted && this.observedHref === expected;
  }

  // -------------------------------------------------------------------------
  // Runtime publication
  // -------------------------------------------------------------------------

  private setStage(phase: ImageHeroStageState['phase'], session: OpeningSession | null) {
    this.updateRuntime({
      stage: session ? { phase, snapshot: session.snapshot, sessionId: session.id } : EMPTY_STAGE,
    });
  }

  private setPhase(
    phase: HeroControllerPhase,
    session: HeroSession | null,
    background: ImageHeroBackgroundLocation | null,
    imageId = session?.snapshot.image.id ?? null,
  ) {
    this.updateRuntime({ phase, sessionId: session?.id ?? null, imageId, background });
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
    this.events.notify();
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
}

export const imageHeroController = new HeroController();
