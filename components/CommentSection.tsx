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
 * size or the border had to be made in three places and had already drifted.
 *
 * The face itself is now `Avatar`, which is the fourth place it existed. This
 * one had its own fallback (a `primary-container` disc with a `primary/20`
 * hairline) that no other avatar in the app wore, and it re-implemented
 * `getAvatarUrl`'s host rule inline as a literal `https://picpony.top/${...}` —
 * the same duplication `Avatar`'s own doc-comment was written about. A derpi
 * avatar is already absolute and `getAvatarUrl` passes those straight through,
 * so the source branch was only ever restating that. */
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
      title={`查看 ${comment.username} 的个人资料`}
      scroll={false}
      className="block shrink-0 rounded-full ring-2 ring-transparent transition-ui hover:ring-primary focus-visible:focus-ring"
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
      <SectionHeading as="h3" icon={<MdChatBubbleOutline size={24} />} className="mb-6">
        评论 ({comments.length})
      </SectionHeading>

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
              /* A grouped list, not a stack of floating cards.
             `m3-row` (globals.css) is the app's shape for "a run of related
             rows": outer corners large, every cut edge inside it `rounded-xs`, a
             2px seam between. `ForumPostList` — the list of *threads* — already
             uses it, so a thread list read as one block of material while the
             replies inside a thread read as eight separate islands 16px apart.
             That comment in globals.css is explicit about why: "the previous 16px
             margin made each row read as its own floating card and lost the
             grouping entirely."
             The tone also drops the `/50`. An alpha on a container token is the
             hand-picked second tint the colour rules exist to prevent — it has to
             be eyeballed once per scheme, and every other `m3-row` in the app sits
             on the plain `surface-container-low` step. */
              className="m3-row bg-surface-container-low flex gap-3 p-3 sm:gap-4 sm:p-4"
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
        <EmptyState
          size="inline"
          icon={<MdChatBubbleOutline size={32} />}
          title="还没有评论，来说第一句"
        />
      )}
    </div>
  );
}
