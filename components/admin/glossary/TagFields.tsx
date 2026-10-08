'use client';

import { MdArrowDownward } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input, Textarea } from '@/components/Input';
import Select from '@/components/Select';
import { FormGrid } from '../AdminForm';
import { TAG_CATEGORIES, type DerpiTagRow, type TagForm } from './model';
import type { Feedback } from './resources';
import TagSuggestField from './TagSuggestField';

export type TagFormErrors = Partial<Record<'en', string>>;

/**
 * A dictionary entry's fields — the inline editor under a row and the create dialog are this one
 * column of labelled fields (R9-010: the editor was a two-column table under 「字段 / 内容」).
 * A new entry's English tag is a combobox of Derpibooru's tags; an existing one's is fixed.
 */
export default function TagFields({
  prefix,
  form,
  errors,
  busy,
  creating,
  onChange,
}: {
  prefix: string;
  form: TagForm;
  errors: TagFormErrors;
  busy: boolean;
  creating: boolean;
  onChange: (next: Partial<TagForm>) => void;
}) {
  return (
    <>
      <FormGrid>
        {creating ? (
          <TagSuggestField
            id={`${prefix}-en`}
            value={form.en}
            error={errors.en}
            readOnly={busy}
            onChange={(en) => onChange({ en })}
            onPick={(tag: DerpiTagRow) => onChange({ en: tag.name, cat: tag.category || 'general', count: tag.images || 0 })}
          />
        ) : (
          <Input id={`${prefix}-en`} label="英文标签" value={form.en} readOnly className="font-mono" helper="英文标签不可修改" />
        )}
        <Select
          label="分类"
          value={form.cat}
          options={TAG_CATEGORIES}
          disabled={busy}
          onChange={(cat) => onChange({ cat })}
        />
      </FormGrid>
      <Input
        id={`${prefix}-cn`}
        label="中文翻译"
        value={form.translations}
        readOnly={busy}
        placeholder="例如：紫悦, 暮光闪闪, ts"
        helper="第一个是主译名，其余为别名，用逗号分隔"
        onChange={(event) => onChange({ translations: event.target.value })}
      />
      <Textarea
        id={`${prefix}-description`}
        label="标签简介"
        rows={3}
        className="resize-none"
        value={form.description}
        readOnly={busy}
        placeholder="例如：该角色首次登场于第一季…"
        onChange={(event) => onChange({ description: event.target.value })}
      />
    </>
  );
}

/** The feedback a save will close, shown above the fields while it is being handled. */
export function WorkOrderNote({ workOrder, onUse }: { workOrder: Feedback; onUse: () => void }) {
  return (
    <Card variant="filled" padding="sm" className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-label-l text-on-surface">
          {`正在处理反馈 #${workOrder.id} · ${workOrder.username || '游客'}`}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap wrap-anywhere text-body-m text-on-surface-variant">{workOrder.content}</p>
      </div>
      <Button type="button" variant="tonal" size="xs" icon={<MdArrowDownward />} onClick={onUse}>
        填入中文翻译
      </Button>
    </Card>
  );
}
