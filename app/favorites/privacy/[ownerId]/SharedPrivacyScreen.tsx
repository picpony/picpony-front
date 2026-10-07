'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MdDownload, MdLock, MdLockOpen, MdNoEncryption, MdPersonOff } from 'react-icons/md';
import { useResource } from '@/lib/resource';
import { sharedPrivacyFaves, userProfile } from '@/lib/resources';
import { verifySharedPrivacyPassword, type SharedPrivacyAnswer } from '@/lib/api/favorites';
import { apiErrorMessage, isAborted, isApiError, isNotFound, isRetryable } from '@/lib/api/errors';
import { clearImageSequence } from '@/lib/imageSequence';
import { favoritesHref, settled } from '@/lib/favorites';
import { useBackOrParent } from '@/lib/backNavigation';
import { readToken, useEscapeBack, useSession } from '@/lib/hooks';
import { useScreenStateFor } from '@/lib/screenState';
import { useSyncedSetting } from '@/lib/settingsSync';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { validateRequired } from '@/lib/validation';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { Input } from '@/components/Input';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
import { showToast } from '@/components/Toast';
import { FaveGridView, useDeviceRules, useLocalFavePage } from '@/components/favorites/FaveGrid';
import { GateCard } from '@/components/favorites/PrivacyForms';
import { usePictureBatch } from '@/components/favorites/usePictureBatch';

const COLUMN = 'mx-auto flex w-full max-w-7xl flex-1 flex-col page-back-room-7xl';

/** The password, then the space read again — its answer is what the screen shows next. */
async function openSharedSpace(token: string, ownerId: number, password: string, signal: AbortSignal) {
  await verifySharedPrivacyPassword(token, ownerId, password);
  signal.throwIfAborted();
  if (readToken() !== token) throw new DOMException('session changed', 'AbortError');
  return sharedPrivacyFaves.read({ token, ownerId }, { force: true });
}

function GateSkeleton() {
  return (
    <div className={COLUMN} data-page-loading="">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
      </div>
      <Card variant="filled" padding="lg" className="mx-auto flex w-full max-w-md flex-col items-center gap-3">
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-14 w-full" />
      </Card>
    </div>
  );
}

/**
 * Somebody's privacy space, shared with you — what a privacy share card opens and the original
 * front end's `#shared_privacy:<id>` links lead to. Signed in only (the original refused a
 * signed-out visitor before asking). It reads `get_shared_privacy_faves`; behind the owner's
 * password, it asks for it (`verify_shared_privacy_password`) and reads again.
 *
 * An owner who does not exist, an owner with no password set, a wrong password and a read that
 * failed are four different answers. The password is the owner's, not yours: the field asks no
 * password manager to fill or keep it, and it is emptied once sent. The pictures are held in
 * memory only, like every read (signing out drops them all).
 */
export default function SharedPrivacyScreen({ ownerId }: { ownerId: number }) {
  const { ready, token, user } = useSession();
  const back = useBackOrParent('/');
  useEscapeBack(back);
  const pageBack = <PageBack onClick={back} />;

  if (!ready) {
    return (
      <>
        {pageBack}
        <GateSkeleton />
      </>
    );
  }
  if (!token) {
    return (
      <>
        {pageBack}
        <div className={COLUMN}>
          <SignInRequired description="登录后即可查看对方分享给你的隐私空间" />
        </div>
      </>
    );
  }
  if (Number(user?.id) === ownerId) {
    return (
      <>
        {pageBack}
        <div className={COLUMN}>
          <OwnSpace />
        </div>
      </>
    );
  }
  return <SharedSpace key={`${token}:${ownerId}`} token={token} ownerId={ownerId} pageBack={pageBack} />;
}

/** Your own space's link, followed: it lives on /favorites, behind your own password. */
function OwnSpace() {
  const router = useRouter();
  const showPrivacy = useSyncedSetting('showPrivacyFaves');
  return (
    <EmptyState
      fill
      icon={<MdLock size={ICON.display} />}
      title="这是你自己的隐私空间"
      description={showPrivacy ? '在我的收藏中查看和管理' : '在设置中开启显示隐私空间后，可在我的收藏中查看'}
      action={
        <Button variant="tonal" onClick={() => router.push(showPrivacy ? favoritesHref('privacy') : '/settings', { scroll: false })}>
          {showPrivacy ? '前往我的隐私空间' : '前往设置'}
        </Button>
      }
    />
  );
}

