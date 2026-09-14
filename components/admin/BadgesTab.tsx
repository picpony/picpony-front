'use client';

import { useState } from 'react';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { MdEmojiEvents, MdAdd, MdEdit, MdDelete, MdContentCopy, MdLink } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { SectionHeader } from './';
import SectionHeading from '@/components/SectionHeading';
import UserBadge from '@/components/UserBadge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { Input, ColorSwatch } from '@/components/Input';
import Radio from '@/components/Radio';
import { copyText } from '@/lib/utils';
import { ICON } from '@/lib/icons';
import { useConfirm } from '@/components/ConfirmDialog';
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';

interface Badge {
  id: number;
  badge_name: string;
  badge_color: string;
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

const emptyBadges: Badge[] = [];

const linksQuery = defineAdminQuery<BadgeLink[]>('badge-links', async (token, signal) => {
  const data = await adminApi.adminGetBadgeLinks(token, signal);
  return adminData(data, data.data?.links || data.links || []);
});

export default function BadgesTab({ token }: { token: string }) {
  const [activeSubTab, setActiveSubTab] = useState<'grant' | 'links'>('grant');
  const mutation = useAdminMutation(token);
  const read = useAdminQuery(linksQuery, activeSubTab === 'links' ? token : '');
  const badgeLinks = read.data ?? [];
  const loading = read.loading;
  const loadData = read.refresh;

  // Badge grant form
  const [badgeName, setBadgeName] = useState('');
  const [badgeColor, setBadgeColor] = useState('#f1c40f');
  const [targetUserIds, setTargetUserIds] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isPermanent, setIsPermanent] = useState(true);
  const grantMutation = useAdminMutation(token);
  const granting = grantMutation.busy;

  // Badge edit
  const [editingBadge, setEditingBadge] = useState<Badge | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#f1c40f');
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Badge link form
  const [linkBadgeName, setLinkBadgeName] = useState('');
  const [linkBadgeColor, setLinkBadgeColor] = useState('#e74c3c');
  const [linkBadgeExpiresAt, setLinkBadgeExpiresAt] = useState('');
  const [linkExpiresAt, setLinkExpiresAt] = useState('');
  const createLinkMutation = useAdminMutation(token);
  const creatingLink = createLinkMutation.busy;

  const { confirmThen, confirmDialog } = useConfirm();

  const handleGrantBadge = async () => {
    if (grantMutation.isPending()) return;
    if (!badgeName.trim()) {
      showToast('请填写徽章名称', 'warning');
      return;
    }
    const userIds = targetUserIds.trim() ? targetUserIds.split(/[,，]/).map((id) => Number(id.trim())) : undefined;
    if (userIds?.some((id) => !Number.isSafeInteger(id) || id < 1)) {
      showToast('用户 ID 必须是用逗号分隔的正整数', 'warning');
      return;
    }
    if (!/^#[\da-f]{6}$/i.test(badgeColor)) {
      showToast('请输入有效的六位十六进制颜色', 'warning');
      return;
    }
    if (!isPermanent && !expiresAt) {
      showToast('请填写徽章到期时间', 'warning');
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      showToast('结束日期不能早于开始日期', 'warning');
      return;
    }
    const payload: Record<string, unknown> = {
      badge_name: badgeName.trim(),
      badge_color: badgeColor,
    };
    if (userIds) payload.user_ids = [...new Set(userIds)];
    if (startDate) payload.start_date = startDate;
    if (endDate) payload.end_date = endDate;
    if (!isPermanent && expiresAt) payload.expires_at = expiresAt;

    await grantMutation.run(
      () => adminApi.adminGrantBadge(token, payload),
      () => {
        showToast('已授予徽章', 'success');
        setBadgeName('');
        setTargetUserIds('');
        setStartDate('');
        setEndDate('');
        setExpiresAt('');
      },
      '授予失败',
      { onCommitted: loadData },
    );
  };

