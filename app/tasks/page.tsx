'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
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
import { readUserInfo } from '@/lib/hooks';

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

export default function TasksPage() {
  const [data, setData] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TaskTab>('novice');
  const [claiming, setClaiming] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = readUserInfo();
      if (!user) {
        setError('请先登录');
        setLoading(false);
        return;
      }
      const res = await api.getTasks(user.token);
      if (res.success) {
        setData(res);
      } else {
        setError(res.error || '加载失败');
      }
    } catch {
      setError('网络错误，请稍后再试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadTasks();
    });
  }, [loadTasks]);

  const handleClaim = async (taskType: string) => {
    setClaiming(taskType);
    try {
      const user = readUserInfo();
      if (!user) return;
      const res = await api.claimTask(user.token, taskType);
      const result = await res.json();
      if (result.success) {
        showToast(`领取成功，经验 +${result.experience}，金币 +${result.coins}`, 'success');
        loadTasks();
      } else {
        showToast(result.error || '领取失败', 'error');
      }
    } catch {
      showToast('网络错误，请稍后再试', 'error');
    } finally {
      setClaiming(null);
    }
  };

  const getTaskItems = (forTab: TaskTab): TaskItem[] => {
    if (!data) return [];
    if (forTab === 'novice') {
      const nt = data.novice_tasks || {};
      const bindApi = nt['bind_api'];
      const verifyApi = nt['verify_api'];
      const setBg = nt['set_bg'];
      return [
        {
          id: 'novice_bind_api',
          name: '首次绑定 API Key',
          xp: 100,
          coins: 5,
          progress: bindApi?.progress || 0,
          target: 1,
          claimed: bindApi?.claimed || 0,
        },
        {
          id: 'novice_verify_api',
          name: '首次验证 API Key',
          xp: 100,
          coins: 10,
          progress: verifyApi?.progress || 0,
          target: 1,
          claimed: verifyApi?.claimed || 0,
        },
        {
          id: 'novice_set_bg',
          name: '首次设置背景图',
          xp: 30,
          coins: 2,
          progress: setBg?.progress || 0,
          target: 1,
          claimed: setBg?.claimed || 0,
        },
      ];
    }
    if (forTab === 'daily') {
      const t = data.tasks || {
        login_progress: 0,
        login_claimed: 0,
        fav_progress: 0,
        fav_claimed: 0,
        share_progress: 0,
        share_claimed: 0,
        comment_progress: 0,
        comment_claimed: 0,
      };
      return [
        {
          id: 'login',
          name: '每日登录',
          xp: 5,
          coins: 1,
          progress: t.login_progress ?? 0,
          target: 1,
          claimed: t.login_claimed ?? 0,
        },
        {
          id: 'fav',
          name: '每日收藏超过5张图片',
          xp: 10,
          coins: 2,
          progress: t.fav_progress ?? 0,
          target: 5,
          claimed: t.fav_claimed ?? 0,
        },
        {
          id: 'share',
          name: '每日分享5张图片',
          xp: 10,
          coins: 3,
          progress: t.share_progress ?? 0,
          target: 5,
          claimed: t.share_claimed ?? 0,
        },
        {
          id: 'comment',
          name: '每日5评论',
          xp: 10,
          coins: 3,
          progress: t.comment_progress ?? 0,
          target: 5,
          claimed: t.comment_claimed ?? 0,
        },
      ];
    }
    if (forTab === 'weekly') {
      const wt = data.weekly_tasks || { upload_progress: 0, upload_claimed: 0 };
      return [
        {
          id: 'weekly_upload',
          name: '每周通过 picpony 上传新作品5次',
          xp: 15,
          coins: 5,
          progress: wt.upload_progress ?? 0,
          target: 5,
          claimed: wt.upload_claimed ?? 0,
        },
      ];
    }
    return [];
  };

  /* One tab's worth of rows. Takes the tab rather than reading `activeTab`, because
     every pane is rendered now — see the `TabPanes` note at the call site. */
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

    const items = getTaskItems(forTab);
    return (
      <div>
        {items.map((item) => {
          const pct =
            item.target > 0 ? (Math.min(item.progress, item.target) / item.target) * 100 : 0;
          const canClaim = item.progress >= item.target && !item.claimed;
          return (
            <div
              key={item.id}
              /* No per-row entrance. The rows used to fade in on a 50ms cascade of
                 their own *inside* a 500ms pane transition — two clocks on one
                 subtree, which is the case AGENTS.md calls out ("over content that
                 already cascades on mount"). The pane's slide is the entrance; a
                 second one on top is not extra polish. The 50ms step was also a
                 third cascade rhythm, against `Reveal`'s 60 and the skeletons' 90. */
              className="m3-row flex items-center gap-4 p-4 bg-surface-container-low"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-label-l text-on-surface truncate">{item.name}</span>
                  <span className="text-body-s text-warning whitespace-nowrap">
                    <MdEmojiEvents size={ICON.dense} className="inline mr-0.5" />
                    经验+{item.xp}
                    <span className="ml-1 text-warning">金币+{item.coins}</span>
                  </span>
                  {/* Sits at the bar's right edge; tabular figures stop the
                      digits shifting as progress ticks up. */}
                  <span className="ml-auto shrink-0 text-body-s tabular-nums text-on-surface-variant">
                    {Math.min(item.progress, item.target)}/{item.target}
                  </span>
                </div>
                {/* `ProgressBar`, the primitive. This was one of six hand-rolled
                    tracks: an 8dp box (the token is 4), an animated `width`, and
                    the three state colours as inline `style` so no grep for a
                    `bg-*` utility could find them. The tone is now an axis, and
                    the curve is the spring `ProgressIndicatorDefaults` assigns
                    rather than the loop easing every one of the six was using. */}
                <ProgressBar
                  value={pct}
                  tone={item.claimed ? 'success' : canClaim ? 'warning' : 'secondary'}
                  label={`${item.name} 进度`}
                  className="mt-2"
                />
              </div>
              {/* Fixed footprint: 领取 / 去完成 / 已领取 / loading all occupy the same box, so claiming never reflows the row. */}
              <div className="flex w-20 shrink-0 justify-end">
                
                {item.claimed ? (
                  <span className="flex h-8 items-center gap-1 text-label-m text-success">
                    
                    <MdCheckCircle size={ICON.dense} /> 已领取
                  </span>
                ) : (
                  <Button
                    size="xs"
                    fullWidth
                    variant={canClaim ? 'filled' : 'text'}
                    onClick={() => handleClaim(item.id)}
                    disabled={!canClaim}
                    loading={claiming === item.id}
                    /* No colour override on the disabled branch. It used to add
                       a container background and an `outline` ink, which emitted a
                       second background and a second ink over the `text`
                       variant's own — `cn` is a plain join, so which one won came
                       down to stylesheet order — and `outline` is a boundary
                       role that measures 4.3:1 on the light surface, under AA
                       for a button label. `disabled` already applies the
                       primitive's own `disabled-content`, i.e. the 38% M3
                       specifies for disabled content. */
                    /* No `animate-control-pop`. That keyframe is the expressive
                       ζ0.6 spring — 8.4% overshoot — and AGENTS.md reserves it for
                       "a small mark arriving in place: an unread count, a favourite
                       filling in". A 32dp button with a two-character label is not a
                       mark, and anything large wearing that spring reads as a wobble.
                       The state change here is the variant flipping from `text` to
                       `filled`, which the button already transitions. */
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
    <div className="max-w-4xl mx-auto">
      <PageHeader title="等级与任务" />
      {/* User card */}{' '}
      {data && (
        /* `warning-container` with its own `on-` ink, not a 60% wash carrying
           `text-warning`. Two faults compounded here: the alpha meant the panel
           was a different weight in each scheme, and `warning` is the *text*
           role — dark ochre on light, pale amber on dark — so on a diluted
           amber card the heading was low-contrast in one scheme and glaring in
           the other. The progress track underneath was full-strength
           `warning-container` sitting on the same colour at 60%, i.e. an empty
           bar you could barely find. */
        <div className="bg-warning-container text-on-warning-container mb-6 rounded-md p-4">
          {' '}
          <div className="flex items-center justify-between mb-3">
            
            <div className="text-headline-s-emphasized">
              {' '}
              Lv.{data.level}{' '}
              {data.equipped_badges?.map((b) => (
                <UserBadge
                  key={b.badge_name}
                  name={b.badge_name}
                  color={b.badge_color}
                  className="ml-2 align-middle"
                />
              ))}{' '}
            </div>
            <div className="text-body-m">
              {' '}
              <MdEmojiEvents size={ICON.dense} className="inline mr-1" /> 金币：{' '}
              <span className="text-body-m-emphasized">
                {data.coins?.toLocaleString() || 0}
              </span>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-label-m mb-1">
              <span>当前经验进度</span>
              <span>当前经验：{data.experience % 100} / 100</span>
            </div>
            {/* The last of the six hand-rolled meters, and the one that had drifted
                furthest: a 10dp track (the token is 4, and 10 is not on the 4dp
                grid) in `surface-container-lowest` rather than the track role, with
                a gradient whose far end was `tertiary` — which inverts between
                schemes, so the right-hand side of the bar swapped shade with the
                theme. That is the exact defect the comment above it claimed to have
                fixed by moving the near end to `warning-fill`. Flat, on the token,
                and through the primitive. */}
            <ProgressBar
              value={data.experience % 100}
              tone="warning"
              label="当前等级经验进度"
            />
          </div>
        </div>
      )}{' '}
      {/* The destination's own shape, not a spinner in the middle of nothing.
          Every other list in the app — history, forum, messages — loads as its
          own rows, and a task row is a name over a bar with a fixed-width action
          at the end, so that is what stands in for it. A centred spinner told
          the user "something is happening somewhere" and then reflowed the whole
          screen when the rows arrived. */}
      {loading && (
        <div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="m3-row flex items-center gap-4 bg-surface-container-low p-4">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-2/5" delay={i * 80} />
                <Skeleton className="mt-2 h-2 w-full rounded-full" delay={i * 80 + 60} />
              </div>
              <Skeleton className="h-8 w-20 shrink-0 rounded-full" delay={i * 80 + 120} />
            </div>
          ))}
        </div>
      )}{' '}
      {error && <ErrorRetry title="任务加载失败" message={error} onRetry={loadTasks} />}{' '}
      {!loading && !error && data && (
        <>
          {' '}
          {/* `Tabs`, not a fourth copy of a tab row. This one had `useSlidingIndicator`
              wired by hand, no ARIA roles, and — the tell that it was a copy made
              before the primitive existed — an active tab distinguished by colour
              alone, with no weight contrast, which is the exact defect the shared
              component's own comment records having fixed. `tone="warning"` keeps
              this screen's amber indicator. */}
          <Tabs
            className="mb-6"
            label="任务分类"
            tone="warning"
            value={activeTab}
            onChange={setActiveTab}
            deps={[data]}
            tabs={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
          />
          {/* `TabPanes`, and the subtitle lives inside each pane.
              This was `Tabs` plus two `key`-ed wrappers, and the `key` is the exact
              thing AGENTS.md forbids: it destroys the outgoing subtree in the commit
              that starts the switch, so the transition had no exit to play and the
              app's fourth tab surface was the one with no animation at all. Moving
              the subtitle inside the pane also means it travels with its own content
              rather than being swapped underneath it. */}
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
