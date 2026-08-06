'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Checkbox from '@/components/Checkbox';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import {
  MdLibraryBooks,
  MdAdd,
  MdSearch,
  MdEdit,
  MdDelete,
  MdContentCopy,
  MdTranslate,
  MdFileDownload,
  MdFileUpload,
  MdCloudDownload,
  MdClose,
  MdFeedback,
  MdEmojiEvents,
  MdCheckCircle,
  MdOutlineWarning,
} from 'react-icons/md';
import { Spinner } from './';
import DataTable, { type Column } from '@/components/DataTable';
import Pagination from '@/components/Pagination';
import Button from '@/components/Button';
import { tagCategoryChip, tagCategoryDot } from '@/lib/tagCategories';
import { Input, Textarea } from '@/components/Input';

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

export default function GlossaryTab() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const initFromStorage = () => {
    const storedUser = typeof window !== 'undefined' ? localStorage.getItem('user_info') : null;
    let token = '';
    let role = 'user';
    let admin = false;
    if (storedUser) {
      try {
        const user = JSON.parse(storedUser);
        token = user.token || '';
        role = user.role || 'user';
        const allowedRoles = ['super_admin', 'admin', 'editor'];
        admin = allowedRoles.includes(user.role);
      } catch {
        // ignore
      }
    }
    const savedItemsPerPage =
      typeof window !== 'undefined' ? localStorage.getItem('picpony_items_per_page') : null;
    const itemsPerPage = savedItemsPerPage ? parseInt(savedItemsPerPage, 10) : 100;
    return {
      token,
      userRole: role,
      isAdmin: admin,
      itemsPerPage,
      initError: storedUser ? null : '请先登录',
    };
  };

  const initial = initFromStorage();
  const [isAdmin] = useState(initial.isAdmin);
  const [token] = useState<string>(initial.token);
  const [error, setError] = useState<string | null>(initial.initError);
  const [itemsPerPage, setItemsPerPage] = useState<number>(initial.itemsPerPage);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalMatches, setTotalMatches] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortMode, setSortMode] = useState('count_desc');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showUntranslatedOnly, setShowUntranslatedOnly] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
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
  const [batchInput, setBatchInput] = useState('');
  const [isBatchImporting, setIsBatchImporting] = useState(false);

  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [syncStartPage, setSyncStartPage] = useState(1);
  const [syncEndPage, setSyncEndPage] = useState(20);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, message: '' });

  const [isDuplicateMode, setIsDuplicateMode] = useState(false);
  const [duplicateTags, setDuplicateTags] = useState<Tag[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);

  const [isDerpiModalOpen, setIsDerpiModalOpen] = useState(false);
  const [derpiSearchQuery, setDerpiSearchQuery] = useState('');
  const [derpiResults, setDerpiResults] = useState<DerpiTag[]>([]);
  const [isDerpiSearching, setIsDerpiSearching] = useState(false);

  const [stats, setStats] = useState<TagStats>({ total: 0, translated: 0, leaderboard: [] });

  const [glossaryConfirmModalOpen, setGlossaryConfirmModalOpen] = useState(false);
  const [glossaryConfirmTitle, setGlossaryConfirmTitle] = useState('');
  const [glossaryConfirmMessage, setGlossaryConfirmMessage] = useState('');
  const glossaryConfirmActionRef = useRef<(() => void) | null>(null);

  const showGlossaryConfirm = (title: string, message: string, action: () => void) => {
    setGlossaryConfirmTitle(title);
    setGlossaryConfirmMessage(message);
    glossaryConfirmActionRef.current = action;
    setGlossaryConfirmModalOpen(true);
  };

  const handleGlossaryConfirmAction = () => {
    glossaryConfirmActionRef.current?.();
    setGlossaryConfirmModalOpen(false);
  };

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const loadTags = useCallback(
    async (page = 1) => {
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
    },
    [token, itemsPerPage, searchKeyword, sortMode, categoryFilter, showUntranslatedOnly],
  );

  useEffect(() => {
    if (!token) return;
    api
      .getDictionary(token, {
        page: 1,
        limit: itemsPerPage,
        keyword: searchKeyword,
        sort: sortMode,
        category: categoryFilter,
        untranslated: showUntranslatedOnly ? 1 : 0,
      })
      .then((data) => {
        if (data.success) {
          setTags(data.tags || []);
          setTotalMatches(data.total_matches || 0);
          setTotalPages(Math.ceil((data.total_matches || 0) / itemsPerPage) || 1);
          setCurrentPage(1);
          if (data.stats) {
            setStats(data.stats);
          }
        } else {
          setError(data.error || '加载失败');
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '网络错误');
      })
      .finally(() => setIsLoading(false));
  }, [token, itemsPerPage, searchKeyword, sortMode, categoryFilter, showUntranslatedOnly]);

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
    setDerpiSuggestions([]);
    setShowSuggestions(false);
  };

  const closeEditModal = () => {
    setTimeout(() => {
      setIsEditModalOpen(false);
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

    const { en, cn, cat, count, description, id } = editForm;

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
        const parts = cn
          .replace(/，/g, ',')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s);
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

    showGlossaryConfirm('确认删除', '确定要永久删除这个词条吗？', async () => {
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
    });
  };

  const batchDelete = async () => {
    if (!isAdmin || !token || selectedIds.size === 0) return;

    showGlossaryConfirm(
      '确认批量删除',
      `确定要永久删除选中的 ${selectedIds.size} 个标签吗？`,
      async () => {
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
      },
    );
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
    const tasks: {
      en: string;
      cn: string;
      aliases: string[];
      cat: string;
      count: number;
      description: string;
    }[] = [];
    const batchEnTags = new Set<string>();

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#') || !trimmedLine.includes('=')) continue;

      const parts = trimmedLine.split('=');
      const en = parts[0].trim().toLowerCase();
      const cnRaw = parts[1]?.trim() || '';

      const cnParts = cnRaw
        .replace(/，/g, ',')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s);
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

    showGlossaryConfirm(
      '确认批量导入',
      `成功解析到 ${tasks.length} 个新标签，开始导入？`,
      async () => {
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
      },
    );
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
      setSyncProgress({
        current: p - syncStartPage + 1,
        total: totalPagesToFetch,
        message: `正在拉取第 ${p} 页...`,
      });

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
    } catch {
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

  const visibleTags = isDuplicateMode ? duplicateTags : tags;
  const allSelected = visibleTags.length > 0 && visibleTags.every((t) => selectedIds.has(t.id));

  /* Built here rather than at module scope: every cell closes over `isAdmin`,
     the selection set and the row handlers, and the header cell owns the
     select-all checkbox. */
  const tagColumns: Column<Tag>[] = [
    {
      key: 'select',
      align: 'center',
      headerClassName: 'w-12',
      // The phone card has no row grid to select across, so the checkbox
      // column would just be a stray control with no header to explain it.
      hideOnMobile: true,
      header: isAdmin ? (
        <Checkbox checked={allSelected} onChange={toggleSelectAll} aria-label="全选本页标签" />
      ) : (
        ''
      ),
      render: (tag) =>
        isAdmin ? (
          <Checkbox
            checked={selectedIds.has(tag.id)}
            onChange={() => toggleRowSelection(tag.id)}
            aria-label={`选择 ${tag.en}`}
          />
        ) : null,
    },
    {
      key: 'cn',
      header: '中文翻译',
      primary: true,
      render: (tag) =>
        tag.cn === '未翻译' ? (
          <span className="bg-error-container text-error inline-flex items-center gap-1 rounded px-2 py-1 text-label-m whitespace-nowrap">
            {' '}
            <MdOutlineWarning size={14} /> 未翻译{' '}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {' '}
            <span className="bg-primary-container text-on-primary-container inline-flex items-center rounded px-2 py-1 text-label-m ">
              {' '}
              {tag.cn}{' '}
            </span>{' '}
            {tag.aliases?.map((alias, idx) => (
              <span
                key={idx}
                className="bg-surface-container-high text-on-surface-variant inline-flex items-center rounded px-2 py-1 text-label-m "
              >
                {' '}
                {alias}{' '}
              </span>
            ))}{' '}
          </div>
        ),
    },
    {
      key: 'en',
      header: '英文标签',
      render: (tag) => (
        <div className="flex flex-wrap items-center gap-2">
          {' '}
          <span
            className={`inline-flex items-center rounded px-2 py-0.5 text-label-m ${tagCategoryChip(tag.cat)}`}
          >
            {' '}
            {tag.cat}{' '}
          </span>{' '}
          <a
            href={`/search?q=${encodeURIComponent(tag.en)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link flex items-center gap-1 font-mono text-body-m hover:underline"
          >
            {' '}
            {tag.en} <MdSearch size={14} />{' '}
          </a>{' '}
          {tag.count > 0 ? (
            <span className="bg-accent-blue text-on-accent-blue inline-flex items-center rounded px-2 py-0.5 text-label-m ">
              {' '}
              原站 ({tag.count}图){' '}
            </span>
          ) : (
            <span className="bg-surface-container-high text-on-surface-variant inline-flex items-center rounded px-2 py-0.5 text-label-m ">
              {' '}
              本地{' '}
            </span>
          )}{' '}
        </div>
      ),
    },
    {
      key: 'desc',
      header: '标签简介',
      render: (tag) =>
        tag.description ? (
          <p className="text-on-surface-variant line-clamp-2 text-body-m" title={tag.description}>
            {tag.description}
          </p>
        ) : (
          <span className="text-outline text-body-m">暂无简介</span>
        ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      headerClassName: 'w-24',
      render: (tag) =>
        isAdmin ? (
          <>
            <button
              onClick={() => openEditModal(tag)}
              className="touch-target state-layer text-warning rounded-full p-1.5"
              title="编辑"
              aria-label={`编辑 ${tag.en}`}
            >
              <MdEdit size={18} />
            </button>
            <button
              onClick={() => deleteTag(tag.id)}
              className="touch-target state-layer rounded-full p-1.5 text-error"
              title="删除"
              aria-label={`删除 ${tag.en}`}
            >
              <MdDelete size={18} />
            </button>
          </>
        ) : (
          <span className="text-outline text-body-m">无权限</span>
        ),
    },
  ];

  const translationPercentage =
    stats.total > 0 ? ((stats.translated / stats.total) * 100).toFixed(2) : '0.00';
  if (error && !tags.length) {
    return (
      <div className="text-center py-12">
        {' '}
        <p className="text-on-surface-variant mb-4">{error}</p>{' '}
        <button
          onClick={() => loadTags(1)}
          className="px-4 py-2 text-label-l text-on-primary bg-primary hover:bg-primary/90 rounded-full transition-ui"
        >
          {' '}
          重试{' '}
        </button>{' '}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {' '}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {' '}
        <h2 className="text-title-l text-on-surface flex items-center gap-2">
          {' '}
          <MdLibraryBooks className="text-primary" size={24} /> 中英标签词库管理 ({totalMatches}{' '}
          条){' '}
        </h2>{' '}
        {isAdmin && (
          <button
            onClick={() => openEditModal()}
            className="inline-flex items-center gap-2 px-4 py-2 text-label-l text-on-primary bg-primary hover:bg-primary/90 rounded-full transition-ui shrink-0"
          >
            {' '}
            <MdAdd size={18} /> 添加新标签{' '}
          </button>
        )}{' '}
      </div>{' '}
      <div className="flex flex-col sm:flex-row gap-3">
        {' '}
        <Input
          type="text"
          icon={<MdSearch size={20} />}
          value={searchKeyword}
          onChange={(e) => setSearchKeyword(e.target.value)}
          placeholder="搜索中文或英文标签..."
          fieldClassName="flex-1 min-w-[200px]"
        />
        <Select
          value={sortMode}
          onChange={(v) => setSortMode(v)}
          className="shrink-0"
          aria-label="排序方式"
          options={[
            { value: 'count_desc', label: '热度：高到低' },
            { value: 'count_asc', label: '热度：低到高' },
            { value: 'newest', label: '最新添加' },
            { value: 'en_asc', label: '英文：A-Z' },
          ]}
        />
        <Select
          value={categoryFilter}
          onChange={(v) => setCategoryFilter(v)}
          className="shrink-0"
          aria-label="分类筛选"
          options={[
            { value: 'all', label: '全部分类' },
            { value: 'general', label: '常规' },
            { value: 'character', label: '角色' },
            { value: 'species', label: '种族' },
            { value: 'rating', label: '分级' },
            { value: 'origin', label: '来源' },
            { value: 'content-official', label: '官方内容' },
            { value: 'content-fanmade', label: '同人内容' },
            { value: 'error', label: '错误' },
          ]}
        />{' '}
      </div>{' '}
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {' '}
          <button
            onClick={() => setShowUntranslatedOnly(!showUntranslatedOnly)}
            className={`inline-flex items-center gap-1 px-3 py-2 text-label-l rounded-full transition-ui shrink-0 ${
              showUntranslatedOnly
                ? 'bg-primary text-on-primary hover:bg-primary/90'
                : 'bg-primary/10 text-primary hover:bg-primary/20'
            }`}
          >
            {showUntranslatedOnly ? <MdClose size={16} /> : <MdTranslate size={16} />}
            {showUntranslatedOnly ? '取消未翻译过滤' : '只看未翻译'}{' '}
          </button>{' '}
          {selectedIds.size > 0 && (
            <button
              onClick={batchDelete}
              className="inline-flex items-center gap-1 px-3 py-2 text-label-l bg-error-fill text-on-fill hover:bg-error-fill/90 rounded-full transition-ui shrink-0"
            >
              {' '}
              <MdDelete size={16} /> 批量删除 ({selectedIds.size}){' '}
            </button>
          )}{' '}
          <button
            onClick={toggleDuplicateMode}
            className={`inline-flex items-center gap-1 px-3 py-2 text-label-l rounded-full transition-ui shrink-0 ${
              isDuplicateMode
                ? 'bg-primary text-on-primary hover:bg-primary/90'
                : 'bg-primary/10 text-primary hover:bg-primary/20'
            }`}
          >
            <MdContentCopy size={16} />
            {isDuplicateMode ? '退出查重' : '查重模式'}{' '}
          </button>{' '}
          <button
            onClick={() => setIsFeedbackModalOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 text-label-l bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-ui shrink-0"
          >
            {' '}
            <MdFeedback size={16} /> 用户反馈{' '}
          </button>{' '}
          <button
            onClick={exportCurrentPage}
            className="inline-flex items-center gap-1 px-3 py-2 text-label-l bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-ui shrink-0"
          >
            {' '}
            <MdFileDownload size={16} /> 导出当前页{' '}
          </button>{' '}
          <button
            onClick={() => setIsBatchModalOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 text-label-l bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-ui shrink-0"
          >
            {' '}
            <MdFileUpload size={16} /> 批量导入{' '}
          </button>{' '}
          <button
            onClick={() => setIsSyncModalOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 text-label-l bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-ui shrink-0"
          >
            {' '}
            <MdCloudDownload size={16} /> 同步热门{' '}
          </button>{' '}
          <button
            onClick={() => setIsDerpiModalOpen(true)}
            className="inline-flex items-center gap-1 px-3 py-2 text-label-l bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-ui shrink-0"
          >
            {' '}
            <MdSearch size={16} /> 搜原站标签{' '}
          </button>{' '}
        </div>
      )}{' '}
      <DataTable<Tag>
        columns={tagColumns}
        rows={visibleTags}
        rowKey={(tag) => tag.id}
        loading={isLoading}
        empty={
          isDuplicateMode ? (
            <div className="flex flex-col items-center gap-2">
              {' '}
              <MdCheckCircle size={32} className="text-success" />{' '}
              <p className="flex items-center gap-2">
                {' '}
                <MdEmojiEvents size={20} className="text-success" />{' '}
                太棒了，当前词库没有发现重复英文标签！{' '}
              </p>{' '}
            </div>
          ) : (
            '未找到匹配的标签记录'
          )
        }
      />
      {!isDuplicateMode && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-body-m text-on-surface-variant">每页:</span>
            <Input
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
              className="rounded"
              fieldClassName="w-16"
            />
            <span className="text-body-m text-on-surface-variant">条</span>
          </div>

          <div className="flex flex-col items-center gap-1 sm:items-end">
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={loadTags}
              siblings={1}
              className="mt-0"
            />
            <span className="text-on-surface-variant text-body-s">共 {totalMatches} 条</span>
          </div>
        </div>
      )}
      <div className="p-4 bg-surface-container-low/50 rounded-md border border-outline-variant">
        <div className="text-center mb-3">
          <span className="text-body-m text-on-surface-variant">
            词库翻译进度：已翻译 <strong className="text-primary">{stats.translated}</strong> /
            总标签 <strong>{stats.total}</strong> ({' '}
            <strong className="text-success">{translationPercentage}%</strong> )
          </span>
        </div>
        <div className="w-full h-3 bg-surface-container-highest rounded-full overflow-hidden">
          <div
            className="h-full bg-success-fill rounded-full transition-[width] duration-500 ease-[var(--ease-standard)]"
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
            <Button variant="text" onClick={closeEditModal}>
              取消
            </Button>
            <Button variant="filled" onClick={saveTag} disabled={isSaving}>
              {isSaving ? '保存中...' : '保存'}{' '}
            </Button>{' '}
          </>
        }
      >
        {' '}
        <div className="space-y-4">
          {' '}
          <div className="relative">
            {' '}
            <label className="block text-label-l text-on-surface mb-1" htmlFor="glossarytab-f1">
              {' '}
              英文原标签 {editingTag ? '(勿改动)' : ''}{' '}
            </label>{' '}
            <Input
              id="glossarytab-f1"
              type="text"
              value={editForm.en}
              onChange={(e) => {
                setEditForm({ ...editForm, en: e.target.value });
                searchDerpiSuggestions(e.target.value);
              }}
              disabled={!!editingTag}
              placeholder="例如：twilight sparkle"
              className="font-mono"
            />{' '}
            {showSuggestions && derpiSuggestions.length > 0 && (
              <div
                ref={suggestionsRef}
                className="absolute z-10 w-full mt-1 bg-surface-container-lowest border border-outline-variant popover-scrollbar rounded-sm shadow-e3 max-h-48 overflow-y-auto"
              >
                {' '}
                {derpiSuggestions.map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => selectSuggestion(tag)}
                    className="w-full px-3 py-2 text-left hover:bg-surface-container-high flex items-center justify-between"
                  >
                    {' '}
                    <div className="flex items-center gap-2">
                      {' '}
                      <span
                        className={`w-2 h-2 rounded-full ${tagCategoryDot(tag.category)}`}
                      />{' '}
                      <span className="text-body-m text-on-surface font-mono">{tag.name}</span>{' '}
                    </div>{' '}
                    <span className="text-body-s text-outline">{tag.images} 图</span>{' '}
                  </button>
                ))}{' '}
              </div>
            )}{' '}
          </div>{' '}
          <div>
            {' '}
            <label className="block text-label-l text-on-surface mb-1" htmlFor="glossarytab-f2">
              {' '}
              中文翻译 <span className="text-outline">(多重翻译请用英文逗号 , 隔开)</span>{' '}
            </label>{' '}
            <Input
              id="glossarytab-f2"
              type="text"
              value={editForm.cn}
              onChange={(e) => setEditForm({ ...editForm, cn: e.target.value })}
              placeholder="例如：紫悦,暮光闪闪,ts"
            />{' '}
          </div>{' '}
          <div>
            {' '}
            <label className="block text-label-l text-on-surface mb-1" htmlFor="glossarytab-f3">
              分类
            </label>{' '}
            <Select
              value={editForm.cat}
              onChange={(v) => setEditForm({ ...editForm, cat: v })}
              className="w-full"
              options={[
                { value: 'general', label: '常规 (general)' },
                { value: 'character', label: '角色 (character)' },
                { value: 'species', label: '种族 (species)' },
                { value: 'rating', label: '分级 (rating)' },
                { value: 'origin', label: '来源 (origin)' },
                { value: 'content-official', label: '官方内容 (content-official)' },
                { value: 'content-fanmade', label: '同人内容 (content-fanmade)' },
                { value: 'error', label: '错误 (error)' },
              ]}
            />{' '}
          </div>{' '}
          <div>
            {' '}
            <label className="block text-label-l text-on-surface mb-1">标签简介</label>{' '}
            <Textarea
              id="glossarytab-f3"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              placeholder="例如：该角色首次登场于第X季..."
              rows={3}
              className="resize-none"
            />{' '}
          </div>{' '}
        </div>{' '}
      </Modal>{' '}
      <Modal
        isOpen={isBatchModalOpen}
        onClose={() => !isBatchImporting && setIsBatchModalOpen(false)}
        title="批量导入标签"
        maxWidth="max-w-xl"
        footer={
          <>
            {' '}
            <button
              onClick={() => setIsBatchModalOpen(false)}
              className="px-4 py-2 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
            >
              {' '}
              取消{' '}
            </button>{' '}
            <button
              onClick={executeBatchImport}
              disabled={isBatchImporting}
              className="px-4 py-2 text-label-l bg-tertiary-container text-on-tertiary-container hover:bg-tertiary-container/80 rounded-full transition-ui disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {' '}
              {isBatchImporting ? '导入中...' : '开始导入'}{' '}
            </button>{' '}
          </>
        }
      >
        {' '}
        <p className="text-body-m text-on-surface-variant mb-3">
          {' '}
          格式要求：
          <code className="bg-surface-container-high px-1 rounded">
            英文标签 = 主中文名, 别名1, 别名2
          </code>{' '}
        </p>{' '}
        <Textarea
          value={batchInput}
          onChange={(e) => setBatchInput(e.target.value)}
          placeholder="例如：&#10;twilight sparkle = 紫悦, 暮光闪闪, ts"
          rows={12}
          className="font-mono resize-none"
        />{' '}
      </Modal>{' '}
      <Modal
        isOpen={isSyncModalOpen}
        onClose={() => !isSyncing && setIsSyncModalOpen(false)}
        title="拉取原站热门标签"
        maxWidth="max-w-md"
        hideCloseButton={isSyncing}
        footer={
          <>
            {' '}
            {!isSyncing && (
              <button
                onClick={() => setIsSyncModalOpen(false)}
                className="px-4 py-2 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
              >
                {' '}
                取消{' '}
              </button>
            )}{' '}
            <button
              onClick={isSyncing ? () => setIsSyncing(false) : executeSync}
              className={`text-label-l rounded-sm px-4 py-2 transition-ui ${
                isSyncing
                  ? 'bg-error-fill text-on-fill hover:bg-error-fill/90'
                  : 'bg-success-fill text-on-fill hover:bg-success-fill/90'
              }`}
            >
              {isSyncing ? '停止同步' : '开始同步'}{' '}
            </button>{' '}
          </>
        }
      >
        {' '}
        <div className="space-y-4">
          {' '}
          <p className="text-body-m text-on-surface-variant">
            {' '}
            系统将按原站<strong>图片总数</strong>从高到低自动拉取标签。 <br />{' '}
            <span className="text-error">新拉取的标签会被标记为【未翻译】</span>{' '}
          </p>{' '}
          {isSyncing ? (
            <div className="space-y-3">
              {' '}
              <div className="flex items-center justify-between text-body-m">
                {' '}
                <span className="text-on-surface-variant">{syncProgress.message}</span>{' '}
                <span className="text-primary ">
                  {' '}
                  {syncProgress.current} / {syncProgress.total}{' '}
                </span>{' '}
              </div>{' '}
              <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
                {' '}
                <div
                  className="h-full bg-success-fill rounded-full transition-[width] duration-300 ease-[var(--ease-standard)]"
                  style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                />{' '}
              </div>{' '}
            </div>
          ) : (
            <div className="flex items-center gap-4">
              {' '}
              <div className="flex-1">
                {' '}
                <Input
                  label="起始页"
                  id="glossarytab-f4"
                  type="number"
                  min={1}
                  value={syncStartPage}
                  onChange={(e) => setSyncStartPage(parseInt(e.target.value) || 1)}
                />{' '}
              </div>{' '}
              <div className="flex-1">
                {' '}
                <Input
                  label="结束页"
                  id="glossarytab-f5"
                  type="number"
                  min={1}
                  value={syncEndPage}
                  onChange={(e) => setSyncEndPage(parseInt(e.target.value) || 1)}
                />{' '}
              </div>{' '}
            </div>
          )}{' '}
        </div>{' '}
      </Modal>{' '}
      <Modal
        isOpen={isDerpiModalOpen}
        onClose={() => setIsDerpiModalOpen(false)}
        title="搜索 Trixiebooru 原站标签"
        maxWidth="max-w-lg"
      >
        {' '}
        <div className="space-y-4">
          {' '}
          <div className="flex gap-2">
            {' '}
            <Input
              type="text"
              value={derpiSearchQuery}
              onChange={(e) => setDerpiSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executeDerpiSearch()}
              placeholder="输入英文标签名..."
              fieldClassName="flex-1"
            />
            <Button variant="filled" onClick={executeDerpiSearch} disabled={isDerpiSearching}>
              {isDerpiSearching ? '搜索中...' : '搜索'}
            </Button>
          </div>
          <div className="popover-scrollbar max-h-72 overflow-y-auto border border-outline-variant rounded-md">
            {derpiResults.length === 0 ? (
              <div className="p-8 text-center text-on-surface-variant">
                {isDerpiSearching ? '搜索中...' : '搜索结果将显示在这里'}
              </div>
            ) : (
              derpiResults.map((tag) => (
                <div
                  key={tag.name}
                  className="flex items-center justify-between p-3 border-b border-outline-variant last:border-b-0 hover:bg-surface-container-high/50"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-body-s px-2 py-0.5 rounded ${tagCategoryChip(tag.category)}`}
                    >
                      {tag.category || 'general'}{' '}
                    </span>{' '}
                    <span className="font-mono text-body-m text-on-surface">{tag.name}</span>{' '}
                    <span className="text-body-s text-outline">({tag.images} 图)</span>{' '}
                  </div>{' '}
                  <button
                    onClick={() => importFromDerpi(tag)}
                    className="px-3 py-1 text-label-m bg-success-fill text-on-fill hover:bg-success-fill/90 rounded transition-ui shrink-0"
                  >
                    {' '}
                    + 导入{' '}
                  </button>{' '}
                </div>
              ))
            )}{' '}
          </div>{' '}
        </div>{' '}
      </Modal>{' '}
      <Modal
        isOpen={isFeedbackModalOpen}
        onClose={() => setIsFeedbackModalOpen(false)}
        title="用户反馈与翻译申请"
        maxWidth="max-w-xl"
      >
        {' '}
        <div className="popover-scrollbar max-h-[60vh] overflow-y-auto">
          {' '}
          {isLoadingFeedback ? (
            <div className="flex items-center justify-center py-12">
              {' '}
              <Spinner label="" size="md" />{' '}
            </div>
          ) : feedbacks.length === 0 ? (
            <div className="text-center py-12 text-on-surface-variant"> 暂无任何反馈申请 </div>
          ) : (
            <div className="space-y-3">
              {' '}
              {feedbacks.map((feedback) => (
                <div
                  key={feedback.id}
                  className={`p-4 rounded-md border-l-4 ${
                    feedback.status === 'pending'
                      ? 'bg-warning-container border-warning/40'
                      : feedback.status === 'processed'
                        ? 'bg-success-container border-success/40'
                        : 'bg-error-container border-error/40'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-body-m text-on-surface-variant">
                      来自: {feedback.username} | {feedback.created_at}
                    </span>
                    <span
                      className={`text-body-s px-2 py-0.5 rounded ${
                        feedback.status === 'pending'
                          ? 'bg-warning-container text-warning'
                          : feedback.status === 'processed'
                            ? 'bg-success-container text-success'
                            : 'bg-error-container text-error'
                      }`}
                    >
                      {feedback.status === 'pending'
                        ? '待处理'
                        : feedback.status === 'processed'
                          ? '已采纳'
                          : '已忽略'}{' '}
                    </span>{' '}
                  </div>{' '}
                  <div className="font-mono text-label-l-emphasized text-primary mb-2">
                    {feedback.tag_name}
                  </div>{' '}
                  <div className="text-body-m text-on-surface-variant mb-3 bg-surface-container-high/50 p-2 rounded">
                    {' '}
                    {feedback.content}{' '}
                  </div>{' '}
                  <div className="flex justify-end gap-2">
                    {' '}
                    {feedback.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleFeedback(feedback.id, 'processed')}
                          className="px-3 py-1 text-label-m bg-success-fill text-on-fill hover:bg-success-fill/90 rounded transition-ui"
                        >
                          {' '}
                          采纳{' '}
                        </button>{' '}
                        <button
                          onClick={() => handleFeedback(feedback.id, 'rejected')}
                          className="px-3 py-1 text-label-m bg-error-fill text-on-fill hover:bg-error-fill/90 rounded transition-ui"
                        >
                          {' '}
                          忽略{' '}
                        </button>{' '}
                      </>
                    ) : (
                      <button
                        onClick={() => handleFeedback(feedback.id, 'pending')}
                        className="px-3 py-1 text-label-m text-on-surface-variant hover:bg-surface-container-high rounded transition-ui"
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
      <Modal
        isOpen={glossaryConfirmModalOpen}
        onClose={() => setGlossaryConfirmModalOpen(false)}
        title={glossaryConfirmTitle}
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setGlossaryConfirmModalOpen(false)}
              className="px-4 py-2 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
            >
              取消
            </button>
            <Button variant="danger" onClick={handleGlossaryConfirmAction}>
              确认
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant">{glossaryConfirmMessage}</p>
      </Modal>
    </div>
  );
}
