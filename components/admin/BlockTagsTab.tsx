'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { MdShield, MdAdd } from 'react-icons/md';
import { SectionHeader, Spinner } from './';

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

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmActionRef = useRef<(() => void) | null>(null);

  const showConfirm = (action: () => void) => {
    confirmActionRef.current = action;
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    confirmActionRef.current?.();
    setConfirmOpen(false);
  };

  const loadBlockTags = async () => {
    setLoading(true);
    try {
      const data = await api.getBlockTags(token);
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
        const data = await api.getBlockTags(token);
        if (!cancelled && data.success) {
          setBlockTags(data.tags || {});
        }
      } catch {
        if (!cancelled) showToast('加载失败', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleAddTag = async (key: string) => {
    if (!newTagName.trim()) return;
    try {
      const res = await api.adminAddBlockTag(token, { filter_key: key, tag_name: newTagName.trim() });
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
    showConfirm(async () => {
      try {
        const res = await api.adminRemoveBlockTag(token, tagId);
        const data = await res.json();
        if (data.success) {
          showToast('已移除', 'success');
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
      <SectionHeader
        icon={<MdShield className="text-primary" size={24} />}
        title="底层屏蔽标签管理"
        onRefresh={loadBlockTags}
      />

      <div className="text-xs text-slate-500 dark:text-slate-400 p-3 bg-red-50 dark:bg-red-900/20 rounded border-l-4 border-l-red-500">
        此处管理网站全局底层屏蔽规则，影响所有用户的搜索过滤结果。
        <b>safe</b> 与 <b>spoilers</b> 中的标签会作为排除项（-标签）加入搜索。
        <b>onlyPony</b> 中的标签会作为可选物种范围（OR 关系）。
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          {filterKeys.map((key) => {
            const tags = blockTags[key] || [];
            return (
              <div key={key} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{filterLabels[key]}</h3>
                  <button
                    onClick={() => setAddingKey(addingKey === key ? null : key)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20"
                  >
                    <MdAdd size={14} /> 添加
                  </button>
                </div>

                {addingKey === key && (
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder="输入标签名..."
                      className="flex-1 px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-800"
                      onKeyDown={(e) => e.key === 'Enter' && handleAddTag(key)}
                    />
                    <button
                      onClick={() => handleAddTag(key)}
                      className="px-3 py-1.5 bg-primary text-white rounded text-xs font-medium"
                    >
                      确认
                    </button>
                  </div>
                )}

                {tags.length === 0 ? (
                  <p className="text-xs text-slate-400">暂无标签</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag: BlockTag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                      >
                        {tag.tag_name}
                        <button
                          onClick={() => handleRemoveTag(key, tag.id)}
                          className="text-red-400 hover:text-red-600 ml-1"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认移除"
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setConfirmOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">确定要移除此标签？</p>
      </Modal>
    </div>
  );
}
