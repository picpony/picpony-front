'use client';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DURATION,
  Observer,
  gsap,
  prefersReducedMotion,
  useGSAP,
} from '@/lib/motion';
import { cn } from '@/lib/utils';
import {
  useEscapeToClose,
  useExitAnimation,
  useFocusTrap,
  useMounted,
  useScrollLock,
} from '@/lib/overlay';

interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  zIndex?: number;
  /** Cap the panel's height. A sheet taller than this is a dialog. */
  maxHeight?: string;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  bodyClassName?: string;
  className?: string;
  /** Hide the drag handle for a sheet that is not draggable (rare). */
  hideHandle?: boolean;
}

/** Fraction of the panel's height you must cross for a slow drag to dismiss. */
const COMMIT_RATIO = 0.35;
/** px/s past which a flick dismisses regardless of distance travelled. */
const FLICK_VELOCITY = 500;
/** Must match the exit tween below — the panel stays mounted this long. */
const EXIT_MS = DURATION.short * 1000;

/**
 * M3 modal bottom sheet.
 *
 * `AGENTS.md` has listed this in the primitives table since the design system
 * was written, and the file did not exist — so every mobile surface that wanted
 * one reached for `Modal` instead. A centred dialog is the wrong shape on a
 * phone: it floats in the middle with a scrim above *and* below it, its content
 * is bounded by `max-w-md` rather than by the screen, and it is nowhere near the
 * thumb. A sheet is docked, full-width, and dismissed by pushing it back down.
 *
 * Three things make it a sheet rather than a dialog wearing different classes:
 *
 * - **Shape.** `rounded-t-2xl` — 28dp on the two corners that are visible, none
 *   on the two that are flush with the screen edge. Same step as `Modal`, since
 *   both are the shape scale's "dialog, sheet, large media container" role.
 * - **Motion.** It rises from its own bottom edge on `decelerate` (400ms, the
 *   enters-the-screen pairing) and leaves on `accelerate` (200ms). GSAP owns the
 *   transform for the whole lifetime rather than CSS keyframes, because the drag
 *   below writes the same property — two owners meant a released drag snapped
 *   back to zero before the exit keyframe could take it down.
 * - **The drag.** The panel tracks the finger, so you can change your mind
 *   halfway. It commits past 35% of its height or on a flick at any distance,
 *   which is the same rule and the same shape of code as `useDrawerSwipe`.
 *
 * The drag deliberately yields to an inner scroller: a downward drag only starts
 * a dismiss when the body is already at `scrollTop === 0`, so a long list inside
 * the sheet scrolls normally and only pulls the sheet once it has nothing left to
 * scroll. Without that check every attempt to scroll a sheet closed it.
 *
 * Focus, Esc and the refcounted scroll lock come from `lib/overlay.ts`, shared
 * with `Modal` — a sheet that let the gallery scroll behind it would be the
 * exact bug that module was extracted to prevent.
 */
