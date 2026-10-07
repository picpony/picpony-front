'use client';

import { useMemo, useRef, useState } from 'react';
import { MdSell } from 'react-icons/md';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import Modal from '@/components/Modal';
import PendingTagsPicker from '@/components/groups/PendingTagsPicker';
import TagComboField, { type TagComboFieldHandle } from '@/components/groups/TagComboField';
import TagWell from '@/components/groups/TagWell';
import { MAX_TAG_GROUP_NAME, MAX_TAGS_PER_TAG_GROUP, type TagGroup } from '@/lib/api/tagGroups';
import { ICON } from '@/lib/icons';

export interface TagGroupDraft {
  id: number | null;
  name: string;
  tags: string[];
}

export function draftOf(group: TagGroup | null): TagGroupDraft {
  return { id: group?.id ?? null, name: group?.name ?? '', tags: [...(group?.tags ?? [])] };
}

export interface TagGroupInput {
  id: number | null;
  name: string;
  tags: string[];
}

interface TagGroupEditorProps {
  isOpen: boolean;
  initial: TagGroupDraft;
  saving: boolean;
  onSave: (input: TagGroupInput) => void;
  onClose: () => void;
}

/**
 * 新建 / 编辑标签组 — a name, the shared tag field (the block-group editor's own, so one combobox
 * behaves one way everywhere), the group's tags against their cap of 50, and the 待定标签库 when it
 * holds anything — the original front end's editor, field for field.
 *
 * Validation is the fields' own: a missing name is the name field's error, an empty group and a
 * full one are said under the tag field. 保存 is `filled`. A dialog with changes asks before it
 * is dismissed, by any route (✕, Esc, the scrim, Back).
 */
export default function TagGroupEditor({ isOpen, initial, saving, onSave, onClose }: TagGroupEditorProps) {
  const { confirm, confirmDialog } = useConfirm();
  const [draft, setDraft] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [errors, setErrors] = useState<{ name?: string; tags?: string }>({});
  const tagField = useRef<TagComboFieldHandle>(null);

  /* A new draft (another group, or a fresh one) resets the form — during render, the documented
     pattern for state that follows a prop. */
  if (seen !== initial) {
    setSeen(initial);
    setDraft(initial);
    setErrors({});
  }

  const chosen = useMemo(() => new Set(draft.tags), [draft.tags]);
  const dirty = draft.name !== initial.name || draft.tags.join('\n') !== initial.tags.join('\n');

  /** Adds tags up to the cap. Returns how many went in. */
  const add = (tags: string[]): number => {
    const fresh = tags.filter((tag) => !draft.tags.includes(tag));
    const room = Math.max(0, MAX_TAGS_PER_TAG_GROUP - draft.tags.length);
    const taken = fresh.slice(0, room);
    setErrors((previous) => ({
      ...previous,
      tags: taken.length < fresh.length
        ? `一个标签组最多 ${MAX_TAGS_PER_TAG_GROUP} 个标签${taken.length > 0 ? `，有 ${fresh.length - taken.length} 个没有加入` : ''}`
        : undefined,
    }));
    if (taken.length === 0) return 0;
    setDraft((previous) => ({ ...previous, tags: [...previous.tags, ...taken] }));
    return taken.length;
  };

  const remove = (tag: string) => {
    setDraft((previous) => ({ ...previous, tags: previous.tags.filter((item) => item !== tag) }));
    setErrors((previous) => ({ ...previous, tags: undefined }));
  };

  const submit = () => {
    if (saving) return;
    const name = draft.name.trim();
    const next: typeof errors = {};
    if (!name) next.name = '请输入标签组名称';
    if (draft.tags.length === 0) next.tags = '请至少添加一个标签';
    setErrors(next);
    if (next.name || next.tags) {
      if (next.tags && !next.name) tagField.current?.focus();
      return;
    }
    onSave({ id: draft.id, name, tags: draft.tags });
  };

  const requestClose = async () => {
    if (saving) return;
    if (dirty && !(await confirm({
      title: '确认放弃修改',
      message: '确定要放弃对此标签组的修改吗？',
      tone: 'danger',
    }))) return;
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => void requestClose()}
      title={draft.id ? '编辑标签组' : '新建标签组'}
      maxWidth="lg"
      footer={
        <>
          <Button variant="text" disabled={saving} onClick={() => void requestClose()}>
            取消
          </Button>
          <Button variant="filled" loading={saving} onClick={submit}>
            保存
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="space-y-5"
        inert={saving}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          label="名称"
          required
          value={draft.name}
          maxLength={MAX_TAG_GROUP_NAME}
          count={{ value: Array.from(draft.name).length, max: MAX_TAG_GROUP_NAME }}
          error={errors.name}
          placeholder="例如：每日必刷、高分精选…"
          onChange={(event) => {
            const name = event.target.value;
            setDraft((previous) => ({ ...previous, name }));
            if (errors.name) setErrors((previous) => ({ ...previous, name: undefined }));
          }}
        />
        <TagComboField
          ref={tagField}
          label="添加标签"
          placeholder="搜索或输入标签，回车添加"
          chosen={chosen}
          onAdd={add}
          disabled={saving}
          error={errors.tags}
          helper="支持中文名称搜索；输入多个标签时用逗号分隔"
        />
        <TagWell
          title="包含的标签"
          icon={<MdSell size={ICON.dense} />}
          tags={draft.tags}
          max={MAX_TAGS_PER_TAG_GROUP}
          onRemove={remove}
          empty="还没有添加标签"
          disabled={saving}
        />
        <PendingTagsPicker chosen={chosen} onAdd={add} confirm={confirm} disabled={saving} />
      </form>
      {confirmDialog}
    </Modal>
  );
}
