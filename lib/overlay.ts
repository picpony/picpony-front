'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { getAppScroller } from '@/lib/motion';

/* ---------------------------------------------------------------------------
 * Overlay behaviour, shared by every surface that covers the page.
 *
 * All of this lived inside `Modal.tsx`, which meant the second such surface —
 * a bottom sheet — either duplicated eighty lines of focus and scroll handling
 * or shipped without them. Neither is acceptable: a sheet that does not lock the
 * scroller lets the gallery move behind it, and one that does not trap focus
 * drops the keyboard caret onto the page underneath. Both are the *same*
 * requirements, so they are stated once here and composed by both.
 *
 * Nothing about layout, shape or motion lives here. That is deliberate — a
 * dialog and a sheet differ in exactly those three things and in nothing else.
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
 * exit animation has something to play on. Returns false until the first open,
 * so a closed overlay costs nothing on first paint.
 */
export function useExitAnimation(isOpen: boolean, durationMs: number): boolean {
  const [rendering, setRendering] = useState(isOpen);
  const everOpened = useRef(isOpen);

  useEffect(() => {
    if (isOpen) {
      everOpened.current = true;
      queueMicrotask(() => setRendering(true));
    } else if (everOpened.current) {
      const timer = setTimeout(() => setRendering(false), durationMs);
      return () => clearTimeout(timer);
    }
  }, [isOpen, durationMs]);

  return rendering;
}

/**
 * Scroll lock, refcounted.
 *
 * Each overlay used to set `overflow` on open and blindly reset it on unmount,
 * so closing an inner dialog unlocked the page while an outer one was still up.
 *
 * It also has to target the *app scroller*, not `<body>`. The shell already sets
 * `overflow: hidden` on the body and scrolls a `<main>` inside it, so locking the
 * body was a no-op and the gallery went on scrolling behind every open dialog.
 * `.main-scrollbar` reserves a stable gutter, so switching that element to
 * `hidden` does not reflow the content underneath.
 *
 * And `getAppScroller()` alone names one fixed element, which is wrong whenever
 * the overlay was opened from something that scrolls independently — an
 * image-detail overlay brings its own scroller and covers the gallery entirely,
 * so a confirm dialog opened inside it froze the hidden page and left the visible
 * one moving. The element that actually scrolls under the trigger is found by
 * walking up from it instead.
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
    // The element that opened the overlay is still focused at this point, which
    // is what tells us which scroller the user was actually looking at.
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
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Moves focus into the panel on open, cycles Tab inside it, and hands focus back
 * to whatever opened it on close.
 *
 * The panel itself takes focus, not its first control: focusing the close button
 * lands a visible ring on it the instant the surface opens, which reads as "the
 * dismiss button is what you want". The panel is labelled by its own heading, so
 * a screen reader still announces it; Tab from there reaches the first real
 * control. `[data-autofocus]` overrides this for a surface built around one field.
 */
export function useFocusTrap(isOpen: boolean, panelRef: RefObject<HTMLElement | null>): void {
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const autoFocus = panel.querySelector<HTMLElement>('[data-autofocus]');
      (autoFocus ?? panel).focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      returnFocusTo.current?.focus?.({ preventScroll: true });
    };
  }, [isOpen, panelRef]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, panelRef]);
}

/**
 * Esc dismisses. Capture phase and `stopPropagation`, so the innermost open
 * overlay consumes the key and an outer one does not close with it.
 */
export function useEscapeToClose(isOpen: boolean, onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!isOpen || !enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isOpen, onClose, enabled]);
}
