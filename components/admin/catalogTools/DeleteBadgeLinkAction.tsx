'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { deleteBadgeLink } from '@/lib/api/adminCatalogTools';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

interface DeleteScopeValue {
  busyId: number | null;
  busy: boolean;
  uncertain: boolean;
  remove: (id: number, name: string) => void;
}

const DeleteScopeContext = createContext<DeleteScopeValue | null>(null);

/**
 * Owns badge-link deletion above the links `DataTable` so `<MutationResult>` renders full-width
 * above the table rather than blowing out the table's `auto` actions track.
 */
export function BadgeLinkDeleteScope({ token, onDeleted, children }: { token: string; onDeleted: () => void; children: ReactNode }) {
  const mutation = useCatalogMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const [busyId, setBusyId] = useState<number | null>(null);
  const remove = (id: number, name: string) => {
    confirmThen(
      '确认删除领取链接',
      `确定要永久删除徽章「${name}」的领取链接 #${id} 吗？此操作无法恢复。`,
      () => {
        setBusyId(id);
        void mutation
          .run(() => deleteBadgeLink(token, id), () => showToast('已删除领取链接', 'success'), onDeleted)
          .finally(() => setBusyId((current) => (current === id ? null : current)));
      },
      { tone: 'danger' },
    );
  };
  return (
    <DeleteScopeContext.Provider value={{ busyId, busy: mutation.busy, uncertain: mutation.uncertain, remove }}>
      <MutationResult mutation={mutation} />
      {children}
      {confirmDialog}
    </DeleteScopeContext.Provider>
  );
}

export default function DeleteBadgeLinkAction({ token, id, name, disabled, onDeleted }: { token: string; id: number; name: string; disabled?: boolean; onDeleted: () => void }) {
  const scope = useContext(DeleteScopeContext);
  const fallbackMutation = useCatalogMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  if (scope) {
    return (
      <Button
        size="xs"
        variant="danger-text"
        loading={scope.busy && scope.busyId === id}
        disabled={disabled || scope.uncertain || (scope.busy && scope.busyId !== id)}
        onClick={() => scope.remove(id, name)}
      >
        删除
      </Button>
    );
  }
  return (
    <>
      <Button
        size="xs"
        variant="danger-text"
        loading={fallbackMutation.busy}
        disabled={disabled || fallbackMutation.uncertain}
        onClick={() => confirmThen('确认删除领取链接', `确定要永久删除徽章「${name}」的领取链接 #${id} 吗？此操作无法恢复。`, () => void fallbackMutation.run(() => deleteBadgeLink(token, id), () => showToast('已删除领取链接', 'success'), onDeleted), { tone: 'danger' })}
      >
        删除
      </Button>
      <MutationResult mutation={fallbackMutation} />
      {confirmDialog}
    </>
  );
}
