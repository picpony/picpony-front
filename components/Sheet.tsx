'use client';
/* `'use no memo'` for the same reason `lib/motion.ts` carries it: this component passes a
   hand-tuned `useGSAP` dependency list and deliberately omits `revertOnUpdate`, so it sits on the
   one path where a change in memoised identity changes when the GSAP context is torn down. Lift
   it with the tab and hero probes as guardrails. */'use no memo';

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Observer, gsap, spring, useGSAP } from '@/lib/motion';
import { motionTier } from '@/lib/appearance';
import { SPRING_MS } from '@/lib/spring';
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
const EXIT_MS = SPRING_MS.defaultEffects;

/**
 * M3 modal bottom sheet.
 *
 * Three things make it a sheet rather than a dialog wearing different classes:
 *
 * - **Shape.** `rounded-t-2xl` (28dp) on the two visible corners, none on the two
 *   flush with the screen edge — the shape scale's dialog/sheet step.
 * - **Motion.** `default-effects` (the spring `ModalBottomSheet.kt` assigns) in both
 *   directions and on the scrim too — a sheet moving on a position is component
 *   motion, and *effects* rather than spatial because a panel that overshoots on
 *   the way out bounces back into view. GSAP owns the transform for the whole
 *   lifetime rather than CSS keyframes, because the drag below writes the same
 *   property — two owners meant a released drag snapped back to zero before the
 *   exit keyframe could take it down.
 * - **The drag.** The panel tracks the finger; commits past 35% of its height or
 *   on a flick at any distance.
 *
 * The drag yields to an inner scroller: a downward drag only starts a dismiss when
 * the body is at the top, so a long list scrolls normally and only pulls the sheet
 * once it has nothing left to scroll.
 *
 * Focus, Escape and the refcounted scroll lock come from `lib/overlay.ts`, shared
 * with `Modal`.
 */
