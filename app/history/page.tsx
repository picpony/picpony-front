'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MdCalendarToday, MdClose, MdDeleteOutline, MdDeleteSweep, MdHistory, MdImage, MdPerson } from 'react-icons/md';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import FadeInImage from '@/components/FadeInImage';
import IconButton from '@/components/IconButton';
import PageHeader from '@/components/PageHeader';
import PresenceBlock from '@/components/PresenceBlock';
import PresenceList from '@/components/PresenceList';
import Pagination from '@/components/Pagination';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
import { showToast } from '@/components/Toast';
import SectionHeading from '@/components/SectionHeading';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { clearBrowsingHistory, type HistoryEntry } from '@/lib/api/history';
import { prefetchImageDetail } from '@/lib/detail';
import { findDetailOriginLink, rememberDetailOrigin } from '@/lib/detailTransit';
import { focusLanding } from '@/lib/focusLanding';
import { openFromSequence, type ImageSequenceSource } from '@/lib/imageSequence';
import { useIntentPrefetch } from '@/lib/useIntentPrefetch';
import { formatClock, formatDate, formatDateTime, formatDayLabel } from '@/lib/format';
import { readToken, useNow, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { browsingHistory } from '@/lib/resources';
import { useScreenState } from '@/lib/screenState';
import { todayOnBeijingCalendar } from '@/lib/settingsSync';
import { clamp, cn } from '@/lib/utils';
import { settle } from '@/lib/settle';
import { byDay } from './days';
import { useHistoryDeletes } from './useHistoryDeletes';
import { useHistorySequence } from './useHistorySequence';

/** The backend's page, so the placeholder is the list's own length. */
const PAGE_SIZE = 20;

const ROW = 'm3-row group relative bg-surface-container-low';

function HistorySkeleton() {
  return (
    <div data-page-loading aria-hidden="true">
      <Skeleton className="mb-2 ml-1 h-5 w-12" />
      <div>
        {Array.from({ length: PAGE_SIZE }, (_, i) => (
          <div key={i} className="m3-row flex items-center gap-4 bg-surface-container-low p-4">
            <Skeleton className="size-14 shrink-0 rounded-sm" delay={Math.min(i, 8) * 70} />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-24" delay={Math.min(i, 8) * 70 + 40} />
              <Skeleton className="h-3 w-12" delay={Math.min(i, 8) * 70 + 80} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryRow({ entry, presenceKey, sequence, onDelete }: {
  entry: HistoryEntry;
  presenceKey: string;
  /** The list 上一张 / 下一张 walk once this row opens its picture (`useHistorySequence`). */
  sequence: ImageSequenceSource | undefined;
  onDelete: (entry: HistoryEntry) => void;
}) {
  /* The picture's record on the intent ladder, so the detail usually opens complete rather than
     on its skeleton — the same ladder, and the same background priority, as a gallery card's. */
  const intent = useIntentPrefetch(() => {
    /* A warm that fails is the detail's own read to retry; nothing here waits on it. */
    prefetchImageDetail(entry.id, { priority: 'background' }).catch(() => {});
  });
  return (
    /* `data-detail-origin`: the row is what the picture grows out of and shrinks back into — a
       history row has no shared picture to fly (its thumbnail is a 56px crop of a picture of
       unknown shape), so it takes the forum's container transform (`lib/detailTransit.ts`). */
    <div role="listitem" className={ROW} data-detail-origin={entry.id} data-presence-key={presenceKey}>
      {/* The row is one control (R5-026): the link fills it, so its state layer and its target
          are the same box. The delete is a sibling laid over the row's trailing edge — never a
          control inside the link — revealed by hover under a pointer and always there under a
          finger. The ring is inset: a grouped list's seams would clip an outset one. */}
      <Link
        scroll={false}
        href={`/pic/${entry.id}`}
        {...intent}
        onClick={(event) => {
          if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
            /* The list first, then the origin — both synchronously, before the link navigates:
               the viewer's 上一张 / 下一张 walk this list, and the overlay grows out of this row.
               A modified click opens a new tab and leaves this one's list alone. */
            if (sequence) openFromSequence(sequence);
            rememberDetailOrigin(entry.id);
          }
        }}
        className="flex items-center gap-4 rounded-[inherit] p-4 pr-16 transition-ui state-layer focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset"
      >
        <span className="relative size-14 shrink-0 overflow-hidden rounded-sm bg-surface-container-high">
          {entry.previewUrl ? (
            /* The box is 56px; without `sizes`, `fill` resolves to the viewport's width. */
            <FadeInImage src={entry.previewUrl} alt="" fill sizes="56px" className="object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-on-surface-variant">
              <MdImage size={ICON.standard} aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-label-l text-on-surface">#{entry.id}</span>
            {entry.uploader && (
              <span className="flex min-w-0 max-w-full items-center gap-1 text-body-s text-on-surface-variant">
                <MdPerson size={ICON.dense} className="shrink-0" aria-hidden="true" />
                <span className="truncate" title={entry.uploader}>
                  {entry.uploader}
                </span>
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-body-s tabular-nums text-on-surface-variant">
            {entry.viewedAt ? (
              <time dateTime={entry.viewedAt} title={formatDateTime(entry.viewedAt)}>
                {formatClock(entry.viewedAt)}
              </time>
            ) : (
              '时间未知'
            )}
          </span>
        </span>
      </Link>
      {/* The in-list delete every list wears (D1-012): the outlined glyph, in the error ink once
          its row is hovered or it has the keyboard — neutral at rest, so a column of rows under a
          finger is not a column of red bins (OD-5, `danger-quiet`). */}
      <IconButton
        size="sm"
        variant="danger-quiet"
        icon={<MdDeleteOutline />}
        onClick={() => onDelete(entry)}
        /* Named per row: a page of buttons all called 删除 tells a screen reader nothing. */
        aria-label={`删除浏览记录 #${entry.id}`}
        className="hover-reveal absolute right-3 top-1/2 -translate-y-1/2"
      />
    </div>
  );
}

/**
 * 按日期筛选 (D1-021): a field-toolbar button that opens the browser's own date picker. The date
 * field it replaces showed the engine's mask while empty — 「yyyy/mm/日」, half Latin — as the
 * header's loudest text. The field is still there, unseen and out of the tab order, under the
 * button's leading edge, so the picker opens where the button is; once a day is chosen the button
 * names it as the list's day headings do, and a cross beside it clears it.
 */
function DateFilter({ value, max, now, onChange }: {
  value: string;
  max: string | undefined;
  now: number | null;
  onChange: (next: string) => void;
}) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const open = () => {
    const field = fieldRef.current;
    if (!field) return;
    try {
      field.showPicker();
    } catch {
      /* An engine without the picker call: a date field opens its own picker when focused and
         pressed, which is what the button stood in for. */
      field.focus();
      field.click();
    }
  };
  const label = value ? (now !== null ? formatDayLabel(value, now, { clock: false }) : formatDate(value)) : '按日期筛选';
  return (
    <div className="relative flex items-center gap-1">
      <Button variant="surface" icon={<MdCalendarToday />} onClick={open} aria-label={value ? `按日期筛选：${label}` : undefined}>
        {label}
      </Button>
      <input
        ref={fieldRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0"
      />
      {value && <IconButton dismiss aria-label="清除日期筛选" icon={<MdClose />} onClick={() => onChange('')} />}
    </div>
  );
}

export default function HistoryPage() {
  const { token, ready } = useSession();
  /* Both survive a remount: leaving page 3 of one day for a picture lands back on it. */
  const [page, setPage] = useScreenState('history:page', 1);
  const [date, setDate] = useScreenState<string>('history:date', '');
  const { confirm, confirmDialog } = useConfirm();
  const [clearing, setClearing] = useState(false);
  const now = useNow();

  const view = useMemo(() => ({ page, date: date || null }), [page, date]);
  const read = useResource(browsingHistory, token ? { token, ...view } : SKIP, {
    keepPrevious: token ? `${token}:${date}` : false,
  });

  /* Where a removal's focus goes when no row is left beside it: the empty state that replaces the
     list (it arrives in the same commit), else the page's heading. Asked at the moment of need. */
  const rootRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const landing = useCallback(
    () => emptyRef.current?.querySelector<HTMLElement>('h2') ?? rootRef.current?.querySelector<HTMLElement>('h1') ?? null,
    [],
  );
  /* 撤销 is pressed in the toast, which then leaves with the focus: the commit that brings the rows
     back hands it to the first of them — in that commit, before a frame can show it on the document
     (under 关闭 the toast is gone in the same commit) — unless the focus has gone somewhere of the
     user's own meanwhile. */
  const restored = useRef<{ ids: number[]; pressed: Element | null } | null>(null);
  const restoreFocus = useCallback((ids: number[], pressed: Element | null) => {
    restored.current = { ids, pressed };
  }, []);
  const deletes = useHistoryDeletes(token, view, restoreFocus);
  useLayoutEffect(() => {
    const pending = restored.current;
    if (!pending) return;
    restored.current = null;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && active.isConnected && active !== pending.pressed) return;
    for (const id of pending.ids) {
      const link = findDetailOriginLink(id);
      if (link) {
        link.focus({ preventScroll: true });
        return;
      }
    }
  }, [deletes.hidden]);

  const data = read.data;
  const entries = useMemo(
    () => (data?.entries ?? []).filter((entry) => !deletes.hidden.has(entry.id)),
    [data, deletes.hidden],
  );
  const totalPages = data?.totalPages ?? 1;
  const firstLoad = Boolean(token) && data === undefined && read.error === undefined;
  const showEmpty = data !== undefined && entries.length === 0 && !read.isPrevious;
  /* Rows were on this screen: an empty state that follows them is a pane swap, not an entrance. */
  const [hadRows, setHadRows] = useState(false);
  if (!hadRows && entries.length > 0) setHadRows(true);

  /* 清空记录 empties the list and disables itself in one commit, so the button that had the focus
     can no longer hold it: the commit that shows the empty state lands the focus there — unless it
     has gone somewhere of the user's own. Keyed on the empty state arriving, not on the press: the
     cleared answer is published on a paint boundary, a frame after the handler's own updates. */
  const clearedRef = useRef(false);
  useLayoutEffect(() => {
    if (!clearedRef.current || !showEmpty) return;
    clearedRef.current = false;
    const active = document.activeElement;
    const lost = !(active instanceof HTMLElement) || active === document.body || !active.isConnected ||
      Boolean(active.closest('[inert]')) || active.matches(':disabled');
    const target = lost ? landing() : null;
    if (target) focusLanding(target);
  }, [showEmpty, data, landing]);

  /* The page the rows on screen belong to: while a turn is in flight the rows are the previous
     page's (`keepPrevious`), and 上一张 / 下一张 must walk the page they show. */
  const [dataPage, setDataPage] = useState(page);
  if (data !== undefined && !read.isPrevious && dataPage !== page) setDataPage(page);

  /* The list the viewer walks, and the list a close turns back to (G4-004). */
  const sequence = useHistorySequence({
    token,
    date,
    page,
    setPage,
    dataPage,
    entries,
    totalPages,
    pageSize: PAGE_SIZE,
    hidden: deletes.hidden,
  });

  /* A page emptied from under the viewer — its last rows deleted, or the list shortened
     elsewhere — steps back to the page before it, with a pager that says so (R5-027). Only on a
     settled answer for this very page. */
  useEffect(() => {
    if (!data || read.isPrevious || read.isLoading || data.entries.length > 0 || page <= 1) return;
    setPage(clamp(page - 1, 1, data.totalPages));
  }, [data, read.isPrevious, read.isLoading, page, setPage]);

  const changeDate = (next: string) => {
    setDate(next);
    setPage(1);
  };

  const handleClear = async () => {
    if (!token || readToken() !== token || clearing) return;
    if (!(await confirm({
      title: '确认清空',
      message: '确定要清空所有浏览历史吗？清空后无法恢复。',
      tone: 'danger',
    }))) return;
    if (readToken() !== token) return;
    setClearing(true);
    const cleared = await settle(clearBrowsingHistory(token));
    if (readToken() === token) {
      if (cleared.ok) {
        deletes.forget();
        /* Drop every cached page, then publish the authoritative empty answer for the page now
           shown, so keepPrevious cannot hold the old rows over it. */
        browsingHistory.invalidate();
        const empty = { entries: [], totalPages: 1 };
        browsingHistory.write({ token, page: 1, date: null }, empty);
        browsingHistory.write({ token, ...view }, empty);
        setPage(1);
        setDate('');
        clearedRef.current = true;
        showToast('已清空浏览历史', 'success');
      } else {
        showToast(apiErrorMessage(cleared.error, '清空失败'), 'error');
      }
    }
    setClearing(false);
  };

  const today = now !== null ? todayOnBeijingCalendar(now) : undefined;
  /* Offered once there is a history to narrow: never over an empty one, but kept while a chosen
     day is empty, so the day can be changed or cleared. */
  const filter = token && data && (date || data.entries.length > 0 || page > 1) && (
    <DateFilter value={date} max={today} now={now} onChange={changeDate} />
  );

  const header = (
    <PageHeader
      title="浏览历史"
      actions={
        token ? (
          <>
            {filter}
            <Button
              variant="danger-text"
              onClick={() => void handleClear()}
              loading={clearing}
              disabled={!data || (data.entries.length === 0 && page === 1 && !date)}
              icon={<MdDeleteSweep />}
              responsiveLabel
            >
              清空记录
            </Button>
          </>
        ) : undefined
      }
    />
  );

  let body;
  if (!ready || firstLoad) {
    body = <HistorySkeleton />;
  } else if (!token) {
    body = <SignInRequired description="登录后即可在任意设备上查看看过的图片。" />;
  } else if (!data) {
    body = (
      <ErrorRetry
        title="浏览历史加载失败"
        message={apiErrorMessage(read.error)}
        onRetry={isRetryable(read.error) ? read.refresh : undefined}
      />
    );
  } else {
    /* After rows, the empty state comes in on the pane swap's keyframe rather than its own
       entrance, which hides the heading during its stagger — and the heading is where a removal
       with no row left sends the focus (`landing`). */
    const empty = date ? (
      <EmptyState
        entrance={!hadRows}
        icon={<MdHistory size={ICON.display} />}
        title="这一天没有浏览记录"
        description="换一天，或清除日期筛选查看全部。"
        action={<Button variant="tonal" onClick={() => changeDate('')}>清除筛选</Button>}
      />
    ) : page > 1 ? (
      /* Its rows deleted, with 撤销 still on offer: the history is not empty, and the pager stays. */
      <EmptyState entrance={!hadRows} icon={<MdHistory size={ICON.display} />} title="这一页没有浏览记录" />
    ) : (
      <EmptyState
        entrance={!hadRows}
        icon={<MdHistory size={ICON.display} />}
        title="暂无浏览记录"
        description="看过的图片会出现在这里。"
      />
    );
    body = (
      /* The anchor wraps the list *and* its pager: `Pagination` finds it with `closest()`. */
      <div data-pagination-anchor>
        {read.isPrevious && read.error !== undefined && (
          <ErrorRetry
            size="inline"
            title="这一页加载失败"
            message={apiErrorMessage(read.error)}
            onRetry={isRetryable(read.error) ? read.refresh : undefined}
          />
        )}
        {/* A deleted row fades where it was while the rows and days under it close the gap, and
            撤销 opens it again (`PresenceList`); a page or a date replaces the list outright.
            `gap`, not `space-y`: a leaving day is taken out of the flow, and a sibling margin
            would keep its space until it was gone. A removal's focus goes to the row now in its
            place, else the one before it — across a day that leaves — else to `landing`. */}
        <PresenceList items={byDay(entries, now)} getKey={(day) => day.key} resetKey={data} fallbackFocus={landing}>
          {(days, ref) => (
            /* Positioned for the empty state, which leaves where it stood as a row comes back. */
            <div className="relative">
              <div
                ref={ref}
                className={cn(
                  'flex flex-col gap-6 transition-opacity duration-standard ease-[var(--ease-standard)]',
                  /* The paging dim over a list whose next page is on its way: one value, everywhere. */
                  read.isPrevious && read.isLoading ? 'pointer-events-none opacity-50' : 'opacity-100',
                )}
                aria-busy={read.isLoading || undefined}
              >
                {days.map(({ item: day, key }) => (
                  <div key={key} data-presence-key={key}>
                    <SectionHeading level="group" id={`history-day-${key}`}>
                      {day.label}
                    </SectionHeading>
                    <PresenceList items={day.entries} getKey={(entry) => entry.id} resetKey={data}>
                      {(rows, listRef) => (
                        <div ref={listRef} role="list" aria-labelledby={`history-day-${key}`}>
                          {rows.map(({ item: entry, key: rowKey }) => (
                            <HistoryRow
                              key={rowKey}
                              presenceKey={rowKey}
                              entry={entry}
                              sequence={sequence}
                              onDelete={deletes.remove}
                            />
                          ))}
                        </div>
                      )}
                    </PresenceList>
                  </div>
                ))}
              </div>
              {/* The last row fades where it stood while the empty state comes in; 撤销 takes it back
                  out, and a focus on its heading goes on to the rows that returned. */}
              <PresenceBlock
                show={showEmpty}
                fallbackFocus={() => rootRef.current?.querySelector<HTMLElement>('[data-detail-origin] a[href]') ?? null}
              >
                <div ref={emptyRef} className={cn(hadRows && 'animate-page-transition')}>
                  {empty}
                </div>
              </PresenceBlock>
            </div>
          )}
        </PresenceList>
        {totalPages > 1 && (
          <Pagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={setPage}
            onPrefetchPage={(next) => token && browsingHistory.prefetch({ token, page: next, date: date || null })}
            className="mt-8"
          />
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="mx-auto max-w-4xl">
      {header}
      {body}
      {confirmDialog}
    </div>
  );
}
