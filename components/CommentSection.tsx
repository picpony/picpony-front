'use client';

import Link from 'next/link';
import { MdChatBubbleOutline, MdReply } from 'react-icons/md';
import Avatar from '@/components/Avatar';
import RichTextRenderer from '@/components/RichTextRenderer';
import Skeleton, { SkeletonText, SkeletonCircle } from '@/components/Skeleton';
import CommentComposer from '@/components/CommentComposer';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import type { Comment } from '@/lib/api';
import SectionHeading from '@/components/SectionHeading';
import { ICON } from '@/lib/icons';
import { formatDateTime, formatShortDateTime } from '@/lib/format';

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
  fetchComments: () => Promise<Comment[]>;
  handleReply: (comment: Comment) => void;
  handleCancelReply: () => void;
  setComments: (comments: Comment[]) => void;
}

/** Comment timestamps are secondary information in a narrow column, so they
 *  lose the year (almost always the current one) and keep the clock. The full
 *  value stays on the element's `title`. */
/** 40dp leading avatar for a comment row: one component for all three former
 *  copies (linked-with-image, unlinked-with-image, initial fallback), the face
 *  itself being `Avatar`. */
function CommentAvatar({ comment }: { comment: Comment }) {
  const face = <Avatar src={comment.avatar} name={comment.username} size={40} />;

  if (!comment.user_id) return <div className="shrink-0">{face}</div>;

  return (
    <Link
      href={
        comment.source === 'trixiebooru'
          ? `/derpi/user/${comment.user_id}`
          : `/user/${comment.user_id}`
      }
      aria-label={`查看 ${comment.username} 的个人资料`}
      scroll={false}
      className="block shrink-0 rounded-full ring-2 ring-transparent transition-ui hover:ring-primary-ink focus-visible:focus-ring"
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
  fetchComments,
  handleReply,
  handleCancelReply,
  setComments,
}: CommentSectionProps) {
  return (
    <div ref={commentsSectionRef} className="mt-8 border-t border-outline-variant pt-8">
      <SectionHeading as="h3" icon={<MdChatBubbleOutline size={ICON.standard} />} className="mb-6">
        评论 ({comments.length})
      </SectionHeading>

      {/* 评论编辑器 */}
      <div className="mb-8 flex gap-3" id="comment-editor-area">
        <div ref={commentEditorMountRef} className="flex-1">
          <CommentComposer
            key={imageId}
            imageId={imageId}
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
           section to one line and then snapped the full list in. */
        <div>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="m3-row bg-surface-container-low flex gap-4 p-4">
              <SkeletonCircle size={40} delay={i * 120} />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-28" delay={i * 120 + 60} />
                <SkeletonText lines={2} delay={i * 120 + 120} />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length > 0 ? (
        <div>
          {comments.map((comment) => (
            <article
              key={`${comment.source}-${comment.id}`}
              /* A grouped list, not a stack of floating cards: `m3-row`
             (globals.css) is the app's shape for "a run of related rows" —
             large outer corners, every cut edge inside it at the small step, a
             2px seam between. The tone is the plain `surface-container-low`
             step, no alpha on top of it. */
              className="m3-row bg-surface-container-low flex gap-3 p-3 sm:gap-4 sm:p-4"
            >
              <CommentAvatar comment={comment} />

              {/* Identity on top, body in the middle, actions on their own
                  line — the M3 list-item shape, and every element gets the
                  width it needs. */}
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
                    title={formatDateTime(comment.created_at)}
                    className="text-body-s text-on-surface-variant ms-auto shrink-0"
                  >
                    {formatShortDateTime(comment.created_at)}
                  </time>
                </div>

                <div className="text-on-surface-variant text-body-m break-words whitespace-pre-wrap">
                  <RichTextRenderer content={comment.body} />
                </div>

                <div className="mt-2 -ms-2">
                  <Button
                    variant="text"
                    onClick={() => handleReply(comment)}
                    icon={<MdReply />}
                  >
                    回复
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          size="inline"
          icon={<MdChatBubbleOutline size={ICON.large} />}
          title="还没有评论，来说第一句"
        />
      )}
    </div>
  );
}
