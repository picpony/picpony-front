'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Modal from '@/components/Modal';
import Skeleton from '@/components/Skeleton';
import { Textarea } from '@/components/Input';
import { showToast } from '@/components/Toast';
import { useAuthModal } from '@/components/AuthModal';
import FollowHeight from '@/components/FollowHeight';
import SubscribeButton from '@/components/subscriptions/SubscribeButton';
import { submitTagFeedback } from '@/lib/api/picpony';
import { readJson } from '@/lib/api/http';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { MEDIA } from '@/lib/constants';
import { readToken, useMediaQuery, useSession } from '@/lib/hooks';
import { addPendingTag, MAX_PENDING } from '@/lib/pendingTags';
import { SKIP, useResource } from '@/lib/resource';
import { tagEntry } from '@/lib/resources';
import { tagCategory } from '@/lib/tagCategories';
import { cn } from '@/lib/utils';

type SendOutcome = { ok: true } | { ok: false; message: string };

async function sendFeedback(token: string, tagName: string, reason: string, translation: string): Promise<SendOutcome> {
  try {
    const data = await readJson<{ success?: unknown; message?: string; error?: string }>(
      await submitTagFeedback(token, { tagName, reason, translation }),
    );
    if (data.success === true) return { ok: true };
    return { ok: false, message: data.error || data.message || '反馈提交失败' };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '反馈提交失败') };
  }
}

/**
 * The entry while it is read, in the entry's own shape (M1-019): 中文名 over a row of name marks,
 * then 标签简介 over one line of prose, each placeholder inside the line box of the type role it
 * stands in for — so the commonest entry lands without the dialog moving at all, and any other
 * one moves only by the difference, on `FollowHeight`'s spring. One line because that is the
 * plurality: of fifteen live entries sampled (the tags a picture carries — rating, species,
 * characters), six had a one-line description, three none and six five lines or more, and none
 * had a category. A spinner here was a box of its own size: the panel grew 57px and re-centred
 * 28px in the frame the entry arrived.
 */
function EntrySkeleton() {
  return (
    <div className="space-y-3">
      <p className="sr-only" role="status">
        正在查询词库…
      </p>
      <div aria-hidden="true">
        <div className="text-label-m"><Skeleton className="inline-block h-2.5 w-9 align-middle" /></div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {/* A mark's own corner and its 20px box (`Badge` at `sm`). */}
          <Skeleton className="h-5 w-10 rounded-xs" />
          <Skeleton className="h-5 w-14 rounded-xs" />
        </div>
      </div>
      <div aria-hidden="true">
        <div className="text-label-m"><Skeleton className="inline-block h-2.5 w-12 align-middle" /></div>
        <div className="mt-1 text-body-m"><Skeleton className="inline-block h-3 w-4/5 align-middle" /></div>
      </div>
    </div>
  );
}

/**
 * A tag's glossary entry, and the way to report it wrong.
 *
 * The entry is the dictionary's public read (`tagEntry`, the one search suggestions use), so a
 * visitor who is not signed in sees it too — the original front end showed it to everyone; this
 * dialog used to answer 登录后可查看词库信息 instead. The heading is the real tag, so a chip that
 * shows a Chinese name is one tap from the English one.
 *
 * **反馈错误** turns the same dialog into the feedback form (`submit_tag_feedback`): a reason,
 * and optionally the translation it should have — the original front end's two fields. One
 * dialog with two branches rather than a second dialog stacked on the first. It needs an
 * account: signed out, the button opens the sign-in dialog and nothing else.
 *
 * **The switch is a pane swap, not a cut** (M1-020): the body and the action row are keyed on the
 * view and the arriving ones fade in on the pane-swap keyframe — `AuthModal`'s steps, the tier's
 * business rather than an entrance, so it plays with 入场动画 off — while the dialog's size follows
 * them (`FollowHeight` on both): it grew 80px and re-centred 40px in one frame. Focus goes where
 * the new view starts: the reason field under a mouse, the dialog itself under a finger (the new
 * title is announced and no keyboard is raised), 反馈错误 on the way back.
 *
 * **订阅 / 已订阅** follows the tag (`SubscribeButton`, shared with /subscriptions): subscribing reads
 * the tag's live count from Derpibooru first, as the original front end's 订阅此标签 did.
 *
 * The tag it shows is held through the close animation: `tag` goes null the moment the dialog is
 * asked to close, and reading it directly blanked the heading for the whole fade.
 */
