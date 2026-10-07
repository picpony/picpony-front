'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  MdDeleteOutline,
  MdEdit,
  MdIosShare,
  MdLink,
  MdMoreVert,
  MdOutlineThumbUp,
  MdShare,
  MdThumbUp,
} from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import FadeInImage from '@/components/FadeInImage';
import IconButton from '@/components/IconButton';
import Menu, { type MenuAction } from '@/components/Menu';
import PageBack from '@/components/PageBack';
import Skeleton, { SkeletonCircle, SkeletonText } from '@/components/Skeleton';
import { showToast } from '@/components/Toast';
import { useAuthModal } from '@/components/AuthModal';
import { useConfirm } from '@/components/ConfirmDialog';
import ForumAuthor from '@/components/forum/ForumAuthor';
import ForumPostBody from '@/components/forum/ForumPostBody';
import { CategoryBadge, PinnedBadge } from '@/components/forum/ForumBadges';
import ReplyComposer, { type ReplyTarget } from '@/components/forum/ReplyComposer';
import ThreadComments, { replyElementId } from '@/components/forum/ThreadComments';
import {
  copyPostLink,
  removeComment,
  removePost,
  sendLike,
  sharePostNatively,
} from '@/components/forum/threadActions';
import { FORUM_STAFF_ROLES } from '@/lib/api/forum';
import { apiErrorMessage, isNotFound, isRetryable } from '@/lib/api/errors';
import { useBackOrParent } from '@/lib/backNavigation';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { patchListedPost, patchThreadPage } from '@/lib/forumCache';
import { playForumContainerTransform, readForumOrigin, readForumPreview, rememberForumReturn } from '@/lib/forumTransition';
import { formatCount, formatDateTime } from '@/lib/format';
import { readToken, useEscapeBack, useSession } from '@/lib/hooks';
import { useResource, SKIP } from '@/lib/resource';
import { forumThread } from '@/lib/resources';
import { useScreenStateFor } from '@/lib/screenState';
import { scrollAppToElement } from '@/lib/scrollTo';
import { searchPage } from '@/lib/searchState';
import { getAssetUrl } from '@/lib/utils';
import type { ForumComment, ForumPost, ForumPostDetailResponse } from '@/lib/types/forum';

/** Writes the page of replies into the address — a replace: a page turn is not a place Back
 *  steps through (coordinator call C1), and a reload or a shared link keeps it. */
