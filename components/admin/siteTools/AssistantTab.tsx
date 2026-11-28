'use client';

import { useEffect, useRef, useState } from 'react';
import { MdAdd, MdDeleteOutline, MdEdit } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Collapse from '@/components/Collapse';
import DataTable from '@/components/DataTable';
import FollowHeight from '@/components/FollowHeight';
import IconButton from '@/components/IconButton';
import { PageLoadingIndicator } from '@/components/LoadingIndicator';
import SectionHeading from '@/components/SectionHeading';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { MOTION_SPEED_SCALE, motionTier } from '@/lib/appearance';
import { formatDateTime } from '@/lib/format';
import {
  coerceThinkingForProvider,
  fieldsPayload,
  GATEWAY,
  normalizeProviderType,
  providerFieldsFor,
  providerPayload,
  providerValues,
  quotaFields,
  validateModelName,
  type Values,
} from '@/lib/adminSiteTools/model';
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

type Config = Awaited<ReturnType<typeof api.readAssistantConfig>>;

/**
 * One provider's form. Saving sends the whole configuration under the list's revision; the answer
 * is the whole list again, which replaces the read. Models are discovered and benchmarked against
 * the **saved** address and key only — the backend takes no URL or key on a probe.
 */
function ProviderEditor({
  token,
  config,
  provider,
  onDone,
}: {
  token: string;
  config: Config;
  provider: api.Provider | null;
  onDone: () => void;
}) {
  const [values, setValues] = useState<Values>(() => providerValues(provider));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const probeAbortRef = useRef<AbortController | null>(null);
  const save = useAdminMutation(token),
    probe = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const busy = save.busy || probe.busy;
  const providerType = normalizeProviderType(values.provider_type);
  const fields = providerFieldsFor(providerType);
  /* The saved row's discovered catalogue (re-read after discovery). */
  const catalog = provider ? provider.model_catalog : [];
  const modelRows = usePagedRows(
    catalog.map((name) => ({ name })),
    provider?.id ?? 'new',
    20,
  );
  const selectedModel = typeof values.model === 'string' ? values.model.trim() : '';
  const keyReady = Boolean(provider?.has_key && provider.key_available);
  const unsaved =
    !provider ||
    providerType !== provider.provider_type ||
    values.base_url !== provider.base_url ||
    Boolean(values.api_key) ||
    values.clear_key === true;
  const unsavedModel = Boolean(provider && selectedModel !== provider.model);
  useEffect(
    () => () => {
      probeAbortRef.current?.abort();
      probeAbortRef.current = null;
    },
    [token, provider?.id],
  );
  const change = (next: Values) => {
    const nextType = normalizeProviderType(next.provider_type);
    const adjusted =
      nextType !== providerType ? { ...next, thinking: coerceThinkingForProvider(nextType, next.thinking) } : next;
    setValues(adjusted);
    setErrors({});
    setNotice('');
  };
  const submit = () => {
    if (busy) return;
    let draft: ReturnType<typeof providerPayload>;
    try {
      draft = providerPayload(values);
      setErrors({});
    } catch (error) {
      setErrors(fieldErrors(error));
      return;
    }
    confirmThen(
      '确认保存模型配置',
      `确定要保存「${draft.name}」吗？${draft.clear_key ? '已保存的密钥将被清除。' : draft.is_primary ? '该配置将设为主模型，原主模型改为备用。' : ''}`,
      () =>
        void save.run(
          () => api.saveAssistantProvider(token, config.revision, draft, provider?.id),
          () => {
            showToast('已保存模型配置', 'success');
            onDone();
          },
          '模型配置保存失败',
          {
            onCommitted: (d) => {
              assistantQuery.write(token, d.config);
              assistantQuota.invalidate({ token });
            },
          },
        ),
      { tone: draft.clear_key ? 'danger' : 'filled' },
    );
  };
  const run = (kind: 'discover' | 'benchmark', model?: string, pendingKey?: string) => {
    if (busy || !provider) return;
    probeAbortRef.current?.abort();
    const abortController = new AbortController();
    probeAbortRef.current = abortController;
    const providerId = provider.id;
    void probe.run(
      () => api.probeProvider(token, providerId, config.revision, kind, model, abortController.signal),
      (d) =>
        setNotice(
          d.ok
            ? kind === 'discover'
              ? `已获取 ${d.result.models?.length ?? 0} 个模型`
              : `${model} 连接正常，耗时 ${d.result.latency_ms} 毫秒`
            : `${kind === 'discover' ? '获取模型列表' : `测试 ${model} `}失败：${d.failure}`,
        ),
      kind === 'discover' ? '模型列表获取失败' : '模型连接测试失败',
      {
        key: pendingKey ?? (kind === 'discover' ? 'discover' : `benchmark:${model ?? ''}`),
        /* Optimistically advance the cached revision (and discovered catalogue) before re-reading so
           back-to-back probes or saves never collide with a stale revision 409. */
        onCommitted: (d) => {
          const current = assistantQuery.peek(token).data;
          if (current && typeof d.revision === 'number') {
            assistantQuery.write(token, {
              ...current,
              revision: d.revision,
              providers:
                d.ok && kind === 'discover' && Array.isArray(d.result.models)
                  ? current.providers.map((item) =>
                      item.id === providerId ? { ...item, model_catalog: d.result.models! } : item,
                    )
                  : current.providers,
            });
          }
          assistantQuery.invalidate(token);
        },
      },
    );
  };
  const presetGateway = () =>
    change({
      ...values,
      name: values.name || '绘云彩彩中转站',
      provider_type: 'openai_compatible',
      base_url: GATEWAY,
      thinking: coerceThinkingForProvider('openai_compatible', values.thinking),
    });
  return (
    <AdminForm
      aria-label={provider ? `编辑模型配置 ${provider.name}` : '添加模型配置'}
      onSubmit={submit}
      className="max-w-none space-y-6"
    >
      <div className="@container/form max-w-2xl space-y-4">
        <SectionHeading as="h3">{provider ? `编辑 · ${provider.name}` : '添加模型配置'}</SectionHeading>
        <AdminNote>
          {provider?.has_key
            ? `已保存密钥${provider.key_hint ? `（${provider.key_hint}）` : ''}，留空即可保留。${provider.key_available ? '' : '当前服务器无法解密该密钥，请重新填写。'}`
            : '尚未保存密钥。'}
        </AdminNote>
        <div>
          <Button type="button" variant="tonal" onClick={presetGateway} disabled={busy}>
            使用绘云彩彩中转站
          </Button>
        </div>
        <SettingsFields fields={fields} values={values} onChange={change} busy={busy} errors={errors} />
      </div>
      {provider && (
        <div className="space-y-4">
          <SectionHeading as="h3">可用模型列表</SectionHeading>
          <AdminNote>获取模型列表后可直接点「选用」填入上方模型名称，或点「测试」检查单个模型的连通性。</AdminNote>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="tonal"
              loading={probe.pendingKeys.has('discover')}
              disabled={busy || unsaved || !keyReady}
              onClick={() =>
                confirmThen(
                  '确认获取模型列表',
                  '确定要使用已保存的地址与密钥获取模型列表吗？',
                  () => run('discover', undefined, 'discover'),
                  { tone: 'filled' },
                )
              }
            >
              获取模型列表
            </Button>
            {selectedModel && (
              <Button
                type="button"
                variant="surface"
                loading={probe.pendingKeys.has('benchmark-current')}
                disabled={busy || unsaved || !keyReady}
                onClick={() => {
                  const problem = validateModelName(providerType, selectedModel);
                  if (problem) {
                    setErrors((prev) => ({ ...prev, model: problem }));
                    return;
                  }
                  confirmThen(
                    '确认测试模型',
                    `确定要向「${selectedModel}」发送一次测试请求吗？测试可能消耗服务额度。`,
                    () => run('benchmark', selectedModel, 'benchmark-current'),
                    { tone: 'filled' },
                  );
                }}
              >
                测试当前模型
              </Button>
            )}
          </div>
          {unsaved ? (
            <p className="text-body-s text-on-surface-variant">请先保存当前接口协议、地址与密钥，再获取模型或测试。</p>
          ) : !keyReady ? (
            <p className="text-body-s text-on-surface-variant">
              {provider.has_key
                ? '当前服务器无法解密已保存的密钥，请重新填写并保存后再测试。'
                : '请先保存密钥再获取模型或测试。'}
            </p>
          ) : unsavedModel ? (
            <p className="text-body-s text-on-surface-variant">
              模型名称已修改但尚未保存，点击下方「保存模型配置」后生效。
            </p>
          ) : null}
          <AdminListAnchor>
            <DataTable
              rows={modelRows.rows}
              listKey={modelRows.listKey}
              rowKey={(r) => r.name}
              empty="尚未获取模型列表"
              columns={[
                {
                  key: 'name',
                  header: '模型',
                  primary: true,
                  className: 'wrap-anywhere',
                  render: (r) => (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span>{r.name}</span>
                      {selectedModel === r.name && (
                        <Badge tone="success" size="sm">
                          {provider.model === r.name ? '当前选用' : '当前选用（未保存）'}
                        </Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'actions',
                  header: '操作',
                  actions: true,
                  render: (r) => (
                    <>
                      <Button
                        type="button"
                        size="xs"
                        variant={selectedModel === r.name ? 'text' : 'tonal'}
                        disabled={busy || selectedModel === r.name}
                        onClick={() => change({ ...values, model: r.name })}
                      >
                        {selectedModel === r.name ? '已选用' : '选用'}
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="text"
                        loading={probe.pendingKeys.has(`benchmark:${r.name}`)}
                        disabled={busy || unsaved || !keyReady}
                        onClick={() =>
                          confirmThen(
                            '确认测试模型',
                            `确定要向「${r.name}」发送一次测试请求吗？测试可能消耗服务额度。`,
                            () => run('benchmark', r.name, `benchmark:${r.name}`),
                            { tone: 'filled' },
                          )
                        }
                      >
                        测试
                      </Button>
                    </>
                  ),
                },
              ]}
            />
            <AdminPager page={modelRows.page} totalPages={modelRows.totalPages} onPageChange={modelRows.setPage} />
          </AdminListAnchor>
        </div>
      )}
      {errors.form && (
        <p role="alert" className="text-body-s text-error">
          {errors.form}
        </p>
      )}
      {notice && (
        <p role="status" className="text-body-m tabular-nums">
          {notice}
        </p>
      )}
      <FormActions className={!provider ? 'max-w-2xl' : ''}>
        <Button type="button" variant="text" disabled={busy} onClick={onDone}>
          收起
        </Button>
        <Button type="submit" variant="filled" loading={save.busy} disabled={probe.busy}>
          保存模型配置
        </Button>
      </FormActions>
      {confirmDialog}
    </AdminForm>
  );
}

const PROVIDER_EDITOR_ID = 'admin-assistant-provider-editor';
const COLLAPSE_WATCHDOG_MS = Math.ceil(1000 * MOTION_SPEED_SCALE.slow);

function Providers({ token, read }: { token: string; read: ReturnType<typeof useAdminQuery<Config>> }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  /* Hold the last edited target (and provider snapshot if deleted) while `Collapse` glides closed. */
  const [shownEditing, setShownEditing] = useState<string | 'new' | null>(null);
  const [cachedProvider, setCachedProvider] = useState<api.Provider | null>(null);
  const remove = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const config = read.data;
  const liveShownProvider =
    config && shownEditing && shownEditing !== 'new'
      ? (config.providers.find((p) => p.id === shownEditing) ?? null)
      : null;
  const shownProvider =
    shownEditing && shownEditing !== 'new'
      ? (liveShownProvider ?? (cachedProvider?.id === shownEditing ? cachedProvider : null))
      : null;
  const editorOpen = Boolean(
    config && editing && (editing === 'new' || config.providers.some((p) => p.id === editing)),
  );

  const openOrToggle = (target: string | 'new') => {
    if (editing === target) {
      setEditing(null);
      if (motionTier('list') === 'off') {
        setShownEditing(null);
        setCachedProvider(null);
      }
      return;
    }
    const found = target === 'new' ? null : (config?.providers.find((p) => p.id === target) ?? null);
    setCachedProvider(found);
    setShownEditing(target);
    setEditing(target);
  };

  const closeEditor = () => {
    setEditing(null);
    if (motionTier('list') === 'off') {
      setShownEditing(null);
      setCachedProvider(null);
    }
  };

  useEffect(() => {
    if (editorOpen || !shownEditing) return;
    if (motionTier('list') === 'off') {
      const frame = requestAnimationFrame(() => {
        setShownEditing(null);
        setCachedProvider(null);
      });
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(() => {
      setShownEditing(null);
      setCachedProvider(null);
    }, COLLAPSE_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [editorOpen, shownEditing]);

  return (
    <ReadState
      variant="table"
      title="助手模型加载失败"
      loading={read.loading}
      error={read.error}
      retry={read.retryable ? read.refresh : undefined}
    >
      {config && (
        <section className="space-y-4" aria-labelledby="admin-assistant-providers-heading">
          <SectionHeading as="h3" id="admin-assistant-providers-heading">
            助手模型
          </SectionHeading>
          <AdminNote>{`主模型不可用时按备用顺序依次尝试。最多 ${api.PROVIDER_LIMIT} 个配置；启用的配置须已保存密钥。`}</AdminNote>
          <DataTable
            rows={config.providers}
            rowKey={(p) => p.id}
            empty="尚未添加模型配置"
            columns={[
              {
                key: 'name',
                header: '配置',
                primary: true,
                className: 'wrap-anywhere',
                render: (p) => (
                  <span className="inline-flex flex-col items-start gap-1">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span>{p.name}</span>
                      <Badge tone="neutral" size="sm">
                        {p.provider_type === 'gemini' ? 'Gemini' : 'OpenAI'}
                      </Badge>
                    </span>
                    <span className="text-body-s text-on-surface-variant">{p.model || '未选择模型'}</span>
                  </span>
                ),
              },
              {
                key: 'role',
                header: '角色',
                width: 'auto',
                className: 'tabular-nums',
                render: (p) =>
                  p.is_primary ? (
                    <Badge tone="success" size="md">
                      主模型
                    </Badge>
                  ) : (
                    `备用 #${p.fallback_rank}`
                  ),
              },
              {
                key: 'state',
                header: '状态',
                width: 'auto',
                render: (p) => (
                  <Badge size="md" tone={p.enabled ? (p.key_available ? 'success' : 'error') : 'neutral'}>
                    {p.enabled ? (p.key_available ? '已启用' : '密钥不可用') : '未启用'}
                  </Badge>
                ),
              },
              {
                key: 'updated',
                header: '更新时间',
                width: 'auto',
                className: 'tabular-nums',
                render: (p) => formatDateTime(p.updated_at),
              },
              {
                key: 'actions',
                header: '操作',
                actions: true,
                render: (p) => (
                  <>
                    <IconButton
                      size="sm"
                      icon={<MdEdit />}
                      aria-label={`编辑 ${p.name}`}
                      aria-expanded={editing === p.id}
                      aria-controls={PROVIDER_EDITOR_ID}
                      disabled={remove.busy}
                      onClick={() => openOrToggle(p.id)}
                    />
                    <IconButton
                      size="sm"
                      variant="danger-text"
                      icon={<MdDeleteOutline />}
                      aria-label={`删除 ${p.name}`}
                      loading={remove.pendingKeys.has(p.id)}
                      onClick={() =>
                        confirmThen(
                          '确认删除模型配置',
                          `确定要删除「${p.name}」吗？此配置的密钥将一并清除，此操作无法恢复。`,
                          () =>
                            void remove.run(
                              () => api.removeAssistantProvider(token, config.revision, p.id),
                              () => {
                                showToast('已删除模型配置', 'success');
                                if (editing === p.id) closeEditor();
                              },
                              '模型配置删除失败',
                              {
                                key: p.id,
                                onCommitted: (d) => {
                                  assistantQuery.write(token, d);
                                  assistantQuota.invalidate({ token });
                                },
                              },
                            ),
                          { tone: 'danger' },
                        )
                      }
                    />
                  </>
                ),
              },
            ]}
          />
          <div>
            <Button
              variant="tonal"
              icon={<MdAdd />}
              aria-expanded={editing === 'new'}
              aria-controls={PROVIDER_EDITOR_ID}
              disabled={config.providers.length >= api.PROVIDER_LIMIT && editing !== 'new'}
              onClick={() => openOrToggle('new')}
            >
              添加模型配置
            </Button>
            <Collapse
              id={PROVIDER_EDITOR_ID}
              open={editorOpen}
              onTransitionEnd={(event) => {
                if (
                  event.target === event.currentTarget &&
                  event.propertyName === 'grid-template-rows' &&
                  !editorOpen
                ) {
                  setShownEditing(null);
                  setCachedProvider(null);
                }
              }}
            >
              {shownEditing && (shownEditing === 'new' || shownProvider) && (
                <div className="pt-4">
                  <FollowHeight watch={shownEditing}>
                    <ProviderEditor
                      key={shownEditing}
                      token={token}
                      config={config}
                      provider={shownProvider}
                      onDone={closeEditor}
                    />
                  </FollowHeight>
                </div>
              )}
            </Collapse>
          </div>
        </section>
      )}
      {confirmDialog}
    </ReadState>
  );
}

function AssistantTab({ token }: AdminPanelProps) {
  const providers = useAdminQuery(assistantQuery, token);
  const quota = useAdminQuery(quotaQuery, token);
  /* Hold initial dual loading behind a single centred indicator until both parallel reads settle
     (data or error), so whichever answers first never paints above the other's indicator and
     shoves it downward mid-load. Refreshes keep `loading` false and never hide settled content. */
  const initialLoading = providers.loading || quota.loading;
  return (
    <div className="space-y-6">
      <SectionHeader
        section="ai-assistant"
        onRefresh={() => {
          providers.refresh();
          quota.refresh();
        }}
        isLoading={providers.refreshing || quota.refreshing}
      />
      {initialLoading ? (
        <PageLoadingIndicator size="pane" holdFooter delay={120} label="正在加载彩彩 AI 设置…" className="min-h-60" />
      ) : (
        <>
          <Providers token={token} read={providers} />
          <ReadState
            title="额度规则加载失败"
            loading={quota.loading}
            error={quota.error}
            retry={quota.retryable ? quota.refresh : undefined}
          >
            {quota.data && (
              <ConfigEditor
                title="额度规则"
                token={token}
                initial={quota.data.values}
                fields={quotaFields}
                validate={(v) => fieldsPayload(quotaFields, v)}
                save={(v) => api.saveAiQuota(token, quota.data!.revision, v)}
                refresh={() => {
                  quotaQuery.invalidate();
                  assistantQuota.invalidate({ token });
                }}
                confirmation={() => '确定要修改全站彩彩 AI 额度规则吗？每日赠送与金币兑换比例将使用新规则。'}
              >
                <AdminNote>
                  成功回复扣 1 点，成功任务共扣 2 点；每日赠送于北京时间零点重置，兑换余额长期保留。
                </AdminNote>
              </ConfigEditor>
            )}
          </ReadState>
        </>
      )}
    </div>
  );
}
export default protectedPanel(AssistantTab);
