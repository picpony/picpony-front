'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import { MdEmojiEvents, MdCheckCircle, MdLock } from 'react-icons/md';

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
  const router = useRouter();
  const [data, setData] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TaskTab>('novice');
  const [claiming, setClaiming] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stored = localStorage.getItem('user_info');
      if (!stored) { setError('请先登录'); setLoading(false); return; }
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
    loadTasks();
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
      return [
        { id: 'novice_bind_api', name: '首次绑定 API Key', xp: 100, coins: 5, progress: (nt as any).bind_api?.progress || 0, target: 1, claimed: (nt as any).bind_api?.claimed || 0 },
        { id: 'novice_verify_api', name: '首次验证 API Key', xp: 100, coins: 10, progress: (nt as any).verify_api?.progress || 0, target: 1, claimed: (nt as any).verify_api?.claimed || 0 },
        { id: 'novice_set_bg', name: '首次设置背景图', xp: 30, coins: 2, progress: (nt as any).set_bg?.progress || 0, target: 1, claimed: (nt as any).set_bg?.claimed || 0 },
      ];
    }
    if (activeTab === 'daily') {
      const t = data.tasks || {} as any;
      return [
        { id: 'login', name: '每日登录', xp: 5, coins: 1, progress: t.login_progress ?? 0, target: 1, claimed: t.login_claimed ?? 0 },
        { id: 'fav', name: '每日收藏超过5张图片', xp: 10, coins: 2, progress: t.fav_progress ?? 0, target: 5, claimed: t.fav_claimed ?? 0 },
        { id: 'share', name: '每日分享5张图片', xp: 10, coins: 3, progress: t.share_progress ?? 0, target: 5, claimed: t.share_claimed ?? 0 },
        { id: 'comment', name: '每日5评论', xp: 10, coins: 3, progress: t.comment_progress ?? 0, target: 5, claimed: t.comment_claimed ?? 0 },
      ];
    }
    if (activeTab === 'weekly') {
      const wt = data.weekly_tasks || {} as any;
      return [
        { id: 'weekly_upload', name: '每周通过 picpony 上传新作品5次', xp: 15, coins: 5, progress: wt.upload_progress ?? 0, target: 5, claimed: wt.upload_claimed ?? 0 },
      ];
    }
    return [];
  };

  const renderTabContent = () => {
    if (activeTab === 'cumulative') {
      return (
        <div className="text-center text-slate-400 dark:text-slate-500 py-12">
          <MdLock size={48} className="mx-auto mb-4 opacity-40" />
          <p>该类任务暂未开放，敬请期待</p>
        </div>
      );
    }

    const items = getTaskItems();
    return (
      <div className="space-y-3">
        {items.map(item => {
          const pct = item.target > 0 ? Math.min(item.progress, item.target) / item.target * 100 : 0;
          const canClaim = item.progress >= item.target && !item.claimed;
          return (
            <div key={item.id} className="flex items-center gap-4 p-4 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{item.name}</span>
                  <span className="text-xs text-amber-500 dark:text-amber-400 whitespace-nowrap">
                    <MdEmojiEvents size={12} className="inline mr-0.5" />
                    经验+{item.xp}
                    <span className="ml-1 text-yellow-600 dark:text-yellow-400">金币+{item.coins}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: item.claimed ? '#22c55e' : canClaim ? '#f59e0b' : 'var(--color-primary, #E06C9F)',
                      }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 w-14 text-right">
                    {Math.min(item.progress, item.target)}/{item.target}
                  </span>
                </div>
              </div>
              <div className="shrink-0">
                {item.claimed ? (
                  <span className="flex items-center gap-1 text-xs text-green-500 font-medium">
                    <MdCheckCircle size={16} />
                    已领取
                  </span>
                ) : (
                  <button
                    onClick={() => handleClaim(item.id)}
                    disabled={!canClaim || claiming === item.id}
                    className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      canClaim
                        ? 'bg-primary text-white hover:bg-primary/90'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    {claiming === item.id ? <Spinner size="sm" white /> : canClaim ? '领取' : '去完成'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">等级与任务</h1>
      </div>

      {/* User card */}
      {data && (
        <div className="mb-6 p-5 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border border-amber-200 dark:border-amber-800/30">
          <div className="flex items-center justify-between mb-3">
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              Lv.{data.level}
              {data.equipped_badges?.map((b, i) => (
                <span
                  key={i}
                  className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold text-white align-middle"
                  style={{ backgroundColor: b.badge_color }}
                >
                  {b.badge_name}
                </span>
              ))}
            </div>
            <div className="text-sm text-amber-700 dark:text-amber-300">
              <MdEmojiEvents size={14} className="inline mr-1" />
              金币: <span className="font-bold">{data.coins?.toLocaleString() || 0}</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-amber-600 dark:text-amber-400 mb-1">
              <span>当前经验进度</span>
              <span>当前经验: {data.experience % 100} / 100</span>
            </div>
            <div className="h-2.5 rounded-full bg-amber-200 dark:bg-amber-900/40 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400 transition-all duration-500"
                style={{ width: `${data.experience % 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {error && (
        <div className="text-center py-12">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={loadTasks}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Tabs */}
          <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-slate-700">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
                  activeTab === tab.id
                    ? 'text-amber-500 border-amber-400'
                    : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab subtitle */}
          <div className="mb-4">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {tabs.find(t => t.id === activeTab)?.label}
            </span>
            {tabs.find(t => t.id === activeTab)?.subtitle && (
              <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                {tabs.find(t => t.id === activeTab)?.subtitle}
              </span>
            )}
          </div>

          {renderTabContent()}
        </>
      )}
    </div>
  );
}
