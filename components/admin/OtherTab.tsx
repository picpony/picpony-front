'use client';

import { useState } from 'react';
import { MdBarChart, MdSave, MdTranslate, MdWarning } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import ErrorRetry from '@/components/ErrorRetry';
import { Textarea } from '@/components/Input';
import SectionHeading from '@/components/SectionHeading';
import Skeleton from '@/components/Skeleton';
import ToggleSwitch from '@/components/ToggleSwitch';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { formatCount, formatDateTime } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { translateSwitch } from '@/lib/resources';
import { publishSavedSiteStatus } from '@/lib/siteStatus';
import * as adminApi from '@/lib/api/admin';
import { collectSiteStats } from '@/lib/api/adminSiteTools';
import SectionHeader from './SectionHeader';
import RefreshButton from './RefreshButton';
import { adminData, defineAdminQuery, retryError, useAdminQuery } from './queries';
import { siteStatusQuery as statusQuery } from './sharedQueries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';

/** The statistics as the wire carries them: each figure a number, a numeric string, or absent. */
interface SiteStats {
  images?: number | string | null;
  tags?: number | string | null;
  comments?: number | string | null;
  updated_at?: string | null;
}

const STAT_FIELDS = [
  { key: 'images', label: '图片总数' },
  { key: 'tags', label: '标签总数' },
  { key: 'comments', label: '评论总数' },
] as const;

const statsQuery = defineAdminQuery<SiteStats>('site-stats', async (_token, signal) => {
  const data = await adminApi.getSiteStats(signal);
  adminData(data, undefined, '全站统计');
  if (!data.stats || typeof data.stats !== 'object') throw new Error('全站统计加载失败');
  return data.stats as SiteStats;
});

/**
 * A statistic as the card prints it, or `—` when the document did not carry it — never a 0
 * (G4-015, the rule `figureOf` in ./figures states for the console's tables).
 */
function statText(value: unknown): string {
  const figure = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(figure) ? formatCount(figure) : '—';
}

/** The longest notice the maintenance screen shows; the server cuts anything past it. */
const MESSAGE_MAX = 500;

/**
 * A settings row while its value is unknown: the row's own shape, the switch's slot a placeholder.
 * Only the placeholder is hidden from assistive tech (`Skeleton` hides itself): the label and its
 * description are the row's real words, and hiding the whole row left a screen reader with nothing
 * where the two switches are (G4-021).
 */
function RowSkeleton({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-label-l text-on-surface">{label}</p>
        <p className="text-body-s text-on-surface-variant">{description}</p>
      </div>
      <Skeleton className="h-8 w-13 shrink-0 rounded-full" />
    </div>
  );
}

const MAINTENANCE_COPY =
  '开启后，访客和普通用户打开页面时将看到维护提示（含下方的提示文字）；管理人员仍可正常使用网站，页面顶部会显示正在维护。';
const TRANSLATE_COPY =
  '控制图片详情中的「一键翻译」。关闭后，用户将无法发起新的图片翻译。';

/**
 * 其他功能: the site's two switches and its statistics.
 *
 * The switches state only what is known: until the status document has been read, each row is
 * its own shape with a placeholder where the switch goes (R9-029: both used to show 关 under an
 * 80px bar, and 图片翻译 then flipped on when the read landed). Their copy says what each switch
 * does in this front end — the maintenance screen (`MaintenanceScreen`, rendered by the root
 * layout) and the picture detail's translate control (R9-027, R9-028).
 */