function SharedSpace({ token, ownerId, pageBack }: { token: string; ownerId: number; pageBack: React.ReactNode }) {
  const read = useResource(sharedPrivacyFaves, { token, ownerId }, { refetchInterval: 30_000 });
  const owner = useResource(userProfile, { id: String(ownerId) });
  const ownerName = owner.data?.username ?? null;
  // The resource pauses publication in a hidden document. Conceal its old snapshot locally as
  // well, until a new access answer replaces it; otherwise it can flash on return.
  const [concealedAnswer, setConcealedAnswer] = useState<SharedPrivacyAnswer | null>(null);
  const answer = read.error || read.data === concealedAnswer ? undefined : read.data;
  const images = answer?.state === 'open' ? answer.images : null;
  const [page, setPage] = useScreenStateFor('favorites:shared-privacy', ownerId, 1);
  const listKey = `fave-shared-privacy:${token}:${ownerId}`;
  const rules = useDeviceRules();
  const allowed = useMemo(() => images ? rules.withhold(images, images.map((image) => image.id)).images : [], [images, rules]);
  useEffect(() => {
    const args = { token, ownerId };
    const conceal = () => {
      setConcealedAnswer(sharedPrivacyFaves.peek(args).data ?? null);
      clearImageSequence(listKey);
      if (readToken() === token) sharedPrivacyFaves.write(args, { state: 'locked', message: null });
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') sharedPrivacyFaves.expire(args);
      else conceal();
    };
    sharedPrivacyFaves.expire(args);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', conceal);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', conceal);
      conceal();
    };
  }, [token, ownerId, listKey]);
  const state = useLocalFavePage({ images, page, setPage, listKey });
  if (images && page > state.totalPages) setPage(state.totalPages);
  /* Somebody else's space: download, and nothing that writes — every write in the batch is to the
     signed-in account's own space (G3-020). */
  const batch = usePictureBatch({ token, source: { kind: 'shared-privacy' } });
  useDocumentTitle(ownerName ? `${ownerName} 的隐私空间 - PicPony` : null);

  /* The password giving way to the pictures (and a re-lock giving way back) swaps the column's
     face on the pane swap's keyframe — it was one frame (M1-011). Not the first answer's face:
     that is a placeholder resolving, and arrives with the route. */
  const face = answer?.state ?? (read.error ? 'failed' : 'loading');
  const [seenFace, setSeenFace] = useState(face);
  const [swapped, setSwapped] = useState(false);
  if (seenFace !== face) {
    setSeenFace(face);
    setSwapped(seenFace !== 'loading');
  }
  const swap = cn(COLUMN, swapped && 'animate-page-transition');

  const title = ownerName ? `${ownerName} 的隐私空间` : '隐私空间';

  if (owner.data === null || isNotFound(owner.error)) {
    return <>{pageBack}<div className={COLUMN}><EmptyState fill icon={<MdPersonOff size={ICON.display} />} title="用户不存在" /></div></>;
  }

  if (answer === undefined) {
    if (!read.error) {
      return (
        <>
          {pageBack}
          <GateSkeleton />
        </>
      );
    }
    return (
      <>
        {pageBack}
        <div className={COLUMN}>
          {isNotFound(read.error) ? (
            <EmptyState fill icon={<MdPersonOff size={ICON.display} />} title="用户不存在" description="分享该隐私空间的用户不存在或已注销" />
          ) : (
            <ErrorRetry
              fill
              title="隐私空间加载失败"
              message={apiErrorMessage(read.error)}
              onRetry={isRetryable(read.error) ? read.refresh : undefined}
            />
          )}
        </div>
      </>
    );
  }

  if (answer.state === 'no-password') {
    return (
      <>
        {pageBack}
        <div className={COLUMN}>
          <EmptyState
            fill
            icon={<MdNoEncryption size={ICON.display} />}
            title="对方还没有设置隐私空间"
            description={answer.message ?? '对方设置隐私密码后，才能查看其中的图片'}
          />
        </div>
      </>
    );
  }

  if (answer.state === 'locked') {
    return (
      <>
        {pageBack}
        <div key="locked" className={swap}>
          <PageHeader title={title} />
          <SharedUnlockForm token={token} ownerId={ownerId} ownerName={ownerName} message={answer.message} />
        </div>
      </>
    );
  }

  const list = answer.images;
  return (
    <>
      {pageBack}
      <div key="open" className={swap}>
        <PageHeader
          title={title}
          subtitle={<span className="tabular-nums">共 {formatCount(list.length)} 张</span>}
          actions={
            allowed.length > 0 ? (
              <Button variant="tonal" icon={<MdDownload />} loading={batch.busy} onClick={() => void batch.download(allowed)}>
                下载全部
              </Button>
            ) : undefined
          }
        />
        <div data-pagination-anchor="">
          <FaveGridView
            state={state}
            page={page}
            setPage={setPage}
            listKey={listKey}
            failureTitle="隐私空间加载失败"
            empty={<EmptyState size="pane" icon={<MdLock size={ICON.display} />} title="此隐私空间还没有图片" />}
          />
        </div>
      </div>
      {batch.dialogs}
    </>
  );
}

/**
 * The owner's password. `autoComplete="off"` and no username beside it: this is somebody else's
 * secret, and a password manager has nothing of yours to fill in or keep here.
 */
function SharedUnlockForm({
  token,
  ownerId,
  ownerName,
  message,
}: {
  token: string;
  ownerId: number;
  ownerName: string | null;
  message: string | null;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => { pending.current?.abort(); }, []);
  const form = useFieldErrors<'password'>(() => [['password', validateRequired(password, '请输入隐私密码')]]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !form.check()) return;
    setBusy(true);
    const controller = new AbortController();
    pending.current = controller;
    const outcome = await settled(openSharedSpace(token, ownerId, password, controller.signal));
    setBusy(false);
    setPassword('');
    if (readToken() !== token) return;
    if (outcome.ok) {
      if (outcome.value.state !== 'open') form.set('password', outcome.value.message ?? '密码错误');
    } else if (isApiError(outcome.error) && outcome.error.kind === 'envelope') {
      form.set('password', apiErrorMessage(outcome.error, '密码错误'));
    } else if (!isAborted(outcome.error)) {
      showToast(apiErrorMessage(outcome.error, '解锁失败'), 'error');
    }
  };

  return (
    <GateCard
      icon={<MdLock size={ICON.display} />}
      title="需要隐私密码"
      description={message ?? `输入${ownerName ? ` ${ownerName} ` : '对方'}告诉你的隐私密码以查看`}
    >
      <form onSubmit={submit} noValidate autoComplete="off" className="flex flex-col gap-4">
        <Input
          {...form.field('password')}
          label="隐私密码"
          type="password"
          revealable
          autoComplete="off"
          data-autofocus=""
          value={password}
          readOnly={busy}
          onChange={(event) => {
            setPassword(event.target.value);
            form.clear('password');
          }}
        />
        <Button type="submit" variant="filled" icon={<MdLockOpen />} loading={busy} className="self-end">
          解锁
        </Button>
      </form>
    </GateCard>
  );
}
