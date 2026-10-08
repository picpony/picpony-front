'use client';

import { useRef, useState } from 'react';
import { MdAutoAwesome, MdRefresh } from 'react-icons/md';
import { SettingsSection, SettingsRow, SwitchRow, ROW_CLASS } from '@/app/settings/SettingsRow';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Select from '@/components/Select';
import Skeleton from '@/components/Skeleton';
import ErrorRetry from '@/components/ErrorRetry';
import ProgressBar from '@/components/ProgressBar';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSession, readToken, updateUserInfo } from '@/lib/hooks';
import { useResource } from '@/lib/resource';
import { assistantPermission, assistantQuota } from '@/lib/assistant/queries';
import { useJournalText } from '@/lib/assistant/useJournal';
import { newRequestId, parseExchange, writeJournalText } from '@/lib/assistant/journal';
import { AssistantRefusal, setAssistantEnabled, setAssistantPermission, exchangeAssistantQuota } from '@/lib/api/assistant';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { tasks, coinTransactions } from '@/lib/resources';
import type { AssistantQuota, PermissionMode } from '@/lib/assistant/protocol';
import { ICON } from '@/lib/icons';
import { formatExactCount } from '@/lib/format';
import { settle } from '@/lib/settle';
import QuotaExchangeDialog from './QuotaExchangeDialog';

export default function AssistantSettings() {
  const { token, user } = useSession();
  if (!token || !user?.id) return null;
  return <AccountAssistantSettings key={token} token={token} accountId={String(user.id)} />;
}

