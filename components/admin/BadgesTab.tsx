'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { MdEmojiEvents, MdAdd, MdRefresh, MdEdit, MdDelete, MdContentCopy, MdLink } from 'react-icons/md';
import { SectionHeader, EmptyState, Spinner } from './';

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
  const [badges, setBadges] = useState<Badge[]>([]);
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

  useEffect(() => { loadData(); }, []);

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
    if (!badgeName.trim()) { showToast('请填写徽章名称', 'warning'); return; }
    setGranting(true);
    try {
      const payload: Record<string, unknown> = {
        badge_name: badgeName.trim(),
        badge_color: badgeColor,
      };
      if (targetUserIds.trim()) {
        payload.user_ids = targetUserIds.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
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
    if (!linkBadgeName.trim()) { showToast('请填写徽章名称', 'warning'); return; }
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
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      showToast('领取链接已复制', 'success');
    } catch {
      prompt('复制失败，请手动复制:', url);
    }
  };

  const subTabs = [
    { id: 'grant' as const, label: '授予徽章' },
    { id: 'links' as const, label: '领取链接' },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdEmojiEvents className="text-primary" size={24} />}
        title="徽章管理"
        onRefresh={loadData}
      />

      <div className="flex gap-2 mb-4">
        {subTabs.map((st) => (
          <button
            key={st.id}
            onClick={() => setActiveSubTab(st.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeSubTab === st.id
                ? 'bg-primary/10 text-primary'
                : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'grant' && (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700 space-y-4">
            <div className="text-xs text-slate-500 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border-l-4 border-l-yellow-500">
              您可以向特定用户 ID，或在某日期区间注册的用户批量授予专属徽章。徽章将在用户的发言、个人主页等多处显示。
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">徽章名称</label>
              <input
                type="text" value={badgeName} onChange={(e) => setBadgeName(e.target.value)}
                placeholder="例如：元老、贡献者"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">徽章颜色</label>
              <div className="flex items-center gap-3">
                <input
                  type="color" value={badgeColor}
                  onChange={(e) => setBadgeColor(e.target.value)}
                  className="w-10 h-10 p-0.5 border rounded cursor-pointer"
                />
                <input
                  type="text" value={badgeColor} onChange={(e) => setBadgeColor(e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                授予指定用户（输入用户ID，多个用逗号隔开，留空则使用下方日期区间）
              </label>
              <input
                type="text" value={targetUserIds} onChange={(e) => setTargetUserIds(e.target.value)}
                placeholder="例如：1, 2, 5"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800"
              />
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">注册起始日期</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">注册截止日期</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">有效期</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={isPermanent} onChange={() => setIsPermanent(true)} />
                  永久徽章
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" checked={!isPermanent} onChange={() => setIsPermanent(false)} />
                  设定有效期至
                </label>
                {!isPermanent && (
                  <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
                    className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
                )}
              </div>
            </div>

            <button
              onClick={handleGrantBadge}
              disabled={granting}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              <MdAdd size={16} />
              {granting ? '授予中...' : '立即授予徽章'}
            </button>
          </div>

          {/* Badges list */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">已有徽章列表</h3>
            {loading ? <Spinner /> : badges.length === 0 ? <EmptyState message="暂无徽章" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">ID</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">名称</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">颜色</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {badges.map((badge) => (
                      <tr key={badge.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 px-2">{badge.id}</td>
                        <td className="py-2 px-2 font-medium">{badge.badge_name}</td>
                        <td className="py-2 px-2">
                          <span className="px-2 py-0.5 rounded text-xs text-white" style={{ backgroundColor: badge.badge_color }}>
                            {badge.badge_color}
                          </span>
                        </td>
                        <td className="py-2 px-2 flex gap-1">
                          <button onClick={() => handleEditBadge(badge)} className="text-blue-500 hover:text-blue-700 p-1" title="编辑">
                            <MdEdit size={16} />
                          </button>
                          <button onClick={() => handleDeleteBadge(badge.id)} className="text-red-500 hover:text-red-700 p-1" title="删除">
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
        </>
      )}

      {activeSubTab === 'links' && (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-700 space-y-4">
            <div className="text-xs text-slate-500 p-3 bg-orange-50 dark:bg-orange-900/20 rounded border-l-4 border-l-orange-500">
              生成一个包含徽章信息的专属链接，用户点击链接即可自动领取指定的徽章。
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">徽章名称</label>
                <input type="text" value={linkBadgeName} onChange={(e) => setLinkBadgeName(e.target.value)}
                  placeholder="输入徽章名称"
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">徽章颜色</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={linkBadgeColor} onChange={(e) => setLinkBadgeColor(e.target.value)}
                    className="w-10 h-10 p-0.5 border rounded cursor-pointer" />
                  <input type="text" value={linkBadgeColor} onChange={(e) => setLinkBadgeColor(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">徽章有效期至（留空为永久）</label>
                <input type="date" value={linkBadgeExpiresAt} onChange={(e) => setLinkBadgeExpiresAt(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">链接有效期至（留空为永久）</label>
                <input type="date" value={linkExpiresAt} onChange={(e) => setLinkExpiresAt(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
              </div>
            </div>

            <button onClick={handleCreateBadgeLink} disabled={creatingLink}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50">
              <MdLink size={16} />
              {creatingLink ? '生成中...' : '生成领取链接'}
            </button>
          </div>

          {/* Existing badge links */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">已生成的链接</h3>
            {badgeLinks.length === 0 ? <EmptyState message="暂无领取链接" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">徽章</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">状态</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">有效期</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {badgeLinks.map((link) => (
                      <tr key={link.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2 px-2">
                          <span className="px-2 py-0.5 rounded text-xs text-white" style={{ backgroundColor: link.badge_color }}>
                            {link.badge_name}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <button
                            onClick={() => handleToggleBadgeLink(link.id, link.is_active)}
                            className={`text-xs px-2 py-1 rounded ${link.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                          >
                            {link.is_active ? '已启用' : '已停用'}
                          </button>
                        </td>
                        <td className="py-2 px-2 text-xs text-slate-400">
                          {link.link_expires_at ? `链接: ${link.link_expires_at}` : '永久'}
                          {link.badge_expires_at && ` / 徽章: ${link.badge_expires_at}`}
                        </td>
                        <td className="py-2 px-2">
                          <button onClick={() => copyBadgeLink(link)}
                            className="text-blue-500 hover:text-blue-700 p-1" title="复制链接">
                            <MdContentCopy size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit badge modal */}
      {editModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditModalOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 text-slate-800 dark:text-slate-100">编辑徽章</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">名称</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">颜色</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)}
                    className="w-10 h-10 p-0.5 border rounded cursor-pointer" />
                  <input type="text" value={editColor} onChange={(e) => setEditColor(e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800" />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-400">
                  取消
                </button>
                <button onClick={handleSaveEdit}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90">
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
        <p className="text-sm text-slate-600 dark:text-slate-400">确定要删除此徽章？</p>
      </Modal>
    </div>
  );
}
