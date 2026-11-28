'use client';

import { useEffect } from 'react';
import ErrorRetry from '@/components/ErrorRetry';

/**
 * Route-level error boundary. Without one, a throw fell through to Next's default
 * screen — English, unstyled, no way back. `reset()` re-renders the segment, enough for
 * the transient network failures that cause most of these.
 *
 * Renders `ErrorRetry` rather than its own layout, so the app does not say "that did
 * not load" in two different voices depending on how far up the failure happened.
 *
 * `fill`, which the 404 also sets and nothing else does: those two are the only screens
 * whose entire content is the status block. A list's empty state must not — it sits
 * under a page header, and filling would push the page past the viewport.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack in production.
    console.error('Route error:', error);
  }, [error]);

  return (
    <ErrorRetry
      fill
      title="页面加载失败"
      message={
        error.digest ? (
          <span className="text-label-s text-on-surface-variant block font-mono">错误编号：{error.digest}</span>
        ) : undefined
      }
      onRetry={reset}
    />
  );
}
