'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, Notification } from '@/lib/api';
import {
  MdOutlineChatBubbleOutline,
  MdOutlineEmojiEmotions,
  MdRefresh,
  MdArrowBack,
  MdSearch,
} from 'react-icons/md';
import { getEmojis } from '@/app/actions/getEmojis';
import Spinner from '@/components/Spinner';
import TabBar from '@/components/TabBar';

interface Announcement {
  id: number;
  version: string;
  title: string;
  content: string;
  date: string;
}

import { Contact, Message } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';
import RichTextRenderer from '@/components/RichTextRenderer';
import Pagination from '@/components/Pagination';
import Skeleton from '@/components/Skeleton';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { Input } from '@/components/Input';
import { readSnapshot, writeSnapshot } from '@/lib/pageCache';
import PageBack from '@/components/PageBack';
import { useEscapeBack } from '@/lib/hooks';

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
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loading, setLoading] = useState(!snapshot);
  const [error, setError] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isEmojiPickerClosing, setIsEmojiPickerClosing] = useState(false);
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
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

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

  const handleCloseEmojiPicker = () => {
    setIsEmojiPickerClosing(true);
    setTimeout(() => {
      setShowEmojiPicker(false);
      setIsEmojiPickerClosing(false);
    }, 200);
  };

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
  useEscapeBack(handleBack, !showEmojiPicker && !isEmojiPickerClosing);

  const toggleEmojiPicker = () => {
    if (showEmojiPicker) {
      handleCloseEmojiPicker();
    } else {
      setShowEmojiPicker(true);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        if (showEmojiPicker && !isEmojiPickerClosing) {
          handleCloseEmojiPicker();
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker, isEmojiPickerClosing]);

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
      setCurrentUsername(user.username);
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
        if (!currentUsername) setCurrentUsername(user.username);
        const data = await api.getMessages(user.token, contactId);
        if (data.success) {
          setMessages(data.messages);
          fetchUnreadCounts();
          fetchContacts(true);
        }
      } catch (err) {
        console.error('获取聊天记录失败', err);
      } finally {
        setLoadingMessages(false);
      }
    },
    [currentUsername, fetchUnreadCounts, fetchContacts],
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
      if (!storedUser) return;
      const user = JSON.parse(storedUser);

      const res = await api.sendMessage(user.token, selectedContact.id, newMessage.trim());
      const data = await res.json();

      if (data.success) {
        setNewMessage('');
        fetchMessages(selectedContact.id, true);
      } else {
        console.error('发送消息失败:', data.message);
      }
    } catch (err) {
      console.error('发送消息出错:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

    // Check if content has emoji markers
    const emojiRegex = /\$emoji_[a-zA-Z0-9_]+\$/g;
    if (!emojiRegex.test(content)) {
      // No emoji — just use RichTextRenderer directly
      return <RichTextRenderer content={content} />;
    }

    // Reset regex state after .test()
    emojiRegex.lastIndex = 0;

    // Has emoji — split and render each part
    const parts = content.split(/(\$emoji_[a-zA-Z0-9_]+\$)/g);
    const elements: React.ReactNode[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const match = part.match(/^\$emoji_([a-zA-Z0-9_]+)\$$/);
      if (match) {
        elements.push(
          <FadeInImage
            key={`e${i}`}
            src={`/img/emoji/${match[1]}.png`}
            alt={match[1]}
            width={24}
            height={24}
            className="inline-block w-6 h-6 align-middle mx-0.5"
          />,
        );
      } else if (part) {
        elements.push(
          <span key={`t${i}`} className="inline">
            <RichTextRenderer content={part} />
          </span>,
        );
      }
    }

    return <>{elements}</>;
  };

  return (
    <>
      {/* Same affordance, same pixel, same key as every other full-screen view.
          Outside the centred wrapper on purpose — see `PageBack`. */}
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <div className="max-w-4xl mx-auto pt-14">
        <h1 className="text-headline-s text-on-surface mb-6">消息</h1>

        <TabBar
          className="mb-3"
          value={activeTab}
          onChange={(v) => setActiveTab(v)}
          tabs={[
            { value: 'announcement' as const, label: '公告' },
            { value: 'notification' as const, label: '系统', badge: unreadCounts.notifications },
            { value: 'interaction' as const, label: '互动', badge: unreadCounts.interactions },
            { value: 'chat' as const, label: '私信', badge: unreadCounts.messages },
          ]}
        />

        <div className="min-h-[400px] relative">
          <div key={activeTab} className="animate-page-transition">
            {activeTab === 'chat' ? (
              <div className="bg-surface-container rounded-2xl overflow-hidden flex h-[calc(100dvh-200px)] md:h-[600px]">
                <div
                  className={`w-full md:w-80 flex-col ${selectedContact ? 'hidden md:flex' : 'flex'}`}
                >
                  <div className="p-3">
                    <Input
                      type="text"
                      icon={<MdSearch size={18} />}
                      placeholder="搜索昵称发起私信..."
                    />
                  </div>
                  <div className="popover-scrollbar flex-1 overflow-y-auto p-4">
                    {loading && contacts.length === 0 ? (
                      <div className="space-y-1">
                        {[1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className="flex items-center justify-start w-full p-2 gap-1.5 mb-4"
                          >
                            <div className="relative">
                              <Skeleton
                                style={{ animationDelay: `${i * 80}ms` }}
                                className="skeleton w-12 h-12 rounded-full"
                              />
                            </div>
                            <div className="flex-1 min-w-0 space-y-2">
                              <Skeleton
                                style={{ animationDelay: `${i * 80 + 40}ms` }}
                                className="skeleton h-4 rounded w-3/4"
                              />
                              <Skeleton
                                style={{ animationDelay: `${i * 80 + 80}ms` }}
                                className="skeleton h-3 rounded w-1/2"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : error ? (
                      <div className="text-center text-outline text-body-m pt-6">{error}</div>
                    ) : contacts.length > 0 ? (
                      contacts.map((contact) => (
                        <button
                          key={contact.id}
                          onClick={() => setSelectedContact(contact)}
                          className={`flex items-center justify-start text-left w-full p-2 gap-1.5 mb-4 transition-ui ${
                            selectedContact?.id === contact.id
                              ? 'bg-[var(--sidebar-hover)]'
                              : 'hover:bg-[var(--sidebar-hover)]'
                          }`}
                        >
                          <div className="relative">
                            <div className="w-12 h-12 rounded-full overflow-hidden bg-surface-container-high">
                              {contact.avatar ? (
                                <FadeInImage
                                  src={`https://picpony.top/${contact.avatar}`}
                                  alt={contact.username}
                                  width={48}
                                  height={48}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-outline bg-surface-container-highest">
                                  {contact.username[0].toUpperCase()}
                                </div>
                              )}
                            </div>
                            {contact.unread_count > 0 && (
                              <div className="absolute -top-1 -right-1 bg-error-fill text-on-fill text-label-s-emphasized px-1.5 py-0.5 rounded-full">
                                {contact.unread_count}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-baseline">
                              <h4 className="text-on-surface truncate text-label-l-emphasized">
                                {contact.username}
                              </h4>
                            </div>
                            <p className="text-body-s text-on-surface-variant truncate mt-1">
                              {contact.last_msg_time}
                            </p>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="text-center text-outline text-body-m pt-6">滚木</div>
                    )}
                  </div>
                </div>

                <div
                  className={`flex-1 flex-col bg-surface-container-low/30 ${!selectedContact ? 'hidden md:flex' : 'flex'}`}
                >
                  {selectedContact ? (
                    <>
                      <div className="p-4 bg-surface-container flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <IconButton
                            onClick={() => setSelectedContact(null)}
                            aria-label="返回联系人列表"
                            icon={<MdArrowBack size={20} />}
                            className="md:hidden -ml-2"
                          />
                          <span className="text-title-m text-on-surface">
                            {selectedContact.username}
                          </span>
                        </div>
                      </div>
                      <div
                        ref={messagesContainerRef}
                        className="popover-scrollbar flex-1 p-4 overflow-y-auto flex flex-col space-y-4"
                      >
                        {loadingMessages ? (
                          <div className="flex-1 flex items-center justify-center">
                            <Spinner size="lg" />
                          </div>
                        ) : messages.length > 0 ? (
                          messages.map((msg) => {
                            const isMe = currentUsername
                              ? msg.sender_name === currentUsername
                              : msg.sender_id !== selectedContact?.id;
                            return (
                              <div
                                key={msg.id}
                                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                              >
                                <div
                                  className={`flex max-w-[70%] ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}
                                >
                                  <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-surface-container-high">
                                    {msg.sender_avatar ? (
                                      <FadeInImage
                                        src={`https://picpony.top/${msg.sender_avatar}`}
                                        alt={msg.sender_name}
                                        width={32}
                                        height={32}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-outline text-body-s bg-surface-container-highest">
                                        {msg.sender_name[0].toUpperCase()}
                                      </div>
                                    )}
                                  </div>
                                  <div
                                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                                  >
                                    <span className="text-label-s text-outline mb-1 px-1">
                                      {msg.created_at}
                                    </span>
                                    <div
                                      className={`px-4 py-2 rounded-2xl text-body-m ${
                                        isMe
                                          ? 'bg-primary text-on-primary rounded-br-sm'
                                          : 'bg-surface-container-lowest text-on-surface rounded-bl-sm'
                                      }`}
                                    >
                                      {renderMessageContent(msg.content)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-outline">
                            <p>滚木</p>
                          </div>
                        )}
                      </div>
                      <div className="px-4 pb-4 pt-1 bg-surface-container relative">
                        <div className="flex items-center justify-between mb-1">
                          <div className="relative" ref={emojiPickerRef}>
                            <IconButton
                              onClick={toggleEmojiPicker}
                              aria-label="表情"
                              aria-expanded={showEmojiPicker}
                              icon={<MdOutlineEmojiEmotions size={24} />}
                              className={showEmojiPicker ? 'text-primary' : undefined}
                            />

                            {(showEmojiPicker || isEmojiPickerClosing) && (
                              <div
                                className={`absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-2rem)] bg-surface-container rounded-sm shadow-e4 z-50 p-2 origin-bottom-left ${isEmojiPickerClosing ? 'emoji-picker-animate-out' : 'emoji-picker-animate-in'}`}
                              >
                                <div className="grid grid-cols-5 sm:grid-cols-6 gap-2 popover-scrollbar max-h-60 overflow-y-auto p-1">
                                  {emojiList.map((emoji) => (
                                    <button
                                      key={emoji}
                                      onClick={() => handleEmojiClick(emoji)}
                                      className="touch-target p-1 hover:bg-surface-container-high rounded transition-ui flex items-center justify-center"
                                      title={emoji}
                                    >
                                      <FadeInImage
                                        src={`/img/emoji/${emoji}.png`}
                                        alt={emoji}
                                        width={32}
                                        height={32}
                                        className="w-8 h-8 object-contain"
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <IconButton
                            onClick={() => fetchMessages(selectedContact.id)}
                            disabled={loadingMessages}
                            aria-label="刷新消息"
                            icon={
                              <MdRefresh
                                size={24}
                                className={loadingMessages ? 'animate-spin' : ''}
                              />
                            }
                          />{' '}
                        </div>{' '}
                        <div className="flex space-x-2">
                          {' '}
                          <Input
                            ref={inputRef}
                            type="text"
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="输入消息..."
                            className="border-none rounded-full"
                            fieldClassName="flex-1"
                            disabled={sending}
                          />{' '}
                          <Button
                            onClick={handleSendMessage}
                            variant="filled"
                            loading={sending}
                            disabled={!newMessage.trim()}
                          >
                            发送
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-outline">
                      <MdOutlineChatBubbleOutline size={64} className="mb-2 opacity-20" />
                      <p>选择一个联系人开始聊天</p>
                    </div>
                  )}
                </div>
              </div>
            ) : activeTab === 'announcement' ? (
              <div>
                {' '}
                {loading ? (
                  <div className="space-y-4">
                    {' '}
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-32 rounded-md" />
                    ))}{' '}
                  </div>
                ) : error ? (
                  <div className="text-center py-20 text-on-surface-variant">
                    {' '}
                    <p>{error}</p>{' '}
                    <button
                      onClick={() => fetchAnnouncements()}
                      className="mt-4 text-primary hover:underline"
                    >
                      {' '}
                      重试{' '}
                    </button>{' '}
                  </div>
                ) : announcements.length > 0 ? (
                  <div className="space-y-4">
                    {' '}
                    {announcements.map((item) => (
                      <div key={item.id} className="bg-surface-container rounded-md p-5">
                        {' '}
                        <div className="flex justify-between items-start mb-3">
                          {' '}
                          <div className="flex items-center">
                            {' '}
                            <span className="bg-primary/10 text-primary text-label-m-emphasized px-2 py-1 rounded mr-3">
                              {' '}
                              {item.version}{' '}
                            </span>{' '}
                            <h3 className="text-title-m-emphasized text-on-surface">
                              {item.title}
                            </h3>{' '}
                          </div>{' '}
                          <span className="text-body-m text-outline">{item.date}</span>{' '}
                        </div>{' '}
                        <div
                          className="text-on-surface-variant text-label-l leading-relaxed announcement-content"
                          dangerouslySetInnerHTML={{ __html: item.content }}
                        />{' '}
                      </div>
                    ))}{' '}
                  </div>
                ) : (
                  <div className="text-center py-20 text-on-surface-variant"> 滚木 </div>
                )}{' '}
              </div>
            ) : activeTab === 'interaction' ? (
              <div>
                {loading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-24 rounded-md" />
                    ))}
                  </div>
                ) : error ? (
                  <div className="text-center py-20 text-on-surface-variant">
                    <p>{error}</p>
                    <button
                      onClick={() => fetchInteractionNotifications()}
                      className="mt-4 text-primary hover:underline"
                    >
                      重试
                    </button>
                  </div>
                ) : interactionNotifications.length > 0 ? (
                  <div className="space-y-4">
                    {interactionNotifications.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-md p-5 relative overflow-hidden transition-ui ${item.is_read === 0 ? 'bg-primary/5' : 'bg-surface-container'}`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h3
                            className={`text-title-m-emphasized ${item.is_read === 0 ? 'text-on-surface' : 'text-on-surface '}`}
                          >
                            {item.title}
                          </h3>
                          <span className="text-body-m text-outline">{item.created_at}</span>
                        </div>
                        <div className="text-on-surface-variant text-body-m leading-relaxed">
                          {item.content}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-20 text-on-surface-variant">滚木</div>
                )}
                {interactionNotificationsTotalPages > 1 && (
                  <Pagination
                    currentPage={interactionNotificationsPage}
                    totalPages={interactionNotificationsTotalPages}
                    onPageChange={(p) => fetchInteractionNotifications(p)}
                    className="mt-6"
                  />
                )}
              </div>
            ) : (
              <div>
                {loading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-24 rounded-md" />
                    ))}
                  </div>
                ) : error ? (
                  <div className="text-center py-20 text-on-surface-variant">
                    <p>{error}</p>
                    <button
                      onClick={() => fetchNotifications()}
                      className="mt-4 text-primary hover:underline"
                    >
                      重试
                    </button>
                  </div>
                ) : notifications.length > 0 ? (
                  <div className="space-y-4">
                    {notifications.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-md p-5 relative overflow-hidden transition-ui ${item.is_read === 0 ? 'bg-primary/5' : 'bg-surface-container'}`}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h3
                            className={`text-title-m-emphasized ${item.is_read === 0 ? 'text-on-surface' : 'text-on-surface '}`}
                          >
                            {item.title}
                          </h3>
                          <span className="text-body-m text-outline">{item.created_at}</span>
                        </div>
                        <div className="text-on-surface-variant text-body-m leading-relaxed">
                          {item.content}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-20 text-on-surface-variant">滚木</div>
                )}
              </div>
            )}
          </div>
        </div>

        <style jsx global>{`
          .announcement-content br {
            margin-bottom: 0.5rem;
            display: block;
            content: '';
          }
          @keyframes slideUpFadeIn {
            from {
              opacity: 0;
              transform: translateY(10px) scale(0.95);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @keyframes slideDownFadeOut {
            from {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
            to {
              opacity: 0;
              transform: translateY(10px) scale(0.95);
            }
          }
          .emoji-picker-animate-in {
            animation: slideUpFadeIn 0.2s var(--ease-decelerate) forwards;
          }
          .emoji-picker-animate-out {
            animation: slideDownFadeOut 0.2s var(--ease-accelerate) forwards;
          }
        `}</style>
      </div>
    </>
  );
}
