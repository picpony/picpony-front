'use client';

import Link from 'next/link';
import { MdHome, MdPersonOff } from 'react-icons/md';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import PageBack from '@/components/PageBack';
import { buttonClasses } from '@/components/buttonStyles';
import { useBackOrParent } from '@/lib/backNavigation';
import { useEscapeBack } from '@/lib/hooks';
import { apiErrorMessage } from '@/lib/api/errors';
import { ICON } from '@/lib/icons';

/** The back affordance every state of the route carries — the route is not a sidebar destination. */
export function ProfileBack() {
  const back = useBackOrParent('/');
  useEscapeBack(back);
  return <PageBack onClick={back} />;
}

/**
 * A profile that does not exist (R7-009): the not-found state, never 重试 — no retry makes a
 * missing account appear. The block is the route's whole content (`fill`), so its title is the
 * page's `<h1>`. Rendered by `not-found.tsx` when the server's read already knew, and by the
 * island when its own read found out.
 */
export function ProfileMissing() {
  return (
    <>
      <ProfileBack />
      <EmptyState
        fill
        icon={<MdPersonOff size={ICON.display} />}
        title="用户不存在"
        description="该用户可能已注销，或者链接本来就不对。"
        action={
          <Link scroll={false} href="/" className={buttonClasses({ variant: 'filled' })}>
            <MdHome aria-hidden="true" />
            回到首页
          </Link>
        }
      />
    </>
  );
}

/** A profile that could not be read: the failure's own sentence, and 重试 when it could help. */
export function ProfileFailure({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <>
      <ProfileBack />
      <ErrorRetry fill title="用户资料加载失败" message={apiErrorMessage(error)} onRetry={onRetry} />
    </>
  );
}