export default function OtherTab({ token }: AdminPanelProps) {
  const status = useAdminQuery(statusQuery, token);
  const statistics = useAdminQuery(statsQuery, token);
  const maintenanceMutation = useAdminMutation(token);
  const translateMutation = useAdminMutation(token);
  const syncMutation = useAdminMutation(token);
  const { confirmThen, confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<string | null>(null);

  const current = status.data;
  const message = draft ?? current?.maintenanceMessage ?? '';
  const messageError = message.length > MESSAGE_MAX ? `提示文字最多 ${MESSAGE_MAX} 字` : undefined;

  const commitMaintenance = (enabled: boolean) => {
    if (!current || messageError) return;
    void maintenanceMutation.run(
      () => adminApi.adminToggleMaintenance(token, { maintenance_mode: enabled, maintenance_message: message }),
      () => {
        setDraft(null);
        showToast(
          enabled === current.maintenanceMode ? '已保存维护提示' : enabled ? '已开启维护模式' : '已关闭维护模式',
          'success',
        );
      },
      '维护设置保存失败',
      {
        onCommitted: () => {
          publishSavedSiteStatus({ maintenance: enabled });
          statusQuery.write(token, (previous) => ({ ...(previous ?? current), maintenanceMode: enabled, maintenanceMessage: message }));
          status.refresh();
        },
      },
    );
  };

  const toggleMaintenance = (enabled: boolean) => {
    if (!current) return;
    if (!enabled) {
      commitMaintenance(false);
      return;
    }
    confirmThen(
      '确认开启维护模式',
      '确定要开启维护模式吗？访客和普通用户打开页面时将只能看到维护提示，无法使用网站。',
      () => commitMaintenance(true),
    );
  };

  const toggleTranslate = (enabled: boolean) => {
    if (!current) return;
    void translateMutation.run(
      () => adminApi.adminToggleTranslate(token, { translate_enabled: enabled }),
      () => showToast(enabled ? '已开启图片翻译' : '已关闭图片翻译', 'success'),
      '图片翻译设置保存失败',
      {
        onCommitted: () => {
          translateSwitch.write({}, enabled);
          statusQuery.write(token, (previous) => ({ ...(previous ?? current), translateEnabled: enabled }));
          status.refresh();
        },
      },
    );
  };

  const stats = statistics.data;

  return (
    <div className="space-y-6">
      <SectionHeader section="other" />

      <section aria-label="站点开关" aria-busy={!current && !status.error ? true : undefined} className="space-y-4">
        {status.error && !current ? (
          <ErrorRetry size="inline" {...retryError('站点状态加载失败', status.error)} onRetry={status.retryable ? status.refresh : undefined} />
        ) : null}
        <Card variant="filled" className="space-y-4">
          {current ? (
            <ToggleSwitch
              layout="row"
              checked={current.maintenanceMode}
              onChange={toggleMaintenance}
              disabled={maintenanceMutation.busy}
              label={
                <span className="flex items-center gap-2">
                  <MdWarning size={ICON.control} aria-hidden="true" /> 维护模式
                </span>
              }
              description={MAINTENANCE_COPY}
            />
          ) : (
            <RowSkeleton label="维护模式" description={MAINTENANCE_COPY} />
          )}
          {current && (
            <div className="space-y-3">
              <Textarea
                id="other-maintenance-message"
                label="维护提示文字"
                rows={2}
                className="resize-none"
                value={message}
                readOnly={maintenanceMutation.busy}
                error={messageError}
                count={{ value: message.length, max: MESSAGE_MAX }}
                helper="留空则显示默认的维护提示"
                placeholder="例如：服务器正在升级维护，预计一小时后恢复…"
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="tonal"
                  icon={<MdSave />}
                  loading={maintenanceMutation.busy}
                  disabled={message === current.maintenanceMessage || Boolean(messageError)}
                  onClick={() => commitMaintenance(current.maintenanceMode)}
                >
                  保存提示文字
                </Button>
              </div>
            </div>
          )}
        </Card>
        <Card variant="filled">
          {current ? (
            <ToggleSwitch
              layout="row"
              checked={current.translateEnabled}
              onChange={toggleTranslate}
              disabled={translateMutation.busy}
              label={
                <span className="flex items-center gap-2">
                  <MdTranslate size={ICON.control} aria-hidden="true" /> 图片翻译
                </span>
              }
              description={TRANSLATE_COPY}
            />
          ) : (
            <RowSkeleton label="图片翻译" description={TRANSLATE_COPY} />
          )}
        </Card>
      </section>

      <section aria-labelledby="admin-site-statistics-heading" className="space-y-4">
        <SectionHeading
          as="h3"
          icon={<MdBarChart size={ICON.control} />}
          actions={<RefreshButton onClick={statistics.refresh} label="刷新统计" loading={statistics.refreshing} />}
        >
          <span id="admin-site-statistics-heading">全站数据统计</span>
        </SectionHeading>
        {statistics.error && stats && <ErrorRetry size="inline" {...retryError('全站统计刷新失败', statistics.error)} onRetry={statistics.retryable ? statistics.refresh : undefined} />}
        {statistics.error && !stats ? (
          <ErrorRetry size="inline" {...retryError('全站统计加载失败', statistics.error)} onRetry={statistics.retryable ? statistics.refresh : undefined} />
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {STAT_FIELDS.map(({ key, label }) => (
                <Card key={key} variant="filled" padding="sm" className="space-y-1">
                  <dt className="text-body-s text-on-surface-variant">{label}</dt>
                  <dd className="text-title-l tabular-nums text-on-surface">
                    {stats ? statText(stats[key]) : <Skeleton className="h-8 w-24" />}
                  </dd>
                </Card>
              ))}
            </dl>
            <p className="text-body-s text-on-surface-variant">
              {stats ? `统计更新于 ${stats.updated_at ? formatDateTime(stats.updated_at) : '暂无记录'}` : ' '}
            </p>
          </>
        )}
        <Button variant="tonal" loading={syncMutation.busy} onClick={() => confirmThen('确认同步全站统计', '确定要从 Derpibooru 同步图片、标签和评论总数吗？将按当前全站线路读取三项总数，全部成功后更新本站统计。', () => void syncMutation.run(
          async (isCurrent) => {
            const counts = await collectSiteStats(token, isCurrent);
            return counts && isCurrent() ? adminApi.adminSyncSiteStats(token, counts) : null;
          },
          () => showToast('已同步全站统计', 'success'), '全站统计同步失败', { onCommitted: () => statsQuery.invalidate() },
        ))}>同步全站统计</Button>
      </section>
      {confirmDialog}
    </div>
  );
}
