'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MdClose, MdReply, MdSend } from 'react-icons/md';
import Spinner from '@/components/Spinner';
import { showToast } from '@/components/Toast';
import { api, type Comment } from '@/lib/api';

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });

type ReplyTarget = {
  id: number;
  username: string;
  body: string;
};

type CommentComposerProps = {
  imageId: number;
  mounted: boolean;
  replyTo: ReplyTarget | null;
  loadComments: () => Promise<Comment[]>;
  onCancelReply: () => void;
  onCommentsLoaded: (comments: Comment[]) => void;
};

export default function CommentComposer({
  imageId,
  mounted,
  replyTo,
  loadComments,
  onCancelReply,
  onCommentsLoaded,
}: CommentComposerProps) {
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [editorRevision, setEditorRevision] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isMountedRef = useRef(true);
  const trimmedComment = comment.trim();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleSubmit = async () => {
    if (!trimmedComment || isSubmitting) return;

    let token: string | null = null;
    try {
      const userInfo = localStorage.getItem('user_info');
      if (userInfo) token = JSON.parse(userInfo).token || null;
    } catch (error) {
      console.error('Failed to parse user info', error);
    }

    if (!token) {
      showToast('请先登录', 'error');
      router.push('/login');
      return;
    }

    setIsSubmitting(true);
    try {
      const replyPrefix = replyTo ? `@${replyTo.username} ` : '';
      const response = await api.postComment(token, imageId, replyPrefix + comment);
      const data = await response.json();
      if (!isMountedRef.current) return;

      if (!data.success) {
        showToast(data.message || '发送失败', 'error');
        return;
      }

      showToast('评论发送成功', 'success');
      setComment('');
      setEditorRevision((revision) => revision + 1);
      onCancelReply();
      const comments = await loadComments();
      if (isMountedRef.current) onCommentsLoaded(comments);
    } catch (error) {
      console.error('Post comment error:', error);
      showToast('发送失败', 'error');
    } finally {
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  return (
    <>
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
          <MdReply size={14} />
          <span>回复 <strong className="text-primary">{replyTo.username}</strong>：</span>
          <span className="flex-1 truncate text-xs opacity-70">
            {replyTo.body.slice(0, 80)}{replyTo.body.length > 80 ? '...' : ''}
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="取消回复"
            className="ml-auto text-red-400 hover:text-red-600"
          >
            <MdClose size={16} />
          </button>
        </div>
      )}

      {mounted ? (
        <RichTextEditor
          key={editorRevision}
          value={comment}
          onChange={setComment}
          placeholder={replyTo ? `回复 @${replyTo.username}...` : '写下你的评论...'}
          disabled={isSubmitting}
        />
      ) : (
        <div className="h-[360px] rounded-xl border border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900/50" />
      )}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || !trimmedComment}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-sm font-medium text-white shadow-none transition-all hover:bg-primary/90 hover:shadow-sm disabled:bg-gray-500/10 disabled:text-gray-500/40"
        >
          {isSubmitting ? (
            <>
              <Spinner size="sm" />
              发送中...
            </>
          ) : (
            <>
              {replyTo ? '发送回复' : '发送评论'}
              <MdSend size={18} />
            </>
          )}
        </button>
      </div>
    </>
  );
}
