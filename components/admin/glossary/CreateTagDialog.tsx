'use client';

import { useState } from 'react';
import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { AdminForm } from '../AdminForm';
import TagFields, { WorkOrderNote, type TagFormErrors } from './TagFields';
import { emptyTagForm, withSuggestion, type DerpiTagRow, type TagForm } from './model';
import type { Feedback } from './resources';

const FORM_ID = 'glossary-create-form';

/**
 * 添加新标签. The caller's `onSave` checks the dictionary for the tag and writes it; an existing
 * tag comes back as the field's own error rather than a toast (`onDuplicate`).
 */
export default function CreateTagDialog({
  open,
  prefill,
  saving,
  workOrder,
  duplicate,
  onClose,
  onSave,
}: {
  open: boolean;
  /** A Derpibooru tag the dialog opens on — from 搜原站标签, or a feedback naming a missing tag. */
  prefill: Partial<DerpiTagRow> | null;
  saving: boolean;
  workOrder: Feedback | null;
  /** The tag the last save found already in the dictionary, lower-cased. */
  duplicate: string | null;
  onClose: () => void;
  onSave: (form: TagForm) => void;
}) {
  const [form, setForm] = useState<TagForm>(() => emptyTagForm(prefill ?? undefined));
  const [errors, setErrors] = useState<TagFormErrors>({});
  const en = form.en.trim().toLowerCase();
  const shown: TagFormErrors = {
    en: errors.en ?? (duplicate && duplicate === en ? '词库中已存在此标签' : undefined),
  };

  const submit = () => {
    if (saving) return;
    if (!en) {
      setErrors({ en: '请填写英文标签' });
      return;
    }
    onSave(form);
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      closeOnEscape={!saving}
      title="添加新标签"
      maxWidth="lg"
      footer={
        <>
          <Button type="button" variant="text" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="submit" form={FORM_ID} variant="filled" loading={saving}>
            保存
          </Button>
        </>
      }
    >
      <AdminForm id={FORM_ID} onSubmit={submit} className="max-w-none" aria-label="添加新标签">
        {workOrder && (
          <WorkOrderNote
            workOrder={workOrder}
            onUse={() => setForm((previous) => ({ ...previous, translations: withSuggestion(previous.translations, workOrder.content) }))}
          />
        )}
        <TagFields
          prefix="glossary-new"
          form={form}
          errors={shown}
          busy={saving}
          creating
          onChange={(next) => {
            setForm((previous) => ({ ...previous, ...next }));
            if ('en' in next) setErrors({});
          }}
        />
      </AdminForm>
    </Modal>
  );
}
