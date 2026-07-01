'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MdEmail, MdLock, MdSend, MdArrowBack } from 'react-icons/md';
import { showToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
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
    if (!email.trim()) { showToast('请输入邮箱', 'error'); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { showToast('请输入有效的邮箱地址', 'error'); return; }

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
    if (!code.trim()) { showToast('请输入验证码', 'error'); return; }
    if (!newPassword.trim()) { showToast('请输入新密码', 'error'); return; }
    if (newPassword.length < 6) { showToast('密码长度至少6位', 'error'); return; }
    if (newPassword !== confirmPassword) { showToast('两次密码输入不一致', 'error'); return; }

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
      <Link
        href="/login"
        className="flex items-center text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 mb-8 transition-colors"
      >
        <MdArrowBack size={18} className="mr-1" />
        返回登录
      </Link>

      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
        {step === 'request' ? '忘记密码' : '重置密码'}
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-8">
        {step === 'request'
          ? '输入注册邮箱，我们将发送验证码到您的邮箱'
          : '输入验证码和新密码'}
      </p>

      {step === 'request' ? (
        <form onSubmit={handleRequestCode} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">邮箱</label>
            <div className="relative">
              <MdEmail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                placeholder="请输入注册邮箱"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading || !email.trim()}
            className="w-full py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <Spinner size="sm" white /> : (
              <>
                <MdSend size={18} />
                发送验证码
              </>
            )}
          </button>
        </form>
      ) : (
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
            <p className="text-sm text-primary font-medium">验证码已发送至 {email}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">验证码</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
              placeholder="请输入邮箱验证码"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">新密码</label>
            <div className="relative">
              <MdLock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                placeholder="至少6位密码"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">确认密码</label>
            <div className="relative">
              <MdLock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                placeholder="再次输入新密码"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={isLoading || !code.trim() || !newPassword.trim()}
            className="w-full py-3 bg-primary text-white rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? <Spinner size="sm" white /> : '重置密码'}
          </button>
          <div className="text-center">
            <button
              type="button"
              onClick={() => setStep('request')}
              className="text-sm text-primary hover:underline"
            >
              重新发送验证码
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
