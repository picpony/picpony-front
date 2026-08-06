'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import Button from '@/components/Button';
import { useSlidingIndicator } from '@/lib/motion';
import { MdEmojiEvents, MdCheckCircle, MdLock } from 'react-icons/md';
import UserBadge from '@/components/UserBadge';

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
  const { containerRef, indicatorRef } = useSlidingIndicator(activeTab, [data]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stored = localStorage.getItem('user_info');
      if (!stored) {
        setError('请先登录');
        setLoading(false);
        return;
      }
      const user = JSON.parse(stored);
      const res = await api.getTasks(user.token);
      if (res.success) {
        setData(res);
      } else {
        setError(res.error || '加载失败');
      }
    } catch {
      setError('网络错误');
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
      const stored = localStorage.getItem('user_info');
      if (!stored) return;
      const user = JSON.parse(stored);
      const res = await api.claimTask(user.token, taskType);
      const result = await res.json();
      if (result.success) {
        showToast(`领取成功！经验 +${result.experience}，金币 +${result.coins}`, 'success');
        loadTasks();
      } else {
        showToast(result.error || '领取失败', 'error');
      }
    } catch {
      showToast('网络错误', 'error');
    } finally {
      setClaiming(null);
    }
  };

  const getTaskItems = (): TaskItem[] => {
    if (!data) return [];
    if (activeTab === 'novice') {
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
    if (activeTab === 'daily') {
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
    if (activeTab === 'weekly') {
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

  const renderTabContent = () => {
    if (activeTab === 'cumulative') {
      return (
        <div key="cumulative" className="text-center text-outline py-12 animate-page-transition">
          <MdLock size={48} className="mx-auto mb-4 opacity-40" />
          <p>该类任务暂未开放，敬请期待</p>
        </div>
      );
    }

    const items = getTaskItems();
    return (
      <div key={`items-${activeTab}`}>
        {items.map((item, index) => {
          const pct =
            item.target > 0 ? (Math.min(item.progress, item.target) / item.target) * 100 : 0;
          const canClaim = item.progress >= item.target && !item.claimed;
          return (
            <div
              key={item.id}
              className="m3-row flex items-center gap-4 p-4 bg-surface-container-low animate-fade-in"
              style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-label-l text-on-surface truncate">{item.name}</span>
                  <span className="text-body-s text-warning whitespace-nowrap">
                    <MdEmojiEvents size={12} className="inline mr-0.5" />
                    经验+{item.xp}
                    <span className="ml-1 text-warning">金币+{item.coins}</span>
                  </span>
                  {/* Sits at the bar's right edge; tabular figures stop the
                      digits shifting as progress ticks up. */}
                  <span className="ml-auto shrink-0 text-body-s tabular-nums text-outline">
                    {Math.min(item.progress, item.target)}/{item.target}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-surface-container-high overflow-hidden">
                  <div
                    className="h-full rounded-full origin-left animate-[bar-grow_0.6s_var(--ease-decelerate)] transition-[width,background-color] duration-500 ease-[var(--ease-standard)]"
                    style={{
                      width: `${pct}%`,
                      animationDelay: `${100 + index * 50}ms`,
                      animationFillMode: 'backwards',
                      backgroundColor: item.claimed
                        ? 'var(--md-sys-color-success-fill)'
                        : canClaim
                          ? 'var(--md-sys-color-warning-fill)'
                          : 'var(--md-sys-color-primary)',
                    }}
                  />{' '}
                </div>{' '}
              </div>{' '}
              {/* Fixed footprint: 领取 / 去完成 / 已领取 / loading all occupy the same box, so claiming never reflows the row. */}{' '}
              <div className="flex w-20 shrink-0 justify-end">
                {' '}
                {item.claimed ? (
                  <span className="flex h-8 items-center gap-1 text-label-m text-success">
                    {' '}
                    <MdCheckCircle size={16} /> 已领取{' '}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    fullWidth
                    variant={canClaim ? 'filled' : 'text'}
                    onClick={() => handleClaim(item.id)}
                    disabled={!canClaim}
                    loading={claiming === item.id}
                    className={
                      canClaim
                        ? 'animate-[control-pop_0.3s_var(--ease-spring)]'
                        : 'bg-surface-container-high text-outline  '
                    }
                  >
                    {canClaim ? '领取' : '去完成'}{' '}
                  </Button>
                )}{' '}
              </div>{' '}
            </div>
          );
        })}{' '}
      </div>
    );
  };
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 animate-fade-in">
      {' '}
      {/* Header */}{' '}
      <div className="flex items-center gap-3 mb-8">
        {' '}
        <h1 className="text-title-l text-on-surface">等级与任务</h1>{' '}
      </div>{' '}
      {/* User card */}{' '}
      {data && (
        <div className="mb-6 p-5 rounded-md bg-warning-container/60">
          {' '}
          <div className="flex items-center justify-between mb-3">
            {' '}
            <div className="text-headline-s-emphasized text-warning">
              {' '}
              Lv.{data.level}{' '}
              {data.equipped_badges?.map((b, i) => (
                <UserBadge
                  key={i}
                  name={b.badge_name}
                  color={b.badge_color}
                  className="ml-2 align-middle"
                />
              ))}{' '}
            </div>{' '}
            <div className="text-body-m text-warning">
              {' '}
              <MdEmojiEvents size={14} className="inline mr-1" /> 金币:{' '}
              <span className="font-bold">{data.coins?.toLocaleString() || 0}</span>{' '}
            </div>{' '}
          </div>{' '}
          <div>
            {' '}
            <div className="flex justify-between text-label-m text-warning mb-1">
              {' '}
              <span>当前经验进度</span> <span>当前经验: {data.experience % 100} / 100</span>{' '}
            </div>{' '}
            <div className="h-2.5 rounded-full bg-warning-container overflow-hidden">
              {' '}
              <div
                className="h-full rounded-full bg-gradient-to-r from-warning to-tertiary transition-[width] duration-500 ease-[var(--ease-standard)]"
                style={{ width: `${data.experience % 100}%` }}
              />{' '}
            </div>{' '}
          </div>{' '}
        </div>
      )}{' '}
      {loading && (
        <div className="flex justify-center py-16">
          {' '}
          <Spinner />{' '}
        </div>
      )}{' '}
      {error && (
        <div className="text-center py-12">
          {' '}
          <p className="text-error mb-4">{error}</p>{' '}
          <Button onClick={loadTasks} variant="filled">
            重试
          </Button>
        </div>
      )}{' '}
      {!loading && !error && data && (
        <>
          {' '}
          {/* Tabs */}{' '}
          <div
            ref={containerRef}
            className="relative flex gap-1 mb-6"
          >
            {' '}
            <span
              ref={indicatorRef}
              aria-hidden="true"
              className="absolute bottom-[-1px] left-0 h-0.5 rounded-full bg-warning-fill"
            />{' '}
            {tabs.map((tab) => (
              <button
                key={tab.id}
                data-tab={tab.id}
                data-ripple
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-label-l transition-ui rounded-t-lg ${
                  activeTab === tab.id
                    ? 'text-warning'
                    : 'text-on-surface-variant hover:text-on-surface '
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* Tab subtitle */}
          <div key={`subtitle-${activeTab}`} className="mb-4 animate-fade-in">
            <span className="text-label-l-emphasized text-on-surface">
              {tabs.find((t) => t.id === activeTab)?.label}
            </span>
            {tabs.find((t) => t.id === activeTab)?.subtitle && (
              <span className="ml-2 text-body-s text-outline">
                {tabs.find((t) => t.id === activeTab)?.subtitle}
              </span>
            )}
          </div>
          {renderTabContent()}
        </>
      )}
    </div>
  );
}
