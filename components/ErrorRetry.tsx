'use client';

import { MdErrorOutline, MdRefresh } from 'react-icons/md';
import Button from '@/components/Button';
import StatusView, { type StatusViewSize } from './StatusView';
import { ICON } from '@/lib/icons';

interface ErrorRetryProps {
  title?: string;
  /** `ReactNode`, not `string` — the route boundary hangs a digest line off it. */
  message?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /**
   * Replaces the retry button, for a failure whose one useful exit is not "try
   * again" — the image detail offers 上一张, a missing profile offers the
   * original site.
   */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  /** Match the enclosure — see `StatusView`. Defaults to a whole-route block. */
  size?: StatusViewSize;
  /** The whole route is this block — fill the scroller and centre. See `StatusView`. */
  fill?: boolean;
}

/**
 * "That did not load." The sibling of `EmptyState` — both render `StatusView`,
 * so a failed list and an empty list share one silhouette, type scale and
 * entrance; only the glyph, the sentence and the retry differ.
 *
 * The refresh glyph's hover rotation is kept: it is the one motion that says
 * "this button will try again" rather than "this button will navigate", and it
 * costs nothing until the pointer arrives.
 */
export default function ErrorRetry({
  title = '加载失败',
  message,
  onRetry,
  retryLabel = '重试',
  action,
  icon,
  size = 'page',
  fill = false,
}: ErrorRetryProps) {
  return (
    <StatusView
      size={size}
      fill={fill}
      title={title}
      description={message}
      /* No glyph at `inline`, matching `EmptyState`: the two are presets over one
         `StatusView` with one silhouette, and the default tray-and-gap stood
         taller than the ~120px wells this size serves. The words are the status. */
      icon={icon ?? (size === 'inline' ? undefined : <MdErrorOutline size={ICON.display} />)}
      action={
        action ??
        (onRetry && (
          <Button
            onClick={onRetry}
            variant="filled"
            className="group"
            icon={
              <MdRefresh
                className="transition-transform duration-standard ease-[var(--ease-standard)] group-hover:rotate-180 no-motion:group-hover:rotate-0"
              />
            }
          >
            {retryLabel}
          </Button>
        ))
      }
    />
  );
}
