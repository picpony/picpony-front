'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthModal } from '@/components/AuthModal';

// 登录已改为全局弹窗：直接访问 /login 时打开弹窗并回到主页
export default function LoginPage() {
  const { openAuth } = useAuthModal();
  const router = useRouter();

  useEffect(() => {
    openAuth('login');
    router.replace('/');
  }, [openAuth, router]);

  return null;
}
