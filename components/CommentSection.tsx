'use client';

import Link from 'next/link';
import { MdChatBubbleOutline, MdReply } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import RichTextRenderer from '@/components/RichTextRenderer';
import Spinner from '@/components/Spinner';
import CommentComposer from '@/components/CommentComposer';
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
    <div ref={commentsSectionRef} className="mt-8 border-t border-slate-100 pt-8 dark:border-slate-700">
      <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2">
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
        <div className="flex justify-center py-8">
          <Spinner size="lg" />
        </div>
      ) : comments.length > 0 ? (
        <div className="space-y-4">
          {comments.map((comment) => (
            <div key={`${comment.source}-${comment.id}`} className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 flex gap-4">
              {/* 头像 */}
              <div className="flex-shrink-0">
                {comment.user_id ? (
                  <Link
                    href={comment.source === 'trixiebooru' ? `/derpi/user/${comment.user_id}` : `/user/${comment.user_id}`}
                    title={`查看 ${comment.username} 的个人资料`}
                    scroll={false}
                    className="block rounded-full ring-2 ring-transparent hover:ring-primary/40 transition-all"
                  >
                    {comment.avatar ? (
                      <FadeInImage
                        src={comment.source === 'trixiebooru' ? comment.avatar : `https://picpony.top/${comment.avatar}`}
                        alt={`${comment.username}`}
                        width={40}
                        height={40}
                        className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-600"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold border border-primary/20">
                        {comment.username.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </Link>
                ) : (
                  comment.avatar ? (
                    <FadeInImage
                      src={comment.source === 'trixiebooru' ? comment.avatar : `https://picpony.top/${comment.avatar}`}
                      alt={`${comment.username}`}
                      width={40}
                      height={40}
                      className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-slate-600"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold border border-primary/20">
                      {comment.username.charAt(0).toUpperCase()}
                    </div>
                  )
                )}
              </div>

              {/* 评论正文 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                      {comment.username}
                    </span>
                    {comment.source === 'trixiebooru' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded border border-blue-200">
                        Derpibooru
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReply(comment)}
                      title="回复"
                      className="text-slate-400 hover:text-primary transition-colors p-1 rounded"
                    >
                      <MdReply size={14} />
                    </button>
                    <span className="text-xs text-slate-500">
                      {new Date(comment.created_at).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                </div>
                <div className="text-slate-600 dark:text-slate-300 text-sm whitespace-pre-wrap break-words">
                  <RichTextRenderer content={comment.body} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
          滚木
        </div>
      )}
    </div>
  );
}
