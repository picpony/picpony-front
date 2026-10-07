'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { MdDeleteOutline, MdRefresh, MdSend } from 'react-icons/md';
import Modal from '@/components/Modal';
import Sheet from '@/components/Sheet';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import ChatBubble from '@/components/ChatBubble';
import { Textarea } from '@/components/Input';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton from '@/components/Skeleton';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSession, useMediaQuery, readToken } from '@/lib/hooks';
import { MEDIA } from '@/lib/constants';
import { formatExactCount } from '@/lib/format';
import { createAssistantSession } from '@/lib/assistant/session';
import { actionLabel, actionSupported } from '@/lib/assistant/actions';
import { assistantQuota } from '@/lib/assistant/queries';
import { MAX_MESSAGE } from '@/lib/assistant/protocol';
import { useResource, SKIP } from '@/lib/resource';
import { cn } from '@/lib/utils';
import styles from './AssistantPanel.module.css';

export default function AssistantPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { token, user } = useSession();
  if (!token || !user?.id) return null;
  return <Conversation key={token} token={token} accountId={String(user.id)} isOpen={isOpen} onClose={onClose} />;
}

function Conversation({ token, accountId, isOpen, onClose }: { token: string; accountId: string; isOpen: boolean; onClose: () => void }) {
  const router = useRouter();
  const [session] = useState(() => createAssistantSession(token, accountId, {
    active: () => !document.hidden && assistantQuota.peek({ token }).data?.user_enabled !== false,
    navigate: href => {
      const target = new URL(href, window.location.href);
      target.searchParams.sort();
      const arrived = () => {
        const current = new URL(window.location.href); current.searchParams.sort();
        return current.pathname === target.pathname && current.search === target.search;
      };
      if (arrived()) return Promise.resolve();
      router.push(href, { scroll: false });
      const start = performance.now();
      return new Promise<void>((resolve, reject) => {
        const check = () => {
          if (readToken() !== token || document.hidden) { reject(new Error('会话已暂停，未继续执行后续操作')); return; }
          if (arrived()) { resolve(); return; }
          if (performance.now() - start > 30000) { reject(new Error('页面尚未完成切换，请先核对当前页面')); return; }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
    },
  }));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const quota = useResource(assistantQuota, state.available ? { token } : SKIP);
  const desktop = useMediaQuery(MEDIA.sm, true);
  const [history, setHistory] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const focusPending = useRef(false);
  const interacted = useRef(false);
  const nearEnd = useRef(true);
  const attached = useRef(false);
  const close = () => { session.setActive(false); onClose(); };
  useEffect(() => {
    session.setActive(isOpen);
    if (isOpen) { focusPending.current = true; interacted.current = false; }
    if (isOpen && !session.getSnapshot().ready) void session.restore();
  }, [session, isOpen]);
  useEffect(() => {
    if (isOpen && state.available && !state.loading && focusPending.current && !interacted.current) {
      focusPending.current = false; composer.current?.focus({ preventScroll: true });
    }
  }, [isOpen, state.available, state.loading]);
  useEffect(() => {
    attached.current = true;
    return () => { attached.current = false; queueMicrotask(() => { if (!attached.current) session.dispose(); }); };
  }, [session]);
  useEffect(() => {
    if (isOpen && quota.data && (!quota.data.enabled || !quota.data.user_enabled)) onClose();
  }, [isOpen, quota.data, onClose]);
  useEffect(() => {
    if (nearEnd.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [state.messages, state.receipts, state.pending, state.task, state.error, history]);
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    const sync = () => {
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const inset = viewport ? Math.max(0, window.innerHeight - height - viewport.offsetTop) : 0;
      root.style.setProperty('--picpony-assistant-keyboard', `${inset}px`);
      root.style.setProperty('--picpony-assistant-height', `${height - 16}px`);
    };
    sync(); window.visualViewport?.addEventListener('resize', sync); window.visualViewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      window.visualViewport?.removeEventListener('resize', sync); window.visualViewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      root.style.removeProperty('--picpony-assistant-keyboard'); root.style.removeProperty('--picpony-assistant-height');
    };
  }, [isOpen]);
  const current = () => readToken() === token;
  const messages = history ? state.messages : state.messages.slice(-6);
  const canSend = state.available && !state.loading && !state.busy && !state.task?.confirmation_token && quota.data?.user_enabled !== false && (state.pending !== null || quota.data?.remaining !== 0);
  const text = state.pending?.message ?? state.draft;
  const thread = state.loading && !state.messages.length ? (
    <div role="status" aria-label="正在加载对话" className="flex flex-col gap-3">
      <Skeleton className="h-16 w-4/5 rounded-lg" />
      <Skeleton className="ml-auto h-12 w-3/5 rounded-lg" />
      <Skeleton className="h-20 w-4/5 rounded-lg" />
    </div>
  ) : state.ready && !state.available ? (
    <EmptyState title={state.status || '彩彩 AI 暂不可用'} description="可在账户设置中查看当前开关与额度" size="inline" />
  ) : !messages.length ? (
    <EmptyState title="和彩彩聊聊吧" description="可以查找图片，也可以告诉彩彩你想处理的站内任务" size="inline" />
  ) : (
    /* A thread, read as /messages reads one: who spoke is the side and the cut corners, so a
       run of one speaker sits 2dp apart and a new speaker 12dp below. (Each bubble used to carry
       彩彩 / 你 in the slot `ChatBubble` keeps for the delivery state.) */
    <ol aria-label={history ? '全部聊天记录' : '最近对话'}>
      {messages.map((message, index) => {
        const own = message.role === 'user';
        const startOfRun = index === 0 || messages[index - 1].role !== message.role;
        const endOfRun = index === messages.length - 1 || messages[index + 1].role !== message.role;
        return (
          <li key={message.id > 0 ? message.id : `${message.role}-${index}`} className={cn('group', index > 0 && (startOfRun ? 'mt-3' : 'mt-0.5'))}>
            <ChatBubble own={own} startOfRun={startOfRun} endOfRun={endOfRun}>{message.content.replaceAll('||', '\n\n')}</ChatBubble>
            {history && message.id > 0 && (
              <div className={cn('hover-reveal flex', own ? 'justify-end' : 'justify-start')}>
                <IconButton size="sm" aria-label={`删除第 ${index + 1} 条消息`} disabled={state.busy} icon={<MdDeleteOutline />} onClick={async () => {
                  if (await confirm({ title: '确认删除', message: '确定要删除此条聊天记录吗？' }) && current()) void session.removeMessage(message.id);
                }} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
  const content = <div className={styles.conversation} data-assistant-conversation="" onPointerDownCapture={() => { interacted.current = true; }} onKeyDownCapture={event => { if (event.key === 'Tab') interacted.current = true; }}>
    {/* 全部记录 is a filter over the same thread, so a filter chip: one label, `aria-pressed`
        both ways. It was a text button whose label became the other state's name while it
        reported being pressed. No close control here on a phone: the sheet's handle, its scrim
        and Back close it, as every other sheet's do; the dialog's header has its own. */}
    <div className="flex flex-wrap items-center gap-2">
      <Chip variant="filter" selected={history} onClick={() => setHistory(value => !value)}>全部记录</Chip>
      {history && <Button variant="danger-text" size="xs" disabled={state.busy || !state.messages.length} onClick={async () => {
        if (await confirm({ title: '确认清空', message: '确定要清空此会话的聊天记录吗？彩彩将不再记得这些内容。' }) && current()) void session.clear();
      }}>清空</Button>}
      {quota.data && <span className="ml-auto text-body-s tabular-nums text-on-surface-variant">剩余 {formatExactCount(quota.data.remaining)} 点</span>}
    </div>
    <div ref={log} className={cn(styles.messages, 'popover-scrollbar pr-1')} onScroll={event => {
      const node = event.currentTarget; nearEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
    }}>
      {/* Pinned to the bottom, as a chat is: a short thread sits just above the field instead of
          leaving the panel's height empty under it. An auto margin, not `justify-content`, so a
          long thread still scrolls to its first message. */}
      <div className="flex min-h-full flex-col gap-3">
        <div className="mt-auto">{thread}</div>
        {state.pending && <Card padding="sm"><p className="text-body-m text-on-surface wrap-anywhere whitespace-pre-wrap">{state.pending.message}</p><p className="mt-2 text-body-s text-on-surface-variant">{state.busy ? '正在等待彩彩回复…' : '此条消息的结果尚未确认，草稿已保留。'}</p>
          {!state.busy && <div className="mt-2 flex flex-wrap gap-2"><Button variant="text" onClick={() => void session.restore()}>核对记录</Button><Button variant="text" onClick={async () => {
            if (await confirm({ title: '确认保留草稿', message: '之前的请求可能已经受理。确定要解除待确认状态并保留文字草稿吗？此操作不会重复发送。' }) && current()) session.discardPending();
          }}>保留草稿</Button></div>}
        </Card>}
        {state.task?.confirmation_token && <Card padding="sm">
          <p className="mb-2 text-title-s text-on-surface">请确认操作</p>
          <ul className="list-disc space-y-2 pl-5 text-body-m text-on-surface">{state.task.actions.map((action, index) => <li key={action.call_id || index}>{actionLabel(action)}</li>)}</ul>
          <div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="text" disabled={state.busy} onClick={() => void session.decide('reject')}>取消</Button><Button variant="filled" loading={state.busy} disabled={state.task.actions.some(action => !actionSupported(action))} onClick={() => void session.decide('confirm')}>确认执行</Button></div>
        </Card>}
        {state.receipts.length > 0 && <ul className="space-y-2 text-body-s text-on-surface-variant" aria-label="操作结果">{state.receipts.slice(-8).map((receipt, index) => <li key={`${receipt.task_id}:${receipt.call_id}:${index}`}>{receipt.summary}</li>)}</ul>}
        {state.task && !state.task.confirmation_token && !state.busy && state.task.status !== 'completed' && <Button variant="tonal" className="self-start" onClick={() => void session.resume()}>核对任务</Button>}
        {state.error && <ErrorRetry size="inline" title="彩彩 AI 操作未完成" message={state.error} onRetry={!state.available && !state.busy ? () => void session.restore() : undefined} />}
      </div>
    </div>
    <p role="status" className="min-h-5 text-body-s text-on-surface-variant">{state.status || (quota.data?.remaining === 0 ? '当前额度已用完' : '')}</p>
    {/* The dense composer row /messages has (AGENTS: the chat composer): a 48dp field that grows
        with what is typed to 160px and then scrolls, and a 48dp send beside it at its bottom —
        the field was a fixed two-row 84px box beside a 40dp button. */}
    <form onSubmit={event => { event.preventDefault(); if (canSend && current()) { nearEnd.current = true; void session.send(); } }} className="flex shrink-0 items-end gap-2 [--touch-floor:48px]">
      <Textarea ref={composer} size="sm" rows={1} aria-label="告诉彩彩" placeholder="告诉彩彩你想做什么…" className="max-h-40 resize-none [field-sizing:content]" fieldClassName="min-w-0 flex-1" maxLength={MAX_MESSAGE} value={text} disabled={!state.available} readOnly={state.busy || !!state.pending} data-autofocus="" onChange={event => session.setDraft(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229 && canSend) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
      }} />
      <IconButton
        type="submit"
        variant="filled"
        size="md"
        shape="square"
        className="touch-size"
        /* Pressing it must not take focus from the field — that closes a phone's keyboard. */
        onPointerDown={event => event.preventDefault()}
        loading={state.busy}
        disabled={!canSend || !text.trim()}
        aria-label={state.pending ? '重试发送' : '发送'}
        icon={state.pending ? <MdRefresh /> : <MdSend />}
      />
    </form>
  </div>;
  return <>
    {desktop ? <Modal isOpen={isOpen} onClose={close} title="彩彩 AI" maxWidth="xl">{content}</Modal> : <Sheet isOpen={isOpen} onClose={close} title="彩彩 AI" className={styles.sheet} bodyClassName={`${styles.sheetBody} px-4 pb-4`}>{content}</Sheet>}
    {confirmDialog}
  </>;
}
