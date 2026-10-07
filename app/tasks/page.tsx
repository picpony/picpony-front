'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { MdCheckCircle, MdChevronRight } from 'react-icons/md';
import Button from '@/components/Button';
import { buttonClasses } from '@/components/buttonStyles';
import Card from '@/components/Card';
import ErrorRetry from '@/components/ErrorRetry';
import PageHeader from '@/components/PageHeader';
import ProgressBar from '@/components/ProgressBar';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { showToast } from '@/components/Toast';
import UserBadge from '@/components/UserBadge';
import { settingsHref } from '@/app/settings/tabs';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { claimTask, type TaskCategory, type TaskDocument } from '@/lib/api/tasks';
import { readToken, updateUserInfo, useNow, useSession } from '@/lib/hooks';
import { motionTier, scaledMs } from '@/lib/appearance';
import { formatExactCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { coinTransactions, tasks } from '@/lib/resources';
import { useScreenState } from '@/lib/screenState';
import { wornBadges } from '@/lib/userBadges';
import { settle } from '@/lib/settle';
import { SPRING_MS } from '@/lib/spring';
import { cn } from '@/lib/utils';

interface TaskDefinition {
  /** The id inside its category's progress block. */
  key: string;
  /** What `claim_task` is told. */
  claimId: string;
  name: string;
  xp: number;
  coins: number;
  target: number;
  /** Where the task is done; none for one that completes itself. */
  href?: string;
}

/**
 * The tasks and their rewards, the original front end's — copy aside (R5-033) and the reward
 * figures, which are its own: what a claim actually pays is the server's, and its receipt is what
 * the toast reports. 累计任务 is not offered (R5-032): the original listed it as 暂未开发 too.
 */
const CATEGORIES: { id: TaskCategory; label: string; subtitle: string; tasks: TaskDefinition[] }[] = [
  {
    id: 'novice',
    label: '新手任务',
    subtitle: '仅限完成一次',
    tasks: [
      { key: 'bind_api', claimId: 'novice_bind_api', name: '首次绑定 API Key', xp: 100, coins: 5, target: 1, href: settingsHref('account') },
      { key: 'verify_api', claimId: 'novice_verify_api', name: '首次核验 API Key', xp: 100, coins: 10, target: 1, href: settingsHref('account') },
      { key: 'set_bg', claimId: 'novice_set_bg', name: '首次设置背景图', xp: 30, coins: 2, target: 1, href: settingsHref('account') },
    ],
  },
  {
    id: 'daily',
    label: '每日任务',
    subtitle: '每天零点（北京时间）刷新进度',
    tasks: [
      { key: 'login', claimId: 'login', name: '每日登录', xp: 10, coins: 1, target: 1 },
      { key: 'fav', claimId: 'fav', name: '每日收藏 5 张图片', xp: 15, coins: 2, target: 5, href: '/' },
      { key: 'share', claimId: 'share', name: '每日分享 5 张图片', xp: 15, coins: 3, target: 5, href: '/' },
      { key: 'comment', claimId: 'comment', name: '每日评论 5 次', xp: 15, coins: 3, target: 5, href: '/' },
    ],
  },
  {
    id: 'weekly',
    label: '每周任务',
    subtitle: '每周刷新进度',
    tasks: [
      { key: 'upload', claimId: 'weekly_upload', name: '每周通过 PicPony 上传 5 次作品', xp: 15, coins: 5, target: 5, href: '/upload' },
    ],
  },
];

type CategoryId = TaskCategory;

/** A figure the session carries, read the way the document's are. */
function sessionFigure(value: unknown): number | null {
  const n = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function LevelCard({
  document,
  session,
  loading,
}: {
  document: TaskDocument | undefined;
  session: { level: number | null; experience: number | null; coins: number | null };
  loading: boolean;
}) {
  const now = useNow();
  /* The document's figures, then the session's (the same account, read by `get_user`) — never
     a figure made up for an answer that carried none (R5-031). The level follows from the
     experience by the site's own rule where only that is known. */
  const experience = document?.experience ?? session.experience;
  const level = document?.level ?? session.level ?? (experience !== null ? Math.floor(experience / 100) + 1 : null);
  const coins = document?.coins ?? session.coins;
  const progress = experience !== null ? experience % 100 : null;
  const worn = document && now !== null ? wornBadges(document.equippedBadges, [], now) : [];

  return (
    /* `Card`, not a hand-rolled container (R5-034), and the level meter is 多色's accent moment:
       `tertiary` on its own container, the profile's meter. */
    <Card variant="filled" padding="lg" className="mb-6" aria-busy={loading || undefined}>
      {/* Two figures on one line at every width: the level reads from the card's leading edge and
          the balance from its trailing edge. The balance is itself the way to its ledger — a
          native wallet's pattern — so there is no separate 明细 button whose own padding left the
          right edge ragged, and no viewport breakpoint deciding an alignment the card's width
          should (with the drawer docked, the coins block wrapped and kept its right alignment,
          its label floating above the wrong line). The link's state layer reaches 12px past the
          text, which the negative margin keeps on the card's content edge. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6">
        <div className="min-w-0">
          <p className="text-label-l text-on-surface-variant">当前等级</p>
          <div className="mt-1 flex min-h-9 flex-wrap items-center gap-2">
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <span className="text-headline-s-emphasized tabular-nums text-on-surface">
                {level !== null ? `Lv.${level}` : '—'}
              </span>
            )}
            {worn.map((badge) => (
              <UserBadge key={badge.badge_name} name={badge.badge_name} color={badge.badge_color} size="md" />
            ))}
          </div>
        </div>
        <Link
          scroll={false}
          href="/tasks/coins"
          data-ripple=""
          aria-label={coins !== null && !loading ? `金币 ${formatExactCount(coins)}，查看明细` : '金币明细'}
          className="state-layer -mx-3 -my-2 block touch-manipulation rounded-md px-3 py-2 text-right text-on-surface focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
        >
          <span className="flex items-center justify-end text-label-l text-on-surface-variant">
            金币
            <MdChevronRight size={ICON.dense} aria-hidden="true" className="-me-1.5" />
          </span>
          <span className="mt-1 flex min-h-9 items-center justify-end">
            {loading ? (
              <Skeleton className="h-8 w-16" delay={60} />
            ) : (
              <span className="text-headline-s-emphasized tabular-nums">{coins !== null ? formatExactCount(coins) : '—'}</span>
            )}
          </span>
        </Link>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-label-m text-on-surface-variant">升级进度</span>
          {loading ? (
            <Skeleton className="h-4 w-16" delay={80} />
          ) : (
            <span className="text-label-m tabular-nums text-on-surface-variant">
              {progress !== null ? `${progress} / 100` : '—'}
            </span>
          )}
        </div>
        {loading ? (
          <Skeleton className="h-1 w-full rounded-full" delay={120} />
        ) : progress !== null ? (
          <LevelMeter level={level} progress={progress} />
        ) : (
          /* No experience in either answer: the meter's place, empty, rather than a made-up 0. */
          <div className="h-1" aria-hidden="true" />
        )}
      </div>
    </Card>
  );
}

/**
 * The level meter, which never runs backwards. Experience past a level boundary is shown the way a
 * game's bar rolls over: the fill runs to the end, empties with no transition, and fills again to
 * the new level's share. Animated as a plain value it ran from 95% back to 5% while the level went
 * up — gaining experience drawn as losing it (M1-021). Under 关闭 the value simply changes.
 */
function LevelMeter({ level, progress }: { level: number | null; progress: number }) {
  const [shown, setShown] = useState({ level, progress, epoch: 0, rolling: false });
  if (!shown.rolling && (shown.level !== level || shown.progress !== progress)) {
    const levelledUp =
      shown.level !== null && level !== null && level > shown.level && typeof document !== 'undefined' && motionTier() !== 'off';
    setShown(levelledUp ? { level: shown.level, progress: 100, epoch: shown.epoch, rolling: true } : { ...shown, level, progress });
  }
  /* The figures the rollover lands on, read when it ends rather than when it began. */
  const latest = useRef({ level, progress });
  useEffect(() => {
    latest.current = { level, progress };
  });
  useEffect(() => {
    if (!shown.rolling) return;
    let frame = 0;
    /* The fill's own spring, at the current speed: the reset waits for the bar to be full. */
    const timer = window.setTimeout(() => {
      setShown((current) => ({ ...current, progress: 0, epoch: current.epoch + 1 }));
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setShown((current) => ({ ...latest.current, epoch: current.epoch, rolling: false })));
      });
    }, scaledMs(SPRING_MS.slowEffects));
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [shown.rolling]);
  /* A new bar for the empty frame: remounted at 0 it has no transition to run backwards on. */
  return <ProgressBar key={shown.epoch} value={shown.progress} tone="tertiary" label={`等级 ${level ?? ''} 经验进度`} />;
}

