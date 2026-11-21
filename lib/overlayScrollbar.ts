'use client';

import type {
  OverlayScrollbars as OverlayScrollbarsInstance,
  PartialOptions,
  ScrollbarsAutoHideBehavior,
} from 'overlayscrollbars';
import { useEffect, type RefObject } from 'react';
import { motionTier } from '@/lib/appearance';
import { MEDIA } from '@/lib/constants';
import { runWhenIdle } from '@/lib/utils';

/**
 * Shared OverlayScrollbars runtime and hooks.
 *
 * Replaces native classic scrollbars with floating overlay pseudo-scrollbars
 * that occupy zero layout width (no reserved `scrollbar-gutter`, no sideways
 * shifts when overflow appears). The library is loaded on demand and cached
 * synchronously after first arrival so initial route scripts stay lean while
 * later modals, popovers and panels attach without an async wait.
 *
 * For React-owned scrollers we bind `elements.viewport = viewport` (keeping
 * `viewport === target`) and place the generated `.os-scrollbar` tracks in a
 * non-scrolling sibling slot (`scrollbars.slot`). React keeps ownership of
 * every child node, existing refs/selectors/scrollTop/ScrollTimeline targets
 * stay on the real scroller element, and padding/layout utilities on the
 * scroller are never overwritten by OverlayScrollbars' wrapper styles.
 */

export const PICPONY_SCROLLBAR_THEME = 'os-theme-picpony';

export type ScrollbarAxis = 'y' | 'x' | 'both';
export type ScrollbarAutoHide = 'auto' | ScrollbarsAutoHideBehavior;

export interface OverlayScrollbarOptions {
  axis?: ScrollbarAxis;
  autoHide?: ScrollbarAutoHide;
  defer?: boolean;
  enabled?: boolean;
  observeInput?: boolean;
  /** Changing value forces a geometry refresh (for controlled `<textarea>`). */
  refreshKey?: string | number;
}

export interface OverlayScrollbarHandle {
  update: () => void;
  destroy: () => void;
}

type OverlayScrollbarsModule = typeof import('overlayscrollbars');

let loadedModule: OverlayScrollbarsModule | null = null;
let loadingModule: Promise<OverlayScrollbarsModule> | null = null;

function registerPlugins(mod: OverlayScrollbarsModule): OverlayScrollbarsModule {
  if (!loadedModule) {
    mod.OverlayScrollbars.plugin(mod.ClickScrollPlugin);
    loadedModule = mod;
  }
  return loadedModule;
}

export function loadOverlayScrollbars(): Promise<OverlayScrollbarsModule> {
  if (loadedModule) return Promise.resolve(loadedModule);
  if (!loadingModule) {
    loadingModule = import('overlayscrollbars')
      .then((mod) => registerPlugins(mod))
      .catch((error) => {
        loadingModule = null;
        throw error;
      });
  }
  return loadingModule;
}

function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(MEDIA.pointerCoarse).matches
  );
}

const SKIP_FLOW_DIRECTION = () => ({});
const IGNORE_ALL_MUTATIONS = () => true;

/**
 * Resolve OverlayScrollbars options from axis, pointer type and motion tier.
 *
 * Fine-pointer devices show overflowing bars on entry (and on initial paint
 * via `autoHideSuspend`) and fade them after leaving; coarse touch devices
 * keep bars hidden until a scroll starts, matching mobile overlay bars.
 *
 * `flowDirectionStyles` skips OverlayScrollbars' repeated `getComputedStyle`
 * RTL/writing-mode checks (PicPony is LTR `horizontal-tb`), and `elementEvents`
 * disables its default `querySelectorAll('img')` scan on every DOM mutation.
 * When `ignoreMutations` is set, content-size tracking is delegated to our
 * direct-child `ResizeObserver` instead of OverlayScrollbars' subtree
 * `MutationObserver`, avoiding synchronous forced layouts during taps and
 * transitions.
 */
export function buildScrollbarOptions(
  axis: ScrollbarAxis = 'y',
  autoHide: ScrollbarAutoHide = 'auto',
  ignoreMutations = false,
): PartialOptions {
  const coarse = isCoarsePointer();
  const resolvedAutoHide: ScrollbarsAutoHideBehavior =
    autoHide === 'auto' ? (coarse ? 'scroll' : 'leave') : autoHide;
  const suspend = autoHide === 'auto' ? !coarse : false;

  return {
    paddingAbsolute: false,
    showNativeOverlaidScrollbars: false,
    update: {
      elementEvents: null,
      flowDirectionStyles: SKIP_FLOW_DIRECTION,
      ignoreMutation: ignoreMutations ? IGNORE_ALL_MUTATIONS : null,
    },
    overflow: {
      x: axis === 'y' ? 'hidden' : 'scroll',
      y: axis === 'x' ? 'hidden' : 'scroll',
    },
    scrollbars: {
      theme: PICPONY_SCROLLBAR_THEME,
      visibility: 'auto',
      autoHide: resolvedAutoHide,
      autoHideDelay: 800,
      autoHideSuspend: suspend,
      dragScroll: true,
      clickScroll: motionTier('scroll') === 'off' ? 'instant' : true,
      pointers: ['mouse', 'touch', 'pen'],
    },
  };
}

