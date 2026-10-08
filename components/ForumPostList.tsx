'use client';

import { memo, useLayoutEffect, useRef, type MouseEvent } from 'react';
import Link from 'next/link';
import { MdComment, MdThumbUp, MdVisibility } from 'react-icons/md';
import type { ForumPost } from '@/lib/types/forum';
import FadeInImage from '@/components/FadeInImage';
import Pagination from '@/components/Pagination';
import Avatar from '@/components/Avatar';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import { CategoryBadge, PinnedBadge } from '@/components/forum/ForumBadges';
import { readForumLeft, rememberForumOrigin } from '@/lib/forumTransition';
import { forumThread } from '@/lib/resources';
import { useIntentPrefetch } from '@/lib/useIntentPrefetch';
import { isPlainActivation } from '@/lib/richTextLinks';
import { forumTeaser } from '@/lib/forumText';
import { FORUM_PAGE_SIZE } from '@/lib/api/forum';
import { formatCompactDate, formatCount, formatDate, formatDateTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { cn, getAssetUrl } from '@/lib/utils';

/**
 * One row's grid: the avatar down the leading column; the title line and the teaser beside it,
 * with the cover in the trailing column beside those two; and the byline — author and date,
 * counts at the trailing edge — spanning the text *and* cover columns under them all. So the
 * counts land on the row's own trailing padding on every row, cover or not; they used to end
 * wherever the cover left the text column, jogging 72px down the list and wrapping onto a line of
 * their own on a phone (R6-021).
 *
 * The teaser holds the cover's height with the title (24 + 2 + 30 = 56), so a row is the same
 * height with a cover or without one, and the skeleton below is exactly this geometry.
 */
const ROW_GRID = 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 p-3 sm:gap-x-4 sm:p-4';
const TEASER_HEIGHT = 'min-h-[30px]';

interface ForumPostListProps {
  posts: ForumPost[];
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPrefetchPage?: (page: number) => void;
  /** The rows belong to a viewer's own read: the unread marks mean something only then. */
  signedIn: boolean;
  /** The session a thread opened from here reads with — the key its warm read must match. */
  token: string | null;
  /** A read is in flight under these rows (a page turn, a new search): dim them. */
  busy?: boolean;
  className?: string;
}

function ForumRow({ post, signedIn, token, now }: { post: ForumPost; signedIn: boolean; token: string | null; now: number | null }) {
  /* **Warmed on the press, never on a hover** — a thread read counts a view on the server, so
     warming a thread the pointer merely crossed would inflate the count. A press is followed by
     its click ~100ms later (a finger's after the tap timeout, and not at all if it becomes a
     scroll), which is the head start worth having. */
  const intent = useIntentPrefetch(() => forumThread.prefetch({ id: String(post.id), page: 1, token }));
  const unread = signedIn && post.is_unread;
  const teaser = forumTeaser(post);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    /* A modified click — a new tab, a new window — is the browser's; only a plain one flies. */
    if (!isPlainActivation(event)) return;
    rememberForumOrigin(post.id, event.currentTarget, post);
  };

  return (
    <Link
      href={`/forum/${post.id}`}
      scroll={false}
      onClick={onClick}
      onPointerDown={(event) => { if (event.button === 0) intent.onPointerDown(event); }}
      onPointerCancel={intent.onPointerCancel}
      data-forum-row={post.id}
      data-ripple=""
      className={cn(
        /* A grouped list row: one cut block of rows with seams, the state layer for hover and
           press. The ring is inset: the group clips an outset one at its seams (R11-006). No
           entrance of its own — the tab strip already carries the arrival. */
        'm3-row block bg-surface-container-low state-layer transition-ui',
        'focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset',
        ROW_GRID,
      )}
    >
      <span className="row-span-3 self-start">
        <Avatar src={post.avatar} name={post.username} size={40} />
      </span>
      <span className="col-start-2 flex min-w-0 items-center gap-1.5">
        {unread && (
          /* A mark rather than a container: a first visit has every thread unread, and a list
             of tinted rows says nothing. The weight carries it too. */
          <span className="size-2 shrink-0 rounded-full bg-primary-ink forced-mark" aria-hidden="true" />
        )}
        {post.is_pinned && <PinnedBadge />}
        {post.category !== 'discussion' && <CategoryBadge category={post.category} />}
        <span
          className={cn(
            'min-w-0 truncate text-on-surface',
            unread ? 'text-title-m-emphasized' : 'text-title-m',
          )}
        >
          {unread && <span className="sr-only">有新动态：</span>}
          {post.title}
        </span>
      </span>
      {post.cover_image && (
        <span className="col-start-3 row-span-2 row-start-1">
          <FadeInImage
            src={getAssetUrl(post.cover_image)}
            alt=""
            width={56}
            height={56}
            sizes="56px"
            /* 56dp and an 8dp corner (`ListTokens.ItemLeadingImageWidth` / `-ExpressiveShape`):
               a list image, not a card. Decorative here — the title names the row. */
            className="size-14 rounded-sm object-cover"
          />
        </span>
      )}
      {/* The slot holds the row's height; the line inside it is clamped. Clamped on the slot
          itself, the taller box showed the top of the second line under the first. */}
      <span className={cn('col-start-2 block min-w-0', TEASER_HEIGHT)}>
        <span className="line-clamp-1 text-body-m text-on-surface-variant">{teaser}</span>
      </span>
      <span className="col-span-2 col-start-2 mt-1 flex min-w-0 items-center gap-3 text-body-s text-on-surface-variant">
        <span className="min-w-0 truncate">
          {post.username}
          <span aria-hidden="true"> · </span>
          <time dateTime={post.created_at} title={formatDateTime(post.created_at)} className="tabular-nums">
            {now === null ? formatDate(post.created_at) : formatCompactDate(post.created_at, now)}
          </time>
        </span>
        <span className="ms-auto flex shrink-0 items-center gap-3 tabular-nums">
          <span className="flex items-center gap-1">
            <MdVisibility size={ICON.dense} aria-hidden="true" />
            <span className="sr-only">浏览量</span>
            {formatCount(post.views)}
          </span>
          <span className="flex items-center gap-1">
            <MdComment size={ICON.dense} aria-hidden="true" />
            <span className="sr-only">回复数</span>
            {formatCount(post.reply_count)}
          </span>
          <span className="flex items-center gap-1">
            <MdThumbUp size={ICON.dense} aria-hidden="true" />
            <span className="sr-only">点赞数</span>
            {formatCount(post.like_count)}
          </span>
        </span>
      </span>
    </Link>
  );
}

