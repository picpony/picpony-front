'use client';
/* `'use no memo'` for the same reason `Sheet` carries it: this component passes a hand-tuned
   `useGSAP` dependency list and deliberately omits `revertOnUpdate`. */'use no memo';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MdClose } from 'react-icons/md';
import { gsap, spring, surfaceEnter, useGSAP } from '@/lib/motion';
import { motionTier } from '@/lib/appearance';
import { SPRING_MS } from '@/lib/spring';
import { cn } from '@/lib/utils';
import IconButton from './IconButton';
import {
  useExitAnimation,
  useOverlayLayer,
  useMounted,
  useScrollLock,
  OverlayLayerContext,
} from '@/lib/overlay';
import { ICON } from '@/lib/icons';

interface SidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** The panel's name when it shows no `title`. */
  'aria-label'?: string;
  children: ReactNode;
  closeOnOverlayClick?: boolean;
  /** Esc — and the system Back, which follows the same rule. */
  closeOnEscape?: boolean;
  /** Whether the system/browser Back closes the panel (`lib/historyLayers.ts`). On by default. */
  closeOnBack?: boolean;
  bodyClassName?: string;
  className?: string;
  /** Drops the ✕ — for a panel whose body already carries its dismiss. */
  hideCloseButton?: boolean;
  /** Fires once the panel has left — `Modal`'s and `Sheet`'s twin. */
  onExited?: () => void;
}

/** Must match the exit tween below — the panel stays mounted this long. */
const EXIT_MS = SPRING_MS.defaultEffects;

/**
 * M3 modal side sheet, docked to the right edge at full height.
 *
 * The bottom `Sheet`'s sibling on the other axis, sharing its three defining moves:
 *
 * - **Shape.** `rounded-l-2xl` (28dp) on the two corners facing the page, none on the
 *   two flush with the screen edge.
 * - **Motion.** `default-effects` both directions and on the scrim — a panel travelling
 *   on a position is component motion, and *effects* rather than spatial because one
 *   that overshoots on the way out bounces back into view. The travel is the whole
 *   statement of which edge it belongs to, so even the reduced tier keeps it, exactly
 *   as the bottom sheet keeps its rise. GSAP owns the transform for the whole lifetime,
 *   as the sheet's does.
 * - **Container.** `surface-container-low` at elevation 1 — the side sheet sits on the
 *   same row of the spec's scale as the modal bottom sheet, a quieter surface than the
 *   dialog's `high` at 3.
 *
 * No drag to dismiss: the panel is the desktop surface (its phone twin is the bottom
 * sheet), and Esc, the scrim and the ✕ are already there — a pointer drag would fight
 * text selection in a chat transcript.
 *
 * Focus, Escape, Back and the refcounted scroll lock come from `lib/overlay.ts`,
 * shared with `Modal` and `Sheet`.
 */
