'use client';

import { useState, useMemo } from 'react';
import { showToast } from '@/components/Toast';
import DataTable, { type Column } from '@/components/DataTable';
import { MdBlock, MdAdd, MdOpenInNew } from 'react-icons/md';
import { SectionHeader, SearchInput } from './';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';

interface BlacklistItem {
  image_id: number;
  reason: string;
  created_at: string;
}

const emptyBlacklist: BlacklistItem[] = [];
const blacklistQuery = defineAdminQuery<BlacklistItem[]>('blacklist', async (token, signal) => {
  const data = await adminApi.adminGetBlacklist(token, signal);
  return adminData(data, data.blacklist || []);
});

export default function BlacklistTab({ token }: { token: string }) {
  const mutation = useAdminMutation(token);
  const read = useAdminQuery(blacklistQuery, token);
  const blacklist = read.data ?? emptyBlacklist;
  const isLoading = read.loading;
  const loadBlacklist = read.refresh;
  const addMutation = useAdminMutation(token);
  const adding = addMutation.busy;
  const [searchKw, setSearchKw] = useState('');
  const [imageId, setImageId] = useState('');
  const [reason, setReason] = useState('');

  const { confirmThen, confirmDialog } = useConfirm();

  const filteredBlacklist = useMemo(() => {
    if (!searchKw) return blacklist;
    const kw = searchKw.toLowerCase();
    return blacklist.filter(
      (b) => String(b.image_id) === kw || b.reason?.toLowerCase().includes(kw),
    );
  }, [searchKw, blacklist]);

  const addBlacklist = async () => {
    if (addMutation.isPending() || mutation.isPending()) return;
    const id = Number(imageId);
    if (!Number.isSafeInteger(id) || id < 1) {
      showToast('请输入有效的图片 ID', 'error');
      return;
    }
    await addMutation.run(
      () => adminApi.adminAddBlacklist(token, id, reason),
      () => {
        showToast('已添加屏蔽', 'success');
        setImageId('');
        setReason('');
      },
      '添加失败',
      { onCommitted: loadBlacklist },
    );
  };

  const removeBlacklist = async (id: number) => {
    confirmThen('确认解除屏蔽', `确定要解除对图片 #${id} 的屏蔽吗？`, async () => {
      if (addMutation.isPending()) return;
      await mutation.run(
        () => adminApi.adminRemoveBlacklist(token, id),
        () => showToast('已解除屏蔽', 'success'),
        '解除失败',
        { onCommitted: () => {
          blacklistQuery.write(token, (previous) => previous?.filter((item) => item.image_id !== id) ?? []);
          loadBlacklist();
        } },
      );
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
          className="prose-link inline-flex items-center gap-1 focus-visible:ring-2 focus-ring"
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
        <Button variant="success" size="xs" disabled={mutation.busy || adding} onClick={() => removeBlacklist(item.image_id)}>
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
              min={1}
              disabled={adding}
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
              disabled={adding}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：严重违规、政治敏感…"
            />
          </div>
          <div className="flex items-end">
            <Button icon={<MdAdd />} variant="danger" onClick={addBlacklist} loading={adding} disabled={mutation.busy}>
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
        error={read.error}
        onRetry={loadBlacklist}
        empty="暂无屏蔽记录"
      />

      {confirmDialog}
    </div>
  );
}
