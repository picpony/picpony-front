'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { showToast } from '@/components/Toast';
import CaptchaModal from '@/components/CaptchaModal';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import Reveal from '@/components/Reveal';
import { api } from '@/lib/api';

type RegisterStep = 'form' | 'verify';

export default function RegisterPage() {
  const [step, setStep] = useState<RegisterStep>('form');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const registeredUserId = useRef<number>(0);
  const registeredUsername = useRef<string>('');
  const router = useRouter();

  const [codeDigits, setCodeDigits] = useState<string[]>(Array(6).fill(''));
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);

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
    setShowCaptchaModal(true);
  };

  const onCaptchaVerify = async (token: string) => {
    setShowCaptchaModal(false);
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

        showToast('邮箱验证成功，欢迎加入！', 'success');
        setTimeout(() => router.push('/'), 1500);
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

  return (
    <div className="max-w-md mx-auto mt-12 p-8 bg-surface-container-lowest rounded-md relative">
      {step === 'form' ? (
        <Reveal>
          {' '}
          <div className="mb-8">
            {' '}
            <h1 className="text-headline-s text-on-surface"> 注册 </h1>{' '}
          </div>{' '}
          <form className="space-y-4" onSubmit={handleSubmit}>
            {' '}
            <Input
              id="register-f1"
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
              id="register-f2"
              type="email"
              label="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="请输入邮箱"
              maxLength={50}
            />
            <Input
              id="register-f3"
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
              onClose={() => setShowCaptchaModal(false)}
              onVerify={onCaptchaVerify}
            />{' '}
            <Button type="submit" variant="filled" size="lg" fullWidth loading={isLoading}>
              注册
            </Button>
          </form>{' '}
          <div className="mt-6 text-center">
            {' '}
            <p className="text-body-m text-on-surface-variant">
              {' '}
              已有账号？{' '}
              <Link href="/login" className="text-primary cursor-pointer hover:underline">
                {' '}
                立即登录{' '}
              </Link>{' '}
            </p>{' '}
          </div>{' '}
        </Reveal>
      ) : (
        <Reveal className="space-y-6">
          {' '}
          <div className="text-center">
            {' '}
            <h1 className="text-headline-s text-on-surface mb-2"> 验证邮箱 </h1>{' '}
            <p className="text-body-m text-on-surface-variant">
              {' '}
              验证码已发送至 <span className=" text-on-surface">{email}</span>{' '}
            </p>{' '}
            <p className="text-body-s text-outline mt-1"> 有效期为 10 分钟，请及时查收 </p>{' '}
          </div>{' '}
          <div>
            {' '}
            <label className="block text-label-l text-on-surface mb-3 text-center">
              {' '}
              请输入 6 位验证码{' '}
            </label>{' '}
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              {' '}
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
                  className="w-11 h-12 sm:w-12 sm:h-13 text-center text-title-l-emphasized rounded-sm border border-outline bg-surface-container-lowest text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
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
        </Reveal>
      )}
    </div>
  );
}
