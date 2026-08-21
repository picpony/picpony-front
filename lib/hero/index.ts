'use client';

/**
 * Public surface of the Hero transition system.
 *
 * Components should import from here rather than reaching into `lib/hero/*`, so
 * the internal module layout stays free to change.
 */

import { imageHeroController } from './controller';
import type {
  HeroCloseIntent,
  HeroDetailRouteChangeIntent,
  HeroNavigation,
  HeroOpenIntent,
  HeroRouteRegistration,
  HeroStageNodes,
} from './types';

export type {
  HeroControllerPhase,
  HeroDetailRouteChangeIntent,
  HeroNavigation,
  HeroRouteRegistration,
  HeroStageNodes,
  ImageHeroBackgroundLocation,
  ImageHeroCloseOutcome,
  ImageHeroRuntimeState,
  ImageHeroSnapshot,
  ImageHeroStageState,
} from './types';

export { warmImageHeroFrame } from './frameCache';
export { isScrollLikelyActive } from './input';
export { publishWhenHeroSettled } from './publish';
export { canAnimateImageHero, prepareImageHero, warmImageHero } from './media';

// --- Setup ---------------------------------------------------------------

export function initializeImageHeroHistory(router?: HeroNavigation) {
  imageHeroController.initialize(router);
}

// --- Intents -------------------------------------------------------------

export function requestImageHeroOpen(intent: HeroOpenIntent) {
  return imageHeroController.requestOpen(intent);
}

export function requestImageHeroClose(intent: HeroCloseIntent) {
  return imageHeroController.requestClose(intent);
}

export function requestImageHeroDetailRouteChange(intent: HeroDetailRouteChangeIntent) {
  return imageHeroController.requestDetailRouteChange(intent);
}

/** Reverse whatever transition is running. Returns false if none was. */
export function interruptImageHero(navigationHandled = false) {
  return imageHeroController.interrupt(navigationHandled);
}

// --- Registration --------------------------------------------------------

export function observeImageHeroClientNavigation(href: string) {
  imageHeroController.observeRoute(href);
}

export function registerImageHeroStage(sessionId: number, nodes: HeroStageNodes) {
  return imageHeroController.registerStage(sessionId, nodes);
}

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

export function getImageHeroBackgroundLocation() {
  return imageHeroController.getBackground();
}

export function getImageHeroRuntime() {
  return imageHeroController.getRuntime();
}

export function subscribeImageHeroRuntime(listener: () => void) {
  return imageHeroController.subscribeRuntime(listener);
}

export function getImageHeroStage() {
  return imageHeroController.getStage();
}

export function subscribeImageHeroStage(listener: () => void) {
  return imageHeroController.subscribeStage(listener);
}

export function isImageHeroTransitionRunning() {
  return imageHeroController.isRunning();
}

export function waitForImageHeroTransition(signal?: AbortSignal) {
  return imageHeroController.waitForIdle(signal).then(() => undefined);
}

/** True once no transition is holding back detail content. */
export function isImageHeroPublicationQuiet() {
  return imageHeroController.isPublicationQuiet();
}

/** True when this image's detail data may be shown without disturbing a flight. */
export function isImageHeroDetailDataPublishable(imageId: number) {
  return imageHeroController.isDetailDataPublishable(imageId);
}