const SKIP_OBSERVE_SELECTOR =
  '[data-image-hero-gallery-anchor],[data-image-hero-route-anchor],[data-image-hero-stage-anchor]';

function observeDirectChildren(viewport: HTMLElement, onResize: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const resize = new ResizeObserver(onResize);
  const syncChildren = () => {
    resize.disconnect();
    for (const child of Array.from(viewport.children)) {
      if (child instanceof HTMLElement && !child.matches(SKIP_OBSERVE_SELECTOR)) {
        resize.observe(child);
      }
    }
  };
  syncChildren();
  const mutations =
    typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          syncChildren();
          onResize();
        })
      : null;
  mutations?.observe(viewport, { childList: true });
  return () => {
    resize.disconnect();
    mutations?.disconnect();
  };
}

/**
 * Attach OverlayScrollbars directly to an existing scrolling element while
 * rendering `.os-scrollbar` inside a non-scrolling positioned `slot` ancestor.
 */
export function mountSlottedScrollbar(
  viewport: HTMLElement,
  slot: HTMLElement,
  {
    axis = 'y',
    autoHide = 'auto',
    defer = false,
    observeInput = false,
  }: Pick<OverlayScrollbarOptions, 'axis' | 'autoHide' | 'defer' | 'observeInput'> = {},
): OverlayScrollbarHandle {
  let disposed = false;
  let instance: OverlayScrollbarsInstance | null = null;
  let cancelIdle: (() => void) | null = null;
  let cancelChildResize: (() => void) | null = null;
  let motionWaitObserver: MutationObserver | null = null;
  let frame = 0;

  const ignoreMutations =
    axis === 'y' && viewport.tagName !== 'P' && !viewport.isContentEditable;

  const isTransitionBusy = () =>
    viewport.hasAttribute('data-axis-running') ||
    document.documentElement.hasAttribute('data-image-hero-transition');

  const waitForMotionSettle = () => {
    if (motionWaitObserver || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      if (disposed) {
        observer.disconnect();
        motionWaitObserver = null;
        return;
      }
      if (!isTransitionBusy()) {
        observer.disconnect();
        motionWaitObserver = null;
        scheduleUpdate();
      }
    });
    motionWaitObserver = observer;
    observer.observe(viewport, { attributes: true, attributeFilter: ['data-axis-running'] });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-image-hero-transition'],
    });
  };

  const scheduleUpdate = () => {
    if (disposed || !instance || frame) return;
    if (isTransitionBusy()) {
      waitForMotionSettle();
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed || !instance || instance.state().destroyed) return;
      if (isTransitionBusy()) {
        waitForMotionSettle();
        return;
      }
      instance.update();
    });
  };

  const onMediaChange = () => {
    if (!disposed && instance && !instance.state().destroyed) {
      instance.options(buildScrollbarOptions(axis, autoHide, ignoreMutations));
    }
  };

  const mediaQuery =
    autoHide === 'auto' && typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MEDIA.pointerCoarse)
      : null;

  const attach = (mod: OverlayScrollbarsModule) => {
    if (disposed || !viewport.isConnected || !slot.isConnected) return;
    const options = buildScrollbarOptions(axis, autoHide, ignoreMutations);
    const existing = mod.OverlayScrollbars(viewport);
    if (existing) {
      existing.options(options);
      instance = existing;
    } else {
      instance = mod.OverlayScrollbars(
        {
          target: viewport,
          elements: { viewport },
          scrollbars: { slot },
        },
        options,
      );
    }
    if (viewport.tagName !== 'TEXTAREA') {
      cancelChildResize = observeDirectChildren(viewport, scheduleUpdate);
    }
    mediaQuery?.addEventListener?.('change', onMediaChange);
  };

  let started = false;
  const start = () => {
    if (started || disposed) return;
    started = true;
    cancelIdle?.();
    cancelIdle = null;
    viewport.removeEventListener('scroll', start);
    viewport.removeEventListener('pointerenter', start);
    if (loadedModule) {
      attach(loadedModule);
      return;
    }
    void loadOverlayScrollbars().then(
      (mod) => attach(mod),
      () => {},
    );
  };

  if (observeInput) {
    viewport.addEventListener('input', scheduleUpdate, { passive: true });
  }

  if (defer) {
    viewport.addEventListener('scroll', start, { passive: true, once: true });
    viewport.addEventListener('pointerenter', start, { passive: true, once: true });
    cancelIdle = runWhenIdle(start, 1200);
  } else {
    start();
  }

  return {
    update: scheduleUpdate,
    destroy: () => {
      disposed = true;
      cancelIdle?.();
      cancelIdle = null;
      motionWaitObserver?.disconnect();
      motionWaitObserver = null;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      viewport.removeEventListener('scroll', start);
      viewport.removeEventListener('pointerenter', start);
      if (observeInput) viewport.removeEventListener('input', scheduleUpdate);
      cancelChildResize?.();
      cancelChildResize = null;
      mediaQuery?.removeEventListener?.('change', onMediaChange);
      if (instance && !instance.state().destroyed) {
        instance.destroy();
      }
      instance = null;
    },
  };
}

