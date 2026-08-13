'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { MdEmojiEvents, MdAdd, MdEdit, MdDelete, MdContentCopy, MdLink } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import { SectionHeader } from './';
import UserBadge from '@/components/UserBadge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import TabBar from '@/components/TabBar';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { Input, ColorSwatch } from '@/components/Input';
import Radio from '@/components/Radio';
import { copyText } from '@/lib/utils';

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

export default function BadgesTab({ token }: { token: string }) {
  const [badges] = useState<Badge[]>([]);
  const [badgeLinks, setBadgeLinks] = useState<BadgeLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'grant' | 'links'>('grant');

  // Badge grant form
  const [badgeName, setBadgeName] = useState('');
  const [badgeColor, setBadgeColor] = useState('#f1c40f');
  const [targetUserIds, setTargetUserIds] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [isPermanent, setIsPermanent] = useState(true);
  const [granting, setGranting] = useState(false);

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
  const [creatingLink, setCreatingLink] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load badge links
      const linksRes = await api.adminGetBadgeLinks(token);
      setBadgeLinks(linksRes.data?.links || linksRes.links || []);
    } catch {
      showToast('加载数据失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const linksRes = await api.adminGetBadgeLinks(token);
        if (!cancelled) {
          setBadgeLinks(linksRes.data?.links || linksRes.links || []);
        }
      } catch {
        if (!cancelled) showToast('加载数据失败', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

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

  const handleGrantBadge = async () => {
    if (!badgeName.trim()) {
      showToast('请填写徽章名称', 'warning');
      return;
    }
    setGranting(true);
    try {
      const payload: Record<string, unknown> = {
        badge_name: badgeName.trim(),
        badge_color: badgeColor,
      };
      if (targetUserIds.trim()) {
        payload.user_ids = targetUserIds
          .split(',')
          .map((s: string) => parseInt(s.trim()))
          .filter((n: number) => !isNaN(n));
      }
      if (startDate) payload.start_date = startDate;
      if (endDate) payload.end_date = endDate;
      if (!isPermanent && expiresAt) payload.expires_at = expiresAt;

      const res = await api.adminGrantBadge(token, payload);
      const data = await res.json();
      if (data.success) {
        showToast('徽章授予成功', 'success');
        setBadgeName('');
        setTargetUserIds('');
        setStartDate('');
        setEndDate('');
        setExpiresAt('');
        loadData();
      } else {
        showToast(data.error || '授予失败', 'error');
      }
    } catch {
      showToast('授予失败', 'error');
    } finally {
      setGranting(false);
    }
  };

  const handleEditBadge = (badge: Badge) => {
    setEditingBadge(badge);
    setEditName(badge.badge_name);
    setEditColor(badge.badge_color);
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingBadge) return;
    try {
      const res = await api.adminEditBadge(token, {
        badge_id: editingBadge.id,
        badge_name: editName.trim(),
        badge_color: editColor,
      });
      const data = await res.json();
      if (data.success) {
        showToast('徽章已更新', 'success');
        setEditModalOpen(false);
        loadData();
      } else {
        showToast(data.error || '更新失败', 'error');
      }
    } catch {
      showToast('更新失败', 'error');
    }
  };

  const handleDeleteBadge = (badgeId: number) => {
    showConfirm(async () => {
      try {
        const res = await api.adminDeleteBadge(token, badgeId);
        const data = await res.json();
        if (data.success) {
          showToast('已删除', 'success');
          loadData();
        } else {
          showToast(data.error || '删除失败', 'error');
        }
      } catch {
        showToast('删除失败', 'error');
      }
    });
  };

  const handleCreateBadgeLink = async () => {
    if (!linkBadgeName.trim()) {
      showToast('请填写徽章名称', 'warning');
      return;
    }
    setCreatingLink(true);
    try {
      const payload: Record<string, unknown> = {
        badge_name: linkBadgeName.trim(),
        badge_color: linkBadgeColor,
      };
      if (linkBadgeExpiresAt) payload.badge_expires_at = linkBadgeExpiresAt;
      if (linkExpiresAt) payload.link_expires_at = linkExpiresAt;

      const res = await api.adminCreateBadgeLink(token, payload);
      const data = await res.json();
      if (data.success) {
        showToast('领取链接已生成', 'success');
        setLinkBadgeName('');
        setLinkBadgeColor('#e74c3c');
        setLinkBadgeExpiresAt('');
        setLinkExpiresAt('');
        loadData();
      } else {
        showToast(data.error || '创建失败', 'error');
      }
    } catch {
      showToast('创建失败', 'error');
    } finally {
      setCreatingLink(false);
    }
  };

  const handleToggleBadgeLink = async (id: number, isActive: number) => {
    try {
      const res = await api.adminToggleBadgeLink(token, id, isActive ? 0 : 1);
      const data = await res.json();
      if (data.success) {
        showToast(isActive ? '已停用' : '已启用', 'success');
        loadData();
      }
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const copyBadgeLink = async (link: BadgeLink) => {
    const url = `${window.location.origin}/claim-badge?token=${link.token}`;
    if (await copyText(url)) showToast('领取链接已复制', 'success');
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
            icon={<MdEdit size={16} />}
            title="编辑"
            aria-label={`编辑徽章 ${b.badge_name}`}
            className="text-primary"
          />
          <IconButton
            size="sm"
            onClick={() => handleDeleteBadge(b.id)}
            icon={<MdDelete size={16} />}
            title="删除"
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
        <button
          onClick={() => handleToggleBadgeLink(l.id, l.is_active)}
          className={`state-layer rounded-sm px-2 py-1 text-label-m transition-ui outline-none focus-visible:ring-2 focus-ring ${
            l.is_active
              ? 'bg-success-container text-on-success-container'
              : 'bg-error-container text-on-error-container'
          }`}
        >
          {l.is_active ? '已启用' : '已停用'}
        </button>
      ),
    },
    {
      key: 'expiry',
      header: '有效期',
      render: (l) => (
        <span className="text-on-surface-variant text-body-s">
          {l.link_expires_at ? `链接: ${l.link_expires_at}` : '永久'}
          {l.badge_expires_at && ` / 徽章: ${l.badge_expires_at}`}
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
          icon={<MdContentCopy size={16} />}
          title="复制链接"
          aria-label={`复制 ${l.badge_name} 的领取链接`}
          className="text-primary"
        />
      ),
    },
  ];
  return (
    <div className="space-y-6">
      {' '}
      <SectionHeader
        icon={<MdEmojiEvents className="text-primary" size={24} />}
        title="徽章管理"
        onRefresh={loadData}
      />{' '}
      {/* The app's fifth tab row, and the last one that was not `TabBar`. It
          was a pair of `rounded-full` pills with a `secondary-container`
          selected fill — close enough to the real thing to look deliberate, but
          with no sliding indicator, and its panes were gated on
          `{activeSubTab === 'x' && …}`, which unmounts the outgoing pane so
          there is nothing left for the transition to animate out. */}
      <TabBar
        className="mb-4"
        value={activeSubTab}
        onChange={setActiveSubTab}
        label="徽章管理分区"
        tabs={subTabs.map((st) => ({ value: st.id, label: st.label }))}
      />
      <TabPanes value={activeSubTab}>
        <TabPane value="grant">
          {' '}
          <Card variant="transparent" className="space-y-4">
            {' '}
            <Card variant="filled" padding="sm" className="text-body-s text-on-surface-variant">
              {' '}
              您可以向特定用户
              ID，或在某日期区间注册的用户批量授予专属徽章。徽章将在用户的发言、个人主页等多处显示。{' '}
            </Card>{' '}
            <div>
              {' '}
              <Input
                label="徽章名称"
                id="badgestab-f1"
                type="text"
                value={badgeName}
                onChange={(e) => setBadgeName(e.target.value)}
                placeholder="例如：元老、贡献者"
              />{' '}
            </div>{' '}
            <div>
              {' '}
              <p className="block text-label-l text-on-surface-variant mb-1">
                徽章颜色
              </p>{' '}
              <div className="flex items-center gap-3">
                <ColorSwatch
                  aria-label="选择徽章颜色"
                  value={badgeColor}
                  onChange={(e) => setBadgeColor(e.target.value)}
                />
                <Input
                  type="text"
                  value={badgeColor}
                  onChange={(e) => setBadgeColor(e.target.value)}
                  fieldClassName="flex-1"
                />{' '}
              </div>{' '}
            </div>{' '}
            <div>
              {' '}
              <Input
                label="授予指定用户（输入用户ID，多个用逗号隔开，留空则使用下方日期区间）"
                type="text"
                value={targetUserIds}
                onChange={(e) => setTargetUserIds(e.target.value)}
                placeholder="例如：1, 2, 5"
              />{' '}
            </div>{' '}
            <div className="flex gap-4">
              {' '}
              <div className="flex-1">
                {' '}
                <Input
                  label="注册起始日期"
                  id="badgestab-f2"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />{' '}
              </div>{' '}
              <div className="flex-1">
                {' '}
                <Input
                  label="注册截止日期"
                  id="badgestab-f3"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />{' '}
              </div>{' '}
            </div>{' '}
            <div>
              {/* `fieldset`/`legend`, because this caption names a *group* of
                  radios rather than one control. A bare `<label>` with no
                  `htmlFor` labels nothing at all — it is inert styled text — so
                  a screen reader announced "永久徽章, radio, 1 of 2" with no
                  indication of what the choice was about. The UA's border,
                  padding and margin are reset; `min-w-0` because a fieldset's
                  default `min-width: min-content` stops flex children shrinking. */}
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-1 text-label-l text-on-surface-variant">有效期</legend>
                <div className="flex items-center gap-4">
                  <Radio
                    name="badge-duration"
                    value="permanent"
                    checked={isPermanent}
                    onChange={() => setIsPermanent(true)}
                    label="永久徽章"
                  />
                  <Radio
                    name="badge-duration"
                    value="expiring"
                    checked={!isPermanent}
                    onChange={() => setIsPermanent(false)}
                    label="设定有效期至"
                  />
                  {!isPermanent && (
                    <Input
                      type="date"
                      aria-label="徽章有效期至"
                      value={expiresAt}
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
              icon={<MdAdd size={16} />}
            >
              {granting ? '授予中...' : '立即授予徽章'}
            </Button>
          </Card>
          {/* Badges list */}
          <Card variant="transparent">
            <h3 className="text-label-l text-on-surface mb-4">已有徽章列表</h3>
            <DataTable<Badge>
              columns={badgeColumns}
              rows={badges}
              rowKey={(b) => b.id}
              loading={loading}
              empty="暂无徽章"
            />
          </Card>
        </TabPane>
        <TabPane value="links">
          {' '}
          <Card variant="transparent" className="space-y-4">
            {' '}
            <Card variant="filled" padding="sm" className="text-body-s text-on-surface-variant">
              {' '}
              生成一个包含徽章信息的专属链接，用户点击链接即可自动领取指定的徽章。{' '}
            </Card>{' '}
            <div className="flex gap-4">
              {' '}
              <div className="flex-1">
                {' '}
                <Input
                  label="徽章名称"
                  type="text"
                  value={linkBadgeName}
                  onChange={(e) => setLinkBadgeName(e.target.value)}
                  placeholder="输入徽章名称"
                />{' '}
              </div>{' '}
              <div className="flex-1">
                {' '}
                <p className="block text-label-l text-on-surface-variant mb-1">
                  徽章颜色
                </p>{' '}
                <div className="flex items-center gap-2">
                  <ColorSwatch
                    aria-label="选择领取链接徽章颜色"
                    value={linkBadgeColor}
                    onChange={(e) => setLinkBadgeColor(e.target.value)}
                  />
                  <Input
                    type="text"
                    value={linkBadgeColor}
                    onChange={(e) => setLinkBadgeColor(e.target.value)}
                    fieldClassName="flex-1"
                  />{' '}
                </div>{' '}
              </div>{' '}
            </div>{' '}
            <div className="flex gap-4">
              {' '}
              <div className="flex-1">
                {' '}
                <Input
                  label="徽章有效期至（留空为永久）"
                  type="date"
                  value={linkBadgeExpiresAt}
                  onChange={(e) => setLinkBadgeExpiresAt(e.target.value)}
                />{' '}
              </div>{' '}
              <div className="flex-1">
                {' '}
                <Input
                  label="链接有效期至（留空为永久）"
                  id="badgestab-f4"
                  type="date"
                  value={linkExpiresAt}
                  onChange={(e) => setLinkExpiresAt(e.target.value)}
                />{' '}
              </div>{' '}
            </div>{' '}
            <Button
              icon={<MdLink size={16} />}
              variant="warning"
              onClick={handleCreateBadgeLink}
              loading={creatingLink}
            >
              生成领取链接
            </Button>
          </Card>
          {/* Existing badge links */}
          <Card variant="transparent">
            <h3 className="text-label-l text-on-surface mb-4">已生成的链接</h3>
            <DataTable<BadgeLink>
              columns={badgeLinkColumns}
              rows={badgeLinks}
              rowKey={(l) => l.id}
              empty="暂无领取链接"
            />
          </Card>
        </TabPane>
      </TabPanes>
      {/* Edit badge modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="编辑徽章"
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="text" onClick={() => setEditModalOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveEdit} variant="filled">
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label
              htmlFor="badge-edit-name"
              className="block text-label-l text-on-surface-variant mb-1"
            >
              名称
            </label>
            <Input
              id="badge-edit-name"
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <div>
            <label
              htmlFor="badge-edit-color"
              className="block text-label-l text-on-surface-variant mb-1"
            >
              颜色
            </label>
            <div className="flex items-center gap-3">
              <ColorSwatch
                aria-label="选择徽章颜色"
                value={editColor}
                onChange={(e) => setEditColor(e.target.value)}
              />
              <Input
                id="badge-edit-color"
                type="text"
                value={editColor}
                onChange={(e) => setEditColor(e.target.value)}
                fieldClassName="flex-1"
              />
            </div>
          </div>
        </div>
      </Modal>
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
        <p className="text-body-m text-on-surface-variant">确定要删除此徽章？</p>
      </Modal>
    </div>
  );
}
