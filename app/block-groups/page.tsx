'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Spinner from '@/components/Spinner';
import {
  MdAdd,
  MdClose,
  MdShield,
  MdSearch,
  MdEdit,
  MdDelete,
  MdBlock,
  MdVisibility,
} from 'react-icons/md';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuthModal } from '@/components/AuthModal';

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

type UserInfo = {
  id: number;
  token: string;
  username: string;
  role: string;
  avatar: string | null;
};

function readUserInfo(): UserInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('user_info');
    if (!stored) return null;
    const u = JSON.parse(stored);
    return { id: u.id, token: u.token, username: u.username, role: u.role, avatar: u.avatar };
  } catch {
    return null;
  }
}

export default function BlockGroupsPage() {
  const { openAuth } = useAuthModal();
  const [userInfo] = useState<UserInfo | null>(() => readUserInfo());
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

  useEffect(() => {
    if (!userInfo) {
      openAuth('login');
    }
  }, [userInfo, openAuth]);

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

  useEffect(() => {
    if (!userInfo) return;
    // Defer so setLoading inside loadGroups is not sync in the effect body
    queueMicrotask(() => {
      void loadGroups();
    });
  }, [userInfo, loadGroups]);

  function updateLocalStorageCache(groups: BlockGroup[]) {
    const hidden = new Set<string>();
    const spoilered = new Set<string>();
    groups.forEach((g) => {
      if (g.is_active) {
        (g.hidden_tags || g.tags || []).forEach((t) => {
          if (t) hidden.add(t.trim().toLowerCase());
        });
        (g.spoilered_tags || []).forEach((t) => {
          if (t) spoilered.add(t.trim().toLowerCase());
        });
      }
    });
    localStorage.setItem('trixie_active_hidden_tags', JSON.stringify(Array.from(hidden)));
    localStorage.setItem('trixie_active_spoilered_tags', JSON.stringify(Array.from(spoilered)));
  }

  // ================= Tag Autocomplete =================
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(
      async () => {
        if (searchQuery.length < 2) {
          setShowSuggestions(false);
          return;
        }
        try {
          const res = await fetch(
            `${TRIXIE_SEARCH}?q=name:*${encodeURIComponent(searchQuery)}*&per_page=10`,
          );
          if (!res.ok) return;
          const data = await res.json();
          if (data?.tags?.length > 0) {
            setSuggestions(
              data.tags.map((t: { name: string; images: number }) => ({
                name: t.name,
                images: t.images,
              })),
            );
            setShowSuggestions(true);
          } else {
            setShowSuggestions(false);
          }
        } catch {
          /* ignore */
        }
      },
      searchQuery.length < 2 ? 0 : 300,
    );
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // Click outside autocomplete
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        autocompleteRef.current &&
        !autocompleteRef.current.contains(e.target as Node) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const addTag = useCallback(
    (tagName: string) => {
      const currentTotal = hiddenTags.length + spoileredTags.length;
      if (currentTotal >= MAX_TAGS_PER_GROUP) {
        showToast(`每个屏蔽组最多只能添加 ${MAX_TAGS_PER_GROUP} 个标签`, 'warning');
        return;
      }
      if (tagActionType === 'hide') {
        setHiddenTags((prev) =>
          prev.includes(tagName) ? prev : [...prev.filter((t) => t !== tagName), tagName],
        );
        setSpoileredTags((prev) => prev.filter((t) => t !== tagName));
      } else {
        setSpoileredTags((prev) =>
          prev.includes(tagName) ? prev : [...prev.filter((t) => t !== tagName), tagName],
        );
        setHiddenTags((prev) => prev.filter((t) => t !== tagName));
      }
      setSearchQuery('');
      setShowSuggestions(false);
    },
    [hiddenTags.length, spoileredTags.length, tagActionType],
  );

  const removeTag = useCallback((tagName: string, type: 'hide' | 'spoiler') => {
    if (type === 'hide') setHiddenTags((prev) => prev.filter((t) => t !== tagName));
    else setSpoileredTags((prev) => prev.filter((t) => t !== tagName));
  }, []);

  // ================= Edit / Create =================
  const openEditModal = useCallback(
    (group?: BlockGroup) => {
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
    },
    [groups],
  );

  const handleSaveGroup = useCallback(async () => {
    if (!groupName.trim()) {
      showToast('请输入屏蔽组名称', 'warning');
      return;
    }
    if (hiddenTags.length === 0 && spoileredTags.length === 0) {
      showToast('请至少添加一个标签', 'warning');
      return;
    }
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

  const handleToggleGroup = useCallback(
    async (id: number, isActive: boolean) => {
      if (!userInfo?.token) return;
      // Optimistic update
      setGroups((prev) => {
        const updated = prev.map((g) => (g.id === id ? { ...g, is_active: isActive ? 1 : 0 } : g));
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
    },
    [userInfo?.token, loadGroups],
  );

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
  const sectionTitle = 'text-title-m-emphasized text-on-surface mb-4 flex items-center gap-2';
  if (!userInfo) return null;
  return (
    <div className="max-w-4xl mx-auto p-4">
      {' '}
      {/* Page header */}{' '}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        {' '}
        <h2 className={sectionTitle}>屏蔽组</h2>{' '}
        <div className="flex items-center gap-2">
          {' '}
          <button
            onClick={() => openEditModal()}
            className="px-3 py-1.5 text-label-m text-on-primary bg-primary hover:bg-primary/90 rounded-full transition-ui flex items-center gap-1"
          >
            {' '}
            <MdAdd size={14} /> 新建{' '}
          </button>{' '}
        </div>{' '}
      </div>{' '}
      {/* Stats bar */}{' '}
      <p className="text-body-m text-on-surface-variant mb-4">
        {' '}
        已创建屏蔽组: <strong className="text-on-surface">{groups.length}</strong> /{' '}
        {MAX_GROUPS}{' '}
      </p>{' '}
      {/* Loading */}{' '}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          {' '}
          <Spinner />{' '}
        </div>
      ) : groups.length === 0 ? (
        /* Empty state */ <div className="text-center py-20 text-outline">
          {' '}
          <MdShield size={64} className="mx-auto mb-4 opacity-30" />{' '}
          <p className="mb-2">还没有任何屏蔽组，快去创建一个吧！</p>{' '}
          <p className="text-body-s text-outline">开启后，主页将自动处理包含这些标签的图片。</p>{' '}
        </div>
      ) : (
        /* Group grid */ <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {' '}
          {groups.map((group) => {
            const hTags = group.hidden_tags || group.tags || [];
            const sTags = group.spoilered_tags || [];
            const isActive = group.is_active === 1;
            return (
              <div
                key={group.id}
                className={`bg-surface-container rounded-md border p-4 flex flex-col gap-3 shadow-e1 transition-ui ${isActive ? 'border-error/40' : 'border-outline-variant opacity-60'}`}
              >
                {' '}
                {/* Header */}{' '}
                <div className="flex items-center justify-between border-b border-dashed border-outline-variant pb-3">
                  {' '}
                  <span
                    className={`text-label-l-emphasized truncate ${isActive ? 'text-error' : 'text-outline'}`}
                  >
                    {group.name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Toggle switch */}
                    <label className="relative inline-block w-9 h-5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => handleToggleGroup(group.id, e.target.checked)}
                        className="opacity-0 w-0 h-0 peer"
                      />
                      <span className="absolute inset-0 bg-surface-container-highest rounded-full transition-ui peer-checked:bg-error-fill after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-surface-raised after:rounded-full after:transition-transform peer-checked:after:translate-x-4" />
                    </label>
                    <button
                      onClick={() => openEditModal(group)}
                      className="touch-target p-1.5 text-body-s text-outline hover:text-primary rounded transition-ui"
                      title="编辑"
                    >
                      <MdEdit size={14} />
                    </button>
                    <button
                      onClick={() => confirmDeleteGroup(group.id)}
                      className="touch-target p-1.5 text-body-s text-outline hover:text-error rounded transition-ui"
                      title="删除"
                    >
                      <MdDelete size={14} />
                    </button>
                  </div>
                </div>
                {/* Tags preview */}
                <div className="text-body-s space-y-1" style={{ opacity: isActive ? 1 : 0.4 }}>
                  {hTags.length > 0 && (
                    <div className="text-error">
                      <MdBlock size={12} className="inline mr-0.5" /> 隐藏: {hTags.join(', ')}
                    </div>
                  )}
                  {sTags.length > 0 && (
                    <div className="text-warning">
                      <MdVisibility size={12} className="inline mr-0.5" /> 遮挡: {sTags.join(', ')}
                    </div>
                  )}
                  {hTags.length === 0 && sTags.length === 0 && (
                    <span className="text-outline">空屏蔽组</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* ================= Edit / Create Modal ================= */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={editGroupId ? '编辑屏蔽组' : '创建新屏蔽组'}
        maxWidth="max-w-lg"
      >
        {' '}
        <div className="space-y-4">
          {' '}
          <div>
            {' '}
            <Input
              label="屏蔽组名称"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="例如：重口味屏蔽、黑名单画师..."
              maxLength={30}
            />{' '}
          </div>{' '}
          <div className="flex items-center gap-4 text-body-m">
            {' '}
            <label className="flex items-center gap-1.5 cursor-pointer text-error ">
              {' '}
              <input
                type="radio"
                name="tagActionType"
                value="hide"
                checked={tagActionType === 'hide'}
                onChange={() => setTagActionType('hide')}
              />
              <MdBlock size={16} /> 彻底隐藏
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-warning font-medium">
              <input
                type="radio"
                name="tagActionType"
                value="spoiler"
                checked={tagActionType === 'spoiler'}
                onChange={() => setTagActionType('spoiler')}
              />{' '}
              <MdVisibility size={16} /> 遮挡打码{' '}
            </label>{' '}
          </div>{' '}
          <div className="relative">
            {' '}
            <label className="block text-body-m text-on-surface mb-1">
              {' '}
              搜索并添加标签（支持联想）{' '}
            </label>{' '}
            <div className="relative">
              <Input
                ref={searchInputRef}
                type="text"
                icon={<MdSearch size={16} />}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="输入英文标签..."
              />
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={autocompleteRef}
                className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface-container border border-outline-variant popover-scrollbar rounded-sm shadow-e3 max-h-48 overflow-y-auto"
              >
                {' '}
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => addTag(s.name)}
                    className="w-full text-left px-3 py-2 text-body-m hover:bg-surface-container-high flex justify-between items-center border-b border-outline-variant last:border-0"
                  >
                    {' '}
                    <span className="text-on-surface">{s.name}</span>{' '}
                    <span className="text-body-s text-outline">{s.images}</span>{' '}
                  </button>
                ))}{' '}
              </div>
            )}{' '}
          </div>{' '}
          <div>
            {' '}
            <label className="block text-body-m text-error mb-1">
              <MdBlock size={14} className="inline mr-0.5" /> 隐藏标签列表：
            </label>{' '}
            <div className="flex flex-wrap gap-2 p-3 border border-outline-variant rounded-md bg-surface-container-low/50 popover-scrollbar min-h-[40px] max-h-[120px] overflow-y-auto">
              {' '}
              {hiddenTags.length === 0 ? (
                <span className="text-body-s text-outline">暂无标签</span>
              ) : (
                hiddenTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 text-label-m rounded bg-surface-container-lowest border border-outline-variant border-l-[3px] border-l-error"
                  >
                    {' '}
                    {tag}{' '}
                    <button
                      onClick={() => removeTag(tag, 'hide')}
                      aria-label={`移除 ${tag}`}
                      className="state-layer ml-0.5 rounded-full p-0.5 text-error"
                    >
                      {' '}
                      <MdClose size={14} />{' '}
                    </button>{' '}
                  </span>
                ))
              )}{' '}
            </div>{' '}
          </div>{' '}
          <div>
            {' '}
            <label className="block text-body-m text-warning mb-1">
              <MdVisibility size={14} className="inline mr-0.5" /> 遮挡标签列表：
            </label>{' '}
            <div className="flex flex-wrap gap-2 p-3 border border-outline-variant rounded-md bg-surface-container-low/50 popover-scrollbar min-h-[40px] max-h-[120px] overflow-y-auto">
              {' '}
              {spoileredTags.length === 0 ? (
                <span className="text-body-s text-outline">暂无标签</span>
              ) : (
                spoileredTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 text-label-m rounded bg-surface-container-lowest border border-outline-variant border-l-[3px] border-l-warning"
                  >
                    {' '}
                    {tag}{' '}
                    <button
                      onClick={() => removeTag(tag, 'spoiler')}
                      aria-label={`移除 ${tag}`}
                      className="state-layer ml-0.5 rounded-full p-0.5 text-warning"
                    >
                      <MdClose size={14} />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setEditModalOpen(false)}
              className="flex-1 px-4 py-2 border border-outline rounded-full text-body-m text-on-surface-variant hover:bg-surface-container-high transition-ui"
            >
              取消
            </button>
            <button
              onClick={handleSaveGroup}
              className="flex-1 px-4 py-2 bg-error-fill text-on-fill rounded-full text-label-l hover:bg-error-fill/90 transition-ui"
            >
              保存屏蔽组
            </button>
          </div>
        </div>
      </Modal>
      {/* ================= Delete Confirm Modal ================= */}
      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="确认删除"
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setDeleteConfirmOpen(false)}
              className="px-4 py-2 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
            >
              取消
            </button>
            <Button variant="danger" onClick={handleDeleteGroup}>
              确认删除
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant">确定要删除这个屏蔽组吗？</p>
      </Modal>
    </div>
  );
}
