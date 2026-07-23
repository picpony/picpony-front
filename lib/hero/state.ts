'use client';

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

export type TransitionHandle = {
  generation: number;
  kind: HeroDirection;
  superseded: boolean;
  supersededPromise: Promise<void>;
  markSuperseded: () => void;
};

export let phase: HeroPhase = 'idle';
export let snapshot: ImageHeroSnapshot | null = null;
export let sourceElement: HTMLElement | null = null;
export let lastLocation: ImageHeroBackgroundLocation | null = null;

let transitionFinished: Promise<void> = Promise.resolve();
let resolveTransition: (() => void) | null = null;
let stageState: ImageHeroStageState = { phase: 'idle', snapshot: null };
const stageListeners = new Set<() => void>();
let transitionGeneration = 0;
let activeTransition: TransitionHandle | null = null;
let closingCanBeSuperseded = false;
let pendingOpenAfterTransition: (() => void) | null = null;

export function setHeroPhase(next: HeroPhase) {
  phase = next;
}

export function setHeroSnapshot(next: ImageHeroSnapshot | null) {
  snapshot = next;
}

export function setHeroSourceElement(next: HTMLElement | null) {
  sourceElement = next;
}

export function setHeroBackgroundLocation(next: ImageHeroBackgroundLocation | null) {
  lastLocation = next;
}

export function clearImageHeroContext() {
  snapshot = null;
  sourceElement = null;
  lastLocation = null;
}

export function publishHeroStage(next: ImageHeroStageState) {
  stageState = next;
  stageListeners.forEach((listener) => listener());
}

export function subscribeHeroStage(listener: () => void) {
  stageListeners.add(listener);
  return () => stageListeners.delete(listener);
}

export function getHeroStage() {
  return stageState;
}

export function waitForHeroTransition() {
  return transitionFinished;
}

export function ensureHeroTransitionPromise() {
  if (resolveTransition) return;
  transitionFinished = new Promise<void>((resolve) => {
    resolveTransition = resolve;
  });
}

export function resolveHeroTransitionPromise() {
  resolveTransition?.();
  resolveTransition = null;
}

export function claimHeroTransition(direction: HeroDirection): TransitionHandle {
  activeTransition?.markSuperseded();
  let resolveSuperseded!: () => void;
  const handle: TransitionHandle = {
    generation: ++transitionGeneration,
    kind: direction,
    superseded: false,
    supersededPromise: new Promise<void>((resolve) => {
      resolveSuperseded = resolve;
    }),
    markSuperseded() {
      if (handle.superseded) return;
      handle.superseded = true;
      resolveSuperseded();
    },
  };
  activeTransition = handle;
  return handle;
}

export function ownsHeroTransition(handle: TransitionHandle) {
  return activeTransition === handle && !handle.superseded;
}

export function clearActiveHeroTransition() {
  activeTransition = null;
}

export function setClosingHeroCanBeSuperseded(value: boolean) {
  closingCanBeSuperseded = value;
}

export function canSupersedeHeroClose() {
  return phase === 'closing' && closingCanBeSuperseded;
}

export function queueHeroOpen(run: () => void) {
  pendingOpenAfterTransition = run;
}

export function takeQueuedHeroOpen() {
  const pending = pendingOpenAfterTransition;
  pendingOpenAfterTransition = null;
  return pending;
}
