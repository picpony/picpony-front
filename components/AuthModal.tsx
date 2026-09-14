'use client';

import dynamic from 'next/dynamic';

import { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react';
import { MdClose, MdEmail, MdLock, MdSend, MdArrowBack } from 'react-icons/md';
import IconButton from './IconButton';
import Modal from './Modal';
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
import { Input } from './Input';
import LottieIcon from './LottieIcon';
import Logo from './Logo';
import { showToast } from './Toast';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { sessionUser } from '@/lib/resources';
import { readToken, updateUserInfo, writeUserInfo } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { LS_KEYS } from '@/lib/constants';

export type AuthView = 'login' | 'register' | 'reset';

interface AuthContextValue {
  isOpen: boolean;
  view: AuthView;
  openAuth: (view?: AuthView) => void;
  closeAuth: () => void;
  switchView: (view: AuthView) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthModal() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthModal 必须在 AuthProvider 内使用');
  return ctx;
}

// 全局登录弹窗：登录/注册/找回共用，切换视图时窗口不关闭
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<AuthView>('login');
  // 验证码弹窗打开时禁用外层 Esc，避免误关整窗
  const [innerModalOpen, setInnerModalOpen] = useState(false);
  const [flow, setFlow] = useState(0);
  const flowRef = useRef(0);
  const openRef = useRef(false);

  const openAuth = useCallback((v: AuthView = 'login') => {
    openRef.current = true;
    setFlow(++flowRef.current);
    setInnerModalOpen(false);
    setView(v);
    setIsOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    openRef.current = false;
    flowRef.current += 1;
    setInnerModalOpen(false);
    setIsOpen(false);
  }, []);

  const switchView = useCallback((v: AuthView) => {
    setFlow(++flowRef.current);
    setInnerModalOpen(false);
    setView(v);
  }, []);

  return (
    <AuthContext.Provider value={{ isOpen, view, openAuth, closeAuth, switchView }}>
      {children}
      <AuthModal
        isOpen={isOpen}
        view={view}
        onClose={closeAuth}
        onSwitchView={switchView}
        closeOnEscape={!innerModalOpen}
        innerModalOpen={innerModalOpen}
        onInnerModalChange={setInnerModalOpen}
        flow={flow}
        isCurrentFlow={() => openRef.current && flowRef.current === flow}
      />
    </AuthContext.Provider>
  );
}

