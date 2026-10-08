'use client';

import { useEffect, useState } from 'react';
import { MdHistory } from 'react-icons/md';
import Button from '@/components/Button';
import InlineEditorPanel from '@/components/InlineEditorPanel';
import SectionHeading from '@/components/SectionHeading';
import { AdminForm, FormActions } from '../AdminForm';
import TagFields, { WorkOrderNote } from './TagFields';
import { tagFormOf, tagSavePayload, withSuggestion, type GlossaryTag, type TagForm } from './model';
import type { Feedback } from './resources';

export function tagEditorId(tagId: number) {
  return `glossary-inline-${tagId}-editor`;
}

/**
 * One entry's editor, under its row. A save sends the original editor's body
 * (`tagSavePayload`), flags carried through; 查看编辑历史 opens the entry's history.
 */
export default function TagEditor({
  tag,
  closing,
  saving,
  workOrder,
  onSave,
  onCancel,
  onExitComplete,
  onDirtyChange,
  onHistory,
}: {
  tag: GlossaryTag;
  closing: boolean;
  saving: boolean;
  workOrder: Feedback | null;
  onSave: (payload: Record<string, unknown>) => void;
  onCancel: () => void;
  onExitComplete: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onHistory: () => void;
}) {
  const [form, setForm] = useState<TagForm>(() => tagFormOf(tag));
  const initial = tagFormOf(tag);
  const dirty = (Object.keys(initial) as (keyof TagForm)[]).some((key) => initial[key] !== form[key]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const submit = () => {
    if (saving) return;
    onSave(tagSavePayload(form, tag));
  };

  return (
    <InlineEditorPanel
      id={tagEditorId(tag.id)}
      label={`编辑标签 ${tag.en}`}
      isClosing={closing}
      onExitComplete={onExitComplete}
      onEscape={saving ? undefined : onCancel}
    >
      {/* The panel is the named region (编辑标签 …); the form inside it is not a second one (G4-031). */}
      <AdminForm onSubmit={submit}>
        <SectionHeading
          as="h3"
          subtitle={tag.en}
          actions={
            <Button type="button" variant="text" size="xs" icon={<MdHistory />} onClick={onHistory}>
              查看编辑历史
            </Button>
          }
        >
          编辑标签
        </SectionHeading>
        {workOrder && (
          <WorkOrderNote
            workOrder={workOrder}
            onUse={() => setForm((previous) => ({ ...previous, translations: withSuggestion(previous.translations, workOrder.content) }))}
          />
        )}
        <TagFields
          prefix={`glossary-${tag.id}`}
          form={form}
          errors={{}}
          busy={saving}
          creating={false}
          onChange={(next) => setForm((previous) => ({ ...previous, ...next }))}
        />
        <FormActions>
          <Button type="button" variant="text" onClick={onCancel} disabled={saving}>
            取消
          </Button>
          <Button type="submit" variant="filled" loading={saving}>
            保存
          </Button>
        </FormActions>
      </AdminForm>
    </InlineEditorPanel>
  );
}
