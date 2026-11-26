'use client';

import { useEffect, useRef, useState } from 'react';
import { MdAdd } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import Collapse from '@/components/Collapse';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { Input } from '@/components/Input';
import PresenceList from '@/components/PresenceList';
import SectionHeading from '@/components/SectionHeading';
import Skeleton from '@/components/Skeleton';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { MOTION_SPEED_SCALE, motionTier } from '@/lib/appearance';
import * as adminApi from '@/lib/api/admin';
import { BLOCK_FILTER_KEYS, installBlockFilters, type BlockFilterKey, type BlockFilters } from '@/lib/blockFilters';
import SectionHeader from './SectionHeader';
import { AdminNote } from './AdminForm';
import { defineAdminQuery, retryError, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';

interface BlockTag {
  id: number;
  tag_name: string;
  filter_key?: BlockFilterKey;
}

type BlockTagsGroup = Partial<Record<BlockFilterKey, BlockTag[]>>;

/** Each rule's name, and what its tags do to a search. */
const RULES: Record<BlockFilterKey, { name: string; role: string }> = {
  safe: { name: '安全模式', role: '排除的标签' },
  spoilers: { name: '剧透模式', role: '排除的标签' },
  banAnthro: { name: '屏蔽拟人', role: '排除的标签' },
  banDiscomfort: { name: '屏蔽不适内容', role: '排除的标签' },
  onlyPony: { name: '只看小马', role: '允许的物种（任一即可）' },
};

const isRule = (value: string): value is BlockFilterKey => (BLOCK_FILTER_KEYS as readonly string[]).includes(value);

/* The rules every visitor's searches carry: the rows (with the ids a removal names), and the same
   tags installed as this tab's live filters, so the console's own searches follow an edit at once. */
const blockTagsQuery = defineAdminQuery<BlockTagsGroup>('block-tags', async (_token, signal) => {
  const data = await adminApi.getBlockTags(signal);
  const grouped: BlockTagsGroup = {};
  const filters = Object.fromEntries(BLOCK_FILTER_KEYS.map((key) => [key, [] as string[]])) as BlockFilters;
  for (const row of data.tags) {
    if (!isRule(row.filter)) continue;
    (grouped[row.filter] ??= []).push({ id: row.id, tag_name: row.tag, filter_key: row.filter });
    const tag = row.tag.trim().toLowerCase();
    if (tag && !filters[row.filter].includes(tag)) filters[row.filter].push(tag);
  }
  installBlockFilters(filters);
  return grouped;
});

/** A tag as Derpibooru spells it: trimmed, lower-case, single spaces. */
function blockTagName(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 屏蔽标签 — the site-wide rules every visitor's searches carry. One verb for taking a tag out of
 * a rule, 移除, on the chip, in the confirm and in its failure (R9-019: it said 删除 in the
 * confirm and named neither the tag nor the rule); a new tag is lower-cased and trimmed, and one
 * the rule already has is refused on the field.
 */
const COLLAPSE_WATCHDOG_MS = Math.ceil(1000 * MOTION_SPEED_SCALE.slow);

export default function BlockTagsTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(blockTagsQuery, token);
  const groups = read.data ?? {};
  const addMutation = useAdminMutation(token);
  const removeMutation = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState<BlockFilterKey | null>(null);
  const [closing, setClosing] = useState<{ key: BlockFilterKey; draft: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!adding) return;
    addInputRef.current?.focus({ preventScroll: true });
  }, [adding]);

  useEffect(() => {
    if (!closing) return;
    if (motionTier('list') === 'off') {
      const frame = requestAnimationFrame(() => setClosing(null));
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(() => setClosing(null), COLLAPSE_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [closing]);

  const closeAdding = (key: BlockFilterKey) => {
    if (motionTier('list') !== 'off') setClosing({ key, draft });
    setAdding(null);
  };

  const add = (key: BlockFilterKey) => {
    if (addMutation.isPending()) return;
    const name = blockTagName(draft);
    if (!name) {
      setDraftError('请输入标签名');
      return;
    }
    /* No Derpibooru tag contains a comma — it is the tag separator — and in a search it is AND.
       `explicit, grimdark` typed as two tags at once was stored as one, and every visitor's search
       then carried `-explicit,\ grimdark`: the exclusion of one tag and a *required* second term
       (review P6-F7). One tag per add. */
    if (/[,，]/.test(name)) {
      setDraftError('一次添加一个标签，标签名不能包含逗号');
      return;
    }
    if ((groups[key] ?? []).some((tag) => blockTagName(tag.tag_name) === name)) {
      setDraftError(`「${RULES[key].name}」中已有标签 ${name}`);
      return;
    }
    void addMutation.run(
      () => adminApi.adminAddBlockTag(token, { filter: key, tag: name }),
      () => {
        showToast(`已将 ${name} 加入「${RULES[key].name}」`, 'success');
        setDraft('');
        closeAdding(key);
      },
      '添加失败',
      { onCommitted: read.refresh },
    );
  };

  const remove = (key: BlockFilterKey, tag: BlockTag) =>
    confirmThen('确认移除标签', `确定要从「${RULES[key].name}」中移除 ${tag.tag_name} 吗？`, () =>
      void removeMutation.run(
        () => adminApi.adminRemoveBlockTag(token, tag.id),
        () => showToast(`已从「${RULES[key].name}」中移除 ${tag.tag_name}`, 'success'),
        '移除失败',
        {
          key: tag.id,
          onCommitted: () => {
            blockTagsQuery.write(token, (previous) => ({
              ...(previous ?? {}),
              [key]: (previous?.[key] ?? []).filter((row) => row.id !== tag.id),
            }));
            read.refresh();
          },
        },
      ), { tone: 'danger' });

  const toggleAdding = (key: BlockFilterKey) => {
    if (adding === key) {
      closeAdding(key);
      setDraft('');
      setDraftError(null);
      return;
    }
    if (adding && motionTier('list') !== 'off') setClosing({ key: adding, draft });
    else if (closing?.key === key) setClosing(null);
    setDraft('');
    setDraftError(null);
    setAdding(key);
  };

  return (
    <div className="space-y-6">
      <SectionHeader section="blocktags" onRefresh={read.refresh} isLoading={read.refreshing} />
      <AdminNote>
        以下规则作用于全站所有用户的搜索结果：前四项中的标签会作为排除项加入搜索，「只看小马」中的标签是允许的物种范围，满足其中任一即可。
      </AdminNote>
      {read.error && !read.data ? (
        <ErrorRetry size="pane" {...retryError('屏蔽标签加载失败', read.error)} onRetry={read.retryable ? read.refresh : undefined} />
      ) : (
        <div className="space-y-4">
          {BLOCK_FILTER_KEYS.map((key, index) => {
            const tags = groups[key] ?? [];
            const open = adding === key;
            const mounted = open || closing?.key === key;
            const collapseId = `block-tag-add-${key}`;
            return (
              <Card key={key} variant="filled" className="space-y-3">
                <div>
                  <SectionHeading
                    as="h3"
                    className="mb-0"
                    subtitle={RULES[key].role}
                    actions={
                      <Button
                        type="button"
                        variant="tonal"
                        size="xs"
                        icon={<MdAdd />}
                        aria-expanded={open}
                        aria-controls={collapseId}
                        disabled={!read.data}
                        onClick={() => toggleAdding(key)}
                      >
                        添加标签
                      </Button>
                    }
                  >
                    {RULES[key].name}
                  </SectionHeading>
                  <Collapse
                    id={collapseId}
                    open={open}
                    onTransitionEnd={(event) => {
                      if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows' && !open) {
                        setClosing((current) => (current?.key === key ? null : current));
                      }
                    }}
                  >
                    {mounted && (
                      <form
                        noValidate
                        aria-label={`向「${RULES[key].name}」添加标签`}
                        className="flex items-start gap-2 pt-3"
                        onSubmit={(event) => {
                          event.preventDefault();
                          add(key);
                        }}
                      >
                        <Input
                          ref={open ? addInputRef : undefined}
                          size="sm"
                          aria-label="标签名"
                          placeholder="输入英文标签名，例如：grimdark"
                          autoComplete="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          value={open ? draft : (closing?.draft ?? '')}
                          readOnly={addMutation.busy || !open}
                          error={open ? (draftError ?? undefined) : undefined}
                          fieldClassName="min-w-0 flex-1"
                          onChange={(event) => {
                            setDraft(event.target.value);
                            setDraftError(null);
                          }}
                        />
                        <Button type="submit" variant="filled" loading={open && addMutation.busy}>
                          添加
                        </Button>
                      </form>
                    )}
                  </Collapse>
                </div>
                {!read.data ? (
                  <div className="flex flex-wrap gap-2" aria-hidden="true">
                    {[64, 88, 72, 96, 56].map((width, chip) => (
                      <Skeleton key={chip} className="h-8 rounded-sm" style={{ width }} delay={index * 90 + chip * 40} />
                    ))}
                  </div>
                ) : (
                  <PresenceList items={tags} getKey={(tag) => tag.id} variant="grid">
                    {(entries, ref) =>
                      entries.length === 0 ? (
                        <EmptyState size="inline" title="暂无标签" />
                      ) : (
                        <ul ref={ref} className="relative flex flex-wrap gap-2" aria-label={`「${RULES[key].name}」的标签`}>
                          {entries.map(({ item: tag, key: entryKey, leaving }) => (
                            <li key={entryKey} data-presence-key={entryKey}>
                              <Chip
                                disabled={leaving || removeMutation.pendingKeys.has(tag.id)}
                                onRemove={() => remove(key, tag)}
                                removeLabel={`从「${RULES[key].name}」中移除 ${tag.tag_name}`}
                              >
                                {tag.tag_name}
                              </Chip>
                            </li>
                          ))}
                        </ul>
                      )
                    }
                  </PresenceList>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
