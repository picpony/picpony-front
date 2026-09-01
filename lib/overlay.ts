'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
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
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Moves focus into the panel on open, cycles Tab inside it, and hands focus back
 * to whatever opened it on close.
 *
 * The panel itself takes focus, not its first control: focusing a button lands a
 * visible ring on it the instant the surface opens. The panel is labelled by its
 * own heading, so a screen reader still announces it. `[data-autofocus]` overrides
 * this for a surface built around one field.
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