  const handleEditBadge = (badge: Badge) => {
    setEditingBadge(badge);
    setEditName(badge.badge_name);
    setEditColor(badge.badge_color);
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingBadge) return;
    if (!editName.trim() || !/^#[\da-f]{6}$/i.test(editColor)) {
      showToast('请填写徽章名称和有效的六位十六进制颜色', 'warning');
      return;
    }
    await mutation.run(() => adminApi.adminEditBadge(token, {
        badge_id: editingBadge.id,
        badge_name: editName.trim(),
        badge_color: editColor,
      }), () => {
        showToast('徽章已更新', 'success');
        setEditModalOpen(false);
      }, '更新失败', { onCommitted: loadData });
  };

  const handleDeleteBadge = (badgeId: number) => {
    confirmThen('确认删除', '确定要删除此徽章吗？', async () => {
      await mutation.run(() => adminApi.adminDeleteBadge(token, badgeId), () => {
          showToast('已删除', 'success');
        }, '删除失败', { onCommitted: loadData });
    });
  };

  const handleCreateBadgeLink = async () => {
    if (createLinkMutation.isPending()) return;
    if (!linkBadgeName.trim()) {
      showToast('请填写徽章名称', 'warning');
      return;
    }
    if (!/^#[\da-f]{6}$/i.test(linkBadgeColor)) {
      showToast('请输入有效的六位十六进制颜色', 'warning');
      return;
    }
    const payload: Record<string, unknown> = {
      badge_name: linkBadgeName.trim(),
      badge_color: linkBadgeColor,
    };
    if (linkBadgeExpiresAt) payload.badge_expires_at = linkBadgeExpiresAt;
    if (linkExpiresAt) payload.link_expires_at = linkExpiresAt;

    await createLinkMutation.run(
      () => adminApi.adminCreateBadgeLink(token, payload),
      () => {
        showToast('领取链接已生成', 'success');
        setLinkBadgeName('');
        setLinkBadgeColor('#e74c3c');
        setLinkBadgeExpiresAt('');
        setLinkExpiresAt('');
      },
      '创建失败',
      { onCommitted: loadData },
    );
  };

  const handleToggleBadgeLink = async (id: number, isActive: number) => {
    await mutation.run(
      () => adminApi.adminToggleBadgeLink(token, id, isActive ? 0 : 1),
      () => showToast(isActive ? '已停用' : '已启用', 'success'),
      '操作失败',
      { onCommitted: () => {
        linksQuery.write(token, (previous) => previous?.map((link) =>
          link.id === id ? { ...link, is_active: isActive ? 0 : 1 } : link) ?? []);
        loadData();
      } },
    );
  };

  const copyBadgeLink = async (link: BadgeLink) => {
    const url = new URL('/claim-badge', window.location.origin);
    url.searchParams.set('token', link.token);
    if (await copyText(url.href)) showToast('领取链接已复制', 'success');
    else showToast('复制失败，请手动选中链接复制', 'error');
  };

  const subTabs = [
    { id: 'grant' as const, label: '授予徽章' },
    { id: 'links' as const, label: '领取链接' },
  ];

  const badgeColumns: Column<Badge>[] = [
    { key: 'id', header: 'ID', render: (b) => b.id },
    {
      key: 'name',
      header: '名称',
      primary: true,
      render: (b) => <span className="text-body-m-emphasized">{b.badge_name}</span>,
    },
    {
      key: 'color',
      header: '颜色',
      render: (b) => <UserBadge name={b.badge_color} color={b.badge_color} />,
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (b) => (
        <>
          <IconButton
            size="sm"
            onClick={() => handleEditBadge(b)}
            icon={<MdEdit size={ICON.dense} />}
            aria-label={`编辑徽章 ${b.badge_name}`}
            className="text-primary-ink"
          />
          <IconButton
            size="sm"
            onClick={() => handleDeleteBadge(b.id)}
            icon={<MdDelete size={ICON.dense} />}
            aria-label={`删除徽章 ${b.badge_name}`}
            className="text-error"
          />
        </>
      ),
    },
  ];

  const badgeLinkColumns: Column<BadgeLink>[] = [
    {
      key: 'badge',
      header: '徽章',
      primary: true,
      render: (l) => <UserBadge name={l.badge_name} color={l.badge_color} />,
    },
    {
      key: 'state',
      header: '状态',
      render: (l) => (
        <Chip
          variant="filter"
          tone={l.is_active ? 'success' : 'error'}
          selected={Boolean(l.is_active)}
          disabled={mutation.busy}
          onClick={() => handleToggleBadgeLink(l.id, l.is_active)}
        >
          {l.is_active ? '已启用' : '已停用'}
        </Chip>
      ),
    },
    {
      key: 'expiry',
      header: '有效期',
      render: (l) => (
        <span className="text-on-surface-variant text-body-s">
          {l.link_expires_at ? `链接：${l.link_expires_at}` : '永久'}
          {l.badge_expires_at && ` / 徽章：${l.badge_expires_at}`}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (l) => (
        <IconButton
          size="sm"
          onClick={() => copyBadgeLink(l)}
          icon={<MdContentCopy size={ICON.dense} />}
          aria-label={`复制 ${l.badge_name} 的领取链接`}
          className="text-primary-ink"
        />
      ),
    },
  ];
  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdEmojiEvents size={ICON.standard} />}
        title="徽章管理"
        onRefresh={loadData}
      />
      {/* Shared `Tabs` primitive — the panes must stay mounted, or there is
          nothing for the transition to animate out. */}
      <Tabs
        className="mb-4"
        value={activeSubTab}
        onChange={setActiveSubTab}
        label="徽章管理分区"
        tabs={subTabs.map((st) => ({ value: st.id, label: st.label }))}
      />
      <TabPanes value={activeSubTab}>
        <TabPane value="grant">
          <Card variant="transparent" className="space-y-4">
            <Card variant="filled" padding="sm" className="text-body-s text-on-surface-variant">
              您可以向特定用户
              ID，或在某日期区间注册的用户批量授予专属徽章。徽章将在用户的发言、个人主页等多处显示。{' '}
            </Card>
            <div>
              <Input
                label="徽章名称"
                id="badgestab-f1"
                type="text"
                value={badgeName}
                disabled={granting}
                onChange={(e) => setBadgeName(e.target.value)}
                placeholder="例如：元老、贡献者"
              />
            </div>
            <div>
              <p className="block text-label-l text-on-surface-variant mb-1">
                徽章颜色
              </p>
              <div className="flex items-center gap-3">
                <ColorSwatch
                  aria-label="选择徽章颜色"
                  value={badgeColor}
                  disabled={granting}
                  onChange={(e) => setBadgeColor(e.target.value)}
                />
                <Input
                  type="text"
                  aria-label="徽章颜色值"
                  value={badgeColor}
                  disabled={granting}
                  onChange={(e) => setBadgeColor(e.target.value)}
                  fieldClassName="flex-1"
                />
              </div>
            </div>
            <div>
              <Input
                label="授予指定用户（输入用户 ID，多个用逗号隔开，留空则使用下方日期区间）"
                type="text"
                value={targetUserIds}
                disabled={granting}
                onChange={(e) => setTargetUserIds(e.target.value)}
                placeholder="例如：1, 2, 5"
              />
            </div>
            <div className="flex gap-4">
              
              <div className="flex-1">
                
                <Input
                  label="注册起始日期"
                  id="badgestab-f2"
                  type="date"
                  value={startDate}
                  disabled={granting}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex-1">
                
                <Input
                  label="注册截止日期"
                  id="badgestab-f3"
                  type="date"
                  value={endDate}
                  disabled={granting}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              {/* `fieldset`/`legend`: this caption names a *group* of radios, and
                  a bare `<label>` with no `htmlFor` labels nothing — a screen
                  reader announced the radios with no indication of what the
                  choice was about. The zeroed `min-width` is because a
                  fieldset's default stops flex children shrinking. */}
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-1 text-label-l text-on-surface-variant">有效期</legend>
                <div className="flex items-center gap-4">
                  <Radio
                    name="badge-duration"
                    value="permanent"
                    checked={isPermanent}
                    disabled={granting}
                    onChange={() => setIsPermanent(true)}
                    label="永久徽章"
                  />
                  <Radio
                    name="badge-duration"
                    value="expiring"
                    checked={!isPermanent}
                    disabled={granting}
                    onChange={() => setIsPermanent(false)}
                    label="设定有效期至"
                  />
                  {!isPermanent && (
                    <Input
                      type="date"
                      aria-label="徽章有效期至"
                      value={expiresAt}
                      disabled={granting}
                      onChange={(e) => setExpiresAt(e.target.value)}
                    />
                  )}
                </div>
              </fieldset>
            </div>
            <Button
              onClick={handleGrantBadge}
              variant="filled"
              loading={granting}
              icon={<MdAdd />}
            >
              {granting ? '授予中…' : '立即授予徽章'}
            </Button>
          </Card>
          <Card variant="transparent">
            <SectionHeading as="h3" className="mb-4">
              已有徽章列表
            </SectionHeading>
            {/* There is no endpoint to fill the badge list —
                `lib/api/admin.ts` has `adminGrantBadge`, `adminEditBadge` and
                `adminDeleteBadge` but no `admin_list_badges`, so the rows below
                cannot arrive until the backend grows one. The edit and delete paths
                are complete and become reachable the moment it does, which is why
                they stay. The empty copy says that rather than claiming there are
                no badges, which is what it used to say. */}
            <DataTable<Badge>
              columns={badgeColumns}
              rows={emptyBadges}
              rowKey={(b) => b.id}
              empty="徽章列表接口尚未开放"
            />
          </Card>
        </TabPane>
        <TabPane value="links">
          <Card variant="transparent" className="space-y-4">
            <Card variant="filled" padding="sm" className="text-body-s text-on-surface-variant">
              生成徽章领取链接，用户打开链接并登录后即可领取指定的徽章。{' '}
            </Card>
            <div className="flex gap-4">
              
              <div className="flex-1">
                
                <Input
                  label="徽章名称"
                  type="text"
                  value={linkBadgeName}
                  disabled={creatingLink}
                  onChange={(e) => setLinkBadgeName(e.target.value)}
                  placeholder="输入徽章名称"
                />
              </div>
              <div className="flex-1">
                
                <p className="block text-label-l text-on-surface-variant mb-1">
                  徽章颜色
                </p>
                <div className="flex items-center gap-2">
                  <ColorSwatch
                    aria-label="选择领取链接徽章颜色"
                    value={linkBadgeColor}
                    disabled={creatingLink}
                    onChange={(e) => setLinkBadgeColor(e.target.value)}
                  />
                  <Input
                    type="text"
                    aria-label="领取链接徽章颜色值"
                    value={linkBadgeColor}
                    disabled={creatingLink}
                    onChange={(e) => setLinkBadgeColor(e.target.value)}
                    fieldClassName="flex-1"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              
              <div className="flex-1">
                
                <Input
                  label="徽章有效期至（留空为永久）"
                  type="date"
                  value={linkBadgeExpiresAt}
                  disabled={creatingLink}
                  onChange={(e) => setLinkBadgeExpiresAt(e.target.value)}
                />
              </div>
              <div className="flex-1">
                
                <Input
                  label="链接有效期至（留空为永久）"
                  id="badgestab-f4"
                  type="date"
                  value={linkExpiresAt}
                  disabled={creatingLink}
                  onChange={(e) => setLinkExpiresAt(e.target.value)}
                />
              </div>
            </div>
            <Button
              icon={<MdLink />}
              variant="warning"
              onClick={handleCreateBadgeLink}
              loading={creatingLink}
            >
              生成领取链接
            </Button>
          </Card>
          {/* Existing badge links */}
          <Card variant="transparent">
            <SectionHeading as="h3" className="mb-4">已生成的链接</SectionHeading>
            <DataTable<BadgeLink>
              columns={badgeLinkColumns}
              rows={badgeLinks}
              rowKey={(l) => l.id}
              loading={loading}
              error={read.error}
              onRetry={loadData}
              empty="暂无领取链接"
            />
          </Card>
        </TabPane>
      </TabPanes>
      {/* Edit badge modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => { if (!mutation.busy) setEditModalOpen(false); }}
        title="编辑徽章"
        maxWidth="md"
        footer={
          <>
            <Button variant="text" onClick={() => setEditModalOpen(false)} disabled={mutation.busy}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} variant="filled" loading={mutation.busy}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Input
              label="名称"
              disabled={mutation.busy}
              id="badge-edit-name"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <div>
            <p className="mb-1 text-label-l text-on-surface-variant">颜色</p>
            <div className="flex items-center gap-3">
              <ColorSwatch
                aria-label="选择徽章颜色"
                value={editColor}
                disabled={mutation.busy}
                onChange={(e) => setEditColor(e.target.value)}
              />
              <Input
                id="badge-edit-color"
                aria-label="徽章颜色值"
                type="text"
                value={editColor}
                disabled={mutation.busy}
                onChange={(e) => setEditColor(e.target.value)}
                fieldClassName="flex-1"
              />
            </div>
          </div>
        </div>
      </Modal>
      {confirmDialog}
    </div>
  );
}
