import Skeleton, { SkeletonText } from '@/components/Skeleton';
import { PageFallback } from '@/components/ImageDetailSlot';

/**
 * Route-level fallback for the App Router.
 *
 * A centred spinner shares no geometry with any page — once the route cross-fade
 * landed, you watched a full page dissolve *into* a dot. A silhouette at roughly the
 * right size makes the same wait read as content being replaced. Deliberately generic:
 * most pages render their own, better-fitting skeleton once mounted.
 *
 * **`max-w-4xl`, the list column.** The routes that reach this fallback are the ones whose
 * server component awaits a read, and the grid route among them (`/`) has its own boundary in
 * the gallery's shape; what remains is list- and article-shaped, where the wider silhouette
 * started its title a column's margin to the left of the page it stood in for, and moved it
 * sideways on arrival.
 *
 * **`data-page-loading`**: the footer is held back while this is up (see the page-chrome rules
 * in globals.css). This silhouette is shorter than most windows, and under it the footer was
 * painted at the bottom of the screen and thrown off it when the page arrived.
 *
 * **`PageFallback`: the page column's, never the picture slot's.** Next hands this file to every
 * parallel slot of the root layout, and the `@imageDetail` slot is not in the page column — drawn
 * there, it was a gutterless page silhouette over the page itself (`components/ImageDetailSlot.tsx`).
 */
export default function Loading() {
  return (
    <PageFallback>
      <div role="status" aria-live="polite" data-page-loading className="mx-auto max-w-4xl">
        <span className="sr-only">加载中…</span>
        {/* Page title */}
        <Skeleton className="mb-6 h-8 w-48" />
        {/* Two content blocks and a short tail — the shape most routes settle into. */}
        <div className="flex flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-32 w-full rounded-md" delay={90} />
          <Skeleton className="h-48 w-full rounded-md" delay={180} />
          <SkeletonText lines={3} delay={270} />
        </div>
      </div>
    </PageFallback>
  );
}
