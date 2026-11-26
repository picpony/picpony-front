'use client';

import { useEffect, useState } from 'react';
import { MdArchive, MdDeleteOutline, MdUnarchive } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Checkbox from '@/components/Checkbox';
import Card from '@/components/Card';
import Collapse from '@/components/Collapse';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import Select from '@/components/Select';
import SearchInput from '@/components/SearchInput';
import SectionHeading from '@/components/SectionHeading';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { MOTION_SPEED_SCALE, motionTier } from '@/lib/appearance';
import { formatDateTime } from '@/lib/format';
import { cloudFields, cloudPayload, modeFields, fieldsPayload, text } from '@/lib/adminSiteTools/model';
import * as api from '@/lib/api/adminSiteTools';
import { semanticQuery } from '@/lib/resources';
import { publishSavedSiteStatus } from '@/lib/siteStatus';
import { savedSemanticTiming } from '@/lib/adminSiteTools/propagation';
import SectionHeader from '../SectionHeader';
import { AdminNote } from '../AdminForm';
import { useAdminQuery, tableError } from '../queries';
import { useAdminMutation } from '../useAdminMutation';
import { AdminListAnchor, AdminPager, useCursorPages } from '../paging';
import type { AdminPanelProps } from '../registry';
import { ConfigEditor, protectedPanel, ReadState } from './common';
import { semanticConfigQuery, feedbackQuery, useToolPage } from './queries';

function Feedback({ token }: { token: string }) {
  const [filter, setFilter] = useState<{ status: api.FeedbackStatus; q: string }>({ status: 'new', q: '' });
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<{ scope: string; ids: number[] }>({ scope: '', ids: [] });
  const pageScope = `${token}:${filter.status}:${filter.q}`;
  /* A cursor list (`before` → `next_cursor`): the pager offers the pages reached so far and the next. */
  const pages = useCursorPages(pageScope);
  const scope = `${pageScope}:${pages.page}`;
  const read = useToolPage(feedbackQuery, token, { ...filter, before: pages.cursor }, `${filter.status}:${filter.q}`);
  if (read.data && !read.isPrevious && !read.error) pages.learn(pages.page, read.data.next);
  if (read.data && !read.isPrevious && !read.isLoading && !read.error && !read.data.rows.length && pages.page > 1) pages.setPage(pages.page - 1);
  const archive = useAdminMutation(token), remove = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const locked = read.isPrevious || read.isLoading || remove.busy || archive.busy;
  const ids = read.data?.rows.map((r) => r.id) ?? [];
  const selected = selection.scope === scope ? selection.ids.filter((id) => ids.includes(id)) : [];
  const change = (id: number, checked: boolean) => setSelection({ scope, ids: checked ? [...selected, id] : selected.filter((x) => x !== id) });
  const refresh = () => { setSelection({ scope, ids: [] }); feedbackQuery.invalidate(); };
  const deleteIds = (targets: number[]) => {
    if (!targets.length || locked) return;
    confirmThen('确认删除搜索反馈', `确定要删除反馈 ${targets.map((id) => `#${id}`).join('、')} 吗？共 ${targets.length} 条，删除后无法恢复。`, () => void remove.run(() => api.deleteFeedback(token, targets), () => showToast('已删除反馈', 'success'), '反馈删除失败', { onCommitted: refresh }), { tone: 'danger' });
  };
  const columns: Column<api.Feedback>[] = [
    { key: 'select', header: '选择', leading: true, render: (r) => <Checkbox aria-label={`选择反馈 #${r.id}`} checked={selected.includes(r.id)} disabled={locked} onChange={(v) => change(r.id, v)} /> },
    { key: 'query', header: '搜索原句', primary: true, className: 'whitespace-pre-wrap wrap-anywhere', render: (r) => r.query },
    { key: 'result', header: '模型结果', width: 'minmax(0, 2fr)', className: 'whitespace-pre-wrap wrap-anywhere', render: (r) => r.result || '无结果' },
    { key: 'who', header: '提交信息', width: 'minmax(0, 1.5fr)', className: 'tabular-nums', render: (r) => <span className="inline-flex flex-col items-start gap-1 align-top"><span>{r.user || '访客'} · {r.engine || '未记录模型'}</span><span className="text-body-s text-on-surface-variant">{formatDateTime(r.date)}</span><Badge size="md" tone={r.status === 'archived' ? 'neutral' : 'warning'}>{r.status === 'archived' ? '已归档' : '待处理'}</Badge></span> },
    { key: 'actions', header: '操作', actions: true, render: (r) => <>
      <IconButton size="sm" icon={r.status === 'archived' ? <MdUnarchive /> : <MdArchive />} aria-label={`${r.status === 'archived' ? '恢复' : '归档'}反馈 #${r.id}`} disabled={read.isPrevious || remove.busy} loading={archive.pendingKeys.has(r.id)} onClick={() => void archive.run(() => api.archiveFeedback(token, r.id, r.status !== 'archived'), () => showToast(r.status === 'archived' ? '已恢复反馈' : '已归档反馈', 'success'), '反馈归档失败', { key: r.id, onCommitted: refresh })} />
      <IconButton size="sm" variant="danger-text" icon={<MdDeleteOutline />} aria-label={`删除反馈 #${r.id}`} disabled={locked} onClick={() => deleteIds([r.id])} />
    </> },
  ];
  return <section aria-labelledby="admin-search-feedback-heading" className="@container space-y-4">
    <SectionHeading as="h3" id="admin-search-feedback-heading">搜索反馈</SectionHeading>
    <form
      role="search"
      aria-label="筛选搜索反馈"
      noValidate
      className="flex flex-col gap-3 @md:flex-row @md:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        setFilter({ ...filter, q: search.trim() });
      }}
    >
      <Select size="sm" aria-label="反馈状态" value={filter.status} options={[{ value: 'new', label: '待处理' }, { value: 'archived', label: '已归档' }, { value: 'all', label: '全部' }]} onChange={(status) => setFilter({ ...filter, status: status as api.FeedbackStatus })} />
      <SearchInput value={search} onChange={setSearch} placeholder="搜索反馈…" className="min-w-0 @md:flex-1" />
      <Button type="submit" variant="filled">搜索</Button>
    </form>
    <div className="flex flex-wrap items-center gap-4">
      <Checkbox label="选择本页全部反馈" checked={ids.length > 0 && ids.every((id) => selected.includes(id))} disabled={locked || !ids.length} onChange={(checked) => setSelection({ scope, ids: checked ? ids : [] })} />
      <Button variant="danger-text" className="tabular-nums" disabled={!selected.length || read.isPrevious || archive.busy} loading={remove.busy} onClick={() => deleteIds(selected)}>删除所选（{selected.length}）</Button>
    </div>
    <AdminListAnchor>
      <DataTable columns={columns} rows={read.data?.rows ?? []} listKey={read.listKey} rowKey={(r) => r.id} loading={read.loading} {...tableError(read.isPrevious ? `搜索反馈第 ${pages.page} 页加载失败` : '搜索反馈加载失败', read.message)} onRetry={read.retry} empty="暂无搜索反馈" />
      <AdminPager page={pages.page} totalPages={pages.totalPages} onPageChange={pages.setPage} disabled={read.isLoading || archive.busy || remove.busy} summary={read.data ? `共 ${read.data.counts[filter.status]} 条反馈` : undefined} />
    </AdminListAnchor>
    {confirmDialog}
  </section>;
}

