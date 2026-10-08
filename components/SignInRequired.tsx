'use client';

import type { ReactNode } from 'react';
import { MdLockPerson } from 'react-icons/md';
import Button from './Button';
import StatusView, { type StatusViewSize } from './StatusView';
import { useAuthModal } from './AuthModal';
import { ICON } from '@/lib/icons';

interface SignInRequiredProps {
  /** Defaults to 需要登录. */
  title?: string;
  /** What signing in unlocks here, in one short sentence — e.g. 登录后即可查看收藏。 */
  description?: ReactNode;
  /** Match the enclosure, as with `EmptyState` / `ErrorRetry`. */
  size?: StatusViewSize;
  className?: string;
}

/**
 * The signed-out state of a screen that needs an account: a `StatusView` — the
 * `EmptyState` / `ErrorRetry` silhouette, so "you are not signed in" reads as the same
 * kind of object as "nothing here" and "that failed" — with one way forward, 登录.
 *
 * **It never opens anything by itself** (owner decision 4). A gated page that opened the
 * sign-in dialog on arrival put a dialog in front of a visitor who had only followed a
 * link, and dismissing it left a page that said nothing about why it was empty. Here the
 * page states it, and the dialog opens when asked for.
 *
 * `inline` draws no glyph, like its siblings; the other sizes take the display glyph.
 */
export default function SignInRequired({
  title = '需要登录',
  description,
  size = 'page',
  className = '',
}: SignInRequiredProps) {
  const { openAuth } = useAuthModal();
  return (
    <StatusView
      size={size}
      className={className}
      title={title}
      description={description}
      icon={size === 'inline' ? undefined : <MdLockPerson size={ICON.display} />}
      action={
        <Button variant="filled" onClick={() => openAuth('login')}>
          登录
        </Button>
      }
    />
  );
}