function AccountAssistantSettings({ token, accountId }: { token: string; accountId: string }) {
  const quota = useResource(assistantQuota, { token });
  const permission = useResource(assistantPermission, { token });
  const exchange = parseExchange(useJournalText(accountId, 'exchange'));
  const [coins, setCoins] = useState('1');
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const { confirm, confirmDialog } = useConfirm();
  const lock = useRef(false);
  /* 启用彩彩 AI moves when it is pressed and is sent after (the block-group switch's arrangement):
     the switch shows the press while the request is out, and a run of presses sends the last. */
  const [enabledShown, setEnabledShown] = useState<boolean | null>(null);
  const enabling = useRef<{ inFlight: boolean; next: boolean | null }>({ inFlight: false, next: null });
  const current = () => readToken() === token;
  /* A success is a transient status report, so it is a toast (AGENTS: `showToast`) rather than a
     paragraph appended under the rows, where it read as part of the section and stayed there. */
  const setNotice = (message: string) => { if (current()) showToast(message, 'success'); };
  function applyQuota(value: AssistantQuota) {
    if (!current()) return;
    assistantQuota.write({ token }, value);
    updateUserInfo(token, { coins: value.coins });
  }
  /* No `try` in this component: the React Compiler lowers neither a `try` with a `finally` nor a
     conditional inside one, and skipped the whole of it for either (NEW-5). Each handler settles
     its work (`settle`) and branches on the outcome — the same paths, the same order. */
  async function mutate(run: () => Promise<void>) {
    if (lock.current || !current()) return;
    lock.current = true; setBusy(true); setError(undefined);
    const outcome = await settle(run());
    if (!outcome.ok && current()) setError(outcome.error);
    lock.current = false; setBusy(false);
  }
  /** One press sent and applied — a failure of either is the press failing. */
  async function sendEnabled(want: boolean) {
    const value = await setAssistantEnabled(token, want);
    if (!current()) return;
    applyQuota(value);
    if (enabling.current.next === null) {
      setEnabledShown(null);
      setNotice(want ? '已启用彩彩 AI' : '已关闭彩彩 AI');
    }
  }
  /** Sends the latest press until none is waiting; stops when the account changed under it. */
  async function drainEnabled(queue: { inFlight: boolean; next: boolean | null }) {
    while (queue.next !== null) {
      const want = queue.next;
      queue.next = null;
      const outcome = await settle(sendEnabled(want));
      if (!current()) return;
      if (!outcome.ok) {
        /* Back to what the server holds, with the reason; a press made meanwhile is dropped
           with it rather than sent against an answer the user has not seen. */
        queue.next = null;
        setEnabledShown(null);
        showToast(apiErrorMessage(outcome.error), 'error');
      }
    }
  }
  async function changeEnabled(enabled: boolean) {
    if (!current()) return;
    setEnabledShown(enabled);
    const queue = enabling.current;
    queue.next = enabled;
    if (queue.inFlight) return;
    queue.inFlight = true;
    /* The queue is let go however the run ends — drained, the account changed, or a throw. */
    await settle(drainEnabled(queue));
    queue.inFlight = false;
  }
  async function changePermission(mode: PermissionMode) {
    if (busy || !permission.data || mode === permission.data) return;
    if (mode === 'full' && !await confirm({
      title: '确认开启完全权限', tone: 'danger',
      message: '确定要让彩彩免去逐次确认，按你的指令修改、发送、删除账户内容或消耗金币吗？模型可能理解错误，操作不一定能够撤销。这不会绕过密码、隐私锁或账户权限，你可以随时切回默认模式。',
    })) return;
    if (!current()) return;
    await mutate(async () => {
      const saved = await setAssistantPermission(token, mode);
      if (!current()) return;
      assistantPermission.write({ token }, saved); setNotice('已保存权限规则');
    });
  }
  async function exchangeCoins() {
    const amount = exchange?.coins ?? Number(coins);
    /* The dialog already refuses these on its field and disables 确认兑换, so reaching here with one
       is a race rather than a user error — there is nothing to announce. */
    if (busy || !quota.data || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000) return;
    if (!exchange && amount > quota.data.coins) return;
    if (!current()) return;
    await mutate(async () => {
      const pending = exchange ?? { coins: amount, requestId: newRequestId(), pointsPerCoin: quota.data!.points_per_coin };
      writeJournalText(accountId, 'exchange', JSON.stringify(pending));
      const outcome = await settle(exchangeAssistantQuota(token, pending.coins, pending.requestId));
      if (!outcome.ok) {
        /* A refusal is the server's answer, so nothing is left to check; anything else keeps the
           journal for 核对兑换. Thrown on, for `mutate` to show. */
        if (current() && outcome.error instanceof AssistantRefusal) writeJournalText(accountId, 'exchange', null);
        throw outcome.error;
      }
      if (!current()) return;
      applyQuota(outcome.value); writeJournalText(accountId, 'exchange', null);
      tasks.expire({ token }); coinTransactions.expire(); setNotice('已兑换额度'); setExchangeOpen(false);
    });
  }
  const problem = quota.error ?? permission.error;
  const refresh = () => { void quota.refresh(); void permission.refresh(); };
  return <>
    {/* No neighbour dims while one request is out (AGENTS: busy is active, disabled is
        unavailable — a native `disabled` on a control that was just used drops its focus to the
        document). Each action guards its own second press instead. */}
    <SettingsSection title="彩彩 AI" icon={<MdAutoAwesome size={ICON.control} />} subtitle="权限与额度随当前账户保存" actions={<IconButton aria-label="刷新彩彩 AI 设置" onClick={refresh} icon={<MdRefresh size={ICON.standard} />} />}>
      {!quota.data || !permission.data ? !problem && <AssistantSettingsSkeleton /> : <>
        <SwitchRow label="启用彩彩 AI" checked={enabledShown ?? quota.data.user_enabled} onChange={enabled => void changeEnabled(enabled)} description={!quota.data.enabled ? '管理员暂未开放彩彩 AI，你的选择仍会保留' : '开启后可长按吉祥物与彩彩聊天'} />
        <SettingsRow label="权限规则" supporting={permission.data === 'full' ? '按你的指令直接执行，不再逐次确认' : '写入、发送和删除等操作执行前需要确认'}
          action={<Select aria-label="彩彩 AI 权限规则" size="sm" value={permission.data} options={[{ value: 'default', label: '默认模式' }, { value: 'full', label: '完全权限' }]} onChange={mode => void changePermission(mode)} />} />
        <QuotaRow quota={quota.data} />
        <SettingsRow label="兑换额度"
          supporting={exchange ? '上次兑换尚未确认，可沿用原标识核对结果' : <>现有 <span className="tabular-nums">{formatExactCount(quota.data.coins)}</span> 金币 · 1 金币兑换 {quota.data.points_per_coin} 点</>}
          action={<Button variant="tonal" onClick={() => { if (busy) return; setError(undefined); setCoins('1'); setExchangeOpen(true); }}>{exchange ? '核对兑换' : '兑换'}</Button>} />
      </>}
      {problem !== undefined && <ErrorRetry size="inline" title="彩彩 AI 设置加载失败" message={apiErrorMessage(problem)} onRetry={isRetryable(problem) ? refresh : undefined} />}
      {error !== undefined && !exchangeOpen && <ErrorRetry size="inline" title="操作未完成" message={apiErrorMessage(error)} />}
    </SettingsSection>
    {quota.data && <QuotaExchangeDialog isOpen={exchangeOpen} onClose={() => { if (!lock.current) setExchangeOpen(false); }} quota={quota.data} pending={exchange} coins={coins} onCoinsChange={setCoins} busy={busy} error={error} onSubmit={() => void exchangeCoins()} />}
    {confirmDialog}
  </>;
}

