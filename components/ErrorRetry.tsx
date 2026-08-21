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
   * again" — the image detail offers 上一张, a missing Derpibooru profile offers
   * the original site. Both used to render `StatusView` directly and re-type this
   * component's glyph and default title by hand, so the two drifted apart the
   * moment either changed.
   */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  /** Match the enclosure — see `StatusView`. Defaults to a whole-route block. */
  size?: StatusViewSize;
  /** The whole route is this block — fill the scroller and centre. See `StatusView`. */
  fill?: boolean;
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
      icon={icon ?? <MdErrorOutline size={size === 'inline' ? ICON.large : ICON.display} />}
      action={
        action ??
        (onRetry && (
          <Button
            onClick={onRetry}
            variant="filled"
            className="group"
            icon={
              <MdRefresh
                size={ICON.control}
                className="transition-transform duration-200 ease-[var(--ease-standard)] group-hover:rotate-180 motion-reduce:group-hover:rotate-0"
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
