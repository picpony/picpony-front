'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdCheckCircleOutline, MdErrorOutline, MdInfoOutline } from 'react-icons/md';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: () => void;
}

export default function Toast({ message, type = 'success', duration = 3000, onClose }: ToastProps) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsClosing(true);
      setTimeout(onClose, 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <MdCheckCircleOutline className="w-5 h-5 text-green-500 mr-2 shrink-0" />;
      case 'error':
        return <MdErrorOutline className="w-5 h-5 text-red-500 mr-2 shrink-0" />;
      case 'info':
        return <MdInfoOutline className="w-5 h-5 text-blue-500 mr-2 shrink-0" />;
    }
  };

  const toastContent = (
    <div className="fixed top-4 left-0 right-0 z-[9999] flex justify-center pointer-events-none px-4">
      <div 
        className={`bg-white shadow-lg border border-slate-100 rounded-full px-5 py-3 flex items-center pointer-events-auto ${
          isClosing ? 'animate-toast-out' : 'animate-toast-in'
        }`}
      >
        {getIcon()}
        <span className="text-sm font-medium text-slate-700">{message}</span>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(toastContent, document.body) : null;
}
