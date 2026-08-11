import Skeleton, { SkeletonText } from '@/components/Skeleton';

/**
 * Route-level fallback for the App Router.
 *
 * A centred spinner was the wrong shape for this slot. It shares no geometry
 * with any page, so a slow segment read as "the content vanished and a dot
 * appeared" — and once the route cross-fade landed it got worse, because you
 * now watch a full page dissolve *into* that dot. A silhouette at roughly the
 * right size makes the same wait read as content being replaced.
 *
 * Deliberately generic: most pages render their own, better-fitting skeleton
 * once mounted, and this only covers the gap before that component exists.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-4xl"
    >
      <span className="sr-only">加载中…</span>
      {/* Page title */}
      <Skeleton className="mb-6 h-8 w-48" />
      {/* Two content blocks and a short tail — the shape most routes settle
          into, and enough height that the scroller does not jump when the real
          page arrives. */}
      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-32 w-full rounded-md" delay={90} />
        <Skeleton className="h-48 w-full rounded-md" delay={180} />
        <SkeletonText lines={3} delay={270} />
      </div>
    </div>
  );
}
