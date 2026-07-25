'use client';

import { imageHeroController } from './hero/controller';
import { warmImageHeroFrame } from './hero/frameCache';
import {
  canAnimateImageHero,
  canUseImageHeroTransition,
  prepareImageHero,
  warmImageHero,
} from './hero/media';
import type {
  HeroCloseIntent,
  HeroCloseNavigation,
  HeroDetailRouteChangeIntent,
  HeroMilestone,
  HeroOpenIntent,
  HeroOpenNavigation,
  HeroRouteRegistration,
  HeroStageNodes,
} from './hero/types';

export type {
  HeroControllerPhase,
  HeroDetailRouteChangeIntent,
  HeroMilestone,
  HeroRouteRegistration,
  HeroStageNodes,
  ImageHeroBackgroundLocation,
  ImageHeroCloseOutcome,
  ImageHeroRuntimeState,
  ImageHeroSnapshot,
  ImageHeroStageState,
} from './hero/types';

export {
  canAnimateImageHero,
  canUseImageHeroTransition,
  prepareImageHero,
  warmImageHero,
  warmImageHeroFrame,
};

export function initializeImageHeroHistory(
  router?: HeroOpenNavigation & HeroCloseNavigation,
) {
  imageHeroController.initialize(router);
}

export function connectImageHeroRouter(router: HeroOpenNavigation & HeroCloseNavigation) {
  imageHeroController.connectRouter(router);
}

export function requestImageHeroOpen(intent: HeroOpenIntent) {
  return imageHeroController.requestOpen(intent);
}

export function requestImageHeroClose(intent: HeroCloseIntent) {
  return imageHeroController.requestClose(intent);
}

export function requestImageHeroDetailRouteChange(intent: HeroDetailRouteChangeIntent) {
  return imageHeroController.requestDetailRouteChange(intent);
}

export function interruptImageHero(navigationHandled = false) {
  return imageHeroController.interrupt(navigationHandled);
}

export function observeImageHeroClientNavigation(href: string) {
  imageHeroController.observeRoute(href);
}

export function registerImageHeroStage(sessionId: number, nodes: HeroStageNodes) {
  return imageHeroController.registerStage(sessionId, nodes);
}

export function createImageHeroRouteSurfaceId(imageId: number) {
  return imageHeroController.createSurfaceId(imageId);
}

export function registerImageHeroRoute(registration: HeroRouteRegistration) {
  return imageHeroController.registerRoute(registration);
}

export function updateImageHeroRouteTarget(surfaceId: string, target: HTMLElement | null) {
  imageHeroController.updateRouteTarget(surfaceId, target);
}

export function markImageHeroRoutePreviewPaintable(
  surfaceId: string,
  target?: HTMLElement | null,
) {
  imageHeroController.markRoutePreviewPaintable(surfaceId, target);
}

export function bindImageHeroDismissGesture(
  surfaceId: string,
  canStart: () => boolean,
  navigation: HeroCloseNavigation,
) {
  return imageHeroController.bindRouteDismiss(surfaceId, canStart, navigation);
}

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

export function getActiveImageHeroKind() {
  return imageHeroController.getActiveKind();
}

export function canSupersedeImageHeroClose() {
  return imageHeroController.canSupersedeClose();
}

export function waitForImageHeroTransition(signal?: AbortSignal) {
  return imageHeroController.waitForIdle(signal).then(() => undefined);
}

export function waitForImageHeroMilestone(
  milestone: HeroMilestone,
  sessionId?: number,
  signal?: AbortSignal,
) {
  return imageHeroController.waitForMilestone(milestone, sessionId, signal);
}

export function isImageHeroPublicationQuiet() {
  return imageHeroController.isPublicationQuiet();
}

export function isImageHeroDetailDataPublishable(imageId: number) {
  return imageHeroController.isDetailDataPublishable(imageId);
}

export function getImageHeroDiagnostics() {
  return imageHeroController.diagnostics();
}
