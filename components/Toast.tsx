'use client';

import { useState, useEffect } from 'react';
import { Alert, Portal } from '@mui/material';

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

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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

  const handleClose = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <Portal>
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-3 pointer-events-none items-center">
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onClose={() => handleClose(toast.id)} />
        ))}
      </div>
    </Portal>
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

  return (
    <div className={containerClasses}>
      <Alert 
        severity={toast.type} 
        variant="filled"
        onClose={handleManualClose}
        sx={{ 
          borderRadius: '12px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          padding: '8px 24px',
          alignItems: 'center',
          '& .MuiAlert-icon': {
            padding: 0,
            marginRight: '12px'
          },
          '& .MuiAlert-message': {
            padding: 0,
            fontWeight: 500
          },
          '& .MuiAlert-action': {
            padding: 0,
            marginLeft: '12px',
            marginRight: '-8px'
          }
        }}
      >
        {toast.message}
      </Alert>
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
