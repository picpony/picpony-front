'use client';

import dynamic from 'next/dynamic';

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { MdArrowBack } from 'react-icons/md';
import CodeInput from './CodeInput';
/**
 * The captcha is behind `dynamic()` and behind a "has ever opened" flag, and the
 * second half is what makes the first one work: the modal was rendered
 * unconditionally with `isOpen={false}`, so `dynamic()` alone would have fetched
 * the chunk the moment the sign-in dialog mounted. `captchaMounted` is a one-way
 * latch, so the chunk arrives on the first challenge and the element then *stays*
 * mounted — which is what `Modal`'s exit animation needs.
 */
const CaptchaModal = dynamic(() => import('./CaptchaModal'), { ssr: false });
import Button from './Button';
import { Field, Input } from './Input';
import { showToast } from './Toast';
import { cn } from '@/lib/utils';
import { login, register, verifyEmailById, resendVerifyCodeById, resetPasswordRequest, resetPassword } from '@/lib/api/picpony';
import { apiErrorMessage } from '@/lib/api/errors';
import { envelopeMessage, readJson } from '@/lib/api/http';
import { sessionUser } from '@/lib/resources';
import { readToken, resolveDerpiCredentials, updateUserInfo, writeUserInfo } from '@/lib/hooks';
import { LS_KEYS } from '@/lib/constants';
import { startCooldown, useCooldown } from '@/lib/useCooldown';
import { focusField, useFieldErrors } from '@/lib/useFieldErrors';
import {
  CODE_LENGTH,
  PASSWORD_HINT,
  USERNAME_HINT,
  validateAccount,
  validateCode,
  validateEmail,
  validateNewPassword,
  validatePasswordConfirmation,
  validateRequired,
  validateUsername,
} from '@/lib/validation';

import type { AuthView, PendingRegistration, ViewSwitch, AuthFormProps as ViewProps } from './AuthModal';

/**
 * A password reset whose code is on its way. It outlives the dialog the same way a pending
 * sign-up does — for as long as the code itself (the copy's 「10 分钟内有效」): closing the dialog
 * to read the mail no longer throws the code step away, and the resend countdown resumes where
 * it was. It ends when the password is reset or the user changes the account. No password is kept.
 */
interface PendingReset {
  account: string;
  sentAt: number;
}

const PENDING_RESET_KEY = 'picpony_pending_reset';
/** How long a reset code stays valid. */
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
/** The backend's resend window, which `useCooldown` also defaults to. */
const RESEND_SECONDS = 60;

/** The cooldown key for an account — one countdown per account, however it was typed. */
const resetCooldownKey = (account: string) => `reset:${account.trim().toLowerCase()}`;

function readPendingReset(): PendingReset | null {
  try {
    const raw = sessionStorage.getItem(PENDING_RESET_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingReset> | null;
    if (value && typeof value.account === 'string' && typeof value.sentAt === 'number') {
      const age = Date.now() - value.sentAt;
      if (value.account.trim() && age >= 0 && age < RESET_CODE_TTL_MS) {
        return { account: value.account, sentAt: value.sentAt };
      }
    }
  } catch {
    // Storage can be disabled; the step then lasts as long as the form.
  }
  return null;
}

function writePendingReset(value: PendingReset | null) {
  try {
    if (value) sessionStorage.setItem(PENDING_RESET_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_RESET_KEY);
  } catch {
    // As above.
  }
}

/** Form state and authentication requests live behind the dialog's lazy boundary. */
export default function AuthForms({ view, ...props }: ViewProps & { view: AuthView }) {
  if (view === 'register') return <RegisterForm {...props} />;
  if (view === 'reset') return <ResetForm {...props} />;
  return <LoginForm {...props} />;
}

/**
 * "返回登录", which appeared three times byte-for-byte. One component, so a
 * change to one cannot silently leave the other two behind. A text button, whose
 * container edge sits in the column's gutter so the arrow lines up with the fields.
 */
function BackToLogin({ onSwitch }: { onSwitch: (next: ViewSwitch) => void }) {
  return (
    <Button
      variant="text"
      icon={<MdArrowBack />}
      onClick={() => onSwitch({ view: 'login' })}
      className="-ml-4 mb-6"
    >
      返回登录
    </Button>
  );
}

/** A view's title. `h2`: the dialog sits under the page's own `h1`, and names itself by it. */
function ViewHeading({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} tabIndex={-1} className={cn('text-headline-s text-on-surface focus-visible:outline-hidden', className)}>
      {children}
    </h2>
  );
}

