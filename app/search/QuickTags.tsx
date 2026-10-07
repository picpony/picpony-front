'use client';

import { useRef } from 'react';
import Chip from '@/components/Chip';
import ErrorRetry from '@/components/ErrorRetry';
import SectionHeading from '@/components/SectionHeading';
import Skeleton from '@/components/Skeleton';
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

/** The rows' own geometry while they load: four one-line rows of chips. */
function QuickTagsSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {QUICK_TAG_GROUPS.map((group, row) => (
        <div key={group} className="flex h-10 items-center gap-3">
          <Skeleton className="h-4 w-8" delay={row * 90} />
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-16" delay={row * 90 + index * 40} />
          ))}
        </div>
      ))}
    </div>
  );
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
        className="scrollbar-hide scroll-fade-x flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"
      >
        {tags.map((tag) => (
          <Chip
            key={tag.en}
            variant="filter"
            selected={queryHasTerm(value, tag.en)}
            onClick={() => onToggle(tag.en)}
            /* The Chinese name is the label; the tag it adds is the supplement. */
            title={tag.cn ? tag.en : undefined}
            className="shrink-0"
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
  const groups = QUICK_TAG_GROUPS
    .map((group) => ({
      group,
      tags: (read.data?.[group] ?? []).filter((tag) => !excluded.has(tag.en.toLowerCase())),
    }))
    .filter((entry) => entry.tags.length > 0);

  if (read.data !== undefined && groups.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionHeading className="mb-2" subtitle="点选标签加入搜索框，可多选">
        快捷标签
      </SectionHeading>
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
        <div className="flex flex-col gap-2">
          {groups.map(({ group, tags }) => (
            <QuickTagRow key={group} group={group} tags={tags} value={value} onToggle={onToggle} />
          ))}
        </div>
      )}
    </section>
  );
}
