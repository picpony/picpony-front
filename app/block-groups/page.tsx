'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import { MdAdd, MdClose, MdShield, MdSearch, MdEdit, MdDelete, MdBlock, MdVisibility, MdSync, MdErrorOutline } from 'react-icons/md';

const TRIXIE_SEARCH = 'https://trixiebooru.org/api/v1/json/search/tags';
const MAX_GROUPS = 50;
const MAX_TAGS_PER_GROUP = 100;

interface BlockGroup {
  id: number;
  name: string;
  tags: string[];
  hidden_tags: string[];
  spoilered_tags: string[];
  is_active: number;
}

export default function BlockGroupsPage() {
  const router = useRouter();
  const [userInfo, setUserInfo] = useState<{ id: number; token: string; username: string; role: string; avatar: string | null } | null>(null);
  const [groups, setGroups] = useState<BlockGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit modal state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editGroupId, setEditGroupId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState('');
  const [hiddenTags, setHiddenTags] = useState<string[]>([]);
  const [spoileredTags, setSpoileredTags] = useState<string[]>([]);
  const [tagActionType, setTagActionType] = useState<'hide' | 'spoiler'>('hide');

  // Tag autocomplete
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{ name: string; images: number }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const autocompleteRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Confirm delete
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const deleteTargetRef = useRef<number | null>(null);

  // Import modal
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFilters, setImportFilters] = useState<{ id: number; name: string; description: string; hidden_tags: string; spoilered_tags: string; hidden_complex: string; spoilered_complex: string; hidden_tag_ids: number[]; spoilered_tag_ids: number[] }[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState('');

  useEffect(() => {
    const stored = localStorage.getItem('user_info');
    if (!stored) {
      router.push('/login');
      return;
    }
    try {
      const u = JSON.parse(stored);
      setUserInfo({ id: u.id, token: u.token, username: u.username, role: u.role, avatar: u.avatar });
    } catch {
      router.push('/login');
    }
  }, []);

  const loadGroups = useCallback(async () => {
    if (!userInfo?.token) return;
    setLoading(true);
    try {
      const data = await api.getBlockGroups(userInfo.token);
      if (data.success) {
        setGroups(data.groups || []);
        updateLocalStorageCache(data.groups || []);
      } else {
        showToast(data.error || '加载失败', 'error');
      }
    } catch {
      showToast('网络错误', 'error');
    } finally {
      setLoading(false);
    }
  }, [userInfo?.token]);

  useEffect(() => { if (userInfo) loadGroups(); }, [userInfo, loadGroups]);

  function updateLocalStorageCache(groups: BlockGroup[]) {
    const hidden = new Set<string>();
    const spoilered = new Set<string>();
    groups.forEach(g => {
      if (g.is_active) {
        (g.hidden_tags || g.tags || []).forEach(t => { if (t) hidden.add(t.trim().toLowerCase()); });
        (g.spoilered_tags || []).forEach(t => { if (t) spoilered.add(t.trim().toLowerCase()); });
      }
    });
    localStorage.setItem('trixie_active_hidden_tags', JSON.stringify(Array.from(hidden)));
    localStorage.setItem('trixie_active_spoilered_tags', JSON.stringify(Array.from(spoilered)));
  }

  // ================= Tag Autocomplete =================
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (searchQuery.length < 2) { setShowSuggestions(false); return; }
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${TRIXIE_SEARCH}?q=name:*${encodeURIComponent(searchQuery)}*&per_page=10`);
        if (!res.ok) return;
        const data = await res.json();
        if (data?.tags?.length > 0) {
          setSuggestions(data.tags.map((t: { name: string; images: number }) => ({ name: t.name, images: t.images })));
          setShowSuggestions(true);
        } else {
          setShowSuggestions(false);
        }
      } catch { /* ignore */ }
    }, 300);
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current); };
  }, [searchQuery]);

  // Click outside autocomplete
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const addTag = useCallback((tagName: string) => {
    const currentTotal = hiddenTags.length + spoileredTags.length;
    if (currentTotal >= MAX_TAGS_PER_GROUP) {
      showToast(`每个屏蔽组最多只能添加 ${MAX_TAGS_PER_GROUP} 个标签`, 'warning');
      return;
    }
    if (tagActionType === 'hide') {
      setHiddenTags(prev => prev.includes(tagName) ? prev : [...prev.filter(t => t !== tagName), tagName]);
      setSpoileredTags(prev => prev.filter(t => t !== tagName));
    } else {
      setSpoileredTags(prev => prev.includes(tagName) ? prev : [...prev.filter(t => t !== tagName), tagName]);
      setHiddenTags(prev => prev.filter(t => t !== tagName));
    }
    setSearchQuery('');
    setShowSuggestions(false);
  }, []);

  const removeTag = useCallback((tagName: string, type: 'hide' | 'spoiler') => {
    if (type === 'hide') setHiddenTags(prev => prev.filter(t => t !== tagName));
    else setSpoileredTags(prev => prev.filter(t => t !== tagName));
  }, []);

  // ================= Edit / Create =================
  const openEditModal = useCallback((group?: BlockGroup) => {
    if (!group && groups.length >= MAX_GROUPS) {
      showToast(`最多只能创建 ${MAX_GROUPS} 个屏蔽组`, 'warning');
      return;
    }
    setEditGroupId(group?.id ?? null);
    setGroupName(group?.name ?? '');
    setHiddenTags([...(group?.hidden_tags || group?.tags || [])]);
    setSpoileredTags([...(group?.spoilered_tags || [])]);
    setSearchQuery('');
    setShowSuggestions(false);
    setEditModalOpen(true);
  }, [groups]);

  const handleSaveGroup = useCallback(async () => {
    if (!groupName.trim()) { showToast('请输入屏蔽组名称', 'warning'); return; }
    if (hiddenTags.length === 0 && spoileredTags.length === 0) { showToast('请至少添加一个标签', 'warning'); return; }
    if (!userInfo?.token) return;

    try {
      const payload = {
        id: editGroupId ?? undefined,
        name: groupName.trim(),
        tags: [...hiddenTags, ...spoileredTags],
        hidden_tags: hiddenTags,
        spoilered_tags: spoileredTags,
      };
      const res = await api.saveBlockGroup(userInfo.token, payload);
      const data = await res.json();
      if (data.success) {
        showToast(editGroupId ? '已更新' : '已创建', 'success');
        setEditModalOpen(false);
        loadGroups();
      } else {
        showToast(data.error || '保存失败', 'error');
      }
    } catch {
      showToast('网络错误', 'error');
    }
  }, [editGroupId, groupName, hiddenTags, spoileredTags, userInfo?.token, loadGroups]);

  const handleToggleGroup = useCallback(async (id: number, isActive: boolean) => {
    if (!userInfo?.token) return;
    // Optimistic update
    setGroups(prev => {
      const updated = prev.map(g => g.id === id ? { ...g, is_active: isActive ? 1 : 0 } : g);
      updateLocalStorageCache(updated);
      return updated;
    });
    try {
      const res = await api.toggleBlockGroup(userInfo.token, id, isActive ? 1 : 0);
      const data = await res.json();
      if (!data.success) {
        showToast(data.error || '切换失败', 'error');
        loadGroups();
      }
    } catch {
      showToast('网络错误', 'error');
      loadGroups();
    }
  }, [userInfo?.token, loadGroups]);

  const confirmDeleteGroup = useCallback((id: number) => {
    deleteTargetRef.current = id;
    setDeleteConfirmOpen(true);
  }, []);

  const handleDeleteGroup = useCallback(async () => {
    const id = deleteTargetRef.current;
    if (!id || !userInfo?.token) return;
    setDeleteConfirmOpen(false);
    try {
      const res = await api.deleteBlockGroup(userInfo.token, id);
      const data = await res.json();
      if (data.success) {
        showToast('已删除', 'success');
        loadGroups();
      } else {
        showToast(data.error || '删除失败', 'error');
      }
    } catch {
      showToast('网络错误', 'error');
    }
  }, [userInfo?.token, loadGroups]);

  // ================= Derpibooru Import =================
  const openImportModal = useCallback(async () => {
    const stored = localStorage.getItem('user_info');
    if (!stored) { showToast('请先登录', 'warning'); return; }
    const u = JSON.parse(stored);
    const apiKey = u.derpi_username ? u.api_key : null;
    if (!apiKey) {
      showToast('请在设置中绑定 Derpibooru API Key', 'warning');
      return;
    }
    setImportModalOpen(true);
    setImportLoading(true);
    setImportError('');
    try {
      const res = await fetch(`https://trixiebooru.org/api/v1/json/filters/user?key=${apiKey}`);
      if (!res.ok) throw new Error(`API Key 无效 (HTTP ${res.status})`);
      const data = await res.json();
      if (data.filters?.length > 0) {
        setImportFilters(data.filters);
      } else {
        setImportError('您的账号下没有可导入的过滤器');
      }
    } catch (err: unknown) {
      setImportError(`获取失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setImportLoading(false);
    }
  }, []);

  const importSingleFilter = useCallback(async (filter: typeof importFilters[0]) => {
    if (groups.length >= MAX_GROUPS) { showToast(`最多只能创建 ${MAX_GROUPS} 个屏蔽组`, 'warning'); return; }

    // Parse hidden tags from complex and simple
    const hComplex = filter.hidden_complex
      ? filter.hidden_complex.split(/,| OR /i).map(t => t.trim().replace(/^"|"$/g, '')).filter(Boolean)
      : [];
    const hTags = filter.hidden_tags
      ? filter.hidden_tags.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    const hSet = [...new Set([...hComplex, ...hTags].filter(t => t && !t.includes(':') && !t.includes('!')))];
    const hiddenTagNames: string[] = [];

    // Resolve hidden_tag_ids to tag names
    if (filter.hidden_tag_ids?.length > 0) {
      for (const id of filter.hidden_tag_ids.slice(0, 50)) {
        try {
          const r = await fetch(`https://trixiebooru.org/api/v1/json/tags/${id}`);
          if (r.ok) {
            const d = await r.json();
            if (d.tag?.name) hiddenTagNames.push(d.tag.name);
          }
        } catch { /* skip */ }
      }
    }
    const finalHidden = [...new Set([...hSet, ...hiddenTagNames])];

    // Parse spoilered tags
    const sComplex = filter.spoilered_complex
      ? filter.spoilered_complex.split(/,| OR /i).map(t => t.trim().replace(/^"|"$/g, '')).filter(Boolean)
      : [];
    const sTags = filter.spoilered_tags
      ? filter.spoilered_tags.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    const sSet = [...new Set([...sComplex, ...sTags].filter(t => t && !t.includes(':') && !t.includes('!')))];
    const spoileredTagNames: string[] = [];

    if (filter.spoilered_tag_ids?.length > 0) {
      for (const id of filter.spoilered_tag_ids.slice(0, 50)) {
        try {
          const r = await fetch(`https://trixiebooru.org/api/v1/json/tags/${id}`);
          if (r.ok) {
            const d = await r.json();
            if (d.tag?.name) spoileredTagNames.push(d.tag.name);
          }
        } catch { /* skip */ }
      }
    }
    const finalSpoilered = [...new Set([...sSet, ...spoileredTagNames])];

    if (finalHidden.length === 0 && finalSpoilered.length === 0) {
      showToast('该过滤器没有可导入的标签', 'warning');
      return;
    }

    if (!userInfo?.token) return;
    try {
      const res = await api.saveBlockGroup(userInfo.token, {
        name: filter.name.length > 30 ? filter.name.slice(0, 30) : filter.name,
        tags: [...finalHidden, ...finalSpoilered],
        hidden_tags: finalHidden,
        spoilered_tags: finalSpoilered,
      });
      const data = await res.json();
      if (data.success) {
        showToast('导入成功', 'success');
        loadGroups();
      } else {
        showToast(data.error || '导入失败', 'error');
      }
    } catch {
      showToast('网络错误', 'error');
    }
  }, [groups.length, userInfo?.token, loadGroups]);

  const sectionTitle = "text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2";

  if (!userInfo) return null;

  return (
    <div className="max-w-4xl mx-auto p-4">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h2 className={sectionTitle}>屏蔽组</h2>
        <div className="flex items-center gap-2">
          <button onClick={openImportModal}
            className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors">
            从 Derpibooru 导入
          </button>
          <button onClick={() => openEditModal()}
            className="px-3 py-1.5 text-xs font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors flex items-center gap-1">
            <MdAdd size={14} /> 新建
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        已创建屏蔽组: <strong className="text-slate-700 dark:text-slate-200">{groups.length}</strong> / {MAX_GROUPS}
      </p>

      {/* Loading */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Spinner />
        </div>
      ) : groups.length === 0 ? (
        /* Empty state */
        <div className="text-center py-20 text-slate-400">
          <MdShield size={64} className="mx-auto mb-4 opacity-30" />
          <p className="mb-2">还没有任何屏蔽组，快去创建一个吧！</p>
          <p className="text-xs text-slate-400">开启后，主页将自动处理包含这些标签的图片。</p>
        </div>
      ) : (
        /* Group grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map(group => {
            const hTags = group.hidden_tags || group.tags || [];
            const sTags = group.spoilered_tags || [];
            const isActive = group.is_active === 1;
            return (
              <div key={group.id}
                className={`bg-white dark:bg-slate-800 rounded-xl border p-4 flex flex-col gap-3 shadow-sm transition-all duration-200 ${
                  isActive ? 'border-red-200 dark:border-red-900/50' : 'border-slate-100 dark:border-slate-700 opacity-60'
                }`}>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-dashed border-slate-200 dark:border-slate-700 pb-3">
                  <span className={`font-bold text-sm truncate ${isActive ? 'text-red-500' : 'text-slate-400'}`}>
                    {group.name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Toggle switch */}
                    <label className="relative inline-block w-9 h-5 cursor-pointer">
                      <input type="checkbox" checked={isActive} onChange={e => handleToggleGroup(group.id, e.target.checked)}
                        className="opacity-0 w-0 h-0 peer" />
                      <span className="absolute inset-0 bg-slate-300 dark:bg-slate-600 rounded-full transition-colors peer-checked:bg-red-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
                    </label>
                    <button onClick={() => openEditModal(group)}
                      className="p-1.5 text-xs text-slate-400 hover:text-primary rounded transition-colors" title="编辑">
                      <MdEdit size={14} />
                    </button>
                    <button onClick={() => confirmDeleteGroup(group.id)}
                      className="p-1.5 text-xs text-slate-400 hover:text-red-500 rounded transition-colors" title="删除">
                      <MdDelete size={14} />
                    </button>
                  </div>
                </div>

                {/* Tags preview */}
                <div className="text-xs space-y-1" style={{ opacity: isActive ? 1 : 0.4 }}>
                  {hTags.length > 0 && (
                    <div className="text-red-500">
                      <MdBlock size={12} className="inline mr-0.5" /> 隐藏: {hTags.join(', ')}
                    </div>
                  )}
                  {sTags.length > 0 && (
                    <div className="text-amber-500">
                      <MdVisibility size={12} className="inline mr-0.5" /> 遮挡: {sTags.join(', ')}
                    </div>
                  )}
                  {hTags.length === 0 && sTags.length === 0 && (
                    <span className="text-slate-400">空屏蔽组</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================= Edit / Create Modal ================= */}
      <Modal isOpen={editModalOpen} onClose={() => setEditModalOpen(false)}
        title={editGroupId ? '编辑屏蔽组' : '创建新屏蔽组'} maxWidth="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">屏蔽组名称</label>
            <input type="text" value={groupName} onChange={e => setGroupName(e.target.value)}
              placeholder="例如：重口味屏蔽、黑名单画师..."
              maxLength={30}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
          </div>

          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5 cursor-pointer text-red-500 font-medium">
              <input type="radio" name="tagActionType" value="hide" checked={tagActionType === 'hide'}
                onChange={() => setTagActionType('hide')} />
              <MdBlock size={16} /> 彻底隐藏
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-amber-500 font-medium">
              <input type="radio" name="tagActionType" value="spoiler" checked={tagActionType === 'spoiler'}
                onChange={() => setTagActionType('spoiler')} />
              <MdVisibility size={16} /> 遮挡打码
            </label>
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              搜索并添加标签（支持联想）
            </label>
            <div className="relative">
              <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input ref={searchInputRef} type="text" value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="输入英文标签..."
                className="w-full pl-9 pr-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100" />
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div ref={autocompleteRef}
                className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map(s => (
                  <button key={s.name}
                    onClick={() => addTag(s.name)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex justify-between items-center border-b border-slate-100 dark:border-slate-700 last:border-0">
                    <span className="text-slate-800 dark:text-slate-200">{s.name}</span>
                    <span className="text-xs text-slate-400">{s.images}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-red-500 mb-1"><MdBlock size={14} className="inline mr-0.5" /> 隐藏标签列表：</label>
            <div className="flex flex-wrap gap-2 p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/50 min-h-[40px] max-h-[120px] overflow-y-auto">
              {hiddenTags.length === 0 ? (
                <span className="text-xs text-slate-400">暂无标签</span>
              ) : hiddenTags.map(tag => (
                <span key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 border-l-[3px] border-l-red-500">
                  {tag}
                  <button onClick={() => removeTag(tag, 'hide')} className="text-red-400 hover:text-red-600 ml-0.5">
                    <MdClose size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-amber-500 mb-1"><MdVisibility size={14} className="inline mr-0.5" /> 遮挡标签列表：</label>
            <div className="flex flex-wrap gap-2 p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/50 min-h-[40px] max-h-[120px] overflow-y-auto">
              {spoileredTags.length === 0 ? (
                <span className="text-xs text-slate-400">暂无标签</span>
              ) : spoileredTags.map(tag => (
                <span key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 border-l-[3px] border-l-amber-500">
                  {tag}
                  <button onClick={() => removeTag(tag, 'spoiler')} className="text-amber-400 hover:text-amber-600 ml-0.5">
                    <MdClose size={14} />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setEditModalOpen(false)}
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              取消
            </button>
            <button onClick={handleSaveGroup}
              className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors">
              保存屏蔽组
            </button>
          </div>
        </div>
      </Modal>

      {/* ================= Delete Confirm Modal ================= */}
      <Modal isOpen={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}
        title="确认删除" maxWidth="max-w-sm"
        footer={
          <>
            <button onClick={() => setDeleteConfirmOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors">
              取消
            </button>
            <button onClick={handleDeleteGroup}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors">
              确认删除
            </button>
          </>
        }>
        <p className="text-sm text-slate-600 dark:text-slate-400">确定要删除这个屏蔽组吗？</p>
      </Modal>

      {/* ================= Import Modal ================= */}
      <Modal isOpen={importModalOpen} onClose={() => setImportModalOpen(false)}
        title="从 Derpibooru 导入" maxWidth="max-w-lg">
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            系统已自动读取您绑定的 API Key。请选择要导入的云端过滤器：
          </p>

          {importLoading ? (
            <div className="text-center py-8 text-purple-500 text-sm">
              <MdSync size={16} className="inline animate-spin mr-1" /> 正在连接 Derpibooru 拉取数据...
            </div>
          ) : importError ? (
            <div className="text-center py-8 text-red-500 text-sm">
              <MdErrorOutline size={16} className="inline mr-1" /> {importError}
            </div>
          ) : importFilters.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              <p>您的账号下没有任何过滤器</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {importFilters.map(filter => (
                <div key={filter.id}
                  className="flex items-center justify-between gap-3 p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{filter.name}</div>
                    {filter.description && (
                      <div className="text-xs text-slate-400 truncate mt-0.5">{filter.description}</div>
                    )}
                  </div>
                  <button onClick={() => importSingleFilter(filter)}
                    disabled={groups.length >= MAX_GROUPS}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                    导入
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
