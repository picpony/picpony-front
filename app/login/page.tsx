'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { showToast } from '@/components/Toast';
import CaptchaModal from '@/components/CaptchaModal';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import Reveal from '@/components/Reveal';
import { api } from '@/lib/api';
import { readJson } from '@/lib/api/client';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showCaptchaModal, setShowCaptchaModal] = useState(false);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!username || !password) {
      showToast('请输入用户名和密码', 'error');
      return;
    }

    setShowCaptchaModal(true);
  };

  const onCaptchaVerify = async (token: string) => {
    setShowCaptchaModal(false);
    setIsLoading(true);

    try {
      const res = await api.login({
        username,
        password,
        cf_token: token,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSuccess(true);
        showToast('登录成功', 'success');

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
            const fullUserInfo = {
              ...baseUserInfo,
              ...userData.user,
              token: data.token,
              api_key: data.api_key,
              derpi_user_id: data.derpi_user_id,
              derpi_username: data.derpi_username,
            };
            localStorage.setItem('user_info', JSON.stringify(fullUserInfo));
          }
        } catch (err) {
          console.error('Failed to fetch user info after login', err);
        }

        setTimeout(() => {
          router.push('/');
        }, 1000);
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
    <Reveal className="max-w-md mx-auto mt-12 p-8 bg-surface-container-lowest rounded-md relative">
      <div className="mb-8">
        <h1 className="text-headline-s text-on-surface">登录</h1>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          id="login-f1"
          type="text"
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          placeholder="请输入用户名"
        />
        <Input
          id="login-f2"
          type="password"
          label="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="请输入密码"
        />

        <CaptchaModal
          isOpen={showCaptchaModal}
          onClose={() => setShowCaptchaModal(false)}
          onVerify={onCaptchaVerify}
        />

        <Button type="submit" variant="filled" size="lg" fullWidth loading={isLoading} disabled={success}>
          登录
        </Button>
      </form>

      <div className="mt-6 text-center space-y-2">
        <p className="text-body-m text-on-surface-variant">
          还没有账号？{' '}
          <Link href="/register" className="text-primary cursor-pointer hover:underline">
            立即注册
          </Link>
        </p>
        <p className="text-body-m text-on-surface-variant">
          <Link href="/reset-password" className="text-primary hover:underline">
            忘记密码？
          </Link>
        </p>
      </div>
    </Reveal>
  );
}
