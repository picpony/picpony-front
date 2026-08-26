'use client';

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { MdCheckCircle, MdError, MdInfo, MdWarning } from 'react-icons/md';
import { gsap, useGSAP, DURATION } from '@/lib/motion';
import { motionScale, motionTier } from '@/lib/appearance';
import { ICON } from '@/lib/icons';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

type ToastListener = (toast: ToastMessage) => void;
const listeners: ToastListener[] = [];

let toastId = 0;

export const showToast = (
  message: string,
  type: ToastType = 'success',
  duration: number = 3000,
) => {
  const id = ++toastId;
  const toast = { id, message, type, duration };
  listeners.forEach((listener) => listener(toast));
};

/* The four severities keep the colours this app has always used — green,
   red, blue, amber — but drawn from the scheme-independent `*-fill` tokens
   rather than Tailwind's palette, so a toast is the same colour in both
   themes and its white label is guaranteed 4.5:1. An earlier pass sent `info`
   to `inverse-surface`, which is textbook M3 for a snackbar and wrong here:
   that token flips with the theme, so the same message arrived as a dark chip
   or a light one depending on the scheme. */
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

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  useEffect(() => {
    const listener = (toast: ToastMessage) => {
      setToasts((prev) => [...prev, toast]);
    };
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  const handleClose = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (!mounted) return null;

  /* An error interrupts; everything else waits its turn.
   *
   * The region was unconditionally `polite`, which is right for "已保存" and
   * wrong for "上传失败" — a failure the user needs to know about before they
   * carry on was queued behind whatever the screen reader was already saying.
   * The politeness follows the most severe message currently on screen rather
   * than being split into two regions, because the region has to be in the DOM
   * before its contents change for the announcement to be reliable, and two
   * stacked regions would have to share one column of pixels. */
  const urgent = toasts.some((toast) => toast.type === 'error');

  return createPortal(
    <div
      className="pointer-events-none fixed top-6 left-1/2 z-toast flex -translate-x-1/2 flex-col items-center"
      role="status"
      aria-live={urgent ? 'assertive' : 'polite'}
      aria-atomic="false"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={handleClose} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: (id: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const card = wrap.firstElementChild as HTMLElement;

      const tier = motionTier();
      if (tier === 'off') {
        const timer = setTimeout(() => onClose(toast.id), toast.duration);
        return () => clearTimeout(timer);
      }

      /* Reduced halves the slide rather than removing it. A snackbar docked to the top edge
         that fades in place has nothing to say about where it came from, and 8px is the same
         distance every other entrance takes under this tier. The height collapse is not
         travel of the *message* — it is the gap under it closing, so the queue reads as
         emptying rather than as jumping. */
      const reduced = tier === 'reduced';
      const slide = reduced ? -8 : -16;
      const slideOut = reduced ? -4 : -8;

      /* A snackbar's own motion is a fade plus a short slide from the edge it
         is docked to — this one is top-centre, so it comes down. No scale and
         no overshoot: the previous `spring` on `scale` made a message about a
         saved form bounce, and the bounce is the loudest thing in the frame for
         something the user did not ask to see.

         In on `decelerate` because it is arriving, out on `accelerate` because it
         is leaving. The height collapse is the *same* leg as the fade — the card
         going and the gap closing are one dismissal — so it shares the exit's clock
         and curve. It used to be 300ms on `standard` against the fade's 200ms
         `accelerate`, which left the stack below still settling 100ms after the
         message had vanished. The small negative offset stays: the gap starts
         closing just before the card is fully gone, so the queue reads as emptying
         rather than as jumping. */

      /* The dwell is wall-clock, so it has to be divided back out of the global time scale.
       *
       * `gsap.globalTimeline.timeScale(1 / motionScale())` reaches every tween in the app,
       * which is right for the two legs above and wrong for the gap between them: a snackbar's
       * duration is how long there is to *read* it, not how long it takes to arrive. Left
       * alone, a 3000ms message was on screen for 1500ms at the reduced tier and 2100ms at
       * 快速 — the tier a motion-sensitive reader is most likely to pick was the one that took
       * half the message away. A timeline position `p` is reached at wall-clock `p * scale`,
       * so `p = d / scale` lands on `d` whatever the speed. The `off` tier never gets here;
       * it uses a real `setTimeout` above, which is why dividing by a possible zero is safe. */
      const dwell = toast.duration / 1000 / motionScale();

      const tl = gsap
        .timeline({ onComplete: () => onClose(toast.id) })
        .fromTo(
          card,
          { y: slide, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: DURATION.long, ease: 'decelerate' },
        )
        .to(
          card,
          { y: slideOut, autoAlpha: 0, duration: DURATION.short, ease: 'accelerate' },
          dwell,
        )
        .to(wrap, { height: 0, duration: DURATION.short, ease: 'accelerate' }, '<0.08');

      return () => {
        tl.kill();
      };
    },
    { scope: wrapRef },
  );

  const style = severityStyles[toast.type];

  return (
    <div ref={wrapRef} className="pointer-events-auto overflow-hidden">
      <div
        /* M3's snackbar, by its own tokens: `corner-extra-small` (4dp) — not the
           8dp this had, which is the menu/text-field step — `body-medium` for the
           message rather than `label-large`, elevation level 3, and a 560dp cap
           so a long sentence wraps instead of running the width of a desktop
           window. The container stays a `*-fill` tone rather than the spec's
           `inverse-surface`, which is the documented divergence at the top of
           this file: that role flips between schemes, so the same message would
           arrive as a dark chip or a light one depending on the theme. */
        className={`${style.bg} text-on-fill mb-3 flex max-w-140 min-h-12 items-center gap-3 rounded-xs px-4 py-2 shadow-e3`}
      >
        <span className="shrink-0 [&>svg]:block" aria-hidden="true">
          {style.icon}
        </span>
        <span className="text-body-m">{toast.message}</span>
      </div>
    </div>
  );
}

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
}

export default function Toast({ message, type = 'success', duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    showToast(message, type, duration);
    const timer = setTimeout(() => {
      if (onClose) onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [message, type, duration, onClose]);

  return null;
}