function replacePage(id: string, page: number) {
  const params = new URLSearchParams(window.location.search);
  if (page > 1) params.set('page', String(page));
  else params.delete('page');
  const query = params.toString();
  const href = `/forum/${id}${query ? `?${query}` : ''}`;
  if (href !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', href);
}

/** The post card before anything is known about the post: its own geometry, holding the footer. */
function PostSkeleton() {
  return (
    <div data-page-loading="" aria-hidden="true">
      <Skeleton className="mb-4 h-8 w-3/4" />
      <div className="mb-6 flex items-center gap-3">
        <SkeletonCircle size={40} />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" delay={60} />
          <Skeleton className="h-3 w-44" delay={90} />
        </div>
      </div>
      <SkeletonText lines={4} delay={120} />
    </div>
  );
}

/**
 * A forum thread: the post, its replies, and the composer.
 *
 * **It opens on the list row's own copy of the post** (`readForumPreview`), so the card is
 * complete in the frame the container transform starts and only the replies wait for the network
 * (R6-037). **Nothing reads it ahead of intent**: a thread read counts a view on the server, so
 * there is no hover warm (the list warms on a press) and no page prefetch on the pager.
 *
 * Every write updates what is on screen and the list the reader returns to in place
 * (`lib/forumCache.ts`) — a like, a reply, a deleted reply or post — rather than reloading.
 */
export default function ForumThreadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const page = searchPage(useSearchParams().get('page'));
  const router = useRouter();
  const { user, token, ready } = useSession();
  const { openAuth } = useAuthModal();
  const { confirm, confirmDialog } = useConfirm();
  const handleBack = useBackOrParent('/?tab=forum');
  const titleId = useId();
  const repliesHeadingId = useId();

  /* The row's copy, read once: a preview is what the thread shows while its read is in flight. */
  const [preview] = useState(() => readForumPreview(id));
  /* Signed-in state is only known after hydration; reading before it would read twice (and
     count two views). */
  const read = useResource(forumThread, ready ? { id, page, token } : SKIP, {
    keepPrevious: `thread:${id}:${token ?? ''}`,
  });
  const data = read.data;
  const post: ForumPost | null = data?.post ?? preview;
  const failed = read.error !== undefined;
  const notFound = failed && isNotFound(read.error);

  const myId = Number(user?.id);
  const staff = typeof user?.role === 'string' && FORUM_STAFF_ROLES.has(user.role);
  const own = post !== null && Number.isSafeInteger(myId) && myId > 0 && post.user_id === myId;

  /* The composer's state that the screen needs: whether it holds anything (Esc stands down), and
     which reply it answers — kept per thread for the session, beside the words themselves. */
  const [composerDirty, setComposerDirty] = useState(false);
  const [replyTo, setReplyTo] = useScreenStateFor<ReplyTarget | null>('forum-reply-to', id, null);
  const [focusRequest, setFocusRequest] = useState(0);
  useEscapeBack(handleBack, !composerDirty && replyTo === null);

  useDocumentTitle(post?.title ? `${post.title} - PicPony` : null);

  /* ----- the container transform ----------------------------------------------------------- */

  /* A ref callback, not an effect: it runs in the commit, before paint, so the card is held
     out before a frame of it can show, while the row it was pressed in grows into it. It flies
     only when the card opens complete — from a list row's preview; a press elsewhere (a
     profile's posts) hands no copy of the post, and growing into a loading card would land on
     the wrong height. Its detach records that the card was left on screen, for the card to
     shrink back into its row (the return). */
  const cardRef = useCallback(
    (card: HTMLElement | null) => {
      if (!card) return;
      const origin = preview ? readForumOrigin(id) : null;
      const stop = origin ? playForumContainerTransform(card, origin) : null;
      return () => {
        rememberForumReturn(id, card);
        stop?.();
      };
    },
    [id, preview],
  );

  /* ----- like ------------------------------------------------------------------------------ */

  /* Optimistic, and the screen's own for the thread's life — it survives a page turn — until the
     server answers; a failure puts it back and says why (R6-039). */
  const [likeLocal, setLikeLocal] = useState<{ liked: boolean; count: number } | null>(null);
  const likeBusy = useRef(false);
  const liked = likeLocal?.liked ?? post?.is_liked ?? false;
  const likeCount = likeLocal?.count ?? post?.like_count ?? 0;

  const toggleLike = () => {
    if (!post) return;
    const session = readToken();
    if (!session) {
      openAuth('login');
      return;
    }
    if (likeBusy.current) return;
    const before = { liked, count: likeCount };
    likeBusy.current = true;
    setLikeLocal({ liked: !liked, count: Math.max(0, likeCount + (liked ? -1 : 1)) });
    void sendLike(session, post.id).then((outcome) => {
      likeBusy.current = false;
      if (readToken() !== session) return;
      if (!outcome.ok) {
        setLikeLocal(before);
        showToast(outcome.message, 'error');
        return;
      }
      const patch = { is_liked: outcome.liked, like_count: outcome.count };
      setLikeLocal({ liked: outcome.liked, count: outcome.count });
      patchThreadPage({ id, page, token: session }, (previous) => ({ ...previous, post: { ...previous.post, ...patch } }));
      patchListedPost(post.id, patch);
    });
  };

  /* ----- share ----------------------------------------------------------------------------- */

  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const [shareMenu, setShareMenu] = useState<{ native: boolean } | null>(null);
  const [sharing, setSharing] = useState(false);
  const shareItems: MenuAction[] = [
    { value: 'copy', label: '复制链接', icon: <MdLink /> },
    ...(shareMenu?.native ? [{ value: 'native', label: '分享到其他应用', icon: <MdIosShare /> }] : []),
  ];
  const onShareSelect = (value: string) => {
    setShareMenu(null);
    if (!post) return;
    setSharing(true);
    const done = () => setSharing(false);
    const run = value === 'native' ? sharePostNatively(post, readToken()) : copyPostLink(post, readToken());
    void run.then(done, done);
  };

  /* ----- edit / delete the post ------------------------------------------------------------ */

  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  /* The original front end's rule: the author edits; the author or staff delete. */
  const moreItems: MenuAction[] = [
    ...(own ? [{ value: 'edit', label: '编辑', icon: <MdEdit /> }] : []),
    ...(own || staff ? [{ value: 'delete', label: '删除', icon: <MdDeleteOutline />, destructive: true }] : []),
  ];

  const deletePost = async () => {
    const session = readToken();
    if (!session || !post) return;
    const ok = await confirm({ title: '确认删除', message: '确定要删除此帖子吗？删除后无法恢复。' });
    if (!ok) return;
    setDeletingPost(true);
    const outcome = await removePost(session, post.id);
    setDeletingPost(false);
    if (readToken() !== session) return;
    if (!outcome.ok) {
      showToast(outcome.message, 'error');
      return;
    }
    patchListedPost(post.id, null);
    showToast('已删除帖子', 'success');
    handleBack();
  };

  const onMoreSelect = (value: string) => {
    setMoreOpen(false);
    if (value === 'edit') router.push(`/forum/${id}/edit`, { scroll: false });
    else if (value === 'delete') void deletePost();
  };

  /* ----- replies --------------------------------------------------------------------------- */

  const [deletingReply, setDeletingReply] = useState<number | null>(null);
  const pendingFocus = useRef<number | null>(null);

  const changePage = useCallback(
    (next: number) => {
      replacePage(id, next);
    },
    [id],
  );

  const onReply = useCallback(
    (comment: ForumComment) => {
      if (!readToken()) {
        openAuth('login');
        return;
      }
      setReplyTo({ commentId: comment.id, userId: comment.user_id, username: comment.username, content: comment.content });
      setFocusRequest((n) => n + 1);
    },
    [openAuth, setReplyTo],
  );

  const canDeleteReply = useCallback(
    (comment: ForumComment) => staff || (Number.isSafeInteger(myId) && myId > 0 && comment.user_id === myId),
    [staff, myId],
  );

  const deleteReply = useCallback(
    async (comment: ForumComment) => {
      const session = readToken();
      if (!session) return;
      const ok = await confirm({ title: '确认删除', message: '确定要删除此回复吗？' });
      if (!ok) return;
      setDeletingReply(comment.id);
      const outcome = await removeComment(session, comment.id);
      setDeletingReply((current) => (current === comment.id ? null : current));
      if (readToken() !== session) return;
      if (!outcome.ok) {
        showToast(outcome.message, 'error');
        return;
      }
      showToast('已删除回复', 'success');
      let replies: number | null = null;
      patchThreadPage({ id, page, token: session }, (previous) => {
        const comments = previous.comments.filter((row) => row.id !== comment.id);
        const total = Math.max(0, previous.total_comments - (previous.comments.length - comments.length));
        replies = total;
        return { ...previous, comments, total_comments: total, post: { ...previous.post, reply_count: total } };
      });
      if (replies !== null) patchListedPost(Number(id), { reply_count: replies });
    },
    [confirm, id, page],
  );

  /* Sent: the last page as it now stands is written under its own key, the address follows it,
     and the new reply — the newest of the viewer's on that page — takes focus and the view. */
  const onSent = useCallback(
    (last: ForumPostDetailResponse | null, session: string) => {
      if (!last) {
        read.refresh();
        return;
      }
      forumThread.write({ id, page: last.page, token: session }, last);
      patchListedPost(last.post.id, { reply_count: last.total_comments, updated_at: last.post.updated_at });
      const viewer = Number(user?.id);
      const mine = [...last.comments].reverse().find((row) => row.user_id === viewer);
      pendingFocus.current = mine?.id ?? null;
      changePage(last.page);
    },
    [changePage, id, read, user?.id],
  );

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    const row = document.getElementById(replyElementId(target));
    if (!row) return;
    pendingFocus.current = null;
    row.focus({ preventScroll: true });
    scrollAppToElement(row, { offset: 88 });
  }, [data]);

  /* ----- the states ------------------------------------------------------------------------ */

  const back = <PageBack onClick={handleBack} />;

  if (!post && failed) {
    return (
      <>
        {back}
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col page-back-room">
          {notFound ? (
            <EmptyState
              fill
              title="帖子不存在或已被删除"
              action={
                <Button variant="tonal" onClick={handleBack}>
                  返回论坛
                </Button>
              }
            />
          ) : (
            <ErrorRetry
              fill
              title="帖子加载失败"
              message={apiErrorMessage(read.error)}
              onRetry={isRetryable(read.error) ? read.refresh : undefined}
            />
          )}
        </div>
      </>
    );
  }

  /* A preview whose thread has since gone: the row was read before it was deleted. */
  if (notFound) {
    return (
      <>
        {back}
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col page-back-room">
          <EmptyState
            fill
            title="帖子不存在或已被删除"
            action={
              <Button variant="tonal" onClick={handleBack}>
                返回论坛
              </Button>
            }
          />
        </div>
      </>
    );
  }

  const coverShown = post?.cover_image && !post.content.includes(post.cover_image) ? post.cover_image : null;
  const total = data?.total_comments ?? post?.reply_count ?? 0;

  return (
    <>
      {back}
      <div className="mx-auto w-full max-w-4xl page-back-room">
        {/* The same tone as the list row it grows out of, so the transform reads as one surface
            changing shape; a quote inside steps up from it, as it does in a reply (R6-051). */}
        <Card
          ref={cardRef}
          variant="elevated"
          padding="lg"
          className="mb-8"
          aria-labelledby={post ? titleId : undefined}
          role="article"
          /* How the return finds this card in the route's still frame of the page. */
          data-forum-card={id}
        >
          <div>
            {post ? (
              <>
                {(post.is_pinned || post.category !== 'discussion') && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {post.is_pinned && <PinnedBadge size="md" />}
                    {post.category !== 'discussion' && <CategoryBadge category={post.category} size="md" />}
                  </div>
                )}
                <div className="mb-4 flex items-start gap-2">
                  <h1 id={titleId} className="min-w-0 flex-1 text-title-l text-on-surface wrap-anywhere sm:text-headline-s">
                    {post.title}
                  </h1>
                  {moreItems.length > 0 && (
                    <>
                      <IconButton
                        ref={moreButtonRef}
                        aria-label="更多操作"
                        aria-haspopup="menu"
                        aria-expanded={moreOpen}
                        loading={deletingPost}
                        icon={<MdMoreVert />}
                        onClick={() => setMoreOpen((open) => !open)}
                        className="-me-2 -mt-1 shrink-0"
                      />
                      <Menu
                        open={moreOpen}
                        onClose={() => setMoreOpen(false)}
                        anchorRef={moreButtonRef}
                        aria-label="更多操作"
                        items={moreItems}
                        onSelect={onMoreSelect}
                      />
                    </>
                  )}
                </div>
                <ForumAuthor
                  userId={post.user_id}
                  username={post.username}
                  avatar={post.avatar}
                  role={post.role}
                  experience={post.experience}
                  badges={post.badges}
                  meta={
                    <>
                      <time dateTime={post.created_at} className="tabular-nums">
                        {formatDateTime(post.created_at)}
                      </time>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">浏览 {formatCount(post.views)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">回复 {formatCount(total)}</span>
                    </>
                  }
                  className="mb-6"
                />
                {coverShown && (
                  <div className="relative mb-6 aspect-video overflow-hidden rounded-md bg-surface-container-high sm:aspect-[2/1]">
                    <FadeInImage
                      src={getAssetUrl(coverShown)}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, 848px"
                    />
                  </div>
                )}
                {/* An article: `body-l`, and the rich-text rhythm follows in `em`. */}
                <div className="min-w-0 text-body-l text-on-surface wrap-anywhere">
                  <ForumPostBody post={post} />
                </div>
                <div className="mt-6 flex items-center gap-1 border-t border-outline-variant pt-4">
                  <IconButton
                    toggle
                    selected={liked}
                    selectedTone="tertiary"
                    aria-label="点赞"
                    icon={liked ? <MdThumbUp /> : <MdOutlineThumbUp />}
                    onClick={toggleLike}
                    className="-ms-2"
                  />
                  <span className="min-w-6 text-label-l text-on-surface-variant tabular-nums">{formatCount(likeCount)}</span>
                  <IconButton
                    ref={shareButtonRef}
                    aria-label="分享"
                    aria-haspopup="menu"
                    aria-expanded={shareMenu !== null}
                    loading={sharing}
                    icon={<MdShare />}
                    onClick={() =>
                      setShareMenu((open) => (open ? null : { native: typeof navigator.share === 'function' }))
                    }
                    className="ms-auto -me-2"
                  />
                  <Menu
                    open={shareMenu !== null}
                    onClose={() => setShareMenu(null)}
                    anchorRef={shareButtonRef}
                    aria-label="分享"
                    items={shareItems}
                    onSelect={onShareSelect}
                  />
                </div>
              </>
            ) : (
              <PostSkeleton />
            )}
          </div>
        </Card>

        {/* Below the post, nothing waits in a placeholder of a guessed height: the replies come
            with the post, and the composer with the replies, so what lands never pushes down
            something already on screen (the footer is held meanwhile). */}
        {post && (
          <ThreadComments
            headingId={repliesHeadingId}
            comments={data?.comments}
            total={total}
            page={data?.page ?? page}
            totalPages={data?.total_pages ?? 1}
            error={failed && (data === undefined || read.isPrevious) ? read.error : undefined}
            onRetry={read.refresh}
            onPageChange={changePage}
            canDelete={canDeleteReply}
            deletingId={deletingReply}
            onReply={onReply}
            onDelete={deleteReply}
            expected={post.reply_count}
          />
        )}

        {post && (data !== undefined || failed) && (
          <ReplyComposer
            threadId={id}
            postId={post.id}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onDirtyChange={setComposerDirty}
            onSent={onSent}
            focusRequest={focusRequest}
          />
        )}
      </div>
      {confirmDialog}
    </>
  );
}
