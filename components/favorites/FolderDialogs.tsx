'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { MdCreateNewFolder } from 'react-icons/md';
import Modal from '@/components/Modal';
import dynamic from 'next/dynamic';
import Button from '@/components/Button';
import Checkbox from '@/components/Checkbox';
import Radio from '@/components/Radio';
import { Input } from '@/components/Input';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { showToast } from '@/components/Toast';
import { apiErrorMessage, isApiError } from '@/lib/api/errors';
import type { FaveFolder } from '@/lib/api/favorites';
import { createFolder } from '@/lib/favoritesActions';
import { folderLabel, settled } from '@/lib/favorites';
import { formatCount } from '@/lib/format';
import { readToken, useMediaQuery } from '@/lib/hooks';
import { MEDIA } from '@/lib/constants';

const Sheet = dynamic(() => import('@/components/Sheet'), { ssr: false, loading: () => null });

/**
 * A choice surface: a bottom sheet on a phone, a dialog from `sm` up — one component, so a list of
 * folders is the same list in both. The sheet has no footer of its own, so the action row is
 * sticky at the foot of its body: it never scrolls away with a long list.
 *
 * **A surface leaves showing what it showed** (M1-008, M1-009). Every caller keeps its content —
 * its read, its title, its choices — for the length of the exit and resets on `onExited`, never in
 * the commit that closes it: reset there, the picker collapsed to its skeleton and the transfer
 * read 移动 0 张到… while they were visibly on their way out.
 */
export function ChoiceSurface({
  isOpen,
  onClose,
  onExited,
  title,
  children,
  actions,
  busy = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Once the exit has played — where a caller lets go of what the surface was showing. */
  onExited?: () => void;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  /** A write in flight: the surface cannot be dismissed (Back is swallowed rather than obeyed). */
  busy?: boolean;
}) {
  const wide = useMediaQuery(MEDIA.sm, true);
  const [opened, setOpened] = useState(false);
  if (isOpen && !opened) setOpened(true);
  if (!opened && !isOpen) return null;
  if (!wide) {
    return (
      <Sheet isOpen={isOpen} onClose={onClose} onExited={onExited} title={title} closeOnEscape={!busy} closeOnOverlayClick={!busy}>
        {children}
        <div className="sticky bottom-0 mt-2 flex flex-wrap justify-end gap-3 bg-surface-container-low pt-3 pb-1">{actions}</div>
      </Sheet>
    );
  }
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onExited={onExited}
      title={title}
      maxWidth="sm"
      closeOnEscape={!busy}
      closeOnOverlayClick={!busy}
      footer={actions}
    >
      {children}
    </Modal>
  );
}

/** One folder as a row of a choice list: its name and how many pictures it holds. */
function FolderRowLabel({ folder }: { folder: FaveFolder }) {
  return (
    <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <span className="truncate text-body-l text-on-surface">{folderLabel(folder)}</span>
      <span className="shrink-0 text-body-s text-on-surface-variant tabular-nums">{formatCount(folder.itemCount)} 张</span>
    </span>
  );
}

