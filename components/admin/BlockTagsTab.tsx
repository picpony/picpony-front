'use client';

import { useState } from 'react';
import { MdAdd } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { Input } from '@/components/Input';
import SectionHeading from '@/components/SectionHeading';
import Skeleton from '@/components/Skeleton';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import * as adminApi from '@/lib/api/admin';
import { BLOCK_FILTER_KEYS, installBlockFilters, parseBlockFilters, type BlockFilterKey } from '@/lib/blockFilters';
import SectionHeader from './SectionHeader';
import { AdminNote } from './AdminForm';
import { adminData, defineAdminQuery, retryError, useAdminQuery } from './queries';
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

const blockTagsQuery = defineAdminQuery<BlockTagsGroup>('block-tags', async (token, signal) => {
  const data = await adminApi.getBlockTags(token, signal);
  adminData(data, undefined, '屏蔽标签');
  const filters = parseBlockFilters(data);
  if (!filters) throw new Error('屏蔽标签加载失败');
  installBlockFilters(filters);
  const grouped: BlockTagsGroup = {};
  if (Array.isArray(data.tags)) {
    for (const tag of data.tags as BlockTag[]) {
      if (tag.filter_key && BLOCK_FILTER_KEYS.includes(tag.filter_key)) (grouped[tag.filter_key] ??= []).push(tag);
    }
  } else if (data.grouped && typeof data.grouped === 'object') {
    for (const key of BLOCK_FILTER_KEYS) grouped[key] = Array.isArray(data.grouped[key]) ? data.grouped[key] : [];
  }
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
export default function BlockTagsTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(blockTagsQuery, token);
  const groups = read.data ?? {};
  const addMutation = useAdminMutation(token);
  const removeMutation = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState<BlockFilterKey | null>(null);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

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
      () => adminApi.adminAddBlockTag(token, { filter_key: key, tag_name: name }),
      () => {
        showToast(`已将 ${name} 加入「${RULES[key].name}」`, 'success');
        setDraft('');
        setAdding(null);
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
      ));

  const toggleAdding = (key: BlockFilterKey) => {
    setDraft('');
    setDraftError(null);
    setAdding((current) => (current === key ? null : key));
  };

  return (
    <div className="space-y-6">
      <SectionHeader section="blocktags" onRefresh={read.refresh} isLoading={read.refreshing} />
      <AdminNote>
        这些规则作用于全站所有用户的搜索结果：前四项中的标签会作为排除项加入搜索，「只看小马」中的标签是允许的物种范围，满足其中任一即可。
      </AdminNote>
      {read.error && !read.data ? (
        <ErrorRetry size="pane" {...retryError('屏蔽标签加载失败', read.error)} onRetry={read.retryable ? read.refresh : undefined} />
      ) : (
        <div className="space-y-4">
          {BLOCK_FILTER_KEYS.map((key, index) => {
            const tags = groups[key] ?? [];
            const open = adding === key;
            return (
              <Card key={key} variant="filled" className="space-y-3">
                <SectionHeading
                  as="h3"
                  className="mb-3"
                  subtitle={`${RULES[key].role}（${key}）`}
                  actions={
                    <Button
                      type="button"
                      variant="tonal"
                      size="xs"
                      icon={<MdAdd />}
                      aria-expanded={open}
                      disabled={!read.data}
                      onClick={() => toggleAdding(key)}
                    >
                      添加标签
                    </Button>
                  }
                >
                  {RULES[key].name}
                </SectionHeading>
                {open && (
                  <form
                    noValidate
                    aria-label={`向「${RULES[key].name}」添加标签`}
                    className="flex items-start gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      add(key);
                    }}
                  >
                    <Input
                      size="sm"
                      aria-label="标签名"
                      placeholder="输入英文标签名，例如 grimdark"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                      value={draft}
                      readOnly={addMutation.busy}
                      error={draftError ?? undefined}
                      fieldClassName="min-w-0 flex-1"
                      onChange={(event) => {
                        setDraft(event.target.value);
                        setDraftError(null);
                      }}
                    />
                    <Button type="submit" variant="filled" loading={addMutation.busy}>
                      添加
                    </Button>
                  </form>
                )}
                {!read.data ? (
                  <div className="flex flex-wrap gap-2" aria-hidden="true">
                    {[64, 88, 72, 96, 56].map((width, chip) => (
                      <Skeleton key={chip} className="h-8 rounded-sm" style={{ width }} delay={index * 90 + chip * 40} />
                    ))}
                  </div>
                ) : tags.length === 0 ? (
                  <EmptyState size="inline" title="这条规则还没有标签" />
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label={`「${RULES[key].name}」的标签`}>
                    {tags.map((tag) => (
                      <li key={tag.id}>
                        <Chip
                          disabled={removeMutation.pendingKeys.has(tag.id)}
                          onRemove={() => remove(key, tag)}
                          removeLabel={`从「${RULES[key].name}」中移除 ${tag.tag_name}`}
                        >
                          {tag.tag_name}
                        </Chip>
                      </li>
                    ))}
                  </ul>
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
