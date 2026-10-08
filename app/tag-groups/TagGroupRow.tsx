'use client';

import { memo } from 'react';
import Link from 'next/link';
import { MdDeleteOutline, MdEdit, MdSearch, MdShare } from 'react-icons/md';
import Button from '@/components/Button';
import { buttonClasses } from '@/components/buttonStyles';
import { GroupMenu, GroupRow, TagMarks } from '@/components/groups/GroupRow';
import { tagGroupQuery, type TagGroup } from '@/lib/api/tagGroups';

/** How many of a group's tags a row shows before 「+N」. */
const PREVIEW = 12;

/** A group's own search: its tags as one query, in the recipient's default order. */
export function tagGroupSearchHref(tags: readonly string[]): string {
  return `/search?${new URLSearchParams({ q: tagGroupQuery(tags) }).toString()}`;
}

/**
 * One 标签组, in the groups' shared row (`GroupRow`): its name and size, its tags, and the things
 * done with it. 搜索 (the group as one search, the original's 搜搜这个组合) is the row's own action,
 * so it is the trailing control with a container; 复制分享链接 (a link that opens that search for
 * somebody else), 编辑 and 删除 are in the ⋮, whose spinner says a link is being made.
 *
 * A group with no tags (an old one, or one imported empty) has nothing to search or share: both
 * are unavailable, and the row says what is missing.
 */
function TagGroupRow({
  group,
  sharing,
  deleting,
  onShare,
  onEdit,
  onDelete,
  'data-presence-key': presenceKey,
}: {
  group: TagGroup;
  sharing: boolean;
  deleting: boolean;
  onShare: (group: TagGroup) => void;
  onEdit: (group: TagGroup) => void;
  onDelete: (group: TagGroup) => void;
  /** The list's presence handle (`PresenceList`), on the row's own root. */
  'data-presence-key'?: string;
}) {
  const name = group.name || '未命名标签组';
  const empty = group.tags.length === 0;
  /* The visible word is 搜索 (the glyph alone below `sm`); the name says which group. */
  const searchLabel = `搜索标签组 ${name}`;
  return (
    <GroupRow
      name={name}
      summary={empty ? '还没有标签，编辑它来添加' : `${group.tags.length} 个标签`}
      busy={deleting}
      data-presence-key={presenceKey}
      control={
        empty ? (
          <Button variant="tonal" icon={<MdSearch />} responsiveLabel disabled aria-label={searchLabel}>
            搜索
          </Button>
        ) : (
          <Link
            scroll={false}
            href={tagGroupSearchHref(group.tags)}
            aria-label={searchLabel}
            className={buttonClasses({ variant: 'tonal', responsiveLabel: true })}
          >
            <MdSearch aria-hidden="true" />
            <span className="max-sm:hidden">搜索</span>
          </Link>
        )
      }
      menu={
        <GroupMenu
          label={`「${name}」的更多操作`}
          busy={sharing || deleting}
          items={[
            { value: 'share', label: '复制分享链接', icon: <MdShare />, disabled: empty },
            { value: 'edit', label: '编辑标签组', icon: <MdEdit /> },
            { value: 'delete', label: '删除标签组', icon: <MdDeleteOutline />, destructive: true },
          ]}
          onSelect={(value) => (value === 'share' ? onShare(group) : value === 'edit' ? onEdit(group) : onDelete(group))}
        />
      }
    >
      {!empty && <TagMarks tags={group.tags} preview={PREVIEW} label={`${name} 的标签`} />}
    </GroupRow>
  );
}

export default memo(TagGroupRow);
