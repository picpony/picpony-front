'use client';

/**
 * Public surface of the Hero transition system — **the engine side**. Importing this module
 * evaluates the controller, so it belongs to the surfaces that open or show a picture (gallery
 * cards, the detail route). The shell, which renders on every route, imports `./runtime`
 * instead: the published state and the forwarding calls, without the engine.
 */

import { imageHeroController } from './controller';
import type {
  HeroCloseIntent,
  HeroDetailStepIntent,
  HeroNavigation,
  HeroOpenIntent,
  HeroRouteRegistration,
} from './types';

export type {
  HeroControllerPhase,
  HeroDetailStepIntent,
  HeroNavigation,
  HeroRouteRegistration,
  HeroStageNodes,
  ImageHeroBackgroundLocation,
  ImageHeroCloseOutcome,
  ImageHeroRuntimeState,
  ImageHeroSnapshot,
  ImageHeroStageState,
} from './types';

export {
  getImageHeroNavigation,
  getImageHeroRuntime,
  getImageHeroStage,
  initializeImageHeroHistory,
  interruptImageHero,
  isImageHeroTransitionRunning,
  observeImageHeroClientNavigation,
  registerImageDetailClose,
  registerImageHeroStage,
  requestImageDetailClose,
  subscribeImageHeroRuntime,
  subscribeImageHeroStage,
  waitForImageHeroTransition,
} from './runtime';
export { findImageHeroCardLink } from './dom';
export { warmImageHeroFrame } from './frameCache';
export { isScrollLikelyActive } from './input';
export { publishWhenHeroSettled } from './publish';
export {
  canAnimateImageHero,
  prepareImageHero,
  warmImageHero,
  warmImageHeroSource,
} from './media';

// --- Intents -------------------------------------------------------------

export function requestImageHeroOpen(intent: HeroOpenIntent) {
  return imageHeroController.requestOpen(intent);
}

export function requestImageHeroClose(intent: HeroCloseIntent) {
  return imageHeroController.requestClose(intent);
}

/** 上一张 / 下一张: an in-place step to another picture — see `HeroController.requestDetailStep`. */
export function requestImageHeroDetailStep(intent: HeroDetailStepIntent) {
  return imageHeroController.requestDetailStep(intent);
}

/** The detail painted the picture a step was heading for. */
export function settleImageHeroDetailStep(imageId: number) {
  imageHeroController.settleDetailStep(imageId);
}

/** 返回 on a reloaded detail whose ladder survived it — see `HeroController.leaveOrphanLadder`. */
export function leaveImageHeroOrphanLadder() {
  return imageHeroController.leaveOrphanLadder();
}

// --- Registration --------------------------------------------------------

export function registerImageHeroRoute(registration: HeroRouteRegistration) {
  return imageHeroController.registerRoute(registration);
}

export function updateImageHeroRouteTarget(surfaceId: string, target: HTMLElement | null) {
  imageHeroController.updateRouteTarget(surfaceId, target);
}

export function markImageHeroRoutePreviewPaintable(surfaceId: string, target?: HTMLElement | null) {
  imageHeroController.markRoutePreviewPaintable(surfaceId, target);
}

/** The detail resolved with nothing to fly to — see `HeroRouteRegistration`. */
export function markImageHeroRouteResolvedWithoutMedia(surfaceId: string) {
  imageHeroController.markRouteResolvedWithoutMedia(surfaceId);
}

export function bindImageHeroDismissGesture(
  surfaceId: string,
  canStart: () => boolean,
  navigation: HeroNavigation,
) {
  return imageHeroController.bindRouteDismiss(surfaceId, canStart, navigation);
}

// --- State ---------------------------------------------------------------

export function getImageHeroOrigin(imageId: number) {
  return imageHeroController.getOrigin(imageId);
}

/** True once no transition is holding back detail content. */
export function isImageHeroPublicationQuiet() {
  return imageHeroController.isPublicationQuiet();
}

/** True when this image's detail data may be shown without disturbing a flight. */
export function isImageHeroDetailDataPublishable(imageId: number) {
  return imageHeroController.isDetailDataPublishable(imageId);
}
