'use client';

import type { ReactNode } from 'react';
import { MdInbox } from 'react-icons/md';
import StatusView, { type StatusViewSize } from './StatusView';
import { ICON } from '@/lib/icons';

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  /** One way out — "去绑定", "去上传". Omit when there is genuinely nothing to do. */
  action?: ReactNode;
  /** Override the default tray glyph with something the screen is about. */
  icon?: ReactNode;
  size?: StatusViewSize;
  /** The whole route is this block — fill the scroller and centre. See `StatusView`. */
  fill?: boolean;
  className?: string;
}

/**
 * "There is nothing here yet." One preset over `StatusView` (its sibling is
 * `ErrorRetry`), so empty and failed share one silhouette, type scale and
 * entrance.
 *
 * The glyph defaults to a tray so a call site that forgets still shows an
 * absence rather than a rendering failure; override it where the screen has
 * something more specific to say.
 *
 * **`inline` deliberately shows no glyph.** It had a default 36px tray which,
 * with its gap, stood taller than the 120px wells this size exists for — the
 * empty state itself made them scroll. At this size the sentence *is* the empty
 * state; a call site with something better can still pass `icon`.
 */
export default function EmptyState({
  title,
  description,
  action,
  icon,
  size = 'page',
  fill = false,
  className = '',
}: EmptyStateProps) {
  return (
    <StatusView
      size={size}
      fill={fill}
      className={className}
      title={title}
      description={description}
      action={action}
      icon={icon ?? (size === 'inline' ? undefined : <MdInbox size={ICON.display} />)}
    />
  );
}
