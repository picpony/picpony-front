'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { MdChatBubbleOutline, MdDeleteOutline, MdReply, MdTranslate } from 'react-icons/md';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import IconButton from '@/components/IconButton';
import RichTextRenderer from '@/components/RichTextRenderer';
import Skeleton, { SkeletonCircle, SkeletonText } from '@/components/Skeleton';
import CommentComposer, { type ReplyTarget } from '@/components/CommentComposer';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import SectionHeading from '@/components/SectionHeading';
import Spinner from '@/components/Spinner';
import UserBadge from '@/components/UserBadge';
import { LoadMoreButton } from '@/components/Pagination';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { useAuthModal } from '@/components/AuthModal';
import { deleteComment } from '@/lib/api/picpony';
import { readJson } from '@/lib/api/http';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { derpiCommentTarget, derpiMarkdown, plainTextOf } from '@/lib/derpiMarkup';
import { formatCompactDateTime, formatCount, formatDate, formatDateTime } from '@/lib/format';
import { useImageComments } from '@/lib/imageComments';
import { useTextTranslation } from '@/lib/translation';
import { readToken, useNow, useSession } from '@/lib/hooks';
import { scrollAppToElement } from '@/lib/scrollTo';
import { ICON } from '@/lib/icons';
import type { Comment } from '@/lib/types/image';

export type { ReplyTarget };

interface CommentSectionProps {
  imageId: number;
  /** Derpibooru's count from the picture's record, named until the thread's own counts land. */
  derpiCount?: number;
  replyTo: ReplyTarget | null;
  onReply: (target: ReplyTarget) => void;
  onCancelReply: () => void;
  /** The composer, for the reply flow to scroll to. */
  composerRef: React.RefObject<HTMLDivElement | null>;
  /** The scroller the detail lives in (the overlay's own); `null` is the app's. */
  scrollerRef?: React.RefObject<HTMLElement | null> | null;
}

const STAFF_ROLES = new Set(['admin', 'super_admin', 'superadmin']);

/** A PicPony author's level, as the profile computes it. */
const levelOf = (experience: number) => Math.floor(Math.max(0, experience) / 100) + 1;

/** The row's key, and the anchor a reply's `@name` link scrolls to. */
const rowKey = (comment: Comment) => `${comment.source ?? 'picpony'}-${comment.id}`;

type DeleteOutcome = { ok: true } | { ok: false; message: string };

/** The deletion itself, at module scope (the React Compiler lowers no value block inside a `try`). */
async function removeComment(token: string, commentId: number): Promise<DeleteOutcome> {
  try {
    const data = await readJson<{ success?: unknown; message?: string; error?: string }>(
      await deleteComment(token, commentId),
    );
    if (data.success === true) return { ok: true };
    return { ok: false, message: data.error || data.message || '删除失败' };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '删除失败') };
  }
}

/** 40dp leading avatar for a comment row, linked to the author's profile where there is one. */
function CommentAvatar({ comment }: { comment: Comment }) {
  const face = <Avatar src={comment.avatar} name={comment.username} size={40} />;
  if (!comment.user_id) return <div className="shrink-0">{face}</div>;
  return (
    <Link
      href={comment.source === 'trixiebooru' ? `/derpi/user/${comment.user_id}` : `/user/${comment.user_id}`}
      aria-label={`查看 ${comment.username} 的个人资料`}
      scroll={false}
      className="block shrink-0 rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
    >
      {face}
    </Link>
  );
}

