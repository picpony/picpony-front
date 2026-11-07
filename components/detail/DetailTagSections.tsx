'use client';

import type { ReactNode } from 'react';
import Skeleton from '@/components/Skeleton';

export const DETAIL_TAG_SECTIONS = [
  { key: 'artists', title: '艺术家', prefix: 'artist:', category: 'artist', more: '显示更多艺术家标签' },
  { key: 'ocs', title: '图中包含的 OC', prefix: 'oc:', category: 'oc', more: '显示更多 OC 标签' },
  { key: 'regular', title: '标签', prefix: '', category: null, more: '显示更多标签' },
] as const;

export function DetailTagPlaceholder() {
  return (
    <div aria-hidden="true" className="flex gap-2">
      <Skeleton className="h-8 w-16 pointer-coarse:my-1" />
      <Skeleton className="h-8 w-24 pointer-coarse:my-1" delay={60} />
    </div>
  );
}

export function DetailTagSection({
  section,
  children,
}: {
  section: (typeof DETAIL_TAG_SECTIONS)[number];
  children: ReactNode;
}) {
  return (
    <div data-image-detail-tag-section={section.key}>
      <h2 className="mb-2 text-label-m-emphasized text-on-surface-variant">{section.title}</h2>
      {children}
    </div>
  );
}

/** Only the regular tag heading is fixed; optional sections arrive with their data. */
export default function DetailTagSkeleton() {
  return (
    <DetailTagSection section={DETAIL_TAG_SECTIONS[2]}>
      <DetailTagPlaceholder />
    </DetailTagSection>
  );
}
