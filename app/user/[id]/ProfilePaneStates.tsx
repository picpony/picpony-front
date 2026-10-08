'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MdBlock, MdVisibilityOff } from 'react-icons/md';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton from '@/components/Skeleton';
import { buttonClasses } from '@/components/buttonStyles';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { ICON } from '@/lib/icons';
import type { ProfileUser } from '@/lib/types/user';
import type { ProfileTab } from '@/lib/profiles';

/** What every pane of the profile is handed. */
export interface ProfilePaneProps {
  profile: ProfileUser;
  /** The route's id — the key every tab read is scoped to. */
  id: string;
  /** The viewer is the profile's owner (known once the session is). */
  own: boolean;
  /** The session has been read: until then a pane cannot know whose view it is drawing. */
  ready: boolean;
  /** Its tab is the selected one. */
  active: boolean;
  token: string | null;
  /** The clock the page formats times against (see `ProfileContent`). */
  now: number;
}

/**
 * Whether a pane has ever been shown. A pane reads when its tab is first selected and **keeps
 * reading its key after that**: with the read gated on "selected" alone, switching away turned
 * its key to `SKIP`, its data to nothing and its content to a skeleton — while it was still on
 * screen, sliding out.
 */
export function useVisited(active: boolean): boolean {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return visited || active;
}

/** A tab the owner hides from visitors — the original front end's sentence. */
export function PaneHidden() {
  return (
    <EmptyState
      size="pane"
      icon={<MdVisibilityOff size={ICON.display} />}
      title="该用户隐藏了该内容"
    />
  );
}

/** The owner's own view of a tab they hide from visitors: the content, and a line saying so. */
export function OwnerHiddenNote({ tab }: { tab: ProfileTab }) {
  const what = { uploads: '上传记录', faves: '收藏夹', posts: '帖子', comments: '评论' }[tab];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-s text-on-surface-variant">
      <span className="flex items-center gap-1.5">
        <MdVisibilityOff size={ICON.dense} aria-hidden="true" />
        你的{what}已对其他人隐藏
      </span>
      <Link scroll={false} href="/settings" className={buttonClasses({ variant: 'text', size: 'xs' })}>
        前往设置
      </Link>
    </div>
  );
}

/**
 * A tab read that failed with nothing to show. **A refusal is the owner's answer, not a fault**
 * (`retryable: false` — a hidden folder, a privacy setting, a 403): it is an empty state carrying
 * the server's own sentence, with no 重试 that could only get the same answer (R7-020). Anything
 * else is the failure preset with the error's sentence and 重试.
 */
export function PaneFailure({ error, title, onRetry }: { error: unknown; title: string; onRetry: () => void }) {
  if (!isRetryable(error)) {
    return <EmptyState size="pane" icon={<MdBlock size={ICON.display} />} title={apiErrorMessage(error)} />;
  }
  return <ErrorRetry size="pane" title={title} message={apiErrorMessage(error)} onRetry={onRetry} />;
}

/**
 * The posts and comments lists' first-load rows: the grouped list's material, seam and 56dp
 * thumbnail, so the rows land where their placeholders stood. `data-page-loading` holds the
 * footer while it is on screen.
 */
export function ListRowsSkeleton({ rows = 5, badge = false }: { rows?: number; badge?: boolean }) {
  return (
    <div data-page-loading="">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="m3-row bg-surface-container-low p-4">
          <div className="flex items-start gap-3">
            <Skeleton className="size-14 shrink-0 rounded-sm" delay={i * 80} />
            <div className="min-w-0 flex-1">
              {badge ? (
                <div className="mb-1.5 flex h-6 items-center gap-2">
                  <Skeleton className="h-5 w-16 rounded-xs" delay={i * 80 + 40} />
                  <Skeleton className="h-3.5 w-20" delay={i * 80 + 80} />
                </div>
              ) : (
                <Skeleton className="mb-2 h-5 w-3/5" delay={i * 80 + 40} />
              )}
              <Skeleton className={badge ? 'h-5 w-3/5' : 'h-3.5 w-2/5'} delay={i * 80 + 120} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
