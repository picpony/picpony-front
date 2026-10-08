'use client';

import { useEffect, useState } from 'react';
import { MdRefresh, MdSpeed } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import { ICON } from '@/lib/icons';
import { currentLineLabels, raceImageLines, refreshRoutePolicy, subscribeRouteState } from '@/lib/route';
import { changeSyncedSetting, useSyncedSetting } from '@/lib/settingsSync';
import { SettingsRow, SettingsSection, SwitchRow } from './SettingsRow';

/* What the server renders: `resolveApiLine` answers `direct` there and no policy is ever loaded,
   so `ready` is what keeps the row from claiming a line before the client has read one. */
const INITIAL = { ready: false, api: '直连', image: '直连', apiForced: false, imageForced: false };

/**
 * 性能与加速. The line in force is not only this user's business: an administrator can pin the
 * whole site to one per axis (`lib/route.ts`). A pinned axis shows no switches at all — four
 * permanently disabled switches were noise on every visit — and the section says who decided;
 * 当前线路 still reports what is in use, and 重新检测 re-reads the policy either way.
 *
 * Subscribed rather than read once, because a failover can move the line while this is open; state
 * plus an effect rather than `useSyncExternalStore`, whose client snapshot is read during hydration
 * and would report the device's real line against server HTML built from the SSR fallback.
 */
export default function LinesSection() {
  const [lines, setLines] = useState(INITIAL);
  useEffect(() => {
    const read = () => {
      const labels = currentLineLabels();
      setLines({
        ready: true,
        api: labels.api,
        image: labels.raceWon ? `${labels.image}（竞速优选）` : labels.image,
        apiForced: labels.apiForced,
        imageForced: labels.imageForced,
      });
    };
    read();
    return subscribeRouteState(read);
  }, []);
  const [refreshing, setRefreshing] = useState(false);

  const cdn = useSyncedSetting('useCdn');
  const picponyProxy = useSyncedSetting('usePicponyProxy');
  const apiAccel = useSyncedSetting('useApiAccel');
  const relay = useSyncedSetting('useHongKongRelay');

  /* Re-read the site policy and re-measure the image lines: the policy is fetched once per load,
     so without this the only way to notice an administrator switching lines is to reload. The
     race reports through the same subscription, not this promise — it can take five seconds. */
  const refresh = async () => {
    setRefreshing(true);
    raceImageLines();
    await refreshRoutePolicy();
    setRefreshing(false);
  };

  const forced = lines.apiForced && lines.imageForced
    ? '线路已由管理员统一指定'
    : lines.apiForced
      ? 'API 线路已由管理员统一指定'
      : lines.imageForced
        ? '图片线路已由管理员统一指定'
        : undefined;

  return (
    <SettingsSection
      title="性能与加速"
      icon={<MdSpeed size={ICON.control} />}
      subtitle={forced}
      actions={
        <Button size="xs" variant="tonal" icon={<MdRefresh />} loading={refreshing} onClick={refresh}>
          重新检测
        </Button>
      }
    >
      {/* Which line is actually in use — not always what the switches say: an administrator can
          pin one, and a failover can move it mid-session. The row reports; the switches ask. */}
      <SettingsRow
        label="当前线路"
        badge={lines.apiForced || lines.imageForced ? <Badge tone="warning" size="sm">全站强制</Badge> : undefined}
        supporting={lines.ready ? `API：${lines.api} ｜ 图片：${lines.image}` : '检测中…'}
      />
      {!lines.imageForced && (
        <>
          <SwitchRow
            label="启用图片 CDN 加速"
            description="通过 wsrv.nl 加速图片加载"
            checked={cdn}
            onChange={(on) => changeSyncedSetting('useCdn', on)}
          />
          <SwitchRow
            label="启用 PicPony 加速服务器 (beta)"
            description="通过 PicPony 代理服务器加载图片，开启后自动启用 CDN 作为下一档"
            checked={picponyProxy}
            onChange={(on) => {
              changeSyncedSetting('usePicponyProxy', on);
              if (on) changeSyncedSetting('useCdn', true);
            }}
          />
        </>
      )}
      {!lines.apiForced && (
        <>
          <SwitchRow
            label="启用 PicPony API"
            description="通过 PicPony 中转访问 Derpibooru，直连不通时的首选线路"
            checked={relay}
            onChange={(on) => changeSyncedSetting('useHongKongRelay', on)}
          />
          {/* Disabled while the relay is on rather than hidden: with the relay preferred this has
              nothing left to select, and a vanished row would have to be rediscovered. No API-key
              gate (a divergence from the original front end): the accel line needs no credential. */}
          <SwitchRow
            label="启用 API 加速"
            description={relay ? '已优先使用 PicPony API，关闭后此项可选' : '通过备用 API 代理提升请求稳定性'}
            checked={apiAccel}
            onChange={(on) => changeSyncedSetting('useApiAccel', on)}
            disabled={relay}
          />
        </>
      )}
    </SettingsSection>
  );
}
