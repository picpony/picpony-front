'use client';

import { useMemo, useRef, useState } from 'react';
import { MdBlock, MdVisibilityOff } from 'react-icons/md';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import Modal from '@/components/Modal';
import Radio from '@/components/Radio';
import PendingTagsPicker from '@/components/groups/PendingTagsPicker';
import TagComboField, { type TagComboFieldHandle } from '@/components/groups/TagComboField';
import TagWell from '@/components/groups/TagWell';
import {
  MAX_GROUP_NAME,
  MAX_TAGS_PER_LIST,
  type BlockGroup,
  type BlockGroupInput,
} from '@/lib/api/blockGroups';
import { ICON } from '@/lib/icons';

type ListKind = 'hide' | 'spoiler';

export interface BlockGroupDraft {
  id: number | null;
  name: string;
  hidden: string[];
  spoilered: string[];
}

export function draftOf(group: BlockGroup | null): BlockGroupDraft {
  return {
    id: group?.id ?? null,
    name: group?.name ?? '',
    hidden: [...(group?.hidden_tags ?? [])],
    spoilered: [...(group?.spoilered_tags ?? [])],
  };
}

interface BlockGroupEditorProps {
  isOpen: boolean;
  initial: BlockGroupDraft;
  saving: boolean;
  onSave: (input: BlockGroupInput) => void;
  onClose: () => void;
}

/**
 * 新建 / 编辑屏蔽组 — a name, which list new tags go into (彻底隐藏 or 遮挡打码), the shared tag
 * field, the two lists, and the 待定标签库 when it holds anything.
 *
 * Validation is the fields' own (R5-040): a missing name is the name field's error, an empty
 * group is the tag field's, a full list is said where the tag would have gone — never a toast
 * that leaves before it is read. 保存 is `filled`: saving is not destructive. A dialog with
 * changes asks before it is dismissed, by any route (✕, Esc, the scrim, Back).
 */
export default function BlockGroupEditor({ isOpen, initial, saving, onSave, onClose }: BlockGroupEditorProps) {
  const { confirm, confirmDialog } = useConfirm();
  const [draft, setDraft] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [target, setTarget] = useState<ListKind>('hide');
  const [errors, setErrors] = useState<{ name?: string; tags?: string }>({});
  const tagField = useRef<TagComboFieldHandle>(null);

  /* A new draft (another group, or a fresh one) resets the form — during render, the documented
     pattern for state that follows a prop. */
  if (seen !== initial) {
    setSeen(initial);
    setDraft(initial);
    setTarget('hide');
    setErrors({});
  }

  const chosen = useMemo(() => new Set([...draft.hidden, ...draft.spoilered]), [draft.hidden, draft.spoilered]);
  const dirty =
    draft.name !== initial.name ||
    draft.hidden.join('\n') !== initial.hidden.join('\n') ||
    draft.spoilered.join('\n') !== initial.spoilered.join('\n');

  /** Puts tags into the current list (moving any from the other one). Returns how many went in. */
  const add = (tags: string[]): number => {
    const into = target === 'hide' ? 'hidden' : 'spoilered';
    const other = target === 'hide' ? 'spoilered' : 'hidden';
    const list = draft[into];
    const fresh = tags.filter((tag) => !list.includes(tag));
    const room = MAX_TAGS_PER_LIST - list.length;
    const taken = fresh.slice(0, Math.max(0, room));
    if (taken.length < fresh.length) {
      setErrors((previous) => ({
        ...previous,
        tags: `${target === 'hide' ? '隐藏' : '遮挡'}列表最多 ${MAX_TAGS_PER_LIST} 个标签${taken.length > 0 ? `，有 ${fresh.length - taken.length} 个没有加入` : ''}`,
      }));
    } else {
      setErrors((previous) => ({ ...previous, tags: undefined }));
    }
    if (taken.length === 0) return 0;
    setDraft((previous) => ({
      ...previous,
      [into]: [...previous[into], ...taken],
      [other]: previous[other].filter((tag) => !taken.includes(tag)),
    }));
    return taken.length;
  };

  const remove = (kind: ListKind, tag: string) => {
    const key = kind === 'hide' ? 'hidden' : 'spoilered';
    setDraft((previous) => ({ ...previous, [key]: previous[key].filter((item) => item !== tag) }));
    setErrors((previous) => ({ ...previous, tags: undefined }));
  };

  const submit = () => {
    if (saving) return;
    const name = draft.name.trim();
    const next: typeof errors = {};
    if (!name) next.name = '请输入屏蔽组名称';
    if (draft.hidden.length === 0 && draft.spoilered.length === 0) next.tags = '请至少添加一个标签';
    setErrors(next);
    if (next.name || next.tags) {
      if (next.tags && !next.name) tagField.current?.focus();
      return;
    }
    onSave({ id: draft.id, name, hidden: draft.hidden, spoilered: draft.spoilered });
  };

  const requestClose = async () => {
    if (saving) return;
    if (dirty && !(await confirm({
      title: '确认放弃修改',
      message: '确定要放弃对此屏蔽组的修改吗？',
      tone: 'danger',
    }))) return;
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => void requestClose()}
      title={draft.id ? '编辑屏蔽组' : '新建屏蔽组'}
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
          maxLength={MAX_GROUP_NAME}
          count={{ value: Array.from(draft.name).length, max: MAX_GROUP_NAME }}
          error={errors.name}
          placeholder="例如：重口味屏蔽、黑名单画师…"
          onChange={(event) => {
            const name = event.target.value;
            setDraft((previous) => ({ ...previous, name }));
            if (errors.name) setErrors((previous) => ({ ...previous, name: undefined }));
          }}
        />
        <fieldset>
          <legend className="mb-1 text-label-l text-on-surface">新加入的标签</legend>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <Radio
              name="block-group-target"
              value="hide"
              checked={target === 'hide'}
              onChange={() => setTarget('hide')}
              tone="error"
              label={<span className="flex items-center gap-1.5"><MdBlock size={ICON.dense} aria-hidden="true" />彻底隐藏</span>}
            />
            <Radio
              name="block-group-target"
              value="spoiler"
              checked={target === 'spoiler'}
              onChange={() => setTarget('spoiler')}
              tone="warning"
              label={<span className="flex items-center gap-1.5"><MdVisibilityOff size={ICON.dense} aria-hidden="true" />遮挡打码</span>}
            />
          </div>
        </fieldset>
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
          title="隐藏标签"
          icon={<MdBlock size={ICON.dense} />}
          tags={draft.hidden}
          max={MAX_TAGS_PER_LIST}
          onRemove={(tag) => remove('hide', tag)}
          empty="暂无隐藏标签"
          disabled={saving}
        />
        <TagWell
          title="遮挡标签"
          icon={<MdVisibilityOff size={ICON.dense} />}
          tags={draft.spoilered}
          max={MAX_TAGS_PER_LIST}
          onRemove={(tag) => remove('spoiler', tag)}
          empty="暂无遮挡标签"
          disabled={saving}
        />
        <PendingTagsPicker chosen={chosen} onAdd={add} confirm={confirm} disabled={saving} />
      </form>
      {confirmDialog}
    </Modal>
  );
}
