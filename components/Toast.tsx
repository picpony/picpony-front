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
import { DURATION, EASE } from '@/lib/motionTokens';
import { motionTier, scaledMs } from '@/lib/appearance';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

/** An explicit action — the only part of a toast that takes a tap (e.g. 撤销). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Reading time in ms. Defaults to the severity's own, lengthened for a long message. */
  duration?: number;
  action?: ToastAction;
}

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
  action?: ToastAction;
  /** Bumped when an identical toast is raised again: restarts its reading time. */
  version: number;
  /** Pushed out by a newer toast before its time was up. */
  leaving: boolean;
}

type ToastListener = (toast: Omit<ToastMessage, 'version' | 'leaving'>) => void;
const listeners: ToastListener[] = [];
/** Raised before the container subscribed (a first-commit effect anywhere in the tree). */
const pending: Array<Omit<ToastMessage, 'version' | 'leaving'>> = [];

let toastId = 0;

/** At most this many on screen; a newer one sends the oldest away. */
const MAX_VISIBLE = 3;
/** M3's snackbar dwell runs 4–10s. A status report reads in four; a problem gets six. */
const BASE_DWELL: Record<ToastType, number> = { success: 4000, info: 4000, warning: 6000, error: 6000 };
/** Past twenty characters, each one buys this much more reading time, up to the cap. */
const PER_CHARACTER_MS = 60;
const MAX_DWELL = 10000;

function dwellFor(message: string, type: ToastType) {
  const extra = Math.max(0, Array.from(message).length - 20) * PER_CHARACTER_MS;
  return Math.min(MAX_DWELL, BASE_DWELL[type] + extra);
}

/**
 * A transient status report. `options` may be a bare duration (the former signature).
 *
 *     showToast('已保存');
 *     showToast('邮箱地址无效', 'error');
 *     showToast('已删除', 'success', { action: { label: '撤销', onClick: undo } });
 */
export const showToast = (
  message: string,
  type: ToastType = 'success',
  options?: number | ToastOptions,
) => {
  const opts = typeof options === 'number' ? { duration: options } : (options ?? {});
  const toast = {
    id: ++toastId,
    message,
    type,
    duration: opts.duration ?? dwellFor(message, type),
    action: opts.action,
  };
  if (!listeners.length) {
    pending.push(toast);
    return;
  }
  listeners.forEach((listener) => listener(toast));
};

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
    listeners.push(listener);
    // Anything raised before the container existed, in order.
    for (const toast of pending.splice(0)) listener(toast);
    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    };
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
    const tier = motionTier();
    if (!card || tier === 'off') return;
    /* A short drop from under the app bar, with the shared 8px travel under reduced
       motion. Only the arrival owns these frames. */
    const enter = card.animate(
      [
        { transform: `translateY(${tier === 'reduced' ? -8 : -16}px)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: scaledMs(DURATION.long * 1000), easing: EASE.decelerate, fill: 'backwards' },
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
    if (!wrap || !card || motionTier() === 'off') {
      onGone(toast.id);
      return;
    }
    /* Created when it starts, not at mount: the message can wrap to more lines, or
       the motion preference change, while it is being read. */
    const wrapHeight = wrap.offsetHeight;
    const pose = getComputedStyle(card);
    const from = { transform: pose.transform, opacity: pose.opacity };
    const exitMs = scaledMs(DURATION.short * 1000);
    running.current.forEach((animation) => animation.cancel());
    const exit = card.animate([from, { transform: 'translateY(-8px)', opacity: 0 }], {
      duration: exitMs,
      easing: EASE.accelerate,
      fill: 'forwards',
    });
    /* Closing the gap is the same leg as the departing card, on its clock and curve.
       It begins 80ms into the fade so the stack closes up smoothly. */
    const collapse = wrap.animate([{ height: `${wrapHeight}px` }, { height: '0px' }], {
      duration: exitMs,
      delay: scaledMs(80),
      easing: EASE.accelerate,
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
    const timer = setTimeout(leave, scaledMs(DURATION.long * 1000) + toast.duration);
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
