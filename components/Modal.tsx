'use client';

import { useEffect, useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
  zIndex?: number;
  hideCloseButton?: boolean;
  footer?: React.ReactNode;
  closeOnOverlayClick?: boolean;
}

const CLOSE_ANIM_DURATION = 200;

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-md',
  zIndex = 100,
  hideCloseButton = false,
  footer,
  closeOnOverlayClick = true,
}: ModalProps) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [rendering, setRendering] = useState(isOpen);
  const everOpened = useRef(isOpen);

  useEffect(() => {
    if (isOpen) {
      everOpened.current = true;
      setRendering(true);
    } else if (everOpened.current) {
      const timer = setTimeout(() => {
        setRendering(false);
      }, CLOSE_ANIM_DURATION);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!mounted || !rendering) return null;

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 sm:p-6 bg-black/50 ${
        isOpen ? 'animate-modal-overlay' : 'animate-modal-overlay-out'
      }`}
      style={{ zIndex, pointerEvents: isOpen ? 'auto' : 'none' }}
      onClick={closeOnOverlayClick ? handleClose : undefined}
    >
      <div
        className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full ${maxWidth} overflow-hidden ${
          isOpen ? 'animate-modal-content' : 'animate-modal-content-out'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || !hideCloseButton) && (
          <div className="flex justify-between items-center p-6 pb-0">
            {title && (
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
                {title}
              </h3>
            )}
            {!hideCloseButton && (
              <button
                onClick={handleClose}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors ml-auto cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="p-6">{children}</div>
        {footer && (
          <div className="px-6 pb-6 flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
