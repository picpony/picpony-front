'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { MdHistory, MdDelete, MdDeleteSweep, MdImage, MdPerson } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import Button from '@/components/Button';
import Skeleton from '@/components/Skeleton';
import { useAuthModal } from '@/components/AuthModal';

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
  const { openAuth } = useAuthModal();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  const fetchHistory = useCallback(
    async (targetPage: number) => {
      setIsLoading(true);
      setError(null);
      try {
        const storedUser = localStorage.getItem('user_info');
        if (!storedUser) {
          openAuth('login');
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
      } catch {
        setError('网络请求失败');
      } finally {
        setIsLoading(false);
      }
    },
    [openAuth],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void fetchHistory(1);
    });
  }, [fetchHistory]);

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
        {' '}
        <h1 className="text-headline-s text-on-surface mb-6">浏览历史</h1>{' '}
        <div className="space-y-3">
          {' '}
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="m3-row flex gap-4 p-4 bg-surface-container-low">
              {' '}
              <Skeleton className="w-20 h-16 rounded-md flex-shrink-0" />{' '}
              <div className="flex-1 space-y-2">
                {' '}
                <Skeleton className="h-4 rounded w-1/3" />{' '}
                <Skeleton className="h-3 rounded w-1/4" />{' '}
              </div>{' '}
            </div>
          ))}{' '}
        </div>{' '}
      </div>
    );
  }
  return (
    <>
      {' '}
      <div className="max-w-4xl mx-auto px-4 py-8 animate-fade-in">
        {' '}
        <div className="flex items-center justify-between mb-6">
          {' '}
          <h1 className="text-headline-s text-on-surface flex items-center gap-2">
            {' '}
            浏览历史{' '}
          </h1>{' '}
          {history.length > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-2 px-4 py-2 text-label-l text-error hover:bg-error-container rounded-full transition-ui"
            >
              {' '}
              <MdDeleteSweep size={18} /> 清空记录{' '}
            </button>
          )}{' '}
        </div>{' '}
        {error ? (
          <div className="text-center py-20 text-on-surface-variant">
            {' '}
            <p>{error}</p>{' '}
            <button
              onClick={() => fetchHistory(page)}
              className="mt-4 text-primary hover:underline"
            >
              重试
            </button>{' '}
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-20">
            {' '}
            <MdHistory size={48} className="mx-auto text-outline mb-4" />{' '}
            <p className="text-on-surface-variant text-title-m">暂无浏览记录</p>{' '}
          </div>
        ) : (
          <>
            {' '}
            <div>
              {' '}
              {history.map((item) => (
                <div
                  key={item.id}
                  className="m3-row flex items-center gap-4 p-4 bg-surface-container-low transition-ui hover:bg-surface-container-high group"
                >
                  {' '}
                  <Link href={`/pic/${item.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                    {' '}
                    <div className="w-20 h-16 rounded-md overflow-hidden bg-surface-container-high flex-shrink-0">
                      {' '}
                      {item.preview_url ? (
                        <FadeInImage src={item.preview_url} alt="" fill className="object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-outline">
                          {' '}
                          <MdImage size={24} />{' '}
                        </div>
                      )}{' '}
                    </div>{' '}
                    <div className="flex-1 min-w-0">
                      {' '}
                      <p className=" text-on-surface flex items-center gap-2">
                        {' '}
                        #{item.id}{' '}
                        {item.uploader && (
                          <span className="text-body-s text-outline flex items-center gap-1">
                            {' '}
                            <MdPerson size={12} /> {item.uploader}{' '}
                          </span>
                        )}{' '}
                      </p>{' '}
                      <p className="text-body-s text-outline mt-1">
                        {' '}
                        {item.last_view_time
                          ? new Date(item.last_view_time).toLocaleString('zh-CN')
                          : '未知时间'}
                      </p>
                    </div>
                  </Link>
                  <button
                    onClick={() => handleDeleteItem(item.id)}
                    className="p-2 text-outline hover:text-error opacity-40 group-hover:opacity-100 transition-ui"
                    title="移除此记录"
                    aria-label="删除浏览记录"
                  >
                    <MdDelete size={18} />
                  </button>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={fetchHistory}
                className="mt-8"
              />
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
              className="px-4 py-2 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
            >
              取消
            </button>
            <Button variant="danger" onClick={handleClearConfirm}>
              确认清空
            </Button>
          </>
        }
      >
        <p className="text-on-surface-variant">确定要清空所有浏览历史吗？此操作不可撤销。</p>
      </Modal>
    </>
  );
}
