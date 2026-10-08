'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { clamp, cn } from '@/lib/utils';
import { SPRING_MS } from '@/lib/spring';
import { useExitAnimation, useMounted } from '@/lib/overlay';
import { trackPress } from '@/lib/ripple';

/** Gap between the anchor and the bubble, per M3. */
const OFFSET = 4;
/** Keep the bubble this far from the viewport edge. */
const VIEWPORT_PADDING = 8;
/**
 * How long a pointer must rest before the bubble appears. Material's own figure.
 * Without a delay a tooltip fires on every pointer that crosses a toolbar, which
 * is how a helpful label becomes a flicker.
 */
const HOVER_DELAY_MS = 500;
/**
 * How long the bubble waits after the pointer leaves the control before it goes — the
 * time to cross the 4dp gap onto the bubble itself, which WCAG 1.4.13 requires be
 * possible ("hoverable"). Short enough that a pointer sweeping along a toolbar does not
 * trail a bubble behind it.
 */
const LEAVE_GRACE_MS = 120;
/**
 * A finger's version of the rest delay: a touch held this long without travelling is a
 * long press, and a long press on a labelled control is how a phone asks what it is.
 */
const LONG_PRESS_MS = 500;
/**
 * How long a long-press tooltip stays after the finger lifts — Compose's own
 * `TooltipDuration` (1500ms): there is no pointer left to hover it, so it times out.
 */
const TOUCH_HOLD_MS = 1500;
/**
 * How long the bubble stays mounted after `open` goes false. Read from the spring
 * itself rather than hand-typed beside it: the fade runs on `fast-effects`, and a
 * literal here is a second copy of that number waiting to drift.
 */
const EXIT_MS = SPRING_MS.fastEffects;

/**
 * M3 plain tooltip.
 *
 * By its own tokens (`PlainTooltipTokens`): `inverse-surface` container,
 * `inverse-on-surface` text at `body-small`, extra-small corner, and **no
 * elevation** — a plain tooltip is a label, not a surface that floats.
 *
 * `inverse-surface` here is not the mistake the snackbar's note warns about. That
 * role flips between schemes, which is wrong for a *severity*; a tooltip carries
 * no severity — its whole job is to contrast with whatever surface it is over,
 * and flipping is exactly how it keeps doing that.
 *
 * Shows on hover after a delay, on **focus immediately** (a keyboard user has
 * already committed to the control) and on a **long press** under a finger. Hides on
 * leave (after a short grace, so the pointer can move onto the bubble), blur, Escape
 * and press; a long-press bubble times out after the finger lifts.
 *
 * `aria-describedby`, not `aria-label`: the control already has a name, and the
 * tooltip repeats it for the eye — announcing it as the name too would read it
 * twice.
 */
