'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { MdClose, MdReply, MdSend } from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { useAuthModal } from '@/components/AuthModal';
import { showToast } from '@/components/Toast';
import { api, type Comment } from '@/lib/api';
import { ICON } from '@/lib/icons';
import { readToken } from '@/lib/hooks';

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), { ssr: false });

type ReplyTarget = {
  id: number;
  username: string;
  body: string;
};

type CommentComposerProps = {
  imageId: number;
  replyTo: ReplyTarget | null;
  loadComments: () => Promise<Comment[]>;
  onCancelReply: () => void;
  onCommentsLoaded: (comments: Comment[]) => void;
};

export default function CommentComposer({
  imageId,
  replyTo,
  loadComments,
  onCancelReply,
  onCommentsLoaded,
}: CommentComposerProps) {
  const { openAuth } = useAuthModal();
  const [comment, setComment] = useState('');
  const [editorRevision, setEditorRevision] = useState(0);
  /* Whether the visitor has asked to write. See the placeholder below for why the
     editor is not mounted until they have. Derived (`editorOpen`) rather than
     synced — pressing 回复 *is* asking to write, and an effect mirroring `replyTo`
     into this would be a setState in an effect. */
  const [pressedWrite, setPressedWrite] = useState(false);
  const editorOpen = pressedWrite || replyTo !== null;

  /* Warm the chunk on intent rather than on press, so the editor is already in
     the module cache by the time the click lands. Same ladder as
     `useIntentPrefetch`, minus the timers; `import()` is idempotent. */
  const warmEditor = () => {
    void import('@/components/RichTextEditor');
  };
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

    const token = readToken();
    if (!token) {
      showToast('请先登录', 'error');
      openAuth('login');
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
          <MdReply size={ICON.dense} />
          <span>
            回复 <strong className="text-primary-ink">{replyTo.username}</strong>：
          </span>
          {/* Quieter by *size*, not by a dimmed copy of the same role: `body-s`
              against the bar's `body-m` says "supporting" through the type
              scale instead. */}
          <span className="flex-1 truncate text-body-s">
            {replyTo.body.slice(0, 80)}
            {replyTo.body.length > 80 ? '…' : ''}
          </span>
          {/* `IconButton`, not a bare glyph with a hover opacity: this is the
              same 取消回复 control the forum thread renders, and that one is
              already an `IconButton`. The hand-rolled version had no focus ring,
              no state layer and a 16px hit area. */}
          <IconButton
            size="sm"
            onClick={onCancelReply}
            aria-label="取消回复"
            className="-me-1.5 ml-auto shrink-0 text-error"
            icon={<MdClose size={ICON.dense} />}
          />
        </div>
      )}
      {/* The editor loads when you go to write, not when the comments scroll into view.
       *
       * `RichTextEditor` is `@wangeditor/editor` plus its Uppy upload stack: **774KB raw,
       * 176KB brotli**, the largest chunk in the app by a factor of three. It used to mount as
       * soon as `mounted` went true — which `PicDetail` sets from an IntersectionObserver with
       * a 500px root margin — so scrolling anywhere near the comments on *any* picture
       * downloaded and instantiated a full rich-text editor, whether or not the visitor had
       * any intention of typing. Most do not.
       *
       * The placeholder is a real `<button>` rather than a styled div: it is the control that
       * starts the editor, so it has to be reachable by keyboard and announce itself. Pressing
       * it (or focusing it and pressing Enter/Space, which a button gives for free) swaps in
       * the editor and the `autoFocus`-equivalent is handled by wangEditor's own mount.
       *
       * **`mounted` no longer gates this, and must not.** It comes from an
       * IntersectionObserver in `PicDetail`, and its entire purpose was to defer the heavy
       * mount until the composer was near the viewport — which pressing the placeholder now
       * does explicitly and far more precisely. Leaving it in the condition made the button
       * `disabled` until the observer happened to fire, so the first press on a composer the
       * user had scrolled straight to did nothing at all. */}
      {editorOpen ? (
        <RichTextEditor
          key={editorRevision}
          value={comment}
          onChange={setComment}
          placeholder={replyTo ? `回复 @${replyTo.username}…` : '写下你的评论…'}
          disabled={isSubmitting}
        />
      ) : (
        /* Roughly a 52px toolbar (6px padding + 40px buttons) + a 300px body +
           2×1px border. `min-h` rather than a fixed height because the toolbar
           wraps to a second row on narrow screens, and under-reserving is much
           less disruptive than over-reserving: the editor grows into the space
           instead of the page collapsing around it.

           The same box in both states, so opening the editor does not move the page. */
        <button
          type="button"
          onClick={() => setPressedWrite(true)}
          onPointerEnter={warmEditor}
          onFocus={warmEditor}
          className="min-h-[354px] w-full cursor-text rounded-sm border border-outline-variant bg-surface-container-low p-4 text-left text-body-l text-on-surface-variant transition-ui state-layer focus-visible:ring-2 focus-visible:focus-ring"
        >
          {/* Always the plain prompt: `editorOpen` is true whenever `replyTo` is
              set, so this branch only ever renders with no reply target. */}
          写下你的评论…
        </button>
      )}
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          onClick={handleSubmit}
          variant="filled"
          loading={isSubmitting}
          disabled={!trimmedComment}
          icon={<MdSend size={ICON.dense} />}
        >
          {isSubmitting ? '发送中…' : replyTo ? '发送回复' : '发送评论'}
        </Button>
      </div>
    </>
  );
}
