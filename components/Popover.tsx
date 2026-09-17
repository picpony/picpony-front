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
import { motionTier, scaledMs } from '@/lib/appearance';
import { MENU_TRANSITION } from '@/lib/motionTokens';
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
 * A menu row has a 40dp minimum under a fine pointer and 48dp under a coarse one,
 * so the estimate has to read the same density axis or
 * `Popover` picks its side against the wrong number and flips the panel on the way in.
 * Include the 2dp row gaps and the 8dp padding at each end of the container.
 */
export function estimateMenuHeight(rows: number, rowHeight?: number): number {
  const coarse =
    typeof window !== 'undefined' && window.matchMedia(MEDIA.pointerCoarse).matches;
  return rows * (rowHeight ?? (coarse ? 48 : 40)) + Math.max(0, rows - 1) * 2 + 8 * 2;
}

/* The list opens out of its trigger, like Vuetify's VMenu. Its clock remains
 * the application's shared short/state pair: 200ms enter, 150ms exit, with the
 * user's speed scale. The arrangement is borrowed; the literal durations are not.
 *
 * Menu duration and easing are one pair; the search view keeps FastEffects.
 * Reduced motion removes the travel. The exit hold uses the
 * unscaled duration because useExitAnimation applies the maximum speed itself. */
const EXIT_MS = MENU_TRANSITION.exit.duration;

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
  /** Match the anchor exactly. Intrinsically sized panels are centred on it. */
  matchAnchorWidth?: boolean;
  /** Extra classes on the panel, for width and inner padding. */
  className?: string;
  /** Search suggestions extend the search bar's material and 28dp silhouette. */
  variant?: 'menu' | 'search';
  handleRef?: RefObject<PopoverHandle | null>;
  id?: string;
  role?: string;
  'aria-label'?: string;
}

