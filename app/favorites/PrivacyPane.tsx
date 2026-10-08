'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  MdChecklist, MdDeselect, MdDownload, MdDriveFileMove, MdFileCopy, MdLock, MdLockOutline,
  MdMoreVert, MdPassword, MdRemoveCircleOutline, MdSelectAll, MdSend, MdSettings,
} from 'react-icons/md';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { FAVE_PAGE_SIZE } from '@/lib/favorites';
import { checkPrivacy, enterPrivacyScreen, lockPrivacy, reloadPrivacy, usePrivacySpace, type PrivacyStatus } from '@/lib/favoritesPrivacy';
import { useSelectionMode } from '@/lib/favoritesSelection';
import { useScreenStateFor } from '@/lib/screenState';
import { useSession } from '@/lib/hooks';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';
import type { PonyImage } from '@/lib/types/image';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import IconButton from '@/components/IconButton';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import Menu from '@/components/Menu';
import Skeleton from '@/components/Skeleton';
import { useShareToContact } from '@/components/ShareToContactDialog';
import SelectionBar, { type SelectionCommand } from '@/components/favorites/SelectionBar';
import { FaveGridView, useDeviceRules, useLocalFavePage } from '@/components/favorites/FaveGrid';
import { usePictureBatch } from '@/components/favorites/usePictureBatch';
import { PrivacyCreateForm, PrivacyPasswordDialog, PrivacyResetDialog, PrivacySettingsDialog, PrivacyUnlockForm } from '@/components/favorites/PrivacyForms';

function GateSkeleton() {
  return (
    <Card variant="filled" padding="lg" className="mx-auto flex w-full max-w-md flex-col items-center gap-3" data-page-loading="">
      <Skeleton className="size-12 rounded-full" />
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-2 h-14 w-full" />
    </Card>
  );
}

/** Which face of the space is up — what the pane swaps between. */
function viewOf(status: PrivacyStatus): 'loading' | 'failed' | 'create' | 'locked' | 'open' {
  if (status === 'unknown' || status === 'checking') return 'loading';
  if (status === 'check-failed' || status === 'list-failed') return 'failed';
  if (status === 'no-password') return 'create';
  if (status === 'locked') return 'locked';
  return 'open';
}

/**
 * The gate owns the memory lease. Only the open child holds picture selections and dialogs, so
 * locking destroys those references as well as the store's list. A confirming read keeps that
 * child and its grid; it is not another first load. A foreground picture is another route too:
 * the covered privacy list stops presence until it is shown again.
 *
 * **Unlocking and locking swap the pane's face** (M1-011): the arriving one fades in on the pane
 * swap's keyframe — the tier's, not the entrance switch's, since the user asked for it — where the
 * gate and the grid used to replace each other in one frame. Not on the pane's first face, which
 * arrives with the pane, and never a `Reveal` (a tab pane owns its contents' entrance).
 */
export default function PrivacyPane({ token, active }: { token: string; active: boolean }) {
  const { user } = useSession();
  const pathname = usePathname();
  const viewing = active && pathname === '/favorites';
  const username = typeof user?.username === 'string' ? user.username : '';
  const ownerId = Number(user?.id);
  const space = usePrivacySpace(token);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    if (viewing && space.status === 'unknown') void checkPrivacy(token);
  }, [viewing, space.status, token]);
  useEffect(() => viewing ? enterPrivacyScreen(token) : undefined, [viewing, token]);

  const view = viewOf(space.status);
  const [seen, setSeen] = useState(view);
  const [swapped, setSwapped] = useState(false);
  if (seen !== view) {
    setSeen(view);
    /* Its first read giving way to its first face is a placeholder resolving, not a swap. */
    setSwapped(seen !== 'loading');
  }

  let face: ReactNode;
  if (view === 'loading') face = <GateSkeleton />;
  else if (view === 'failed') {
    face = <ErrorRetry size="pane" title="隐私空间加载失败" message={apiErrorMessage(space.error)}
      onRetry={isRetryable(space.error) ? () => void reloadPrivacy(token) : undefined} />;
  } else if (view === 'create') face = <PrivacyCreateForm token={token} username={username} />;
  else if (view === 'locked') {
    face = <PrivacyUnlockForm token={token} username={username} autoLocked={space.autoLocked} onForgot={() => setResetOpen(true)} />;
  } else if (!space.images) face = <ImageGridSkeleton count={FAVE_PAGE_SIZE} entrance={false} />;
  else {
    face = <OpenPrivacy token={token} username={username} ownerId={ownerId} active={viewing}
      images={space.images} error={space.error} />;
  }
  /* The reset dialog outlives the face it was opened from: a reset that succeeds turns the pane to
     创建 in the commit that closes the dialog, and inside the locked face it was unmounted there
     instead of leaving on its own exit. A portalled `Modal`, so where it sits changes no layout. */
  return <>
    <div key={view} className={cn(swapped && 'animate-page-transition')}>{face}</div>
    <PrivacyResetDialog open={resetOpen} token={token} username={username} onClose={() => setResetOpen(false)} />
  </>;
}

