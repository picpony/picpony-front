'use client';

import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { MdCheckCircle, MdError, MdInfo, MdWarning } from 'react-icons/md';
import { MENU_TRANSITION, TRAVEL_PX } from '@/lib/motionTokens';
import { motionTier, scaledMs } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';

import { subscribeToasts, type ToastListener, type ToastNotice, type ToastType } from '@/lib/toast';

export { showToast } from '@/lib/toast';
export type { ToastAction, ToastOptions, ToastType } from '@/lib/toast';

interface ToastMessage extends ToastNotice {
  /** Bumped when an identical toast is raised again: restarts its reading time. */
  version: number;
  /** Pushed out by a newer toast before its time was up. */
  leaving: boolean;
}

/** At most this many on screen; a newer one sends the oldest away. */
const MAX_VISIBLE = 3;

/* The four severities keep the colours this app has always used — green, red,
   blue, amber — but from the scheme-independent `*-fill` tokens rather than
   Tailwind's palette, so a toast is the same colour in both themes and its white
   label is guaranteed 4.5:1. (`inverse-surface` is textbook M3 for a snackbar and
   wrong here: that token flips with the theme, so the same message arrived as a
   dark chip or a light one depending on the scheme.) */
const severityStyles: Record<ToastType, { bg: string; icon: React.ReactNode }> = {
  success: {
    bg: 'bg-success-fill',
    icon: <MdCheckCircle size={ICON.control} />,
  },
  error: {
    bg: 'bg-error-fill',
    icon: <MdError size={ICON.control} />,
  },
  info: {
    bg: 'bg-info-fill',
    icon: <MdInfo size={ICON.control} />,
  },
  warning: {
    bg: 'bg-warning-fill',
    icon: <MdWarning size={ICON.control} />,
  },
};

/**
 * The snackbar stack: below the app bar (`--app-chrome-bottom`, which the shell keeps at
 * the bar's bottom edge including the dev banner and the safe area), centred, never over
 * the bar's controls.
 *
 * **Not hit-testable.** A toast is a report, not a surface: it used to swallow taps on
 * whatever it covered — the theme button, a dialog's ✕ — for its whole dwell. Only an
 * explicit `action` takes pointer events.
 *
 * **One copy of a message.** Raising a toast identical to one on screen restarts that one's
 * reading time instead of stacking a second; at most three are on screen, the oldest
 * leaving early for a newer one.
 *
 * **Two live regions, present from mount.** An announcement needs its region in the
 * document before its content changes, so the regions are rendered empty and never swapped:
 * errors go to the assertive one, everything else waits its turn in the polite one. The
 * painted toast is `aria-hidden` apart from its action, which is described by the message.
 */
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!mounted) return;
    const listener: ToastListener = (toast) => {
      setToasts((prev) => {
        const same = prev.find(
          (item) =>
            !item.leaving &&
            item.type === toast.type &&
            item.message === toast.message &&
            item.action?.label === toast.action?.label,
        );
        if (same) {
          return prev.map((item) =>
            item === same
              ? { ...item, action: toast.action, duration: toast.duration, version: item.version + 1 }
              : item,
          );
        }
        const next = [...prev, { ...toast, version: 0, leaving: false }];
        let excess = next.filter((item) => !item.leaving).length - MAX_VISIBLE;
        return next.map((item) => {
          if (excess > 0 && !item.leaving) {
            excess -= 1;
            return { ...item, leaving: true };
          }
          return item;
        });
      });
    };
    return subscribeToasts(listener);
  }, [mounted]);

  const handleGone = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (!mounted) return null;

  const region = (urgent: boolean) =>
    toasts
      .filter((toast) => (toast.type === 'error') === urgent)
      .map((toast) => (
        // Re-keyed per raise, so a repeated message is announced again.
        <p key={`${toast.id}:${toast.version}`} id={`toast-${toast.id}`}>
          {toast.message}
        </p>
      ));

  return createPortal(
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="false">
        {region(false)}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="false">
        {region(true)}
      </div>
      <div
        className="pointer-events-none fixed inset-x-4 z-toast mx-auto flex w-fit max-w-140 flex-col items-center"
        style={{ top: 'calc(var(--app-chrome-bottom, 4rem) + 0.5rem)' }}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onGone={handleGone} />
        ))}
      </div>
    </>,
    document.body,
  );
}

/** The stack closes up this long into the card's FastEffects fade (ms at the default speed), with
 *  the card about two thirds gone, so the gap closes behind it rather than under it. A lag
 *  between two parts of one gesture, not a duration, so it is not a step on the scale. */
const COLLAPSE_LAG_MS = 40;

