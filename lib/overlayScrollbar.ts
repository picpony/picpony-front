'use client';

import type {
  OverlayScrollbars as OverlayScrollbarsInstance,
  PartialOptions,
  ScrollbarsAutoHideBehavior,
} from 'overlayscrollbars';
import { useEffect, useRef, type RefObject } from 'react';
import { motionTier, scaledMs } from '@/lib/appearance';
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
  /** Override whether auto-hide stays suspended until first scroll on fine pointers. */
  autoHideSuspend?: boolean;
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
const SYNC_ATTR = 'data-os-sync';

function isGeometryStale(
  viewport: HTMLElement,
  instance: OverlayScrollbarsInstance,
  axis: ScrollbarAxis,
): boolean {
  const clientW = viewport.clientWidth;
  const clientH = viewport.clientHeight;
  if (clientW === 0 && clientH === 0) return false;

  const { overflowEdge, overflowAmount, hasOverflow } = instance.state();
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const dprTolerance = dpr % 1 !== 0 ? 1 : 0;

  if (axis !== 'y') {
    const scrollW = viewport.scrollWidth;
    const expectedEdgeX = clientW + Math.max(0, clientW - scrollW);
    const rawX = Math.max(0, scrollW - clientW);
    const expectedX = rawX > dprTolerance ? rawX : 0;
    if (
      Math.abs(overflowEdge.x - expectedEdgeX) >= 1 ||
      Math.abs(overflowAmount.x - expectedX) >= 1 ||
      expectedX > 0 !== hasOverflow.x
    ) {
      return true;
    }
  }

  if (axis !== 'x') {
    const scrollH = viewport.scrollHeight;
    const expectedEdgeY = clientH + Math.max(0, clientH - scrollH);
    const rawY = Math.max(0, scrollH - clientH);
    const expectedY = rawY > dprTolerance ? rawY : 0;
    if (
      Math.abs(overflowEdge.y - expectedEdgeY) >= 1 ||
      Math.abs(overflowAmount.y - expectedY) >= 1 ||
      expectedY > 0 !== hasOverflow.y
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Reconcile OverlayScrollbars' cached `overflowEdge`, `overflowAmount` and
 * `--os-viewport-percent` thumb proportion against the live viewport geometry.
 *
 * When `ignoreMutation` suppresses OverlayScrollbars' subtree `MutationObserver`
 * (or when content resizes without a pending mutation record, such as `<textarea>`
 * input or async image layout), a bare `instance.update()` sees no observer hint
 * and skips overflow re-measurement entirely. Toggling an unstyled attribute in
 * `update.attributes` and immediately calling `instance.update()` drains the
 * record synchronously via `takeRecords()` and runs OverlayScrollbars' native
 * content-mutation overflow path without `update(true)`'s side effects (resetting
 * `autoHideSuspend`, cancelling active auto-hide timers, or recreating observers).
 */
export function syncScrollbarGeometry(
  viewport: HTMLElement,
  instance: OverlayScrollbarsInstance,
  axis: ScrollbarAxis,
): boolean {
  const { destroyed, sleeping } = instance.state();
  if (!viewport.isConnected || destroyed || sleeping) return false;
  if (!isGeometryStale(viewport, instance, axis)) return false;

  viewport.setAttribute(SYNC_ATTR, viewport.getAttribute(SYNC_ATTR) === '1' ? '0' : '1');
  instance.update();

  if (!isGeometryStale(viewport, instance, axis)) return true;

  // Fallback when OverlayScrollbars' internal content-size cache already matches
  // the current scroll dimensions (for example, after a viewport-only resize such
  // as a sidebar dock toggle): force a refresh while preserving auto-hide classes.
  const { scrollbarHorizontal, scrollbarVertical } = instance.elements();
  const bars = [scrollbarHorizontal.scrollbar, scrollbarVertical.scrollbar];
  const saved = bars.map((el) => ({
    el,
    autoHide: el.classList.contains('os-scrollbar-auto-hide'),
    hidden: el.classList.contains('os-scrollbar-auto-hide-hidden'),
  }));
  instance.update(true);
  for (const { el, autoHide, hidden } of saved) {
    el.classList.toggle('os-scrollbar-auto-hide', autoHide);
    el.classList.toggle('os-scrollbar-auto-hide-hidden', hidden);
  }
  return true;
}

function attachTrackSync(instance: OverlayScrollbarsInstance, onSync: () => void): () => void {
  const { scrollbarHorizontal, scrollbarVertical } = instance.elements();
  const bars = [scrollbarHorizontal.scrollbar, scrollbarVertical.scrollbar];
  for (const bar of bars) {
    bar.addEventListener('pointerenter', onSync, { passive: true });
    bar.addEventListener('pointerdown', onSync, { capture: true, passive: true });
  }
  return () => {
    for (const bar of bars) {
      bar.removeEventListener('pointerenter', onSync);
      bar.removeEventListener('pointerdown', onSync, { capture: true });
    }
  };
}

/**
 * Live click-scroll timing resolved on each track click so motion-tier and
 * speed changes in `/settings` take effect immediately without rebuilding
 * mounted scrollbar instances.
 */
const resolveClickScroll = () =>
  motionTier('scroll') === 'off'
    ? {
        clickScrollDistance: 0,
        clickScrollDuration: 0,
        clickPressDelay: 0,
        pressDistanceDuration: 0,
      }
    : {
        clickScrollDuration: Math.round(scaledMs(200, 'scroll')),
        clickPressDelay: 150,
        pressDistanceDuration: Math.round(scaledMs(90, 'scroll')),
      };

/**
 * Resolve OverlayScrollbars options from axis, pointer type and motion tier.
 *
 * Fine-pointer devices show overflowing bars on entry (and on initial paint
 * when `autoHideSuspend` is enabled) and fade them after leaving; coarse touch
 * devices keep bars hidden until a scroll starts, matching mobile overlay bars.
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
  autoHideSuspend?: boolean,
): PartialOptions {
  const coarse = isCoarsePointer();
  const resolvedAutoHide: ScrollbarsAutoHideBehavior =
    autoHide === 'auto' ? (coarse ? 'scroll' : 'leave') : autoHide;
  const suspend = coarse ? false : (autoHideSuspend ?? autoHide === 'auto');

  return {
    paddingAbsolute: false,
    showNativeOverlaidScrollbars: false,
    update: {
      attributes: [SYNC_ATTR],
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
      autoHideDelay: coarse ? 900 : 650,
      autoHideSuspend: suspend,
      dragScroll: true,
      clickScroll: resolveClickScroll,
      pointers: ['mouse', 'touch', 'pen'],
    },
  };
}

const SKIP_OBSERVE_SELECTOR =
  '[data-image-hero-gallery-anchor],[data-image-hero-route-anchor],[data-image-hero-stage-anchor]';

/**
 * Descendant scroll containers whose offsets must survive OverlayScrollbars' initial
 * `appendChildren(viewport, children)` re-insertion (re-appending children resets nested
 * `scrollLeft`/`scrollTop` to 0 without firing a `scroll` event).
 */
const DESCENDANT_SCROLLER_SELECTOR =
  '[role="tablist"], .main-scrollbar, .popover-scrollbar, .scrollbar-hide, .overflow-x-auto, .overflow-y-auto, [data-app-scroll-container]';

function observeDirectChildren(viewport: HTMLElement, onResize: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const resize = new ResizeObserver(onResize);
  const syncChildren = () => {
    resize.disconnect();
    for (const child of Array.from(viewport.children)) {
      if (child instanceof HTMLElement && !child.matches(SKIP_OBSERVE_SELECTOR)) {
        resize.observe(child, { box: 'border-box' });
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
    autoHideSuspend,
    defer = false,
    observeInput = false,
  }: Pick<
    OverlayScrollbarOptions,
    'axis' | 'autoHide' | 'autoHideSuspend' | 'defer' | 'observeInput'
  > = {},
): OverlayScrollbarHandle {
  let disposed = false;
  let instance: OverlayScrollbarsInstance | null = null;
  let cancelIdle: (() => void) | null = null;
  let cancelChildResize: (() => void) | null = null;
  let detachTrackListeners: (() => void) | null = null;
  let motionWaitObserver: MutationObserver | null = null;
  let frame = 0;

  const ignoreMutations = axis === 'y' && viewport.tagName !== 'P' && !viewport.isContentEditable;

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

  const syncNow = () => {
    if (disposed || !instance || instance.state().destroyed) return;
    if (isTransitionBusy()) {
      waitForMotionSettle();
      return;
    }
    syncScrollbarGeometry(viewport, instance, axis);
  };

  const scheduleUpdate = () => {
    if (disposed || !instance || frame) return;
    if (isTransitionBusy()) {
      waitForMotionSettle();
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncNow();
    });
  };

  const onMediaChange = () => {
    if (!disposed && instance && !instance.state().destroyed) {
      instance.options(buildScrollbarOptions(axis, autoHide, ignoreMutations, autoHideSuspend));
    }
  };

  const mediaQuery =
    autoHide === 'auto' && typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MEDIA.pointerCoarse)
      : null;

  const attach = (mod: OverlayScrollbarsModule) => {
    if (disposed || !viewport.isConnected || !slot.isConnected) return;
    const options = buildScrollbarOptions(axis, autoHide, ignoreMutations, autoHideSuspend);
    const existing = mod.OverlayScrollbars(viewport);
    if (existing) {
      existing.options(options);
      instance = existing;
      scheduleUpdate();
    } else {
      const savedDescendantScrolls: Array<[HTMLElement, number, number]> = [];
      for (const el of viewport.querySelectorAll<HTMLElement>(DESCENDANT_SCROLLER_SELECTOR)) {
        if (el.scrollLeft || el.scrollTop) {
          savedDescendantScrolls.push([el, el.scrollLeft, el.scrollTop]);
        }
      }
      instance = mod.OverlayScrollbars(
        {
          target: viewport,
          elements: { viewport },
          scrollbars: { slot },
        },
        options,
      );
      for (const [el, left, top] of savedDescendantScrolls) {
        if (!el.isConnected) continue;
        if (el.scrollLeft !== left) el.scrollLeft = left;
        if (el.scrollTop !== top) el.scrollTop = top;
      }
    }
    detachTrackListeners?.();
    detachTrackListeners = attachTrackSync(instance, syncNow);
    if (viewport.tagName !== 'TEXTAREA') {
      cancelChildResize?.();
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
    viewport.removeEventListener('pointermove', start);
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
    viewport.addEventListener('pointermove', start, { passive: true, once: true });
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
      viewport.removeEventListener('pointermove', start);
      if (observeInput) viewport.removeEventListener('input', scheduleUpdate);
      detachTrackListeners?.();
      detachTrackListeners = null;
      cancelChildResize?.();
      cancelChildResize = null;
      mediaQuery?.removeEventListener?.('change', onMediaChange);
      viewport.removeAttribute(SYNC_ATTR);
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
    autoHideSuspend,
    defer = false,
  }: Pick<OverlayScrollbarOptions, 'axis' | 'autoHide' | 'autoHideSuspend' | 'defer'> = {},
): OverlayScrollbarHandle {
  let disposed = false;
  let instance: OverlayScrollbarsInstance | null = null;
  let cancelIdle: (() => void) | null = null;
  let detachTrackListeners: (() => void) | null = null;

  const syncNow = () => {
    if (disposed || !instance || instance.state().destroyed) return;
    syncScrollbarGeometry(instance.elements().viewport, instance, axis);
  };

  const attach = (mod: OverlayScrollbarsModule) => {
    if (disposed || !host.isConnected) return;
    const options = buildScrollbarOptions(axis, autoHide, false, autoHideSuspend);
    const existing = mod.OverlayScrollbars(host);
    if (existing) {
      existing.options(options);
      instance = existing;
      syncNow();
    } else {
      instance = mod.OverlayScrollbars(host, options);
    }
    detachTrackListeners?.();
    detachTrackListeners = attachTrackSync(instance, syncNow);
  };

  let started = false;
  const start = () => {
    if (started || disposed) return;
    started = true;
    cancelIdle?.();
    cancelIdle = null;
    host.removeEventListener('scroll', start);
    host.removeEventListener('pointerenter', start);
    host.removeEventListener('pointermove', start);
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
    host.addEventListener('pointermove', start, { passive: true, once: true });
    cancelIdle = runWhenIdle(start, 1200);
  } else {
    start();
  }

  return {
    update: syncNow,
    destroy: () => {
      disposed = true;
      cancelIdle?.();
      cancelIdle = null;
      host.removeEventListener('scroll', start);
      host.removeEventListener('pointerenter', start);
      host.removeEventListener('pointermove', start);
      detachTrackListeners?.();
      detachTrackListeners = null;
      if (instance && !instance.state().destroyed) {
        instance.elements().viewport.removeAttribute(SYNC_ATTR);
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
    autoHideSuspend,
    defer = false,
    enabled = true,
    observeInput = false,
    refreshKey,
  }: OverlayScrollbarOptions = {},
) {
  const handleRef = useRef<OverlayScrollbarHandle | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const viewport = viewportRef.current;
    const slot = slotRef.current;
    if (!viewport || !slot) return;
    const handle = mountSlottedScrollbar(viewport, slot, {
      axis,
      autoHide,
      autoHideSuspend,
      defer,
      observeInput,
    });
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      handle.destroy();
    };
  }, [viewportRef, slotRef, axis, autoHide, autoHideSuspend, defer, enabled, observeInput]);

  useEffect(() => {
    if (!enabled || refreshKey === undefined) return;
    handleRef.current?.update();
  }, [enabled, refreshKey]);
}

/**
 * Upgrade horizontal scrollable tables (`.popover-scrollbar`) and `<pre>`
 * code blocks inside a `dangerouslySetInnerHTML` rich-text container.
 */
export function useRichTextScrollbars(rootRef: RefObject<HTMLElement | null>, contentKey: unknown) {
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
