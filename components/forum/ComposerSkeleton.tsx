'use client';

import Skeleton from '@/components/Skeleton';
import { EditorPlaceholder } from '@/components/RichTextEditorShell';

/**
 * The post form before the session is known, in the form's own geometry — the kind of post, the
 * two fields with their supporting lines, the editor, the cover and the action row — so the
 * signed-in form lands without moving anything, and the footer waits below it.
 */
export default function ComposerSkeleton() {
  return (
    <div data-page-loading="" aria-hidden="true" className="space-y-6">
      <div>
        <Skeleton className="mb-2 h-5 w-20" />
        <div className="flex h-12 items-center gap-6">
          <Skeleton className="h-5 w-24" delay={40} />
          <Skeleton className="h-5 w-24" delay={60} />
          <Skeleton className="h-5 w-28" delay={80} />
        </div>
        <Skeleton className="mx-4 mt-1 h-3.5 w-48" delay={100} />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-14 w-full rounded-xs" delay={120} />
        <Skeleton className="mx-4 h-3.5 w-24" delay={140} />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-[5.25rem] w-full rounded-xs" delay={160} />
        <Skeleton className="mx-4 h-3.5 w-56" delay={180} />
      </div>
      <div>
        <Skeleton className="mb-2 h-5 w-12" delay={200} />
        <EditorPlaceholder size="post" />
      </div>
      <div>
        <Skeleton className="mb-2 h-5 w-24" delay={220} />
        <Skeleton className="h-12 w-full rounded-md" delay={240} />
      </div>
      <div className="flex justify-end gap-3 border-t border-outline-variant pt-4">
        <Skeleton className="h-10 w-16 rounded-full" delay={260} />
        <Skeleton className="h-10 w-28 rounded-full" delay={280} />
      </div>
    </div>
  );
}
