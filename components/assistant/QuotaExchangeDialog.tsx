'use client';

import { useId } from 'react';
import Link from 'next/link';
import Modal from '@/components/Modal';
import Input from '@/components/Input';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorRetry from '@/components/ErrorRetry';
import { apiErrorMessage } from '@/lib/api/errors';
import type { AssistantQuota } from '@/lib/assistant/protocol';
import type { PendingExchange } from '@/lib/assistant/journal';
import { formatExactCount } from '@/lib/format';

export default function QuotaExchangeDialog({ isOpen, onClose, quota, pending, coins, onCoinsChange, busy, error, onSubmit }: {
  isOpen: boolean;
  onClose: () => void;
  quota: AssistantQuota;
  pending: PendingExchange | null;
  coins: string;
  onCoinsChange: (value: string) => void;
  busy: boolean;
  error: unknown;
  onSubmit: () => void;
}) {
  const formId = useId();
  const amount = pending?.coins ?? Number(coins);
  const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= 100000;
  const insufficient = valid && !pending && amount > quota.coins;
  const rate = pending ? pending.pointsPerCoin : quota.points_per_coin;
  const points = valid && rate ? amount * rate : null;
  const fieldError = !valid && coins !== '' ? '请输入 1 至 100000 的整数' : insufficient ? '金币不足，请减少兑换数量' : undefined;
  return <Modal isOpen={isOpen} onClose={onClose} title="兑换彩彩额度" maxWidth="sm" closeOnEscape={!busy} closeOnOverlayClick={!busy}
    footer={<>
      <Button variant="text" disabled={busy} onClick={onClose}>{pending ? '稍后' : '取消'}</Button>
      <Button form={formId} type="submit" variant="filled" disabled={!valid || insufficient} loading={busy}>{pending ? '核对结果' : '确认兑换'}</Button>
    </>}>
    <form id={formId} onSubmit={event => { event.preventDefault(); if (valid && !insufficient && !busy) onSubmit(); }} className="space-y-5">
      <p className="text-body-m text-on-surface-variant">现有 <span className="text-on-surface tabular-nums">{formatExactCount(quota.coins)}</span> 金币，1 金币可兑换 {quota.points_per_coin} 点额度。</p>
      <Input label="使用金币" type="number" inputMode="numeric" min={1} max={100000} step={1} value={pending ? String(pending.coins) : coins} disabled={busy || !!pending} onChange={e => onCoinsChange(e.target.value)} error={fieldError} data-autofocus="" />
      {/* `filled` is the step for "a distinct block inside this one" (AGENTS' container table); the
          values take `title-l` so the dialog's own `headline-s` title stays the top of the hierarchy. */}
      <Card>
        <dl className="grid grid-cols-2 gap-4">
          <div><dt className="text-body-s text-on-surface-variant">消耗金币</dt><dd className="text-title-l text-on-surface tabular-nums mt-1">{valid ? formatExactCount(amount) : '—'}</dd></div>
          <div><dt className="text-body-s text-on-surface-variant">获得额度</dt><dd className="text-title-l text-on-surface tabular-nums mt-1">{points === null ? '待核对' : `${formatExactCount(points)} 点`}</dd></div>
        </dl>
      </Card>
      {busy ? <p className="text-body-s text-on-surface-variant">正在核对兑换结果…</p> : pending ? <p className="text-body-s text-on-surface-variant">上次兑换尚未确认，将沿用同一标识核对。<Link href="/tasks/coins" scroll={false} className="text-link underline underline-offset-2 hover:text-link-hover">查看金币明细</Link></p> : <p className="text-body-s text-on-surface-variant">兑换额度不会随每日赠送额度清零。确认后将扣除所示金币。</p>}
      {error !== undefined && <ErrorRetry size="inline" title="兑换未完成" message={apiErrorMessage(error)} />}
    </form>
  </Modal>;
}
