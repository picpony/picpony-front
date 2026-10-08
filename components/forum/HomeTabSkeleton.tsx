'use client';

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import Skeleton from '@/components/Skeleton';
import { ForumListSkeleton } from '@/components/ForumPostList';

/**
 * The 论坛 pane before its first answer, in the pane's own geometry: the header (a 40dp action
 * beside the title), the 40dp search row, the chip row (48px of target under a finger), then a
 * page of rows. What the home route's boundary shows while the server reads the forum's first
 * page for a cold `/?tab=forum`.
 */
export function ForumPaneSkeleton() {
  return (
    <div className="mx-auto max-w-4xl" data-page-loading="" aria-hidden="true">
      <div className="mb-6 flex h-10 items-center justify-between gap-4">
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-10 w-24 rounded-full" />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="h-10 min-w-0 flex-1 rounded-sm" />
        <Skeleton className="h-10 w-28 rounded-full" />
      </div>
      <div className="mb-4 flex gap-2 overflow-hidden">
        {[16, 22, 22, 26].map((width, i) => (
          <Skeleton key={i} className="h-8 shrink-0 rounded-sm pointer-coarse:my-1" style={{ width: `${width * 4}px` }} />
        ))}
      </div>
      <ForumListSkeleton />
    </div>
  );
}

/**
 * The home route's placeholder, in the shape of the destination the address names: the forum's
 * for `/?tab=forum`, the gallery's otherwise. The route's boundary cannot know the tab without
 * awaiting the search params, which would make the page itself suspend; this reads it on the
 * client side of the same render.
 */
export default function HomeTabSkeleton({ gallery }: { gallery: ReactNode }) {
  const tab = useSearchParams().get('tab');
  return tab === 'forum' ? <ForumPaneSkeleton /> : <>{gallery}</>;
}
