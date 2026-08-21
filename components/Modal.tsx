'use client';

import { useCallback, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { MdClose } from 'react-icons/md';
import IconButton from './IconButton';
import { cn } from '@/lib/utils';
import {
  useEscapeToClose,
  useExitAnimation,
  useFocusTrap,
  useMounted,
  useScrollLock,
} from '@/lib/overlay';
import { ICON } from '@/lib/icons';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /**
   * The panel's width cap, as a closed set rather than any Tailwind class.
   *
   * M3 caps a basic dialog at 560dp (`max-w-xl` here is 576, the nearest step), and
   * a free-form `string` let a call site pass anything — including the `max-w-4xl`
   * that `AuthModal` needs and that is a *documented divergence*, not a default. A
   * union keeps the divergence visible: `4xl` appears in exactly one file, and a new
   * one cannot be introduced without touching this type.
   *
   * `fit` is the captcha's, whose content is a fixed-size widget.
   */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | 'fit';
  /** Overrides the shared dialog layer. Only for a dialog opened *from* another
   *  dialog, which has to sit above its parent. */
  hideCloseButton?: boolean;
  footer?: React.ReactNode;
  closeOnOverlayClick?: boolean;
  /** Opt out of Esc-to-close for flows that must be completed or explicitly cancelled. */
  closeOnEscape?: boolean;
  /** Removes the default padding so a child can bleed to the edges (e.g. a cropper). */
  bodyClassName?: string;
  /** Extra classes on the panel itself, for shared transform states (e.g. an
   *  inner dialog opening shrinks this one). Lands last so it can override. */
  panelClassName?: string;
}

const CLOSE_ANIM_DURATION = 200;

/**
 * The centred dialog.
 *
 * Focus trapping, the refcounted scroll lock, Esc handling and the exit-animation
 * hold now live in `lib/overlay.ts`, because `Sheet` needs all four and had no
 * way to reach them from here. What is left in this file is what makes a dialog a
 * dialog rather than a sheet: it is centred, it is `rounded-2xl` on all four
 * corners, and it grows from 93% scale rather than rising from the bottom edge.
 */
/* Spelled per key rather than interpolated, because Tailwind scans source text and
   a template literal would compile to nothing. */
const MAX_WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  fit: 'max-w-fit',
} as const;

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'md',
  hideCloseButton = false,
  footer,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  bodyClassName = '',
  panelClassName = '',
}: ModalProps) {
  const mounted = useMounted();
  const rendering = useExitAnimation(isOpen, CLOSE_ANIM_DURATION);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useScrollLock(isOpen);
  useFocusTrap(isOpen, panelRef);
  useEscapeToClose(isOpen, onClose, closeOnEscape);

  const handleClose = useCallback(() => onClose(), [onClose]);

  if (!mounted || !rendering) return null;

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center p-4 sm:p-6',
        'bg-scrim-veil',
        /* The shared dialog layer, unless the caller names one — see the
           stacking-order block in globals.css. */
        'z-dialog',
        isOpen ? 'animate-modal-overlay' : 'animate-modal-overlay-out',
      )}
      onClick={closeOnOverlayClick ? handleClose : undefined}
      /* `inert` while leaving, not `pointer-events: none`.
       *
       * The dialog is held in the tree for `CLOSE_ANIM_DURATION` so its exit has
       * something to play on, and for those 200ms it was still a focusable
       * subtree in the accessibility tree — the focus trap has already released
       * by then, so Tab could walk into a dialog that was visibly scaling away.
       * `pointer-events` only stops the pointer; `inert` (React 19) removes the
       * subtree from the tab order and the accessibility tree together, which is
       * the rule AGENTS.md states for an overlay that outlives its own `open`. */
      inert={!isOpen}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden outline-none',
          /* `surface-container-high`, which is M3's dialog container. It was
             `-lowest` — the flattest step on the scale — so the one surface in
             the app that is meant to read as lifted off everything else was
             painted lighter than the page behind it and relied entirely on its
             shadow to separate. Tone first, shadow second, is the whole M3
             depth recipe; this had it backwards. */
          'bg-surface-container-high text-on-surface rounded-2xl shadow-e3',
          MAX_WIDTHS[maxWidth],
          isOpen ? 'animate-modal-content' : 'animate-modal-content-out',
          panelClassName,
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
              <IconButton
                onClick={handleClose}
                aria-label="关闭"
                dismiss
                className="-mr-2 ml-auto hover:text-on-surface"
                icon={<MdClose size={ICON.standard} />}
              />
            )}
          </div>
        )}
        {/* `bodyClassName` 完整接管 padding：cn 只拼接不解决 Tailwind
            冲突，所以默认 p-6 不能留在 base 里，否则会盖掉传入的 p-0。 */}
        <div className={cn('main-scrollbar min-h-0 flex-1 overflow-y-auto', bodyClassName || 'p-6')}>
          {children}
        </div>
        {footer && <div className="flex shrink-0 justify-end gap-3 px-6 pb-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
