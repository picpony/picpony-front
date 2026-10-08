'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import { showToast } from '@/components/Toast';
import { useAuthModal } from '@/components/AuthModal';
import { changePassword } from '@/lib/api/picpony';
import { readEnvelope } from '@/lib/api/http';
import { apiErrorMessage, isApiError } from '@/lib/api/errors';
import {
  PASSWORD_HINT,
  validateNewPassword,
  validatePasswordConfirmation,
  validateRequired,
} from '@/lib/validation';
import { clearUserInfo, readToken } from '@/lib/hooks';
import { useFieldErrors } from '@/lib/useFieldErrors';

type Field = 'current' | 'next' | 'confirm';

/**
 * 修改密码 — the one password rule (`validateNewPassword`, the sign-up rule the backend holds),
 * a confirmation field (a typo in an unconfirmed new password would lock the account: it signs out
 * on success), and the autocomplete tokens a password manager keys on, with the username beside
 * them so the manager knows whose password changed.
 *
 * On success the session ends, as the backend's does: the dialog closes, the account is signed out
 * and the sign-in dialog opens — the one thing the user can do next.
 */
export default function PasswordDialog({
  open,
  token,
  username,
  onClose,
}: {
  open: boolean;
  token: string;
  username: string;
  onClose: () => void;
}) {
  const { openAuth } = useAuthModal();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors<Field>(() => [
    ['current', validateRequired(current, '请输入当前密码')],
    ['next', validateNewPassword(next) ?? (next === current ? '新密码不能与当前密码相同' : null)],
    ['confirm', validatePasswordConfirmation(next, confirm)],
  ]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !form.check()) return;
    setBusy(true);
    try {
      await readEnvelope(await changePassword(token, { old_password: current, new_password: next }));
      if (readToken() !== token) return;
      showToast('密码已修改，请重新登录', 'success');
      onClose();
      if (clearUserInfo(token)) openAuth('login');
    } catch (error) {
      if (readToken() !== token) return;
      /* The backend's refusal here is about the current password. */
      if (isApiError(error) && error.kind === 'envelope') form.set('current', apiErrorMessage(error));
      else showToast(apiErrorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const edit = (field: Field, set: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    form.clear(field);
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title="修改密码"
      closeOnEscape={!busy}
      footer={
        <>
          <Button variant="text" type="button" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="filled" type="submit" form="password-form" loading={busy}>
            修改密码
          </Button>
        </>
      }
    >
      <form id="password-form" onSubmit={submit} noValidate className="space-y-4">
        {/* Whose password this is, for a password manager; never shown. */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <Input
          {...form.field('current')}
          label="当前密码"
          data-autofocus
          type="password"
          name="current-password"
          autoComplete="current-password"
          value={current}
          onChange={edit('current', setCurrent)}
          readOnly={busy}
        />
        <Input
          {...form.field('next')}
          label="新密码"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={next}
          helper={PASSWORD_HINT}
          onChange={edit('next', setNext)}
          readOnly={busy}
        />
        <Input
          {...form.field('confirm')}
          label="确认新密码"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={edit('confirm', setConfirm)}
          readOnly={busy}
        />
      </form>
    </Modal>
  );
}