function TaskRow({
  task,
  state,
  loading,
  claimed,
  claiming,
  onClaim,
}: {
  task: TaskDefinition;
  state: { progress: number; claimed: boolean } | undefined;
  loading: boolean;
  claimed: boolean;
  claiming: boolean;
  onClaim: () => void;
}) {
  const progress = Math.min(state?.progress ?? 0, task.target);
  const done = progress >= task.target;
  const isClaimed = Boolean(state?.claimed) || claimed;
  const canClaim = done && !isClaimed;
  /* Whether the row was already claimed when it was first shown: only a claim this screen saw
     lands with the tick's pop (the CountBadge rule — never on arrival of data). */
  const [baseline, setBaseline] = useState<boolean | null>(loading ? null : isClaimed);
  if (baseline === null && !loading) setBaseline(isClaimed);
  const landed = baseline === false && isClaimed;
  return (
    <div className="m3-row flex items-center gap-4 bg-surface-container-low p-4">
      <div className="min-w-0 flex-1">
        <p className="text-label-l text-on-surface">{task.name}</p>
        <p className="mt-0.5 text-body-s text-on-surface-variant">
          经验 +{task.xp} · 金币 +{task.coins}
        </p>
        {/* The count has its own slot at the bar's trailing edge, so it never wraps onto a
            line of its own (R5-034); tabular figures keep it still as it ticks. */}
        <div className="mt-2 flex items-center gap-3">
          {loading ? (
            <Skeleton className="h-1 flex-1 rounded-full" />
          ) : (
            /* One tone in every state (D1-004): the trailing control already says claimable or
               claimed, and the severity fills read as a warning when something good was ready —
               and on the dark track they all but vanished (1.9:1). */
            <ProgressBar value={(progress / task.target) * 100} label={`${task.name} 进度`} className="w-auto flex-1" />
          )}
          <span className="w-10 shrink-0 text-right text-body-s tabular-nums text-on-surface-variant">
            {loading ? <Skeleton className="ml-auto h-3 w-8" /> : `${progress}/${task.target}`}
          </span>
        </div>
      </div>
      {/* One footprint for every state, so a claim never reflows the row. 领取 is the only claim
          control (R5-029); an unfinished task leads to where it is done. */}
      <div className="flex w-20 shrink-0 justify-end">
        {loading ? (
          <Skeleton className="h-8 w-full rounded-full" />
        ) : isClaimed ? (
          <span className={cn('flex h-8 items-center gap-1 text-label-m text-success', landed && 'animate-fade-in')}>
            <MdCheckCircle size={ICON.dense} aria-hidden="true" className={cn(landed && 'animate-control-pop')} />
            已领取
          </span>
        ) : canClaim ? (
          <Button size="xs" fullWidth variant="filled" loading={claiming} onClick={onClaim}>
            领取
          </Button>
        ) : task.href ? (
          <Link scroll={false} href={task.href} className={buttonClasses({ variant: 'text', size: 'xs', fullWidth: true })}>
            去完成
          </Link>
        ) : (
          <span className="flex h-8 items-center text-label-m text-on-surface-variant">未完成</span>
        )}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { user, token, ready } = useSession();
  const [activeTab, setActiveTab] = useScreenState<CategoryId>('tasks:tab', 'novice');
  /* Per task: a second press of the same 领取 is ignored while its claim is out, and the other
     tasks' buttons stay as they are — nothing dims beside the one being claimed. */
  const [claiming, setClaiming] = useState<ReadonlySet<string>>(() => new Set());
  const claimPending = useRef(new Set<string>());
  /* A claim the server acknowledged, shown until the next document arrives — which carries it. */
  const [receipt, setReceipt] = useState<{ document: TaskDocument | undefined; ids: Set<string> } | null>(null);

  const read = useResource(tasks, token ? { token } : SKIP);
  const doc = read.data;
  const loading = !ready || (Boolean(token) && doc === undefined && read.error === undefined);
  const claimedNow = receipt && receipt.document === doc ? receipt.ids : null;

  const session = useMemo(() => ({
    level: sessionFigure(user?.level),
    experience: sessionFigure(user?.experience),
    coins: sessionFigure(user?.coins),
  }), [user?.level, user?.experience, user?.coins]);

  /* The document is the newest word on the account's level and coins: the drawer reads them from
     the session, so a claim shows there too. */
  useEffect(() => {
    if (!doc || !token) return;
    const patch: Record<string, unknown> = {};
    if (doc.level !== null) patch.level = doc.level;
    if (doc.experience !== null) patch.experience = doc.experience;
    if (doc.coins !== null) patch.coins = doc.coins;
    if (Object.keys(patch).length > 0) updateUserInfo(token, patch);
  }, [doc, token]);

  const handleClaim = async (task: TaskDefinition) => {
    if (claimPending.current.has(task.claimId) || !token || readToken() !== token) return;
    claimPending.current.add(task.claimId);
    setClaiming(new Set(claimPending.current));
    const claimed = await settle(claimTask(token, task.claimId));
    if (readToken() === token) {
      if (claimed.ok) {
        const paid = claimed.value;
        setReceipt((previous) => ({
          document: doc,
          ids: new Set(previous && previous.document === doc ? previous.ids : []).add(task.claimId),
        }));
        const parts = [
          paid.experience !== null ? `经验 +${paid.experience}` : null,
          paid.coins !== null ? `金币 +${paid.coins}` : null,
        ].filter(Boolean);
        showToast(parts.length > 0 ? `已领取，${parts.join('，')}` : '已领取奖励', 'success');
        /* Re-read underneath the receipt; the ledger has a new row. */
        tasks.expire({ token });
        coinTransactions.invalidate();
      } else {
        showToast(apiErrorMessage(claimed.error, '领取失败'), 'error');
      }
    }
    claimPending.current.delete(task.claimId);
    setClaiming(new Set(claimPending.current));
  };

  const header = <PageHeader title="等级与任务" />;

  if (ready && !token) {
    return (
      <div className="mx-auto max-w-4xl">
        {header}
        <SignInRequired description="登录后即可查看等级、完成任务并领取奖励。" />
      </div>
    );
  }

  if (!loading && !doc) {
    return (
      <div className="mx-auto max-w-4xl">
        {header}
        <ErrorRetry
          title="任务加载失败"
          message={apiErrorMessage(read.error)}
          onRetry={isRetryable(read.error) ? read.refresh : undefined}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      {header}
      <LevelCard document={doc} session={session} loading={loading} />
      <Tabs
        className="mb-6"
        label="任务分类"
        tone="warning"
        value={activeTab}
        onChange={setActiveTab}
        tabs={CATEGORIES.map((category) => ({ value: category.id, label: category.label }))}
      />
      {/* `lean`: the rows trail the strip (decision 25). The rows have no entrance of their own
          and nothing inside a pane reveals, so nothing stacks on the lean; while the first read
          is out every pane is its placeholder (`data-page-loading`), so a switch then slides as
          one plane. */}
      <TabPanes value={activeTab} lean>
        {CATEGORIES.map((category) => {
          const block = doc?.progress[category.id];
          return (
            <TabPane key={category.id} value={category.id}>
              <p className="mb-3 px-1 text-body-s text-on-surface-variant">{category.subtitle}</p>
              {!loading && (!block || category.tasks.some((task) => !block[task.key])) ? (
                /* The answer carried no progress for this category: say so, never draw zeros. */
                <ErrorRetry
                  size="pane"
                  title="任务进度加载失败"
                  message="服务器返回的任务进度不完整"
                  onRetry={read.refresh}
                />
              ) : (
                <div data-page-loading={loading || undefined}>
                  {category.tasks.map((task) => (
                    <TaskRow
                      key={task.claimId}
                      task={task}
                      state={block?.[task.key]}
                      loading={loading}
                      claimed={Boolean(claimedNow?.has(task.claimId))}
                      claiming={claiming.has(task.claimId)}
                      onClaim={() => void handleClaim(task)}
                    />
                  ))}
                </div>
              )}
            </TabPane>
          );
        })}
      </TabPanes>
    </div>
  );
}
