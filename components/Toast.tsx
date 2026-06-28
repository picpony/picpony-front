'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { MdClose, MdCheckCircle, MdError, MdInfo, MdWarning } from 'react-icons/md';

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
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 pointer-events-none items-center">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onClose={handleClose} />
      ))}
    </div>,
    document.body
  );
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: (id: number) => void }) {
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');

  useEffect(() => {
    // Enter animation: enter → visible after one frame
    const raf = requestAnimationFrame(() => {
      setPhase('visible');
    });

    // Schedule exit after toast duration
    const timer = setTimeout(() => {
      setPhase('exit');
    }, toast.duration);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [toast.duration]);

  // Phase 'exit' → fade out over 300ms, then remove from DOM
  useEffect(() => {
    if (phase === 'exit') {
      const timer = setTimeout(() => {
        onClose(toast.id);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [phase, toast.id, onClose]);

  const handleManualClose = () => {
    if (phase === 'exit') return;
    setPhase('exit');
  };

  let containerClasses = "pointer-events-auto transition-all duration-300 ease-in-out ";
  if (phase === 'enter') {
    containerClasses += "opacity-0 translate-y-4 scale-95";
  } else if (phase === 'visible') {
    containerClasses += "opacity-100 translate-y-0 scale-100";
  } else if (phase === 'exit') {
    containerClasses += "opacity-0 -translate-y-4 scale-95";
  }

  const style = severityStyles[toast.type];

  return (
    <div className={containerClasses}>
      <div className={`${style.bg} text-white rounded-xl shadow-lg px-5 py-2.5 flex items-center gap-3`}>
        <span className="shrink-0">{style.icon}</span>
        <span className="font-medium text-sm">{toast.message}</span>
        <button
          onClick={handleManualClose}
          className="shrink-0 ml-2 hover:opacity-80 transition-opacity"
        >
          <MdClose size={18} />
        </button>
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
