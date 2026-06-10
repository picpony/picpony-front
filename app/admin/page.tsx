'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MdBook, MdDashboard, MdSearch, MdAdd, MdDelete, MdEdit, 
  MdFileDownload, MdFileUpload, MdSync, MdWarning, MdCheckCircle, 
  MdContentCopy, MdClose, MdEmojiEvents, MdFeedback, 
  MdTranslate, MdLibraryBooks, MdCloudDownload, 
  MdOutlineWarning, MdPeople, 
  MdReport, MdBlock, MdStore, MdAttachMoney, MdBuild,
  MdToggleOn, MdToggleOff, MdBarChart,
  MdOpenInNew
} from 'react-icons/md';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { Spinner, SearchInput, SectionHeader, EmptyState } from '@/components/admin';

interface Tag {
  id: number;
  cn: string;
  en: string;
  aliases: string[];
  cat: string;
  count: number;
  description: string;
  last_editor?: string;
  created_at?: string;
}

interface TagStats {
  total: number;
  translated: number;
  leaderboard: { username: string; count: number }[];
}

interface Feedback {
  id: number;
  tag_name: string;
  content: string;
  username: string;
  status: 'pending' | 'processed' | 'rejected';
  created_at: string;
}

interface DerpiTag {
  name: string;
  category: string;
  images: number;
}

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  api_key: string | null;
  derpi_user_id: string | null;
  derpi_username: string | null;
  is_banned: number;
  created_at: string;
  experience: number;
  coins: number;
  badges?: Badge[];
}

interface Badge {
  id: number;
  badge_name: string;
  badge_color: string;
}

interface Report {
  id: number;
  image_id: number;
  username: string;
  reason: string;
  status: 'pending' | 'processed' | 'rejected';
  created_at: string;
}

interface BlacklistItem {
  image_id: number;
  reason: string;
  created_at: string;
}

interface ShopItem {
  id: number;
  name: string;
  description: string;
  image_url: string | null;
  price: number;
  stock: number;
  active: number;
}

interface NotificationItem {
  id: number;
  user_id: number;
  receiver_name?: string;
  title: string;
  content: string;
  created_at: string;
}

interface AuditMessage {
  id: number;
  sender_id: number;
  sender_name: string;
  receiver_id: number;
  receiver_name: string;
  content: string;
  is_read: number;
  created_at: string;
}

interface BadgeLink {
  id: number;
  token: string;
  badge_name: string;
  badge_color: string;
  is_active: number;
  badge_expires_at: string | null;
  link_expires_at: string | null;
}

interface BlockTag {
  id: number;
  tag_name: string;
}

interface BlockTagsGroup {
  [key: string]: BlockTag[];
}

interface TeamMember {
  id: number;
  name: string;
  role: string;
  category: string;
  avatar_url: string | null;
  link_url: string | null;
  order_num: number;
}

interface DeveloperUser {
  id: number;
  username: string;
  email: string;
  api_key: string | null;
  derpi_username: string | null;
  created_at: string;
}

type TabId = 'welcome' | 'glossary' | 'users' | 'notifications' | 'messages' | 'reports' | 'blacklist' | 'shop' | 'wealth' | 'other' | 'badges' | 'blocktags' | 'developer' | 'team';

interface TabConfig {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
}

