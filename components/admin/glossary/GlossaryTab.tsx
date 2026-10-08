'use client';

import { useCallback, useRef, useState } from 'react';
import {
  MdAdd,
  MdArrowDropDown,
  MdCloudDownload,
  MdContentCopy,
  MdDeleteOutline,
  MdEdit,
  MdFeedback,
  MdFileDownload,
  MdFileUpload,
  MdSearch,
  MdTranslate,
} from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Checkbox from '@/components/Checkbox';
import Chip from '@/components/Chip';
import DataTable, { type Column } from '@/components/DataTable';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import IconButton from '@/components/IconButton';
import { captureInlineEditorLayout } from '@/components/InlineEditorPanel';
import Menu from '@/components/Menu';
import Pagination from '@/components/Pagination';
import ProgressBar from '@/components/ProgressBar';
import SearchInput from '@/components/SearchInput';
import SectionHeading from '@/components/SectionHeading';
import Select from '@/components/Select';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { SKIP, useResource } from '@/lib/resource';
import { tagEntry } from '@/lib/resources';
import { readToken } from '@/lib/hooks';
import { LS_KEYS } from '@/lib/constants';
import { requireAdminSuccess } from '@/lib/adminMutations';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { deleteDictionaryTag, saveDictionaryTag, type DictionaryStats } from '@/lib/api/picpony';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { tagCategoryChip } from '@/lib/tagCategories';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from '../SectionHeader';
import { useAdminMutation } from '../useAdminMutation';
import { useSettled } from '../useSettled';
import { AdminPager, usePagedRows, useShownListKey } from '../paging';
import { tableError } from '../queries';
import type { AdminPanelProps } from '../registry';
import {
  CATEGORY_FILTERS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  SORTS,
  exportText,
  isUntranslated,
  pageSizeOf,
  reportedCount,
  sameTag,
  savedTag,
  tagSavePayload,
  translatedShare,
  type DerpiTagRow,
  type GlossaryTag,
  type ImportTask,
  type TagForm,
} from './model';
import { dictionaryPage, duplicateTags, tagFeedback, type DictionaryArgs, type Feedback } from './resources';
import TagEditor, { tagEditorId } from './TagEditor';
import CreateTagDialog from './CreateTagDialog';
import BatchImportDialog from './BatchImportDialog';
import SyncDialog, { type SyncResult } from './SyncDialog';
import DerpiSearchDialog from './DerpiSearchDialog';
import FeedbackDialog from './FeedbackDialog';
import HistoryDialog from './HistoryDialog';

const EMPTY: GlossaryTag[] = [];
type SaveBody = Parameters<typeof saveDictionaryTag>[1];

const PAGE_SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ value: String(size), label: `每页 ${size} 条` }));

const TOOLS = [
  { value: 'derpi', label: '搜原站标签', icon: <MdSearch size={ICON.standard} /> },
  { value: 'import', label: '批量导入', icon: <MdFileUpload size={ICON.standard} /> },
  { value: 'sync', label: '同步原站热门标签', icon: <MdCloudDownload size={ICON.standard} /> },
  { value: 'export', label: '导出当前页', icon: <MdFileDownload size={ICON.standard} /> },
];

