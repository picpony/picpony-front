'use client';
/* `'use no memo'` for the same reason `lib/motion.ts` carries it: this component passes a
   hand-tuned `useGSAP` dependency list and deliberately omits `revertOnUpdate`, so it sits on the
   one path where a change in memoised identity changes when the GSAP context is torn down. Lift
   it with the tab and hero probes as guardrails. */'use no memo';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Observer, gsap, spring, useGSAP } from '@/lib/motion';
import { motionTier } from '@/lib/appearance';
import { SPRING_MS } from '@/lib/spring';
import { cn } from '@/lib/utils';
import {
  useExitAnimation,
  useOverlayLayer,
  useMounted,
  useScrollLock,
  OverlayLayerContext,
} from '@/lib/overlay';

interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** The sheet's name when it shows no `title`. */
  'aria-label'?: string;
  children: ReactNode;
  /** Cap the panel's height. A sheet taller than this is a dialog. */
  maxHeight?: string;
  closeOnOverlayClick?: boolean;
  /** Esc — and the system Back, which follows the same rule. */
  closeOnEscape?: boolean;
  /** Whether the system/browser Back closes the sheet (`lib/historyLayers.ts`). On by default. */
  closeOnBack?: boolean;
  bodyClassName?: string;
  className?: string;
  /** Hide the drag handle for a sheet that is not draggable (rare). */
  hideHandle?: boolean;
  /**
   * Fires once the panel has left — `Modal`'s twin. For content that must hold still while the
   * sheet goes (a cart that was just checked out keeps its lines on the way down) and only then
   * reset.
   */
  onExited?: () => void;
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
 * Focus, Escape, Back and the refcounted scroll lock come from `lib/overlay.ts`,
 * shared with `Modal`.
 */