/**
 * The in-sentence switch — 「还没有账号？立即注册」. A link in the prose role (its underline is
 * the affordance, its colour the link role at 6:1), not ink in `primary-ink`, which measured
 * 2.5:1 here; the sentence stands on its own line, so the finger-sized hit area cannot reach
 * another line's target.
 */
function InlineSwitch({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="prose-link touch-target cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
    >
      {children}
    </button>
  );
}

interface AuthOperation {
  expectedToken: string | null;
  cancelled: boolean;
}

/** A closed/replaced form no longer owns its response, including while Modal
 * keeps it mounted for its exit. The ref lock also closes the same-frame double
 * submit gap; React's loading state alone cannot do that. */
function useAuthOperation(isCurrentFlow: () => boolean) {
  const operation = useRef<AuthOperation | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const sessionChanged = () => {
      const pending = operation.current;
      if (pending && readToken() !== pending.expectedToken) pending.cancelled = true;
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === LS_KEYS.userInfo) sessionChanged();
    };
    window.addEventListener('user_info_updated', sessionChanged);
    window.addEventListener('storage', storageChanged);
    return () => {
      mounted.current = false;
      if (operation.current) operation.current.cancelled = true;
      window.removeEventListener('user_info_updated', sessionChanged);
      window.removeEventListener('storage', storageChanged);
    };
  }, []);

  return {
    begin() {
      if (!isCurrentFlow() || operation.current) return null;
      const next = { expectedToken: readToken(), cancelled: false };
      operation.current = next;
      return next;
    },
    current(pending: AuthOperation) {
      return mounted.current && isCurrentFlow() && operation.current === pending &&
        !pending.cancelled && readToken() === pending.expectedToken;
    },
    finish(pending: AuthOperation) {
      if (operation.current !== pending) return false;
      operation.current = null;
      return mounted.current && isCurrentFlow();
    },
    busy() { return operation.current !== null; },
  };
}

/** Report the form's own dirtiness to the dialog after each change. */
function useReportDirty(dirty: boolean, onDirtyChange: (dirty: boolean) => void) {
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
}

/**
 * Focus when a form arrives, either after its chunk loads or after a view switch: the first
 * field under a mouse, the heading under a finger. A chunk that finishes during dismissal
 * must not take focus back from the page, or override a focus choice already made
 * in the new view before its animation frame runs.
 */
function useFocusOnMount(
  enabled: boolean,
  finePointer: boolean,
  headingId: string,
  first: () => HTMLElement | null | undefined,
  isCurrentFlow: () => boolean,
) {
  const viewRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef(first);
  useEffect(() => {
    firstRef.current = first;
  });
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      if (!isCurrentFlow() || viewRef.current?.contains(document.activeElement)) return;
      const target = finePointer ? firstRef.current() : null;
      if (target) focusField(target);
      else document.getElementById(headingId)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
    // Once, when the view appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return viewRef;
}

/** A failed request's sentence: the server's own words, or the one wording for its status. */
function failureOf(data: unknown, fallback: string) {
  return envelopeMessage(data) ?? fallback;
}

/** The fields every sign-in response carries, as the session stores them. */
function sessionFrom(data: Record<string, unknown>) {
  return {
    token: data.token as string,
    username: data.username as string,
    avatar: data.avatar as string | undefined,
    role: data.role as string | undefined,
    api_key: data.api_key as string | undefined,
    derpi_user_id: data.derpi_user_id as number | undefined,
    derpi_username: data.derpi_username as string | undefined,
  };
}

/**
 * Store a new session and fill it out from `get_user` through the shared resource, so the
 * shell does not immediately ask the same question again. Returns false if the operation was
 * superseded meanwhile. `writeUserInfo` throws when the browser refuses storage; that reaches
 * the caller's catch, whose message says so.
 */
