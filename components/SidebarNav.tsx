'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import {
  MdHome,
  MdForum,
  MdSearch,
  MdCloudUpload,
  MdEditNote,
  MdCollectionsBookmark,
  MdNotifications,
  MdHistory,
  MdEmojiEvents,
  MdShield,
  MdSettings,
  MdDashboard,
  MdLogout,
} from 'react-icons/md';
import { useBackgroundSearchParams } from './BackgroundLocation';
import { CountBadge } from './Badge';
import { cn } from '@/lib/utils';
import { isStaff } from '@/lib/roles';
import { ICON } from '@/lib/icons';

export interface SidebarUser {
  id?: number;
  username: string;
  role: string;
}

interface SidebarNavProps {
  user: SidebarUser | null;
  /** Pathname of the page *behind* any image-detail overlay. */
  backgroundPathname: string;
  unread: number;
  onNavigate: () => void;
  onLogout: () => void;
}

/* **48dp rows under a pointer, 56 under a finger.** 56 is M3's navigation-drawer
   item height and it is a touch figure: this drawer is the only navigation on a
   phone, and a phone is where 56 earns its keep. On a desktop it is a repeated
   element — thirteen of them signed in, which measured 930px of column against a
   736px viewport — so it takes the density step down.

   `pointer-coarse:h-14` rather than `touch-size`, and the difference matters: that
   utility raises a box to `--touch-floor`, which is 48, so it can only help a control
   that is *smaller* than the floor. This row is already at the floor and needs to go
   past it, which is a size decision rather than a hit-area one. `touch-size` is for
   the 40dp cases — a menu row, a pagination number, an app-bar action — where the
   floor is the thing being reached.

   A 24dp glyph in a 48dp box still leaves 12dp above and below, which is the
   drawer item's own leading space, so nothing is crowded by the change.
   `py-2` gave ~36px once, and a first pass corrected that to 48 by reaching for
   the touch minimum — the number was right and the reason was wrong, which is
   why it then moved to 56 and is now back. The pill shape is the spec's
   (`ActiveIndicatorShape = CornerFull`) and does not move.

   The padding is **asymmetric, and that is the spec's**: `NavigationDrawer.kt`'s
   item row is `padding(start = 16.dp, end = 24.dp)`. It read 16/16 here, which
   crowded the trailing unread badge against the drawer's edge — the extra 8dp
   exists because a trailing element needs more air than a leading one. It stays
   asymmetric at both densities, because it is about the badge rather than the
   height. The 12dp between the icon and the label is the spacer in the same row,
   and `gap-3` covers the label-to-badge spacer at 12dp as well (also the spec's). */
const ROW = cn(
  'flex h-12 pointer-coarse:h-14 w-full items-center gap-3 rounded-full pl-4 pr-6',
  'text-label-l outline-none transition-ui',
  'focus-visible:ring-2 focus-ring',
);

function NavItem({
  href,
  icon,
  label,
  active,
  badge,
  onClick,
  scroll,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
  /** `false` leaves the scroller alone on commit — see the home entries below. */
  scroll?: boolean;
}) {
  const inner = (
    <>
      {/* A fixed, centred cell rather than a bare span around the glyph. An
          inline <svg> sits on the text baseline, which left each icon a
          fraction low and by a different amount per glyph; a grid cell takes
          it out of inline flow entirely and pins every label to the same x. */}
      <span className="grid h-6 w-6 shrink-0 place-items-center [&>svg]:block" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {/* `CountBadge`, not a second copy of it. This span was byte-identical to
          the primitive's class string — same box, same `min-w`, same `99+`
          clamp — minus the two things the primitive adds: the spring pop when
          the count arrives, and an accessible name, so a screen reader read the
          drawer as "消息 3" with no unit. */}
      <CountBadge count={badge ?? 0} label={badge ? `${badge} 条未读` : undefined} />
    </>
  );

  const className = cn(
    ROW,
    active
      ? /* `secondary-container`, which is both M3's own navigation-drawer active
           fill and the pair this app already uses everywhere else it means
           "selected" — `IconButton`'s selected state, a selected `Chip`, the
           messages contact list. The sidebar was the one holdout.

           It also settles the concern the previous value was chosen for. That was
           `bg-primary` at 10%, tinted at state-layer weight because "a filled pill at
           container strength dominated the drawer — the active row read louder
           than the page content beside it". True of `primary-container`, which is
           the brand hue; `secondary` is the muted rose two steps off it, so its
           container marks position without shouting.

           And a 10% alpha could not do the job in both schemes: composited over
           the dark surface it was very nearly invisible, which left `text-primary`
           carrying "you are here" on its own. A tonal step reads in both — the
           same argument the `*-fill` tokens in globals.css are built on. */
        'bg-secondary-container text-on-secondary-container'
      : 'text-on-surface-variant state-layer',
  );

  if (!href) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-ripple
        className={cn(className, 'cursor-pointer')}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={href}
      scroll={scroll}
      onClick={onClick}
      data-ripple
      aria-current={active ? 'page' : undefined}
      className={className}
    >
      {inner}
    </Link>
  );
}

