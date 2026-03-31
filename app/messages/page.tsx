'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Tabs, Tab, Box, CircularProgress } from '@mui/material';

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

  useEffect(() => {
    document.title = "消息 - PicPony";
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
      const data = await api.getNotifications();
      if (data.success) {
        setNotifications(data.notifications);
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

  const fetchContacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) {
        setError('请先登录');
        return;
      }
      const user = JSON.parse(storedUser);
      setCurrentUsername(user.username);
      const data = await api.getRecentContacts(user.token);
      if (data.success) {
        setContacts(data.contacts);
      } else {
        setError('获取联系人失败');
      }
    } catch (err) {
      setError('网络请求失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (contactId: number) => {
    setLoadingMessages(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) return;
      const user = JSON.parse(storedUser);
      if (!currentUsername) setCurrentUsername(user.username);
      const data = await api.getMessages(user.token, contactId);
      if (data.success) {
        setMessages(data.messages);
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
          <Tab label="通知" value="notification" />
          <Tab label="私信" value="chat" />
        </Tabs>
      </Box>

      <div className="min-h-[400px] relative">
        <div className={`transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
          {activeTab === 'chat' ? (
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden flex h-[600px]">
              <div className="w-80 border-r border-slate-100 flex flex-col">
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
                      <div 
                        key={contact.id}
                        onClick={() => setSelectedContact(contact)}
                        className={`p-4 flex items-center space-x-3 cursor-pointer transition-colors hover:bg-slate-50 ${selectedContact?.id === contact.id ? 'bg-slate-50' : ''}`}
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
                      </div>
                    ))
                  ) : (
                    <div className="p-10 text-center text-slate-400 text-sm">
                      暂无联系人
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 flex flex-col bg-slate-50/30">
                {selectedContact ? (
                  <>
                    <div className="p-4 border-b border-slate-100 bg-white flex items-center justify-between">
                      <div className="flex items-center space-x-3">
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
                                    {msg.content}
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
                    <div className="p-4 bg-white border-t border-slate-100">
                      <div className="flex space-x-2">
                        <input 
                          type="text" 
                          placeholder="输入消息..." 
                          className="flex-1 bg-slate-100 border-none rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                          disabled
                        />
                        <button className="bg-primary text-white px-4 py-2 rounded-full text-sm font-bold opacity-50 cursor-not-allowed">
                          发送
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                    <svg className="w-16 h-16 mb-4 opacity-20" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
                    </svg>
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
                      className="bg-white rounded-xl p-5 relative overflow-hidden"
                    >
                      {item.is_read === 0 && (
                        <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                      )}
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
      `}</style>
    </div>
  );
}
