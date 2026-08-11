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
import IconButton from '@/components/IconButton';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { useAuthModal } from '@/components/AuthModal';
import PageHeader from '@/components/PageHeader';

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
      <div className="max-w-4xl mx-auto">
        {' '}
        <PageHeader title="浏览历史" />{' '}
        <div className="space-y-3">
          {' '}
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="m3-row flex gap-4 p-4 bg-surface-container-low">
              {' '}
              <Skeleton className="w-20 h-16 rounded-md shrink-0" />{' '}
              <div className="flex-1 space-y-2">
                {' '}
                <Skeleton className="h-4 w-1/3" />{' '}
                <Skeleton className="h-3 w-1/4" />{' '}
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
      <div className="max-w-4xl mx-auto">
        {' '}
        <PageHeader
          title="浏览历史"
          actions={
            history.length > 0 ? (
              <Button
                variant="danger-text"
                onClick={handleClear}
                icon={<MdDeleteSweep size={18} />}
                responsiveLabel
              >
                清空记录
              </Button>
            ) : undefined
          }
        />
        {error ? (
          <ErrorRetry message={error} onRetry={() => fetchHistory(page)} />
        ) : history.length === 0 ? (
          <EmptyState
            icon={<MdHistory size={48} />}
            title="暂无浏览记录"
            description="看过的图片会出现在这里。"
          />
        ) : (
          <>
            {' '}
            <div>
              {' '}
              {history.map((item) => (
                <div
                  key={item.id}
                  className="m3-row flex items-center gap-4 p-4 bg-surface-container-low transition-ui state-layer group"
                >
                  {' '}
                  <Link href={`/pic/${item.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                    {' '}
                    <div className="w-20 h-16 rounded-md overflow-hidden bg-surface-container-high shrink-0">
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
                      <p className="text-body-m text-on-surface flex items-center gap-2">
                        {' '}
                        #{item.id}{' '}
                        {item.uploader && (
                          <span className="text-body-s text-on-surface-variant flex items-center gap-1">
                            {' '}
                            <MdPerson size={12} /> {item.uploader}{' '}
                          </span>
                        )}{' '}
                      </p>{' '}
                      <p className="text-body-s text-on-surface-variant mt-1">
                        {' '}
                        {item.last_view_time
                          ? new Date(item.last_view_time).toLocaleString('zh-CN')
                          : '未知时间'}
                      </p>
                    </div>
                  </Link>
                  {/* `IconButton`, not a hand-rolled padded box around a glyph.
                      Three faults compounded: a 40% opacity until `group-hover`
                      meant that on a touch device — where there is no hover —
                      the only way to remove a record sat permanently at 40%,
                      compositing `outline` down to roughly 1.5:1, under even the
                      3:1 bar for a non-text control; the 34px box was under the
                      44px touch rule; and it had no focus ring. Visible by
                      default, hover-revealed from `sm` up, which is the rule the
                      gallery tiles and the detail zoom already follow. */}
                  <IconButton
                    onClick={() => handleDeleteItem(item.id)}
                    icon={<MdDelete size={18} />}
                    size="sm"
                    title="移除此记录"
                    aria-label="删除浏览记录"
                    className="text-on-surface-variant hover:text-error opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                  />
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
            <Button variant="text" onClick={() => setIsClearModalOpen(false)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleClearConfirm}>
              确认清空
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant">确定要清空所有浏览历史吗？此操作不可撤销。</p>
      </Modal>
    </>
  );
}
