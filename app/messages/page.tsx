'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { Tabs, Tab, Box, CircularProgress, ButtonBase, IconButton, Badge } from '@mui/material';
import { MdOutlineChatBubbleOutline, MdOutlineEmojiEmotions, MdRefresh, MdArrowBack } from 'react-icons/md';
import { getEmojis } from '@/app/actions/getEmojis';

interface Announcement {
  id: number;
  version: string;
  title: string;
  content: string;
  date: string;
}

interface Notification {
  id: number;
  title: string;
  content: string;
  is_read: number;
  created_at: string;
}

import { Contact, Message } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';

export default function MessagesPage() {
  const [activeTab, setActiveTab] = useState<'announcement' | 'notification' | 'chat'>('announcement');
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
  const [unreadCounts, setUnreadCounts] = useState({ messages: 0, notifications: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCounts = async () => {
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) return;
      const user = JSON.parse(storedUser);
      const data = await api.getUnreadCounts(user.token);
      if (data.success) {
        setUnreadCounts({
          messages: data.unread_messages,
          notifications: data.unread_notifications
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
    document.title = "消息 - PicPony";
  }, []);

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
  }, []);

  const handleTabChange = (_: React.SyntheticEvent, newValue: 'announcement' | 'notification' | 'chat') => {
    if (newValue === activeTab) return;
    
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveTab(newValue);
      setIsTransitioning(false);
    }, 200);
  };

  useEffect(() => {
    if (activeTab === 'announcement') {
      fetchAnnouncements();
    } else if (activeTab === 'notification') {
      fetchNotifications();
    } else {
      fetchContacts();
    }
  }, [activeTab]);

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
          <img 
            key={index} 
            src={`/img/emoji/${emojiName}.png`} 
            alt={emojiName} 
            className="inline-block w-6 h-6 align-middle mx-0.5" 
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              if (!target.nextSibling || target.nextSibling.textContent !== part) {
                target.insertAdjacentText('afterend', part);
              }
            }}
          />
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">消息</h1>
      
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs 
          value={activeTab} 
          onChange={handleTabChange}
          sx={{
            '& .MuiTab-root': {
              fontSize: '1rem',
              fontWeight: 500,
              textTransform: 'none',
              minWidth: 100,
            },
            '& .Mui-selected': {
              color: 'var(--color-primary) !important',
            },
            '& .MuiTabs-indicator': {
              backgroundColor: 'var(--color-primary)',
            }
          }}
        >
          <Tab label="公告" value="announcement" />
          <Tab 
            label={
              <Badge color="error" badgeContent={unreadCounts.notifications} sx={{ '& .MuiBadge-badge': { right: -15, top: 5 } }}>
                通知
              </Badge>
            } 
            value="notification" 
          />
          <Tab 
            label={
              <Badge color="error" badgeContent={unreadCounts.messages} sx={{ '& .MuiBadge-badge': { right: -15, top: 5 } }}>
                私信
              </Badge>
            } 
            value="chat" 
          />
        </Tabs>
      </Box>

      <div className="min-h-[400px] relative">
        <div className={`transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
          {activeTab === 'chat' ? (
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden flex h-[calc(100vh-200px)] md:h-[600px]">
              <div className={`w-full md:w-80 border-r border-slate-100 flex-col ${selectedContact ? 'hidden md:flex' : 'flex'}`}>
                <div className="flex-1 overflow-y-auto">
                  {loading && contacts.length === 0 ? (
                    <div className="p-4 space-y-4">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className="flex items-center space-x-3 animate-pulse">
                          <div className="w-12 h-12 bg-slate-100 rounded-full"></div>
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-slate-100 rounded w-3/4"></div>
                            <div className="h-3 bg-slate-100 rounded w-1/2"></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : error ? (
                    <div className="p-10 text-center text-slate-400 text-sm">
                      {error}
                    </div>
                  ) : contacts.length > 0 ? (
                    contacts.map(contact => (
                      <ButtonBase 
                        key={contact.id}
                        onClick={() => setSelectedContact(contact)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-start',
                          textAlign: 'left',
                          width: '100%',
                          p: 2,
                          gap: 1.5,
                          transition: 'background-color 0.2s',
                          backgroundColor: selectedContact?.id === contact.id ? 'rgb(248 250 252)' : 'transparent',
                          '&:hover': {
                            backgroundColor: 'rgb(248 250 252)',
                          }
                        }}
                      >
                        <div className="relative">
                          <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 border border-slate-100">
                            {contact.avatar ? (
                              <FadeInImage 
                                src={`https://picpony.top/${contact.avatar}`} 
                                alt={contact.username}
                                width={48}
                                height={48}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-slate-400 bg-slate-200">
                                {contact.username[0].toUpperCase()}
                              </div>
                            )}
                          </div>
                          {contact.unread_count > 0 && (
                            <div className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full border-2 border-white">
                              {contact.unread_count}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline">
                            <h4 className="font-bold text-slate-800 truncate text-sm">{contact.username}</h4>
                          </div>
                          <p className="text-xs text-slate-500 truncate mt-1">
                            {contact.last_msg_time}
                          </p>
                        </div>
                      </ButtonBase>
                    ))
                  ) : (
                    <div className="p-10 text-center text-slate-400 text-sm">
                      暂无联系人
                    </div>
                  )}
                </div>
              </div>

              <div className={`flex-1 flex-col bg-slate-50/30 ${!selectedContact ? 'hidden md:flex' : 'flex'}`}>
                {selectedContact ? (
                  <>
                    <div className="p-4 border-b border-slate-100 bg-white flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <IconButton 
                          onClick={() => setSelectedContact(null)}
                          className="md:!hidden -ml-2"
                          size="small"
                        >
                          <MdArrowBack />
                        </IconButton>
                        <span className="font-bold text-slate-800">{selectedContact.username}</span>
                      </div>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto flex flex-col space-y-4">
                      {loadingMessages ? (
                        <div className="flex-1 flex items-center justify-center">
                          <CircularProgress size={30} sx={{ color: 'var(--color-primary)' }} />
                        </div>
                      ) : messages.length > 0 ? (
                        messages.map((msg) => {
                          const isMe = currentUsername ? msg.sender_name === currentUsername : msg.sender_id !== selectedContact?.id;
                          return (
                            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                              <div className={`flex max-w-[70%] ${isMe ? 'flex-row-reverse' : 'flex-row'} items-end gap-2`}>
                                <div className="w-8 h-8 rounded-full overflow-hidden flex-shrink-0 bg-slate-100">
                                  {msg.sender_avatar ? (
                                    <FadeInImage 
                                      src={`https://picpony.top/${msg.sender_avatar}`} 
                                      alt={msg.sender_name}
                                      width={32}
                                      height={32}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs bg-slate-200">
                                      {msg.sender_name[0].toUpperCase()}
                                    </div>
                                  )}
                                </div>
                                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                  <span className="text-[10px] text-slate-400 mb-1 px-1">{msg.created_at}</span>
                                  <div 
                                    className={`px-4 py-2 rounded-2xl text-sm ${
                                      isMe 
                                        ? 'bg-primary text-white rounded-br-sm' 
                                        : 'bg-white border border-slate-100 text-slate-800 rounded-bl-sm'
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
                        <div className="flex-1 flex items-center justify-center text-slate-400">
                          <p>暂无聊天记录</p>
                        </div>
                      )}
                    </div>
                    <div className="px-4 pb-4 pt-1 bg-white border-t border-slate-100 relative">
                      <div className="flex items-center justify-between mb-1">
                        <div className="relative" ref={emojiPickerRef}>
                          <IconButton 
                            size="small" 
                            onClick={toggleEmojiPicker}
                            sx={{ color: showEmojiPicker ? 'var(--color-primary)' : 'text.secondary' }}
                          >
                            <MdOutlineEmojiEmotions size={24} />
                          </IconButton>
                          
                          {(showEmojiPicker || isEmojiPickerClosing) && (
                            <div className={`absolute bottom-full left-0 mb-2 w-72 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-2 origin-bottom-left ${isEmojiPickerClosing ? 'emoji-picker-animate-out' : 'emoji-picker-animate-in'}`}>
                              <div className="grid grid-cols-6 gap-2 max-h-60 overflow-y-auto p-1">
                                {emojiList.map(emoji => (
                                  <button
                                    key={emoji}
                                    onClick={() => handleEmojiClick(emoji)}
                                    className="p-1 hover:bg-slate-100 rounded transition-colors flex items-center justify-center"
                                    title={emoji}
                                  >
                                    <img 
                                      src={`/img/emoji/${emoji}.png`} 
                                      alt={emoji} 
                                      className="w-8 h-8 object-contain"
                                    />
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                        <IconButton 
                          size="small" 
                          onClick={() => fetchMessages(selectedContact.id)}
                          disabled={loadingMessages}
                          sx={{ color: 'text.secondary' }}
                        >
                          <MdRefresh size={24} className={loadingMessages ? 'animate-spin' : ''} />
                        </IconButton>
                      </div>
                      <div className="flex space-x-2">
                        <input 
                          ref={inputRef}
                          type="text" 
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          onKeyPress={handleKeyPress}
                          placeholder="输入消息..." 
                          className="flex-1 bg-slate-100 border-none rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                          disabled={sending}
                        />
                        <ButtonBase 
                          onClick={handleSendMessage}
                          disabled={!newMessage.trim() || sending}
                          sx={{
                            backgroundColor: 'var(--color-primary)',
                            color: 'white',
                            px: 2,
                            py: 1,
                            borderRadius: '9999px',
                            fontSize: '0.875rem',
                            fontWeight: 'bold',
                            transition: 'background-color 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: '64px',
                            opacity: !newMessage.trim() || sending ? 0.5 : 1,
                            cursor: !newMessage.trim() || sending ? 'not-allowed' : 'pointer',
                            '&.Mui-disabled': {
                              color: 'white',
                              opacity: 0.5,
                            }
                          }}
                        >
                          {sending ? <CircularProgress size={20} sx={{ color: 'white' }} /> : '发送'}
                        </ButtonBase>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
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
                    <div key={i} className="bg-slate-50 h-32 rounded-xl animate-pulse"></div>
                  ))}
                </div>
              ) : error ? (
                <div className="text-center py-20 text-slate-500">
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
                      className="bg-white rounded-xl p-5"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center">
                          <span className="bg-primary/10 text-primary text-xs font-bold px-2 py-1 rounded mr-3">
                            {item.version}
                          </span>
                          <h3 className="text-lg font-bold text-slate-800">{item.title}</h3>
                        </div>
                        <span className="text-sm text-slate-400">{item.date}</span>
                      </div>
                      <div 
                        className="text-slate-600 text-sm leading-relaxed announcement-content"
                        dangerouslySetInnerHTML={{ __html: item.content }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-500">
                  暂无公告
                </div>
              )}
            </div>
          ) : (
            <div>
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-slate-50 h-24 rounded-xl animate-pulse"></div>
                  ))}
                </div>
              ) : error ? (
                <div className="text-center py-20 text-slate-500">
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
                      className={`rounded-xl p-5 relative overflow-hidden transition-colors ${item.is_read === 0 ? 'bg-primary/5 border border-primary/20' : 'bg-white'}`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h3 className={`text-lg font-bold ${item.is_read === 0 ? 'text-slate-900' : 'text-slate-700'}`}>
                          {item.title}
                        </h3>
                        <span className="text-sm text-slate-400">{item.created_at}</span>
                      </div>
                      <div className="text-slate-600 text-sm leading-relaxed">
                        {item.content}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-slate-500">
                  暂无通知
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
