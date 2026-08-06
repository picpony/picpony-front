'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthModal } from '@/components/AuthModal';

// 找回密码已改为全局弹窗：直接访问 /reset-password 时打开弹窗并回到主页
export default function ResetPasswordPage() {
  const { openAuth } = useAuthModal();
  const router = useRouter();

  useEffect(() => {
    openAuth('reset');
    router.replace('/');
  }, [openAuth, router]);

  return null;
}
