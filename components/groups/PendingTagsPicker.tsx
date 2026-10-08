'use client';

import { useId, useMemo, useState } from 'react';
import { MdInventory2 } from 'react-icons/md';
import Button from '@/components/Button';
import Chip from '@/components/Chip';
import type { useConfirm } from '@/components/ConfirmDialog';
import SectionHeading from '@/components/SectionHeading';
import { showToast } from '@/components/Toast';
import { ICON } from '@/lib/icons';
import { clearPendingTags, removePendingTags, usePendingTags } from '@/lib/pendingTags';

interface PendingTagsPickerProps {
  /** Tags already in the list being built; they are shown as added and cannot be picked again. */
  chosen: ReadonlySet<string>;
  /** Add the picked tags to the list. Returns how many went in (the list may be full). */
  onAdd: (tags: string[]) => number;
  /** Asks before 清空全部 — the dialog's own `useConfirm`, so the question stacks above it. */
  confirm: ReturnType<typeof useConfirm>['confirm'];
  disabled?: boolean;
}

/**
 * 待定标签库 in a group editor — the original front end's import: tags set aside earlier, picked
 * here as filter chips and added to the group together (添加选中), or pruned (删除选中 / 清空全部).
 *
 * **Nothing is drawn while the library is empty.** It is filled from elsewhere (tags set aside on
 * another screen, or a library carried over from the original front end), and a panel explaining
 * an empty scratch list in every editor would be furniture.
 *
 * **A tag already in the list says so in words** (G4-017): its chip is checked and unavailable, its
 * name reads 「…，已在列表中」, and the line under the heading counts them. It was a native `title`
 * on a disabled chip — which takes no pointer, so the hint never showed, and had no touch or
 * screen-reader path at all.
 *
 * A pruning the browser refuses to store (storage blocked or full) is said in a toast and keeps the
 * selection, rather than clearing it as if the tags had gone (G4-028).
 *
 * **The same anatomy as the lists above it** (`TagWell`): a group caption (`SectionHeading
 * level="group"`, G4-031) over a tonal box. The hint is the box's first line and describes the
 * chips, rather than sitting in the caption, where it would become part of the heading's name.
 */
export default function PendingTagsPicker({ chosen, onAdd, confirm, disabled = false }: PendingTagsPickerProps) {
  const library = usePendingTags();
  const headingId = useId();
  const hintId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  /* A pick for a tag that left the library (another tab, 删除选中) is not a pick. */
  const selection = useMemo(() => library.filter((tag) => picked.has(tag) && !chosen.has(tag)), [library, picked, chosen]);

  if (library.length === 0) return null;

  const toggle = (tag: string) => {
    setPicked((previous) => {
      const next = new Set(previous);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const add = () => {
    const added = onAdd(selection);
    if (added > 0) setPicked(new Set());
  };

  const remove = async () => {
    if (!(await confirm({
      title: '确认删除',
      message: `确定要从待定标签库中删除选中的 ${selection.length} 个标签吗？`,
      tone: 'danger',
    }))) return;
    if (!removePendingTags(selection)) {
      showToast('待定标签删除失败，请检查浏览器是否允许本地存储', 'error');
      return;
    }
    setPicked(new Set());
  };

  const clear = async () => {
    if (!(await confirm({ title: '确认清空', message: '确定要清空待定标签库吗？', tone: 'danger' }))) return;
    if (!clearPendingTags()) {
      showToast('待定标签库清空失败，请检查浏览器是否允许本地存储', 'error');
      return;
    }
    setPicked(new Set());
  };

  const inList = library.filter((tag) => chosen.has(tag)).length;

  return (
    <section aria-labelledby={headingId}>
      <SectionHeading as="h3" level="group" id={headingId} icon={<MdInventory2 size={ICON.dense} />}>
        待定标签库
      </SectionHeading>
      <div className="rounded-md bg-surface-container-highest p-3 forced-boundary">
        <p id={hintId} className="text-body-s text-on-surface-variant">
          {inList > 0 ? `选择后添加到上方列表，其中 ${inList} 个已在列表中` : '选择后添加到上方列表'}
        </p>
        <div role="group" aria-label="待定标签" aria-describedby={hintId} className="mt-2 flex flex-wrap gap-2">
          {library.map((tag) => {
            const added = chosen.has(tag);
            return (
              <Chip
                key={tag}
                variant="filter"
                selected={added || picked.has(tag)}
                disabled={disabled || added}
                onClick={() => toggle(tag)}
                aria-label={added ? `${tag}，已在列表中` : undefined}
                title={tag}
              >
                {tag}
              </Chip>
            );
          })}
        </div>
        {/* `type="button"`: the picker sits inside its editor's form, where a button with no type is
            a submit — a press on 删除选中 or 清空全部 also saved the group and closed the editor
            under its own question. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="xs" variant="tonal" disabled={disabled || selection.length === 0} onClick={add}>
            {selection.length > 0 ? `添加选中（${selection.length}）` : '添加选中'}
          </Button>
          <Button type="button" size="xs" variant="danger-text" disabled={disabled || selection.length === 0} onClick={() => void remove()}>
            删除选中
          </Button>
          <Button type="button" size="xs" variant="danger-text" className="ml-auto" disabled={disabled} onClick={() => void clear()}>
            清空全部
          </Button>
        </div>
      </div>
    </section>
  );
}