export default function Sheet({
  isOpen,
  onClose,
  title,
  children,
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
     documents: a dependency that flips on every toggle leaves a second Observer
     alive holding a stale closure, because `useGSAP` defers cleanup to unmount
     unless `revertOnUpdate` is set. Written in an effect rather than in the
     render body — a render may be discarded, and a ref mutated during one that
     never commits is a write the committed tree does not know about. */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  /* Enter and exit, on `default-effects` both ways — the spring
   * `ModalBottomSheet.kt` assigns.
   *
   * `overwrite: true` rather than `revertOnUpdate`: reverting would restore the
   * panel to its unanimated position — which for the enter tween is off-screen —
   * in the same frame the exit is trying to start from rest. */
  useGSAP(
    () => {
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!panel || !rendering) return;

      if (motionTier() === 'off') {
        gsap.set(panel, { y: isOpen ? 0 : '100%' });
        if (scrim) gsap.set(scrim, { opacity: isOpen ? 1 : 0 });
        return;
      }

      /* The reduced tier rises like the standard one. `defaultEffects` is
         critically damped (no overshoot to remove), and a panel that appears in
         the middle of the screen without arriving from anywhere reads as a
         dialog — the travel *is* what says which edge it belongs to. */
      if (isOpen) {
        gsap.fromTo(panel, { y: '100%' }, { y: 0, ...spring('defaultEffects'), overwrite: true });
        if (scrim)
          gsap.fromTo(
            scrim,
            { opacity: 0 },
            /* The panel's clock, not a shorter one of its own: the scrim is the
               other half of the sheet arriving, so finishing first left the sheet
               still rising over an already-settled dim. */
            { opacity: 1, ...spring('defaultEffects'), overwrite: true },
          );
      } else {
        gsap.to(panel, { y: '100%', ...spring('defaultEffects'), overwrite: true });
        if (scrim)
          gsap.to(scrim, { opacity: 0, ...spring('defaultEffects'), overwrite: true });
      }
    },
    { dependencies: [isOpen, rendering] },
  );

  /* Drag to dismiss. Separate hook from the tweens above because this one has a
     real teardown — an Observer on the panel — and therefore genuinely needs
     `revertOnUpdate` to avoid stacking one per toggle.

     **Not gated on the motion preference, and that is the fix**: gating it
     removed drag-to-dismiss from every sheet on every phone, and a direct
     manipulation is not an animation — the panel following a finger is the
     finger's motion. What the preference owns is the *settle* after release, so
     that is where it branches: `settle()` jumps to the target instead of
     tweening to it. `useDrawerSwipe` has the same shape for the same reason. */
  useGSAP(
    (_context, contextSafe) => {
      const panel = panelRef.current;
      if (!panel || !rendering) return;

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
        const target = dismiss ? height : 0;
        const scrim = scrimRef.current;

        /* Off keeps the gesture and drops the flight: land on the target in one
           frame, `gsap.set` rather than a 1ms tween so no competing tween can be
           created. Only `off` — under `reduced` a drag release still springs,
           because the finger has already carried the panel most of the way and
           cutting the remainder reads as the gesture being dropped. */
        if (motionTier() === 'off') {
          gsap.set(panel, { y: target });
          if (scrim) gsap.set(scrim, { opacity: dismiss ? 0 : 1 });
          if (dismiss) onCloseRef.current();
          return;
        }

        /* One spring per direction, and **no distance-scaled duration** — a spring
           already covers a shorter remaining distance in less time, so scaling
           its clock as well double-counts. `default-effects` on a dismiss (a
           panel that overshoots on the way out bounces back into view) and
           `default-spatial` on a settle-back, the split `NavigationDrawer.kt`
           makes for a drag release. */
        const release = spring(dismiss ? 'defaultEffects' : 'defaultSpatial');

        if (scrim)
          gsap.to(scrim, {
            opacity: dismiss ? 0 : 1,
            ...release,
            overwrite: true,
          });

        gsap.to(panel, {
          y: target,
          ...release,
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
      className={cn('fixed inset-0 flex flex-col justify-end z-dialog')}
      /* `inert` while leaving — same reason as `Modal`'s: the panel outlives its
         own `isOpen` so the exit tween has a target, and `pointer-events` alone
         would leave a focusable, screen-reader-visible subtree on screen for
         those 200ms. */
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
        tabIndex={-1}
        className={cn(
          'relative flex w-full flex-col overflow-hidden outline-none',
          /* `shadow-e1`, not `e3`: M3 puts the modal bottom sheet at elevation
             level 1. Level 3 is the dialog/FAB/search step — a heavier shadow
             than the thing a sheet is a quieter alternative to. */
          'bg-surface-container-low text-on-surface rounded-t-2xl shadow-e1',
          // A sheet on a tablet or a desktop window should not run the whole
          // width of a 1600px screen; it stays a phone-width dock, centred.
          'mx-auto sm:max-w-lg',
          maxHeight,
          className,
        )}
      >
        {!hideHandle && (
          /* M3's drag handle: a 32×4dp bar in `on-surface-variant`, inside a 48dp
             touch strip — the spec's unmodified `OnSurfaceVariant` (no alpha) at
             the touch-target floor, so the one affordance telling a phone user
             this panel can be pushed back down is at full strength. */
          <div className="flex h-12 shrink-0 items-center justify-center" aria-hidden="true">
            <span className="bg-on-surface-variant h-1 w-8 rounded-full" />
          </div>
        )}
        {title && (
          <h2 id={titleId} className="text-title-l text-on-surface shrink-0 px-6 pt-1 pb-3">
            {title}
          </h2>
        )}
        <div
          ref={bodyRef}
          /* `data-app-scroll-container`, like `Modal`'s body: this is the box that
             scrolls, so anything inside that wants to scroll to an element has to
             find this rather than the page behind the sheet. */
          data-app-scroll-container
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
