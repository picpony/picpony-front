'use client';

import type { PonyImage } from '@/lib/types/image';
import type { FrameAsset } from './frameCache';

export type HeroDirection = 'forward' | 'back';

/**
 * `opening.*` and `closing.flight` are the only phases with a live flyer.
 * `reversing` covers an interrupted flight of either kind; `recovering` covers a
 * transaction that lost its flight and is reconciling the URL instead.
 */
export type HeroControllerPhase =
  | 'gallery-idle'
  | 'opening.flight'
  | 'opening.landed'
  | 'opening.handoff'
  | 'detail-idle'
  | 'closing.flight'
  | 'reversing'
  | 'recovering';

export type ImageHeroBackgroundLocation = {
  pathname: string;
  search: string;
};

/** Everything captured at activation, before any network work. */
export type ImageHeroSnapshot = {
  image: PonyImage;
  previewSrc: string;
  previewFrame: FrameAsset;
  sourceKey: string | null;
  mediaType: 'image' | 'video';
  canAnimate: boolean;
  createdAt: number;
};

export type ImageHeroStageState = {
  phase: 'idle' | 'opening' | 'landed';
  snapshot: ImageHeroSnapshot | null;
  sessionId: number | null;
};

export type ImageHeroRuntimeState = {
  phase: HeroControllerPhase;
  sessionId: number | null;
  imageId: number | null;
  stage: ImageHeroStageState;
  interactionQuiet: boolean;
  background: ImageHeroBackgroundLocation | null;
};

export type ImageHeroCloseOutcome = 'closed' | 'handled' | 'restored';

/** The DOM a detail surface is built from. */
export type HeroSurfaceNodes = {
  overlay: HTMLElement;
  scroller: HTMLElement;
  content: HTMLElement;
  surface: HTMLElement;
  floatingBack: HTMLElement | null;
};

export type HeroRouteRegistration = HeroSurfaceNodes & {
  surfaceId: string;
  imageId: number;
  target: HTMLElement | null;
  /** The route can paint the same pixels the flyer is showing. */
  previewPaintable: boolean;
  /**
   * The route has finished resolving and has **no** hero media — the failure state.
   *
   * Without it the handoff can never be satisfied: it requires a paintable preview and a
   * target, and both are set only by `DetailImage`/`DetailVideo`, which the failure branch
   * does not render. The wait then ran to `HERO_DETAIL_ROUTE_TIMEOUT_MS`, so an image that
   * turned out not to exist left the error page sealed and the screen blank for **30
   * seconds** before `reconcileIdleLocation` surfaced it.
   */
  resolvedWithoutMedia: boolean;
};

export type HeroStageNodes = HeroSurfaceNodes & {
  target: HTMLElement;
  /** Positions the flight layer inside the stage scroller's own coordinates. */
  anchor: HTMLElement;
};

export type HeroNavigation = {
  push: (href: string) => void;
  replace: (href: string) => void;
};

export type HeroOpenIntent = {
  snapshot: ImageHeroSnapshot;
  source: HTMLElement;
  detailHref: string;
  background?: ImageHeroBackgroundLocation;
  navigation: HeroNavigation;
  /** Replaying a history entry rather than starting a fresh navigation. */
  historyRestore?: boolean;
};

/**
 * Which of the two exit choreographies a close runs.
 *
 * `container` shrinks the whole detail surface back into the thumbnail — Material's container
 * transform read backwards, with the return thresholds. `dismiss` does not: a swipe-down is a
 * gesture the hand is already driving, so the surface keeps the translate and veil the finger
 * left it at and only continues them. M3 draws the same line for a drawer, settling a drag
 * release on a different spring from a close.
 */
export type HeroChoreography = 'container' | 'dismiss';

export type HeroCloseIntent = {
  imageId: number;
  navigation: HeroNavigation;
  backgroundMode?: 'fresh' | 'continue';
  cause?: 'button' | 'history' | 'dismiss' | 'interrupt';
};

export type HeroDetailRouteChangeIntent = {
  imageId: number;
  detailHref: string;
  navigation: HeroNavigation;
};