function ToastItem({ toast, onGone }: { toast: ToastMessage; onGone: (id: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const running = useRef<Animation[]>([]);
  const leaving = useRef(false);
  /** The action is hovered or focused: the reading time waits. */
  const [held, setHeld] = useState(false);

  /* A **layout** effect, because `enter` carries a backwards fill: created in a
     passive effect the browser paints the card at its CSS resting position first
     and only then snaps it back to the start of the slide — one frame of the
     settled toast. `components/Reveal.tsx` records the same choice. */
  useLayoutEffect(() => {
    const card = wrapRef.current?.firstElementChild as HTMLElement | null;
    const tier = motionTier('overlay');
    if (!card || tier === 'off') return;
    /* A short drop from under the app bar, with the shared small travel under reduced
       motion. Only the arrival owns these frames. A toast is a small surface, so it arrives as
       the menu and an in-place swap do (`MENU_TRANSITION.enter`, 200ms standard decelerate) —
       on the large surfaces' 400ms it took twice as long to arrive as the menu beside it, and
       leaving on FastEffects it was the only small surface with a 4:1 enter/leave ratio. */
    const enter = card.animate(
      [
        { transform: `translateY(${-(tier === 'reduced' ? TRAVEL_PX.small : TRAVEL_PX.standard)}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: scaledMs(MENU_TRANSITION.enter.duration, 'overlay'), easing: MENU_TRANSITION.enter.easing, fill: 'backwards' },
    );
    running.current.push(enter);
    // The ordinary styles are the resting pose; no layer stays promoted while it is read.
    enter.finished.then(() => enter.cancel(), () => {});
    const list = running.current;
    return () => {
      for (const animation of list) animation.cancel();
    };
  }, []);

  const leave = useCallback(() => {
    const wrap = wrapRef.current;
    const card = wrap?.firstElementChild as HTMLElement | null;
    if (leaving.current) return;
    leaving.current = true;
    if (!wrap || !card || motionTier('overlay') === 'off') {
      onGone(toast.id);
      return;
    }
    /* Created when it starts, not at mount: the message can wrap to more lines, or
       the motion preference change, while it is being read. */
    const wrapHeight = wrap.offsetHeight;
    const pose = getComputedStyle(card);
    const from = { transform: pose.transform, opacity: pose.opacity };
    /* FastEffects, as every small surface leaves (the menu, the tooltip, an in-place swap): it
       starts on the frame after the dismissal. The emphasized accelerate it left on held still for
       its first 80ms. */
    const leaveTiming = springTiming('fastEffects', 'overlay');
    running.current.forEach((animation) => animation.cancel());
    const exit = card.animate([from, { transform: `translateY(${-TRAVEL_PX.small}px)`, opacity: 0 }], {
      ...leaveTiming,
      fill: 'forwards',
    });
    /* Closing the gap is the same response as the departing card. It begins 40ms into the fade,
       with the card two thirds gone, so the stack closes up behind it rather than under it. */
    const collapse = wrap.animate([{ height: `${wrapHeight}px` }, { height: '0px' }], {
      ...leaveTiming,
      delay: scaledMs(COLLAPSE_LAG_MS, 'overlay'),
      fill: 'forwards',
    });
    running.current = [exit, collapse];
    collapse.finished.then(() => onGone(toast.id), () => {});
  }, [onGone, toast.id]);

  /* Reading time is not motion, so only the entrance goes through `scaledMs`. Restarted
     by a repeat of the same message; suspended while the action is under the pointer
     or the keyboard. */
  useEffect(() => {
    if (toast.leaving) {
      leave();
      return;
    }
    if (held) return;
    const timer = setTimeout(leave, scaledMs(MENU_TRANSITION.enter.duration, 'overlay') + toast.duration);
    return () => clearTimeout(timer);
  }, [held, leave, toast.duration, toast.leaving, toast.version]);

  useEffect(
    () => () => {
      for (const animation of running.current) animation.cancel();
    },
    [],
  );

  const style = severityStyles[toast.type];

  return (
    <div ref={wrapRef} className="max-w-full overflow-hidden">
      <div
        /* M3's snackbar, by its own tokens: extra-small corner (4dp), `body-medium`
           for the message, elevation level 3, and a cap so a long sentence wraps.
           The container stays a `*-fill` tone rather than the spec's
           `inverse-surface` — the documented divergence at the top of this file:
           that role flips between schemes, so the same message would arrive as a
           dark chip or a light one depending on the theme. */
        className={cn(
          style.bg,
          'text-on-fill mb-3 flex max-w-140 min-h-12 items-center gap-3 rounded-xs py-2 pl-4 shadow-e3',
          toast.action ? 'pr-2' : 'pr-4',
        )}
      >
        <span className="shrink-0 [&>svg]:block" aria-hidden="true">
          {style.icon}
        </span>
        <span className="text-body-m min-w-0 flex-1 wrap-anywhere" aria-hidden="true">
          {toast.message}
        </span>
        {toast.action && (
          /* Hand-built rather than `Button`: the action's ink is `on-fill` on a fill
             tone, a pairing no `Button` variant carries, and a variant plus a colour
             override emits two colour utilities. Everything else is the primitives'
             vocabulary — state layer, ripple, and the ring drawn inward in the white
             every fill tone carries (the media role is that same scheme-independent
             white, and the only inward white ring the system has). */
          <button
            type="button"
            data-ripple=""
            aria-describedby={`toast-${toast.id}`}
            className="state-layer text-label-l touch-size pointer-events-auto relative h-10 shrink-0 cursor-pointer overflow-hidden rounded-full px-3 focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-on-media"
            onPointerEnter={() => setHeld(true)}
            onPointerLeave={() => setHeld(false)}
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
            onClick={() => {
              toast.action?.onClick();
              leave();
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  );
}
