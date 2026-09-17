'use client';

import { useState, useRef } from 'react';
import { api } from '@/lib/api';
import { SKIP, useResource } from '@/lib/resource';
import { useScreenState } from '@/lib/screenState';
import { tasks } from '@/lib/resources';
import { showToast } from '@/components/Toast';
import Skeleton from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import Button from '@/components/Button';
import { MdEmojiEvents, MdCheckCircle, MdLock } from 'react-icons/md';
import UserBadge from '@/components/UserBadge';
import PageHeader from '@/components/PageHeader';
import ProgressBar from '@/components/ProgressBar';
import { ICON } from '@/lib/icons';
import { readToken, useSession } from '@/lib/hooks';
import { useAuthModal } from '@/components/AuthModal';

interface TaskData {
  success: boolean;
  level: number;
  experience: number;
  coins: number;
  equipped_badges?: Array<{ badge_name: string; badge_color: string }>;
  novice_tasks?: Record<string, { progress: number; claimed: number }>;
  tasks?: {
    login_progress: number;
    login_claimed: number;
    fav_progress: number;
    fav_claimed: number;
    share_progress: number;
    share_claimed: number;
    comment_progress: number;
    comment_claimed: number;
  };
  weekly_tasks?: {
    upload_progress: number;
    upload_claimed: number;
  };
}

type TaskTab = 'novice' | 'daily' | 'weekly' | 'cumulative';

interface TaskItem {
  id: string;
  name: string;
  xp: number;
  coins: number;
  progress: number;
  target: number;
  claimed: number;
}

const tabs: { id: TaskTab; label: string; subtitle: string }[] = [
  { id: 'novice', label: '新手任务', subtitle: '仅限完成一次' },
  { id: 'daily', label: '每日任务', subtitle: '每日零点刷新任务进度' },
  { id: 'weekly', label: '每周任务', subtitle: '每周刷新任务进度' },
  { id: 'cumulative', label: '累计任务', subtitle: '' },
];

const TASK_DEFINITIONS = {
  novice: [
    { id: 'bind_api', name: '首次绑定 API Key', xp: 100, coins: 5, target: 1 },
    { id: 'verify_api', name: '首次验证 API Key', xp: 100, coins: 10, target: 1 },
    { id: 'set_bg', name: '首次设置背景图', xp: 30, coins: 2, target: 1 },
  ],
  daily: [
    { id: 'login', name: '每日登录', xp: 5, coins: 1, target: 1 },
    { id: 'fav', name: '每日收藏超过5张图片', xp: 10, coins: 2, target: 5 },
    { id: 'share', name: '每日分享5张图片', xp: 10, coins: 3, target: 5 },
    { id: 'comment', name: '每日5评论', xp: 10, coins: 3, target: 5 },
  ],
  weekly: [
    { id: 'upload', name: '每周通过 picpony 上传新作品5次', xp: 15, coins: 5, target: 5 },
  ],
} as const;

/** Labels and rewards are known before the API's three progress shapes arrive. */
function getTaskItems(data: TaskData | undefined, tab: TaskTab): TaskItem[] {
  if (tab === 'cumulative') return [];
  if (tab === 'novice') {
    return TASK_DEFINITIONS.novice.map((task) => ({
      ...task,
      id: `novice_${task.id}`,
      progress: data?.novice_tasks?.[task.id]?.progress ?? 0,
      claimed: data?.novice_tasks?.[task.id]?.claimed ?? 0,
    }));
  }
  if (tab === 'daily') {
    return TASK_DEFINITIONS.daily.map((task) => ({
      ...task,
      progress: data?.tasks?.[`${task.id}_progress`] ?? 0,
      claimed: data?.tasks?.[`${task.id}_claimed`] ?? 0,
    }));
  }
  return TASK_DEFINITIONS.weekly.map((task) => ({
    ...task,
    id: `weekly_${task.id}`,
    progress: data?.weekly_tasks?.[`${task.id}_progress`] ?? 0,
    claimed: data?.weekly_tasks?.[`${task.id}_claimed`] ?? 0,
  }));
}

