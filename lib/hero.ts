'use client';

import { flushSync } from 'react-dom';
import type { PonyImage } from '@/lib/types/image';
import {
  prefetchImageDetail,
  type DetailRequestPriority,
} from '@/lib/detail';
import {
  HERO_DURATIONS,
  type HeroRect,
} from './hero/geometry';
import {
  HERO_DETAIL_OVERLAY_SELECTOR,
  HERO_BACKGROUND_SELECTOR,
  HERO_BACKGROUND_VISUAL_SELECTOR,
  HERO_HOST_SELECTOR,
  HERO_ROUTE_TIMEOUT_MS,
  HERO_STAGE_TARGET_SELECTOR,
  createElementWaiter,
  createInterruptedRouteHold,
  findImageHeroThumbnail,
  focusHeroElement,
  getHeroHost,
  getHeroRect,
  getVisualMedia,
  hideHeroElement,
  isVolatileVisualMedia,
  normalizeHeroSrc,
  normalizePathSearch,
  restoreHeroElement,
  suspendHeavyDetailMedia,
  waitForRouteOverlayGone,
} from './hero/dom';
import {
  captureHeroFrame,
} from './hero/frameCache';
import {
  animateBackground,
  animateDetailExit,
  animateFlight,
  cancelBackgroundAnimation,
  createFlight,
  createLayer,
  fadeOutFlightLayer,
  finishBackground,
  handoffStage,
  revealOverlay,
  revealRouteOverlay,
  reverseAnimation,
  type Flight,
  type FlightMotion,
} from './hero/flight';
import {
  bindClosingScroll,
  bindOpeningScroll,
  type ScrollSync,
} from './hero/scroll';
import { bindPendingImageHeroDismissGesture } from './hero/dismissGesture';
import {
  createImageHeroHistory,
} from './hero/history';
import {
  canSupersedeHeroClose,
  claimHeroTransition,
  clearActiveHeroTransition,
  clearImageHeroContext,
  ensureHeroTransitionPromise,
  getHeroStage,
  lastLocation,
  ownsHeroTransition,
  phase,
  publishHeroStage,
  queueHeroOpen,
  resolveHeroTransitionPromise,
  setClosingHeroCanBeSuperseded,
  setHeroBackgroundLocation,
  setHeroPhase,
  setHeroSnapshot,
  setHeroSourceElement,
  snapshot,
  sourceElement,
  subscribeHeroStage,
  takeQueuedHeroOpen,
  waitForHeroTransition,
  type HeroDirection,
  type ImageHeroBackgroundLocation,
  type ImageHeroSnapshot,
  type TransitionHandle,
} from './hero/state';

export type {
  ImageHeroBackgroundLocation,
  ImageHeroSnapshot,
  ImageHeroStageState,
} from './hero/state';
export { warmImageHeroFrame } from './hero/frameCache';

type OpeningInterrupt = {
  promise: Promise<void>;
  requested: boolean;
  navigationHandled: boolean;
  replayNavigation: (() => void) | null;
  request: (navigationHandled: boolean) => void;
  dispose: () => void;
};

type ImageHeroNavigationOptions = {
  backgroundLocation?: ImageHeroBackgroundLocation;
  detailHref?: string;
  historyMode?: 'create' | 'restore' | 'none';
  background?: 'fresh' | 'adopt' | 'continue';
};

type ImageHeroBackOptions = {
  background?: 'fresh' | 'continue';
};

type ImageHeroNavigate = (
  isCurrent: () => boolean,
) => void | Promise<void>;

const SNAPSHOT_TTL = 2 * 60 * 1000;
const INTERRUPT_EXIT_DURATION_MS = 180;

let componentWarmup: Promise<unknown> | null = null;
let requestOpeningInterrupt: ((navigationHandled: boolean) => void) | null = null;
let openingExpectedDetailHref: string | null = null;
let openingObservedExpectedRoute = false;
let stopTransitionScroll: (() => void) | null = null;
let stopPendingDismissGesture: (() => void) | null = null;
let preserveInterruptedRoute = false;
let releaseInterruptedRouteHold: (() => void) | null = null;