function storedPageSize(): number {
  try {
    return pageSizeOf(localStorage.getItem(LS_KEYS.itemsPerPage));
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

function without(set: ReadonlySet<number>, ids: Iterable<number>): Set<number> {
  const next = new Set(set);
  for (const id of ids) next.delete(id);
  return next;
}

/**
 * 词库编辑 — the dictionary of English tags and their Chinese names.
 *
 * One panel built from parts (`components/admin/glossary/*`): the list reads through the
 * resource layer (paged, the previous page held during a turn, failures said in place), an entry
 * is edited under its row, a new one in 添加新标签 with Derpibooru's tags as a combobox, and the
 * batch jobs are each one request a page. The toolbar is three groups — filters, the selection's
 * one action, and a 工具 menu — where it was seven controls in one wrapping row (R9-036).
 */
export default function GlossaryTab({ token }: AdminPanelProps) {
  // ---- What is shown ----
  const [search, setSearch] = useState('');
  const keyword = useSettled(search.trim(), search.trim() ? 400 : 0);
  const [sort, setSort] = useState('count_desc');
  const [category, setCategory] = useState('all');
  const [untranslated, setUntranslated] = useState(false);
  const [duplicates, setDuplicates] = useState(false);
  const [perPage, setPerPage] = useState(storedPageSize);
  const [page, setPage] = useState({ page: 1, scope: '' });
  const scope = [keyword, sort, category, untranslated ? 1 : 0, perPage].join('\n');
  const currentPage = page.scope === scope ? page.page : 1;
  const args: DictionaryArgs = { token, page: currentPage, limit: perPage, keyword, sort, category, untranslated };
  const list = useResource(dictionaryPage, !duplicates && token ? args : SKIP, { keepPrevious: `${token}\n${scope}` });
  const dupes = useResource(duplicateTags, duplicates && token ? token : SKIP);
  const read = duplicates ? dupes : list;
  const duplicatePage = usePagedRows(dupes.data ?? EMPTY, token, perPage);
  const rows = (duplicates ? duplicatePage.rows : list.data?.tags) ?? EMPTY;
  const pageKey = useShownListKey(`${scope}
${currentPage}`, list.isPrevious);
  const listKey = duplicates ? `duplicates
${duplicatePage.listKey}` : pageKey;
  const total = duplicates ? duplicatePage.total : (list.data?.total ?? 0);
  const totalPages = duplicates ? 1 : Math.max(1, Math.ceil(total / perPage));

  /* The last statistics the list carried, kept while 查重 shows a list without them. */
  const [stats, setStats] = useState<DictionaryStats | null>(null);
  if (list.data?.stats && list.data.stats !== stats) setStats(list.data.stats);
  const share = translatedShare(stats);

  // ---- Selection, editing, dialogs ----
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [editing, setEditing] = useState<{ id: number; closing: boolean } | null>(null);
  const dirtyRef = useRef(false);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const refreshAfterClose = useRef(false);
  const [create, setCreate] = useState<{ open: boolean; prefill: Partial<DerpiTagRow> | null; session: number }>(
    { open: false, prefill: null, session: 0 },
  );
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [importDialog, setImportDialog] = useState({ open: false, session: 0 });
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [derpiOpen, setDerpiOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [history, setHistory] = useState<{ tag: GlossaryTag; open: boolean } | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLButtonElement>(null);
  /** The feedback being handled: a save of its tag closes it. */
  const [workOrder, setWorkOrder] = useState<Feedback | null>(null);
  /** A feedback's tag waiting for the filtered list, to open its editor (or 添加新标签). */
  const [pendingTag, setPendingTag] = useState<string | null>(null);

  const saveMutation = useAdminMutation(token);
  const deleteMutation = useAdminMutation(token);
  const bulkMutation = useAdminMutation(token);
  const { confirm, confirmThen, confirmDialog } = useConfirm();

  const refreshLists = () => {
    dictionaryPage.invalidate();
    duplicateTags.invalidate();
  };

  const openCreate = (prefill: Partial<DerpiTagRow> | null) => {
    setDuplicate(null);
    setCreate((current) => ({ open: true, prefill, session: current.session + 1 }));
  };

  if (pendingTag && !duplicates && keyword.toLowerCase() === pendingTag && list.data && !list.isPrevious) {
    const match = list.data.tags.find((tag) => tag.en.toLowerCase() === pendingTag);
    setPendingTag(null);
    if (match) setEditing({ id: match.id, closing: false });
    else openCreate({ name: pendingTag, category: 'general', images: 0 });
  }

  /**
   * Close the feedback being handled — only when the tag just saved is the one it names (review
   * P6-F2). A work order stays open while the operator saves other rows (the search it opened is a
   * substring match, so neighbours are on screen) or adds an unrelated tag; marking it 已采纳并写入词库
   * on any save closed a user's request that nobody had acted on.
   */
  const completeWorkOrder = (en: string) => {
    const order = workOrder;
    if (!order || !sameTag(order.tag_name, en)) return;
    setWorkOrder(null);
    void (async () => {
      try {
        await requireAdminSuccess(
          await adminApi.handleTagFeedback(token, order.id, 'processed', '已采纳并写入词库', order.status),
        );
        if (readToken() === token) tagFeedback.invalidate();
      } catch {
        if (readToken() === token) showToast('标签已保存，但该反馈仍是待处理', 'warning');
      }
    })();
  };

  // ---- Writes ----
  const saveEdit = (tag: GlossaryTag, payload: Record<string, unknown>) => {
    const listArgs = args;
    const inDuplicates = duplicates;
    void saveMutation.run(
      () => saveDictionaryTag(token, payload as SaveBody),
      () => {
        showToast(`已保存标签「${tag.en}」`, 'success');
        completeWorkOrder(tag.en);
        setEditing((current) => (current?.id === tag.id ? { id: tag.id, closing: true } : current));
      },
      '保存失败',
      {
        key: tag.id,
        onCommitted: () => {
          tagEntry.invalidate();
          /* The row shows what was saved at once; the list is read again once the editor has
             closed, so a row that no longer matches the filter does not vanish from under it. */
          if (inDuplicates) {
            if (duplicateTags.peek(token).data) {
              duplicateTags.write(token, (previous) => (previous ?? []).map((row) => (row.id === tag.id ? savedTag(row, payload) : row)));
            }
          } else if (dictionaryPage.peek(listArgs).data) {
            dictionaryPage.write(listArgs, (previous) => ({
              ...(previous as NonNullable<typeof previous>),
              tags: (previous?.tags ?? []).map((row) => (row.id === tag.id ? savedTag(row, payload) : row)),
            }));
          }
          refreshAfterClose.current = true;
        },
      },
    );
  };

  const saveNew = (form: TagForm) => {
    const payload = tagSavePayload(form, null);
    const en = String(payload.en);
    setDuplicate(null);
    void saveMutation.run(
      async (isCurrent) => {
        const exists = await adminApi.checkTagExists(token, en);
        if (exists) {
          if (isCurrent()) setDuplicate(en);
          return null;
        }
        if (!isCurrent()) return null;
        return saveDictionaryTag(token, payload as SaveBody);
      },
      () => {
        showToast(`已添加标签「${en}」`, 'success');
        completeWorkOrder(en);
        setCreate((current) => ({ ...current, open: false }));
      },
      '添加失败',
      {
        key: 'create',
        onCommitted: () => {
          tagEntry.invalidate();
          refreshLists();
        },
      },
    );
  };

  const remove = (tag: GlossaryTag) =>
    confirmThen('确认删除标签', `确定要永久删除标签「${tag.en}」吗？此操作无法恢复。`, () =>
      void deleteMutation.run(
        () => deleteDictionaryTag(token, tag.id),
        () => showToast(`已删除标签「${tag.en}」`, 'success'),
        '删除失败',
        {
          key: tag.id,
          onCommitted: () => {
            tagEntry.invalidate();
            setSelected((previous) => without(previous, [tag.id]));
            setEditing((current) => (current?.id === tag.id ? null : current));
            refreshLists();
          },
        },
      ));

  const removeSelected = () => {
    const ids = [...selected];
    if (ids.length === 0 || bulkMutation.isPending('delete')) return;
    confirmThen('确认批量删除', `确定要永久删除选中的 ${ids.length} 个标签吗？此操作无法恢复。`, () =>
      void bulkMutation.run(
        () => adminApi.batchDeleteDictionaryTags(token, ids),
        /* A count the backend did not send is not 0 (G4-015's rule, in a toast): the deletion is
           known, its size is not, so the sentence says only what is known. */
        (data) => {
          const deleted = reportedCount(data.deleted_count);
          showToast(deleted === null ? '已删除所选标签' : `已删除 ${deleted} 个标签`, 'success');
        },
        '批量删除失败',
        {
          key: 'delete',
          onCommitted: () => {
            tagEntry.invalidate();
            setSelected((previous) => without(previous, ids));
            refreshLists();
          },
        },
      ));
  };

  const importTags = (tasks: ImportTask[]) =>
    confirmThen(
      '确认批量导入',
      `确定要导入所列的 ${tasks.length} 个标签吗？词库中已有的标签会自动跳过。`,
      () =>
        void bulkMutation.run(
          () => adminApi.batchImportDictionaryTags(token, tasks),
          (data) => {
            /* Each count is said only when it arrived — never as an invented 0. An absent `failed` is
               "none reported", the reading `importStatus` gives `failed_count`, so the dialog still
               closes on a success that reported no failures. */
            const created = reportedCount(data.created);
            const skipped = reportedCount(data.skipped);
            const failed = reportedCount(data.failed);
            const parts = [created === null ? '已完成导入' : `已导入 ${created} 个标签`, skipped ? `跳过 ${skipped} 个已有的标签` : null, failed ? `${failed} 个导入失败` : null];
            showToast(parts.filter(Boolean).join('，'), failed ? 'warning' : 'success');
            if (!failed) setImportDialog((current) => ({ ...current, open: false }));
          },
          '批量导入失败',
          {
            key: 'import',
            onCommitted: (data) => {
              /* Unless the backend said none were created: an unknown count may include some. */
              if (reportedCount(data.created) !== 0) tagEntry.invalidate();
              refreshLists();
            },
          },
        ),
      { tone: 'filled' },
    );

  const syncFinished = (result: SyncResult, visible = true) => {
    if (result.created > 0 || result.uncounted) tagEntry.invalidate();
    refreshLists();
    if (!visible) return;
    /* 新增 3 个, or 新增至少 3 个 when a page did not report its counts — no space between two Han runs. */
    const amount = (n: number) => (result.uncounted ? `至少 ${n} 个` : ` ${n} 个`);
    const tally = [
      `新增${amount(result.created)}`,
      `跳过${amount(result.skipped)}`,
      result.failedTags ? `${result.failedTags} 个失败` : null,
      result.failedPages ? `${result.failedPages} 页失败` : null,
    ].filter(Boolean).join('，');
    const clean = !result.stopped && !result.failedTags && !result.failedPages;
    showToast(`${result.stopped ? '已停止同步' : '已同步'}：${tally}`, clean ? 'success' : 'warning');
    if (clean) setSyncOpen(false);
  };

  const exportPage = () => {
    if (rows.length === 0) {
      showToast('当前页没有可导出的标签', 'info');
      return;
    }
    const url = URL.createObjectURL(new Blob([exportText(rows)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = duplicates ? 'tags_duplicates.txt' : `tags_page_${currentPage}.txt`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('已导出', 'success');
  };

  const runTool = (value: string) => {
    if (value === 'derpi') setDerpiOpen(true);
    else if (value === 'import') setImportDialog((current) => ({ ...current, open: true }));
    else if (value === 'sync') setSyncOpen(true);
    else if (value === 'export') exportPage();
  };

  const handleFeedback = (feedback: Feedback) => {
    const tag = feedback.tag_name.trim();
    setFeedbackOpen(false);
    setWorkOrder(feedback);
    setDuplicates(false);
    setUntranslated(false);
    setCategory('all');
    setSearch(tag);
    setPendingTag(tag.toLowerCase());
  };

  // ---- The editor under a row ----
  const openEditor = async (tag: GlossaryTag, trigger: HTMLElement) => {
    if (editing && saveMutation.isPending(editing.id)) return;
    if (editing && editing.id !== tag.id && !editing.closing && dirtyRef.current) {
      const current = rows.find((row) => row.id === editing.id);
      const discard = await confirm({
        title: '确认放弃修改',
        message: `确定要放弃对标签「${current?.en ?? ''}」的修改吗？`,
      });
      if (!discard) return;
    }
    captureInlineEditorLayout(trigger);
    dirtyRef.current = false;
    setEditing({ id: tag.id, closing: false });
  };

  const closeEditor = () => {
    if (!editing || saveMutation.isPending(editing.id)) return;
    setEditing({ ...editing, closing: true });
  };

  const finishClose = (id: number) => {
    setEditing((current) => (current?.id === id && current.closing ? null : current));
    if (refreshAfterClose.current) {
      refreshAfterClose.current = false;
      refreshLists();
    }
  };

  const renderEditor = (tag: GlossaryTag) => {
    if (editing?.id !== tag.id) return null;
    const current = rows.find((row) => row.id === tag.id) ?? tag;
    return (
      <TagEditor
        key={tag.id}
        tag={current}
        closing={editing.closing}
        saving={saveMutation.pendingKeys.has(tag.id)}
        workOrder={workOrder && sameTag(workOrder.tag_name, current.en) ? workOrder : null}
        onSave={(payload) => saveEdit(current, payload)}
        onCancel={closeEditor}
        onExitComplete={() => finishClose(tag.id)}
        onDirtyChange={setDirty}
        onHistory={() => setHistory({ tag: current, open: true })}
      />
    );
  };

  // ---- The list ----
  const pageIds = rows.map((tag) => tag.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const columns: Column<GlossaryTag>[] = [
    {
      key: 'select',
      leading: true,
      header: (
        <Checkbox
          checked={allSelected}
          disabled={pageIds.length === 0}
          onChange={() =>
            setSelected((previous) => {
              if (allSelected) return without(previous, pageIds);
              const next = new Set(previous);
              pageIds.forEach((id) => next.add(id));
              return next;
            })}
          aria-label="全选本页标签"
        />
      ),
      render: (tag) => (
        <Checkbox
          checked={selected.has(tag.id)}
          onChange={() =>
            setSelected((previous) => {
              const next = new Set(previous);
              if (next.has(tag.id)) next.delete(tag.id);
              else next.add(tag.id);
              return next;
            })}
          aria-label={`选择 ${tag.en}`}
        />
      ),
    },
    {
      key: 'cn',
      header: '中文翻译',
      primary: true,
      render: (tag) =>
        isUntranslated(tag.cn) ? (
          <Badge tone="warning" size="md">未翻译</Badge>
        ) : (
          <span className="min-w-0">
            <span className="block text-body-m-emphasized text-on-surface wrap-anywhere">{tag.cn}</span>
            {tag.aliases.length > 0 && (
              <span className="block text-body-s text-on-surface-variant wrap-anywhere">{`别名：${tag.aliases.join('、')}`}</span>
            )}
          </span>
        ),
    },
    {
      key: 'en',
      header: '英文标签',
      render: (tag) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge colors={tagCategoryChip(tag.cat)}>{tag.cat || 'general'}</Badge>
          <a
            href={`/search?q=${encodeURIComponent(tag.en)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="prose-link font-mono text-body-m wrap-anywhere focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
          >
            {tag.en}
          </a>
          <span className="text-body-s tabular-nums text-on-surface-variant">
            {tag.count > 0 ? `原站（${formatCount(tag.count)} 图）` : '本地标签'}
          </span>
        </span>
      ),
    },
    {
      key: 'description',
      header: '标签简介',
      render: (tag) =>
        tag.description ? (
          <span className="line-clamp-2 text-on-surface-variant" title={tag.description}>{tag.description}</span>
        ) : (
          <span className="text-on-surface-variant">暂无简介</span>
        ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (tag) => {
        const open = editing?.id === tag.id && !editing.closing;
        return (
          <>
            <IconButton
              size="sm"
              icon={<MdEdit />}
              aria-label={`编辑标签 ${tag.en}`}
              aria-expanded={open}
              aria-controls={tagEditorId(tag.id)}
              disabled={deleteMutation.pendingKeys.has(tag.id)}
              onClick={(event) => {
                if (open) closeEditor();
                else void openEditor(tag, event.currentTarget);
              }}
            />
            <IconButton
              size="sm"
              variant="danger-text"
              icon={<MdDeleteOutline />}
              aria-label={`删除标签 ${tag.en}`}
              loading={deleteMutation.pendingKeys.has(tag.id)}
              disabled={saveMutation.pendingKeys.has(tag.id)}
              onClick={() => remove(tag)}
            />
          </>
        );
      },
    },
  ];

  const failure = read.error ? apiErrorMessage(read.error) : undefined;
  const turnFailed = !duplicates && list.isPrevious && Boolean(list.error);

  return (
    <div className="@container/glossary space-y-6">
      <SectionHeader section="glossary"
        subtitle={read.data !== undefined ? (duplicates ? `${total} 个重复的英文标签` : `共 ${total} 条`) : undefined}
        onRefresh={read.refresh}
        isLoading={read.isLoading && read.data !== undefined}
        actions={
          <>
            <Button type="button" variant="tonal" icon={<MdFeedback />} onClick={() => setFeedbackOpen(true)}>
              用户反馈
            </Button>
            <Button
              ref={toolsRef}
              type="button"
              variant="tonal"
              trailingIcon={<MdArrowDropDown />}
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((value) => !value)}
            >
              工具
            </Button>
            <Button type="button" variant="filled" icon={<MdAdd />} onClick={() => openCreate(null)}>
              添加新标签
            </Button>
          </>
        }
      />
      <Menu
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        anchorRef={toolsRef}
        items={TOOLS}
        onSelect={runTool}
        aria-label="词库工具"
      />

      <div className="space-y-3">
        <div className="flex flex-col gap-3 @lg/glossary:flex-row">
          <div className="min-w-0 @lg/glossary:flex-1">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索英文标签或中文翻译…" aria-label="搜索标签" />
          </div>
          <Select
            size="sm"
            value={sort}
            options={SORTS}
            disabled={duplicates}
            aria-label="排序方式"
            onChange={setSort}
          />
          <Select
            size="sm"
            value={category}
            options={CATEGORY_FILTERS}
            disabled={duplicates}
            aria-label="分类筛选"
            onChange={setCategory}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            variant="filter"
            selected={untranslated}
            disabled={duplicates}
            icon={<MdTranslate size={ICON.dense} />}
            onClick={() => setUntranslated((value) => !value)}
          >
            只看未翻译
          </Chip>
          <Chip
            variant="filter"
            selected={duplicates}
            icon={<MdContentCopy size={ICON.dense} />}
            onClick={() => {
              setDuplicates((value) => !value);
              setSelected(new Set());
              setEditing(null);
            }}
          >
            查重模式
          </Chip>
          {selected.size > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="text-body-m text-on-surface-variant">{`已选择 ${selected.size} 个`}</span>
              <Button type="button" variant="text" size="xs" onClick={() => setSelected(new Set())}>
                取消选择
              </Button>
              <Button
                type="button"
                variant="danger"
                size="xs"
                icon={<MdDeleteOutline />}
                loading={bulkMutation.pendingKeys.has('delete')}
                onClick={removeSelected}
              >
                {`批量删除（${selected.size}）`}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div data-pagination-anchor="" className="space-y-4">
        {turnFailed && (
          <ErrorRetry size="inline" title={`第 ${currentPage} 页加载失败`} message={apiErrorMessage(list.error)} onRetry={isRetryable(list.error) ? list.refresh : undefined} />
        )}
        <DataTable<GlossaryTag>
          columns={columns}
          rows={rows}
          listKey={listKey}
          rowKey={(tag) => tag.id}
          expandedRow={renderEditor}
          loading={Boolean(token) && read.data === undefined && !read.error}
          skeletonRows={perPage}
          {...(read.data === undefined ? tableError(duplicates ? '查重结果加载失败' : '词库加载失败', failure) : {})}
          onRetry={read.error && isRetryable(read.error) ? read.refresh : undefined}
          empty={
            duplicates ? (
              <EmptyState size="inline" title="没有发现重复的英文标签" />
            ) : keyword || untranslated || category !== 'all' ? (
              '没有符合条件的标签'
            ) : (
              '词库中还没有标签'
            )
          }
        />
        {duplicates && <AdminPager page={duplicatePage.page} totalPages={duplicatePage.totalPages} onPageChange={duplicatePage.setPage} />}
        {!duplicates && (
          <div className="flex flex-col items-center gap-3 @lg/glossary:flex-row @lg/glossary:justify-between">
            <Select
              size="sm"
              value={String(perPage)}
              options={PAGE_SIZE_OPTIONS}
              aria-label="每页条数"
              onChange={(value) => {
                const size = pageSizeOf(value);
                setPerPage(size);
                try {
                  localStorage.setItem(LS_KEYS.itemsPerPage, String(size));
                } catch {
                  /* A preference that cannot be kept is still applied. */
                }
              }}
            />
            {totalPages > 1 && (
              <div className="w-full min-w-0 @lg/glossary:w-auto @lg/glossary:flex-1">
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={(next) => {
                    setEditing(null);
                    setPage({ page: next, scope });
                  }}
                  siblings={1}
                  className="mt-0 w-full @lg/glossary:justify-end"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {share !== null && stats && (
        <Card variant="filled" className="space-y-3">
          {/* The console's heading primitive, its figures as the heading's aside (G4-016: a hand-set
              title-s h3 beside every other h3 here being `SectionHeading`). `mb-3` is the card's own
              12px rhythm — a bare zero would cancel `space-y-3` rather than stand in for it. */}
          <SectionHeading
            as="h3"
            className="mb-3"
            aside={
              <>
                {'已翻译 '}
                <span className="tabular-nums text-on-surface">{formatCount(stats.translated)}</span>
                {' / 共 '}
                <span className="tabular-nums text-on-surface">{formatCount(stats.total)}</span>
                {` 个标签（${share.toFixed(2)}%）`}
              </>
            }
          >
            词库翻译进度
          </SectionHeading>
          <ProgressBar value={share} label="词库翻译进度" />
        </Card>
      )}

      <CreateTagDialog
        key={`create-${create.session}`}
        open={create.open}
        prefill={create.prefill}
        saving={saveMutation.pendingKeys.has('create')}
        workOrder={workOrder && create.open && create.prefill?.name && sameTag(workOrder.tag_name, create.prefill.name) ? workOrder : null}
        duplicate={duplicate}
        onClose={() => {
          if (saveMutation.isPending('create')) return;
          setCreate((current) => ({ ...current, open: false }));
        }}
        onSave={saveNew}
      />
      <BatchImportDialog
        key={`import-${importDialog.session}`}
        open={importDialog.open}
        importing={bulkMutation.pendingKeys.has('import')}
        onClose={() => {
          if (bulkMutation.isPending('import')) return;
          setImportDialog((current) => ({ ...current, open: false }));
        }}
        onImport={importTags}
      />
      <SyncDialog
        open={syncOpen}
        token={token}
        onClose={() => {
          if (!syncing) setSyncOpen(false);
        }}
        onRunningChange={setSyncing}
        onFinished={syncFinished}
      />
      <DerpiSearchDialog
        open={derpiOpen}
        onClose={() => setDerpiOpen(false)}
        onImport={(tag) => {
          setDerpiOpen(false);
          openCreate(tag);
        }}
      />
      <FeedbackDialog open={feedbackOpen} token={token} onClose={() => setFeedbackOpen(false)} onHandle={handleFeedback} />
      <HistoryDialog
        key={`history-${history?.tag.id ?? 0}`}
        token={token}
        tag={history?.tag ?? null}
        open={Boolean(history?.open)}
        onClose={() => setHistory((current) => (current ? { ...current, open: false } : current))}
      />
      {confirmDialog}
    </div>
  );
}