async function establishSession(
  data: Record<string, unknown>,
  pending: AuthOperation,
  isCurrent: (pending: AuthOperation) => boolean,
): Promise<boolean> {
  const base = sessionFrom(data);
  pending.expectedToken = base.token;
  writeUserInfo(base);
  try {
    const result = await sessionUser.read({ token: base.token });
    if (!isCurrent(pending)) return false;
    if (result.kind === 'ok') {
      /* The sign-in response's Derpibooru binding is the newer word — but only where it says
         something: a response without `api_key` used to overwrite the account read's key with
         `undefined`, and `writeUserInfo` then deleted the stored key until the shell's next
         read put it back (review P2-F9). `resolveDerpiCredentials` is that rule, shared with the
         shell's own merge. */
      updateUserInfo(base.token, {
        ...base,
        ...result.user,
        token: base.token,
        ...resolveDerpiCredentials(base as unknown as Record<string, unknown>, result.user as unknown as Record<string, unknown>),
      });
    }
  } catch {
    // The session is valid without the extra fields; the shell reads them again itself.
  }
  return isCurrent(pending);
}

function LoginForm({
  headingId,
  onSwitch,
  onCaptchaChange,
  onSuccess,
  isCurrentFlow,
  onDirtyChange,
  focusOnMount,
  finePointer,
}: ViewProps) {
  const operation = useAuthOperation(isCurrentFlow);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const usernameRef = useRef<HTMLInputElement | null>(null);
  const form = useFieldErrors<'username' | 'password'>(() => [
    ['username', validateRequired(username, '请输入用户名')],
    ['password', password ? null : '请输入密码'],
  ]);
  const usernameField = form.field('username');
  const passwordField = form.field('password');

  useReportDirty(Boolean(username || password), onDirtyChange);
  const viewRef = useFocusOnMount(focusOnMount, finePointer, headingId, () => usernameRef.current, isCurrentFlow);

  /* One-way: once the challenge has been shown the element stays mounted, so its
     exit animation has something to run on. See the note on the import. */
  const [captchaMounted, setCaptchaMounted] = useState(false);

  const setCaptcha = (open: boolean) => {
    if (open) setCaptchaMounted(true);
    setShowCaptchaModal(open);
    onCaptchaChange(open);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isCurrentFlow() || operation.busy()) return;
    if (!form.check()) return;
    setCaptcha(true);
  };

  const onCaptchaVerify = async (token: string) => {
    const pending = operation.begin();
    if (!pending) return;
    setCaptcha(false);
    setIsLoading(true);
    try {
      const res = await login({ username: username.trim(), password, cf_token: token });
      const data = await readJson(res);
      if (!operation.current(pending)) return;
      if (res.ok && data.success && typeof data.token === 'string') {
        if (!(await establishSession(data, pending, operation.current))) return;
        showToast('已登录', 'success');
        onSuccess();
      } else {
        showToast(failureOf(data, '登录失败，请检查用户名和密码'), 'error');
      }
    } catch (err) {
      if (operation.current(pending)) showToast(apiErrorMessage(err), 'error');
    } finally {
      if (operation.finish(pending)) setIsLoading(false);
    }
  };

  return (
    <div ref={viewRef}>
      <ViewHeading id={headingId} className="mb-8">登录</ViewHeading>
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Input
          {...usernameField}
          ref={(element) => {
            usernameRef.current = element;
            usernameField.ref(element);
          }}
          id="auth-login-f1"
          name="username"
          type="text"
          label="用户名"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          data-autofocus={finePointer ? '' : undefined}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            form.clear('username');
          }}
        />
        <Input
          {...passwordField}
          id="auth-login-f2"
          name="password"
          type="password"
          label="密码"
          autoComplete="current-password"
          enterKeyHint="go"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            form.clear('password');
          }}
        />
        {/* 忘记密码 belongs to the password it recovers, so it sits under that field.
            The account typed above travels to the reset form, which takes either kind. */}
        <div className="-mt-2 flex justify-end">
          <Button
            type="button"
            variant="text"
            className="-mr-4"
            onClick={() => onSwitch({ view: 'reset', account: username.trim() || undefined })}
          >
            忘记密码？
          </Button>
        </div>
        {captchaMounted && (
          <CaptchaModal
            isOpen={showCaptchaModal}
            onClose={() => setCaptcha(false)}
            onVerify={onCaptchaVerify}
          />
        )}
        <Button type="submit" variant="filled" size="lg" fullWidth loading={isLoading}>
          登录
        </Button>
      </form>
      <p className="mt-6 text-center text-body-m text-on-surface-variant">
        还没有账号？<InlineSwitch onClick={() => onSwitch({ view: 'register' })}>立即注册</InlineSwitch>
      </p>
    </div>
  );
}

