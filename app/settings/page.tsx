'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { MdEdit, MdClose } from 'react-icons/md';
import Toast from '@/components/Toast';

export default function SettingsPage() {
  const router = useRouter();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentUsername, setCurrentUsername] = useState('');

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isPasswordClosing, setIsPasswordClosing] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  
  const [toastConfig, setToastConfig] = useState<{message: string, type: 'success' | 'error'} | null>(null);

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

  useEffect(() => {
    const storedUser = localStorage.getItem('user_info');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        setCurrentUsername(user.username);
      } catch (e) {
        console.error("Failed to parse user info", e);
      }
    }
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword.trim() || !newPassword.trim()) {
      setToastConfig({ message: '密码不能为空', type: 'error' });
      return;
    }

    setPasswordLoading(true);

    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);

      const res = await fetch('https://picpony.top/api.php?action=change_password', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword
        })
      });

      const data = await res.json();

      if (data.success) {
        setToastConfig({ message: '密码修改成功，你将会退出登录', type: 'success' });
        closePasswordModal();
        
        setTimeout(() => {
          localStorage.removeItem('user_info');
          window.dispatchEvent(new Event('user_info_updated'));
          router.push('/login');
        }, 1500);
      } else {
        setToastConfig({ message: data.message || '修改失败，请重试', type: 'error' });
      }
    } catch (err: any) {
      setToastConfig({ message: err.message || '网络错误，请重试', type: 'error' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) {
      setToastConfig({ message: '用户名不能为空', type: 'error' });
      return;
    }

    setIsLoading(true);

    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);

      const res = await fetch('https://picpony.top/api.php?action=change_username', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          new_username: newUsername.trim()
        })
      });

      const data = await res.json();

      if (data.success) {
        setToastConfig({ message: '用户名修改成功！', type: 'success' });
        setCurrentUsername(newUsername.trim());
        
        const updatedUser = { ...user, username: newUsername.trim() };
        localStorage.setItem('user_info', JSON.stringify(updatedUser));
        
        window.dispatchEvent(new Event('user_info_updated'));

        closeModal();
      } else {
        setToastConfig({ message: data.message || '修改失败，请重试', type: 'error' });
      }
    } catch (err: any) {
      setToastConfig({ message: err.message || '网络错误，请重试', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-primary">设置</h1>
      
      <div className="bg-white overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">账户设置</h2>
          
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <p className="text-sm text-slate-500 mb-1">当前用户名</p>
              <p className="font-medium text-slate-800">{currentUsername || '未登录'}</p>
            </div>
            <button
              onClick={() => setIsModalOpen(true)}
              disabled={!currentUsername}
              className="flex items-center px-4 py-2 bg-white border border-slate-200 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MdEdit size={16} className="mr-2" />
              修改用户名
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg mt-4">
            <div>
              <p className="text-sm text-slate-500 mb-1">账号密码</p>
              <p className="font-medium text-slate-800">********</p>
            </div>
            <button
              onClick={() => setIsPasswordModalOpen(true)}
              disabled={!currentUsername}
              className="flex items-center px-4 py-2 bg-white border border-slate-200 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <MdEdit size={16} className="mr-2" />
              修改密码
            </button>
          </div>
        </div>
      </div>

      {isModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closeModal}
        >
          <div 
            className={`bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-800">修改用户名</h3>
              <button 
                onClick={closeModal}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <MdClose size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6">
              <div className="mb-4">
                <label htmlFor="newUsername" className="block text-sm font-medium text-slate-700 mb-2">
                  新用户名
                </label>
                <input
                  type="text"
                  id="newUsername"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
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
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
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

      {isPasswordModalOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isPasswordClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closePasswordModal}
        >
          <div 
            className={`bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isPasswordClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-800">修改密码</h3>
              <button 
                onClick={closePasswordModal}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <MdClose size={24} />
              </button>
            </div>
            
            <form onSubmit={handlePasswordSubmit} className="p-6">
              <div className="mb-4">
                <label htmlFor="oldPassword" className="block text-sm font-medium text-slate-700 mb-2">
                  原密码
                </label>
                <input
                  type="password"
                  id="oldPassword"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="请输入原密码"
                  disabled={passwordLoading}
                  autoFocus
                />
              </div>
              <div className="mb-4">
                <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700 mb-2">
                  新密码
                </label>
                <input
                  type="password"
                  id="newPassword"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                  placeholder="请输入新密码"
                  disabled={passwordLoading}
                />
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={closePasswordModal}
                  disabled={passwordLoading}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
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

      {toastConfig && (
        <Toast 
          message={toastConfig.message} 
          type={toastConfig.type} 
          onClose={() => setToastConfig(null)} 
        />
      )}
    </div>
  );
}
