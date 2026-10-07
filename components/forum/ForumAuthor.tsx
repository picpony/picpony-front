'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import RoleBadge from '@/components/RoleBadge';
import UserBadge from '@/components/UserBadge';
import type { EquippedBadge } from '@/lib/types/forum';
import { cn } from '@/lib/utils';

/** A PicPony author's level, as the profile computes it. */
export const levelOf = (experience: number) => Math.floor(Math.max(0, experience) / 100) + 1;

interface ForumAuthorProps {
  userId: number;
  username: string;
  avatar: string | null;
  role: string;
  experience: number | null;
  badges: EquippedBadge[];
  /** The line under the name: when, and anything else the context adds. */
  meta?: ReactNode;
  /** Controls at the trailing edge of the name line. */
  actions?: ReactNode;
  /** What they wrote, in the text column under the meta — aligned with the name, not the avatar. */
  children?: ReactNode;
  className?: string;
}

/**
 * Who wrote a post or a reply: the avatar, the name with the marks the original front end showed
 * beside it (role, level, up to three worn badges), and a line of meta under it.
 *
 * **One tab stop per author** (R11-007). The avatar and the name both open the profile under a
 * pointer — the picture is the bigger target — but only the name is in the tab order and the
 * accessibility tree: two stops to one place, per reply, spent 26 stops on a 13-reply thread
 * before the composer. The name's hover is an underline, not the brand ink, which as text on this
 * surface is under the contrast floor (R11-021).
 */
export default function ForumAuthor({
  userId,
  username,
  avatar,
  role,
  experience,
  badges,
  meta,
  actions,
  children,
  className,
}: ForumAuthorProps) {
  const href = `/user/${userId}`;
  return (
    <div className={cn('flex min-w-0 items-start gap-3', className)}>
      <Link href={href} scroll={false} tabIndex={-1} aria-hidden="true" className="shrink-0 rounded-full">
        <Avatar src={avatar} name={username} size={40} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex min-h-8 min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={href}
              scroll={false}
              className={cn(
                'min-w-0 truncate rounded-xs text-label-l-emphasized text-on-surface underline-offset-2',
                'hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-ring',
              )}
            >
              {username}
            </Link>
            <RoleBadge role={role} className="shrink-0" />
            {experience !== null && <Badge className="shrink-0">Lv.{levelOf(experience)}</Badge>}
            {badges.slice(0, 3).map((badge) => (
              <UserBadge key={badge.badge_name} name={badge.badge_name} color={badge.badge_color} />
            ))}
          </div>
          {actions && <div className="-me-1.5 flex shrink-0 items-center">{actions}</div>}
        </div>
        {meta && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-body-s text-on-surface-variant">{meta}</div>
        )}
        {children}
      </div>
    </div>
  );
}
