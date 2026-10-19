'use client';

import { useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import { showToast } from '@/components/Toast';
import { changeUsername, isRefusal } from '@/lib/api/picpony';
import { apiErrorMessage } from '@/lib/api/errors';
import { USERNAME_HINT, validateUsername } from '@/lib/validation';
import { readToken, readUserInfo } from '@/lib/hooks';
import { sessionUser } from '@/lib/resources';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { profileRevision, saveAccountFields } from './useAccount';

/**
 * 修改用户名. The sign-up rule (length and characters, `lib/validation.ts`) checked in the field,
 * and the server's refusal — a name already taken — shown there too. Opens on the current name,
 * so a small correction is a small edit; unchanged, there is nothing to confirm.
 */
export default function UsernameDialog({
  open,
  token,
  current,
  onClose,
}: {
  open: boolean;
  token: string;
  current: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors<'name'>(() => [['name', validateUsername(name)]]);
  const trimmed = name.trim();

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !form.check() || trimmed === current) return;
    setBusy(true);
    try {
      const saved = await changeUsername(token, trimmed, profileRevision(readUserInfo()));
      if (readToken() !== token) return;
      saveAccountFields(token, { username: saved.username, profile_revision: saved.revision });
      showToast('已修改用户名', 'success');
      onClose();
    } catch (error) {
      if (readToken() !== token) return;
      /* A refusal is about the name; anything else is about the connection. */
      if (isRefusal(error, 'PROFILE_CONFLICT')) {
        void sessionUser.read({ token }, { force: true }).catch(() => {});
        showToast(apiErrorMessage(error), 'error');
      } else if (isRefusal(error)) form.set('name', apiErrorMessage(error));
      else showToast(apiErrorMessage(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title="修改用户名"
      closeOnEscape={!busy}
      footer={
        <>
          <Button variant="text" type="button" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="filled" type="submit" form="username-form" loading={busy} disabled={!trimmed || trimmed === current}>
            保存
          </Button>
        </>
      }
    >
      <form id="username-form" onSubmit={submit} noValidate>
        <Input
          {...form.field('name')}
          label="用户名"
          data-autofocus
          name="username"
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
          value={name}
          helper={USERNAME_HINT}
          onChange={(event) => {
            setName(event.target.value);
            form.clear('name');
          }}
          /* Read-only rather than disabled while saving: a disabled field drops the focus a
             keyboard user pressed Enter from. */
          readOnly={busy}
        />
      </form>
    </Modal>
  );
}
