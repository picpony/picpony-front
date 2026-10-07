'use client';

import type { ImagePreview } from '@/lib/types/image';
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
  image: ImagePreview;
  previewSrc: string;
  /**
   * The bitmap a flight takes off from. Always present on a snapshot a press made; a step's
   * (上一张 / 下一张) may have none when the list never painted that picture — it needs one only
   * if the viewer later closes by flying, and the close captures the live frame first.
   */
  previewFrame: FrameAsset | null;
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
  /** Actual direction, including a reversal toward either the gallery or the detail. */
  direction: HeroDirection | null;
  sessionId: number | null;
  imageId: number | null;
  /* No `interactionQuiet` here: it was published and never read, and every quiet↔active
     transition would re-render the runtime's subscribers — see `subscribeHeroInteraction`
     in the controller. */
  stage: ImageHeroStageState;
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
   * The route has finished resolving and has **no** hero media — the failure state. The
   * handoff requires a paintable preview and a target, and only `DetailImage`/`DetailVideo`
   * set either, so without this flag the wait ran to `HERO_DETAIL_ROUTE_TIMEOUT_MS` and a
   * missing image left the error page sealed and the screen blank for 30 seconds.
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
  /** Warm a route's payload ahead of the press (the card's intent ladder). */
  prefetch?: (href: string) => void;
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
 * transform read backwards. `dismiss` does not: a swipe-down is a gesture the hand is already
 * driving, so the surface keeps the translate and veil the finger left it at and only
 * continues them. M3 draws the same line for a drawer.
 */
export type HeroChoreography = 'container' | 'dismiss';

export type HeroCloseIntent = {
  imageId: number;
  navigation: HeroNavigation;
  backgroundMode?: 'fresh' | 'continue';
  cause?: 'button' | 'history' | 'dismiss' | 'interrupt';
};

/**
 * 上一张 / 下一张 inside an open viewer: an in-place change of the picture, never a navigation.
 * `flush` completes the detail's own visual swap immediately — a close or an interruption that
 * arrives mid-transition must measure the picture that is about to be on screen.
 */
export type HeroDetailStepIntent = {
  fromId: number;
  toId: number;
  snapshot: ImageHeroSnapshot;
  flush: () => void;
};