/** What the key field leaves in place: the stored key by its mask, or why it cannot be used. */
function keyNote(config: api.SemanticConfig): string {
  if (!config.hasKey) return '尚未保存模型密钥。';
  if (!config.keyReadable) return '当前服务器无法解密该密钥，请重新填写。';
  return `已保存模型密钥（${config.masked}），留空即可保留。`;
}

const COLLAPSE_WATCHDOG_MS = Math.ceil(1000 * MOTION_SPEED_SCALE.slow);

function SemanticTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(semanticConfigQuery, token);
  const test = useAdminMutation(token);
  const [result, setResult] = useState<api.CloudTest | null>(null);
  const [shownResult, setShownResult] = useState<api.CloudTest | null>(null);
  const { confirmThen, confirmDialog } = useConfirm();
  const refresh = () => {
    semanticConfigQuery.invalidate();
    semanticQuery.invalidate();
    setResult(null);
    if (motionTier('list') === 'off') setShownResult(null);
  };
  useEffect(() => {
    if (result || !shownResult) return;
    if (motionTier('list') === 'off') {
      const frame = requestAnimationFrame(() => setShownResult(null));
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(() => setShownResult(null), COLLAPSE_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [result, shownResult]);
  return <div className="space-y-6">
    <SectionHeader section="semantic" onRefresh={() => { read.refresh(); feedbackQuery.invalidate(); }} isLoading={read.refreshing} />
    <ReadState title="智能搜索设置加载失败" loading={read.loading} error={read.error} retry={read.retryable ? read.refresh : undefined}>
      {read.data && <>
        <ConfigEditor title="搜索解析方式" token={token} initial={read.data.mode} fields={modeFields} validate={(v) => fieldsPayload(modeFields, v)} save={(v) => api.saveSemanticMode(token, v)} refresh={(data) => {
          const mode = text(data.semantic_search_mode);
          publishSavedSiteStatus({ semantic: { availability: mode === 'off' ? 'off' : 'on' } });
          refresh();
        }} confirmation={() => '确定要修改全站搜索解析方式吗？之后的搜索将使用新规则。'} />
        <ConfigEditor title="云端模型" token={token} initial={read.data.cloud} fields={cloudFields} validate={cloudPayload} save={(v) => api.saveSemanticCloud(token, v)} refresh={(data, values) => {
          publishSavedSiteStatus({ semantic: savedSemanticTiming(values, data, read.data?.hasKey ?? false) });
          refresh();
        }} confirmation={(v) => `确定要保存云端模型设置吗？${v.semantic_cloud_clear_key ? '已保存的模型密钥将被清除。' : '设置将用于全站智能搜索。'}`}>
          <AdminNote>{keyNote(read.data)}</AdminNote>
        </ConfigEditor>
        <div>
          <Button variant="tonal" loading={test.busy} onClick={() => confirmThen('确认测试云端模型', '确定要使用已保存的配置发送一次测试请求吗？测试可能消耗服务额度。', () => void test.run(() => api.testSemanticCloud(token), (d) => { setShownResult(d); setResult(d); }, '测试失败'), { tone: 'filled' })}>测试云端连接</Button>
          <Collapse
            open={Boolean(result)}
            onTransitionEnd={(event) => {
              if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows' && !result) {
                setShownResult(null);
              }
            }}
          >
            {shownResult && (
              <div className="pt-3">
                <Card variant="filled" padding="sm" className="max-w-2xl space-y-2">
                  <p role="status" className="text-body-m tabular-nums">{shownResult.ok ? `连接正常：${shownResult.model || '已保存的模型'}，耗时 ${shownResult.latency_ms} 毫秒` : `模型服务返回 HTTP ${shownResult.http_status}（${shownResult.model || '已保存的模型'}，耗时 ${shownResult.latency_ms} 毫秒）`}</p>
                </Card>
              </div>
            )}
          </Collapse>
        </div>
      </>}
    </ReadState>
    <Feedback token={token} />
    {confirmDialog}
  </div>;
}
export default protectedPanel(SemanticTab);
