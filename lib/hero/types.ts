import type { PonyImage } from '@/lib/types/image';

export type HeroDirection = 'forward' | 'back';
export type HeroPhase = 'idle' | 'opening' | 'closing';

export interface ImageHeroSnapshot {
  image: PonyImage;
  previewSrc: string;
  previewFrame: HTMLCanvasElement;
  sourceKey: string | null;
  mediaType: 'image' | 'video';
  canAnimate: boolean;
  createdAt: number;
}

export interface ImageHeroBackgroundLocation {
  pathname: string;
  search: string;
}

export interface ImageHeroStageState {
  phase: 'idle' | 'opening' | 'landed';
  snapshot: ImageHeroSnapshot | null;
}

export type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type Host = Rect & { element: HTMLElement };

export type ShadeLayer = {
  element: HTMLElement;
};

export type Flight = {
  layer: HTMLElement;
  compensator: HTMLElement;
  flyer: HTMLElement;
  image: HTMLCanvasElement;
  shade: ShadeLayer | null;
  startRect: Rect;
  radius: string;
  host: Host;
};

export type FlightMotion = {
  finished: Promise<void>;
  reverse: () => Promise<void>;
  finish: () => void;
  retarget: (x: number, y: number, endpoint?: 'from' | 'to') => void;
  cancel: () => void;
};

export type ScrollSync = {
  sync: () => void;
  flush: (preferRoute?: boolean) => void;
  waitForRelease: () => Promise<void>;
  stop: () => void;
};

export type TransitionScrollNodes = {
  stageScroller: HTMLElement | null;
  routeScroller: HTMLElement | null;
  targetWrap: HTMLElement | null;
};

export type OpeningInterrupt = {
  promise: Promise<void>;
  requested: boolean;
  navigationHandled: boolean;
  replayNavigation: (() => void) | null;
  request: (navigationHandled: boolean) => void;
  dispose: () => void;
};

export type ImageHeroNavigationOptions = {
  backgroundLocation?: ImageHeroBackgroundLocation;
  detailHref?: string;
  historyMode?: 'create' | 'restore' | 'none';
};

export type ImageHeroHistoryMarker = {
  version: 1;
  token: string;
  kind: 'base' | 'guard';
  imageId: number;
  detailHref: string;
  background: ImageHeroBackgroundLocation;
};

export type ImageHeroHistoryRecord = {
  token: string;
  imageId: number;
  detailHref: string;
  background: ImageHeroBackgroundLocation;
  snapshot: ImageHeroSnapshot;
};

export type ImageHeroHistoryPosition = 'unknown' | 'background' | 'base' | 'guard';
export type ClosingHistoryOutcome = 'commit' | 'handled' | 'restore-detail';

export type VisualMedia = HTMLImageElement | HTMLVideoElement;
