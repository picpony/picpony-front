'use client';

import { PageLoadingIndicator } from '@/components/LoadingIndicator';

/**
 * Loading placeholder before the post composer resolves (session or full thread read).
 * Holds the footer (`data-page-loading`) while avoiding an overly intricate form skeleton
 * that would vanish immediately when the visitor is signed out or unauthorised.
 */
export default function ComposerSkeleton({ delay = 0 }: { delay?: number }) {
  return <PageLoadingIndicator size="page" holdFooter delay={delay} label="正在加载编辑器…" />;
}
