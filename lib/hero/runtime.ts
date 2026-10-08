'use client';

import type {
  HeroNavigation,
  HeroStageNodes,
  ImageHeroRuntimeState,
  ImageHeroStageState,
} from './types';

/**
 * The part of the hero system the **shell** needs on every route, and nothing else: the runtime
 * store the shell renders from (phase, direction, image, stage, background) and the handful of
 * calls it forwards (route observation, the Stage's registration, an interrupt).
 *
 * **The engine is not imported here, and that is the point of the file.** The controller, the
 * flight, the container transform and the geometry solver are ~30KB brotli; imported by the
 * shell they landed in the first document of every route, including the many that never open a
 * picture. The engine binds itself to this module when its own module evaluates — which happens
 * wherever a picture can be opened (a gallery card's `useHeroLink`, the detail route's
 * `PicDetail`), so it is resident before any press can need it. Until then every forwarded call
 * is the no-flight answer: nothing is running, nothing to interrupt, no Stage to register.
 *
 * History handling needs no warm-up either: a ladder entry reached before the engine exists is
 * reconciled from the location when the engine binds, which is the same thing the engine does
 * on its own first load.
 */

const EMPTY_STAGE: ImageHeroStageState = { phase: 'idle', snapshot: null, sessionId: null };

export const INITIAL_HERO_RUNTIME: ImageHeroRuntimeState = {
  phase: 'gallery-idle',
  direction: null,
  sessionId: null,
  imageId: null,
  stage: EMPTY_STAGE,
  background: null,
};

let runtime = INITIAL_HERO_RUNTIME;
const listeners = new Set<() => void>();

export function getImageHeroRuntime() {
  return runtime;
}

export function subscribeImageHeroRuntime(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getImageHeroStage() {
  return runtime.stage;
}

export const subscribeImageHeroStage = subscribeImageHeroRuntime;

/** Engine only: replace the published state and tell every subscriber. */
export function publishImageHeroRuntime(next: ImageHeroRuntimeState) {
  runtime = next;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Runtime subscriptions are external; one throwing must not starve the rest.
    }
  });
}

/** What the engine exposes to the shell. */
export interface HeroEngineBinding {
  initialize(router?: HeroNavigation): void;
  destroy(): void;
  observeRoute(href: string): void;
  registerStage(sessionId: number, nodes: HeroStageNodes): () => void;
  interrupt(navigationHandled?: boolean): boolean;
  isRunning(): boolean;
  waitForIdle(signal?: AbortSignal): Promise<unknown>;
}

let engine: HeroEngineBinding | null = null;
let router: HeroNavigation | undefined;

/**
 * Called once by the engine's module as it evaluates. A second binding is a development
 * hot-reload of the controller: the previous instance is torn down first, or its listeners
 * would keep answering beside the new one's.
 */
export function bindImageHeroEngine(next: HeroEngineBinding) {
  /* A server render evaluates the engine's module as well; there is no document to bind to,
     and a module-scope binding there would be shared by every concurrent request. */
  if (typeof window === 'undefined') return;
  if (engine && engine !== next) engine.destroy();
  engine = next;
  next.initialize(router);
}

export function initializeImageHeroHistory(nextRouter?: HeroNavigation) {
  if (nextRouter) router = nextRouter;
  engine?.initialize(nextRouter);
}

/**
 * The app router the shell handed over, for a gallery card's navigation and its intent warm. A
 * card must not call `useRouter()` itself: that hook reads `LayoutRouterContext`, a new object on
 * every router change, so every mounted card re-rendered on every URL write — each `?page=`,
 * `?view=` and `?tab=` — around 150ms of React per write with a hundred cards in development.
 */
export function getImageHeroNavigation(): HeroNavigation | undefined {
  return router;
}

export function observeImageHeroClientNavigation(href: string) {
  engine?.observeRoute(href);
}

export function registerImageHeroStage(sessionId: number, nodes: HeroStageNodes) {
  return engine ? engine.registerStage(sessionId, nodes) : () => {};
}

/** Reverse whatever transition is running. Returns false if none was. */
export function interruptImageHero(navigationHandled = false) {
  return engine?.interrupt(navigationHandled) ?? false;
}

export function isImageHeroTransitionRunning() {
  return engine?.isRunning() ?? false;
}

export function waitForImageHeroTransition(signal?: AbortSignal) {
  return engine ? engine.waitForIdle(signal).then(() => undefined) : Promise.resolve();
}

/* The open overlay's own 返回, for chrome that asks the same thing: the drawer row of the very
   page the overlay covers. The detail's overlay presentation registers it while it is mounted,
   so the shell reaches it without importing the engine. */
let detailClose: (() => void) | null = null;

export function registerImageDetailClose(close: () => void) {
  detailClose = close;
  return () => {
    if (detailClose === close) detailClose = null;
  };
}

/** Close the open image-detail overlay exactly as its 返回 does. False when none is mounted. */
export function requestImageDetailClose() {
  if (!detailClose) return false;
  detailClose();
  return true;
}
