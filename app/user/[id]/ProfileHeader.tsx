'use client';

import type { MouseEvent, ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  MdAccessTime,
  MdCake,
  MdChevronRight,
  MdEdit,
  MdEvent,
  MdFemale,
  MdMale,
  MdMessage,
  MdPerson,
  MdPets,
  MdPlace,
  MdVerified,
} from 'react-icons/md';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import BadgeWall from '@/components/BadgeWall';
import Card from '@/components/Card';
import FadeInImage from '@/components/FadeInImage';
import ProgressBar from '@/components/ProgressBar';
import RoleBadge from '@/components/RoleBadge';
import Skeleton from '@/components/Skeleton';
import UserBadge from '@/components/UserBadge';
import { buttonClasses } from '@/components/buttonStyles';
/* 编辑资料, the API key, the privacy switches: all of them are 账户's, and the bare address opens
   偏好 (review P5-F3). */
import { settingsHref } from '@/app/settings/tabs';
import { birthdayLabel, formatDate, lastOnlineStatus } from '@/lib/format';
import { genderLabel, normalizeGender, raceLabel } from '@/lib/profileFields';
import { bioOf, derpiProfileHref, ipLocationOf } from '@/lib/profiles';
import { parseEquippedBadges, parseHeldBadges, wornBadges } from '@/lib/userBadges';
import { getAssetUrl } from '@/lib/utils';
import { ICON } from '@/lib/icons';
import type { ProfileUser } from '@/lib/types/user';

/** The banner's box, with a picture — the detail column's width at every step. */
const BANNER_BOX = 'h-48 sm:h-64 md:h-80 rounded-2xl sm:rounded-3xl';

/**
 * The banner. With a picture it is the page's largest paint — /user/1's LCP element — so it loads
 * eagerly at high fetch priority (R7-041). Without one it is a short band in the brand's container
 * tone and nothing else (R7-021): the grey box it replaced was as tall as a banner and repeated
 * the avatar's glyph right above the avatar.
 */
function Banner({ profile }: { profile: ProfileUser | undefined }) {
  if (!profile) return <Skeleton className={`w-full ${BANNER_BOX}`} />;
  const src = profile.banner ? getAssetUrl(profile.banner) : '';
  if (!src) return <div aria-hidden="true" className="h-24 w-full rounded-2xl bg-primary-container sm:h-32 sm:rounded-3xl" />;
  return (
    <div className={`relative w-full overflow-hidden bg-surface-container-high ${BANNER_BOX}`}>
      <FadeInImage
        src={src}
        alt={`${profile.username} 的个人横幅`}
        fill
        /* The detail column is 1024px at most; `fill` alone resolved to `100vw`. */
        sizes="(min-width: 1024px) 1024px, 100vw"
        eager
        fetchPriority="high"
        className="object-cover"
      />
    </div>
  );
}

function MetaItem({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 [&>svg]:block" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </span>
  );
}

function genderIcon(value: unknown) {
  const stored = normalizeGender(value);
  if (stored === '男') return <MdMale size={ICON.dense} />;
  if (stored === '女') return <MdFemale size={ICON.dense} />;
  return <MdPerson size={ICON.dense} />;
}

/**
 * The bound Derpibooru account, as a link into the app's own Derpibooru profile — its uploads,
 * awards and the way out to the original site are there (R7-019). No avatar: the one this card
 * built never existed on the CDN (R7-018), and the account's real one is a read this page does
 * not need to make. An account named without an API key to prove it says so as a mark; its owner
 * is told where to prove it, and the card takes them there.
 */
function DerpiAccountCard({ profile, own }: { profile: ProfileUser; own: boolean }) {
  const router = useRouter();
  const derpiHref = derpiProfileHref(profile);
  if (!derpiHref) return null;
  const verified = profile.has_api_key === true;
  const href = own && !verified ? settingsHref('account') : derpiHref;
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(href, { scroll: false });
  };
  const supporting = verified
    ? 'Derpibooru 账户'
    : own
      ? '在设置中绑定 API Key 以核验身份'
      : 'Derpibooru 账户，尚未核验';
  return (
    <Card as="a" href={href} onClick={navigate} variant="outlined" padding="sm" interactive>
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high"
        >
          <Image src="/img/derpi.svg" alt="" width={24} height={24} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-title-s text-on-surface">{profile.derpi_username}</span>
            {!verified && <Badge tone="warning">未核验</Badge>}
          </span>
          <span className="truncate text-body-s text-on-surface-variant">{supporting}</span>
        </span>
        <MdChevronRight size={ICON.standard} aria-hidden="true" className="shrink-0 text-on-surface-variant" />
      </span>
    </Card>
  );
}

interface ProfileHeaderProps {
  /** `undefined` while the record loads: the header draws its own placeholders in place. */
  profile: ProfileUser | undefined;
  own: boolean;
  /** The viewer is signed in and is not the owner: 发送私信 is offered. */
  canMessage: boolean;
  /** The page's clock (see `ProfileContent`); `null` only when nothing has told the time yet. */
  now: number | null;
  onManageBadges?: () => void;
}

/**
 * The profile's header: banner, avatar, name and marks, level, the metadata line, bio, badge wall
 * and the Derpibooru account.
 *
 * **One tree for loading and loaded.** The `<h1>` is the same element in both — hidden text while
 * the record loads, the name once it lands — so a route change that focused it (AppLayout moves
 * focus to the incoming page's heading) keeps focus when the content arrives.
 *
 * **Nothing the session decides moves the layout.** The session is read after hydration, so what
 * depends on it — 发送私信, 编辑资料, 管理佩戴, the owner's wording — takes space that is already
 * there: the actions sit in the band beside the avatar, the wall's heading row keeps its height.
 */
