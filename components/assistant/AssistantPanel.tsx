'use client';

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  MdArrowDownward,
  MdAutoAwesome,
  MdBuild,
  MdCheck,
  MdCheckCircleOutline,
  MdClose,
  MdContentCopy,
  MdCurrencyExchange,
  MdDeleteOutline,
  MdErrorOutline,
  MdExplore,
  MdFavoriteBorder,
  MdHistory,
  MdRefresh,
  MdSearch,
  MdSend,
  MdTaskAlt,
  MdVerifiedUser,
} from 'react-icons/md';
import SidePanel from '@/components/SidePanel';
import Sheet from '@/components/Sheet';
import ScrollArea from '@/components/ScrollArea';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import ChatBubble from '@/components/ChatBubble';
import MarkdownRenderer, { warmMarkdownDocument } from '@/components/MarkdownRenderer';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import LoadingIndicator, { PageLoadingIndicator } from '@/components/LoadingIndicator';
import Spinner from '@/components/Spinner';
import { useTooltip } from '@/components/Tooltip';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { useSession, useMediaQuery, readToken, updateUserInfo } from '@/lib/hooks';
import { MEDIA } from '@/lib/constants';
import { formatExactCount } from '@/lib/format';
import { motionTier } from '@/lib/appearance';
import { useOverlayScrollbar } from '@/lib/overlayScrollbar';
import { createAssistantSession, THINKING_STATUS } from '@/lib/assistant/session';
import { actionLabel, actionSupported, toolLabel } from '@/lib/assistant/actions';
import { assistantQuota } from '@/lib/assistant/queries';
import { useJournalText } from '@/lib/assistant/useJournal';
import { newRequestId, parseExchange, writeJournalText } from '@/lib/assistant/journal';
import { AssistantRefusal, exchangeAssistantQuota } from '@/lib/api/assistant';
import { coinTransactions, faveFolders, tasks } from '@/lib/resources';
import { MAX_MESSAGE, type AssistantLiveTool, type AssistantQuota } from '@/lib/assistant/protocol';
import { ICON } from '@/lib/icons';
import { useResource, SKIP } from '@/lib/resource';
import { settle } from '@/lib/settle';
import { cn, copyText } from '@/lib/utils';
import QuotaExchangeDialog from './QuotaExchangeDialog';
import ThinkingBlock from './ThinkingBlock';
import styles from './AssistantPanel.module.css';

/** Five `body-l` lines plus vertical inset before the composer switches to scrolling. */
const MAX_COMPOSER_HEIGHT = 144;
/** Show the character counter once a draft approaches the backend's 2000-char cap. */
const COUNTER_THRESHOLD = Math.floor(MAX_MESSAGE * 0.75);

const STARTER_PROMPTS = [
  {
    label: '找紫悦高清壁纸',
    prompt: '帮我找一些紫悦的高清壁纸图片',
    icon: 'search',
  },
  {
    label: '查看今日任务与金币',
    prompt: '看看我今天的任务进度和金币余额',
    icon: 'task',
  },
  {
    label: '查看我的收藏夹',
    prompt: '帮我查看我的收藏夹里有哪些分类',
    icon: 'favorites',
  },
  {
    label: '打开标签订阅页',
    prompt: '带我去标签订阅页面看看',
    icon: 'explore',
  },
] as const;

type StarterIcon = (typeof STARTER_PROMPTS)[number]['icon'];

function starterIcon(kind: StarterIcon) {
  switch (kind) {
    case 'search':
      return <MdSearch />;
    case 'task':
      return <MdTaskAlt />;
    case 'favorites':
      return <MdFavoriteBorder />;
    case 'explore':
      return <MdExplore />;
  }
}

function formatMessageText(raw: string): string {
  return raw.replaceAll('||', '\n\n');
}

