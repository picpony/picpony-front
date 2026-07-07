'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { MdBlock, MdAdd, MdOpenInNew } from 'react-icons/md';
import { SectionHeader, SearchInput, EmptyState, Spinner } from './';

interface BlacklistItem {
  image_id: number;
  reason: string;
  created_at: string;
}

export default function BlacklistTab({ token }: { token: string }) {
  const [blacklist, setBlacklist] = useState<BlacklistItem[]>([]);
  const [filteredBlacklist, setFilteredBlacklist] = useState<BlacklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');
  const [imageId, setImageId] = useState('');
  const [reason, setReason] = useState('');

  const [blacklistConfirmModalOpen, setBlacklistConfirmModalOpen] = useState(false);
  const [blacklistConfirmTitle, setBlacklistConfirmTitle] = useState('');
  const [blacklistConfirmMessage, setBlacklistConfirmMessage] = useState('');
  const blacklistConfirmActionRef = useRef<(() => void) | null>(null);

  const showBlacklistConfirm = (title: string, message: string, action: () => void) => {
    setBlacklistConfirmTitle(title);
    setBlacklistConfirmMessage(message);
    blacklistConfirmActionRef.current = action;
    setBlacklistConfirmModalOpen(true);
  };

  const handleBlacklistConfirmAction = () => {
    blacklistConfirmActionRef.current?.();
    setBlacklistConfirmModalOpen(false);
  };

  const loadBlacklist = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetBlacklist(token);
      if (data.success) {
        setBlacklist(data.blacklist || []);
        setFilteredBlacklist(data.blacklist || []);
      }
    } catch {
      showToast('加载黑名单失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api.adminGetBlacklist(token)
      .then((data) => {
        if (data.success) {
          setBlacklist(data.blacklist || []);
          setFilteredBlacklist(data.blacklist || []);
        }
      })
      .catch(() => showToast('加载黑名单失败', 'error'))
      .finally(() => setIsLoading(false));
  }, [token]);

  useEffect(() => {
    if (!searchKw) {
      setFilteredBlacklist(blacklist);
      return;
    }
    const kw = searchKw.toLowerCase();
    setFilteredBlacklist(blacklist.filter(b => 
      String(b.image_id) === kw ||
      b.reason?.toLowerCase().includes(kw)
    ));
  }, [searchKw, blacklist]);

  const addBlacklist = async () => {
    if (!imageId) {
      showToast('请输入图片ID', 'error');
      return;
    }
    try {
      const res = await api.adminAddBlacklist(token, parseInt(imageId), reason);
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
    showBlacklistConfirm(
      '确认解除屏蔽',
      `确定要解除对图片 #${id} 的屏蔽吗？`,
      async () => {
        try {
          const res = await api.adminRemoveBlacklist(token, id);
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
      }
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdBlock className="text-primary" size={24} />}
        title="全局违规图片屏蔽库"
        onRefresh={loadBlacklist}
      />

      <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-900/30">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">图片ID</label>
            <input
              type="number"
              value={imageId}
              onChange={(e) => setImageId(e.target.value)}
              placeholder="例如: 3123456"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div className="flex-[2]">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">屏蔽原因（仅后台可见）</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如: 严重违规、政治敏感..."
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={addBlacklist}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              <MdAdd size={18} className="inline mr-1" />
              强制屏蔽
            </button>
          </div>
        </div>
      </div>

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索已屏蔽图片..."
      />

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">图片ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">原帖</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">屏蔽原因</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">时间</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={5} message="" icon={<Spinner label="" />} />
            ) : filteredBlacklist.length === 0 ? (
              <EmptyState colSpan={5} message="暂无屏蔽记录" />
            ) : (
              filteredBlacklist.map((item) => (
                <tr key={item.image_id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm font-medium">#{item.image_id}</td>
                  <td className="px-4 py-3">
                    <a 
                      href={`/pic/${item.image_id}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-sm flex items-center gap-1"
                    >
                      查看原帖 <MdOpenInNew size={14} />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm">{item.reason || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{item.created_at}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => removeBlacklist(item.image_id)}
                      className="px-3 py-1 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded transition-colors"
                    >
                      解除屏蔽
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={blacklistConfirmModalOpen}
        onClose={() => setBlacklistConfirmModalOpen(false)}
        title={blacklistConfirmTitle}
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setBlacklistConfirmModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleBlacklistConfirmAction}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">{blacklistConfirmMessage}</p>
      </Modal>
    </div>
  );
}