export default function ProfileHeader({ profile, own, canMessage, now, onManageBadges }: ProfileHeaderProps) {
  const held = parseHeldBadges(profile?.badges);
  const worn = profile && now !== null ? wornBadges(parseEquippedBadges(profile.equipped_badges), held, now) : [];
  const experience = profile && typeof profile.experience === 'number' ? profile.experience : null;
  const level = experience !== null ? Math.floor(experience / 100) + 1 : null;
  const xpInLevel = experience !== null ? ((experience % 100) + 100) % 100 : 0;

  const gender = profile ? genderLabel(profile.gender) : null;
  const race = profile ? raceLabel(profile.race) : null;
  const birthday = profile ? birthdayLabel(profile.birthday) : null;
  const joined = profile?.created_at ? formatDate(profile.created_at) : '';
  const seen = profile?.last_online && now !== null ? lastOnlineStatus(profile.last_online, now) : null;
  const location = profile ? ipLocationOf(profile) : null;
  const bio = profile ? bioOf(profile) : '';

  return (
    <div>
      <Banner profile={profile} />
      <div className="relative pt-12 sm:pt-16">
        <div className="absolute -top-12 left-0 sm:-top-16">
          {profile ? (
            /* The page's other large paint: eager, at high priority (R1-028). */
            <Avatar src={profile.avatar} name={profile.username} size="hero" priority className="border-4 border-surface" />
          ) : (
            <Skeleton className="size-24 rounded-full border-4 border-surface sm:size-32" />
          )}
        </div>
        {/* The band beside the avatar: an action appearing with the session lands in space
            that was already there (48dp band, 40dp control; 64dp from `sm`). */}
        <div className="absolute right-0 top-1 flex gap-2 sm:top-3">
          {profile && own && (
            <Link scroll={false} href={settingsHref('account')} className={buttonClasses({ variant: 'tonal' })}>
              <MdEdit aria-hidden="true" />
              编辑资料
            </Link>
          )}
          {profile && canMessage && (
            <Link scroll={false} href={`/messages?to=${profile.id}`} className={buttonClasses({ variant: 'filled' })}>
              <MdMessage aria-hidden="true" />
              发送私信
            </Link>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:mt-4">
          <h1
            className={
              profile ? 'text-headline-s sm:text-headline-m min-w-0 max-w-full wrap-anywhere text-on-surface' : 'sr-only'
            }
          >
            {profile ? profile.username : '个人资料'}
          </h1>
          {!profile && <Skeleton className="h-8 w-40 sm:h-9 sm:w-48" />}
          {profile && (
            <>
              {/* Ordinary users carry no role mark (R7-015): "this person is a person" is not an
                  annotation. */}
              <RoleBadge role={profile.role} size="md" />
              {profile.has_api_key === true && profile.derpi_username && (
                <Badge tone="success" size="md" icon={<MdVerified />}>
                  已核验
                </Badge>
              )}
              {/* The worn set — what appears beside this name everywhere else. */}
              {worn.map((badge) => (
                <UserBadge key={badge.badge_name} name={badge.badge_name} color={badge.badge_color} size="md" />
              ))}
            </>
          )}
        </div>

        {level !== null ? (
          /* The level as a labelled meter, the shape /tasks gives the same value. Capped, so a
             meter as wide as the column does not read as a divider under the name. */
          <div className="mt-3 max-w-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-label-l text-on-surface">Lv.{level}</span>
              <span className="text-label-m tabular-nums text-on-surface-variant">经验：{xpInLevel} / 100</span>
            </div>
            {/* The theme's accent: the level is one of 多色's accent moments. */}
            <ProgressBar value={xpInLevel} tone="tertiary" label={`等级 ${level} 经验进度`} className="mt-1.5" />
          </div>
        ) : (
          !profile && <Skeleton className="mt-3 h-9 w-full max-w-xs" />
        )}

        {profile ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-body-m text-on-surface-variant">
            {gender && <MetaItem icon={genderIcon(profile.gender)}>{gender}</MetaItem>}
            {race && <MetaItem icon={<MdPets size={ICON.dense} />}>{race}</MetaItem>}
            {birthday && <MetaItem icon={<MdCake size={ICON.dense} />}>{birthday}</MetaItem>}
            {joined && <MetaItem icon={<MdEvent size={ICON.dense} />}>注册于 {joined}</MetaItem>}
            {seen &&
              (seen.online ? (
                /* 在线 is a state, not a time (R7-017). */
                <span className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 rounded-full bg-success-fill forced-mark" />
                  在线
                </span>
              ) : (
                <MetaItem icon={<MdAccessTime size={ICON.dense} />}>上次在线：{seen.text}</MetaItem>
              ))}
            {location && <MetaItem icon={<MdPlace size={ICON.dense} />}>IP 属地：{location}</MetaItem>}
          </div>
        ) : (
          <Skeleton className="mt-4 h-5 w-full max-w-md" />
        )}

        {profile ? (
          <div className="mt-4">
            {bio ? (
              <p className="whitespace-pre-wrap wrap-anywhere text-body-m text-on-surface">{bio}</p>
            ) : (
              <p className="text-body-m text-on-surface-variant">
                {own ? '你还没有填写个人简介' : '该用户很懒，什么都没有留下。'}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        )}

        {profile && held.length > 0 && now !== null && (
          <div className="mt-6">
            <BadgeWall
              badges={held}
              equipped={new Set(worn.map((badge) => badge.badge_name))}
              now={now}
              onManage={own ? onManageBadges : undefined}
            />
          </div>
        )}

        {profile && derpiProfileHref(profile) && (
          <div className="mt-6">
            <DerpiAccountCard profile={profile} own={own} />
          </div>
        )}
      </div>
    </div>
  );
}
