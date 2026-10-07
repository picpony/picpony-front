'use client';

import type { MouseEvent, ReactNode } from 'react';
import Card from '@/components/Card';
import ProgressBar from '@/components/ProgressBar';
import Skeleton from '@/components/Skeleton';
import { SKIP, useResource } from '@/lib/resource';
import { formatCount } from '@/lib/format';
import SectionHeader from './SectionHeader';
import { useAdminQuery } from './queries';
import { reportsQuery, siteStatusQuery } from './sharedQueries';
import { dictionaryPage, tagFeedback } from './glossary/resources';
import { translatedShare } from './glossary/model';
import { adminHref, canAccess, type AdminPanelProps, type AdminTabId } from './registry';

/**
 * One of the overview's tiles: a figure and the section it comes from, the whole tile a link to
 * that section (`Card as="a"`) — its address is the section's own, so it opens in a new tab too,
 * and a plain press switches the section in place.
 */
function Tile({
  tab,
  label,
  value,
  caption,
  openTab,
  children,
}: {
  tab: AdminTabId;
  label: string;
  /** `undefined` while the read is in flight. */
  value: ReactNode | undefined;
  caption: string;
  openTab: (tab: AdminTabId) => void;
  children?: ReactNode;
}) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    openTab(tab);
  };
  return (
    <Card as="a" interactive variant="filled" href={adminHref(tab)} onClick={open} className="flex flex-col gap-1">
      <span className="text-label-l text-on-surface-variant">{label}</span>
      <span className="text-headline-s tabular-nums text-on-surface">
        {value === undefined ? <Skeleton className="my-1 h-7 w-20" /> : value}
      </span>
      {children}
      <span className="text-body-s text-on-surface-variant">{caption}</span>
    </Card>
  );
}

/**
 * 概览 — where the console opens: what is waiting, built from reads the sections already make, so
 * the figures cost no request the sections would not (R9-002: one heading and 「请从左侧菜单选择」,
 * where on a phone or tablet the menu is above the panel). An editor sees the glossary's tiles;
 * an administrator the moderation queue and the maintenance switch too.
 */
export default function WelcomeTab({ token, role, openTab }: AdminPanelProps) {
  const admin = canAccess('admin', role);
  const reports = useAdminQuery(reportsQuery, admin ? token : '');
  const status = useAdminQuery(siteStatusQuery, admin ? token : '');
  /* The glossary feedback queue's own first page — the same key the feedback dialog opens on. */
  const feedback = useResource(tagFeedback, token ? { token, status: 'pending', page: 1, keyword: '' } : SKIP);
  /* A one-row page: the statistics ride on any dictionary read. */
  const dictionary = useResource(
    dictionaryPage,
    token ? { token, page: 1, limit: 1, keyword: '', sort: 'count_desc', category: 'all', untranslated: false } : SKIP,
  );

  const pendingReports = reports.data?.filter((report) => report.status === 'pending').length;
  const stats = dictionary.data?.stats ?? null;
  const share = translatedShare(stats);
  const failed = '暂时无法读取';

  return (
    <div className="space-y-6">
      <SectionHeader section="welcome"
        subtitle="待处理的事项和站点状态。按下卡片进入对应的分区，其余功能在面板分区中选择。"
      />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="待办事项">
        {admin && (
          <li className="grid">
            <Tile
              tab="reports"
              label="待处理的举报"
              value={reports.error ? failed : pendingReports === undefined ? undefined : formatCount(pendingReports)}
              caption="前往举报处理"
              openTab={openTab}
            />
          </li>
        )}
        <li className="grid">
          <Tile
            tab="glossary"
            label="待处理的词库反馈"
            value={feedback.error && !feedback.data ? failed : feedback.data ? formatCount(feedback.data.summary.pending) : undefined}
            caption="前往词库编辑"
            openTab={openTab}
          />
        </li>
        <li className="grid">
          <Tile
            tab="glossary"
            label="词库翻译进度"
            value={
              dictionary.error && !dictionary.data
                ? failed
                : dictionary.data
                  ? share === null ? '暂无标签' : `${share.toFixed(2)}%`
                  : undefined
            }
            caption={stats ? `已翻译 ${formatCount(stats.translated)} / 共 ${formatCount(stats.total)} 个标签` : '前往词库编辑'}
            openTab={openTab}
          >
            {share !== null && <ProgressBar value={share} label="词库翻译进度" className="my-1" />}
          </Tile>
        </li>
        {admin && (
          <li className="grid">
            <Tile
              tab="other"
              label="维护模式"
              value={status.error && !status.data ? failed : status.data ? (status.data.maintenanceMode ? '已开启' : '未开启') : undefined}
              caption={status.data?.maintenanceMode ? '访客现在只能看到维护提示' : '前往其他功能'}
              openTab={openTab}
            />
          </li>
        )}
      </ul>
    </div>
  );
}
