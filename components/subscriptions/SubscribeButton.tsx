'use client';

import { useState } from 'react';
import { MdNotificationAdd, MdNotificationsActive } from 'react-icons/md';
import Button from '@/components/Button';
import { useAuthModal } from '@/components/AuthModal';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { tagSubscriptions } from '@/lib/resources';
import { cn } from '@/lib/utils';
import {
  findSubscription,
  SESSION_CHANGED_MESSAGE,
  subscribeMessage,
  subscribeToTag,
  unsubscribeConfirmed,
} from './actions';

/**
 * 订阅 / 已订阅 for one tag — the tag dialog's and a subscription gallery's. Subscribing takes the
 * live count first (a Derpibooru read), so the button is busy for as long as both steps take;
 * 已订阅 offers the way back, behind a confirmation (removing a subscription loses its count of
 * new pictures, which a re-subscribe cannot restore). Signed out it opens the sign-in dialog —
 * when pressed, never by itself.
 *
 * The state is the account's list (`tagSubscriptions`), so the dialog, the gallery and the
 * drawer agree: subscribing anywhere is 已订阅 everywhere at once. A press that finished is shown
 * as settled at once, in the frame its busy state ends, and the list's own answer confirms it a
 * frame later (the list is written on a paint boundary): waiting for that showed the old glyph for
 * a frame between the spinner and the new one.
 *
 * **One footprint for both states** (M1-018): both labels share one grid cell, the other one
 * invisible (`Select`'s widest-option technique), so the button is as wide as 已订阅 in either
 * state and the control beside it never moves; the glyph turns on the shared icon swap — only in
 * answer to a press, never when the list lands or another surface changed it.
 */
export default function SubscribeButton({
  tag,
  className,
  onSubscribed,
}: {
  tag: string;
  className?: string;
  /** After a subscription lands, with the name it was made under (an alias's tag). */
  onSubscribed?: (tagName: string) => void;
}) {
  const { token, ready } = useSession();
  const { openAuth } = useAuthModal();
  const { confirm, confirmDialog } = useConfirm();
  const read = useResource(tagSubscriptions, token ? { token } : SKIP);
  const [busy, setBusy] = useState(false);
  const subscription = findSubscription(read.data, tag);
  const listed = Boolean(subscription);

  /* What a finished press established, for this session, until the list says the same. */
  const [settled, setSettled] = useState<{ token: string; subscribed: boolean; tagName: string } | null>(null);
  if (settled && (settled.token !== token || settled.subscribed === listed)) setSettled(null);
  const subscribed = settled ? settled.subscribed : listed;
  const tagName = subscription?.tagName ?? settled?.tagName ?? tag;

  /* The state a press asked for: the glyph turns while it is the one shown, and the record is
     dropped once the state moves on (the app bar's scheme toggle, `AppLayout`). */
  const [turnTo, setTurnTo] = useState<boolean | null>(null);
  const [shown, setShown] = useState(subscribed);
  if (shown !== subscribed) {
    setShown(subscribed);
    if (turnTo !== null && shown === turnTo) setTurnTo(null);
  }

  const subscribe = async () => {
    if (!token) {
      openAuth('login');
      return;
    }
    setBusy(true);
    const outcome = await subscribeToTag(token, tag);
    setBusy(false);
    const [message, tone] = subscribeMessage(outcome);
    showToast(message, tone);
    if (outcome.kind === 'done' || outcome.kind === 'exists') {
      setTurnTo(true);
      setSettled({ token, subscribed: true, tagName: outcome.tagName });
    }
    if (outcome.kind === 'done') onSubscribed?.(outcome.tagName);
  };

  const unsubscribe = async () => {
    if (!token) return;
    const name = tagName;
    const confirmed = await confirm({
      title: '确认取消订阅',
      message: `确定要取消订阅标签「${name}」吗？取消后不再追踪它的新图片。`,
    });
    if (!confirmed) return;
    setBusy(true);
    /* The session is read again first: the confirmation may have outlived it (G3-018). */
    const outcome = await unsubscribeConfirmed(token, name);
    setBusy(false);
    if (outcome.kind === 'stale-session') {
      showToast(SESSION_CHANGED_MESSAGE, 'warning');
      return;
    }
    if (outcome.kind === 'failed') {
      showToast(outcome.message, 'error');
      return;
    }
    showToast(`已取消订阅「${name}」`, 'success');
    setTurnTo(false);
    setSettled({ token, subscribed: false, tagName: name });
  };

  /* Signed in, the list is what says which button this is: until it has answered, the control
     waits (busy, so it keeps its place and its focus) rather than guessing 订阅. */
  const waiting = Boolean(token) && read.data === undefined && read.error === undefined;
  const Glyph = subscribed ? MdNotificationsActive : MdNotificationAdd;

  return (
    <>
      <Button
        variant="tonal"
        className={className}
        icon={
          /* Nested a level for the turn, so it names its own size (the slot sizes only a glyph
             directly inside it). Keyed on the state: each new glyph mounts, and turns if asked. */
          <span key={subscribed ? 'on' : 'off'} className={cn('block', turnTo === subscribed && 'animate-icon-swap')}>
            <Glyph size={ICON.control} />
          </span>
        }
        loading={busy || (!subscribed && (waiting || !ready))}
        onClick={() => void (subscribed ? unsubscribe() : subscribe())}
      >
        <span className="grid">
          <span aria-hidden={!subscribed || undefined} className={cn('col-start-1 row-start-1', !subscribed && 'invisible')}>
            已订阅
          </span>
          <span aria-hidden={subscribed || undefined} className={cn('col-start-1 row-start-1', subscribed && 'invisible')}>
            订阅
          </span>
        </span>
      </Button>
      {confirmDialog}
    </>
  );
}
