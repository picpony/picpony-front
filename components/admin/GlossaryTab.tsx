'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  deleteDictionaryTag,
  getDictionary,
  getDictionaryDuplicates,
  getDictionaryTagHistory,
  saveDictionaryTag,
} from '@/lib/api/picpony';
import { getDerpiPopularTags, searchDerpiTags } from '@/lib/api/derpi';
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
import ProgressBar from '@/components/ProgressBar';
import Skeleton from '@/components/Skeleton';
import DataTable, { type Column } from '@/components/DataTable';
import Pagination from '@/components/Pagination';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { tagCategoryChip, tagCategoryDot } from '@/lib/tagCategories';
import Chip from '@/components/Chip';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { Input, Textarea } from '@/components/Input';
import { useConfirm, usePrompt } from '@/components/ConfirmDialog';
import InlineEditorPanel, { captureInlineEditorLayout } from '@/components/InlineEditorPanel';
import SectionHeading from '@/components/SectionHeading';
import Popover from '@/components/Popover';
import { ICON } from '@/lib/icons';
import { clamp } from '@/lib/utils';
import { readToken, useSession } from '@/lib/hooks';
import { LS_KEYS } from '@/lib/constants';
import { requireAdminSuccess } from '@/lib/adminMutations';
import { dictionaryTag, type DictionaryEntry } from '@/lib/resources';
import * as adminApi from '@/lib/api/admin';

interface Tag extends DictionaryEntry {
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

