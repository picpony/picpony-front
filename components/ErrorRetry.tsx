'use client';

import { MdErrorOutline, MdRefresh } from 'react-icons/md';
import Reveal from './Reveal';
import Button from '@/components/Button';

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
    <Reveal className="flex flex-col items-center justify-center min-h-[50vh] text-on-surface-variant px-4 text-center">
      {icon || <MdErrorOutline size={48} className="mb-4 text-outline" />}
      <h2 className="text-title-l mb-2 text-on-surface">{title}</h2>
      {message && (
        <div className="mb-6 max-w-md">
          <p className="text-body-m text-on-surface-variant mb-1">{message}</p>
        </div>
      )}
      {onRetry && (
        <Button
          onClick={onRetry}
          variant="filled"
          className="group"
          icon={
            <MdRefresh
              size={20}
              className="transition-transform duration-500 ease-[var(--ease-standard)] group-hover:rotate-180"
            />
          }
        >
          {retryLabel}
        </Button>
      )}
    </Reveal>
  );
}
