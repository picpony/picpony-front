'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import ToggleSwitch from '@/components/ToggleSwitch';
import Modal from '@/components/Modal';
import { MdBuild, MdWarning, MdTranslate, MdBarChart, MdSync } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Textarea } from '@/components/Input';

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
        },
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
    showOtherConfirm('确认同步', '确定要从原站同步最新的数据统计吗？', async () => {
      setIsLoading(true);
      try {
        showToast('同步功能需要后端支持', 'warning');
      } finally {
        setIsLoading(false);
      }
    });
  };
  return (
    <div className="space-y-6">
      {' '}
      <h2 className="text-title-l text-on-surface flex items-center gap-2">
        {' '}
        <MdBuild className="text-primary" size={24} /> 其他功能{' '}
      </h2>{' '}
      <Card variant="outlined">
        {' '}
        <div className="flex items-center justify-between">
          {' '}
          <div>
            {' '}
            <h3 className="font-semibold text-on-surface flex items-center gap-2">
              {' '}
              <MdWarning size={20} /> 维护模式{' '}
            </h3>{' '}
            <p className="text-body-m text-on-surface-variant mt-1">
              {' '}
              开启后，所有非管理员用户访问前台将看到全屏维护提示{' '}
            </p>{' '}
          </div>{' '}
          <ToggleSwitch checked={maintenanceMode} onChange={toggleMaintenance} />{' '}
        </div>{' '}
        {maintenanceMode && (
          <div className="mt-4">
            {' '}
            <label className="block text-label-l text-on-surface mb-1" htmlFor="othertab-f1">
              维护提示文字
            </label>{' '}
            <Textarea
              id="othertab-f1"
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              placeholder="例如：服务器正在升级维护..."
              rows={2}
              className="resize-none"
            />{' '}
          </div>
        )}{' '}
      </Card>{' '}
      <Card variant="outlined">
        {' '}
        <div className="flex items-center justify-between">
          {' '}
          <div>
            {' '}
            <h3 className="font-semibold text-on-surface flex items-center gap-2">
              {' '}
              <MdTranslate size={20} /> 图片翻译功能{' '}
            </h3>{' '}
            <p className="text-body-m text-on-surface-variant mt-1">
              {' '}
              控制前台大图模态框中是否展示&ldquo;一键图片翻译&rdquo;按钮{' '}
            </p>{' '}
          </div>{' '}
          <ToggleSwitch checked={translateEnabled} onChange={toggleTranslate} />{' '}
        </div>{' '}
      </Card>{' '}
      <Card variant="outlined">
        {' '}
        <h3 className="font-semibold text-on-surface flex items-center gap-2 mb-4">
          {' '}
          <MdBarChart size={20} /> 全站数据统计{' '}
        </h3>{' '}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
          {' '}
          <div className="text-center p-3 bg-surface-container-lowest rounded-md">
            {' '}
            <div className="text-body-s text-on-surface-variant mb-1">图片总数</div>{' '}
            <div className="text-title-l-emphasized text-primary">
              {stats.images?.toLocaleString() || 0}
            </div>{' '}
          </div>{' '}
          <div className="text-center p-3 bg-surface-container-lowest rounded-md">
            {' '}
            <div className="text-body-s text-on-surface-variant mb-1">标签总数</div>{' '}
            <div className="text-title-l-emphasized text-primary">
              {stats.tags?.toLocaleString() || 0}
            </div>{' '}
          </div>{' '}
          <div className="text-center p-3 bg-surface-container-lowest rounded-md">
            {' '}
            <div className="text-body-s text-on-surface-variant mb-1">评论总数</div>{' '}
            <div className="text-title-l-emphasized text-primary">
              {stats.comments?.toLocaleString() || 0}
            </div>{' '}
          </div>{' '}
        </div>{' '}
        <div className="flex items-center justify-between">
          {' '}
          <span className="text-body-m text-on-surface-variant">
            {' '}
            上次同步: <span className="">{stats.updated_at || '未同步'}</span>{' '}
          </span>{' '}
          <button
            onClick={syncStats}
            disabled={isLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-label-l text-primary bg-primary/10 hover:bg-primary/20 rounded-full transition-ui disabled:opacity-50"
          >
            {' '}
            <MdSync size={18} className={isLoading ? 'animate-spin' : ''} />
            立即同步
          </button>
        </div>
      </Card>
      <Modal
        isOpen={otherConfirmModalOpen}
        onClose={() => setOtherConfirmModalOpen(false)}
        title={otherConfirmTitle}
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setOtherConfirmModalOpen(false)}
              className="px-4 py-2 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
            >
              取消
            </button>
            <Button variant="danger" onClick={handleOtherConfirmAction}>
              确认
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant">{otherConfirmMessage}</p>
      </Modal>
    </div>
  );
}
