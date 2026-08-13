'use client';

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { MdCheckCircle, MdError, MdInfo, MdWarning } from 'react-icons/md';
import { gsap, useGSAP, prefersReducedMotion, DURATION } from '@/lib/motion';

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
    icon: <MdCheckCircle size={20} />,
  },
  error: {
    bg: 'bg-error-fill',
    icon: <MdError size={20} />,
  },
  info: {
    bg: 'bg-info-fill',
    icon: <MdInfo size={20} />,
  },
  warning: {
    bg: 'bg-warning-fill',
    icon: <MdWarning size={20} />,
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

  return createPortal(
    <div
      className="pointer-events-none fixed top-6 left-1/2 z-toast flex -translate-x-1/2 flex-col items-center"
      // Announced politely so a screen reader hears the result of an action
      // without interrupting whatever it is currently reading.
      role="status"
      aria-live="polite"
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

      if (prefersReducedMotion()) {
        const timer = setTimeout(() => onClose(toast.id), toast.duration);
        return () => clearTimeout(timer);
      }

      /* A snackbar's own motion is a fade plus a short slide from the edge it
         is docked to — this one is top-centre, so it comes down. No scale and
         no overshoot: the previous `spring` on `scale` made a message about a
         saved form bounce, and the bounce is the loudest thing in the frame for
         something the user did not ask to see.

         The three legs run on the three tokens: in on `decelerate` because it
         is arriving, out on `accelerate` because it is leaving, and the height
         collapse on `standard` because it begins and ends on screen. The
         collapse starts slightly before the fade finishes so the stack below
         is already closing as the card goes — sequential reads as a queue
         emptying one at a time. */
      const tl = gsap
        .timeline({ onComplete: () => onClose(toast.id) })
        .fromTo(
          card,
          { y: -16, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: DURATION.long, ease: 'decelerate' },
        )
        .to(
          card,
          { y: -8, autoAlpha: 0, duration: DURATION.short, ease: 'accelerate' },
          toast.duration / 1000,
        )
        .to(wrap, { height: 0, duration: DURATION.medium, ease: 'standard' }, '<0.08');

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
        className={`${style.bg} text-on-fill mb-3 flex min-h-12 items-center gap-3 rounded-sm px-4 py-2`}
      >
        <span className="shrink-0 [&>svg]:block" aria-hidden="true">
          {style.icon}
        </span>
        <span className="text-label-l">{toast.message}</span>
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