/**
 * Sign-up, in two steps: the details, then the e-mail code. The step is the pending
 * registration's presence, so a reopened dialog lands on the code step until it is done. A
 * step reached inside the open dialog swaps in like a view and takes the focus.
 */
function RegisterForm(props: ViewProps) {
  const [arrived, setArrived] = useState(false);
  const onPendingChange = (value: PendingRegistration | null) => {
    setArrived(true);
    props.onPendingChange(value);
  };
  const stepProps = { ...props, onPendingChange, focusOnMount: props.focusOnMount || arrived };
  return (
    <div key={props.pending ? 'verify' : 'details'} className={cn(arrived && 'animate-page-transition')}>
      {props.pending ? (
        <VerifyEmail {...stepProps} pending={props.pending} />
      ) : (
        <RegisterDetails {...stepProps} />
      )}
    </div>
  );
}

function RegisterDetails({
  headingId,
  onSwitch,
  onCaptchaChange,
  onSuccess,
  isCurrentFlow,
  onDirtyChange,
  focusOnMount,
  finePointer,
  onPendingChange,
}: ViewProps) {
  const operation = useAuthOperation(isCurrentFlow);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const usernameRef = useRef<HTMLInputElement | null>(null);
  const form = useFieldErrors<'username' | 'email' | 'password'>(() => [
    ['username', validateUsername(username)],
    ['email', validateEmail(email)],
    ['password', validateNewPassword(password)],
  ]);
  const usernameField = form.field('username');

  useReportDirty(Boolean(username || email || password), onDirtyChange);
  const viewRef = useFocusOnMount(focusOnMount, finePointer, headingId, () => usernameRef.current, isCurrentFlow);

  /* One-way: once the challenge has been shown the element stays mounted, so its exit animation
     has something to run on. See the note on the import. */
  const [captchaMounted, setCaptchaMounted] = useState(false);

  const setCaptcha = (open: boolean) => {
    if (open) setCaptchaMounted(true);
    setShowCaptchaModal(open);
    onCaptchaChange(open);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isCurrentFlow() || operation.busy()) return;
    if (!form.check()) return;
    setCaptcha(true);
  };

  const onCaptchaVerify = async (token: string) => {
    setCaptcha(false);
    const pending = operation.begin();
    if (!pending) return;
    setIsLoading(true);
    const name = username.trim();
    const address = email.trim();
    try {
      const res = await register({ username: name, email: address, password, cf_token: token });
      const data = await readJson(res);
      if (!operation.current(pending)) return;
      if (res.ok && data.success && typeof data.token === 'string') {
        // A server that needs no e-mail check signs the new account in at once.
        if (!(await establishSession(data, pending, operation.current))) return;
        showToast('已注册，欢迎加入', 'success');
        onSuccess();
      } else if (res.ok && data.success && typeof data.user_id === 'number') {
        startCooldown(`register:${data.user_id}`);
        onPendingChange({
          userId: data.user_id,
          username: typeof data.username === 'string' ? data.username : name,
          email: address,
        });
        showToast('验证码已发送至邮箱', 'success');
      } else {
        showToast(failureOf(data, '注册失败，请检查填写的内容'), 'error');
      }
    } catch (err) {
      if (operation.current(pending)) showToast(apiErrorMessage(err), 'error');
    } finally {
      if (operation.finish(pending)) setIsLoading(false);
    }
  };

  return (
    <div ref={viewRef}>
      <BackToLogin onSwitch={onSwitch} />
      <ViewHeading id={headingId} className="mb-8">注册</ViewHeading>
      <form className="space-y-4" onSubmit={handleSubmit} noValidate>
        <Input
          {...usernameField}
          ref={(element) => {
            usernameRef.current = element;
            usernameField.ref(element);
          }}
          id="auth-register-f1"
          name="username"
          type="text"
          label="用户名"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          data-autofocus={finePointer ? '' : undefined}
          helper={USERNAME_HINT}
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            form.clear('username');
          }}
        />
        <Input
          {...form.field('email')}
          id="auth-register-f2"
          name="email"
          type="email"
          inputMode="email"
          label="邮箱"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="next"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            form.clear('email');
          }}
        />
        <Input
          {...form.field('password')}
          id="auth-register-f3"
          name="new-password"
          type="password"
          label="密码"
          autoComplete="new-password"
          enterKeyHint="go"
          helper={PASSWORD_HINT}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            form.clear('password');
          }}
        />
        {captchaMounted && (
          <CaptchaModal
            isOpen={showCaptchaModal}
            onClose={() => setCaptcha(false)}
            onVerify={onCaptchaVerify}
          />
        )}
        <Button type="submit" variant="filled" size="lg" fullWidth loading={isLoading}>
          注册
        </Button>
      </form>
      <p className="mt-6 text-center text-body-m text-on-surface-variant">
        已有账号？<InlineSwitch onClick={() => onSwitch({ view: 'login' })}>立即登录</InlineSwitch>
      </p>
    </div>
  );
}