/**
 * Attach standard wrapper-mode OverlayScrollbars to an imperative,
 * non-React-reconciled element (such as tables or `<pre>` blocks rendered
 * via `dangerouslySetInnerHTML`).
 */
export function mountWrappedScrollbar(
  host: HTMLElement,
  {
    axis = 'x',
    autoHide = 'auto',
    defer = false,
  }: Pick<OverlayScrollbarOptions, 'axis' | 'autoHide' | 'defer'> = {},
): OverlayScrollbarHandle {
  let disposed = false;
  let instance: OverlayScrollbarsInstance | null = null;
  let cancelIdle: (() => void) | null = null;

  const attach = (mod: OverlayScrollbarsModule) => {
    if (disposed || !host.isConnected) return;
    const existing = mod.OverlayScrollbars(host);
    if (existing) {
      existing.options(buildScrollbarOptions(axis, autoHide));
      instance = existing;
    } else {
      instance = mod.OverlayScrollbars(host, buildScrollbarOptions(axis, autoHide));
    }
  };

  let started = false;
  const start = () => {
    if (started || disposed) return;
    started = true;
    cancelIdle?.();
    cancelIdle = null;
    host.removeEventListener('scroll', start);
    host.removeEventListener('pointerenter', start);
    if (loadedModule) {
      attach(loadedModule);
      return;
    }
    void loadOverlayScrollbars().then(
      (mod) => attach(mod),
      () => {},
    );
  };

  if (defer) {
    host.addEventListener('scroll', start, { passive: true, once: true });
    host.addEventListener('pointerenter', start, { passive: true, once: true });
    cancelIdle = runWhenIdle(start, 1200);
  } else {
    start();
  }

  return {
    update: () => {
      if (!disposed && instance && !instance.state().destroyed) {
        instance.update();
      }
    },
    destroy: () => {
      disposed = true;
      cancelIdle?.();
      cancelIdle = null;
      host.removeEventListener('scroll', start);
      host.removeEventListener('pointerenter', start);
      if (instance && !instance.state().destroyed) {
        instance.destroy();
      }
      instance = null;
    },
  };
}

/**
 * Bind OverlayScrollbars to an existing React viewport + slot ref pair.
 * Ideal when the slot is already an enclosing shell (e.g. `.m3-field`).
 */
export function useOverlayScrollbar(
  viewportRef: RefObject<HTMLElement | null>,
  slotRef: RefObject<HTMLElement | null>,
  {
    axis = 'y',
    autoHide = 'auto',
    defer = false,
    enabled = true,
    observeInput = false,
    refreshKey,
  }: OverlayScrollbarOptions = {},
) {
  useEffect(() => {
    if (!enabled) return;
    const viewport = viewportRef.current;
    const slot = slotRef.current;
    if (!viewport || !slot) return;
    const handle = mountSlottedScrollbar(viewport, slot, {
      axis,
      autoHide,
      defer,
      observeInput,
    });
    return () => handle.destroy();
  }, [viewportRef, slotRef, axis, autoHide, defer, enabled, observeInput]);

  useEffect(() => {
    if (!enabled || refreshKey === undefined) return;
    const viewport = viewportRef.current;
    if (!viewport || !loadedModule) return;
    const instance = loadedModule.OverlayScrollbars(viewport);
    if (instance && !instance.state().destroyed) {
      instance.update();
    }
  }, [viewportRef, enabled, refreshKey]);
}

/**
 * Upgrade horizontal scrollable tables (`.popover-scrollbar`) and `<pre>`
 * code blocks inside a `dangerouslySetInnerHTML` rich-text container.
 */
export function useRichTextScrollbars(
  rootRef: RefObject<HTMLElement | null>,
  contentKey: unknown,
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.popover-scrollbar, pre'));
    if (targets.length === 0) return;
    const handles = targets.map((el) => mountWrappedScrollbar(el, { axis: 'x', defer: true }));
    return () => {
      for (const handle of handles) handle.destroy();
    };
  }, [rootRef, contentKey]);
}
