'use client';

import { useRef } from 'react';
import Chip from '@/components/Chip';
import ErrorRetry from '@/components/ErrorRetry';
import SectionHeading from '@/components/SectionHeading';
import { PageLoadingIndicator } from '@/components/LoadingIndicator';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { QUICK_TAG_GROUPS, type QuickTag, type QuickTagGroup } from '@/lib/api/semantic';
import { useResource } from '@/lib/resource';
import { quickTags } from '@/lib/resources';
import { queryHasTerm } from '@/lib/searchQuery';
import { useScrollFade } from '@/lib/useScrollFade';

const GROUP_LABELS: Record<QuickTagGroup, string> = {
  rating: '分级',
  species: '种族',
  character: '角色',
  general: '常规',
};

/** Placeholder while quick-tag categories and dynamic chip widths load. */
export function QuickTagsSkeleton() {
  return <PageLoadingIndicator size="inline" indicatorSize="md" label="正在加载快捷标签…" className="min-h-28" />;
}

function QuickTagRow({
  group,
  tags,
  value,
  onToggle,
}: {
  group: QuickTagGroup;
  tags: QuickTag[];
  value: string;
  onToggle: (tag: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  useScrollFade(rowRef);
  return (
    <div className="flex h-10 min-w-0 items-center gap-3">
      <span className="w-8 shrink-0 text-label-l text-on-surface-variant" id={`quick-tags-${group}`}>
        {GROUP_LABELS[group]}
      </span>
      <div
        ref={rowRef}
        role="group"
        aria-labelledby={`quick-tags-${group}`}
        className="scrollbar-hide scroll-fade-x -my-1.5 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1.5"
      >
        {tags.map((tag) => (
          <Chip
            key={tag.en}
            variant="filter"
            selected={queryHasTerm(value, tag.en)}
            onClick={() => onToggle(tag.en)}
            /* The Chinese name is the label; the tag it adds is the supplement. */
            title={tag.cn ? tag.en : undefined}
            className="shrink-0 pointer-coarse:my-0"
          >
            {tag.cn || tag.en}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/**
 * The site's quick tags, by category — the resting search screen's way in for someone who does
 * not yet know a tag's English name. A tap adds the tag to the field, a second tap takes it out
 * (the chip shows which are in), and nothing is searched until the field is: several tags make
 * one search. A tag this device's content settings exclude is not offered — it could only come
 * back empty.
 *
 * Each category is one line that scrolls when it overflows, so the placeholder rows are the rows'
 * exact geometry and the screen below them does not move when they arrive.
 */
export default function QuickTags({
  value,
  onToggle,
  excluded,
}: {
  value: string;
  onToggle: (tag: string) => void;
  excluded: ReadonlySet<string>;
}) {
  const read = useResource(quickTags, {});
  const groups = QUICK_TAG_GROUPS.map((group) => ({
    group,
    tags: (read.data?.[group] ?? []).filter((tag) => !excluded.has(tag.en.toLowerCase())),
  })).filter((entry) => entry.tags.length > 0);

  if (read.data !== undefined && groups.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionHeading className="mb-2">快捷标签</SectionHeading>
      {read.data === undefined ? (
        read.error ? (
          <ErrorRetry
            size="inline"
            title="快捷标签加载失败"
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        ) : (
          <QuickTagsSkeleton />
        )
      ) : (
        <div className="flex flex-col gap-2 pointer-coarse:gap-3">
          {groups.map(({ group, tags }) => (
            <QuickTagRow key={group} group={group} tags={tags} value={value} onToggle={onToggle} />
          ))}
        </div>
      )}
    </section>
  );
}
