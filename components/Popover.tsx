'use client';

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cn, clamp } from '@/lib/utils';
import { MEDIA } from '@/lib/constants';
import { motionTier } from '@/lib/appearance';
import { SPRING_MS } from '@/lib/spring';
import { springTiming } from '@/lib/springTiming';
import { OverlayLayerContext, useOverlayLayer, useExitAnimation, useMounted } from '@/lib/overlay';

const MENU_MARGIN = 8;
const VIEWPORT_PADDING = 12;
/** 18rem — past this the panel scrolls no matter how much room it has. */
export const POPOVER_MAX_HEIGHT = 288;

/**
 * The height a list of `rows` menu rows will come out at, for `estimatedHeight`.
 *
 * A menu row is M3's 40dp item under a pointer and grows to the 48dp touch floor under
 * a finger (`touch-size` on the row), so the estimate has to read the same axis or
 * `Popover` picks its side against the wrong number and flips the panel on the way in.
 * The 8px is the container's own vertical padding. The one place this arithmetic lives.
 */
export function estimateMenuHeight(rows: number): number {
  const coarse =
    typeof window !== 'undefined' && window.matchMedia(MEDIA.pointerCoarse).matches;
  return rows * (coarse ? 48 : 40) + 8 * 2;
}

/* Container-transform timings.
 *
 * The **fast** tier, both halves — what `Menu.kt` reaches for: `FastSpatial` for the
 * container, `FastEffects` for what is inside it. A menu is the fastest floating
 * surface in the system; the default tier opened every menu one step slower.
 * The exit is the same `FastEffects` spring, not a curve: component motion, not a
 * screen transition, and ζ=1 guarantees no bounce back into view.
 *
 * `springTiming` pairs the easing and duration, scales their clock and substitutes
 * the critically damped geometry under reduced motion. The exit hold uses the
 * unscaled duration because useExitAnimation applies the maximum speed itself. */
const EXIT_MS = SPRING_MS.fastEffects;

export interface PopoverHandle {
  /** The panel element, for callers that need to measure or scroll it. */
  readonly element: HTMLDivElement | null;
}

interface PopoverProps {
  open: boolean;
  /** Called on Escape, on an outside press, or on a scroll that dismisses. */
  onClose: (refocus: boolean) => void;
  /** The control the panel hangs off. Its rect decides side, width and origin. */
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /**
   * Height guess used to pick a side *before* the panel has been laid out.
   * Must track the real geometry: when it undershoots, the panel is judged to
   * fit below when it does not, and a scrollbar appears in a panel that had
   * room to open upwards instead.
   */
  estimatedHeight?: number;
  /** Cap on the panel's height. */
  maxHeight?: number;
  /** Panel takes at least the anchor's width. On by default — a menu hanging
   *  off a control narrower than itself reads as detached. */
  matchAnchorWidth?: boolean;
  /** Extra classes on the panel, for width and inner padding. */
  className?: string;
  /** Fade the panel's direct children in behind the container morph. */
  animateChildren?: boolean;
  handleRef?: RefObject<PopoverHandle | null>;
  id?: string;
  role?: string;
  'aria-label'?: string;
}

/**
 * A floating panel anchored to a control.
 *
 * The one recipe for the app's floating surfaces: 4dp corner and `surface-container`
 * (`MenuTokens.ContainerShape` / `ContainerColor`), elevation level 2 (`ContainerElevation`)
 * — the shape-scale and elevation rows "menus" name. No border: the tonal step plus
 * elevation is the whole M3 separation recipe.
 *
 * **What this owns**: the surface, where it goes, how it arrives and leaves, and how
 * it is dismissed. **What it does not own**: the content, or any roving focus inside
 * it — see `Menu` for that.
 */
