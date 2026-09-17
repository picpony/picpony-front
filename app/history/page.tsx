'use client';

import { useEffect } from 'react';
import { SKIP, useResource } from '@/lib/resource';
import { useScreenState } from '@/lib/screenState';
import { browsingHistory } from '@/lib/resources';
import Link from 'next/link';
import { MdHistory, MdDelete, MdDeleteSweep, MdImage, MdPerson } from 'react-icons/md';
import FadeInImage from '@/components/FadeInImage';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import Pagination from '@/components/Pagination';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { useAuthModal } from '@/components/AuthModal';
import PageHeader from '@/components/PageHeader';
import { ICON } from '@/lib/icons';
import { formatDateTime } from '@/lib/format';
import { readToken, useSession } from '@/lib/hooks';

export default function HistoryPage() {
  const { openAuth } = useAuthModal();
  const { token, ready } = useSession();
  /* The page number survives a remount: leaving page 3 for a picture and coming back
     lands on page 3 — see `lib/screenState.ts`. */
  const [page, setPage] = useScreenState('history:page', 1);
  const { confirm, confirmDialog } = useConfirm();

  const read = useResource(browsingHistory, token ? { token, page } : SKIP, { keepPrevious: true });
  const history = read.data?.history ?? [];
  const totalPages = read.data?.totalPages ?? 1;
  const isLoading = !ready || (Boolean(token) && read.data === undefined && read.error === undefined);
  const error = read.error instanceof Error ? read.error.message : read.error ? '网络请求失败' : null;

  useEffect(() => {
    if (ready && !token) openAuth('login');
  }, [token, ready, openAuth]);

  const handleClear = async () => {
    if (!token || readToken() !== token) return;
    if (!(await confirm({
      title: '确认清空',
      message: '确定要清空所有浏览历史吗？此操作不可撤销。',
      confirmLabel: '确认清空',
    }))) return;
    if (readToken() !== token) return;
    try {
      const res = await api.clearBrowsingHistory(token);
      const data = await res.json();
      if (readToken() !== token) return;
      if (data.success) {
        showToast('浏览历史已清空', 'success');
        /* Drop every cached page, then publish the mutation's authoritative empty answer.
           Page 1 may already be selected, so changing the page alone cannot re-run the read.
           The current page also needs the empty answer before keepPrevious can retain it. */
        browsingHistory.invalidate();
        const empty = { history: [], totalPages: 1 };
        browsingHistory.write({ token, page }, empty);
        if (page !== 1) browsingHistory.write({ token, page: 1 }, empty);
        setPage(1);
      } else {
        showToast(data.error || '清空失败', 'error');
      }
    } catch {
      if (readToken() === token) showToast('操作失败', 'error');
    }
  };

  const handleDeleteItem = async (imageId: number) => {
    if (!token) {
      showToast('请先登录', 'error');
      return;
    }
    if (readToken() !== token) return;
    try {
      const res = await api.deleteBrowsingHistoryItem(token, imageId);
      const data = await res.json();
      if (readToken() !== token) return;
      if (data.success) {
        /* Written through rather than re-read: the row is gone from the server and the
           screen should say so in the same frame — a refetch would blank the list and
           bring back an identical one a round trip later. The write leaves the entry's
           age alone, so the next revalidation still confirms it (see `resource.write`). */
        browsingHistory.write({ token, page }, (previous) => ({
          history: (previous?.history ?? []).filter((item) => item.id !== imageId),
          totalPages: previous?.totalPages ?? 1,
        }));
        showToast('已删除', 'success');
      } else {
        showToast(data.error || '删除失败', 'error');
      }
    } catch (err) {
      if (readToken() !== token) return;
      console.error('Delete history item error:', err);
      showToast('操作失败', 'error');
    }
  };
  if (isLoading && history.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        {' '}
        <PageHeader title="浏览历史" />
        {/* No `space-y-3`: `.m3-row` already puts 2px seams between rows
            (`ListTokens.SegmentedGap`), so this added 12px more and the list re-spaced
            per row when data landed. `items-center` matches the real row, which centres
            its text column against the 64px thumbnail. */}
        <div>
          {' '}
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="m3-row flex items-center gap-4 p-4 bg-surface-container-low">
              
              <Skeleton className="size-14 rounded-sm shrink-0" />
              <div className="flex-1 space-y-2">
                
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/4" />
              </div>
            </div>
          ))}{' '}
        </div>
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
                icon={<MdDeleteSweep />}
                responsiveLabel
              >
                清空记录
              </Button>
            ) : undefined
          }
        />
        {error ? (
          <ErrorRetry message={error} onRetry={read.refresh} />
        ) : history.length === 0 ? (
          <EmptyState
            icon={<MdHistory size={ICON.display} />}
            title="暂无浏览记录"
            description="看过的图片会出现在这里。"
          />
        ) : (
          /* The anchor wraps the list *and* its pager: `Pagination` finds it with
             `closest()`, so on the list alone no pager can see it. Its top edge is still
             the first row rather than the page header, which is the point. */
          <div data-pagination-anchor>
            <div>
              {' '}
              {history.map((item) => (
                <div
                  key={item.id}
                  className="m3-row flex items-center gap-4 p-4 bg-surface-container-low transition-ui state-layer group"
                >
                  
                  <Link scroll={false} href={`/pic/${item.id}`} className="flex items-center gap-4 flex-1 min-w-0">
                    
                    <div className="size-14 rounded-sm overflow-hidden bg-surface-container-high shrink-0">
                      {' '}
                      {item.preview_url ? (
                        <FadeInImage
                          src={item.preview_url}
                          alt=""
                          fill
                          /* The box is 56px (`size-14`). Without this, `fill` resolves to
                             `100vw` — every row downloaded a full-viewport-width variant to
                             paint a 56px thumbnail. */
                          sizes="56px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-outline">
                          
                          <MdImage size={ICON.standard} />
                        </div>
                      )}{' '}
                    </div>
                    <div className="flex-1 min-w-0">
                      
                      <p className="text-body-m text-on-surface flex flex-wrap items-center gap-x-2 gap-y-1">
                        
                        #{item.id}
                        {item.uploader && (
                          <span className="text-body-s text-on-surface-variant flex min-w-0 max-w-full items-center gap-1">
                            
                            <MdPerson size={ICON.dense} className="shrink-0" />
                            <span className="truncate" title={item.uploader}>{item.uploader}</span>
                          </span>
                        )}
                      </p>
                      <p className="text-body-s text-on-surface-variant mt-1">
                        {' '}
                        {item.last_view_time
                          ? formatDateTime(item.last_view_time)
                          : '未知时间'}
                      </p>
                    </div>
                  </Link>
                  {/* `IconButton`, not a hand-rolled padded box around a glyph. Three
                      faults compounded: a 40% opacity until `group-hover` meant that on a
                      touch device the only way to remove a record sat permanently at 40%
                      (`outline` composites to roughly 1.5:1 there, under the 3:1 bar for a
                      non-text control); the 34px box was under the 44px touch rule; and it
                      had no focus ring. Visible on touch, hover-revealed on desktop —
                      the rule the gallery tiles and detail zoom already follow. */}
                  <IconButton
                    onClick={() => handleDeleteItem(item.id)}
                    icon={<MdDelete size={ICON.dense} />}
                    size="sm"
                    /* Named per row, not once for the list: every button here read
                       `删除浏览记录`, so arrowing down a page announced the same string
                       with nothing to tell them apart. */
                    aria-label={`删除浏览记录 #${item.id}`}
                    className="hover-reveal text-on-surface-variant hover:text-error"
                  />
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
                onPrefetchPage={(next) =>
                  token && browsingHistory.prefetch({ token, page: next })
                }
                className="mt-8"
              />
            )}
          </div>
        )}
      </div>
      {confirmDialog}
    </>
  );
}