const categoryMap: Record<string, { label: string; color: string }> = {
  character: { label: '角色', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  species: { label: '种族', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  rating: { label: '分级', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  general: { label: '常规', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  origin: { label: '来源', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  'content-official': { label: '官方内容', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  'content-fanmade': { label: '同人内容', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  error: { label: '错误', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
};

const roleBadgeMap: Record<string, { label: string; color: string }> = {
  super_admin: { label: '超管', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  admin: { label: '管理员', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  editor: { label: '小编', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  user: { label: '用户', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
};

const teamCategoryMap: Record<string, { label: string; color: string }> = {
  developer: { label: '开发团队', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  manager: { label: '管理团队', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  editor: { label: '小编团队', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  special: { label: '特别鸣谢', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
};

const filterKeyMap: Record<string, string> = {
  safe: '安全模式 (safe) — 排除项',
  spoilers: '剧透模式 (spoilers) — 排除项',
  banAnthro: '屏蔽拟人 (banAnthro) — 排除项',
  banDiscomfort: '屏蔽不适内容 (banDiscomfort) — 排除项',
  onlyPony: '只看小马 (onlyPony) — 可选物种范围 (OR 关系)',
};

function WelcomeTab() {
  return (
    <div>
      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-4">欢迎来到管理面板</h2>
      <p className="text-slate-600 dark:text-slate-400 mb-6">
        在这里您可以管理网站的各种设置和内容。请从左侧菜单选择要管理的功能模块。
      </p>
    </div>
  );
}

function UsersTab({ token, myRole }: { token: string; myRole: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetUsers(token);
      if (data.success) {
        setUsers(data.users || []);
        setFilteredUsers(data.users || []);
      }
    } catch (err) {
      showToast('加载用户失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!searchKw) {
      setFilteredUsers(users);
      return;
    }
    const kw = searchKw.toLowerCase();
    setFilteredUsers(users.filter(u => 
      String(u.id) === kw ||
      u.username?.toLowerCase().includes(kw) ||
      u.email?.toLowerCase().includes(kw)
    ));
  }, [searchKw, users]);

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setIsEditModalOpen(true);
  };

  const closeEditModal = () => {
    setIsEditModalOpen(false);
    setEditingUser(null);
  };

  const handleBan = async (userId: number, isBanned: number) => {
    if (!confirm(isBanned ? '确认封禁该用户？' : '确认解封该用户？')) return;
    try {
      const res = await api.adminUpdateUser(token, { target_id: userId, is_banned: isBanned });
      const data = await res.json();
      if (data.success) {
        showToast(isBanned ? '已封禁' : '已解封', 'success');
        loadUsers();
      } else {
        showToast(data.error || '操作失败', 'error');
      }
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const handleDelete = async (userId: number) => {
    if (!confirm('【极度危险】确定要彻底抹除此账号及所有相关数据吗？此操作无法恢复！')) return;
    try {
      const res = await api.adminDeleteUser(token, userId);
      const data = await res.json();
      if (data.success) {
        showToast('已删除', 'success');
        loadUsers();
      } else {
        showToast(data.error || '删除失败', 'error');
      }
    } catch {
      showToast('删除失败', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdPeople className="text-primary" size={24} />}
        title="用户与权限管理"
        onRefresh={loadUsers}
      />

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索用户ID、用户名或邮箱..."
      />

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">用户名</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">角色</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">邮箱</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">状态</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={6} message="" icon={<Spinner label="" />} />
            ) : filteredUsers.length === 0 ? (
              <EmptyState colSpan={6} message="没有找到匹配的用户" />
            ) : (
              filteredUsers.map((user) => {
                const roleInfo = roleBadgeMap[user.role] || roleBadgeMap.user;
                return (
                  <tr key={user.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-sm">#{user.id}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-primary">{user.username}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${roleInfo.color}`}>
                        {roleInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-400">{user.email || '-'}</td>
                    <td className="px-4 py-3">
                      {user.is_banned ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                          已封禁
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                          正常
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(user)}
                          className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded transition-colors"
                          title="编辑"
                        >
                          <MdEdit size={18} />
                        </button>
                        <button
                          onClick={() => handleBan(user.id, user.is_banned ? 0 : 1)}
                          className={`p-1.5 rounded transition-colors ${user.is_banned ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30' : 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30'}`}
                          title={user.is_banned ? '解封' : '封禁'}
                        >
                          {user.is_banned ? <MdCheckCircle size={18} /> : <MdBlock size={18} />}
                        </button>
                        <button
                          onClick={() => handleDelete(user.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                          title="删除"
                        >
                          <MdDelete size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={isEditModalOpen}
        onClose={closeEditModal}
        title="编辑用户"
        maxWidth="max-w-lg"
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          编辑用户功能正在开发中，当前仅支持封禁/解封和删除操作。
        </p>
      </Modal>
    </div>
  );
}

function ShopTab({ token }: { token: string }) {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<ShopItem | null>(null);
  const [form, setForm] = useState({
    id: 0,
    name: '',
    description: '',
    image_url: '',
    price: 10,
    stock: 100,
    active: true,
  });

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetShopItems(token);
      if (data.success) {
        setItems(data.items || []);
      }
    } catch {
      showToast('加载商品失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const resetForm = () => {
    setForm({ id: 0, name: '', description: '', image_url: '', price: 10, stock: 100, active: true });
    setEditingItem(null);
    setIsEditing(false);
  };

  const startEdit = (item: ShopItem) => {
    setEditingItem(item);
    setForm({
      id: item.id,
      name: item.name,
      description: item.description || '',
      image_url: item.image_url || '',
      price: item.price,
      stock: item.stock,
      active: item.active === 1,
    });
    setIsEditing(true);
  };

  const saveItem = async () => {
    if (!form.name.trim()) {
      showToast('请输入商品名称', 'error');
      return;
    }
    try {
      const res = await api.adminSaveShopItem(token, {
        ...form,
        active: form.active ? 1 : 0,
      });
      const data = await res.json();
      if (data.success) {
        showToast(editingItem ? '更新成功' : '添加成功', 'success');
        resetForm();
        loadItems();
      } else {
        showToast(data.error || '保存失败', 'error');
      }
    } catch {
      showToast('保存失败', 'error');
    }
  };

  const deleteItem = async (id: number) => {
    if (!confirm('确定要删除这个商品吗？')) return;
    try {
      const res = await api.adminDeleteShopItem(token, id);
      const data = await res.json();
      if (data.success) {
        showToast('删除成功', 'success');
        loadItems();
      } else {
        showToast(data.error || '删除失败', 'error');
      }
    } catch {
      showToast('删除失败', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdStore className="text-primary" size={24} />}
        title="小商店管理"
        onRefresh={loadItems}
      />

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
          {isEditing ? <MdEdit size={20} /> : <MdAdd size={20} />}
          {isEditing ? '编辑商品' : '添加新商品'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">商品名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">图片URL</label>
            <input
              type="text"
              value={form.image_url}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">价格（金币）</label>
            <input
              type="number"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">库存</label>
            <input
              type="number"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">商品简介</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm resize-none"
          />
        </div>
        <div className="flex items-center gap-4 mb-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="w-4 h-4 text-primary border-slate-300 rounded focus:ring-primary"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">上架展示</span>
          </label>
        </div>
        <div className="flex gap-3">
          {isEditing && (
            <button
              onClick={resetForm}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
          )}
          <button
            onClick={saveItem}
            className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
          >
            {isEditing ? '保存修改' : '添加商品'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">商品</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">价格</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">库存</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">状态</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={6} message="" icon={<Spinner label="" />} />
            ) : items.length === 0 ? (
              <EmptyState colSpan={6} message="暂无商品" />
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm">#{item.id}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.image_url && (
                        <img src={item.image_url} alt="" className="w-10 h-10 rounded object-cover" />
                      )}
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200">{item.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{item.description}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-amber-600">{item.price}</td>
                  <td className="px-4 py-3 text-sm">{item.stock}</td>
                  <td className="px-4 py-3">
                    {item.active === 1 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        上架中
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        已下架
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEdit(item)}
                        className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded transition-colors"
                      >
                        <MdEdit size={18} />
                      </button>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                      >
                        <MdDelete size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsTab({ token }: { token: string }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [filteredReports, setFilteredReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetReports(token);
      if (data.success) {
        setReports(data.reports || []);
        setFilteredReports(data.reports || []);
      }
    } catch {
      showToast('加载举报失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    if (!searchKw) {
      setFilteredReports(reports);
      return;
    }
    const kw = searchKw.toLowerCase();
    setFilteredReports(reports.filter(r => 
      String(r.id) === kw ||
      String(r.image_id) === kw ||
      r.username?.toLowerCase().includes(kw)
    ));
  }, [searchKw, reports]);

  const handleReport = async (id: number, status: string) => {
    try {
      const res = await api.adminHandleReport(token, id, status);
      const data = await res.json();
      if (data.success) {
        showToast('处理成功', 'success');
        loadReports();
      } else {
        showToast(data.error || '处理失败', 'error');
      }
    } catch {
      showToast('处理失败', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdReport className="text-primary" size={24} />}
        title="违规举报处理"
        onRefresh={loadReports}
      />

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索举报ID、图片ID或举报人..."
      />

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">单号</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">图片</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">举报人</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">原因</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">状态</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={6} message="" icon={<Spinner label="" />} />
            ) : filteredReports.length === 0 ? (
              <EmptyState colSpan={6} message="暂无举报记录" />
            ) : (
              filteredReports.map((report) => (
                <tr key={report.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm">#{report.id}</td>
                  <td className="px-4 py-3">
                    <a 
                      href={`/pic/${report.image_id}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-sm flex items-center gap-1"
                    >
                      #{report.image_id} <MdOpenInNew size={14} />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm">{report.username}</td>
                  <td className="px-4 py-3 text-sm max-w-xs truncate" title={report.reason}>{report.reason}</td>
                  <td className="px-4 py-3">
                    {report.status === 'pending' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        待处理
                      </span>
                    ) : report.status === 'processed' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        已处理
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        已驳回
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {report.status === 'pending' ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleReport(report.id, 'processed')}
                          className="px-3 py-1 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded transition-colors"
                        >
                          完结
                        </button>
                        <button
                          onClick={() => handleReport(report.id, 'rejected')}
                          className="px-3 py-1 text-xs font-medium text-white bg-slate-400 hover:bg-slate-500 rounded transition-colors"
                        >
                          驳回
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">已归档</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BlacklistTab({ token }: { token: string }) {
  const [blacklist, setBlacklist] = useState<BlacklistItem[]>([]);
  const [filteredBlacklist, setFilteredBlacklist] = useState<BlacklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');
  const [imageId, setImageId] = useState('');
  const [reason, setReason] = useState('');

  const loadBlacklist = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetBlacklist(token);
      if (data.success) {
        setBlacklist(data.blacklist || []);
        setFilteredBlacklist(data.blacklist || []);
      }
    } catch {
      showToast('加载黑名单失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadBlacklist();
  }, [loadBlacklist]);

  useEffect(() => {
    if (!searchKw) {
      setFilteredBlacklist(blacklist);
      return;
    }
    const kw = searchKw.toLowerCase();
    setFilteredBlacklist(blacklist.filter(b => 
      String(b.image_id) === kw ||
      b.reason?.toLowerCase().includes(kw)
    ));
  }, [searchKw, blacklist]);

  const addBlacklist = async () => {
    if (!imageId) {
      showToast('请输入图片ID', 'error');
      return;
    }
    try {
      const res = await api.adminAddBlacklist(token, parseInt(imageId), reason);
      const data = await res.json();
      if (data.success) {
        showToast('已添加屏蔽', 'success');
        setImageId('');
        setReason('');
        loadBlacklist();
      } else {
        showToast(data.error || '添加失败', 'error');
      }
    } catch {
      showToast('添加失败', 'error');
    }
  };

  const removeBlacklist = async (id: number) => {
    if (!confirm(`确定要解除对图片 #${id} 的屏蔽吗？`)) return;
    try {
      const res = await api.adminRemoveBlacklist(token, id);
      const data = await res.json();
      if (data.success) {
        showToast('已解除屏蔽', 'success');
        loadBlacklist();
      } else {
        showToast(data.error || '解除失败', 'error');
      }
    } catch {
      showToast('解除失败', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdBlock className="text-primary" size={24} />}
        title="全局违规图片屏蔽库"
        onRefresh={loadBlacklist}
      />

      <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-900/30">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">图片ID</label>
            <input
              type="number"
              value={imageId}
              onChange={(e) => setImageId(e.target.value)}
              placeholder="例如: 3123456"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div className="flex-[2]">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">屏蔽原因（仅后台可见）</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如: 严重违规、政治敏感..."
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={addBlacklist}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              <MdAdd size={18} className="inline mr-1" />
              强制屏蔽
            </button>
          </div>
        </div>
      </div>

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索已屏蔽图片..."
      />

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">图片ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">原帖</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">屏蔽原因</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">时间</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={5} message="" icon={<Spinner label="" />} />
            ) : filteredBlacklist.length === 0 ? (
              <EmptyState colSpan={5} message="暂无屏蔽记录" />
            ) : (
              filteredBlacklist.map((item) => (
                <tr key={item.image_id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm font-medium">#{item.image_id}</td>
                  <td className="px-4 py-3">
                    <a 
                      href={`/pic/${item.image_id}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:underline text-sm flex items-center gap-1"
                    >
                      查看原帖 <MdOpenInNew size={14} />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm">{item.reason || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{item.created_at}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => removeBlacklist(item.image_id)}
                      className="px-3 py-1 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded transition-colors"
                    >
                      解除屏蔽
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WealthTab({ token }: { token: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchKw, setSearchKw] = useState('');
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState({
    experience: 0,
    coinsOp: 'add',
    coinsValue: '',
    reason: '',
  });

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetWealth(token);
      if (data.success) {
        setUsers(data.users || []);
        setFilteredUsers(data.users || []);
      }
    } catch {
      showToast('加载用户失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!searchKw) {
      setFilteredUsers(users);
      return;
    }
    const kw = searchKw.toLowerCase();
    setFilteredUsers(users.filter(u => 
      String(u.id) === kw ||
      u.username?.toLowerCase().includes(kw)
    ));
  }, [searchKw, users]);

  const openModal = (user: User) => {
    setEditingUser(user);
    setForm({
      experience: user.experience || 0,
      coinsOp: 'add',
      coinsValue: '',
      reason: '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const submit = async () => {
    if (!editingUser) return;
    if (!form.reason.trim()) {
      showToast('请填写变动原因', 'error');
      return;
    }
    try {
      const res = await api.adminUpdateWealth(token, {
        target_id: editingUser.id,
        experience: form.experience,
        coins_op: form.coinsOp,
        coins_value: form.coinsValue,
        reason: form.reason,
      });
      const data = await res.json();
      if (data.success) {
        showToast('修改成功', 'success');
        closeModal();
        loadUsers();
      } else {
        showToast(data.error || '修改失败', 'error');
      }
    } catch {
      showToast('修改失败', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdAttachMoney className="text-primary" size={24} />}
        title="经验与金币管理"
        onRefresh={loadUsers}
      />

      <SearchInput
        value={searchKw}
        onChange={setSearchKw}
        placeholder="搜索用户ID或用户名..."
      />

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">用户名</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">当前经验</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">当前金币</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={5} message="" icon={<Spinner label="" />} />
            ) : filteredUsers.length === 0 ? (
              <EmptyState colSpan={5} message="没有找到匹配的用户" />
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm">#{user.id}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-primary">{user.username}</span>
                  </td>
                  <td className="px-4 py-3 text-sm">{user.experience || 0}</td>
                  <td className="px-4 py-3 text-sm font-medium text-amber-600">{user.coins || 0}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openModal(user)}
                      className="px-3 py-1 text-xs font-medium text-white bg-primary hover:bg-primary/90 rounded transition-colors"
                    >
                      修改资产
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={`修改资产 - ${editingUser?.username || ''}`}
        maxWidth="max-w-md"
        footer={
          <>
            <button
              onClick={closeModal}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={submit}
              className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
            >
              确认修改
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">经验值</label>
            <input
              type="number"
              value={form.experience}
              onChange={(e) => setForm({ ...form, experience: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">金币操作</label>
            <div className="flex gap-2">
              <select
                value={form.coinsOp}
                onChange={(e) => setForm({ ...form, coinsOp: e.target.value })}
                className="px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
              >
                <option value="add">[+]</option>
                <option value="sub">[-]</option>
                <option value="set">[=]</option>
              </select>
              <input
                type="number"
                value={form.coinsValue}
                onChange={(e) => setForm({ ...form, coinsValue: e.target.value })}
                placeholder="数值"
                className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">变动原因（必填）</label>
            <input
              type="text"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="例如: 违规惩罚、特殊活动奖励..."
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

function OtherTab({ token }: { token: string }) {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [translateEnabled, setTranslateEnabled] = useState(true);
  const [stats, setStats] = useState({ images: 0, tags: 0, comments: 0, updated_at: '-' });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadSettings();
    loadStats();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.getMaintenanceStatus();
      if (data.success) {
        setMaintenanceMode(data.maintenance_mode);
        setMaintenanceMessage(data.maintenance_message || '');
        setTranslateEnabled(data.translate_enabled !== false);
      }
    } catch {
      showToast('加载设置失败', 'error');
    }
  };

  const loadStats = async () => {
    try {
      const data = await api.getSiteStats();
      if (data.success && data.stats) {
        setStats(data.stats);
      }
    } catch {
      // ignore
    }
  };

  const toggleMaintenance = async () => {
    const newValue = !maintenanceMode;
    if (newValue && !confirm('开启维护模式后，所有非管理员用户将无法访问网站，确定要开启吗？')) return;
    try {
      const res = await api.adminToggleMaintenance(token, {
        maintenance_mode: newValue,
        maintenance_message: maintenanceMessage,
      });
      const data = await res.json();
      if (data.success) {
        setMaintenanceMode(newValue);
        showToast(newValue ? '维护模式已开启' : '维护模式已关闭', 'success');
      } else {
        showToast(data.error || '操作失败', 'error');
      }
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const toggleTranslate = async () => {
    const newValue = !translateEnabled;
    try {
      const res = await api.adminToggleTranslate(token, { translate_enabled: newValue });
      const data = await res.json();
      if (data.success) {
        setTranslateEnabled(newValue);
        showToast(newValue ? '翻译功能已开启' : '翻译功能已关闭', 'success');
      } else {
        showToast(data.error || '操作失败', 'error');
      }
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const syncStats = async () => {
    if (!confirm('确定要从原站同步最新的数据统计吗？')) return;
    setIsLoading(true);
    try {
      showToast('同步功能需要后端支持', 'warning');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <MdBuild className="text-primary" size={24} />
        其他功能
      </h2>

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <MdWarning size={20} />
              维护模式
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              开启后，所有非管理员用户访问前台将看到全屏维护提示
            </p>
          </div>
          <button
            onClick={toggleMaintenance}
            className={`p-2 rounded-lg transition-colors ${maintenanceMode ? 'text-red-500 bg-red-50 dark:bg-red-950/30' : 'text-slate-400 bg-slate-100 dark:bg-slate-700'}`}
          >
            {maintenanceMode ? <MdToggleOn size={32} /> : <MdToggleOff size={32} />}
          </button>
        </div>
        {maintenanceMode && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">维护提示文字</label>
            <textarea
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              placeholder="例如：服务器正在升级维护..."
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm resize-none"
            />
          </div>
        )}
      </div>

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <MdTranslate size={20} />
              图片翻译功能
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              控制前台大图模态框中是否展示"一键图片翻译"按钮
            </p>
          </div>
          <button
            onClick={toggleTranslate}
            className={`p-2 rounded-lg transition-colors ${translateEnabled ? 'text-green-500 bg-green-50 dark:bg-green-950/30' : 'text-slate-400 bg-slate-100 dark:bg-slate-700'}`}
          >
            {translateEnabled ? <MdToggleOn size={32} /> : <MdToggleOff size={32} />}
          </button>
        </div>
      </div>

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
          <MdBarChart size={20} />
          全站数据统计
        </h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center p-3 bg-white dark:bg-slate-700 rounded-lg">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">图片总数</div>
            <div className="text-xl font-bold text-primary">{stats.images?.toLocaleString() || 0}</div>
          </div>
          <div className="text-center p-3 bg-white dark:bg-slate-700 rounded-lg">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">标签总数</div>
            <div className="text-xl font-bold text-primary">{stats.tags?.toLocaleString() || 0}</div>
          </div>
          <div className="text-center p-3 bg-white dark:bg-slate-700 rounded-lg">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">评论总数</div>
            <div className="text-xl font-bold text-primary">{stats.comments?.toLocaleString() || 0}</div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            上次同步: <span className="font-medium">{stats.updated_at || '未同步'}</span>
          </span>
          <button
            onClick={syncStats}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors disabled:opacity-50"
          >
            <MdSync size={18} className={isLoading ? 'animate-spin' : ''} />
            立即同步
          </button>
        </div>
      </div>
    </div>
  );
}

function GlossaryTab() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>('user');
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState<string>('');

  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalMatches, setTotalMatches] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(100);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortMode, setSortMode] = useState('count_desc');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showUntranslatedOnly, setShowUntranslatedOnly] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isEditModalClosing, setIsEditModalClosing] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editForm, setEditForm] = useState({
    id: 0,
    en: '',
    cn: '',
    aliases: '',
    cat: 'general',
    count: 0,
    description: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [derpiSuggestions, setDerpiSuggestions] = useState<DerpiTag[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isBatchModalClosing, setIsBatchModalClosing] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [isBatchImporting, setIsBatchImporting] = useState(false);

  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isSyncModalClosing, setIsSyncModalClosing] = useState(false);
  const [syncStartPage, setSyncStartPage] = useState(1);
  const [syncEndPage, setSyncEndPage] = useState(20);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, message: '' });

  const [isDuplicateMode, setIsDuplicateMode] = useState(false);
  const [duplicateTags, setDuplicateTags] = useState<Tag[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [isFeedbackModalClosing, setIsFeedbackModalClosing] = useState(false);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);

  const [isDerpiModalOpen, setIsDerpiModalOpen] = useState(false);
  const [isDerpiModalClosing, setIsDerpiModalClosing] = useState(false);
  const [derpiSearchQuery, setDerpiSearchQuery] = useState('');
  const [derpiResults, setDerpiResults] = useState<DerpiTag[]>([]);
  const [isDerpiSearching, setIsDerpiSearching] = useState(false);

  const [stats, setStats] = useState<TagStats>({ total: 0, translated: 0, leaderboard: [] });
  const [showFullLeaderboard, setShowFullLeaderboard] = useState(false);

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user_info');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        setToken(user.token);
        setUserRole(user.role || 'user');
        const allowedRoles = ['super_admin', 'admin', 'editor'];
        setIsAdmin(allowedRoles.includes(user.role));
      } catch {
        setError('请先登录');
      }
    } else {
      setError('请先登录');
    }

    const savedItemsPerPage = localStorage.getItem('picpony_items_per_page');
    if (savedItemsPerPage) {
      setItemsPerPage(parseInt(savedItemsPerPage, 10));
    }
  }, []);

  const loadTags = useCallback(async (page = 1, preserveScroll = false) => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const data = await api.getDictionary(token, {
        page,
        limit: itemsPerPage,
        keyword: searchKeyword,
        sort: sortMode,
        category: categoryFilter,
        untranslated: showUntranslatedOnly ? 1 : 0,
      });

      if (data.success) {
        setTags(data.tags || []);
        setTotalMatches(data.total_matches || 0);
        setTotalPages(Math.ceil((data.total_matches || 0) / itemsPerPage) || 1);
        setCurrentPage(page);
        if (data.stats) {
          setStats(data.stats);
        }
      } else {
        setError(data.error || '加载失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setIsLoading(false);
    }
  }, [token, itemsPerPage, searchKeyword, sortMode, categoryFilter, showUntranslatedOnly]);

  useEffect(() => {
    if (token) {
      loadTags(1);
    }
  }, [token, loadTags]);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      if (!isDuplicateMode) {
        loadTags(1);
      }
    }, 400);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchKeyword, sortMode, categoryFilter, showUntranslatedOnly, loadTags, isDuplicateMode]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadDuplicates = async () => {
    if (!token || !isAdmin) return;

    setIsLoading(true);
    try {
      const data = await api.getDictionaryDuplicates(token);
      if (data.success && data.tags) {
        setDuplicateTags(data.tags);
        setTotalMatches(data.tags.length);
      } else {
        setDuplicateTags([]);
        setTotalMatches(0);
      }
    } catch (err) {
      showToast('查重失败: ' + (err instanceof Error ? err.message : '未知错误'), 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleDuplicateMode = () => {
    if (!isAdmin) {
      showToast('无权限', 'error');
      return;
    }

    const newMode = !isDuplicateMode;
    setIsDuplicateMode(newMode);
    setSelectedIds(new Set());

    if (newMode) {
      loadDuplicates();
    } else {
      loadTags(1);
    }
  };

  const openEditModal = (tag?: Tag) => {
    if (!isAdmin) {
      showToast('无权限', 'error');
      return;
    }

    if (tag) {
      setEditingTag(tag);
      setEditForm({
        id: tag.id,
        en: tag.en,
        cn: tag.cn === '未翻译' ? '' : tag.cn,
        aliases: tag.aliases?.join(',') || '',
        cat: tag.cat || 'general',
        count: tag.count || 0,
        description: tag.description || '',
      });
    } else {
      setEditingTag(null);
      setEditForm({
        id: 0,
        en: '',
        cn: '',
        aliases: '',
        cat: 'general',
        count: 0,
        description: '',
      });
    }
    setIsEditModalOpen(true);
    setIsEditModalClosing(false);
    setDerpiSuggestions([]);
    setShowSuggestions(false);
  };

  const closeEditModal = () => {
    setIsEditModalClosing(true);
    setTimeout(() => {
      setIsEditModalOpen(false);
      setIsEditModalClosing(false);
    }, 200);
  };

  const searchDerpiSuggestions = async (query: string) => {
    if (query.length < 2) {
      setDerpiSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const data = await api.searchDerpiTags(query);
      if (data.tags && data.tags.length > 0) {
        setDerpiSuggestions(data.tags);
        setShowSuggestions(true);
      } else {
        setDerpiSuggestions([]);
        setShowSuggestions(false);
      }
    } catch {
      // ignore
    }
  };

  const selectSuggestion = (tag: DerpiTag) => {
    setEditForm((prev) => ({
      ...prev,
      en: tag.name,
      cat: tag.category || 'general',
      count: tag.images || 0,
    }));
    setShowSuggestions(false);
  };

  const saveTag = async () => {
    if (!isAdmin || !token) return;

    const { en, cn, aliases, cat, count, description, id } = editForm;

    if (!en.trim()) {
      showToast('英文标签不能为空', 'error');
      return;
    }

    setIsSaving(true);

    try {
      if (!id) {
        const exists = await api.checkTagExists(token, en);
        if (exists) {
          showToast('词库中已存在此标签', 'error');
          setIsSaving(false);
          return;
        }
      }

      let finalCn = '未翻译';
      let finalAliases: string[] = [];

      if (cn.trim()) {
        const parts = cn.replace(/，/g, ',').split(',').map((s) => s.trim()).filter((s) => s);
        if (parts.length > 0) {
          finalCn = parts[0];
          finalAliases = parts.slice(1);
        }
      }

      const res = await api.saveDictionaryTag(token, {
        id: id || undefined,
        en: en.trim(),
        cn: finalCn,
        aliases: finalAliases,
        cat,
        count,
        description: description.trim(),
      });

      const data = await res.json();

      if (data.success) {
        showToast(id ? '更新成功' : '添加成功', 'success');
        closeEditModal();
        if (isDuplicateMode) {
          loadDuplicates();
        } else {
          loadTags(currentPage);
        }
      } else {
        showToast(data.error || '保存失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteTag = async (id: number) => {
    if (!isAdmin || !token) return;

    if (!confirm('确定要永久删除这个词条吗？')) return;

    try {
      const res = await api.deleteDictionaryTag(token, id);
      const data = await res.json();

      if (data.success) {
        showToast('删除成功', 'success');
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        if (isDuplicateMode) {
          loadDuplicates();
        } else {
          loadTags(currentPage);
        }
      } else {
        showToast(data.error || '删除失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误', 'error');
    }
  };

  const batchDelete = async () => {
    if (!isAdmin || !token || selectedIds.size === 0) return;

    if (!confirm(`确定要永久删除选中的 ${selectedIds.size} 个标签吗？`)) {
      return;
    }

    const idsArray = Array.from(selectedIds);
    let success = 0;
    let fail = 0;

    for (let i = 0; i < idsArray.length; i++) {
      try {
        const res = await api.deleteDictionaryTag(token, idsArray[i]);
        const data = await res.json();
        if (data.success) success++;
        else fail++;
      } catch {
        fail++;
      }
      await new Promise((r) => setTimeout(r, 60));
    }

    showToast(`批量删除完成: ${success}成功, ${fail}失败`, 'success');

    setSelectedIds(new Set());
    if (isDuplicateMode) {
      loadDuplicates();
    } else {
      loadTags(currentPage);
    }
  };

  const toggleSelectAll = () => {
    const allIds = (isDuplicateMode ? duplicateTags : tags).map((t) => t.id);
    const allSelected = allIds.every((id) => selectedIds.has(id));

    if (allSelected) {
      const newSelected = new Set(selectedIds);
      allIds.forEach((id) => newSelected.delete(id));
      setSelectedIds(newSelected);
    } else {
      const newSelected = new Set(selectedIds);
      allIds.forEach((id) => newSelected.add(id));
      setSelectedIds(newSelected);
    }
  };

  const toggleRowSelection = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const executeBatchImport = async () => {
    if (!isAdmin || !token) return;

    const lines = batchInput.split('\n');
    const tasks: { en: string; cn: string; aliases: string[]; cat: string; count: number; description: string }[] = [];
    const batchEnTags = new Set<string>();

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#') || !trimmedLine.includes('=')) continue;

      const parts = trimmedLine.split('=');
      const en = parts[0].trim().toLowerCase();
      const cnRaw = parts[1]?.trim() || '';

      const cnParts = cnRaw.replace(/，/g, ',').split(',').map((s) => s.trim()).filter((s) => s);
      if (cnParts.length === 0 || !en) continue;

      if (batchEnTags.has(en)) continue;

      tasks.push({
        en,
        cn: cnParts[0],
        aliases: cnParts.slice(1),
        cat: 'general',
        count: 0,
        description: '',
      });

      batchEnTags.add(en);
    }

    if (tasks.length === 0) {
      showToast('没有解析到有效数据', 'error');
      return;
    }

    if (!confirm(`成功解析到 ${tasks.length} 个新标签，开始导入？`)) {
      return;
    }

    setIsBatchImporting(true);
    let success = 0;
    let fail = 0;
    let skipped = 0;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      try {
        const exists = await api.checkTagExists(token, task.en);
        if (exists) {
          skipped++;
          continue;
        }

        const res = await api.saveDictionaryTag(token, task);
        const data = await res.json();
        if (data.success) success++;
        else fail++;
      } catch {
        fail++;
      }
      await new Promise((r) => setTimeout(r, 60));
    }

    showToast(`批量导入完成: ${success}成功, ${skipped}跳过, ${fail}失败`, 'success');

    setIsBatchImporting(false);
    setIsBatchModalOpen(false);
    setBatchInput('');
    loadTags(1);
  };

  const executeSync = async () => {
    if (!isAdmin || !token) return;

    const totalPagesToFetch = syncEndPage - syncStartPage + 1;
    if (totalPagesToFetch > 100) {
      showToast('一次最多允许拉取 100 页', 'error');
      return;
    }

    setIsSyncing(true);
    setSyncProgress({ current: 0, total: totalPagesToFetch, message: '开始同步...' });

    let newTagsCount = 0;
    let skippedCount = 0;

    for (let p = syncStartPage; p <= syncEndPage; p++) {
      setSyncProgress({ current: p - syncStartPage + 1, total: totalPagesToFetch, message: `正在拉取第 ${p} 页...` });

      try {
        const data = await api.getDerpiPopularTags(p);
        if (!data.tags || data.tags.length === 0) break;

        for (const tag of data.tags) {
          const exists = await api.checkTagExists(token, tag.name);
          if (exists) {
            skippedCount++;
            continue;
          }

          await api.saveDictionaryTag(token, {
            en: tag.name,
            cn: '未翻译',
            aliases: [],
            cat: tag.category || 'general',
            count: tag.images || 0,
            description: '',
          });

          newTagsCount++;
          await new Promise((r) => setTimeout(r, 40));
        }
      } catch (err) {
        console.error(`Sync page ${p} failed:`, err);
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    setIsSyncing(false);
    showToast(`同步完成: ${newTagsCount}新增, ${skippedCount}跳过`, 'success');
    setIsSyncModalOpen(false);
    loadTags(1);
  };

  const executeDerpiSearch = async () => {
    if (!derpiSearchQuery.trim()) return;

    setIsDerpiSearching(true);
    try {
      const data = await api.searchDerpiTags(derpiSearchQuery);
      setDerpiResults(data.tags || []);
    } catch (err) {
      showToast('搜索失败', 'error');
    } finally {
      setIsDerpiSearching(false);
    }
  };

  const importFromDerpi = (tag: DerpiTag) => {
    setIsDerpiModalOpen(false);
    openEditModal({
      id: 0,
      en: tag.name,
      cn: '未翻译',
      aliases: [],
      cat: tag.category || 'general',
      count: tag.images || 0,
      description: '',
    });
  };

  const loadFeedbacks = async () => {
    if (!token || !isAdmin) return;

    setIsLoadingFeedback(true);
    try {
      const data = await api.getTagFeedback(token);
      if (data.success) {
        setFeedbacks(data.feedbacks || []);
      }
    } catch {
      showToast('加载反馈失败', 'error');
    } finally {
      setIsLoadingFeedback(false);
    }
  };

  const handleFeedback = async (id: number, status: string) => {
    if (!token) return;

    try {
      await api.handleTagFeedback(token, id, status);
      loadFeedbacks();
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const exportCurrentPage = () => {
    const dataToExport = isDuplicateMode ? duplicateTags : tags;
    if (dataToExport.length === 0) {
      showToast('当前没有数据可导出', 'error');
      return;
    }

    const txtParts = dataToExport.map((tag) => {
      let cn = tag.cn === '未翻译' ? '' : tag.cn;
      if (cn && tag.aliases?.length) {
        cn += ',' + tag.aliases.join(',');
      }
      return `A:${tag.en} - B:${cn} - C:${tag.description || ''}`;
    });

    const txtContent = txtParts.join(' // ');
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tags_page_${currentPage}_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('导出成功', 'success');
  };

  const loadFullLeaderboard = async () => {
    try {
      const data = await api.getDictionaryLeaderboard();
      if (data.success && data.leaderboard) {
        setStats((prev) => ({ ...prev, leaderboard: data.leaderboard }));
        setShowFullLeaderboard(true);
      }
    } catch {
      showToast('加载排行榜失败', 'error');
    }
  };

  const renderTagRow = (tag: Tag) => {
    const isSelected = selectedIds.has(tag.id);
    const catInfo = categoryMap[tag.cat] || categoryMap.general;

    return (
      <tr
        key={tag.id}
        className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      >
        <td className="px-4 py-3 text-center">
            {isAdmin && (
              <label className="relative flex items-center justify-center w-5 h-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleRowSelection(tag.id)}
                  className="peer sr-only"
                />
                <div className="w-5 h-5 rounded-md border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 peer-checked:bg-primary peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 transition-all duration-200" />
                <svg
                  className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 pointer-events-none"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </label>
            )}
        </td>
              <td className="px-4 py-3">
                {tag.cn === '未翻译' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 whitespace-nowrap">
                    <MdOutlineWarning size={14} />
                    未翻译
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-primary/10 text-primary">
                      {tag.cn}
                    </span>
                    {tag.aliases?.map((alias, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${catInfo.color}`}>
                    {tag.cat}
                  </span>
                  <a
                    href={`/#q=${encodeURIComponent(tag.en)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    {tag.en} <MdSearch size={14} />
                  </a>
            {tag.count > 0 ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                原站 ({tag.count}图)
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                本地
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          {tag.description ? (
            <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2" title={tag.description}>
              {tag.description}
            </p>
          ) : (
            <span className="text-sm text-slate-400 dark:text-slate-500">暂无简介</span>
          )}
        </td>
        <td className="px-4 py-3">
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => openEditModal(tag)}
                className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded transition-colors"
                title="编辑"
              >
                <MdEdit size={18} />
              </button>
              <button
                onClick={() => deleteTag(tag.id)}
                className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                title="删除"
              >
                <MdDelete size={18} />
              </button>
            </div>
          ) : (
            <span className="text-sm text-slate-400">无权限</span>
          )}
        </td>
      </tr>
    );
  };

  const translationPercentage = stats.total > 0 ? ((stats.translated / stats.total) * 100).toFixed(2) : '0.00';

  if (error && !tags.length) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500 dark:text-slate-400 mb-4">{error}</p>
        <button
          onClick={() => loadTags(1)}
          className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <MdLibraryBooks className="text-primary" size={24} />
          中英标签词库管理 ({totalMatches} 条)
        </h2>
        {isAdmin && (
          <button
            onClick={() => openEditModal()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors shrink-0"
          >
            <MdAdd size={18} />
            添加新标签
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="搜索中文或英文标签..."
            className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
          />
        </div>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value)}
          className="px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm shrink-0"
        >
          <option value="count_desc">热度：高到低</option>
          <option value="count_asc">热度：低到高</option>
          <option value="newest">最新添加</option>
          <option value="en_asc">英文：A-Z</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm shrink-0"
        >
          <option value="all">全部分类</option>
          <option value="general">常规</option>
          <option value="character">角色</option>
          <option value="species">种族</option>
          <option value="rating">分级</option>
          <option value="origin">来源</option>
          <option value="content-official">官方内容</option>
          <option value="content-fanmade">同人内容</option>
          <option value="error">错误</option>
        </select>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowUntranslatedOnly(!showUntranslatedOnly)}
            className={`inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 ${
              showUntranslatedOnly
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-primary/10 text-primary hover:bg-primary/20'
            }`}
          >
            {showUntranslatedOnly ? <MdClose size={16} /> : <MdTranslate size={16} />}
            {showUntranslatedOnly ? '取消未翻译过滤' : '只看未翻译'}
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={batchDelete}
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors shrink-0"
            >
              <MdDelete size={16} />
              批量删除 ({selectedIds.size})
            </button>
          )}
          <button
            onClick={toggleDuplicateMode}
            className={`inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 ${
              isDuplicateMode
                ? 'bg-primary text-white hover:bg-primary/90'
                : 'bg-primary/10 text-primary hover:bg-primary/20'
            }`}
          >
            <MdContentCopy size={16} />
            {isDuplicateMode ? '退出查重' : '查重模式'}
          </button>
          <button
            onClick={() => setIsFeedbackModalOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors shrink-0"
          >
            <MdFeedback size={16} />
            用户反馈
          </button>
          <button
            onClick={exportCurrentPage}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors shrink-0"
          >
            <MdFileDownload size={16} />
            导出当前页
          </button>
          <button
            onClick={() => setIsBatchModalOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors shrink-0"
          >
            <MdFileUpload size={16} />
            批量导入
          </button>
          <button
            onClick={() => setIsSyncModalOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors shrink-0"
          >
            <MdCloudDownload size={16} />
            同步热门
          </button>
          <button
            onClick={() => setIsDerpiModalOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors shrink-0"
          >
            <MdSearch size={16} />
            搜原站标签
          </button>
        </div>
      )}

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-center w-12">
              {isAdmin && (
                  <label className="relative flex items-center justify-center w-5 h-5 cursor-pointer">
                    <input
                      type="checkbox"
                      onChange={toggleSelectAll}
                      checked={
                        (isDuplicateMode ? duplicateTags : tags).length > 0 &&
                        (isDuplicateMode ? duplicateTags : tags).every((t) => selectedIds.has(t.id))
                      }
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 rounded-md border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 peer-checked:bg-primary peer-checked:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 transition-all duration-200" />
                    <svg
                      className="absolute w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 pointer-events-none"
                      viewBox="0 0 12 12"
                      fill="none"
                    >
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </label>
                )}
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">中文翻译</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">英文标签</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">标签简介</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300 w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={5} message="" icon={<Spinner label="" />} />
            ) : (isDuplicateMode ? duplicateTags : tags).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                  {isDuplicateMode ? (
                    <div className="flex flex-col items-center gap-2">
                      <MdCheckCircle size={32} className="text-green-500" />
                      <p className="flex items-center gap-2">
                        <MdEmojiEvents size={20} className="text-green-500" />
                        太棒了，当前词库没有发现重复英文标签！
                      </p>
                    </div>
                  ) : (
                    '未找到匹配的标签记录'
                  )}
                </td>
              </tr>
            ) : (
              (isDuplicateMode ? duplicateTags : tags).map(renderTagRow)
            )}
          </tbody>
        </table>
      </div>

      {!isDuplicateMode && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 dark:text-slate-400">每页:</span>
            <input
              type="number"
              min={1}
              max={150}
              value={itemsPerPage}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 100;
                const clamped = Math.max(1, Math.min(150, val));
                setItemsPerPage(clamped);
                localStorage.setItem('picpony_items_per_page', clamped.toString());
              }}
              onBlur={() => loadTags(1)}
              className="w-16 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">条</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadTags(currentPage - 1)}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              上一页
            </button>
            <span className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg">
              第 {currentPage} / {totalPages} 页 (共 {totalMatches} 条)
            </span>
            <button
              onClick={() => loadTags(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一页
            </button>
          </div>
        </div>
      )}

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="text-center mb-3">
          <span className="text-sm text-slate-600 dark:text-slate-400">
            词库翻译进度：已翻译 <strong className="text-primary">{stats.translated}</strong> / 总标签{' '}
            <strong>{stats.total}</strong> ({' '}
            <strong className="text-green-500">{translationPercentage}%</strong> )
          </span>
        </div>
        <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-500"
            style={{ width: `${translationPercentage}%` }}
          />
        </div>
      </div>

      {/* Modals */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={closeEditModal}
        title={editingTag ? '编辑标签' : '添加新标签'}
        maxWidth="max-w-lg"
        footer={
          <>
            <button
              onClick={closeEditModal}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={saveTag}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              英文原标签 {editingTag ? '(勿改动)' : ''}
            </label>
            <input
              type="text"
              value={editForm.en}
              onChange={(e) => {
                setEditForm({ ...editForm, en: e.target.value });
                searchDerpiSuggestions(e.target.value);
              }}
              disabled={!!editingTag}
              placeholder="例如：twilight sparkle"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm font-mono"
            />
            {showSuggestions && derpiSuggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-10 w-full mt-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg shadow-lg max-h-48 overflow-y-auto"
              >
                {derpiSuggestions.map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => selectSuggestion(tag)}
                    className="w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-600 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${categoryMap[tag.category]?.color.split(' ')[0] || 'bg-slate-300'}`} />
                      <span className="text-sm text-slate-700 dark:text-slate-200 font-mono">{tag.name}</span>
                    </div>
                    <span className="text-xs text-slate-400">{tag.images} 图</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              中文翻译 <span className="text-slate-400">(多重翻译请用英文逗号 , 隔开)</span>
            </label>
            <input
              type="text"
              value={editForm.cn}
              onChange={(e) => setEditForm({ ...editForm, cn: e.target.value })}
              placeholder="例如：紫悦,暮光闪闪,ts"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">分类</label>
            <select
              value={editForm.cat}
              onChange={(e) => setEditForm({ ...editForm, cat: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
            >
              <option value="general">常规 (general)</option>
              <option value="character">角色 (character)</option>
              <option value="species">种族 (species)</option>
              <option value="rating">分级 (rating)</option>
              <option value="origin">来源 (origin)</option>
              <option value="content-official">官方内容 (content-official)</option>
              <option value="content-fanmade">同人内容 (content-fanmade)</option>
              <option value="error">错误 (error)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">标签简介</label>
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              placeholder="例如：该角色首次登场于第X季..."
              rows={3}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm resize-none"
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isBatchModalOpen}
        onClose={() => !isBatchImporting && setIsBatchModalOpen(false)}
        title="批量导入标签"
        maxWidth="max-w-2xl"
        footer={
          <>
            <button
              onClick={() => setIsBatchModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={executeBatchImport}
              disabled={isBatchImporting}
              className="px-4 py-2 text-sm font-medium text-white bg-cyan-500 hover:bg-cyan-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBatchImporting ? '导入中...' : '开始导入'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
          格式要求：<code className="bg-slate-100 dark:bg-slate-700 px-1 rounded">英文标签 = 主中文名, 别名1, 别名2</code>
        </p>
        <textarea
          value={batchInput}
          onChange={(e) => setBatchInput(e.target.value)}
          placeholder="例如：&#10;twilight sparkle = 紫悦, 暮光闪闪, ts"
          rows={12}
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm font-mono resize-none"
        />
      </Modal>

      <Modal
        isOpen={isSyncModalOpen}
        onClose={() => !isSyncing && setIsSyncModalOpen(false)}
        title="拉取原站热门标签"
        maxWidth="max-w-md"
        hideCloseButton={isSyncing}
        footer={
          <>
            {!isSyncing && (
              <button
                onClick={() => setIsSyncModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                取消
              </button>
            )}
            <button
              onClick={isSyncing ? () => setIsSyncing(false) : executeSync}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                isSyncing
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-emerald-500 hover:bg-emerald-600'
              }`}
            >
              {isSyncing ? '停止同步' : '开始同步'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            系统将按原站<strong>图片总数</strong>从高到低自动拉取标签。
            <br />
            <span className="text-red-500">新拉取的标签会被标记为【未翻译】</span>
          </p>

          {isSyncing ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-400">{syncProgress.message}</span>
                <span className="text-primary font-medium">
                  {syncProgress.current} / {syncProgress.total}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">起始页</label>
                <input
                  type="number"
                  min={1}
                  value={syncStartPage}
                  onChange={(e) => setSyncStartPage(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">结束页</label>
                <input
                  type="number"
                  min={1}
                  value={syncEndPage}
                  onChange={(e) => setSyncEndPage(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
                />
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={isDerpiModalOpen}
        onClose={() => setIsDerpiModalOpen(false)}
        title="搜索 Trixiebooru 原站标签"
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={derpiSearchQuery}
              onChange={(e) => setDerpiSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executeDerpiSearch()}
              placeholder="输入英文标签名..."
              className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm"
            />
            <button
              onClick={executeDerpiSearch}
              disabled={isDerpiSearching}
              className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50"
            >
              {isDerpiSearching ? '搜索中...' : '搜索'}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg">
            {derpiResults.length === 0 ? (
              <div className="p-8 text-center text-slate-500 dark:text-slate-400">
                {isDerpiSearching ? '搜索中...' : '搜索结果将显示在这里'}
              </div>
            ) : (
              derpiResults.map((tag) => (
                <div
                  key={tag.name}
                  className="flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-700 last:border-b-0 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${categoryMap[tag.category]?.color || categoryMap.general.color}`}>
                      {tag.category || 'general'}
                    </span>
                    <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{tag.name}</span>
                    <span className="text-xs text-slate-400">({tag.images} 图)</span>
                  </div>
                  <button
                    onClick={() => importFromDerpi(tag)}
                    className="px-3 py-1 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded transition-colors shrink-0"
                  >
                    + 导入
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isFeedbackModalOpen}
        onClose={() => setIsFeedbackModalOpen(false)}
        title="用户反馈与翻译申请"
        maxWidth="max-w-2xl"
      >
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoadingFeedback ? (
            <div className="flex items-center justify-center py-12">
              <Spinner label="" size="md" />
            </div>
          ) : feedbacks.length === 0 ? (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
              暂无任何反馈申请
            </div>
          ) : (
            <div className="space-y-3">
              {feedbacks.map((feedback) => (
                <div
                  key={feedback.id}
                  className={`p-4 rounded-lg border-l-4 ${
                    feedback.status === 'pending'
                      ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-400'
                      : feedback.status === 'processed'
                      ? 'bg-green-50 dark:bg-green-950/20 border-green-400'
                      : 'bg-red-50 dark:bg-red-950/20 border-red-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-500 dark:text-slate-400">
                      来自: {feedback.username} | {feedback.created_at}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        feedback.status === 'pending'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          : feedback.status === 'processed'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      }`}
                    >
                      {feedback.status === 'pending' ? '待处理' : feedback.status === 'processed' ? '已采纳' : '已忽略'}
                    </span>
                  </div>
                  <div className="font-mono text-sm font-semibold text-primary mb-2">{feedback.tag_name}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400 mb-3 bg-slate-100 dark:bg-slate-700/50 p-2 rounded">
                    {feedback.content}
                  </div>
                  <div className="flex justify-end gap-2">
                    {feedback.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleFeedback(feedback.id, 'processed')}
                          className="px-3 py-1 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded transition-colors"
                        >
                          采纳
                        </button>
                        <button
                          onClick={() => handleFeedback(feedback.id, 'rejected')}
                          className="px-3 py-1 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
                        >
                          忽略
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleFeedback(feedback.id, 'pending')}
                        className="px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                      >
                        标记为未处理
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabId>('welcome');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [userRole, setUserRole] = useState<string>('user');
  const [token, setToken] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem('user_info');
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        setToken(user.token);
        setUserRole(user.role || 'user');
      } catch {
        // ignore
      }
    }
    setIsLoading(false);
  }, []);

  const tabs: TabConfig[] = [
    { id: 'welcome', label: '欢迎', icon: <MdDashboard size={20} /> },
    { id: 'glossary', label: '词库编辑', icon: <MdBook size={20} /> },
    { id: 'users', label: '用户管理', icon: <MdPeople size={20} />, adminOnly: true },
    { id: 'shop', label: '商店管理', icon: <MdStore size={20} />, adminOnly: true },
    { id: 'reports', label: '举报处理', icon: <MdReport size={20} />, adminOnly: true },
    { id: 'blacklist', label: '屏蔽图库', icon: <MdBlock size={20} />, adminOnly: true },
    { id: 'wealth', label: '经验金币', icon: <MdAttachMoney size={20} />, superAdminOnly: true },
    { id: 'other', label: '其他功能', icon: <MdBuild size={20} />, adminOnly: true },
  ];

  const handleTabChange = (tabId: TabId) => {
    if (tabId === activeTab) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setActiveTab(tabId);
      setIsTransitioning(false);
    }, 200);
  };

  const isAdmin = ['super_admin', 'admin', 'editor'].includes(userRole);
  const isSuperAdmin = userRole === 'super_admin';

  const visibleTabs = tabs.filter(tab => {
    if (tab.superAdminOnly) return isSuperAdmin;
    if (tab.adminOnly) return isAdmin;
    return true;
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" label="" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-6xl mx-auto text-center py-12">
        <p className="text-slate-500 dark:text-slate-400">您没有权限访问此页面</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="bg-white dark:bg-slate-950 rounded-xl overflow-hidden flex flex-col md:flex-row">
        <div className="md:w-48 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800">
          <nav className="flex md:flex-col p-2 gap-1 overflow-x-auto">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span className="shrink-0">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 p-6 min-h-[600px] relative">
          <div className={`transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
            {activeTab === 'welcome' && <WelcomeTab />}
            {activeTab === 'glossary' && <GlossaryTab />}
            {activeTab === 'users' && <UsersTab token={token} myRole={userRole} />}
            {activeTab === 'shop' && <ShopTab token={token} />}
            {activeTab === 'reports' && <ReportsTab token={token} />}
            {activeTab === 'blacklist' && <BlacklistTab token={token} />}
            {activeTab === 'wealth' && <WealthTab token={token} />}
            {activeTab === 'other' && <OtherTab token={token} />}
          </div>
        </div>
      </div>
    </div>
  );
}