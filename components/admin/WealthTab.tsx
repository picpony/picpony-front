'use client';

import { useMemo, useState } from 'react';
import { MdToll } from 'react-icons/md';
import Button from '@/components/Button';
import DataTable, { type Column } from '@/components/DataTable';
import { Input } from '@/components/Input';
import Modal from '@/components/Modal';
import SearchInput from '@/components/SearchInput';
import SectionHeading from '@/components/SectionHeading';
import Select from '@/components/Select';
import { showToast } from '@/components/Toast';
import { ICON } from '@/lib/icons';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from './SectionHeader';
import { AdminForm, FormGrid } from './AdminForm';
import { AdminListAnchor, AdminPager, usePagedRows } from './paging';
import { useAdminQuery, tableError } from './queries';
import { usersQuery } from './sharedQueries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';
import { coinsAfter, wealthPayload, wholeNumber, type CoinsOp, type WealthUser } from './wealth';
import { figureField, figureOf, figureText } from './figures';

const EMPTY: WealthUser[] = [];

const COINS_OPS: { value: CoinsOp; label: string }[] = [
  { value: 'add', label: '增加' },
  { value: 'sub', label: '扣除' },
  { value: 'set', label: '设为' },
];

const REASON_LABEL: Record<CoinsOp, string> = {
  add: '增加金币的原因',
  sub: '扣除金币的原因',
  set: '金币变动的原因',
};

/**
 * 经验与金币 (创始人 only). The dialog changes two different things in two different ways, and now says
 * so: experience is *set* to a value, coins are added, deducted or set by an operator named in
 * words (增加 / 扣除 / 设为, not bracketed glyphs), with the result previewed before it is sent.
 *
 * The rows are 用户管理's own read (`usersQuery`, one request for both panels — G4-020). A figure a
 * row did not carry reads 当前 — and is never treated as 0 (G4-015): the table prints `—`, the
 * experience field opens empty, and an add or a deduction against an unknown balance has no
 * preview to show, so it shows none.
 */