function AuthModal({
  isOpen,
  view,
  onClose,
  onSwitchView,
  closeOnEscape,
  innerModalOpen,
  onInnerModalChange,
  flow,
  isCurrentFlow,
}: {
  isOpen: boolean;
  view: AuthView;
  onClose: () => void;
  onSwitchView: (view: AuthView) => void;
  closeOnEscape: boolean;
  innerModalOpen: boolean;
  onInnerModalChange: (open: boolean) => void;
  flow: number;
  isCurrentFlow: () => boolean;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="4xl"
      aria-label={view === 'login' ? '登录' : view === 'register' ? '注册' : '找回密码'}
      bodyClassName="p-0"
      closeOnEscape={closeOnEscape}
      hideCloseButton
      // 整个窗口组件在验证码弹窗打开时缩小让位，带动画
      // 用独立 scale 属性（Tailwind v4），避开 modalContent 动画 forwards 对 transform/opacity 的填充锁定
      panelClassName={cn(
        'transition-[scale] spring-default-spatial',
        innerModalOpen ? 'scale-95' : 'scale-100',
      )}
    >
      {/* 手机高度跟随内容自适应，桌面保持固定较高高度 */}
      <div className="flex md:min-h-[640px]">
        <div
          aria-hidden="true"
          className="hidden md:flex md:w-3/5 items-center justify-center bg-surface-container-low"
        >
          <LottieIcon
            className="w-4/5 max-w-md"
            load={() => import('@/lib/lottie/login.json').then((m) => m.default)}
            /* 3257×2148, the composition's own box. Reserving it matters more here
               than on /search: this pane is 60% of a 640px-tall dialog, so an
               unreserved host let the form column decide the height and then
               resized it when the chunk landed. */
            aspect={3257 / 2148}
            /* The wordmark, which is what /about already falls back to under
               reduced motion — so this pane is never empty. */
            fallback={<Logo className="h-auto w-2/3" />}
          />
        </div>
        {/* flex-col + my-auto：内容短时垂直居中，超高时正常滚动 */}
        <div className="relative main-scrollbar flex w-full md:w-2/5 flex-col overflow-y-auto p-6 sm:p-8">
          <IconButton
            onClick={onClose}
            aria-label="关闭"
            dismiss
            className="absolute right-1 top-5 z-10 hover:text-on-surface"
            icon={<MdClose size={ICON.standard} />}
          />
          <div key={`${view}:${flow}`} className="my-auto animate-page-transition">
            {view === 'login' && (
              <LoginForm
                onSwitch={onSwitchView}
                onCaptchaChange={onInnerModalChange}
                onSuccess={onClose}
                isCurrentFlow={isCurrentFlow}
              />
            )}
            {view === 'register' && (
              <RegisterForm
                onSwitch={onSwitchView}
                onCaptchaChange={onInnerModalChange}
                onSuccess={onClose}
                isCurrentFlow={isCurrentFlow}
              />
            )}
            {view === 'reset' && <ResetForm onSwitch={onSwitchView} isCurrentFlow={isCurrentFlow} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * "返回登录", which appeared three times byte-for-byte. One component, so a
 * change to one cannot silently leave the other two behind.
 */
function BackToLogin({ onSwitch }: { onSwitch: (view: AuthView) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSwitch('login')}
      className="mb-8 flex items-center rounded-xs text-label-l text-on-surface-variant outline-none transition-ui hover:text-on-surface focus-visible:ring-2 focus-ring"
    >
      <MdArrowBack size={ICON.dense} className="mr-1" /> 返回登录
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

function LoginForm({
  onSwitch,
  onCaptchaChange,
  onSuccess,
  isCurrentFlow,
}: {
  onSwitch: (view: AuthView) => void;
  onCaptchaChange: (open: boolean) => void;
  onSuccess: () => void;
  isCurrentFlow: () => boolean;
}) {
  const operation = useAuthOperation(isCurrentFlow);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);

  /* One-way: once the challenge has been shown the element stays mounted, so its
     exit animation has something to run on. See the note on the import. */
  const [captchaMounted, setCaptchaMounted] = useState(false);

  const setCaptcha = (open: boolean) => {
    if (open) setCaptchaMounted(true);
    setShowCaptchaModal(open);
    onCaptchaChange(open);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCurrentFlow() || operation.busy()) return;
    if (!username || !password) {
      showToast('请输入用户名和密码', 'error');
      return;
    }
    setCaptcha(true);
  };

  const onCaptchaVerify = async (token: string) => {
    const pending = operation.begin();
    if (!pending) return;
    setCaptcha(false);
    setIsLoading(true);
    try {
      const res = await api.login({ username, password, cf_token: token });
      const data = await res.json();
      if (!operation.current(pending)) return;
      if (res.ok && data.success) {
        const baseUserInfo = {
          token: data.token,
          username: data.username,
          avatar: data.avatar,
          role: data.role,
          api_key: data.api_key,
          derpi_user_id: data.derpi_user_id,
          derpi_username: data.derpi_username,
        };
        pending.expectedToken = data.token;
        writeUserInfo(baseUserInfo);
        try {
          /* Through the shared resource, so the shell does not immediately ask
             the same question again: this fills the cache entry for the new
             token, so `AppLayout` joins the same in-flight read. */
          const result = await sessionUser.read({ token: data.token });
          if (!operation.current(pending)) return;
          if (result.kind === 'ok') {
            updateUserInfo(data.token, {
              ...baseUserInfo,
              ...result.user,
              token: data.token,
              api_key: data.api_key,
              derpi_user_id: data.derpi_user_id,
              derpi_username: data.derpi_username,
            });
          }
        } catch (err) {
          console.error('Failed to fetch user info after login', err);
        }
        if (!operation.current(pending)) return;
        showToast('登录成功', 'success');
        onSuccess();
      } else {
        showToast(data.message || '登录失败，请检查用户名和密码', 'error');
      }
    } catch {
      if (operation.current(pending)) showToast('网络错误，请稍后再试', 'error');
    } finally {
      if (operation.finish(pending)) setIsLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-headline-s text-on-surface mb-8">登录</h1>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          id="auth-login-f1"
          type="text"
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          placeholder="请输入用户名"
        />
        <Input
          id="auth-login-f2"
          type="password"
          label="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="请输入密码"
        />
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
      <div className="mt-6 text-center space-y-2">
        <p className="text-body-m text-on-surface-variant">
          还没有账号？{' '}
          <button
            type="button"
            onClick={() => onSwitch('register')}
            className="text-primary-ink cursor-pointer hover:underline rounded-xs outline-none focus-visible:ring-2 focus-ring"
          >
            立即注册
          </button>
        </p>
        <p className="text-body-m text-on-surface-variant">
          <button
            type="button"
            onClick={() => onSwitch('reset')}
            className="text-primary-ink cursor-pointer hover:underline rounded-xs outline-none focus-visible:ring-2 focus-ring"
          >
            忘记密码？
          </button>
        </p>
      </div>
    </div>
  );
}

type RegisterStep = 'form' | 'verify';

function RegisterForm({
  onSwitch,
  onCaptchaChange,
  onSuccess,
  isCurrentFlow,
}: {
  onSwitch: (view: AuthView) => void;
  onCaptchaChange: (open: boolean) => void;
  onSuccess: () => void;
  isCurrentFlow: () => boolean;
}) {
  const operation = useAuthOperation(isCurrentFlow);
  const [step, setStep] = useState<RegisterStep>('form');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const registeredUserId = useRef<number>(0);
  const registeredUsername = useRef<string>('');

  /* One string, not six characters plus a ref array. `CodeInput` owns the boxes,
     the focus advance, paste distribution, the arrow keys and the a11y labels. */
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  /* One-way: once the challenge has been shown the element stays mounted, so its exit animation
     has something to run on. See the note on the import. */
  const [captchaMounted, setCaptchaMounted] = useState(false);

  const setCaptcha = (open: boolean) => {
    if (open) setCaptchaMounted(true);
    setShowCaptchaModal(open);
    onCaptchaChange(open);
  };

  const validateForm = (): string | null => {
    if (!username.trim()) return '请输入用户名';
    if (username.trim().length > 20) return '用户名长度不得超过 20 个字符';
    if (!/^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$/.test(username.trim())) {
      return '用户名只能包含字母、数字、下划线、减号和中文字符';
    }
    if (!email.trim()) return '请输入邮箱';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return '请输入有效的邮箱地址';
    if (email.trim().length > 50) return '邮箱地址最多 50 个字符';
    if (!password) return '请输入密码';
    if (password.length < 8 || password.length > 20) return '密码长度需在 8-20 位之间';
    if (!/[A-Za-z]/.test(password) || !/[^A-Za-z]/.test(password)) {
      return '密码必须包含字母和数字或特殊字符';
    }
    return null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCurrentFlow() || operation.busy()) return;
    const error = validateForm();
    if (error) {
      showToast(error, 'error');
      return;
    }
    setCaptcha(true);
  };

  const onCaptchaVerify = async (token: string) => {
    setCaptcha(false);
    const pending = operation.begin();
    if (!pending) return;
    setIsLoading(true);
    try {
      const res = await api.register({
        username: username.trim(),
        email: email.trim(),
        password,
        cf_token: token,
      });
      const data = await res.json();
      if (!operation.current(pending)) return;
      if (res.ok && data.success) {
        registeredUserId.current = data.user_id;
        registeredUsername.current = data.username;
        setStep('verify');
        showToast('验证码已发送至您的邮箱，请查收', 'success');
      } else {
        showToast(data.error || data.message || '注册失败，请检查输入', 'error');
      }
    } catch {
      if (operation.current(pending)) showToast('网络错误，请稍后再试', 'error');
    } finally {
      if (operation.finish(pending)) setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    if (code.length !== 6) {
      showToast('请输入完整的 6 位验证码', 'error');
      return;
    }
    const pending = operation.begin();
    if (!pending) return;
    setIsVerifying(true);
    try {
      const res = await api.verifyEmailById(registeredUserId.current, code);
      const data = await res.json();
      if (!operation.current(pending)) return;
      if (data.success) {
        pending.expectedToken = data.token;
        writeUserInfo({
          token: data.token,
          username: data.username,
          avatar: data.avatar,
          role: data.role,
          api_key: data.api_key,
          derpi_user_id: data.derpi_user_id,
          derpi_username: data.derpi_username,
        });
        showToast('邮箱验证成功，欢迎加入', 'success');
        onSuccess();
      } else {
        showToast(data.error || data.message || '验证失败', 'error');
      }
    } catch {
      if (operation.current(pending)) showToast('网络错误，请稍后再试', 'error');
    } finally {
      if (operation.finish(pending)) setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    const pending = operation.begin();
    if (!pending) return;
    setIsResending(true);
    try {
      const res = await api.resendVerifyCodeById(registeredUserId.current);
      const data = await res.json();
      if (!operation.current(pending)) return;
      if (data.success) {
        showToast('新验证码已发送，请查收', 'success');
      } else {
        showToast(data.error || data.message || '发送失败', 'error');
      }
    } catch {
      if (operation.current(pending)) showToast('网络错误，请稍后再试', 'error');
    } finally {
      if (operation.finish(pending)) setIsResending(false);
    }
  };

  if (step === 'verify') {
    return (
      <div>
        <BackToLogin onSwitch={onSwitch} />
        <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-headline-s text-on-surface mb-2">验证邮箱</h1>
          <p className="text-body-m text-on-surface-variant">
            验证码已发送至 <span className="text-on-surface">{email}</span>
          </p>
          <p className="text-body-s text-on-surface-variant mt-1">有效期为 10 分钟，请及时查收</p>
        </div>
        <div>
          <p className="block text-label-l text-on-surface mb-3 text-center">
            请输入 6 位验证码
          </p>
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            {/* `CodeInput`, the primitive — the boxes, the focus advance, paste
                distribution, the arrow keys and the a11y labels are its job. */}
            <CodeInput
              value={code}
              onChange={setCode}
              autoFocus
              disabled={isVerifying}
              aria-label="邮箱验证码"
            />
          </div>
        </div>
        <Button
          onClick={handleVerify}
          variant="filled"
          size="lg"
          fullWidth
          loading={isVerifying}
          disabled={code.length !== 6}
        >
          验证并登录
        </Button>
        <div className="text-center">
          <button
            onClick={handleResend}
            disabled={isResending}
            className="text-body-m text-primary-ink cursor-pointer hover:underline rounded-xs outline-none focus-visible:ring-2 focus-ring disabled:disabled-content disabled:cursor-not-allowed"
          >
            {isResending ? '发送中…' : '未收到？重新发送验证码'}
          </button>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackToLogin onSwitch={onSwitch} />
      <h1 className="text-headline-s text-on-surface mb-8">注册</h1>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          id="auth-register-f1"
          type="text"
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          placeholder="字母、数字、下划线、中文"
          maxLength={20}
          helper="支持字母、数字、下划线(_)、减号(-)和中文字符"
        />
        <Input
          id="auth-register-f2"
          type="email"
          label="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="请输入邮箱"
          maxLength={50}
        />
        <Input
          id="auth-register-f3"
          type="password"
          label="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="8-20位，需包含字母和数字/字符"
          maxLength={20}
          helper="长度 8-20 位，必须包含字母和数字或特殊字符"
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
      <div className="mt-6 text-center">
        <p className="text-body-m text-on-surface-variant">
          已有账号？{' '}
          <button
            type="button"
            onClick={() => onSwitch('login')}
            className="text-primary-ink cursor-pointer hover:underline rounded-xs outline-none focus-visible:ring-2 focus-ring"
          >
            立即登录
          </button>
        </p>
      </div>
    </div>
  );
}

function ResetForm({ onSwitch, isCurrentFlow }: { onSwitch: (view: AuthView) => void; isCurrentFlow: () => boolean }) {
  const operation = useAuthOperation(isCurrentFlow);
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCurrentFlow() || operation.busy()) return;
    if (!email.trim()) {
      showToast('请输入邮箱', 'error');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showToast('请输入有效的邮箱地址', 'error');
      return;
    }

    const pending = operation.begin();
    if (!pending) return;
    setIsLoading(true);
    try {
      const res = await api.resetPasswordRequest(email);
      const data = await res.json();
      if (!operation.current(pending)) return;
      if (data.success) {
        showToast('验证码已发送至邮箱', 'success');
        setStep('reset');
      } else {
        showToast(data.message || '发送失败', 'error');
      }
    } catch {
      if (operation.current(pending)) showToast('网络错误，请稍后再试', 'error');
    } finally {
      if (operation.finish(pending)) setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCurrentFlow() || operation.busy()) return;
    if (!code.trim()) {
      showToast('请输入验证码', 'error');
      return;
    }
    if (!newPassword.trim()) {
      showToast('请输入新密码', 'error');
      return;
    }
    if (newPassword.length < 6) {
      showToast('密码长度至少6位', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('两次密码输入不一致', 'error');
      return;
    }

    const pending = operation.begin();
    if (!pending) return;
    setIsLoading(true);
    try {
      const res = await api.resetPassword({
        email,
        code: code.trim(),
        new_password: newPassword,
      });
      const data = await res.json();
      if (!operation.current(pending)) return;
      if (data.success) {
        showToast('密码重置成功，请登录', 'success');
        onSwitch('login');
      } else {
        showToast(data.message || '重置失败', 'error');
      }
    } catch {
      if (operation.current(pending)) showToast('网络错误，请稍后再试', 'error');
    } finally {
      if (operation.finish(pending)) setIsLoading(false);
    }
  };

  return (
    <div>
      <BackToLogin onSwitch={onSwitch} />
      <h1 className="text-headline-s text-on-surface mb-2">
        {step === 'request' ? '忘记密码' : '重置密码'}
      </h1>
      <p className="text-body-m text-on-surface-variant mb-8">
        {step === 'request' ? '输入注册邮箱，我们将发送验证码到您的邮箱' : '输入验证码和新密码'}
      </p>
      {step === 'request' ? (
        <form onSubmit={handleRequestCode} className="space-y-4">
          <Input
            type="email"
            label="邮箱"
            icon={<MdEmail size={ICON.dense} />}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="请输入注册邮箱"
          />
          <Button
            type="submit"
            variant="filled"
            size="lg"
            fullWidth
            loading={isLoading}
            disabled={!email.trim()}
            icon={<MdSend size={ICON.dense} />}
          >
            发送验证码
          </Button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div className="bg-primary-container text-on-primary-container rounded-md p-3">
            <p className="text-body-m">验证码已发送至 {email}</p>
          </div>
          <Input
            type="text"
            label="验证码"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            placeholder="请输入邮箱验证码"
          />
          <Input
            type="password"
            label="新密码"
            icon={<MdLock size={ICON.dense} />}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            placeholder="至少6位密码"
          />
          <Input
            type="password"
            label="确认密码"
            icon={<MdLock size={ICON.dense} />}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            placeholder="再次输入新密码"
          />
          <Button
            type="submit"
            variant="filled"
            size="lg"
            fullWidth
            loading={isLoading}
            disabled={!code.trim() || !newPassword.trim()}
          >
            重置密码
          </Button>
          <div className="text-center">
            <button
              type="button"
              onClick={() => setStep('request')}
              className="text-body-m text-primary-ink cursor-pointer hover:underline rounded-xs outline-none focus-visible:ring-2 focus-ring"
            >
              重新发送验证码
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
