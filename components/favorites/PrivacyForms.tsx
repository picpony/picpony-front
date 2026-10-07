'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { MdLock, MdLockOpen } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import ToggleSwitch from '@/components/ToggleSwitch';
import { Input } from '@/components/Input';
import { showToast } from '@/components/Toast';
import { apiErrorMessage, isApiError } from '@/lib/api/errors';
import { PRIVACY_UNLOCK_SECONDS, parseUnlockSeconds, settled, unlockLabel } from '@/lib/favorites';
import { changePrivacyPassword, createPrivacyPassword, resetPrivacy, unlockPrivacy } from '@/lib/favoritesPrivacy';
import { ICON } from '@/lib/icons';
import { readToken } from '@/lib/hooks';
import { changeSyncedSetting, useSyncedSetting } from '@/lib/settingsSync';
import { useFieldErrors } from '@/lib/useFieldErrors';
import {
  PRIVACY_PASSWORD_HINT,
  validatePasswordConfirmation,
  validatePrivacyPassword,
  validateRequired,
} from '@/lib/validation';

/*
 * The privacy space's password is **not the account's** and must never be offered where the
 * account's is, nor saved over it. So a field that chooses one is `new-password` (a manager may
 * generate and save it, and never fills the account's in), and the unlock field is
 * `current-password` beside a hidden username naming the space rather than the account — a
 * manager keeps it as a credential of its own. The reset asks for the account's password, under
 * the account's own username. Nothing here is stored: the gate's fields are emptied once they are
 * sent, a dialog's once it has left (`Modal`'s `onExited`) — never in the commit that closes it,
 * since a floated label drops back into an emptied field while the dialog is still on screen for
 * the length of its exit (M1-009).
 */

/** Whose space this is, for a password manager — never shown. */
function SpaceIdentity({ username }: { username: string }) {
  return <input type="text" name="username" autoComplete="username" value={`${username} 的隐私空间`} readOnly hidden />;
}

/** The gate's frame: a card in the pane, its glyph, its words and its form. */
export function GateCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card variant="filled" padding="lg" className="mx-auto w-full max-w-md" data-privacy-gate="">
      <div className="mb-4 flex flex-col items-center gap-2 text-center">
        <span className="text-outline" aria-hidden="true">
          {icon}
        </span>
        <h2 className="text-title-l text-on-surface">{title}</h2>
        <p className="text-body-m text-on-surface-variant">{description}</p>
      </div>
      {children}
    </Card>
  );
}

/** 创建隐私空间 — its first password, twice. */
export function PrivacyCreateForm({ token, username }: { token: string; username: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors<'password' | 'confirm'>(() => [
    ['password', validatePrivacyPassword(password)],
    ['confirm', validatePasswordConfirmation(password, confirm)],
  ]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !form.check()) return;
    setBusy(true);
    const outcome = await settled(createPrivacyPassword(token, password));
    setBusy(false);
    if (readToken() !== token) return;
    if (outcome.ok) {
      setPassword('');
      setConfirm('');
      showToast('已创建隐私空间');
    } else if (isApiError(outcome.error) && outcome.error.kind === 'envelope') {
      form.set('password', apiErrorMessage(outcome.error, '创建失败'));
    } else {
      showToast(apiErrorMessage(outcome.error, '创建失败'), 'error');
    }
  };

  return (
    <GateCard
      icon={<MdLock size={ICON.display} />}
      title="创建隐私空间"
      description="隐私空间里的图片需要密码才能查看。隐私密码无法找回，忘记时只能清空隐私空间。"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <SpaceIdentity username={username} />
        <Input
          {...form.field('password')}
          label="隐私密码"
          type="password"
          revealable
          autoComplete="new-password"
          helper={PRIVACY_PASSWORD_HINT}
          value={password}
          readOnly={busy}
          onChange={(event) => {
            setPassword(event.target.value);
            form.clear('password');
          }}
        />
        <Input
          {...form.field('confirm')}
          label="确认隐私密码"
          type="password"
          revealable
          autoComplete="new-password"
          value={confirm}
          readOnly={busy}
          onChange={(event) => {
            setConfirm(event.target.value);
            form.clear('confirm');
          }}
        />
        <Button type="submit" variant="filled" loading={busy} className="self-end">
          创建
        </Button>
      </form>
    </GateCard>
  );
}

