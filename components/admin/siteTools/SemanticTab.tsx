'use client';

import { useState } from 'react';
import { MdArchive, MdDeleteOutline, MdUnarchive } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Checkbox from '@/components/Checkbox';
import Card from '@/components/Card';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import Select from '@/components/Select';
import SearchInput from '@/components/SearchInput';
import SectionHeading from '@/components/SectionHeading';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { formatDateTime } from '@/lib/format';
import { cloudFields, cloudPayload, modeFields, fieldsPayload, optionalMeasurement, text, type Row } from '@/lib/adminSiteTools/model';
import * as api from '@/lib/api/adminSiteTools';
import { semanticQuery } from '@/lib/resources';
import { publishSavedSiteStatus } from '@/lib/siteStatus';
import { savedSemanticTiming } from '@/lib/adminSiteTools/propagation';
import SectionHeader from '../SectionHeader';
import { AdminForm, AdminNote } from '../AdminForm';
import { useAdminSelect, tableError } from '../queries';
import { useAdminMutation } from '../useAdminMutation';
import { AdminListAnchor, AdminPager } from '../paging';
import type { AdminPanelProps } from '../registry';
import { ConfigEditor, protectedPanel, ReadState } from './common';
import { selectToolsStatus, statusQuery, feedbackQuery, useToolPage } from './queries';

