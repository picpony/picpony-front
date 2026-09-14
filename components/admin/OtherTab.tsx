'use client';

import { useState } from 'react';
import { showToast } from '@/components/Toast';
import ToggleSwitch from '@/components/ToggleSwitch';
import { MdBuild, MdWarning, MdTranslate, MdBarChart, MdRefresh, MdSave } from 'react-icons/md';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import Card from '@/components/Card';
import { Textarea } from '@/components/Input';
import { ICON } from '@/lib/icons';
import ErrorRetry from '@/components/ErrorRetry';
import Skeleton from '@/components/Skeleton';
import SectionHeading from '@/components/SectionHeading';
/* Namespace import, deliberately: `api` is a runtime spread and
   un-tree-shakeable, so only these admin tabs may import `lib/api/admin`. */
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';

const statusQuery = defineAdminQuery('site-status', async (_token, signal) => {
  const data = await adminApi.getMaintenanceStatus(signal);
  return adminData(data, {
    maintenanceMode: data.maintenance_mode === true,
    maintenanceMessage: typeof data.maintenance_message === 'string' ? data.maintenance_message : '',
    translateEnabled: data.translate_enabled !== false,
  });
});
interface SiteStats { images: number; tags: number; comments: number; updated_at: string }
const statsQuery = defineAdminQuery<SiteStats>('site-stats', async (_token, signal) => {
  const data = await adminApi.getSiteStats(signal);
  adminData(data, undefined);
  if (!data.stats || typeof data.stats !== 'object') throw new Error('统计数据响应无效');
  return data.stats as SiteStats;
});

export default function OtherTab({ token }: { token: string }) {
  const status = useAdminQuery(statusQuery, token);
  const statistics = useAdminQuery(statsQuery, token);
  const mutation = useAdminMutation(token);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);

  const { confirmThen, confirmDialog } = useConfirm();

  const maintenanceMode = status.data?.maintenanceMode ?? false;
  const translateEnabled = status.data?.translateEnabled ?? false;
  const stats = statistics.data ?? { images: 0, tags: 0, comments: 0, updated_at: '-' };
  const loaded = Boolean(status.data && !status.error);
  const message = maintenanceMessage ?? status.data?.maintenanceMessage ?? '';

  const commitMaintenance = async (newValue: boolean) => {
    if (!loaded || !status.data) return;
    const current = status.data;
    await mutation.run(() => adminApi.adminToggleMaintenance(token, {
      maintenance_mode: newValue,
      maintenance_message: message,
    }), () => {
      statusQuery.write(token, { ...current, maintenanceMode: newValue, maintenanceMessage: message });
      setMaintenanceMessage(null);
      showToast(newValue === current.maintenanceMode ? '维护提示已保存' : newValue ? '维护模式已开启' : '维护模式已关闭', 'success');
      status.refresh();
    });
  };

  const toggleMaintenance = async () => {
    if (!loaded) return;
    const newValue = !maintenanceMode;
    if (newValue) {
      confirmThen(
        '确认开启维护模式',
        '开启维护模式后，所有非管理员用户将无法访问网站，确定要开启吗？',
        () => commitMaintenance(newValue),
      );
    } else {
      await commitMaintenance(newValue);
    }
  };

  const toggleTranslate = async () => {
    if (!loaded || !status.data) return;
    const current = status.data;
    const newValue = !translateEnabled;
    await mutation.run(() => adminApi.adminToggleTranslate(token, { translate_enabled: newValue }),
      () => {
        statusQuery.write(token, { ...current, translateEnabled: newValue });
        showToast(newValue ? '翻译功能已开启' : '翻译功能已关闭', 'success');
        status.refresh();
      });
  };
  return (
    <div className="space-y-6">
      <SectionHeading icon={<MdBuild size={ICON.standard} />}>其他功能</SectionHeading>
      {status.error && <ErrorRetry size="inline" message={status.error} onRetry={status.refresh} />}
      {status.loading && <Skeleton className="h-20 w-full" />}
      <Card variant="filled">
        {/* `layout="row"` rather than a hand-built justify-between pair: same
            reading order, and the whole row is the label element, so clicking
            the supporting text toggles the switch it describes. */}
        <ToggleSwitch
          layout="row"
          checked={maintenanceMode}
          onChange={toggleMaintenance}
          disabled={!loaded || mutation.busy}
          label={
            <span className="flex items-center gap-2">
              <MdWarning size={ICON.control} /> 维护模式
            </span>
          }
          description="开启后，所有非管理员用户访问前台将看到全屏维护提示"
        />
        {loaded && (
          <div className="mt-4 space-y-3">
            <Textarea
              id="othertab-f1"
              label="维护提示文字"
              value={message}
              onChange={(e) => setMaintenanceMessage(e.target.value)}
              disabled={!loaded || mutation.busy}
              placeholder="例如：服务器正在升级维护…"
              rows={2}
              className="resize-none"
            />
            <Button variant="tonal" icon={<MdSave />} onClick={() => commitMaintenance(maintenanceMode)}
              loading={mutation.busy} disabled={message === status.data?.maintenanceMessage}>
              保存提示文字
            </Button>
          </div>
        )}
      </Card>
      <Card variant="filled">
        <ToggleSwitch
          layout="row"
          checked={translateEnabled}
          onChange={toggleTranslate}
          disabled={!loaded || mutation.busy}
          label={
            <span className="flex items-center gap-2">
              <MdTranslate size={ICON.control} /> 图片翻译功能
            </span>
          }
          description="控制前台大图模态框中是否展示“一键图片翻译”按钮"
        />
      </Card>
      <Card variant="transparent">
        <SectionHeading as="h3" icon={<MdBarChart size={ICON.control} />}>全站数据统计</SectionHeading>
        {statistics.error ? <ErrorRetry size="inline" message={statistics.error} onRetry={statistics.refresh} /> : <>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-4">
          
          <div className="text-center p-3 rounded-md">
            {' '}
            <div className="text-body-s text-on-surface-variant mb-1">图片总数</div>
            <div className="text-title-l-emphasized text-primary-ink">
              {statistics.loading ? <Skeleton className="mx-auto h-8 w-20" /> : stats.images?.toLocaleString() || 0}
            </div>
          </div>
          <div className="text-center p-3 rounded-md">
            {' '}
            <div className="text-body-s text-on-surface-variant mb-1">标签总数</div>
            <div className="text-title-l-emphasized text-primary-ink">
              {statistics.loading ? <Skeleton className="mx-auto h-8 w-20" /> : stats.tags?.toLocaleString() || 0}
            </div>
          </div>
          <div className="text-center p-3 rounded-md">
            {' '}
            <div className="text-body-s text-on-surface-variant mb-1">评论总数</div>
            <div className="text-title-l-emphasized text-primary-ink">
              {statistics.loading ? <Skeleton className="mx-auto h-8 w-20" /> : stats.comments?.toLocaleString() || 0}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          
          <span className="text-body-m text-on-surface-variant">
            上次更新：{stats.updated_at || '暂无记录'}
          </span>
          <Button
            variant="accent"
            onClick={statistics.refresh}
            loading={statistics.loading}
            icon={<MdRefresh />}
          >
            刷新统计
          </Button>
        </div>
        </>}
      </Card>
      {confirmDialog}
    </div>
  );
}
