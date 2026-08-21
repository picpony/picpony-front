'use client';

import { useState, useEffect } from 'react';
import { showToast } from '@/components/Toast';
import ToggleSwitch from '@/components/ToggleSwitch';
import { MdBuild, MdWarning, MdTranslate, MdBarChart, MdSync } from 'react-icons/md';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import Card from '@/components/Card';
import { Textarea } from '@/components/Input';
import { ICON } from '@/lib/icons';
/* A namespace import, and it is the point: `lib/api.ts`'s `api` is a runtime
   spread and therefore un-tree-shakeable, so while the admin surface was in it
   every gallery route shipped all 48 of these. Only the eleven admin tabs
   import it now, and each is already its own `dynamic` chunk. */
import * as adminApi from '@/lib/api/admin';

export default function OtherTab({ token }: { token: string }) {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [translateEnabled, setTranslateEnabled] = useState(true);
  const [stats, setStats] = useState({ images: 0, tags: 0, comments: 0, updated_at: '-' });
  const [isLoading, setIsLoading] = useState(false);

  const { confirmThen, confirmDialog } = useConfirm();

  useEffect(() => {
    const doLoad = async () => {
      try {
        const [dataResult, statsResult] = await Promise.all([
          adminApi.getMaintenanceStatus().catch(() => null),
          adminApi.getSiteStats().catch(() => null),
        ]);

        if (dataResult?.success) {
          setMaintenanceMode(dataResult.maintenance_mode);
          setMaintenanceMessage(dataResult.maintenance_message || '');
          setTranslateEnabled(dataResult.translate_enabled !== false);
        } else {
          showToast('设置加载失败', 'error');
        }

        if (statsResult?.success && statsResult.stats) {
          setStats(statsResult.stats);
        }
      } catch {
        showToast('设置加载失败', 'error');
      }
    };
    doLoad();
  }, []);

  const toggleMaintenance = async () => {
    const newValue = !maintenanceMode;
    if (newValue) {
      confirmThen(
        '确认开启维护模式',
        '开启维护模式后，所有非管理员用户将无法访问网站，确定要开启吗？',
        async () => {
          try {
            const res = await adminApi.adminToggleMaintenance(token, {
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
        const res = await adminApi.adminToggleMaintenance(token, {
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
      const res = await adminApi.adminToggleTranslate(token, { translate_enabled: newValue });
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
    confirmThen('确认同步', '确定要从原站同步最新的数据统计吗？', async () => {
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
        
        <MdBuild size={ICON.standard} /> 其他功能
      </h2>
      <Card variant="filled">
        {/* `layout="row"` rather than a hand-built `justify-between` pair. Same
            reading order, one description ink, and the whole row is now the
            label element — so a click on the supporting text toggles the switch
            it describes, which it did not before. */}
        <ToggleSwitch
          layout="row"
          checked={maintenanceMode}
          onChange={toggleMaintenance}
          label={
            <span className="flex items-center gap-2">
              <MdWarning size={ICON.control} /> 维护模式
            </span>
          }
          description="开启后，所有非管理员用户访问前台将看到全屏维护提示"
        />
        {maintenanceMode && (
          <div className="mt-4">
            <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="othertab-f1">
              维护提示文字
            </label>
            <Textarea
              id="othertab-f1"
              value={maintenanceMessage}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              placeholder="例如：服务器正在升级维护…"
              rows={2}
              className="resize-none"
            />
          </div>
        )}
      </Card>
      <Card variant="filled">
        <ToggleSwitch
          layout="row"
          checked={translateEnabled}
          onChange={toggleTranslate}
          label={
            <span className="flex items-center gap-2">
              <MdTranslate size={ICON.control} /> 图片翻译功能
            </span>
          }
          description="控制前台大图模态框中是否展示“一键图片翻译”按钮"
        />
      </Card>
      <Card variant="transparent">
        {' '}
        <h3 className="text-label-l text-on-surface mb-4 flex items-center gap-2">
          
          <MdBarChart size={ICON.control} /> 全站数据统计
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
          
          <div className="text-center p-3 rounded-md">
            {' '}
            <div className="text-body-s text-on-surface-variant mb-1">图片总数</div>
            <div className="text-title-l-emphasized text-primary">
              {stats.images?.toLocaleString() || 0}
            </div>
          </div>
          <div className="text-center p-3 rounded-md">
            {' '}
            <div className="text-body-s text-on-surface-variant mb-1">标签总数</div>
            <div className="text-title-l-emphasized text-primary">
              {stats.tags?.toLocaleString() || 0}
            </div>
          </div>
          <div className="text-center p-3 rounded-md">
            {' '}
            <div className="text-body-s text-on-surface-variant mb-1">评论总数</div>
            <div className="text-title-l-emphasized text-primary">
              {stats.comments?.toLocaleString() || 0}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          
          <span className="text-body-m text-on-surface-variant">
            {' '}
            上次同步：<span className="">{stats.updated_at || '未同步'}</span>
          </span>
          <Button
            variant="accent"
            onClick={syncStats}
            loading={isLoading}
            icon={<MdSync size={ICON.dense} />}
          >
            立即同步
          </Button>
        </div>
      </Card>
      {confirmDialog}
    </div>
  );
}