/** The resend control both code steps share: a text button that counts down after a send. */
function ResendButton({
  seconds,
  busy,
  onResend,
}: {
  seconds: number;
  busy: boolean;
  onResend: () => void;
}) {
  return (
    <Button type="button" variant="text" className="-mr-4 tabular-nums" disabled={seconds > 0} loading={busy} onClick={onResend}>
      {seconds > 0 ? `重新发送（${seconds} 秒）` : '重新发送验证码'}
    </Button>
  );
}

function VerifyEmail({
  headingId,
  onSwitch,
  onSuccess,
  isCurrentFlow,
  onDirtyChange,
  focusOnMount,
  finePointer,
  pending: registration,
  onPendingChange,
}: ViewProps & { pending: PendingRegistration }) {
  const operation = useAuthOperation(isCurrentFlow);
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const codeRef = useRef<HTMLDivElement | null>(null);
  const cooldown = useCooldown(`register:${registration.userId}`);
  const form = useFieldErrors<'code'>(() => [['code', validateCode(code)]]);
  const codeField = form.field('code');

  useReportDirty(code.length > 0, onDirtyChange);
  const viewRef = useFocusOnMount(focusOnMount, finePointer, headingId, () => codeRef.current, isCurrentFlow);

  const verify = async (value: string) => {
    if (!isCurrentFlow() || operation.busy()) return;
    if (validateCode(value)) {
      form.check();
      return;
    }
    const pending = operation.begin();
    if (!pending) return;
    setIsVerifying(true);
    try {
      const res = await verifyEmailById(registration.userId, value);
      const data = await readJson(res);
      if (!operation.current(pending)) return;
      if (res.ok && data.success && typeof data.token === 'string') {
        onPendingChange(null);
        cooldown.reset();
        if (!(await establishSession(data, pending, operation.current))) return;
        showToast('邮箱已验证，欢迎加入', 'success');
        onSuccess();
      } else if (res.ok) {
        // The server read the code and refused it: the answer goes under the code.
        form.set('code', failureOf(data, '验证码错误，请重新输入'));
      } else {
        showToast(failureOf(data, '邮箱验证失败，请稍后再试'), 'error');
      }
    } catch (err) {
      if (operation.current(pending)) showToast(apiErrorMessage(err), 'error');
    } finally {
      if (operation.finish(pending)) setIsVerifying(false);
    }
  };

  const resend = async () => {
    const pending = operation.begin();
    if (!pending) return;
    setIsResending(true);
    try {
      const res = await resendVerifyCodeById(registration.userId);
      const data = await readJson(res);
      if (!operation.current(pending)) return;
      if (res.ok && data.success) {
        cooldown.start();
        showToast('验证码已重新发送', 'success');
      } else {
        showToast(failureOf(data, '验证码发送失败，请稍后再试'), 'error');
      }
    } catch (err) {
      if (operation.current(pending)) showToast(apiErrorMessage(err), 'error');
    } finally {
      if (operation.finish(pending)) setIsResending(false);
    }
  };

  return (
    <div ref={viewRef}>
      <BackToLogin onSwitch={onSwitch} />
      <ViewHeading id={headingId} className="mb-2">验证邮箱</ViewHeading>
      <p className="text-body-m text-on-surface-variant mb-8">
        验证码已发送至 <span className="text-on-surface wrap-anywhere">{registration.email}</span>，10 分钟内有效。
      </p>
      <form
        className="space-y-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
      >
        <div ref={(element) => { codeRef.current = element; codeField.ref(element); }}>
          <Field error={codeField.error}>
            <CodeInput
              value={code}
              length={CODE_LENGTH}
              onChange={(next) => {
                setCode(next);
                form.clear('code');
              }}
              // Six digits are the whole answer: the step submits itself.
              onComplete={(value) => void verify(value)}
              autoFocus={finePointer}
              disabled={isVerifying}
              aria-label="邮箱验证码"
            />
          </Field>
        </div>
        <Button type="submit" variant="filled" size="lg" fullWidth loading={isVerifying}>
          验证并登录
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-2">
        {/* Starting over is the one way out of the pending sign-up; 返回登录 keeps it. */}
        <Button
          type="button"
          variant="text"
          className="-ml-4"
          onClick={() => {
            onPendingChange(null);
            cooldown.reset();
          }}
        >
          重新注册
        </Button>
        <ResendButton seconds={cooldown.remaining} busy={isResending} onResend={() => void resend()} />
      </div>
    </div>
  );
}