const imageHeroHistory = createImageHeroHistory({
  getPhase: () => phase,
  interruptOpening(navigationHandled) {
    requestOpeningInterrupt?.(navigationHandled);
  },
  closeFromHistory(record) {
    return navigateBackWithImageHero(record.imageId, () => {
      imageHeroHistory.commitBack(() => window.history.back());
    });
  },
  restoreFromHistory(record, source) {
    return navigateToImageWithHero(
      record.snapshot,
      source,
      () => {},
      (navigationHandled) => {
        if (!navigationHandled) {
          imageHeroHistory.commitBack(() => window.history.back());
        }
      },
      {
        backgroundLocation: record.background,
        detailHref: record.detailHref,
        historyMode: 'restore',
      },
    );
  },
});

function heroNow() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function stopActiveTransitionScroll() {
  stopTransitionScroll?.();
  stopTransitionScroll = null;
}

function stopActivePendingDismissGesture() {
  stopPendingDismissGesture?.();
  stopPendingDismissGesture = null;
}

function isAtOpeningDetailLocation() {
  return Boolean(
    openingExpectedDetailHref &&
    normalizePathSearch(window.location.href) === openingExpectedDetailHref,
  );
}

function holdInterruptedRouteUntilGone() {
  if (releaseInterruptedRouteHold) return;
  preserveInterruptedRoute = true;
  const release = createInterruptedRouteHold(() => {
    if (releaseInterruptedRouteHold === release) releaseInterruptedRouteHold = null;
    preserveInterruptedRoute = false;
  });
  releaseInterruptedRouteHold = release;
}

export function initializeImageHeroHistory() {
  imageHeroHistory.initialize();
}

export function observeImageHeroClientNavigation(href: string) {
  if (phase !== 'opening' || !requestOpeningInterrupt) return false;
  const nextHref = normalizePathSearch(href);
  if (openingExpectedDetailHref && nextHref === openingExpectedDetailHref) {
    openingObservedExpectedRoute = true;
    return false;
  }
  const backgroundHref = lastLocation
    ? normalizePathSearch(`${lastLocation.pathname}${lastLocation.search}`)
    : null;
  // The stage can commit one render before App Router publishes the target
  // pathname. Ignore that initial source-route observation, but interrupt any
  // other route immediately, even if the detail route has not mounted yet.
  if (!openingObservedExpectedRoute && backgroundHref === nextHref) return false;
  requestOpeningInterrupt(true);
  return true;
}

