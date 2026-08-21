'use client';

import { memo } from 'react';
import { MdComment, MdVisibility, MdThumbUp, MdForum } from 'react-icons/md';
import { ForumPost } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';
import Pagination from '@/components/Pagination';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import Avatar from '@/components/Avatar';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import { rememberForumOrigin } from '@/lib/forumTransition';
import Link from 'next/link';
import Badge from '@/components/Badge';
import { ICON } from '@/lib/icons';
import { formatDate } from '@/lib/format';
import { getAssetUrl } from '@/lib/utils';

interface ForumPostListProps {
  posts: ForumPost[];
  page: number;
  totalPages: number;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  onPageChange: (newPage: number) => void;
  onPostClick: (postId: number) => void;
  className?: string;
}

export default memo(function ForumPostList({
  posts,
  page,
  totalPages,
  isLoading,
  error,
  onRetry,
  onPageChange,
  onPostClick,
  className = '',
}: ForumPostListProps) {
  if (isLoading) {
    return (
      /* Three bars and the `mb-8`, matching the row below. It stood at two bars
         inside no wrapper margin, so the placeholder row was measurably shorter than
         the row it replaced *and* `Pagination` jumped up when the posts landed. The
         real row is a title, an author line and a baseline. */
      <div className={className}>
        <div className="mb-8">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="m3-row bg-surface-container-low p-4 flex gap-4">
              <SkeletonCircle size={48} delay={i * 80} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-3/4" delay={i * 80 + 40} />
                <Skeleton className="h-4 w-1/3" delay={i * 80 + 80} />
                <Skeleton className="h-4 w-1/4" delay={i * 80 + 120} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      /* `pane`, matching the empty branch below. It defaulted to `page`, so one
         list had two silhouettes — a half-viewport block when it failed and a
         32dvh one when it was merely empty. */
      <ErrorRetry size="pane" title="帖子加载失败" message={error.message} onRetry={onRetry} />
    );
  }

  return (
    <div className={className}>
      <div className="mb-8">
        {posts.length === 0 ? (
          <EmptyState
            size="pane"
            icon={<MdForum size={ICON.display} />}
            title="暂无帖子"
            description="还没有人开过话题，来发第一个吧。"
          />
        ) : (
          posts.map((post) => {
            /* No `sm:size-4` on these glyphs. It overrode the `size` prop, so the
               icon got *smaller* on the wider viewport — 18dp down to 16 — and 16 is
               off the icon scale entirely (below 18 a Material Symbol's strokes stop
               resolving and it reads as a smudge). `dense` at both sizes. */
            const stats = (
              <>
                <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                  <MdVisibility size={ICON.dense} aria-hidden="true" />
                  <span className="sr-only">浏览量</span> {post.views}
                </span>
                <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                  <MdComment size={ICON.dense} aria-hidden="true" />
                  <span className="sr-only">回复数</span> {post.reply_count}
                </span>
                <span className="flex items-center gap-1 whitespace-nowrap tabular-nums">
                  <MdThumbUp size={ICON.dense} aria-hidden="true" />
                  <span className="sr-only">点赞数</span> {post.like_count}
                </span>
              </>
            );
            return (
              /* A `<Link>`, not a `<div onClick>`.
                 This is the forum's primary navigation and it had no `href`, no
                 `tabIndex` and no key handler, so it could not be reached by
                 keyboard at all, middle-clicked, or opened in a new tab. The
                 handler stays for `rememberForumOrigin`, which hands the pressed
                 rectangle to the detail page's container transform. */
              <Link
                key={post.id}
                href={`/forum/${post.id}`}
                scroll={false}
                onClick={(e) => {
                  e.preventDefault();
                  // The card on the detail page grows out of this rectangle.
                  rememberForumOrigin(post.id, e.currentTarget as HTMLElement);
                  onPostClick(post.id);
                }}
                data-ripple
                data-tab-row
                /* M3 grouped list row, settings-page style: one continuous cut
                 block of `bg-surface-container-low` rows with 2px seams and
                 large outer corners.

                 No entrance cascade. The rows used to fade in on a 45ms-per-row
                 stagger, which lands *on top of* the tab shared axis: switching
                 to 论坛 played a slide and a per-row fade at once, so the list
                 arrived twice. The slide already carries the arrival — an
                 entrance cascade belongs to picture content, where the wait is
                 real, not to a text list that is already in the DOM.

                 `state-layer` alone carries hover. The tone step that used to sit
                 beside it (`hover:` on the container-high role) was left behind
                 when the alpha tint was replaced, so the row ran two hover
                 treatments at once, on 150ms and 200ms. */
                className="m3-row block bg-surface-container-low p-4 cursor-pointer state-layer transition-ui focus-visible:ring-2 focus-ring"
              >
                <div className="flex gap-4">
                  <div className="shrink-0">
                    <Avatar src={post.avatar} name={post.username} size={48} />
                  </div>
                  {/* One shape, cover or no cover.
                      Three rows: the title, the author under it, and a baseline
                      carrying the date on the left and the counts on the right.
                      The middle column stretches to whatever the row is tall,
                      so `mt-auto` drops that baseline to the bottom edge of the
                      thumbnail when there is one and changes nothing when there
                      is not — which is the point. Branching on the cover gave
                      the two kinds of post visibly different anatomy; here the
                      picture only decides how tall the row is.
                      Date and counts share the baseline rather than each owning
                      a row of their own: it keeps the card to three lines, and
                      the two ends anchor the bottom the way the avatar and the
                      thumbnail anchor the top. */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      {post.is_pinned === 1 && (
                        <Badge tone="error" size="sm" className="shrink-0">
                          置顶
                        </Badge>
                      )}
                      <h2 className="text-body-l sm:text-title-m-emphasized text-on-surface truncate">
                        {post.title}
                      </h2>
                    </div>
                    {/* `on-surface-variant`, which is
                        `ListTokens.ItemSupportingTextColor`. It shared `on-surface` with
                        the headline above it, so the row's two lines carried the same ink
                        and stated no hierarchy — the title and the author read as equally
                        important. */}
                    <span className="block truncate text-body-s text-on-surface-variant sm:text-body-m">
                      {post.username}
                    </span>
                    {/* `flex-wrap` and a shrinkable stats group: with a cover
                        thumbnail the middle column is only ~168px on a 360px
                        phone, and three icon-plus-number pairs are ~164px — so
                        the date truncated to nothing and the counts were then
                        clipped by `data-ripple`'s `overflow: hidden`. The 点赞
                        count is the one that goes first, as `Pagination` drops its
                        outer page numbers for the same reason. */}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1.5 text-body-s text-on-surface-variant sm:text-body-m">
                      <span className="truncate">
                        {formatDate(post.created_at)}
                      </span>
                      <div className="flex items-center gap-3 sm:gap-4">{stats}</div>
                    </div>
                  </div>
                  {post.cover_image && (
                    <div className="shrink-0">
                      <FadeInImage
                        src={getAssetUrl(post.cover_image)}
                        alt="帖子封面"
                        width={80}
                        height={80}
                        /* 56dp and an 8dp corner:
                           `ListTokens.ItemLeadingImageWidth` / `-Height` are 56 and
                           `ItemLeadingImageExpressiveShape` is `CornerSmall`. It was
                           48dp growing to 80 with a 12dp card corner — a leading image
                           is not a card, and neither figure was on the token. */
                        className="object-cover rounded-sm size-14"
                      />
                    </div>
                  )}
                </div>
              </Link>
            );
          })
        )}
      </div>

      {totalPages > 1 && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
          className="mt-8"
        />
      )}
    </div>
  );
});
