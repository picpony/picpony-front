'use client';

import { useEffect, useCallback, useRef, useState, useId, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { MdClose } from 'react-icons/md';
import { cn } from '@/lib/utils';
import { getAppScroller } from '@/lib/motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
  zIndex?: number;
  hideCloseButton?: boolean;
  footer?: React.ReactNode;
  closeOnOverlayClick?: boolean;
  /** Opt out of Esc-to-close for flows that must be completed or explicitly cancelled. */
  closeOnEscape?: boolean;
  /** Removes the default padding so a child can bleed to the edges (e.g. a cropper). */
  bodyClassName?: string;
}

const CLOSE_ANIM_DURATION = 200;

/**
 * Scroll lock is refcounted. Each modal used to set `body.overflow` on open and
 * blindly reset it to `unset` on unmount, so closing an inner dialog unlocked
 * the page while an outer one was still open.
 *
 * It also has to target the *app scroller*, not `<body>`. The shell already
 * sets `overflow: hidden` on the body and scrolls a `<main>` inside it, so
 * locking the body was a no-op — the gallery went on scrolling behind every
 * open dialog. `.main-scrollbar` reserves a stable gutter, so switching the
 * scroller to `hidden` does not reflow the content underneath.
 *
 * `getAppScroller()` names one fixed element, which is wrong whenever the
 * dialog was opened from somewhere that scrolls independently — an image-detail
 * overlay brings its own scroller and covers the gallery entirely, so a
 * confirm dialog opened inside it froze the hidden page and left the visible
 * one scrolling. The element that actually scrolls under the trigger is found
 * by walking up from it instead.
 */
let scrollLocks = 0;
let lockedEl: HTMLElement | null = null;

/** Nearest scrollable ancestor of `from`, falling back to the app scroller. */
function findScroller(from: Element | null): HTMLElement {
  for (let el = from; el instanceof HTMLElement; el = el.parentElement) {
    const overflowY = getComputedStyle(el).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return getAppScroller() ?? document.body;
}

function lockScroll(from: Element | null) {
  if (scrollLocks === 0) {
    lockedEl = findScroller(from);
    lockedEl.style.overflow = 'hidden';
  }
  scrollLocks += 1;
}
function releaseScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0 && lockedEl) {
    lockedEl.style.overflow = '';
    lockedEl = null;
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-md',
  zIndex = 100,
  hideCloseButton = false,
  footer,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  bodyClassName = '',
}: ModalProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [rendering, setRendering] = useState(isOpen);
  const everOpened = useRef(isOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (isOpen) {
      everOpened.current = true;
      queueMicrotask(() => setRendering(true));
    } else if (everOpened.current) {
      const timer = setTimeout(() => setRendering(false), CLOSE_ANIM_DURATION);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    // The element that opened the dialog is still focused at this point, which
    // is what tells us which scroller the user was actually looking at.
    lockScroll(document.activeElement);
    return releaseScroll;
  }, [isOpen]);

  // Move focus in on open and hand it back to whatever opened the dialog.
  // Without this the keyboard caret stayed on the page behind the overlay.
  useEffect(() => {
    if (!isOpen) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      // The panel itself, not its first control. Focusing the close button
      // would land a visible focus ring on it the instant the dialog opens,
      // and it reads oddly as"the dismiss button is what you want". The panel
      // is labelled by its heading, so a screen reader still announces the
      // dialog; Tab from here goes to the first real control.
      const autoFocus = panel.querySelector<HTMLElement>('[data-autofocus]');
      (autoFocus ?? panel).focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      returnFocusTo.current?.focus?.({ preventScroll: true });
    };
  }, [isOpen]);

  // Esc to dismiss, and Tab cycling kept inside the panel.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose();
        return;
      }
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
  }, [isOpen, closeOnEscape, onClose]);

  const handleClose = useCallback(() => onClose(), [onClose]);

  if (!mounted || !rendering) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center p-4 sm:p-6',
        'bg-scrim/50',
        isOpen ? 'animate-modal-overlay' : 'animate-modal-overlay-out',
      )}
      style={{ zIndex, pointerEvents: isOpen ? 'auto' : 'none' }}
      onClick={closeOnOverlayClick ? handleClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden outline-none',
          'bg-surface-container-lowest text-on-surface rounded-2xl shadow-e3',
          maxWidth,
          isOpen ? 'animate-modal-content' : 'animate-modal-content-out',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || !hideCloseButton) && (
          <div className="flex shrink-0 items-center justify-between gap-4 p-6 pb-0">
            {title && (
              <h2 id={titleId} className="text-headline-s text-on-surface">
                {title}
              </h2>
            )}
            {!hideCloseButton && (
              <button
                onClick={handleClose}
                aria-label="关闭"
                className="text-on-surface-variant hover:text-on-surface -mr-2 ml-auto inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full outline-none transition-ui hover:rotate-90 focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:hover:rotate-0"
              >
                <MdClose size={22} />
              </button>
            )}
          </div>
        )}
        <div className={cn('main-scrollbar min-h-0 flex-1 overflow-y-auto p-6', bodyClassName)}>
          {children}
        </div>
        {footer && <div className="flex shrink-0 justify-end gap-3 px-6 pb-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
