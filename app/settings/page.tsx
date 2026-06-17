'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { MdEdit, MdClose, MdEmail, MdPerson, MdImage } from 'react-icons/md';
import { showToast } from '@/components/Toast';
import { api } from '@/lib/api';

const buttonClass = (disabled: boolean) =>
  `flex items-center justify-center min-w-[36px] sm:min-w-auto min-h-[36px] sm:min-h-auto px-0 sm:px-2 py-0 sm:py-1 bg-[var(--card-bg)] border border-[var(--card-border)] rounded-md text-sm font-medium text-[var(--sidebar-text)] transition-all duration-200 hover:bg-[var(--sidebar-hover)] hover:text-primary ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;

export default function SettingsPage() {
  const router = useRouter();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentUsername, setCurrentUsername] = useState('');
  const [currentAvatar, setCurrentAvatar] = useState('');
  const [currentBanner, setCurrentBanner] = useState('');
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [isBannerUploading, setIsBannerUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Password
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isPasswordClosing, setIsPasswordClosing] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // API Key
  const [currentApiKey, setCurrentApiKey] = useState('');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [isApiKeyClosing, setIsApiKeyClosing] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [apiKeyLoading, setApiKeyLoading] = useState(false);

  // Email
  const [currentEmail, setCurrentEmail] = useState('');
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isEmailClosing, setIsEmailClosing] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [showVerifyInput, setShowVerifyInput] = useState(false);
  const [isResending, setIsResending] = useState(false);

  // Profile
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProfileClosing, setIsProfileClosing] = useState(false);
  const [profileBio, setProfileBio] = useState('');
  const [profileGender, setProfileGender] = useState('保密');
  const [profileBirthday, setProfileBirthday] = useState('');
  const [profileRace, setProfileRace] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

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

  const closeEmailModal = () => {
    if (emailLoading) return;
    setIsEmailClosing(true);
    setTimeout(() => {
      setIsEmailModalOpen(false);
      setIsEmailClosing(false);
      setNewEmail('');
      setVerifyCode('');
      setShowVerifyInput(false);
    }, 200);
  };

  const closeProfileModal = () => {
    if (profileLoading) return;
    setIsProfileClosing(true);
    setTimeout(() => {
      setIsProfileModalOpen(false);
      setIsProfileClosing(false);
    }, 200);
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user_info');
    if (!storedUser) {
      router.push('/login');
      return;
    }
    try {
      const user = JSON.parse(storedUser);
      setCurrentUsername(user.username);
      setCurrentAvatar(user.avatar || '');

      api.getUser(user.token)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.user) {
            const u = data.user;
            setCurrentApiKey(u.api_key || '');
            if (u.api_key) localStorage.setItem('derpi_api_key', u.api_key);
            else localStorage.removeItem('derpi_api_key');

            if (u.avatar) {
              const fullUrl = u.avatar.startsWith('http') ? u.avatar : `https://picpony.top/${u.avatar}`;
              setCurrentAvatar(fullUrl);
              const updatedUser = { ...user, avatar: fullUrl };
              localStorage.setItem('user_info', JSON.stringify(updatedUser));
            }

            setCurrentEmail(u.email || '');
            setIsEmailVerified(u.email_verified === 1);
            setCurrentBanner(u.banner || '');
            setProfileBio(u.bio || '');
            setProfileGender(u.gender || '保密');
            setProfileBirthday(u.birthday || '');
            setProfileRace(u.race || '');
          }
        })
        .catch(err => console.error("Failed to fetch user info", err));
    } catch (e) {
      console.error("Failed to parse user info", e);
    }
  }, [router]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('请选择图片文件', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { showToast('图片大小不能超过 5MB', 'error'); return; }

    setIsAvatarUploading(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);
      const res = await api.uploadAvatar(user.token, file);
      const data = await res.json();
      if (data.success) {
        showToast('头像上传成功', 'success');
        const fullUrl = data.avatar_url.startsWith('http') ? data.avatar_url : `https://picpony.top/${data.avatar_url}`;
        setCurrentAvatar(fullUrl);
        const updatedUser = { ...user, avatar: fullUrl };
        localStorage.setItem('user_info', JSON.stringify(updatedUser));
        window.dispatchEvent(new Event('user_info_updated'));
      } else {
        showToast(data.message || '上传失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误', 'error');
    } finally {
      setIsAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('请选择图片文件', 'error'); return; }
    if (file.size > 10 * 1024 * 1024) { showToast('图片大小不能超过 10MB', 'error'); return; }

    setIsBannerUploading(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);
      const res = await api.uploadBanner(user.token, file);
      const data = await res.json();
      if (data.success) {
        showToast('Banner 上传成功', 'success');
        const fullUrl = data.banner_url.startsWith('http') ? data.banner_url : `https://picpony.top/${data.banner_url}`;
        setCurrentBanner(fullUrl);
        const updatedUser = { ...user, banner: fullUrl };
        localStorage.setItem('user_info', JSON.stringify(updatedUser));
        window.dispatchEvent(new Event('user_info_updated'));
      } else {
        showToast(data.message || '上传失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误', 'error');
    } finally {
      setIsBannerUploading(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  };

  const handleApiKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiKeyLoading(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);
      const res = await api.saveApikey(user.token, {
        api_key: newApiKey.trim(), derpi_user_id: "", derpi_username: ""
      });
      const data = await res.json();
      if (data.success) {
        showToast('已更新 Derpibooru API Key', 'success');
        setCurrentApiKey(newApiKey.trim());
        localStorage.setItem('derpi_api_key', newApiKey.trim());
        closeApiKeyModal();
      } else {
        showToast(data.message || '配置失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误', 'error');
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
      const res = await api.changePassword(user.token, { old_password: oldPassword, new_password: newPassword });
      const data = await res.json();
      if (data.success) {
        showToast('密码修改成功，即将重新登录', 'success');
        closePasswordModal();
        setTimeout(() => {
          localStorage.removeItem('user_info');
          window.dispatchEvent(new Event('user_info_updated'));
          router.push('/login');
        }, 1500);
      } else {
        showToast(data.message || '修改失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误', 'error');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) { showToast('用户名不能为空', 'error'); return; }
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
        showToast(data.message || '修改失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) { showToast('请输入邮箱', 'error'); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) { showToast('请输入有效的邮箱地址', 'error'); return; }

    setEmailLoading(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);
      const res = await api.updateEmail(user.token, newEmail.trim());
      const data = await res.json();
      if (data.success) {
        setCurrentEmail(newEmail.trim());
        setIsEmailVerified(false);
        setShowVerifyInput(true);
        showToast('邮箱已更新，请查收验证码', 'success');
      } else {
        showToast(data.message || '更新失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误', 'error');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (!verifyCode.trim()) { showToast('请输入验证码', 'error'); return; }
    setEmailLoading(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) return;
      const user = JSON.parse(storedUser);
      const res = await api.verifyEmail(user.token, verifyCode.trim());
      const data = await res.json();
      if (data.success) {
        setIsEmailVerified(true);
        setShowVerifyInput(false);
        showToast('邮箱验证成功', 'success');
        closeEmailModal();
      } else {
        showToast(data.message || '验证失败', 'error');
      }
    } catch (err) {
      showToast('验证失败', 'error');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsResending(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) return;
      const user = JSON.parse(storedUser);
      const res = await api.resendVerifyCode(user.token);
      const data = await res.json();
      if (data.success) {
        showToast('验证码已重新发送', 'success');
      } else {
        showToast(data.message || '发送失败', 'error');
      }
    } catch {
      showToast('发送失败', 'error');
    } finally {
      setIsResending(false);
    }
  };

  const handleProfileSubmit = async () => {
    setProfileLoading(true);
    try {
      const storedUser = localStorage.getItem('user_info');
      if (!storedUser) throw new Error('未登录');
      const user = JSON.parse(storedUser);
      const res = await api.saveProfile(user.token, {
        bio: profileBio,
        gender: profileGender,
        birthday: profileBirthday,
        race: profileRace,
      });
      const data = await res.json();
      if (data.success) {
        showToast('个人资料已更新', 'success');
        window.dispatchEvent(new Event('user_info_updated'));
        closeProfileModal();
      } else {
        showToast(data.message || '保存失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误', 'error');
    } finally {
      setProfileLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-6">设置</h1>

      <div className="bg-white dark:bg-slate-950 overflow-hidden rounded-xl space-y-0">
        {/* ====== Account Settings ====== */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">账户设置</h2>

          {/* Avatar */}
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
            <input type="file" ref={fileInputRef} onChange={handleAvatarUpload} accept="image/*" className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} disabled={!currentUsername || isAvatarUploading}
              className={buttonClass(!currentUsername || isAvatarUploading)}>
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">修改头像</span>
            </button>
          </div>

          {/* Banner */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg mb-4">
            <div className="flex items-center gap-4">
              <div className="relative w-24 h-14 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 flex-shrink-0">
                {currentBanner ? (
                  <img src={currentBanner.startsWith('http') ? currentBanner : `https://picpony.top/${currentBanner}`} alt="Banner" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <MdImage size={20} />
                  </div>
                )}
                {isBannerUploading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">个人 Banner</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">建议尺寸 1200×300，最大 10MB</p>
              </div>
            </div>
            <input type="file" ref={bannerInputRef} onChange={handleBannerUpload} accept="image/*" className="hidden" />
            <button onClick={() => bannerInputRef.current?.click()} disabled={!currentUsername || isBannerUploading}
              className={buttonClass(!currentUsername || isBannerUploading)}>
              <MdImage size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">上传 Banner</span>
            </button>
          </div>

          {/* Username */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg mb-4">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">用户名</p>
              <p className="font-medium text-slate-800 dark:text-slate-200">{currentUsername || '未登录'}</p>
            </div>
            <button onClick={() => setIsModalOpen(true)} disabled={!currentUsername} className={buttonClass(!currentUsername)}>
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">修改用户名</span>
            </button>
          </div>

          {/* Password */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg mb-4">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">账号密码</p>
              <p className="font-medium text-slate-800 dark:text-slate-200">********</p>
            </div>
            <button onClick={() => setIsPasswordModalOpen(true)} disabled={!currentUsername} className={buttonClass(!currentUsername)}>
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">修改密码</span>
            </button>
          </div>

          {/* Email */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg mb-4">
            <div className="flex items-center gap-2">
              <MdEmail size={20} className="text-slate-400" />
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">邮箱</p>
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  {currentEmail || '未设置'}
                  {currentEmail && (
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${isEmailVerified ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                      {isEmailVerified ? '已验证' : '未验证'}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button onClick={() => { setNewEmail(currentEmail); setIsEmailModalOpen(true); }} disabled={!currentUsername} className={buttonClass(!currentUsername)}>
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">{currentEmail ? '修改' : '绑定'}</span>
            </button>
          </div>

          {/* Profile (Bio, Gender, Birthday) */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg mb-4">
            <div className="flex items-center gap-2">
              <MdPerson size={20} className="text-slate-400" />
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">个人资料</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {profileBio ? profileBio.substring(0, 30) + (profileBio.length > 30 ? '...' : '') : '点击编辑个人简介、性别、生日'}
                </p>
              </div>
            </div>
            <button onClick={() => setIsProfileModalOpen(true)} disabled={!currentUsername} className={buttonClass(!currentUsername)}>
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">编辑</span>
            </button>
          </div>

          {/* API Key */}
          <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg mb-4">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">Derpibooru API Key</p>
              <p className="font-medium text-slate-800 dark:text-slate-200">
                {currentApiKey ? `${currentApiKey.substring(0, 4)}...${currentApiKey.substring(currentApiKey.length - 4)}` : '未配置'}
              </p>
            </div>
            <button onClick={() => { setNewApiKey(currentApiKey); setIsApiKeyModalOpen(true); }} disabled={!currentUsername} className={buttonClass(!currentUsername)}>
              <MdEdit size={16} className="sm:mr-2" />
              <span className="hidden sm:inline">{currentApiKey ? '修改配置' : '去配置'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ====== Username Modal ====== */}
      {isModalOpen && typeof document !== 'undefined' && createPortal(
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closeModal}>
          <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">修改用户名</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><MdClose size={24} /></button>
            </div>
            <form onSubmit={handleUsernameSubmit} className="px-6 pb-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">新用户名</label>
                <input type="text" value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  placeholder="请输入新用户名" disabled={isLoading} autoFocus />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={closeModal} disabled={isLoading}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">取消</button>
                <button type="submit" disabled={isLoading || !newUsername.trim()}
                  className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary/90 rounded-lg disabled:opacity-50 flex items-center">
                  {isLoading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />提交中...</> : '确认修改'}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}

      {/* ====== Password Modal ====== */}
      {isPasswordModalOpen && typeof document !== 'undefined' && createPortal(
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isPasswordClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closePasswordModal}>
          <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isPasswordClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">修改密码</h3>
              <button onClick={closePasswordModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><MdClose size={24} /></button>
            </div>
            <form onSubmit={handlePasswordSubmit} className="px-6 pb-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">原密码</label>
                <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  placeholder="请输入原密码" disabled={passwordLoading} autoFocus />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">新密码</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  placeholder="请输入新密码" disabled={passwordLoading} />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={closePasswordModal} disabled={passwordLoading}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">取消</button>
                <button type="submit" disabled={passwordLoading || !oldPassword.trim() || !newPassword.trim()}
                  className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary/90 rounded-lg disabled:opacity-50 flex items-center">
                  {passwordLoading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />提交中...</> : '确认修改'}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}

      {/* ====== API Key Modal ====== */}
      {isApiKeyModalOpen && typeof document !== 'undefined' && createPortal(
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isApiKeyClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closeApiKeyModal}>
          <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isApiKeyClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">配置 API Key</h3>
              <button onClick={closeApiKeyModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><MdClose size={24} /></button>
            </div>
            <form onSubmit={handleApiKeySubmit} className="px-6 pb-6">
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Derpibooru API Key</label>
                <input type="text" value={newApiKey} onChange={(e) => setNewApiKey(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  placeholder="请输入你的 API Key" disabled={apiKeyLoading} autoFocus />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  通过绑定 Derpibooru API Key 可同步黑名单过滤等设置。<br />
                  获取方法：登录 Derpibooru → Account Settings → API Key 区域。
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={closeApiKeyModal} disabled={apiKeyLoading}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">取消</button>
                <button type="submit" disabled={apiKeyLoading}
                  className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary/90 rounded-lg disabled:opacity-50 flex items-center">
                  {apiKeyLoading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />提交中...</> : '确认保存'}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}

      {/* ====== Email Modal ====== */}
      {isEmailModalOpen && typeof document !== 'undefined' && createPortal(
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isEmailClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closeEmailModal}>
          <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md overflow-hidden ${isEmailClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">邮箱设置</h3>
              <button onClick={closeEmailModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><MdClose size={24} /></button>
            </div>
            <div className="px-6 pb-6 space-y-4">
              {!showVerifyInput ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">新邮箱地址</label>
                    <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                      placeholder="example@email.com" disabled={emailLoading} autoFocus />
                  </div>
                  <div className="flex justify-end gap-3">
                    <button type="button" onClick={closeEmailModal} disabled={emailLoading}
                      className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">取消</button>
                    <button onClick={handleEmailSubmit} disabled={emailLoading || !newEmail.trim()}
                      className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary/90 rounded-lg disabled:opacity-50">
                      {emailLoading ? '提交中...' : '更新邮箱'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-sm text-blue-700 dark:text-blue-400">
                    验证码已发送至 {newEmail}，请查收
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">验证码</label>
                    <input type="text" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                      placeholder="请输入验证码" disabled={emailLoading} />
                  </div>
                  <div className="flex justify-between">
                    <button onClick={handleResendCode} disabled={isResending}
                      className="text-sm text-primary hover:underline disabled:opacity-50">
                      {isResending ? '发送中...' : '重新发送'}
                    </button>
                    <div className="flex gap-3">
                      <button type="button" onClick={closeEmailModal} disabled={emailLoading}
                        className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">取消</button>
                      <button onClick={handleVerifyEmail} disabled={emailLoading || !verifyCode.trim()}
                        className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary/90 rounded-lg disabled:opacity-50">
                        {emailLoading ? '验证中...' : '验证邮箱'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>, document.body
      )}

      {/* ====== Profile Modal ====== */}
      {isProfileModalOpen && typeof document !== 'undefined' && createPortal(
        <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 ${isProfileClosing ? 'animate-modal-overlay-out' : 'animate-modal-overlay'}`}
          onClick={closeProfileModal}>
          <div className={`bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-lg overflow-hidden ${isProfileClosing ? 'animate-modal-content-out' : 'animate-modal-content'}`}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">编辑个人资料</h3>
              <button onClick={closeProfileModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"><MdClose size={24} /></button>
            </div>
            <div className="px-6 pb-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">个人简介 (Bio)</label>
                <textarea value={profileBio} onChange={(e) => setProfileBio(e.target.value)} rows={3} maxLength={500}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none"
                  placeholder="介绍一下你自己..." />
                <p className="text-xs text-slate-400 mt-1">{profileBio.length}/500</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">性别</label>
                <select value={profileGender} onChange={(e) => setProfileGender(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none">
                  <option value="保密">保密</option>
                  <option value="雄性">雄性</option>
                  <option value="雌性">雌性</option>
                  <option value="其他">其他</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">生日</label>
                <input type="date" value={profileBirthday} onChange={(e) => setProfileBirthday(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">种族</label>
                <select value={profileRace} onChange={(e) => setProfileRace(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none">
                  <option value="">未设置</option>
                  <option value="Earth Pony">陆马</option>
                  <option value="Unicorn">独角兽</option>
                  <option value="Pegasus">飞马</option>
                  <option value="Alicorn">天角兽</option>
                  <option value="Bat Pony">蝙蝠小马</option>
                  <option value="Changeling">幻形灵</option>
                  <option value="Other">其他</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeProfileModal} disabled={profileLoading}
                  className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">取消</button>
                <button onClick={handleProfileSubmit} disabled={profileLoading}
                  className="px-4 py-2 text-sm text-white bg-primary hover:bg-primary/90 rounded-lg disabled:opacity-50">
                  {profileLoading ? '保存中...' : '保存资料'}
                </button>
              </div>
            </div>
          </div>
        </div>, document.body
      )}
    </div>
  );
}
