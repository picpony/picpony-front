'use client';

import { forwardRef, useId } from 'react';
import Link from 'next/link';
import { MdBlock, MdBookmarks } from 'react-icons/md';
import Badge from '@/components/Badge';
import Checkbox from '@/components/Checkbox';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton from '@/components/Skeleton';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import type { SharedBlockGroup, SharedTagGroup, ShareableBlockGroup, ShareableTagGroup } from '@/lib/api/forum';
import { useResource, SKIP } from '@/lib/resource';
import { shareableGroups } from '@/lib/resources';
import { ICON } from '@/lib/icons';

/** How many of a group's tags its row names. */
const TAG_PREVIEW = 4;

/** What an edited post already shares — kept unless unticked, since the post holds copies, not ids. */
export interface KeptGroups {
  tagGroups: SharedTagGroup[];
  blockGroups: SharedBlockGroup[];
}

export interface GroupOption {
  key: string;
  kind: 'tag' | 'block';
  name: string;
  /** For a tag group, its tags; for a block group, hidden then spoilered. */
  tags: string[];
  hidden?: number;
  source: 'own' | 'kept';
}

export function optionsOf(
  own: { tagGroups: ShareableTagGroup[]; blockGroups: ShareableBlockGroup[] } | undefined,
  kept: KeptGroups | null,
): GroupOption[] {
  const options: GroupOption[] = [];
  kept?.tagGroups.forEach((group, index) =>
    options.push({ key: `kept-tag:${index}`, kind: 'tag', name: group.name, tags: group.tags, source: 'kept' }),
  );
  kept?.blockGroups.forEach((group, index) =>
    options.push({
      key: `kept-block:${index}`,
      kind: 'block',
      name: group.name,
      tags: [...group.hidden_tags, ...group.spoilered_tags],
      hidden: group.hidden_tags.length,
      source: 'kept',
    }),
  );
  own?.tagGroups.forEach((group) =>
    options.push({ key: `tag:${group.id}`, kind: 'tag', name: group.name, tags: group.tags, source: 'own' }),
  );
  own?.blockGroups.forEach((group) =>
    options.push({
      key: `block:${group.id}`,
      kind: 'block',
      name: group.name,
      tags: [...group.hidden_tags, ...group.spoilered_tags],
      hidden: group.hidden_tags.length,
      source: 'own',
    }),
  );
  return options;
}

/**
 * The groups a selection shares, as the copies `create_forum_post` / `update_forum_post` take in
 * `shared_groups` (the original front end's shape: a name and its tags).
 */
export function sharedGroupsOf(
  selected: readonly string[],
  own: { tagGroups: ShareableTagGroup[]; blockGroups: ShareableBlockGroup[] } | undefined,
  kept: KeptGroups | null,
): { tag_groups: SharedTagGroup[]; block_groups: SharedBlockGroup[] } {
  const chosen = new Set(selected);
  const tag_groups: SharedTagGroup[] = [];
  const block_groups: SharedBlockGroup[] = [];
  kept?.tagGroups.forEach((group, index) => {
    if (chosen.has(`kept-tag:${index}`)) tag_groups.push({ name: group.name, tags: group.tags });
  });
  kept?.blockGroups.forEach((group, index) => {
    if (chosen.has(`kept-block:${index}`)) {
      block_groups.push({ name: group.name, hidden_tags: group.hidden_tags, spoilered_tags: group.spoilered_tags });
    }
  });
  own?.tagGroups.forEach((group) => {
    if (chosen.has(`tag:${group.id}`)) tag_groups.push({ name: group.name, tags: group.tags });
  });
  own?.blockGroups.forEach((group) => {
    if (chosen.has(`block:${group.id}`)) {
      block_groups.push({ name: group.name, hidden_tags: group.hidden_tags, spoilered_tags: group.spoilered_tags });
    }
  });
  return { tag_groups, block_groups };
}

interface SharedGroupsPickerProps {
  token: string;
  selected: readonly string[];
  onChange: (next: string[]) => void;
  kept: KeptGroups | null;
  error?: string | null;
}

