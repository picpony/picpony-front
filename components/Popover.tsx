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
import { SPRINGS, SPRING_MS, springToLinear } from '@/lib/spring';
import { useEscapeToClose, useExitAnimation, useMounted } from '@/lib/overlay';

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
 * Spelled out as literals rather than CSS tokens because they are handed to Web
 * Animations as `easing:` strings, where a failed `var()` silently falls back to
 * `ease`. `lib/spring.ts` generates them from the same closed form as the CSS
 * tables, so the two cannot drift. */
const ENTER_MS = SPRING_MS.fastSpatial;
const ENTER_EASING = springToLinear(SPRINGS.fastSpatial);
const ROW_MS = SPRING_MS.fastEffects;
const ROW_EASING = springToLinear(SPRINGS.fastEffects);
const EXIT_MS = SPRING_MS.fastEffects;
const EXIT_EASING = springToLinear(SPRINGS.fastEffects);

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
  const closingRef = useRef(false);
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
    closingRef.current = false;
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

  /* Exit: the reverse container transform, shrinking back into the anchor rather
     than blinking out. `closingRef` guards it — Escape, an outside press and a
     commit can all land in one gesture. */
  useEffect(() => {
    if (open || !rendering || closingRef.current) return;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor || motionTier() === 'off') return;

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.width === 0 || panelRect.height === 0) return;

    closingRef.current = true;
    /* `useExitAnimation` already holds the panel and drops it, so this only has to
       draw those milliseconds.

       It does have to be cancellable — that is what the cleanup is for. `fill:
       'forwards'` keeps the last keyframe applied after the animation ends, and
       `useExitAnimation` reuses the same node when the panel reopens inside the hold:
       without the cancel, the still-live forwards fill would reassert hidden state on
       a panel that is now open, so a fast close-then-open left an invisible menu
       holding the focus trap.

       The reduced tier collapses into the anchor like the standard one. It briefly
       faded instead, but the shape change *is* the menu — one composited scale on one
       small panel — and what the tier removes is distance, overshoot and cascade,
       none of which are here. */
    const exit = panel.animate(
      [
        {},
        {
          transform: `scale(${Math.min(1, anchorRect.width / panelRect.width)}, ${Math.min(
            1,
            anchorRect.height / panelRect.height,
          )})`,
          opacity: 0,
        },
      ],
      { duration: scaledMs(EXIT_MS), easing: EXIT_EASING, fill: 'forwards' },
    );
    return () => exit.cancel();
  }, [open, rendering, anchorRef]);

  /* Enter: an M3 container transform. The panel starts at the anchor's own box
     — scaled down to it and transparent — and grows into place, while its rows
     stay invisible for the first third and then fade in behind the morph. That
     "container morphs, then content arrives" split is the character of an MD3
     menu opening; a plain fade throws it away.

     Web Animations rather than GSAP: this starts from a measured box, and the
     backwards fill guarantees the first painted frame is already the scaled one.
     A tween beginning on the next rAF tick flashes the panel at full size. */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!open || !rendering || !panel || !anchor) return;
    const tier = motionTier();
    if (tier === 'off') return;

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.width === 0 || panelRect.height === 0) return;

    // Never scale up — the panel is at least as wide as its anchor.
    const sx = Math.min(1, anchorRect.width / panelRect.width);
    const sy = Math.min(1, anchorRect.height / panelRect.height);

    // Already anchored to the trigger's edge, so scaling about that edge
    // reproduces the translate half of the reference for free.
    panel.style.transformOrigin = placement.up ? 'bottom left' : 'top left';

    /* Reduced keeps the morph and drops the rows' own leg: the stagger is the
       flourish, and with rows on the same clock as the plate there is one
       entrance rather than two — what this tier wants. */
    const reduced = tier === 'reduced';
    const container = panel.animate(
      [{ transform: `scale(${sx}, ${sy})`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      {
        duration: scaledMs(ENTER_MS),
        easing: ENTER_EASING,
        fill: 'backwards',
      },
    );

    /* The rows wait out the container's morph and then fade on their **own**
       clock (the effects spring's settle time) rather than being stretched over a
       doubled span. A spring's shape and duration are one object: replayed longer,
       the same ζ=1 curve is not a slower fade, it is a different one. The wait is
       a `delay` because that is what a delay is for. */
    const rows =
      animateChildren && !reduced
        ? [...panel.children].map((row) =>
            row.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: scaledMs(ROW_MS),
              delay: scaledMs(ENTER_MS * 0.5),
              easing: ROW_EASING,
              fill: 'backwards',
            }),
          )
        : [];

    return () => {
      container.cancel();
      rows.forEach((row) => row.cancel());
    };
  }, [open, rendering, placement.up, anchorRef, animateChildren]);

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
  useEscapeToClose(open, closeAndRefocus);

  if (!mounted || !rendering) return null;

  return createPortal(
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
    </div>,
    document.body,
  );
}
