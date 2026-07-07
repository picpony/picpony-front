'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import ToggleSwitch from '@/components/ToggleSwitch';
import Modal from '@/components/Modal';
import { MdBuild, MdWarning, MdTranslate, MdBarChart, MdSync } from 'react-icons/md';
import { Spinner } from './';

export default function OtherTab({ token }: { token: string }) {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [translateEnabled, setTranslateEnabled] = useState(true);
  const [stats, setStats] = useState({ images: 0, tags: 0, comments: 0, updated_at: '-' });
  const [isLoading, setIsLoading] = useState(false);

  const [otherConfirmModalOpen, setOtherConfirmModalOpen] = useState(false);
  const [otherConfirmTitle, setOtherConfirmTitle] = useState('');
  const [otherConfirmMessage, setOtherConfirmMessage] = useState('');
  const otherConfirmActionRef = useRef<(() => void) | null>(null);

  const showOtherConfirm = (title: string, message: string, action: () => void) => {
    setOtherConfirmTitle(title);
    setOtherConfirmMessage(message);
    otherConfirmActionRef.current = action;
    setOtherConfirmModalOpen(true);
  };

  const handleOtherConfirmAction = () => {
    otherConfirmActionRef.current?.();
    setOtherConfirmModalOpen(false);
  };

  useEffect(() => {
    const doLoad = async () => {
      try {
        const [dataResult, statsResult] = await Promise.all([
          api.getMaintenanceStatus().catch(() => null),
          api.getSiteStats().catch(() => null),
        ]);

        if (dataResult?.success) {
          setMaintenanceMode(dataResult.maintenance_mode);
          setMaintenanceMessage(dataResult.maintenance_message || '');
          setTranslateEnabled(dataResult.translate_enabled !== false);
        } else {
          showToast('加载设置失败', 'error');
        }

        if (statsResult?.success && statsResult.stats) {
          setStats(statsResult.stats);
        }
      } catch {
        showToast('加载设置失败', 'error');
      }
    };
    doLoad();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await api.getMaintenanceStatus();
      if (data.success) {
        setMaintenanceMode(data.maintenance_mode);
        setMaintenanceMessage(data.maintenance_message || '');
        setTranslateEnabled(data.translate_enabled !== false);
      }
    } catch {
      showToast('加载设置失败', 'error');
    }
  };

  const loadStats = async () => {
    try {
      const data = await api.getSiteStats();
      if (data.success && data.stats) {
        setStats(data.stats);
      }
    } catch {
      // ignore
    }
  };

  const toggleMaintenance = async () => {
    const newValue = !maintenanceMode;
    if (newValue) {
      showOtherConfirm(
        '确认开启维护模式',
        '开启维护模式后，所有非管理员用户将无法访问网站，确定要开启吗？',
        async () => {
          try {
            const res = await api.adminToggleMaintenance(token, {
              maintenance_mode: newValue,
              maintenance_message: maintenanceMessage,
            });
            const data = await res.json();
            if (data.success) {
              setMaintenanceMode(newValue);
              showToast(newValue ? '维护模式已开启' : '维护模式已关闭', 'success');
            } else {
              showToast(data.error || '操作失败', 'error');
            }
          } catch {
            showToast('操作失败', 'error');
          }
        }
      );
    } else {
      try {
        const res = await api.adminToggleMaintenance(token, {
          maintenance_mode: newValue,
          maintenance_message: maintenanceMessage,
        });
        const data = await res.json();
        if (data.success) {
          setMaintenanceMode(newValue);
          showToast(newValue ? '维护模式已开启' : '维护模式已关闭', 'success');
        } else {
          showToast(data.error || '操作失败', 'error');
        }
      } catch {
        showToast('操作失败', 'error');
      }
    }
  };

  const toggleTranslate = async () => {
    const newValue = !translateEnabled;
    try {
      const res = await api.adminToggleTranslate(token, { translate_enabled: newValue });
      const data = await res.json();
      if (data.success) {
        setTranslateEnabled(newValue);
        showToast(newValue ? '翻译功能已开启' : '翻译功能已关闭', 'success');
      } else {
        showToast(data.error || '操作失败', 'error');
      }
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const syncStats = async () => {
    showOtherConfirm(
      '确认同步',
      '确定要从原站同步最新的数据统计吗？',
      async () => {
        setIsLoading(true);
        try {
          showToast('同步功能需要后端支持', 'warning');
        } finally {
          setIsLoading(false);
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <MdBuild className="text-primary" size={24} />
        其他功能
      </h2>

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <MdWarning size={20} />
              维护模式
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              开启后，所有非管理员用户访问前台将看到全屏维护提示
            </p>
          </div>
          <ToggleSwitch
            checked={maintenanceMode}
            onChange={toggleMaintenance}
          />
        </div>
        {maintenanceMode && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">维护提示文字</label>
            <textarea
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              placeholder="例如：服务器正在升级维护..."
              rows={2}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm resize-none"
            />
          </div>
        )}
      </div>

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <MdTranslate size={20} />
              图片翻译功能
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              控制前台大图模态框中是否展示&ldquo;一键图片翻译&rdquo;按钮
            </p>
          </div>
          <ToggleSwitch
            checked={translateEnabled}
            onChange={toggleTranslate}
          />
        </div>
      </div>

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2 mb-4">
          <MdBarChart size={20} />
          全站数据统计
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
          <div className="text-center p-3 bg-white dark:bg-slate-700 rounded-lg">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">图片总数</div>
            <div className="text-xl font-bold text-primary">{stats.images?.toLocaleString() || 0}</div>
          </div>
          <div className="text-center p-3 bg-white dark:bg-slate-700 rounded-lg">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">标签总数</div>
            <div className="text-xl font-bold text-primary">{stats.tags?.toLocaleString() || 0}</div>
          </div>
          <div className="text-center p-3 bg-white dark:bg-slate-700 rounded-lg">
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">评论总数</div>
            <div className="text-xl font-bold text-primary">{stats.comments?.toLocaleString() || 0}</div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            上次同步: <span className="font-medium">{stats.updated_at || '未同步'}</span>
          </span>
          <button
            onClick={syncStats}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors disabled:opacity-50"
          >
            <MdSync size={18} className={isLoading ? 'animate-spin' : ''} />
            立即同步
          </button>
        </div>
      </div>

      <Modal
        isOpen={otherConfirmModalOpen}
        onClose={() => setOtherConfirmModalOpen(false)}
        title={otherConfirmTitle}
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setOtherConfirmModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleOtherConfirmAction}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">{otherConfirmMessage}</p>
      </Modal>
    </div>
  );
}