export default function TagInfoModal({ tag, onClose }: { tag: string | null; onClose: () => void }) {
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const session = useSession();
  const reasonId = useId();
  const finePointer = useMediaQuery(MEDIA.pointerFine);
  const [shown, setShown] = useState(tag);
  const [mode, setMode] = useState<{ tag: string | null; view: 'entry' | 'feedback' }>({ tag, view: 'entry' });
  /* Whether the view has been switched in this opening: the dialog's own entrance brings the first
     view, and a second fade on it would lag behind the panel (`AuthModal`'s `switched`). */
  const [switched, setSwitched] = useState(false);
  const [reason, setReason] = useState('');
  const [translation, setTranslation] = useState('');
  const [sending, setSending] = useState(false);
  if (tag !== null && tag !== shown) {
    setShown(tag);
    setMode({ tag, view: 'entry' });
    setSwitched(false);
    setReason('');
    setTranslation('');
  }
  const view = mode.tag === shown ? mode.view : 'entry';
  const result = useResource(tagEntry, shown ? { tag: shown } : SKIP);
  const entry = result.data;
  const loading = Boolean(shown) && entry === undefined && result.error === undefined;

  const bodyRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const feedbackButtonRef = useRef<HTMLButtonElement>(null);
  /* Where focus goes once a switch has committed — set by the press that switched. */
  const focusAfterSwitch = useRef<'form' | 'return' | null>(null);

  const switchTo = (next: 'entry' | 'feedback') => {
    focusAfterSwitch.current = next === 'feedback' ? 'form' : 'return';
    setMode({ tag: shown, view: next });
    setSwitched(true);
  };

  /* In the commit that switched: the control that had focus has just been replaced, and a frame
     later the focus had spent one on the document. */
  useLayoutEffect(() => {
    const target = focusAfterSwitch.current;
    focusAfterSwitch.current = null;
    if (target === 'return') feedbackButtonRef.current?.focus({ preventScroll: true });
    else if (target === 'form' && finePointer) reasonRef.current?.focus({ preventScroll: true });
    else if (target === 'form') bodyRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true });
  }, [view, finePointer]);

  const openFeedback = () => {
    if (!session.token) {
      openAuth('login');
      return;
    }
    switchTo('feedback');
  };

  const submit = () => {
    const token = readToken();
    if (!shown || !reason.trim() || sending) return;
    if (!token) {
      openAuth('login');
      return;
    }
    setSending(true);
    void sendFeedback(token, shown, reason, translation).then((outcome) => {
      setSending(false);
      if (!outcome.ok) {
        showToast(outcome.message, 'error');
        return;
      }
      showToast('已提交反馈，感谢帮助完善词库', 'success');
      setReason('');
      setTranslation('');
      switchTo('entry');
    });
  };

  const chineseNames = entry ? [entry.cn, ...entry.aliases.filter((alias) => alias !== entry.cn)].filter(Boolean) : [];
  const swap = switched && 'animate-page-transition';
  /* The headline swaps with the view, on the body's clock — keyed, so the arriving words fade in
     rather than replacing the leaving ones in a frame. Empty, there is no headline at all, and the
     dialog keeps its fallback name. */
  const heading = view === 'feedback' ? '反馈词库错误' : (shown ?? '');

  return (
    <Modal
      isOpen={tag !== null}
      onClose={() => {
        if (!sending) onClose();
      }}
      title={heading ? <span key={view} className={cn(swap)}>{heading}</span> : undefined}
      maxWidth="md"
      closeOnOverlayClick={!sending}
      footer={
        /* One wrapper for the row so it can fade and change height as one block; the row inside
           is the footer's own arrangement (trailing, wrapping, a leading member by `mr-auto`). */
        <FollowHeight className="w-full">
          <div key={view} className={cn('flex flex-wrap justify-end gap-3', swap)}>
            {view === 'feedback' ? (
              <>
                <Button variant="text" onClick={() => switchTo('entry')} disabled={sending}>
                  返回
                </Button>
                <Button variant="filled" onClick={submit} loading={sending} disabled={!reason.trim()}>
                  提交反馈
                </Button>
              </>
            ) : (
              <>
                <Button ref={feedbackButtonRef} variant="text" className="mr-auto" onClick={openFeedback}>
                  反馈错误
                </Button>
                <Button variant="text" onClick={() => {
                  if (shown === null) return;
                  const outcome = addPendingTag(shown);
                  if (outcome === 'added') showToast('已添加到待定标签库', 'success');
                  else if (outcome === 'exists') showToast('此标签已在待定标签库中', 'info');
                  else if (outcome === 'full') showToast(`待定标签库已满（最多 ${MAX_PENDING} 个），请先整理后再添加`, 'error');
                  else showToast('待定标签保存失败，请检查浏览器是否允许本地存储', 'error');
                }}>
                  添加到待定标签
                </Button>
                {/* The original front end's 订阅此标签: the account's list says which of the two it is. */}
                {shown !== null && <SubscribeButton tag={shown} />}
                <Button
                  variant="accent"
                  onClick={() => {
                    if (shown === null) return;
                    router.push(`/search?q=${encodeURIComponent(shown)}`, { scroll: false });
                    onClose();
                  }}
                >
                  搜索此标签
                </Button>
              </>
            )}
          </div>
        </FollowHeight>
      }
    >
      <FollowHeight>
        <div ref={bodyRef} key={view} className={cn(swap)}>
          {view === 'feedback' ? (
            <div className="space-y-4">
              <p className="text-body-m text-on-surface-variant">
                标签：<span className="text-body-m-emphasized text-on-surface wrap-anywhere">{shown}</span>
              </p>
              <Textarea
                ref={reasonRef}
                id={reasonId}
                label="反馈原因或说明"
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                maxLength={1000}
                disabled={sending}
              />
              <Textarea
                label="建议的正确翻译（可选）"
                value={translation}
                onChange={(event) => setTranslation(event.target.value)}
                rows={2}
                maxLength={200}
                disabled={sending}
              />
            </div>
          ) : loading ? (
            <EntrySkeleton />
          ) : result.error !== undefined && entry === undefined ? (
            <ErrorRetry
              size="inline"
              title="词库查询失败"
              message={apiErrorMessage(result.error)}
              onRetry={isRetryable(result.error) ? result.refresh : undefined}
            />
          ) : entry ? (
            <div className="space-y-3">
              {chineseNames.length > 0 && (
                <div>
                  <p className="text-label-m text-on-surface-variant">中文名</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {/* One tone step above the dialog's own container, so the marks separate from
                        it by tone rather than vanishing into it. */}
                    {chineseNames.map((name) => (
                      <Badge key={name} colors="bg-surface-container-highest text-on-surface-variant">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {entry.description && (
                <div>
                  <p className="text-label-m text-on-surface-variant">标签简介</p>
                  <p className="mt-1 whitespace-pre-wrap text-body-m text-on-surface wrap-anywhere">{entry.description}</p>
                </div>
              )}
              {entry.category && (
                <div>
                  <p className="text-label-m text-on-surface-variant">分类</p>
                  <p className="mt-1 text-body-m text-on-surface">{tagCategory(entry.category).label}</p>
                </div>
              )}
            </div>
          ) : (
            <EmptyState size="inline" title="词库中暂无此标签的详细信息" />
          )}
        </div>
      </FollowHeight>
    </Modal>
  );
}