export default function Sheet({
  isOpen,
  onClose,
  title,
  'aria-label': ariaLabel,
  children,
  maxHeight = 'max-h-[85dvh]',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  closeOnBack = true,
  bodyClassName = '',
  className = '',
  hideHandle = false,
  onExited,
}: SheetProps) {
  const mounted = useMounted();
  const rendering = useExitAnimation(isOpen, EXIT_MS);
  const exited = useRef(onExited);
  useLayoutEffect(() => {
    exited.current = onExited;
  });
  /* The exit hold is the wall-clock bound at the slowest speed (`useExitAnimation`), so the panel
     is off screen by the time `rendering` falls. */
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
  /* `isOpen` for the drag, `useDrawerSwipe`'s shape: written in a layout effect, in the commit
     that changes it, and a change made elsewhere while a finger holds the panel — Back, Esc, the
     caller — handed to the gesture there (`interrupt`). The enter/exit tween already carries the
     panel from where it is to React's state, so the gesture only has to end: it used to follow
     the finger for the rest of the exit hold, the panel jumping back up under it with the scrim
     returning, and its release then sprang the leaving sheet open or asked to close it again. */
  const openRef = useRef(isOpen);
  const interrupt = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const changed = openRef.current !== isOpen;
    openRef.current = isOpen;
    if (changed) interrupt.current?.();
  });

  /* Enter and exit, on `default-effects` both ways — the spring
   * `ModalBottomSheet.kt` assigns.
   *
   * `overwrite: true` rather than `revertOnUpdate`: reverting would restore the
   * panel to its unanimated position — which for the enter tween is off-screen —
   * in the same frame the exit is trying to start from rest. */
  useGSAP(
    (_context, contextSafe) => {
      /* This hook does not revert on update (see above), so a returned cleanup would only
         run at unmount: the pending start is cancelled here, by the next run. */
      cancelAnimationFrame(enterFrame.current);
      enterFrame.current = 0;
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!rendering) {
        placedPanel.current = null;
        return;
      }
      if (!panel) return;

      /* Seed only a newly mounted surface. Reopening during its exit keeps the
         current pose; a fromTo here sent it back to the bottom edge first. */
      if (placedPanel.current !== panel) {
        placedPanel.current = panel;
        gsap.set(panel, { y: '100%' });
        if (scrim) gsap.set(scrim, { opacity: 0 });
      }

      if (motionTier() === 'off') {
        gsap.killTweensOf(panel);
        if (scrim) gsap.killTweensOf(scrim);
        gsap.set(panel, { y: isOpen ? 0 : '100%' });
        if (scrim) gsap.set(scrim, { opacity: isOpen ? 1 : 0 });
        return;
      }

      /* The reduced tier rises like the standard one. `defaultEffects` is
         critically damped (no overshoot to remove), and a panel that appears in
         the middle of the screen without arriving from anywhere reads as a
         dialog — the travel *is* what says which edge it belongs to.

         Started from the next frame, not from this effect: the sheet mounts in the
         same commit as whatever opened it, and a tween created here took its start
         time before that commit's work — a 380ms stall was consumed as elapsed
         motion, so the first frame drawn was the panel already docked. From the
         first frame the browser can produce, a stall only delays the travel. */
      const start = contextSafe!(() => {
        enterFrame.current = 0;
        gsap.to(panel, { y: isOpen ? 0 : '100%', ...spring('defaultEffects'), overwrite: true });
        /* The panel's clock: the scrim is the other half of this same movement. */
        if (scrim)
          gsap.to(scrim, { opacity: isOpen ? 1 : 0, ...spring('defaultEffects'), overwrite: true });
      });
      if (isOpen) enterFrame.current = requestAnimationFrame(start);
      else start();
    },
    { dependencies: [isOpen, rendering] },
  );
  useEffect(() => () => cancelAnimationFrame(enterFrame.current), []);

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
      let originY = 0;
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

      /* Closed (or reopened) from elsewhere mid-gesture: the drag is over, and its release, when
         the finger lifts, finds nothing to do. A release already springing is turned round by
         the exit tween's `overwrite`. */
      interrupt.current = () => {
        active = false;
        pending = false;
      };

      const observer = Observer.create({
        target: panel,
        // Touch only, like the drawer. A pointer-drag on desktop would fight
        // text selection inside the sheet, and those users have Esc and the scrim.
        type: 'touch',
        dragMinimum: 8,
        lockAxis: true,
        tolerance: 4,
        ignore: '[data-no-sheet-drag]',
        onDragStart: (self) => {
          /* A sheet whose body is scrolled is being read, not dragged. Only once
             it has nothing left to scroll does a downward pull belong to the
             sheet. Anything outside the scroller — the handle, the header — can
             always start a drag. A leaving sheet takes none. */
          const body = bodyRef.current;
          const fromBody = self.event.target instanceof Node && body?.contains(self.event.target);
          pending = openRef.current && (!fromBody || !body || body.scrollTop <= 0);
        },
        onDrag: (self) => {
          if (pending) {
            // A horizontal drag is not a dismiss; let it go.
            if (self.axis === 'y') {
              height = panel.offsetHeight;
              if (height <= 0) return;
              /* The finger takes over from an entrance or a previous release.
                 Stop those clocks before writing positions, and preserve the
                 current offset so grabbing a moving sheet does not snap it home. */
              originY = Number(gsap.getProperty(panel, 'y')) || 0;
              gsap.killTweensOf(panel);
              if (scrimRef.current) gsap.killTweensOf(scrimRef.current);
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
          place(gsap.utils.clamp(0, height, originY + (self.y ?? 0) - (self.startY ?? 0)));
        },
        onDragEnd: (self) => {
          pending = false;
          if (!active) return;
          const y = (gsap.getProperty(panel, 'y') as number) || 0;
          const flick = self.velocityY > FLICK_VELOCITY;
          settle(flick || y / height > COMMIT_RATIO);
        },
      });

      return () => {
        observer.kill();
        interrupt.current = null;
      };
    },
    { dependencies: [rendering], revertOnUpdate: true },
  );

  if (!mounted || !rendering) return null;

  return createPortal(
    <OverlayLayerContext.Provider value={layer}>
    <div
      style={layer.depth ? { zIndex: `calc(var(--z-dialog) + ${layer.depth})` } : undefined}
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
        aria-label={title ? undefined : (ariaLabel ?? '对话框')}
        tabIndex={-1}
        className={cn(
          'relative flex w-full flex-col overflow-hidden focus-visible:outline-hidden',
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
          /* No browser touch action on the strip or the title: the drag is the
             sheet's, and a downward pan that reached the browser as well would start
             its overscroll glow or pull-to-refresh under the finger. */
          <div className="flex h-12 shrink-0 touch-none items-center justify-center" aria-hidden="true">
            <span className="bg-on-surface-variant h-1 w-8 rounded-full" />
          </div>
        )}
        {title && (
          <h2 id={titleId} className="text-title-l text-on-surface shrink-0 touch-none px-6 pt-1 pb-3">
            {title}
          </h2>
        )}
        <div
          ref={bodyRef}
          /* `data-app-scroll-container`, like `Modal`'s body: this is the box that
             scrolls, so anything inside that wants to scroll to an element has to
             find this rather than the page behind the sheet. */
          data-app-scroll-container
          /* Overscroll is contained: a list that reaches its end keeps the rest of
             the fling rather than handing it to the page (or the browser) beneath. */
          className={cn(
            'popover-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-y-contain',
            bodyClassName || 'px-6',
          )}
        >
          {children}
        </div>
        {/* The dock sits against the screen edge, so it owns the home-indicator
            inset. `max()` rather than a flat value: on a device with no inset
            the sheet would otherwise carry 34px of dead space. */}
        <div className="h-[max(1rem,env(safe-area-inset-bottom))] shrink-0" />
      </div>
    </div>
    </OverlayLayerContext.Provider>,
    document.body,
  );
}
