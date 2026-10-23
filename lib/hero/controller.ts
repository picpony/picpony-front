'use client';

import {
  HERO_BACKGROUND_SELECTOR,
  HERO_ARM_TTL_MS,
  HERO_CONTENT_SELECTOR,
  HERO_DETAIL_ROUTE_TIMEOUT_MS,
  HERO_HANDOFF_FOLLOW_MAX_MS,
  HERO_HANDOFF_SCROLL_DEFER_MAX_MS,
  HERO_HANDOFF_SCROLL_QUIET_MS,
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
import { heroRectsEqual, releaseSpeedAlong, type HeroRect } from './geometry';

function unionHeroRects(a: HeroRect, b: HeroRect): HeroRect {
  const top = Math.min(a.top, b.top);
  const left = Math.min(a.left, b.left);
  return {
    top,
    left,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
}
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
import { clearInactiveHeroBackground, HeroMotion, holdHeroMotion } from './motion';
import {
  getElementScrollPlane,
  getGalleryScrollPlane,
  planeRectToScreen,
  type HeroScrollPlane,
} from './plane';
import { createHeroFlight, type HeroFlight } from './flight';
import { watchImageHeroFlightUpgrade } from './upgrade';
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
import { canFollowHeroScroll, followHeroScroll, type HeroScrollFollow } from './follow';
import { motionTier } from '@/lib/appearance';
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
import { heroProbeDisabled, heroProbeMark } from './probe';

/** Keeps the Stage scroller and the routed scroller at the same offset. */
type OpeningScrollBridge = {
  /** The route as a scroll peer: offsets mirrored from scroll events, on the main thread. */
  addTarget: (scroller: HTMLElement, content?: HTMLElement) => void;
  /**
   * The route as a compositor follower of the Stage's scroll (`lib/hero/follow.ts`), sized from
   * its content like a peer. Null where scroll-driven animations are missing — the caller then
   * keeps the peer bridge and its old ordering.
   */
  follow: (
    scroller: HTMLElement,
    content: HTMLElement,
    node: HTMLElement,
  ) => HeroScrollFollow | null;
  sync: () => void;
  /**
   * The route as **the** scroller: the only continuity peer and input target, still sizing the
   * Stage from its content so the Stage can take the scroll back at the same offset. No offset
   * is mirrored anywhere while it owns — see `HeroController.promoteAdoption`.
   */
  own: (scroller: HTMLElement, content: HTMLElement, forwardStageWheel?: boolean) => void;
  /** The Stage takes the scroll back, aligned once to where the route was. */
  disown: () => void;
  returnToGallery: (scroller: HTMLElement) => void;
  release: () => void;
};

/**
 * The routed detail shown in the Stage's place before the handoff — mid-flight, the moment it can
 * paint the flyer's picture, or at the landing. The Stage still owns the input, the flyer and the
 * history; the route is what the reader sees: it wears the Stage's shared tracks
 * (`HeroMotion.attachMirror`), follows its scroll on the compositor, and keeps its own picture
 * hidden under the flyer until the landing reveals it (`revealOpeningHandoff`).
 */
type OpeningAdoption = {
  route: HeroRoute;
  stage: HeroStageNodes;
  /** What the adoption put on the DOM for the Stage's sake; released first in the reveal write. */
  lease: DomLease;
  /**
   * Who takes new input. Following: the route is pointer-transparent and the Stage's scroller,
   * whose stream the route follows on the compositor, keeps it. Owned (`promoteAdoption`): the
   * Stage is pointer-transparent and the route scrolls natively, carrying the flyer.
   */
  input: DomLease;
  /** The route owns the scroll, the input and the flyer's plane — see `promoteAdoption`. */
  owned: boolean;
};

type ViewportBaseline = {
  destination: HeroRect;
  planeWidth: number;
  planeHeight: number;
  /**
   * The plane scroller's offset when `destination` was read. A screen box moves when the reader
   * scrolls the Stage mid-flight, while the landing box in the scroller's own coordinates does
   * not, so the comparison adds it back — a scroll is not a reason to re-aim.
   */
  scrollTop: number;
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
  /** The armed press's held flyer and motion, until the launch adopts or drops it. */
  prepared: PreparedFlight | null;
  /** The route shown in the Stage's place ahead of the handoff — see `OpeningAdoption`. */
  adoption: OpeningAdoption | null;
  /**
   * The route's compositor follow of the Stage's scroll (`lib/hero/follow.ts`). Outlives the
   * adoption: the handoff reveals the route at the landing but keeps it following a stream still
   * latched to the Stage until that stream pauses or fresh input lands on the route.
   */
  follow: HeroScrollFollow | null;
  /** The opening pull's recognizer, bound to whichever scroller owns the scroll right now. */
  pullRecognizer: (() => void) | null;
  /**
   * A retargeted open's predecessor (`retargetOpening`): its motion still wears the Stage's
   * shared tracks until this open's own motion takes them over, and its history unwinds in
   * parallel with this flight — this open claims history and navigates once it has.
   */
  predecessor: HeroPredecessor | null;
  /** The reversal in flight (`reverseOpening`), for a tap that opens beside it. */
  reverseTurn: { landed: Promise<unknown>; navigationHandled: boolean } | null;
};

/** What a retargeted open inherits from the open it replaced — see `retargetOpening`. */
type HeroPredecessor = {
  /** Still wearing the Stage's shared tracks until `takePredecessorSurface`. */
  motion: HeroMotion | null;
  /** The replaced open's history, back on the background. */
  unwind: Promise<boolean>;
  /** Its record's token: the unwind's own traversal is not a user's Back. */
  token: string;
  /** Told once the successor took the surface (or will not): the motion may be disposed. */
  released: () => void;
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
  /** Puts `inert` on the leaving route; deferred until the flight runs (`exposeGallery`). */
  applyRouteInert?: (() => void) | null;
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

type PreparedFlight = {
  plane: HeroScrollPlane;
  targetRect: HeroRect;
  flight: HeroFlight;
  motion: HeroMotion;
  sourceRect: HeroRect;
  stage: HeroStageNodes;
  viewport: { width: number; height: number };
};

type ArmedOpen = {
  id: number;
  snapshot: ImageHeroSnapshot;
  source: HTMLElement;
  timer: number;
  prepareFrame: number;
  prepared: PreparedFlight | null;
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
  /** A press on a card mounted the Stage ahead of the click; see `armOpen`. */
  private armed: ArmedOpen | null = null;
  private readonly events = new HeroSignal();
  /** Fired when a route starts or stops being the visible surface of a running open. */
  private readonly surface = new HeroSignal();
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
  /** Opens a retarget replaced, flying home on their own until they land (`retargetOpening`). */
  private retiringOpenings = new Set<OpeningSession>();
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

  /**
   * A route became (or stopped being) the visible surface of a running open. Not part of the
   * published runtime on purpose: every runtime write re-renders the shell's subscribers, and
   * only the detail's own publication gates care about this.
   */
  subscribeSurface = (listener: () => void) => this.surface.subscribe(listener);

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

  /**
   * The routed detail for this image is on screen, in the Stage's place, while its open is still
   * running (`OpeningAdoption`).
   */
  isDetailSurfaceLive(imageId: number) {
    const foreground = this.foreground;
    return (
      foreground?.kind === 'opening' &&
      !foreground.reversing &&
      (foreground.adoption?.route ?? foreground.handoffRoute)?.imageId === imageId
    );
  }

  /**
   * Whether the detail's body — its largest subtree — may mount now.
   *
   * At rest, always. During an open it used to wait for `detail-idle`, because the old handoff
   * revealed the route in one frame that had to be cheap. Where the route follows the Stage on
   * the compositor (`lib/hero/follow.ts`) no frame of the open depends on the main thread any
   * more — the flyer, the window, the fades and the scroll all run on the compositor — and the
   * route is either sealed (its body lays out unseen) or already the visible surface. So the
   * body mounts the moment its record is in, during the flight, and the route is revealed with
   * it rather than filling in after the landing. Where it does not follow, the old rule stands.
   */
  isDetailBodyPublishable(imageId: number) {
    const phase = this.runtime.phase;
    if (!phase.startsWith('opening.')) return true;
    if (this.isDetailSurfaceLive(imageId)) return true;
    const foreground = this.foreground;
    return (
      foreground?.kind === 'opening' &&
      !foreground.reversing &&
      foreground.snapshot.image.id === imageId &&
      canFollowHeroScroll()
    );
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
    heroProbeMark('hx:t:stage-registered');
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
      const owner = this.foreground;
      if (owner?.kind === 'opening' && owner.adoption?.route === route) this.releaseAdoption(owner);
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
        // So does a retarget, unwinding the open it replaced before pushing its own.
        if (foreground.predecessor && !foreground.routeNavigationStarted) return;
      }
      // A retarget's predecessor's detail URL committing late is superseded by the unwind.
      if (foreground.predecessor && !foreground.routeNavigationStarted) return;
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

  /**
   * **The press lays out the Stage; the click only reveals it.** Between a finger landing on a
   * card and the click that follows it there are 50–150ms in which nothing used to happen; the
   * click then had to render the Stage (React), lay the whole document out to read the landing
   * box, and only then could the flight start — ~30ms of a ~90ms click task at 4× CPU. Here the
   * press mounts the Stage invisible (`visibility: hidden`, so laid out but neither painted nor
   * hit-tested) under the session id the open will use, and the next frame lays it out for
   * free. A click on the same card adopts it (`startOpening`); anything else — a scroll's
   * `pointercancel`, a press on another card, the timeout — unmounts it. Nothing is fetched or
   * decoded here: this is layout, not media warm-up.
   */
  armOpen(snapshot: ImageHeroSnapshot, source: HTMLElement, pointerType = 'touch') {
    this.initialize();
    if (
      !snapshot.canAnimate ||
      !source.isConnected ||
      this.foreground ||
      this.detailStep ||
      this.closePreparation ||
      this.runtime.phase !== 'gallery-idle' ||
      heroProbeDisabled('arm')
    ) {
      return false;
    }
    const current = this.armed;
    if (current && current.snapshot === snapshot && current.source === source) {
      window.clearTimeout(current.timer);
      current.timer = window.setTimeout(() => this.disarmOpen(current.id), HERO_ARM_TTL_MS);
      return true;
    }
    this.disarmOpen();
    const id = ++this.sessionSequence;
    const armed: ArmedOpen = {
      id,
      snapshot,
      source,
      timer: window.setTimeout(() => this.disarmOpen(id), HERO_ARM_TTL_MS),
      prepareFrame: 0,
      prepared: null,
    };
    this.armed = armed;
    this.updateRuntime({ stage: { phase: 'armed', snapshot, sessionId: id } });
    /* Right after the press's own handler has committed the Stage. A mouse press gets a task of
       its own; a touch cannot: until Blink knows whether a touch is a scroll it holds back
       timers, posted tasks and frames alike (measured: none ran in 110ms of a held finger), so
       the build runs in a microtask behind the press — after React commits the Stage, before
       the finger lifts. */
    const prepare = () => {
      armed.prepareFrame = 0;
      this.prepareArmedFlight(id);
    };
    if (pointerType === 'mouse') {
      armed.prepareFrame = window.setTimeout(prepare, 0);
    } else {
      armed.prepareFrame = -1;
      queueMicrotask(() => {
        if (armed.prepareFrame === -1) prepare();
      });
    }
    return true;
  }

  /** Unmount an armed Stage (all of them, or only session `id`). */
  disarmOpen(id?: number) {
    const armed = this.armed;
    if (!armed || (id !== undefined && armed.id !== id)) return;
    window.clearTimeout(armed.timer);
    if (armed.prepareFrame > 0) window.clearTimeout(armed.prepareFrame);
    armed.prepareFrame = 0;
    armed.prepared?.motion.dispose();
    this.armed = null;
    const stage = this.runtime.stage;
    if (stage.phase === 'armed' && stage.sessionId === armed.id) {
      this.updateRuntime({ stage: EMPTY_STAGE });
    }
  }

  /** The armed session id, iff the open about to start is the press that armed it. */
  private adoptArmed(intent: HeroOpenIntent) {
    const armed = this.armed;
    if (!armed) return null;
    this.armed = null;
    window.clearTimeout(armed.timer);
    if (armed.prepareFrame > 0) window.clearTimeout(armed.prepareFrame);
    armed.prepareFrame = 0;
    const stage = this.runtime.stage;
    if (
      stage.phase === 'armed' &&
      stage.sessionId === armed.id &&
      armed.source === intent.source &&
      armed.snapshot.image.id === intent.snapshot.image.id &&
      armed.snapshot.sourceKey === intent.snapshot.sourceKey &&
      !intent.historyRestore
    ) {
      return armed;
    }
    armed.prepared?.motion.dispose();
    if (stage.phase === 'armed') this.updateRuntime({ stage: EMPTY_STAGE });
    return null;
  }

  requestOpen(intent: HeroOpenIntent) {
    heroProbeMark('hx:t:request');
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
        if (
          !opening.reversing &&
          !opening.handoffCommitted &&
          this.retargetOpening(opening, intent)
        ) {
          return true;
        }
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
      const reversing = this.foreground;
      if (
        phase === 'reversing' &&
        reversing?.kind === 'opening' &&
        intent.source.isConnected &&
        this.retargetReversing(reversing, intent)
      ) {
        return true;
      }
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
      onCandidate: (ready) => pull.prime(ready),
      onCancel: ({ sample, velocity }: HeroPullRelease) => pull.settle(sample, velocity),
      onCommit: ({ sample, velocity, velocityX }: HeroPullRelease) => {
        pull.commit(sample);
        void this.requestClose({
          imageId: route.imageId,
          navigation,
          backgroundMode: 'continue',
          cause: 'dismiss',
          releaseVelocity: { x: velocityX, y: velocity },
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
        // A route revealed early is what the reader is dragging; the Stage under it follows too,
        // so a release that reverses the open takes over from the same pose.
        mirrors: () => (session.adoption ? [session.adoption.route.overlay] : []),
        onOffset: (distance, x) => session.motion?.setPullOffset(distance, x),
        onSeize: () => {
          session.pullSeized = true;
          // Hand the background sink and reveal cascade to the gesture.
          session.motion?.releaseShared();
        },
      },
    );
    session.pull = pull;
    this.bindOpeningPullRecognizer(session, stage.overlay, stage.scroller);

    session.shared.add(() => {
      session.pullRecognizer?.();
      session.pullRecognizer = null;
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

  /**
   * (Re)bind the opening pull's recognizer to the scroller that owns the scroll: the Stage's, or
   * the route's once it takes the scroll over (`promoteAdoption`). The recognizer reads its
   * scroller's offset to know it is at the top and writes its `touch-action`, so it must be the
   * one under the finger. Only rebound between gestures — promotion waits for a quiet hand.
   */
  private bindOpeningPullRecognizer(
    session: OpeningSession,
    target: HTMLElement,
    scroller: HTMLElement,
  ) {
    const pull = session.pull;
    if (!pull) return;
    session.pullRecognizer?.();
    session.pullRecognizer = bindHeroDismissGesture({
      target,
      // The Stage overlay is pointer-transparent by design, so listen wider.
      listenTarget: window,
      scroller,
      canStart: () => this.owns(session) && !session.reversing,
      onPull: (sample) => {
        if (this.owns(session)) pull.applyImmediate(sample);
      },
      onCandidate: (ready) => pull.prime(ready),
      onCancel: async ({ sample, velocity }: HeroPullRelease) => {
        await pull.settle(sample, velocity);
        // A fresh drag during the settle keeps the surface claimed.
        if (!pull.isActive) session.pullSeized = false;
        this.events.notify();
      },
      onCommit: ({ sample }: HeroPullRelease) => {
        heroProbeMark('hx:pull:commit');
        pull.commit(sample);
        void this.reverseOpening(session, false);
      },
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
      predecessor?: HeroPredecessor;
      /** Where the picture is now, when it is already on screen (a reversal turned round). */
      sourceRect?: HeroRect;
    } = {},
  ) {
    /* Measured before this method writes anything: the Stage's state attribute below dirties
       style, and a read after it forced a style pass inside the tap (~4ms of a 4×-throttled
       tap, traced) that the frame's own pass would otherwise have absorbed. */
    const sourceRect = options.sourceRect ?? getHeroRect(intent.source);
    // A picture opening owns focus from here; a card revealed by the last close no longer asks.
    this.cancelRevealFocus();
    const background = intent.background ?? this.runtime.background ?? currentBackground();
    intent.background = background;
    const armed = this.adoptArmed(intent);
    const adopted = armed?.id ?? null;
    const id = adopted ?? ++this.sessionSequence;
    if (adopted !== null && this.stage?.sessionId === adopted) {
      /* React commits the new phase before this task paints, but the flight launches from a
         microtask that may run first: reveal the laid-out Stage on the node itself so no
         order of the two can paint a frame of flyer over an invisible window. */
      this.stage.nodes.overlay.setAttribute('data-image-hero-stage-state', 'opening');
      this.stage.nodes.floatingBack?.removeAttribute('data-image-hero-stage-armed');
    }
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
      sourceRect,
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
      prepared: armed && !options.collapseRecord && !options.predecessor ? armed.prepared : null,
      adoption: null,
      pullRecognizer: null,
      predecessor: options.predecessor ?? null,
      reverseTurn: null,
      follow: null,
    };
    if (armed?.prepared && session.prepared !== armed.prepared) armed.prepared.motion.dispose();

    // Plant a same-URL history entry now: it is a synchronous Back barrier while
    // the App Router is still preparing its asynchronous route commit.
    if (
      !session.historyRestore &&
      !session.collapseRecord &&
      !session.predecessor &&
      !session.provisionalClaimed
    ) {
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
    heroProbeMark('hx:t:phase-set');
    void this.runOpening(session);
  }

  private async runOpening(session: OpeningSession) {
    const { intent } = session;
    try {
      let collapse: Promise<boolean> | null = null;
      /** A retarget's own navigation, behind its predecessor's unwind (`navigateAfterUnwind`). */
      let navigation: Promise<boolean> | null = null;
      if (session.collapseRecord) {
        collapse = imageHeroHistory.ensureBackground(session.collapseRecord);
        session.collapsePromise = collapse;
      } else if (session.predecessor) {
        navigation = this.navigateAfterUnwind(session, session.predecessor.unwind);
      } else if (!session.historyRestore && !session.routeNavigationStarted) {
        /* Only the check here; the push itself waits for the flight's first frame (below). The
           flightless paths push the moment they run (`recoverOpeningWithoutFlight`). */
        if (!session.provisionalClaimed) {
          this.dropPreparedFlight(session);
          await this.reverseOpening(session, false);
          return;
        }
      }

      if (session.skipFlight) {
        this.dropPreparedFlight(session);
        if (navigation && !(await navigation)) {
          if (this.owns(session)) await this.reverseOpening(session, false);
          return;
        }
        await this.recoverOpeningWithoutFlight(session, collapse);
        return;
      }

      const stage = await waitForSignal<HeroStageNodes>(this.events, {
        signal: session.abort.signal,
        timeout: 1000,
        read: () => (this.stage?.sessionId === session.id ? this.stage.nodes : null),
      });
      if (!this.owns(session)) {
        this.dropPreparedFlight(session);
        return;
      }
      const frame = session.snapshot.previewFrame;
      if (!stage || !intent.source.isConnected || !frame) {
        this.dropPreparedFlight(session);
        this.dropPredecessor(session);
        if (navigation && !(await navigation)) {
          if (this.owns(session)) await this.reverseOpening(session, false);
          return;
        }
        await this.recoverOpeningWithoutFlight(session, collapse);
        return;
      }

      this.launchFlight(session, stage, frame);
      this.watchEarlyReveal(session, stage);
      /* **The detail URL is pushed after the picture's first frame, not before it.** The push is
         the App Router's whole navigate dispatch — reducer, prefetch-cache lookup, fetch, a
         `pushState` (wrapped by the top loader) — ~6ms of a 4×-throttled tap, profiled, all of it
         inside the task whose frame starts the flight. The route it starts renders in a
         transition, frames later, so a frame's delay costs the route nothing visible; the history
         barrier `claim` planted in `startOpening` already makes Back during that frame a reverse
         (`returnToBackground` unwinds a barrier that never got its push). A reverse or retarget
         before it fires owns the history from there, so the push is dropped. */
      if (!session.routeNavigationStarted && !navigation && !collapse) {
        afterFirstFrame(() => {
          if (!this.owns(session) || session.reversing || session.routeNavigationStarted) return;
          this.startRouteNavigation(session);
        });
      }

      await session.motion!.landed;
      if (!this.owns(session)) return;
      this.setStage('landed', session);
      this.setPhase('opening.landed', session, intent.background!);

      if (collapse && !(await this.commitParallelCollapse(session, collapse))) return;
      if (navigation && !(await navigation)) {
        if (this.owns(session)) await this.reverseOpening(session, false);
        return;
      }

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
      this.dropPreparedFlight(session);
      if (session.abort.signal.aborted || !this.owns(session)) return;
      console.error('[hero] opening transaction failed', error);
      await this.reverseOpening(session, false);
    }
  }

  /**
   * The opening's flyer and motion: the plane, the landing box, the flyer, and every track.
   * Shared by the click (`launchFlight`) and by a press building it ahead of the click inside
   * the still-hidden Stage (`prepareArmedFlight`), where the tracks are held at frame 0.
   */
  private buildOpeningMotion(
    stage: HeroStageNodes,
    frame: FrameAsset,
    source: HTMLElement,
    sourceRect: HeroRect,
    sessionId: number,
    imageId: number,
    continueBackground: boolean,
    handover: ReturnType<HeroMotion['handOver']> | null = null,
  ) {
    const plane = getElementScrollPlane(stage.anchor, stage.scroller, stage.overlay);
    const targetRect = getHeroRect(stage.target);
    heroProbeMark('hx:t:rects');
    const flight = createHeroFlight({
      asset: frame,
      treatment: source,
      plane,
      from: sourceRect,
      to: targetRect,
      direction: 'forward',
      sessionId,
      imageId,
    });
    heroProbeMark('hx:t:flight-built');
    try {
      const motion = new HeroMotion({
        flight,
        from: sourceRect,
        to: targetRect,
        direction: 'forward',
        background: getHeroBackgroundVisual(),
        overlay: stage.overlay,
        floatingBack: stage.floatingBack,
        continueBackground: continueBackground || Boolean(handover),
        // The container grows from the card itself, not from the picture's landing box:
        // `_rectTween.end = Offset.zero & navSize` — the whole surface, not the media slot.
        // A retarget's grows on from the window its predecessor had open (`handOver`).
        container: handover?.window
          ? {
              /* On from the window the predecessor had open — widened to take in this card,
                 which the tap landed outside of: the flyer rides inside the window, and a card
                 outside it would launch clipped away. */
              card: unionHeroRects(handover.window.rect, sourceRect),
              cardRadius: Math.max(handover.window.radius, getHeroCornerRadius(source)),
            }
          : {
              card: sourceRect,
              cardRadius: getHeroCornerRadius(source),
            },
        choreography: 'container',
        sharedFrom: handover?.shared,
      });
      return { plane, targetRect, flight, motion };
    } catch (error) {
      flight.release();
      throw error;
    }
  }

  /**
   * Build the armed press's opening in its hidden Stage, tracks held at frame 0, a frame after
   * the Stage mounted (its layout is clean by then, so the reads are free). Pure geometry and
   * animation setup on the card's own captured frame: nothing is fetched or decoded, the card
   * is not touched (its leases wait for the click), and a press that never becomes a click
   * disposes all of it (`disarmOpen`).
   */
  private prepareArmedFlight(id: number) {
    heroProbeMark('hx:t:prep-enter');
    const armed = this.armed;
    const stage = this.stage;
    if (
      !armed ||
      armed.id !== id ||
      armed.prepared ||
      stage?.sessionId !== id ||
      this.foreground ||
      this.runtime.phase !== 'gallery-idle' ||
      !armed.source.isConnected
    ) {
      return;
    }
    const frame = armed.snapshot.previewFrame;
    if (!frame) return;
    try {
      const sourceRect = getHeroRect(armed.source);
      let built: ReturnType<HeroController['buildOpeningMotion']> | null = null;
      const motion = holdHeroMotion(() => {
        built = this.buildOpeningMotion(
          stage.nodes,
          frame,
          armed.source,
          sourceRect,
          id,
          armed.snapshot.image.id,
          false,
        );
        return built.motion;
      });
      const result = built as ReturnType<HeroController['buildOpeningMotion']> | null;
      if (!result) return;
      armed.prepared = {
        ...result,
        motion,
        sourceRect,
        stage: stage.nodes,
        viewport: trackedViewportSize(),
      };
    } catch {
      // The click builds it the ordinary way.
    }
  }

  /** The press's prepared opening, iff it still describes the geometry the click sees. */
  private takePreparedFlight(session: OpeningSession, stage: HeroStageNodes) {
    const prepared = session.prepared;
    session.prepared = null;
    if (!prepared) return null;
    const same = (a: HeroRect, b: HeroRect) =>
      Math.abs(a.left - b.left) < 0.5 &&
      Math.abs(a.top - b.top) < 0.5 &&
      Math.abs(a.width - b.width) < 0.5 &&
      Math.abs(a.height - b.height) < 0.5;
    /* The landing box is not re-read: the held tracks already hold the window at the card, so
       a read now measures the scaled-down box. Nothing can have moved it without moving the
       viewport (a resize), which is checked, or the card, which is. */
    if (
      prepared.stage === stage &&
      prepared.viewport.width === trackedViewportSize().width &&
      prepared.viewport.height === trackedViewportSize().height &&
      same(prepared.sourceRect, session.sourceRect)
    ) {
      return prepared;
    }
    heroProbeMark('hx:t:prepared-stale');
    prepared.motion.dispose();
    return null;
  }

  private dropPreparedFlight(session: OpeningSession) {
    session.prepared?.motion.dispose();
    session.prepared = null;
  }

  private launchFlight(session: OpeningSession, stage: HeroStageNodes, frame: FrameAsset) {
    const { intent } = session;
    heroProbeMark('hx:t:launch');
    const prepared = this.takePreparedFlight(session, stage);
    const { plane, targetRect, flight, motion } =
      prepared ??
      this.buildOpeningMotion(
        stage,
        frame,
        intent.source,
        session.sourceRect,
        session.id,
        session.snapshot.image.id,
        Boolean(session.collapseRecord),
        this.takePredecessorSurface(session),
      );
    session.visual.add(flight.release);
    /* The card's bitmap is sized for a card: repaint the flyer from the detail's final the
       moment it decodes, mid-flight. It checks `canvas.isConnected` before every repaint, so
       disposal order does not matter. See `lib/hero/upgrade.ts`. */
    if (session.snapshot.mediaType === 'image') {
      session.visual.add(watchImageHeroFlightUpgrade(flight.image, session.snapshot.image.id));
    }
    session.visual.add(leaseHeroCardChrome(intent.source));
    session.visual.add(leaseHeroVisibility(intent.source, false));
    session.motion = motion;
    motion.release();

    session.viewportBaseline = {
      destination: targetRect,
      planeWidth: plane.viewportWidth,
      planeHeight: plane.viewportHeight,
      scrollTop: plane.scrollTop,
    };
    heroProbeMark(prepared ? 'hx:t:motion-prepared' : 'hx:t:motion-built');
    /* **The picture's first frame before anything else.** Its tracks are created above and go
       to the compositor with the frame that ends this task; binding the scroll follow and the
       dismiss recognisers here put their peer animations, leases and listeners (~15ms at 4×
       CPU, traced) between the tap and that frame. Nothing they do is visible until the user
       scrolls or drags, so they bind in the task after the first frame instead — one frame
       during which the Stage's native scroll still works and only the follow lags. */
    afterFirstFrame(() => {
      if (!this.owns(session) || session.reversing || session.motion !== motion) return;
      this.bindOpeningScroll(session, stage);
      this.bindOpeningDismiss(session, stage);
      heroProbeMark('hx:t:bound');
    });
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
   * **Another card, tapped while a picture is opening, opens at once — beside the first, not after
   * it.** The first picture turns round and flies home on its own (`HeroMotion.retreat`), its
   * history unwinds in the background, and the new open launches as soon as the Stage has
   * re-rendered for it (one commit) — growing the surface on from the window the first had open
   * (`takePredecessorSurface`) instead of waiting for a reverse, a history traversal and a router
   * commit to finish first. Only the new open's *navigation* waits for the unwind
   * (`navigateAfterUnwind`); nothing on screen does.
   *
   * False when there is nothing to fly or unwind safely from here — the caller then keeps the
   * serial reverse-then-open.
   */
  private retargetOpening(opening: OpeningSession, intent: HeroOpenIntent) {
    if (
      !this.owns(opening) ||
      opening.historyRestore ||
      opening.collapseRecord ||
      opening.predecessor
    ) {
      return false;
    }
    const motion = opening.motion;
    const source = opening.intent.source;
    if (!motion || !source.isConnected || this.stage?.sessionId !== opening.id) return false;
    // Read before any write: the live pose, its way home, the gallery's plane.
    const measurement = {
      destination: getGalleryLandingRect(source),
      plane: getGalleryScrollPlane() ?? undefined,
      pose: motion.measurePose(),
    };

    opening.reversing = true;
    opening.abort.abort();
    opening.pull?.releaseOffset();
    this.releaseAdoption(opening);
    if (opening.handoffRoute) {
      if (opening.handoffVisual) {
        opening.shared.release(opening.handoffVisual);
        opening.handoffVisual = null;
      }
      this.routes.seal(opening.handoffRoute, opening.owner);
      opening.handoffRoute = null;
    }
    // The picture first: its reversed leg is the one thing here the eye follows.
    const landed = motion.retreat(measurement.destination, measurement.plane, measurement.pose);

    // Supersede a still-pending detail push now, as a reversal does (a late commit would win).
    const background = backgroundHref(opening.intent.background!);
    const currentHref = normalizeHeroHref(window.location.href);
    if (
      opening.provisionalClaimed &&
      opening.routeNavigationStarted &&
      (currentHref === normalizeHeroHref(background) || currentHref === opening.record.detailHref)
    ) {
      opening.intent.navigation.replace(background);
    }
    const unwind = this.unwindRetargeted(opening);

    opening.scrollBridge?.release();
    opening.scrollContinuity?.release();
    opening.scrollContinuity = null;
    opening.shared.dispose();
    this.handOffRetiringOpening(opening, motion, landed, unwind, intent);
    return true;
  }

  /**
   * The open being replaced leaves the foreground now and flies home on its own; the successor
   * starts in this same task. Its flyer is disposed once it has landed *and* the successor has
   * taken the Stage's surface off it (`takePredecessorSurface`) — whichever comes last — so the
   * surface never drops to its resting CSS between the two, and the card's thumbnail comes back
   * the moment the flyer sits on it.
   */
  private handOffRetiringOpening(
    opening: OpeningSession,
    motion: HeroMotion,
    landed: Promise<unknown>,
    unwind: Promise<boolean>,
    intent: HeroOpenIntent,
  ) {
    this.retiringOpenings.add(opening);
    let hasLanded = false;
    let handedOver = false;
    const finish = () => {
      if (!hasLanded || !handedOver || !this.retiringOpenings.delete(opening)) return;
      motion.dispose();
      if (opening.motion === motion) opening.motion = null;
    };
    void landed
      .catch(() => undefined)
      .then(() => {
        hasLanded = true;
        opening.visual.dispose();
        finish();
      });
    /* The same card again: the picture turns round rather than a second copy leaving the card —
       the new flight starts from the live pose, and the old flyer goes in the task the new one
       is built (before its card lease, which must not stack on the old one's). */
    const turnRound = intent.source === opening.intent.source;
    const pose = turnRound ? motion.measurePose() : null;
    const sourceRect = pose
      ? planeRectToScreen(
          {
            ...pose.rect,
            top: pose.rect.top + pose.pullOffset,
            left: pose.rect.left + (pose.pullOffsetX ?? 0),
          },
          motion.flight.plane,
        )
      : undefined;
    this.foreground = null;
    this.startOpening(intent, {
      sourceRect,
      predecessor: {
        motion,
        unwind,
        token: opening.record.token,
        released: () => {
          handedOver = true;
          if (turnRound) {
            hasLanded = true;
            opening.visual.dispose();
          }
          finish();
        },
      },
    });
  }

  /**
   * **A tap on another card while the open is already turning back** — the picture flying home
   * after a pull, an Escape, a Back — opens it at once, as `retargetOpening` does mid-open: the
   * reversal carries on flying home untouched, its history unwind becomes the new open's gate,
   * and the new open takes the Stage's reversing surface over from wherever it is. It used to
   * wait for the reverse to land, the history to settle and the router to commit.
   */
  private retargetReversing(opening: OpeningSession, intent: HeroOpenIntent) {
    if (
      this.foreground !== opening ||
      !opening.reversing ||
      opening.historyRestore ||
      opening.collapseRecord ||
      opening.predecessor ||
      !opening.reverseTurn ||
      this.stage?.sessionId !== opening.id
    ) {
      return false;
    }
    const motion = opening.motion;
    if (!motion) return false;
    const { landed, navigationHandled } = opening.reverseTurn;
    const unwind = this.returnToBackground(opening, navigationHandled)
      .then((onBackground) => {
        if (onBackground) imageHeroHistory.forget(opening.record);
        return onBackground;
      })
      .catch(() => false);
    opening.scrollBridge?.release();
    opening.scrollContinuity?.release();
    opening.scrollContinuity = null;
    this.handOffRetiringOpening(opening, motion, landed, unwind, intent);
    return true;
  }

  /** The replaced open's history, back on its background — whatever of it was built. */
  private async unwindRetargeted(opening: OpeningSession) {
    let onBackground = true;
    if (opening.routeNavigationStarted) {
      onBackground = opening.provisionalClaimed
        ? await imageHeroHistory.ensureBackground(opening.record)
        : await imageHeroHistory.returnUnmarkedToBackground(
            opening.intent.background!,
            opening.record.token,
          );
    } else if (opening.provisionalClaimed) {
      onBackground = await imageHeroHistory.ensureBackground(opening.record);
    }
    if (onBackground) imageHeroHistory.forget(opening.record);
    return onBackground;
  }

  /** A retarget's navigation: claim and push once the predecessor's history is unwound. */
  private async navigateAfterUnwind(session: OpeningSession, unwind: Promise<boolean>) {
    const unwound = await unwind.catch(() => false);
    if (!this.owns(session) || !unwound) return false;
    const href = backgroundHref(session.intent.background!);
    if (this.observedHref !== normalizeHeroHref(href)) {
      if (!(await this.waitForRouterCommit(href, session.abort.signal))) return false;
      if (!this.owns(session)) return false;
    }
    session.routeFloor = this.routes.currentEpoch;
    session.provisionalClaimed = imageHeroHistory.claim(session.record);
    return this.startRouteNavigation(session);
  }

  /**
   * The predecessor's live surface, for this open's motion to grow on from: read and released in
   * the task that builds the new tracks, so no frame shows the Stage between the two.
   */
  private takePredecessorSurface(session: OpeningSession) {
    const motion = session.predecessor?.motion;
    if (!motion || !session.predecessor) return null;
    session.predecessor.motion = null;
    const handover = motion.handOver();
    session.predecessor.released();
    return handover;
  }

  /** A retarget that will not fly: the predecessor's surface freezes where it is. */
  private dropPredecessor(session: OpeningSession) {
    const motion = session.predecessor?.motion;
    if (!motion || !session.predecessor) return;
    session.predecessor.motion = null;
    motion.retire();
    session.predecessor.released();
  }

  /**
   * Show the route in the Stage's place while the picture is still flying, as soon as it can
   * paint the flyer's picture — the destination arriving *during* the transition, as a Flutter
   * route's page does, instead of a skeleton held until the landing.
   *
   * Only while the container transform is running (the mirror needs its tracks), and only where
   * the take-over needs no main-thread scroll: a quiet hand (the route simply takes the scroll —
   * `promoteAdoption`), or a stream in progress the route can follow on the compositor. Without
   * scroll-driven animations a stream in progress is waited out. Waits out a pull the hand has
   * seized: the gesture owns the shared tracks then.
   */
  private watchEarlyReveal(session: OpeningSession, stage: HeroStageNodes) {
    const motion = session.motion;
    if (!motion || motionTier('image') !== 'standard') return;
    let landed = false;
    void motion.landed.then(() => {
      landed = true;
      this.events.notify();
    });
    const eligible = () =>
      !landed &&
      this.owns(session) &&
      session.motion === motion &&
      !session.adoption &&
      !session.pullSeized &&
      this.runtime.phase === 'opening.flight';
    void waitForSignal<HeroRoute | false>(this.events, {
      signal: session.abort.signal,
      read: () => {
        if (landed || !this.owns(session) || session.motion !== motion || session.adoption) {
          return false;
        }
        if (session.pullSeized || this.runtime.phase !== 'opening.flight') return null;
        const route = this.findOpeningRoute(session, true);
        return route && !route.resolvedWithoutMedia && route.target ? route : null;
      },
    }).then(async (route) => {
      if (!route) return;
      if (!canFollowHeroScroll() && !isHeroInteractionQuiet()) {
        // No compositor follow: the take-over waits for the hand, never mirrors a stream.
        await waitForHeroInteractionQuiet(session.abort.signal, HERO_HANDOFF_SCROLL_QUIET_MS);
        if (!eligible()) return;
      }
      void runScheduledFrame(session.abort.signal, {
        read: () => null,
        write: () => {
          if (!eligible()) return;
          if (!this.adoptOpeningRoute(session, route, stage, true)) return;
          heroProbeMark('hx:t:early-reveal');
          /* The flyer was aimed at the Stage's landing box. The route's is the same box unless
             its record has already changed the header above the picture: re-aim from the
             route's own target, through the path a viewport change takes. */
          this.handleViewportInvalidation();
        },
      });
    });
  }

  /**
   * Make the route the visible surface: revealed, wearing the shared tracks (mid-flight), its
   * picture hidden under the flyer, the Stage's own surface and content hidden behind it. Runs
   * inside a scheduler write. False leaves everything as it was.
   *
   * **Who scrolls is decided by the hand, never by a main-thread mirror.** With the hand quiet the
   * route takes the scroll at once (`promoteAdoption`). With a touch or wheel stream in progress
   * the stream stays latched to the Stage's scroller — a browser never moves a gesture between
   * scrollers — so the route follows it on the compositor (`lib/hero/follow.ts`) and takes over
   * the moment the hand pauses (`watchPromotion`). Without scroll-driven animations there is no
   * follow, so a stream in progress refuses the adoption; the caller waits for the hand.
   */
  private adoptOpeningRoute(
    session: OpeningSession,
    route: HeroRoute,
    stage: HeroStageNodes,
    midFlight: boolean,
  ) {
    const bridge = session.scrollBridge;
    const node = route.content.querySelector<HTMLElement>(HERO_CONTENT_SELECTOR);
    if (!bridge || !node || !route.target) return false;
    const canOwn = Boolean(route.anchor?.isConnected);
    const ownNow = canOwn && isHeroInteractionQuiet();
    if (!ownNow && !canFollowHeroScroll()) return false;
    const detachMirror = midFlight ? (session.motion?.attachMirror(route.overlay) ?? null) : null;
    if (midFlight && !detachMirror) return false;
    if (!this.routes.reveal(route, session.owner)) {
      detachMirror?.();
      return false;
    }
    let follow: HeroScrollFollow | null = null;
    if (!ownNow) {
      follow = bridge.follow(route.scroller, route.content, node);
      if (!follow) {
        // No compositor follow after all: back to the landing reveal, sealed as it was.
        detachMirror?.();
        this.routes.seal(route, session.owner);
        return false;
      }
    }
    const lease = combineHeroLeases(
      leaseAttribute(route.overlay, 'data-image-hero-route-state', 'adopted'),
      // The Stage's floating back stays the one on screen until the landing.
      route.floatingBack
        ? leaseInlineStyles(route.floatingBack, { visibility: 'hidden', pointerEvents: 'none' })
        : null,
      this.routes.sealTarget(route),
      leaseInlineStyles(stage.surface, { visibility: 'hidden' }),
      leaseInlineStyles(stage.content, { visibility: 'hidden' }),
      detachMirror ? { release: detachMirror } : null,
    );
    const input = leaseInlineStyles(route.overlay, { pointerEvents: 'none' });
    session.adoption = { route, stage, lease, input, owned: false };
    session.shared.add(lease);
    session.shared.add(input);
    if (follow) {
      session.follow?.release();
      session.follow = follow;
      session.shared.add(follow);
      if (canOwn) this.watchPromotion(session);
    } else {
      this.promoteAdoption(session);
    }
    this.surface.notify();
    return true;
  }

  /**
   * **The route takes the scroll over**: its own scroller at the Stage's offset (the follow
   * folded into it, or a plain copy when nothing followed), the flyer replanted into the route's
   * plane so the route's native scroll carries it exactly as the Stage's did, new input landing
   * on the route, the opening pull rebound to it. From here to the end of the open nothing
   * mirrors, follows or forwards a scroll offset: one compositor-scrolled element carries the
   * page and the picture, on every engine, and the landing has no scroll to hand over.
   *
   * Runs inside a scheduler write, with the hand quiet: a gesture is never moved between
   * scrollers, and the recognizer is never rebound under a finger.
   */
  private promoteAdoption(session: OpeningSession) {
    const adoption = session.adoption;
    if (!adoption || adoption.owned || !this.owns(session)) return false;
    const { route, stage } = adoption;
    const anchor = route.anchor;
    if (!anchor?.isConnected) return false;
    const follow = session.follow;
    if (follow) {
      follow.commit();
      session.shared.release(follow);
      session.follow = null;
    } else {
      route.scroller.scrollTop = stage.scroller.scrollTop;
    }
    const motion = session.motion;
    if (motion && motion.flight.layer.parentElement === stage.anchor) {
      const plane = motion.flight.plane;
      // Same host box and origin, the route at the Stage's offset: every keyframe stays true.
      motion.replant({
        ...plane,
        anchor,
        scroller: route.scroller,
        host: { ...plane.host, element: route.scroller },
      });
    }
    session.shared.release(adoption.input);
    adoption.input = combineHeroLeases(
      leaseInlineStyles(stage.overlay, { pointerEvents: 'none' }),
      leaseInlineStyles(stage.scroller, { pointerEvents: 'none' }),
      this.guardAdoptedClicks(session, route, stage),
    );
    session.shared.add(adoption.input);
    adoption.owned = true;
    session.scrollBridge?.own(route.scroller, route.content, !isHeroInteractionQuiet());
    this.bindOpeningPullRecognizer(session, route.overlay, route.scroller);
    heroProbeMark('hx:t:promote');
    this.events.notify();
    return true;
  }

  /**
   * The route takes the input before it is the detail, so it takes the Stage's click contract
   * with it: a tap outside the still-growing window that lands on another gallery card opens that
   * card (the Stage scroller's `forwardOpeningCardClick`), and nothing inside the route activates
   * until the handoff — the Stage's content was inert, and a link followed mid-open would
   * navigate under the transaction. Scrolling is untouched; only `click` is filtered.
   */
  private guardAdoptedClicks(
    session: OpeningSession,
    route: HeroRoute,
    stage: HeroStageNodes,
  ): DomLease {
    const handle = (event: MouseEvent) => {
      if (!this.owns(session)) return;
      event.preventDefault();
      event.stopPropagation();
      // Inside the window (its scroller is clipped to it) the tap is on the detail, not a card.
      if (event.target instanceof Node && route.scroller.contains(event.target)) return;
      for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
        const card = element.closest<HTMLAnchorElement>('a.image-hero-card-link');
        if (!card || route.overlay.contains(card) || stage.overlay.contains(card)) continue;
        const thumbnail = card.querySelector<HTMLElement>('[data-image-hero-role="thumbnail"]');
        if (!thumbnail || Number(thumbnail.dataset.imageHeroId) === session.snapshot.image.id)
          return;
        card.click();
        return;
      }
    };
    route.overlay.addEventListener('click', handle, true);
    return { release: () => route.overlay.removeEventListener('click', handle, true) };
  }

  /** A followed adoption is promoted the moment the hand pauses — mid-flight or after. */
  private watchPromotion(session: OpeningSession) {
    const adoption = session.adoption;
    if (!adoption) return;
    void waitForHeroInteractionQuiet(session.abort.signal, HERO_HANDOFF_SCROLL_QUIET_MS).then(
      (outcome) => {
        if (outcome === 'aborted' || session.adoption !== adoption || adoption.owned) return;
        void runScheduledFrame(session.abort.signal, {
          read: () => null,
          write: () => {
            if (session.adoption !== adoption || adoption.owned) return;
            /* A new stream started between the quiet and this frame: keep following and look
               again — never move a gesture in progress. */
            if (!isHeroInteractionQuiet()) {
              this.watchPromotion(session);
              return;
            }
            this.promoteAdoption(session);
          },
        });
      },
    );
  }

  /**
   * Hand the screen back to the Stage, in the pose the route was in (its tracks never stopped):
   * a reversal, a route that unmounted, a session torn down. A route that owned the scroll gives
   * the Stage its offset and the flyer back first. The route is sealed again.
   */
  private releaseAdoption(session: OpeningSession) {
    const adoption = session.adoption;
    if (!adoption) return;
    session.adoption = null;
    const { route, stage } = adoption;
    if (adoption.owned) {
      session.scrollBridge?.disown();
      const motion = session.motion;
      if (motion && route.anchor && motion.flight.layer.parentElement === route.anchor) {
        const plane = motion.flight.plane;
        motion.replant({
          ...plane,
          anchor: stage.anchor,
          scroller: stage.scroller,
          host: { ...plane.host, element: stage.scroller },
        });
      }
      // A reversal ends the pull; anything else keeps it, on the Stage again.
      if (!session.reversing && this.owns(session)) {
        this.bindOpeningPullRecognizer(session, stage.overlay, stage.scroller);
      }
    }
    // `release` on the scope runs the lease once and forgets it.
    session.shared.release(adoption.input);
    session.shared.release(adoption.lease);
    if (session.follow) {
      session.shared.release(session.follow);
      session.follow = null;
    }
    if (route.overlay.isConnected) this.routes.seal(route, session.owner);
    this.surface.notify();
  }

  /**
   * Swap the Stage for the real route.
   *
   * The route is normally on screen and scrolling already (`adoptOpeningRoute`,
   * `promoteAdoption`), so the swap that remains — the flyer for the route's own picture, the
   * Stage's back for the route's — is one batched write with nothing to see and no scroll to
   * hand over.
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

    /* A route that resolved without media has no picture to take over from the flyer; it is
       revealed by the commit as it always was. Anything else is adopted now if the flight did
       not already — waiting for the hand where nothing can follow its stream. */
    if (session.adoption && session.adoption.route !== route) this.releaseAdoption(session);
    const adoptable = !route.resolvedWithoutMedia && Boolean(route.target);
    if (!session.adoption && adoptable) {
      if (!canFollowHeroScroll() && !isHeroInteractionQuiet()) {
        await waitForHeroInteractionQuiet(
          session.abort.signal,
          HERO_HANDOFF_SCROLL_QUIET_MS,
          HERO_HANDOFF_FOLLOW_MAX_MS,
        );
        if (!this.owns(session) || !session.motion) return;
      }
      await runScheduledFrame(session.abort.signal, {
        read: () => null,
        write: () => {
          if (this.owns(session) && !session.adoption) {
            this.adoptOpeningRoute(session, route, stage, false);
          }
        },
      });
      if (!this.owns(session) || !session.motion) return;
    }

    /* **A scroll the reader is in the middle of stays on the surface it started on**, followed by
       the route on the compositor; the route takes the input when the hand pauses
       (`watchPromotion`). The landing waits for that rather than handing a live stream over. */
    const pending = session.adoption;
    if (pending && !pending.owned && route.anchor) {
      await waitForSignal(this.events, {
        signal: session.abort.signal,
        timeout: HERO_HANDOFF_FOLLOW_MAX_MS,
        read: () => (session.adoption !== pending || pending.owned ? true : null),
      });
      if (!this.owns(session) || !session.motion) return;
      if (session.adoption === pending && !pending.owned) {
        /* A stream that outlasted the bound: take over now. A latched wheel stream keeps
           arriving on the Stage; its deltas are forwarded to the route (`own`'s residual) —
           the one main-thread scroll left, and only for this overflow. */
        await runScheduledFrame(session.abort.signal, {
          read: () => null,
          write: () => this.promoteAdoption(session),
        });
        if (!this.owns(session) || !session.motion) return;
      }
    }

    if (!session.adoption) {
      // The landing reveal (no adoption possible): the route tracks the Stage until the commit.
      session.scrollBridge?.addTarget(route.scroller, route.content);
      session.scrollBridge?.sync();
      if (!isHeroInteractionQuiet()) {
        await waitForHeroInteractionQuiet(
          session.abort.signal,
          HERO_HANDOFF_SCROLL_QUIET_MS,
          HERO_HANDOFF_SCROLL_DEFER_MAX_MS,
        );
        if (!this.owns(session) || !session.motion) return;
      }
    }

    const owned = Boolean(session.adoption?.owned);
    if (!(await this.revealOpeningHandoff(session, route, stage))) {
      if (this.owns(session)) await this.reverseOpening(session, false);
      return;
    }
    if (session.follow && !(await this.transferFollowedInput(session, route))) return;
    // A route that owned the scroll has no input to transfer.
    if (!owned && !(await this.waitForInputTransfer(session, () => session.scrollBridge?.sync()))) {
      return;
    }
    this.completeOpeningHandoff(session);
  }

  /**
   * The one write that makes the route the detail on screen: the flyer gives way to the route's
   * own picture, the Stage's floating back to the route's, and new input lands on the route. The
   * adoption's leases are released *before* the handoff's own is taken: both write the Stage's
   * `visibility` and `pointer-events`, and a lease restores what it found.
   */
  private async revealOpeningHandoff(
    session: OpeningSession,
    route: HeroRoute,
    stage: HeroStageNodes,
  ) {
    let revealed = false;
    await runScheduledFrame(session.abort.signal, {
      read: () => stage.scroller.scrollTop,
      write: (scrollTop) => {
        if (!this.owns(session)) return;
        const adoption = session.adoption?.route === route ? session.adoption : null;
        if (adoption) {
          session.adoption = null;
          session.shared.release(adoption.input);
          session.shared.release(adoption.lease);
          route.overlay.dataset.imageHeroRouteState = 'active';
        } else {
          if (session.follow) {
            session.shared.release(session.follow);
            session.follow = null;
          }
          route.scroller.scrollTop = scrollTop;
          if (!this.routes.reveal(route, session.owner)) return;
        }
        if (!session.follow && !adoption?.owned) {
          session.scrollBridge?.addTarget(route.scroller, route.content);
          session.scrollBridge?.sync();
          session.scrollContinuity?.setInputTarget(route.scroller);
        }
        session.handoffRoute = route;
        revealed = true;
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
    if (revealed) this.surface.notify();
    return revealed && this.owns(session);
  }

  /**
   * Turn the follow into the route's own scroll offset, when the hand gives a moment for it: the
   * Stage's stream has paused (bounded), or fresh input lands on the route — the reader is
   * driving what they see now. The fresh-input listener is **not passive**, for its one event:
   * the fold must be written before that event's own scroll applies, or the browser scrolls the
   * route from the parked offset and the fold then takes the delta back.
   */
  private async transferFollowedInput(session: OpeningSession, route: HeroRoute) {
    const follow = session.follow;
    if (!follow) return true;
    const scroller = route.scroller;
    const wait = new AbortController();
    const fresh = (event: Event) => {
      if (event instanceof WheelEvent && event.ctrlKey) return;
      wait.abort();
      commit();
    };
    const listeners = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    const commit = () => {
      listeners.forEach((type) => scroller.removeEventListener(type, fresh, true));
      if (session.follow !== follow || !this.owns(session)) return;
      follow.commit();
      session.shared.release(follow);
      session.follow = null;
      session.scrollBridge?.addTarget(route.scroller, route.content);
      session.scrollBridge?.sync();
      session.scrollContinuity?.setInputTarget(route.scroller);
    };
    listeners.forEach((type) =>
      scroller.addEventListener(type, fresh, { capture: true, passive: false }),
    );
    const abortWait = () => wait.abort();
    session.abort.signal.addEventListener('abort', abortWait, { once: true });
    try {
      if (!isHeroInteractionQuiet()) {
        await waitForHeroInteractionQuiet(
          wait.signal,
          HERO_HANDOFF_SCROLL_QUIET_MS,
          HERO_HANDOFF_FOLLOW_MAX_MS,
        );
      }
    } finally {
      session.abort.signal.removeEventListener('abort', abortWait);
    }
    if (!this.owns(session)) {
      listeners.forEach((type) => scroller.removeEventListener(type, fresh, true));
      return false;
    }
    await runScheduledFrame(session.abort.signal, { read: () => null, write: commit });
    listeners.forEach((type) => scroller.removeEventListener(type, fresh, true));
    return this.owns(session);
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
    /* A pull on the route can complete the handoff early (`prepareRouteDismiss`): a follow still
       running is folded into the route's offset before the bridge goes, or it would snap back. */
    session.follow?.commit();
    session.follow = null;
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
    // The drag is folded into the pose just measured; the reverse owns the flyer's offset now.
    session.pull?.releaseOffset();

    /* A route shown early hands the screen back to the Stage, which never stopped wearing the
       same tracks — so the reverse below turns one surface around, in the pose it was in. The
       route cannot stay: undoing the navigation unmounts it mid-reverse. */
    this.releaseAdoption(session);

    /* The reversed leg starts before anything else in this task. Its first frame needs the main
       thread once, to hand the new animations to the compositor, and every write queued in front
       of it — the history supersede, the phase publication and the React render it schedules,
       the lease disposal — used to sit between the finger lifting and that frame: measured
       ~120ms of a frozen picture at 4× CPU after a committed pull. The work below touches
       nothing the reverse reads. */
    const reversal =
      session.motion && measurement
        ? session.motion.reverse(measurement.destination, measurement.plane, measurement.pose)
        : null;
    // Caught, not dropped: `finished` rejects on cancel and the await below is later.
    reversal?.catch(() => undefined);
    session.reverseTurn = {
      landed: reversal ?? Promise.resolve(),
      navigationHandled,
    };

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
      if (reversal) await reversal;
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
    // A retarget that never navigated has only its predecessor's unwind to finish.
    if (session.predecessor && !session.routeNavigationStarted) {
      const unwound = await session.predecessor.unwind.catch(() => false);
      if (!session.provisionalClaimed) return unwound;
    }
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
    } else if (!navigationHandled && session.provisionalClaimed) {
      // Reversed before its deferred push (`runOpening`): only the barrier to take down.
      onBackground = await imageHeroHistory.ensureBackground(session.record);
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
        new Promise<boolean>((resolve) =>
          window.setTimeout(() => resolve(false), STEP_REVEAL_TIMEOUT_MS),
        ),
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
      const chosen =
        active instanceof HTMLElement &&
        active !== document.body &&
        active.isConnected &&
        !active.hasAttribute('data-route-focus');
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
    /* The leaving detail lets go of input in the same task as the gallery gets it back, and both
       wait for the flight to be running (`exposeGallery`): a shield takes the pointer at once,
       while `inert` on the detail and the lift of the gallery's `inert` — each a restyle of a
       whole subtree — land together under the moving picture. Done in one task, the overlay's
       focus trap can never pull back a focus the user has just given the gallery. */
    const freeze = this.routes.freeze(route, session.owner, { deferInert: true });
    session.shared.add(freeze);
    session.applyRouteInert = freeze.applyInert;
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
      /* No frame waits here any more. The gallery's `inert` restyle that the close used to wait
         two frames for is now deferred until this flight is running (`exposeGallery`), so the
         flight launches in the task that asked for the close: a released finger hands straight
         over to the flight instead of freezing the picture for two frames. */
      const exposeFallback = window.setTimeout(() => this.exposeGallery(session), 250);
      session.shared.add(() => window.clearTimeout(exposeFallback));
      /* Synchronous to the launch on purpose: the phase published by `beginClosing` re-renders
         the shell in a microtask, and every rect read below would otherwise force that commit's
         style and layout in front of the flight (~30ms at 4× CPU). Read now, the layout is the
         clean one the detail was already showing. */
      if ((session.retired || !this.owns(session)) && !(await this.guardClosing(session))) {
        this.exposeGallery(session);
        return;
      }
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
        speed: releaseSpeedAlong(session.intent.releaseVelocity, from, to),
      });

      /* The flyer's animation is ready once the compositor has it; one more frame and it has been
         presented. The gallery restyle runs after that, underneath a moving flight. */
      const flyer = flight.flyer.getAnimations()[0];
      void (flyer?.ready ?? Promise.resolve())
        .then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
        .then(
          () => this.exposeGallery(session),
          () => this.exposeGallery(session),
        );
      session.viewportBaseline = {
        destination: to,
        planeWidth: plane.viewportWidth,
        planeHeight: plane.viewportHeight,
        scrollTop: plane.scrollTop,
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
    // No flight to run under: hand the gallery back now rather than after the collapse.
    this.exposeGallery(session);
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
    /** The route following on the compositor, until the handoff commits it into a peer. */
    let following: HeroScrollFollow | null = null;
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
          /* Same task as the new height: the follow maps the Stage's whole range, so its
             keyframes must describe the range the compositor will scroll next frame. */
          following?.refresh();
          sync();
          /* The route's content moved under a route already on screen (its record arrived,
             the body mounted): if that moved its picture, the flyer re-aims at it. */
          if (session.adoption) this.handleViewportInvalidation();
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
      follow: (target, content, node) => {
        if (released) return null;
        if (targetContent) resizeObserver?.unobserve(targetContent);
        if (targetScroller) continuity.removePeer(targetScroller);
        targetScroller = null;
        targetContent = content;
        following?.release();
        following = followHeroScroll(stage.scroller, target, node);
        if (!following) {
          targetContent = null;
          return null;
        }
        const follow = following;
        resizeObserver?.observe(content);
        syncHeight();
        return {
          refresh: follow.refresh,
          commit: () => {
            follow.commit();
            if (following === follow) following = null;
          },
          release: () => {
            follow.release();
            if (following !== follow) return;
            following = null;
            if (targetContent === content) {
              resizeObserver?.unobserve(content);
              targetContent = null;
            }
          },
        };
      },
      sync,
      own: (target, content, forwardStageWheel) => {
        if (released) return;
        following?.release();
        following = null;
        if (targetContent && targetContent !== content) resizeObserver?.unobserve(targetContent);
        targetScroller = target;
        targetContent = content;
        resizeObserver?.observe(content);
        continuity.replacePeers(target);
        if (forwardStageWheel) continuity.addDeltaSource(stage.scroller);
        syncHeight();
      },
      disown: () => {
        if (released || !targetScroller) return;
        const owner = targetScroller;
        if (targetContent) resizeObserver?.unobserve(targetContent);
        targetScroller = null;
        targetContent = null;
        stage.scroller.scrollTop = owner.scrollTop;
        continuity.replacePeers(stage.scroller);
      },
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
        following?.release();
        following = null;
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
          !foreground.routeNavigationStarted &&
          ((foreground.collapseRecord &&
            navigation.programmaticToken === foreground.collapseRecord.token) ||
            (foreground.predecessor &&
              navigation.programmaticToken === foreground.predecessor.token)),
        );
        if (!ownsParallelCollapse) void this.reverseOpening(foreground, true);
        return;
      }
      if (
        navigation.programmatic &&
        foreground.predecessor &&
        navigation.programmaticToken === foreground.predecessor.token
      ) {
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
      frame === record.snapshot.previewFrame
        ? record.snapshot
        : { ...record.snapshot, previewFrame: frame };
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
          /* Once a route is on screen in the Stage's place, its picture is the one the flyer
             lands on; it wears the same window and fit, so the same unprojection applies. */
          const adopted = session.adoption?.route.target;
          const target = adopted?.isConnected ? adopted : stage.target;
          /* A route that owns the scroll carries the flyer in its own plane
             (`promoteAdoption`); a re-aim must stay there or it moves the flyer back under a
             scroller that no longer moves. */
          const owner = session.adoption?.owned ? session.adoption.route : null;
          const plane = owner?.anchor?.isConnected
            ? getElementScrollPlane(owner.anchor, owner.scroller, owner.overlay)
            : getElementScrollPlane(stage.anchor, stage.scroller, stage.overlay);
          return {
            // The landing target sits inside the container transform's fit, so a
            // mid-flight read is the scaled box; undo the fit before re-aiming.
            destination: motion.unprojectRect(getHeroRect(target)),
            plane,
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
        const scrollTop = measurement.plane.scrollTop;
        if (
          baseline &&
          baseline.planeWidth === measurement.plane.viewportWidth &&
          baseline.planeHeight === measurement.plane.viewportHeight &&
          heroRectsEqual(
            { ...baseline.destination, top: baseline.destination.top + baseline.scrollTop },
            { ...measurement.destination, top: measurement.destination.top + scrollTop },
            HERO_VIEWPORT_REBUILD_EPSILON_PX,
          )
        ) {
          return;
        }
        session.viewportBaseline = {
          destination: measurement.destination,
          planeWidth: measurement.plane.viewportWidth,
          planeHeight: measurement.plane.viewportHeight,
          scrollTop,
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
      const handle = window.requestIdleCallback(read, {
        timeout: BACKGROUND_SCROLL_READ_TIMEOUT_MS,
      });
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
                transferred ? ('native' as const) : quiet,
              ),
            ])
          : quiet);
      } finally {
        waitAbort.abort();
        signals.forEach((signal) => signal.removeEventListener('abort', abortWait));
      }
      if (
        !this.owns(session) ||
        session.abort.signal.aborted ||
        lifecycleSignal.aborted ||
        outcome === 'aborted'
      )
        return false;
      if (outcome === 'expired') return true;
      sync?.();
      const frameConfirmed = await waitForFrame(
        [session.abort.signal, lifecycleSignal],
        HERO_ROUTE_TIMEOUT_MS,
      );
      if (!this.owns(session) || session.abort.signal.aborted || lifecycleSignal.aborted)
        return false;
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

  /**
   * Hand the gallery back to the shell once a close is on screen.
   *
   * Lifting `inert` restyles every card (1,450 elements, ~66ms on a desktop and several times that
   * on a phone at 4× CPU). That restyle used to land in the very commit that started the close,
   * so the flight had to wait two frames for it — the picture froze under a released finger for
   * 120–250ms before it moved. The flight's tracks are transform and opacity on the compositor,
   * which keeps producing frames while the main thread restyles: so the flight goes first, and
   * the restyle runs underneath it.
   */
  private exposeGallery(session: HeroSession) {
    if (!this.owns(session) || this.runtime.phase !== 'closing.flight') return;
    if (session.kind === 'closing') session.applyRouteInert?.();
    this.updateRuntime({ galleryExposed: true });
    this.syncLeaving();
  }

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
    const direction = phase.startsWith('opening')
      ? 'forward'
      : phase === 'closing.flight'
        ? 'back'
        : phase === 'reversing'
          ? session?.kind === 'closing'
            ? 'forward'
            : 'back'
          : null;
    this.updateRuntime({
      phase,
      direction,
      sessionId: session?.id ?? null,
      imageId,
      background,
      // Only a close holds the gallery back, and only until its flight is running.
      galleryExposed: phase !== 'closing.flight',
    });
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      if (direction) root.dataset.imageHeroTransition = direction;
      else delete root.dataset.imageHeroTransition;
      root.dataset.imageHeroState = phase;
    }
    heroProbeMark(`hero-phase:${phase}`);
    this.syncLeaving();
    if (phase === 'detail-idle' && !session) this.settleDetailSurface();
    else if (phase === 'recovering' && !session) this.scheduleIdleRecovery();
    this.events.notify();
  }

  /**
   * **A settled detail is a visible, interactive detail — whoever got it there.**
   *
   * Every path that ends in `detail-idle` revealed "its" route: the one its session recorded, with
   * its session's seal owner. Under repeated open / Back that route is often not the live one: a
   * close that had already collapsed the ladder and is then turned around (a re-tap of the card
   * flying home) walks history forward again, the router mounts the overlay afresh, and the new
   * registration — arriving while the phase is `reversing` — is sealed by the idle owner. The
   * session then revealed its own, disconnected registration, the live one stayed
   * `visibility: hidden; inert`, and the shell, seeing `detail-idle`, made the gallery inert and
   * stopped its scrolling: the reported dead screen — the list on screen, `/pic/<id>` in the
   * address bar, nothing responding. A leaked freeze lease (`routes.freeze`) on the live route
   * did the same with the overlay visible.
   *
   * So the phase itself enforces it: with no session running, the live route of the picture the
   * runtime names is revealed and released from any interaction lease, and every other route is
   * sealed. Owner checks exist so that two *running* sessions cannot steal surfaces from each
   * other; with none running there is nobody to steal from.
   */
  private settleDetailSurface() {
    if (this.foreground || this.detailStep || this.stepSwap) return;
    const imageId = this.runtime.imageId;
    if (imageId === null) return;
    const href = normalizeHeroHref(window.location.href);
    if (!DETAIL_PATHNAME.test(window.location.pathname)) return;
    const route = this.routes.findByImage(imageId, href);
    if (!route) return; // Not mounted yet: `registerRoute` leaves it unsealed in `detail-idle`.
    this.routes.reveal(route, null);
    this.routes.sealAllExcept(route);
  }

  /**
   * `recovering` with no session is a state nothing leaves on its own: `reconcileIdleLocation`
   * enters it when the location is a detail whose ladder is present but not on its guard (a
   * traversal that landed on the base or the provisional rung in the middle of a burst of Back
   * and re-taps). Every route is sealed there, a tap on a card only queues behind it, and the
   * screen is dead until the next navigation. Once history is quiet, settle it from the ladder:
   * put the guard back and show the detail, or failing that collapse to the list.
   */
  private idleRecovery: Promise<void> | null = null;

  private scheduleIdleRecovery() {
    if (this.idleRecovery) return;
    const run = (async () => {
      const stable = await imageHeroHistory.waitForStable();
      /* A frame for the router: the traversal that put us here may still be committing. */
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!stable || this.foreground || this.detailStep || this.runtime.phase !== 'recovering')
        return;
      const match = window.location.pathname.match(DETAIL_PATHNAME);
      const record = match ? this.currentDetailRecord(Number(match[1])) : null;
      if (!record) {
        this.reconcileIdleLocation();
        return;
      }
      const role = imageHeroHistory.currentRole();
      if (role === 'provisional') {
        /* Under the detail: the list is where the user was heading. */
        if (await imageHeroHistory.ensureBackground(record)) {
          if (!this.foreground && this.runtime.phase === 'recovering') this.reconcileIdleLocation();
          return;
        }
      } else if (await this.restoreGuardStrict(record)) {
        if (this.foreground || this.runtime.phase !== 'recovering') return;
        this.detailRecord = record;
        this.currentSnapshot = record.snapshot;
        this.setPhase('detail-idle', null, record.background, record.imageId);
        this.rememberBackgroundScroll();
        return;
      }
      if (this.foreground || this.runtime.phase !== 'recovering') return;
      /* The ladder could not be repaired: present what the location shows, as a plain detail. */
      const activeId = Number(match![1]);
      this.detailRecord = null;
      this.currentSnapshot = null;
      this.setPhase('detail-idle', null, record.background, activeId);
    })();
    this.idleRecovery = run;
    void run.finally(() => {
      if (this.idleRecovery === run) this.idleRecovery = null;
      this.drainPendingOpen();
    });
  }

  /** A tap queued while the screen was unsettled, once nothing is running any more. */
  private drainPendingOpen() {
    const pending = this.pendingOpen;
    if (!pending || this.foreground || this.detailStep) return;
    if (this.runtime.phase !== 'gallery-idle') return;
    this.pendingOpen = null;
    if (pending.source.isConnected) this.startOpening(pending);
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
    /* A close marks its surfaces once its flight runs (`exposeGallery`): the marker's
       `[data-image-hero-leaving] *` rule restyles the whole leaving detail (~230 nodes, 16–34ms at
       4× CPU), and the close shield already holds the pointer until then. */
    if (this.runtime.direction === 'back' && this.runtime.galleryExposed) {
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
      next.background === current.background &&
      next.galleryExposed === current.galleryExposed
    ) {
      return;
    }
    publishImageHeroRuntime(next);
  }
}

export const imageHeroController = new HeroController();
bindImageHeroEngine(imageHeroController);

let trackedViewport: { width: number; height: number } | null = null;

/**
 * `innerWidth`/`innerHeight` as of the last `resize`. Read live, they bring style and layout up
 * to date first, and the click compares them (`takePreparedFlight`) right after the open has
 * dirtied both: a forced pass inside the tap (~5ms of a 4×-throttled tap, profiled) that the
 * frame redid after the flight's own writes. A resize is what changes them, and it is
 * dispatched before any frame shows the new size.
 */
function trackedViewportSize() {
  if (!trackedViewport) {
    const read = () => {
      trackedViewport = { width: window.innerWidth, height: window.innerHeight };
    };
    read();
    window.addEventListener('resize', read, { passive: true });
  }
  return trackedViewport!;
}

/** Run `task` in the first task after the next frame has been produced. */
function afterFirstFrame(task: () => void) {
  if (typeof requestAnimationFrame !== 'function') {
    queueMicrotask(task);
    return;
  }
  requestAnimationFrame(() => setTimeout(task, 0));
}