const MemoRow = memo(ForumRow);

/**
 * The forum's rows and the pager under them. What to show while there are no rows — a skeleton,
 * a failure, an empty result — is the pane's business (`components/forum/ForumPane.tsx`).
 */
export default function ForumPostList({
  posts,
  page,
  totalPages,
  onPageChange,
  onPrefetchPage,
  signedIn,
  token,
  busy = false,
  className = '',
}: ForumPostListProps) {
  const now = useNow();

  /* The row of the thread the reader has just left takes the focus back: marked for the shell's
     route landing, which prefers it to the page's heading when the navigation left the focus
     nowhere (`components/AppLayout.tsx`) — Back from a thread lands on its row, as closing a
     picture lands on its card. Never scrolled to; the restored offset owns the position. */
  const rowsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const id = readForumLeft();
    const row = id === null ? null : rowsRef.current?.querySelector<HTMLElement>(`[data-forum-row="${CSS.escape(id)}"]`);
    if (!row) return;
    row.setAttribute('data-return-focus', '');
    return () => row.removeAttribute('data-return-focus');
  }, [posts]);

  return (
    /* The pager's landing edge: a turn lands on the first row, not the top of the page. */
    <div data-pagination-anchor className={className} aria-busy={busy || undefined}>
      {/* The rows are siblings, and must stay so: the grouped list's outer corners find the
          first and last row among their siblings, and the tab lean takes each row as a block. */}
      <div
        ref={rowsRef}
        className={cn(
          'mb-8 transition-opacity duration-standard ease-[var(--ease-standard)]',
          busy ? 'pointer-events-none opacity-50' : 'opacity-100',
        )}
      >
        {posts.map((post) => (
          <MemoRow key={post.id} post={post} signedIn={signedIn} token={token} now={now} />
        ))}
      </div>
      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
          onPrefetchPage={onPrefetchPage}
          disabled={busy}
          className="mt-8"
        />
      )}
    </div>
  );
}

/**
 * The list before its first answer: a page of rows (the page size, 20) in the row's own grid,
 * with and without a cover as the real list alternates — a short skeleton let the footer land
 * mid-screen and then shoved it off when the rows arrived (CLS 0.14–0.18, R6-022).
 *
 * `data-page-loading` holds the page footer while it is on screen, and tells the tab strip's
 * lean that this pane is a placeholder: a 图库 ⇄ 论坛 switch made now slides it as one plane
 * rather than leaning rows the answer is about to replace.
 */
export function ForumListSkeleton() {
  return (
    <div data-page-loading="" aria-hidden="true" className="mb-8">
      {Array.from({ length: FORUM_PAGE_SIZE }, (_, i) => {
        const delay = Math.min(i, 6) * 80;
        const covered = i % 3 === 1;
        return (
          <div key={i} className={cn('m3-row bg-surface-container-low', ROW_GRID)}>
            <span className="row-span-3 self-start">
              <SkeletonCircle size={40} delay={delay} />
            </span>
            <span className="col-start-2 flex h-6 items-center">
              <Skeleton className="h-4 w-3/5" delay={delay + 40} />
            </span>
            {covered && (
              <span className="col-start-3 row-span-2 row-start-1">
                <Skeleton className="size-14 rounded-sm" delay={delay + 40} />
              </span>
            )}
            <span className={cn('col-start-2 flex items-start pt-1', TEASER_HEIGHT)}>
              <Skeleton className="h-3.5 w-11/12" delay={delay + 80} />
            </span>
            <span className="col-span-2 col-start-2 mt-1 flex h-[18px] items-center gap-3">
              <Skeleton className="h-3 w-28" delay={delay + 120} />
              <Skeleton className="ms-auto h-3 w-24" delay={delay + 120} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
