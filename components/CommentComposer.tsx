'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdClose, MdReply, MdSend } from 'react-icons/md';
import Button from '@/components/Button';
import Collapse from '@/components/Collapse';
import IconButton from '@/components/IconButton';
import { EditorPlaceholder, type RichTextEditorHandle } from '@/components/RichTextEditorShell';
import { useAuthModal } from '@/components/AuthModal';
import { showToast } from '@/components/Toast';
import { postComment, requestId } from '@/lib/api/picpony';
import { apiErrorMessage } from '@/lib/api/errors';
import { motionTier, scaledMs } from '@/lib/appearance';
import { plainTextOf } from '@/lib/derpiMarkup';
import { readCommentDraft, replyReference, writeCommentDraft } from '@/lib/imageComments';
import { readToken, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { HANDOFF_MS, TRAVEL_PX } from '@/lib/motionTokens';
import { springTiming } from '@/lib/springTiming';
import { cn } from '@/lib/utils';

/**
 * A comment is a reply, so the editor takes the shorter `reply` box. While its chunk loads, the
 * shell's own placeholder is drawn at that same size, so opening it is one change of height
 * rather than two. `loading` is what keeps the lazy chunk from suspending to the route's
 * boundary, which would replace the whole detail with the route skeleton for as long as the chunk
 * takes (docs/module-boundaries.md#initial-document-and-lazy-boundaries).
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

/**
 * The `Idempotency-Key` of a send, kept per picture and body until it lands: pressing 发送 again
 * after a send whose answer was lost repeats *that* send, and the backend posts it once.
 */
const sendKeys = new Map<string, string>();

/** The post itself, at module scope (the React Compiler cannot lower a `finally` in a component). */
async function send(
  token: string,
  imageId: number,
  text: string,
  replyTo: ReplyTarget | null,
): Promise<SendOutcome> {
  const body = replyBody(text, replyTo);
  const attempt = `${imageId}\n${body}`;
  const key = sendKeys.get(attempt) ?? requestId();
  sendKeys.set(attempt, key);
  try {
    await postComment(token, imageId, body, replyReference(replyTo), key);
    sendKeys.delete(attempt);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '评论发送失败') };
  }
}

type TransitionPhase = 'idle' | 'opening' | 'closing';

interface ComposerPose {
  height: number;
  triggerOpacity: number;
  editorOpacity: number;
  editorTranslate: string;
}

/**
 * Writing a comment: a one-line field until you go to write (the rich-text editor is the app's
 * largest chunk, and most readers never write), then the editor, a reply's quote above it, and
 * 发送.
 *
 * Expanding and collapsing animate the box height on the critically damped `layout` spring (list
 * category, so the comment thread underneath glides without bouncing) while cross-fading the
 * 56dp trigger and the editor on `fastEffects` / `defaultEffects`. The editor mounts only when
 * opened and stays mounted until a collapse finishes, keeping both directions interruptible and
 * free of eager chunk loading or blank collapse gaps.
 *
 * **Signed out it asks you to sign in, and only that** — one piece of feedback (it used to toast
 * 请先登录 *and* open the dialog), and before anything can be typed. **Nothing typed is thrown
 * away**: the draft is kept per picture for the life of the page (a step to the next picture and
 * back, a session that expires mid-sentence, a failed send), and the editor reopens on it.
 */
