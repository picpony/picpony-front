'use client';

import { useEffect } from 'react';
import { MdRefresh, MdErrorOutline } from 'react-icons/md';
import Button from '@/components/Button';

/**
 * Route-level error boundary.
 *
 * Without one, a throw anywhere in a segment fell through to Next's default
 * screen — English, unstyled, and offering no way back. `reset()` re-renders
 * the segment, which is enough for the transient network failures that cause
 * most of these.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack in production.
    console.error('Route error:', error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <MdErrorOutline size={64} className="text-error mb-4" aria-hidden="true" />
      <h1 className="text-headline-s text-on-surface mb-2">出了点问题</h1>
      <p className="text-body-m text-on-surface-variant mb-6">
        页面加载时发生错误，可以重试一次；如果反复出现，请稍后再来。
      </p>
      {error.digest && (
        <p className="text-label-s text-outline mb-6 font-mono">错误编号：{error.digest}</p>
      )}
      <Button variant="filled" icon={<MdRefresh size={18} />} onClick={reset}>
        重试
      </Button>
    </div>
  );
}
