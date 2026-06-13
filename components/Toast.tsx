'use client';

import { useState, useEffect } from 'react';
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const listener = (toast: ToastMessage) => {
      setToasts(prev => [...prev, toast]);
    };
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  const handleClose = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (!mounted) return null;

  return createPortal(
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 pointer-events-none items-center">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onClose={() => handleClose(toast.id)} />
      ))}
    </div>,
    document.body
  );
}

function ToastItem({ toast, onClose }: { toast: ToastMessage, onClose: () => void }) {
  const [state, setState] = useState<'entering' | 'entered' | 'exiting'>('entering');

  useEffect(() => {
    const enterTimer = requestAnimationFrame(() => {
      setState('entered');
    });

    const exitTimer = setTimeout(() => {
      setState('exiting');
      setTimeout(onClose, 300);
    }, toast.duration);

    return () => {
      cancelAnimationFrame(enterTimer);
      clearTimeout(exitTimer);
    };
  }, [toast.duration, onClose]);

  const handleManualClose = () => {
    if (state === 'exiting') return;
    setState('exiting');
    setTimeout(onClose, 300);
  };

  let containerClasses = "pointer-events-auto transition-all duration-300 ease-in-out ";
  if (state === 'entering') {
    containerClasses += "opacity-0 translate-y-4 scale-95";
  } else if (state === 'entered') {
    containerClasses += "opacity-100 translate-y-0 scale-100";
  } else if (state === 'exiting') {
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
