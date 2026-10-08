'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import dynamic from 'next/dynamic';
import { MdClose, MdReply, MdSend } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import IconButton from '@/components/IconButton';
import SectionHeading from '@/components/SectionHeading';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
import { showToast } from '@/components/Toast';
import { useAuthModal } from '@/components/AuthModal';
import { EditorPlaceholder, type RichTextEditorHandle } from '@/components/RichTextEditorShell';
import { sendReply } from '@/components/forum/threadActions';
import { bbcodeToPlainText } from '@/lib/bbcode';
import { isBlankRichText, replyQuote } from '@/lib/forumText';
import { readToken, useSession } from '@/lib/hooks';
import { useScreenStateFor } from '@/lib/screenState';
import { scrollAppToElement } from '@/lib/scrollTo';
import { ICON } from '@/lib/icons';
import type { ForumPostDetailResponse } from '@/lib/types/forum';

/* The editor is the heaviest thing on the screen and the last thing on it: its chunk loads after
   the thread, into a box already its size. */
const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
  ssr: false,
  loading: () => <EditorPlaceholder size="reply" />,
});

/** The reply a new reply answers: its author, and its words for the quote. */
export interface ReplyTarget {
  commentId: number;
  userId: number;
  username: string;
  content: string;
}

interface ReplyComposerProps {
  threadId: string;
  postId: number;
  replyTo: ReplyTarget | null;
  onCancelReply: () => void;
  /** Whether the composer holds anything — the screen stands its Esc-to-leave down while it does. */
  onDirtyChange: (dirty: boolean) => void;
  /** Sent: the thread's last page as it now stands (`null` if that read failed), and the session. */
  onSent: (last: ForumPostDetailResponse | null, token: string) => void;
  /** Bumped by the screen when 回复 is pressed on a row: bring the composer into view, focused. */
  focusRequest: number;
}

/**
 * 发表回复. The words survive leaving the thread and coming back in this session (screen state,
 * per thread), a reply to a reply opens with a quote built from the words it answers (R6-031),
 * and a sent reply is shown where it landed — the last page, scrolled to (R6-032).
 *
 * Signed out it says what signing in is for, in place (decision 4).
 */
export default function ReplyComposer({
  threadId,
  postId,
  replyTo,
  onCancelReply,
  onDirtyChange,
  onSent,
  focusRequest,
}: ReplyComposerProps) {
  const { token, ready } = useSession();
  const { openAuth } = useAuthModal();
  const [content, setContent] = useScreenStateFor('forum-reply', threadId, '');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const editor = useRef<RichTextEditorHandle>(null);
  const cardRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const errorId = useId();
  const blank = isBlankRichText(content);
  /* The reply target as it is now, for a send that lands after the reader picked another. */
  const latestReplyTo = useRef(replyTo);
  useEffect(() => {
    latestReplyTo.current = replyTo;
  });

  useEffect(() => {
    onDirtyChange(!blank);
  }, [blank, onDirtyChange]);

  useEffect(() => {
    if (focusRequest === 0) return;
    scrollAppToElement(cardRef.current, { offset: 72 });
    editor.current?.focus();
  }, [focusRequest]);

  const submit = async () => {
    const session = readToken();
    if (!session) {
      openAuth('login');
      return;
    }
    if (sending) return;
    if (uploading) {
      setError('图片还在上传，请稍候');
      return;
    }
    if (blank) {
      setError('请输入回复内容');
      editor.current?.focus();
      return;
    }
    setError(null);
    setSending(true);
    /* What this send carries. The editor stays editable while it is out, so the reader may go on
       typing or pick another reply to answer; the send's success takes away only what it sent
       (review P4-F3: it emptied the editor and dropped the newly picked target as well). */
    const sent = content;
    const target = replyTo;
    const outcome = await sendReply(session, threadId, {
      postId,
      content: (target ? replyQuote(target.username, target.content) : '') + sent.trim(),
      replyToUserId: target?.userId,
      replyToCommentId: target?.commentId,
    });
    setSending(false);
    if (readToken() !== session) return;
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setContent((current) => (current === sent ? '' : current));
    if (target && latestReplyTo.current?.commentId === target.commentId) onCancelReply();
    showToast('已发送回复', 'success');
    onSent(outcome.last, session);
  };

  /* Ctrl/⌘+Enter sends, as in every composer; plain Enter is a new paragraph. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  return (
    <Card
      ref={cardRef}
      variant="elevated"
      padding="lg"
      className="mb-8 scroll-mt-20"
      aria-labelledby={headingId}
      role="region"
      onKeyDown={onKeyDown}
    >
      <SectionHeading id={headingId}>发表回复</SectionHeading>
      {!ready ? (
        <Skeleton className="h-24 w-full rounded-md" />
      ) : !token ? (
        <SignInRequired size="inline" title="登录后即可回复" />
      ) : (
        <div className="space-y-3">
          {replyTo && (
            <div className="flex items-center gap-2 rounded-sm bg-secondary-container py-1 ps-3 pe-1 text-on-secondary-container">
              <MdReply size={ICON.dense} className="shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1 truncate text-body-m">
                回复 <span className="text-label-l-emphasized">{replyTo.username}</span>：
                <span className="text-body-s">{bbcodeToPlainText(replyTo.content, { maxLength: 80 })}</span>
              </p>
              <IconButton size="sm" dismiss aria-label="取消回复" icon={<MdClose />} onClick={onCancelReply} />
            </div>
          )}
          <RichTextEditor
            value={content}
            onChange={(next) => {
              setContent(next);
              if (error) setError(null);
            }}
            size="reply"
            label={replyTo ? `回复 ${replyTo.username}` : '回复内容'}
            placeholder={replyTo ? `回复 ${replyTo.username}…` : '写下你的回复…'}
            invalid={error !== null}
            describedBy={error ? errorId : undefined}
            handleRef={editor}
            onUploadingChange={setUploading}
          />
          {error && (
            <p id={errorId} role="alert" className="text-body-s text-error">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="filled" icon={<MdSend />} loading={sending} onClick={() => void submit()}>
              发送回复
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