function OpenPrivacy({ token, username, ownerId, active, images, error }: {
  token: string;
  username: string;
  ownerId: number;
  active: boolean;
  images: readonly PonyImage[];
  error: unknown;
}) {
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLButtonElement>(null);
  const { share, shareDialog } = useShareToContact();
  const [page, setPage] = useScreenStateFor('favorites:privacy', token, 1);
  const listKey = `fave-privacy:${token}`;
  const state = useLocalFavePage({ images, page, setPage, listKey });
  if (page > state.totalPages) setPage(state.totalPages);
  const rules = useDeviceRules();
  const allowed = useMemo(() => rules.withhold(images, images.map((image) => image.id)).images, [images, rules]);
  const pageOrder = useMemo(() => (state.shown?.images ?? []).map((image) => image.id), [state.shown]);
  const selection = useSelectionMode({ order: pageOrder, restoreFocus: () => selectRef.current });
  const { exit, forget, enter } = selection;
  const settled = useCallback((left: number[]) => { forget(left); exit(); }, [forget, exit]);
  const batch = usePictureBatch({ token, source: { kind: 'privacy' }, onSettled: settled });
  const gridSelection = useMemo(() => ({ active: selection.active, selected: selection.selected,
    onToggle: selection.toggle, onLongPress: enter }), [selection.active, selection.selected, selection.toggle, enter]);
  useEffect(() => { if (!active) exit(); }, [active, exit]);
  useEffect(() => { exit(); }, [rules.fp, exit]);
  useEffect(() => {
    const ids = new Set(allowed.map((image) => image.id));
    forget([...selection.selected].filter((id) => !ids.has(id)));
  }, [allowed, forget, selection.selected]);

  const selected = allowed.filter((image) => selection.selected.has(image.id));
  const allSelected = pageOrder.length > 0 && pageOrder.every((id) => selection.selected.has(id));
  const unavailable = selected.length === 0 || batch.busy;
  const barCommands: SelectionCommand[] = [
    { value: 'all', label: allSelected ? '取消全选' : '全选', icon: allSelected ? <MdDeselect /> : <MdSelectAll />,
      onSelect: () => selection.setMany(pageOrder, !allSelected), disabled: pageOrder.length === 0 || batch.busy },
    { value: 'move', label: '移动到…', icon: <MdDriveFileMove />, onSelect: () => batch.openTransfer('move', selected), disabled: unavailable },
    { value: 'copy', label: '复制到…', icon: <MdFileCopy />, onSelect: () => batch.openTransfer('copy', selected), disabled: unavailable },
    { value: 'remove', label: '移出隐私空间', icon: <MdRemoveCircleOutline />, destructive: true,
      onSelect: () => void batch.remove(selected), disabled: unavailable },
    { value: 'download', label: '下载', icon: <MdDownload />, onSelect: () => void batch.download(selected), disabled: unavailable },
    { value: 'share', label: '分享', icon: <MdSend />, onSelect: () => selected[0] && batch.shareOne(selected[0]), disabled: selected.length !== 1 || batch.busy },
  ];
  const menuItems = [
    { value: 'password', label: '修改隐私密码', icon: <MdPassword /> },
    { value: 'share', label: '分享空间', icon: <MdSend />, disabled: !username || !Number.isSafeInteger(ownerId) || ownerId < 1 },
    { value: 'download', label: '下载全部', icon: <MdDownload />, disabled: allowed.length === 0 || batch.busy },
    { value: 'settings', label: '隐私空间设置', icon: <MdSettings /> },
  ];
  const onMenu = (value: string) => {
    if (value === 'password') setPasswordOpen(true);
    else if (value === 'share') share({ kind: 'privacy-space', ownerId, ownerName: username });
    else if (value === 'download') void batch.download(allowed);
    else if (value === 'settings') setSettingsOpen(true);
  };

  return (
    <div data-pagination-anchor="">
      {/* The 收藏夹 pane's row: one row at every width, the actions their glyphs below `sm`, so the
          mode hiding them never leaves a blank band (D1-014). */}
      <div className="mb-4 flex min-h-10 items-center gap-4">
        <p className="min-w-0 flex-1 text-body-m text-on-surface-variant tabular-nums">共 {formatCount(images.length)} 张</p>
        {/* Out of the mode's way on the bar's own clock, never in one frame (M1-002). */}
        <div
          inert={selection.active}
          className={cn('flex shrink-0 items-center gap-2 transition-opacity spring-fast-effects', selection.active && 'opacity-0')}
        >
          <Button ref={selectRef} variant="text" icon={<MdChecklist />} onClick={() => enter()} disabled={allowed.length === 0} responsiveLabel>
            选择
          </Button>
          <Button variant="tonal" icon={<MdLockOutline />} onClick={() => lockPrivacy(token)} responsiveLabel>
            锁定
          </Button>
          <IconButton ref={menuRef} icon={<MdMoreVert />} aria-label="隐私空间的更多操作" tooltip="更多操作"
            aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)} />
          <Menu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef}
            aria-label="隐私空间的更多操作" items={menuItems} onSelect={onMenu} />
        </div>
      </div>
      {error != null && <ErrorRetry size="inline" title="隐私空间更新失败" message={apiErrorMessage(error)}
        onRetry={isRetryable(error) ? () => void reloadPrivacy(token) : undefined} />}
      <FaveGridView state={state} page={page} setPage={setPage} listKey={listKey} selection={gridSelection}
        entrance={false} failureTitle="隐私空间加载失败" empty={
          <EmptyState size="pane" icon={<MdLock size={ICON.display} />} title="隐私空间还没有图片"
            description="选择收藏夹里的图片后移入，就会出现在这里" />
        } />
      <SelectionBar active={selection.active} count={selection.count} unit="张" label="隐私空间多选" commands={barCommands} onExit={exit} />
      <PrivacyPasswordDialog open={passwordOpen} token={token} username={username} onClose={() => setPasswordOpen(false)} />
      <PrivacySettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {batch.dialogs}
      {shareDialog}
    </div>
  );
}
