'use client';

import { createContext, useCallback, useContext, useState, useRef } from 'react';
import { MdClose, MdEmail, MdLock, MdSend, MdArrowBack } from 'react-icons/md';
import Modal from './Modal';
import CaptchaModal from './CaptchaModal';
import Button from './Button';
import { Input } from './Input';
import LottieIcon from './LottieIcon';
import { showToast } from './Toast';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { readJson } from '@/lib/api/client';

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

  const openAuth = useCallback((v: AuthView = 'login') => {
    setView(v);
    setIsOpen(true);
  }, []);

  const closeAuth = useCallback(() => setIsOpen(false), []);

  const switchView = useCallback((v: AuthView) => setView(v), []);

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
}: {
  isOpen: boolean;
  view: AuthView;
  onClose: () => void;
  onSwitchView: (view: AuthView) => void;
  closeOnEscape: boolean;
  innerModalOpen: boolean;
  onInnerModalChange: (open: boolean) => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-4xl"
      bodyClassName="p-0"
      closeOnEscape={closeOnEscape}
      hideCloseButton
      // 整个窗口组件在验证码弹窗打开时缩小让位，带动画
      // 用独立 scale 属性（Tailwind v4），避开 modalContent 动画 forwards 对 transform/opacity 的填充锁定
      panelClassName={cn(
        'transition-[scale] duration-300 ease-[var(--ease-standard)]',
        innerModalOpen ? 'scale-[0.96]' : 'scale-100',
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
            fallback={null}
          />
        </div>
        {/* flex-col + my-auto：内容短时垂直居中，超高时正常滚动 */}
        <div className="relative main-scrollbar flex w-full md:w-2/5 flex-col overflow-y-auto p-6 sm:p-8">
          <button
            onClick={onClose}
            aria-label="关闭"
            className="absolute right-3 top-5 z-10 inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-on-surface-variant outline-none transition-ui hover:rotate-90 hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:hover:rotate-0"
          >
            <MdClose size={22} />
          </button>
          <div key={view} className="my-auto animate-page-transition">
            {view === 'login' && (
              <LoginForm
                onSwitch={onSwitchView}
                onCaptchaChange={onInnerModalChange}
                onSuccess={onClose}
              />
            )}
            {view === 'register' && (
              <RegisterForm
                onSwitch={onSwitchView}
                onCaptchaChange={onInnerModalChange}
                onSuccess={onClose}
              />
            )}
            {view === 'reset' && <ResetForm onSwitch={onSwitchView} />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LoginForm({
  onSwitch,
  onCaptchaChange,
  onSuccess,
}: {
  onSwitch: (view: AuthView) => void;
  onCaptchaChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);

  const setCaptcha = (open: boolean) => {
    setShowCaptchaModal(open);
    onCaptchaChange(open);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      showToast('请输入用户名和密码', 'error');
      return;
    }
    setCaptcha(true);
  };

  const onCaptchaVerify = async (token: string) => {
    setCaptcha(false);
    setIsLoading(true);
    try {
      const res = await api.login({ username, password, cf_token: token });
      const data = await res.json();
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
        localStorage.setItem('user_info', JSON.stringify(baseUserInfo));
        try {
          const userRes = await api.getUser(data.token);
          const userData = await readJson(userRes);
          if (userData.success && userData.user) {
            localStorage.setItem(
              'user_info',
              JSON.stringify({
                ...baseUserInfo,
                ...userData.user,
                token: data.token,
                api_key: data.api_key,
                derpi_user_id: data.derpi_user_id,
                derpi_username: data.derpi_username,
              }),
            );
          }
        } catch (err) {
          console.error('Failed to fetch user info after login', err);
        }
        showToast('登录成功', 'success');
        window.dispatchEvent(new Event('user_info_updated'));
        onSuccess();
      } else {
        showToast(data.message || '登录失败，请检查用户名和密码', 'error');
      }
    } catch {
      showToast('网络错误，请稍后再试', 'error');
    } finally {
      setIsLoading(false);
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
        <CaptchaModal
          isOpen={showCaptchaModal}
          onClose={() => setCaptcha(false)}
          onVerify={onCaptchaVerify}
        />
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
            className="text-primary cursor-pointer hover:underline"
          >
            立即注册
          </button>
        </p>
        <p className="text-body-m text-on-surface-variant">
          <button
            type="button"
            onClick={() => onSwitch('reset')}
            className="text-primary hover:underline"
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
}: {
  onSwitch: (view: AuthView) => void;
  onCaptchaChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<RegisterStep>('form');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const registeredUserId = useRef<number>(0);
  const registeredUsername = useRef<string>('');

  const [codeDigits, setCodeDigits] = useState<string[]>(Array(6).fill(''));
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const setCaptcha = (open: boolean) => {
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
    const error = validateForm();
    if (error) {
      showToast(error, 'error');
      return;
    }
    setCaptcha(true);
  };

  const onCaptchaVerify = async (token: string) => {
    setCaptcha(false);
    setIsLoading(true);
    try {
      const res = await api.register({
        username: username.trim(),
        email: email.trim(),
        password,
        cf_token: token,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        registeredUserId.current = data.user_id;
        registeredUsername.current = data.username;
        setStep('verify');
        showToast('验证码已发送至您的邮箱，请查收', 'success');
      } else {
        showToast(data.error || data.message || '注册失败，请检查输入', 'error');
      }
    } catch {
      showToast('网络错误，请稍后再试', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    const code = codeDigits.join('');
    if (code.length !== 6) {
      showToast('请输入完整的 6 位验证码', 'error');
      return;
    }
    setIsVerifying(true);
    try {
      const res = await api.verifyEmailById(registeredUserId.current, code);
      const data = await res.json();
      if (data.success) {
        localStorage.setItem(
          'user_info',
          JSON.stringify({
            token: data.token,
            username: data.username,
            avatar: data.avatar,
            role: data.role,
            api_key: data.api_key,
            derpi_user_id: data.derpi_user_id,
            derpi_username: data.derpi_username,
          }),
        );
        showToast('邮箱验证成功，欢迎加入！', 'success');
        window.dispatchEvent(new Event('user_info_updated'));
        onSuccess();
      } else {
        showToast(data.error || data.message || '验证失败', 'error');
      }
    } catch {
      showToast('网络错误，请稍后再试', 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    try {
      const res = await api.resendVerifyCodeById(registeredUserId.current);
      const data = await res.json();
      if (data.success) {
        showToast('新验证码已发送，请查收', 'success');
      } else {
        showToast(data.error || data.message || '发送失败', 'error');
      }
    } catch {
      showToast('网络错误，请稍后再试', 'error');
    } finally {
      setIsResending(false);
    }
  };

  if (step === 'verify') {
    return (
      <div>
        <button
          type="button"
          onClick={() => onSwitch('login')}
          className="flex items-center text-label-l text-on-surface-variant hover:text-on-surface mb-8 transition-ui"
        >
          <MdArrowBack size={18} className="mr-1" /> 返回登录
        </button>
        <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-headline-s text-on-surface mb-2">验证邮箱</h1>
          <p className="text-body-m text-on-surface-variant">
            验证码已发送至 <span className="text-on-surface">{email}</span>
          </p>
          <p className="text-body-s text-outline mt-1">有效期为 10 分钟，请及时查收</p>
        </div>
        <div>
          <label className="block text-label-l text-on-surface mb-3 text-center">
            请输入 6 位验证码
          </label>
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            {codeDigits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  codeInputRefs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                value={digit}
                maxLength={1}
                autoFocus={i === 0}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  const newDigits = [...codeDigits];
                  newDigits[i] = val.slice(0, 1);
                  setCodeDigits(newDigits);
                  if (val && i < 5) codeInputRefs.current[i + 1]?.focus();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !digit && i > 0) {
                    codeInputRefs.current[i - 1]?.focus();
                    const newDigits = [...codeDigits];
                    newDigits[i - 1] = '';
                    setCodeDigits(newDigits);
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
                  const newDigits = Array(6).fill('');
                  for (let j = 0; j < text.length; j++) newDigits[j] = text[j];
                  setCodeDigits(newDigits);
                  const nextIndex = Math.min(text.length, 5);
                  codeInputRefs.current[nextIndex]?.focus();
                }}
                className="w-9 h-10 sm:w-10 sm:h-11 text-center text-title-m-emphasized rounded-sm border border-outline bg-surface-container-lowest text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
            ))}
          </div>
        </div>
        <Button
          onClick={handleVerify}
          variant="filled"
          size="lg"
          fullWidth
          loading={isVerifying}
          disabled={codeDigits.join('').length !== 6}
        >
          验证并登录
        </Button>
        <div className="text-center">
          <button
            onClick={handleResend}
            disabled={isResending}
            className="text-body-m text-primary cursor-pointer hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResending ? '发送中...' : '未收到？重新发送验证码'}
          </button>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onSwitch('login')}
        className="flex items-center text-label-l text-on-surface-variant hover:text-on-surface mb-8 transition-ui"
      >
        <MdArrowBack size={18} className="mr-1" /> 返回登录
      </button>
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
        <CaptchaModal
          isOpen={showCaptchaModal}
          onClose={() => setCaptcha(false)}
          onVerify={onCaptchaVerify}
        />
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
            className="text-primary cursor-pointer hover:underline"
          >
            立即登录
          </button>
        </p>
      </div>
    </div>
  );
}

function ResetForm({ onSwitch }: { onSwitch: (view: AuthView) => void }) {
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      showToast('请输入邮箱', 'error');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showToast('请输入有效的邮箱地址', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.resetPasswordRequest(email);
      const data = await res.json();
      if (data.success) {
        showToast('验证码已发送至邮箱', 'success');
        setStep('reset');
      } else {
        showToast(data.message || '发送失败', 'error');
      }
    } catch {
      showToast('网络错误，请稍后再试', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
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

    setIsLoading(true);
    try {
      const res = await api.resetPassword({
        email,
        code: code.trim(),
        new_password: newPassword,
      });
      const data = await res.json();
      if (data.success) {
        showToast('密码重置成功，请登录', 'success');
        onSwitch('login');
      } else {
        showToast(data.message || '重置失败', 'error');
      }
    } catch {
      showToast('网络错误，请稍后再试', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => onSwitch('login')}
        className="flex items-center text-label-l text-on-surface-variant hover:text-on-surface mb-8 transition-ui"
      >
        <MdArrowBack size={18} className="mr-1" /> 返回登录
      </button>
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
            icon={<MdEmail size={18} />}
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
            icon={<MdSend size={18} />}
          >
            发送验证码
          </Button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div className="p-3 bg-primary/5 rounded-md border border-primary/20">
            <p className="text-body-m text-primary">验证码已发送至 {email}</p>
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
            icon={<MdLock size={18} />}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={6}
            placeholder="至少6位密码"
          />
          <Input
            type="password"
            label="确认密码"
            icon={<MdLock size={18} />}
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
              className="text-body-m text-primary hover:underline"
            >
              重新发送验证码
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
