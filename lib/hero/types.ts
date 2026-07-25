'use client';

import type { PonyImage } from '@/lib/types/image';
import type { FrameAsset } from './frameCache';

export type HeroDirection = 'forward' | 'back';

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

export type HeroRouteNodes = {
  overlay: HTMLElement;
  scroller: HTMLElement;
  content: HTMLElement;
  surface: HTMLElement;
  target: HTMLElement | null;
  floatingBack: HTMLElement | null;
};

export type HeroRouteRegistration = HeroRouteNodes & {
  surfaceId: string;
  imageId: number;
  previewPaintable: boolean;
};

export type HeroStageNodes = {
  overlay: HTMLElement;
  scroller: HTMLElement;
  content: HTMLElement;
  surface: HTMLElement;
  target: HTMLElement;
  anchor: HTMLElement;
  floatingBack: HTMLElement | null;
};

export type HeroOpenNavigation = {
  push: (href: string) => void;
  replace: (href: string) => void;
};

export type HeroCloseNavigation = {
  replace: (href: string) => void;
  push: (href: string) => void;
};

export type HeroOpenIntent = {
  snapshot: ImageHeroSnapshot;
  source: HTMLElement;
  detailHref: string;
  background?: ImageHeroBackgroundLocation;
  navigation: HeroOpenNavigation;
  historyRestore?: boolean;
};

export type HeroCloseIntent = {
  imageId: number;
  navigation: HeroCloseNavigation;
  backgroundMode?: 'fresh' | 'continue';
  cause?: 'button' | 'history' | 'dismiss' | 'interrupt';
};

export type HeroDetailRouteChangeIntent = {
  imageId: number;
  detailHref: string;
  navigation: HeroOpenNavigation & HeroCloseNavigation;
};

export type HeroMilestone =
  | 'route-registered'
  | 'preview-paintable'
  | 'landed'
  | 'handoff-complete'
  | 'interaction-quiet'
  | 'idle';
