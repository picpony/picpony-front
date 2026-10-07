'use client';

import { useId, useState, type ComponentType, type ReactNode } from 'react';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { Input, Textarea } from '@/components/Input';
import Select from '@/components/Select';
import ToggleSwitch from '@/components/ToggleSwitch';
import Skeleton from '@/components/Skeleton';
import SectionHeading from '@/components/SectionHeading';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import { apiErrorMessage } from '@/lib/api/errors';
import { FormProblem, type FieldSpec, type Values } from '@/lib/adminSiteTools/model';
import { AdminForm, FormActions, FormGrid } from '../AdminForm';
import { retryError } from '../queries';
import { canAccess, type AdminPanelProps } from '../registry';
import { useAdminMutation } from '../useAdminMutation';

export function protectedPanel(Content: ComponentType<AdminPanelProps>) {
  return function SiteToolPanel(props: AdminPanelProps) {
    if (!props.token || !canAccess('admin', props.role)) return <EmptyState size="pane" title="没有权限查看此内容" />;
    return <Content key={props.token} {...props} />;
  };
}

/**
 * A site-tool read's loading and failure states.
 *
 * `title` is **required** and names what failed, because every panel used to print 设置加载失败: on
 * 频率与临时封禁 the content is 频率规则 and 临时封禁, on 访问统计 it is a visitor count, and on
 * 彩彩 AI two reads fail at once and drew two identical blocks with two identically-named 重试
 * buttons, so the operator could not tell which had failed. The Copy table's rule is one string per
 * condition, noun first.
 *
 * It renders the failure **and** the children, so a panel that keeps its own rows on a failed
 * refresh must not also pass the same error to a `tableError` — that is one failure drawn twice,
 * under two different nouns.
 */
export function ReadState({ title, loading, error, retry, children }: { title: string; loading: boolean; error?: string; retry?: () => void; children?: ReactNode }) {
  return <>
    {error && <ErrorRetry size="inline" {...retryError(title, error)} onRetry={retry} />}
    {loading ? <div data-page-loading className="max-w-2xl space-y-4" aria-label="正在加载设置"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-12 w-32" /></div> : children}
  </>;
}
export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof FormProblem ? error.fields : { form: apiErrorMessage(error) };
}
export function SettingsFields({ fields, values, onChange, errors = {}, busy = false }: {
  fields: FieldSpec[]; values: Values; onChange: (next: Values) => void; errors?: Record<string, string>; busy?: boolean;
}) {
  return <FormGrid>{fields.map((f) => {
    const value = values[f.key];
    const set = (v: string | boolean) => onChange({ ...values, [f.key]: v });
    const multiline = ['textarea', 'ips', 'origins'].includes(f.kind ?? '');
    return <div key={f.key} className={multiline || f.kind === 'boolean' ? '@lg/form:col-span-2' : 'min-w-0'}>
      {f.kind === 'boolean' ? <ToggleSwitch layout="row" label={f.label} description={f.helper} checked={value === true} onChange={set} disabled={busy} />
        : f.options ? <><Select label={f.label} value={String(value ?? '')} options={f.options} onChange={set} disabled={busy} />{errors[f.key] && <p role="alert" className="text-body-s text-error">{errors[f.key]}</p>}</>
          : multiline ? <Textarea label={f.label} value={String(value ?? '')} onChange={(e) => set(e.target.value)} readOnly={busy} rows={f.key === 'system_prompt' ? 7 : 4} helper={f.helper} error={errors[f.key]} maxLength={f.max} />
            : <Input label={f.label} value={String(value ?? '')} onChange={(e) => set(e.target.value)} readOnly={busy} type={f.kind === 'password' ? 'password' : 'text'} inputMode={f.kind === 'number' ? (f.decimal ? 'decimal' : 'numeric') : f.kind === 'url' ? 'url' : 'text'} autoComplete={f.kind === 'password' ? 'new-password' : 'off'} helper={f.helper} error={errors[f.key]} maxLength={f.kind === 'number' ? undefined : f.max} />}
    </div>;
  })}</FormGrid>;
}

export function ConfigEditor({ title, token, initial, fields, validate, save, refresh, confirmation, children, saved = '已保存设置' }: {
  title: string; token: string; initial: Values; fields: FieldSpec[]; validate: (v: Values) => unknown;
  save: (v: Values) => Promise<Response>; refresh: (data: Record<string, unknown>, values: Values) => void; confirmation?: (v: Values) => string; children?: ReactNode; saved?: string;
}) {
  const [draft, setDraft] = useState<{ values: Values; savedFrom?: Values } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const values = draft && (!draft.savedFrom || draft.savedFrom === initial) ? draft.values : initial;
  const mutation = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  /* The form is named by its heading, not by an `aria-label` restating it (G4-031). */
  const heading = useId();
  const submit = () => {
    if (mutation.isPending()) return;
    try { validate(values); } catch (error) { setErrors(fieldErrors(error)); return; }
    setErrors({});
    const snapshot = { ...values };
    const commit = () => void mutation.run(() => save(snapshot), () => {
      const clean = { ...snapshot };
      for (const field of fields) {
        if (field.kind === 'password') clean[field.key] = '';
        if (field.key.endsWith('clear_key')) clean[field.key] = false;
      }
      setDraft({ values: clean, savedFrom: initial }); showToast(saved, 'success');
    }, `${title}保存失败`, { onCommitted: (data) => refresh(data, snapshot) });
    if (confirmation) confirmThen(`确认保存${title}`, confirmation(snapshot), commit);
    else commit();
  };
  return <>
    <AdminForm onSubmit={submit} aria-labelledby={heading}>
      <SectionHeading as="h3" id={heading}>{title}</SectionHeading>
      {children}
      <SettingsFields fields={fields} values={values} busy={mutation.busy} errors={errors} onChange={(v) => { setDraft({ values: v }); setErrors({}); }} />
      {errors.form && <p role="alert" className="text-body-s text-error">{errors.form}</p>}
      <FormActions><Button type="submit" loading={mutation.busy}>{`保存${/^[A-Za-z]/.test(title) ? ' ' : ''}${title}`}</Button></FormActions>
    </AdminForm>
    {confirmDialog}
  </>;
}