function createOpeningInterrupt(): OpeningInterrupt {
  let resolvePromise: (() => void) | null = null;
  let releasePopStateHook = () => {};
  const state: OpeningInterrupt = {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    requested: false,
    navigationHandled: false,
    replayNavigation: null,
    request(navigationHandled) {
      if (state.requested) {
        state.navigationHandled ||= navigationHandled;
        return;
      }
      state.requested = true;
      state.navigationHandled = navigationHandled;
      // Hide the real intercepted route as soon as an opening is interrupted.
      // The stage/flyer remain visible, so this closes the small handoff window
      // where the route could otherwise paint for one frame before reversing.
      document.documentElement.dataset.imageHeroInterrupted = 'true';
      resolvePromise?.();
    },
    dispose() {
      window.removeEventListener('keydown', handleKeyDown);
      releasePopStateHook();
      window.removeEventListener('click', handleClick, true);
      if (requestOpeningInterrupt === state.request) requestOpeningInterrupt = null;
    },
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    state.request(false);
  };
  const handlePopState = () => state.request(true);
  const handleClick = (event: MouseEvent) => {
    if (
      state.navigationHandled ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const target = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>('a[href]')
      : null;
    if (!target || target.target === '_blank' || target.hasAttribute('download')) return;
    let href: string;
    try {
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      href = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return;
    }
    if (normalizePathSearch(href) === openingExpectedDetailHref) return;

    event.preventDefault();
    event.stopPropagation();
    state.replayNavigation = () => {
      if (target.isConnected) target.click();
    };
    state.request(false);
  };

  requestOpeningInterrupt = state.request;
  window.addEventListener('keydown', handleKeyDown);
  releasePopStateHook = imageHeroHistory.registerTransitionPopStateHook(handlePopState);
  window.addEventListener('click', handleClick, true);
  return state;
}

function begin(direction: HeroDirection) {
  releaseInterruptedRouteHold?.();
  if (direction === 'forward') setClosingHeroCanBeSuperseded(false);
  setHeroPhase(direction === 'forward' ? 'opening' : 'closing');
  imageHeroHistory.resetClosingRestoreRequested();
  stopActiveTransitionScroll();
  document.documentElement.dataset.imageHeroTransition = direction;
  const currentSnapshot = snapshot;
  if (direction === 'forward' && currentSnapshot) {
    flushSync(() => publishHeroStage({ phase: 'opening', snapshot: currentSnapshot }));
  } else {
    publishHeroStage({ phase: 'idle', snapshot: null });
  }
  ensureHeroTransitionPromise();
}

function beginTransition(direction: HeroDirection): TransitionHandle {
  const handle = claimHeroTransition(direction);
  begin(direction);
  return handle;
}

function ownsTransition(handle: TransitionHandle) {
  return ownsHeroTransition(handle);
}

async function raceTransitionOutcome<T>(
  handle: TransitionHandle,
  interruption: OpeningInterrupt,
  promise: Promise<T>,
): Promise<'supersede' | 'interrupt' | { value: T }> {
  if (handle.superseded) return 'supersede';
  if (interruption.requested) return 'interrupt';
  const result = await Promise.race([
    promise.then((value): { value: T } => ({ value })),
    interruption.promise.then((): 'interrupt' => 'interrupt'),
    handle.supersededPromise.then((): 'supersede' => 'supersede'),
  ]);
  if (handle.superseded) return 'supersede';
  if (result === 'interrupt' || interruption.requested) return 'interrupt';
  if (result === 'supersede') return 'supersede';
  return result;
}

function end() {
  setHeroPhase('idle');
  imageHeroHistory.resetClosingRestoreRequested();
  openingExpectedDetailHref = null;
  openingObservedExpectedRoute = false;
  clearActiveHeroTransition();
  delete document.documentElement.dataset.imageHeroTransition;
  if (!preserveInterruptedRoute) {
    delete document.documentElement.dataset.imageHeroInterrupted;
  }
  publishHeroStage({ phase: 'idle', snapshot: null });
  resolveHeroTransitionPromise();
  stopActiveTransitionScroll();
  const pending = takeQueuedHeroOpen();
  if (pending) queueMicrotask(pending);
}

function isFresh(value: ImageHeroSnapshot | null, id: number) {
  return Boolean(value && value.image.id === id && Date.now() - value.createdAt < SNAPSHOT_TTL);
}

function getClosingLandingRect(target: HTMLElement, continueFromCurrentBackground: boolean) {
  if (!continueFromCurrentBackground) return getHeroRect(target);
  const background = document.querySelector<HTMLElement>(HERO_BACKGROUND_VISUAL_SELECTOR)
    ?? document.querySelector<HTMLElement>(HERO_BACKGROUND_SELECTOR);
  if (!background) return getHeroRect(target);

  // A pull gesture raises/scales the gallery before the close starts. The
  // source rect should retain its drag transform, but the thumbnail endpoint
  // must describe the gallery after that temporary sink has fully cleared.
  // Remove the compositor transform only for this synchronous measurement;
  // no paint can occur between the write, read, and restoration.
  const transform = background.style.transform;
  background.style.transform = 'none';
  const rect = getHeroRect(target);
  background.style.transform = transform;
  return rect;
}

export function isImageHeroTransitionRunning() {
  return phase !== 'idle';
}

export function getActiveImageHeroKind(): 'opening' | 'closing' | null {
  return phase === 'idle' ? null : phase;
}

export function canSupersedeImageHeroClose() {
  return canSupersedeHeroClose();
}

export function queueImageHeroOpen(run: () => void) {
  queueHeroOpen(run);
}

// Collapse a preempted transition's history back to the gallery. Exposed so a
// preempting open can await it before pushing its own entries.
export function collapseSupersededImageHeroHistory() {
  return imageHeroHistory.collapseSuperseded();
}

export function interruptImageHero() {
  if (phase !== 'opening' || !requestOpeningInterrupt) return false;
  requestOpeningInterrupt(false);
  return true;
}

export function subscribeImageHeroStage(listener: () => void) {
  return subscribeHeroStage(listener);
}

export function getImageHeroStage() {
  return getHeroStage();
}

export function waitForImageHeroTransition() {
  return waitForHeroTransition();
}

export function warmImageHero(
  imageId?: number,
  priority: DetailRequestPriority = 'immediate',
) {
  componentWarmup ??= import('@/components/PicDetail').catch(() => {
    componentWarmup = null;
  });
  if (imageId === undefined) return componentWarmup;
  return Promise.all([
    componentWarmup,
    prefetchImageDetail(imageId, { priority }).catch(() => undefined),
  ]);
}

export function prepareImageHero(
  image: PonyImage,
  source: HTMLElement | null,
  canAnimate: boolean,
  previewSrcOverride?: string,
) {
  if (!source) return null;
  const visual = getVisualMedia(source);
  const previewFrame = captureHeroFrame(visual);
  const mediaType = visual instanceof HTMLVideoElement ? 'video' : 'image';
  const previewSrc = normalizeHeroSrc(
    visual?.currentSrc ||
    visual?.getAttribute('src') ||
    previewSrcOverride ||
    (mediaType === 'video'
      ? image.representations?.thumb ||
        image.representations?.thumb_small ||
        image.representations?.thumb_tiny ||
        image.representations?.small ||
        image.representations?.full
      : image.representations?.small) ||
    image.representations?.thumb ||
    image.representations?.small ||
    image.representations?.full ||
    image.view_url ||
    '',
  );
  const rect = getHeroRect(source);
  const next: ImageHeroSnapshot = {
    image,
    previewSrc,
    previewFrame: previewFrame ?? document.createElement('canvas'),
    sourceKey: source.dataset.imageHeroSourceKey ?? null,
    mediaType,
    canAnimate: canAnimate && Boolean(previewFrame) && rect.width > 0 && rect.height > 0,
    createdAt: Date.now(),
  };
  return next;
}

export function getImageHeroOrigin(imageId: number) {
  return isFresh(snapshot, imageId) ? snapshot : null;
}

export function getImageHeroBackgroundLocation() {
  return lastLocation;
}

export function canAnimateImageHero(value: ImageHeroSnapshot) {
  return Boolean(
    value.canAnimate &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.animate === 'function' &&
    document.querySelector(HERO_HOST_SELECTOR),
  );
}

export function canUseImageHeroTransition(value: ImageHeroSnapshot) {
  return canAnimateImageHero(value) && phase === 'idle';
}

// Reverse an opening flight back onto the source thumbnail. `landed` picks the
// two behaviours that differ between an interrupt caught mid-flight and one
// caught after the flyer already reached the stage: the landed variant hides
// the now-visible stage target and plays a fresh background sink-out, while the
// mid-flight variant reverses the still-running forward sink in place.
async function reverseOpening(
  motion: FlightMotion,
  forwardBackground: ReturnType<typeof animateBackground>,
  target: HTMLElement,
  landingRect: HeroRect,
  navigateBack: (navigationHandled: boolean) => void,
  wasNavigationHandled: () => boolean,
  landed: boolean,
) {
  setHeroPhase('closing');
  stopActivePendingDismissGesture();
  document.documentElement.dataset.imageHeroInterrupted = 'true';
  if (landed) hideHeroElement(document.querySelector<HTMLElement>(HERO_STAGE_TARGET_SELECTOR));
  stopActiveTransitionScroll();
  const scrollSync = bindClosingScroll(motion, target, landingRect, 'from', () => phase, false);
  stopTransitionScroll = scrollSync.stop;
  const detailExit = animateDetailExit(landed ? HERO_DURATIONS.back : INTERRUPT_EXIT_DURATION_MS);
  const backgroundReverse = landed ? animateBackground('back') : null;
  const backgroundFinished = landed
    ? backgroundReverse?.animation.finished ?? Promise.resolve()
    : reverseAnimation(forwardBackground?.animation);
  const motionFinished = motion.reverse();
  await Promise.allSettled([motionFinished, backgroundFinished, detailExit.finished]);
  scrollSync.flush();
  motion.finish();
  const settleBackground = () => {
    if (!landed) return;
    finishBackground(backgroundReverse);
    finishBackground(forwardBackground);
  };
  if (wasNavigationHandled() && isAtOpeningDetailLocation()) {
    detailExit.restore();
    scrollSync.flush(true);
    settleBackground();
    return true;
  }
  detailExit.finish();
  // A browser/Android back can arrive while the reverse animation is already
  // running. Read the flag at commit time so we do not issue a second back.
  navigateBack(wasNavigationHandled());
  if (!await waitForRouteOverlayGone()) holdInterruptedRouteUntilGone();
  scrollSync.flush();
  settleBackground();
  return false;
}

export async function navigateToImageWithHero(
  value: ImageHeroSnapshot,
  source: HTMLElement,
  navigate: ImageHeroNavigate,
  navigateBack: (navigationHandled: boolean) => void,
  options: ImageHeroNavigationOptions = {},
) {
  const runNavigation = (isCurrent: () => boolean) =>
    Promise.resolve(navigate(isCurrent)).catch((error) => {
      console.error('[hero] opening navigation failed', error);
    });
  if (!canAnimateImageHero(value)) {
    void runNavigation(() => true);
    return false;
  }
  const host = getHeroHost();
  if (!host) {
    void runNavigation(() => true);
    return false;
  }

  setHeroSnapshot(value);
  setHeroSourceElement(source);
  openingExpectedDetailHref = normalizePathSearch(
    options.detailHref ?? `/pic/${value.image.id}`,
  );
  openingObservedExpectedRoute = false;
  setHeroBackgroundLocation(options.backgroundLocation ?? {
    pathname: window.location.pathname,
    search: window.location.search,
  });
  imageHeroHistory.ensureListener();

  const startedAt = heroNow();
  const handle = beginTransition('forward');

  // The stage committed synchronously in begin(). Its landing target is the
  // flight destination 鈥?the exact box the user sees after the flight, so the
  // handoff cannot jump regardless of scrollbar width or container padding.
  const stageTarget = document.querySelector<HTMLElement>(HERO_STAGE_TARGET_SELECTOR);
  let destinationRect: HeroRect | null = null;
  let layer: HTMLElement | null = null;
  let flight: Flight | null = null;
  try {
    destinationRect = stageTarget ? getHeroRect(stageTarget) : null;
    if (stageTarget && destinationRect &&
        destinationRect.width > 1 && destinationRect.height > 1) {
      layer = createLayer(host);
      flight = createFlight(layer, source, value.previewFrame, host, source, 'forward');
    }
  } catch (error) {
    console.error('[hero] failed to prepare opening flight', error);
  }
  if (!stageTarget || !destinationRect || !layer || !flight) {
    layer?.remove();
    if (ownsTransition(handle)) {
      setHeroSnapshot(null);
      setHeroSourceElement(null);
      end();
    }
    void runNavigation(() => true);
    return false;
  }

  const sourceOpacity = hideHeroElement(source);
  let target: HTMLElement | null = null;
  let targetOpacity = '';
  let navigated = false;
  let layerRemoved = false;
  let flightLanded = false;
  let interrupted = false;
  let restoredDetail = false;
  let lateBack = false;
  const waitController = new AbortController();
  const elementWaiter = createElementWaiter(waitController.signal);

  const interruption = createOpeningInterrupt();
  const isCurrentOpening = () => (
    ownsTransition(handle) &&
    phase === 'opening' &&
    !interruption.requested
  );
  const background = options.background === 'adopt'
    ? null
    : animateBackground('forward', options.background === 'continue');
  const stageOverlay = document.querySelector<HTMLElement>('[data-image-hero-stage]');
  if (stageOverlay) {
    void revealOverlay(
      stageOverlay,
      startedAt,
      isCurrentOpening,
    ).catch(() => undefined);
  }
  const routeRevealPromise = elementWaiter.wait(
    `${HERO_DETAIL_OVERLAY_SELECTOR}:not([data-image-hero-stage])`,
    HERO_ROUTE_TIMEOUT_MS,
  ).then((overlay) => overlay
    ? revealRouteOverlay(overlay, startedAt, isCurrentOpening)
    : undefined);
  void routeRevealPromise.catch(() => undefined);
  const targetPromise = elementWaiter.wait(
    `[data-image-hero-role="detail"][data-image-hero-id="${value.image.id}"][data-image-hero-ready="true"]`,
    HERO_ROUTE_TIMEOUT_MS,
  ).then((element) => {
    if (element) targetOpacity = hideHeroElement(element);
    target = element;
    return element;
  });
  const flightMotion = animateFlight(
    flight,
    flight.startRect,
    destinationRect,
    window.getComputedStyle(stageTarget).borderRadius,
    'forward',
  );
  const flightPromise = Promise.all([
    flightMotion.finished,
    background?.animation.finished ?? Promise.resolve(),
  ]).then(() => {
    flightLanded = true;
  });
  const openingScroll = bindOpeningScroll(flightMotion, elementWaiter.wait, () => phase);
  stopTransitionScroll = openingScroll.stop;
  const startRect = flight.startRect;
  const reverse = (landed: boolean) => {
    waitController.abort();
    return reverseOpening(
      flightMotion,
      background,
      source,
      startRect,
      navigateBack,
      () => interruption.navigationHandled,
      landed,
    );
  };
  stopActivePendingDismissGesture();
  const pendingDismissGesture = bindPendingImageHeroDismissGesture({
    canStart: isCurrentOpening,
    dismiss: async () => {
      if (interruptImageHero()) await waitForHeroTransition();
    },
  });
  stopPendingDismissGesture = pendingDismissGesture;
  const standDown = () => {
    // A newer transition took over: fade this flyer out and leave all shared
    // state (phase, snapshot, stage, background, history) to the new owner.
    waitController.abort();
    fadeOutFlightLayer(layer, flightMotion);
    layerRemoved = true;
  };

  try {
    navigated = true;
    void runNavigation(isCurrentOpening);

    // Stage 1 鈥?flight in progress. Interrupt reverses from mid-air; supersede
    // fades out while the newer flight flies.
    const stage1 = await raceTransitionOutcome(handle, interruption, flightPromise);
    if (stage1 === 'supersede') {
      standDown();
    } else if (stage1 === 'interrupt' && !flightLanded) {
      restoredDetail = await reverse(false);
    } else {
      await flightPromise;
      stageTarget.style.opacity = '1';
      publishHeroStage({ phase: 'landed', snapshot: value });

      // Stage 2 鈥?wait for the routed detail to decode, then (stage 3) for any
      // touch scroll to settle. Esc/back reverses from the stable stage; a
      // newer open supersedes.
      const stage2 = await raceTransitionOutcome(handle, interruption, targetPromise);
      const settled = stage2 === 'interrupt' || stage2 === 'supersede'
        ? stage2
        : await raceTransitionOutcome(handle, interruption, openingScroll.waitForRelease());

      if (settled === 'supersede') {
        standDown();
      } else if (settled === 'interrupt') {
        restoredDetail = await reverse(true);
      } else {
        // Stage 4 鈥?atomic handoff from the stage to the real route.
        const handedOff = await handoffStage(
          target,
          targetOpacity,
          async () => { openingScroll.flush(); },
          () => interruption.requested || !ownsTransition(handle),
        );
        if (!handedOff) {
          if (handle.superseded) {
            standDown();
          } else {
            restoredDetail = await reverse(true);
          }
        } else {
          openingScroll.flush(true);
          restoreHeroElement(source, sourceOpacity);
          layer.remove();
          layerRemoved = true;
          lateBack = interruption.requested;
        }
      }
    }
    interrupted = restoredDetail === false && !lateBack && !layerRemoved && !handle.superseded;
  } catch (error) {
    console.error('[hero] opening transition failed', error);
    if (!navigated) void runNavigation(isCurrentOpening);
  } finally {
    waitController.abort();
    elementWaiter.dispose();
    interruption.dispose();
    if (stopPendingDismissGesture === pendingDismissGesture) {
      pendingDismissGesture();
      stopPendingDismissGesture = null;
    }
    if (ownsTransition(handle)) finishBackground(background);
    restoreHeroElement(source, sourceOpacity);
    restoreHeroElement(target, targetOpacity);
    if (!layerRemoved) layer.remove();
    if (ownsTransition(handle)) {
      if (interrupted) {
        clearImageHeroContext();
      }
      end();
    }
  }

  if (handle.superseded) return false;
  if (interrupted) {
    focusHeroElement(source);
    interruption.replayNavigation?.();
    return false;
  } else if (lateBack) {
    await navigateBackWithImageHero(
      value.image.id,
      () => navigateBack(interruption.navigationHandled),
    );
    return false;
  } else {
    focusHeroElement(document.querySelector<HTMLElement>('[data-image-detail-floating-back="route"]'));
    if (options.historyMode !== 'restore' && options.historyMode !== 'none') {
      imageHeroHistory.installGuard(value, lastLocation);
    }
    return true;
  }
}

export async function navigateBackWithImageHero(
  imageId: number,
  navigate: () => void,
  options: ImageHeroBackOptions = {},
) {
  const source = document.querySelector<HTMLElement>(
    `[data-image-hero-role="detail"][data-image-hero-id="${imageId}"]`,
  );
  const value = getImageHeroOrigin(imageId);
  const target = sourceElement?.isConnected
    ? sourceElement
    : findImageHeroThumbnail(imageId, value?.sourceKey);
  const host = getHeroHost();

  if (!source || !target || !host || !value || phase !== 'idle' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof HTMLElement.prototype.animate !== 'function') {
    clearImageHeroContext();
    imageHeroHistory.commitBack(navigate);
    window.setTimeout(() => focusHeroElement(target), 0);
    return;
  }

  const continueFromCurrentBackground = options.background === 'continue';
  let partialLayer: HTMLElement | null = null;
  let partialResumeHeavyMedia: (() => Promise<void>) | null = null;
  let partialSourceOpacity = '';
  let partialTargetOpacity = '';
  let preparation: {
    layer: HTMLElement;
    flight: Flight;
    resumeHeavyMedia: () => Promise<void>;
    sourceOpacity: string;
    targetOpacity: string;
    landingRect: HeroRect;
  } | null = null;

  try {
    partialLayer = createLayer(host);
    const currentMedia = getVisualMedia(source);
    const closingFrame = currentMedia && isVolatileVisualMedia(currentMedia)
      ? captureHeroFrame(currentMedia) ?? value.previewFrame
      : value.previewFrame;
    const flight = createFlight(partialLayer, source, closingFrame, host, target, 'back');
    const resumeHeavyMedia = suspendHeavyDetailMedia(source);
    partialResumeHeavyMedia = resumeHeavyMedia;
    const sourceOpacity = hideHeroElement(source);
    partialSourceOpacity = sourceOpacity;
    const targetOpacity = hideHeroElement(target);
    partialTargetOpacity = targetOpacity;
    const landingRect = getClosingLandingRect(target, continueFromCurrentBackground);
    preparation = {
      layer: partialLayer,
      flight,
      resumeHeavyMedia,
      sourceOpacity,
      targetOpacity,
      landingRect,
    };
  } catch (error) {
    console.error('[hero] failed to prepare closing flight', error);
    partialLayer?.remove();
    restoreHeroElement(source, partialSourceOpacity);
    restoreHeroElement(target, partialTargetOpacity);
    void partialResumeHeavyMedia?.();
    clearImageHeroContext();
    imageHeroHistory.commitBack(navigate);
    window.setTimeout(() => focusHeroElement(target), 0);
    return;
  }

  // Every preparation step above either completes the immutable bundle or
  // returns through the cleanup fallback, so the transition body can keep
  // non-null references without exposing a half-created flyer.
  const {
    layer,
    flight,
    resumeHeavyMedia,
    sourceOpacity,
    targetOpacity,
    landingRect,
  } = preparation;
  let navigated = false;
  let targetRestored = false;
  let layerRemoved = false;
  let restoredDetail = false;
  let mediaResumed = false;
  const isDetailPath = () => /^\/pic\/[^/]+\/?$/.test(window.location.pathname);

  const handle = beginTransition('back');
  setClosingHeroCanBeSuperseded(true);
  const historyRestore = imageHeroHistory.createClosingRestoreWaiter();
  const historyRestoreRequested = historyRestore.promise;
  let popStateCount = 0;
  const handlePopState = () => { popStateCount += 1; };
  // Re-read the final history position after the flight. A rapid Back then Forward
  // can otherwise leave the still-mounted detail route with its exit fill and
  // pointer lock applied, while a second Back still needs to finish the close.
  const releasePopStateHook = imageHeroHistory.registerTransitionPopStateHook(handlePopState);
  let background: ReturnType<typeof animateBackground> = null;
  let motion: FlightMotion | null = null;
  let scrollSync: ScrollSync | null = null;
  let detailExit: ReturnType<typeof animateDetailExit> | null = null;
  const restoreClosingDetail = () => {
    detailExit?.restore();
    if (!mediaResumed) {
      void resumeHeavyMedia();
      mediaResumed = true;
    }
    restoreHeroElement(source, sourceOpacity);
    restoredDetail = true;
  };
  const restoreClosingHistoryBounce = () => {
    if (!imageHeroHistory.isClosingRestoreRequested()) return false;
    restoreClosingDetail();
    imageHeroHistory.restoreCurrentGuard();
    return true;
  };

  try {
    motion = animateFlight(
      flight,
      flight.startRect,
      landingRect,
      window.getComputedStyle(target).borderRadius,
      'back',
    );
    scrollSync = bindClosingScroll(
      motion,
      target,
      landingRect,
      'to',
      () => phase,
      !continueFromCurrentBackground,
    );
    stopTransitionScroll = scrollSync.stop;
    background = animateBackground('back', options.background === 'continue');
    detailExit = animateDetailExit(HERO_DURATIONS.back);
    const flightPromise = Promise.all([
      motion.finished,
      background?.animation.finished ?? Promise.resolve(),
      detailExit.finished,
    ]);
    const raced = await Promise.race([
      flightPromise.then(() => 'done' as const),
      handle.supersededPromise.then(() => 'supersede' as const),
    ]);
    setClosingHeroCanBeSuperseded(false);
    if (raced === 'supersede') {
      // A newer open took over: fade this close flyer out and leave the history
      // return to the new open (it collapses these entries itself).
      // B has synchronously sampled the current background transform and
      // started its replacement animation before this promise resumes. Cancel
      // A's animation without clearing B's shared inline transform, and release
      // A's exit pointer lock so a reused route shell cannot inherit it.
      detailExit.restore();
      cancelBackgroundAnimation(background);
      background = null;
      fadeOutFlightLayer(layer, motion);
      layerRemoved = true;
    } else {
    scrollSync.flush();
    motion.finish();
    finishBackground(background);
    background = null;
    let historyOutcome = imageHeroHistory.resolveClosingOutcome(imageId, popStateCount);
    if (historyOutcome === 'restore-detail') {
      restoreClosingDetail();
    } else {
      detailExit.finish();
    }
    if (historyOutcome === 'commit') {
      navigated = true;
      imageHeroHistory.commitBack(navigate);
    }
    if (historyOutcome !== 'restore-detail') {
      const routeWaitController = new AbortController();
      const waitOutcome = await Promise.race([
        waitForRouteOverlayGone(1200, routeWaitController.signal).then((gone) =>
          gone ? 'route' as const : 'timeout' as const),
        historyRestoreRequested.then(() => 'restore-detail' as const),
      ]);
      routeWaitController.abort();
      if (waitOutcome === 'restore-detail' || restoreClosingHistoryBounce()) {
        historyOutcome = 'restore-detail';
      } else if (waitOutcome === 'timeout' && isDetailPath()) {
        // A slow/failed route transition must not leave the detail shell with
        // the exit animation's fill and pointer lock applied forever.
        restoreClosingDetail();
        historyOutcome = 'restore-detail';
      }
    }
    restoreHeroElement(target, targetOpacity);
    targetRestored = true;
    layer.remove();
    layerRemoved = true;
    }
  } catch (error) {
    console.error('[hero] closing transition failed', error);
    const historyOutcome = imageHeroHistory.resolveClosingOutcome(imageId, popStateCount);
    if (historyOutcome === 'restore-detail') {
      restoreClosingDetail();
    } else if (!navigated && historyOutcome === 'commit') {
      imageHeroHistory.commitBack(navigate);
    }
  } finally {
    setClosingHeroCanBeSuperseded(false);
    historyRestore.dispose();
    releasePopStateHook();
    scrollSync?.flush();
    if (ownsTransition(handle)) finishBackground(background);
    if (
      !handle.superseded &&
      !mediaResumed &&
      source.isConnected &&
      isDetailPath()
    ) {
      detailExit?.restore();
      void resumeHeavyMedia();
      restoredDetail = true;
    }
    restoreHeroElement(source, sourceOpacity);
    if (!targetRestored) restoreHeroElement(target, targetOpacity);
    if (ownsTransition(handle)) {
      if (!restoredDetail) {
        clearImageHeroContext();
      }
      if (!layerRemoved) layer.remove();
      end();
    } else if (!layerRemoved) {
      layer.remove();
    }
  }
  if (!handle.superseded) {
    focusHeroElement(restoredDetail
      ? document.querySelector<HTMLElement>('[data-image-detail-back-button]')
      : target);
  }
}
