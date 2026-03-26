'use client';

import { useState, useEffect } from 'react';
import { MdEdit, MdClose } from 'react-icons/md';

export default function SettingsPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');

  const closeModal = () => {
    if (isLoading) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsModalOpen(false);
      setIsClosing(false);
      setNewUsername('');
      setError('');
      setSuccessMsg('');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) {
      setError('用户名不能为空');
      return;
    }

    setIsLoading(true);
    setError('');
    setSuccessMsg('');

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
        setSuccessMsg('用户名修改成功！');
        setCurrentUsername(newUsername.trim());
        
        const updatedUser = { ...user, username: newUsername.trim() };
        localStorage.setItem('user_info', JSON.stringify(updatedUser));
        
        window.dispatchEvent(new Event('user_info_updated'));

        setTimeout(() => {
          closeModal();
        }, 1500);
      } else {
        setError(data.message || '修改失败，请重试');
      }
    } catch (err: any) {
      setError(err.message || '网络错误，请重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-primary">设置</h1>
      
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
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
        </div>
      </div>

      {isModalOpen && (
        <div 
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 ${isClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
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

              {error && (
                <p className="text-red-500 text-sm mb-4">{error}</p>
              )}
              
              {successMsg && (
                <p className="text-green-500 text-sm mb-4">{successMsg}</p>
              )}

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
        </div>
      )}
    </div>
  );
}
