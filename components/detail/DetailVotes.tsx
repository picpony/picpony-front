'use client';

import { MdThumbDown, MdThumbUp } from 'react-icons/md';
import Skeleton from '@/components/Skeleton';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import type { PonyImage } from '@/lib/types/image';

/**
 * The picture's votes: the two counts, and their ratio as one track.
 *
 * Until the record is in, the same two lines as a placeholder — the row and the 4dp track — so
 * the body under it does not move when the numbers land. `HeroStage` draws this placeholder too:
 * the two must measure identically, or the handoff shifts.
 */
export default function DetailVotes({ image, pending }: { image: PonyImage | null; pending: boolean }) {
  if (pending) {
    return (
      <div aria-hidden="true" data-image-detail-score-loading>
        <div className="mb-1.5 flex justify-between">
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" delay={60} />
        </div>
        <Skeleton className="h-1 w-full rounded-full" delay={120} />
      </div>
    );
  }
  if (typeof image?.upvotes !== 'number' || typeof image.downvotes !== 'number') return null;
  const { upvotes, downvotes } = image;
  const total = upvotes + downvotes;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-label-l text-on-surface tabular-nums">
        <span className="flex items-center gap-1">
          <MdThumbUp size={ICON.dense} className="text-success" aria-hidden="true" />
          <span className="sr-only">赞</span>
          {formatCount(upvotes)}
        </span>
        <span className="flex items-center gap-1">
          {formatCount(downvotes)}
          <span className="sr-only">踩</span>
          <MdThumbDown size={ICON.dense} className="text-error" aria-hidden="true" />
        </span>
      </div>
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-secondary-container">
        {/* With no votes the bare track shows through. Deliberately not a `ProgressBar`: a
            100%-stacked two-segment ratio with a both-zero state, which `value`/`max` cannot
            express. Two full-width bars anchored at opposite edges and scaled, not two flex
            items with an animated width — this runs live while the viewer pages, when layout
            work is least affordable. `spring-slow-effects`, `ProgressBar`'s spring: critically
            damped, since an overshoot would push one segment over the other. */}
        {total > 0 && (
          <>
            <div
              className="absolute inset-y-0 left-0 w-full origin-left bg-success-fill transition-transform spring-slow-effects"
              style={{ transform: `scaleX(${upvotes / total})` }}
            />
            <div
              className="absolute inset-y-0 left-0 w-full origin-right bg-error-fill transition-transform spring-slow-effects"
              style={{ transform: `scaleX(${downvotes / total})` }}
            />
          </>
        )}
      </div>
    </div>
  );
}
