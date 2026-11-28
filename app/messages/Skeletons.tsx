import { PageLoadingIndicator } from '@/components/LoadingIndicator';

/**
 * Placeholder while an inbox list's row count and item heights are unknown.
 * `holdFooter` (`data-page-loading`) keeps the page footer out of the viewport until data lands.
 */
export function ListRowsSkeleton() {
  return (
    <PageLoadingIndicator size="pane" indicatorSize="lg" holdFooter label="正在加载消息列表…" />
  );
}

/**
 * Placeholder while the contact list is unknown. `flow` holds the page footer back on narrow
 * layouts; collapsed rails switch to a compact indicator so it fits the icon-only column.
 */
export function ContactRowsSkeleton({ flow, faded }: { flow: boolean; faded?: boolean }) {
  return (
    <PageLoadingIndicator
      size="inline"
      indicatorSize={faded ? 'sm' : 'md'}
      showLabel={!faded}
      holdFooter={flow}
      label="正在加载联系人…"
      className="min-h-48"
    />
  );
}
