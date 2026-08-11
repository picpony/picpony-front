'use client';

import { useEffect } from 'react';
import ErrorRetry from '@/components/ErrorRetry';

/**
 * Route-level error boundary.
 *
 * Without one, a throw anywhere in a segment fell through to Next's default
 * screen — English, unstyled, and offering no way back. `reset()` re-renders
 * the segment, which is enough for the transient network failures that cause
 * most of these.
 *
 * It renders `ErrorRetry` rather than its own layout, because otherwise the app
 * says "that did not load" in two different voices depending on how far up the
 * failure happened: a fetch that rejects inside a page got the shared 48px
 * glyph over `title-l` at 50vh with a staggered entrance, and a throw that
 * reached the boundary got a 64px glyph over `headline-s` at 60vh with none.
 * The user cannot tell those two events apart and should not be shown two
 * designs for them.
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
    <ErrorRetry
      title="出了点问题"
      message={
        <>
          页面加载时发生错误，可以重试一次；如果反复出现，请稍后再来。
          {/* A `<span class="block">` rather than a second paragraph: this sits
              inside `StatusView`'s own <p>, and a nested <p> is invalid and gets
              hoisted out by the parser — which put the digest above the sentence
              it belongs to. */}
          {error.digest && (
            <span className="text-label-s text-on-surface-variant mt-3 block font-mono">
              错误编号：{error.digest}
            </span>
          )}
        </>
      }
      onRetry={reset}
    />
  );
}
