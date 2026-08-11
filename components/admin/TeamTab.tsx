'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { MdPeople, MdAdd, MdEdit, MdDelete } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { SectionHeader } from './';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input } from '@/components/Input';

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await api.getTeamMembers();
        if (!cancelled && data.success) {
          setMembers(data.members || []);
        }
      } catch {
        if (!cancelled) showToast('加载失败', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetForm = () => {
    setForm({
      name: '',
      role: '',
      category: 'developer',
      avatar_url: '',
      link_url: '',
      order_num: 0,
    });
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
    if (!form.name.trim()) {
      showToast('姓名不能为空', 'warning');
      return;
    }
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
    if (isNaN(uid)) {
      showToast('请输入有效的用户 ID', 'warning');
      return;
    }
    try {
      const data = await api.adminGetUsers(token);
      if (data.success) {
        const user = (data.users || []).find((u: { id: number }) => u.id === uid);
        if (user) {
          setForm((prev) => ({ ...prev, name: user.username || '' }));
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

  const teamColumns: Column<TeamMember>[] = [
    { key: 'id', header: 'ID', render: (m) => m.id },
    {
      key: 'name',
      header: '姓名',
      primary: true,
      render: (m) => <span className="text-body-m-emphasized">{m.name}</span>,
    },
    {
      key: 'role',
      header: '角色',
      render: (m) => <span className="text-on-surface-variant text-body-s">{m.role}</span>,
    },
    {
      key: 'category',
      header: '分类',
      render: (m) => (
        <span className="text-body-s">
          {categoryOptions.find((c) => c.value === m.category)?.label || m.category}
        </span>
      ),
    },
    {
      key: 'order',
      header: '排序',
      render: (m) => <span className="text-on-surface-variant text-body-s">{m.order_num}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (m) => (
        <>
          <IconButton
            size="sm"
            onClick={() => handleEdit(m)}
            icon={<MdEdit size={16} />}
            title="编辑"
            aria-label={`编辑 ${m.name}`} className="text-primary"
          />
          <IconButton
            size="sm"
            onClick={() => handleDelete(m.id)}
            icon={<MdDelete size={16} />}
            title="删除"
            aria-label={`删除 ${m.name}`} className="text-error"
          />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdPeople className="text-primary" size={24} />}
        title="运营团队管理"
        onRefresh={loadMembers}
      />

      <Card variant="transparent" className="space-y-4">
        <h3 className="text-label-l text-on-surface">
          {editingMember ? '编辑团队成员' : '添加团队成员'}{' '}
        </h3>{' '}
        <div className="flex items-end gap-3 rounded-md border border-dashed border-outline p-3">
          {' '}
          <div className="flex-1">
            {' '}
            <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="teamtab-f1">
              快捷导入：调用站内用户
            </label>{' '}
            <Input
              id="teamtab-f1"
              type="number"
              value={importUserId}
              onChange={(e) => setImportUserId(e.target.value)}
              placeholder="输入用户 ID"
            />{' '}
          </div>{' '}
          <Button onClick={handleImportUser} variant="filled">
            导入信息
          </Button>
        </div>{' '}
        <div>
          {' '}
          <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="teamtab-f2">
            成员姓名（必填）
          </label>{' '}
          <Input
            id="teamtab-f2"
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="如：小明"
          />{' '}
        </div>{' '}
        <div>
          {' '}
          <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="teamtab-f3">
            角色/头衔
          </label>{' '}
          <Input
            id="teamtab-f3"
            type="text"
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            placeholder="如：全栈开发"
          />{' '}
        </div>{' '}
        <div>
          {' '}
          <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="teamtab-f4">
            栏目分类
          </label>{' '}
          <Select
            value={form.category}
            onChange={(v) => setForm((f) => ({ ...f, category: v }))}
            className="w-full"
            options={categoryOptions}
          />{' '}
        </div>{' '}
        <div>
          {' '}
          <Input
            id="teamtab-f4"
            label="头像链接（选填）"
            type="text"
            value={form.avatar_url}
            onChange={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))}
            placeholder="头像图片直链"
          />{' '}
        </div>{' '}
        <div>
          {' '}
          <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="teamtab-f5">
            个人主页链接（选填）
          </label>{' '}
          <Input
            id="teamtab-f5"
            type="text"
            value={form.link_url}
            onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))}
            placeholder="如：https://github.com/xxx"
          />{' '}
        </div>{' '}
        <div>
          {' '}
          <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="teamtab-f6">
            排序号（值越小越靠前）
          </label>{' '}
          <Input
            id="teamtab-f6"
            type="number"
            value={form.order_num}
            onChange={(e) => setForm((f) => ({ ...f, order_num: parseInt(e.target.value) || 0 }))}
            fieldClassName="w-32"
          />{' '}
        </div>{' '}
        <div className="flex gap-3">
          {' '}
          {editingMember && (
            <Button variant="outlined" onClick={resetForm}>
              {' '}
              取消编辑{' '}
            </Button>
          )}{' '}
          <Button onClick={handleSave} variant="filled" loading={saving} icon={<MdAdd size={16} />}>
            {saving ? '保存中...' : editingMember ? '更新成员' : '添加成员'}
          </Button>
        </div>
      </Card>

      <Card variant="transparent">
        <h3 className="text-label-l text-on-surface mb-4">成员列表</h3>
        <DataTable<TeamMember>
          columns={teamColumns}
          rows={members}
          rowKey={(m) => m.id}
          loading={loading}
          empty="暂无成员"
        />
      </Card>

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="确认删除"
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="text" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button variant="danger" onClick={handleConfirm}>
              确认
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant">确定要删除此成员？</p>
      </Modal>
    </div>
  );
}
