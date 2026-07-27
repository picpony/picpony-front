'use client';

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { MdCheckCircle, MdError, MdInfo, MdWarning } from 'react-icons/md';
import { gsap, useGSAP, prefersReducedMotion } from '@/lib/motion';

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

export const showToast = (message: string, type: ToastType = 'success', duration: number = 3000) => {
  const id = ++toastId;
  const toast = { id, message, type, duration };
  listeners.forEach(listener => listener(toast));
};

const severityStyles: Record<ToastType, { bg: string; icon: React.ReactNode }> = {
  success: {
    bg: 'bg-green-600',
    icon: <MdCheckCircle size={22} />,
  },
  error: {
    bg: 'bg-red-600',
    icon: <MdError size={22} />,
  },
  info: {
    bg: 'bg-blue-600',
    icon: <MdInfo size={22} />,
  },
  warning: {
    bg: 'bg-amber-500',
    icon: <MdWarning size={22} />,
  },
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  useEffect(() => {
    const listener = (toast: ToastMessage) => {
      setToasts(prev => [...prev, toast]);
    };
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  const handleClose = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col pointer-events-none items-center">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onClose={handleClose} />
      ))}
    </div>,
    document.body
  );
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: (id: number) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const card = wrap.firstElementChild as HTMLElement;

    if (prefersReducedMotion()) {
      const timer = setTimeout(() => onClose(toast.id), toast.duration);
      return () => clearTimeout(timer);
    }

    // Enter with a spring drop; exit collapses the wrapper's height so the
    // remaining toasts glide up instead of jumping.
    const tl = gsap.timeline({ onComplete: () => onClose(toast.id) })
      .fromTo(card,
        { y: -24, scale: 0.9, autoAlpha: 0 },
        { y: 0, scale: 1, autoAlpha: 1, duration: 0.45, ease: 'spring' },
      )
      .to(card,
        { y: -12, scale: 0.94, autoAlpha: 0, duration: 0.3, ease: 'accelerate' },
        toast.duration / 1000,
      )
      .to(wrap, { height: 0, duration: 0.25, ease: 'standard' }, '<0.1');

    return () => { tl.kill(); };
  }, { scope: wrapRef });

  const style = severityStyles[toast.type];

  return (
    <div ref={wrapRef} className="pointer-events-auto overflow-hidden">
      <div className={`${style.bg} text-white rounded-xl shadow-lg px-5 py-2.5 mb-3 flex items-center gap-3`}>
        <span className="shrink-0">{style.icon}</span>
        <span className="font-medium text-sm">{toast.message}</span>
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
