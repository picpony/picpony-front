'use client';

import { useEffect, useRef, useState } from 'react';
import { getTeamMembers } from '@/lib/api/picpony';
import { showToast } from '@/components/Toast';
import Select from '@/components/Select';
import { MdPeople, MdAdd, MdEdit, MdDelete } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { SectionHeader } from './';
import SectionHeading from '@/components/SectionHeading';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input } from '@/components/Input';
import { ICON } from '@/lib/icons';
import { useConfirm } from '@/components/ConfirmDialog';
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { readToken } from '@/lib/hooks';
import { teamMembers } from '@/lib/resources';
import { useAdminMutation } from './useAdminMutation';

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

const EMPTY_FORM = {
  name: '',
  role: '',
  category: 'developer',
  avatar_url: '',
  link_url: '',
  order_num: 0,
};

const membersQuery = defineAdminQuery<TeamMember[]>('team', async (_token, signal) => {
  const data = await getTeamMembers(signal);
  return adminData(data, data.members || []);
});

export default function TeamTab({ token }: { token: string }) {
  const read = useAdminQuery(membersQuery, token);
  const members = read.data ?? [];
  const loading = read.loading;
  const loadMembers = read.refresh;
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const saveMutation = useAdminMutation(token);
  const deleteMutation = useAdminMutation(token);
  const saving = saveMutation.busy;
  const importRef = useRef<AbortController | null>(null);
  const [importRequest, setImportRequest] = useState<{ token: string; controller: AbortController } | null>(null);
  const importing = importRequest?.token === token && !importRequest.controller.signal.aborted;
  const [importUserId, setImportUserId] = useState('');

  useEffect(() => () => {
    importRef.current?.abort();
    importRef.current = null;
  }, [token]);

  const cancelImport = () => {
    importRef.current?.abort();
    importRef.current = null;
    setImportRequest(null);
  };

  const resetForm = () => {
    cancelImport();
    setForm(EMPTY_FORM);
    setEditingMember(null);
  };

  const { confirmThen, confirmDialog } = useConfirm();

  const handleEdit = (member: TeamMember) => {
    if (saveMutation.isPending() || deleteMutation.isPending()) return;
    cancelImport();
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
    if (saveMutation.isPending() || deleteMutation.isPending()) return;
    if (!form.name.trim()) {
      showToast('姓名不能为空', 'warning');
      return;
    }
    cancelImport();
    const payload = {
      name: form.name.trim(),
      role: form.role.trim(),
      category: form.category,
      avatar_url: form.avatar_url.trim() || null,
      link_url: form.link_url.trim() || null,
      order_num: form.order_num,
    };
    await saveMutation.run(
      () => editingMember
        ? adminApi.updateTeamMember(token, { ...payload, id: editingMember.id })
        : adminApi.addTeamMember(token, payload),
      () => {
        showToast(editingMember ? '已更新' : '已添加', 'success');
        resetForm();
      },
      '保存失败',
      { onCommitted: () => { loadMembers(); teamMembers.invalidate(); } },
    );
  };

  const handleDelete = (id: number) => {
    confirmThen('确认删除', '确定要删除此成员吗？', async () => {
      if (saveMutation.isPending()) return;
      await deleteMutation.run(
        () => adminApi.deleteTeamMember(token, id),
        () => showToast('已删除', 'success'),
        '删除失败',
        { onCommitted: () => {
          membersQuery.write(token, (previous) => previous?.filter((member) => member.id !== id) ?? []);
          loadMembers();
          teamMembers.invalidate();
        } },
      );
    });
  };

  const handleImportUser = async () => {
    if (saveMutation.isPending() || importRef.current || readToken() !== token) return;
    const uid = Number(importUserId);
    if (!Number.isSafeInteger(uid) || uid < 1) {
      showToast('请输入有效的用户 ID', 'warning');
      return;
    }
    const controller = new AbortController();
    importRef.current = controller;
    setImportRequest({ token, controller });
    const isCurrent = () => !controller.signal.aborted && readToken() === token;
    try {
      const data = await adminApi.adminGetUsers(token, controller.signal);
      if (!isCurrent()) return;
      const users = adminData(data, data.users || []);
      const user = users.find((candidate: { id: number }) => candidate.id === uid);
      if (user) {
        setForm((prev) => ({ ...prev, name: user.username || '' }));
        showToast('已导入用户信息', 'success');
        setImportUserId('');
      } else {
        showToast('未找到该用户', 'error');
      }
    } catch (error) {
      if (isCurrent()) showToast(error instanceof Error ? error.message : '导入失败', 'error');
    } finally {
      if (importRef.current === controller) {
        importRef.current = null;
        setImportRequest(null);
      }
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
            disabled={saving || deleteMutation.busy}
            onClick={() => handleEdit(m)}
            icon={<MdEdit size={ICON.dense} />}
            aria-label={`编辑 ${m.name}`} className="text-primary-ink"
          />
          <IconButton
            size="sm"
            onClick={() => handleDelete(m.id)}
            disabled={saving || deleteMutation.busy}
            icon={<MdDelete size={ICON.dense} />}
            aria-label={`删除 ${m.name}`} className="text-error"
          />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdPeople size={ICON.standard} />}
        title="运营团队管理"
        onRefresh={loadMembers}
      />

      <Card variant="transparent" className="space-y-4">
        <SectionHeading as="h3" className="mb-0">
          {editingMember ? '编辑团队成员' : '添加团队成员'}{' '}
        </SectionHeading>
        <div className="flex items-end gap-3 rounded-md border border-dashed border-outline p-3">
          
          <div className="flex-1">
            
            <Input
              label="快捷导入：调用站内用户"
              id="teamtab-f1"
              type="number"
              min={1}
              disabled={saving}
              value={importUserId}
              onChange={(e) => { cancelImport(); setImportUserId(e.target.value); }}
              placeholder="输入用户 ID"
            />
          </div>
          <Button onClick={handleImportUser} variant="filled" loading={importing} disabled={saving}>
            导入信息
          </Button>
        </div>
        <div>
          <Input
            label="成员姓名（必填）"
            id="teamtab-f2"
            type="text"
            value={form.name}
            disabled={saving}
            onChange={(e) => {
              cancelImport();
              setForm((f) => ({ ...f, name: e.target.value }));
            }}
            placeholder="如：小明"
          />
        </div>
        <div>
          <Input
            label="角色/头衔"
            id="teamtab-f3"
            type="text"
            value={form.role}
            disabled={saving}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            placeholder="如：全栈开发"
          />
        </div>
        <div>
          {/* `aria-label` on the `Select` rather than a `<label htmlFor>`: a `Select`
              renders a `<button role="combobox">`, not a labellable form control, so
              `htmlFor` had nowhere to land — and the id it pointed at
              (`teamtab-f4`) belonged to the *avatar* field below, so this label named
              that input while the combobox had no accessible name and the avatar field
              had two. Two controls mislabelled by one stray id. */}
          <p className="block text-label-l text-on-surface-variant mb-1">栏目分类</p>
          <Select
            disabled={saving}
            value={form.category}
            onChange={(v) => setForm((f) => ({ ...f, category: v }))}
            className="w-full"
            options={categoryOptions}
            aria-label="栏目分类"
          />
        </div>
        <div>
          <Input
            id="teamtab-f4"
            label="头像链接（选填）"
            type="text"
            value={form.avatar_url}
            disabled={saving}
            onChange={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))}
            placeholder="头像图片直链"
          />
        </div>
        <div>
          <Input
            label="个人主页链接（选填）"
            id="teamtab-f5"
            type="text"
            value={form.link_url}
            disabled={saving}
            onChange={(e) => setForm((f) => ({ ...f, link_url: e.target.value }))}
            placeholder="如：https://github.com/xxx"
          />
        </div>
        <div>
          <Input
            label="排序号"
            helper="值越小越靠前"
            id="teamtab-f6"
            type="number"
            value={form.order_num}
            disabled={saving}
            onChange={(e) => setForm((f) => ({ ...f, order_num: parseInt(e.target.value) || 0 }))}
            fieldClassName="w-32"
          />
        </div>
        <div className="flex gap-3">
          
          {editingMember && (
            <Button variant="tonal" onClick={resetForm} disabled={saving}>
              取消编辑
            </Button>
          )}
          <Button onClick={handleSave} variant="filled" loading={saving} disabled={deleteMutation.busy} icon={<MdAdd />}>
            {saving ? '保存中…' : editingMember ? '更新成员' : '添加成员'}
          </Button>
        </div>
      </Card>

      <Card variant="transparent">
        <SectionHeading as="h3" className="mb-4">成员列表</SectionHeading>
        <DataTable<TeamMember>
          columns={teamColumns}
          rows={members}
          rowKey={(m) => m.id}
          loading={loading}
          error={read.error}
          onRetry={loadMembers}
          empty="暂无成员"
        />
      </Card>

      {confirmDialog}
    </div>
  );
}
