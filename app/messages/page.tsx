'use client';

import { Fragment, useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, Notification } from '@/lib/api';
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
  MdChevronLeft,
  MdChevronRight,
} from 'react-icons/md';
import { getEmojis } from '@/app/actions/getEmojis';
import TabBar from '@/components/TabBar';
import PageHeader from '@/components/PageHeader';
import { showToast } from '@/components/Toast';

interface Announcement {
  id: number;
  version: string;
  title: string;
  content: string;
  date: string;
}

import { Contact, Message } from '@/lib/api';
import Image from 'next/image';
import RichTextRenderer from '@/components/RichTextRenderer';
import Pagination from '@/components/Pagination';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { Input, Textarea } from '@/components/Input';
import Avatar from '@/components/Avatar';
import Badge, { CountBadge } from '@/components/Badge';
import ChatBubble, { markRuns } from '@/components/ChatBubble';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Sheet from '@/components/Sheet';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { readSnapshot, writeSnapshot } from '@/lib/pageCache';
import { useEscapeBack, useMediaQuery } from '@/lib/hooks';
import { MEDIA } from '@/lib/constants';
import { cn } from '@/lib/utils';
import Popover from '@/components/Popover';

type MessagesTab = 'announcement' | 'notification' | 'interaction' | 'chat';

/**
 * What is worth keeping when this page unmounts.
 *
 * Leaving for the gallery and coming back used to replay the whole first load:
 * four skeleton cards, then a 1600px jump as the real list arrived — and because
 * the route slide runs for 500ms, that jump happened *while the page was still
 * moving*. Measured on the way in: 616px tall with three skeletons at 109ms,
 * 2248px with none at 290ms.
 *
 * `tab` is in here for the same reason the gallery's page number is: coming back
 * to a different tab than the one you left is a refresh, whatever the network
 * did. Dropped wholesale on sign-out — see `clearSnapshots`.
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

const MESSAGES_KEY = 'messages';

/**
 * The 系统 and 互动 tabs, which were ~50 lines of identical markup each — same
 * row, same skeleton, same error block, same empty state — so a change to one
 * silently left the other behind.
 *
 * A component rather than a function called during render. That is not a style
 * preference: the retry callbacks close over `useCallback`s that read a ref
 * (`shown`), and React's lint rule cannot prove a callback handed to a plain
 * function call is only invoked later, whereas it can for a JSX prop. Making it
 * a component states the truth — these are props, not a render-time computation.
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
    return <EmptyState size="pane" icon={<MdNotificationsNone size={48} />} title={emptyTitle} />;
  }
  return (
    <div>
      {items.map((item) => (
        <div
          key={item.id}
          /* Unread is carried by the *container tone*, not by a `primary/5` wash.
             An alpha on a token has to be eyeballed once per scheme, and at 5% it
             was very nearly invisible in the dark one — so "unread" was being
             communicated by almost nothing. A container step plus a leading
             marker reads in both.

             That fix landed at `primary-container/40`, which is still an alpha,
             and the honest end of the same argument is a real step. This one is
             a *tone* step rather than the full `primary-container`: the rows are
             a stack, and a saturated pink row repeated twenty times down an
             inbox stops reading as "new" and starts reading as the list's
             background. The colour signal is already on the 4px leading marker
             beside it, which is the same device the contact list uses. */
          className={cn(
            'm3-row relative overflow-hidden p-5 transition-ui',
            item.is_read === 0 ? 'bg-surface-container-high' : 'bg-surface-container-low',
          )}
        >
          {item.is_read === 0 && (
            <span aria-hidden="true" className="bg-primary absolute inset-y-0 left-0 w-1" />
          )}
          <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <h3 className="text-title-m-emphasized text-on-surface min-w-0">
              {item.is_read === 0 && <span className="sr-only">未读：</span>}
              {item.title}
            </h3>
            <time className="text-body-s text-on-surface-variant shrink-0 tabular-nums">
              {item.created_at}
            </time>
          </div>
          <div className="text-on-surface-variant text-body-m">{item.content}</div>
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
        <div key={i} className="m3-row flex flex-col gap-2 bg-surface-container-low p-5">
          <Skeleton className="h-4 w-1/3" delay={i * 80} />
          <Skeleton className="h-3.5 w-full" delay={i * 80 + 60} />
          <Skeleton className="h-3.5 w-3/4" delay={i * 80 + 120} />
        </div>
      ))}
    </div>
  );
}

