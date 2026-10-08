'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { MdClose, MdReply, MdSend } from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { EditorPlaceholder } from '@/components/RichTextEditorShell';
import { useAuthModal } from '@/components/AuthModal';
import { showToast } from '@/components/Toast';
import { postComment } from '@/lib/api/picpony';
import { readJson } from '@/lib/api/http';
import { apiErrorMessage } from '@/lib/api/errors';
import { plainTextOf } from '@/lib/derpiMarkup';
import { readCommentDraft, writeCommentDraft } from '@/lib/imageComments';
import { readToken, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';

/**
 * A comment is a reply, so the editor takes the shorter `reply` box. While its chunk loads, the
 * shell's own placeholder is drawn at that same size, so opening it is one change of height
 * rather than two. `loading` is what keeps the lazy chunk from suspending to the route's
 * boundary, which would replace the whole detail with the route skeleton for as long as the chunk
 * takes (AGENTS, the dynamic-dialog rule).
 */
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
  ssr: false,
  loading: () => <EditorPlaceholder size="reply" />,
});

/* The chunk is warmed on intent — a pointer arriving, focus landing — so it is usually resident
   by the time the press lands. `import()` is idempotent. */
const warmEditor = () => {
  void import('@/components/RichTextEditor');
};

export type ReplyTarget = {
  id: number;
  username: string;
  body: string;
  source: 'picpony' | 'trixiebooru';
  /** A PicPony author's account; a Derpibooru author has none here. */
  userId: number | null;
};

type CommentComposerProps = {
  imageId: number;
  replyTo: ReplyTarget | null;
  onCancelReply: () => void;
  /** The comment was accepted: the thread re-reads. */
  onPosted: () => void;
};

/** A quoted name cannot close its own tag. */
const quotedName = (name: string) => name.replace(/"/g, '＂').replace(/]/g, '］');

/**
 * The body the backend is sent — the original front end's reply shape, so a reply reads as one in
 * both front ends: a quote of what it answers (its words, not its markup, the first hundred
 * characters) above the reply.
 */
function replyBody(text: string, replyTo: ReplyTarget | null): string {
  if (!replyTo) return text;
  const quote = plainTextOf(replyTo.body, { keepQuotes: false, max: 100 });
  return `[quote="${quotedName(replyTo.username)}"]\n${quote}\n[/quote]\n\n${text}`;
}

type SendOutcome = { ok: true } | { ok: false; message: string };

/** The post itself, at module scope (the React Compiler cannot lower a `finally` in a component). */
async function send(token: string, imageId: number, text: string, replyTo: ReplyTarget | null): Promise<SendOutcome> {
  try {
    const response = await postComment(token, imageId, replyBody(text, replyTo), {
      userId: replyTo?.source === 'picpony' ? replyTo.userId : 0,
      commentId: replyTo?.id ?? null,
    });
    const data = await readJson<{ success?: unknown; message?: string; error?: string }>(response);
    if (data.success === true) return { ok: true };
    return { ok: false, message: data.error || data.message || '评论发送失败' };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '评论发送失败') };
  }
}

/**
 * Writing a comment: a one-line field until you go to write (the rich-text editor is the app's
 * largest chunk, and most readers never write), then the editor, a reply's quote above it, and
 * 发送.
 *
 * **Signed out it asks you to sign in, and only that** — one piece of feedback (it used to toast
 * 请先登录 *and* open the dialog), and before anything can be typed. **Nothing typed is thrown
 * away**: the draft is kept per picture for the life of the page (a step to the next picture and
 * back, a session that expires mid-sentence, a failed send), and the editor reopens on it.
 */