export default function Sheet({
  isOpen,
  onClose,
  title,
  children,
  zIndex,
  maxHeight = 'max-h-[85dvh]',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  bodyClassName = '',
  className = '',
  hideHandle = false,
}: SheetProps) {
  const mounted = useMounted();
  const rendering = useExitAnimation(isOpen, EXIT_MS);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useScrollLock(isOpen);
  useFocusTrap(isOpen, panelRef);
  useEscapeToClose(isOpen, onClose, closeOnEscape);

  const handleClose = useCallback(() => onClose(), [onClose]);
  /* Read through a ref inside the Observer, for the reason `useDrawerSwipe`
     documents at length: a dependency that flips on every toggle leaves a second
     Observer alive holding a stale closure, because `useGSAP` defers cleanup to
     unmount unless `revertOnUpdate` is set.
     Written in an effect rather than in the render body — a render may be
     discarded, and a ref mutated during one that never commits is a write the
     committed tree does not know about. */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /* Enter and exit. `overwrite: true` rather than `revertOnUpdate`: reverting
     would restore the panel to its unanimated position — which for the enter
     tween is off-screen — in the same frame the exit is trying to start from
     rest. */
  useGSAP(
    () => {
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!panel || !rendering) return;

      if (prefersReducedMotion()) {
        gsap.set(panel, { y: isOpen ? 0 : '100%' });
        if (scrim) gsap.set(scrim, { opacity: isOpen ? 1 : 0 });
        return;
      }

      if (isOpen) {
        gsap.fromTo(
          panel,
          { y: '100%' },
          { y: 0, duration: DURATION.long, ease: 'decelerate', overwrite: true },
        );
        if (scrim)
          gsap.fromTo(
            scrim,
            { opacity: 0 },
            { opacity: 1, duration: DURATION.medium, ease: 'decelerate', overwrite: true },
          );
      } else {
        gsap.to(panel, {
          y: '100%',
          duration: DURATION.short,
          ease: 'accelerate',
          overwrite: true,
        });
        if (scrim)
          gsap.to(scrim, {
            opacity: 0,
            duration: DURATION.short,
            ease: 'accelerate',
            overwrite: true,
          });
      }
    },
    { dependencies: [isOpen, rendering] },
  );

  /* Drag to dismiss. Separate hook from the tweens above because this one has a
     real teardown — an Observer on the panel — and therefore genuinely needs
     `revertOnUpdate` to avoid stacking one per toggle. */
  useGSAP(
    (_context, contextSafe) => {
      const panel = panelRef.current;
      if (!panel || !rendering || prefersReducedMotion()) return;

      let height = 0;
      let active = false;
      let pending = false;

      const place = contextSafe!((y: number) => {
        gsap.set(panel, { y });
        const scrim = scrimRef.current;
        // The scrim thins as the sheet goes, so the page behind it comes back
        // progressively rather than all at once on release.
        if (scrim) gsap.set(scrim, { opacity: height > 0 ? 1 - y / height : 1 });
      });

      const settle = contextSafe!((dismiss: boolean) => {
        active = false;
        pending = false;
        const from = (gsap.getProperty(panel, 'y') as number) || 0;
        const target = dismiss ? height : 0;
        const duration = gsap.utils.clamp(0.12, DURATION.long, Math.abs(target - from) / 1400);

        const scrim = scrimRef.current;
        if (scrim)
          gsap.to(scrim, {
            opacity: dismiss ? 0 : 1,
            duration,
            ease: dismiss ? 'accelerate' : 'decelerate',
            overwrite: true,
          });

        gsap.to(panel, {
          y: target,
          duration,
          ease: dismiss ? 'accelerate' : 'decelerate',
          overwrite: true,
          onComplete: () => {
            /* Only tell React once the panel has actually left. Calling it at
               release would flip `isOpen`, and the exit tween above would then
               start a second, competing animation from wherever the finger was. */
            if (dismiss) onCloseRef.current();
          },
        });
      });

      const observer = Observer.create({
        target: panel,
        // Touch only, like the drawer. A pointer-drag on desktop would fight
        // text selection inside the sheet, and those users have Esc and the scrim.
        type: 'touch',
        dragMinimum: 8,
        lockAxis: true,
        tolerance: 4,
        ignore: '[data-no-sheet-drag]',
        onDragStart: () => {
          /* A sheet whose body is scrolled is being read, not dragged. Only once
             it has nothing left to scroll does a downward pull belong to the
             sheet. Anything outside the scroller — the handle, the header — can
             always start a drag. */
          const body = bodyRef.current;
          pending = !body || body.scrollTop <= 0;
        },
        onDrag: (self) => {
          if (pending) {
            // A horizontal drag is not a dismiss; let it go.
            if (self.axis === 'y') {
              height = panel.offsetHeight;
              if (height <= 0) return;
              active = true;
              pending = false;
            } else if (self.axis === 'x') {
              pending = false;
              return;
            } else {
              return;
            }
          }
          if (!active) return;
          // Downward only. Clamped at 0 so an upward drag does not lift the
          // sheet off its dock and expose the page beneath it.
          place(gsap.utils.clamp(0, height, (self.y ?? 0) - (self.startY ?? 0)));
        },
        onDragEnd: (self) => {
          pending = false;
          if (!active) return;
          const y = (gsap.getProperty(panel, 'y') as number) || 0;
          const flick = self.velocityY > FLICK_VELOCITY;
          settle(flick || y / height > COMMIT_RATIO);
        },
      });

      return () => observer.kill();
    },
    { dependencies: [rendering], revertOnUpdate: true },
  );

  if (!mounted || !rendering) return null;

  return createPortal(
    <div
      /* A sheet is a dialog that docks to the bottom edge, so it shares the
         dialog layer — see the stacking-order block in globals.css. */
      className={cn('fixed inset-0 flex flex-col justify-end', zIndex === undefined && 'z-dialog')}
      style={{ zIndex, pointerEvents: isOpen ? 'auto' : 'none' }}
    >
      <div
        ref={scrimRef}
        className="bg-scrim/50 absolute inset-0"
        onClick={closeOnOverlayClick ? handleClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex w-full flex-col overflow-hidden outline-none',
          'bg-surface-container-low text-on-surface rounded-t-2xl shadow-e3',
          // A sheet on a tablet or a desktop window should not run the whole
          // width of a 1600px screen; it stays a phone-width dock, centred.
          'mx-auto sm:max-w-lg',
          maxHeight,
          className,
        )}
      >
        {!hideHandle && (
          // M3's drag handle: a 32x4dp bar in a 22dp-tall touch strip. Purely an
          // affordance — the whole panel is draggable, not just this.
          <div className="flex h-6 shrink-0 items-center justify-center" aria-hidden="true">
            <span className="bg-on-surface-variant/40 h-1 w-8 rounded-full" />
          </div>
        )}
        {title && (
          <h2 id={titleId} className="text-title-l text-on-surface shrink-0 px-6 pt-1 pb-3">
            {title}
          </h2>
        )}
        <div
          ref={bodyRef}
          className={cn('popover-scrollbar min-h-0 flex-1 overflow-y-auto', bodyClassName || 'px-6')}
        >
          {children}
        </div>
        {/* The dock sits against the screen edge, so it owns the home-indicator
            inset. `max()` rather than a flat value: on a device with no inset
            the sheet would otherwise carry 34px of dead space. */}
        <div className="h-[max(1rem,env(safe-area-inset-bottom))] shrink-0" />
      </div>
    </div>,
    document.body,
  );
}
