'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, ForumPostDetail, ForumComment } from '@/lib/api';
import {
  MdErrorOutline,
  MdThumbUp,
  MdOutlineThumbUp,
  MdComment,
  MdVisibility,
  MdSend,
  MdContentCopy,
  MdReply,
  MdLogin,
  MdClose,
} from 'react-icons/md';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });
import RichTextRenderer from '@/components/RichTextRenderer';
import FadeInImage from '@/components/FadeInImage';
import { showToast } from '@/components/Toast';
import Pagination from '@/components/Pagination';
import Skeleton, { SkeletonCircle, SkeletonText } from '@/components/Skeleton';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import PageBack from '@/components/PageBack';
import RoleBadge from '@/components/RoleBadge';
import Avatar from '@/components/Avatar';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { useEscapeBack } from '@/lib/hooks';
import { useAuthModal } from '@/components/AuthModal';
import { readForumOrigin, playForumContainerTransform } from '@/lib/forumTransition';
import { scrollAppToElement } from '@/lib/motion';
import SectionHeading from '@/components/SectionHeading';

export default function ForumPostPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openAuth } = useAuthModal();
  const id = params.id as string;
  const pageParam = searchParams.get('page');
  const initialPage = pageParam ? parseInt(pageParam, 10) : 1;

  const [post, setPost] = useState<ForumPostDetail | null>(null);
  const [comments, setComments] = useState<ForumComment[]>([]);
  const [page, setPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isLikeLoading, setIsLikeLoading] = useState(false);

  // Reply state
  const [replyTo, setReplyTo] = useState<{
    userId: number;
    username: string;
    commentId: number;
    text: string;
  } | null>(null);

  useEffect(() => {
    const checkLoginStatus = () => {
      const userInfo = localStorage.getItem('user_info');
      setIsLoggedIn(!!userInfo);
    };

    checkLoginStatus();
    window.addEventListener('user_info_updated', checkLoginStatus);
    return () => window.removeEventListener('user_info_updated', checkLoginStatus);
  }, []);

  useEffect(() => {
    let isMounted = true;
    queueMicrotask(() => {
      if (!isMounted) return;
      setIsLoading(true);
      setError(null);
    });

    api
      .getForumPostDetail(id, page)
      .then((res) => {
        if (isMounted) {
          setPost(res.post);
          setComments(res.comments);
          setTotalPages(res.total_pages);
          setIsLiked(res.post.is_liked === 1);
          setLikeCount(res.post.like_count);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [id, page, retryCount]);

  const handleToggleLike = useCallback(async () => {
    const userInfoStr = localStorage.getItem('user_info');
    if (!userInfoStr) {
      setSubmitError('请先登录');
      return;
    }
    setIsLikeLoading(true);
    try {
      const userInfo = JSON.parse(userInfoStr);
      const res = await api.toggleForumPostLike(userInfo.token, parseInt(id));
      const data = await res.json();
      if (data.success) {
        setIsLiked(data.is_liked === 1);
        setLikeCount(data.like_count);
      }
    } catch (err) {
      console.error('Toggle like error:', err);
    } finally {
      setIsLikeLoading(false);
    }
  }, [id]);

  const handleCopyLink = useCallback(() => {
    const shareUrl = `${window.location.origin}/forum/${id}`;
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        showToast('分享链接已复制到剪贴板！', 'success');
      })
      .catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = shareUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showToast('分享链接已复制到剪贴板！', 'success');
      });
  }, [id]);

  /* Back goes back, not to `/forum`.
   *
   * Most arrivals here are from the home page's forum tab (`/?tab=forum`),
   * which is a different route from `/forum`; pushing the latter left you on a
   * list you had never visited, one entry deeper in the history, with the tab
   * you came from still behind you. Popping returns you to whichever list it
   * actually was, with its scroll and page intact. The push is only for a cold
   * entry — a shared link, a new tab — where there is nothing to pop. */
  const handleBack = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push('/?tab=forum');
  }, [router]);

  /* Escape leaves, as on every other full-screen view. Stood down while a reply
     is being composed: there the key belongs to cancelling the reply, which the
     composer handles, and losing a half-written comment to a stray press is a
     worse failure than having to reach for the button. */
  useEscapeBack(handleBack, !replyTo);

  /* Container transform: grow the post's card out of the row that was pressed.
   *
   * A ref callback rather than an effect, for both of its properties. It runs
   * in the commit's mutation phase, so the card is put back at the row's
   * rectangle before anything paints — an effect would let one frame through
   * with it already full size, which is the flash. And it fires when the
   * *node* attaches, which is the part that actually matters here: the card is
   * mounted by the loading branch below, within a frame of the navigation,
   * while `post` does not arrive for a few hundred ms. Keying on the post
   * would start the flight from a rectangle the page had long since scrolled
   * past — measured, it simply never ran.
   *
   * Re-entrant on purpose: `readForumOrigin` does not destroy the rect, so the
   * remount React simulates in development kills the first flight and plays
   * the second, rather than losing both. */
  const cardBodyRef = useRef<HTMLDivElement>(null);
  const cardRef = useCallback(
    (card: HTMLDivElement | null) => {
      if (!card) return;
      const origin = readForumOrigin(id);
      if (!origin) return;
      return playForumContainerTransform(card, cardBodyRef.current, origin);
    },
    [id],
  );

  const handleReplyTo = useCallback(
    (userId: number, username: string, commentId: number, text: string) => {
      if (!isLoggedIn) {
        setSubmitError('请先登录');
        return;
      }
      setReplyTo({ userId, username, commentId, text });
      /* One easing for every scroll in the app. `scrollIntoView({ behavior:
         'smooth' })` used the browser's own curve, which is not `--ease-scroll`
         and is not the curve pagination or "back to top" use — so the same page
         glided three different ways depending on which control you pressed.
         The timeout stays: the editor is only mounted once `replyTo` commits, so
         there is nothing to scroll to on this tick. */
      setTimeout(() => {
        scrollAppToElement(document.getElementById('comment-input-area'), { offset: 72 });
      }, 100);
    },
    [isLoggedIn],
  );

  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage >= 1 && newPage <= totalPages) {
        setPage(newPage);
        router.push(`/forum/${id}?page=${newPage}`);
      }
    },
    [id, totalPages, router],
  );

  const handleSubmitComment = useCallback(async () => {
    if (!newComment.trim() || isSubmitting) return;

    const userInfoStr = localStorage.getItem('user_info');
    if (!userInfoStr) {
      setSubmitError('请先登录');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      const userInfo = JSON.parse(userInfoStr);

      // Build final content with reply quote prefix
      let finalContent = newComment;
      if (replyTo) {
        const cleanText = replyTo.text
          .replace(/\[quote=.*?\][\s\S]*?\[\/quote\]/gi, '')
          .replace(/<[^>]+>/g, '')
          .trim()
          .substring(0, 100);
        finalContent = `[quote="${replyTo.username}"]\n${cleanText}\n[/quote]\n\n${newComment}`;
      }

      const res = await api.createForumComment(
        userInfo.token,
        parseInt(id),
        finalContent,
        replyTo?.userId,
        replyTo?.commentId,
      );
      const data = await res.json();

      if (data.success) {
        setNewComment('');
        setReplyTo(null); // Clear reply state
        setRetryCount((c) => c + 1); // Reload comments
      } else {
        setSubmitError(data.message || '发送评论失败');
      }
    } catch (err) {
      setSubmitError('发送评论失败，请稍后重试');
      console.error('Failed to submit comment:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [id, newComment, isSubmitting, replyTo]);

  /* The loading state is the destination's own layout, not a separate page:
     same wrapper, same back button, same card, so React reuses those DOM nodes
     when the post lands instead of unmounting them. The card is what the
     container transform above is attached to, and that flight starts on the
     navigation — a remount half way through would kill it. It also means there
     is a way back out while the request is in flight, which there was not. */
  if (isLoading) {
    return (
      <>
        <PageBack onClick={handleBack} title="返回论坛 (Esc)" label="返回论坛" />
        <div className="max-w-4xl mx-auto pt-14">
          <div ref={cardRef} className="bg-surface-container-lowest p-4 sm:p-6 rounded-md mb-8">
            <div ref={cardBodyRef}>
              <Skeleton className="h-8 w-3/4 mb-4" />
              <div className="mb-6 flex items-center gap-3 border-b border-outline-variant pb-4">
                <SkeletonCircle size={40} />
                <Skeleton className="h-4 w-32" />
              </div>
              <SkeletonText lines={3} delay={120} />
            </div>
          </div>
        </div>
      </>
    );
  }

  if (error || !post) {
    /* `PageBack` here too, which is the point: the loading and loaded states
       both draw it, so without it the top-left affordance vanished the moment a
       post failed to load and reappeared on retry. The old layout compensated
       with a 返回 button in the middle of the screen — a second back affordance,
       in a different place, for the one state where the first one was missing.
       Now the chrome is identical across all three states and the error block
       only owns the thing that is actually specific to it. */
    return (
      <>
        <PageBack onClick={handleBack} title="返回论坛 (Esc)" label="返回论坛" />
        <div className="mx-auto max-w-4xl pt-14">
          <ErrorRetry
            title="帖子加载失败"
            message={error?.message || '帖子不存在'}
            onRetry={() => setRetryCount((c) => c + 1)}
          />
        </div>
      </>
    );
  }

  return (
    <>
      {/* Leading navigation, same affordance and same pixel as every other
          full-screen view — see `components/PageBack.tsx`, including why it
          sits outside the centred wrapper. */}
      <PageBack onClick={handleBack} title="返回论坛 (Esc)" label="返回论坛" />
      <div className="max-w-4xl mx-auto pt-14">
        <div ref={cardRef} className="bg-surface-container-lowest p-4 sm:p-6 rounded-md mb-8">
          <div ref={cardBodyRef}>
            <h1 className="text-title-l sm:text-headline-s text-on-surface mb-4">{post.title}</h1>
            {/* `flex-wrap` plus `min-w-0` on the author block: with neither, the
            stats on the right refuse to shrink, the author block is crushed to
            a few px, and a CJK username — which may break between any two
            characters — wraps one character per line. */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-outline-variant pb-4">
              <div className="flex min-w-0 items-center gap-3">
                <Link href={`/user/${post.user_id}`} className="shrink-0">
                  {/* `Avatar`. Every avatar in the forum section fell back to
                      `/img/default-avatar.png`, and that file does not exist —
                      `public/img/` holds only the emoji folder and the two
                      wordmarks. So a user without a picture got a broken image,
                      and so did anyone whose avatar the CDN failed to serve. The
                      `onError` handler "fixing" it pointed at the same missing
                      file. `Avatar` falls back to the initial and then to a
                      glyph, and resolves the host through `getAvatarUrl` instead
                      of pasting it inline. */}
                  <Avatar src={post.avatar} name={post.username} size={40} />
                </Link>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      href={`/user/${post.user_id}`}
                      className="text-label-l-emphasized text-on-surface hover:text-primary truncate transition-ui"
                    >
                      {post.username}
                    </Link>
                    {/* `lib/roles.ts` exists so that "the badge beside a
                        username is the same badge wherever you meet that user",
                        and this screen was the one that bypassed it — a
                        hand-rolled `bg-primary` at 10% with `text-primary`, uppercase
                        tracking-wider` pill, so a founder read purple on their
                        profile and brand-pink here. `uppercase tracking-wider`
                        also did nothing to a Chinese role label but widen it,
                        over a tracking token already halved for Han glyphs. */}
                    <RoleBadge role={post.role} className="shrink-0" />
                  </div>
                  <time
                    dateTime={post.created_at}
                    title={new Date(post.created_at).toLocaleString('zh-CN')}
                    className="text-body-s text-on-surface-variant mt-0.5 block truncate tabular-nums"
                  >
                    发布于{' '}
                    {new Date(post.created_at).toLocaleString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-label-l text-on-surface-variant sm:gap-4">
                <span className="flex items-center gap-1 tabular-nums" title="浏览量">
                  <MdVisibility size={16} /> {post.views}
                </span>
                <span className="flex items-center gap-1 tabular-nums" title="回复数">
                  <MdComment size={16} /> {post.reply_count}
                </span>
              </div>
            </div>
            {post.cover_image && (
              <div className="mb-8 rounded-md overflow-hidden bg-surface-container-high">
                <div className="relative w-full aspect-video sm:aspect-[2/1]">
                  <FadeInImage
                    src={`https://picpony.top${post.cover_image}`}
                    alt={post.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 896px"
                  />
                </div>
              </div>
            )}
            {/* `text-body-l`, and it is the type role that was missing rather
                than a size bump. This container carried no role at all, so its
                size and line-height came from whatever `@layer base` gives the
                body — while the replies below it are `text-body-m`. Two blocks
                of the same prose on one screen, set at two different measures,
                with no rule saying which was which. A post is an article and a
                reply is a remark; `body-l` says so, and because the rhythm in
                globals.css is expressed in `em`, the replies' paragraphs fall
                closer together on their own. */}
            <div className="text-on-surface text-body-l break-words">
              <RichTextRenderer content={post.content} />
            </div>
            {/* Action row, the same one the image detail has: unlabelled
                `IconButton`s on a centred line with an `outline-variant`
                divider. It used to be two outlined pill buttons carrying their
                own text, which made the two detail screens in this app answer
                the same question — like, share — in two different shapes. */}
            <div className="mt-8 flex items-center justify-center gap-2 border-t border-outline-variant pt-6">
              <IconButton
                onClick={handleToggleLike}
                loading={isLikeLoading}
                selected={isLiked}
                title={isLiked ? '取消点赞' : '点赞'}
                aria-label={isLiked ? '取消点赞' : '点赞'}
                icon={isLiked ? <MdThumbUp size={20} /> : <MdOutlineThumbUp size={20} />}
              />
              <span className="min-w-6 text-label-l text-on-surface-variant tabular-nums">
                {likeCount}
              </span>
              <div className="mx-1 h-6 w-px bg-outline-variant" />
              <IconButton
                onClick={handleCopyLink}
                title="复制分享链接"
                aria-label="分享"
                icon={<MdContentCopy size={20} />}
              />
            </div>
          </div>
        </div>
        <div className="mb-8">
          <SectionHeading>全部回复 ({post.reply_count})</SectionHeading>
          <div>
            {comments.length === 0 ? (
              <EmptyState
                size="pane"
                icon={<MdComment size={48} />}
                title="暂无回复"
                description="来抢下沙发吧"
              />
            ) : (
              comments.map((comment, index) => (
                <article
                  key={comment.id}
                  /* A grouped list, matching `ForumPostList` above it and the
                     image detail's comment list. Eight replies as eight
                     `rounded-md` cards on a `space-y-4` stack read as eight
                     unrelated posts; `m3-row` cuts one block of material into
                     rows, which is what a thread actually is.
                     `surface-container-low`, one step in from the post card's
                     `lowest`, so the post keeps its place as the focus and the
                     replies read as the ground under it. */
                  className="m3-row bg-surface-container-low flex gap-3 p-3 sm:gap-4 sm:p-4"
                >
                  <Link
                    href={`/user/${comment.user_id}`}
                    className="block shrink-0 self-start rounded-full ring-2 ring-transparent transition-ui hover:ring-primary focus-visible:focus-ring"
                    title={`查看 ${comment.username} 的个人资料`}
                  >
                    <Avatar src={comment.avatar} name={comment.username} size={40} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link
                        href={`/user/${comment.user_id}`}
                        className="text-label-l-emphasized text-on-surface hover:text-primary truncate transition-ui"
                      >
                        {comment.username}
                      </Link>
                      <RoleBadge role={comment.role} className="shrink-0" />
                      <span className="text-body-s text-on-surface-variant ms-auto shrink-0 tabular-nums">
                        #{(page - 1) * 20 + index + 1}
                      </span>
                    </div>
                    <div className="text-on-surface text-body-m break-words">
                      <RichTextRenderer content={comment.content} />
                    </div>
                    {/* `mt-3`, the same 12px the rhythm in globals.css puts
                        between this body's own paragraphs. At `mt-2` the row of
                        controls sat closer to the last line of the reply than
                        that line sat to the one above it, so it read as part of
                        the sentence. */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {isLoggedIn && (
                        <div className="-ms-2">
                          <Button
                            variant="text"
                            icon={<MdReply size={18} />}
                            onClick={() =>
                              handleReplyTo(
                                comment.user_id,
                                comment.username,
                                comment.id,
                                comment.content,
                              )
                            }
                          >
                            回复
                          </Button>
                        </div>
                      )}
                      <time
                        dateTime={comment.created_at}
                        title={new Date(comment.created_at).toLocaleString('zh-CN')}
                        className="text-body-s text-on-surface-variant ms-auto"
                      >
                        {new Date(comment.created_at).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
          {/* Directly under the list it pages, which is where it was not: it
              sat *below* the reply editor, so turning to page 2 of the replies
              meant scrolling past the whole rich-text composer to find the
              control and then scrolling back up to read the result. */}
          {totalPages > 1 && (
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              className="mt-6"
            />
          )}
        </div>
        {/* Comment Input */}
        <div
          id="comment-input-area"
          className="bg-surface-container-lowest p-4 sm:p-6 rounded-md mb-8"
        >
          <SectionHeading as="h3">发表回复</SectionHeading>
          {!isLoggedIn ? (
            /* `EmptyState`, which takes an action for exactly this. The
               hand-rolled block was a centred paragraph in a bordered div — the
               sixteenth silhouette for "there is nothing here for you", in a
               type scale none of the other fifteen used. */
            <EmptyState
              size="pane"
              icon={<MdLogin size={48} />}
              title="登录后才能发表回复"
              action={
                <Button variant="filled" onClick={() => openAuth('login')}>
                  去登录
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {/* Reply hint bar */}
              {replyTo && (
                <div className="bg-primary-container text-on-primary-container flex items-center justify-between gap-2 rounded-md px-4 py-2.5 text-body-m">
                  <div className="flex items-center gap-2 min-w-0">
                    <MdReply size={16} className="shrink-0" />
                    <span className="truncate">
                      回复 <strong>{replyTo.username}</strong>：
                      {/* Quieter by size, not by opacity — the same treatment
                          `CommentComposer`'s reply bar uses, so the two 回复 X
                          previews in this app finally match. */}
                      <span className="ml-1 text-body-s">                        {replyTo.text
                          .replace(/\[quote=.*?\][\s\S]*?\[\/quote\]/gi, '')
                          .replace(/<[^>]+>/g, '')
                          .trim()
                          .substring(0, 80)}
                      </span>
                    </span>
                  </div>
                  <IconButton
                    size="sm"
                    onClick={handleCancelReply}
                    title="取消回复"
                    aria-label="取消回复"
                    className="-me-1.5 shrink-0"
                    icon={<MdClose size={16} />}
                  />
                </div>
              )}
              <RichTextEditor
                value={newComment}
                onChange={setNewComment}
                placeholder={replyTo ? `回复 ${replyTo.username}...` : '写下你的回复...'}
              />
              {submitError && (
                <div className="text-error text-body-m flex items-center gap-1">
                  <MdErrorOutline size={16} />
                  {submitError}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  onClick={handleSubmitComment}
                  variant="filled"
                  loading={isSubmitting}
                  disabled={!newComment.trim()}
                  icon={<MdSend size={18} />}
                >
                  发送回复
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