/**
 * A floating panel anchored to a control.
 *
 * Menu surfaces use a 16dp corner, `surface-container` and level 2. The search
 * variant extends the search bar's 28dp corner and highest container tone,
 * keeping a restrained level 1 shadow only to explain its overlap with the page.
 * Both recipes live here so width, material and motion cannot drift at call sites.
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
  variant = 'menu',
  handleRef,
  id,
  role,
  'aria-label': ariaLabel,
}: PopoverProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /* Kept in the tree past `open` so the exit has something to play on. The
     shared hook rather than a hand-rolled flag; `Modal` and `Sheet` hold
     themselves open the same way. */
  const rendering = useExitAnimation(open, variant === 'search' ? SPRING_MS.fastEffects : EXIT_MS);
  const placedPanel = useRef<HTMLDivElement | null>(null);
  // measure() runs before placement's state update commits. The entrance needs
  // that freshly chosen side even on the first upward opening.
  const opensUp = useRef(false);
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
    opensUp.current = up;
    const panelWidth = panelRef.current?.offsetWidth;
    const left = !matchAnchorWidth && panelWidth
      ? rect.left + (rect.width - panelWidth) / 2
      : rect.left;
    setPlacement({
      top: up ? rect.top - MENU_MARGIN : rect.bottom + MENU_MARGIN,
      left,
      width: rect.width,
      up,
      available: clamp(up ? spaceAbove : spaceBelow, 0, maxHeight),
    });
  }, [anchorRef, estimatedHeight, maxHeight, matchAnchorWidth]);

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
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const width = panel.offsetWidth;
    const rightLimit = window.innerWidth - VIEWPORT_PADDING - width;
    const rect = anchor.getBoundingClientRect();
    const aligned = matchAnchorWidth ? rect.left : rect.left + (rect.width - width) / 2;
    const clamped = clamp(aligned, VIEWPORT_PADDING, rightLimit);
    if (Math.abs(clamped - placement.left) > 0.5) {
      setPlacement((prev) => ({ ...prev, left: clamped }));
    }
  }, [open, rendering, placement.left, placement.width, anchorRef, matchAnchorWidth]);

  /* One layout effect owns both directions. Cancelling the
     entrance in a layout cleanup and starting the exit in a passive effect
     exposed the full-sized panel for a frame. Commit the current pose before
     cancellation so an interrupted morph and its content keep their place.

     The transform is resolved from real trigger and panel geometry. Content
     becomes visible once the expanding surface is nearly full size and finishes
     on the same clock; it does not trail after the container. Reduced/search
     keep one fade, with no independent content animation. */
  useLayoutEffect(() => {
    if (!mounted || !rendering) {
      placedPanel.current = null;
      return;
    }
    const panel = panelRef.current;
    const content = contentRef.current;
    const anchor = anchorRef.current;
    if (!panel || !content || !anchor) return;
    // Padding gives an unmeasured width: 0 panel a nonzero offsetWidth. Wait
    // for the anchor width before seeding the first collapsed pose.
    if (matchAnchorWidth && placement.width <= 0) return;

    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    if (width === 0 || height === 0) return;
    const tier = motionTier();
    const morph = variant === 'menu' && tier === 'standard';
    let collapsed = 'none';
    if (morph) {
      const target = anchor.getBoundingClientRect();
      const rawX = target.width / width;
      const rawY = target.height / height;
      const normalization = Math.max(1, rawX, rawY);
      const sx = rawX / normalization;
      const sy = rawY / normalization;
      const aligned = matchAnchorWidth ? target.left : target.left + (target.width - width) / 2;
      const left = clamp(aligned, VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - width);
      const x = target.left + target.width / 2 - left - width * sx / 2;
      const y = opensUp.current ? height + MENU_MARGIN - height * sy : -MENU_MARGIN;
      collapsed = `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;
    }
    const firstPlacement = placedPanel.current !== panel;
    placedPanel.current = panel;
    const panelStyle = getComputedStyle(panel);
    const fromTransform = firstPlacement && open ? collapsed : panelStyle.transform;
    const fromOpacity = firstPlacement && open ? '0' : panelStyle.opacity;
    const fromContentOpacity = firstPlacement && open && morph ? '0' : getComputedStyle(content).opacity;
    const transform = open ? 'none' : collapsed;
    const opacity = open ? '1' : '0';
    panel.style.transform = transform;
    panel.style.opacity = opacity;
    // One stable origin also makes an in-flight above/below flip continuous.
    panel.style.transformOrigin = '0 0';
    content.style.opacity = morph && !open ? '0' : '1';

    if (tier === 'off') return;

    if (fromOpacity === opacity && fromTransform === transform && fromContentOpacity === content.style.opacity) return;
    const menu = MENU_TRANSITION[open ? 'enter' : 'exit'];
    const timing = variant === 'search'
      ? springTiming('fastEffects')
      : { duration: scaledMs(menu.duration), easing: menu.easing };
    const from: Keyframe = { opacity: fromOpacity };
    const to: Keyframe = { opacity };
    if (fromTransform !== transform) {
      from.transform = fromTransform;
      to.transform = transform;
    }
    const running = [panel.animate([from, to], { ...timing, fill: 'both' })];
    if (morph) {
      const effects = springTiming('fastEffects');
      // Only hidden content waits for the surface to expand. A reversal with
      // visible text picks up its opacity immediately from the current frame.
      const delay = open && Number(fromContentOpacity) < 0.05
        ? Math.max(0, timing.duration - effects.duration)
        : 0;
      running.push(content.animate(
        [{ opacity: fromContentOpacity }, { opacity: content.style.opacity }],
        { ...effects, delay, fill: 'both' },
      ));
    }

    let active = true;
    Promise.all(running.map((animation) => animation.finished)).then(() => {
      if (!active) return;
      running.forEach((animation) => animation.cancel());
    }, () => {});

    return () => {
      active = false;
      for (const animation of running) {
        if (animation.playState !== 'idle') {
          try {
            animation.commitStyles();
          } catch {
            // A detached panel has no pose to preserve.
          }
        }
        animation.cancel();
      }
    };
  }, [open, mounted, rendering, placement.up, placement.width, anchorRef, variant, matchAnchorWidth]);

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
        width: matchAnchorWidth ? placement.width : undefined,
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

         Menu rows sit 8dp inside the 16dp outer corner. Both variants lay out
         at final dimensions before animating. Menu content fades in as its
         surface expands; search suggestions keep only the single panel fade. */
      className={cn(
        'popover-scrollbar text-on-surface z-popover overflow-y-auto',
        variant === 'search'
          ? 'rounded-2xl bg-surface-container-highest p-2 shadow-e1'
          : 'rounded-lg bg-surface-container shadow-e2',
        className,
      )}
    >
      <div ref={contentRef} role="presentation" className="space-y-0.5">
        {children}
      </div>
    </div>
    </OverlayLayerContext.Provider>,
    document.body,
  );
}
