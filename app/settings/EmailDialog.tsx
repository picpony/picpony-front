'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import CodeInput from '@/components/CodeInput';
import { Field, Input } from '@/components/Input';
import { showToast } from '@/components/Toast';
import { resendVerifyCode, updateEmail, verifyEmail } from '@/lib/api/picpony';
import { envelopeMessage, readEnvelope } from '@/lib/api/http';
import { apiErrorMessage, isApiError } from '@/lib/api/errors';
import { CODE_LENGTH, validateCode, validateEmail, validateRequired } from '@/lib/validation';
import { startCooldown, useCooldown } from '@/lib/useCooldown';
import { readToken, readUserInfo } from '@/lib/hooks';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { sessionUser } from '@/lib/resources';
import { cn } from '@/lib/utils';
import { EMAIL_PENDING, saveAccountFields, saysAlreadyVerified } from './useAccount';

export type EmailStep = 'change' | 'verify';

/**
 * 邮箱 — changing the address, and verifying it. Two steps of one dialog, each a real form
 * (Enter submits), and the second one reachable on its own: the row offers 验证 for as long as the
 * address is unverified, so closing the dialog no longer loses the step, and the resend countdown
 * is kept per address outside the dialog (`useCooldown`), so reopening it resumes rather than
 * offering a send the server would refuse.
 *
 * The change asks for the current password: the original front end changed an address with
 * `{ current_password, new_email }`, so both of its names are sent, beside this app's `email`.
 *
 * **A change is final unless the backend says it sent a code.** That is how the original front
 * end treated it: 邮箱修改成功, and the badge read 已验证. The owner confirmed the backend's rules
 * (2026-09-27, decision 26):
 * - registration requires a code, so a registered account's address is verified;
 * - a change needs no verification at all. That is a known gap in the backend, kept for now.
 *
 * The verify step therefore never shows today. It waits for the day a change answers with a
 * message naming 验证码. That answer sets `EMAIL_PENDING`, and the row offers 验证 until the code is
 * accepted. An answer that the address is already verified is taken as the verification it
 * reports, never as a failure (`saysAlreadyVerified`).
 */
