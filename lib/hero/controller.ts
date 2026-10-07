'use client';

import {
  HERO_BACKGROUND_SELECTOR,
  HERO_DETAIL_ROUTE_TIMEOUT_MS,
  HERO_INPUT_TRANSFER_MAX_MS,
  HERO_INPUT_TRANSFER_QUIET_MS,
  HERO_ROUTE_TIMEOUT_MS,
  HERO_VIEWPORT_REBUILD_EPSILON_PX,
  SNAPSHOT_TTL,
} from './constants';
import {
  combineHeroLeases,
  findImageHeroCardLink,
  findImageHeroThumbnail,
  getHeroBackgroundVisual,
  getHeroCornerRadius,
  getHeroRect,
  getHeroRectWithoutAncestorTransform,
  getVisualMedia,
  isHeroThumbnailInView,
  leaseAttribute,
  leaseHeroCardChrome,
  leaseHeroVisibility,
  leaseInlineStyles,
  type DomLease,
} from './dom';
import { revealInImageSequence } from '@/lib/imageSequence';
import { captureHeroFrame, type FrameAsset } from './frameCache';
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
  type HeroInteractionQuietResult,
} from './input';
import { clearInactiveHeroBackground, HeroMotion } from './motion';
import { getElementScrollPlane, getGalleryScrollPlane, type HeroScrollPlane } from './plane';
import { createHeroFlight } from './flight';
import { HeroPullSurface } from './pull';
import { HeroRouteRegistry, type HeroRoute } from './routes';
import {
  bindImageHeroEngine,
  getImageHeroRuntime,
  INITIAL_HERO_RUNTIME,
  publishImageHeroRuntime,
  subscribeImageHeroRuntime,
} from './runtime';
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
  HeroDetailStepIntent,
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

type StepTarget = {
  imageId: number;
  detailHref: string;
  snapshot: ImageHeroSnapshot;
};

/** Upper bound on the detail's own step transition, after which its swap is assumed done. */
const STEP_SWAP_TIMEOUT_MS = 2000;
/**
 * How long the history half of a step may wait for an idle slice once the swap has landed. The
 * rewrite is two router commits (the traversal onto the base entry, then its new URL), and each
 * re-renders every subscriber to the location — the list under the viewer included. Run beside
 * the swap, they landed inside the step's own frames (measured in development: the outgoing half
 * started 200ms after the press, behind them). After the swap they cost nothing anyone sees, and a
 * run of presses rewrites once, for the picture it stops on.
 */
const STEP_SYNC_IDLE_TIMEOUT_MS = 600;
/**
 * The ceiling on a close waiting for the list to bring a stepped-to card into view. Only a
 * fallback: the wait is sized by the list itself, whose `reveal` resolves once the card is in the
 * DOM — a turned page of fifty cards takes a while to mount on a slow device (900ms was short for
 * one in development, and the close gave up and went flightless with the card a frame away).
 */
const STEP_REVEAL_TIMEOUT_MS = 4000;
/** After the list says the card is there, how long it may take to scroll into view. */
const STEP_REVEAL_SETTLE_MS = 500;
/**
 * How long a card the list revealed on a close may wait for the detail to leave before taking
 * focus (`focusRevealedCard`). A ceiling only: the detail is gone within one closing flight.
 */
const REVEAL_FOCUS_TIMEOUT_MS = 3000;
const MAX_BACKGROUND_SCROLLS = 32;
/** An idle slice arrives within a frame or two once a landing settles; this only bounds a busy page. */
const BACKGROUND_SCROLL_READ_TIMEOUT_MS = 1000;
/** How long a remounted list may take to grow back to the offset it is being returned to. */
const BACKGROUND_SCROLL_RESTORE_MS = 1500;