/**
 * What a user has, then how to get more — two rows, one question each.
 *
 * The total leads, at the trailing edge where a settings row puts its value; under it, the pools it
 * is made of: today's gift as a real meter (it runs down and refills at Beijing midnight, which is
 * what a meter says) and the exchanged balance, which never expires. The costs a reader needs to
 * interpret the number sit in the supporting line. It replaces a row whose label carried the total,
 * whose supporting line repeated the breakdown, and which then stacked a body-m sentence and a
 * body-s footnote under itself — four type treatments for one number.
 */
function QuotaRow({ quota }: { quota: AssistantQuota }) {
  const gift = quota.daily_points > 0 ? Math.round((quota.daily_remaining / quota.daily_points) * 100) : 0;
  return (
    <SettingsRow
      label="可用额度"
      supporting="成功回复扣 1 点，成功任务共扣 2 点"
      action={
        <span className="flex items-baseline gap-1">
          <span className="text-title-m-emphasized text-on-surface tabular-nums">{formatExactCount(quota.remaining)}</span>
          <span className="text-body-s text-on-surface-variant">点</span>
        </span>
      }
    >
      <dl className="mt-3 space-y-3 text-body-s">
        {quota.daily_points > 0 ? (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-on-surface-variant">今日赠送 · 北京时间零点重置</dt>
              <dd className="shrink-0 tabular-nums text-on-surface">
                {formatExactCount(quota.daily_remaining)} / {formatExactCount(quota.daily_points)}
              </dd>
            </div>
            <ProgressBar className="mt-2" value={gift} label={`今日赠送额度剩余 ${quota.daily_remaining} / ${quota.daily_points} 点`} />
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-on-surface-variant">今日赠送</dt>
            <dd className="shrink-0 text-on-surface">暂无</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-on-surface-variant">兑换余额 · 不会清零</dt>
          <dd className="shrink-0 tabular-nums text-on-surface">{formatExactCount(quota.purchased_remaining)}</dd>
        </div>
        {quota.reserved > 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-on-surface-variant">执行中预留</dt>
            <dd className="shrink-0 tabular-nums text-on-surface">{formatExactCount(quota.reserved)}</dd>
          </div>
        )}
      </dl>
    </SettingsRow>
  );
}

/** The loaded rows' own shapes, in one run, so nothing re-spaces when the data lands. */
function AssistantSettingsSkeleton() {
  return <div role="group" aria-label="正在加载彩彩 AI 设置" aria-busy="true">
    {[0, 1].map(i => <div key={i} className={ROW_CLASS}><div className="flex-1 space-y-2"><Skeleton className="h-5 w-28" /><Skeleton className="h-4 w-44" /></div><Skeleton className={i === 0 ? 'h-8 w-13 rounded-full' : 'h-10 w-28'} /></div>)}
    <div className={`${ROW_CLASS} flex-col items-stretch`}>
      <div className="flex items-center gap-4"><div className="flex-1 space-y-2"><Skeleton className="h-5 w-20" /><Skeleton className="h-4 w-48" /></div><Skeleton className="h-6 w-14" /></div>
      <div className="mt-3 space-y-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-1 w-full rounded-full" /><Skeleton className="h-4 w-full" /></div>
    </div>
    <div className={ROW_CLASS}><div className="flex-1 space-y-2"><Skeleton className="h-5 w-20" /><Skeleton className="h-4 w-40" /></div><Skeleton className="h-10 w-18 rounded-full" /></div>
  </div>;
}
