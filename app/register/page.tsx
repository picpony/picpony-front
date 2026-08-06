'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthModal } from '@/components/AuthModal';

// 注册已改为全局弹窗：直接访问 /register 时打开弹窗并回到主页
export default function RegisterPage() {
  const { openAuth } = useAuthModal();
  const router = useRouter();

  useEffect(() => {
    openAuth('register');
    router.replace('/');
  }, [openAuth, router]);

  return null;
}
