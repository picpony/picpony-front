'use client';

import { useState, useEffect } from 'react';
import { showToast } from '@/components/Toast';
import { MdShield, MdAdd } from 'react-icons/md';
import { SectionHeader } from './';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
import { useConfirm } from '@/components/ConfirmDialog';
/* A namespace import, and it is the point: `lib/api.ts`'s `api` is a runtime
   spread and therefore un-tree-shakeable, so while the admin surface was in it
   every gallery route shipped all 48 of these. Only the eleven admin tabs
   import it now, and each is already its own `dynamic` chunk. */
import * as adminApi from '@/lib/api/admin';

interface BlockTag {
  id: number;
  tag_name: string;
}

interface BlockTagsGroup {
  [key: string]: BlockTag[];
}

const filterKeys = ['safe', 'spoilers', 'banAnthro', 'banDiscomfort', 'onlyPony'];

const filterLabels: Record<string, string> = {
  safe: '安全模式 (safe) — 排除项',
  spoilers: '剧透模式 (spoilers) — 排除项',
  banAnthro: '屏蔽拟人 (banAnthro) — 排除项',
  banDiscomfort: '屏蔽不适内容 (banDiscomfort) — 排除项',
  onlyPony: '只看小马 (onlyPony) — 可选物种范围 (OR 关系)',
};

export default function BlockTagsTab({ token }: { token: string }) {
  const [blockTags, setBlockTags] = useState<BlockTagsGroup>({});
  const [loading, setLoading] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');

  /* `useConfirm`, not a `Modal` plus an open flag and a ref. Five admin tabs
     converted to the shared dialog and five — this among them — kept their own,
     which is also why their copy drifted: every hand-rolled body dropped the
     sentence-final 吗 that every converted one kept. */
  const { confirmThen, confirmDialog } = useConfirm();

  const loadBlockTags = async () => {
    setLoading(true);
    try {
      const data = await adminApi.getBlockTags(token);
      if (data.success) {
        setBlockTags(data.tags || {});
      }
    } catch {
      showToast('加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await adminApi.getBlockTags(token);
        if (!cancelled && data.success) {
          setBlockTags(data.tags || {});
        }
      } catch {
        if (!cancelled) showToast('加载失败', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAddTag = async (key: string) => {
    if (!newTagName.trim()) return;
    try {
      const res = await adminApi.adminAddBlockTag(token, {
        filter_key: key,
        tag_name: newTagName.trim(),
      });
      const data = await res.json();
      if (data.success) {
        showToast('已添加', 'success');
        setNewTagName('');
        setAddingKey(null);
        loadBlockTags();
      } else {
        showToast(data.error || '添加失败', 'error');
      }
    } catch {
      showToast('添加失败', 'error');
    }
  };

  const handleRemoveTag = (_key: string, tagId: number) => {
    confirmThen('确认删除', '确定要删除此标签吗？', async () => {
      try {
        const res = await adminApi.adminRemoveBlockTag(token, tagId);
        const data = await res.json();
        if (data.success) {
          showToast('已删除', 'success');
          loadBlockTags();
        } else {
          showToast(data.error || '移除失败', 'error');
        }
      } catch {
        showToast('移除失败', 'error');
      }
    });
  };
  return (
    <div className="space-y-6">
      {' '}
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
      {loading ? (
        /* The destination's own shape — three section cards each with a heading
           row and a run of tag chips — not a spinner. A centred dot said
           "something is happening somewhere" and then reflowed three cards' worth
           of layout in when the list landed. */
        <div className="space-y-6">
          {filterKeys.map((key, i) => (
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
          {filterKeys.map((key) => {
            const tags = blockTags[key] || [];
            return (
              <Card key={key} variant="filled">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-label-l text-on-surface">{filterLabels[key]}</h3>
                  <Button
                    icon={<MdAdd size={ICON.dense} />}
                    variant="accent"
                    size="xs"
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
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="输入标签名…"
                      fieldClassName="flex-1"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag(key)}
                    />
                    <Button onClick={() => handleAddTag(key)} variant="filled" size="xs">
                      确认
                    </Button>
                  </div>
                )}
                {tags.length === 0 ? (
                  <EmptyState size="inline" title="暂无标签" />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag: BlockTag) => (
                      /* `Chip` with `onRemove`, not a hand-rolled `rounded-full`
                         pill with a literal `×` in it. The pill was the exact
                         shape the shape table warns about — a chip is 8dp, not a
                         pill — and its dismiss was an unlabelled `<button>`
                         containing a multiplication sign, which a screen reader
                         reads out as "times". */
                      <Chip
                        key={tag.id}
                        onRemove={() => handleRemoveTag(key, tag.id)}
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