function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      {/* `pt-2 pb-1`, i.e. 8 above and 4 below a 20px `title-s` line box, for 32px
          total. It read `pt-3` (36px), which is on the 4dp grid and on no rhythm:
          a heading binds to what it introduces, so the space above it has to be
          the larger one. That is the same 2:1 asymmetry `.bbcode-content`'s own
          heading rule uses (`1.25em 0.5em`). */}
      {label && <h2 className="text-title-s text-on-surface-variant px-4 pt-2 pb-1">{label}</h2>}
      {children}
    </div>
  );
}

/**
 * The drawer's navigation.
 *
 * The main `<nav>` used to contain exactly one entry — 主页 — with everything
 * else buried inside a collapsed menu that only appeared once you were signed
 * in. So a signed-out visitor had no route to the forum, search or anything
 * else except by guessing a URL. Destinations are grouped by what you're trying
 * to do instead, and the browse/create groups are always present.
 */
export default function SidebarNav({
  user,
  backgroundPathname,
  unread,
  onNavigate,
  onLogout,
}: SidebarNavProps) {
  const searchParams = useBackgroundSearchParams();
  const onHome = backgroundPathname === '/';
  const forumTab = searchParams.get('tab') === 'forum';
  const staff = isStaff(user?.role);

  return (
    <nav aria-label="主导航" className="flex flex-1 flex-col gap-1 px-3 pb-3">
      <Section>
        {/* `scroll={false}` only while already on the home page: from here these
            two are the same control as the tab bar, and the tab machinery owns
            the scroller — it restores each tab's own offset and holds the
            outgoing pane over the pixels you were looking at. Letting Next reset
            the scroller on top of that is what made the sidebar land at the top
            while the tab bar came back to where you were. Arriving from another
            route it is a genuine navigation and the default (top) is right. */}
        <NavItem
          href="/"
          icon={<MdHome size={ICON.standard} />}
          label="主页"
          active={onHome && !forumTab}
          scroll={onHome ? false : undefined}
          onClick={onNavigate}
        />
        <NavItem
          href="/?tab=forum"
          icon={<MdForum size={ICON.standard} />}
          label="论坛"
          active={onHome && forumTab}
          scroll={onHome ? false : undefined}
          onClick={onNavigate}
        />
        <NavItem
          href="/search"
          icon={<MdSearch size={ICON.standard} />}
          label="搜索"
          active={backgroundPathname === '/search'}
          onClick={onNavigate}
        />
      </Section>

      {user && (
        <Section label="创作">
          <NavItem
            href="/upload"
            icon={<MdCloudUpload size={ICON.standard} />}
            label="发布图片"
            active={backgroundPathname === '/upload'}
            onClick={onNavigate}
          />
          <NavItem
            href="/forum/create"
            icon={<MdEditNote size={ICON.standard} />}
            label="发布帖子"
            active={backgroundPathname === '/forum/create'}
            onClick={onNavigate}
          />
        </Section>
      )}

      {user && (
        <Section label="我的">
          <NavItem
            href="/favorites"
            icon={<MdCollectionsBookmark size={ICON.standard} />}
            label="我的收藏"
            active={backgroundPathname === '/favorites'}
            onClick={onNavigate}
          />
          <NavItem
            href="/messages"
            icon={<MdNotifications size={ICON.standard} />}
            label="消息"
            active={backgroundPathname === '/messages'}
            badge={unread}
            onClick={onNavigate}
          />
          <NavItem
            href="/history"
            icon={<MdHistory size={ICON.standard} />}
            label="浏览历史"
            active={backgroundPathname === '/history'}
            onClick={onNavigate}
          />
          <NavItem
            href="/tasks"
            icon={<MdEmojiEvents size={ICON.standard} />}
            label="任务"
            active={backgroundPathname === '/tasks'}
            onClick={onNavigate}
          />
          <NavItem
            href="/block-groups"
            icon={<MdShield size={ICON.standard} />}
            label="屏蔽组"
            active={backgroundPathname === '/block-groups'}
            onClick={onNavigate}
          />
        </Section>
      )}

      {/* `shrink-0` for the same reason as the structural rule in `AppLayout`: a
          1px flex item in a column absorbs overflow and collapses to nothing. */}
      {user && <div className="bg-outline-variant mx-4 my-2 h-px shrink-0" />}

      <Section>
        {user && (
          <NavItem
            href="/settings"
            icon={<MdSettings size={ICON.standard} />}
            label="设置"
            active={backgroundPathname === '/settings'}
            onClick={onNavigate}
          />
        )}
        {staff && (
          <NavItem
            href="/admin"
            icon={<MdDashboard size={ICON.standard} />}
            label="管理面板"
            active={backgroundPathname.startsWith('/admin')}
            onClick={onNavigate}
          />
        )}
        {user && <NavItem icon={<MdLogout size={ICON.standard} />} label="登出" onClick={onLogout} />}
      </Section>
    </nav>
  );
}
