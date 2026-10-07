'use client';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { deleteBadgeLink } from '@/lib/api/adminCatalogTools';
import { useCatalogMutation } from './useCatalogMutation';
import MutationResult from './MutationResult';

export default function DeleteBadgeLinkAction({ token, id, name, disabled, onDeleted }: { token: string; id: number; name: string; disabled?: boolean; onDeleted: () => void }) {
  const mutation = useCatalogMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  return <><Button size="xs" variant="danger-text" loading={mutation.busy} disabled={disabled || mutation.uncertain} onClick={() => confirmThen('确认删除领取链接', `确定要永久删除徽章「${name}」的领取链接 #${id} 吗？删除后不能恢复。`, () => void mutation.run(() => deleteBadgeLink(token, id), () => showToast('已删除领取链接', 'success'), onDeleted))}>删除</Button><MutationResult mutation={mutation} />{confirmDialog}</>;
}