  const { user, token: sessionToken, ready } = useSession();
  const token = sessionToken ?? '';
  const isAdmin = ['super_admin', 'admin', 'editor'].includes(String(user?.role ?? 'user'));
  const [error, setError] = useState<string | null>(null);
  const [itemsPerPage, setItemsPerPage] = useState(100);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const alive = useRef(true);
  const lifetime = useRef(0);
  const requests = useRef<Record<string, number>>({});
  const bulkPending = useRef(false);
  const savePending = useRef(false);
  const syncRun = useRef(0);
  const feedbackPending = useRef(new Set<number>());
  const isActive = useCallback(() => alive.current && readToken() === token && Boolean(token), [token]);
  const beginRead = useCallback((kind: string) => {
    const request = (requests.current[kind] ?? 0) + 1;
    requests.current[kind] = request;
    const epoch = lifetime.current;
    return () => isActive() && lifetime.current === epoch && requests.current[kind] === request;
  }, [isActive]);
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => {
      if (!alive.current) return;
      try {
        const saved = Number(localStorage.getItem(LS_KEYS.itemsPerPage));
        if (Number.isSafeInteger(saved) && saved > 0) setItemsPerPage(clamp(saved, 1, 150));
      } catch { /* Local preferences are optional. */ }
      setPreferencesReady(true);
    });
    return () => { alive.current = false; lifetime.current += 1; syncRun.current += 1; };
  }, []);
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
  const [syncStopping, setSyncStopping] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, message: '' });

  const [isDuplicateMode, setIsDuplicateMode] = useState(false);
  const [duplicateTags, setDuplicateTags] = useState<Tag[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
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

  const { confirmThen, confirmDialog } = useConfirm();
  const { prompt, promptDialog } = usePrompt();

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
    if (!isActive()) return;
    const current = beginRead('history');

    setHistoryTag(tag);
    setHistoryRecords([]);
    setSelectedHistoryIndex(-1);
    setHistoryError(null);
    setIsHistoryModalOpen(true);
    setIsHistoryLoading(true);

    try {
      const data = await getDictionaryTagHistory(token, tag.id);
      if (!current()) return;
      if (data.success) {
        const list: TagHistory[] = data.history || [];
        setHistoryRecords(list);
        setSelectedHistoryIndex(list.length > 0 ? 0 : -1);
      } else {
        setHistoryError(data.error || '加载失败');
      }
    } catch (err) {
      if (current()) setHistoryError(err instanceof Error ? err.message : '网络错误，请稍后再试');
    } finally {
      if (current()) setIsHistoryLoading(false);
    }
  };

  /* Anchors the Derpibooru suggestion popover. */
  const enFieldRef = useRef<HTMLDivElement>(null);
  const refreshAfterInlineCloseRef = useRef(false);

  const loadTags = useCallback(
    async (page = 1) => {
      if (!isActive()) return;
      const current = beginRead('tags');

      setIsLoading(true);
      setError(null);

      try {
        const data = await getDictionary(token, {
          page,
          limit: itemsPerPage,
          keyword: searchKeyword,
          sort: sortMode,
          category: categoryFilter,
          untranslated: showUntranslatedOnly ? 1 : 0,
        });
        if (!current()) return;
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
        if (current()) setError(err instanceof Error ? err.message : '网络错误，请稍后再试');
      } finally {
        if (current()) setIsLoading(false);
      }
    },
    [token, itemsPerPage, searchKeyword, sortMode, categoryFilter, showUntranslatedOnly, isActive, beginRead],
  );

  /* Outside-click dismissal is `Popover`'s. */

  const loadDuplicates = useCallback(async () => {
    if (!isActive() || !isAdmin) return;
    const current = beginRead('tags');

    setIsLoading(true);
    try {
      const data = await getDictionaryDuplicates(token);
      if (!current()) return;
      if (data.success && data.tags) {
        setDuplicateTags(data.tags);
        setTotalMatches(data.tags.length);
      } else {
        setDuplicateTags([]);
        setTotalMatches(0);
      }
    } catch (err) {
      if (current()) showToast('查重失败：' + (err instanceof Error ? err.message : '未知错误'), 'error');
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [token, isAdmin, isActive, beginRead]);

  useEffect(() => {
    if (!ready || !preferencesReady) return;
    const requestState = requests.current;
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      if (!token) { setError('请先登录'); setIsLoading(false); return; }
      if (isDuplicateMode) void loadDuplicates();
      else void loadTags(1);
    });
    return () => { current = false; requestState.tags = (requestState.tags ?? 0) + 1; };
  }, [ready, preferencesReady, token, loadTags, loadDuplicates, isDuplicateMode]);

  const toggleDuplicateMode = () => {
    if (!isAdmin) {
      showToast('无权限', 'error');
      return;
    }

    const newMode = !isDuplicateMode;
    setIsDuplicateMode(newMode);
    setSelectedIds(new Set());

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
    if (!savePending.current) setIsEditModalOpen(false);
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
    const current = beginRead('suggestions');
    if (query.length < 2) {
      setDerpiSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const data = await searchDerpiTags(query);
      if (!current()) return;
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
    requests.current.suggestions = (requests.current.suggestions ?? 0) + 1;
    setEditForm((prev) => ({
      ...prev,
      en: tag.name,
      cat: tag.category || 'general',
      count: tag.images || 0,
    }));
    setShowSuggestions(false);
  };

  const saveTag = async () => {
    if (!isAdmin || !isActive() || savePending.current) return;

    const { en, cn, cat, count, description, id } = editForm;

    if (!en.trim()) {
      showToast('英文标签不能为空', 'error');
      return;
    }

    savePending.current = true;
    setIsSaving(true);

    try {
      if (!id) {
        const exists = await adminApi.checkTagExists(token, en);
        if (!isActive()) return;
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

      const res = await saveDictionaryTag(token, {
        id: id || undefined,
        en: en.trim(),
        cn: finalCn,
        aliases: finalAliases,
        cat,
        count,
        description: description.trim(),
      });

      await requireAdminSuccess(res, '保存失败');
      dictionaryTag.invalidate();
      if (!isActive()) return;

      showToast(id ? '已更新' : '已添加', 'success');
      // Saving a tag and closing its feedback work order are separate writes.
      if (activeFeedbackWorkOrder) {
        const workOrder = activeFeedbackWorkOrder;
        try {
          const feedbackResponse = await adminApi.handleTagFeedback(
            token,
            workOrder.id,
            'processed',
            '已采纳并写入词库',
            workOrder.status,
          );
          await requireAdminSuccess(feedbackResponse);
        } catch {
          if (isActive()) showToast('标签已保存，但工单仍保持待处理', 'warning');
        }
        if (!isActive()) return;
        setActiveFeedbackWorkOrder(null);
      }
      if (id) {
        refreshAfterInlineCloseRef.current = true;
        closeInlineEditor();
      } else {
        setIsEditModalOpen(false);
        if (isDuplicateMode) {
          loadDuplicates();
        } else {
          loadTags(currentPage);
        }
      }
    } catch (err) {
      if (isActive()) showToast(err instanceof Error ? err.message : '网络错误，请稍后再试', 'error');
    } finally {
      savePending.current = false;
      if (isActive()) setIsSaving(false);
    }
  };

  const deleteTag = async (id: number) => {
    if (!isAdmin || !isActive() || feedbackPending.current.has(id)) return;

    confirmThen('确认删除', '确定要永久删除此词条吗？', async () => {
      if (!isActive() || feedbackPending.current.has(id)) return;
      feedbackPending.current.add(id);
      try {
        const res = await deleteDictionaryTag(token, id);
        await requireAdminSuccess(res);
        dictionaryTag.invalidate();
        if (!isActive()) return;

        showToast('已删除', 'success');
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        if (isDuplicateMode) void loadDuplicates();
        else void loadTags(currentPage);
      } catch (err) {
        if (isActive()) showToast(err instanceof Error ? err.message : '网络错误，请稍后再试', 'error');
      } finally {
        feedbackPending.current.delete(id);
      }
    });
  };

  const batchDelete = async () => {
    if (!isAdmin || !isActive() || selectedIds.size === 0 || bulkPending.current) return;
    confirmThen('确认批量删除', `确定要永久删除选中的 ${selectedIds.size} 个标签吗？`, async () => {
      if (!isActive() || bulkPending.current) return;
      bulkPending.current = true;
      const current = beginRead('bulk');
      const removed = new Set<number>();
      let failed = 0;
      try {
        for (const id of selectedIds) {
          if (!current()) return;
          try {
            await requireAdminSuccess(await deleteDictionaryTag(token, id));
            removed.add(id);
            if (!current()) return;
          } catch {
            if (!current()) return;
            failed++;
          }
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        if (!current()) return;
        setSelectedIds((previous) => new Set([...previous].filter((id) => !removed.has(id))));
        showToast(`批量删除完成：${removed.size} 成功，${failed} 失败`, failed ? 'warning' : 'success');
        if (isDuplicateMode) void loadDuplicates();
        else void loadTags(currentPage);
      } finally {
        // One invalidation per batch also clears cached "not found" lookups.
        if (removed.size) dictionaryTag.invalidate();
        bulkPending.current = false;
      }
    });
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
    if (!isAdmin || !isActive() || bulkPending.current) return;

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

      const splitAt = trimmedLine.indexOf('=');
      const en = trimmedLine.slice(0, splitAt).trim().toLowerCase();
      const cnRaw = trimmedLine.slice(splitAt + 1).trim();

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

    confirmThen('确认批量导入', `确定要导入这 ${tasks.length} 个标签吗？`, async () => {
      if (!isActive() || bulkPending.current) return;
      bulkPending.current = true;
      const current = beginRead('bulk');
      setIsBatchImporting(true);
      let success = 0;
      let failed = 0;
      let skipped = 0;
      try {
        for (const task of tasks) {
          if (!current()) return;
          try {
            const exists = await adminApi.checkTagExists(token, task.en);
            if (!current()) return;
            if (exists) { skipped++; continue; }
            await requireAdminSuccess(await saveDictionaryTag(token, task));
            success++;
            if (!current()) return;
          } catch {
            if (!current()) return;
            failed++;
          }
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        if (!current()) return;
        showToast(`批量导入完成：${success} 成功，${skipped} 跳过，${failed} 失败`, failed ? 'warning' : 'success');
        if (!failed) { setIsBatchModalOpen(false); setBatchInput(''); }
        void loadTags(1);
      } finally {
        if (success) dictionaryTag.invalidate();
        bulkPending.current = false;
        if (isActive()) setIsBatchImporting(false);
      }
    });
  };

  const executeSync = async () => {
    if (!isAdmin || !isActive() || bulkPending.current) return;
    if (!Number.isSafeInteger(syncStartPage) || !Number.isSafeInteger(syncEndPage) ||
      syncStartPage < 1 || syncEndPage < syncStartPage) {
      showToast('起止页必须是正整数，且结束页不能小于起始页', 'error');
      return;
    }
    const totalPagesToFetch = syncEndPage - syncStartPage + 1;
    if (totalPagesToFetch > 100) {
      showToast('一次最多允许拉取 100 页', 'error');
      return;
    }
    bulkPending.current = true;
    const run = ++syncRun.current;
    const scopeCurrent = beginRead('bulk');
    const current = () => scopeCurrent() && syncRun.current === run;
    setIsSyncing(true);
    setSyncStopping(false);
    setSyncProgress({ current: 0, total: totalPagesToFetch, message: '开始同步…' });
    let added = 0;
    let skipped = 0;
    let failedTags = 0;
    let failedPages = 0;
    try {
      for (let page = syncStartPage; page <= syncEndPage && current(); page++) {
        setSyncProgress({ current: page - syncStartPage + 1, total: totalPagesToFetch, message: `正在拉取第 ${page} 页…` });
        try {
          const data = await getDerpiPopularTags(page);
          if (!current()) break;
          if (!Array.isArray(data.tags)) throw new Error('原站标签响应无效');
          if (!data.tags.length) break;
          for (const tag of data.tags) {
            if (!current()) break;
            try {
              const exists = await adminApi.checkTagExists(token, tag.name);
              if (!current()) break;
              if (exists) { skipped++; continue; }
              await requireAdminSuccess(await saveDictionaryTag(token, {
                en: tag.name, cn: '未翻译', aliases: [], cat: tag.category || 'general',
                count: tag.images || 0, description: '',
              }));
              added++;
              if (!scopeCurrent()) break;
              if (!current()) break;
            } catch {
              if (!scopeCurrent()) break;
              failedTags++;
              if (!current()) break;
            }
            await new Promise((resolve) => setTimeout(resolve, 40));
          }
        } catch {
          if (!current()) break;
          failedPages++;
        }
        if (page < syncEndPage && current()) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const stopped = syncRun.current !== run;
      if (!isActive()) return;
      showToast(`${stopped ? '同步已停止' : '同步完成'}：${added} 新增，${skipped} 跳过，${failedTags} 标签失败，${failedPages} 页面失败`, stopped || failedTags || failedPages ? 'warning' : 'success');
      if (!stopped && !failedTags && !failedPages) setIsSyncModalOpen(false);
      void loadTags(1);
    } finally {
      if (added) dictionaryTag.invalidate();
      bulkPending.current = false;
      if (isActive()) { setIsSyncing(false); setSyncStopping(false); }
    }
  };

  const stopSync = () => {
    syncRun.current += 1;
    setSyncStopping(true);
  };

  const executeDerpiSearch = async () => {
    if (!derpiSearchQuery.trim()) return;

    setIsDerpiSearching(true);
    try {
      const data = await searchDerpiTags(derpiSearchQuery);
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
    if (!isActive() || !isAdmin) return;
    const current = beginRead('feedbacks');
    setIsLoadingFeedback(true);
    setFeedbackError(null);
    try {
      const data = await adminApi.getTagFeedback(token, {
        status: status === 'all' ? undefined : status,
        keyword: keyword || undefined,
        page,
        limit: 40,
      });
      if (!current()) return;
      if (data.success) {
        setFeedbacks(data.feedbacks || []);
        setFeedbackSummary(data.summary || { pending: 0, processed: 0, rejected: 0 });
        const pg = data.pagination;
        if (pg) {
          setFeedbackTotalPages(pg.pages || 1);
          setFeedbackPage(pg.page || 1);
        }
      } else {
        setFeedbackError(data.error || data.message || '反馈加载失败');
      }
    } catch {
      if (current()) setFeedbackError('反馈加载失败');
    } finally {
      if (current()) setIsLoadingFeedback(false);
    }
  };

  // 打开弹窗时按当前筛选加载
  useEffect(() => {
    let current = true;
    const requestState = requests.current;
    if (isFeedbackModalOpen) {
      queueMicrotask(() => {
        if (current) void loadFeedbacks();
      });
    }
    return () => { current = false; requestState.feedbacks = (requestState.feedbacks ?? 0) + 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 打开时按当前筛选加载一次
  }, [isFeedbackModalOpen]);

  // 直接处理工单状态（忽略 / 恢复待处理等，note 为处理备注）
  const handleFeedback = async (id: number, status: string, note?: string, expectedStatus = 'pending') => {
    if (!isActive() || feedbackPending.current.has(id)) return;
    feedbackPending.current.add(id);
    try {
      await requireAdminSuccess(await adminApi.handleTagFeedback(token, id, status, note || undefined, expectedStatus));
      if (isActive()) void loadFeedbacks();
    } catch (err) {
      if (isActive()) showToast(err instanceof Error ? err.message : '操作失败', 'error');
    } finally {
      feedbackPending.current.delete(id);
    }
  };

  // 处理并编辑标签：挂起工单 → 关反馈弹窗 → 展开词库列表内对应词语的编辑行（找不到则新建）
  const handleFeedbackAndEdit = async (item: Feedback) => {
    if (!isActive()) return;
    const current = beginRead('feedback-edit');

    setActiveFeedbackWorkOrder(item);
    setIsFeedbackModalOpen(false);

    try {
      let target = visibleTags.find(
        (t) => t.en.toLowerCase() === (item.tag_name || '').toLowerCase(),
      );
      if (!target) {
        const data = await getDictionary(token, {
          keyword: item.tag_name,
          page: 1,
          limit: 100,
        });
        if (!current()) return;
        if (!data.success) throw new Error(data.error || '标签查询失败');
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
      if (!current()) return;
      setActiveFeedbackWorkOrder(null);
      setIsFeedbackModalOpen(true);
      showToast('标签查询失败，请重试处理此工单', 'error');
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
          <p className="text-label-l text-primary-ink">
            正在处理用户工单 #{workOrder.id} · {workOrder.username || '游客'}
          </p>
          <p className="mt-0.5 break-words text-body-m text-on-surface-variant">
            {workOrder.content}
          </p>
        </div>
        <Button
          variant="tonal"
          size="xs"
          icon={<MdArrowDownward />}
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
                size="xs"
                icon={<MdHistory />}
                onClick={() => openTagHistory(tag)}
                title="查看该标签的历史编辑记录"
                className="text-primary-ink"
              >
                查看编辑历史
              </Button>
            )}
            <Button variant="text" size="xs" onClick={closeInlineEditor} disabled={isSaving}>
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
                      placeholder="例如：该角色首次登场于第X季…"
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
          /* `Badge`, not an inline span with a container pair — one shape, one
             owner for the colour pair. */
          <Badge tone="error" icon={<MdOutlineWarning />} className="whitespace-nowrap">
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
            className="prose-link flex items-center gap-1 font-mono text-body-m focus-visible:ring-2 focus-ring"
          >
            {tag.en} <MdSearch size={ICON.dense} />
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
            {/* `IconButton`, not an icon-only `<Button>` with `w-9 px-0` forcing a
                36px box — a retired figure — around a 32dp `xs` button. See
                `UsersTab`, which had the same three. */}
            <IconButton
              type="button"
              size="sm"
              icon={<MdEdit />}
              onClick={(event) => {
                if (editingTag?.id === tag.id && !isInlineEditorClosing) {
                  closeInlineEditor();
                  return;
                }
                captureInlineEditorLayout(event.currentTarget);
                openInlineEditor(tag);
              }}
              className="text-warning"
              aria-label={`编辑标签 ${tag.en}`}
              aria-expanded={editingTag?.id === tag.id && !isInlineEditorClosing}
              aria-controls={`glossary-inline-editor-${tag.id}`}
            />
            <IconButton
              type="button"
              size="sm"
              icon={<MdDelete />}
              onClick={() => deleteTag(tag.id)}
              className="text-error"
              aria-label={`删除标签 ${tag.en}`}
            />
          </>
        ) : (
          <span className="text-on-surface-variant text-body-m">无权限</span>
        ),
    },
  ];

  const translationPercentage =
    stats.total > 0 ? ((stats.translated / stats.total) * 100).toFixed(2) : '0.00';
  if (!ready || !preferencesReady) {
    return <div className="space-y-3"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>;
  }
  if (error && !tags.length) {
    return (
      <ErrorRetry title="词库加载失败" message={error} onRetry={() => void loadTags(1)} />
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        
        <SectionHeading
          className="mb-0"
          icon={<MdLibraryBooks size={ICON.standard} />}
          aside={`${totalMatches} 条`}
        >
          中英标签词库管理
        </SectionHeading>
        {isAdmin && (
          <Button variant="filled" icon={<MdAdd />} onClick={() => openCreateModal()}>
            添加新标签
          </Button>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        
        <Input
          type="text"
          icon={<MdSearch size={ICON.control} />}
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
        {/* Both of these are `size="sm"`, matching the `SearchInput` they sit beside:
            this is a filter bar, so 40dp is the step and the field's 56 is not. */}
        <Select
          size="sm"
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
          size="sm"
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
        />
      </div>{' '}
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          
          <Chip
            variant="filter"
            tone="primary"
            selected={showUntranslatedOnly}
            onClick={() => setShowUntranslatedOnly(!showUntranslatedOnly)}
            icon={<MdTranslate size={ICON.dense} />}
          >
            {showUntranslatedOnly ? '取消未翻译过滤' : '只看未翻译'}
          </Chip>
          {selectedIds.size > 0 && (
            <Button icon={<MdDelete />} variant="danger" size="xs" onClick={batchDelete}>
              批量删除 ({selectedIds.size})
            </Button>
          )}
          <Chip
            variant="filter"
            tone="primary"
            selected={isDuplicateMode}
            onClick={toggleDuplicateMode}
            icon={<MdContentCopy size={ICON.dense} />}
          >
            {isDuplicateMode ? '退出查重' : '查重模式'}
          </Chip>
          <Button
            icon={<MdFeedback />}
            variant="accent"
            size="xs"
            onClick={() => setIsFeedbackModalOpen(true)}
          >
            用户反馈
          </Button>
          <Button
            icon={<MdFileDownload />}
            variant="accent"
            size="xs"
            onClick={exportCurrentPage}
          >
            导出当前页
          </Button>
          <Button
            icon={<MdFileUpload />}
            variant="accent"
            size="xs"
            onClick={() => setIsBatchModalOpen(true)}
          >
            批量导入
          </Button>
          <Button
            icon={<MdCloudDownload />}
            variant="accent"
            size="xs"
            onClick={() => setIsSyncModalOpen(true)}
          >
            同步热门
          </Button>
          <Button
            icon={<MdSearch />}
            variant="accent"
            size="xs"
            onClick={() => setIsDerpiModalOpen(true)}
          >
            搜原站标签
          </Button>
        </div>
      )}{' '}
      {/* Wrapped only to carry the anchor, and it has to reach *past* the table: the pager
          is a sibling of it and `Pagination` looks for the anchor with `closest()`, so a
          wrapper around the table alone is one the pager cannot see — and a page turn then
          scrolls the whole admin console to the top. */}
      <div data-pagination-anchor>
        <DataTable<Tag>
          columns={tagColumns}
          rows={visibleTags}
          rowKey={(tag) => tag.id}
          expandedRow={renderInlineEditor}
          loading={isLoading}
          /* The resolved page size, so the placeholder is the right *length*. */
          skeletonRows={Math.min(itemsPerPage, 20)}
          empty={
            isDuplicateMode ? (
              /* `EmptyState`, not a bespoke centred stack — same silhouette as
                 every other "nothing here" in the app. */
              <EmptyState
                size="inline"
                icon={<MdCheckCircle size={ICON.large} className="text-success" />}
                title="太棒了，当前词库没有发现重复英文标签！"
              />
            ) : (
              '未找到匹配的标签记录'
            )
          }
        />
        {/* `mt-6` because this row used to be a direct child of the `space-y-6` above and took
            its 24px gap from it; inside the anchor it has to carry its own. */}
        {!isDuplicateMode && (
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-body-m text-on-surface-variant">每页：</span>
              <Input
                type="number"
                aria-label="每页词条数"
                min={1}
                max={150}
                value={itemsPerPage}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 100;
                  const clamped = clamp(val, 1, 150);
                  setItemsPerPage(clamped);
                  try { localStorage.setItem(LS_KEYS.itemsPerPage, clamped.toString()); } catch { /* Optional preference. */ }
                }}
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
      </div>
      <div className="p-4 rounded-md">
        <div className="text-center mb-3">
          <span className="text-body-m text-on-surface-variant">
            词库翻译进度：已翻译 <strong className="text-primary-ink">{stats.translated}</strong> /
            总标签 <strong>{stats.total}</strong> ({' '}
            <strong className="text-success">{translationPercentage}%</strong> )
          </span>
        </div>
        <ProgressBar
          value={Number(translationPercentage)}
          tone="success"
          label="词库翻译进度"
        />
      </div>
      {/* Modals */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={closeCreateModal}
        title="添加新标签"
        maxWidth="lg"
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
        <div className="space-y-4">
          {renderFeedbackReference()}
          <div className="relative" ref={enFieldRef}>
            <Input
              label="英文原标签"
              id="glossarytab-f1"
              type="text"
              value={editForm.en}
              onChange={(e) => {
                setEditForm({ ...editForm, en: e.target.value });
                searchDerpiSuggestions(e.target.value);
              }}
              placeholder="例如：twilight sparkle"
              className="font-mono"
            />
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
                    
                    <div className="flex items-center gap-2">
                      
                      <span
                        className={`w-2 h-2 rounded-full ${tagCategoryDot(tag.category)}`}
                      />
                      <span className="text-body-m text-on-surface font-mono">{tag.name}</span>
                    </div>
                    <span className="text-body-s text-on-surface-variant">{tag.images} 图</span>
                  </button>
                ))}{' '}
            </Popover>
          </div>
          <div>
            <Input
              label="中文翻译"
              helper="多个翻译请用英文逗号隔开"
              id="glossarytab-f2"
              type="text"
              value={editForm.cn}
              onChange={(e) => setEditForm({ ...editForm, cn: e.target.value })}
              placeholder="例如：紫悦,暮光闪闪,ts"
            />
          </div>
          <div>
            {/* `aria-label` on the `Select`, not a `<label htmlFor>`. A `Select`
                renders a `<button role="combobox">`, which `htmlFor` cannot label —
                and the id this pointed at (`glossarytab-f3`) is the description
                textarea below, so the label named *that* field, the combobox had no
                accessible name, and the textarea ended up with two. */}
            <p className="block text-label-l text-on-surface-variant mb-1">分类</p>
            <Select
              value={editForm.cat}
              onChange={(v) => setEditForm({ ...editForm, cat: v })}
              className="w-full"
              options={TAG_CATEGORY_OPTIONS}
              aria-label="分类"
            />
          </div>
          <div>
            <Textarea
              id="glossarytab-f3"
              label="标签简介"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              placeholder="例如：该角色首次登场于第X季…"
              rows={3}
              className="resize-none"
            />
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={isBatchModalOpen}
        onClose={() => !isBatchImporting && setIsBatchModalOpen(false)}
        title="批量导入标签"
        maxWidth="xl"
        footer={
          <>
            <Button variant="text" onClick={() => setIsBatchModalOpen(false)}>
              取消
            </Button>
            <Button variant="tonal" onClick={executeBatchImport} loading={isBatchImporting}>
              开始导入
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant mb-3">
          格式要求：
          <code className="bg-surface-container-high px-1 rounded-xs">
            英文标签 = 主中文名, 别名1, 别名2
          </code>
        </p>
        <Textarea
          value={batchInput}
          onChange={(e) => setBatchInput(e.target.value)}
          placeholder="例如：&#10;twilight sparkle = 紫悦, 暮光闪闪, ts"
          rows={12}
          className="font-mono resize-none"
        />
      </Modal>
      <Modal
        isOpen={isSyncModalOpen}
        onClose={() => !isSyncing && setIsSyncModalOpen(false)}
        title="拉取原站热门标签"
        maxWidth="md"
        hideCloseButton={isSyncing}
        footer={
          <>
            {!isSyncing && (
              <Button variant="text" onClick={() => setIsSyncModalOpen(false)}>
                取消
              </Button>
            )}
            <Button
              variant={isSyncing ? 'danger' : 'success'}
              onClick={isSyncing ? stopSync : executeSync}
              disabled={syncStopping}
            >
              {syncStopping ? '正在停止…' : isSyncing ? '停止同步' : '开始同步'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-body-m text-on-surface-variant">
            系统将按原站<strong>图片总数</strong>从高到低自动拉取标签。 <br />
            <span className="text-error">新拉取的标签会被标记为【未翻译】</span>
          </p>{' '}
          {isSyncing ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-body-m">
                <span className="text-on-surface-variant">{syncProgress.message}</span>
                <span className="text-primary-ink">
                  {syncProgress.current} / {syncProgress.total}
                </span>
              </div>
              <ProgressBar
                value={
                  syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0
                }
                tone="success"
                label="词库同步进度"
              />
            </div>
          ) : (
            <div className="flex items-center gap-4">
              
              <div className="flex-1">
                
                <Input
                  label="起始页"
                  id="glossarytab-f4"
                  type="number"
                  min={1}
                  value={syncStartPage}
                  onChange={(e) => setSyncStartPage(Number(e.target.value))}
                />
              </div>
              <div className="flex-1">
                
                <Input
                  label="结束页"
                  id="glossarytab-f5"
                  type="number"
                  min={1}
                  value={syncEndPage}
                  onChange={(e) => setSyncEndPage(Number(e.target.value))}
                />
              </div>
            </div>
          )}{' '}
        </div>
      </Modal>
      <Modal
        isOpen={isDerpiModalOpen}
        onClose={() => setIsDerpiModalOpen(false)}
        title="搜索 Trixiebooru 原站标签"
        maxWidth="lg"
      >
        <div className="space-y-4">
          <div className="flex gap-2">
            
            <Input
              type="text"
              value={derpiSearchQuery}
              onChange={(e) => setDerpiSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && executeDerpiSearch()}
              placeholder="输入英文标签名…"
              fieldClassName="flex-1"
            />
            <Button variant="filled" onClick={executeDerpiSearch} loading={isDerpiSearching}>
              搜索
            </Button>
          </div>
          <div className="popover-scrollbar max-h-72 overflow-y-auto border border-outline-variant rounded-md">
            {derpiResults.length === 0 ? (
              <div className="p-8 text-center text-on-surface-variant">
                {isDerpiSearching ? '搜索中…' : '搜索结果将显示在这里'}
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
                    <span className="font-mono text-body-m text-on-surface">{tag.name}</span>
                    <span className="text-body-s text-on-surface-variant">({tag.images} 图)</span>
                  </div>
                  <Button variant="success" size="xs" onClick={() => importFromDerpi(tag)}>
                    + 导入
                  </Button>
                </div>
              ))
            )}{' '}
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={isFeedbackModalOpen}
        onClose={() => setIsFeedbackModalOpen(false)}
        title="用户反馈与翻译申请"
        maxWidth="xl"
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
            icon={<MdSearch size={ICON.dense} />}
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

        {/* This is the scroller for the list below, not `Modal`'s body — so it carries the
            marker `Pagination` looks for. Without it, `closest()` found the dialog's body
            instead and a page turn scrolled a box that was not the one moving. */}
        <div
          data-app-scroll-container
          className="popover-scrollbar max-h-[60vh] overflow-y-auto"
        >
          {isLoadingFeedback ? (
            /* Feedback rows, in the shape they arrive in: a centred spinner
               collapsed the box to nothing and then snapped the cards back. */
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
          ) : feedbackError ? (
            <ErrorRetry size="inline" title={feedbackError} onRetry={() => { void loadFeedbacks(); }} />
          ) : feedbacks.length === 0 ? (
            <EmptyState size="inline" title="暂无任何反馈申请" />
          ) : (
            <div data-pagination-anchor>
              <div className="space-y-3">
                {feedbacks.map((feedback) => (
                  <div key={feedback.id} className="p-4 rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-body-m text-on-surface-variant">
                        来自：{feedback.username} | {feedback.created_at}
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
                    <div className="font-mono text-label-l-emphasized text-primary-ink mb-2">
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
                        {feedback.handling_note ? ` · 备注：${feedback.handling_note}` : ''}
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
                                 `prompt()` — a system box outside our scrim,
                                 type scale and focus trap. */
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
                        <Button variant="text" size="xs" onClick={() => void handleFeedback(feedback.id, 'pending', undefined, feedback.status)}>
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
            </div>
          )}
        </div>
      </Modal>
      {confirmDialog}
      {promptDialog}
      <Modal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        title={historyTag ? `编辑历史 · ${historyTag.en}` : '编辑历史'}
        maxWidth="2xl"
      >
        <div className="space-y-4">
          {/* 历史记录列表（行样式与设置页面 m3-row 一致） */}
          <div className="popover-scrollbar max-h-56 overflow-y-auto rounded-md bg-surface">
            {isHistoryLoading ? (
              /* `m3-row` bars, the geometry the records land in — the rows are
                 siblings in a cut block, so the skeletons must be siblings too
                 or the header above them takes the corner radius while the list
                 is loading. */
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
                      ? 'bg-secondary-container'
                      : 'bg-surface-container-low state-layer'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`mb-1 text-body-m ${
                        i === selectedHistoryIndex
                          ? 'text-on-secondary-container'
                          : 'text-on-surface-variant'
                      }`}
                    >
                      {h.editor_username || '未知用户'}
                    </p>
                    <p
                      className={`text-body-m-emphasized ${
                        i === selectedHistoryIndex
                          ? 'text-on-secondary-container'
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
