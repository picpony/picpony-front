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
import { cn } from '@/lib/utils';
import { prefersReducedMotion } from '@/lib/motion';
import { useEscapeToClose, useExitAnimation, useMounted } from '@/lib/overlay';

const MENU_MARGIN = 6;
const VIEWPORT_PADDING = 12;
/** 18rem — past this the panel scrolls no matter how much room it has. */
export const POPOVER_MAX_HEIGHT = 288;

/* Container-transform timings, from Vuetify 3.7's MD3 menu: 225ms in, 125ms
   out, with the rows running at twice the container's duration so their fade
   trails the morph. Vuetify's own curves are Material *2* leftovers
   (0.4, 0, 0.2, 1); these are this project's M3 equivalents.

   Spelled out rather than read from the CSS tokens because they are handed to
   Web Animations as `easing:` strings, where a failed `var()` falls back to
   `ease` silently — the same documented exception the hero's REVEAL_EASING and
   the top loader make. The values ARE the token values; keep them in sync. */
const ENTER_MS = 225;
const EXIT_MS = 125;
const EASE_DECELERATE = 'cubic-bezier(0.05, 0.7, 0.1, 1)';
const EASE_STANDARD = 'cubic-bezier(0.2, 0, 0, 1)';
const EASE_ACCELERATE = 'cubic-bezier(0.3, 0, 0.8, 0.15)';

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
  'aria-activedescendant'?: string;
}

