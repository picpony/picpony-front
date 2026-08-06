'use client';

import Link from 'next/link';
import { MdChatBubbleOutline, MdReply } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import RichTextRenderer from '@/components/RichTextRenderer';
import Skeleton, { SkeletonText, SkeletonCircle } from '@/components/Skeleton';
import CommentComposer from '@/components/CommentComposer';
import Button from '@/components/Button';
import type { Comment } from '@/lib/api';

interface ReplyTo {
  id: number;
  username: string;
  body: string;
}

interface CommentSectionProps {
  comments: Comment[];
  isLoadingComments: boolean;
  imageId: number;
  replyTo: ReplyTo | null;
  commentsSectionRef: React.RefObject<HTMLDivElement | null>;
  commentEditorMountRef: React.RefObject<HTMLDivElement | null>;
  shouldMountCommentEditor: boolean;
  fetchComments: () => Promise<Comment[]>;
  handleReply: (comment: Comment) => void;
  handleCancelReply: () => void;
  setComments: (comments: Comment[]) => void;
}

/** Comment timestamps are secondary information sitting next to a username in
 *  a narrow column, so they lose the year (almost always the current one) and
 *  keep the clock. The full value stays on the element's `title`. */
function formatCommentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 40dp leading avatar for a comment row.
 *
 * The same markup existed three times inside the list — linked-with-image,
 * unlinked-with-image, and the initial fallback — so a change to the ring, the
 * size or the border had to be made in three places and had already drifted. */
function CommentAvatar({ comment }: { comment: Comment }) {
  const face = comment.avatar ? (
    <FadeInImage
      src={
        comment.source === 'trixiebooru'
          ? comment.avatar
          : `https://picpony.top/${comment.avatar}`
      }
      alt=""
      width={40}
      height={40}
      shimmer={false}
      className="border-outline-variant h-10 w-10 rounded-full border object-cover"
    />
  ) : (
    <div className="bg-primary-container text-on-primary-container text-label-l-emphasized border-primary/20 flex h-10 w-10 items-center justify-center rounded-full border">
      {comment.username.charAt(0).toUpperCase()}
    </div>
  );

  if (!comment.user_id) return <div className="shrink-0">{face}</div>;

  return (
    <Link
      href={
        comment.source === 'trixiebooru'
          ? `/derpi/user/${comment.user_id}`
          : `/user/${comment.user_id}`
      }
      title={`查看 ${comment.username} 的个人资料`}
      scroll={false}
      className="hover:ring-primary/40 block shrink-0 rounded-full ring-2 ring-transparent transition-ui"
    >
      {face}
    </Link>
  );
}

export default function CommentSection({
  comments,
  isLoadingComments,
  imageId,
  replyTo,
  commentsSectionRef,
  commentEditorMountRef,
  shouldMountCommentEditor,
  fetchComments,
  handleReply,
  handleCancelReply,
  setComments,
}: CommentSectionProps) {
  return (
    <div ref={commentsSectionRef} className="mt-8 border-t border-outline-variant pt-8">
      <h3 className="text-title-m-emphasized text-on-surface mb-6 flex items-center gap-2">
        <MdChatBubbleOutline className="text-primary" size={24} />
        评论 ({comments.length})
      </h3>

      {/* 评论编辑器 */}
      <div className="mb-8 flex gap-3" id="comment-editor-area">
        <div ref={commentEditorMountRef} className="flex-1">
          <CommentComposer
            key={imageId}
            imageId={imageId}
            mounted={shouldMountCommentEditor}
            replyTo={replyTo}
            loadComments={fetchComments}
            onCancelReply={handleCancelReply}
            onCommentsLoaded={setComments}
          />
        </div>
      </div>

      {/* 评论列表 */}
      {isLoadingComments ? (
        /* Skeleton rather than a centred spinner: the spinner collapsed the
           section to one line and then snapped the full list in, so the page
           jumped by however many comments happened to load. */
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="bg-surface-container-low/50 flex gap-4 rounded-md p-4">
              <SkeletonCircle size={40} delay={i * 120} />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-28" delay={i * 120 + 60} />
                <SkeletonText lines={2} delay={i * 120 + 120} />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length > 0 ? (
        <div className="space-y-4">
          {comments.map((comment) => (
            <article
              key={`${comment.source}-${comment.id}`}
              className="bg-surface-container-low/50 flex gap-3 rounded-md p-3 sm:gap-4 sm:p-4"
            >
              <CommentAvatar comment={comment} />

              {/* The header used to be one `justify-between` row carrying the
                  name, a source badge, a reply button and a full
                  `YYYY/MM/DD HH:mm` timestamp. On a 360px screen that is four
                  competing things in ~250px, and the reply target was a 14px
                  glyph. Now: identity on top, body in the middle, actions on
                  their own line — the M3 list-item shape, and every element
                  gets the width it needs. */}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-label-l-emphasized text-on-surface truncate">
                    {comment.username}
                  </span>
                  {comment.source === 'trixiebooru' && (
                    <span className="text-label-s bg-accent-blue text-on-accent-blue rounded-xs px-1.5 py-0.5">
                      Derpibooru
                    </span>
                  )}
                  <time
                    dateTime={comment.created_at}
                    title={new Date(comment.created_at).toLocaleString('zh-CN')}
                    className="text-body-s text-on-surface-variant ms-auto shrink-0"
                  >
                    {formatCommentTime(comment.created_at)}
                  </time>
                </div>

                <div className="text-on-surface-variant text-body-m break-words whitespace-pre-wrap">
                  <RichTextRenderer content={comment.body} />
                </div>

                <div className="mt-2 -ms-2">
                  <Button
                    variant="text"
                    onClick={() => handleReply(comment)}
                    icon={<MdReply size={18} />}
                  >
                    回复
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-on-surface-variant bg-surface-container-low/50 rounded-md border border-outline-variant">
          滚木
        </div>
      )}
    </div>
  );
}