/** Compact interactive quota summary pill in the top bar. */
function QuotaPill({
  quota,
  pendingExchange,
  disabled,
  onOpen,
}: {
  quota: AssistantQuota;
  pendingExchange: boolean;
  disabled: boolean;
  onOpen: () => void;
}) {
  const empty = quota.remaining === 0;
  const label = pendingExchange ? '待核对兑换' : empty ? '额度已用完' : `剩余 ${formatExactCount(quota.remaining)} 点`;
  const hint = pendingExchange
    ? '上次兑换结果尚未确认，点击核对'
    : `剩余 ${formatExactCount(quota.remaining)} 点，点击兑换彩彩额度`;
  const { anchorRef, anchorProps, tooltip } = useTooltip(disabled ? undefined : hint);

  return (
    <>
      <button
        ref={(node) => {
          anchorRef.current = node;
        }}
        type="button"
        disabled={disabled}
        onClick={onOpen}
        aria-label={hint}
        data-ripple="inner"
        {...anchorProps}
        className={cn(
          'touch-target-block inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2.5 text-label-s tabular-nums',
          'select-none touch-manipulation transition-[background-color,color] spring-fast-effects',
          'focus-visible:outline-hidden focus-visible:ring-2 focus-ring forced-boundary',
          disabled ? 'cursor-not-allowed disabled-content' : 'state-layer cursor-pointer',
          empty || pendingExchange
            ? 'bg-warning-container text-on-warning-container ripple-warning'
            : 'bg-surface-container-high text-on-surface-variant',
        )}
      >
        <span data-ripple-host="" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </button>
      {tooltip}
    </>
  );
}

/** Subtle speaker mark anchoring full-width assistant prose, thinking traces and tool calls. */
function AssistantEyebrow() {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-label-s text-on-surface-variant" aria-hidden="true">
      <MdAutoAwesome size={ICON.dense} className="shrink-0 text-primary-ink" />
      <span>彩彩 AI</span>
    </div>
  );
}

/** A tool call inside the live reply or settled turn, with crisp M3 running/success/error states. */
function LiveToolRow({ tool, running = false }: { tool: AssistantLiveTool; running?: boolean }) {
  const isError = tool.ok === false;
  const isSuccess = tool.ok === true;
  const isRunning = running && tool.ok === undefined;
  const label = toolLabel(tool.name, tool.arguments);

  return (
    <div
      className={cn(
        'inline-flex min-h-8 max-w-full items-center gap-2 rounded-sm border px-2.5 py-1 text-label-m forced-boundary',
        isError
          ? 'border-transparent bg-error-container text-on-error-container'
          : 'border-outline-variant bg-surface-container text-on-surface-variant',
      )}
    >
      {isRunning ? (
        <Spinner size="sm" tone="primary" />
      ) : isSuccess ? (
        <MdCheckCircleOutline size={ICON.dense} aria-hidden="true" className="shrink-0 text-success" />
      ) : isError ? (
        <MdErrorOutline size={ICON.dense} aria-hidden="true" className="shrink-0" />
      ) : (
        <MdBuild size={ICON.dense} aria-hidden="true" className="shrink-0 text-on-surface-variant" />
      )}
      <span className={cn('min-w-0 truncate', isRunning && 'text-on-surface')}>{label}</span>
      {isRunning && <span className="shrink-0 text-label-s text-on-surface-variant">执行中…</span>}
      {isError && <span className="shrink-0 text-label-s">失败</span>}
    </div>
  );
}

/** Copies an assistant reply with brief visual check feedback and a shared toast. */
function CopyReplyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function handleCopy() {
    const ok = await copyText(text);
    if (!ok) {
      showToast('复制失败', 'error');
      return;
    }
    setCopied(true);
    showToast('已复制回复', 'success');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, 1800);
  }

  return (
    <IconButton
      size="sm"
      variant="standard"
      aria-label="复制回复"
      icon={copied ? <MdCheck className="text-success" /> : <MdContentCopy />}
      onClick={() => void handleCopy()}
    />
  );
}

export default function AssistantPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { token, user } = useSession();
  if (!token || !user?.id) return null;
  return <Conversation key={token} token={token} accountId={String(user.id)} isOpen={isOpen} onClose={onClose} />;
}