export default function TasksPage() {
  const { token, ready } = useSession();
  const { openAuth } = useAuthModal();
  const [activeTab, setActiveTab] = useScreenState<TaskTab>('tasks:tab', 'novice');
  const [claiming, setClaiming] = useState<string | null>(null);
  const claimPending = useRef(false);
  const [claimReceipt, setClaimReceipt] = useState<{ snapshot: TaskData | undefined; ids: Set<string> } | null>(null);

  const read = useResource(tasks, token ? { token } : SKIP);
  const data = read.data as TaskData | undefined;
  // Receipts cover the interval before the authoritative refresh arrives. A new
  // task snapshot (including the next day's reset) must be allowed to replace them.
  const claimedPending = claimReceipt && claimReceipt.snapshot === data ? claimReceipt.ids : new Set<string>();
  const experience = Number.isFinite(data?.experience) ? Math.max(0, data!.experience) : 0;
  const level = Number.isFinite(data?.level) ? Math.max(1, data!.level) : Math.floor(experience / 100) + 1;

  /* Nothing to draw only while there is genuinely nothing — a cached screen refreshing
     underneath has `data` and `isLoading` at once, and drawing the skeleton then is the
     flash this layer exists to remove. */
  const loading = !ready || (Boolean(token) && data === undefined && read.error === undefined);
  const error = !ready ? null : !token
    ? '请先登录'
    : read.error
      ? '网络错误，请稍后再试'
      : data && !data.success
        ? '加载失败'
        : null;
  const loadTasks = read.refresh;

  const handleClaim = async (taskType: string) => {
    if (claimPending.current || !token || readToken() !== token) return;
    claimPending.current = true;
    setClaiming(taskType);
    try {
      const res = await api.claimTask(token, taskType);
      const result = await res.json();
      if (readToken() !== token) return;
      if (result.success) {
        setClaimReceipt((previous) => ({
          snapshot: data,
          ids: new Set(previous && previous.snapshot === data ? previous.ids : []).add(taskType),
        }));
        showToast(`已领取，经验 +${result.experience}，金币 +${result.coins}`, 'success');
        // Refresh in the background; the local claim lock stays held until this
        // handler returns, preventing a double claim from a rapid double click.
        loadTasks();
      } else {
        showToast(result.error || '领取失败', 'error');
      }
    } catch {
      if (readToken() === token) showToast('网络错误，请稍后再试', 'error');
    } finally {
      claimPending.current = false;
      setClaiming(null);
    }
  };

  /* One tab's worth of rows. Takes the tab rather than reading `activeTab`: every pane
     is rendered now — see the `TabPanes` note at the call site. */
  const renderTabContent = (forTab: TaskTab) => {
    if (forTab === 'cumulative') {
      return (
        <EmptyState
          size="pane"
          icon={<MdLock size={ICON.display} />}
          title="该类任务暂未开放"
          description="敬请期待。"
        />
      );
    }

    const items = getTaskItems(data, forTab);
    return (
      <div>
        {items.map((item, index) => {
          const pct =
            item.target > 0 ? (Math.min(item.progress, item.target) / item.target) * 100 : 0;
          const isClaimed = Boolean(item.claimed || claimedPending.has(item.id));
          const canClaim = item.progress >= item.target && !isClaimed;
          return (
            <div
              key={item.id}
              /* No per-row entrance: a cascade inside a 500ms pane transition is two
                 clocks on one subtree, the case AGENTS.md calls out. The pane's slide is
                 the entrance; a second one on top is not extra polish. */
              className="m3-row flex items-center gap-4 p-4 bg-surface-container-low"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-label-l max-w-full wrap-anywhere text-on-surface">{item.name}</span>
                  <span className="text-body-s flex flex-wrap items-baseline gap-x-1 text-warning">
                    <span className="whitespace-nowrap">
                    <MdEmojiEvents size={ICON.dense} className="inline mr-0.5" />
                    经验+{item.xp}
                    </span>
                    <span className="whitespace-nowrap">金币+{item.coins}</span>
                  </span>
                  {/* Sits at the bar's right edge; tabular figures stop the digits
                      shifting as progress ticks up. */}
                  <div className="relative ml-auto shrink-0 text-body-s tabular-nums text-on-surface-variant">
                    <span className={loading ? 'invisible' : undefined} aria-hidden={loading || undefined}>
                      {Math.min(item.progress, item.target)}/{item.target}
                    </span>
                    {loading && <Skeleton className="absolute inset-0" delay={index * 80} />}
                  </div>
                </div>
                {/* `ProgressBar`, the primitive — one of six hand-rolled tracks (an 8dp
                    box, an animated `width`, state colours as inline `style`). The tone is
                    now an axis and the curve the spring `ProgressIndicatorDefaults`
                    assigns. */}
                {loading ? (
                  <Skeleton className="mt-2 h-1 w-full rounded-full" delay={index * 80 + 60} />
                ) : (
                  <ProgressBar
                    value={pct}
                    tone={isClaimed ? 'success' : canClaim ? 'warning' : 'secondary'}
                    label={`${item.name} 进度`}
                    className="mt-2"
                  />
                )}
              </div>
              {/* Fixed footprint: 领取 / 去完成 / 已领取 / loading all occupy the same box, so claiming never reflows the row. */}
              <div className="flex w-20 shrink-0 justify-end">
                
                {loading ? (
                  <Skeleton className="h-8 w-full rounded-full" delay={index * 80 + 120} />
                ) : isClaimed ? (
                  <span className="flex h-8 items-center gap-1 text-label-m text-success">
                    
                    <MdCheckCircle size={ICON.dense} /> 已领取
                  </span>
                ) : (
                  <Button
                    size="xs"
                    fullWidth
                    variant={canClaim ? 'filled' : 'text'}
                    onClick={() => handleClaim(item.id)}
                    disabled={!canClaim || claiming !== null}
                    loading={claiming === item.id}
                    /* No colour override on the disabled branch: the added background
                       and boundary ink fought the `text` variant's own (`cn` is a plain
                       join, so stylesheet order decided) and measured under AA for a
                       button label. `disabled` already applies the primitive's
                       `disabled-content`, the 38% M3 specifies. */
                    /* No pop-in animation: that expressive spring is reserved for a
                       small mark arriving in place (an unread count, a favourite filling
                       in); a button with a two-character label wearing it reads as a
                       wobble. The state change here is the variant flipping from `text`
                       to `filled`, which the button already transitions. */
                  >
                    {canClaim ? '领取' : '去完成'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}{' '}
      </div>
    );
  };
  return (
    <div className="max-w-4xl mx-auto" aria-busy={loading || undefined}>
      <PageHeader title="等级与任务" />
      {/* User card */}{' '}
      {(loading || data) && (
        /* `warning-container` with its own `on-` ink, not a 60% wash carrying the
           warning *text* role: the alpha made the panel a different weight in each
           scheme, and on a diluted amber card the heading was low-contrast in one and
           glaring in the other. */
        <div className="bg-warning-container text-on-warning-container mb-6 rounded-md p-4">
          {' '}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            
            <div className="text-headline-s-emphasized min-w-0 wrap-anywhere">
              {' '}
              {loading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  Lv.{level}{' '}
                  {data?.equipped_badges?.map((b) => (
                    <UserBadge
                      key={b.badge_name}
                      name={b.badge_name}
                      color={b.badge_color}
                      className="ml-2 align-middle"
                    />
                  ))}
                </>
              )}
            </div>
            <div className="text-body-m shrink-0 tabular-nums">
              {' '}
              <MdEmojiEvents size={ICON.dense} className="inline mr-1" /> 金币：{' '}
              {loading ? (
                <Skeleton className="inline-block h-4 w-12 align-middle" delay={60} />
              ) : (
                <span className="text-body-m-emphasized">
                  {data?.coins?.toLocaleString() || 0}
                </span>
              )}
            </div>
          </div>
          <div>
            <div className="flex justify-between text-label-m mb-1">
              <span>当前经验进度</span>
              {loading ? (
                <Skeleton className="h-4 w-28" delay={80} />
              ) : (
                <span>当前经验：{experience % 100} / 100</span>
              )}
            </div>
            {/* Through the primitive: the hand-rolled meter was a 10dp track in a
                non-track role with a gradient whose far end was `tertiary`, which
                inverts between schemes — the right-hand side of the bar swapped shade
                with the theme. Flat, on the token. */}
            {loading ? (
              <Skeleton className="h-1 w-full rounded-full" delay={120} />
            ) : (
              <ProgressBar
                value={experience % 100}
                tone="warning"
                label="当前等级经验进度"
              />
            )}
          </div>
        </div>
      )}{' '}
      {/* Keep the overview, tabs and pane heading in place during the first read.
          Task definitions are static, so only the account's progress and actions need
          placeholders; using the same rows also preserves their narrow-screen wraps. */}
      {error && <ErrorRetry title="任务加载失败" message={error} onRetry={token ? loadTasks : () => openAuth('login')} />}{' '}
      {!error && (loading || data) && (
        <>
          {' '}
          {/* `Tabs`, not a fourth copy of a tab row: this one had a hand-wired sliding
              indicator, no ARIA roles, and an active tab distinguished by colour alone
              with no weight contrast. `tone="warning"` keeps this screen's amber
              indicator. */}
          <Tabs
            className="mb-6"
            label="任务分类"
            tone="warning"
            value={activeTab}
            onChange={setActiveTab}
            deps={[data]}
            tabs={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
          />
          {/* `TabPanes`, and the subtitle lives inside each pane. This was `Tabs` plus
              two `key`-ed wrappers — the `key` is the exact thing AGENTS.md forbids: it
              destroys the outgoing subtree in the commit that starts the switch, so the
              transition had no exit to play. The subtitle inside the pane also travels
              with its own content. */}
          <TabPanes value={activeTab}>
            {tabs.map((tab) => (
              <TabPane key={tab.id} value={tab.id}>
                <div className="mb-4">
                  <span className="text-label-l-emphasized text-on-surface">{tab.label}</span>
                  {tab.subtitle && (
                    <span className="ml-2 text-body-s text-on-surface-variant">{tab.subtitle}</span>
                  )}
                </div>
                {renderTabContent(tab.id)}
              </TabPane>
            ))}
          </TabPanes>
        </>
      )}
    </div>
  );
}
