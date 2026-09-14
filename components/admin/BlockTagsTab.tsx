'use client';

import { useState } from 'react';
import { showToast } from '@/components/Toast';
import { MdShield, MdAdd } from 'react-icons/md';
import { SectionHeader } from './';
import SectionHeading from '@/components/SectionHeading';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
import { useConfirm } from '@/components/ConfirmDialog';
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';
import { BLOCK_FILTER_KEYS, installBlockFilters, parseBlockFilters, type BlockFilterKey } from '@/lib/blockFilters';

interface BlockTag {
  id: number;
  tag_name: string;
  filter_key?: BlockFilterKey;
}

type BlockTagsGroup = Partial<Record<BlockFilterKey, BlockTag[]>>;

const filterLabels: Record<BlockFilterKey, string> = {
  safe: '安全模式 (safe) — 排除项',
  spoilers: '剧透模式 (spoilers) — 排除项',
  banAnthro: '屏蔽拟人 (banAnthro) — 排除项',
  banDiscomfort: '屏蔽不适内容 (banDiscomfort) — 排除项',
  onlyPony: '只看小马 (onlyPony) — 可选物种范围 (OR 关系)',
};

const blockTagsQuery = defineAdminQuery<BlockTagsGroup>('block-tags', async (token, signal) => {
  const data = await adminApi.getBlockTags(token, signal);
  adminData(data, undefined);
  const filters = parseBlockFilters(data);
  if (!filters) throw new Error('屏蔽标签响应无效');
  installBlockFilters(filters);
  const grouped: BlockTagsGroup = {};
  if (Array.isArray(data.tags)) {
    for (const tag of data.tags as BlockTag[]) {
      if (tag.filter_key && BLOCK_FILTER_KEYS.includes(tag.filter_key)) {
        (grouped[tag.filter_key] ??= []).push(tag);
      }
    }
  } else if (data.grouped && typeof data.grouped === 'object') {
    for (const key of BLOCK_FILTER_KEYS) grouped[key] = Array.isArray(data.grouped[key]) ? data.grouped[key] : [];
  }
  return grouped;
});

export default function BlockTagsTab({ token }: { token: string }) {
  const read = useAdminQuery(blockTagsQuery, token);
  const blockTags = read.data ?? {};
  const loading = read.loading;
  const loadBlockTags = read.refresh;
  const mutation = useAdminMutation(token);
  const [addingKey, setAddingKey] = useState<BlockFilterKey | null>(null);
  const [newTagName, setNewTagName] = useState('');

  const { confirmThen, confirmDialog } = useConfirm();

  const handleAddTag = async (key: BlockFilterKey) => {
    if (!read.data || !newTagName.trim()) return;
    await mutation.run(() => adminApi.adminAddBlockTag(token, {
        filter_key: key,
        tag_name: newTagName.trim(),
      }), () => {
        showToast('已添加', 'success');
        setNewTagName('');
        setAddingKey(null);
      }, '添加失败', { onCommitted: loadBlockTags });
  };

  const handleRemoveTag = (tagId: number) => {
    confirmThen('确认删除', '确定要删除此标签吗？', async () => {
      await mutation.run(() => adminApi.adminRemoveBlockTag(token, tagId), () => {
          showToast('已删除', 'success');
        }, '移除失败', { onCommitted: loadBlockTags });
    });
  };
  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdShield size={ICON.standard} />}
        title="底层屏蔽标签管理"
        onRefresh={loadBlockTags}
      />
      <Card variant="filled" padding="sm" className="text-body-s text-on-surface-variant">
        此处管理网站全局底层屏蔽规则，影响所有用户的搜索过滤结果。 <b>safe</b> 与 <b>spoilers</b>{' '}
        中的标签会作为排除项（-标签）加入搜索。 <b>onlyPony</b> 中的标签会作为可选物种范围（OR
        关系）。
      </Card>
      {read.error ? <ErrorRetry size="pane" message={read.error} onRetry={loadBlockTags} /> : loading ? (
        /* The destination's own shape — section cards with heading rows and tag
           chips — not a spinner, which reflowed three cards' worth of layout in
           when the list landed. */
        <div className="space-y-6">
          {BLOCK_FILTER_KEYS.map((key, i) => (
            <Card key={key} variant="filled">
              <div className="mb-3 flex items-center justify-between">
                <Skeleton className="h-5 w-24" delay={i * 90} />
                <Skeleton className="h-8 w-16 rounded-full" delay={i * 90 + 40} />
              </div>
              <div className="flex flex-wrap gap-2">
                {[64, 88, 72, 96, 56].map((w, j) => (
                  <Skeleton
                    key={j}
                    className="h-8 rounded-sm"
                    style={{ width: w }}
                    delay={i * 90 + 80 + j * 40}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {BLOCK_FILTER_KEYS.map((key) => {
            const tags = blockTags[key] || [];
            return (
              <Card key={key} variant="filled">
                <div className="flex items-center justify-between mb-3">
                  <SectionHeading as="h3" className="mb-0">{filterLabels[key]}</SectionHeading>
                  <Button
                    icon={<MdAdd />}
                    variant="accent"
                    size="xs"
                    disabled={mutation.busy}
                    onClick={() => setAddingKey(addingKey === key ? null : key)}
                  >
                    添加
                  </Button>
                </div>
                {addingKey === key && (
                  <div className="flex items-center gap-2 mb-3">
                    
                    <Input
                      type="text"
                      value={newTagName}
                      disabled={mutation.busy}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="输入标签名…"
                      fieldClassName="flex-1"
                      onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAddTag(key)}
                    />
                    <Button onClick={() => handleAddTag(key)} variant="filled" size="xs" loading={mutation.busy} disabled={!newTagName.trim()}>
                      确认
                    </Button>
                  </div>
                )}
                {tags.length === 0 ? (
                  <EmptyState size="inline" title="暂无标签" />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      /* `Chip` with `onRemove`, not a hand-rolled pill with a
                         literal `×` in it: a chip is 8dp, not a pill, and the
                         unlabelled button was read out as "times". */
                      <Chip
                        key={tag.id}
                        disabled={mutation.busy}
                        onRemove={() => handleRemoveTag(tag.id)}
                        removeLabel={`移除标签 ${tag.tag_name}`}
                      >
                        {tag.tag_name}
                      </Chip>
                    ))}
                  </div>
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