/**
 * A thread loads into a thread, not into a spinner.
 *
 * This pane was the last `<Spinner size="lg" />` standing in for a screen's
 * content. A centred dot says "something is happening somewhere" and then
 * reflows the whole pane when the bubbles land; alternating bubble-shaped bars
 * say "a conversation is arriving here", in the geometry it will arrive in.
 */
const THREAD_SKELETON_ROWS = [
  { own: false, width: 'w-40' },
  { own: false, width: 'w-24' },
  { own: true, width: 'w-32' },
  { own: false, width: 'w-52' },
  { own: true, width: 'w-20' },
] as const;

function ThreadSkeleton() {
  return (
    <div className="flex flex-1 flex-col justify-end gap-3" aria-hidden="true">
      {THREAD_SKELETON_ROWS.map((row, i) => (
        <div
          key={i}
          className={cn('flex items-end gap-2', row.own ? 'flex-row-reverse' : 'flex-row')}
        >
          <SkeletonCircle size={32} delay={i * 80} />
          <Skeleton className={cn('h-9 rounded-2xl', row.width)} delay={i * 80 + 40} />
        </div>
      ))}
    </div>
  );
}

/**
 * `'YYYY-MM-DD HH:MM:SS'` → a `Date`, without the engine's ISO-versus-local coin
 * flip. `new Date('2026-01-01 08:00:00')` is not a format the spec defines, so
 * whether it parses at all — and in which zone — is left to the engine.
 *
 * The values are rendered in whatever zone the API returns them in; this only
 * decides *how they are split up*, never what they mean, so it deliberately does
 * not shift them.
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
 * The clock under a run's last bubble.
 *
 * Every bubble used to print the raw `'2026-03-04 15:22:07'` the API returns —
 * 19 characters of `label-s` under a two-character message, with the date
 * repeated on every single turn. The date now lives once per day in a separator;
 * a bubble only needs the time.
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const toUserIdParam = searchParams.get('to');
  const snapshot = useState(() => readSnapshot<MessagesSnapshot>(MESSAGES_KEY))[0];
  const [activeTab, setActiveTab] = useState<MessagesTab>(snapshot?.value.tab ?? 'announcement');
  const [announcements, setAnnouncements] = useState<Announcement[]>(
    snapshot?.value.announcements ?? [],
  );
  const [notifications, setNotifications] = useState<Notification[]>(
    snapshot?.value.notifications ?? [],
  );
  const [contacts, setContacts] = useState<Contact[]>(snapshot?.value.contacts ?? []);
  const [contactQuery, setContactQuery] = useState('');
  /* Session state, not a stored preference: the rail is a "give the thread
     more room for a minute" control, and a collapsed sidebar that survives
     a reload is a sidebar people forget they collapsed. */
  const [contactsCollapsed, setContactsCollapsed] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiList, setEmojiList] = useState<string[]>([]);
  const [unreadCounts, setUnreadCounts] = useState({
    messages: 0,
    notifications: 0,
    interactions: 0,
  });
  const [interactionNotifications, setInteractionNotifications] = useState<Notification[]>(
    snapshot?.value.interactions ?? [],
  );
  const [interactionNotificationsPage, setInteractionNotificationsPage] = useState(
    snapshot?.value.interactionsPage ?? 1,
  );
  const [interactionNotificationsTotalPages, setInteractionNotificationsTotalPages] = useState(
    snapshot?.value.interactionsTotalPages ?? 1,
  );
  /* Tabs whose contents are already on screen. A tab in here still refetches on
     arrival — the inbox is exactly the thing that goes out of date — but it does
     it underneath what is showing rather than behind a skeleton. */
  const shown = useRef(
    new Set<MessagesTab>(snapshot && !snapshot.stale ? [snapshot.value.tab] : []),
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /* The composer's height follows its content. `auto` first, because
     `scrollHeight` on an element that is already tall enough reports the height
     it currently has, so measuring without resetting only ever grows — deleting
     a line would leave the box where it was. Layout effect, not effect: this
     runs in the same commit as the keystroke, so the box never paints at the
     wrong height for a frame. */
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
  }, [newMessage, selectedContact]);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  /* Which enclosure the emoji picker gets. `sm` rather than `md`: the picker is
     anchored to a control inside the thread pane, and the thread only becomes a
     side-by-side column at `md` — but the popover is already comfortable at 640,
     and reaching for a sheet on a landscape phone would cover the message you
     are replying to. */
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

  const fetchUnreadCounts = useCallback(async () => {
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) return;
      const user = JSON.parse(storedUser);
      const data = await api.getUnreadCounts(user.token);
      if (data.success) {
        setUnreadCounts({
          messages: data.unread_messages,
          notifications: data.unread_notifications,
          interactions: data.unread_interactions,
        });
        const event = new CustomEvent('unread_counts_updated');
        window.dispatchEvent(event);
      }
    } catch (err) {
      console.error('获取未读数量失败', err);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchUnreadCounts();
    });
  }, [fetchUnreadCounts]);

  useEffect(() => {
    const loadEmojis = async () => {
      const emojis = await getEmojis();
      setEmojiList(emojis);
    };
    loadEmojis();
  }, []);

  useEffect(() => {
    if (!toUserIdParam) return;

    const targetId = parseInt(toUserIdParam, 10);
    if (isNaN(targetId)) return;

    queueMicrotask(() => setActiveTab('chat'));

    const timer = setTimeout(async () => {
      const existing = contacts.find((c) => c.id === targetId);
      if (existing) {
        setSelectedContact(existing);
        return;
      }

      try {
        const storedUser = localStorage.getItem('user_info');
        if (!storedUser) return;

        const res = await api.getUserProfile(String(targetId));
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
          setSelectedContact(tempContact);
        }
      } catch (err) {
        console.error('获取用户信息失败', err);
      }
    }, 500);

    return () => clearTimeout(timer);
    // contacts intentionally omitted: only re-run when deep-link target changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toUserIdParam]);

  /* `Popover` (desktop) and `Sheet` (phone) both hold themselves in the tree
     until their own exit has played, so closing is a plain state flip. This
     used to be a manual `isEmojiPickerClosing` flag plus a 200ms `setTimeout`
     that had to be kept in step with a CSS keyframe by hand — and a second
     document-level mousedown listener duplicating what both primitives already
     do. */
  const handleCloseEmojiPicker = () => setShowEmojiPicker(false);

  /* Straight to the gallery, not `history.back()`. /messages sits on the row
     above / on the app's notional plane (see `ROUTE_CELL` in routeCrossFade),
     so leaving it is a move down to the gallery no matter which screen the user
     arrived from — stepping back onto a forum post played that down-move onto
     something that is not below it. */
  const handleBack = useCallback(() => {
    if (selectedContact) {
      setSelectedContact(null);
      return;
    }
    router.push('/');
  }, [router, selectedContact]);

  /* Escape leaves the page. Stood down with the emoji picker open — that is the
     nearer thing to dismiss. Inside a conversation `handleBack` already backs
     out to the contact list first, so both controls agree. */
  useEscapeBack(handleBack, !showEmojiPicker);

  const toggleEmojiPicker = () => setShowEmojiPicker((open) => !open);

  /* `silent` on every loader, not just `fetchContacts`: the refresh that happens
     on arrival with a snapshot already showing must not blank the list back to
     skeletons, and must not replace something correct with an error banner if
     the network is down. */
  const fetchAnnouncements = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await api.getAnnouncementHistory();
      if (data.success) {
        shown.current.add('announcement');
        setAnnouncements(data.announcements);
      } else if (!silent) {
        setError('获取公告失败');
      }
    } catch (err) {
      if (!silent) setError('网络请求失败');
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchNotifications = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const storedUser = localStorage.getItem('user_info');
        if (!storedUser) {
          if (!silent) setError('请先登录');
          return;
        }
        const user = JSON.parse(storedUser);
        const data = await api.getNotifications(user.token);
        if (data.success) {
          shown.current.add('notification');
          setNotifications(data.notifications);
          fetchUnreadCounts();
        } else if (!silent) {
          setError('获取通知失败');
        }
      } catch (err) {
        if (!silent) setError('网络请求失败');
        console.error(err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [fetchUnreadCounts],
  );

  const fetchInteractionNotifications = useCallback(
    async (page: number = 1, silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const storedUser = localStorage.getItem('user_info');
        if (!storedUser) {
          if (!silent) setError('请先登录');
          return;
        }
        const user = JSON.parse(storedUser);
        const data = await api.getInteractionNotifications(user.token, page);
        if (data.success) {
          shown.current.add('interaction');
          setInteractionNotifications(data.notifications);
          setInteractionNotificationsTotalPages(data.total_pages);
          setInteractionNotificationsPage(page);
          fetchUnreadCounts();
        } else if (!silent) {
          setError('获取互动通知失败');
        }
      } catch (err) {
        if (!silent) setError('网络请求失败');
        console.error(err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [fetchUnreadCounts],
  );

  const fetchContacts = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) {
        if (!silent) setError('请先登录');
        return;
      }
      const user = JSON.parse(storedUser);
      const data = await api.getRecentContacts(user.token);
      if (data.success) {
        shown.current.add('chat');
        setContacts(data.contacts);
      } else {
        if (!silent) setError('获取联系人失败');
      }
    } catch (err) {
      if (!silent) setError('网络请求失败');
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchMessages = useCallback(
    async (contactId: number, silent = false) => {
      if (!silent) setLoadingMessages(true);
      try {
        const storedUser = localStorage.getItem('user_info');
        if (!storedUser) return;
        const user = JSON.parse(storedUser);
        const data = await api.getMessages(user.token, contactId);
        if (data.success) {
          setMessages(data.messages);
          fetchUnreadCounts();
          fetchContacts(true);
        } else {
          /* `if (data.success)` with no else left the *previous* contact's bubbles
             on screen under the new contact's name and avatar — the worst possible
             failure mode for a private thread. Clearing is the honest state, and
             the toast is the only signal the user gets. */
          setMessages([]);
          showToast('聊天记录加载失败', 'error');
        }
      } catch (err) {
        console.error('获取聊天记录失败', err);
        setMessages([]);
        showToast('网络错误，无法加载聊天记录', 'error');
      } finally {
        setLoadingMessages(false);
      }
    },
    [fetchUnreadCounts, fetchContacts],
  );

  useEffect(() => {
    /* A tab that already has something on screen — restored from the snapshot,
       or simply loaded earlier this mount — refreshes silently. Only a tab with
       nothing to show is allowed to put up a skeleton.
       `shown` is added to by the loaders on delivery, never here. Marking a tab
       as seen when its request goes out means StrictMode's remount finds it
       already marked, refreshes silently, and never clears `loading` — a
       permanent skeleton. */
    const silent = shown.current.has(activeTab);
    // Defer so loaders' sync setState is not in the effect body
    queueMicrotask(() => {
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
  }, [
    activeTab,
    fetchAnnouncements,
    fetchNotifications,
    fetchInteractionNotifications,
    fetchContacts,
  ]);

  /* One writer for the whole snapshot rather than a write threaded through each
     loader. Held back while the first load is in flight and while an error is
     showing, so an empty or failed screen is never what a later visit restores. */
  useEffect(() => {
    if (loading || error) return;
    writeSnapshot<MessagesSnapshot>(MESSAGES_KEY, {
      tab: activeTab,
      announcements,
      notifications,
      interactions: interactionNotifications,
      interactionsPage: interactionNotificationsPage,
      interactionsTotalPages: interactionNotificationsTotalPages,
      contacts,
    });
  }, [
    loading,
    error,
    activeTab,
    announcements,
    notifications,
    interactionNotifications,
    interactionNotificationsPage,
    interactionNotificationsTotalPages,
    contacts,
  ]);

  useEffect(() => {
    if (selectedContact) {
      queueMicrotask(() => {
        void fetchMessages(selectedContact.id);
      });
    }
  }, [selectedContact, fetchMessages]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedContact || sending) return;

    setSending(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) {
        showToast('请先登录', 'error');
        return;
      }
      const user = JSON.parse(storedUser);

      const res = await api.sendMessage(user.token, selectedContact.id, newMessage.trim());
      const data = await res.json();

      if (data.success) {
        setNewMessage('');
        fetchMessages(selectedContact.id, true);
      } else {
        /* Both failure paths used to `console.error` and stop there — no toast, no
           failed state, nothing in the thread. The message simply did not appear
           and the user had no way to tell whether it had been sent. The typed text
           is deliberately left in the field so it can be retried without being
           retyped. */
        showToast(data.message || '发送失败，请重试', 'error');
      }
    } catch (err) {
      console.error('发送消息出错:', err);
      showToast('网络错误，消息未发送', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    /* `isComposing` is the important half on a Chinese-language board. An IME
       uses Enter to commit the current pinyin candidate, and that keydown reaches
       React with `isComposing: true` — so without this guard, pressing Enter to
       choose a character sent the half-composed string as a message instead. It
       is the most likely defect a user of this screen actually hits. */
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

      setTimeout(() => {
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

    /* Split on the emoji markers and render the pieces as one inline flow.
     *
     * Both halves of that used to be block-level and it showed. The text runs
     * went through `RichTextRenderer` unqualified, so each one came back as a
     * `<div class="rich-text-content"><p>…</p></div>`; the emoji went through
     * `FadeInImage`, which wraps every picture in a `relative flex h-full w-full`
     * div because it is built for a *media box* that has already been sized.
     * So "你好 🐴 再见" rendered as three stacked lines with the emoji alone in
     * the middle of a full-width block, and a long message broke wherever an
     * emoji happened to fall rather than at the bubble's edge.
     *
     * `inline` on the renderer drops the paragraph, and a plain `next/image`
     * replaces the fade wrapper — a 24px local glyph has nothing to fade in
     * from, and a shimmer under it would be larger than the emoji. */
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

  /* Emoji grid, shared by the desktop popover and the mobile sheet. Two
     enclosures, one control — the picker itself must not differ between them. */
  const emojiGrid = (
    <div className="grid grid-cols-6 gap-1">
      {emojiList.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => handleEmojiClick(emoji)}
          title={emoji}
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

  /* Case-insensitive substring on the display name, which is the only field
     the row shows. Local, not a request: the contact list is already in memory
     and small, so a round trip would make typing feel slower than reading. */
  const visibleContacts = contactQuery.trim()
    ? contacts.filter((c) =>
        c.username.toLowerCase().includes(contactQuery.trim().toLowerCase()),
      )
    : contacts;

  /* Keyed on `sender_id`, not on `sender_name`. A thread has exactly two
     participants and the id is the fact; the display name is a label that two
     accounts can share and that its owner can change mid-thread, at which point
     every message before the change joined the wrong run. A run also ends at a
     day boundary and at a five-minute pause — see `markRuns`. */
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

        <TabBar
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

        {/* The panes slide on the shared axis, like every other tab set in the
            app. This used to be `<div key={activeTab} className="animate-page-
            transition">` — a remount plus a 12px fade, which is a different
            motion from the gallery/forum switch and from the profile tabs, and
            which threw away each tab's scroll position and fetched data on every
            switch because the `key` tore the subtree down. */}
        <TabPanes value={activeTab}>
          <TabPane value="announcement">
            {loading ? (
              <MessageRowsSkeleton />
            ) : error ? (
              <ErrorRetry
                size="pane"
                title="公告加载失败"
                message={error}
                onRetry={() => fetchAnnouncements()}
              />
            ) : announcements.length === 0 ? (
              <EmptyState size="pane" icon={<MdCampaign size={48} />} title="暂无公告" />
            ) : (
              <div>
                {announcements.map((item) => (
                  <div key={item.id} className="m3-row bg-surface-container-low p-5">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="flex min-w-0 items-center gap-3">
                        {/* Was a hand-rolled `bg-primary` at 10% with `text-primary`
                            pill; a version tag is a mark, so it is a `Badge`. */}
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
                    {/* `text-body-m`, not `text-label-l leading-relaxed`. A label
                        role is for a control's name, and `leading-relaxed`
                        overrode the body line-height that is *already* loosened
                        for Han glyphs — so this one block of prose was set looser
                        than every other paragraph in the app. */}
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
              loading={loading}
              error={error}
              onRetry={() => fetchNotifications()}
              emptyTitle="暂无系统消息"
            />
          </TabPane>

          <TabPane value="interaction">
            <NotificationPane
              items={interactionNotifications}
              loading={loading}
              error={error}
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
            {/* `dvh` minus the chrome above it, as one calc rather than the
                previous `h-[calc(100dvh-200px)] md:h-[600px]` pair — 200 was a
                guess, and a fixed 600 on a tall desktop window left it floating
                in half the space. `min-h` keeps the thread usable when a phone
                keyboard is up and `dvh` collapses. */}
            {/* `rounded-md` (12dp): this is a section surface, and the 28dp step
                belongs to a dialog, a sheet or a chat *bubble*. At 28dp the frame's
                `overflow-hidden` also clipped the first and last contact rows'
                corners against a curve they did not share.

                `md:min-h-[26rem]`, not an unconditional floor: with the phone
                keyboard up `100dvh` collapses to roughly 350px, the calc goes
                negative and the 416px minimum wins — so the frame became taller
                than the visual viewport and its bottom-docked composer sat behind
                the keyboard. Below `md` the `dvh` unit should track the keyboard,
                which is the whole reason to use it. */}
            <div className="bg-surface-container flex h-[calc(100dvh-13rem)] overflow-hidden rounded-md md:h-[38rem] md:min-h-[26rem]">
              {/* — Contact list — */}
              <div
                className={cn(
                  'w-full flex-col transition-[width] duration-300 ease-[var(--ease-standard)]',
                  /* One branch or the other, never both: `cn` is a plain join,
                     so emitting `md:w-72` and `md:w-20` together left Tailwind's
                     output order to pick — and it picks the larger, so the rail
                     collapsed its contents and kept its width.
                     18rem expanded, down from 20: the row holds a 48px portrait,
                     a name and a time, and 320px left the name ending a third of
                     the way across. 5rem collapsed is the same rows in the same
                     order, without the words. */
                  contactsCollapsed ? 'md:w-20' : 'md:w-72',
                  selectedContact ? 'hidden md:flex' : 'flex',
                )}
              >
                <div className={cn('flex items-center gap-2 p-3', contactsCollapsed && 'md:px-2')}>
                  {/* This was a fully-styled field with no `value`, no
                      `onChange` and no filtering behind it — a control that
                      looked live, took focus, accepted typing and did nothing
                      with it. */}
                  {!contactsCollapsed && (
                    <Input
                      type="search"
                      icon={<MdSearch size={18} />}
                      placeholder="搜索昵称发起私信..."
                      value={contactQuery}
                      onChange={(e) => setContactQuery(e.target.value)}
                      aria-label="搜索联系人"
                      fieldClassName="min-w-0 flex-1"
                    />
                  )}
                  {/* Below `md` the list and the thread are the same column and
                      swap, so there is nothing beside this to make room for —
                      collapsing it there would only hide the search. */}
                  <IconButton
                    onClick={() => setContactsCollapsed((v) => !v)}
                    aria-label={contactsCollapsed ? '展开联系人列表' : '收起联系人列表'}
                    aria-expanded={!contactsCollapsed}
                    title={contactsCollapsed ? '展开联系人列表' : '收起联系人列表'}
                    className="max-md:hidden mx-auto"
                    icon={
                      contactsCollapsed ? (
                        <MdChevronRight size={22} />
                      ) : (
                        <MdChevronLeft size={22} />
                      )
                    }
                  />
                </div>
                <div className="popover-scrollbar flex-1 overflow-y-auto p-2">
                  {loading && contacts.length === 0 ? (
                    <div className="flex flex-col gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="flex items-center gap-3 p-2">
                          <SkeletonCircle size={48} delay={i * 80} />
                          <div className="flex min-w-0 flex-1 flex-col gap-2">
                            <Skeleton className="h-4 w-3/4" delay={i * 80 + 40} />
                            <Skeleton className="h-3 w-1/2" delay={i * 80 + 80} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : error ? (
                    <ErrorRetry
                      size="inline"
                      title="联系人加载失败"
                      message={error}
                      onRetry={() => fetchContacts()}
                    />
                  ) : contacts.length === 0 ? (
                    <EmptyState
                      size="inline"
                      icon={<MdOutlineChatBubbleOutline size={32} />}
                      title="还没有任何私信"
                    />
                  ) : visibleContacts.length === 0 ? (
                    /* A filter that matches nothing is a different state from
                       having no contacts at all, and saying "还没有任何私信"
                       there would be a lie. */
                    <EmptyState
                      size="inline"
                      icon={<MdSearchOff size={32} />}
                      title="没有匹配的联系人"
                    />
                  ) : (
                    visibleContacts.map((contact) => {
                      const active = selectedContact?.id === contact.id;
                      return (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => setSelectedContact(contact)}
                          aria-current={active ? 'true' : undefined}
                          title={contactsCollapsed ? contact.username : undefined}
                          data-ripple
                          /* A list row in the shape the rest of the app uses:
                             `rounded-full` like the sidebar's nav rows, the M3
                             state layer for hover and press instead of a
                             hand-picked `hover:bg-[var(--sidebar-hover)]` — which
                             reached for a *legacy alias* through an arbitrary
                             value — and the selected row on the secondary
                             container pair rather than on the hover colour, so
                             "selected" and "hovered" stop looking identical.
                             The `mb-4` between rows is gone: 16px between items
                             in a list makes four contacts look like four cards. */
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-3 rounded-full p-2 text-left outline-none',
                            'transition-ui focus-visible:ring-2 focus-ring',
                            contactsCollapsed && 'md:justify-center md:gap-0',
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
                          {/* The name and the time are what the rail drops.
                              `md:hidden` rather than unmounted, so collapsing
                              does not tear the row's subtree down and back up on
                              every toggle. */}
                          <div className={cn('min-w-0 flex-1', contactsCollapsed && 'md:hidden')}>
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
                        onClick={() => setSelectedContact(null)}
                        aria-label="返回联系人列表"
                        icon={<MdArrowBack size={20} />}
                        className="md:hidden"
                      />
                      <Avatar
                        src={selectedContact.avatar}
                        name={selectedContact.username}
                        size={36}
                        className="max-md:hidden"
                      />
                      <span className="text-title-m text-on-surface min-w-0 truncate">
                        {selectedContact.username}
                      </span>
                      <IconButton
                        onClick={() => fetchMessages(selectedContact.id)}
                        disabled={loadingMessages}
                        aria-label="刷新消息"
                        className="ms-auto"
                        icon={
                          <MdRefresh size={22} className={loadingMessages ? 'animate-spin' : ''} />
                        }
                      />
                    </div>

                    <div
                      ref={messagesContainerRef}
                      className="popover-scrollbar flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-4"
                    >
                      {loadingMessages ? (
                        <ThreadSkeleton />
                      ) : messages.length === 0 ? (
                        <EmptyState
                          size="inline"
                          icon={<MdOutlineChatBubbleOutline size={32} />}
                          title="还没有消息，说点什么吧"
                          className="flex-1"
                        />
                      ) : (
                        runs.map(({ item: msg, endOfRun }, i) => {
                          const isMe = msg.sender_id !== selectedContact.id;
                          const previous = i > 0 ? runs[i - 1].item : null;
                          const startsDay =
                            !previous || dayKey(previous.created_at) !== dayKey(msg.created_at);
                          return (
                            <Fragment key={msg.id}>
                              {/* One date per day, in the thread, where the
                                  conversation actually turns over — rather than
                                  the same 19-character stamp repeated under every
                                  bubble. `role="separator"` because that is what
                                  it is: a break in the list, not an entry in it. */}
                              {startsDay && (
                                <div
                                  role="separator"
                                  className="text-label-s text-on-surface-variant my-3 flex items-center gap-3 first:mt-0"
                                >
                                  <span className="bg-outline-variant h-px flex-1" />
                                  <span className="shrink-0">{dayLabel(msg.created_at)}</span>
                                  <span className="bg-outline-variant h-px flex-1" />
                                </div>
                              )}
                              <ChatBubble
                                own={isMe}
                                endOfRun={endOfRun}
                                /* Avatar and timestamp only on the last bubble of a
                                   run. Every message used to carry both, so four
                                   messages in a row showed the same 32px portrait
                                   four times under four separate timestamps and
                                   read as four separate turns. */
                                timestamp={endOfRun ? messageClock(msg.created_at) : undefined}
                                status={
                                  isMe && msg.id === lastOwnMessageId ? (
                                    <span className={msg.is_read ? 'text-primary' : undefined}>
                                      {msg.is_read ? '已读' : '已送达'}
                                    </span>
                                  ) : undefined
                                }
                                avatar={
                                  endOfRun ? (
                                    <Avatar
                                      src={msg.sender_avatar}
                                      name={msg.sender_name}
                                      size={32}
                                    />
                                  ) : undefined
                                }
                                /* A run is tight inside and separated outside, which
                                   is the other half of what makes runs read as
                                   turns rather than as a stack. */
                                className={endOfRun ? 'mb-3 last:mb-0' : ''}
                              >
                                {renderMessageContent(msg.content)}
                              </ChatBubble>
                            </Fragment>
                          );
                        })
                      )}
                    </div>

                    {/* `sm:p-4`, not `sm:px-4 sm:pb-4`: the top edge was left at
                        `pt-3` while the other three went to 16px, so the composer's
                        top padding was 4px short of its own sides.

                        The safe-area inset is what every other bottom-docked
                        surface in this app already does (`Sheet`, the drawer, the
                        tab bar): on a phone this row sits at the bottom of the
                        viewport, over the home indicator. */}
                    <div className="bg-surface-container relative p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
                      <div className="flex items-end gap-2">
                        <div className="relative shrink-0">
                          <IconButton
                            ref={emojiButtonRef}
                            onClick={toggleEmojiPicker}
                            aria-label="表情"
                            aria-expanded={showEmojiPicker}
                            aria-haspopup="dialog"
                            icon={<MdOutlineEmojiEmotions size={24} />}
                            className={showEmojiPicker ? 'text-primary' : undefined}
                          />
                          {/* Desktop: the app's one floating surface, anchored to
                              its own button.
                              This used to be a hand-rolled panel with its own
                              keyframes and its own elevation — `shadow-e3`, which
                              put the emoji picker above `Select`'s menu AND above
                              `Modal`, i.e. the highest-floating thing in the app
                              was the emoji tray. It also carried a comment
                              asserting "a menu is 8dp" directly against `Select`'s
                              comment asserting 4dp; `Popover` settles both from
                              the M3 shape and elevation scales.
                              `w-80` stays: it is what makes the emoji cells clear
                              44px (at `w-72` they computed to 40.6px), and this is
                              served to touch devices from 640px up. */}
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
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          onKeyDown={handleKeyPress}
                          placeholder="输入消息..."
                          aria-label="输入消息"
                          /* `enterKeyHint` so the phone keyboard offers 发送 on a
                             field whose Enter sends, rather than a newline key. */
                          enterKeyHint="send"
                          fieldClassName="min-w-0 flex-1"
                          /* A composer is not a one-line field. As an `<input>`
                             a long message scrolled sideways inside a 40px box,
                             so you could not read back what you had written —
                             and Shift+Enter, which the send handler has always
                             deliberately let through, had nothing to insert into.
                             It grows with its content up to `COMPOSER_MAX_HEIGHT_PX`
                             and then scrolls, which is what every chat composer
                             does.
                             `resize-none` because a drag handle on a control that
                             already sizes itself is two mechanisms fighting over
                             one height — and it now actually wins: `cn` is a plain
                             join, so this used to be emitted *alongside* the
                             primitive's own vertical-resize utility with the
                             stylesheet's order picking the survivor. `Textarea`
                             stands its default down when the call site names a
                             resize, the same way `Skeleton` does for a radius. */
                          className="resize-none"
                          /* Not `disabled={sending}`: disabling a focused input
                             blurs it, which closed the keyboard on every single
                             message sent from a phone. The double-submit is
                             already blocked by `loading` on the button below and
                             by the `sending` re-check inside `handleSendMessage`.

                             The `rounded-full border-none` that used to be here
                             emitted a second radius against the primitive's own
                             and killed the outline the focus state depends on. A
                             pill composer would have to be a variant inside
                             `Input`, not an override at the call site. */
                        />
                        <Button
                          onClick={handleSendMessage}
                          variant="filled"
                          loading={sending}
                          disabled={!newMessage.trim()}
                          responsiveLabel
                          icon={<MdSend size={18} />}
                        >
                          发送
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    size="pane"
                    icon={<MdOutlineChatBubbleOutline size={48} />}
                    title="选择一个联系人开始聊天"
                    className="flex-1"
                  />
                )}
              </div>
            </div>

            {/* Mobile: the same picker as a bottom sheet. A 288px popover above
                the input is most of a phone screen wide, anchored to a 40dp
                button near the bottom edge, and it overflowed on the narrowest
                devices — `max-w-[calc(100vw-2rem)]` was the tell. A sheet is
                M3's answer and puts the grid under the thumb. */}
            {!isWide && (
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
