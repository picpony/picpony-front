'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { getAppScroller } from '@/lib/appScroller';
import { MOTION_SPEED_SCALE } from '@/lib/appearance';

/* ---------------------------------------------------------------------------
 * Overlay behaviour — focus trap, scroll lock, exit hold, Esc — lives here, once,
 * composed by every surface that covers the page; never re-implement it at a call
 * site. Layout, shape and motion deliberately stay out.
 * ------------------------------------------------------------------------ */

/** True only after hydration, for portals that must not render on the server. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Keeps a surface in the tree for `durationMs` after `isOpen` goes false, so its
 * exit animation has something to play on; false until the first open, so a closed
 * overlay costs nothing on first paint.
 *
 * The hold is `durationMs * MOTION_SPEED_SCALE.slow` — the maximum tier, not the live
 * speed. A wall-clock timer that bounds an animation must take the maximum (the slow
 * tier): one written against the unscaled figure fires inside the motion it was meant
 * to outlast.
 */
export function useExitAnimation(isOpen: boolean, durationMs: number): boolean {
  const [rendering, setRendering] = useState(isOpen);
  const everOpened = useRef(isOpen);
  const hold = Math.round(durationMs * MOTION_SPEED_SCALE.slow);

  useEffect(() => {
    if (isOpen) {
      everOpened.current = true;
      queueMicrotask(() => setRendering(true));
    } else if (everOpened.current) {
      const timer = setTimeout(() => setRendering(false), hold);
      return () => clearTimeout(timer);
    }
  }, [isOpen, hold]);

  return rendering;
}

/**
 * Scroll lock, refcounted — closing an inner overlay must not unlock the page while an
 * outer one is still up.
 *
 * Locks the app scroller, not the body: the shell hides the body and scrolls a main element
 * inside it, and that element reserves a stable gutter, so hiding it does not reflow the
 * content underneath. And a fixed "the app scroller" answer is wrong whenever the overlay
 * was opened inside something that scrolls independently, so the element that actually
 * scrolls under the trigger is found by walking up from the still-focused trigger.
 */
let scrollLocks = 0;
let lockedEl: HTMLElement | null = null;

function findScroller(from: Element | null): HTMLElement {
  for (let el = from; el instanceof HTMLElement; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return getAppScroller() ?? document.body;
}

export function useScrollLock(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    // The still-focused trigger tells us which scroller the user was actually looking at.
    const from = document.activeElement;
    if (scrollLocks === 0) {
      lockedEl = findScroller(from);
      lockedEl.style.overflow = 'hidden';
    }
    scrollLocks += 1;
    return () => {
      scrollLocks = Math.max(0, scrollLocks - 1);
      if (scrollLocks === 0 && lockedEl) {
        lockedEl.style.overflow = '';
        lockedEl = null;
      }
    };
  }, [isOpen]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex], [contenteditable]:not([contenteditable="false"])';

type ElementRef = RefObject<HTMLElement | null>;

interface OverlayOptions {
  onClose: () => void;
  /** A disabled Escape still belongs to this layer; it must not dismiss its parent. */
  closeOnEscape?: boolean;
  /** Menus own Escape but leave roving focus and Tab to their control. */
  modal?: boolean;
  /** Portalled siblings that belong to the same surface, e.g. the detail back button. */
  additionalRefs?: readonly ElementRef[];
  /** A route overlay can outlive the element that originally opened it. */
  returnFocus?: () => HTMLElement | null;
}

interface OverlayLayer {
  panelRef: ElementRef;
  options: RefObject<OverlayOptions>;
  parent: OverlayLayer | null;
  depth: number;
}

/** React ancestry survives portals. Effect order does not: when two nested
 *  dialogs open together, the child's effect runs before its parent's. */
export const OverlayLayerContext = createContext<OverlayLayer | null>(null);

// One listener and one ordered stack. Callback updates never re-order layers.
const layers: OverlayLayer[] = [];

function descendsFrom(layer: OverlayLayer, ancestor: OverlayLayer): boolean {
  for (let parent = layer.parent; parent; parent = parent.parent) {
    if (parent === ancestor) return true;
  }
  return false;
}

function rootsOf(layer: OverlayLayer): HTMLElement[] {
  return [layer.panelRef, ...(layer.options.current.additionalRefs ?? [])]
    .map((ref) => ref.current)
    .filter((el): el is HTMLElement => Boolean(el?.isConnected));
}

