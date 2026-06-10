'use client';

import { useEffect, useState } from 'react';

export function useMasonryColumns() {
  const [columns, setColumns] = useState(4);

  useEffect(() => {
    const updateColumns = () => {
      if (window.innerWidth < 640) setColumns(2);
      else if (window.innerWidth < 768) setColumns(2);
      else if (window.innerWidth < 1024) setColumns(3);
      else setColumns(4);
    };

    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, []);

  return columns;
}

export function useAuth() {
  const getUserInfo = (): { token: string; [key: string]: unknown } | null => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem('user_info');
      if (!stored) return null;
      return JSON.parse(stored);
    } catch {
      return null;
    }
  };

  const getToken = (): string | null => {
    const user = getUserInfo();
    return user?.token || null;
  };

  return { getUserInfo, getToken };
}

export function useModalAnimation(onClose: () => void) {
  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200);
  };

  return { isClosing, handleClose };
}

export function useTextInsertion(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  onChange: (value: string) => void
) {
  const insertText = (prefix: string, suffix: string, placeholder: string = '') => {
    if (!textareaRef.current) return;

    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = textareaRef.current.value;

    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);

    const insertText = selected
      ? `${prefix}${selected}${suffix}`
      : `${prefix}${placeholder}${suffix}`;
    const newText = `${before}${insertText}${after}`;
    onChange(newText);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        if (!selected) {
          const cursorPos = start + prefix.length;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos + placeholder.length);
        } else {
          const cursorPos = start + insertText.length;
          textareaRef.current.setSelectionRange(cursorPos, cursorPos);
        }
      }
    }, 0);
  };

  return { insertText };
}