/**
 * A floating panel anchored to a control.
 *
 * There was no such thing, so every floating surface in the app invented one —
 * five recipes for the same object. Measured before this existed:
 *
 *   Select's menu       4dp corner, e2, no border,  surface-container
 *   the share menu      8dp corner, e3, a border,   surface-container
 *   the emoji picker    8dp corner, e3, no border,  surface-container
 *   two autocompletes   8dp corner, e3, a border,   surface-container
 *   a third autocomplete 8dp corner, e3, a border,  surface-container-LOWEST
 *
 * Two of those carried comments arguing *opposite* corner values, which is the
 * tell that nobody was choosing — one said "a menu is 8dp" and the other said
 * "4dp, not the 8dp I first guessed". The M3 shape scale settles it: `small`
 * (8dp) is specified for "text fields, menus", and 4dp `extra-small` is for
 * chips and snackbars. Elevation likewise — level 2 is "menus, nav bar", level
 * 3 is "FAB, dialogs, search" — so four of the five were also a step too high,
 * which is why the share menu floated above `Modal`.
 *
 * No border. The tonal step plus the elevation is the whole M3 separation
 * recipe; an outline on top of both is a fourth signal for one edge.
 *
 * **What this owns**: the surface, where it goes, how it arrives and leaves, and
 * how it is dismissed. **What it does not own**: the content, or any roving
 * focus inside it — see `Menu` for that.
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
  'aria-activedescendant': ariaActiveDescendant,
}: PopoverProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  /* Kept in the tree past `open` so the exit has something to play on. The
     shared hook rather than a hand-rolled flag: `EXIT_MS` is a constant, which
     is exactly the case it was written for, and `Modal` and `Sheet` already
     hold themselves open the same way. */
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
       Testing `spaceBelow` alone left a control halfway down a long page with
       `up === false`, the max-height clamped to whatever was underneath, and a
       six-row panel two rows tall with a scrollbar over an empty upper half. */
    const up = estimate > spaceBelow && spaceAbove > spaceBelow;
    setPlacement({
      top: up ? rect.top - MENU_MARGIN : rect.bottom + MENU_MARGIN,
      left: rect.left,
      width: rect.width,
      up,
      available: Math.max(0, Math.min(maxHeight, up ? spaceAbove : spaceBelow)),
    });
  }, [anchorRef, estimatedHeight, maxHeight]);

  /* Measure before the first paint of an opening panel, never after. Writing
     layout back as state from a layout effect is the documented React pattern
     for measure-then-position: there is no way to know where a portalled panel
     goes without first reading the anchor's box, and doing it after paint would
     show the panel at 0,0 for a frame. */
  useLayoutEffect(() => {
    if (!open) return;
    closingRef.current = false;
    measure();
  }, [open, measure]);

  /* Then clamp horizontally, which `measure` cannot do on its own: it runs
     before the panel exists and the panel's width is not the anchor's whenever
     `matchAnchorWidth` is off — a `Menu` is as wide as its longest label. So a
     menu hanging off an icon button near the right edge was positioned at the
     anchor's `left` and simply ran past the viewport, with no scrollbar to
     reach it because the panel is `position: fixed`.
     Runs pre-paint and settles in one pass: once clamped the condition is
     false, so there is no loop. */
  useLayoutEffect(() => {
    if (!open || !rendering) return;
    const panel = panelRef.current;
    if (!panel) return;
    const width = panel.offsetWidth;
    const rightLimit = window.innerWidth - VIEWPORT_PADDING - width;
    const clamped = Math.max(VIEWPORT_PADDING, Math.min(placement.left, rightLimit));
    if (Math.abs(clamped - placement.left) > 0.5) {
      setPlacement((prev) => ({ ...prev, left: clamped }));
    }
  }, [open, rendering, placement.left]);

  /* Exit: the reverse container transform, shrinking back into the anchor
     rather than blinking out. `closingRef` guards it because Escape, an outside
     press and a commit can all land in one gesture, and each would otherwise
     start another exit on a panel already leaving. */
  useEffect(() => {
    if (open || !rendering || closingRef.current) return;
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor || prefersReducedMotion()) return;

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.width === 0 || panelRect.height === 0) return;

    closingRef.current = true;
    panel.style.pointerEvents = 'none';
    /* `useExitAnimation` already holds the panel for `EXIT_MS` and then drops
       it, so this only has to draw those milliseconds — it does not have to
       report when it is done. */
    panel.animate(
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
      { duration: EXIT_MS, easing: EASE_ACCELERATE, fill: 'forwards' },
    );
  }, [open, rendering, anchorRef]);

  /* Enter: an M3 container transform. The panel starts at the anchor's own box
     — scaled down to it and transparent — and grows into place, while its rows
     stay invisible for the first third and then fade in behind the morph. That
     "container morphs, then content arrives" split is the character of an MD3
     menu opening, and a plain fade throws it away.

     Web Animations rather than GSAP: this starts from a measured box, and
     WAAPI's `fill: 'backwards'` guarantees the first painted frame is already
     the scaled one. A tween beginning on the next rAF tick flashes the panel at
     full size for a frame. */
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!open || !rendering || !panel || !anchor) return;
    if (prefersReducedMotion()) return;

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (panelRect.width === 0 || panelRect.height === 0) return;

    // Never scale up — the panel is at least as wide as its anchor.
    const sx = Math.min(1, anchorRect.width / panelRect.width);
    const sy = Math.min(1, anchorRect.height / panelRect.height);

    // Already anchored to the trigger's edge, so scaling about that edge
    // reproduces the translate half of the reference for free.
    panel.style.transformOrigin = placement.up ? 'bottom left' : 'top left';

    const container = panel.animate(
      [{ transform: `scale(${sx}, ${sy})`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: ENTER_MS, easing: EASE_DECELERATE, fill: 'backwards' },
    );

    const rows = animateChildren
      ? [...panel.children].map((row) =>
          row.animate([{ opacity: 0 }, { opacity: 0, offset: 0.33 }, { opacity: 1 }], {
            duration: ENTER_MS * 2,
            easing: EASE_STANDARD,
            fill: 'backwards',
          }),
        )
      : [];

    return () => {
      container.cancel();
      rows.forEach((row) => row.cancel());
    };
  }, [open, rendering, placement.up, anchorRef, animateChildren]);

  // Reposition against scroll and resize rather than trapping the page. A
  // popover is not modal: the page behind it stays live.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
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
      aria-activedescendant={ariaActiveDescendant}
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
      /* `popover-scrollbar`, not `main-scrollbar`: the latter reserves its
         gutter permanently, which is right for a page column and wrong for a
         160px menu, where it leaves every row 8px short of the right edge.

         `overflow-y: auto` unconditionally, never a conditional `hidden`. The
         condition it replaced used an *estimated* content height, so a panel
         whose real content ran a few pixels past the estimate was judged to fit,
         got `hidden`, and clipped its last row with no way to reach it. `auto`
         already means "a scrollbar only when one is needed". */
      className={cn(
        'popover-scrollbar bg-surface-container text-on-surface z-popover overflow-y-auto rounded-sm shadow-e2',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
