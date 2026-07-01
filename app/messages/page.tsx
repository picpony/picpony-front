'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, Notification } from '@/lib/api';
import { MdOutlineChatBubbleOutline, MdOutlineEmojiEmotions, MdRefresh, MdArrowBack, MdOutlineNotificationsActive, MdSearch } from 'react-icons/md';
import { getEmojis } from '@/app/actions/getEmojis';
import Spinner from '@/components/Spinner';

interface Announcement {
  id: number;
  version: string;
  title: string;
  content: string;
  date: string;
}

import { Contact, Message } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';

export default function MessagesPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'announcement' | 'notification' | 'interaction' | 'chat'>('announcement');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isEmojiPickerClosing, setIsEmojiPickerClosing] = useState(false);
  const [emojiList, setEmojiList] = useState<string[]>([]);
  const [unreadCounts, setUnreadCounts] = useState({ messages: 0, notifications: 0, interactions: 0 });
  const [interactionNotifications, setInteractionNotifications] = useState<Notification[]>([]);
  const [interactionNotificationsPage, setInteractionNotificationsPage] = useState(1);
  const [interactionNotificationsTotalPages, setInteractionNotificationsTotalPages] = useState(1);
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

  const fetchUnreadCounts = async () => {
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) return;
      const user = JSON.parse(storedUser);
      const data = await api.getUnreadCounts(user.token);
      if (data.success) {
        setUnreadCounts({
          messages: data.unread_messages,
          notifications: data.unread_notifications,
          interactions: data.unread_interactions
        });
        const event = new CustomEvent('unread_counts_updated');
        window.dispatchEvent(event);
      }
    } catch (err) {
      console.error('获取未读数量失败', err);
    }
  };

  useEffect(() => {
    fetchUnreadCounts();
  }, []);

  useEffect(() => {
    const loadEmojis = async () => {
      const emojis = await getEmojis();
      setEmojiList(emojis);
    };
    loadEmojis();
  }, []);

  useEffect(() => {
    const toUserId = searchParams.get('to');
    if (!toUserId) return;

    const targetId = parseInt(toUserId, 10);
    if (isNaN(targetId)) return;

    setActiveTab('chat');

    const timer = setTimeout(async () => {
      const existing = contacts.find(c => c.id === targetId);
      if (existing) {
        setSelectedContact(existing);
        return;
      }

      try {
        const storedUser = localStorage.getItem('user_info');
        if (!storedUser) return;
        const user = JSON.parse(storedUser);

        const res = await api.getUserProfile(String(targetId));
        if (res.success && res.user) {
          const tempContact = {
            id: targetId,
            username: res.user.username,
            avatar: res.user.avatar,
            last_msg_time: '',
            unread_count: 0,
          };
          setContacts(prev => {
            if (prev.some(c => c.id === targetId)) return prev;
            return [tempContact, ...prev];
          });
          setSelectedContact(tempContact);
        }
      } catch (err) {
        console.error('获取用户信息失败', err);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchParams.get('to')]);

  const handleCloseEmojiPicker = () => {
    setIsEmojiPickerClosing(true);
    setTimeout(() => {
      setShowEmojiPicker(false);
      setIsEmojiPickerClosing(false);
    }, 200);
  };

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

  const fetchAnnouncements = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAnnouncementHistory();
      if (data.success) {
        setAnnouncements(data.announcements);
      } else {
        setError('获取公告失败');
      }
    } catch (err) {
      setError('网络请求失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotifications = async () => {
    setLoading(true);
    setError(null);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) {
        setError('请先登录');
        return;
      }
      const user = JSON.parse(storedUser);
      const data = await api.getNotifications(user.token);
      if (data.success) {
        setNotifications(data.notifications);
        fetchUnreadCounts();
      } else {
        setError('获取通知失败');
      }
    } catch (err) {
      setError('网络请求失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchInteractionNotifications = async (page: number = 1) => {
    setLoading(true);
    setError(null);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) {
        setError('请先登录');
        return;
      }
      const user = JSON.parse(storedUser);
      const data = await api.getInteractionNotifications(user.token, page);
      if (data.success) {
        setInteractionNotifications(data.notifications);
        setInteractionNotificationsTotalPages(data.total_pages);
        setInteractionNotificationsPage(page);
        fetchUnreadCounts();
      } else {
        setError('获取互动通知失败');
      }
    } catch (err) {
      setError('网络请求失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchContacts = async (silent = false) => {
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
  };

  const fetchMessages = async (contactId: number, silent = false) => {
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
  };

  useEffect(() => {
    if (activeTab === 'announcement') {
      fetchAnnouncements();
    } else if (activeTab === 'notification') {
      fetchNotifications();
    } else if (activeTab === 'interaction') {
      fetchInteractionNotifications();
    } else {
      fetchContacts();
    }
  }, [activeTab]);

  useEffect(() => {
    if (selectedContact) {
      fetchMessages(selectedContact.id);
    }
  }, [selectedContact]);

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
      
      const newValue = newMessage.substring(0, startPos) + emojiPlaceholder + newMessage.substring(endPos);
      setNewMessage(newValue);
      
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(startPos + emojiPlaceholder.length, startPos + emojiPlaceholder.length);
      }, 0);
    } else {
      setNewMessage(prev => prev + emojiPlaceholder);
    }
  };

  const renderMessageContent = (content: string) => {
    const parts = content.split(/(\$emoji_[a-zA-Z0-9_]+\$)/g);
    return parts.map((part, index) => {
      const match = part.match(/^\$emoji_([a-zA-Z0-9_]+)\$$/);
      if (match) {
        const emojiName = match[1];
        return (
          <FadeInImage 
            key={index} 
            src={`/img/emoji/${emojiName}.png`} 
            alt={emojiName} 
            width={24}
            height={24}
            className="inline-block w-6 h-6 align-middle mx-0.5" 
          />
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">消息</h1>
      
      <div className="border-b border-slate-200 dark:border-slate-700 mb-3">
        <div className="flex gap-0">
          {[
            { label: '公告', value: 'announcement', badge: 0 },
            { label: '系统', value: 'notification', badge: unreadCounts.notifications },
            { label: '互动', value: 'interaction', badge: unreadCounts.interactions },
            { label: '私信', value: 'chat', badge: unreadCounts.messages },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => {
                if (tab.value === activeTab) return;
                setIsTransitioning(true);
                setTimeout(() => {
                  setActiveTab(tab.value as typeof activeTab);
                  setIsTransitioning(false);
                }, 200);
              }}
              className={`px-4 py-2.5 text-base font-medium transition-colors relative flex items-center gap-1 ${
                activeTab === tab.value
                  ? 'text-primary'
                  : 'text-[var(--sidebar-text)] hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
              {tab.badge > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
              {activeTab === tab.value && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-[400px] relative">
        <div className={`transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
          {activeTab === 'chat' ? (
            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden flex h-[calc(100vh-200px)] md:h-[600px]">
              <div className={`w-full md:w-80 border-r border-slate-100 dark:border-slate-700 flex-col ${selectedContact ? 'hidden md:flex' : 'flex'}`}>
                <div className="p-3 border-b border-slate-100 dark:border-slate-700">
                  <div className="relative">
                    <MdSearch size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="搜索昵称发起私信..."
                      className="w-full pl-9 pr-3 py-2 bg-slate-100 dark:bg-slate-700 border-none rounded-lg text-sm focus:ring-2 focus:ring-primary/20 outline-none text-slate-800 dark:text-slate-200 placeholder:text-slate-400"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {loading && contacts.length === 0 ? (
                    <div className="space-y-1">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="flex items-center justify-start w-full p-2 gap-1.5 mb-4 animate-pulse">
                          <div className="relative">
                            <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="h-4 bg-slate-100 dark:bg-slate-700 rounded w-3/4" />
                            <div className="h-3 bg-slate-100 dark:bg-slate-700 rounded w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : error ? (
                    <div className="text-center text-slate-400 dark:text-slate-500 text-sm pt-6">
                      {error}
                    </div>
                  ) : contacts.length > 0 ? (
                    contacts.map(contact => (
                      <button
                        key={contact.id}
                        onClick={() => setSelectedContact(contact)}
                        className={`flex items-center justify-start text-left w-full p-2 gap-1.5 mb-4 transition-colors duration-200 ${
                          selectedContact?.id === contact.id ? 'bg-[var(--sidebar-hover)]' : 'hover:bg-[var(--sidebar-hover)]'
                        }`}
                      >
                        <div className="relative">
                          <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-700 border border-slate-100 dark:border-slate-600">
                            {contact.avatar ? (
                              <FadeInImage 
                                src={`https://picpony.top/${contact.avatar}`} 
                                alt={contact.username}
                                width={48}
                                height={48}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-500 bg-slate-200 dark:bg-slate-600">
                                {contact.username[0].toUpperCase()}
                              </div>
                            )}
                          </div>
                          {contact.unread_count > 0 && (
                            <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white dark:border-slate-800">
                              {contact.unread_count}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline">
                            <h4 className="font-bold text-slate-800 dark:text-slate-200 truncate text-sm">{contact.username}</h4>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1">
                            {contact.last_msg_time}
                          </p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-center text-slate-400 dark:text-slate-500 text-sm pt-6">
                      滚木
                    </div>
                  )}
                </div>
              </div>

              <div className={`flex-1 flex-col bg-slate-50/30 dark:bg-slate-900/30 ${!selectedContact ? 'hidden md:flex' : 'flex'}`}>
                {selectedContact ? (
                  <>
                    <div className="p-4 border-b border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => setSelectedContact(null)}
                          className="md:hidden -ml-2 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-[var(--sidebar-text)]"
                        >
                          <MdArrowBack size={20} />
                        </button>
                        <span className="font-bold text-slate-800 dark:text-slate-200">{selectedContact.username}</span>
                      </div>
                    </div>
                    <div ref={messagesContainerRef} className="flex-1 p-4 overflow-y-auto flex flex-col space-y-4">
                      {loadingMessages ? (
                        <div className="flex-1 flex items-center justify-center">
                          <Spinner size="lg" />
                        </div>
                      ) : messages.length > 0 ? (
                        messages.map((msg) => {
                          const isMe = currentUsername ? msg.sender_name === currentUsername : msg.sender_id !== selectedContact?.id;
                          return (
                            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                              <div className={`flex max-w-[70%] ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
                                <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-slate-100 dark:bg-slate-700">
                                  {msg.sender_avatar ? (
                                    <FadeInImage 
                                      src={`https://picpony.top/${msg.sender_avatar}`} 
                                      alt={msg.sender_name}
                                      width={32}
                                      height={32}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-xs bg-slate-200 dark:bg-slate-600">
                                      {msg.sender_name[0].toUpperCase()}
                                    </div>
                                  )}
                                </div>
                                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 mb-1 px-1">{msg.created_at}</span>
                                  <div 
                                    className={`px-4 py-2 rounded-2xl text-sm ${
                                      isMe 
                                        ? 'bg-primary text-white rounded-br-sm' 
                                        : 'bg-white dark:bg-slate-700 border border-slate-100 dark:border-slate-600 text-slate-800 dark:text-slate-200 rounded-bl-sm'
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
                        <div className="flex-1 flex items-center justify-center text-slate-400 dark:text-slate-500">
                          <p>滚木</p>
                        </div>
                      )}
                    </div>
                    <div className="px-4 pb-4 pt-1 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 relative">
                      <div className="flex items-center justify-between mb-1">
                        <div className="relative" ref={emojiPickerRef}>
                          <button
                            onClick={toggleEmojiPicker}
                            className={`p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${showEmojiPicker ? 'text-primary' : 'text-[var(--sidebar-text)]'}`}
                          >
                            <MdOutlineEmojiEmotions size={24} />
                          </button>
                          
                          {(showEmojiPicker || isEmojiPickerClosing) && (
                            <div className={`absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-50 p-2 origin-bottom-left ${isEmojiPickerClosing ? 'emoji-picker-animate-out' : 'emoji-picker-animate-in'}`}>
                              <div className="grid grid-cols-5 sm:grid-cols-6 gap-2 max-h-60 overflow-y-auto p-1">
                                {emojiList.map(emoji => (
                                  <button
                                    key={emoji}
                                    onClick={() => handleEmojiClick(emoji)}
                                    className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors flex items-center justify-center"
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
                        <button
                          onClick={() => fetchMessages(selectedContact.id)}
                          disabled={loadingMessages}
                          className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors text-[var(--sidebar-text)] disabled:opacity-50"
                        >
                          <MdRefresh size={24} className={loadingMessages ? 'animate-spin' : ''} />
                        </button>
                      </div>
                      <div className="flex space-x-2">
                        <input 
                          ref={inputRef}
                          type="text" 
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          onKeyPress={handleKeyPress}
                          placeholder="输入消息..." 
                          className="flex-1 bg-slate-100 dark:bg-slate-700 border-none rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none text-slate-800 dark:text-slate-200"
                          disabled={sending}
                        />
                        <button
                          onClick={handleSendMessage}
                          disabled={!newMessage.trim() || sending}
                          className="bg-primary text-white px-2 py-1 rounded-full text-sm font-bold transition-colors duration-200 flex items-center justify-center min-w-[64px] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {sending ? <Spinner size="sm" white /> : '发送'}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
                    <MdOutlineChatBubbleOutline size={64} className="mb-2 opacity-20" />
                    <p>选择一个联系人开始聊天</p>
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'announcement' ? (
            <div>
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-slate-50 dark:bg-slate-800 h-32 rounded-xl animate-pulse"></div>
                  ))}
                </div>
              ) : error ? (
                <div className="text-center py-20 text-slate-500 dark:text-slate-400">
                  <p>{error}</p>
                  <button 
                    onClick={fetchAnnouncements}
                    className="mt-4 text-primary hover:underline"
                  >
                    重试
                  </button>
                </div>
              ) : announcements.length > 0 ? (
                <div className="space-y-4">
                  {announcements.map((item) => (
                    <div 
                      key={item.id} 
                      className="bg-white dark:bg-slate-800 rounded-xl p-5"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center">
                          <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded mr-3">
                            {item.version}
                          </span>
                          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">{item.title}</h3>
                        </div>
                        <span className="text-sm text-slate-400 dark:text-slate-500">{item.date}</span>
                      </div>
                      <div 
                        className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed announcement-content"
                        dangerouslySetInnerHTML={{ __html: item.content }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-500 dark:text-slate-400">
                  滚木
                </div>
              )}
            </div>
          ) : activeTab === 'interaction' ? (
            <div>
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-slate-50 dark:bg-slate-800 h-24 rounded-xl animate-pulse"></div>
                  ))}
                </div>
              ) : error ? (
                <div className="text-center py-20 text-slate-500 dark:text-slate-400">
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
                      className={`rounded-xl p-5 relative overflow-hidden transition-colors ${item.is_read === 0 ? 'bg-primary/5 border border-primary/20' : 'bg-white dark:bg-slate-800'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h3 className={`text-lg font-bold ${item.is_read === 0 ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>
                          {item.title}
                        </h3>
                        <span className="text-sm text-slate-400 dark:text-slate-500">{item.created_at}</span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                        {item.content}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-500 dark:text-slate-400">
                  滚木
                </div>
              )}
              {interactionNotificationsTotalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-6">
                  <button
                    onClick={() => fetchInteractionNotifications(interactionNotificationsPage - 1)}
                    disabled={interactionNotificationsPage === 1}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    上一页
                  </button>
                  <span className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-300">
                    {interactionNotificationsPage} / {interactionNotificationsTotalPages}
                  </span>
                  <button
                    onClick={() => fetchInteractionNotifications(interactionNotificationsPage + 1)}
                    disabled={interactionNotificationsPage === interactionNotificationsTotalPages}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div>
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-slate-50 dark:bg-slate-800 h-24 rounded-xl animate-pulse"></div>
                  ))}
                </div>
              ) : error ? (
                <div className="text-center py-20 text-slate-500 dark:text-slate-400">
                  <p>{error}</p>
                  <button 
                    onClick={fetchNotifications}
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
                      className={`rounded-xl p-5 relative overflow-hidden transition-colors ${item.is_read === 0 ? 'bg-primary/5 border border-primary/20' : 'bg-white dark:bg-slate-800'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h3 className={`text-lg font-bold ${item.is_read === 0 ? 'text-slate-900 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>
                          {item.title}
                        </h3>
                        <span className="text-sm text-slate-400 dark:text-slate-500">{item.created_at}</span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed">
                        {item.content}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-500 dark:text-slate-400">
                  滚木
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .announcement-content br {
          margin-bottom: 0.5rem;
          display: block;
          content: "";
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
          animation: slideUpFadeIn 0.2s ease-out forwards;
        }
        .emoji-picker-animate-out {
          animation: slideDownFadeOut 0.2s ease-in forwards;
        }
      `}</style>
    </div>
  );
}