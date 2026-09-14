'use client';

import dynamic from 'next/dynamic';

import { Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, Announcement, Notification } from '@/lib/api';
import { SKIP, useResource } from '@/lib/resource';
import { unreadCounts as unreadCountsResource } from '@/lib/resources';
import {
  MdOutlineChatBubbleOutline,
  MdOutlineEmojiEmotions,
  MdRefresh,
  MdArrowBack,
  MdSearch,
  MdSend,
  MdCampaign,
  MdNotificationsNone,
  MdSearchOff,
  MdErrorOutline,
  MdChevronLeft,
  MdChevronRight,
} from 'react-icons/md';
import { getEmojis } from '@/app/actions/getEmojis';
import Tabs from '@/components/Tabs';
import PageHeader from '@/components/PageHeader';
import { showToast } from '@/components/Toast';
import { ICON } from '@/lib/icons';

import { Contact, Message } from '@/lib/api';
import Image from 'next/image';
import RichTextRenderer from '@/components/RichTextRenderer';
import Pagination from '@/components/Pagination';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import IconButton from '@/components/IconButton';
import { Input, Textarea } from '@/components/Input';
import Avatar from '@/components/Avatar';
import Badge, { CountBadge } from '@/components/Badge';
import ChatBubble, { ChatRun, markRuns } from '@/components/ChatBubble';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
/**
 * The emoji sheet is the phone-only half of this picker and this screen's only path to
 * `lib/motion`, which registers GSAP and five plugins at module scope — it is already
 * gated on `!isWide`, so a desktop session never renders it, but a static import loaded
 * the engine anyway.
 *
 * `dynamic()` plus a one-way latch (same pair `AuthModal` uses for its captcha): the
 * chunk arrives on the first tap of 表情 and the element stays mounted, which is what
 * `Sheet`'s exit animation needs — it drives its own open position through GSAP, so
 * without it there is no sheet at all.
 */
const Sheet = dynamic(() => import('@/components/Sheet'), { ssr: false });
import TabPanes, { TabPane } from '@/components/TabPanes';
import { readSnapshot, writeSnapshot } from '@/lib/pageCache';
import { readToken, useEscapeBack, useMediaQuery, useSession } from '@/lib/hooks';
import { MEDIA } from '@/lib/constants';
import { cn } from '@/lib/utils';
import Popover from '@/components/Popover';

type MessagesTab = 'announcement' | 'notification' | 'interaction' | 'chat';

/** What one tab knows about its own request. See `paneState`. */
type PaneState = { loading: boolean; error: string | null };

/**
 * What is worth keeping when this page unmounts.
 *
 * Leaving for the gallery and coming back used to replay the whole first load — four
 * skeleton cards, then a 1600px jump as the real list arrived, *while the route slide
 * was still moving*.
 *
 * `tab` is in here for the same reason the gallery's page number is: coming back to a
 * different tab than the one you left is a refresh, whatever the network did. Dropped
 * wholesale on sign-out — see `clearSnapshots`.
 */
interface MessagesSnapshot {
  tab: MessagesTab;
  announcements: Announcement[];
  notifications: Notification[];
  interactions: Notification[];
  interactionsPage: number;
  interactionsTotalPages: number;
  contacts: Contact[];
}

type RequestKind = MessagesTab | 'thread' | 'send' | 'target' | 'emoji';

/**
 * The 系统 and 互动 tabs, which were ~50 lines of identical markup each — a change to
 * one silently left the other behind.
 *
 * A component rather than a function called during render. Not a style preference: the
 * retry callbacks close over `useCallback`s that read a ref (`shown`), and React's lint
 * rule cannot prove a callback handed to a plain function call is only invoked later,
 * whereas it can for a JSX prop. Making it a component states the truth — these are
 * props, not a render-time computation.
 */
function NotificationPane({
  items,
  loading,
  error,
  onRetry,
  emptyTitle,
  children,
}: {
  items: Notification[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  emptyTitle: string;
  /** Pagination, if the list has any. */
  children?: React.ReactNode;
}) {
  if (loading) {
    return <MessageRowsSkeleton />;
  }
  if (error) {
    return <ErrorRetry size="pane" title="消息加载失败" message={error} onRetry={onRetry} />;
  }
  if (items.length === 0) {
    return <EmptyState size="pane" icon={<MdNotificationsNone size={ICON.display} />} title={emptyTitle} />;
  }
  return (
    <div data-pagination-anchor>
      {items.map((item) => (
        <div
          key={item.id}
          /* Unread is carried by the row's own container pair, and by nothing else. It has
             been three things: a `primary` wash at 5% (nearly invisible over the dark
             surface), then a tone step plus a 4px leading bar — which said the same thing
             twice, and a leading rule is a *quote* mark in this app, not an unread flag.
             `secondary-container` is the pair this app already means "this one" with
             (sidebar route, selected chip, selected contact); secondary is two steps off
             the brand hue, so twenty unread rows still read as a list. */
          className={cn(
            /* `p-4`, the row padding every other list in the app uses. It read 20px — on
               the 4dp grid and on no rhythm, making these the tallest list rows in the app
               (~95px against /history's 66). (Spelled as a figure rather than the class it
               was: the extractor lifts a class name out of a comment and would keep the
               dead rule in the bundle.) */
            'm3-row p-4 transition-ui',
            item.is_read === 0
              ? 'bg-secondary-container text-on-secondary-container'
              : 'bg-surface-container-low text-on-surface-variant',
          )}
        >
          <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            {/* No ink role on the heading or the body: they inherit the row's, which is
                `on-secondary-container` while unread and `on-surface-variant` once read.
                Naming a surface role here would paint surface ink on a container
                background in one of the two states. */}
            <h3 className="text-title-m-emphasized min-w-0">
              {item.is_read === 0 && <span className="sr-only">未读：</span>}
              {item.title}
            </h3>
            <time className="text-body-s shrink-0 tabular-nums">{item.created_at}</time>
          </div>
          <div className="text-body-m">{item.content}</div>
        </div>
      ))}
      {children}
    </div>
  );
}

/** Three grouped rows, the shape every list on this page loads into. */
function MessageRowsSkeleton() {
  return (
    <div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="m3-row flex flex-col gap-2 bg-surface-container-low p-4">
          <Skeleton className="h-4 w-1/3" delay={i * 80} />
          <Skeleton className="h-3.5 w-full" delay={i * 80 + 60} />
          <Skeleton className="h-3.5 w-3/4" delay={i * 80 + 120} />
        </div>
      ))}
    </div>
  );
}

/**
 * A thread loads into a thread, not into a spinner — the last `<Spinner size="lg" />`
 * standing in for a screen's content. Alternating bubble-shaped bars say "a conversation
 * is arriving here", in the geometry it will arrive in.
 *
 * The geometry is a *run*, not a row: one portrait at the head of a turn with that
 * turn's bubbles beside it. Drawn one portrait per bubble, the placeholder reserved a
 * gutter for portraits the conversation would not have and the column shifted as it
 * landed.
 */
const THREAD_SKELETON_RUNS = [
  { own: false, widths: ['w-40', 'w-24'] },
  { own: true, widths: ['w-32'] },
  { own: false, widths: ['w-52'] },
  { own: true, widths: ['w-20'] },
] as const;