function Conversation({
  token,
  accountId,
  isOpen,
  onClose,
}: {
  token: string;
  accountId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [session] = useState(() =>
    createAssistantSession(token, accountId, {
      active: () => !document.hidden && assistantQuota.peek({ token }).data?.user_enabled !== false,
      navigate: (href) => {
        const target = new URL(href, window.location.href);
        target.searchParams.sort();
        const arrived = () => {
          const current = new URL(window.location.href);
          current.searchParams.sort();
          return current.pathname === target.pathname && current.search === target.search;
        };
        if (arrived()) return Promise.resolve();
        router.push(href, { scroll: false });
        const start = performance.now();
        return new Promise<void>((resolve, reject) => {
          const check = () => {
            if (readToken() !== token || document.hidden) {
              reject(new Error('会话已暂停，未继续执行后续操作'));
              return;
            }
            if (arrived()) {
              resolve();
              return;
            }
            if (performance.now() - start > 30000) {
              reject(new Error('页面尚未完成切换，请先核对当前页面'));
              return;
            }
            requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
      },
    }),
  );
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  /* The folder names a confirmation card shows instead of bare ids (review P5-O2), read only while
     a card is waiting for an answer. */
  const folderList = useResource(faveFolders, state.task?.pending_id ? { token } : SKIP);
  const folderName = (id: number) => folderList.data?.folders.find((folder) => folder.id === id)?.name;
  const quota = useResource(assistantQuota, state.available ? { token } : SKIP);
  const pendingExchange = parseExchange(useJournalText(accountId, 'exchange'));
  const desktop = useMediaQuery(MEDIA.sm, true);
  const [history, setHistory] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchangeCoinsInput, setExchangeCoinsInput] = useState('1');
  const [exchangeBusy, setExchangeBusy] = useState(false);
  const [exchangeError, setExchangeError] = useState<unknown>();
  const exchangeLock = useRef(false);
  const { confirm, confirmDialog } = useConfirm();
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const composerScrollHost = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const interacted = useRef(false);
  const nearEnd = useRef(true);
  const attached = useRef(false);

  const text = state.pending?.message ?? state.draft;

  useOverlayScrollbar(composer, composerScrollHost, {
    axis: 'y',
    observeInput: true,
    refreshKey: text,
  });

  const close = () => {
    setShowScrollDown(false);
    session.setActive(false);
    onClose();
  };

  useEffect(() => {
    session.setActive(isOpen);
    if (isOpen) {
      focusPending.current = true;
      interacted.current = false;
      nearEnd.current = true;
    }
    if (isOpen && !session.getSnapshot().ready) void session.restore();
    /* The reply stream is Markdown; start the renderer's chunk while the visitor is still
       typing, so the first delta is formatted rather than waiting on a lazy boundary. */
    if (isOpen) void warmMarkdownDocument();
  }, [session, isOpen]);

  useEffect(() => {
    if (isOpen && state.available && !state.loading && focusPending.current && !interacted.current) {
      focusPending.current = false;
      composer.current?.focus({ preventScroll: true });
    }
  }, [isOpen, state.available, state.loading]);

  useEffect(() => {
    attached.current = true;
    return () => {
      attached.current = false;
      queueMicrotask(() => {
        if (!attached.current) session.dispose();
      });
    };
  }, [session]);

  useEffect(() => {
    if (isOpen && quota.data && (!quota.data.enabled || !quota.data.user_enabled)) onClose();
  }, [isOpen, quota.data, onClose]);

  useEffect(() => {
    if (nearEnd.current && log.current) {
      log.current.scrollTop = log.current.scrollHeight;
    }
  }, [
    isOpen,
    state.messages,
    state.receipts,
    state.pending,
    state.task,
    state.error,
    state.streaming,
    state.tools,
    state.live,
    history,
  ]);

  useLayoutEffect(() => {
    const node = composer.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_COMPOSER_HEIGHT)}px`;
  }, [text, isOpen]);

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
    sync();
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    return () => {
      window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      root.style.removeProperty('--picpony-assistant-keyboard');
      root.style.removeProperty('--picpony-assistant-height');
    };
  }, [isOpen]);

  const current = () => readToken() === token;

  function openExchange() {
    if (exchangeBusy || !quota.data) return;
    setExchangeError(undefined);
    setExchangeCoinsInput('1');
    setExchangeOpen(true);
  }

  /* Mirrors `AssistantSettings`'s journalled exchange flow using `settle()` so React Compiler keeps compiling this component. */
  async function submitExchange() {
    const amount = pendingExchange?.coins ?? Number(exchangeCoinsInput);
    if (exchangeLock.current || !quota.data || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000) return;
    if (!pendingExchange && amount > quota.data.coins) return;
    if (!current()) return;
    exchangeLock.current = true;
    setExchangeBusy(true);
    setExchangeError(undefined);

    const request = pendingExchange ?? {
      coins: amount,
      requestId: newRequestId(),
      revision: quota.data.revision,
      configRevision: quota.data.config_revision,
      pointsPerCoin: quota.data.points_per_coin,
    };

    const persisted = await settle(
      Promise.resolve().then(() => writeJournalText(accountId, 'exchange', JSON.stringify(request))),
    );
    if (!persisted.ok) {
      if (current()) setExchangeError(persisted.error);
      exchangeLock.current = false;
      setExchangeBusy(false);
      return;
    }

    const outcome = await settle(exchangeAssistantQuota(token, request));
    if (!outcome.ok) {
      if (current() && outcome.error instanceof AssistantRefusal) {
        await settle(Promise.resolve().then(() => writeJournalText(accountId, 'exchange', null)));
      }
      if (current()) setExchangeError(outcome.error);
      exchangeLock.current = false;
      setExchangeBusy(false);
      return;
    }

    if (current()) {
      assistantQuota.write({ token }, outcome.value);
      updateUserInfo(token, { coins: outcome.value.coins });
      await settle(Promise.resolve().then(() => writeJournalText(accountId, 'exchange', null)));
      tasks.expire({ token });
      coinTransactions.expire();
      showToast('已兑换额度', 'success');
      setExchangeOpen(false);
    }
    exchangeLock.current = false;
    setExchangeBusy(false);
  }

  async function handleClearHistory() {
    if (
      (await confirm({
        title: '确认清空',
        message: '确定要清空当前会话的全部聊天记录吗？此操作无法恢复。',
        tone: 'danger',
      })) &&
      current()
    ) {
      void session.clear();
    }
  }

  const messages = history ? state.messages : state.messages.slice(-6);
  const hiddenCount = history ? 0 : Math.max(0, state.messages.length - messages.length);
  const canSend =
    state.available &&
    !state.loading &&
    !state.busy &&
    !state.task?.pending_id &&
    quota.data?.user_enabled !== false &&
    (state.pending !== null || quota.data?.remaining !== 0);

  function handleStarterPrompt(prompt: string) {
    if (!state.available || state.busy || state.pending || !current()) return;
    session.setDraft(prompt);
    if (canSend) {
      nearEnd.current = true;
      setShowScrollDown(false);
      void session.send();
    } else {
      composer.current?.focus({ preventScroll: true });
    }
  }

  function scrollToBottom() {
    const node = log.current;
    if (!node) return;
    nearEnd.current = true;
    setShowScrollDown(false);
    node.scrollTo({
      top: node.scrollHeight,
      behavior: motionTier('feedback') === 'off' ? 'auto' : 'smooth',
    });
  }

  /* Treat `!state.ready` as initial loading too so the opening render before `restore()` never
     flashes the welcome view for one frame. */
  const isThreadLoading =
    (state.loading || !state.ready) &&
    !state.error &&
    !state.messages.length &&
    !state.pending &&
    !state.live.length &&
    !state.streaming;
  const hasTrailing = Boolean(
    state.pending || state.live.length > 0 || state.streaming || state.task || state.receipts.length > 0 || state.error,
  );
  const isWelcome = !isThreadLoading && state.available && !messages.length && !hasTrailing;
  const isUnavailable = !isThreadLoading && state.ready && !state.available;

  const thread = isThreadLoading ? (
    <PageLoadingIndicator size="inline" indicatorSize="md" paused={!isOpen} delay={120} label="正在加载对话…" />
  ) : isUnavailable ? (
    <EmptyState
      title={state.status || '彩彩 AI 暂不可用'}
      description="可在设置的账户页签中查看开关与额度"
      size="inline"
    />
  ) : isWelcome ? (
    <div className="flex flex-col items-center px-2 py-6 text-center">
      <div
        aria-hidden="true"
        className="inline-flex size-12 items-center justify-center rounded-full bg-primary-container text-on-primary-container forced-boundary"
      >
        <MdAutoAwesome size={ICON.standard} />
      </div>
      <p className="mt-3 text-title-m text-on-surface">你好，我是彩彩 AI</p>
      <p className="mt-1 max-w-xs text-body-s text-on-surface-variant">
        可以帮你搜索小马图片、查看任务与金币，或直接打开站内页面
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2" role="group" aria-label="快捷提问">
        {STARTER_PROMPTS.map((item) => (
          <Chip
            key={item.label}
            variant="assist"
            icon={starterIcon(item.icon)}
            disabled={state.busy || !state.available}
            onClick={() => handleStarterPrompt(item.prompt)}
          >
            {item.label}
          </Chip>
        ))}
      </div>
    </div>
  ) : !messages.length ? null : (
    /* A thread, read as /messages reads one: who spoke is the side and the cut corners, so a
       run of one speaker sits 2dp apart and a new speaker sits cleanly separated below.
       Only the visitor's own words are a bubble; 彩彩 answers as `plain` full-width prose. */
    <div className="flex flex-col">
      {hiddenCount > 0 && (
        <div className="mb-4 flex justify-center">
          <Button variant="text" size="xs" icon={<MdHistory />} onClick={() => setHistory(true)}>
            查看更早的 {hiddenCount} 条记录
          </Button>
        </div>
      )}
      <ol aria-label={history ? '全部聊天记录' : '最近对话'}>
        {messages.map((message, index) => {
          const own = message.role === 'user';
          const startOfRun = index === 0 || messages[index - 1].role !== message.role;
          const endOfRun = index === messages.length - 1 || messages[index + 1].role !== message.role;
          const formatted = formatMessageText(message.content);
          const deleteAction = message.id ? (
            <IconButton
              size="sm"
              variant="danger-quiet"
              aria-label={`删除第 ${index + 1} 条消息`}
              disabled={state.busy}
              icon={<MdDeleteOutline />}
              onClick={async () => {
                if (
                  (await confirm({
                    title: '确认删除',
                    message: '确定要删除此条聊天记录吗？',
                    tone: 'danger',
                  })) &&
                  current()
                )
                  void session.removeMessage(message.id);
              }}
            />
          ) : null;

          if (own) {
            return (
              <li
                key={message.id || `user-${hiddenCount + index}`}
                className={cn(
                  'group flex items-center justify-end gap-1.5',
                  index > 0 && (startOfRun ? 'mt-5' : 'mt-0.5'),
                )}
              >
                {deleteAction && <span className="hover-reveal shrink-0">{deleteAction}</span>}
                <ChatBubble own startOfRun={startOfRun} endOfRun={endOfRun} className="min-w-0 flex-1">
                  {formatted}
                </ChatBubble>
              </li>
            );
          }

          return (
            <li
              key={message.id || `assistant-${hiddenCount + index}`}
              className={cn('group flex flex-col', index > 0 && (startOfRun ? 'mt-5' : 'mt-1.5'))}
            >
              {startOfRun && <AssistantEyebrow />}
              <ChatBubble own={false} plain rich startOfRun={startOfRun} endOfRun={endOfRun}>
                <div className="flex w-full min-w-0 flex-col gap-2">
                  {message.thinking && <ThinkingBlock text={message.thinking} paused={!isOpen} />}
                  {message.tools?.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {message.tools.map((tool) => (
                        <LiveToolRow key={tool.id} tool={tool} />
                      ))}
                    </div>
                  ) : null}
                  {formatted ? <MarkdownRenderer content={formatted} /> : null}
                </div>
              </ChatBubble>
              {(formatted || deleteAction) && (
                <div className="hover-reveal mt-1 flex items-center gap-0.5">
                  {formatted && <CopyReplyButton text={formatted} />}
                  {deleteAction}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );

  const showCounter = text.length >= COUNTER_THRESHOLD;
  const quotaExhausted = !state.status && quota.data?.remaining === 0;

  const content = (
    <div
      className={styles.conversation}
      data-assistant-conversation=""
      onPointerDownCapture={() => {
        interacted.current = true;
      }}
      onKeyDownCapture={(event) => {
        if (event.key === 'Tab') interacted.current = true;
      }}
    >
      {/* Top bar: assistant identity + clickable quota summary pill + unobtrusive icon actions. */}
      <header
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 border-b border-outline-variant',
          desktop
            ? 'pl-5 pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.75rem,env(safe-area-inset-top))] pb-3'
            : 'px-4 pt-0 pb-3',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container forced-boundary"
          >
            <MdAutoAwesome size={ICON.control} />
          </span>
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <h2 className="max-w-full truncate text-title-m text-on-surface">彩彩 AI</h2>
            {quota.data ? (
              <QuotaPill
                quota={quota.data}
                pendingExchange={Boolean(pendingExchange)}
                disabled={exchangeBusy}
                onOpen={openExchange}
              />
            ) : isUnavailable ? (
              <span className="truncate text-label-s text-on-surface-variant">暂不可用</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {state.available && state.messages.length > 0 && (
            <IconButton
              size="sm"
              toggle
              selected={history}
              aria-label="全部聊天记录"
              tooltip={history ? '已显示全部记录，点击仅看近期' : '查看全部聊天记录'}
              icon={<MdHistory />}
              onClick={() => setHistory((value) => !value)}
            />
          )}
          {quota.data && (
            <IconButton
              size="sm"
              aria-label={pendingExchange ? '核对兑换结果' : '兑换彩彩额度'}
              disabled={exchangeBusy}
              icon={<MdCurrencyExchange />}
              onClick={openExchange}
            />
          )}
          {state.available && (
            <IconButton
              size="sm"
              variant="danger-quiet"
              aria-label="清空聊天记录"
              disabled={state.busy || !state.messages.length}
              icon={<MdDeleteOutline />}
              onClick={() => void handleClearHistory()}
            />
          )}
          <IconButton size="sm" dismiss aria-label="关闭" icon={<MdClose />} onClick={close} />
        </div>
      </header>

      {/* Conversation stream: `data-no-sheet-drag` keeps touch scrolling inside the chat on phones. */}
      <div className="relative flex min-h-0 flex-1 flex-col" data-no-sheet-drag="">
        <ScrollArea
          axis="y"
          className="flex min-h-0 flex-1 flex-col"
          viewportRef={log}
          viewportClassName={cn(styles.messages, 'popover-scrollbar', desktop ? 'px-5 py-4' : 'px-4 py-3')}
          viewportProps={{
            onScroll: (event) => {
              const node = event.currentTarget;
              const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
              nearEnd.current = distance < 64;
              setShowScrollDown(distance > 120);
            },
          }}
        >
          {/* Pinned to the bottom when active, centred when loading/empty/unavailable. */}
          <div className="flex min-h-full flex-col gap-4">
            <div className={isThreadLoading || isWelcome || isUnavailable ? 'my-auto' : 'mt-auto'}>{thread}</div>

            {/* A sent-but-unanswered message stands in as the visitor's own bubble; only an
                unconfirmed outcome adds a calm tinted recovery card underneath it. */}
            {state.pending && (
              <div className="flex flex-col gap-2">
                <ChatBubble own>{formatMessageText(state.pending.message)}</ChatBubble>
                {!state.busy && (
                  <div className="ml-auto flex max-w-full flex-col items-end gap-2 rounded-md bg-warning-container p-3 text-on-warning-container forced-boundary">
                    <p className="text-end text-body-s">此条消息的执行状态尚未确认，草稿已保留</p>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button variant="on-container" size="xs" onClick={() => void session.restore()}>
                        核对记录
                      </Button>
                      <Button
                        variant="on-container"
                        size="xs"
                        onClick={async () => {
                          if (
                            (await confirm({
                              title: '确认保留草稿',
                              message: '确定要放弃等待确认并保留草稿吗？之前已发送的请求不会重复提交。',
                              tone: 'filled',
                            })) &&
                            current()
                          )
                            session.discardPending();
                        }}
                      >
                        保留草稿
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Live streaming turn in server emission order: thinking, text and tool blocks
                interleaved seamlessly until replaced by the persisted message. */}
            {(state.live.length > 0 || state.streaming) && (
              <div role="group" aria-label="彩彩 AI 正在回复" className="flex flex-col gap-2">
                <AssistantEyebrow />
                {state.live.length > 0 ? (
                  state.live.map((block, index) => {
                    if (block.type === 'thinking') {
                      const isActive = state.busy && index === state.live.length - 1;
                      return (
                        <ThinkingBlock
                          key={`thinking-${index}`}
                          text={block.text}
                          isActive={isActive}
                          paused={!isOpen}
                        />
                      );
                    }
                    if (block.type === 'text') {
                      return (
                        <div key={`text-${index}`} className="max-w-full min-w-0 text-body-m wrap-anywhere">
                          <MarkdownRenderer content={formatMessageText(block.text)} />
                        </div>
                      );
                    }
                    return (
                      <div key={`tool-${block.tool.id}`} className="flex">
                        <LiveToolRow tool={block.tool} running={state.busy} />
                      </div>
                    );
                  })
                ) : (
                  <div className="max-w-full min-w-0 text-body-m wrap-anywhere">
                    <MarkdownRenderer content={formatMessageText(state.streaming)} />
                  </div>
                )}
              </div>
            )}

            {/* Action confirmation card for write operations awaiting visitor approval. */}
            {state.task?.pending_id && (
              <Card variant="filled" padding="md">
                <div className="flex items-start gap-2.5">
                  <MdVerifiedUser size={ICON.control} aria-hidden="true" className="mt-0.5 shrink-0 text-primary-ink" />
                  <div className="min-w-0 flex-1">
                    <p className="text-title-s text-on-surface">确认执行操作</p>
                    <p className="mt-0.5 text-body-s text-on-surface-variant">以下站内操作需要你确认后才会继续</p>
                  </div>
                </div>
                <ul className="mt-3 list-disc space-y-1.5 rounded-sm bg-surface-container-low py-2.5 pr-3 pl-7 text-body-m text-on-surface forced-boundary">
                  {state.task.actions.map((action, index) => (
                    <li key={action.call_id || index} className="wrap-anywhere">
                      {actionLabel(action, folderName)}
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button variant="text" disabled={state.busy} onClick={() => void session.decide('reject')}>
                    取消
                  </Button>
                  <Button
                    variant="filled"
                    loading={state.busy}
                    disabled={state.task.actions.some((action) => !actionSupported(action))}
                    onClick={() => void session.decide('confirm')}
                  >
                    确认执行
                  </Button>
                </div>
              </Card>
            )}

            {/* Completed client-action receipts for the current session. */}
            {state.receipts.length > 0 && (
              <ul
                className="flex flex-col gap-1.5 rounded-md border border-outline-variant bg-surface-container px-3 py-2.5 text-body-s text-on-surface-variant forced-boundary"
                aria-label="操作结果"
              >
                {state.receipts.slice(-8).map((receipt, index) => (
                  <li key={`${receipt.task_id}:${receipt.call_id}:${index}`} className="flex items-start gap-2">
                    {receipt.ok ? (
                      <MdCheckCircleOutline
                        size={ICON.dense}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-success"
                      />
                    ) : (
                      <MdErrorOutline size={ICON.dense} aria-hidden="true" className="mt-0.5 shrink-0 text-error" />
                    )}
                    <span className="min-w-0 wrap-anywhere">{receipt.summary}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* Paused or reloaded unfinished turn resume strip. */}
            {state.task && !state.task.pending_id && !state.busy && (
              <div className="flex items-center justify-between gap-3 rounded-md bg-secondary-container px-3.5 py-2.5 text-on-secondary-container forced-boundary">
                <span className="min-w-0 text-body-s">上次任务尚未完成，可核对最新进度</span>
                <Button variant="on-container" size="xs" className="shrink-0" onClick={() => void session.resume()}>
                  核对任务
                </Button>
              </div>
            )}

            {/* Inline error banner. */}
            {state.error && (
              <div className="rounded-md border border-outline-variant bg-surface-container px-3 py-2 forced-boundary">
                <ErrorRetry
                  size="inline"
                  title="彩彩 AI 操作未完成"
                  message={state.error}
                  onRetry={!state.available && !state.busy ? () => void session.restore() : undefined}
                />
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Floating return-to-bottom button when the visitor scrolls up into history. */}
        <div
          className={cn(
            'pointer-events-none absolute right-4 bottom-3 z-10 transition-opacity spring-fast-effects',
            showScrollDown ? 'opacity-100' : 'opacity-0',
          )}
          inert={!showScrollDown}
          aria-hidden={!showScrollDown}
        >
          <IconButton
            size="sm"
            variant="tonal"
            tooltip={showScrollDown ? undefined : false}
            className={cn('shadow-e1', showScrollDown ? 'pointer-events-auto' : 'pointer-events-none')}
            aria-label="回到底部"
            icon={<MdArrowDownward />}
            onClick={scrollToBottom}
          />
        </div>
      </div>

      {/* Composer dock: fixed-height status strip + rounded M3 tonal input surface. */}
      <div
        data-no-sheet-drag=""
        className={cn('shrink-0 border-t border-outline-variant', desktop ? 'px-5 pt-2.5 pb-1' : 'px-4 pt-2 pb-1')}
      >
        <div className="mb-2 flex min-h-5 items-center justify-between gap-2">
          <div role="status" aria-live="polite" className="flex min-w-0 flex-1 items-center gap-1.5">
            {state.status === THINKING_STATUS ? (
              <>
                <LoadingIndicator
                  size="xs"
                  variant="default"
                  tone="primary"
                  decorative
                  paused={!isOpen}
                  className="size-4"
                />
                <span className="truncate text-body-s text-shimmer">{state.status}</span>
              </>
            ) : state.status ? (
              <span className="truncate text-body-s text-on-surface-variant">{state.status}</span>
            ) : quotaExhausted ? (
              <>
                <span className="truncate text-body-s text-warning">当前额度已用完</span>
                <button
                  type="button"
                  disabled={exchangeBusy}
                  onClick={openExchange}
                  className="prose-link shrink-0 cursor-pointer rounded-xs text-label-m focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
                >
                  兑换额度
                </button>
              </>
            ) : null}
          </div>
          {showCounter && (
            <span
              className={cn(
                'shrink-0 text-label-s tabular-nums',
                text.length >= MAX_MESSAGE ? 'text-error' : 'text-on-surface-variant',
              )}
            >
              {text.length} / {MAX_MESSAGE}
            </span>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (canSend && current()) {
              nearEnd.current = true;
              setShowScrollDown(false);
              void session.send();
            }
          }}
          className={cn(
            'flex shrink-0 items-end gap-2 rounded-2xl border bg-surface-container-high p-2 pl-4 [--touch-floor:48px]',
            'transition-[border-color,box-shadow] spring-fast-effects forced-boundary',
            composerFocused
              ? cn('border-transparent ring-2 focus-ring', styles.composerFocused)
              : 'border-outline-variant',
            !state.available && 'disabled-content',
          )}
        >
          <div ref={composerScrollHost} className="os-slot min-w-0 flex-1">
            <textarea
              ref={composer}
              rows={1}
              data-os-axis="y"
              aria-label="输入消息"
              placeholder={state.available ? '输入搜图需求或站内操作指令…' : '彩彩 AI 暂不可用'}
              maxLength={MAX_MESSAGE}
              value={text}
              disabled={!state.available}
              readOnly={state.busy || Boolean(state.pending)}
              data-autofocus=""
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              onChange={(event) => session.setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.keyCode !== 229 &&
                  canSend &&
                  text.trim()
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              className="popover-scrollbar block max-h-36 w-full resize-none overflow-y-auto bg-transparent py-1.5 text-body-l text-on-surface placeholder:text-on-surface-variant focus-visible:outline-hidden disabled:cursor-not-allowed"
            />
          </div>
          <IconButton
            type="submit"
            variant="filled"
            size="md"
            shape="round"
            /* Pressing it must not take focus from the field — that closes a phone's keyboard. */
            onPointerDown={(event) => event.preventDefault()}
            /* No loading spinner here: while 彩彩 is busy `canSend` is false, so disabled ink reports it cleanly. */
            disabled={!canSend || !text.trim()}
            aria-label={state.pending ? '重试发送' : '发送'}
            icon={state.pending ? <MdRefresh /> : <MdSend />}
          />
        </form>
      </div>
    </div>
  );

  return (
    <>
      {desktop ? (
        <SidePanel
          isOpen={isOpen}
          onClose={close}
          aria-label="彩彩 AI"
          hideCloseButton
          bodyClassName={styles.sideBody}
          bodyScrollable={false}
        >
          {content}
        </SidePanel>
      ) : (
        <Sheet
          isOpen={isOpen}
          onClose={close}
          aria-label="彩彩 AI"
          className={styles.sheet}
          bodyClassName={styles.sheetBody}
          bodyScrollable={false}
        >
          {content}
        </Sheet>
      )}
      {quota.data && (
        <QuotaExchangeDialog
          isOpen={exchangeOpen}
          onClose={() => {
            if (!exchangeLock.current) setExchangeOpen(false);
          }}
          quota={quota.data}
          pending={pendingExchange}
          coins={exchangeCoinsInput}
          onCoinsChange={setExchangeCoinsInput}
          busy={exchangeBusy}
          error={exchangeError}
          onSubmit={() => void submitExchange()}
        />
      )}
      {confirmDialog}
    </>
  );
}
