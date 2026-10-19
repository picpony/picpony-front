'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import CodeInput from '@/components/CodeInput';
import { Field, Input } from '@/components/Input';
import { showToast } from '@/components/Toast';
import { confirmEmailChange, isRefusal, updateEmail } from '@/lib/api/picpony';
import { apiErrorMessage } from '@/lib/api/errors';
import { CODE_LENGTH, validateCode, validateEmail, validateRequired } from '@/lib/validation';
import { startCooldown, useCooldown } from '@/lib/useCooldown';
import { readToken, readUserInfo } from '@/lib/hooks';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { sessionUser } from '@/lib/resources';
import { cn } from '@/lib/utils';
import { EMAIL_PENDING, EMAIL_PENDING_VERIFICATION, pendingEmailChange, saveAccountFields } from './useAccount';

export type EmailStep = 'change' | 'verify';

/**
 * 邮箱 — changing the address, in two steps of one dialog, each a real form (Enter submits).
 *
 * The backend's contract (`POST /me/email-changes`, `docs/auth-api.md`): the change asks for the
 * current password and sends a code to the **new** address; the old one stays bound until the code
 * is confirmed (`POST /me/email-changes/{verification}/confirmation`), from the same session. So
 * the code step is reachable on its own: the row offers 验证 for as long as this session's change
 * is pending (`EMAIL_PENDING`), closing the dialog no longer loses it, and the resend countdown is
 * kept per address outside the dialog (`useCooldown`). Another code needs the password again —
 * a resend is the change asked once more — so 重新发送 returns to the first step with the address
 * filled in.
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
  const [pending] = useState(() => {
    const user = readUserInfo();
    return user?.token === token ? pendingEmailChange(user) : null;
  });
  const [step, setStep] = useState<EmailStep>(initialStep === 'verify' && pending ? 'verify' : 'change');
  /* A step reached inside the open dialog swaps in like a view (AuthModal's sign-up steps); the
     step a dialog opens on is simply there. The dialog is keyed per open, so this starts false. */
  const [stepChanged, setStepChanged] = useState(false);
  const [target, setTarget] = useState(pending?.email ?? '');
  const [verification, setVerification] = useState(pending?.verification ?? '');
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'change' | 'verify' | null>(null);
  const cooldown = useCooldown(target ? `email-code:${target}` : null);
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
  /* Back on the first step for another code: the password field takes the focus. */
  const passwordField = useRef<HTMLInputElement>(null);
  const focusPassword = useRef(false);
  useEffect(() => {
    if (step !== 'change' || !focusPassword.current) return;
    focusPassword.current = false;
    passwordField.current?.focus({ preventScroll: true });
  }, [step]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const current = () => readToken() === token;

  const submitChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !change.check()) return;
    const next = address.trim();
    setBusy('change');
    try {
      const data = await updateEmail(token, { new_email: next, current_password: password });
      if (!current()) return;
      saveAccountFields(token, { [EMAIL_PENDING]: next, [EMAIL_PENDING_VERIFICATION]: data.verification });
      setTarget(next);
      setVerification(data.verification);
      setPassword('');
      setCode('');
      setStepChanged(true);
      setStep('verify');
      startCooldown(`email-code:${next}`);
    } catch (error) {
      if (!current()) return;
      if (isRefusal(error, 'PASSWORD_MISMATCH')) change.set('password', apiErrorMessage(error));
      else if (isRefusal(error, 'EMAIL_TAKEN', 'INVALID_INPUT')) change.set('address', apiErrorMessage(error));
      else showToast(apiErrorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  /* Another code is the change asked again, which needs the password. */
  const askAgain = () => {
    if (busy || cooldown.active) return;
    setAddress(target);
    focusPassword.current = true;
    setStepChanged(true);
    setStep('change');
  };

  const clearPending = () => saveAccountFields(token, { [EMAIL_PENDING]: '', [EMAIL_PENDING_VERIFICATION]: '' });

  /* `value` because the last box's `onComplete` fires before the state it just set is readable. */
  const submitCode = async (value: string = code) => {
    if (busy) return;
    const invalid = validateCode(value);
    if (invalid) {
      failCode(invalid);
      return;
    }
    setBusy('verify');
    try {
      const data = await confirmEmailChange(token, verification, value.trim());
      if (!current()) return;
      saveAccountFields(token, { email: data.email, [EMAIL_PENDING]: '', [EMAIL_PENDING_VERIFICATION]: '' });
      void sessionUser.read({ token }, { force: true }).catch(() => {});
      cooldown.reset();
      showToast('已更换邮箱', 'success');
      onClose();
    } catch (error) {
      if (!current()) return;
      if (isRefusal(error, 'EMAIL_CODE_MISMATCH')) failCode(apiErrorMessage(error));
      else if (isRefusal(error, 'EMAIL_PROOF_INVALID')) {
        /* The request is spent (expired, five misses, or another change replaced it). */
        clearPending();
        failCode(apiErrorMessage(error));
      } else showToast(apiErrorMessage(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const sendLabel = cooldown.active ? `重新发送（${cooldown.remaining} 秒）` : '重新发送';
  const passwordProps = change.field('password');

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
              variant="text"
              type="button"
              onClick={askAgain}
              disabled={cooldown.active || busy !== null}
              className="mr-auto tabular-nums"
            >
              {sendLabel}
            </Button>
            <Button variant="text" type="button" onClick={close} disabled={busy !== null}>
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
              {...passwordProps}
              ref={(element) => {
                passwordField.current = element;
                passwordProps.ref(element);
              }}
              label="当前密码"
              type="password"
              name="current-password"
              autoComplete="current-password"
              value={password}
              helper="为了你的账户安全，更换邮箱需要验证密码；验证码将发送至新邮箱"
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
              {`验证码已发送至 ${target}，请在下方输入 ${CODE_LENGTH} 位数字。验证后它将替换当前绑定的邮箱。`}
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
                  autoFocus
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