function ThreadSkeleton() {
  return (
    <div className="flex flex-1 flex-col justify-end gap-3" aria-hidden="true">
      {THREAD_SKELETON_RUNS.map((run, i) => (
        <div
          key={i}
          className={cn('flex items-start gap-2', run.own ? 'flex-row-reverse' : 'flex-row')}
        >
          <SkeletonCircle size={32} delay={i * 80} />
          <div className={cn('flex flex-1 flex-col gap-1', run.own ? 'items-end' : 'items-start')}>
            {run.widths.map((width, j) => (
              <Skeleton
                key={width}
                className={cn('h-10 rounded-lg', width)}
                delay={i * 80 + 40 + j * 40}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * `'YYYY-MM-DD HH:MM:SS'` → a `Date`, without the engine's ISO-versus-local coin flip:
 * `new Date('2026-01-01 08:00:00')` is not a format the spec defines, so whether it
 * parses — and in which zone — is left to the engine. Values are rendered in whatever
 * zone the API returns them in; this only decides how they are split up, never what
 * they mean, so it deliberately does not shift them.
 */
function parseTimestamp(value: string | undefined | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) {
    const loose = new Date(value);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
}

/** The date part, as a grouping key. */
function dayKey(value: string): string {
  return (value || '').slice(0, 10);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** The separator's label: 今天 / 昨天 / 周三 / 3月4日 / 2024年3月4日. */
function dayLabel(value: string): string {
  const date = parseTimestamp(value);
  if (!date) return value;
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((todayMidnight.getTime() - midnight.getTime()) / 86_400_000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days > 1 && days < 7) return WEEKDAYS[date.getDay()];
  const month = date.getMonth() + 1;
  return date.getFullYear() === now.getFullYear()
    ? `${month}月${date.getDate()}日`
    : `${date.getFullYear()}年${month}月${date.getDate()}日`;
}

/**
 * The clock under a run's last bubble. Every bubble used to print the raw 19-character
 * stamp the API returns; the date now lives once per day in a separator and a bubble
 * only needs the time.
 */
function messageClock(value: string): string {
  const date = parseTimestamp(value);
  if (!date) return value;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Two messages this far apart are two turns, however brief the pause looked. */
const RUN_BREAK_MS = 5 * 60 * 1000;

/** Roughly six lines. Past that the composer scrolls instead of eating the thread. */
const COMPOSER_MAX_HEIGHT_PX = 160;

/* Capturing, so `String.split` keeps the markers as their own segments and
   the message can be reassembled as text / emoji / text. */
const EMOJI_MARKER = /(\$emoji_[a-zA-Z0-9_]+\$)/g;

export default function MessagesPage() {
  const { token, ready } = useSession();
  if (!ready) return <MessageRowsSkeleton />;
  /* Remount synchronously when the account changes: no private pane, draft or contact
     from the previous session can survive even the render before effect cleanup. */
  return <MessagesContent key={token ?? 'anonymous'} token={token} />;
}

function MessagesContent({ token }: { token: string | null }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const toUserIdParam = searchParams.get('to');
  const snapshotKey = `messages:${token ?? 'anonymous'}`;
  const snapshot = useState(() => readSnapshot<MessagesSnapshot>(snapshotKey))[0];
  const [activeTab, setActiveTab] = useState<MessagesTab>(snapshot?.value.tab ?? 'announcement');
  const [announcements, setAnnouncements] = useState<Announcement[]>(
    snapshot?.value.announcements ?? [],
  );
  const [notifications, setNotifications] = useState<Notification[]>(
    snapshot?.value.notifications ?? [],
  );
  const [contacts, setContacts] = useState<Contact[]>(snapshot?.value.contacts ?? []);
  const [contactQuery, setContactQuery] = useState('');
  /* Session state, not a stored preference: the rail is a "give the thread more room
     for a minute" control, and a collapsed sidebar that survives a reload is a sidebar
     people forget they collapsed. */
  const [savedContactsCollapsed, setContactsCollapsed] = useState(false);
  const contactsCanCollapse = useMediaQuery(MEDIA.md);
  const contactsCollapsed = savedContactsCollapsed && contactsCanCollapse;
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const selectedContactId = useRef<number | null>(null);
  const lifetime = useRef(0);
  const requests = useRef<Record<RequestKind, number>>({
    announcement: 0, notification: 0, interaction: 0, chat: 0,
    thread: 0, send: 0, target: 0, emoji: 0,
  });
  useEffect(() => () => { lifetime.current += 1; }, []);
  const beginRequest = useCallback((kind: RequestKind) => {
    const run = ++requests.current[kind];
    const epoch = lifetime.current;
    return () => lifetime.current === epoch && requests.current[kind] === run && readToken() === token;
  }, [token]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  /* One `loading` and one `error` per tab, not one for the page. A shared pair, with the
     panes marked rather than unmounted, meant a failure in any one pane put an error
     into every one of them — during a switch, both panes on screen at once, each under
     its own title. The loading half was the same bug in a quieter form: a tab that
     already had its data went back to skeletons because a *different* tab was fetching.
     The initial value is per tab too: a restored snapshot only vouches for the tabs it
     carries. */
  const [paneState, setPaneState] = useState<Record<MessagesTab, PaneState>>(() => {
    const start: PaneState = { loading: !snapshot, error: null };
    return {
      announcement: { ...start },
      notification: { ...start },
      interaction: { ...start },
      chat: { ...start },
    };
  });
  const setPane = useCallback((tab: MessagesTab, next: Partial<PaneState>) => {
    setPaneState((prev) => ({ ...prev, [tab]: { ...prev[tab], ...next } }));
  }, []);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const sendPending = useRef(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  /* One-way: once the sheet has been opened it stays mounted, so its exit animation has
     something to run on. See the note on the import. */
  const [emojiSheetMounted, setEmojiSheetMounted] = useState(false);
  const [emojiList, setEmojiList] = useState<string[]>([]);
  const selectContact = useCallback((contact: Contact | null) => {
    requests.current.target += 1;
    if (selectedContactId.current === (contact?.id ?? null)) return;
    selectedContactId.current = contact?.id ?? null;
    requests.current.thread += 1;
    requests.current.send += 1;
    sendPending.current = false;
    setSelectedContact(contact);
    setMessages([]);
    setThreadError(null);
    setLoadingMessages(Boolean(contact));
    setSending(false);
    setNewMessage('');
    setShowEmojiPicker(false);
  }, []);
  const [interactionNotifications, setInteractionNotifications] = useState<Notification[]>(
    snapshot?.value.interactions ?? [],
  );
  const [interactionNotificationsPage, setInteractionNotificationsPage] = useState(
    snapshot?.value.interactionsPage ?? 1,
  );
  const [interactionNotificationsTotalPages, setInteractionNotificationsTotalPages] = useState(
    snapshot?.value.interactionsTotalPages ?? 1,
  );
  /* Tabs whose contents are already on screen. A tab in here still refetches on arrival
     — the inbox is exactly the thing that goes out of date — but underneath what is
     showing rather than behind a skeleton. */
  const shown = useRef(
    new Set<MessagesTab>(snapshot && !snapshot.stale ? [snapshot.value.tab] : []),
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /* The composer's height follows its content. `auto` first: `scrollHeight` on an
     element already tall enough reports the height it has, so measuring without
     resetting only ever grows — deleting a line would leave the box where it was.
     Layout effect, not effect: it runs in the same commit as the keystroke, so the box
     never paints at the wrong height for a frame. */
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [newMessage, selectedContact]);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  /* Which enclosure the emoji picker gets — `sm` rather than `md`: the thread only
     becomes side-by-side at `md`, but the popover is already comfortable at 640, and a
     sheet on a landscape phone would cover the message you are replying to. */
  const isWide = useMediaQuery(MEDIA.sm);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (activeTab === 'chat') {
      const timer = setTimeout(() => {
        scrollToBottom();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [messages, activeTab]);

  /* The same entry the app bar's badge reads, so this screen and the shell share one
     request instead of sending three between them. Reading a tab marks it read
     server-side, which is why the loaders below still force a re-read — but one request
     now updates both, where the old arrangement fetched here, dispatched an event, and
     made the shell fetch it again to learn the same number. */
  const unreadRead = useResource(unreadCountsResource, token ? { token } : SKIP);
  const unreadCounts = useMemo(
    () => ({
      messages: unreadRead.data?.messages ?? 0,
      notifications: unreadRead.data?.notifications ?? 0,
      interactions: unreadRead.data?.interactions ?? 0,
    }),
    [unreadRead.data],
  );

  const fetchUnreadCounts = useCallback(async () => {
    if (!token || readToken() !== token) return;
    await unreadCountsResource.read({ token }, { force: true }).catch(() => {});
  }, [token]);

  useEffect(() => {
    const isCurrent = beginRequest('emoji');
    const loadEmojis = async () => {
      try {
        const emojis = await getEmojis();
        if (isCurrent()) setEmojiList(emojis);
      } catch {
        /* Emoji are optional; text composition remains available offline. */
      }
    };
    void loadEmojis();
  }, [beginRequest]);

  useEffect(() => {
    if (!toUserIdParam) return;

    const targetId = parseInt(toUserIdParam, 10);
    if (!Number.isSafeInteger(targetId) || targetId <= 0 || !token) return;
    const isCurrent = beginRequest('target');
    const requestGenerations = requests.current;

    queueMicrotask(() => { if (isCurrent()) setActiveTab('chat'); });

    const timer = setTimeout(async () => {
      if (!isCurrent()) return;
      const existing = contacts.find((c) => c.id === targetId);
      if (existing) {
        selectContact(existing);
        return;
      }

      try {
        const res = await api.getUserProfile(String(targetId));
        if (!isCurrent()) return;
        if (res.success && res.user) {
          const tempContact = {
            id: targetId,
            username: res.user.username,
            avatar: res.user.avatar,
            last_msg_time: '',
            unread_count: 0,
          };
          setContacts((prev) => {
            if (prev.some((c) => c.id === targetId)) return prev;
            return [tempContact, ...prev];
          });
          selectContact(tempContact);
        }
      } catch (err) {
        if (isCurrent()) console.error('获取用户信息失败', err);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      requestGenerations.target += 1;
    };
    // contacts intentionally omitted: only re-run when deep-link target changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toUserIdParam, token, beginRequest, selectContact]);

  /* `Popover` (desktop) and `Sheet` (phone) both hold themselves in the tree until their
     own exit has played, so closing is a plain state flip — this used to be a manual
     closing flag plus a 200ms `setTimeout` kept in step with a CSS keyframe by hand, and
     a second document-level mousedown listener duplicating what both primitives do. */
  const handleCloseEmojiPicker = () => setShowEmojiPicker(false);

  /* Straight to the gallery, not `history.back()`: /messages sits on the row above / on
     the app's notional plane (see `ROUTE_CELL` in routeCrossFade), so leaving it is a
     move down to the gallery no matter where the user came from — stepping back onto a
     forum post played that down-move onto something not below it. */
  const handleBack = useCallback(() => {
    if (selectedContact) {
      selectContact(null);
      return;
    }
    router.push('/', { scroll: false });
  }, [router, selectedContact, selectContact]);

  /* Escape leaves the page. Stood down with the emoji picker open — that is the nearer
     thing to dismiss. Inside a conversation `handleBack` already backs out to the
     contact list first, so both controls agree. */
  useEscapeBack(handleBack, !showEmojiPicker);

  const toggleEmojiPicker = () =>
    setShowEmojiPicker((open) => {
      /* Latched on the way *open*, so the chunk is requested by the gesture that needs it. */
      if (!open) setEmojiSheetMounted(true);
      return !open;
    });

  /* `silent` on every loader, not just `fetchContacts`: the refresh on arrival with a
     snapshot already showing must not blank the list back to skeletons, nor replace
     something correct with an error banner if the network is down. Each loader writes
     only its own tab's state — see `paneState`. */
  const fetchAnnouncements = useCallback(
    async (silent = false) => {
      const isCurrent = beginRequest('announcement');
      if (!isCurrent()) return;
      if (!silent) setPane('announcement', { loading: true, error: null });
      try {
        const data = await api.getAnnouncementHistory();
        if (!isCurrent()) return;
        if (data.success) {
          shown.current.add('announcement');
          setAnnouncements(data.announcements);
        } else if (!silent) {
          setPane('announcement', { error: '获取公告失败' });
        }
      } catch (err) {
        if (!isCurrent()) return;
        if (!silent) setPane('announcement', { error: '网络请求失败' });
        console.error(err);
      } finally {
        if (isCurrent()) setPane('announcement', { loading: false });
      }
    },
    [beginRequest, setPane],
  );

  const fetchNotifications = useCallback(
    async (silent = false) => {
      const isCurrent = beginRequest('notification');
      if (!isCurrent()) return;
      if (!silent) setPane('notification', { loading: true, error: null });
      try {
        if (!token) {
          if (!silent) setPane('notification', { error: '请先登录' });
          return;
        }
        const data = await api.getNotifications(token);
        if (!isCurrent()) return;
        if (data.success) {
          shown.current.add('notification');
          setNotifications(data.notifications);
          fetchUnreadCounts();
        } else if (!silent) {
          setPane('notification', { error: '获取通知失败' });
        }
      } catch (err) {
        if (!isCurrent()) return;
        if (!silent) setPane('notification', { error: '网络请求失败' });
        console.error(err);
      } finally {
        if (isCurrent()) setPane('notification', { loading: false });
      }
    },
    [token, beginRequest, fetchUnreadCounts, setPane],
  );

  const fetchInteractionNotifications = useCallback(
    async (page: number = 1, silent = false) => {
      const isCurrent = beginRequest('interaction');
      if (!isCurrent()) return;
      if (!silent) setPane('interaction', { loading: true, error: null });
      try {
        if (!token) {
          if (!silent) setPane('interaction', { error: '请先登录' });
          return;
        }
        const data = await api.getInteractionNotifications(token, page);
        if (!isCurrent()) return;
        if (data.success) {
          shown.current.add('interaction');
          setInteractionNotifications(data.notifications);
          setInteractionNotificationsTotalPages(data.total_pages);
          setInteractionNotificationsPage(page);
          fetchUnreadCounts();
        } else if (!silent) {
          setPane('interaction', { error: '获取互动通知失败' });
        }
      } catch (err) {
        if (!isCurrent()) return;
        if (!silent) setPane('interaction', { error: '网络请求失败' });
        console.error(err);
      } finally {
        if (isCurrent()) setPane('interaction', { loading: false });
      }
    },
    [token, beginRequest, fetchUnreadCounts, setPane],
  );

  const fetchContacts = useCallback(
    async (silent = false) => {
      const isCurrent = beginRequest('chat');
      if (!isCurrent()) return;
      if (!silent) setPane('chat', { loading: true, error: null });
      try {
        if (!token) {
          if (!silent) setPane('chat', { error: '请先登录' });
          return;
        }
        const data = await api.getRecentContacts(token);
        if (!isCurrent()) return;
        if (data.success) {
          shown.current.add('chat');
          setContacts(data.contacts);
        } else if (!silent) {
          setPane('chat', { error: '获取联系人失败' });
        }
      } catch (err) {
        if (!isCurrent()) return;
        if (!silent) setPane('chat', { error: '网络请求失败' });
        console.error(err);
      } finally {
        if (isCurrent()) setPane('chat', { loading: false });
      }
    },
    [token, beginRequest, setPane],
  );

  const fetchMessages = useCallback(
    async (contactId: number, silent = false) => {
      if (!token || selectedContactId.current !== contactId || readToken() !== token) return;
      const requestIsCurrent = beginRequest('thread');
      const isCurrent = () => requestIsCurrent() && selectedContactId.current === contactId;
      setThreadError(null);
      if (!silent) setLoadingMessages(true);
      try {
        const data = await api.getMessages(token, contactId);
        if (!isCurrent()) return;
        if (data.success) {
          setMessages(data.messages);
          fetchUnreadCounts();
          fetchContacts(true);
        } else {
          /* A failure with no `else` left the *previous* contact's bubbles on screen under
             the new contact's name and avatar — the worst failure mode for a private
             thread. Clearing is the honest state, and the toast is the only signal. */
          setThreadError('聊天记录加载失败');
        }
      } catch (err) {
        if (!isCurrent()) return;
        console.error('获取聊天记录失败', err);
        setThreadError('网络错误，请稍后再试');
      } finally {
        if (isCurrent()) setLoadingMessages(false);
      }
    },
    [token, beginRequest, fetchUnreadCounts, fetchContacts],
  );

  useEffect(() => {
    /* A tab that already has something on screen — restored from the snapshot, or loaded
       earlier this mount — refreshes silently; only a tab with nothing to show may put
       up a skeleton. `shown` is added to by the loaders on delivery, never here: marking
       a tab as seen when its request goes out means StrictMode's remount finds it marked,
       refreshes silently, and never clears `loading` — a permanent skeleton. */
    const silent = shown.current.has(activeTab);
    // Defer so loaders' sync setState is not in the effect body
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || readToken() !== token) return;
      if (activeTab === 'announcement') {
        void fetchAnnouncements(silent);
      } else if (activeTab === 'notification') {
        void fetchNotifications(silent);
      } else if (activeTab === 'interaction') {
        void fetchInteractionNotifications(1, silent);
      } else {
        void fetchContacts(silent);
      }
    });
    return () => { cancelled = true; };
  }, [
    token,
    activeTab,
    fetchAnnouncements,
    fetchNotifications,
    fetchInteractionNotifications,
    fetchContacts,
  ]);

  /* One writer for the whole snapshot rather than a write threaded through each loader.
     Held back while the *active* tab's first load is in flight and while its error is
     showing, so an empty or failed screen is never what a later visit restores. Gated
     on the active tab, because that is the tab the snapshot records as the one to
     reopen on. */
  const activePane = paneState[activeTab];
  useEffect(() => {
    if (activePane.loading || activePane.error || readToken() !== token) return;
    writeSnapshot<MessagesSnapshot>(snapshotKey, {
      tab: activeTab,
      announcements,
      notifications,
      interactions: interactionNotifications,
      interactionsPage: interactionNotificationsPage,
      interactionsTotalPages: interactionNotificationsTotalPages,
      contacts,
    });
  }, [
    snapshotKey,
    token,
    activePane.loading,
    activePane.error,
    activeTab,
    announcements,
    notifications,
    interactionNotifications,
    interactionNotificationsPage,
    interactionNotificationsTotalPages,
    contacts,
  ]);

  useEffect(() => {
    let cancelled = false;
    const requestGenerations = requests.current;
    if (selectedContact) {
      queueMicrotask(() => {
        if (!cancelled) void fetchMessages(selectedContact.id);
      });
    }
    return () => {
      cancelled = true;
      requestGenerations.thread += 1;
    };
  }, [selectedContact, fetchMessages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedContact || sending || sendPending.current) return;
    if (!token || readToken() !== token) {
      showToast('请先登录', 'error');
      return;
    }
    const contactId = selectedContact.id;
    const sentText = newMessage.trim();
    const requestIsCurrent = beginRequest('send');
    const isCurrent = () => requestIsCurrent() && selectedContactId.current === contactId;
    sendPending.current = true;
    setSending(true);
    try {
      const res = await api.sendMessage(token, contactId, sentText);
      const data = await res.json();
      if (!isCurrent()) return;

      if (data.success) {
        setNewMessage((current) => current.trim() === sentText ? '' : current);
        void fetchMessages(contactId, true);
      } else {
        /* Both failure paths used to stop silently at `console.error` — no toast, nothing
           in the thread; the user had no way to tell whether it had been sent. The typed
           text is deliberately left in the field so it can be retried without retyping. */
        showToast(data.message || '发送失败，请重试', 'error');
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('发送消息出错:', err);
      showToast('网络错误，请稍后再试', 'error');
    } finally {
      if (isCurrent()) {
        sendPending.current = false;
        setSending(false);
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    /* `isComposing` is the important half on a Chinese-language board: an IME uses Enter
       to commit the current pinyin candidate, and that keydown reaches React with
       `isComposing: true` — without this guard, pressing Enter to choose a character
       sent the half-composed string as a message. */
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleEmojiClick = (emojiName: string) => {
    const emojiPlaceholder = `$emoji_${emojiName}$`;
    const input = inputRef.current;

    if (input) {
      const startPos = input.selectionStart || 0;
      const endPos = input.selectionEnd || 0;

      const newValue =
        newMessage.substring(0, startPos) + emojiPlaceholder + newMessage.substring(endPos);
      setNewMessage(newValue);

      const epoch = lifetime.current;
      const contactId = selectedContactId.current;
      setTimeout(() => {
        if (lifetime.current !== epoch || readToken() !== token || selectedContactId.current !== contactId) return;
        input.focus();
        input.setSelectionRange(
          startPos + emojiPlaceholder.length,
          startPos + emojiPlaceholder.length,
        );
      }, 0);
    } else {
      setNewMessage((prev) => prev + emojiPlaceholder);
    }
  };

  const renderMessageContent = (content: string) => {
    if (!content) return null;

    /* Split on the emoji markers and render the pieces as one inline flow. Both halves
       used to be block-level and it showed: the text runs each came back as a
       `<div><p>…</p></div>` from `RichTextRenderer`, and the emoji went through
       `FadeInImage`, whose full-size wrapper is built for a *media box* already sized —
       so "你好 🐴 再见" rendered as three stacked lines and a long message broke
       wherever an emoji fell rather than at the bubble's edge. `inline` on the renderer
       drops the paragraph, and a plain `next/image` replaces the fade wrapper — a 24px
       local glyph has nothing to fade in from. */
    const parts = content.split(EMOJI_MARKER);
    if (parts.length === 1) return <RichTextRenderer content={content} inline />;

    return (
      <>
        {parts.map((part, i) => {
          const match = part.match(/^\$emoji_([a-zA-Z0-9_]+)\$$/);
          if (match) {
            return (
              <Image
                key={`e${i}`}
                src={`/img/emoji/${match[1]}.png`}
                alt={match[1]}
                width={24}
                height={24}
                className="mx-0.5 inline-block h-6 w-6 align-text-bottom"
              />
            );
          }
          if (!part) return null;
          return <RichTextRenderer key={`t${i}`} content={part} inline />;
        })}
      </>
    );
  };

  /* Emoji grid, shared by the desktop popover and the mobile sheet — two enclosures,
     one control; the picker itself must not differ between them. */
  const emojiGrid = (
    <div className="grid grid-cols-6 gap-1">
      {emojiList.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => handleEmojiClick(emoji)}
          className="state-layer text-on-surface-variant flex aspect-square cursor-pointer items-center justify-center rounded-sm p-1 outline-none focus-visible:ring-2 focus-ring"
        >
          <Image
            src={`/img/emoji/${emoji}.png`}
            alt={emoji}
            width={32}
            height={32}
            className="h-8 w-8 object-contain"
          />
        </button>
      ))}
    </div>
  );

  /* Case-insensitive substring on the display name, the only field the row shows.
     Local, not a request: the contact list is already in memory and small, so a round
     trip would make typing feel slower than reading. */
  const visibleContacts = contactQuery.trim()
    ? contacts.filter((c) =>
        c.username.toLowerCase().includes(contactQuery.trim().toLowerCase()),
      )
    : contacts;

  /* Keyed on `sender_id`, not on `sender_name`: the id is the fact, while the display
     name is a label two accounts can share and its owner can change mid-thread, at
     which point every message before the change joined the wrong run. A run also ends
     at a day boundary and at a five-minute pause — see `markRuns`. */
  const runs = markRuns(
    messages,
    (m) => m.sender_id,
    (m, next) => {
      if (dayKey(m.created_at) !== dayKey(next.created_at)) return true;
      const a = parseTimestamp(m.created_at);
      const b = parseTimestamp(next.created_at);
      return Boolean(a && b && b.getTime() - a.getTime() >= RUN_BREAK_MS);
    },
  );

  /* The flags, turned into actual groups. The thread renders one container per turn — a
     portrait beside the bubbles belonging to it — so the boundaries `markRuns` marks
     have to become nesting. That a run always ends at a day boundary is what lets the
     date separator sit *between* two groups instead of threaded through the middle of
     one. */
  const threadRuns: {
    lead: Message;
    items: { msg: Message; startOfRun: boolean; endOfRun: boolean }[];
  }[] = [];
  for (const { item, startOfRun, endOfRun } of runs) {
    if (startOfRun || threadRuns.length === 0) threadRuns.push({ lead: item, items: [] });
    /* Both flags reach the bubble, and both are load-bearing: together they cut a run
       into one block — `startOfRun` opens it, `endOfRun` closes it; dropping either
       leaves a turn that reads as a stack of separate lozenges or ends on a clipped
       corner. `endOfRun` also decides the timestamp — the clock belongs to the turn,
       not to each message in it. */
    threadRuns[threadRuns.length - 1].items.push({ msg: item, startOfRun, endOfRun });
  }

  /* The delivery mark goes on the newest outgoing message only. Under every own
     bubble it is a column of 已读 down the right-hand side; on the newest one it
     answers the only question a sender actually has. */
  const lastOwnMessageId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (selectedContact && messages[i].sender_id !== selectedContact.id) return messages[i].id;
    }
    return null;
  })();

  return (
    <>
      <div className="mx-auto max-w-4xl">
        <PageHeader title="消息" />

        <Tabs
          className="mb-3"
          value={activeTab}
          onChange={(v) => setActiveTab(v)}
          label="消息分类"
          tabs={[
            { value: 'announcement' as const, label: '公告' },
            { value: 'notification' as const, label: '系统', badge: unreadCounts.notifications },
            { value: 'interaction' as const, label: '互动', badge: unreadCounts.interactions },
            { value: 'chat' as const, label: '私信', badge: unreadCounts.messages },
          ]}
        />

        {/* The panes slide on the shared axis, like every other tab set in the app. This
            used to be a `key`-ed remount plus a 12px fade — a different motion from every
            other tab switch, and the `key` tore the subtree down, throwing away each
            tab's scroll position and fetched data. */}
        <TabPanes value={activeTab}>
          <TabPane value="announcement">
            {paneState.announcement.loading ? (
              <MessageRowsSkeleton />
            ) : paneState.announcement.error ? (
              <ErrorRetry
                size="pane"
                title="公告加载失败"
                message={paneState.announcement.error}
                onRetry={() => fetchAnnouncements()}
              />
            ) : announcements.length === 0 ? (
              <EmptyState size="pane" icon={<MdCampaign size={ICON.display} />} title="暂无公告" />
            ) : (
              <div>
                {announcements.map((item) => (
                  <div key={item.id} className="m3-row bg-surface-container-low p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="flex min-w-0 items-center gap-3">
                        {/* Was a hand-rolled primary-tinted pill; a version tag is a
                            mark, so it is a `Badge`. */}
                        <Badge tone="primary" size="md">
                          {item.version}
                        </Badge>
                        <h3 className="text-title-m-emphasized text-on-surface min-w-0">
                          {item.title}
                        </h3>
                      </div>
                      <time className="text-body-s text-on-surface-variant shrink-0 tabular-nums">
                        {item.date}
                      </time>
                    </div>
                    {/* `text-body-m`, not a label role with extra leading: a label role is
                        for a control's name, and the relaxed leading overrode the body
                        line-height already loosened for Han glyphs — this one prose block
                        was set looser than every other paragraph in the app. */}
                    <div
                      className="text-on-surface-variant text-body-m announcement-content"
                      dangerouslySetInnerHTML={{ __html: item.content }}
                    />
                  </div>
                ))}
              </div>
            )}
          </TabPane>

          <TabPane value="notification">
            <NotificationPane
              items={notifications}
              loading={paneState.notification.loading}
              error={paneState.notification.error}
              onRetry={() => fetchNotifications()}
              emptyTitle="暂无系统消息"
            />
          </TabPane>

          <TabPane value="interaction">
            <NotificationPane
              items={interactionNotifications}
              loading={paneState.interaction.loading}
              error={paneState.interaction.error}
              onRetry={() => fetchInteractionNotifications(interactionNotificationsPage)}
              emptyTitle="暂无互动消息"
            >
              {interactionNotificationsTotalPages > 1 && (
                <Pagination
                  currentPage={interactionNotificationsPage}
                  totalPages={interactionNotificationsTotalPages}
                  onPageChange={(p) => fetchInteractionNotifications(p)}
                  className="mt-6"
                />
              )}
            </NotificationPane>
          </TabPane>

          <TabPane value="chat">
            {/* Height is `dvh` minus the chrome above it, as one calc — the previous
                pair's 200px was a guess, and a fixed 600 on a tall desktop window left
                the frame floating in half the space. `min-h` keeps the thread usable
                when a phone keyboard is up and `dvh` collapses. */}
            {/* `rounded-md` (12dp): this is a section surface, and the 28dp step belongs
                to a dialog, a sheet or a chat *bubble*. At 28dp the frame's clip also cut
                the first and last contact rows' corners against a curve they did not
                share. `md:min-h-[26rem]`, not an unconditional floor: with the phone
                keyboard up `100dvh` collapses to roughly 350px, the calc goes negative
                and the 416px minimum wins — the frame became taller than the visual
                viewport and its bottom-docked composer sat behind the keyboard. Below
                `md` the `dvh` unit should track the keyboard, which is the whole reason
                to use it. */}
            {/* `surface-container-low`, the same step the contact column inside it takes.
                It was `surface-container-highest` — the *filled text field's* own tone, so
                the contact search box in this strip was painted exactly the colour behind
                it and disappeared into it. A two-pane frame holding a list and a thread is
                not a filled field, and the things inside it need somewhere to stand out
                *from*. */}
            <div className="bg-surface-container-low flex h-[calc(100dvh-13rem)] overflow-hidden rounded-md md:h-[38rem] md:min-h-[26rem]">
              {/* — Contact list — */}
              <div
                className={cn(
                  'w-full flex-col transition-[width]',
                  /* The drawer's springs, per direction, for the drawer's reasons — see
                     the note on the `<aside>` in `AppLayout`. This rail is the same
                     object: a docked panel a press collapses, and every clock in the
                     gesture (rail, row gap, search box width/grow, labels' fade) is this
                     one, because they are one movement. The springs are the spec's
                     answer, after a 296ms tier and an invented bezier. */
                  contactsCollapsed ? 'spring-fast-effects' : 'spring-default-spatial',
                  /* One branch or the other, never both: `cn` is a plain join, so emitting
                     both widths let Tailwind's output order pick — and it picks the larger,
                     so the rail collapsed its contents and kept its width.
                     18rem expanded, down from 20: the row holds a 40px portrait, a name
                     and a time, and 320px left the name ending a third of the way across.
                     Collapsed is **derived from the row, not chosen**: the list's inset
                     takes 8px a side, so the rail is the row's height plus 16 (88) — that
                     makes the row come out square and the portrait centre itself with no
                     centring rule. The three numbers that have to agree are the row's
                     height, its horizontal padding and this width (a 48dp portrait in a
                     72px square wants 12px of padding, so the row is `px-3`); taking the
                     row to 64 under a pointer broke exactly that, so the row is one
                     height again. */
                  contactsCollapsed ? 'md:w-22' : 'md:w-72',
                  selectedContact ? 'hidden md:flex' : 'flex',
                )}
              >
                <div
                  className={cn(
                    'flex items-center gap-2 p-3',
                    /* The gap is on the same clock as the rail's width. Collapsed it must
                       reach 0, or the toggle does not end up centred in the 80px rail: 12px
                       of padding either side leaves 56px, and a 40px button with an 8px gap
                       still in front of it can only sit 4px right of centre. Animated
                       rather than switched — an instant 8px hop at the start of the slide
                       is the two-clock movement that made this control look like it jumped
                       before it moved. */
                    'transition-[gap]',
                    contactsCollapsed ? 'spring-fast-effects' : 'spring-default-spatial',
                    contactsCollapsed && 'md:gap-0',
                  )}
                >
                  {/* This was a fully-styled field with no `value`, no `onChange` and no
                      filtering behind it — a control that looked live and did nothing.

                      Kept mounted and faded out rather than unmounted while the rail is
                      collapsing: pulling it out of the row on the first frame made the
                      toggle jump the whole width of the field before the rail had finished
                      narrowing around it. `w-0` on the same clock as the rail so the row's
                      own width goes with it, and `pointer-events-none` because an invisible
                      search box must not still take clicks. */}
                  <div
                    className={cn(
                      /* `flex-grow` is in the transition list, and that is the whole fix
                         for the toggle jumping. `md:grow-0` matters as much as `md:w-0`:
                         `flex-1` is grow *and* basis, so a zero-width box still claimed
                         every spare pixel in the rail and pushed the toggle off centre.
                         But `grow` was being *switched* while `width` was *animated* —
                         the search box gave up its claim in a single frame and the toggle
                         snapped to centre before the rail moved: one property on a clock
                         and its partner on none. `flex-grow` is an animatable number, so
                         putting it on the same clock hands the space over gradually and
                         the toggle glides to its final position with the rail around it. */
                      'min-w-0 transition-[width,opacity,flex-grow]',
                      contactsCollapsed ? 'spring-fast-effects' : 'spring-default-spatial',
                      contactsCollapsed
                        ? 'md:w-0 md:grow-0 md:opacity-0 md:pointer-events-none flex-1'
                        : 'flex-1 opacity-100',
                    )}
                    aria-hidden={contactsCollapsed ? 'true' : undefined}
                    inert={contactsCollapsed ? true : undefined}
                  >
                    <Input
                      type="search"
                      /* `sm` — 40dp. This is a filter above a list, the enclosure the
                         dense step exists for; at the form-slot 56 it made an 80px band
                         above the contacts for one search box. */
                      size="sm"
                      icon={<MdSearch size={ICON.control} />}
                      placeholder="搜索昵称发起私信…"
                      value={contactQuery}
                      onChange={(e) => setContactQuery(e.target.value)}
                      aria-label="搜索联系人"
                      fieldClassName="min-w-0"
                    />
                  </div>
                  {/* Below `md` the list and the thread are the same column and swap, so
                      there is nothing beside this to make room for — collapsing it there
                      would only hide the search. */}
                  <IconButton
                    onClick={() => setContactsCollapsed((v) => !v)}
                    aria-label={contactsCollapsed ? '展开联系人列表' : '收起联系人列表'}
                    aria-expanded={!contactsCollapsed}
                    title={contactsCollapsed ? '展开联系人列表' : '收起联系人列表'}
                    className="max-md:hidden mx-auto"
                    icon={
                      contactsCollapsed ? (
                        <MdChevronRight size={ICON.standard} />
                      ) : (
                        <MdChevronLeft size={ICON.standard} />
                      )
                    }
                  />
                </div>
                <div className="popover-scrollbar flex-1 overflow-y-auto p-2">
                  {paneState.chat.loading && contacts.length === 0 ? (
                    <div className="flex flex-col gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        /* The contact row's own box — the skeleton stood at a different
                           height once, so the list re-spaced as the contacts landed. */
                        <div key={i} className="flex h-18 items-center gap-3 px-3">
                          <SkeletonCircle size={48} delay={i * 80} />
                          <div
                            className={cn(
                              'flex min-w-0 flex-1 flex-col gap-2',
                              contactsCollapsed && 'md:opacity-0',
                            )}
                          >
                            <Skeleton className="h-4 w-3/4" delay={i * 80 + 40} />
                            <Skeleton className="h-3 w-1/2" delay={i * 80 + 80} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : paneState.chat.error ? (
                    /* Collapsed, the rail is 80px wide and `ErrorRetry` wrapped to a
                       column of two-character lines. The state still has to be
                       *reachable* there, so it becomes the one control the state is really
                       about: a retry button, in the error colour, message as tooltip. */
                    contactsCollapsed ? (
                      <div className="hidden justify-center pt-2 md:flex">
                        <IconButton
                          onClick={() => fetchContacts()}
                          aria-label={`联系人加载失败：${paneState.chat.error}，点击重试`}
                          title={`联系人加载失败：${paneState.chat.error}`}
                          className="text-error"
                          icon={<MdErrorOutline size={ICON.standard} />}
                        />
                      </div>
                    ) : (
                      <ErrorRetry
                        size="inline"
                        title="联系人加载失败"
                        message={paneState.chat.error}
                        onRetry={() => fetchContacts()}
                      />
                    )
                  ) : contacts.length === 0 ? (
                    /* Both empty states are words, and words are the one thing an 80px
                       rail has no room for. Collapsed it shows nothing, which is honest —
                       an empty rail is an empty list. */
                    !contactsCollapsed && (
                      <EmptyState
                        size="inline"
                        icon={<MdOutlineChatBubbleOutline size={ICON.large} />}
                        title="还没有任何私信"
                      />
                    )
                  ) : visibleContacts.length === 0 ? (
                    /* A filter that matches nothing is a different state from having no
                       contacts at all, and saying "还没有任何私信" there would be a lie.
                       (Unreachable while collapsed, but the guard costs nothing and the
                       two empty states should behave alike.) */
                    !contactsCollapsed && (
                      <EmptyState
                        size="inline"
                        icon={<MdSearchOff size={ICON.large} />}
                        title="没有匹配的联系人"
                      />
                    )
                  ) : (
                    visibleContacts.map((contact) => {
                      const active = selectedContact?.id === contact.id;
                      return (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => selectContact(contact)}
                          aria-current={active ? 'true' : undefined}
                          aria-label={contactsCollapsed ? contact.username : undefined}
                          data-ripple
                          /* A list row in the shape the rest of the app uses: rounded like
                             the sidebar's nav rows, the M3 state layer for hover/press
                             instead of a hand-picked hover colour, and the selected row on
                             the secondary container pair so "selected" and "hovered" stop
                             looking identical. The 16px between rows is gone — it made
                             four contacts look like four cards.

                             **Fixed height, and nothing about the row's layout changes when
                             the rail collapses.** It used to re-centre and drop the name
                             block on the same frame the toggle was pressed — one gesture,
                             three clocks. Now the row keeps its geometry and the rail
                             simply narrows over it: the text is *clipped* by the shrinking
                             box, and a fixed height means the row's height never depended
                             on the text in the first place.

                             The portrait needs no centring rule either, which is what makes
                             this work: the collapsed rail is the row's height plus the
                             list's 8px inset either side, so the row comes out square
                             (88 − 16 = 72) — provided the horizontal padding *is* that
                             distance (12, so `px-3`). Three numbers move together: the
                             rail's collapsed width, this height, this padding.

                             **48dp portrait, not 40**: 40px in a 72px square leaves 16px of
                             air on every side, and collapsed — where the portrait is the
                             only thing left in the rail — that reads as a small picture
                             floating in a big button. The leading inset is 12 rather than
                             the spec's 16, the cheaper of the two divergences.

                             **72dp at every density** (`ItemTwoLineContainerHeight`). A
                             64 height with unchanged padding put the collapsed portrait
                             4px above centre. */
                          className={cn(
                            'flex h-18 w-full cursor-pointer items-center gap-3 overflow-hidden rounded-full px-3 text-left outline-none',
                            'transition-ui focus-visible:ring-2 focus-ring',
                            active
                              ? 'bg-secondary-container text-on-secondary-container'
                              : 'state-layer text-on-surface',
                          )}
                        >
                          <div className="relative shrink-0">
                            <Avatar src={contact.avatar} name={contact.username} size={48} />
                            <span className="absolute -top-0.5 -right-0.5">
                              <CountBadge
                                count={contact.unread_count}
                                label={`${contact.unread_count} 条未读`}
                              />
                            </span>
                          </div>
                          {/* Faded, never unmounted and never hidden. `md:hidden`
                              removed it from the row on the first frame, which is
                              what made the row change height the instant the
                              toggle was pressed. */}
                          <div
                            className={cn(
                              'min-w-0 flex-1 transition-opacity',
                              contactsCollapsed ? 'spring-fast-effects' : 'spring-default-spatial',
                              contactsCollapsed && 'md:opacity-0',
                            )}
                          >
                            <p className="text-label-l-emphasized truncate">{contact.username}</p>
                            <p className="text-body-s text-on-surface-variant mt-0.5 truncate">
                              {contact.last_msg_time}
                            </p>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* — Thread — */}
              <div
                className={cn(
                  'bg-surface-container-low min-w-0 flex-1 flex-col',
                  !selectedContact ? 'hidden md:flex' : 'flex',
                )}
              >
                {selectedContact ? (
                  <>
                    <div className="bg-surface-container flex min-w-0 items-center gap-3 p-3 sm:p-4">
                      <IconButton
                        onClick={() => selectContact(null)}
                        aria-label="返回联系人列表"
                        icon={<MdArrowBack size={ICON.control} />}
                        className="md:hidden"
                      />
                      <Avatar
                        src={selectedContact.avatar}
                        name={selectedContact.username}
                        size={40}
                        className="max-md:hidden"
                      />
                      <span className="text-title-m text-on-surface min-w-0 truncate">
                        {selectedContact.username}
                      </span>
                      <IconButton
                        onClick={() => fetchMessages(selectedContact.id)}
                        /* `loading`, not a hand-spun glyph: the primitive swaps the icon
                           for a real `Spinner` and blocks interaction, like every other
                           busy control in the app. */
                        loading={loadingMessages}
                        aria-label="刷新消息"
                        className="ms-auto"
                        icon={<MdRefresh size={ICON.standard} />}
                      />
                    </div>

                    <div
                      ref={messagesContainerRef}
                      className="popover-scrollbar flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-4"
                    >
                      {loadingMessages ? (
                        <ThreadSkeleton />
                      ) : threadError ? (
                        <ErrorRetry size="pane" title="聊天记录加载失败" message={threadError} onRetry={() => { void fetchMessages(selectedContact.id); }} />
                      ) : messages.length === 0 ? (
                        <EmptyState
                          size="inline"
                          icon={<MdOutlineChatBubbleOutline size={ICON.large} />}
                          title="还没有消息，说点什么吧"
                          className="flex-1"
                        />
                      ) : (
                        threadRuns.map(({ lead, items }, i) => {
                          const isMe = lead.sender_id !== selectedContact.id;
                          const previous = i > 0 ? threadRuns[i - 1].lead : null;
                          const startsDay =
                            !previous || dayKey(previous.created_at) !== dayKey(lead.created_at);
                          return (
                            <Fragment key={lead.id}>
                              {/* One date per day, where the conversation actually turns
                                  over, rather than the same 19-character stamp repeated
                                  under every bubble. `role="separator"` because that is
                                  what it is: a break in the list, not an entry in it. */}
                              {startsDay && (
                                <div
                                  role="separator"
                                  className="text-label-s text-on-surface-variant my-3 flex items-center gap-3 first:mt-0"
                                >
                                  <span className="bg-outline-variant h-px flex-1" />
                                  <span className="shrink-0">{dayLabel(lead.created_at)}</span>
                                  <span className="bg-outline-variant h-px flex-1" />
                                </div>
                              )}
                              {/* A run is tight inside and separated outside, the other
                                  half of what makes turns read as turns. */}
                              <ChatRun
                                own={isMe}
                                className="mb-3 last:mb-0"
                                avatar={
                                  <Avatar
                                    src={lead.sender_avatar}
                                    name={lead.sender_name}
                                    size={32}
                                  />
                                }
                              >
                                {items.map(({ msg, startOfRun, endOfRun }) => (
                                  <ChatBubble
                                    key={msg.id}
                                    own={isMe}
                                    startOfRun={startOfRun}
                                    endOfRun={endOfRun}
                                    /* The clock belongs to the turn, not to each message
                                       in it: four messages in a row used to print four
                                       separate times and read as four separate turns. */
                                    timestamp={
                                      endOfRun ? messageClock(msg.created_at) : undefined
                                    }
                                    status={
                                      isMe && msg.id === lastOwnMessageId ? (
                                        <span className={msg.is_read ? 'text-primary-ink' : undefined}>
                                          {msg.is_read ? '已读' : '已送达'}
                                        </span>
                                      ) : undefined
                                    }
                                  >
                                    {renderMessageContent(msg.content)}
                                  </ChatBubble>
                                ))}
                              </ChatRun>
                            </Fragment>
                          );
                        })
                      )}
                    </div>

                    {/* `p-2` at every width — 8px around the field for a 72px band. It was
                        12/16px around three 56dp boxes, an 88px strip for one line of text;
                        the padding is the only term left to spend once the field's own
                        height is fixed, and the field is the part you type into.

                        The safe-area inset is what every other bottom-docked surface in this
                        app already does (`Sheet`, the drawer, the tab bar): on a phone this
                        row sits at the bottom of the viewport, over the home indicator. */}
                    <div className="bg-surface-container relative p-2 [--touch-floor:48px] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                      {/* The two controls stay *outside* the field. Right for a search box
                          (one field, one action, pressed once), wrong here: the composer is
                          the thing you live in while typing, and burying send inside it
                          turned three plain targets into one crowded box. Bottom-aligned
                          (`items-end`) so they stay put as the field grows. */}
                      {/* **A 40dp field between two 40dp accessories**, 48 each under a
                          finger, and the row is `p-2` — **56px**, from 88. All three take
                          40, the step a control beside a field takes from the trailing-slot
                          arithmetic `(56 − 40) / 2`. The height history (56 → 40 → 56 →
                          56/40 → 40/40, each step fixing the previous one's side-effect) is
                          a record of how easy this row is to get wrong: equal 56dp boxes
                          made the composer an 88px band for one line of text, and dropping
                          only the buttons to 40 left a 16px gap that read as the buttons
                          being undersized rather than the field oversized.
                          `touch-size` on the buttons and `pointer-coarse` padding on the
                          field carry all three to 48 together where a finger is the pointer.

                          `shape="square"` on the buttons: a circular icon button *changes
                          shape when selected* (M3 makes a selected icon button a rounded
                          square), so toggling the picker morphed a circle into a squarish
                          blob. A 12dp rectangle has the same silhouette in both states —
                          nothing to morph — and pairs better with the field: three
                          rectangles in a row. */}
                      <div className="flex items-end gap-2">
                        <div className="relative shrink-0">
                          <IconButton
                            ref={emojiButtonRef}
                            onClick={toggleEmojiPicker}
                            aria-label="表情"
                            aria-expanded={showEmojiPicker}
                            aria-haspopup="dialog"
                            size="md"
                            className="touch-size rounded-l-lg rounded-r-xs"
                            shape="square"
                            variant="tonal"
                            /* No `size` on the glyph: `IconButton` sizes its own slot
                               (24dp at this step, `MediumIconButtonTokens.IconSize`). */
                            icon={<MdOutlineEmojiEmotions />}
                            /* `selected`, not a text-colour override: an open picker is
                               a toggle that is on, and `IconButton` answers that with
                               the container pair. It no longer answers it with a *shape*
                               change, because `shape="square"` fixes the silhouette in
                               both states — see the note above the row. `text-primary`
                               on a tonal container emitted a second ink over the
                               variant's own. */
                            selected={showEmojiPicker}
                          />
                          {/* Desktop: the app's one floating surface, anchored to its own
                              button. This used to be a hand-rolled panel whose elevation put
                              the emoji tray above `Select`'s menu and `Modal` alike;
                              `Popover` settles shape and elevation from the M3 scales.
                              `w-80` stays: it is what makes the emoji cells clear 44px (at
                              `w-72` they computed to 40.6px), and this is served to touch
                              devices from 640px up. */}
                          {isWide && (
                            <Popover
                              open={showEmojiPicker}
                              onClose={handleCloseEmojiPicker}
                              anchorRef={emojiButtonRef}
                              aria-label="表情"
                              matchAnchorWidth={false}
                              maxHeight={280}
                              estimatedHeight={280}
                              /* One wrapper, so the container morph does not
                                 stagger 36 emoji cells individually. */
                              animateChildren={false}
                              className="w-80 max-w-[calc(100vw-2rem)] p-2"
                            >
                              <div className="p-1">{emojiGrid}</div>
                            </Popover>
                          )}
                        </div>

                        <Textarea
                          ref={inputRef}
                          rows={1}
                          /* `sm` — 40dp under a pointer, 48 under a finger, which is
                             exactly what the two `IconButton`s beside it measure. At the
                             form-slot 56 the field stood 16px taller than them, and the
                             two accessories read as undersized rather than the field as
                             oversized. Both are true: the trio has to agree, and 40 is
                             the step a control beside a field takes. */
                          size="sm"
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          onKeyDown={handleKeyPress}
                          placeholder="输入消息…"
                          aria-label="输入消息"
                          /* `enterKeyHint` so the phone keyboard offers 发送 on a
                             field whose Enter sends, rather than a newline key. */
                          enterKeyHint="send"
                          fieldClassName="min-w-0 flex-1"
                          /* A composer is not a one-line field: as an `<input>` a long
                             message scrolled sideways inside a 40px box and you could not
                             read back what you had written — and Shift+Enter had nothing to
                             insert into. It grows with content up to
                             `COMPOSER_MAX_HEIGHT_PX`, then scrolls.
                             `resize-none` because a drag handle on a control that already
                             sizes itself is two mechanisms fighting over one height — and
                             it now actually wins: `cn` is a plain join, so this used to be
                             emitted *alongside* the primitive's own resize utility with the
                             stylesheet's order picking the survivor. `Textarea` stands its
                             default down when the call site names a resize. */
                          className="resize-none"
                          /* Not `disabled={sending}`: disabling a focused input blurs it,
                             which closed the keyboard on every message sent from a phone.
                             Double-submit is already blocked by `loading` on the button
                             below and the `sending` re-check inside `handleSendMessage`. */
                        />
                        {/* An `IconButton`, not a `Button`: a filled icon button is the
                            conventional send affordance, and the label is not lost —
                            `aria-label` names it and `IconButton` shows it as an M3
                            tooltip on hover. */}
                        <IconButton
                          onClick={handleSendMessage}
                          variant="filled"
                          size="md"
                          shape="square"
                          className="touch-size rounded-r-lg rounded-l-xs"
                          loading={sending}
                          disabled={!newMessage.trim()}
                          aria-label="发送"
                          icon={<MdSend />}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    size="pane"
                    icon={<MdOutlineChatBubbleOutline size={ICON.display} />}
                    title="选择一个联系人开始聊天"
                    className="flex-1"
                  />
                )}
              </div>
            </div>

            {/* Mobile: the same picker as a bottom sheet. A 288px popover above the input
                is most of a phone screen wide, anchored near the bottom edge, and it
                overflowed on the narrowest devices. A sheet is M3's answer and puts the
                grid under the thumb. */}
            {!isWide && emojiSheetMounted && (
              <Sheet
                isOpen={showEmojiPicker}
                onClose={handleCloseEmojiPicker}
                title="表情"
                bodyClassName="px-4"
              >
                {emojiGrid}
              </Sheet>
            )}
          </TabPane>
        </TabPanes>
      </div>
    </>
  );
}
