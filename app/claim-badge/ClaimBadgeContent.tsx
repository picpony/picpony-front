'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { MdEmojiEvents } from 'react-icons/md';
import { useAuthModal } from '@/components/AuthModal';
import Button, { buttonClasses } from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import PageHeader from '@/components/PageHeader';
import Skeleton from '@/components/Skeleton';
import { claimBadge } from '@/lib/api/badges';
import { readToken, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';

export default function ClaimBadgeContent({ claimToken }: { claimToken: string }) {
  const { user, token, ready } = useSession();
  const { openAuth } = useAuthModal();
  const userId = Number(user?.id);
  const profileHref = Number.isSafeInteger(userId) && userId > 0 ? `/user/${userId}` : '/';
  // Each account/link pair owns its result, so changing accounts cannot display
  // the previous account's success or apply its delayed response to this one.
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="领取徽章" />
      {!claimToken ? (
        <ErrorRetry title="领取链接无效" message="链接中缺少领取凭证，请使用完整的徽章领取链接" />
      ) : !ready ? (
        <Card className="space-y-4" aria-label="正在读取登录状态" aria-busy="true">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-10 w-28" />
        </Card>
      ) : !token ? (
        <EmptyState
          title="需要登录"
          description="登录后即可领取此徽章，领取链接会保留在当前页面"
          icon={<MdEmojiEvents size={ICON.display} />}
          action={<Button variant="filled" onClick={() => openAuth('login')}>前往登录</Button>}
        />
      ) : (
        <ClaimForm key={`${token}:${claimToken}`} token={token} claimToken={claimToken} profileHref={profileHref} />
      )}
    </div>
  );
}

function ClaimForm({ token, claimToken, profileHref }: { token: string; claimToken: string; profileHref: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ name?: string; error?: string } | null>(null);
  const inFlight = useRef(false);

  const submit = async () => {
    if (inFlight.current || (result && !result.error) || readToken() !== token) return;
    inFlight.current = true;
    setSubmitting(true);
    setResult(null);
    try {
      const response = await claimBadge(token, claimToken);
      if (readToken() !== token) return;
      setResult(response.success
        ? { name: response.badge_name }
        : { error: response.error || '领取失败，链接可能已停用或过期' });
    } catch {
      if (readToken() === token) setResult({ error: '未能确认领取结果，请稍后重试' });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (result && !result.error) {
    return (
      <EmptyState
        title={result.name ? `已领取「${result.name}」` : '已领取徽章'}
        description="徽章已加入当前账号"
        icon={<MdEmojiEvents size={ICON.display} />}
        action={<Link scroll={false} href={profileHref} className={buttonClasses({ variant: 'filled' })}>{profileHref === '/' ? '返回首页' : '返回个人主页'}</Link>}
      />
    );
  }

  return (
    <Card className="space-y-4">
      <p className="text-body-l text-on-surface">领取后，此徽章将加入当前账号。</p>
      {result?.error && <ErrorRetry size="inline" title={result.error} />}
      <Button variant="filled" onClick={submit} loading={submitting} icon={<MdEmojiEvents />}>
        {submitting ? '领取中…' : '领取徽章'}
      </Button>
    </Card>
  );
}