export default function WealthTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(usersQuery, token);
  const users: readonly WealthUser[] = read.data?.rows ?? EMPTY;
  const mutation = useAdminMutation(token);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ user: WealthUser; open: boolean; session: number } | null>(null);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter((user) => String(user.id) === keyword || user.username?.toLowerCase().includes(keyword));
  }, [users, query]);
  const paged = usePagedRows(filtered, query.trim());

  const open = (user: WealthUser) =>
    setEditing((current) => ({ user, open: true, session: (current?.session ?? 0) + 1 }));
  const close = () => {
    if (editing && mutation.isPending(editing.user.id)) return;
    setEditing((current) => (current ? { ...current, open: false } : current));
  };

  const columns: Column<WealthUser>[] = [
    {
      key: 'name',
      header: '用户名',
      primary: true,
      render: (user) => <span className="text-body-m-emphasized text-on-surface">{user.username}</span>,
    },
    { key: 'id', header: 'ID', width: 'auto', render: (user) => `#${user.id}` },
    { key: 'exp', header: '经验', render: (user) => <span className="tabular-nums">{figureText(user.experience)}</span> },
    {
      key: 'coins',
      header: '金币',
      render: (user) => (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <MdToll size={ICON.dense} aria-hidden="true" className="text-on-surface-variant" />
          {figureText(user.coins)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (user) => (
        <Button size="xs" variant="tonal" onClick={() => open(user)}>
          修改资产
        </Button>
      ),
    },
  ];

  const keyword = query.trim();
  return (
    <div className="space-y-6">
      <SectionHeader section="wealth" onRefresh={read.refresh} isLoading={read.refreshing} />
      <SearchInput value={query} onChange={setQuery} placeholder="搜索用户 ID 或用户名…" />
      <AdminListAnchor>
        <DataTable<WealthUser>
          columns={columns}
          rows={paged.rows}
          listKey={paged.listKey}
          rowKey={(user) => user.id}
          loading={read.loading}
          skeletonRows={8}
          {...tableError('用户列表加载失败', read.error)}
          onRetry={read.retryable ? read.refresh : undefined}
          empty={keyword ? '没有找到匹配的用户' : '暂无用户'}
        />
        <AdminPager
          page={paged.page}
          totalPages={paged.totalPages}
          onPageChange={paged.setPage}
          summary={read.data ? (keyword ? `找到 ${paged.total} 位用户` : `共 ${paged.total} 位用户`) : undefined}
        />
      </AdminListAnchor>
      {editing && (
        <WealthDialog
          key={`${editing.user.id}:${editing.session}`}
          user={editing.user}
          open={editing.open}
          busy={mutation.pendingKeys.has(editing.user.id)}
          onClose={close}
          onSubmit={(payload) =>
            void mutation.run(
              () => adminApi.adminUpdateWealth(token, payload),
              () => {
                showToast(`已更新「${editing.user.username}」的资产`, 'success');
                setEditing((current) => (current ? { ...current, open: false } : current));
              },
              '修改失败',
              { key: editing.user.id, onCommitted: read.refresh },
            )}
        />
      )}
    </div>
  );
}

function WealthDialog({
  user,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  user: WealthUser;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const currentExp = figureOf(user.experience);
  const currentCoins = figureOf(user.coins);
  const [form, setForm] = useState({
    experience: figureField(user.experience),
    experienceReason: '',
    coinsOp: 'add' as CoinsOp,
    coinsValue: '',
    coinsReason: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form | 'form', string>>>({});
  const formId = `wealth-${user.id}`;

  const set = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined, form: undefined }));
  };

  const experience = wholeNumber(form.experience);
  const expChanged = experience !== null && experience !== currentExp;
  const coins = wholeNumber(form.coinsValue);
  /* 设为 needs no balance; adding or deducting does, so an unknown one previews nothing. */
  const coinsResult =
    coins === null ? null : form.coinsOp === 'set' ? coins : currentCoins === null ? null : coinsAfter(currentCoins, form.coinsOp, coins);

  const submit = () => {
    if (busy) return;
    const next: typeof errors = {};
    /* Blank is "leave it": an experience the row did not carry opens empty, and must not stop a
       coin change from being sent. */
    if (form.experience.trim() && experience === null) next.experience = '经验值必须是不小于 0 的整数';
    if (expChanged && !form.experienceReason.trim()) next.experienceReason = '请填写经验值变动的原因';
    if (form.coinsValue.trim() && coins === null) next.coinsValue = '金币数值必须是不小于 0 的整数';
    if (coinsResult !== null && coinsResult < 0) next.coinsValue = `扣除后金币为 ${figureText(coinsResult)}，不能少于 0`;
    if (coins !== null && !form.coinsReason.trim()) next.coinsReason = '请填写金币变动的原因';
    if (!Object.values(next).some(Boolean)) {
      const payload = wealthPayload(user, form);
      if (!payload) next.form = '请修改经验值，或填写要变动的金币数值';
      else {
        onSubmit(payload);
        return;
      }
    }
    setErrors(next);
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      closeOnEscape={!busy}
      title={`修改资产 · ${user.username}`}
      maxWidth="md"
      footer={
        <>
          <Button type="button" variant="text" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" form={formId} variant="filled" loading={busy}>
            确认修改
          </Button>
        </>
      }
    >
      <AdminForm id={formId} onSubmit={submit} className="max-w-none" aria-label={`修改 ${user.username} 的资产`}>
        <SectionHeading as="h3" aside={`当前 ${figureText(user.experience)}`}>经验值</SectionHeading>
        <Input
          label="设为"
          inputMode="numeric"
          autoComplete="off"
          value={form.experience}
          readOnly={busy}
          error={errors.experience}
          helper={expChanged ? `当前 ${figureText(user.experience)} → 修改后 ${figureText(experience)}` : '经验值直接设为这里的数值'}
          onChange={(event) => set('experience', event.target.value)}
          data-autofocus=""
        />
        {expChanged && (
          <Input
            label="经验值变动的原因"
            value={form.experienceReason}
            readOnly={busy}
            error={errors.experienceReason}
            onChange={(event) => set('experienceReason', event.target.value)}
          />
        )}
        <SectionHeading as="h3" aside={`当前 ${figureText(user.coins)}`}>金币</SectionHeading>
        <FormGrid>
          <Select
            label="操作"
            value={form.coinsOp}
            options={COINS_OPS}
            disabled={busy}
            onChange={(value) => set('coinsOp', value)}
          />
          <Input
            label="数值"
            inputMode="numeric"
            autoComplete="off"
            value={form.coinsValue}
            readOnly={busy}
            error={errors.coinsValue}
            helper={coinsResult !== null && coinsResult >= 0 ? `当前 ${figureText(user.coins)} → 修改后 ${figureText(coinsResult)}` : '留空则不变动金币'}
            onChange={(event) => set('coinsValue', event.target.value)}
          />
        </FormGrid>
        {coins !== null && (
          <Input
            label={REASON_LABEL[form.coinsOp]}
            value={form.coinsReason}
            readOnly={busy}
            error={errors.coinsReason}
            helper="会显示在该用户的金币账单中"
            onChange={(event) => set('coinsReason', event.target.value)}
          />
        )}
        {errors.form && (
          <p role="alert" className="px-4 text-body-s text-error">
            {errors.form}
          </p>
        )}
      </AdminForm>
    </Modal>
  );
}
