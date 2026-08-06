'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { MdClose, MdReply, MdSend } from 'react-icons/md';
import Button from '@/components/Button';
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
        <div className="mb-2 flex items-center gap-2 rounded-md border border-outline-variant bg-surface-container-low px-3 py-2 text-body-m text-on-surface-variant">
          <MdReply size={14} />
          <span>
            回复 <strong className="text-primary">{replyTo.username}</strong>：
          </span>
          <span className="flex-1 truncate text-body-s opacity-70">
            {replyTo.body.slice(0, 80)}
            {replyTo.body.length > 80 ? '...' : ''}
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="取消回复"
            className="ml-auto text-error transition-opacity hover:opacity-70"
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
        /* Roughly a 52px toolbar (6px padding + 40px buttons) + a 300px body +
           2×1px border. `min-h` rather than a fixed height because the toolbar
           wraps to a second row on narrow screens, and under-reserving is much
           less disruptive than over-reserving: the editor grows into the space
           instead of the page collapsing around it. */
        <div className="min-h-[354px] rounded-sm border border-outline-variant bg-surface-container-low/70" />
      )}
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          onClick={handleSubmit}
          variant="filled"
          loading={isSubmitting}
          disabled={!trimmedComment}
          icon={<MdSend size={18} />}
        >
          {isSubmitting ? '发送中...' : replyTo ? '发送回复' : '发送评论'}
        </Button>
      </div>
    </>
  );
}
