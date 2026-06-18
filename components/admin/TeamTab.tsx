'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { MdPeople, MdAdd, MdEdit, MdDelete, MdRefresh } from 'react-icons/md';
import { SectionHeader, EmptyState, Spinner } from './';

interface TeamMember {
  id: number;
  name: string;
  role: string;
  category: string;
  avatar_url: string | null;
  link_url: string | null;
  order_num: number;
}

const categoryOptions = [
  { value: 'developer', label: '开发团队' },
  { value: 'manager', label: '管理团队' },
  { value: 'editor', label: '小编团队' },
  { value: 'special', label: '特别鸣谢' },
];

export default function TeamTab({ token }: { token: string }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [form, setForm] = useState({
    name: '',
    role: '',
    category: 'developer' as string,
    avatar_url: '',
    link_url: '',
    order_num: 0,
  });
  const [saving, setSaving] = useState(false);
  const [importUserId, setImportUserId] = useState('');

  const loadMembers = async () => {
    setLoading(true);
    try {
      const data = await api.getTeamMembers();
      if (data.success) {
        setMembers(data.members || []);
      }
    } catch {
      showToast('加载失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMembers(); }, []);

  const resetForm = () => {
    setForm({ name: '', role: '', category: 'developer', avatar_url: '', link_url: '', order_num: 0 });
    setEditingMember(null);
  };

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmActionRef = useRef<(() => void) | null>(null);

  const showConfirm = (action: () => void) => {
    confirmActionRef.current = action;
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    confirmActionRef.current?.();
    setConfirmOpen(false);
  };

  const handleEdit = (member: TeamMember) => {
    setEditingMember(member);
    setForm({
      name: member.name,
      role: member.role,
      category: member.category,
      avatar_url: member.avatar_url || '',
      link_url: member.link_url || '',
      order_num: member.order_num,
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('姓名不能为空', 'warning'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        role: form.role.trim(),
        category: form.category,
        avatar_url: form.avatar_url.trim() || null,
        link_url: form.link_url.trim() || null,
        order_num: form.order_num,
      };

      let res: Response;
      if (editingMember) {
        res = await api.updateTeamMember(token, { ...payload, id: editingMember.id });
      } else {
        res = await api.addTeamMember(token, payload);
      }
      const data = await res.json();
      if (data.success) {
        showToast(editingMember ? '已更新' : '已添加', 'success');
        resetForm();
        loadMembers();
      } else {
        showToast(data.error || '保存失败', 'error');
      }
    } catch {
      showToast('保存失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: number) => {
    showConfirm(async () => {
      try {
        const res = await api.deleteTeamMember(token, id);
        const data = await res.json();
        if (data.success) {
          showToast('已删除', 'success');
          loadMembers();
        } else {
          showToast(data.error || '删除失败', 'error');
        }
      } catch {
        showToast('删除失败', 'error');
      }
    });
  };

  const handleImportUser = async () => {
    const uid = parseInt(importUserId);
    if (isNaN(uid)) { showToast('请输入有效的用户 ID', 'warning'); return; }
    try {
      const data = await api.adminGetUsers(token);
      if (data.success) {
        const user = (data.users || []).find((u: { id: number }) => u.id === uid);
        if (user) {
          setForm(prev => ({ ...prev, name: user.username || '' }));
          showToast('已导入用户信息', 'success');
          setImportUserId('');
        } else {
          showToast('未找到该用户', 'error');
        }
      }
    } catch {
      showToast('导入失败', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdPeople className="text-primary" size={24} />}
        title="运营团队管理"
        onRefresh={loadMembers}
      />

      <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {editingMember ? '编辑团队成员' : '添加团队成员'}
        </h3>

        <div className="flex items-end gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded border border-dashed border-slate-300 dark:border-slate-600">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">快捷导入：调用站内用户</label>
            <input type="number" value={importUserId} onChange={(e) => setImportUserId(e.target.value)}
              placeholder="输入用户 ID"
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-800" />
          </div>
          <button onClick={handleImportUser}
            className="px-4 py-2 bg-primary text-white rounded text-sm font-medium hover:bg-primary/90">
            导入信息
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">成员姓名（必填）</label>
          <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="如：小明"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">角色/头衔</label>
          <input type="text" value={form.role} onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}
            placeholder="如：全栈开发"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">栏目分类</label>
          <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800">
            {categoryOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">头像链接（选填）</label>
          <input type="text" value={form.avatar_url} onChange={(e) => setForm(f => ({ ...f, avatar_url: e.target.value }))}
            placeholder="头像图片直链"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">个人主页链接（选填）</label>
          <input type="text" value={form.link_url} onChange={(e) => setForm(f => ({ ...f, link_url: e.target.value }))}
            placeholder="如：https://github.com/xxx"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">排序号（值越小越靠前）</label>
          <input type="number" value={form.order_num} onChange={(e) => setForm(f => ({ ...f, order_num: parseInt(e.target.value) || 0 }))}
            className="w-32 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
        </div>

        <div className="flex gap-3">
          {editingMember && (
            <button onClick={resetForm}
              className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-400">
              取消编辑
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            <MdAdd size={16} />
            {saving ? '保存中...' : (editingMember ? '更新成员' : '添加成员')}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">成员列表</h3>
        {loading ? <Spinner /> : members.length === 0 ? <EmptyState message="暂无成员" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">ID</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">姓名</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">角色</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">分类</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">排序</th>
                  <th className="text-left py-2 px-2 text-slate-500 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2 px-2">{m.id}</td>
                    <td className="py-2 px-2 font-medium">{m.name}</td>
                    <td className="py-2 px-2 text-xs text-slate-500">{m.role}</td>
                    <td className="py-2 px-2 text-xs">{categoryOptions.find(c => c.value === m.category)?.label || m.category}</td>
                    <td className="py-2 px-2 text-xs text-slate-400">{m.order_num}</td>
                    <td className="py-2 px-2 flex gap-1">
                      <button onClick={() => handleEdit(m)} className="text-blue-500 hover:text-blue-700 p-1" title="编辑">
                        <MdEdit size={16} />
                      </button>
                      <button onClick={() => handleDelete(m.id)} className="text-red-500 hover:text-red-700 p-1" title="删除">
                        <MdDelete size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认删除"
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setConfirmOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">确定要删除此成员？</p>
      </Modal>
    </div>
  );
}
