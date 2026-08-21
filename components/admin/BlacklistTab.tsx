'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { showToast } from '@/components/Toast';
import DataTable, { type Column } from '@/components/DataTable';
import { MdBlock, MdAdd, MdOpenInNew } from 'react-icons/md';
import { SectionHeader, SearchInput } from './';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
/* A namespace import, and it is the point: `lib/api.ts`'s `api` is a runtime
   spread and therefore un-tree-shakeable, so while the admin surface was in it
   every gallery route shipped all 48 of these. Only the eleven admin tabs
   import it now, and each is already its own `dynamic` chunk. */
import * as adminApi from '@/lib/api/admin';

interface BlacklistItem {
  image_id: number;
  reason: string;
  created_at: string;
}

/** Built per render — the array is five literals and `DataTable` doesn't memoise. */

export default function BlacklistTab({ token }: { token: string }) {
  const [blacklist, setBlacklist] = useState<BlacklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');
  const [imageId, setImageId] = useState('');
  const [reason, setReason] = useState('');

  const { confirmThen, confirmDialog } = useConfirm();

  const loadBlacklist = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await adminApi.adminGetBlacklist(token);
      if (data.success) {
        setBlacklist(data.blacklist || []);
      }
    } catch {
      showToast('黑名单加载失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    adminApi
      .adminGetBlacklist(token)
      .then((data) => {
        if (data.success) {
          setBlacklist(data.blacklist || []);
        }
      })
      .catch(() => showToast('黑名单加载失败', 'error'))
      .finally(() => setIsLoading(false));
  }, [token]);

  const filteredBlacklist = useMemo(() => {
    if (!searchKw) return blacklist;
    const kw = searchKw.toLowerCase();
    return blacklist.filter(
      (b) => String(b.image_id) === kw || b.reason?.toLowerCase().includes(kw),
    );
  }, [searchKw, blacklist]);

  const addBlacklist = async () => {
    if (!imageId) {
      showToast('请输入图片 ID', 'error');
      return;
    }
    try {
      const res = await adminApi.adminAddBlacklist(token, parseInt(imageId), reason);
      const data = await res.json();
      if (data.success) {
        showToast('已添加屏蔽', 'success');
        setImageId('');
        setReason('');
        loadBlacklist();
      } else {
        showToast(data.error || '添加失败', 'error');
      }
    } catch {
      showToast('添加失败', 'error');
    }
  };

  const removeBlacklist = async (id: number) => {
    confirmThen('确认解除屏蔽', `确定要解除对图片 #${id} 的屏蔽吗？`, async () => {
      try {
        const res = await adminApi.adminRemoveBlacklist(token, id);
        const data = await res.json();
        if (data.success) {
          showToast('已解除屏蔽', 'success');
          loadBlacklist();
        } else {
          showToast(data.error || '解除失败', 'error');
        }
      } catch {
        showToast('解除失败', 'error');
      }
    });
  };

  const blacklistColumns: Column<BlacklistItem>[] = [
    {
      key: 'id',
      header: '图片 ID',
      primary: true,
      render: (item) => <span className="text-body-m-emphasized">#{item.image_id}</span>,
    },
    {
      key: 'link',
      header: '原帖',
      render: (item) => (
        <a
          href={`/pic/${item.image_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link inline-flex items-center gap-1 hover:underline rounded-xs outline-none focus-visible:ring-2 focus-ring"
        >
          查看原帖 <MdOpenInNew size={ICON.dense} />
        </a>
      ),
    },
    { key: 'reason', header: '屏蔽原因', render: (item) => item.reason || '-' },
    {
      key: 'created',
      header: '时间',
      render: (item) => <span className="text-on-surface-variant">{item.created_at}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (item) => (
        <Button variant="success" size="xs" onClick={() => removeBlacklist(item.image_id)} data-ripple>
          解除屏蔽
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdBlock size={ICON.standard} />}
        title="全局违规图片屏蔽库"
        onRefresh={loadBlacklist}
      />

      <div className="p-4 rounded-md">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <Input
              label="图片 ID"
              id="blacklisttab-f1"
              type="number"
              value={imageId}
              onChange={(e) => setImageId(e.target.value)}
              placeholder="例如：3123456"
            />
          </div>
          <div className="flex-[2]">
            <Input
              label="屏蔽原因（仅后台可见）"
              id="blacklisttab-f2"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：严重违规、政治敏感…"
            />
          </div>
          <div className="flex items-end">
            <Button icon={<MdAdd size={ICON.dense} />} variant="danger" onClick={addBlacklist}>
              强制屏蔽
            </Button>
          </div>
        </div>
      </div>

      <SearchInput value={searchKw} onChange={setSearchKw} placeholder="搜索已屏蔽图片…" />

      <DataTable<BlacklistItem>
        columns={blacklistColumns}
        rows={filteredBlacklist}
        rowKey={(item) => item.image_id}
        loading={isLoading}
        empty="暂无屏蔽记录"
      />

      {confirmDialog}
    </div>
  );
}