export default function CommentComposer({ imageId, replyTo, onCancelReply, onPosted }: CommentComposerProps) {
  const { openAuth } = useAuthModal();
  const session = useSession();
  const signedIn = Boolean(session.token);
  const [draft, setDraft] = useState(() => ({ imageId, text: readCommentDraft(imageId) }));
  const comment = draft.imageId === imageId ? draft.text : readCommentDraft(imageId);
  const [editorRevision, setEditorRevision] = useState(0);
  /* Whether the visitor has asked to write — pressing 回复 is asking too, so it is derived rather
     than synced from `replyTo` by an effect. */
  const [pressedWrite, setPressedWrite] = useState<number | null>(null);
  const editorOpen = signedIn && (pressedWrite === imageId || replyTo !== null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmed = comment.trim();

  const setComment = (text: string) => {
    setDraft({ imageId, text });
    writeCommentDraft(imageId, text);
  };

  const handleSubmit = () => {
    if (!trimmed || isSubmitting) return;
    const token = readToken();
    if (!token) {
      openAuth('login');
      return;
    }
    setIsSubmitting(true);
    void send(token, imageId, comment, replyTo).then((outcome) => {
      setIsSubmitting(false);
      if (!outcome.ok) {
        showToast(outcome.message, 'error');
        return;
      }
      showToast('评论已发送', 'success');
      setComment('');
      setEditorRevision((revision) => revision + 1);
      setPressedWrite(null);
      onCancelReply();
      onPosted();
    });
  };

  const collapse = () => {
    setPressedWrite(null);
    onCancelReply();
  };

  if (!signedIn) {
    return (
      <button
        type="button"
        /* Before hydration the session is unknown; pressing it then does nothing wrong. */
        onClick={() => openAuth('login')}
        className="flex h-14 w-full cursor-pointer items-center rounded-sm bg-surface-container-highest px-4 text-left text-body-l text-on-surface-variant transition-ui state-layer focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
      >
        {trimmed ? '登录后继续编辑评论' : '登录后发表评论'}
      </button>
    );
  }

  if (!editorOpen) {
    return (
      /* A real `<button>` shaped as the filled field it opens into: it starts the editor, so it
         has to be reachable by keyboard and announce itself. 56dp, the field's own height — the
         354px box it used to reserve put most of a phone screen of nothing above the thread. */
      <button
        type="button"
        onClick={() => setPressedWrite(imageId)}
        onPointerEnter={warmEditor}
        onFocus={warmEditor}
        className="flex h-14 w-full cursor-text items-center rounded-sm bg-surface-container-highest px-4 text-left text-body-l text-on-surface-variant transition-ui state-layer focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
      >
        <span className="truncate">{trimmed ? '继续编辑评论…' : '写下你的评论…'}</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {replyTo && (
        <div className="flex min-w-0 items-center gap-2 rounded-sm bg-surface-container px-3 py-1 text-body-m text-on-surface-variant">
          <MdReply size={ICON.dense} className="shrink-0" aria-hidden="true" />
          <span className="shrink-0">
            回复 <span className="text-body-m-emphasized text-on-surface">{replyTo.username}</span>：
          </span>
          {/* Its words, not its markup: a Derpibooru comment opens with a link in Markdown, and
              the bar used to print `[@name](/images/…` raw. */}
          <span className="min-w-0 flex-1 truncate text-body-s">
            {plainTextOf(replyTo.body, { keepQuotes: false, max: 80 })}
          </span>
          <IconButton
            size="sm"
            dismiss
            onClick={onCancelReply}
            aria-label="取消回复"
            className="-me-1.5 shrink-0"
            icon={<MdClose />}
          />
        </div>
      )}
      <RichTextEditor
        key={`${imageId}:${editorRevision}`}
        value={comment}
        onChange={setComment}
        placeholder={replyTo ? `回复 ${replyTo.username}…` : '写下你的评论…'}
        disabled={isSubmitting}
        size="reply"
        label={replyTo ? `回复 ${replyTo.username}` : '评论'}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="text" onClick={collapse} disabled={isSubmitting}>
          收起
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          variant="filled"
          loading={isSubmitting}
          disabled={!trimmed}
          icon={<MdSend />}
        >
          {replyTo ? '发送回复' : '发送评论'}
        </Button>
      </div>
    </div>
  );
}
