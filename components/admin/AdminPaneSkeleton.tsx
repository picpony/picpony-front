'use client';

import Skeleton from '@/components/Skeleton';

/**
 * A console panel's silhouette while its chunk (or the session) is on its way: the panel header
 * at its fixed 40dp row (`SectionHeader`), then a run of list rows. The rows are one container
 * step above the console's surface — `DataTable`'s own tone — so the placeholder and the list it
 * becomes are the same object.
 *
 * `data-page-loading`: a placeholder is not the panel's length, so the shell holds the footer
 * while one is on screen rather than landing it mid-screen and pushing it down.
 */
export default function AdminPaneSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-6" data-page-loading="" aria-hidden="true">
      <div className="flex min-h-10 items-center justify-between gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-28 rounded-full" delay={40} />
      </div>
      <div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="m3-row flex flex-col gap-2 bg-surface-container p-4">
            <Skeleton className="h-4 w-2/5" delay={i * 80} />
            <Skeleton className="h-3.5 w-full" delay={i * 80 + 60} />
            <Skeleton className="h-3.5 w-3/4" delay={i * 80 + 120} />
          </div>
        ))}
      </div>
    </div>
  );
}