function ResetForm({
  headingId,
  onSwitch,
  isCurrentFlow,
  onDirtyChange,
  focusOnMount,
  finePointer,
  prefillAccount,
}: ViewProps) {
  const operation = useAuthOperation(isCurrentFlow);
  /* A code already on its way resumes on its own step — unless the sign-in form handed over a
     different account. Read in the initializer: this form only ever mounts in the open dialog,
     after a gesture, never on the server. */
  const [restored] = useState<PendingReset | null>(() => {
    if (typeof window === 'undefined') return null;
    const stored = readPendingReset();
    if (!stored) return null;
    if (prefillAccount && resetCooldownKey(prefillAccount) !== resetCooldownKey(stored.account)) return null;
    return stored;
  });
  const [step, setStep] = useState<'request' | 'reset'>(restored ? 'reset' : 'request');
  /** Whether the step on screen replaced another one while the dialog was open. */
  const [stepChanged, setStepChanged] = useState(false);
  const [accountInput, setAccountInput] = useState(restored?.account ?? prefillAccount ?? '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const accountRef = useRef<HTMLInputElement | null>(null);
  const codeRef = useRef<HTMLDivElement | null>(null);
  const account = accountInput.trim();
  const isAddress = account.includes('@');
  const cooldown = useCooldown(account ? resetCooldownKey(account) : null);

  // After a reload the in-memory countdown is gone; the stored send time still knows it.
  useEffect(() => {
    if (!restored) return;
    const left = Math.ceil((restored.sentAt + RESEND_SECONDS * 1000 - Date.now()) / 1000);
    if (left > 0) startCooldown(resetCooldownKey(restored.account), left);
  }, [restored]);

  const requestForm = useFieldErrors<'account'>(() => [['account', validateAccount(accountInput)]]);
  const accountField = requestForm.field('account');
  const resetForm = useFieldErrors<'code' | 'password' | 'confirm'>(() => [
    ['code', validateCode(code)],
    ['password', validateNewPassword(newPassword)],
    ['confirm', validatePasswordConfirmation(newPassword, confirmPassword)],
  ]);
  const codeField = resetForm.field('code');

  useReportDirty(Boolean(accountInput || code || newPassword || confirmPassword), onDirtyChange);
  const viewRef = useFocusOnMount(focusOnMount, finePointer, headingId, () =>
    step === 'reset' ? codeRef.current : accountRef.current,
    isCurrentFlow,
  );

  const goTo = (next: 'request' | 'reset') => {
    setStep(next);
    setStepChanged(true);
    requestAnimationFrame(() => {
      if (finePointer) focusField(next === 'reset' ? codeRef.current : accountRef.current);
      else document.getElementById(headingId)?.focus({ preventScroll: true });
    });
  };

  /** Ask for a code. `resend` stays on the second step and restarts its countdown. */
  const sendCode = async (resend: boolean) => {
    if (!isCurrentFlow() || operation.busy()) return;
    const pending = operation.begin();
    if (!pending) return;
    if (resend) setIsResending(true);
    else setIsLoading(true);
    try {
      const res = await resetPasswordRequest(account);
      const data = await readJson(res);
      if (!operation.current(pending)) return;
      if (res.ok && data.success) {
        cooldown.start();
        writePendingReset({ account, sentAt: Date.now() });
        showToast(resend ? '验证码已重新发送' : '验证码已发送至注册邮箱', 'success');
        if (!resend) goTo('reset');
      } else {
        showToast(failureOf(data, '验证码发送失败，请稍后再试'), 'error');
      }
    } catch (err) {
      if (operation.current(pending)) showToast(apiErrorMessage(err), 'error');
    } finally {
      if (operation.finish(pending)) {
        setIsLoading(false);
        setIsResending(false);
      }
    }
  };

  const handleRequestCode = (e: FormEvent) => {
    e.preventDefault();
    if (!isCurrentFlow() || operation.busy()) return;
    if (!requestForm.check()) return;
    // A code sent to this account a moment ago is still on its way; enter it, do not ask again.
    if (cooldown.active) goTo('reset');
    else void sendCode(false);
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!isCurrentFlow() || operation.busy()) return;
    if (!resetForm.check()) return;

    const pending = operation.begin();
    if (!pending) return;
    setIsLoading(true);
    try {
      const res = await resetPassword({
        account,
        code: code.trim(),
        new_password: newPassword,
      });
      const data = await readJson(res);
      if (!operation.current(pending)) return;
      if (res.ok && data.success) {
        cooldown.reset();
        writePendingReset(null);
        showToast('密码已重置，请重新登录', 'success');
        onSwitch({ view: 'login' });
      } else {
        showToast(failureOf(data, '密码重置失败，请检查验证码'), 'error');
      }
    } catch (err) {
      if (operation.current(pending)) showToast(apiErrorMessage(err), 'error');
    } finally {
      if (operation.finish(pending)) setIsLoading(false);
    }
  };

  return (
    <div ref={viewRef}>
      <BackToLogin onSwitch={onSwitch} />
      <div key={step} className={cn(stepChanged && 'animate-page-transition')}>
        <ViewHeading id={headingId} className="mb-2">
          {step === 'request' ? '忘记密码' : '重置密码'}
        </ViewHeading>
        {step === 'request' ? (
          <>
            <p className="text-body-m text-on-surface-variant mb-8">
              输入用户名或注册邮箱，验证码将发送至该账号的注册邮箱。
            </p>
            <form onSubmit={handleRequestCode} className="space-y-4" noValidate>
              <Input
                {...accountField}
                ref={(element) => {
                  accountRef.current = element;
                  accountField.ref(element);
                }}
                name="username"
                type="text"
                label="用户名或邮箱"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                data-autofocus={finePointer ? '' : undefined}
                value={accountInput}
                onChange={(e) => {
                  setAccountInput(e.target.value);
                  requestForm.clear('account');
                }}
              />
              <Button type="submit" variant="filled" size="lg" fullWidth loading={isLoading}>
                发送验证码
              </Button>
            </form>
          </>
        ) : (
          <>
            {/* A username is named as the account, never printed as if it were the address. */}
            <p className="text-body-m text-on-surface-variant mb-6">
              {isAddress ? (
                <>
                  验证码已发送至 <span className="text-on-surface wrap-anywhere">{account}</span>，10 分钟内有效。
                </>
              ) : (
                <>
                  验证码已发送至账号 <span className="text-on-surface wrap-anywhere">{account}</span>{' '}
                  的注册邮箱，10 分钟内有效。
                </>
              )}
            </p>
            <form onSubmit={handleResetPassword} className="space-y-4" noValidate>
              {/* Tells a password manager whose password the new one is. */}
              <input type="text" name="username" autoComplete="username" value={account} readOnly hidden />
              <div ref={(element) => { codeRef.current = element; codeField.ref(element); }}>
                <Field error={codeField.error}>
                  <CodeInput
                    value={code}
                    length={CODE_LENGTH}
                    onChange={(next) => {
                      setCode(next);
                      resetForm.clear('code');
                    }}
                    disabled={isLoading}
                    aria-label="邮箱验证码"
                  />
                </Field>
              </div>
              <Input
                {...resetForm.field('password')}
                name="new-password"
                type="password"
                label="新密码"
                autoComplete="new-password"
                enterKeyHint="next"
                helper={PASSWORD_HINT}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  resetForm.clear('password');
                }}
              />
              <Input
                {...resetForm.field('confirm')}
                name="confirm-password"
                type="password"
                label="确认新密码"
                autoComplete="new-password"
                enterKeyHint="go"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  resetForm.clear('confirm');
                }}
              />
              <Button type="submit" variant="filled" size="lg" fullWidth loading={isLoading}>
                重置密码
              </Button>
            </form>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-2">
              <Button
                type="button"
                variant="text"
                className="-ml-4"
                onClick={() => {
                  // Another account starts over; this one's countdown stays under its own key.
                  writePendingReset(null);
                  goTo('request');
                }}
              >
                更换账号
              </Button>
              <ResendButton seconds={cooldown.remaining} busy={isResending} onResend={() => void sendCode(true)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
