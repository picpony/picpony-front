'use client';

import { memo } from 'react';
import { MdBlock, MdDeleteOutline, MdEdit, MdVisibilityOff } from 'react-icons/md';
import { GroupMenu, GroupRow, TagMarks } from '@/components/groups/GroupRow';
import ToggleSwitch from '@/components/ToggleSwitch';
import type { BlockGroup } from '@/lib/api/blockGroups';
import { ICON } from '@/lib/icons';

/** How many of each of a group's lists a row shows before it says how many more there are. */
const PREVIEW = 10;

/** The line under the name: what the rule does, by kind. */
function summaryOf(group: BlockGroup): string {
  const parts: string[] = [];
  if (group.hidden_tags.length > 0) parts.push(`隐藏 ${group.hidden_tags.length} 个标签`);
  if (group.spoilered_tags.length > 0) parts.push(`遮挡 ${group.spoilered_tags.length} 个标签`);
  return parts.length > 0 ? parts.join(' · ') : '还没有标签，编辑它来添加';
}

/**
 * One 屏蔽组, in the groups' shared row (`GroupRow`): its switch, a ⋮ with 编辑 and 删除, and what
 * it hides and covers.
 *
 * One signal per meaning: the switch is the control and the row's container says the rule is in
 * force; the tags are marks either way, the 隐藏 and 遮挡 glyphs the only difference between the
 * two runs. A switch press flips at once and comes back with a reason if the server refuses;
 * nothing dims while it is out, the switch included (R5-039, G4-002): it stays a live control the
 * page coalesces presses on, so a keyboard user's focus stays on it. Only a delete in flight makes
 * it unavailable — the group is going away.
 */
function BlockGroupRow({
  group,
  deleting,
  onToggle,
  onEdit,
  onDelete,
  'data-presence-key': presenceKey,
}: {
  group: BlockGroup;
  deleting: boolean;
  onToggle: (group: BlockGroup, active: boolean) => void;
  onEdit: (group: BlockGroup) => void;
  onDelete: (group: BlockGroup) => void;
  /** The list's presence handle (`PresenceList`), on the row's own root. */
  'data-presence-key'?: string;
}) {
  const active = group.is_active === 1;
  const name = group.name || '未命名屏蔽组';
  const empty = group.hidden_tags.length === 0 && group.spoilered_tags.length === 0;
  return (
    <GroupRow
      name={name}
      summary={summaryOf(group)}
      active={active}
      busy={deleting}
      data-presence-key={presenceKey}
      control={
        <ToggleSwitch
          checked={active}
          disabled={deleting}
          onChange={(next) => onToggle(group, next)}
          aria-label={`启用屏蔽组 ${name}`}
        />
      }
      menu={
        <GroupMenu
          label={`「${name}」的更多操作`}
          busy={deleting}
          items={[
            { value: 'edit', label: '编辑屏蔽组', icon: <MdEdit /> },
            { value: 'delete', label: '删除屏蔽组', icon: <MdDeleteOutline />, destructive: true },
          ]}
          onSelect={(value) => (value === 'edit' ? onEdit(group) : onDelete(group))}
        />
      }
    >
      {!empty && (
        <>
          <TagMarks tags={group.hidden_tags} preview={PREVIEW} label="隐藏的标签" icon={<MdBlock size={ICON.dense} />} active={active} />
          <TagMarks tags={group.spoilered_tags} preview={PREVIEW} label="遮挡的标签" icon={<MdVisibilityOff size={ICON.dense} />} active={active} />
        </>
      )}
    </GroupRow>
  );
}

export default memo(BlockGroupRow);
