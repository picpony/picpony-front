'use client';

import { useState } from 'react';
import Button from '@/components/Button';
import { Textarea } from '@/components/Input';
import Modal from '@/components/Modal';
import { AdminForm } from '../AdminForm';
import { parseImport, type ImportTask } from './model';

const FORM_ID = 'glossary-import-form';

/**
 * 批量导入. The text is parsed here and sent as **one** request (`batch_import_dictionary_tags`),
 * the original editor's contract: the backend skips what the dictionary holds. While it runs the
 * dialog cannot be dismissed — 取消 used to close it with the job still going (R9-034), and a
 * single request has nothing to stop — and the line under the field says what is being sent.
 */
export default function BatchImportDialog({
  open,
  importing,
  onClose,
  onImport,
}: {
  open: boolean;
  importing: boolean;
  onClose: () => void;
  onImport: (tasks: ImportTask[], text: string) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const parsed = parseImport(text);

  const submit = () => {
    if (importing) return;
    if (parsed.tasks.length === 0) {
      setError(text.trim() ? '没有解析到有效的行，请按「英文标签 = 中文翻译」的格式填写' : '请填写要导入的标签');
      return;
    }
    onImport(parsed.tasks, text);
  };

  const helper = importing
    ? `正在导入 ${parsed.tasks.length} 个标签…`
    : parsed.tasks.length > 0
      ? `将导入 ${parsed.tasks.length} 个标签${parsed.skipped ? `，${parsed.skipped} 行无法识别或重复，将跳过` : ''}；词库中已有的标签会自动跳过`
      : '每行一个标签：英文标签 = 主译名, 别名1, 别名2；以 # 开头的行会被忽略';

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      closeOnEscape={!importing}
      hideCloseButton={importing}
      title="批量导入标签"
      maxWidth="xl"
      footer={
        <>
          <Button type="button" variant="text" onClick={onClose} disabled={importing}>
            取消
          </Button>
          <Button type="submit" form={FORM_ID} variant="filled" loading={importing}>
            开始导入
          </Button>
        </>
      }
    >
      <AdminForm id={FORM_ID} onSubmit={submit} className="max-w-none" aria-label="批量导入标签">
        <Textarea
          label="要导入的标签"
          rows={12}
          className="resize-none font-mono"
          value={text}
          readOnly={importing}
          error={error ?? undefined}
          helper={helper}
          placeholder={'twilight sparkle = 紫悦, 暮光闪闪, ts\nrainbow dash = 云宝'}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
        />
      </AdminForm>
    </Modal>
  );
}
