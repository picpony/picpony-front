'use client';

import { useState } from 'react';
import Button from '@/components/Button';
import DataTable from '@/components/DataTable';
import Select from '@/components/Select';
import Tabs from '@/components/Tabs';
import { TabPane, TabPanes } from '@/components/TabPanes';
import { formatCount, formatDateTime } from '@/lib/format';
import RefreshButton from '../RefreshButton';
import { dateValue, fieldsPayload, relayFields } from '@/lib/adminSiteTools/model';
import * as api from '@/lib/api/adminSiteTools';
import SectionHeader from '../SectionHeader';
import { AdminForm, AdminNote, FormGrid } from '../AdminForm';
import DateInput from '../DateInput';
import { AdminListAnchor, AdminPager } from '../paging';
import { tableError, useAdminQuery } from '../queries';
import type { AdminPanelProps } from '../registry';
import { ConfigEditor, ReadState, protectedPanel } from './common';
import { relayConfigQuery, relayStatsQuery, relayErrorsQuery, useToolPage } from './queries';
import ServiceChecks from './ServiceChecks';

function RelayConfig({ token }: { token: string }) {
  const read = useAdminQuery(relayConfigQuery, token);
  return <ReadState title="中转服务设置加载失败" loading={read.loading} error={read.error} retry={read.retryable ? read.refresh : undefined}>
    {/* Its own refresh: another admin may be changing these values, and this sub-pane had none —
        the one panel whose settings cannot be re-read was the relay's. */}
    <div className="flex justify-end"><RefreshButton onClick={read.refresh} label="刷新设置" loading={read.refreshing} /></div>
    {read.data && <ConfigEditor title="中转服务设置" token={token} initial={read.data.values} fields={relayFields} validate={(v) => fieldsPayload(relayFields, v)} save={(v) => api.saveRelayConfig(token, v)} refresh={() => relayConfigQuery.invalidate()} confirmation={() => '确定要修改全站中转服务设置吗？并发上限、自动切回及白名单将一并更新。'}>
      <AdminNote>自动切回本轮已尝试 {read.data.attempts} 次，最多 3 次。</AdminNote>
    </ConfigEditor>}
  </ReadState>;
}
function RelayStats({ token }: { token: string }) {
  const [args, setArgs] = useState<api.RelayStatsArgs>({ range: '1', date: '', page: 1, sort: 'total', order: 'desc' });
  const [date, setDate] = useState(''), [dateError, setDateError] = useState('');
  const read = useToolPage(relayStatsQuery, token, args, `${args.range}:${args.date}:${args.sort}:${args.order}`);
  if (read.data && !read.isPrevious && !read.isLoading && !read.error && args.page > read.data.totalPages) setArgs({ ...args, page: read.data.totalPages });
  return <div className="space-y-4">
    <AdminForm aria-label="筛选中转统计" onSubmit={() => { try { dateValue(date); setDateError(''); setArgs({ ...args, range: '1', date, page: 1 }); } catch { setDateError('请输入有效的日期'); } }}>
      <FormGrid>
        <Select label="统计范围" value={args.range} options={[{ value: '1', label: '单日' }, { value: '7', label: '最近 7 天' }, { value: '30', label: '最近 30 天' }]} onChange={(range) => setArgs({ ...args, range, date: '', page: 1 })} />
        <Select label="排序" value={`${args.sort}:${args.order}`} options={[{ value: 'total:desc', label: '请求数从多到少' }, { value: 'total:asc', label: '请求数从少到多' }, { value: 'last_seen:desc', label: '最近请求优先' }, { value: 'last_seen:asc', label: '最早请求优先' }]} onChange={(value) => { const [sort, order] = value.split(':'); setArgs({ ...args, sort, order, page: 1 }); }} />
        <DateInput label="指定日期" value={date} error={dateError || undefined} onChange={(e) => setDate(e.target.value)} helper="留空查看今天" />
        <div className="flex flex-wrap items-start gap-3"><Button type="submit" size="lg" variant="tonal">查看日期</Button><RefreshButton onClick={read.refresh} label="刷新统计" loading={read.refreshing} /></div>
      </FormGrid>
    </AdminForm>
    <AdminListAnchor>
      <DataTable rows={read.data?.rows ?? []} listKey={read.listKey} rowKey={(r, i) => `${r.ip}:${r.username}:${i}`} loading={read.loading} {...tableError(read.isPrevious ? `第 ${args.page} 页加载失败` : '中转统计加载失败', read.message)} onRetry={read.retry} empty="暂无中转请求" columns={[
        { key: 'ip', header: 'IP 地址', primary: true, className: 'wrap-anywhere', render: (r) => r.ip },
        { key: 'user', header: '用户', render: (r) => r.username || '访客' },
        { key: 'total', header: '总请求', render: (r) => formatCount(r.total) },
        { key: 'search', header: '搜索请求', render: (r) => formatCount(r.search) },
        { key: 'normal', header: '其他请求', render: (r) => formatCount(r.normal) },
        { key: 'last', header: '最后请求', className: 'tabular-nums', render: (r) => r.last_seen === null ? '—' : typeof r.last_seen === 'string' ? r.last_seen : formatDateTime(r.last_seen) },
      ]} />
      <AdminPager page={args.page} totalPages={read.data?.totalPages ?? 1} onPageChange={(page) => setArgs({ ...args, page })} disabled={read.isLoading} summary={read.data ? `共 ${read.data.total} 条记录` : undefined} />
    </AdminListAnchor>
  </div>;
}
function RelayErrors({ token }: { token: string }) {
  const [args, setArgs] = useState({ date: '', page: 1 });
  const read = useToolPage(relayErrorsQuery, token, args, args.date);
  if (read.data && !read.isPrevious && !read.isLoading && !read.error && args.page > read.data.totalPages) setArgs({ ...args, page: read.data.totalPages });
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start gap-3">
      <Select label="日志日期" value={args.date} options={[{ value: '', label: '全部日期' }, ...(read.data?.dates ?? []).map((date) => ({ value: date, label: date }))]} onChange={(date) => setArgs({ date, page: 1 })} />
      <RefreshButton onClick={read.refresh} label="刷新日志" loading={read.refreshing} />
    </div>
    <AdminNote>{read.data?.available === false ? '尚无错误日志。原站出现错误响应后会自动记录。' : '这里展示最近 5000 条原站错误记录。'}</AdminNote>
    <AdminListAnchor>
      <DataTable rows={read.data?.rows ?? []} listKey={read.listKey} rowKey={(r) => r.key} loading={read.loading} {...tableError(read.isPrevious ? `第 ${args.page} 页加载失败` : '中转日志加载失败', read.message)} onRetry={read.retry} empty="暂无原站错误记录" columns={[
        { key: 'reason', header: '原因', primary: true, className: 'wrap-anywhere', render: (r) => r.reason || (r.status === null ? '未收到原站响应' : `原站返回 ${r.status}`) },
        { key: 'status', header: '状态', render: (r) => `原站 ${r.status ?? '—'} · 中转 ${r.relay ?? '—'}` },
        { key: 'target', header: '目标', className: 'wrap-anywhere', render: (r) => `${r.method} ${r.target}` },
        { key: 'time', header: '时间与耗时', render: (r) => <>{formatDateTime(r.time)}<br />{r.duration === null ? '耗时未记录' : `${r.duration} 毫秒`} · {r.phase || '阶段未记录'}</> },
      ]} />
      <AdminPager page={args.page} totalPages={read.data?.totalPages ?? 1} onPageChange={(page) => setArgs({ ...args, page })} disabled={read.isLoading} summary={read.data ? `共 ${read.data.total} 条记录` : undefined} />
    </AdminListAnchor>
  </div>;
}
const tabs = [{ value: 'relay-config', label: '设置' }, { value: 'relay-stats', label: '请求统计' }, { value: 'relay-errors', label: '错误日志' }, { value: 'relay-checks', label: '线路检测' }];
function RelayTab({ token }: AdminPanelProps) {
  const [active, setActive] = useState('relay-config');
  const [visited, setVisited] = useState(new Set(['relay-config']));
  return <div className="space-y-6">
    <SectionHeader section="relay" />
    <Tabs tabs={tabs} value={active} label="中转服务分区" activation="manual" onChange={(value) => { setVisited(new Set([...visited, value])); setActive(value); }} />
    <TabPanes value={active}>
      <TabPane value="relay-config"><RelayConfig token={token} /></TabPane>
      <TabPane value="relay-stats">{visited.has('relay-stats') && <RelayStats token={token} />}</TabPane>
      <TabPane value="relay-errors">{visited.has('relay-errors') && <RelayErrors token={token} />}</TabPane>
      <TabPane value="relay-checks">{visited.has('relay-checks') && <ServiceChecks token={token} />}</TabPane>
    </TabPanes>
  </div>;
}
export default protectedPanel(RelayTab);
