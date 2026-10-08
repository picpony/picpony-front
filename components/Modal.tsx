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
  /** The headline, and the dialog's name. A node so a dialog that switches views can fade its
      headline with its body (`TagInfoModal`); it is read as text, so keep it phrasing content. */
  title?: React.ReactNode;
  /** A surface with its own visible heading still needs a dialog name. */
  'aria-label'?: string;
  /** Names the dialog by a heading the child renders itself (instead of `title`). */
  'aria-labelledby'?: string;
  /** The element holding the dialog's message — what a confirm dialog is asking. */
  'aria-describedby'?: string;
  /** `alertdialog` for a dialog that interrupts to ask for a decision (a confirm). */
  role?: 'dialog' | 'alertdialog';
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
  /** Drops the ✕ — for a dialog whose footer already carries its dismiss (取消). */
  hideCloseButton?: boolean;
  footer?: React.ReactNode;
  /** A press that starts and ends on the scrim closes the dialog. */
  closeOnOverlayClick?: boolean;
  /** Opt out of Esc-to-close for flows that must be completed or explicitly cancelled.
   *  The system Back follows the same rule. */
  closeOnEscape?: boolean;
  /**
   * Whether the system/browser Back closes this dialog (it holds a same-URL history
   * entry while open — `lib/historyLayers.ts`). On by default; turn it off only for a
   * dialog Back must walk straight past.
   */
  closeOnBack?: boolean;
  /** Removes the default padding so a child can bleed to the edges (e.g. a cropper). */
  bodyClassName?: string;
  /** Extra classes on the panel itself, for shared transform states (e.g. an
   *  inner dialog opening shrinks this one). Lands last so it can override. */
  panelClassName?: string;
  /** Fires once the close animation has finished — for work that must not run on top
   *  of a leaving dialog (a theme wipe snapshotting the screen). */
  onExited?: () => void;
}

const CLOSE_ANIM_DURATION = DURATION.short * 1000;

/**
 * Hide the scrims of dialogs that are still leaving and return the strongest opacity among
 * them, for the arriving dialog's own scrim to start from. Each leaving wrapper is lifted one
 * step above the arriving one, so its panel finishes its exit over the scrim that took over
 * rather than dimmed under it.
 */
function takeOverLeavingScrims(own: HTMLElement, depth: number): number {
  let strongest = 0;
  for (const other of document.querySelectorAll<HTMLElement>('[data-modal-overlay]')) {
    if (other === own || !other.inert) continue;
    const scrim = other.querySelector<HTMLElement>(':scope > [data-modal-scrim]');
    if (!scrim) continue;
    const value = parseFloat(getComputedStyle(scrim).opacity) || 0;
    if (value <= 0.01) continue;
    strongest = Math.max(strongest, value);
    for (const animation of scrim.getAnimations()) animation.cancel();
    scrim.style.opacity = '0';
    other.style.zIndex = `calc(var(--z-dialog) + ${depth + 1})`;
  }
  return strongest;
}

