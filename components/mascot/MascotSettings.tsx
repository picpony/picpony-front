'use client';

import { MdEmojiEmotions } from 'react-icons/md';
import Select from '@/components/Select';
import Skeleton from '@/components/Skeleton';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import { SettingsSection, SettingsRow, SwitchRow } from '@/app/settings/SettingsRow';
import { useSyncedSetting, changeSyncedSetting } from '@/lib/settingsSync';
import { mascotConfig } from '@/lib/mascot/queries';
import { useResource } from '@/lib/resource';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { ICON } from '@/lib/icons';
import type { MascotSize } from '@/lib/mascot/settings';

const SIZES: { value: MascotSize; label: string }[] = [
  { value: 'small', label: '小' }, { value: 'medium', label: '中' }, { value: 'large', label: '大' }, { value: 'xlarge', label: '特大' },
];

export default function MascotSettings() {
  const shown = useSyncedSetting('showMascot');
  const selected = useSyncedSetting('mascotId');
  const desktop = useSyncedSetting('mascotSizeDesktop');
  const mobile = useSyncedSetting('mascotSizeMobile');
  // The catalogue is shared by every character. Keep its controls in place while a new
  // character's first request resolves; the runtime uses that same keyed response.
  const config = useResource(mascotConfig, { selected }, { keepPrevious: 'mascot-catalog' });
  const options = [{ value: 'auto', label: '自动 / 随机' }, ...(config.data?.mascots.map(m => ({ value: m.id, label: m.name })) ?? [])];
  const available = config.data?.enabled === true;
  if (!options.some(o => o.value === selected)) {
    options.push({ value: selected, label: config.isPrevious ? '已选角色' : '已下线的角色' });
  }
  return (
    /* Its own glyph: the paw is 桌面小马's, and the two sections sat one above the other wearing
       the same icon. A face for the character who talks to you; the paw for the ponies that roam. */
    <SettingsSection
      title="吉祥物"
      icon={<MdEmojiEmotions size={ICON.control} />}
      subtitle="绘云彩彩陪你看图，长按可打开彩彩 AI"
      status={config.data === undefined && config.error !== undefined && (
        <ErrorRetry
          size="inline"
          title="吉祥物配置加载失败"
          message={apiErrorMessage(config.error)}
          onRetry={isRetryable(config.error) ? () => void config.refresh() : undefined}
        />
      )}
    >
      <SwitchRow label="显示吉祥物" description="轻触互动，收起后仍可随时展开" checked={shown} onChange={v => changeSyncedSetting('showMascot', v)} />
      {config.data === undefined ? (
        /* Direct siblings, not wrapped: `.m3-row`'s corners and 2px seams are scoped per parent
           (`app/globals.css`), so a wrapper around the placeholder rows turned 显示吉祥物 into a
           standalone fully-rounded row glued to a second rounded group with no seam, which then
           snapped into one run when the read landed. `aria-hidden` moves onto each row — the
           Skeletons are decorative either way. See `app/settings/SettingsRow.tsx`'s own contract. */
        config.error === undefined && (
          <>
            <SettingsRow label="选择角色" aria-hidden="true" leading={<Skeleton className="h-12 w-12 rounded-md" data-page-loading="" />} action={<Skeleton className="h-10 w-32" />} />
            <SettingsRow label="电脑端大小" aria-hidden="true" action={<Skeleton className="h-10 w-20" />} />
            <SettingsRow label="手机端大小" aria-hidden="true" action={<Skeleton className="h-10 w-20" />} />
          </>
        )
      ) : !available ? (
        <EmptyState size="inline" title="吉祥物暂未开放" />
      ) : (
        <>
          {/* The character as the row's media, so the choice is seen rather than named. Every row
              that only means something while the mascot is shown follows the switch together. */}
          <SettingsRow
            label="选择角色"
            leading={<MascotThumb src={config.data.image} />}
            action={<Select aria-label="选择吉祥物" size="sm" disabled={!shown} value={selected} options={options} onChange={value => changeSyncedSetting('mascotId', value)} />}
          />
          <SettingsRow
            label="电脑端大小"
            action={<Select aria-label="吉祥物电脑端大小" size="sm" disabled={!shown} value={desktop} options={SIZES} onChange={value => changeSyncedSetting('mascotSizeDesktop', value)} />}
          />
          <SettingsRow
            label="手机端大小"
            action={<Select aria-label="吉祥物手机端大小" size="sm" disabled={!shown} value={mobile} options={SIZES} onChange={value => changeSyncedSetting('mascotSizeMobile', value)} />}
          />
        </>
      )}
    </SettingsSection>
  );
}

/** The selected character's own art, aspect-fitted in the row's 48dp media slot. */
function MascotThumb({ src }: { src: string }) {
  return (
    <span className="relative block h-12 w-12 shrink-0 overflow-hidden rounded-md bg-surface-container-highest">
      {src && (
        /* eslint-disable-next-line @next/next/no-img-element -- administrator-configured art, served without a referrer like the figure itself. */
        <img src={src} alt="" referrerPolicy="no-referrer" decoding="async" className="absolute inset-0 h-full w-full object-contain p-1" />
      )}
    </span>
  );
}
