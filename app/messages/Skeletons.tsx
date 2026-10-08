import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import { cn } from '@/lib/utils';

/**
 * The inbox lists load as their own rows — a title line and two lines of body in the grouped
 * list's tone and padding — so nothing re-spaces when the rows land. `rows` is the page the
 * list is waiting for: ten announcements a page; a notification page is usually short, so three.
 *
 * `data-page-loading` holds the page footer back while the list is the page's first content
 * (globals.css): these lists are in the page's flow, and the footer under a short placeholder
 * was thrown down the screen when they arrived. A placeholder in a pane that is not on screen
 * does not count there.
 */
export function ListRowsSkeleton({ rows = 3, badge = false }: { rows?: number; badge?: boolean }) {
  return (
    <div data-page-loading aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="m3-row flex flex-col gap-2 bg-surface-container-low p-4">
          <div className="flex items-center gap-3">
            {badge && <Skeleton className="h-6 w-12 rounded-xs" delay={i * 60} />}
            <Skeleton className="h-5 w-1/3" delay={i * 60} />
            <Skeleton className="ms-auto h-4 w-16" delay={i * 60 + 30} />
          </div>
          <Skeleton className="h-4 w-full" delay={i * 60 + 60} />
          <Skeleton className="h-4 w-3/4" delay={i * 60 + 90} />
        </div>
      ))}
    </div>
  );
}

/**
 * Contact rows in the contact row's own box: 72dp, a 48dp portrait, a name line and a preview
 * line. `flow` is the phone's list in the page (it holds the footer back like the lists above);
 * in the two-pane frame the rows sit in a fixed-height column and cannot move anything.
 */
export function ContactRowsSkeleton({ flow, faded }: { flow: boolean; faded?: boolean }) {
  return (
    <div data-page-loading={flow || undefined} className="flex flex-col gap-0.5" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex h-18 items-center gap-3 px-3">
          <SkeletonCircle size={48} delay={i * 80} />
          <div className={cn('flex min-w-0 flex-1 flex-col gap-2', faded && 'opacity-0')}>
            <Skeleton className="h-4 w-3/4" delay={i * 80 + 40} />
            <Skeleton className="h-3 w-1/2" delay={i * 80 + 80} />
          </div>
        </div>
      ))}
    </div>
  );
}
