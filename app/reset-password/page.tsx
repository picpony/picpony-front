'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MdEmail, MdLock, MdSend, MdArrowBack } from 'react-icons/md';
import { showToast } from '@/components/Toast';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import { api } from '@/lib/api';

export default function ResetPasswordPage() {
  const router = useRouter();

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
        setTimeout(() => router.push('/login'), 1500);
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
    <div className="max-w-md mx-auto mt-8 sm:mt-12 p-6 sm:p-8 animate-fade-in">
      {' '}
      <Link
        href="/login"
        className="flex items-center text-label-l text-on-surface-variant hover:text-on-surface mb-8 transition-ui"
      >
        {' '}
        <MdArrowBack size={18} className="mr-1" /> 返回登录{' '}
      </Link>{' '}
      <h1 className="text-headline-s text-on-surface mb-2">
        {' '}
        {step === 'request' ? '忘记密码' : '重置密码'}
      </h1>
      <p className="text-body-m text-on-surface-variant mb-8">
        {step === 'request' ? '输入注册邮箱，我们将发送验证码到您的邮箱' : '输入验证码和新密码'}
      </p>
      {step === 'request' ? (
        <form onSubmit={handleRequestCode} className="space-y-4">
          {' '}
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
          {' '}
          <div className="p-3 bg-primary/5 rounded-md border border-primary/20">
            {' '}
            <p className="text-body-m text-primary ">验证码已发送至 {email}</p>{' '}
          </div>{' '}
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
