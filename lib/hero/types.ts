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
