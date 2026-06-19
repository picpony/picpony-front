'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MdHistory, MdDelete, MdDeleteSweep, MdImage, MdPerson } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';

interface HistoryItem {
  id: number;
  preview_url: string | null;
  uploader: string | null;
  last_view_time: string;
}

interface HistoryResponse {
  success: boolean;
  history: HistoryItem[];
  total_pages: number;
  current_page: number;
}

export default function HistoryPage() {
  const router = useRouter();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  const fetchHistory = async (targetPage: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) {
        router.push('/login');
        return;
      }
      const user = JSON.parse(storedUser);
      const data: HistoryResponse = await api.getBrowsingHistory(user.token, targetPage);
      if (data.success) {
        setHistory(data.history);
        setTotalPages(data.total_pages);
        setPage(targetPage);
      } else {
        setError('获取浏览历史失败');
      }
    } catch (err) {
      setError('网络请求失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory(1);
  }, []);

  const handleClear = async () => {
    setIsClearModalOpen(true);
  };

  const handleClearConfirm = async () => {
    setIsClearModalOpen(false);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) return;
      const user = JSON.parse(storedUser);
      const res = await api.clearBrowsingHistory(user.token);
      const data = await res.json();
      if (data.success) {
        showToast('浏览历史已清空', 'success');
        setHistory([]);
        setTotalPages(1);
      } else {
        showToast(data.error || '清空失败', 'error');
      }
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const handleDeleteItem = async (imageId: number) => {
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) {
        showToast('请先登录', 'error');
        return;
      }
      const user = JSON.parse(storedUser);
      if (!user.token) {
        showToast('登录已过期，请重新登录', 'error');
        return;
      }
      const res = await api.deleteBrowsingHistoryItem(user.token, imageId);
      const data = await res.json();
      if (data.success) {
        setHistory((prev) => prev.filter((item) => item.id !== imageId));
        showToast('已移除', 'success');
      } else {
        showToast(data.error || '删除失败', 'error');
      }
    } catch (err) {
      console.error('Delete history item error:', err);
      showToast('操作失败', 'error');
    }
  };

  if (isLoading && history.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">浏览历史</h1>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl animate-pulse">
              <div className="w-20 h-16 bg-slate-200 dark:bg-slate-700 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3" />
                <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="max-w-4xl mx-auto px-4 py-8 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          浏览历史
        </h1>
        {history.length > 0 && (
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition-colors"
          >
            <MdDeleteSweep size={18} />
            清空记录
          </button>
        )}
      </div>

      {error ? (
        <div className="text-center py-20 text-slate-500 dark:text-slate-400">
          <p>{error}</p>
          <button onClick={() => fetchHistory(page)} className="mt-4 text-primary hover:underline">重试</button>
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-20">
          <MdHistory size={48} className="mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <p className="text-slate-500 dark:text-slate-400 text-lg">暂无浏览记录</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-4 p-3 bg-white dark:bg-slate-800/50 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
              >
                <Link href={`/pic/${item.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-20 h-16 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700 flex-shrink-0">
                    {item.preview_url ? (
                      <FadeInImage src={item.preview_url} alt="" fill className="object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        <MdImage size={24} />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      #{item.id}
                      {item.uploader && (
                        <span className="text-xs text-slate-400 flex items-center gap-1">
                          <MdPerson size={12} />
                          {item.uploader}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {item.last_view_time
                        ? new Date(item.last_view_time).toLocaleString('zh-CN')
                        : '未知时间'}
                    </p>
                  </div>
                </Link>
                <button
                  onClick={() => handleDeleteItem(item.id)}
                  className="p-2 text-slate-400 hover:text-red-500 opacity-40 group-hover:opacity-100 transition-all"
                  title="移除此记录"
                  aria-label="删除浏览记录"
                >
                  <MdDelete size={18} />
                </button>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-8">
              <button
                onClick={() => fetchHistory(page - 1)}
                disabled={page === 1}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
              >
                上一页
              </button>
              <span className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => fetchHistory(page + 1)}
                disabled={page === totalPages}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>

      <Modal
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        title="清空浏览历史"
        footer={
          <>
            <button
              onClick={() => setIsClearModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleClearConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认清空
            </button>
          </>
        }
      >
        <p className="text-slate-600 dark:text-slate-300">
          确定要清空所有浏览历史吗？此操作不可撤销。
        </p>
      </Modal>
    </>
  );
}