/** 解锁 — the password, and 忘记密码 beside it. */
export function PrivacyUnlockForm({
  token,
  username,
  autoLocked,
  onForgot,
}: {
  token: string;
  username: string;
  /** The space locked itself (its unlock duration ran out): say so. */
  autoLocked: boolean;
  onForgot: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useFieldErrors<'password'>(() => [['password', validateRequired(password, '请输入隐私密码')]]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !form.check()) return;
    setBusy(true);
    const outcome = await settled(unlockPrivacy(token, password));
    setBusy(false);
    setPassword('');
    if (outcome.ok || readToken() !== token) return;
    if (isApiError(outcome.error) && outcome.error.kind === 'envelope') form.set('password', apiErrorMessage(outcome.error, '密码错误'));
    else showToast(apiErrorMessage(outcome.error, '解锁失败'), 'error');
  };

  return (
    <GateCard
      icon={<MdLock size={ICON.display} />}
      title={autoLocked ? '隐私空间已自动锁定' : '隐私空间已锁定'}
      description="输入隐私密码以查看其中的图片"
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <SpaceIdentity username={username} />
        <Input
          {...form.field('password')}
          label="隐私密码"
          type="password"
          revealable
          autoComplete="current-password"
          data-autofocus=""
          value={password}
          readOnly={busy}
          onChange={(event) => {
            setPassword(event.target.value);
            form.clear('password');
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="text" onClick={onForgot} disabled={busy}>
            忘记密码
          </Button>
          <Button type="submit" variant="filled" icon={<MdLockOpen />} loading={busy}>
            解锁
          </Button>
        </div>
      </form>
    </GateCard>
  );
}

/**
 * 忘记密码 — the original front end's reset: the account's password first (`verify_password`),
 * and only then `reset_privacy_space`, which empties the space and clears its password.
 */
export function PrivacyResetDialog({
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
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const form = useFieldErrors<'password'>(() => [['password', validateRequired(password, '请输入账号密码')]]);

  /* Emptied once the dialog has left (`Modal`'s `onExited`), never in the commit that closes it:
     the field and its floated label hold through the exit, and the next opening starts clean. A
     reopening that arrives mid-exit is the same dialog, not a new one, and is not reported. */
  const clear = () => {
    setPassword('');
    form.reset();
  };
  const close = () => {
    if (busy) return;
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !form.check()) return;
    setBusy(true);
    const outcome = await settled(resetPrivacy(token, password));
    setBusy(false);
    if (readToken() !== token) return;
    if (outcome.ok) {
      showToast('已清空隐私空间，请重新设置隐私密码');
      onClose();
      return;
    }
    const verifying = (outcome.error as { step?: string }).step === 'verify';
    if (isApiError(outcome.error) && outcome.error.kind === 'envelope') {
      form.set('password', apiErrorMessage(outcome.error, verifying ? '账号密码错误' : '重置失败'));
    } else {
      showToast(apiErrorMessage(outcome.error, '重置失败'), 'error');
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      onExited={clear}
      title="重置隐私空间"
      maxWidth="sm"
      closeOnEscape={!busy}
      closeOnOverlayClick={!busy}
      footer={
        <>
          <Button variant="text" type="button" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="danger" type="submit" form={formId} loading={busy}>
            清空并重置
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="text-body-m text-on-surface-variant">
          隐私密码无法找回。重置将清空隐私空间中的所有图片并清除隐私密码，此操作不可撤销。请输入账号密码以确认。
        </p>
        {/* The account's own credential: its username, its current password. */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <Input
          {...form.field('password')}
          label="账号密码"
          type="password"
          revealable
          autoComplete="current-password"
          data-autofocus=""
          value={password}
          readOnly={busy}
          onChange={(event) => {
            setPassword(event.target.value);
            form.clear('password');
          }}
        />
      </form>
    </Modal>
  );
}

/** 修改隐私密码 — the current one, and the new one twice (`change_privacy_password`). */
export function PrivacyPasswordDialog({
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
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const form = useFieldErrors<'current' | 'next' | 'confirm'>(() => [
    ['current', validateRequired(current, '请输入当前隐私密码')],
    ['next', validatePrivacyPassword(next) ?? (next === current ? '新密码不能与当前密码相同' : null)],
    ['confirm', validatePasswordConfirmation(next, confirm)],
  ]);

  /* Emptied once the dialog has left, not as it closes (see the reset dialog's `clear`): the three
     fields and their floated labels hold through the exit. */
  const clear = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    form.reset();
  };
  const close = () => {
    if (busy) return;
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !form.check()) return;
    setBusy(true);
    const outcome = await settled(changePrivacyPassword(token, current, next));
    setBusy(false);
    if (readToken() !== token) return;
    if (outcome.ok) {
      showToast('已修改隐私密码');
      onClose();
    } else if (isApiError(outcome.error) && outcome.error.kind === 'envelope') {
      /* The backend's refusal here is about the current password (原密码错误). */
      form.set('current', apiErrorMessage(outcome.error, '原密码错误'));
    } else {
      showToast(apiErrorMessage(outcome.error, '修改失败'), 'error');
    }
  };

  const edit = (field: 'current' | 'next' | 'confirm', set: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    set(event.target.value);
    form.clear(field);
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      onExited={clear}
      title="修改隐私密码"
      maxWidth="sm"
      closeOnEscape={!busy}
      closeOnOverlayClick={!busy}
      footer={
        <>
          <Button variant="text" type="button" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="filled" type="submit" form={formId} loading={busy}>
            修改
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <SpaceIdentity username={username} />
        <Input
          {...form.field('current')}
          label="当前隐私密码"
          type="password"
          revealable
          autoComplete="current-password"
          data-autofocus=""
          value={current}
          readOnly={busy}
          onChange={edit('current', setCurrent)}
        />
        <Input
          {...form.field('next')}
          label="新隐私密码"
          type="password"
          revealable
          autoComplete="new-password"
          helper={PRIVACY_PASSWORD_HINT}
          value={next}
          readOnly={busy}
          onChange={edit('next', setNext)}
        />
        <Input
          {...form.field('confirm')}
          label="确认新隐私密码"
          type="password"
          revealable
          autoComplete="new-password"
          value={confirm}
          readOnly={busy}
          onChange={edit('confirm', setConfirm)}
        />
      </form>
    </Modal>
  );
}

/**
 * The privacy space's own settings — where the original front end offered them, on the space:
 * 不合规内容自动收藏到此 (`autoPrivacyFaves`) and how long it stays unlocked once left
 * (`privacyUnlockDurationSeconds`). Both follow the account (C3).
 */
export function PrivacySettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const autoPrivacy = useSyncedSetting('autoPrivacyFaves');
  const seconds = useSyncedSetting('privacyUnlockDurationSeconds');
  const value = parseUnlockSeconds(seconds) ?? PRIVACY_UNLOCK_SECONDS[0];
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="隐私空间设置"
      maxWidth="sm"
      footer={
        <Button variant="filled" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <ToggleSwitch
          layout="row"
          label="露骨图片自动收藏到隐私空间"
          description="开发者模式下收藏带 explicit 标签的图片时，直接存入隐私空间"
          checked={autoPrivacy}
          onChange={(on) => changeSyncedSetting('autoPrivacyFaves', on)}
        />
        <Select
          label="离开后保持解锁"
          value={String(value)}
          onChange={(next) => changeSyncedSetting('privacyUnlockDurationSeconds', Number(next))}
          options={PRIVACY_UNLOCK_SECONDS.map((option) => ({ value: String(option), label: unlockLabel(option) }))}
        />
      </div>
    </Modal>
  );
}