export default function SidePanel({
  isOpen,
  onClose,
  title,
  'aria-label': ariaLabel,
  children,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  closeOnBack = true,
  bodyClassName = '',
  className = '',
  hideCloseButton = false,
  onExited,
}: SidePanelProps) {
  const mounted = useMounted();
  const rendering = useExitAnimation(isOpen, EXIT_MS);
  const exited = useRef(onExited);
  useLayoutEffect(() => {
    exited.current = onExited;
  });
  const wasRendering = useRef(rendering);
  useEffect(() => {
    if (wasRendering.current && !rendering) exited.current?.();
    wasRendering.current = rendering;
  }, [rendering]);
  const panelRef = useRef<HTMLDivElement>(null);
  const placedPanel = useRef<HTMLDivElement | null>(null);
  const enterFrame = useRef(0);
  const scrimRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useScrollLock(isOpen);
  const layer = useOverlayLayer(isOpen && mounted && rendering, panelRef, {
    onClose,
    closeOnEscape,
    history: closeOnBack,
  });

  const handleClose = useCallback(() => onClose(), [onClose]);

  /* Enter and exit on `default-effects` both ways, seeded only on a newly mounted
     surface — the same shape as `Sheet`'s tweens, on the x axis instead of the y.
     `overwrite: true` rather than `revertOnUpdate`: reverting would restore the
     panel to its unanimated position — off-screen right — in the same frame the
     exit tries to start from rest. Started from the next frame when opening, for
     the same stall `Sheet` documents. */
  useGSAP(
    (_context, contextSafe) => {
      cancelAnimationFrame(enterFrame.current);
      enterFrame.current = 0;
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!rendering) {
        placedPanel.current = null;
        return;
      }
      if (!panel) return;

      if (placedPanel.current !== panel) {
        placedPanel.current = panel;
        gsap.set(panel, { x: '100%' });
        if (scrim) gsap.set(scrim, { opacity: 0 });
      }

      if (motionTier('overlay') === 'off') {
        gsap.killTweensOf(panel);
        if (scrim) gsap.killTweensOf(scrim);
        gsap.set(panel, { x: isOpen ? 0 : '100%' });
        if (scrim) gsap.set(scrim, { opacity: isOpen ? 1 : 0 });
        return;
      }

      const start = contextSafe!(() => {
        enterFrame.current = 0;
        /* Arriving on the dialog's clock (400ms emphasized decelerate), leaving on DefaultEffects. */
        const timing = isOpen ? surfaceEnter('overlay') : spring('defaultEffects', 'overlay');
        gsap.to(panel, { x: isOpen ? 0 : '100%', ...timing, overwrite: true });
        if (scrim)
          gsap.to(scrim, { opacity: isOpen ? 1 : 0, ...timing, overwrite: true });
      });
      if (isOpen) enterFrame.current = requestAnimationFrame(start);
      else start();
    },
    { dependencies: [isOpen, rendering] },
  );
  useEffect(() => () => cancelAnimationFrame(enterFrame.current), []);

  if (!mounted || !rendering) return null;

  const hasHeader = Boolean(title) || !hideCloseButton;

  return createPortal(
    <OverlayLayerContext.Provider value={layer}>
    <div
      style={layer.depth ? { zIndex: `calc(var(--z-dialog) + ${layer.depth})` } : undefined}
      /* A side sheet is a dialog docked to the right edge, so it shares the dialog
         layer — see the stacking-order block in globals.css. */
      className={cn('fixed inset-0 flex z-dialog')}
      /* `inert` while leaving — the panel outlives its own `isOpen` so the exit
         tween has a target, as on `Modal` and `Sheet`. */
      inert={!isOpen}
    >
      <div
        ref={scrimRef}
        className="bg-scrim-veil absolute inset-0"
        onClick={closeOnOverlayClick ? handleClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : (ariaLabel ?? '对话框')}
        tabIndex={-1}
        className={cn(
          'relative ml-auto flex h-dvh w-full max-w-md flex-col overflow-hidden focus-visible:outline-hidden',
          'bg-surface-container-low text-on-surface rounded-l-2xl shadow-e1',
          className,
        )}
      >
        {hasHeader && (
          <div className="flex shrink-0 items-center justify-between gap-4 pr-2 pl-6 pt-3 pb-1">
            {title ? (
              <h2 id={titleId} className="text-title-l min-w-0 wrap-anywhere text-on-surface">
                {title}
              </h2>
            ) : (
              <span />
            )}
            {!hideCloseButton && (
              <IconButton
                onClick={handleClose}
                aria-label="关闭"
                dismiss
                className="hover:text-on-surface"
                icon={<MdClose size={ICON.standard} />}
              />
            )}
          </div>
        )}
        <div
          ref={bodyRef}
          /* `data-app-scroll-container`, like `Modal`'s and `Sheet`'s bodies: this is
             the box that scrolls, so anything inside that wants to scroll to an
             element has to find this rather than the page behind the panel. */
          data-app-scroll-container
          className={cn(
            'popover-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-y-contain',
            bodyClassName || 'px-6 pb-4',
          )}
        >
          {children}
        </div>
        {/* Docked to the screen edge, so the panel owns the home-indicator inset,
            as the bottom sheet's dock does. */}
        <div className="h-[max(1rem,env(safe-area-inset-bottom))] shrink-0" />
      </div>
    </div>
    </OverlayLayerContext.Provider>,
    document.body,
  );
}