/**
 * 选择要分享的组: the writer's own tag groups and block groups (`get_my_shareable_groups`), each a
 * checkbox row naming its first few tags — and, when editing, the groups the post already shares.
 * A group is shared as a copy, so a later change to it does not reach the post.
 */
const SharedGroupsPicker = forwardRef<HTMLFieldSetElement, SharedGroupsPickerProps>(function SharedGroupsPicker(
  { token, selected, onChange, kept, error },
  ref,
) {
  const legendId = useId();
  const errorId = useId();
  const read = useResource(shareableGroups, token ? { token } : SKIP);
  const options = optionsOf(read.data, kept);
  const chosen = new Set(selected);
  const toggle = (key: string, on: boolean) =>
    onChange(on ? [...selected.filter((item) => item !== key), key] : selected.filter((item) => item !== key));

  return (
    <fieldset
      ref={ref}
      tabIndex={-1}
      aria-labelledby={legendId}
      aria-describedby={error ? errorId : undefined}
      aria-invalid={error ? true : undefined}
      className="min-w-0 rounded-md focus-visible:outline-hidden"
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <legend id={legendId} className="text-title-s text-on-surface">
          选择要分享的组
        </legend>
        <span className="text-body-s text-on-surface-variant tabular-nums">已选 {chosen.size} 个</span>
      </div>
      {read.data === undefined && !read.error && !kept ? (
        <div aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="m3-row flex items-center gap-3 bg-surface-container-low p-3">
              <Skeleton className="size-5 rounded-xs" delay={i * 60} />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32" delay={i * 60 + 30} />
                <Skeleton className="h-3 w-48" delay={i * 60 + 60} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {read.error !== undefined && (
            <ErrorRetry
              size="inline"
              title="你的组加载失败"
              message={apiErrorMessage(read.error)}
              onRetry={isRetryable(read.error) ? read.refresh : undefined}
            />
          )}
          {options.length === 0 && read.error === undefined ? (
            <EmptyState
              size="inline"
              title="你还没有可分享的标签组或屏蔽组"
              action={
                <Link href="/block-groups" scroll={false} className="text-body-m text-link underline underline-offset-2">
                  去创建屏蔽组
                </Link>
              }
            />
          ) : (
            <ul>
              {options.map((option) => {
                const nameId = `${legendId}-${option.key}`;
                return (
                  <li
                    key={option.key}
                    /* The row is the pointer's target, the checkbox the keyboard's: a click
                       anywhere on the row toggles it, and the checkbox's own label takes its own
                       clicks (hence the test), so nothing toggles twice. */
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('label')) return;
                      toggle(option.key, !chosen.has(option.key));
                    }}
                    className="m3-row flex cursor-pointer items-start gap-3 bg-surface-container-low p-3"
                  >
                    <Checkbox
                      checked={chosen.has(option.key)}
                      onChange={(on) => toggle(option.key, on)}
                      aria-labelledby={nameId}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 text-on-surface-variant [&>svg]:block" aria-hidden="true">
                          {option.kind === 'tag' ? <MdBookmarks size={ICON.dense} /> : <MdBlock size={ICON.dense} />}
                        </span>
                        <span id={nameId} className="min-w-0 truncate text-label-l-emphasized text-on-surface" title={option.name}>
                          {option.kind === 'tag' ? '标签组' : '屏蔽组'}「{option.name}」
                        </span>
                        {option.source === 'kept' && <Badge className="shrink-0">帖子中已分享</Badge>}
                      </p>
                      <p className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
                        {option.tags.slice(0, TAG_PREVIEW).map((tag) => (
                          <Badge key={tag} title={tag} className="max-w-40">
                            {tag}
                          </Badge>
                        ))}
                        {option.tags.length > TAG_PREVIEW && (
                          <span className="text-body-s text-on-surface-variant">+{option.tags.length - TAG_PREVIEW}</span>
                        )}
                        {option.tags.length === 0 && <span className="text-body-s text-on-surface-variant">没有标签</span>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 px-4 text-body-s text-error">
          {error}
        </p>
      )}
    </fieldset>
  );
});

export default SharedGroupsPicker;