function available(el: HTMLElement): boolean {
  return !el.closest('[inert], [hidden], [aria-hidden="true"]') &&
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function activeLayers(): OverlayLayer[] {
  // A third-party lightbox marks the underlying tree inert while it owns focus.
  // Such a layer must not intercept its keys or pull focus out of the viewer.
  return layers.filter((layer) => rootsOf(layer).some(available));
}

function focusScope(): { layer: OverlayLayer; roots: HTMLElement[] } | null {
  const active = activeLayers();
  const index = active.findLastIndex((layer) => layer.options.current.modal !== false);
  return index < 0 ? null : { layer: active[index], roots: active.slice(index).flatMap(rootsOf) };
}

function focusPanel(layer: OverlayLayer): void {
  const panel = layer.panelRef.current;
  if (!panel || !available(panel)) return;
  const autoFocus = panel.querySelector<HTMLElement>('[data-autofocus]');
  (autoFocus && available(autoFocus) ? autoFocus : panel).focus({ preventScroll: true });
}

function focusableItems(roots: HTMLElement[]): HTMLElement[] {
  return Array.from(new Set(roots.flatMap((root) => [
    ...(root.matches(FOCUSABLE) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
  ]))).filter((el) => {
    if (el.matches(':disabled') || !available(el)) return false;
    // Native editing hosts are tabbable without a tabindex attribute (their
    // DOM tabIndex property is nevertheless -1). Explicit -1 still opts out.
    return el.tabIndex >= 0 || (!el.hasAttribute('tabindex') && el.isContentEditable &&
      !el.parentElement?.isContentEditable);
  });
}

/** A portalled menu is last in document order. Tab leaves it relative to its
 *  trigger, not relative to that portal's DOM position. */
export function moveFocusFrom(
  anchor: HTMLElement | null,
  backwards: boolean,
  exclude?: HTMLElement | null,
): void {
  if (!anchor) return;
  const scope = focusScope();
  const items = focusableItems(scope?.roots ?? [document.body])
    .filter((el) => !exclude?.contains(el));
  const index = items.indexOf(anchor);
  if (index < 0 || !items.length) return;
  const next = (index + (backwards ? -1 : 1) + items.length) % items.length;
  items[next].focus({ preventScroll: true });
}

function onOverlayKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  if (event.key === 'Escape') {
    const top = activeLayers().at(-1);
    if (!top) return;
    event.preventDefault();
    event.stopPropagation();
    if (top.options.current.closeOnEscape !== false) top.options.current.onClose();
    return;
  }
  if (event.key !== 'Tab') return;
  const scope = focusScope();
  if (!scope) return;
  const items = focusableItems(scope.roots);
  const index = items.indexOf(document.activeElement as HTMLElement);
  // The initial focus is normally the panel (tabIndex=-1). Both Tab directions
  // must enter the cycle from there; Shift+Tab must never escape to the page.
  if (items.length === 0 || index < 0 || (!event.shiftKey && index === items.length - 1) ||
    (event.shiftKey && index === 0)) {
    event.preventDefault();
    const target = event.shiftKey ? items.at(-1) : items[0];
    if (target) target.focus({ preventScroll: true });
    else focusPanel(scope.layer);
  }
}

function onOverlayFocus(event: FocusEvent): void {
  const scope = focusScope();
  if (!scope || scope.roots.some((root) => root.contains(event.target as Node))) return;
  focusPanel(scope.layer);
}

/**
 * Registers one committed layer for Escape and, for modal surfaces, focus entry,
 * containment and restoration. Call with `open && mounted && rendering` for portals.
 * Focus waits for a hero's initially hidden destination to become visible.
 */
export function useOverlayLayer(
  isOpen: boolean,
  panelRef: ElementRef,
  options: OverlayOptions,
): OverlayLayer {
  const latest = useRef(options);
  const parent = useContext(OverlayLayerContext);
  const layer = useMemo(() => ({ panelRef, options: latest, parent, depth: (parent?.depth ?? -1) + 1 }),
    [panelRef, parent]);
  useLayoutEffect(() => { latest.current = options; });
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const childIndex = layers.findIndex((candidate) => descendsFrom(candidate, layer));
    if (childIndex < 0) layers.push(layer);
    else layers.splice(childIndex, 0, layer);
    if (layers.length === 1) {
      // Bubble lets the focused control consume its own keys first. In
      // particular, WangEditor handles Tab as indentation with preventDefault.
      document.addEventListener('keydown', onOverlayKeyDown);
      document.addEventListener('focusin', onOverlayFocus, true);
    }
    let frame = 0;
    const enter = () => {
      if (latest.current.modal === false) return;
      const panel = panelRef.current;
      if (!panel || !available(panel)) {
        frame = requestAnimationFrame(enter);
        return;
      }
      if (focusScope()?.layer === layer &&
        !rootsOf(layer).some((root) => root.contains(document.activeElement))) focusPanel(layer);
    };
    frame = requestAnimationFrame(enter);
    return () => {
      cancelAnimationFrame(frame);
      const index = layers.indexOf(layer);
      // React has already made the departing panel inert by cleanup time, so
      // its former place in the modal stack cannot be read from activeLayers.
      const wasTopModal = layers.findLast((candidate) => candidate.options.current.modal !== false) === layer;
      if (index >= 0) layers.splice(index, 1);
      if (layers.length === 0) {
        document.removeEventListener('keydown', onOverlayKeyDown);
        document.removeEventListener('focusin', onOverlayFocus, true);
      }
      if (latest.current.modal === false) return;
      // Wait for the closing commit to remove background inert. Never steal
      // focus from a newer dialog opened in the same commit.
      requestAnimationFrame(() => {
        const scope = focusScope();
        const preferred = latest.current.returnFocus?.();
        const target = preferred ?? previous;
        if (target && target !== document.body && available(target) &&
          (!scope || scope.roots.some((root) => root.contains(target)))) {
          target.focus({ preventScroll: true });
        } else if (wasTopModal && scope) {
          focusPanel(scope.layer);
        }
      });
    };
  }, [isOpen, layer, panelRef]);
  return layer;
}