function CommentRow({
  comment,
  canDelete,
  deleting,
  now,
  onReply,
  onDelete,
}: {
  comment: Comment;
  canDelete: boolean;
  deleting: boolean;
  now: number | null;
  onReply: (comment: Comment) => void;
  onDelete: (comment: Comment) => void;
}) {
  const fromDerpibooru = comment.source === 'trixiebooru';
  const body = fromDerpibooru ? derpiMarkdown(comment.body) : comment.body;
  const translation = useTextTranslation(plainTextOf(comment.body), (message) => showToast(message, 'error'));
  const level = !fromDerpibooru && typeof comment.experience === 'number' ? levelOf(comment.experience) : null;
  const badges = !fromDerpibooru ? (comment.equipped_badges ?? []).slice(0, 3) : [];

  return (
    <article
      data-comment-key={rowKey(comment)}
      /* A reply's `@name` link lands focus here, so a keyboard user arrives where the eye does. */
      tabIndex={-1}
      aria-label={`${comment.username} 的评论`}
      /* A grouped list: `m3-row` is the app's shape for a run of related rows — large outer
         corners, the small step at every cut, a 2px seam between. */
      className="m3-row bg-surface-container-low flex gap-3 p-3 focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset sm:gap-4 sm:p-4"
    >
      <CommentAvatar comment={comment} />
      <div className="min-w-0 flex-1">
        {/* Who, then when and from where, with the row's actions trailing the name — the M3
            two-line list item. The actions used to be a 40dp row of their own under every
            comment, which made a one-line comment 125px tall. */}
        <div className="flex min-h-8 items-center gap-2">
          <span className="min-w-0 truncate text-label-l-emphasized text-on-surface">{comment.username}</span>
          {level !== null && <Badge className="shrink-0">Lv.{level}</Badge>}
          <div className="ms-auto flex shrink-0 items-center">
            <IconButton
              size="sm"
              toggle
              selected={translation.translation !== null}
              loading={translation.busy}
              aria-label="翻译"
              icon={<MdTranslate />}
              onClick={translation.toggle}
            />
            <IconButton size="sm" aria-label="回复" icon={<MdReply />} onClick={() => onReply(comment)} />
            {canDelete && (
              <IconButton
                size="sm"
                variant="danger-text"
                loading={deleting}
                aria-label="删除"
                icon={<MdDeleteOutline />}
                onClick={() => onDelete(comment)}
              />
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-s text-on-surface-variant">
          <time dateTime={comment.created_at} title={formatDateTime(comment.created_at)} className="tabular-nums">
            {now === null ? formatDate(comment.created_at) : formatCompactDateTime(comment.created_at, now)}
          </time>
          {fromDerpibooru && <span>来自 Derpibooru</span>}
          {badges.map((badge) => (
            <UserBadge key={badge.badge_name} name={badge.badge_name} color={badge.badge_color} />
          ))}
        </div>
        {/* `wrap-anywhere` and `min-w-0`: a comment holding one long URL used to keep its
            min-content width and push the detail's scroller sideways, which now clips. */}
        <div className="mt-1 min-w-0 text-body-m text-on-surface wrap-anywhere">
          <RichTextRenderer content={body} />
        </div>
        {translation.translation !== null && (
          <div className="mt-2 rounded-sm bg-surface-container px-3 py-2">
            <p className="text-label-m text-on-surface-variant">译文</p>
            <p className="mt-0.5 whitespace-pre-wrap text-body-m text-on-surface wrap-anywhere">
              {translation.translation}
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

/** Three rows in the row's own geometry: avatar, a name line with its actions, a meta line, text. */
function CommentRowsSkeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="m3-row bg-surface-container-low flex gap-3 p-3 sm:gap-4 sm:p-4">
          <SkeletonCircle size={40} delay={i * 120} />
          <div className="min-w-0 flex-1">
            <div className="flex min-h-8 items-center gap-2">
              <Skeleton className="h-3.5 w-28" delay={i * 120 + 60} />
            </div>
            <Skeleton className="h-3 w-20" delay={i * 120 + 90} />
            <SkeletonText lines={2} className="mt-1 py-1" delay={i * 120 + 120} />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A picture's comments: PicPony's own and Derpibooru's, in one thread, newest first
 * (`useImageComments`), with the composer above them.
 *
 * The thread loads when the section comes within reach of the viewport — observed through a
 * callback ref, because the section mounts *after* the observer's first chance to look on a
 * direct load (it only existed once the body had) and a one-shot effect never looked again: on
 * a reloaded `/pic/:id` the comments never loaded at all (R4-001).
 *
 * Each source fails on its own terms — "no comments" is said only when both answered with none —
 * and Derpibooru's older pages load on request. A reply's `@name` link to a comment that is on
 * screen scrolls to it instead of leaving for Derpibooru.
 */
export default function CommentSection({
  imageId,
  derpiCount,
  replyTo,
  onReply,
  onCancelReply,
  composerRef,
  scrollerRef = null,
}: CommentSectionProps) {
  const headingId = useId();
  const session = useSession();
  const { openAuth } = useAuthModal();
  const { confirm, confirmDialog } = useConfirm();
  const now = useNow();
  const listRef = useRef<HTMLDivElement>(null);

  /* Within reach, per picture: a step to the next picture keeps this section mounted. */
  const [reachedFor, setReachedFor] = useState<number | null>(null);
  const observe = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          setReachedFor(imageId);
          observer.disconnect();
        },
        { rootMargin: '160px' },
      );
      observer.observe(node);
      return () => observer.disconnect();
    },
    [imageId],
  );
  const enabled = reachedFor === imageId;
  const thread = useImageComments(imageId, enabled);

  /* Back online: a source that failed for want of a network tries again by itself. */
  const siteRetry = thread.site.retry;
  const derpiRetry = thread.derpi.retry;
  const siteFailed = thread.site.error !== undefined;
  const derpiFailed = thread.derpi.error !== undefined;
  useEffect(() => {
    if (!siteFailed && !derpiFailed) return;
    const onOnline = () => {
      if (siteFailed) siteRetry();
      if (derpiFailed) derpiRetry();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [derpiFailed, derpiRetry, siteFailed, siteRetry]);

  const myId = Number(session.user?.id);
  const isStaff = typeof session.user?.role === 'string' && STAFF_ROLES.has(session.user.role);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleReply = (comment: Comment) => {
    if (!readToken()) {
      openAuth('login');
      return;
    }
    onReply({
      id: comment.id,
      username: comment.username,
      body: comment.body,
      source: comment.source ?? 'picpony',
      userId: comment.source === 'picpony' ? comment.user_id : null,
    });
  };

  const handleDelete = (comment: Comment) => {
    void confirm({ title: '确认删除', message: '确定要删除此评论吗？', tone: 'danger' }).then((confirmed) => {
      const token = readToken();
      if (!confirmed || !token) return;
      setDeletingId(comment.id);
      void removeComment(token, comment.id).then((outcome) => {
        setDeletingId(null);
        if (!outcome.ok) {
          showToast(outcome.message, 'error');
          return;
        }
        thread.removeSiteComment(comment.id);
        showToast('已删除评论', 'success');
      });
    });
  };

  /* A reply's `@name` link names a comment on Derpibooru; when that comment is on screen here,
     go to it rather than to Derpibooru (a modified click still opens the link). */
  const handleThreadClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest?.('a[href]');
    const target = derpiCommentTarget(anchor?.getAttribute('href'));
    if (!target || target.imageId !== imageId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-comment-key="trixiebooru-${target.commentId}"]`);
    if (!row) return;
    event.preventDefault();
    scrollAppToElement(row, { scroller: scrollerRef?.current ?? undefined });
    row.focus({ preventScroll: true });
  };

  /* Every comment there is: Derpibooru's total (the thread's own once its first page is in, the
     record's until then, and still the record's if the list failed) plus PicPony's. */
  const derpiPart = thread.derpi.total ?? (typeof derpiCount === 'number' ? derpiCount : null);
  const known = derpiPart === null && thread.site.count === null ? null : (derpiPart ?? 0) + (thread.site.count ?? 0);
  const bothFailed = siteFailed && derpiFailed;
  const failure = thread.derpi.error ?? thread.site.error;
  const loading = !enabled || !thread.shown;

  return (
    <section ref={observe} aria-labelledby={headingId} className="mt-8 border-t border-outline-variant pt-8">
      <SectionHeading as="h2" id={headingId} icon={<MdChatBubbleOutline size={ICON.standard} />} className="mb-6">
        {known === null ? '评论' : `评论（${formatCount(known)}）`}
      </SectionHeading>

      <div ref={composerRef} className="mb-6">
        <CommentComposer
          imageId={imageId}
          replyTo={replyTo}
          onCancelReply={onCancelReply}
          onPosted={thread.refreshSite}
        />
      </div>

      {loading ? (
        /* The row's own geometry rather than a centred spinner, which collapsed the section to
           one line and then snapped the list in. */
        <CommentRowsSkeleton />
      ) : bothFailed ? (
        <ErrorRetry
          size="inline"
          title="评论加载失败"
          message={apiErrorMessage(failure)}
          onRetry={
            isRetryable(thread.site.error) || isRetryable(thread.derpi.error)
              ? () => {
                  siteRetry();
                  derpiRetry();
                }
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {siteFailed && (
            <ErrorRetry
              size="inline"
              title="本站评论加载失败"
              message={apiErrorMessage(thread.site.error)}
              onRetry={isRetryable(thread.site.error) ? siteRetry : undefined}
            />
          )}
          {thread.comments.length > 0 ? (
            <div ref={listRef} onClick={handleThreadClick}>
              {thread.comments.map((comment) => (
                <CommentRow
                  key={rowKey(comment)}
                  comment={comment}
                  canDelete={
                    comment.source === 'picpony' &&
                    Boolean(session.token) &&
                    (isStaff || (Number.isFinite(myId) && comment.user_id === myId))
                  }
                  deleting={deletingId === comment.id}
                  now={now}
                  onReply={handleReply}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ) : (
            !thread.site.loading &&
            !thread.derpi.loading &&
            !siteFailed &&
            !derpiFailed && <EmptyState size="inline" title="还没有评论" />
          )}
          {thread.derpi.loading && (
            <p role="status" className="flex items-center justify-center gap-2 text-body-m text-on-surface-variant">
              <Spinner size="sm" />
              正在加载 Derpibooru 评论…
            </p>
          )}
          {thread.site.loading && (
            <p role="status" className="flex items-center justify-center gap-2 text-body-m text-on-surface-variant">
              <Spinner size="sm" />
              正在加载本站评论…
            </p>
          )}
          {derpiFailed && (
            <ErrorRetry
              size="inline"
              title="Derpibooru 评论加载失败"
              message={apiErrorMessage(thread.derpi.error)}
              onRetry={isRetryable(thread.derpi.error) ? derpiRetry : undefined}
            />
          )}
          {thread.hasMore &&
            (thread.moreError !== undefined ? (
              <ErrorRetry
                size="inline"
                title="更多评论加载失败"
                message={apiErrorMessage(thread.moreError)}
                onRetry={isRetryable(thread.moreError) ? thread.loadMore : undefined}
              />
            ) : (
              <LoadMoreButton isLoading={thread.loadingMore} onClick={thread.loadMore} />
            ))}
        </div>
      )}
      {confirmDialog}
    </section>
  );
}
