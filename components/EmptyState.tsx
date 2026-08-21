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
 * "There is nothing here yet."
 *
 * This existed as a local `function EmptyState` inside `app/favorites/page.tsx`,
 * which is the whole problem: it was the best of the fourteen and the only one
 * no other screen could reach. The other thirteen were written inline, and
 * because each was written next to the list it belonged to, they inherited that
 * list's type roles rather than a shared one — so /user announced 暂无上传记录 in
 * `title-m` over a `body-m` line while /history used `title-m` alone and the
 * messages tabs used bare `text-on-surface-variant` with no glyph.
 *
 * The glyph defaults to a tray rather than being required. A missing icon is
 * what made three of the inline versions read as a rendering failure, and asking
 * every call site to choose one is how you get three screens with no icon.
 * Override it where the screen has something more specific to say — a bookmark
 * for a collection, a chat bubble for a thread.
 *
 * Geometry, type scale and entrance all come from `StatusView`, which
 * `ErrorRetry` also renders. Empty and failed are the same shape on purpose.
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
      icon={
        /* `inline` is a hint inside a small well; a 48px tray there is larger
           than the box it is apologising for. */
        icon ?? (size === 'inline' ? <MdInbox size={ICON.large} /> : <MdInbox size={ICON.display} />)
      }
    />
  );
}
