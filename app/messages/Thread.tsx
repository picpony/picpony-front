'use client';

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MdArrowDownward, MdErrorOutline, MdOutlineChatBubbleOutline } from 'react-icons/md';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import ChatBubble, { ChatRun, markRuns } from '@/components/ChatBubble';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import Spinner from '@/components/Spinner';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { formatClock, formatDate, formatDayLabel, formatDateTime, parseBackendTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { scrollAppToElement } from '@/lib/scrollTo';
import { cn } from '@/lib/utils';
import type { Message } from '@/lib/types/message';
import type { OutboxItem } from './outbox';
import { renderMessageBody } from './MessageBody';
import { breaksRun, dayKey, receiptPlacement } from './threadModel';

/** A row of the thread: a message the server has, or one still on its way out. */
export interface ThreadEntry {
  key: string;
  message: Message;
  outgoing?: OutboxItem;
}

interface ThreadProps {
  /** The conversation, oldest first — the server's messages then the outgoing ones. */
  entries: readonly ThreadEntry[];
  isOwn: (message: Message) => boolean;
  me: { name: string; avatar: string | null };
  contact: { name: string; avatar: string | null };
  /** The first read: nothing to show yet, or it failed with nothing to show. */
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  older: { hasMore: boolean; loading: boolean; error: unknown; load: () => void };
  onRetrySend: (item: OutboxItem) => void;
  onDiscardSend: (item: OutboxItem) => void;
  label: string;
}

/** Within this of the bottom counts as "at the bottom" — a thumb's slack. */
const BOTTOM_SLACK_PX = 80;

/**
 * The conversation's log.
 *
 * **It opens at the newest message** and never shows its top first: the scroll is put at the
 * bottom before the first paint of every conversation, including one read from the cache. It
 * used to land on the oldest messages and jump 200ms later.
 *
 * **New messages do not move a reader.** At the bottom (within a thumb's slack), the log stays
 * at the bottom as messages arrive — the poll, a picture finishing loading, the keyboard
 * opening, your own send. Scrolled up into the history, it stays where it is and offers 有新消息
 * instead, which takes you down. Your own message always brings you down to it.
 *
 * **What you are reading stays put.** The log positions itself rather than leaving it to the
 * engine's scroll anchoring (which Safari does not have, and which fought this code in Chrome):
 * the first row in view and its distance from the top are recorded on every scroll and every
 * change, and put back after any change above it — an older page arriving, a picture in an old
 * message finishing loading.
 *
 * **It is a log** (`role="log"`, polite): a message that arrives is announced, and the region is a
 * tab stop so the keyboard can scroll it.
 */
export default function Thread({
  entries,
  isOwn,
  me,
  contact,
  loading,
  error,
  onRetry,
  older,
  onRetrySend,
  onDiscardSend,
  label,
}: ThreadProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  /**
   * The log as of the last scroll or change — "before", for the next one: whether it was at
   * the bottom, the first row in view and its distance from the top, the two ends of the rows
   * and the newest message the other side had sent.
   */
  const metrics = useRef({
    atBottom: true,
    anchor: null as { key: string; delta: number } | null,
    first: '',
    last: '',
    newestIncoming: 0,
    positioned: false,
  });
  const [unseen, setUnseen] = useState(0);

  const serverMessages = entries.filter((entry) => !entry.outgoing).map((entry) => entry.message);
  const { readId, deliveredId } = receiptPlacement(serverMessages, isOwn);
  let newestIncoming = 0;
  for (const message of serverMessages) if (!isOwn(message)) newestIncoming = Math.max(newestIncoming, message.id);

  /** Where the reader is: at the bottom, or on which row. */
  const record = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const m = metrics.current;
    m.atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK_PX;
    m.anchor = null;
    for (const row of el.querySelectorAll<HTMLElement>('[data-entry-key]')) {
      if (row.offsetTop + row.offsetHeight > el.scrollTop) {
        m.anchor = { key: row.dataset.entryKey ?? '', delta: row.offsetTop - el.scrollTop };
        break;
      }
    }
  }, []);

  /** Back to where the reader was: the bottom, or the recorded row at its recorded distance. */
  const restore = useCallback((toBottom: boolean) => {
    const el = scrollerRef.current;
    if (!el) return;
    const { anchor } = metrics.current;
    if (toBottom) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    if (!anchor) return;
    const row = el.querySelector<HTMLElement>(`[data-entry-key="${CSS.escape(anchor.key)}"]`);
    if (row) el.scrollTop = row.offsetTop - anchor.delta;
  }, []);

  /* Placement, before paint, after every change of the rows. */
  const first = entries[0]?.key ?? '';
  const last = entries[entries.length - 1]?.key ?? '';
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const m = metrics.current;
    if (!entries.length) {
      m.positioned = false;
      m.first = '';
      m.last = '';
      m.newestIncoming = 0;
      return;
    }
    if (!m.positioned) {
      /* The conversation's first rows: straight to the newest, before anything is seen. */
      el.scrollTop = el.scrollHeight;
      m.positioned = true;
    } else {
      const newest = entries[entries.length - 1];
      const justSent = last !== m.last && newest.outgoing?.status === 'sending';
      restore(m.atBottom || justSent);
      if (!m.atBottom && !justSent && newestIncoming > m.newestIncoming) {
        const arrived = serverMessages.filter((message) => !isOwn(message) && message.id > m.newestIncoming).length;
        if (arrived > 0) setUnseen((count) => count + arrived);
      }
    }
    m.first = first;
    m.last = last;
    m.newestIncoming = newestIncoming;
    record();
    // `entries` is read for its ends and its newest incoming id; those are what this reacts to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first, last, newestIncoming, record, restore]);

  /* Content that changes size by itself (a picture decoding, the keyboard resizing the view)
     keeps the reader where they were: at the bottom, or on their row. */
  useLayoutEffect(() => {
    const content = contentRef.current;
    const el = scrollerRef.current;
    if (!content || !el) return;
    const observer = new ResizeObserver(() => {
      if (!metrics.current.positioned) return;
      restore(metrics.current.atBottom);
      record();
    });
    observer.observe(content);
    observer.observe(el);
    return () => observer.disconnect();
  }, [record, restore]);

  /* The top of the history: reaching it reads the page before. */
  const { hasMore, loading: loadingOlder, load } = older;
  const olderError = older.error !== undefined && older.error !== null;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const el = scrollerRef.current;
    if (!sentinel || !el || !hasMore || loadingOlder || olderError) return;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((entry) => entry.isIntersecting) && metrics.current.positioned) load();
      },
      { root: el, rootMargin: '240px 0px 0px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingOlder, olderError, load]);

  const onScroll = () => {
    record();
    if (metrics.current.atBottom && unseen) setUnseen(0);
  };

  const toBottom = () => {
    const el = scrollerRef.current;
    if (!el) return;
    /* The glide the rest of the app scrolls with (and the tiers that drop it): the end marker's
       top to the bottom edge of the view. */
    scrollAppToElement(endRef.current, { scroller: el, offset: el.clientHeight });
    setUnseen(0);
  };

  const runs = markRuns(
    entries,
    (entry) => (entry.outgoing || isOwn(entry.message) ? 'me' : 'them'),
    (a, b) => breaksRun(a.message, b.message),
  );
  const groups: { lead: ThreadEntry; items: typeof runs }[] = [];
  for (const run of runs) {
    if (run.startOfRun || groups.length === 0) groups.push({ lead: run.item, items: [] });
    groups[groups.length - 1].items.push(run);
  }

  const body = (() => {
    if (!entries.length && loading) return <ThreadSkeleton />;
    if (!entries.length && error) {
      return (
        <ErrorRetry
          size="pane"
          title="聊天记录加载失败"
          message={apiErrorMessage(error)}
          onRetry={isRetryable(error) ? onRetry : undefined}
        />
      );
    }
    if (!entries.length) {
      return (
        <EmptyState
          size="inline"
          icon={<MdOutlineChatBubbleOutline size={ICON.large} />}
          title="还没有消息，说点什么吧"
        />
      );
    }
    return groups.map(({ lead, items }, index) => {
      const own = Boolean(lead.outgoing) || isOwn(lead.message);
      const previous = index > 0 ? groups[index - 1].lead : null;
      const startsDay = !previous || dayKey(previous.message.created_at) !== dayKey(lead.message.created_at);
      const who = own ? me : contact;
      return (
        <Fragment key={lead.key}>
          {/* One date per day, where the conversation turns over. `role="separator"`: a break
              in the list, not an entry in it. */}
          {startsDay && (
            <div role="separator" className="text-label-s text-on-surface-variant my-3 flex items-center gap-3 first:mt-0">
              {/* Rules drawn as borders, which forced colors keeps, where a filled 1px box vanishes. */}
              <span className="border-outline-variant flex-1 border-t" />
              <span className="shrink-0">{now === null ? formatDate(lead.message.created_at) : formatDayLabel(lead.message.created_at, now, { clock: false })}</span>
              <span className="border-outline-variant flex-1 border-t" />
            </div>
          )}
          <ChatRun
            own={own}
            className="mb-3 last:mb-0"
            label={own ? '我' : contact.name}
            avatar={<Avatar src={who.avatar} name={who.name} size={32} />}
          >
            {items.map(({ item, startOfRun, endOfRun }) => {
              const { attachment, node } = renderMessageBody(item.message.content, own);
              const stamp = parseBackendTime(item.message.created_at);
              return (
                <div key={item.key} data-entry-key={item.key}>
                  <ChatBubble
                    own={own}
                    attachment={attachment}
                    startOfRun={startOfRun}
                    endOfRun={endOfRun}
                    timestamp={
                      endOfRun && !item.outgoing ? (
                        <time dateTime={stamp?.toISOString()} title={formatDateTime(item.message.created_at)}>
                          {formatClock(item.message.created_at)}
                        </time>
                      ) : undefined
                    }
                    status={deliveryStatus(item, {
                      read: !item.outgoing && item.message.id === readId,
                      delivered: !item.outgoing && item.message.id === deliveredId,
                      onRetry: onRetrySend,
                      onDiscard: onDiscardSend,
                    })}
                  >
                    {node}
                  </ChatBubble>
                </div>
              );
            })}
          </ChatRun>
        </Fragment>
      );
    });
  })();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollerRef}
        role="log"
        aria-label={label}
        aria-busy={loadingOlder || undefined}
        tabIndex={0}
        onScroll={onScroll}
        /* The engine's own scroll anchoring would fight the placement above (it shifts the
           view when rows land above, and so does this code); this log positions itself. */
        style={{ overflowAnchor: 'none' }}
        className="popover-scrollbar relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:focus-ring-inset"
      >
        <div ref={contentRef} className="flex min-h-full flex-col p-4">
          {entries.length > 0 && (hasMore || loadingOlder || olderError) && (
            <div ref={sentinelRef} className="flex h-10 shrink-0 items-center justify-center">
              {olderError ? (
                <Button variant="text" size="xs" icon={<MdErrorOutline />} onClick={load}>
                  更早的消息加载失败，点按重试
                </Button>
              ) : loadingOlder ? (
                <Spinner size="sm" label="正在加载更早的消息" />
              ) : null}
            </div>
          )}
          {/* The rows sit at the bottom of a short conversation, as a conversation does. */}
          <div className="mt-auto flex flex-col">{body}</div>
          <div ref={endRef} aria-hidden="true" />
        </div>
      </div>
      {unseen > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            variant="tonal"
            size="xs"
            icon={<MdArrowDownward />}
            onClick={toBottom}
            className="pointer-events-auto shadow-e2"
          >
            {unseen > 99 ? '99+ 条新消息' : `${unseen} 条新消息`}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The line under a message about where it is: 已读 / 已送达 for the two messages
 * `receiptPlacement` picks, and a message on its way out — sending, or failed with its two ways
 * out. `null` for every other message, so no empty line is drawn under it.
 */
function deliveryStatus(
  item: ThreadEntry,
  {
    read,
    delivered,
    onRetry,
    onDiscard,
  }: {
    read: boolean;
    delivered: boolean;
    onRetry: (item: OutboxItem) => void;
    onDiscard: (item: OutboxItem) => void;
  },
) {
  const outgoing = item.outgoing;
  if (outgoing?.status === 'sending') return <span>发送中…</span>;
  if (outgoing?.status === 'failed') {
    return (
      <span className="flex flex-wrap items-center gap-x-1 text-error">
        <MdErrorOutline size={ICON.dense} aria-hidden="true" />
        <span>发送失败</span>
        <Button variant="text" size="xs" onClick={() => onRetry(outgoing)}>
          重试
        </Button>
        <Button variant="danger-text" size="xs" onClick={() => onDiscard(outgoing)}>
          删除
        </Button>
      </span>
    );
  }
  if (read) return <span>已读</span>;
  if (delivered) return <span>已送达</span>;
  return null;
}

/**
 * A thread loads into a thread: runs of bubble-shaped bars, one portrait per turn, in the
 * geometry the conversation arrives in.
 *
 * No `data-page-loading` here, unlike the lists: the thread never sits in the page's flow — it
 * is a fixed-height frame beside the contacts, or the phone's full-height view outside the page
 * column — so its arrival cannot move the footer, and holding the footer back would only make
 * it blink when a conversation is opened.
 */
const THREAD_SKELETON_RUNS = [
  { own: false, widths: ['w-40', 'w-24'] },
  { own: true, widths: ['w-32'] },
  { own: false, widths: ['w-52'] },
  { own: true, widths: ['w-20'] },
] as const;

export function ThreadSkeleton() {
  return (
    <div className="flex flex-1 flex-col justify-end gap-3" aria-hidden="true">
      {THREAD_SKELETON_RUNS.map((run, i) => (
        <div key={i} className={cn('flex items-start gap-2', run.own ? 'flex-row-reverse' : 'flex-row')}>
          <SkeletonCircle size={32} delay={i * 80} />
          <div className={cn('flex flex-1 flex-col gap-0.5', run.own ? 'items-end' : 'items-start')}>
            {run.widths.map((width, j) => (
              <Skeleton key={width} className={cn('h-10 rounded-lg', width)} delay={i * 80 + 40 + j * 40} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