/**
 * The centred dialog.
 *
 * Focus trapping, the refcounted scroll lock, Esc, Back and the exit-animation hold live
 * in `lib/overlay.ts` (shared with `Sheet`). What is left here is what makes a dialog a
 * dialog rather than a sheet: centred, `rounded-2xl` on all four corners, with a short
 * rise and a restrained scale change.
 *
 * Spacing is M3's: 24dp around the edge, 16dp from the headline to the content (8 below
 * the header and 8 above the content, so neither a labelled field's floating label — 6px
 * above its box — nor a focus ring on the first control is clipped by the scroller), 24dp
 * from the content to the actions (8 + 16, likewise).
 *
 * **One scrim at a time.** The scrim is the panel's sibling, each with its own opacity on
 * one clock (nested, their opacities multiplied). A dialog that opens while another is
 * still leaving — 确认 answered, and the run it started opening its progress dialog — takes
 * the leaving dialog's scrim over at its current opacity instead of adding a second veil
 * over it (two scrims crossing read as a flash of darker page), and the leaving panel
 * finishes above it.
 * The ✕ does not decide the header's height — it is centred on the headline and its box
 * overhangs the row — so a dialog with and without one spaces its content identically.
 *
 * A body that scrolls shows M3's scrolling-dialog dividers: one under the header once the
 * content has moved, one over the actions while there is more below. They are 1dp
 * pseudo-elements in the divider role laid over the padding (no layout of their own),
 * switched by attribute, so scrolling renders nothing.
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
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  role = 'dialog',
  children,
  maxWidth = 'md',
  hideCloseButton = false,
  footer,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  closeOnBack = true,
  bodyClassName = '',
  panelClassName = '',
  onExited,
}: ModalProps) {
  const mounted = useMounted();
  const rendering = useExitAnimation(isOpen, CLOSE_ANIM_DURATION);
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const placedPanel = useRef<HTMLDivElement | null>(null);
  /** Where the current press began: only a press that starts on the scrim may close. */
  const pressOnScrim = useRef(false);
  const exited = useRef(onExited);
  /** A close whose end has not been reported yet — reported once, by whichever ends it first. */
  const exitPending = useRef(false);
  const titleId = useId();

  useScrollLock(isOpen);
  const layer = useOverlayLayer(isOpen && mounted && rendering, panelRef, {
    onClose,
    closeOnEscape,
    history: closeOnBack,
  });

  const handleClose = useCallback(() => onClose(), [onClose]);

  useLayoutEffect(() => {
    exited.current = onExited;
  });

  const reportExit = useCallback(() => {
    if (!exitPending.current) return;
    exitPending.current = false;
    exited.current?.();
  }, []);

  /* A dialog can reverse while it is arriving or leaving. Independent CSS
     keyframes restarted from their full endpoint; commit the current pose before
     retargeting so closing a half-open surface never makes it grow first.

     The scrim and the panel are siblings, each fading on the same clock, and the
     panel alone takes the transform. Nested, their opacities multiplied and the
     content ran on a different clock from its scrim. WAAPI also leaves AuthModal's
     independent CSS scale free to settle when a nested dialog opens. */
  const depth = layer.depth;
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const scrim = scrimRef.current;
    const panel = panelRef.current;
    if (!mounted || !rendering) {
      placedPanel.current = null;
      /* The hold that unmounts the portal is a wall-clock bound set at the slowest speed,
         and at that speed it can land a frame before the animation reports: the exit is
         over either way. */
      reportExit();
      return;
    }
    if (!overlay || !scrim || !panel) return;
    exitPending.current = !isOpen;

    const firstPlacement = placedPanel.current !== panel;
    placedPanel.current = panel;
    const tier = motionTier();
    const reduced = tier === 'reduced';
    const entryTransform = reduced
      ? 'translateY(8px) scale(0.98)'
      : 'translateY(16px) scale(0.95)';
    const exitTransform = 'translateY(8px) scale(0.98)';
    const arriving = firstPlacement && isOpen;
    const handedOver = arriving ? takeOverLeavingScrims(overlay, depth) : 0;
    const fromScrim = arriving ? String(handedOver) : getComputedStyle(scrim).opacity;
    const fromOpacity = arriving ? '0' : getComputedStyle(panel).opacity;
    const fromTransform = arriving ? entryTransform : getComputedStyle(panel).transform;
    const opacity = isOpen ? '1' : '0';
    const transform = isOpen ? 'none' : exitTransform;

    scrim.style.opacity = opacity;
    panel.style.opacity = opacity;
    panel.style.transform = transform;
    if (tier === 'off') {
      if (!isOpen) reportExit();
      return;
    }

    const timing = {
      duration: scaledMs((isOpen ? DURATION.long : DURATION.short) * 1000),
      easing: isOpen ? EASE.decelerate : EASE.accelerate,
      fill: 'both' as const,
    };
    const running = [
      scrim.animate([{ opacity: fromScrim }, { opacity }], timing),
      panel.animate([{ opacity: fromOpacity, transform: fromTransform }, { opacity, transform }], timing),
    ];
    for (const animation of running) {
      animation.finished.then(() => animation.cancel(), () => {});
    }
    if (!isOpen) {
      // A reopen cancels these, which rejects `finished`: only a real exit reports.
      Promise.all(running.map((animation) => animation.finished)).then(reportExit, () => {});
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
  }, [isOpen, mounted, rendering, reportExit, depth]);

  /* The scrolling-dialog dividers. Written as attributes from the scroll and size
     observers, so a scroll never re-renders the dialog. */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!mounted || !rendering || !body) return;
    const update = () => {
      const scrollable = body.scrollHeight - body.clientHeight > 1;
      headerRef.current?.toggleAttribute('data-divided', scrollable && body.scrollTop > 0);
      footerRef.current?.toggleAttribute(
        'data-divided',
        scrollable && body.scrollTop + body.clientHeight < body.scrollHeight - 1,
      );
    };
    const sizes = new ResizeObserver(update);
    const observeChildren = () => {
      sizes.disconnect();
      sizes.observe(body);
      for (const child of Array.from(body.children)) sizes.observe(child);
    };
    const children = new MutationObserver(() => {
      observeChildren();
      update();
    });
    observeChildren();
    children.observe(body, { childList: true });
    body.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      sizes.disconnect();
      children.disconnect();
      body.removeEventListener('scroll', update);
    };
  }, [mounted, rendering]);

  if (!mounted || !rendering) return null;

  const hasHeader = Boolean(title) || !hideCloseButton;
  const hasFooter = Boolean(footer);

  return createPortal(
    <OverlayLayerContext.Provider value={layer}>
    <div
      ref={overlayRef}
      data-modal-overlay=""
      // Portals can mount child-first, so DOM insertion order cannot decide
      // which of two nested dialogs paints above the other.
      style={layer.depth ? { zIndex: `calc(var(--z-dialog) + ${layer.depth})` } : undefined}
      className={cn(
        'fixed inset-0 flex items-center justify-center p-4 sm:p-6',
        /* The shared dialog layer, unless the caller names one — see the
           stacking-order block in globals.css. */
        'z-dialog',
      )}
      /* A click is dispatched to the common ancestor of its press and its release, so a
         text selection that starts in a field and is released over the scrim arrives
         here as a scrim click. Only a press that *began* on the scrim may close. */
      onPointerDown={(event) => {
        pressOnScrim.current = event.target === event.currentTarget || event.target === scrimRef.current;
      }}
      onClick={(event) => {
        const started = pressOnScrim.current;
        pressOnScrim.current = false;
        const onScrim = event.target === event.currentTarget || event.target === scrimRef.current;
        if (closeOnOverlayClick && started && onScrim) handleClose();
      }}
      /* `inert` while leaving, not `pointer-events: none`. The dialog is held in
       * the tree so its exit has something to play on, and for those 200ms it
       * was still a focusable subtree — the focus trap has already released, so
       * Tab could walk into a dialog that was visibly scaling away. `inert`
       * (React 19) removes the subtree from the tab order and the accessibility
       * tree together. */
      inert={!isOpen}
    >
      <div ref={scrimRef} data-modal-scrim="" aria-hidden="true" className="bg-scrim-veil absolute inset-0" />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
        aria-label={labelledBy || title ? undefined : (ariaLabel ?? '对话框')}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden focus-visible:outline-hidden sm:max-h-[calc(100dvh-3rem)]',
          /* `surface-container-high` is M3's dialog container — tone first,
             shadow second is the whole M3 depth recipe. */
          'bg-surface-container-high text-on-surface rounded-2xl shadow-e3',
          MAX_WIDTHS[maxWidth],
          panelClassName,
        )}
      >
        {hasHeader && (
          <div
            ref={headerRef}
            className="relative flex shrink-0 items-center justify-between gap-4 px-6 pt-6 pb-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:transition-[background-color] after:spring-fast-effects data-divided:after:bg-outline-variant"
          >
            {title && (
              <h2 id={titleId} className="text-headline-s min-w-0 wrap-anywhere text-on-surface">
                {title}
              </h2>
            )}
            {!hideCloseButton && (
              <IconButton
                onClick={handleClose}
                aria-label="关闭"
                dismiss
                /* Centred on the headline's 32dp line, overhanging the row by 4dp
                   each way, so the ✕ never sets the header's height. */
                className="-my-1 -mr-2 ml-auto hover:text-on-surface"
                icon={<MdClose size={ICON.standard} />}
              />
            )}
          </div>
        )}
        {/* `bodyClassName` 完整接管 padding：cn 只拼接不解决 Tailwind
            冲突，所以默认内边距不能留在 base 里，否则会盖掉调用方传入的零内边距。
            Under a header the 16dp between the headline and the content is split
            8 + 8 rather than 12 + 4: a labelled field's floating label sits 6px above
            the field's box, and with 4px of body above it the scroller cut the top of
            every glyph off the first field of an editor dialog.
            `data-app-scroll-container` marks this as the nearest real scroller —
            a `Pagination` in a dialog was turning a page and scrolling the *page
            behind the dialog* to the top. The scrollbar is the overlay style: an
            overlay reserves no gutter, or every dialog's text sits off-centre. */}
        <div
          ref={bodyRef}
          data-app-scroll-container
          className={cn(
            'popover-scrollbar min-h-0 flex-1 overflow-y-auto',
            bodyClassName ||
              cn('px-6', hasHeader ? 'pt-2' : 'pt-6', hasFooter ? 'pb-2' : 'pb-6'),
          )}
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
          <div
            ref={footerRef}
            className="relative flex shrink-0 flex-wrap justify-end gap-3 px-6 pt-4 pb-6 after:pointer-events-none after:absolute after:inset-x-0 after:top-0 after:h-px after:transition-[background-color] after:spring-fast-effects data-divided:after:bg-outline-variant"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
    </OverlayLayerContext.Provider>,
    document.body,
  );
}
