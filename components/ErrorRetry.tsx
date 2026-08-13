'use client';

import { MdErrorOutline, MdRefresh } from 'react-icons/md';
import Button from '@/components/Button';
import StatusView, { type StatusViewSize } from './StatusView';

interface ErrorRetryProps {
  title?: string;
  /** `ReactNode`, not `string` — the route boundary hangs a digest line off it. */
  message?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: React.ReactNode;
  /** Match the enclosure — see `StatusView`. Defaults to a whole-route block. */
  size?: StatusViewSize;
}

/**
 * "That did not load."
 *
 * The sibling of `EmptyState`, and now the same component underneath: both
 * render `StatusView`, so a failed list and an empty list have one silhouette,
 * one type scale and one entrance instead of two that were close enough to look
 * like a mistake. The only differences left are the ones that carry meaning —
 * the glyph, the sentence, and the fact that this one has something to retry.
 *
 * The rotating refresh glyph is kept: it is the one piece of motion that says
 * "this button will try again" rather than "this button will navigate", and it
 * is hung off `group-hover` so it costs nothing until the pointer arrives.
 */
export default function ErrorRetry({
  title = '加载失败',
  message,
  onRetry,
  retryLabel = '重试',
  icon,
  size = 'page',
}: ErrorRetryProps) {
  return (
    <StatusView
      size={size}
      title={title}
      description={message}
      icon={icon ?? <MdErrorOutline size={size === 'inline' ? 32 : 48} />}
      action={
        onRetry && (
          <Button
            onClick={onRetry}
            variant="filled"
            className="group"
            icon={
              <MdRefresh
                size={20}
                className="transition-transform duration-300 ease-[var(--ease-standard)] group-hover:rotate-180 motion-reduce:group-hover:rotate-0"
              />
            }
          >
            {retryLabel}
          </Button>
        )
      }
    />
  );
}