/** Folders as checkboxes — the picker's and the transfer's list. */
export function FolderChecklist({
  folders,
  checked,
  onChange,
  disabled = false,
}: {
  folders: readonly FaveFolder[];
  checked: ReadonlySet<number>;
  onChange: (folderId: number, on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="flex flex-col">
      {folders.map((folder) => (
        <li key={folder.id} className="flex min-h-12 items-center">
          <Checkbox
            className="w-full py-2"
            checked={checked.has(folder.id)}
            disabled={disabled}
            onChange={(on) => onChange(folder.id, on)}
            label={<FolderRowLabel folder={folder} />}
          />
        </li>
      ))}
    </ul>
  );
}

/** Folders as radio buttons — one target: the merge's, the default folder's, an import's. */
export function FolderRadioList({
  folders,
  value,
  onChange,
  name,
  disabled = false,
}: {
  folders: readonly FaveFolder[];
  value: number | null;
  onChange: (folderId: number) => void;
  name: string;
  disabled?: boolean;
}) {
  return (
    <ul className="flex flex-col">
      {folders.map((folder) => (
        <li key={folder.id} className="flex min-h-12 items-center">
          <Radio
            className="w-full py-2"
            name={name}
            value={String(folder.id)}
            checked={value === folder.id}
            disabled={disabled}
            onChange={() => onChange(folder.id)}
            label={<FolderRowLabel folder={folder} />}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * 新建收藏夹, inline at the foot of a folder list: a name and 创建. The backend's refusal (a name
 * taken, too long) is the field's error; the new folder is handed to `onCreated`, which checks it.
 */
export function NewFolderRow({
  token,
  onCreated,
  disabled = false,
  onBusyChange,
}: {
  token: string;
  onCreated: (folder: FaveFolder) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const value = name.trim();
    if (busy || disabled || !value) return;
    setBusy(true);
    onBusyChange?.(true);
    const outcome = await settled(createFolder(token, value));
    setBusy(false);
    onBusyChange?.(false);
    if (readToken() !== token) return;
    if (outcome.ok) {
      setName('');
      setError(null);
      if (outcome.value) onCreated(outcome.value);
      showToast(outcome.value ? `已创建「${value}」` : `已创建「${value}」，收藏夹列表更新失败`, outcome.value ? 'success' : 'warning');
    } else if (isApiError(outcome.error) && outcome.error.kind === 'envelope') {
      setError(apiErrorMessage(outcome.error, '创建失败'));
    } else {
      showToast(apiErrorMessage(outcome.error, '创建失败'), 'error');
    }
  };

  return (
    <form id={formId} onSubmit={submit} noValidate className="mt-2 flex items-start gap-2">
      <Input
        size="sm"
        aria-label="新收藏夹名称"
        placeholder="新收藏夹名称"
        value={name}
        error={error ?? undefined}
        readOnly={busy}
        disabled={disabled}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        enterKeyHint="done"
        autoComplete="off"
      />
      <Button
        type="submit"
        variant="tonal"
        icon={<MdCreateNewFolder />}
        loading={busy}
        disabled={disabled || !name.trim()}
      >
        创建
      </Button>
    </form>
  );
}

/**
 * 移动到… / 复制到… — the target folders of a batch, as checkboxes (one picture may go to several),
 * with 新建收藏夹 at the foot. `onConfirm` runs the transfer; the surface stays up, busy, until it
 * settles, and closes when it succeeds. The ticks stay as they were for the exit and clear once
 * it has played; the caller keeps `mode`, `count` and the list for it too (`onExited`).
 */
export function TransferDialog({
  open,
  mode,
  count,
  folders,
  loading = false,
  error,
  onRetry,
  token,
  onClose,
  onExited,
  onConfirm,
}: {
  open: boolean;
  mode: 'move' | 'copy';
  count: number;
  /** The folders a picture may go to: every ordinary folder but the one it is being taken from. */
  folders: readonly FaveFolder[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  token: string;
  onClose: () => void;
  /** Once the exit has played: the caller lets go of what it kept for it. */
  onExited?: () => void;
  onConfirm: (targetIds: number[]) => Promise<boolean>;
}) {
  const [targets, setTargets] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const verb = mode === 'move' ? '移动' : '复制';
  const validTargets = folders.filter((folder) => targets.has(folder.id)).map((folder) => folder.id);

  const close = () => {
    if (busy || creating) return;
    onClose();
  };
  const exited = () => {
    setTargets(new Set());
    onExited?.();
  };
  const toggle = (id: number, on: boolean) =>
    setTargets((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const confirm = async () => {
    if (busy || creating || validTargets.length === 0) return;
    setBusy(true);
    /* In the list's own order, so the summary reads as the list does. */
    await settled(onConfirm(validTargets));
    setBusy(false);
  };

  return (
    <ChoiceSurface
      isOpen={open}
      onClose={close}
      onExited={exited}
      title={`${verb} ${count} 张到…`}
      busy={busy || creating}
      actions={
        <>
          <Button variant="text" onClick={close} disabled={busy || creating}>
            取消
          </Button>
          <Button variant="filled" onClick={confirm} loading={busy} disabled={creating || validTargets.length === 0 || loading || Boolean(error)}>
            {verb}
          </Button>
        </>
      }
    >
      {error ? <ErrorRetry size="inline" title="收藏夹加载失败" message={apiErrorMessage(error)} onRetry={onRetry} /> : loading ? (
        <div aria-hidden="true" className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      ) : folders.length === 0 ? (
        <EmptyState size="inline" title="还没有其他收藏夹，先新建一个" />
      ) : (
        <FolderChecklist folders={folders} checked={targets} onChange={toggle} disabled={busy} />
      )}
      <NewFolderRow token={token} disabled={busy || loading || Boolean(error)} onBusyChange={setCreating} onCreated={(folder) => toggle(folder.id, true)} />
    </ChoiceSurface>
  );
}

/**
 * 合并到… — the original front end's rule: the target is one of the selected folders (the first
 * preselected), and the others are merged into it and go away. The list and the choice it opened
 * with are held for the exit: the selection they come from is gone by then (the mode ends with the
 * merge), and the chosen radio jumped back to the first row as the dialog left (M1-009).
 */
export function MergeDialog({
  open,
  folders: offered,
  onClose,
  onConfirm,
}: {
  open: boolean;
  /** The selected folders, at least two. */
  folders: readonly FaveFolder[];
  onClose: () => void;
  onConfirm: (targetId: number) => Promise<boolean>;
}) {
  const [folders, setFolders] = useState(offered);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /* Followed while the choice is being made; held once it is being carried out and for the exit. */
  if (open && !busy && folders !== offered) setFolders(offered);
  const target = chosen !== null && folders.some((folder) => folder.id === chosen) ? chosen : (folders[0]?.id ?? null);
  const radioName = useId();

  const close = () => {
    if (busy) return;
    onClose();
  };
  const confirm = async () => {
    if (busy || target === null) return;
    setBusy(true);
    await settled(onConfirm(target));
    setBusy(false);
  };
  const others = folders.length - 1;

  return (
    <ChoiceSurface
      isOpen={open}
      onClose={close}
      onExited={() => setChosen(null)}
      title="合并收藏夹"
      busy={busy}
      actions={
        <>
          <Button variant="text" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="filled" onClick={confirm} loading={busy} disabled={target === null}>
            合并
          </Button>
        </>
      }
    >
      <p className="mb-2 text-body-m text-on-surface-variant">
        选择保留的收藏夹。其余 {others} 个收藏夹的图片将并入其中，合并后它们将被删除。
      </p>
      <FolderRadioList folders={folders} value={target} onChange={setChosen} name={radioName} disabled={busy} />
    </ChoiceSurface>
  );
}

/** One folder from the list, as a dialog: the default folder's choice (`/settings`). */
export function FolderChoiceDialog({
  open,
  title,
  folders,
  loading = false,
  value,
  confirmLabel = '确认',
  error,
  onRetry,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  folders: readonly FaveFolder[];
  /** The list is on its way: rows of its shape stand in. */
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  value: number | null;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (folderId: number) => void;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const shown = chosen ?? value;
  const radioName = useId();
  /* The choice stays on screen while the dialog leaves and clears once it has (M1-009): cleared on
     close, the radio jumped back to the stored folder in the exit's first frame. */
  return (
    <ChoiceSurface
      isOpen={open}
      onClose={onClose}
      onExited={() => setChosen(null)}
      title={title}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="filled"
            disabled={shown === null || loading || Boolean(error)}
            onClick={() => {
              if (shown === null) return;
              onConfirm(shown);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error ? <ErrorRetry size="inline" title="收藏夹加载失败" message={apiErrorMessage(error)} onRetry={onRetry} /> : loading ? (
        <ul className="flex flex-col" aria-hidden="true">
          {Array.from({ length: 3 }, (_, row) => (
            <li key={row} className="flex min-h-12 items-center gap-4">
              <Skeleton className="size-5 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-3.5 w-10" />
            </li>
          ))}
        </ul>
      ) : (
        <FolderRadioList folders={folders} value={shown} onChange={setChosen} name={radioName} />
      )}
    </ChoiceSurface>
  );
}
