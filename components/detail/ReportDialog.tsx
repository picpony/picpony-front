'use client';

import Button from '@/components/Button';
import Modal from '@/components/Modal';
import { Textarea } from '@/components/Input';

/**
 * 举报图片: one labelled field and the two actions.
 *
 * The reason is the caller's state, so it survives what the dialog does not: a failed submit, a
 * session that expired mid-sentence (the submit then asks for a sign-in and keeps the words), the
 * dialog closed and opened again on the same picture. The busy label stays 提交举报 — a label that
 * changes while busy changes the button's width (the spinner is what says it is working).
 */
export default function ReportDialog({
  open,
  reason,
  busy,
  onReasonChange,
  onSubmit,
  onClose,
}: {
  open: boolean;
  reason: string;
  busy: boolean;
  onReasonChange: (reason: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      isOpen={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="举报图片"
      closeOnOverlayClick={!busy}
      footer={
        <>
          <Button variant="text" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="danger" onClick={onSubmit} loading={busy} disabled={!reason.trim()}>
            提交举报
          </Button>
        </>
      }
    >
      <p className="mb-4 text-body-m text-on-surface-variant">请描述违规原因，管理员将会审核处理。</p>
      <Textarea
        label="举报原因"
        required
        value={reason}
        onChange={(event) => onReasonChange(event.target.value)}
        rows={4}
        maxLength={1000}
        disabled={busy}
      />
    </Modal>
  );
}