export default function Popover({
  open,
  onClose,
  anchorRef,
  children,
  estimatedHeight,
  maxHeight = POPOVER_MAX_HEIGHT,
  matchAnchorWidth = true,
  className = '',
  animateChildren = true,
  handleRef,
  id,
  role,
  'aria-label': ariaLabel,
}: PopoverProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  /* Kept in the tree past `open` so the exit has something to play on. The
     shared hook rather than a hand-rolled flag; `Modal` and `Sheet` hold
     themselves open the same way. */
  const rendering = useExitAnimation(open, EXIT_MS);
  const placedPanel = useRef<HTMLDivElement | null>(null);
  const restingRows = useRef(new Map<Element, { inlineOpacity: string; opacity: string }>());
  const [placement, setPlacement] = useState({
    top: 0,
    left: 0,
    width: 0,
    up: false,
    available: maxHeight,
  });

  /* A live getter rather than a snapshot, so a caller reading `.element` always
     sees the current node without this having to re-run on every mount. */
  useImperativeHandle(
    handleRef,
    () => ({
      get element() {
        return panelRef.current;
      },
    }),
    [],
  );

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const estimate = Math.min(estimatedHeight ?? maxHeight, maxHeight);
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN - VIEWPORT_PADDING;
    const spaceAbove = rect.top - MENU_MARGIN - VIEWPORT_PADDING;
    /* Upwards only when it does not fit below AND there is more room above.
       Testing the space below alone left a six-row panel clamped to two rows
       with a scrollbar over an empty upper half. */
    const up = estimate > spaceBelow && spaceAbove > spaceBelow;
    setPlacement({
      top: up ? rect.top - MENU_MARGIN : rect.bottom + MENU_MARGIN,
      left: rect.left,
      width: rect.width,
      up,
      available: clamp(up ? spaceAbove : spaceBelow, 0, maxHeight),
    });
  }, [anchorRef, estimatedHeight, maxHeight]);

  /* Measure before the first paint of an opening panel, never after. Writing
     layout back as state from a layout effect is the documented React pattern
     for measure-then-position; after paint would show the panel at 0,0 for a
     frame. */
  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

  /* Then clamp horizontally, which `measure` cannot do on its own: it runs
     before the panel exists and the panel's width is not the anchor's whenever
     `matchAnchorWidth` is off (a menu is as wide as its longest label) — a menu
     near the right edge ran past the viewport, unreachable because the panel is
     fixed-positioned. Pre-paint, settles in one pass: once clamped the
     condition is false, so there is no loop. */
  useLayoutEffect(() => {
    if (!open || !rendering) return;
    const panel = panelRef.current;
    if (!panel) return;
    const width = panel.offsetWidth;
    const rightLimit = window.innerWidth - VIEWPORT_PADDING - width;
    const clamped = clamp(placement.left, VIEWPORT_PADDING, rightLimit);
    if (Math.abs(clamped - placement.left) > 0.5) {
      setPlacement((prev) => ({ ...prev, left: clamped }));
    }
  }, [open, rendering, placement.left]);

  /* One layout effect owns both directions, including the rows. Cancelling the
     entrance in a layout cleanup and starting the exit in a passive effect
     exposed the full-sized panel for a frame. Commit the current pose before
     cancellation so an interrupted morph and its content keep their place.

     Geometry uses FastSpatial, opacity uses FastEffects; the latter cannot
     overshoot and clip. The standard tier's first opening keeps its delayed row
     fade, while reduced motion presents the rows on the container's own clock. */
  useLayoutEffect(() => {
    const restoreRows = () => {
      for (const [row, rest] of restingRows.current) {
        (row as HTMLElement).style.opacity = rest.inlineOpacity;
      }
      restingRows.current.clear();
    };
    if (!mounted || !rendering) {
      placedPanel.current = null;
      restoreRows();
      return;
    }
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    /* offset dimensions are the resting box. A bounding rect read mid-morph is
       already scaled, which would change the exit's destination on every reversal. */
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    if (width === 0 || height === 0) return;
    const collapsed = `scale(${Math.min(1, anchorRect.width / width)}, ${Math.min(1, anchorRect.height / height)})`;
    const firstPlacement = placedPanel.current !== panel;
    placedPanel.current = panel;
    const panelStyle = getComputedStyle(panel);
    const fromTransform = firstPlacement && open ? collapsed : panelStyle.transform;
    const fromOpacity = firstPlacement && open ? '0' : panelStyle.opacity;
    const rows = [...panel.children].map((row) => {
      const opacity = getComputedStyle(row).opacity;
      if (!restingRows.current.has(row)) {
        restingRows.current.set(row, { inlineOpacity: (row as HTMLElement).style.opacity, opacity });
      }
      return { row: row as HTMLElement, opacity, rest: restingRows.current.get(row)! };
    });
    panel.style.transformOrigin = placement.up ? 'bottom left' : 'top left';
    const transform = open ? 'none' : collapsed;
    const opacity = open ? '1' : '0';
    panel.style.transform = transform;
    panel.style.opacity = opacity;

    const tier = motionTier();
    if (tier === 'off') {
      restoreRows();
      return;
    }

    const effects = springTiming('fastEffects');
    const geometry = open ? springTiming('fastSpatial') : effects;
    const running = [
      panel.animate([{ transform: fromTransform }, { transform }], { ...geometry, fill: 'both' }),
      panel.animate([{ opacity: fromOpacity }, { opacity }], { ...effects, fill: 'both' }),
    ];
    const delayedRows = firstPlacement && animateChildren && tier === 'standard';
    if (open) {
      for (const { row, opacity: current, rest } of rows) {
        row.style.opacity = rest.inlineOpacity;
        /* A reversal resumes visible rows immediately. A fresh reduced opening
           has no separate row entrance; only the panel fades in that tier. */
        if (!delayedRows && current === rest.opacity) continue;
        running.push(row.animate(
          [{ opacity: delayedRows ? '0' : current }, { opacity: rest.opacity }],
          { ...effects, delay: delayedRows ? geometry.duration * 0.5 : 0, fill: 'both' },
        ));
      }
    }

    let active = true;
    Promise.all(running.map((animation) => animation.finished)).then(() => {
      if (!active) return;
      running.forEach((animation) => animation.cancel());
      restoreRows();
    }, () => {});

    return () => {
      active = false;
      for (const animation of running) {
        if (animation.playState !== 'idle') {
          try {
            animation.commitStyles();
          } catch {
            // A detached panel or replaced option row has no pose to preserve.
          }
        }
        animation.cancel();
      }
    };
  }, [open, mounted, rendering, placement.up, anchorRef, animateChildren]);

  /* Reposition against scroll and resize rather than trapping the page: a
     popover is not modal, the page behind it stays live.

     Passive and rAF-coalesced. `measure` reads `getBoundingClientRect`, so a
     non-passive capture listener made every scroll event wait on a layout read
     before the compositor could scroll. One frame requested at most: `frame`
     guards re-entry and the cleanup cancels a pending one. */
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const onReflow = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    window.addEventListener('scroll', onReflow, { capture: true, passive: true });
    window.addEventListener('resize', onReflow, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      // `false` — a press elsewhere is the user moving on, so yanking focus
      // back to the trigger would fight what they just did.
      onClose(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, onClose, anchorRef]);

  const closeAndRefocus = useCallback(() => onClose(true), [onClose]);
  const layer = useOverlayLayer(open && mounted && rendering, panelRef, { onClose: closeAndRefocus, modal: false });

  if (!mounted || !rendering) return null;

  return createPortal(
    <OverlayLayerContext.Provider value={layer}>
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      /* `inert` while leaving, not `pointer-events: none`. The panel is held in
       * the tree for the exit, and for those milliseconds it was still a focusable
       * subtree in the accessibility tree — a Tab after commit could land inside a
       * menu that was visibly going away. `pointer-events` only stops the pointer;
       * `inert` (React 19) takes a subtree out of the tab order and the
       * accessibility tree together. Declarative rather than set in the exit
       * effect, so re-opening inside the exit window cannot leave a live panel
       * inert. */
      inert={!open}
      style={{
        zIndex: layer.depth ? `calc(var(--z-popover) + ${layer.depth})` : undefined,
        position: 'fixed',
        top: placement.up ? undefined : placement.top,
        bottom: placement.up ? window.innerHeight - placement.top : undefined,
        left: placement.left,
        minWidth: matchAnchorWidth ? placement.width : undefined,
        /* A panel wider than the screen has to shrink, not merely be pushed
           inward — the clamp above can only move it. */
        maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
        maxHeight: `${placement.available}px`,
      }}
      /* `popover-scrollbar`, not `main-scrollbar`: the latter reserves its gutter
         permanently, right for a page column and wrong for a short menu, where it
         leaves every row short of the right edge.

         `overflow-y: auto` unconditionally, never a conditional hidden — the
         condition it replaced used an *estimated* content height, so a panel a
         few pixels past the estimate was judged to fit and clipped its last row.
         `auto` already means "a scrollbar only when one is needed".

         **4dp**, from `MenuTokens.ContainerShape = CornerExtraSmall` — menus are
         4dp and so are text fields (read the token file, not the summary table).
         The tone and elevation are `MenuTokens` and were already right. */
      className={cn(
        'popover-scrollbar bg-surface-container text-on-surface z-popover overflow-y-auto rounded-xs shadow-e2',
        className,
      )}
    >
      {children}
    </div>
    </OverlayLayerContext.Provider>,
    document.body,
  );
}
