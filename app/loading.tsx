import Skeleton, { SkeletonText } from '@/components/Skeleton';

/**
 * Route-level fallback for the App Router.
 *
 * A centred spinner shares no geometry with any page — once the route cross-fade
 * landed, you watched a full page dissolve *into* a dot. A silhouette at roughly the
 * right size makes the same wait read as content being replaced. Deliberately generic:
 * most pages render their own, better-fitting skeleton once mounted.
 *
 * `max-w-7xl`, the widest of the five page columns: `max-w-4xl` is right for the list
 * routes but 384px too narrow for the three grids — a placeholder that is too narrow
 * moves the content sideways on arrival.
 */
export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto max-w-7xl"
    >
      <span className="sr-only">加载中…</span>
      {/* Page title */}
      <Skeleton className="mb-6 h-8 w-48" />
      {/* Two content blocks and a short tail — the shape most routes settle into, and
          enough height that the scroller does not jump when the real page arrives. */}
      <div className="flex flex-col gap-4" aria-hidden="true">
        <Skeleton className="h-32 w-full rounded-md" delay={90} />
        <Skeleton className="h-48 w-full rounded-md" delay={180} />
        <SkeletonText lines={3} delay={270} />
      </div>
    </div>
  );
}
