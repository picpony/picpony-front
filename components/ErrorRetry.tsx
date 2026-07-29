'use client';

import { MdErrorOutline, MdRefresh } from 'react-icons/md';
import Reveal from './Reveal';

interface ErrorRetryProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: React.ReactNode;
}

export default function ErrorRetry({
  title = '加载失败',
  message,
  onRetry,
  retryLabel = '重试',
  icon,
}: ErrorRetryProps) {
  return (
    <Reveal className="flex flex-col items-center justify-center min-h-[50vh] text-slate-500 dark:text-slate-400 px-4 text-center">
      {icon || <MdErrorOutline size={48} className="mb-4 text-slate-400 dark:text-slate-500" />}
      <h2 className="text-xl font-semibold mb-2 text-slate-700 dark:text-slate-200">{title}</h2>
      {message && (
        <div className="mb-6 max-w-md">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{message}</p>
        </div>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          data-ripple
          className="flex items-center px-4 py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 hover:shadow-md hover:shadow-primary/25 transition-all duration-200 active:scale-95 cursor-pointer group"
        >
          <MdRefresh size={20} className="mr-2 group-hover:rotate-180 transition-transform duration-500 ease-[var(--ease-standard)]" />
          <span>{retryLabel}</span>
        </button>
      )}
    </Reveal>
  );
}
