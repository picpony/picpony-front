'use client';

import { MdArrowDownward, MdArrowUpward } from 'react-icons/md';
import Skeleton from '@/components/Skeleton';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import type { PonyImage } from '@/lib/types/image';

/**
 * The picture's read-only vote summary: compact upvote/downvote counts beside a tight ratio
 * track so counts are readable at a single glance without looking like a 976px interactive bar.
 *
 * `HeroStage` and `DetailSkeleton` draw the same single-line placeholder height so the handoff
 * never shifts.
 */
export default function DetailVotes({ image, pending }: { image: PonyImage | null; pending: boolean }) {
  if (pending) {
    return (
      <div
        aria-hidden="true"
        data-image-detail-score-loading
        className="flex min-h-5 w-full max-w-md items-center gap-3 text-body-s"
      >
        <Skeleton className="h-4 w-10 shrink-0" />
        <Skeleton className="h-1.5 min-w-24 flex-1 rounded-full" delay={60} />
        <Skeleton className="h-4 w-10 shrink-0" delay={120} />
      </div>
    );
  }
  if (typeof image?.upvotes !== 'number' || typeof image.downvotes !== 'number') return null;
  const { upvotes, downvotes } = image;
  const total = upvotes + downvotes;
  return (
    <div className="flex min-h-5 w-full max-w-md items-center gap-3 text-body-s text-on-surface-variant tabular-nums">
      <span className="inline-flex shrink-0 items-center gap-1 text-on-surface">
        <MdArrowUpward size={ICON.dense} className="text-on-surface-variant" aria-hidden="true" />
        <span className="sr-only">赞</span>
        {formatCount(upvotes)}
      </span>
      <div className="relative h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-secondary-container forced-boundary">
        {total > 0 && (
          <>
            <div
              className="absolute inset-y-0 left-0 w-full origin-left bg-success-fill forced-mark transition-transform spring-progress"
              style={{ transform: `scaleX(${upvotes / total})` }}
            />
            <div
              className="absolute inset-y-0 left-0 w-full origin-right bg-error-fill forced-color-adjust-none forced-colors:bg-[color:CanvasText] transition-transform spring-progress"
              style={{ transform: `scaleX(${downvotes / total})` }}
            />
          </>
        )}
      </div>
      <span className="inline-flex shrink-0 items-center gap-1">
        <MdArrowDownward size={ICON.dense} className="text-on-surface-variant" aria-hidden="true" />
        <span className="sr-only">踩</span>
        {formatCount(downvotes)}
      </span>
    </div>
  );
}
