'use client';

import { useCallback, useRef, useId, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MdClose } from 'react-icons/md';
import IconButton from './IconButton';
import { cn } from '@/lib/utils';
import {
  useExitAnimation,
  useOverlayLayer,
  useMounted,
  useScrollLock,
  OverlayLayerContext,
} from '@/lib/overlay';
import { ICON } from '@/lib/icons';
import { DURATION, EASE } from '@/lib/motionTokens';
import { motionTier, scaledMs } from '@/lib/appearance';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** A surface with its own visible heading still needs a dialog name. */
  'aria-label'?: string;
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

const CLOSE_ANIM_DURATION = DURATION.short * 1000;

/**
 * The centred dialog.
 *
 * Focus trapping, the refcounted scroll lock, Esc handling and the exit-animation
 * hold live in `lib/overlay.ts` (shared with `Sheet`). What is left here is what
 * makes a dialog a dialog rather than a sheet: centred, `rounded-2xl` on all four
 * corners, with a short rise and a restrained scale change.
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
  'aria-label': ariaLabel,
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const placedPanel = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useScrollLock(isOpen);
  const layer = useOverlayLayer(isOpen && mounted && rendering, panelRef, { onClose, closeOnEscape });

  const handleClose = useCallback(() => onClose(), [onClose]);

  /* A dialog can reverse while it is arriving or leaving. Independent CSS
     keyframes restarted from their full endpoint; commit the current pose before
     retargeting so closing a half-open surface never makes it grow first.

     The wrapper owns the one fade, and the panel owns only its transform. Fading
     both multiplies their opacity and gives the content a different clock from
     its scrim. WAAPI also leaves AuthModal's independent CSS scale free to settle
     when a nested dialog opens. */
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const panel = panelRef.current;
    if (!mounted || !rendering) {
      placedPanel.current = null;
      return;
    }
    if (!overlay || !panel) return;

    const firstPlacement = placedPanel.current !== panel;
    placedPanel.current = panel;
    const tier = motionTier();
    const reduced = tier === 'reduced';
    const entryTransform = reduced
      ? 'translateY(8px) scale(0.98)'
      : 'translateY(16px) scale(0.95)';
    const exitTransform = 'translateY(8px) scale(0.98)';
    const fromOpacity = firstPlacement && isOpen ? '0' : getComputedStyle(overlay).opacity;
    const fromTransform = firstPlacement && isOpen
      ? entryTransform
      : getComputedStyle(panel).transform;
    const opacity = isOpen ? '1' : '0';
    const transform = isOpen ? 'none' : exitTransform;

    overlay.style.opacity = opacity;
    panel.style.transform = transform;
    if (tier === 'off') return;

    const timing = {
      duration: scaledMs((isOpen ? DURATION.long : DURATION.short) * 1000),
      easing: isOpen ? EASE.decelerate : EASE.accelerate,
      fill: 'both' as const,
    };
    const running = [
      overlay.animate([{ opacity: fromOpacity }, { opacity }], timing),
      panel.animate([{ transform: fromTransform }, { transform }], timing),
    ];
    for (const animation of running) {
      animation.finished.then(() => animation.cancel(), () => {});
    }

    return () => {
      for (const animation of running) {
        if (animation.playState !== 'idle') {
          try {
            animation.commitStyles();
          } catch {
            // A detached portal has no rendered style to preserve.
          }
        }
        animation.cancel();
      }
    };
  }, [isOpen, mounted, rendering]);

  if (!mounted || !rendering) return null;

  return createPortal(
    <OverlayLayerContext.Provider value={layer}>
    <div
      ref={overlayRef}
      // Portals can mount child-first, so DOM insertion order cannot decide
      // which of two nested dialogs paints above the other.
      style={layer.depth ? { zIndex: `calc(var(--z-dialog) + ${layer.depth})` } : undefined}
      className={cn(
        'fixed inset-0 flex items-center justify-center p-4 sm:p-6',
        'bg-scrim-veil',
        /* The shared dialog layer, unless the caller names one — see the
           stacking-order block in globals.css. */
        'z-dialog',
      )}
      onClick={closeOnOverlayClick ? handleClose : undefined}
      /* `inert` while leaving, not `pointer-events: none`. The dialog is held in
       * the tree so its exit has something to play on, and for those 200ms it
       * was still a focusable subtree — the focus trap has already released, so
       * Tab could walk into a dialog that was visibly scaling away. `inert`
       * (React 19) removes the subtree from the tab order and the accessibility
       * tree together. */
      inert={!isOpen}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : (ariaLabel ?? '对话框')}
        tabIndex={-1}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden outline-none',
          /* `surface-container-high` is M3's dialog container — tone first,
             shadow second is the whole M3 depth recipe. */
          'bg-surface-container-high text-on-surface rounded-2xl shadow-e3',
          MAX_WIDTHS[maxWidth],
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
            冲突，所以默认 p-6 不能留在 base 里，否则会盖掉传入的 p-0。
            `data-app-scroll-container` marks this as the nearest real scroller —
            a `Pagination` in a dialog was turning a page and scrolling the *page
            behind the dialog* to the top. */}
        <div
          data-app-scroll-container
          className={cn('main-scrollbar min-h-0 flex-1 overflow-y-auto', bodyClassName || 'p-6')}
        >
          {children}
        </div>
        {/* The action row, and the only place a dialog's actions belong (AGENTS.md
            says why). `flex-wrap justify-end gap-3`; a leading member takes
            `mr-auto` — an auto margin in a justify-end row absorbs the free
            space to its right, no nested wrapper needed. `flex-wrap` is a guard:
            a fourth action or a longer label wraps to a second line instead of
            being clipped, and changes nothing for a row that fits. */}
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-3 px-6 pb-6">{footer}</div>
        )}
      </div>
    </div>
    </OverlayLayerContext.Provider>,
    document.body,
  );
}
