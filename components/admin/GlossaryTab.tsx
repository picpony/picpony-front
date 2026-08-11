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
  MdFeedback,
  MdCheckCircle,
  MdOutlineWarning,
  MdHistory,
  MdArrowDownward,
} from 'react-icons/md';
import Badge from '@/components/Badge';
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import DataTable, { type Column } from '@/components/DataTable';
import Pagination from '@/components/Pagination';
import Button from '@/components/Button';
import { tagCategoryChip, tagCategoryDot } from '@/lib/tagCategories';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { Input, Textarea } from '@/components/Input';
import { useConfirm, usePrompt } from '@/components/ConfirmDialog';
import InlineEditorPanel, { captureInlineEditorLayout } from '@/components/InlineEditorPanel';
import SectionHeading from '@/components/SectionHeading';
import Popover from '@/components/Popover';

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

interface TagEditForm {
  id: number;
  en: string;
  cn: string;
  aliases: string;
  cat: string;
  count: number;
  description: string;
}

interface TagStats {
  total: number;
  translated: number;
  leaderboard: { username: string; count: number }[];
}

/** 词库标签编辑历史记录（对应后端 get_dictionary_tag_history 返回项） */
interface TagHistory {
  editor_username?: string;
  created_at?: string;
  en_name?: string;
  cn_name?: string;
  aliases?: string[] | string | null;
  category?: string;
  search_count?: number | null;
  description?: string;
}

interface Feedback {
  id: number;
  user_id?: number;
  tag_name: string;
  content: string;
  username: string;
  status: 'pending' | 'processed' | 'rejected';
  created_at: string;
  handled_by?: number | null;
  handled_by_name?: string | null;
  handled_at?: string | null;
  handling_note?: string;
}

interface FeedbackSummary {
  pending: number;
  processed: number;
  rejected: number;
}

interface DerpiTag {
  name: string;
  category: string;
  images: number;
}