export function Tooltip({
  label,
  anchorRef,
  open,
  id,
  onPointerEnter,
  onPointerLeave,
}: {
  label: string;
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  id: string;
  /** The bubble is hoverable: a pointer on it keeps it open. */
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const mounted = useMounted();
  const bubbleRef = useRef<HTMLDivElement>(null);
  /* Held past `open` so the exit has something to play on, and false until the
     first open so a page of forty icon buttons costs forty nulls rather than
     forty portals. `lib/overlay.ts` already owns this — `Modal`, `Sheet` and
     `Popover` all hold themselves open the same way. */
  const rendering = useExitAnimation(open, EXIT_MS);
  const [place, setPlace] = useState({ top: 0, left: 0, above: false });

  /* Measure before the first paint, or the bubble shows at 0,0 for a frame. Two
     passes by construction: the first places it from the anchor's box alone, the
     second — once the bubble exists and its own width is known — centres and
     clamps it. The condition is false after the second, so there is no loop. */
  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    const width = bubble?.width ?? 0;
    const height = bubble?.height ?? 0;
    const below = a.bottom + OFFSET;
    const above = window.innerHeight - a.top + OFFSET;
    /* Above only when it does not fit below: a tooltip belongs under its control
       so it does not cover the thing you are pointing at. */
    const flip = below + height + VIEWPORT_PADDING > window.innerHeight && a.top > height + OFFSET;
    const centred = a.left + a.width / 2 - width / 2;
    const left = clamp(centred, VIEWPORT_PADDING, window.innerWidth - VIEWPORT_PADDING - width);
    const next = { top: flip ? above : below, left, above: flip };
    setPlace((prev) =>
      Math.abs(prev.top - next.top) < 0.5 &&
      Math.abs(prev.left - next.left) < 0.5 &&
      prev.above === next.above
        ? prev
        : next,
    );
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open || !rendering) return;
    measure();
  }, [open, rendering, measure, place.top, place.left]);

  /* The bubble is `position: fixed`, so it does not move with its anchor. Without
     this, opening one by keyboard focus and then scrolling the app scroller — arrow
     keys, space, a wheel over a sibling — left the bubble at its old viewport
     coordinate while the control it describes moved out from under it. `capture` so
     it hears the app scroller rather than only the window, and `passive` because it
     never calls `preventDefault`. `Popover` solves the same problem. */
  useEffect(() => {
    if (!open || !rendering) return;
    /* Match Popover's one read per frame. Scroll events can arrive faster than
       paint; measuring the anchor and bubble on each one only blocks that same
       scroll without producing an extra visible position. */
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
      window.removeEventListener('scroll', onReflow, { capture: true });
      window.removeEventListener('resize', onReflow);
    };
  }, [open, rendering, measure]);

  if (!mounted || !rendering) return null;

  /* Named before the style literal: the React Compiler cannot lower a conditional computed
     key, and bailing out here left the one component every icon button renders uncompiled. */
  const edge = place.above ? 'bottom' : 'top';

  return createPortal(
    <div
      ref={bubbleRef}
      id={id}
      role="tooltip"
      data-open={open ? 'true' : 'false'}
      inert={!open}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={{
        position: 'fixed',
        left: place.left,
        [edge]: place.top,
        maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
      }}
      className={cn(
        /* 4dp corner, 8dp/4dp padding and a 24dp floor — M3's plain tooltip. No
           shadow: the inverse container is the whole separation — which forced colors
           flattens, hence the system edge. */
        'm3-tooltip bg-inverse-surface text-inverse-on-surface text-body-s z-tooltip forced-boundary',
        'flex min-h-6 items-center rounded-xs px-2 py-1 wrap-anywhere',
        /* Hoverable while open (WCAG 1.4.13): the pointer may move onto the bubble
           without it vanishing. Never while leaving, so a closing bubble cannot catch
           a press meant for what is under it. */
        open ? 'pointer-events-auto' : 'pointer-events-none',
        /* `FastEffects` in **both** directions, which is what `Tooltip.kt` does.
           One spring both ways means the bubble cannot arrive and leave on two
           different clocks.

           Only opacity moves. AOSP's tooltip also scales, which is why it reaches
           for `FastSpatial` too; this one does not, so there is nothing for the
           spatial spring to drive and adding a scale would be a new behaviour
           rather than an alignment. */
        'spring-fast-effects transition-opacity',
        open ? 'opacity-100' : 'opacity-0',
      )}
    >
      {label}
    </div>,
    document.body,
  );
}

/**
 * The whole tooltip, as two things to spread.
 *
 * A hook rather than a wrapper component, because a wrapper has to either clone
 * its child — which breaks on any component that does not forward a ref — or
 * introduce a box of its own, which changes the layout of every row it lands in.
 * A control that wants a tooltip already owns its own element and its own ref, so
 * handing it the props is both simpler and layout-neutral.
 *
 *     const { anchorRef, anchorProps, tooltip } = useTooltip(label);
 *     return <>{<button ref={anchorRef} {...anchorProps} />}{tooltip}</>;
 *
 * An optional external target binds the same behaviour to a third-party-owned
 * button, such as an editor toolbar. It preserves other description IDs.
 * Pass `undefined` to opt out: no element, listeners or `aria-describedby`.
 *
 * **Touch** has no hover, so a long press shows the bubble (as on Android), it stays
 * `TOUCH_HOLD_MS` after the finger lifts, and the click that ends the long press is
 * swallowed — asking what a control is must not also press it. A long press that
 * travels or turns into a scroll shows nothing.
 */
