'use client';

import Chip from '@/components/Chip';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton from '@/components/Skeleton';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import type { QuickTagGroup } from '@/lib/api/semantic';
import { useResource } from '@/lib/resource';
import { quickTags } from '@/lib/resources';

/** The rating has a control of its own on this form, so its quick tags are not repeated here. */
const GROUPS: { group: Exclude<QuickTagGroup, 'rating'>; label: string }[] = [
  { group: 'species', label: '种族' },
  { group: 'character', label: '角色' },
  { group: 'general', label: '常规' },
];

/**
 * 快捷标签 on the upload form — the original page's: the site's quick tags by category, a tap
 * adding the tag to the list and a second tap taking it out (the chip shows which are in). The
 * same `quickTags` read the search screen makes. Each category wraps rather than scrolls: a form
 * column has the height to give, and a scrolled row hides tags a person filling a form looks for.
 */
export default function UploadQuickTags({
  chosen,
  onToggle,
  disabled = false,
}: {
  chosen: ReadonlySet<string>;
  onToggle: (tag: string) => void;
  disabled?: boolean;
}) {
  const read = useResource(quickTags, {});
  const rows = GROUPS.map(({ group, label }) => ({ group, label, tags: read.data?.[group] ?? [] })).filter(
    (row) => row.tags.length > 0,
  );

  if (read.data !== undefined && rows.length === 0) return null;

  return (
    <section aria-labelledby="upload-quick-tags">
      <h2 id="upload-quick-tags" className="mb-2 text-label-l text-on-surface">
        快捷标签
      </h2>
      {read.data === undefined ? (
        read.error !== undefined ? (
          <ErrorRetry
            size="inline"
            title="快捷标签加载失败"
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        ) : (
          <div className="space-y-3" aria-hidden="true">
            {GROUPS.map(({ group }, row) => (
              <div key={group} className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-4 w-8" delay={row * 90} />
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-8 w-16 rounded-sm" delay={row * 90 + index * 40} />
                ))}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-3">
          {rows.map(({ group, label, tags }) => (
            <div key={group} role="group" aria-labelledby={`upload-quick-${group}`} className="flex flex-wrap items-center gap-2">
              <span id={`upload-quick-${group}`} className="w-8 shrink-0 text-label-m text-on-surface-variant">
                {label}
              </span>
              {tags.map((tag) => {
                const name = tag.en.toLowerCase();
                return (
                  <Chip
                    key={tag.en}
                    variant="filter"
                    selected={chosen.has(name)}
                    disabled={disabled}
                    onClick={() => onToggle(name)}
                    /* The Chinese name is the label; the tag it adds is the supplement. */
                    title={tag.cn ? tag.en : undefined}
                  >
                    {tag.cn || tag.en}
                  </Chip>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