/* The store's own idle stage, so an idle update compares equal to the initial state. */
const EMPTY_STAGE: ImageHeroStageState = INITIAL_HERO_RUNTIME.stage;

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
  private readonly events = new HeroSignal();
  private readonly routes = new HeroRouteRegistry(() => this.events.notify());
  private stage: { sessionId: number; nodes: HeroStageNodes } | null = null;
  private retainedStageVisuals = new Map<number, DomLease>();
  private foreground: HeroSession | null = null;
  private retiring: HeroSession | null = null;
  private pendingOpen: HeroOpenIntent | null = null;
  /**
   * The history half of an in-place step (上一张 / 下一张): rewriting the ladder to name the
   * picture on screen. Settles `true` once the URL names the latest target.
   */
  private detailStep: Promise<boolean> | null = null;
  private detailStepAbort: AbortController | null = null;
  /** Holds the history half until the swap has landed and the main thread is quiet. */
  private stepSyncGate: { arm(): void; open(): void } | null = null;
  /** The picture the running step is heading for; the latest press wins. */
  private stepTarget: StepTarget | null = null;
  /** The detail's own visual swap is still ahead of it; `flush` completes it at once. */
  private stepSwap: { imageId: number; flush: () => void } | null = null;
  private stepSwapTimer = 0;
  /** `data-image-hero-leaving` on each detail surface a `back` leg is leaving. */
  private leavingLeases = new Map<HTMLElement, DomLease>();
  /** The list's offset under the viewer, per viewer history entry (R12-017). */
  private backgroundScrolls = new Map<string, number>();
  private pendingBackgroundScroll: { key: string; top: number } | null = null;
  private cancelBackgroundScrollRead: Disposer | null = null;
  /** A close waiting for the list to bring its card into view (`startClosing`). */
  private closePreparation: Promise<ImageHeroCloseOutcome> | null = null;
  /** The frame a card the list revealed is waiting in for the detail to leave (`focusRevealedCard`). */
  private revealFocusFrame = 0;
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
    /* `this.events.notify()` and nothing else. The published runtime must not fold in
       `interactionQuiet` — no consumer reads it, and every quiet↔active transition would
       re-render all three `useSyncExternalStore` subscribers, one of which lands in the task
       immediately preceding a press. Internal waiters get the signal via `events`. */
    this.releaseInteraction = subscribeHeroInteraction(() => {
      this.events.notify();
    });
    this.releaseViewport = subscribeHeroViewportInvalidation(this.handleViewportInvalidation);
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('pageshow', this.handlePageShow);
    this.reconcileIdleLocation();
  }

  /** Test/HMR seam; production keeps one controller for the document's life. */
  destroy() {
    /* Never initialised (a server render evaluates this module too, and a development reload
       rebinds there): nothing was attached, and `window` may not exist. */
    if (!this.initialized || typeof window === 'undefined') return;
    this.cancelRevealFocus();
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

  /** The published state lives in `./runtime`, so the shell can read it without the engine. */
  private get runtime() {
    return getImageHeroRuntime();
  }

  getRuntime = () => getImageHeroRuntime();

  subscribeRuntime = (listener: () => void) => subscribeImageHeroRuntime(listener);

  getStage = () => getImageHeroRuntime().stage;

  subscribeStage = (listener: () => void) => subscribeImageHeroRuntime(listener);

  getOrigin(imageId: number) {
    const snapshot = this.currentSnapshot;
    if (!snapshot || snapshot.image.id !== imageId) return null;
    return Date.now() - snapshot.createdAt < SNAPSHOT_TTL ? snapshot : null;
  }

  isRunning() {
    return Boolean(this.foreground || this.detailStep);
  }

  /** A flight (or a pull's settle into one) owns the screen — the one thing a step waits for. */
  hasForeground() {
    return Boolean(this.foreground);
  }

  /** Resolves once no flight owns the screen (a step's own history half does not count). */
  waitForFlightIdle(signal?: AbortSignal) {
    return waitForSignal(this.events, {
      signal,
      read: () => (this.foreground === null ? true : null),
    }).then(Boolean);
  }

  waitForIdle(signal?: AbortSignal) {
    return waitForSignal(this.events, {
      signal,
      read: () =>
        this.foreground === null &&
        this.detailStep === null &&
        (this.runtime.phase === 'gallery-idle' || this.runtime.phase === 'detail-idle')
          ? true
          : null,
    }).then(Boolean);
  }

  /**
   * Once a transaction has handed off, ordinary scrolling must not hold detail
   * data behind the transition gate. The flight itself still waits on input
   * quiet; this only gates publication after the route is stable.
   *
   * A step never gates publication: it has no flight to protect, and the picture it lands on
   * is published the moment the step starts. (Its history half used to — and cleared that gate
   * without telling the runtime's subscribers, so a publication scheduled during it could stay
   * blocked until something unrelated moved: R10-013.)
   */
  isPublicationQuiet() {
    return this.runtime.phase === 'detail-idle' || this.runtime.phase === 'gallery-idle';
  }

  isDetailDataPublishable(imageId: number) {
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
    this.syncLeaving();
    this.events.notify();
    return () => {
      if (this.stage !== registration) return;
      this.stage = null;
      this.releaseRetainedStageVisual(sessionId);
      this.syncLeaving();
      this.events.notify();
    };
  }

  /**
   * A detail surface. Its `href` is the detail URL the surface presents — `/pic/<id>` — not the
   * location at the moment it mounted: a step swaps the picture on the same surface while the
   * URL is rewritten behind it, and a surface keyed on a location it had already left was found
   * by nothing (`findByImage`) and sealed as a stranger.
   */
  registerRoute(registration: HeroRouteRegistration) {
    this.initialize();
    const route = this.routes.register(
      registration,
      normalizeHeroHref(`/pic/${registration.imageId}`),
    );

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
    this.syncLeaving();
    this.events.notify();
    return () => {
      this.routes.unregister(route);
      this.syncLeaving();
    };
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

    /* A step owns the state it is producing: the URL it rewrote commits before the detail has
       swapped its picture, and reconciling there would seal the surface still showing the old
       one. Whichever of the two halves finishes last reconciles (`settleStep`). */
    if (this.detailStep || this.stepSwap) return;
    const foreground = this.foreground;
    if (!foreground) {
      this.reconcileIdleLocation();
      this.applyPendingBackgroundScroll();
      this.rememberBackgroundScroll();
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

    if (this.detailStep) {
      this.queuePendingOpen(intent, this.detailStep);
      return true;
    }

    const phase = this.runtime.phase;
    if (phase === 'opening.flight' || phase === 'opening.landed' || phase === 'opening.handoff') {
      const opening = this.foreground;
      if (opening?.kind === 'opening') {
        // One physical tap can arrive twice: the dismiss bridge synthesizes a
        // click from a pointerup whose hit test still pointed at the dead route.
        // Re-activating the image already flying must be idempotent — treating
        // the duplicate as "open something else" reverses the flight it just
        // started, and the unwind drops the queued intent, so the tap does nothing.
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
      /* The picture flying home, tapped again ("no, keep it open"), turns the close around from
         its live pose, the way Back then Forward always did (R10-006). Retiring it and flying a
         fresh open out of the card snapped the picture ~240px onto the thumbnail in one frame,
         held, then launched from rest, with two copies of it on screen meanwhile. A *different*
         card still retires this close and opens beside it. */
      if (
        closing.record.imageId === intent.snapshot.image.id &&
        (!closing.snapshot.sourceKey || closing.snapshot.sourceKey === intent.snapshot.sourceKey)
      ) {
        if (!closing.reversing) void this.reverseClosing(closing);
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
    if (this.closePreparation) return this.closePreparation;
    if (this.detailStep) {
      // The picture about to be on screen is the one that closes: finish the swap now, then let
      // the (brief) history rewrite land — now, not at the next idle slice — before measuring.
      this.flushStepSwap();
      this.stepSyncGate?.open();
      const retry = () =>
        this.requestClose({
          ...intent,
          imageId: this.runtime.imageId ?? intent.imageId,
        });
      return this.detailStep.then(retry, retry);
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

  // -------------------------------------------------------------------------
  // Detail <-> detail: 上一张 / 下一张
  // -------------------------------------------------------------------------

  /**
   * Step the open viewer to another picture of the list it was opened from, **in place**: never a
   * navigation (decision 19; R10-001 / R10-002 / R4-002).
   *
   * Answers synchronously: `false` when no step can start now (a flight is running, or the detail
   * on screen is not the one `fromId` names). Otherwise the target is the published picture from
   * this instant (its data may publish, a close closes it) while the detail runs its own
   * transition and reports the swap (`settleDetailStep`), and the history ladder is rewritten
   * behind it to name the target (`imageHeroHistory.retarget`): no entry added, the overlay never
   * unmounted, Back still closes the viewer to the list.
   *
   * The rewrite waits for the swap to land and for an idle slice (`STEP_SYNC_IDLE_TIMEOUT_MS`), or
   * runs at once when a close needs the ladder. The promise settles `true` once the URL names the
   * latest target — or once a traversal of the user's overtook it, which then owns the screen —
   * and `false` when the ladder could not be rewritten; the viewer is then reconciled from the
   * location, and the detail returns to the picture the URL still names.
   */
  requestDetailStep(intent: HeroDetailStepIntent): Promise<boolean> | false {
    this.initialize();
    if (
      this.foreground ||
      this.closePreparation ||
      this.runtime.phase !== 'detail-idle' ||
      this.runtime.imageId !== intent.fromId
    ) {
      return false;
    }
    this.stepTarget = {
      imageId: intent.toId,
      detailHref: normalizeHeroHref(`/pic/${intent.toId}`),
      snapshot: intent.snapshot,
    };
    this.currentSnapshot = intent.snapshot;
    this.stepSwap = { imageId: intent.toId, flush: intent.flush };
    if (this.stepSwapTimer) window.clearTimeout(this.stepSwapTimer);
    this.stepSwapTimer = window.setTimeout(() => {
      this.stepSwapTimer = 0;
      if (this.stepSwap?.imageId === intent.toId) this.settleDetailStep(intent.toId);
    }, STEP_SWAP_TIMEOUT_MS);
    this.setPhase('detail-idle', null, this.runtime.background, intent.toId);
    return this.detailStep ?? this.startStepSync();
  }

  /**
   * The page presentation's 返回 after a reload with the overlay open (R10-003): the ladder the
   * overlay pushed survives in history with no live record behind it. Collapse it to the list it
   * was opened from — the entry the user came from, its search and page intact — instead of
   * pushing a new entry on top. `null` when this entry carries no ladder; otherwise the collapse,
   * which resolves `false` if the traversal did not land (the caller then goes to `background`).
   */
  leaveOrphanLadder(): { background: string; collapsed: Promise<boolean> } | null {
    const marker = imageHeroHistory.currentMarker();
    if (!marker || imageHeroHistory.recordForToken(marker.token)) return null;
    return {
      background: backgroundHref(marker.background),
      collapsed: imageHeroHistory.collapseOrphanMarker(marker),
    };
  }

  /** The detail has painted the picture a step was heading for (or gave up on its transition). */
  settleDetailStep(imageId: number) {
    if (this.stepSwap?.imageId !== imageId) return;
    this.stepSwap = null;
    if (this.stepSwapTimer) window.clearTimeout(this.stepSwapTimer);
    this.stepSwapTimer = 0;
    this.stepSyncGate?.arm();
    this.settleStep();
  }

  interrupt(navigationHandled = false) {
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
        /* The gate opening is not the same as the gallery being ready: a route commit can
           land a frame before the unwind finishes releasing the foreground, and a queued tap
           discarded there is a tap that did nothing. Wait the rest of the way out. */
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
        // The recognizer has already coalesced this into the scheduler's write phase.
        if (active()) pull.applyImmediate(sample);
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
        if (this.owns(session)) pull.applyImmediate(sample);
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
    // A picture opening owns focus from here; a card revealed by the last close no longer asks.
    this.cancelRevealFocus();
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
      const frame = session.snapshot.previewFrame;
      if (!stage || !intent.source.isConnected || !frame) {
        await this.recoverOpeningWithoutFlight(session, collapse);
        return;
      }

      this.launchFlight(session, stage, frame);

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

  private launchFlight(session: OpeningSession, stage: HeroStageNodes, frame: FrameAsset) {
    const { intent } = session;
    const plane = getElementScrollPlane(stage.anchor, stage.scroller, stage.overlay);
    const targetRect = getHeroRect(stage.target);
    const flight = createHeroFlight({
      asset: frame,
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
      /* Bounded; on expiry the drag is reset rather than the handoff abandoned. A backstop —
         the recognizer does terminate reliably — but the one wait in the handoff that must
         have a ceiling, since everything downstream (route reveal, pointer shield,
         publication) is gated on reaching it. */
      const settled = await waitForSignal(this.events, {
        signal: session.abort.signal,
        timeout: HERO_ROUTE_TIMEOUT_MS,
        read: () => (session.pullSeized ? null : true),
      });
      if (!this.owns(session) || !session.motion) return;
      if (!settled) {
        session.pull?.reset();
        session.pullSeized = false;
      }
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
        session.scrollContinuity?.setInputTarget(route.scroller);
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
    this.rememberBackgroundScroll();
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
    this.rememberBackgroundScroll();
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
    /* Wait for the gallery to be idle rather than testing once: the queued tap
       used to be dropped whenever a single-shot condition happened not to hold
       (background not reached, commit window missed, idle not current). */
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
    this.rememberBackgroundScroll();
  }

  // -------------------------------------------------------------------------
  // Closing
  // -------------------------------------------------------------------------

  private startClosing(intent: HeroCloseIntent): Promise<ImageHeroCloseOutcome> {
    // Already waiting for the list (a Back arriving during a button's close): one close.
    if (this.closePreparation) return this.closePreparation;
    // A step still mid-transition swaps now: the close measures the picture about to be shown.
    this.flushStepSwap();
    const record = this.currentDetailRecord(intent.imageId, true);
    if (!record) {
      /* A viewer with no ladder (opened without a flight) closes by history alone, and there is
         nothing to land on — but the list still follows it to the picture on screen, turning its
         own page after the close if 上一张 / 下一张 carried the viewer past it. Not awaited:
         with no flight to aim, the close has no reason to wait for the list. */
      void this.revealInList(intent.imageId);
      this.detailRecord = null;
      this.currentSnapshot = null;
      window.history.back();
      return Promise.resolve('handled');
    }

    const route = this.routes.findByImage(intent.imageId, normalizeHeroHref(window.location.href));
    const findThumbnail = () =>
      findImageHeroThumbnail(intent.imageId, record.snapshot.sourceKey) ??
      findImageHeroThumbnail(intent.imageId);
    const thumbnail = route?.target ? findThumbnail() : null;
    if (!route?.target || isHeroThumbnailInView(thumbnail)) {
      return this.beginClosing(intent, record, route, thumbnail);
    }

    /* The card is off screen or not in the list at all — after 上一张 / 下一张 it usually is
       (the list stayed on the page it was opened from). Ask the list to bring it into view first;
       it turns its own page under the overlay and resolves once the card is in the DOM, which is
       what the wait is sized by. The ceiling only bounds a list that never answers: that costs a
       flightless close, never a hang. */
    const preparation = (async (): Promise<ImageHeroCloseOutcome> => {
      const revealed = await Promise.race([
        this.revealInList(intent.imageId),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), STEP_REVEAL_TIMEOUT_MS)),
      ]);
      // In the DOM is not yet on screen: the list's own scroll to it may still be settling.
      let shown = revealed ? findThumbnail() : null;
      const settleBy = performance.now() + STEP_REVEAL_SETTLE_MS;
      while (revealed && !isHeroThumbnailInView(shown) && performance.now() < settleBy) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        shown = findThumbnail();
      }
      if (
        this.foreground ||
        this.runtime.phase !== 'detail-idle' ||
        this.currentDetailRecord(intent.imageId, true) !== record
      ) {
        return 'handled';
      }
      return this.beginClosing(intent, record, route, isHeroThumbnailInView(shown) ? shown : null);
    })();
    this.closePreparation = preparation;
    void preparation.finally(() => {
      if (this.closePreparation === preparation) this.closePreparation = null;
    });
    return preparation;
  }

  /**
   * Asks the list to show the picture on screen as the viewer closes (`revealInImageSequence`),
   * and hands that card focus once the detail has gone.
   *
   * After 上一张 / 下一张 carried the viewer past the page it was opened from, the overlay's own
   * focus return (`useOverlayLayer`) can run before the list has turned its page: it falls back to
   * the card the viewer was opened from, and the page turn then unmounts that card, leaving focus
   * on the document.
   */
  private revealInList(imageId: number): Promise<boolean> {
    const reveal = revealInImageSequence(imageId).catch(() => false);
    void reveal.then((revealed) => {
      if (revealed) this.focusRevealedCard(imageId);
    });
    return reveal;
  }

  /**
   * The revealed card takes focus without scrolling — the reveal owns the position — and only
   * while focus is lost: a choice made in the list meanwhile, or a dialog, keeps it. Until the
   * detail has gone, focus is the overlay's and the list under it is inert, so this waits for it.
   */
  private focusRevealedCard(imageId: number) {
    this.cancelRevealFocus();
    const deadline = performance.now() + REVEAL_FOCUS_TIMEOUT_MS;
    const attempt = () => {
      this.revealFocusFrame = 0;
      if (performance.now() > deadline) return;
      const detailMounted = [...this.routes.values()].some((route) => route.overlay.isConnected);
      if (this.foreground || this.runtime.phase !== 'gallery-idle' || detailMounted) {
        this.revealFocusFrame = requestAnimationFrame(attempt);
        return;
      }
      const active = document.activeElement;
      /* A landing is not a choice: the overlay's fallback (`focusPageLanding`) may have put the
         focus on the page's heading — marked `data-route-focus` — while the list was still turning
         to this card, and the card the reader left is where it belongs. A focus the reader placed
         in the list meanwhile carries no marker and stays. */
      const chosen = active instanceof HTMLElement && active !== document.body && active.isConnected
        && !active.hasAttribute('data-route-focus');
      if (chosen) return;
      const link = findImageHeroCardLink(imageId);
      if (link && !link.closest('[inert]')) link.focus({ preventScroll: true });
    };
    this.revealFocusFrame = requestAnimationFrame(attempt);
  }

  private cancelRevealFocus() {
    if (this.revealFocusFrame) cancelAnimationFrame(this.revealFocusFrame);
    this.revealFocusFrame = 0;
  }

  private async beginClosing(
    intent: HeroCloseIntent,
    record: HeroHistoryRecord,
    route: HeroRoute | null,
    thumbnail: HTMLElement | null,
  ): Promise<ImageHeroCloseOutcome> {
    const plane = thumbnail ? getGalleryScrollPlane() : null;
    // Capture what the detail is showing right now, so the return flight starts
    // from the real pixels rather than the stale activation snapshot.
    const liveAsset = route?.target
      ? (captureHeroFrame(getVisualMedia(route.target)) ?? record.snapshot.previewFrame)
      : null;

    // Nothing to fly between: fall back to an ordinary history collapse.
    if (!route?.target || !thumbnail || !plane || !liveAsset) {
      const closed = await imageHeroHistory.ensureBackground(record);
      if (closed && this.isRecordBackground(record)) return 'closed';
      return (await this.restoreGuardStrict(record)) ? 'restored' : 'handled';
    }

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
    /* The leaving detail lets go of input in the same task as the gallery gets it back: the phase
       below takes the gallery out of `inert`, and while the overlay was still a live modal layer
       its focus trap pulled a focus the user had just given the gallery back into the detail —
       for the two frames the flight waits before it starts (`runClosing`). */
    session.shared.add(this.routes.freeze(route, session.owner));
    this.setPhase('closing.flight', session, record.background);
    void this.runClosing(session, plane);
    return closePromise;
  }

  private async runClosing(session: ClosingSession, measuredPlane: HeroScrollPlane) {
    const { route, thumbnail } = session;
    if (session.retired || !this.owns(session)) {
      this.resolveClosing(session, 'handled');
      return;
    }
    try {
      /* The close has just changed what the shell renders around the detail: the gallery leaves
         `inert`, which restyles every card (1,450 elements and ~66ms measured on a desktop,
         several times that on a phone). Launched in the same frame, the flight's first frame was
         presented that late with its clock already running, so the head of the leg never
         showed. The first frame carries the restyle; the flight starts on the second. */
      const signals = [session.abort.signal, this.lifecycleAbort.signal];
      await waitForFrame(signals, HERO_ROUTE_TIMEOUT_MS);
      await waitForFrame(signals, HERO_ROUTE_TIMEOUT_MS);
      if (!(await this.guardClosing(session))) return;
      const asset = session.snapshot.previewFrame;
      if (!route.target?.isConnected || !thumbnail.isConnected || !asset) {
        await this.abandonToCollapse(session);
        return;
      }
      const plane = getGalleryScrollPlane() ?? measuredPlane;
      const from = getHeroRect(route.target);
      const to = getGalleryLandingRect(thumbnail);

      const scrollContinuity = new HeroScrollContinuity(plane.scroller);
      scrollContinuity.addDeltaSource(route.scroller);
      session.scrollContinuity = scrollContinuity;

      const flight = createHeroFlight({
        asset,
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

  /**
   * The close cannot fly after all — its surfaces went away during the frames it waited for the
   * shell to restyle. Collapse the ladder as an ordinary Back instead.
   */
  private async abandonToCollapse(session: ClosingSession) {
    if (this.foreground !== session) return;
    session.abort.abort();
    session.shared.dispose();
    session.visual.dispose();
    this.foreground = null;
    this.events.notify();
    const closed = await imageHeroHistory.ensureBackground(session.record);
    this.clearBackgroundVisual();
    if (closed && this.isRecordBackground(session.record)) {
      this.setPhase('gallery-idle', null, null);
      this.resolveClosing(session, 'closed');
      return;
    }
    this.reconcileIdleLocation();
    this.resolveClosing(session, 'handled');
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
            destination: session.motion.unprojectRect(getHeroRect(routeTarget)),
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
      this.rememberBackgroundScroll();
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
  // Detail <-> detail: the history half of a step
  // -------------------------------------------------------------------------

  private startStepSync() {
    const abort = new AbortController();
    this.detailStepAbort = abort;
    const opened = this.createStepSyncGate(abort.signal);
    const tracked: Promise<boolean> = opened
      .then(() => this.runStepSync(abort.signal))
      .catch((error) => {
        console.error('[hero] detail step failed', error);
        return false;
      })
      .then((synced) => {
        if (this.detailStep === tracked) {
          this.detailStep = null;
          this.detailStepAbort = null;
        }
        this.settleStep();
        this.events.notify();
        return synced;
      });
    this.detailStep = tracked;
    this.events.notify();
    return tracked;
  }

  /**
   * The gate in front of the history half (see `STEP_SYNC_IDLE_TIMEOUT_MS`): it opens two frames
   * after the swap lands, in the next idle slice, or at once when something needs the URL to be
   * right — a close measures against the ladder. A press that starts another swap before it
   * opens simply leaves it for that swap's landing to re-arm.
   */
  private createStepSyncGate(signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      let frame = 0;
      let idle = 0;
      const clear = () => {
        if (frame) cancelAnimationFrame(frame);
        if (idle && 'cancelIdleCallback' in window) window.cancelIdleCallback(idle);
        frame = 0;
        idle = 0;
      };
      const open = () => {
        clear();
        if (this.stepSyncGate === gate) this.stepSyncGate = null;
        signal.removeEventListener('abort', open);
        resolve();
      };
      const arm = () => {
        clear();
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(() => {
            frame = 0;
            const settle = () => {
              idle = 0;
              if (!this.stepSwap) open();
            };
            if ('requestIdleCallback' in window) {
              idle = window.requestIdleCallback(settle, { timeout: STEP_SYNC_IDLE_TIMEOUT_MS });
            } else {
              settle();
            }
          });
        });
      };
      const gate = { arm, open };
      this.stepSyncGate = gate;
      signal.addEventListener('abort', open, { once: true });
      // The swap may already have landed — motion off makes it a cut in the press's own task.
      if (!this.stepSwap) arm();
    });
  }

  /**
   * Rewrite the history until the URL names the latest target. A press during a pass only moves
   * the target, and the loop picks it up when the pass lands, so a held arrow key costs one
   * same-document traversal per picture actually reached rather than a queue of them.
   */
  private async runStepSync(signal: AbortSignal): Promise<boolean> {
    /* Aborted is not failed: the user's own traversal overtook the rewrite, and it — not this
       loop — decides what the viewer shows next (it is leaving, in practice). The detail keeps
       its picture; only a rewrite that could not happen sends it back to the location's. */
    for (;;) {
      const target = this.stepTarget;
      if (signal.aborted) return true;
      if (!target) return true;
      const from = normalizeHeroHref(window.location.href);
      if (from !== target.detailHref) {
        const record = this.detailRecord;
        if (record && imageHeroHistory.isGuard(record)) {
          /* The signal reaches the rewrite itself, not only this wait: abandoned by a traversal of
             the user's, it writes nothing even if its own step onto the base has landed. */
          const updated = await settleUnlessAborted(
            imageHeroHistory.retarget(record, target, signal),
            signal,
          );
          if (signal.aborted) return true;
          if (!updated) {
            await this.recoverFailedStep(record);
            return false;
          }
          this.detailRecord = updated;
        } else if (!record && !imageHeroHistory.currentMarker()) {
          // A detail opened without a flight has no ladder: its entry is the router's own.
          const replaced = await settleUnlessAborted(
            imageHeroHistory.replaceUnownedDetail(target.detailHref, from, signal),
            signal,
          );
          if (signal.aborted) return true;
          if (!replaced) {
            this.failStep();
            return false;
          }
        } else {
          // A ladder that is not standing on its guard — a traversal of the user's is in flight.
          this.failStep();
          return false;
        }
        this.rememberBackgroundScroll();
      }
      if (this.stepTarget === target) this.stepTarget = null;
    }
  }

  /** The rewrite did not happen. Put the guard back if the step onto the base did, and let the
   *  location say which picture the viewer shows. */
  private async recoverFailedStep(record: HeroHistoryRecord) {
    if (
      !imageHeroHistory.isGuard(record) &&
      normalizeHeroHref(window.location.href) === record.detailHref
    ) {
      await this.restoreGuardStrict(record);
    }
    this.failStep();
  }

  /**
   * The URL still names the picture the step left, so that is what the viewer shows: the swap
   * still ahead is dropped rather than completed, and the detail — told by the step's `false` —
   * returns to the location's picture.
   */
  private failStep() {
    this.stepTarget = null;
    this.stepSwap = null;
    if (this.stepSwapTimer) window.clearTimeout(this.stepSwapTimer);
    this.stepSwapTimer = 0;
    this.reconcileIdleLocation();
  }

  /** Both halves of a step have landed: the settled view is re-derived from the location. */
  private settleStep() {
    if (this.detailStep || this.stepSwap || this.foreground) return;
    this.reconcileIdleLocation();
  }

  /** Complete the detail's own swap now — the next thing measured must be the picture it lands on. */
  private flushStepSwap() {
    const swap = this.stepSwap;
    if (!swap) return;
    try {
      swap.flush();
    } catch {
      // The detail unmounted mid-transition; there is nothing left to swap.
    }
    this.settleDetailStep(swap.imageId);
  }

  /** The user's own traversal overtook a step: theirs is the truth, and the step stops here. */
  private abortDetailStep() {
    this.detailStepAbort?.abort();
    this.detailStepAbort = null;
    this.detailStep = null;
    this.stepTarget = null;
    this.flushStepSwap();
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
      if (navigation.late && !this.detailStep) this.reconcileIdleLocation();
      return;
    }
    /* The picture on screen as the traversal arrived: a step's target from its press on. */
    const onScreen =
      this.stepTarget?.imageId ??
      (this.runtime.phase === 'detail-idle' ? this.runtime.imageId : null);
    if (this.detailStep) {
      /* The user's own traversal overtook a step whose ladder rewrite had not landed: the ladder
         still names the picture the step left, while the viewer shows its target. A Back closes
         the viewer as the ladder has it — without a flight, since nothing on screen is that
         picture — and the list still follows the viewer to the picture on screen. */
      const shown = this.stepTarget?.imageId ?? null;
      this.abortDetailStep();
      if (
        shown !== null &&
        navigation.previous === 'guard' &&
        navigation.position === 'base' &&
        navigation.record &&
        navigation.record.imageId !== shown
      ) {
        void this.revealInList(shown);
      }
    }

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

    if (
      !foreground &&
      !this.closePreparation &&
      navigation.record &&
      navigation.position === 'provisional' &&
      (navigation.previous === 'base' || navigation.previous === 'guard')
    ) {
      /* Left for the list past the ladder's own close: the traversal landed on the provisional
         rung under the detail. A Back the browser resolved while a step's rewrite stood on the
         base does that — landing after the rewrite's writes, or ahead of them (which then write
         nothing: `retarget`) — and so does a jump of two entries from the history menu. The
         router has already put the list back; it follows the viewer to the picture last on
         screen, and the rung is stepped off, or the next Back would land on the list's own
         entry at the same URL and seem to do nothing. */
      if (onScreen !== null) void this.revealInList(onScreen);
      void imageHeroHistory.ensureBackground(navigation.record);
      this.reconcileIdleLocation();
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
      // A detail with no ladder, re-entered from another route: its list remounts under it.
      if (DETAIL_PATHNAME.test(window.location.pathname)) {
        this.scheduleBackgroundScrollRestore();
      } else if (this.runtime.phase === 'detail-idle' && this.runtime.imageId !== null) {
        // Back out of such a viewer: the list follows it to the picture last on screen.
        void this.revealInList(this.runtime.imageId);
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
      /* Back from a route the viewer was left for (a tag, an artist): the viewer returns as it
         was, and so must the list under it, which the router remounts at whatever offset the
         scroller was left with (R12-017). Applied once that commit lands (`observeRoute`). */
      this.scheduleBackgroundScrollRestore();
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
    /* A ladder a step rewrote may carry no frame (the list never painted that picture); the card
       being flown from has one now. */
    const frame =
      record.snapshot.previewFrame ?? (source ? captureHeroFrame(getVisualMedia(source)) : null);
    const snapshot =
      frame === record.snapshot.previewFrame ? record.snapshot : { ...record.snapshot, previewFrame: frame };
    const provisional = navigation.position === 'provisional';
    const intent: HeroOpenIntent = {
      snapshot,
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
      skipFlight: !source || !frame,
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
      if (this.foreground || this.detailStep || marker?.token !== record.token) return;

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
    this.detailStepAbort?.abort();
    this.detailStepAbort = null;
    this.stepSyncGate = null;
    this.detailStep = null;
    this.stepTarget = null;
    this.stepSwap = null;
    if (this.stepSwapTimer) window.clearTimeout(this.stepSwapTimer);
    this.stepSwapTimer = 0;
    this.closePreparation = null;
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
            plane: getElementScrollPlane(stage.anchor, stage.scroller, stage.overlay),
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

  /** The viewer's history entry, as the key for what the list under it looked like. */
  private viewerEntryKey() {
    const nav = (window as unknown as { navigation?: { currentEntry?: { key?: string } | null } })
      .navigation;
    const key = nav?.currentEntry?.key;
    if (key) return `entry:${key}`;
    // Without the Navigation API: the ladder's token, or for a detail with none, its URL.
    const marker = imageHeroHistory.currentMarker();
    return `${marker?.token ?? 'plain'}:${normalizeHeroHref(window.location.href)}`;
  }

  /**
   * The list under a settled viewer cannot move until the viewer closes (it is inert and
   * covered), so its offset now is the one to return to if the user leaves the viewer for another
   * route and comes back with Back — the router remounts the list then (R12-017).
   */
  private rememberBackgroundScroll() {
    if (typeof window === 'undefined' || this.runtime.phase !== 'detail-idle') return;
    if (!DETAIL_PATHNAME.test(window.location.pathname)) return;
    const key = this.viewerEntryKey();
    // Not put back yet: the stored value is the one that counts.
    if (this.pendingBackgroundScroll?.key === key) return;
    /* Read in the next idle slice, not now: this runs at a landing and after a step, when the
       layout is dirty, and reading `scrollTop` there forced a layout of the whole page — the
       gallery and the detail together, 77ms on a first open measured in development. The list
       cannot move in between (the viewer covers it and it is inert), so the later read is the
       same number at a fraction of the cost. */
    this.cancelBackgroundScrollRead?.();
    const read = () => {
      this.cancelBackgroundScrollRead = null;
      if (this.runtime.phase !== 'detail-idle' || this.viewerEntryKey() !== key) return;
      if (this.pendingBackgroundScroll?.key === key) return;
      const scroller = document.querySelector<HTMLElement>(HERO_BACKGROUND_SELECTOR);
      if (!scroller) return;
      this.backgroundScrolls.delete(key);
      this.backgroundScrolls.set(key, scroller.scrollTop);
      while (this.backgroundScrolls.size > MAX_BACKGROUND_SCROLLS) {
        const oldest = this.backgroundScrolls.keys().next().value;
        if (oldest === undefined) break;
        this.backgroundScrolls.delete(oldest);
      }
    };
    // Safari shipped `requestIdleCallback` late; a timer is the same promise with less care.
    const idle = (window as { requestIdleCallback?: Window['requestIdleCallback'] })
      .requestIdleCallback;
    if (idle) {
      const handle = window.requestIdleCallback(read, { timeout: BACKGROUND_SCROLL_READ_TIMEOUT_MS });
      this.cancelBackgroundScrollRead = () => window.cancelIdleCallback(handle);
    } else {
      const handle = window.setTimeout(read, 50);
      this.cancelBackgroundScrollRead = () => window.clearTimeout(handle);
    }
  }

  private scheduleBackgroundScrollRestore() {
    const key = this.viewerEntryKey();
    const top = this.backgroundScrolls.get(key);
    this.pendingBackgroundScroll = top === undefined ? null : { key, top };
  }

  /**
   * After the commit that remounted the list: put it back where it stood. Frame by frame while
   * the list is still shorter than that (a feed's cached pages paint over a commit or two), up
   * to a bound — the list is covered and inert, so nothing else can be moving it.
   */
  private applyPendingBackgroundScroll() {
    const pending = this.pendingBackgroundScroll;
    if (!pending) return;
    const scroller = document.querySelector<HTMLElement>(HERO_BACKGROUND_SELECTOR);
    if (!scroller) {
      this.pendingBackgroundScroll = null;
      return;
    }
    const deadline = performance.now() + BACKGROUND_SCROLL_RESTORE_MS;
    const apply = () => {
      if (this.pendingBackgroundScroll !== pending) return;
      if (this.runtime.phase !== 'detail-idle' || this.viewerEntryKey() !== pending.key) {
        this.pendingBackgroundScroll = null;
        return;
      }
      scroller.scrollTop = pending.top;
      if (Math.abs(scroller.scrollTop - pending.top) <= 1 || performance.now() >= deadline) {
        this.pendingBackgroundScroll = null;
        return;
      }
      requestAnimationFrame(apply);
    };
    apply();
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
   *
   * Bounded by `HERO_INPUT_TRANSFER_MAX_MS`, proceeding on expiry: the quiet window
   * (320ms) is longer than a wheel event's refresh (160ms), so an inertial trackpad stream
   * can hold this loop open indefinitely, and every caller treats `false` as "abandon the
   * handoff", which parks the session and withholds the detail body. A lost 160ms of
   * momentum is the cheaper failure.
   *
   * **The budget must go *into* the quiet wait, not around it.** A deadline checked at the
   * top of the loop cannot fire while the `await` below is what never returns — precisely
   * the case being bounded — so the quiet wait takes the remaining budget and reports expiry
   * explicitly. A browser may truncate its fractional timeout, so the clock cannot distinguish
   * that completed budget from an abort after the promise resolves.
   */
  private async waitForInputTransfer(session: HeroSession, sync?: () => void) {
    const lifecycleSignal = this.lifecycleAbort.signal;
    const deadline = performance.now() + HERO_INPUT_TRANSFER_MAX_MS;
    while (this.owns(session)) {
      if (session.abort.signal.aborted || lifecycleSignal.aborted) return false;
      if (performance.now() >= deadline) return true;
      const continuity = session.scrollContinuity;
      // Only the OLD receiver needs a quiet window. Fresh input on the visible receiver
      // proves the browser has retargeted; waiting for that new scroll to stop held a close
      // open for two full timeout budgets and withheld detail content after an open.
      const waitAbort = new AbortController();
      const abortWait = () => waitAbort.abort();
      const signals = [session.abort.signal, lifecycleSignal];
      signals.forEach((signal) => signal.addEventListener('abort', abortWait, { once: true }));
      if (signals.some((signal) => signal.aborted)) abortWait();
      let outcome: HeroInteractionQuietResult | 'native';
      try {
        const quiet = waitForHeroInteractionQuiet(
          waitAbort.signal,
          HERO_INPUT_TRANSFER_QUIET_MS,
          deadline - performance.now(),
        );
        outcome = await (continuity
          ? Promise.race([
              quiet,
              continuity.waitForNativeInput(waitAbort.signal).then((transferred) =>
                // A released receiver did not receive native input. Keep the same quiet
                // wait: repeatedly racing an already-released receiver would spin here.
                transferred ? 'native' as const : quiet,
              ),
            ])
          : quiet);
      } finally {
        waitAbort.abort();
        signals.forEach((signal) => signal.removeEventListener('abort', abortWait));
      }
      if (!this.owns(session) || session.abort.signal.aborted || lifecycleSignal.aborted || outcome === 'aborted')
        return false;
      if (outcome === 'expired') return true;
      sync?.();
      const frameConfirmed = await waitForFrame(
        [session.abort.signal, lifecycleSignal],
        HERO_ROUTE_TIMEOUT_MS,
      );
      if (!this.owns(session) || session.abort.signal.aborted || lifecycleSignal.aborted) return false;
      // Hidden documents can suspend rAF after input has already transferred. The frame
      // timeout is a completed handoff budget too, not permission to abandon a live session.
      if (!frameConfirmed) return true;
      if (continuity?.hasNativeInput || (isHeroInteractionQuiet() && !hasActiveHeroInput()))
        return true;
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
    const direction = phase.startsWith('opening') ? 'forward'
      : phase === 'closing.flight' ? 'back'
      : phase === 'reversing' ? (session?.kind === 'closing' ? 'forward' : 'back')
      : null;
    this.updateRuntime({ phase, direction, sessionId: session?.id ?? null, imageId, background });
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (direction) root.dataset.imageHeroTransition = direction;
      else delete root.dataset.imageHeroTransition;
      root.dataset.imageHeroState = phase;
    }
    this.syncLeaving();
    this.events.notify();
  }

  /**
   * The detail surfaces a `back` leg is leaving take no pointer input, so a press lands on the
   * gallery that is already coming back (and an already-latched wheel stream still reaches the
   * old scroller, which relays it). Marked on each surface rather than keyed on `<html>`: that
   * flag under a universal descendant rule was invalidated by name, so every open and close
   * began with a style recalculation of the whole document, 1,474 elements (R12-009). On the
   * surface, the recalculation is bounded by the one subtree that is leaving anyway.
   */
  private syncLeaving() {
    if (typeof document === 'undefined') return;
    const wanted = new Set<HTMLElement>();
    if (this.runtime.direction === 'back') {
      if (this.stage) wanted.add(this.stage.nodes.overlay);
      for (const route of this.routes.values()) {
        wanted.add(route.overlay);
        if (route.floatingBack) wanted.add(route.floatingBack);
      }
    }
    this.leavingLeases.forEach((lease, node) => {
      if (wanted.has(node)) return;
      lease.release();
      this.leavingLeases.delete(node);
    });
    wanted.forEach((node) => {
      if (!this.leavingLeases.has(node)) {
        this.leavingLeases.set(node, leaseAttribute(node, 'data-image-hero-leaving', ''));
      }
    });
  }

  private updateRuntime(patch: Partial<ImageHeroRuntimeState>) {
    const current = this.runtime;
    const next = { ...current, ...patch };
    if (
      next.phase === current.phase &&
      next.direction === current.direction &&
      next.sessionId === current.sessionId &&
      next.imageId === current.imageId &&
      next.stage === current.stage &&
      next.background === current.background
    ) {
      return;
    }
    publishImageHeroRuntime(next);
  }
}

export const imageHeroController = new HeroController();
bindImageHeroEngine(imageHeroController);