type TooltipAnchorProps = Pick<
  HTMLAttributes<HTMLElement>,
  | 'aria-describedby'
  | 'onPointerEnter'
  | 'onPointerLeave'
  | 'onPointerDown'
  | 'onFocus'
  | 'onBlur'
  | 'onContextMenu'
>;

export function useTooltip(label?: string, externalTarget?: HTMLElement | null): {
  anchorRef: RefObject<HTMLElement | null>;
  anchorProps: TooltipAnchorProps;
  tooltip: ReactElement | null;
} {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [lastLabel, setLastLabel] = useState(label);
  const [lastTarget, setLastTarget] = useState(externalTarget);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  /* The long press in flight: whether its bubble is up, and how to stop swallowing the
     click that ends it. Refs, because every one of these is read from an event. */
  const touchPress = useRef<{ shown: boolean; disarm: () => void } | null>(null);

  // Disabled controls temporarily remove their label and event handlers. A
  // later re-enable must start a fresh hover, not resurrect the old bubble.
  if (lastLabel !== label || lastTarget !== externalTarget) {
    setLastLabel(label);
    setLastTarget(externalTarget);
    setOpen(false);
  }

  const cancel = useCallback(() => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  }, []);

  const hide = useCallback(() => {
    cancel();
    setOpen(false);
  }, [cancel]);

  const hideAfter = useCallback((ms: number) => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setOpen(false);
    }, ms);
  }, []);

  const keepOpen = useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const showForPointer = useCallback((event: { pointerType: string }) => {
    // A finger has no hover; its path is the long press below.
    if (event.pointerType === 'touch') return;
    keepOpen();
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    // Rest delay describes intent, so only the fade reads the motion preference.
    showTimer.current = window.setTimeout(() => {
      showTimer.current = null;
      setOpen(true);
    }, HOVER_DELAY_MS);
  }, [keepOpen]);

  const leaveForPointer = useCallback((event: { pointerType: string }) => {
    if (event.pointerType === 'touch') return;
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    showTimer.current = null;
    hideAfter(LEAVE_GRACE_MS);
  }, [hideAfter]);

  /* A press dismisses the bubble — except a finger's, which may be the start of a long
     press asking for it. */
  const onPress = useCallback((event: PointerEvent | React.PointerEvent) => {
    touchPress.current?.disarm();
    touchPress.current = null;
    if (event.pointerType !== 'touch') {
      hide();
      return;
    }
    hide();
    const anchor = event.currentTarget as HTMLElement;
    /* On a link a long press already means something — the platform's link menu (open in a
       new tab, copy the address) — and a label is not worth taking that away. */
    if (anchor.closest('a[href]')) return;
    const press: { shown: boolean; disarm: () => void } = { shown: false, disarm: () => {} };
    touchPress.current = press;
    trackPress(
      event,
      {
        press: () => {
          if (touchPress.current !== press) return;
          press.shown = true;
          setOpen(true);
          /* Swallow the click this press ends in, in the capture phase on `window`,
             ahead of React's own listener at the root. */
          const swallow = (e: MouseEvent) => {
            if (e.target instanceof Node && anchor.contains(e.target)) {
              e.preventDefault();
              e.stopPropagation();
            }
            press.disarm();
          };
          let expiry: number | null = null;
          press.disarm = () => {
            window.removeEventListener('click', swallow, true);
            if (expiry !== null) window.clearTimeout(expiry);
            expiry = null;
          };
          window.addEventListener('click', swallow, true);
          // Belt and braces: a release that produces no click must not leave it armed.
          expiry = window.setTimeout(() => press.disarm(), LONG_PRESS_MS + 5000);
        },
        release: () => {
          if (touchPress.current !== press) return;
          // The finger is gone: nothing is holding this control any more.
          touchPress.current = null;
          hideAfter(TOUCH_HOLD_MS);
          /* The click follows the release at once; after a beat, nothing is coming. */
          window.setTimeout(() => press.disarm(), 400);
        },
        cancel: () => {
          if (touchPress.current !== press) return;
          press.disarm();
          touchPress.current = null;
          if (press.shown) hide();
        },
      },
      LONG_PRESS_MS,
    );
  }, [hide, hideAfter]);

  /* A long press is also the platform's context-menu gesture (Edge on a Windows touch
     screen opens the page menu over the bubble). While a finger is holding this control
     for its label, that menu is not what was asked for. `touchPress` is set only while a
     finger is down, so a mouse's right click is never touched. */
  const onContextMenu = useCallback((event: Event | React.SyntheticEvent) => {
    if (touchPress.current) event.preventDefault();
  }, []);

  const showForFocus = useCallback((event: { target: EventTarget | null }) => {
    if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) {
      keepOpen();
      setOpen(true);
    }
  }, [keepOpen]);

  // Third-party toolbars own their buttons. Bind the same behaviour directly
  // instead of adding another tooltip recipe or a wrapper around their DOM.
  useLayoutEffect(() => {
    if (!externalTarget || !label) return;
    anchorRef.current = externalTarget;
    externalTarget.addEventListener('pointerenter', showForPointer);
    externalTarget.addEventListener('pointerleave', leaveForPointer);
    externalTarget.addEventListener('pointerdown', onPress);
    externalTarget.addEventListener('focus', showForFocus);
    externalTarget.addEventListener('blur', hide);
    externalTarget.addEventListener('contextmenu', onContextMenu);
    return () => {
      cancel();
      externalTarget.removeEventListener('pointerenter', showForPointer);
      externalTarget.removeEventListener('pointerleave', leaveForPointer);
      externalTarget.removeEventListener('pointerdown', onPress);
      externalTarget.removeEventListener('focus', showForFocus);
      externalTarget.removeEventListener('blur', hide);
      externalTarget.removeEventListener('contextmenu', onContextMenu);
      if (anchorRef.current === externalTarget) anchorRef.current = null;
    };
  }, [externalTarget, label, showForPointer, leaveForPointer, onPress, showForFocus, hide, cancel, onContextMenu]);

  useLayoutEffect(() => {
    if (!externalTarget || !label || !open) return;
    const ids = new Set(externalTarget.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean));
    ids.add(id);
    externalTarget.setAttribute('aria-describedby', [...ids].join(' '));
    return () => {
      const remaining = externalTarget.getAttribute('aria-describedby')?.split(/\s+/)
        .filter((value) => value && value !== id).join(' ');
      if (remaining) externalTarget.setAttribute('aria-describedby', remaining);
      else externalTarget.removeAttribute('aria-describedby');
    };
  }, [externalTarget, label, open, id]);

  useEffect(() => cancel, [cancel, label]);
  /* Unmounting mid-press must not leave a click swallower on `window`. */
  useEffect(() => () => touchPress.current?.disarm(), []);

  /* Escape dismisses it, which WCAG 1.4.13 requires of any content that appears on
     hover: it has to go away without moving the pointer.
     A second copy of `lib/overlay.ts`'s `useOverlayLayer` is deliberately *not*
     used, and this is the one place that call is right: that hook calls
     `stopPropagation` so the innermost overlay consumes the key, which is correct for
     a dialog and wrong here — a tooltip open over a dialog must dismiss *and* let the
     key reach the dialog behind it. A tooltip is not a layer you are inside. */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, hide]);

  if (!label) {
    return { anchorRef, anchorProps: {}, tooltip: null };
  }

  return {
    anchorRef,
    anchorProps: {
      'aria-describedby': open ? id : undefined,
      onPointerEnter: showForPointer,
      onPointerLeave: leaveForPointer,
      onPointerDown: onPress,
      onFocus: showForFocus,
      onBlur: hide,
      onContextMenu,
    },
    tooltip: (
      <Tooltip
        label={label}
        anchorRef={anchorRef}
        open={open}
        id={id}
        onPointerEnter={keepOpen}
        onPointerLeave={() => hideAfter(LEAVE_GRACE_MS)}
      />
    ),
  };
}

export default Tooltip;
