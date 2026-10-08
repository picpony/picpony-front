'use client';

import Link from 'next/link';
import { MdFilterList, MdNotifications, MdVisibility } from 'react-icons/md';
import Button, { buttonClasses } from '@/components/Button';
import Select from '@/components/Select';
import { ICON } from '@/lib/icons';
import { LS_KEYS } from '@/lib/constants';
import { useSession, useStoredBoolean } from '@/lib/hooks';
import { changeSyncedSetting, spoilersBlockedBy, useSyncedSetting } from '@/lib/settingsSync';
import LinesSection from './LinesSection';
import FavoritesSection from './FavoritesSection';
import { SettingsRow, SettingsSection, SwitchRow } from './SettingsRow';
import { text } from './useAccount';

/* What each level shows, in the words of the tag groups behind it (`lib/blockFilters.ts`): safe
   drops everything above the safe rating, 中等限制 keeps suggestive pictures and still drops
   explicit, questionable, grotesque and grimdark ones. */
const FILTER_DESCRIPTIONS: Record<string, string> = {
  safe: '只显示安全分级的图片',
  spoilers: '另显示擦边内容，仍拦截限制级与血腥内容',
  developer: '显示全部内容，不做分级筛选',
};

const SPOILERS_BLOCKED: Record<NonNullable<ReturnType<typeof spoilersBlockedBy>>, string> = {
  'signed-out': '中等限制需登录，并在个人资料中设置生日（年满 16 岁）',
  'no-birthday': '中等限制需在个人资料中设置生日（年满 16 岁）',
  'too-young': '中等限制需年满 16 岁',
};

/* No 相关度: it was never a Philomena field, and a default cannot know whether the query it meets
   can be ranked — /search offers 相关性 per query. */
const SORT_OPTIONS = [
  { value: 'created_at', label: '上传时间' },
  { value: 'updated_at', label: '更新时间' },
  { value: 'score', label: '评分' },
  { value: 'wilson_score', label: 'Wilson 评分' },
  { value: 'random', label: '随机' },
];

/**
 * 偏好 (decision 23) — how the app browses: content, display and sorting, lines, and the account's
 * email notifications. Usable signed out (device-local then, and the notifications are not offered);
 * signed in, all of it follows the account (`lib/settingsSync`). Defaults later features add — the
 * favourites' default folder among them — go here as sections of their own.
 */
export default function PreferencesPane({ onOpenAccount }: { onOpenAccount: () => void }) {
  const { user } = useSession();
  const developer = useStoredBoolean(LS_KEYS.developer);
  const filter = useSyncedSetting('contentFilter');
  const banAnthro = useSyncedSetting('banAnthro');
  const banDiscomfort = useSyncedSetting('banDiscomfort');
  const onlyPony = useSyncedSetting('onlyPony');
  const showTagCounts = useSyncedSetting('showTagCounts');
  const showChineseTags = useSyncedSetting('showChineseTags');
  const homeSort = useSyncedSetting('defaultHomeSort');
  const searchSort = useSyncedSetting('defaultSearchSort');
  const notifyMessage = useSyncedSetting('emailNotifMessage');
  const notifyReply = useSyncedSetting('emailNotifReply');
  const email = text(user?.email);

  /* The saved record decides, never a birthday typed into an open editor. */
  const blocked = spoilersBlockedBy(user);

  return (
    <div>
      <SettingsSection title="内容筛选" icon={<MdFilterList size={ICON.control} />}>
        <SettingsRow
          label="内容分级"
          supporting={
            <>
              <span className="block">{FILTER_DESCRIPTIONS[filter] ?? FILTER_DESCRIPTIONS.safe}</span>
              {blocked && (
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2">
                  {SPOILERS_BLOCKED[blocked]}
                  {blocked === 'no-birthday' && (
                    <Button variant="text" size="xs" onClick={onOpenAccount} className="-my-1.5">
                      前往账户
                    </Button>
                  )}
                </span>
              )}
            </>
          }
          action={
            <Select
              size="sm"
              value={filter}
              onChange={(value) => changeSyncedSetting('contentFilter', value)}
              aria-label="内容分级"
              options={[
                { value: 'safe', label: '完全安全 (Safe)' },
                { value: 'spoilers', label: '中等限制 (Spoilers)', disabled: blocked !== null },
                ...(developer || filter === 'developer' ? [{ value: 'developer', label: '开发者模式' }] : []),
              ]}
            />
          }
        />
        <SwitchRow
          label="禁止类人生物（马头人）"
          description="隐藏拟人化与人形化的角色图"
          checked={banAnthro}
          onChange={(on) => changeSyncedSetting('banAnthro', on)}
        />
        <SwitchRow
          label="屏蔽可能令您不适的内容"
          description="隐藏肥胖、惊悚、政治及部分恋物题材"
          checked={banDiscomfort}
          onChange={(on) => changeSyncedSetting('banDiscomfort', on)}
        />
        <SwitchRow
          label="只看小马（含类马）"
          description="只显示小马与麒麟、狮鹫、鹰马等同类角色"
          checked={onlyPony}
          onChange={(on) => changeSyncedSetting('onlyPony', on)}
        />
        {/* Hidden and covered tags are the account's block groups, managed on their own screen. */}
        <SettingsRow
          label="屏蔽组"
          supporting="按标签隐藏图片，或给图片盖上遮罩"
          action={
            <Link
              scroll={false}
              href="/block-groups"
              aria-label="管理屏蔽组"
              className={buttonClasses({ variant: 'tonal' })}
            >
              管理
            </Link>
          }
        />
      </SettingsSection>

      <SettingsSection title="显示与排序" icon={<MdVisibility size={ICON.control} />}>
        <SwitchRow
          label="显示标签数量"
          description="在标签旁显示带有该标签的图片数"
          checked={showTagCounts}
          onChange={(on) => changeSyncedSetting('showTagCounts', on)}
        />
        <SwitchRow
          label="显示中文标签 (beta)"
          description="用中文显示标签名"
          checked={showChineseTags}
          onChange={(on) => changeSyncedSetting('showChineseTags', on)}
        />
        <SettingsRow
          label="首页默认排序"
          action={
            <Select
              size="sm"
              value={homeSort}
              onChange={(value) => changeSyncedSetting('defaultHomeSort', value)}
              aria-label="首页默认排序"
              options={SORT_OPTIONS}
            />
          }
        />
        <SettingsRow
          label="搜索默认排序"
          action={
            <Select
              size="sm"
              value={searchSort}
              onChange={(value) => changeSyncedSetting('defaultSearchSort', value)}
              aria-label="搜索默认排序"
              options={SORT_OPTIONS}
            />
          }
        />
      </SettingsSection>

      <LinesSection />

      <FavoritesSection />

      {user && (
        <SettingsSection
          title="邮件通知"
          icon={<MdNotifications size={ICON.control} />}
          subtitle={email ? `发送到 ${email}` : '绑定邮箱后才能接收邮件通知'}
          actions={
            email ? undefined : (
              <Button size="xs" variant="tonal" onClick={onOpenAccount}>
                前往账户
              </Button>
            )
          }
        >
          <SwitchRow
            label="有人给我发私信"
            description="收到新私信时发邮件提醒"
            checked={notifyMessage}
            onChange={(on) => changeSyncedSetting('emailNotifMessage', on)}
            disabled={!email}
          />
          <SwitchRow
            label="有人回复我"
            description="帖子或评论收到回复时发邮件提醒"
            checked={notifyReply}
            onChange={(on) => changeSyncedSetting('emailNotifReply', on)}
            disabled={!email}
          />
        </SettingsSection>
      )}
    </div>
  );
}