export default function CommentComposer({
  imageId,
  replyTo,
  onCancelReply,
  onPosted,
}: CommentComposerProps) {
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
  /* Keep the departing editor mounted under its old key while collapsing after a post, so the
     collapse animation never flashes a fresh placeholder; reopening adopts the new revision. */
  const [mountedRevision, setMountedRevision] = useState(editorRevision);
  if (editorOpen && mountedRevision !== editorRevision) setMountedRevision(editorRevision);
  /* Hold the reply quote bar's open state across a composer collapse so canceling reply on close
     never collapses the inner quote bar simultaneously with the departing editor snapshot. */
  const [mountedReplyOpen, setMountedReplyOpen] = useState(Boolean(replyTo));
  if (editorOpen && mountedReplyOpen !== Boolean(replyTo)) setMountedReplyOpen(Boolean(replyTo));
  /* Track open/close transitions per picture; switching pictures resets immediately without motion. */
  const [transition, setTransition] = useState<{
    imageId: number;
    open: boolean;
    phase: TransitionPhase;
  }>({
    imageId,
    open: editorOpen,
    phase: 'idle',
  });
  if (transition.imageId !== imageId) {
    setTransition({ imageId, open: editorOpen, phase: 'idle' });
  } else if (transition.open !== editorOpen) {
    setTransition({ imageId, open: editorOpen, phase: editorOpen ? 'opening' : 'closing' });
  }
  /* Hold the last reply target while the quote bar collapses inside an open editor. */
  const [lastReply, setLastReply] = useState<{ imageId: number; target: ReplyTarget | null }>({
    imageId,
    target: replyTo,
  });
  if (lastReply.imageId !== imageId) {
    setLastReply({ imageId, target: replyTo });
  } else if (replyTo && lastReply.target !== replyTo) {
    setLastReply({ imageId, target: replyTo });
  }
  const shownReply = replyTo ?? (lastReply.imageId === imageId ? lastReply.target : null);

  /* Which picture's comment is on its way (review P3-O5). A plain flag kept the next picture's
     发送 disabled until the previous picture's request ended, and the success path then cleared
     the reply target the visitor had just picked on the new picture. */
  const [submittingFor, setSubmittingFor] = useState<number | null>(null);
  const isSubmitting = submittingFor === imageId;
  const shownImage = useRef(imageId);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerWrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const editorHandleRef = useRef<RichTextEditorHandle | null>(null);
  const wantFocusRef = useRef(false);
  const poseRef = useRef<ComposerPose | null>(null);

  useEffect(() => {
    shownImage.current = imageId;
  }, [imageId]);

  const attachEditor = useCallback((handle: RichTextEditorHandle | null) => {
    editorHandleRef.current = handle;
    if (handle && wantFocusRef.current) {
      wantFocusRef.current = false;
      handle.focus();
    }
  }, []);

  const phase = transition.imageId === imageId ? transition.phase : 'idle';

  useLayoutEffect(() => {
    if (phase === 'idle') {
      poseRef.current = null;
      return;
    }
    const box = boxRef.current;
    const triggerWrap = triggerWrapRef.current;
    const editorWrap = editorWrapRef.current;
    const opening = phase === 'opening';

    if (opening) {
      wantFocusRef.current = true;
      if (editorHandleRef.current) {
        wantFocusRef.current = false;
        editorHandleRef.current.focus();
      }
    } else {
      wantFocusRef.current = false;
      if (editorWrap?.contains(document.activeElement)) {
        triggerRef.current?.focus({ preventScroll: true });
      }
    }

    const interrupted = poseRef.current;
    poseRef.current = null;
    const tier = motionTier('list');

    if (!box || tier === 'off') {
      let alive = true;
      queueMicrotask(() => {
        if (alive) {
          setTransition((current) =>
            current.imageId === imageId && current.phase === phase
              ? { ...current, phase: 'idle' }
              : current,
          );
        }
      });
      return () => {
        alive = false;
      };
    }

    const from =
      interrupted?.height ??
      (opening
        ? triggerWrap?.getBoundingClientRect().height
        : editorWrap?.getBoundingClientRect().height) ??
      box.getBoundingClientRect().height;
    const to = box.getBoundingClientRect().height;

    const layoutTiming = springTiming('layout', 'list');
    const enterFade = springTiming('defaultEffects', 'list');
    const exitFade = springTiming('fastEffects', 'list');
    const handoff = interrupted ? 0 : scaledMs(HANDOFF_MS, 'list');
    const travel = tier === 'standard' ? TRAVEL_PX.small : 0;
    const animations: Animation[] = [];

    if (Math.abs(to - from) >= 0.5) {
      /* Clip only the moving bottom edge so focus rings on the other three sides stay intact. */
      box.style.clipPath = 'inset(-100vmax -100vmax 0 -100vmax)';
      animations.push(box.animate([{ height: `${from}px` }, { height: `${to}px` }], layoutTiming));
    }

    if (opening) {
      if (triggerWrap) {
        animations.push(
          triggerWrap.animate([{ opacity: interrupted?.triggerOpacity ?? 1 }, { opacity: 0 }], {
            ...exitFade,
            fill: 'forwards',
          }),
        );
      }
      if (editorWrap) {
        animations.push(
          editorWrap.animate([{ opacity: interrupted?.editorOpacity ?? 0 }, { opacity: 1 }], {
            ...enterFade,
            delay: handoff,
            fill: 'backwards',
          }),
        );
        if (travel > 0) {
          animations.push(
            editorWrap.animate(
              [
                { translate: interrupted?.editorTranslate ?? `0 ${-travel}px` },
                { translate: 'none' },
              ],
              { ...layoutTiming, delay: handoff, fill: 'backwards' },
            ),
          );
        }
      }
    } else {
      if (editorWrap) {
        animations.push(
          editorWrap.animate([{ opacity: interrupted?.editorOpacity ?? 1 }, { opacity: 0 }], {
            ...exitFade,
            fill: 'forwards',
          }),
        );
        if (travel > 0) {
          animations.push(
            editorWrap.animate(
              [
                { translate: interrupted?.editorTranslate ?? 'none' },
                { translate: `0 ${-travel}px` },
              ],
              { ...layoutTiming, fill: 'forwards' },
            ),
          );
        }
      }
      if (triggerWrap) {
        animations.push(
          triggerWrap.animate([{ opacity: interrupted?.triggerOpacity ?? 0 }, { opacity: 1 }], {
            ...enterFade,
            delay: handoff,
            fill: 'backwards',
          }),
        );
      }
    }

    let alive = true;
    const settle = () => {
      if (!alive) return;
      box.style.clipPath = '';
      setTransition((current) =>
        current.imageId === imageId && current.phase === phase
          ? { ...current, phase: 'idle' }
          : current,
      );
    };
    if (animations.length === 0) {
      queueMicrotask(settle);
    } else {
      Promise.all(animations.map((animation) => animation.finished)).then(settle, () => {});
    }

    return () => {
      alive = false;
      if (animations.some((animation) => animation.playState === 'running')) {
        poseRef.current = {
          height: box.getBoundingClientRect().height,
          triggerOpacity: triggerWrap
            ? Number(getComputedStyle(triggerWrap).opacity)
            : opening
              ? 0
              : 1,
          editorOpacity: editorWrap
            ? Number(getComputedStyle(editorWrap).opacity)
            : opening
              ? 1
              : 0,
          editorTranslate: editorWrap ? getComputedStyle(editorWrap).translate || 'none' : 'none',
        };
      }
      for (const animation of animations) animation.cancel();
      box.style.clipPath = '';
    };
  }, [phase, imageId]);

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
    const sentFor = imageId;
    setSubmittingFor(sentFor);
    void send(token, sentFor, comment, replyTo).then((outcome) => {
      setSubmittingFor((current) => (current === sentFor ? null : current));
      if (!outcome.ok) {
        showToast(outcome.message, 'error');
        return;
      }
      showToast('已发送评论', 'success');
      /* The sent picture's draft is spent wherever the visitor is now; the editor, the reply
         target and the list refresh belong to the picture on screen, so only that one's. */
      writeCommentDraft(sentFor, '');
      if (shownImage.current !== sentFor) return;
      setDraft({ imageId: sentFor, text: '' });
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

  const showTrigger = !editorOpen || phase !== 'idle';
  const showEditor = editorOpen || phase === 'closing';

  return (
    <div ref={boxRef} className="relative">
      {showTrigger && (
        <div
          ref={triggerWrapRef}
          inert={editorOpen || undefined}
          aria-hidden={editorOpen || undefined}
          className={cn(editorOpen && 'pointer-events-none absolute inset-x-0 top-0')}
        >
          {/* A real `<button>` shaped as the 12dp editor shell it opens into: it starts the editor, so it
              has to be reachable by keyboard and announce itself. 56dp, the field's own height — the
              354px box it used to reserve put most of a phone screen of nothing above the thread. */}
          <button
            ref={triggerRef}
            type="button"
            onClick={() => (signedIn ? setPressedWrite(imageId) : openAuth('login'))}
            onPointerEnter={signedIn ? warmEditor : undefined}
            onFocus={signedIn ? warmEditor : undefined}
            data-ripple=""
            className="flex h-14 w-full cursor-pointer select-none touch-manipulation items-center rounded-md bg-surface-container-high px-4 text-left text-body-l text-on-surface-variant transition-ui state-layer forced-boundary focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
          >
            <span className="truncate">
              {signedIn
                ? trimmed
                  ? '继续编辑评论…'
                  : '发表评论…'
                : trimmed
                  ? '登录后继续编辑评论'
                  : '登录后发表评论'}
            </span>
          </button>
        </div>
      )}
      {showEditor && (
        <div
          ref={editorWrapRef}
          inert={!editorOpen || undefined}
          aria-hidden={!editorOpen || undefined}
          className={cn(!editorOpen && 'pointer-events-none absolute inset-x-0 top-0')}
        >
          <Collapse open={editorOpen ? Boolean(replyTo) : mountedReplyOpen}>
            {shownReply && (
              <div className="pb-2">
                <div className="flex min-w-0 items-center gap-2 rounded-sm bg-surface-container px-3 py-1 text-body-m text-on-surface-variant">
                  <MdReply size={ICON.dense} className="shrink-0" aria-hidden="true" />
                  <span className="flex min-w-0 max-w-[60%] shrink items-center">
                    <span className="shrink-0">回复&nbsp;</span>
                    <span className="min-w-0 truncate text-body-m-emphasized text-on-surface">
                      {shownReply.username}
                    </span>
                    <span className="shrink-0">：</span>
                  </span>
                  {/* Its words, not its markup: a Derpibooru comment opens with a link in Markdown, and
                      the bar used to print `[@name](/images/…` raw. */}
                  <span className="min-w-0 flex-1 truncate text-body-s">
                    {plainTextOf(shownReply.body, { keepQuotes: false, max: 80 })}
                  </span>
                  <IconButton
                    size="sm"
                    dismiss
                    onClick={onCancelReply}
                    aria-label="取消回复"
                    className="-me-2 shrink-0"
                    icon={<MdClose />}
                  />
                </div>
              </div>
            )}
          </Collapse>
          <div className="flex flex-col gap-2">
            <RichTextEditor
              key={`${imageId}:${mountedRevision}`}
              value={comment}
              onChange={setComment}
              placeholder={replyTo ? `回复 ${replyTo.username}…` : '发表评论…'}
              disabled={isSubmitting}
              size="reply"
              label={replyTo ? `回复 ${replyTo.username}` : '评论'}
              handleRef={attachEditor}
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
        </div>
      )}
    </div>
  );
}
