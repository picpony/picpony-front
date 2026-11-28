import { PageLoadingIndicator } from '@/components/LoadingIndicator';
import { PageFallback } from '@/components/ImageDetailSlot';

/**
 * Route-level fallback for the App Router.
 *
 * The generic route fallback does not know which screen layout is arriving (a profile, an article,
 * a form, or a status card), so an arbitrary multi-block skeleton rarely matches the destination.
 * A centred Material 3 Expressive contained loading indicator reports progress cleanly without
 * fabricating a misleading silhouette.
 *
 * **`data-page-loading`**: the footer is held back while this is up (see the page-chrome rules
 * in globals.css).
 *
 * **`PageFallback`: the page column's, never the picture slot's.** Next hands this file to every
 * parallel slot of the root layout, and the `@imageDetail` slot is not in the page column
 * (`components/ImageDetailSlot.tsx`).
 *
 * **`data-route-fallback`** says the page is this and nothing more: a route change that a container
 * transform rides holds its fade until the page has replaced it (`lib/routeCrossFadePlay.ts`).
 */
export default function Loading() {
  return (
    <PageFallback>
      <PageLoadingIndicator
        size="page"
        holdFooter
        data-route-fallback=""
        label="加载中…"
        className="mx-auto max-w-4xl"
      />
    </PageFallback>
  );
}
