'use client';

import { PageLoadingIndicator } from '@/components/LoadingIndicator';

/**
 * Centred M3E loading indicator while a lazy admin panel chunk arrives. Admin tabs span
 * overview tiles, forms, charts and tables, so a single multi-row silhouette rarely matches
 * the arriving panel. `holdFooter` (`data-page-loading`) keeps the footer from jumping.
 */
export default function AdminPaneSkeleton() {
  return <PageLoadingIndicator size="pane" holdFooter delay={120} label="正在加载管理面板…" className="min-h-80" />;
}