const TAG_CATEGORY_OPTIONS = [
  { value: 'general', label: '常规 (general)' },
  { value: 'character', label: '角色 (character)' },
  { value: 'species', label: '种族 (species)' },
  { value: 'rating', label: '分级 (rating)' },
  { value: 'origin', label: '来源 (origin)' },
  { value: 'content-official', label: '官方内容 (content-official)' },
  { value: 'content-fanmade', label: '同人内容 (content-fanmade)' },
  { value: 'error', label: '错误 (error)' },
];

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
  // 搜索框草稿：仅在回车时提交到 searchKeyword 才触发请求
  const [searchDraft, setSearchDraft] = useState('');
  const [sortMode, setSortMode] = useState('count_desc');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showUntranslatedOnly, setShowUntranslatedOnly] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editForm, setEditForm] = useState<TagEditForm>({
    id: 0,
    en: '',
    cn: '',
    aliases: '',
    cat: 'general',
    count: 0,
    description: '',
  });
  const [isInlineEditorClosing, setIsInlineEditorClosing] = useState(false);
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
  const [feedbackKeyword, setFeedbackKeyword] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState<'all' | 'pending' | 'processed' | 'rejected'>('pending');
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary>({
    pending: 0,
    processed: 0,
    rejected: 0,
  });
  const [feedbackPage, setFeedbackPage] = useState(1);
  const [feedbackTotalPages, setFeedbackTotalPages] = useState(1);
  // 正在处理的用户工单（处理并编辑标签时挂起，保存成功后自动标记为已处理）
  const [activeFeedbackWorkOrder, setActiveFeedbackWorkOrder] = useState<Feedback | null>(null);

  const [isDerpiModalOpen, setIsDerpiModalOpen] = useState(false);
  const [derpiSearchQuery, setDerpiSearchQuery] = useState('');
  const [derpiResults, setDerpiResults] = useState<DerpiTag[]>([]);
  const [isDerpiSearching, setIsDerpiSearching] = useState(false);

  const [stats, setStats] = useState<TagStats>({ total: 0, translated: 0, leaderboard: [] });

  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [historyTag, setHistoryTag] = useState<Tag | null>(null);
  const [historyRecords, setHistoryRecords] = useState<TagHistory[]>([]);
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(-1);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  /* One dialog for the whole app (`useConfirm`), not four pieces of state and a
     ref per tab. The signature is kept so the call sites read unchanged; what
     went away is the second copy of the Modal, its footer and its title/message
     state — five admin tabs had built the identical thing. */
  const { confirm, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();

  const showGlossaryConfirm = (title: string, message: string, action: () => void) => {
    void confirm({ title, message }).then((confirmed) => {
      if (confirmed) action();
    });
  };

  // 后端时间按 UTC 存储，转为 Asia/Shanghai 展示（精确到秒）
  const formatHistoryTime = (value?: string) => {
    if (!value) return '';
    const utc = new Date(String(value).replace(' ', 'T') + 'Z');
    if (Number.isNaN(utc.getTime())) return String(value);
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(utc)
      .reduce<Record<string, string>>((o, x) => {
        o[x.type] = x.value;
        return o;
      }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  };

  const formatAliases = (aliases?: string[] | string | null) => {
    if (!aliases) return '无';
    if (Array.isArray(aliases)) return aliases.length > 0 ? aliases.join('、') : '无';
    return String(aliases) || '无';
  };

  // 打开编辑历史弹窗并拉取该标签的历史记录
  const openTagHistory = async (tag: Tag) => {
    if (!token) return;

    setHistoryTag(tag);
    setHistoryRecords([]);
    setSelectedHistoryIndex(-1);
    setHistoryError(null);
    setIsHistoryModalOpen(true);
    setIsHistoryLoading(true);

    try {
      const data = await api.getDictionaryTagHistory(token, tag.id);
      if (data.success) {
        const list: TagHistory[] = data.history || [];
        setHistoryRecords(list);
        setSelectedHistoryIndex(list.length > 0 ? 0 : -1);
      } else {
        setHistoryError(data.error || '加载失败');
      }
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  /* Anchors the Derpibooru suggestion popover. */
  const enFieldRef = useRef<HTMLDivElement>(null);
  const refreshAfterInlineCloseRef = useRef(false);

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

  /* Outside-click dismissal is `Popover`'s. The listener that used to sit here
     only tested the panel, never the field, so typing in the input that owns the
     suggestions dismissed them on the first click. */

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

  const openInlineEditor = (tag: Tag) => {
    if (!isAdmin) {
      showToast('无权限', 'error');
      return;
    }

    setIsEditModalOpen(false);
    setEditingTag(tag);
    setIsInlineEditorClosing(false);
    setEditForm({
      id: tag.id,
      en: tag.en,
      cn: tag.cn === '未翻译' ? '' : [tag.cn, ...(tag.aliases || [])].join(','),
      aliases: tag.aliases?.join(',') || '',
      cat: tag.cat || 'general',
      count: tag.count || 0,
      description: tag.description || '',
    });
    setDerpiSuggestions([]);
    setShowSuggestions(false);
  };

  const openCreateModal = (tag?: DerpiTag) => {
    if (!isAdmin) {
      showToast('无权限', 'error');
      return;
    }

    setEditingTag(null);
    setIsInlineEditorClosing(false);
    setEditForm({
      id: 0,
      en: tag?.name || '',
      cn: '',
      aliases: '',
      cat: tag?.category || 'general',
      count: tag?.images || 0,
      description: '',
    });
    setIsEditModalOpen(true);
    setDerpiSuggestions([]);
    setShowSuggestions(false);
  };

  const closeCreateModal = () => {
    setTimeout(() => {
      setIsEditModalOpen(false);
    }, 200);
  };

  const closeInlineEditor = () => {
    if (!editingTag) return;
    setIsInlineEditorClosing(true);
  };

  const finishInlineEditorClose = () => {
    setEditingTag(null);
    setIsInlineEditorClosing(false);
    setDerpiSuggestions([]);
    setShowSuggestions(false);

    if (!refreshAfterInlineCloseRef.current) return;
    refreshAfterInlineCloseRef.current = false;
    if (isDuplicateMode) {
      loadDuplicates();
    } else {
      loadTags(currentPage);
    }
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
        // 若有挂起的用户工单，保存成功后自动标记为已处理（与 ciku.html 行为一致）
        if (activeFeedbackWorkOrder) {
          const workOrder = activeFeedbackWorkOrder;
          try {
            await api.handleTagFeedback(
              token,
              workOrder.id,
              'processed',
              '已采纳并写入词库',
              'pending',
            );
          } catch {
            showToast('标签已保存，但工单仍保持待处理', 'warning');
          }
          setActiveFeedbackWorkOrder(null);
        }
        if (id) {
          refreshAfterInlineCloseRef.current = true;
          closeInlineEditor();
        } else {
          closeCreateModal();
          if (isDuplicateMode) {
            loadDuplicates();
          } else {
            loadTags(currentPage);
          }
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
    openCreateModal(tag);
  };

  const loadFeedbacks = async (
    status: string = feedbackStatus,
    page: number = feedbackPage,
    keyword: string = feedbackKeyword,
  ) => {
    if (!token || !isAdmin) return;

    setIsLoadingFeedback(true);
    try {
      const data = await api.getTagFeedback(token, {
        status: status === 'all' ? undefined : status,
        keyword: keyword || undefined,
        page,
        limit: 40,
      });
      if (data.success) {
        setFeedbacks(data.feedbacks || []);
        setFeedbackSummary(data.summary || { pending: 0, processed: 0, rejected: 0 });
        const pg = data.pagination;
        if (pg) {
          setFeedbackTotalPages(pg.pages || 1);
          setFeedbackPage(pg.page || 1);
        }
      }
    } catch {
      showToast('加载反馈失败', 'error');
    } finally {
      setIsLoadingFeedback(false);
    }
  };

  // 打开弹窗时按当前筛选加载
  useEffect(() => {
    if (isFeedbackModalOpen) {
      queueMicrotask(() => {
        void loadFeedbacks();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开时按当前筛选加载一次
  }, [isFeedbackModalOpen]);

  // 直接处理工单状态（忽略 / 恢复待处理等，note 为处理备注）
  const handleFeedback = async (id: number, status: string, note?: string) => {
    if (!token) return;

    try {
      await api.handleTagFeedback(token, id, status, note || undefined, 'pending');
      void loadFeedbacks();
    } catch {
      showToast('操作失败', 'error');
    }
  };

  // 处理并编辑标签：挂起工单 → 关反馈弹窗 → 展开词库列表内对应词语的编辑行（找不到则新建）
  const handleFeedbackAndEdit = async (item: Feedback) => {
    if (!token) return;

    setActiveFeedbackWorkOrder(item);
    setIsFeedbackModalOpen(false);

    try {
      let target = visibleTags.find(
        (t) => t.en.toLowerCase() === (item.tag_name || '').toLowerCase(),
      );
      if (!target) {
        const data = await api.getDictionary(token, {
          keyword: item.tag_name,
          page: 1,
          limit: 100,
        });
        if (data.success && Array.isArray(data.tags)) {
          target = data.tags.find(
            (t: Tag) => t.en.toLowerCase() === (item.tag_name || '').toLowerCase(),
          );
        }
      }

      if (target) {
        // 确保目标行出现在列表首行（无论当前页/查重模式），随后展开该行
        setCurrentPage(1);
        setTags((prev) => [target, ...prev.filter((t) => t.id !== target.id)]);
        if (isDuplicateMode) {
          setDuplicateTags((prev) => [target, ...prev.filter((t) => t.id !== target.id)]);
        }
        openInlineEditor(target);
      } else {
        // 词库中不存在该标签，进入新增模式并预填英文名
        openCreateModal({ name: item.tag_name, category: 'general', images: 0 });
      }
    } catch {
      openCreateModal({ name: item.tag_name, category: 'general', images: 0 });
    }
  };

  // 把工单内容填入中文翻译框（保留已填内容时追加为别名）
  const useFeedbackAsTranslation = () => {
    const workOrder = activeFeedbackWorkOrder;
    if (!workOrder?.content) return;
    const content = workOrder.content.trim();
    setEditForm((prev) => ({
      ...prev,
      cn: prev.cn.trim() ? `${prev.cn.trim()},${content}` : content,
    }));
  };

  const changeFeedbackStatus = (status: 'all' | 'pending' | 'processed' | 'rejected') => {
    setFeedbackStatus(status);
    setFeedbackPage(1);
    void loadFeedbacks(status, 1);
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
  const selectedHistory =
    selectedHistoryIndex >= 0 ? historyRecords[selectedHistoryIndex] : null;

  // 正在处理的用户工单引用条（与 ciku.html 的 feedbackEditReference 等价）
  const renderFeedbackReference = () => {
    const workOrder = activeFeedbackWorkOrder;
    if (!workOrder) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-surface-container-low p-3">
        <div className="min-w-0 flex-1">
          <p className="text-label-l text-primary">
            正在处理用户工单 #{workOrder.id} · {workOrder.username || '游客'}
          </p>
          <p className="mt-0.5 break-words text-body-m text-on-surface-variant">
            {workOrder.content}
          </p>
        </div>
        <Button
          variant="tonal"
          size="sm"
          icon={<MdArrowDownward size={16} />}
          onClick={useFeedbackAsTranslation}
        >
          填入中文翻译框
        </Button>
      </div>
    );
  };

  const renderInlineEditor = (tag: Tag) => {
    if (editingTag?.id !== tag.id) return null;

    const enId = `glossary-inline-en-${tag.id}`;
    const cnId = `glossary-inline-cn-${tag.id}`;
    const categoryId = `glossary-inline-category-${tag.id}`;
    const descriptionId = `glossary-inline-description-${tag.id}`;

    return (
      <InlineEditorPanel
        id={`glossary-inline-editor-${tag.id}`}
        label={`编辑标签 ${tag.en}`}
        isClosing={isInlineEditorClosing}
        onExitComplete={finishInlineEditorClose}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <SectionHeading as="h3" className="mb-0" subtitle={tag.en}>
              编辑标签
            </SectionHeading>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tag.id > 0 && (
              <Button
                variant="text"
                size="sm"
                icon={<MdHistory size={16} />}
                onClick={() => openTagHistory(tag)}
                title="查看该标签的历史编辑记录"
                className="text-primary"
              >
                查看编辑历史
              </Button>
            )}
            <Button variant="text" size="sm" onClick={closeInlineEditor} disabled={isSaving}>
              取消
            </Button>
          </div>
        </div>

        {renderFeedbackReference()}

        <div className="popover-scrollbar overflow-x-auto">
          <table className="w-full border-collapse">
              <thead className="bg-surface-container-high">
                <tr>
                  <th
                    scope="col"
                    className="w-28 px-3 py-2 text-left text-label-l text-on-surface-variant sm:w-36"
                  >
                    字段
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-label-l text-on-surface-variant">
                    内容
                  </th>
                </tr>
              </thead>
              <tbody className="bg-surface-container-low">
                <tr>
                  <th scope="row" className="px-3 py-3 text-left align-top">
                    <label htmlFor={enId} className="text-label-l text-on-surface-variant">
                      英文原标签
                    </label>
                  </th>
                  <td className="min-w-48 px-3 py-3">
                    <Input id={enId} value={editForm.en} disabled className="font-mono" />
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-3 py-3 text-left align-top">
                    <label htmlFor={cnId} className="text-label-l text-on-surface-variant">
                      中文翻译
                    </label>
                    <span className="mt-1 block text-body-s text-on-surface-variant">英文逗号分隔别名</span>
                  </th>
                  <td className="min-w-48 px-3 py-3">
                    <Input
                      id={cnId}
                      value={editForm.cn}
                      onChange={(event) => setEditForm({ ...editForm, cn: event.target.value })}
                      placeholder="例如：紫悦,暮光闪闪,ts"
                    />
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-3 py-3 text-left align-top">
                    <span id={categoryId} className="text-label-l text-on-surface-variant">
                      分类
                    </span>
                  </th>
                  <td className="min-w-48 px-3 py-3">
                    <Select
                      value={editForm.cat}
                      onChange={(value) => setEditForm({ ...editForm, cat: value })}
                      className="w-full"
                      aria-label="标签分类"
                      options={TAG_CATEGORY_OPTIONS}
                    />
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-3 py-3 text-left align-top">
                    <label htmlFor={descriptionId} className="text-label-l text-on-surface-variant">
                      标签简介
                    </label>
                  </th>
                  <td className="min-w-48 px-3 py-3">
                    <Textarea
                      id={descriptionId}
                      value={editForm.description}
                      onChange={(event) =>
                        setEditForm({ ...editForm, description: event.target.value })
                      }
                      placeholder="例如：该角色首次登场于第X季..."
                      rows={3}
                      className="resize-none"
                    />
                  </td>
                </tr>
              </tbody>
          </table>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="text" onClick={closeInlineEditor} disabled={isSaving}>
            取消
          </Button>
          <Button variant="filled" onClick={saveTag} loading={isSaving}>
            保存
          </Button>
        </div>
      </InlineEditorPanel>
    );
  };

  /* Built here rather than at module scope: every cell closes over `isAdmin`,
     the selection set and the row handlers, and the header cell owns the
     select-all checkbox. */
  const tagColumns: Column<Tag>[] = [
    {
      key: 'select',
      // 列表布局无列网格：该列渲染为行首裸控件（无 label），全选 checkbox 由表头行渲染 header
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
          /* `Badge`, not an inline span with a container pair. Seven of these
             lived in this one file, in one shape but three type roles, and each
             one had to name both halves of its colour pair by hand. */
          <Badge tone="error" icon={<MdOutlineWarning size={14} />} className="whitespace-nowrap">
            未翻译
          </Badge>
        ) : (
          <div className="flex flex-wrap gap-1">
            <Badge tone="primary">{tag.cn}</Badge>
            {tag.aliases?.map((alias) => (
              <Badge key={alias}>{alias}</Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'en',
      header: '英文标签',
      render: (tag) => (
        <div className="flex flex-wrap items-center gap-2">
          <Badge colors={tagCategoryChip(tag.cat)}>{tag.cat}</Badge>
          <a
            href={`/search?q=${encodeURIComponent(tag.en)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-link flex items-center gap-1 font-mono text-body-m hover:underline rounded-xs outline-none focus-visible:ring-2 focus-ring"
          >
            {tag.en} <MdSearch size={14} />
          </a>
          {tag.count > 0 ? (
            <Badge colors="bg-accent-blue text-on-accent-blue">原站 ({tag.count}图)</Badge>
          ) : (
            <Badge>本地</Badge>
          )}
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
          <span className="text-on-surface-variant text-body-m">暂无简介</span>
        ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (tag) =>
        isAdmin ? (
          <>
            <Button
              type="button"
              variant="text"
              size="sm"
              icon={<MdEdit size={18} />}
              onClick={(event) => {
                if (editingTag?.id === tag.id && !isInlineEditorClosing) {
                  closeInlineEditor();
                  return;
                }
                captureInlineEditorLayout(event.currentTarget);
                openInlineEditor(tag);
              }}
              className="w-9 px-0 text-warning"
              title="编辑"
              aria-label={`编辑 ${tag.en}`}
              aria-expanded={editingTag?.id === tag.id && !isInlineEditorClosing}
              aria-controls={`glossary-inline-editor-${tag.id}`}
            />
            <Button
              type="button"
              variant="text"
              size="sm"
              icon={<MdDelete size={18} />}
              onClick={() => deleteTag(tag.id)}
              className="w-9 px-0 text-error"
              title="删除"
              aria-label={`删除 ${tag.en}`}
            />
          </>
        ) : (
          <span className="text-on-surface-variant text-body-m">无权限</span>
        ),
    },
  ];

  const translationPercentage =
    stats.total > 0 ? ((stats.translated / stats.total) * 100).toFixed(2) : '0.00';
  if (error && !tags.length) {
    return (
      <div className="text-center py-12">
        {' '}
        <p className="text-body-m text-on-surface-variant mb-4">{error}</p>{' '}
        <Button variant="filled" onClick={() => loadTags(1)}>
          {' '}
          重试{' '}
        </Button>{' '}
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
          <Button variant="filled" icon={<MdAdd size={18} />} onClick={() => openCreateModal()}>
            添加新标签
          </Button>
        )}{' '}
      </div>{' '}
      <div className="flex flex-col sm:flex-row gap-3">
        {' '}
        <Input
          type="text"
          icon={<MdSearch size={20} />}
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const kw = searchDraft.trim();
            setSearchKeyword(kw);
            // 与当前关键词相同时 useEffect 不会触发，显式刷新一次
            if (kw === searchKeyword) {
              void loadTags(1);
            }
          }}
          placeholder="搜索标签"
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
          <Chip
            variant="filter"
            tone="primary"
            size="md"
            selected={showUntranslatedOnly}
            onClick={() => setShowUntranslatedOnly(!showUntranslatedOnly)}
            icon={<MdTranslate size={16} />}
          >
            {showUntranslatedOnly ? '取消未翻译过滤' : '只看未翻译'}
          </Chip>{' '}
          {selectedIds.size > 0 && (
            <Button icon={<MdDelete size={16} />} variant="danger" size="sm" onClick={batchDelete}>
              批量删除 ({selectedIds.size})
            </Button>
          )}{' '}
          <Chip
            variant="filter"
            tone="primary"
            size="md"
            selected={isDuplicateMode}
            onClick={toggleDuplicateMode}
            icon={<MdContentCopy size={16} />}
          >
            {isDuplicateMode ? '退出查重' : '查重模式'}
          </Chip>{' '}
          <Button
            icon={<MdFeedback size={16} />}
            variant="accent"
            size="sm"
            onClick={() => setIsFeedbackModalOpen(true)}
          >
            用户反馈
          </Button>
          <Button
            icon={<MdFileDownload size={16} />}
            variant="accent"
            size="sm"
            onClick={exportCurrentPage}
          >
            导出当前页
          </Button>
          <Button
            icon={<MdFileUpload size={16} />}
            variant="accent"
            size="sm"
            onClick={() => setIsBatchModalOpen(true)}
          >
            批量导入
          </Button>
          <Button
            icon={<MdCloudDownload size={16} />}
            variant="accent"
            size="sm"
            onClick={() => setIsSyncModalOpen(true)}
          >
            同步热门
          </Button>
          <Button
            icon={<MdSearch size={16} />}
            variant="accent"
            size="sm"
            onClick={() => setIsDerpiModalOpen(true)}
          >
            搜原站标签
          </Button>
        </div>
      )}{' '}
      <DataTable<Tag>
        columns={tagColumns}
        rows={visibleTags}
        rowKey={(tag) => tag.id}
        expandedRow={renderInlineEditor}
        loading={isLoading}
        empty={
          isDuplicateMode ? (
            /* `EmptyState`, not a bespoke centred stack — same silhouette as
               every other "nothing here" in the app, and the only thing that
               differs is the glyph, which is the point of the `icon` slot. */
            <EmptyState
              size="inline"
              icon={<MdCheckCircle size={32} className="text-success" />}
              title="太棒了，当前词库没有发现重复英文标签！"
            />
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
      <div className="p-4 rounded-md">
        <div className="text-center mb-3">
          <span className="text-body-m text-on-surface-variant">
            词库翻译进度：已翻译 <strong className="text-primary">{stats.translated}</strong> /
            总标签 <strong>{stats.total}</strong> ({' '}
            <strong className="text-success">{translationPercentage}%</strong> )
          </span>
        </div>
        <div className="w-full h-3 bg-surface-container-highest rounded-full overflow-hidden">
          <div
            className="h-full bg-success-fill rounded-full transition-[width] duration-300 ease-[var(--ease-standard)]"
            style={{ width: `${translationPercentage}%` }}
          />
        </div>
      </div>
      {/* Modals */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={closeCreateModal}
        title="添加新标签"
        maxWidth="max-w-lg"
        footer={
          <>
            <Button variant="text" onClick={closeCreateModal}>
              取消
            </Button>
            <Button variant="filled" onClick={saveTag} loading={isSaving}>
              保存
            </Button>
          </>
        }
      >
        {' '}
        <div className="space-y-4">
          {' '}
          {renderFeedbackReference()}
          <div className="relative" ref={enFieldRef}>
            {' '}
            <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="glossarytab-f1">
              {' '}
              英文原标签{' '}
            </label>{' '}
            <Input
              id="glossarytab-f1"
              type="text"
              value={editForm.en}
              onChange={(e) => {
                setEditForm({ ...editForm, en: e.target.value });
                searchDerpiSuggestions(e.target.value);
              }}
              placeholder="例如：twilight sparkle"
              className="font-mono"
            />{' '}
            <Popover
              open={showSuggestions && derpiSuggestions.length > 0}
              onClose={() => setShowSuggestions(false)}
              anchorRef={enFieldRef}
              maxHeight={192}
              estimatedHeight={derpiSuggestions.length * 40}
            >
                {derpiSuggestions.map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => selectSuggestion(tag)}
                    className="w-full px-3 py-2 text-left state-layer flex items-center justify-between outline-none focus-visible:inset-ring-2 focus-visible:focus-ring-inset"
                  >
                    {' '}
                    <div className="flex items-center gap-2">
                      {' '}
                      <span
                        className={`w-2 h-2 rounded-full ${tagCategoryDot(tag.category)}`}
                      />{' '}
                      <span className="text-body-m text-on-surface font-mono">{tag.name}</span>{' '}
                    </div>{' '}
                    <span className="text-body-s text-on-surface-variant">{tag.images} 图</span>{' '}
                  </button>
                ))}{' '}
            </Popover>{' '}
          </div>{' '}
          <div>
            {' '}
            <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="glossarytab-f2">
              {' '}
              中文翻译 <span className="text-on-surface-variant">(多重翻译请用英文逗号 , 隔开)</span>{' '}
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
            <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="glossarytab-f3">
              分类
            </label>{' '}
            <Select
              value={editForm.cat}
              onChange={(v) => setEditForm({ ...editForm, cat: v })}
              className="w-full"
              options={TAG_CATEGORY_OPTIONS}
            />{' '}
          </div>{' '}
          <div>
            {' '}
            <Textarea
              id="glossarytab-f3"
              label="标签简介"
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
            <Button variant="text" onClick={() => setIsBatchModalOpen(false)}>
              {' '}
              取消{' '}
            </Button>{' '}
            <Button variant="tonal" onClick={executeBatchImport} loading={isBatchImporting}>
              开始导入
            </Button>{' '}
          </>
        }
      >
        {' '}
        <p className="text-body-m text-on-surface-variant mb-3">
          {' '}
          格式要求：
          <code className="bg-surface-container-high px-1 rounded-xs">
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
              <Button variant="text" onClick={() => setIsSyncModalOpen(false)}>
                {' '}
                取消{' '}
              </Button>
            )}{' '}
            <Button
              variant={isSyncing ? 'danger' : 'success'}
              onClick={isSyncing ? () => setIsSyncing(false) : executeSync}
            >
              {isSyncing ? '停止同步' : '开始同步'}
            </Button>{' '}
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
            <Button variant="filled" onClick={executeDerpiSearch} loading={isDerpiSearching}>
              搜索
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
                  className="state-layer flex items-center justify-between border-b border-outline-variant p-3 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <Badge colors={tagCategoryChip(tag.category)}>
                      {tag.category || 'general'}
                    </Badge>
                    <span className="font-mono text-body-m text-on-surface">{tag.name}</span>{' '}
                    <span className="text-body-s text-on-surface-variant">({tag.images} 图)</span>{' '}
                  </div>{' '}
                  <Button variant="success" size="xs" onClick={() => importFromDerpi(tag)}>
                    {' '}
                    + 导入{' '}
                  </Button>{' '}
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
        {/* 关键词搜索 */}
        <div className="mb-4">
          <Input
            type="text"
            value={feedbackKeyword}
            onChange={(e) => setFeedbackKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setFeedbackPage(1);
                void loadFeedbacks(feedbackStatus, 1, feedbackKeyword.trim());
              }
            }}
            icon={<MdSearch size={18} />}
            placeholder="搜索标签名或用户名，回车搜索"
          />
        </div>

        {/* 统计条 + 状态筛选 */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-body-s text-on-surface-variant">
            待处理 <strong className="text-warning">{feedbackSummary.pending}</strong>
          </span>
          <span className="text-body-s text-on-surface-variant">
            已采纳 <strong className="text-success">{feedbackSummary.processed}</strong>
          </span>
          <span className="text-body-s text-on-surface-variant">
            已忽略 <strong className="text-error">{feedbackSummary.rejected}</strong>
          </span>
          <div className="ml-auto flex flex-wrap gap-1">
            {(['all', 'pending', 'processed', 'rejected'] as const).map((s) => (
              <Chip
                key={s}
                variant="filter"
                tone="primary"
                selected={feedbackStatus === s}
                onClick={() => changeFeedbackStatus(s)}
              >
                {s === 'all' ? '全部' : s === 'pending' ? '待处理' : s === 'processed' ? '已采纳' : '已忽略'}
              </Chip>
            ))}
          </div>
        </div>

        <div className="popover-scrollbar max-h-[60vh] overflow-y-auto">
          {isLoadingFeedback ? (
            /* Feedback rows, in the shape they arrive in. A centred spinner
               collapsed the 60vh box to nothing and then snapped three cards
               back into it. */
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Card key={i} variant="filled" className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-2/5" delay={i * 90} />
                    <Skeleton className="h-5 w-14 rounded-full" delay={i * 90 + 40} />
                  </div>
                  <Skeleton className="h-4 w-24" delay={i * 90 + 80} />
                  <Skeleton className="h-9 w-full rounded-md" delay={i * 90 + 120} />
                </Card>
              ))}
            </div>
          ) : feedbacks.length === 0 ? (
            <EmptyState size="inline" title="暂无任何反馈申请" />
          ) : (
            <>
              <div className="space-y-3">
                {feedbacks.map((feedback) => (
                  <div key={feedback.id} className="p-4 rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-body-m text-on-surface-variant">
                        来自: {feedback.username} | {feedback.created_at}
                      </span>
                      <Badge
                        tone={
                          feedback.status === 'pending'
                            ? 'warning'
                            : feedback.status === 'processed'
                              ? 'success'
                              : 'error'
                        }
                      >
                        {feedback.status === 'pending'
                          ? '待处理'
                          : feedback.status === 'processed'
                            ? '已采纳'
                            : '已忽略'}
                      </Badge>
                    </div>
                    <div className="font-mono text-label-l-emphasized text-primary mb-2">
                      {feedback.tag_name}
                    </div>
                    <Card
                      variant="filled"
                      padding="sm"
                      className="text-body-m text-on-surface-variant mb-3"
                    >
                      {feedback.content}
                    </Card>
                    {/* 已处理信息 */}
                    {feedback.status !== 'pending' && (
                      <div className="text-body-s text-on-surface-variant mb-3">
                        已由 {feedback.handled_by_name || '管理员'} 处理
                        {feedback.handled_at ? ` · ${feedback.handled_at}` : ''}
                        {feedback.handling_note ? ` · 备注: ${feedback.handling_note}` : ''}
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      {feedback.status === 'pending' ? (
                        <>
                          <Button variant="filled" size="xs" onClick={() => handleFeedbackAndEdit(feedback)}>
                            处理并编辑标签
                          </Button>
                          <Button
                            variant="text"
                            size="xs"
                            onClick={() => {
                              /* The app's own dialog, not the browser's
                                 `prompt()` — a system box in the OS font,
                                 outside our scrim, type scale and focus trap. */
                              void prompt({
                                title: '忽略反馈',
                                label: '忽略原因',
                                message: '可留空。填写的内容会显示在处理记录里。',
                                placeholder: '例如：标签已在其他条目中修正',
                                confirmLabel: '忽略',
                              }).then((note) => {
                                if (note === null) return;
                                void handleFeedback(feedback.id, 'rejected', note);
                              });
                            }}
                          >
                            忽略
                          </Button>
                        </>
                      ) : (
                        <Button variant="text" size="xs" onClick={() => void handleFeedback(feedback.id, 'pending')}>
                          标记为未处理
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {feedbackTotalPages > 1 && (
                <Pagination
                  currentPage={feedbackPage}
                  totalPages={feedbackTotalPages}
                  onPageChange={(p) => {
                    setFeedbackPage(p);
                    void loadFeedbacks(feedbackStatus, p);
                  }}
                  className="mt-4"
                />
              )}
            </>
          )}
        </div>
      </Modal>
      {confirmDialog}
      {promptDialog}
      <Modal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        title={historyTag ? `编辑历史 · ${historyTag.en}` : '编辑历史'}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          {/* 历史记录列表（行样式与设置页面 m3-row 一致） */}
          <div className="popover-scrollbar max-h-56 overflow-y-auto rounded-md bg-surface">
            {isHistoryLoading ? (
              /* `m3-row` bars, the geometry the records land in — the rows are
                 siblings in a cut block, so the skeletons must be siblings too
                 or the header above them takes the "last row" corner radius
                 while the list is loading. */
              <>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="m3-row flex flex-col gap-2 bg-surface-container-low p-4">
                    <Skeleton className="h-4 w-1/2" delay={i * 80} />
                    <Skeleton className="h-3.5 w-1/3" delay={i * 80 + 60} />
                  </div>
                ))}
              </>
            ) : historyError ? (
              <ErrorRetry size="inline" title="历史记录加载失败" message={historyError} />
            ) : historyRecords.length === 0 ? (
              <EmptyState size="inline" title="暂无历史编辑记录" />
            ) : (
              historyRecords.map((h, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedHistoryIndex(i)}
                  className={`m3-row flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-3 p-4 text-left transition-ui sm:flex-nowrap sm:gap-x-4 outline-none focus-visible:inset-ring-2 focus-visible:focus-ring-inset ${
                    i === selectedHistoryIndex
                      ? 'bg-primary-container'
                      : 'bg-surface-container-low state-layer'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`mb-1 text-body-m ${
                        i === selectedHistoryIndex
                          ? 'text-on-primary-container'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      {h.editor_username || '未知用户'}
                    </p>
                    <p
                      className={`text-body-m-emphasized ${
                        i === selectedHistoryIndex
                          ? 'text-on-primary-container'
                          : 'text-on-surface'
                      }`}
                    >
                      {formatHistoryTime(h.created_at)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* 版本快照 */}
          <div className="min-h-24 rounded-md bg-surface-container-low p-4">
            {selectedHistory ? (
              <dl className="space-y-3 text-body-m">
                <div>
                  <dt className="text-label-l text-on-surface-variant">英文标签</dt>
                  <dd className="break-words font-mono text-on-surface">
                    {selectedHistory.en_name || '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-label-l text-on-surface-variant">中文翻译</dt>
                  <dd className="break-words text-on-surface">{selectedHistory.cn_name || '未翻译'}</dd>
                </div>
                <div>
                  <dt className="text-label-l text-on-surface-variant">别名</dt>
                  <dd className="break-words text-on-surface">{formatAliases(selectedHistory.aliases)}</dd>
                </div>
                <div className="flex flex-wrap gap-6">
                  <div>
                    <dt className="text-label-l text-on-surface-variant">分类</dt>
                    <dd className="mt-1">
                      <Badge colors={tagCategoryChip(selectedHistory.category || 'general')}>
                        {selectedHistory.category || 'general'}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-l text-on-surface-variant">数量</dt>
                    <dd className="text-on-surface">{selectedHistory.search_count ?? '-'}</dd>
                  </div>
                </div>
                <div>
                  <dt className="text-label-l text-on-surface-variant">简介</dt>
                  <dd className="whitespace-pre-wrap break-words text-on-surface-variant">
                    {selectedHistory.description || '无'}
                  </dd>
                </div>
                <div className="pt-1 text-body-s text-on-surface-variant">
                  编辑人：{selectedHistory.editor_username || '未知用户'}　时间：
                  {formatHistoryTime(selectedHistory.created_at)}
                </div>
              </dl>
            ) : (
              <p className="text-body-m text-on-surface-variant">请选择一条编辑记录查看快照</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
