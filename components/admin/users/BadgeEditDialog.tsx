'use client';

import { useState } from 'react';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { AdminForm } from '../AdminForm';
import ColorField, { isHexColor } from '../ColorField';
import { Input } from '@/components/Input';
import type { AdminUserBadge } from './rules';

/**
 * Rename or recolour one badge a user holds (`admin_edit_badge`) — the original console edited a
 * user's badges inside the user editor, which is where the badge ids come from; the console's
 * permanently empty 「已有徽章列表」 table had no endpoint to fill it (R9-016).
 *
 * Mounted with a `key` per badge, so each opening starts from that badge's values.
 */
export default function BadgeEditDialog({
  badge,
  owner,
  open,
  saving,
  onClose,
  onSave,
}: {
  badge: AdminUserBadge | null;
  owner: string;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (values: { name: string; color: string }) => void;
}) {
  const [name, setName] = useState(badge?.name ?? '');
  const [color, setColor] = useState(badge?.color || '#f1c40f');
  const [errors, setErrors] = useState<{ name?: string; color?: string }>({});
  const formId = `badge-edit-${badge?.id ?? 'none'}`;

  const submit = () => {
    if (saving) return;
    const next = {
      name: name.trim() ? undefined : '请输入徽章名称',
      color: isHexColor(color) ? undefined : '请输入 #RRGGBB 格式的颜色',
    };
    setErrors(next);
    if (next.name || next.color) return;
    onSave({ name: name.trim(), color });
  };

  return (
    <Modal
      isOpen={open}
      onClose={() => { if (!saving) onClose(); }}
      closeOnEscape={!saving}
      title="编辑徽章"
      maxWidth="md"
      footer={
        <>
          <Button type="button" variant="text" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" form={formId} variant="filled" loading={saving}>
            保存
          </Button>
        </>
      }
    >
      <AdminForm id={formId} onSubmit={submit} className="max-w-none" aria-label={`编辑 ${owner} 的徽章`}>
        <Input
          label="徽章名称"
          value={name}
          readOnly={saving}
          error={errors.name}
          onChange={(event) => {
            setName(event.target.value);
            setErrors((previous) => ({ ...previous, name: undefined }));
          }}
          data-autofocus=""
        />
        <ColorField
          label="徽章颜色"
          value={color}
          disabled={saving}
          error={errors.color}
          onChange={(value) => {
            setColor(value);
            setErrors((previous) => ({ ...previous, color: undefined }));
          }}
        />
      </AdminForm>
    </Modal>
  );
}