function Feedback({ token }: { token: string }) {
  const [filter, setFilter] = useState({ status: 'new', q: '', page: 1 });
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<{ scope: string; ids: number[] }>({ scope: '', ids: [] });
  const scope = JSON.stringify(filter);
  const read = useToolPage(feedbackQuery, token, filter, `${filter.status}:${filter.q}`);
  if (read.data && !read.isPrevious && !read.isLoading && !read.error && filter.page > read.data.totalPages) setFilter({ ...filter, page: read.data.totalPages });
  const archive = useAdminMutation(token), remove = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const locked = read.isPrevious || read.isLoading || remove.busy || archive.busy;
  const ids = read.data?.rows.map((r) => r.id) ?? [];
  const selected = selection.scope === scope ? selection.ids.filter((id) => ids.includes(id)) : [];
  const change = (id: number, checked: boolean) => setSelection({ scope, ids: checked ? [...selected, id] : selected.filter((x) => x !== id) });
  const refresh = () => { setSelection({ scope, ids: [] }); feedbackQuery.invalidate(); };
  const deleteIds = (targets: number[]) => {
    if (!targets.length || locked) return;
    confirmThen('确认删除搜索反馈', `确定要删除反馈 ${targets.map((id) => `#${id}`).join('、')} 吗？共 ${targets.length} 条，删除后无法恢复。`, () => void remove.run(() => api.deleteFeedback(token, targets), () => showToast('已删除反馈', 'success'), '反馈删除失败', { onCommitted: refresh }));
  };
  const columns: Column<api.Feedback>[] = [
    { key: 'select', header: '选择', leading: true, render: (r) => <Checkbox aria-label={`选择反馈 #${r.id}`} checked={selected.includes(r.id)} disabled={locked} onChange={(v) => change(r.id, v)} /> },
    { key: 'query', header: '搜索原句', primary: true, className: 'whitespace-pre-wrap wrap-anywhere', render: (r) => r.query },
    { key: 'result', header: '模型结果', className: 'whitespace-pre-wrap wrap-anywhere', render: (r) => r.result || '无结果' },
    { key: 'who', header: '提交信息', render: (r) => <span>{r.user || '访客'} · {r.engine || '未记录模型'}<br />{formatDateTime(r.date)}<br /><Badge>{r.status === 'archived' ? '已归档' : '待处理'}</Badge></span> },
    { key: 'actions', header: '操作', actions: true, render: (r) => <>
      <IconButton size="sm" icon={r.status === 'archived' ? <MdUnarchive /> : <MdArchive />} aria-label={`${r.status === 'archived' ? '恢复' : '归档'}反馈 #${r.id}`} disabled={read.isPrevious || remove.busy} loading={archive.pendingKeys.has(r.id)} onClick={() => void archive.run(() => api.archiveFeedback(token, r.id, r.status !== 'archived'), () => showToast(r.status === 'archived' ? '已恢复反馈' : '已归档反馈', 'success'), '反馈归档失败', { key: r.id, onCommitted: refresh })} />
      <IconButton size="sm" variant="danger-text" icon={<MdDeleteOutline />} aria-label={`删除反馈 #${r.id}`} disabled={locked} onClick={() => deleteIds([r.id])} />
    </> },
  ];
  return <section aria-labelledby="admin-search-feedback-heading" className="space-y-4">
    <SectionHeading as="h3" id="admin-search-feedback-heading">搜索反馈</SectionHeading>
    <AdminForm aria-label="筛选搜索反馈" onSubmit={() => setFilter({ ...filter, q: search.trim(), page: 1 })}>
      <div className="flex flex-wrap items-start gap-3">
        <Select label="反馈状态" value={filter.status} options={[{ value: 'new', label: '待处理' }, { value: 'archived', label: '已归档' }, { value: 'all', label: '全部' }]} onChange={(status) => setFilter({ ...filter, status, page: 1 })} />
        <SearchInput value={search} onChange={setSearch} placeholder="搜索反馈…" className="sm:w-64" />
        <Button type="submit" size="lg" variant="tonal">搜索</Button>
      </div>
    </AdminForm>
    <div className="flex flex-wrap items-center gap-4">
      <Checkbox label="选择本页全部反馈" checked={ids.length > 0 && ids.every((id) => selected.includes(id))} disabled={locked || !ids.length} onChange={(checked) => setSelection({ scope, ids: checked ? ids : [] })} />
      <Button variant="danger-text" disabled={!selected.length || read.isPrevious || archive.busy} loading={remove.busy} onClick={() => deleteIds(selected)}>删除所选（{selected.length}）</Button>
    </div>
    <AdminListAnchor>
      <DataTable columns={columns} rows={read.data?.rows ?? []} listKey={read.listKey} rowKey={(r) => r.id} loading={read.loading} {...tableError(read.isPrevious ? `第 ${filter.page} 页加载失败` : '搜索反馈加载失败', read.message)} onRetry={read.retry} empty="暂无搜索反馈" />
      <AdminPager page={filter.page} totalPages={read.data?.totalPages ?? 1} onPageChange={(page) => setFilter({ ...filter, page })} disabled={read.isLoading || archive.busy || remove.busy} summary={read.data ? `共 ${read.data.total} 条反馈` : undefined} />
    </AdminListAnchor>
    {confirmDialog}
  </section>;
}

function SemanticTab({ token }: AdminPanelProps) {
  const read = useAdminSelect(statusQuery, token, selectToolsStatus);
  const test = useAdminMutation(token);
  const [result, setResult] = useState<{ model: string; content: string; ms: number | null; cooldown: string } | null>(null);
  const { confirmThen, confirmDialog } = useConfirm();
  const refresh = () => { statusQuery.invalidate(); semanticQuery.invalidate(); setResult(null); };
  return <div className="space-y-6">
    <SectionHeader section="semantic" onRefresh={() => { read.refresh(); feedbackQuery.invalidate(); }} isLoading={read.refreshing} />
    <ReadState title="智能搜索设置加载失败" loading={read.loading} error={read.error} retry={read.retryable ? read.refresh : undefined}>
      {read.data && <>
        <ConfigEditor title="搜索解析方式" token={token} initial={{ semantic_search_mode: read.data.mode }} fields={modeFields} validate={(v) => fieldsPayload(modeFields, v)} save={(v) => api.saveSemanticMode(token, v)} refresh={(data, values) => {
          const reported = text(data.semantic_search_mode);
          const mode = modeFields[0].options?.some((option) => option.value === reported) ? reported : values.semantic_search_mode;
          publishSavedSiteStatus({ semantic: { availability: mode === 'off' ? 'off' : 'on' } });
          refresh();
        }} confirmation={() => '确定要修改全站搜索解析方式吗？之后的搜索将使用新规则。'} />
        <ConfigEditor title="云端模型" token={token} initial={read.data.cloud} fields={cloudFields} validate={cloudPayload} save={(v) => api.saveSemanticCloud(token, v)} refresh={(data, values) => {
          publishSavedSiteStatus({ semantic: savedSemanticTiming(values, data, read.data?.hasKey ?? false) });
          refresh();
        }} confirmation={(v) => `确定要保存云端模型设置吗？${v.semantic_cloud_clear_key ? '已保存的模型密钥将被清除。' : '设置将用于全站智能搜索。'}`}>
          <AdminNote>{read.data.hasKey ? '已保存模型密钥，留空即可保留。' : '尚未保存模型密钥。'}</AdminNote>
        </ConfigEditor>
        <div className="space-y-3"><Button variant="tonal" loading={test.busy} onClick={() => confirmThen('确认测试云端模型', '确定要使用已保存的配置发送一次模型测试请求吗？测试可能消耗服务额度，未保存的内容不会参与测试。', () => void test.run(() => api.testSemanticCloud(token), (d) => {
          const cooldown = d.cooldown && typeof d.cooldown === 'object' ? d.cooldown as Row : null;
          /* The duration is optional: a test that answered is a working connection whether or not it
             timed itself, so an absent `ms` leaves the sentence without it rather than reporting the
             test as failed (G2-003's rule, same as the benchmark's). */
          setResult({ model: text(d.model), content: text(d.content), ms: optionalMeasurement(d.ms), cooldown: cooldown?.blocked ? `云端暂时停用 ${Number(cooldown.remaining_seconds) || 0} 秒：${text(cooldown.reason) || '服务冷却中'}` : '' });
        }, '云端连接测试失败'))}>测试云端连接</Button>{result && <Card variant="filled" padding="sm" className="max-w-2xl space-y-2"><p role="status" className="text-body-m">连接正常：{result.model || '已保存的模型'}{result.ms === null ? '' : `，耗时 ${result.ms} 毫秒`}</p><p className="whitespace-pre-wrap wrap-anywhere text-body-s">{result.content || '未返回文本'}</p>{result.cooldown && <p className="text-body-s">{result.cooldown}</p>}</Card>}</div>
      </>}
    </ReadState>
    <Feedback token={token} />
    {confirmDialog}
  </div>;
}
export default protectedPanel(SemanticTab);
