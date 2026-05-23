'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { MdEdit, MdClose } from 'react-icons/md';
import { ButtonBase } from '@mui/material';
import { showToast } from '@/components/Toast';
import { api } from '@/lib/api';

const buttonSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: { xs: '36px', sm: 'auto' },
  minHeight: { xs: '36px', sm: 'auto' },
  px: { xs: 0, sm: 2 },
  py: { xs: 0, sm: 1 },
  backgroundColor: 'var(--card-bg)',
  border: '1px solid',
  borderColor: 'var(--card-border)',
  borderRadius: '0.375rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: 'var(--sidebar-text)',
  transition: 'all 0.2s',
  '&:hover': {
    backgroundColor: 'var(--sidebar-hover)',
    color: 'var(--color-primary)',
  },
  '&.Mui-disabled': {
    opacity: 0.5,
    cursor: 'not-allowed',
  }
};

export default function SettingsPage() {
  const router = useRouter();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentUsername, setCurrentUsername] = useState('');
  const [currentAvatar, setCurrentAvatar] = useState('');
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isPasswordClosing, setIsPasswordClosing] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [currentApiKey, setCurrentApiKey] = useState('');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isApiKeyClosing, setIsApiKeyClosing] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [apiKeyLoading, setApiKeyLoading] = useState(false);

  const [darkMode, setDarkMode] = useState(false);

  const closeModal = () => {
    if (isLoading) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsModalOpen(false);
      setIsClosing(false);
      setNewUsername('');
    }, 200);
  };

  const closePasswordModal = () => {
    if (passwordLoading) return;
    setIsPasswordClosing(true);
    setTimeout(() => {
      setIsPasswordModalOpen(false);
      setIsPasswordClosing(false);
      setOldPassword('');
      setNewPassword('');
    }, 200);
  };

  const closeApiKeyModal = () => {
    if (apiKeyLoading) return;
    setIsApiKeyClosing(true);
    setTimeout(() => {
      setIsApiKeyModalOpen(false);
      setIsApiKeyClosing(false);
      setNewApiKey('');
    }, 200);
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user_info');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        setCurrentUsername(user.username);
        setCurrentAvatar(user.avatar || '');
        
        api.getUser(user.token)
          .then(res => res.json())
          .then(data => {
            if (data.success && data.user) {
              const apiKey = data.user.api_key || '';
              setCurrentApiKey(apiKey);
              if (apiKey) {
                localStorage.setItem('derpi_api_key', apiKey);
              } else {
                localStorage.removeItem('derpi_api_key');
              }
              if (data.user.avatar) {
                const fullAvatarUrl = data.user.avatar.startsWith('http') ? data.user.avatar : `https://picpony.top/${data.user.avatar}`;
                setCurrentAvatar(fullAvatarUrl);
                const updatedUser = { ...user, avatar: fullAvatarUrl };
                localStorage.setItem('user_info', JSON.stringify(updatedUser));
              }
            }
          })
          .catch(err => console.error("Failed to fetch user info", err));
      } catch (e) {
        console.error("Failed to parse user info", e);
      }
    }
    
    const storedDark = localStorage.getItem('darkMode');
    setDarkMode(storedDark === 'true');
  }, []);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', 'error');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片大小不能超过 5MB', 'error');
      return;
    }

    setIsAvatarUploading(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);

      const res = await api.uploadAvatar(user.token, file);
      const data = await res.json();

      if (data.success) {
        showToast('头像上传成功', 'success');
        const fullAvatarUrl = data.avatar_url.startsWith('http') ? data.avatar_url : `https://picpony.top/${data.avatar_url}`;
        setCurrentAvatar(fullAvatarUrl);
        
        const updatedUser = { ...user, avatar: fullAvatarUrl };
        localStorage.setItem('user_info', JSON.stringify(updatedUser));
        window.dispatchEvent(new Event('user_info_updated'));
      } else {
        showToast(data.message || '上传失败，请重试', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请重试', 'error');
    } finally {
      setIsAvatarUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDarkModeToggle = () => {
    const newValue = !darkMode;
    setDarkMode(newValue);
    localStorage.setItem('darkMode', String(newValue));
    document.documentElement.classList.toggle('dark', newValue);
    document.cookie = `darkMode=${newValue};path=/;max-age=${365 * 24 * 60 * 60}`;
  };

  const handleApiKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setApiKeyLoading(true);

    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);

      const res = await api.saveApikey(user.token, {
        api_key: newApiKey.trim(),
        derpi_user_id: "",
        derpi_username: ""
      });

      const data = await res.json();

      if (data.success) {
        showToast('已更新 Derpibooru API Key', 'success');
        setCurrentApiKey(newApiKey.trim());
        localStorage.setItem('derpi_api_key', newApiKey.trim());
        closeApiKeyModal();
      } else {
        showToast(data.message || '配置失败，请重试', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请重试', 'error');
    } finally {
      setApiKeyLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword.trim() || !newPassword.trim()) {
      showToast('密码不能为空', 'error');
      return;
    }

    setPasswordLoading(true);

    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);

      const res = await api.changePassword(user.token, {
        old_password: oldPassword,
        new_password: newPassword
      });

      const data = await res.json();

      if (data.success) {
        showToast('密码修改成功，你将会退出登录', 'success');
        closePasswordModal();
        
        setTimeout(() => {
          localStorage.removeItem('user_info');
          window.dispatchEvent(new Event('user_info_updated'));
          router.push('/login');
        }, 1500);
      } else {
        showToast(data.message || '修改失败，请重试', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请重试', 'error');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) {
      showToast('用户名不能为空', 'error');
      return;
    }

    setIsLoading(true);

    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);

      const res = await api.changeUsername(user.token, newUsername.trim());

      const data = await res.json();

      if (data.success) {
        showToast('用户名修改成功！', 'success');
        setCurrentUsername(newUsername.trim());
        
        const updatedUser = { ...user, username: newUsername.trim() };
        localStorage.setItem('user_info', JSON.stringify(updatedUser));
        
        window.dispatchEvent(new Event('user_info_updated'));

        closeModal();
      } else {
        showToast(data.message || '修改失败，请重试', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请重试', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">设置</h1>
      
      <div className="bg-white dark:bg-slate-950 overflow-hidden rounded-xl">
        <div className="p-6 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">账户设置</h2>
          
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg mb-4">
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700 flex-shrink-0">
                {currentAvatar ? (
                  <img src={currentAvatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 text-2xl font-bold">
                    {currentUsername ? currentUsername.charAt(0).toUpperCase() : '?'}
                  </div>
                )}
                {isAvatarUploading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">用户头像</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">支持 JPG、PNG、GIF 格式，最大 5MB</p>
              </div>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarUpload}
              accept="image/*"
              className="hidden"
            />
            <ButtonBase
              onClick={() => fileInputRef.current?.click()}
              disabled={!currentUsername || isAvatarUploading}
              sx={buttonSx}
            >
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">修改头像</span>
            </ButtonBase>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">当前用户名</p>
              <p className="font-medium text-slate-800 dark:text-slate-200">{currentUsername || '未登录'}</p>
            </div>
            <ButtonBase
              onClick={() => setIsModalOpen(true)}
              disabled={!currentUsername}
              sx={buttonSx}
            >
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">修改用户名</span>
            </ButtonBase>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg mt-4">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">账号密码</p>
              <p className="font-medium text-slate-800 dark:text-slate-200">********</p>
            </div>
            <ButtonBase
              onClick={() => setIsPasswordModalOpen(true)}
              disabled={!currentUsername}
              sx={buttonSx}
            >
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">修改密码</span>
            </ButtonBase>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg mt-4">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Derpibooru API Key</p>
              <p className="font-medium text-slate-800 dark:text-slate-200">
                {currentApiKey ? `${currentApiKey.substring(0, 4)}...${currentApiKey.substring(currentApiKey.length - 4)}` : '未配置'}
              </p>
            </div>
            <ButtonBase
              onClick={() => {
                setNewApiKey(currentApiKey);
                setIsApiKeyModalOpen(true);
              }}
              disabled={!currentUsername}
              sx={buttonSx}
            >
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">{currentApiKey ? '修改配置' : '去配置'}</span>
            </ButtonBase>
          </div>
        </div>
        
        <div className="p-6 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">偏好设置</h2>
        </div>
      </div>

      {isModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closeModal}
        >
          <div 
            className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">修改用户名</h3>
              <button 
                onClick={closeModal}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <MdClose size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6">
              <div className="mb-4">
                <label htmlFor="newUsername" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  新用户名
                </label>
                <input
                  type="text"
                  id="newUsername"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="请输入新用户名"
                  disabled={isLoading}
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isLoading}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isLoading || !newUsername.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 flex items-center"
                >
                  {isLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      提交中...
                    </>
                  ) : (
                    '确认修改'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {isApiKeyModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isApiKeyClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closeApiKeyModal}
        >
          <div 
            className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isApiKeyClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">配置 API Key</h3>
              <button 
                onClick={closeApiKeyModal}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <MdClose size={24} />
              </button>
            </div>
            
            <form onSubmit={handleApiKeySubmit} className="p-6">
              <div className="mb-4">
                <label htmlFor="newApiKey" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Derpibooru API Key
                </label>
                <input
                  type="text"
                  id="newApiKey"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="请输入你的 API Key"
                  disabled={apiKeyLoading}
                  autoFocus
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  通过绑定Derpibooru API Key，您可以同步您的黑名单过滤、解锁内容等，且绝对安全（不涉密码）。<br />
                  获取教程：<br />
                  1. 登录Derpibooru<br />
                  2. 进入Account Settings<br />
                  3. 在页面中找到 API Key 区域的 Click to show 点击查看并复制粘贴到下方。
                </p>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closeApiKeyModal}
                  disabled={apiKeyLoading}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={apiKeyLoading}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 flex items-center"
                >
                  {apiKeyLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      提交中...
                    </>
                  ) : (
                    '确认保存'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {isPasswordModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isPasswordClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closePasswordModal}
        >
          <div 
            className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isPasswordClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">修改密码</h3>
              <button 
                onClick={closePasswordModal}
                className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <MdClose size={24} />
              </button>
            </div>
            
            <form onSubmit={handlePasswordSubmit} className="p-6">
              <div className="mb-4">
                <label htmlFor="oldPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  原密码
                </label>
                <input
                  type="password"
                  id="oldPassword"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="请输入原密码"
                  disabled={passwordLoading}
                  autoFocus
                />
              </div>
              <div className="mb-4">
                <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  新密码
                </label>
                <input
                  type="password"
                  id="newPassword"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="请输入新密码"
                  disabled={passwordLoading}
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  disabled={passwordLoading}
                  className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={passwordLoading || !oldPassword.trim() || !newPassword.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 flex items-center"
                >
                  {passwordLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      提交中...
                    </>
                  ) : (
                    '确认修改'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