export default function EmailDialog({
  open,
  token,
  email,
  initialStep,
  onClose,
}: {
  open: boolean;
  token: string;
  /** The bound address, or '' when there is none. */
  email: string;
  initialStep: EmailStep;
  onClose: () => void;
}) {
  const [step, setStep] = useState<EmailStep>(initialStep);
  /* A step reached inside the open dialog swaps in like a view (AuthModal's sign-up steps); the
     step a dialog opens on is simply there. The dialog is keyed per open, so this starts false. */
  const [stepChanged, setStepChanged] = useState(false);
  const [target, setTarget] = useState(email);
  const [address, setAddress] = useState(initialStep === 'change' ? '' : email);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'change' | 'send' | 'verify' | null>(null);
  const cooldown = useCooldown(target ? `email-code:${target}` : null);
  const [codeSent, setCodeSent] = useState(cooldown.active);
  const introId = useId();

  const change = useFieldErrors<'address' | 'password'>(() => [
    ['address', validateEmail(address) ?? (address.trim() === email ? '这已是当前绑定的邮箱' : null)],
    ['password', validateRequired(password, '请输入当前密码')],
  ]);
  /* The code row keeps its own error: it is one group of boxes, and focus goes to its first empty one. */
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeBox = useRef<HTMLDivElement>(null);
  const focusCode = () => {
    const boxes = Array.from(codeBox.current?.querySelectorAll<HTMLInputElement>('input') ?? []);
    (boxes.find((box) => !box.value) ?? boxes.at(-1))?.focus();
  };
  const failCode = (message: string) => {
    setCodeError(message);
    focusCode();
  };
  /* Focus follows the step: to the boxes once a code is on its way — the send button goes
     disabled for the countdown, which would drop the focus of the key that pressed it — and to
     the send button when the step opens with nothing sent yet. */
  const sendButton = useRef<HTMLButtonElement>(null);
  const focusSend = useRef(false);
  useEffect(() => {
    if (step !== 'verify' || !focusSend.current) return;
    focusSend.current = false;
    sendButton.current?.focus({ preventScroll: true });
  }, [step]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const current = () => readToken() === token;
  /* The account's id, read when it is used: both code actions read `user_id` (`resendVerifyCode`). */
  const accountId = () => {
    const user = readUserInfo();
    const id = user?.token === token ? Number(user.id) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  const submitChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !change.check()) return;
    const next = address.trim();
    setBusy('change');
    try {
      const data = await readEnvelope<{ email?: unknown }>(
        await updateEmail(token, { email: next, new_email: next, current_password: password }),
      );
      if (!current()) return;
      const saved = typeof data.email === 'string' && data.email ? data.email : next;
      const sent = /验证码/.test(envelopeMessage(data) ?? '');
      saveAccountFields(token, { email: saved, [EMAIL_PENDING]: sent ? saved : '' });
      void sessionUser.read({ token }, { force: true }).catch(() => {});
      if (!sent) {
        showToast('已更换邮箱', 'success');
        onClose();
        return;
      }
      setTarget(saved);
      setCodeSent(true);
      setPassword('');
      /* Sent: the boxes take the focus as they mount. */
      focusSend.current = false;
      setStepChanged(true);
      setStep('verify');
      cooldownFor(saved);
    } catch (error) {
      if (!current()) return;
      if (isApiError(error) && error.kind === 'envelope') change.set('password', apiErrorMessage(error));
      else showToast(apiErrorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  /* Verified, by the code or by the backend's word that it already was. */
  const finishVerified = () => {
    saveAccountFields(token, { [EMAIL_PENDING]: '' });
    cooldown.reset();
    showToast('邮箱已验证', 'success');
    onClose();
  };

  /* The countdown is keyed on the address; right after a change the hook's key has not caught up. */
  const cooldownFor = (to: string) => startCooldown(`email-code:${to}`);

  const sendCode = async () => {
    if (busy || cooldown.active) return;
    const userId = accountId();
    if (userId === null) {
      showToast('登录信息不完整，请重新登录', 'error');
      return;
    }
    setBusy('send');
    try {
      await readEnvelope(await resendVerifyCode(token, userId));
      if (!current()) return;
      setCodeSent(true);
      cooldown.start();
      focusCode();
    } catch (error) {
      if (!current()) return;
      if (saysAlreadyVerified(apiErrorMessage(error))) finishVerified();
      else showToast(apiErrorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  /* `value` because the last box's `onComplete` fires before the state it just set is readable. */
  const submitCode = async (value: string = code) => {
    if (busy) return;
    const invalid = validateCode(value);
    if (invalid) {
      failCode(invalid);
      return;
    }
    const userId = accountId();
    if (userId === null) {
      showToast('登录信息不完整，请重新登录', 'error');
      return;
    }
    setBusy('verify');
    try {
      await readEnvelope(await verifyEmail(token, userId, value.trim()));
      if (!current()) return;
      finishVerified();
    } catch (error) {
      if (!current()) return;
      if (saysAlreadyVerified(apiErrorMessage(error))) finishVerified();
      else if (isApiError(error) && error.kind === 'envelope') failCode(apiErrorMessage(error));
      else showToast(apiErrorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const sendLabel = cooldown.active
    ? `重新发送（${cooldown.remaining} 秒）`
    : codeSent
      ? '重新发送'
      : '发送验证码';

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title={step === 'verify' ? '验证邮箱' : email ? '更换邮箱' : '绑定邮箱'}
      aria-describedby={step === 'verify' ? introId : undefined}
      closeOnEscape={!busy}
      footer={
        step === 'verify' ? (
          <>
            <Button
              ref={sendButton}
              variant="text"
              type="button"
              onClick={sendCode}
              loading={busy === 'send'}
              disabled={cooldown.active}
              data-autofocus={codeSent ? undefined : ''}
              className="mr-auto tabular-nums"
            >
              {sendLabel}
            </Button>
            <Button variant="text" type="button" onClick={close} disabled={busy !== null && busy !== 'send'}>
              稍后
            </Button>
            <Button variant="filled" type="submit" form="email-verify-form" loading={busy === 'verify'}>
              验证
            </Button>
          </>
        ) : (
          <>
            <Button variant="text" type="button" onClick={close} disabled={busy !== null}>
              取消
            </Button>
            <Button variant="filled" type="submit" form="email-change-form" loading={busy === 'change'}>
              保存
            </Button>
          </>
        )
      }
    >
      <div key={step} className={cn(stepChanged && 'animate-page-transition')}>
        {step === 'change' ? (
          <form id="email-change-form" onSubmit={submitChange} noValidate className="space-y-4">
            <Input
              {...change.field('address')}
              label={email ? '新邮箱地址' : '邮箱地址'}
              data-autofocus
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="off"
              spellCheck={false}
              value={address}
              helper={email ? `当前：${email}` : undefined}
              onChange={(event) => {
                setAddress(event.target.value);
                change.clear('address');
              }}
              readOnly={busy !== null}
            />
            <Input
              {...change.field('password')}
              label="当前密码"
              type="password"
              name="current-password"
              autoComplete="current-password"
              value={password}
              helper="为了你的账户安全，更换邮箱需要验证密码"
              onChange={(event) => {
                setPassword(event.target.value);
                change.clear('password');
              }}
              readOnly={busy !== null}
            />
          </form>
        ) : (
          <form
            id="email-verify-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCode();
            }}
            noValidate
            className="space-y-4"
          >
            <p id={introId} className="text-body-m text-on-surface-variant wrap-anywhere">
              {codeSent
                ? `验证码已发送至 ${target}，请在下方输入 ${CODE_LENGTH} 位数字。`
                : `向 ${target} 发送一个 ${CODE_LENGTH} 位验证码，收到后在下方输入。`}
            </p>
            <Field error={codeError}>
              <div ref={codeBox}>
                <CodeInput
                  value={code}
                  onChange={(value) => {
                    setCode(value);
                    setCodeError(null);
                  }}
                  onComplete={(value) => void submitCode(value)}
                  autoFocus={codeSent}
                  /* Never disabled while the code is checked: that would drop the focus of the box
                     the last digit was typed into. A second completion is ignored while busy. */
                />
              </div>
            </Field>
          </form>
        )}
      </div>
    </Modal>
  );
}
