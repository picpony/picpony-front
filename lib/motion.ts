'use client';

/**
 * Public motion entry, loaded through motionLazy or by a deferred component.
 * Each implementation owns its state and lifecycle; they never import this facade.
 * Token-only consumers use motionTokens, springTiming or appScroller directly.
 */
export { DURATION, EASE, eases, SPRING, spring, Flip, gsap, useGSAP, Observer } from './motion/engine';
export { circularReveal, changeScheme, changePalette, changeCustomPalette, changePaletteHues } from './motion/theme';
export { useDrawerSwipe, DrawerSwipeHost, type DrawerSwipeOptions } from './motion/drawer';
export { useStaggerGridOn, StaggerGridHost } from './motion/grid';
export { playSharedAxis, supportsEdgeMask, type SharedAxisHandle } from './motion/sharedAxis';
export type { LeanBlock, LeanPlan } from './motion/tabGeometry';
export {
  startTabTransition,
  primeTabTransition,
  playPrimedTabTransition,
  TabPanesDriver,
  finishTabTransition,
} from './motion/tabs';
export { getAppScroller, heroOwnsScreen, setHeroBusyCheck } from './appScroller';
export { beginPageTransit, setThemeWipeGuard } from './pageTransit';
export { setTabIntent } from './tabIntent';
export { spawnRipple } from './ripple';
export { scrollAppToTop, scrollAppToElement } from './scrollTo';
