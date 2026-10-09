'use client';

import { useState } from 'react';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Checkbox from '@/components/Checkbox';
import DataTable from '@/components/DataTable';
import SectionHeading from '@/components/SectionHeading';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { assistantFields, assistantPayload, fieldsPayload, quotaFields, GATEWAY, type Values } from '@/lib/adminSiteTools/model';
import * as api from '@/lib/api/adminSiteTools';
import { assistantQuota } from '@/lib/assistant/queries';
import { AdminForm, AdminNote, FormActions } from '../AdminForm';
import SectionHeader from '../SectionHeader';
import { useAdminQuery } from '../queries';
import { useAdminMutation } from '../useAdminMutation';
import { AdminListAnchor, AdminPager, usePagedRows } from '../paging';
import type { AdminPanelProps } from '../registry';
import { ConfigEditor, ReadState, protectedPanel, SettingsFields, fieldErrors } from './common';
import { assistantQuery, quotaQuery } from './queries';

function Provider({ token }: { token: string }) {
  const read = useAdminQuery(assistantQuery, token);
  /* `savedFrom` is `ConfigEditor`'s rule (review P6-O4): a draft just saved stays on screen while
     the read is still the one from before the save — clearing it showed the old model until the
     re-read landed — and gives way as soon as a new read arrives. */
  const [draft, setDraftState] = useState<{ values: Values; savedFrom?: Values } | null>(null);
  const setDraft = (next: Values | null) => setDraftState(next ? { values: next } : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [models, setModels] = useState<api.ModelList | null>(null);
  const [notice, setNotice] = useState('');
  const save = useAdminMutation(token), list = useAdminMutation(token), discover = useAdminMutation(token), test = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const values = draft && (!draft.savedFrom || !read.data || draft.savedFrom === read.data.values) ? draft.values : read.data?.values;
  const catalog = models ?? read.data;
  const candidates = Array.isArray(values?.model_candidates) ? values.model_candidates : [];
  const sameProvider = Boolean(values && read.data && String(values.base_url).replace(/\/+$/, '') === String(read.data.values.base_url).replace(/\/+$/, '') && String(values.models_url).replace(/\/+$/, '') === String(read.data.values.models_url).replace(/\/+$/, ''));
  const busy = save.busy || list.busy || discover.busy || test.busy;
  const modelRows = usePagedRows((catalog?.catalog ?? []).map((name) => ({ name, result: catalog?.benchmarks[name] })), catalog, 20);
  const validate = () => {
    if (!values) return false;
    try { assistantPayload(values); setErrors({}); return true; }
    catch (error) { setErrors(fieldErrors(error)); return false; }
  };
  const change = (next: Values) => {
    if (!values) return;
    if (next.base_url !== values.base_url || next.models_url !== values.models_url) {
      setModels({ catalog: [], candidates: [], benchmarks: {}, model: '' });
      next = { ...next, model_candidates: [] };
    }
    setDraft(next); setErrors({}); setNotice('');
  };
  const saveConfig = () => {
    if (busy || !values || !validate()) return;
    const snapshot = { ...values };
    confirmThen('确认保存助手配置', `确定要保存彩彩 AI 的模型配置吗？${values.clear_key ? '已保存的助手密钥将被清除。' : '之后的对话将使用新配置。'}`, () => void save.run(
      () => api.saveAssistantConfig(token, snapshot), () => { setDraftState({ values: { ...snapshot, api_key: '', clear_key: false }, savedFrom: read.data?.values }); setModels(null); setNotice(''); showToast('已保存助手配置', 'success'); }, '助手配置保存失败', { onCommitted: () => { assistantQuery.invalidate(); assistantQuota.invalidate({ token }); } },
    ));
  };
  const fetchModels = () => {
    if (busy || !sameProvider || !read.data?.hasKey || values?.api_key || values?.clear_key) return;
    void list.run(() => api.listAssistantModels(token), (d) => {
      const next = api.modelList(d); setModels(next);
      setDraft({ ...values!, model_candidates: next.candidates }); setNotice(`已获取 ${next.catalog.length} 个模型`);
    }, '模型列表获取失败');
  };
  const benchmark = () => {
    if (busy || !values || !validate()) return;
    const snapshot = { ...values, clear_key: false };
    confirmThen('确认获取模型并测速', '确定要按当前填写的配置获取模型并逐个测速吗？该操作可能保存配置、发送多次模型请求并消耗服务额度。', () => void discover.run(
      () => api.discoverAssistantModels(token, snapshot), (d) => {
        const next = api.modelList(d); setModels(next);
        setDraft({ ...snapshot, model: next.model, model_candidates: next.candidates, api_key: '' });
        setNotice(`已获取 ${next.catalog.length} 个模型，其中 ${Object.values(next.benchmarks).filter((r) => r.ok).length} 个可用`);
      }, '模型测速失败', { onCommitted: () => { assistantQuery.invalidate(); assistantQuota.invalidate({ token }); } },
    ));
  };
  const preset = () => {
    if (!values || busy) return;
    const same = values.base_url === GATEWAY && values.models_url === '';
    change({ ...values, name: '绘云彩彩中转站', base_url: GATEWAY, models_url: '', ...(same ? {} : { model: '', model_candidates: [] }) });
    setNotice('已填入中转站地址，请使用 picpony- 开头的客户端密钥，保存后再获取模型列表');
  };
  return <ReadState title="助手模型加载失败" loading={read.loading} error={read.error} retry={read.retryable ? read.refresh : undefined}>
    {values && <AdminForm aria-label="助手模型配置" onSubmit={saveConfig}>
      <SectionHeading as="h3">助手模型</SectionHeading>
      <AdminNote>{read.data?.hasKey ? '已保存助手密钥，留空即可保留。' : '尚未保存助手密钥。'}测试连接和只获取模型列表使用已保存的配置。</AdminNote>
      <Button type="button" variant="tonal" onClick={preset} disabled={busy}>使用绘云彩彩中转站</Button>
      <SettingsFields fields={assistantFields} values={values} onChange={change} busy={busy} errors={errors} />
      <SectionHeading as="h3">候选模型</SectionHeading>
      <AdminNote>选择后，只在所选模型中使用延迟较低的模型；清空选择会在全部可用模型中自动选择。修改候选后请保存配置。</AdminNote>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="tonal" loading={list.busy} disabled={!sameProvider || !read.data?.hasKey || Boolean(values.api_key) || values.clear_key === true || save.busy || discover.busy || test.busy} onClick={fetchModels}>只获取模型列表</Button>
        <Button type="button" variant="tonal" loading={discover.busy} disabled={save.busy || list.busy || test.busy || values.clear_key === true} onClick={benchmark}>获取列表并测速</Button>
        <Button type="button" variant="text" disabled={busy || !candidates.length} onClick={() => change({ ...values, model_candidates: [] })}>清空选择</Button>
      </div>
      {(!sameProvider || values.api_key || values.clear_key) && <p className="text-body-s text-on-surface-variant">请先保存当前地址与密钥，再只获取模型列表。</p>}
      <AdminListAnchor>
        <DataTable rows={modelRows.rows} listKey={modelRows.listKey} rowKey={(r) => r.name} empty="尚未获取模型列表" columns={[
          { key: 'select', header: '选择', leading: true, render: (r) => <Checkbox aria-label={`选择模型 ${r.name}`} checked={candidates.includes(r.name)} disabled={busy} onChange={(checked) => change({ ...values, model_candidates: checked ? [...candidates, r.name] : candidates.filter((x) => x !== r.name) })} /> },
          { key: 'name', header: '模型', primary: true, className: 'wrap-anywhere', render: (r) => r.name },
          /* Three states, not two: no benchmark at all is 未测速, a benchmark that reported a duration
             prints it, and one that said `ok` without a duration is 可用 — the model was tested and
             works, so 未测速 would be untrue and a 0 would be invented (G2-003). */
          { key: 'latency', header: '测试结果', render: (r) => r.result ? <Badge tone={r.result.ok ? 'success' : 'error'}>{r.result.ok ? (r.result.latency === null ? '可用' : `${r.result.latency} 毫秒`) : '不可用'}</Badge> : '未测速' },
        ]} />
        <AdminPager page={modelRows.page} totalPages={modelRows.totalPages} onPageChange={modelRows.setPage} />
      </AdminListAnchor>
      {errors.form && <p role="alert" className="text-body-s text-error">{errors.form}</p>}
      {notice && <p role="status" className="text-body-m">{notice}</p>}
      <FormActions>
        <Button type="button" variant="tonal" loading={test.busy} disabled={!read.data?.hasKey || save.busy || list.busy || discover.busy} onClick={() => confirmThen('确认测试助手连接', '确定要使用已保存的助手配置发送一次模型测试请求吗？测试可能消耗服务额度。', () => void test.run(() => api.testAssistant(token), (d) => setNotice(d.latency_ms == null ? '连接成功' : `连接成功，耗时 ${d.latency_ms} 毫秒`), '助手连接测试失败'))}>测试助手连接</Button>
        <Button type="submit" loading={save.busy} disabled={list.busy || discover.busy || test.busy}>保存助手配置</Button>
      </FormActions>
    </AdminForm>}
    {confirmDialog}
  </ReadState>;
}
function AssistantTab({ token }: AdminPanelProps) {
  const quota = useAdminQuery(quotaQuery, token);
  return <div className="space-y-6">
    <SectionHeader section="ai-assistant" onRefresh={() => { assistantQuery.invalidate(); quota.refresh(); }} isLoading={quota.refreshing} />
    <Provider token={token} />
    <ReadState title="额度规则加载失败" loading={quota.loading} error={quota.error} retry={quota.retryable ? quota.refresh : undefined}>
      {quota.data && <ConfigEditor title="额度规则" token={token} initial={quota.data} fields={quotaFields} validate={(v) => fieldsPayload(quotaFields, v)} save={(v) => api.saveAiQuota(token, v)} refresh={() => { quotaQuery.invalidate(); assistantQuota.invalidate({ token }); }} confirmation={() => '确定要修改全站彩彩 AI 额度规则吗？每日赠送与金币兑换比例将使用新规则。'}>
        <AdminNote>仅登录用户可使用。成功回复扣 1 点，成功任务共扣 2 点。每日赠送在北京时间零点清零，兑换余额保留。</AdminNote>
      </ConfigEditor>}
    </ReadState>
  </div>;
}
export default protectedPanel(AssistantTab);
