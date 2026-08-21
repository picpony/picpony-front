'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import {
  MdAdd,
  MdShield,
  MdSearch,
  MdEdit,
  MdDelete,
  MdBlock,
  MdVisibility,
} from 'react-icons/md';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import ToggleSwitch from '@/components/ToggleSwitch';
import { Input } from '@/components/Input';
import { useAuthModal } from '@/components/AuthModal';
import PageHeader from '@/components/PageHeader';
import Radio from '@/components/Radio';
import Chip from '@/components/Chip';
import Popover from '@/components/Popover';
import { ICON } from '@/lib/icons';
import { readUserInfo } from '@/lib/hooks';

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

export default function BlockGroupsPage() {
  const { openAuth } = useAuthModal();
  const [userInfo] = useState<UserInfo | null>(() => readUserInfo() as UserInfo | null);
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
  /* Anchors the suggestion popover. `Popover` measures this to place itself
     and to decide which way to open. */
  const searchFieldRef = useRef<HTMLDivElement>(null);
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
      showToast('网络错误，请稍后再试', 'error');
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
          /* `searchDerpiTags`, not a bare `fetch` on a locally re-declared base.
             The shared wrapper goes through `proxyFetch`, so this autocomplete
             gets the accelerator fallback and its health degradation like every
             other Derpibooru call — and it escapes quotes and whitespace before
             interpolating, which a raw query does not: a `"` in the box broke the
             Philomena expression and returned nothing. It asks for 30 rows where
             this list shows 10, hence the slice. */
          const data = await api.searchDerpiTags(searchQuery);
          const tags = (data?.tags ?? []) as { name: string; images: number }[];
          if (tags.length > 0) {
            setSuggestions(tags.slice(0, 10).map((t) => ({ name: t.name, images: t.images })));
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

  /* The outside-click listener that used to live here is `Popover`'s now — it
     already knows both the panel and the anchor, which is what this had to be
     handed two refs to reconstruct. */

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
      showToast('网络错误，请稍后再试', 'error');
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
        showToast('网络错误，请稍后再试', 'error');
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
      showToast('网络错误，请稍后再试', 'error');
    }
  }, [userInfo?.token, loadGroups]);
  if (!userInfo) return null;
  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="屏蔽组"
        subtitle={`已创建屏蔽组 ${groups.length} / ${MAX_GROUPS}`}
        actions={
          <Button
            variant="filled"
            size="xs"
            onClick={() => openEditModal()}
            icon={<MdAdd size={ICON.dense} />}
          >
            新建
          </Button>
        }
      />
      {/* Loading */}{' '}
      {loading ? (
        /* Cards in the grid they will land in, rather than one centred spinner
           that then reflows into a three-column layout. */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              /* The outlined card's own recipe: `surface` + `outline-variant` at
                 elevation 0. This was `surface-container` + a border *and* an
                 `e1` shadow — a tone from no row of the colour table plus both
                 separators at once, written out twice in this file (here and on
                 the real row below, byte-identical). */
              className="bg-surface border-outline-variant flex flex-col gap-3 rounded-md border p-4"
            >
              <div className="border-outline-variant flex items-center justify-between border-b border-dashed pb-3">
                <Skeleton className="h-4 w-24" delay={i * 90} />
                <Skeleton className="h-8 w-28 rounded-full" delay={i * 90 + 60} />
              </div>
              <Skeleton className="h-3.5 w-3/4" delay={i * 90 + 120} />
              <Skeleton className="h-3.5 w-1/2" delay={i * 90 + 180} />
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        /* The shared empty state. This was the sixteenth hand-rolled one — a
           64px glyph at 30% opacity over two untyped paragraphs — and the only
           one of the sixteen with an opacity on its icon. */
        <EmptyState
          icon={<MdShield size={ICON.display} />}
          title="还没有任何屏蔽组"
          description="创建一个后，主页会自动处理包含这些标签的图片。"
          action={
            <Button variant="filled" icon={<MdAdd size={ICON.dense} />} onClick={() => openEditModal()}>
              新建屏蔽组
            </Button>
          }
        />
      ) : (
        /* Group grid */ <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          
          {groups.map((group) => {
            const hTags = group.hidden_tags || group.tags || [];
            const sTags = group.spoilered_tags || [];
            const isActive = group.is_active === 1;
            return (
              <div
                key={group.id}
                /* One signal per meaning — the note on the switch below says
                   exactly this, and the card was doing the opposite four times:
                   a soft 40%-alpha error edge, a card-wide 60% opacity, an
                   `outline` name colour, and then a *nested* 40% opacity on the
                   tag preview. The two opacities multiply, so an inactive
                   group's tags rendered at 24% — unreadable, and the one part of
                   the card that says what the rule actually does.

                   What is left: the switch is the control, the name colour is
                   the state, and the border is `error` only while the rule is in
                   force. The tag lines below drop to `on-surface-variant` when
                   it is not, because the red and amber *mean* "being blocked
                   right now"; off, they are just a list of words. */
                className={`bg-surface flex flex-col gap-3 rounded-md border p-4 transition-ui ${isActive ? 'border-error' : 'border-outline-variant'}`}
              >
                
                {/* Header */}
                <div className="flex items-center justify-between border-b border-dashed border-outline-variant pb-3">
                  
                  <span
                    className={`text-label-l-emphasized truncate ${isActive ? 'text-error' : 'text-on-surface-variant'}`}
                  >
                    {group.name}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* The real switch. This was a hand-rolled 36x20 box — an
                        `opacity-0` checkbox under a `peer-checked:` span with an
                        `after:` pseudo-element for the handle — sitting two routes
                        away from the settings page's full M3 switches, which have
                        the spec's two handle clocks, a press swell, a state layer
                        and a check glyph. Same control, two levels of finish.

                        Its track was `error-fill` when on. That is dropped rather
                        than ported: an M3 switch is `primary` when enabled, and
                        error on a *track* reads as "this control is in an error
                        state" rather than "this rule is active". The row already
                        says blocking three times over — the group name goes
                        `text-error`, and the hidden-tag line under it is error
                        too. One signal per meaning. */}
                    <ToggleSwitch
                      checked={isActive}
                      onChange={(v) => handleToggleGroup(group.id, v)}
                      aria-label={`启用屏蔽组 ${group.name}`}
                    />
                    {/* `IconButton size="sm"` is the sanctioned 32dp box. The
                        pair used to be `p-1.5 rounded` with `touch-target` — a
                        a bare 4dp corner on a control whose role is
                        `rounded-full`, and a hit-area shim standing in for a box
                        the primitive already gives. */}
                    <IconButton
                      size="sm"
                      onClick={() => openEditModal(group)}
                      aria-label={`编辑屏蔽组 ${group.name}`}
                      icon={<MdEdit size={ICON.dense} />}
                    />
                    <IconButton
                      size="sm"
                      onClick={() => confirmDeleteGroup(group.id)}
                      aria-label={`删除屏蔽组 ${group.name}`}
                      className="hover:text-error"
                      icon={<MdDelete size={ICON.dense} />}
                    />
                  </div>
                </div>
                {/* Tags preview */}
                <div className="text-body-s space-y-1">
                  {hTags.length > 0 && (
                    <div className={isActive ? 'text-error' : 'text-on-surface-variant'}>
                      <MdBlock size={ICON.dense} className="inline mr-0.5" /> 隐藏：{hTags.join(', ')}
                    </div>
                  )}
                  {sTags.length > 0 && (
                    <div className={isActive ? 'text-warning' : 'text-on-surface-variant'}>
                      <MdVisibility size={ICON.dense} className="inline mr-0.5" /> 遮挡：{sTags.join(', ')}
                    </div>
                  )}
                  {hTags.length === 0 && sTags.length === 0 && (
                    <span className="text-on-surface-variant">空屏蔽组</span>
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
        maxWidth="lg"
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
              placeholder="例如：重口味屏蔽、黑名单画师…"
              maxLength={30}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Radio
              name="tagActionType"
              value="hide"
              checked={tagActionType === 'hide'}
              onChange={() => setTagActionType('hide')}
              tone="error"
              label={
                <span className="flex items-center gap-1.5">
                  <MdBlock size={ICON.dense} /> 彻底隐藏
                </span>
              }
            />
            <Radio
              name="tagActionType"
              value="spoiler"
              checked={tagActionType === 'spoiler'}
              onChange={() => setTagActionType('spoiler')}
              tone="warning"
              label={
                <span className="flex items-center gap-1.5">
                  <MdVisibility size={ICON.dense} /> 遮挡打码
                </span>
              }
            />
          </div>
          <div className="relative" ref={searchFieldRef}>
            {/* The caption is the field's own `label`, not a bare `<label>` next
                to it. Without `htmlFor` a `<label>` labels nothing: clicking it
                did not focus the input, and the input's only accessible name was
                its placeholder, which disappears the moment you type. */}
            <Input
              ref={searchInputRef}
              label="搜索并添加标签（支持联想）"
              type="text"
              icon={<MdSearch size={ICON.dense} />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="输入英文标签…"
            />
            {/* `Popover` — the app's one floating surface. This was a fourth
                hand-rolled recipe (an outline on top of the tonal step and the
                elevation, which is a third signal for one edge) and it was
                clipped by any scrolling ancestor because it was absolutely
                positioned rather than portalled. */}
            <Popover
              open={showSuggestions && suggestions.length > 0}
              onClose={() => setShowSuggestions(false)}
              anchorRef={searchFieldRef}
              maxHeight={192}
              estimatedHeight={suggestions.length * 40}
            >
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => addTag(s.name)}
                    className="w-full text-left px-3 py-2 text-body-m state-layer flex justify-between items-center border-b border-outline-variant last:border-0 outline-none focus-visible:inset-ring-2 focus-visible:focus-ring-inset"
                  >
                    
                    <span className="text-on-surface">{s.name}</span>
                    <span className="text-body-s text-on-surface-variant">{s.images}</span>
                  </button>
                ))}{' '}
            </Popover>
          </div>
          <div>
            {' '}
            <p className="block text-body-m text-error mb-1">
              <MdBlock size={ICON.dense} className="inline mr-0.5" /> 隐藏标签列表：
            </p>
            <div className="flex flex-wrap gap-2 p-3 border border-outline-variant rounded-md bg-surface-container-low popover-scrollbar min-h-10 max-h-30 overflow-y-auto">
              
              {hiddenTags.length === 0 ? (
                <EmptyState size="inline" title="暂无标签" />
              ) : (
                hiddenTags.map((tag) => (
                  <Chip key={tag} onRemove={() => removeTag(tag, 'hide')} removeLabel={`移除 ${tag}`}>
                    {tag}
                  </Chip>
                ))
              )}
            </div>
          </div>
          <div>
            {' '}
            <p className="block text-body-m text-warning mb-1">
              <MdVisibility size={ICON.dense} className="inline mr-0.5" /> 遮挡标签列表：
            </p>
            <div className="flex flex-wrap gap-2 p-3 border border-outline-variant rounded-md bg-surface-container-low popover-scrollbar min-h-10 max-h-30 overflow-y-auto">
              
              {spoileredTags.length === 0 ? (
                <EmptyState size="inline" title="暂无标签" />
              ) : (
                spoileredTags.map((tag) => (
                  <Chip key={tag} onRemove={() => removeTag(tag, 'spoiler')} removeLabel={`移除 ${tag}`}>
                    {tag}
                  </Chip>
                ))
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="tonal" fullWidth onClick={() => setEditModalOpen(false)}>
              取消
            </Button>
            <Button variant="danger" fullWidth onClick={handleSaveGroup}>
              保存屏蔽组
            </Button>
          </div>
        </div>
      </Modal>
      {/* ================= Delete Confirm Modal ================= */}
      <Modal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title="确认删除"
        maxWidth="sm"
        footer={
          <>
            <Button variant="text" onClick={() => setDeleteConfirmOpen(false)}>
              取消
            </Button>
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
