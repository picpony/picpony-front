'use client';

import { useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { useIntentPrefetch } from '@/lib/useIntentPrefetch';
import { prefetchRoute } from '@/lib/prefetchRoute';
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
   item height and it is a touch figure — this drawer is the only navigation on a
   phone; on a desktop it is a repeated element and takes the density step down.

   `pointer-coarse:h-14` rather than `touch-size`, and the difference matters:
   `touch-size` raises a box *to* `--touch-floor` (48), which can only help a
   control smaller than the floor. This row is already at the floor and needs to
   go past it — a size decision, not a hit-area one.

   The padding is **asymmetric, and that is the spec's** (`NavigationDrawer.kt`:
   `padding(start = 16.dp, end = 24.dp)`), which gives the trailing unread badge
   its air. The pill shape is the spec's (`ActiveIndicatorShape = CornerFull`). */
const ROW = cn(
  'flex h-12 pointer-coarse:h-14 w-full items-center gap-3 rounded-full pl-4 pr-6',
  'outline-none transition-ui state-layer',
  'focus-visible:ring-2 focus-ring',
);

function NavItem({
  href,
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  /* Only the rows that navigate. The drawer's two `<button>` rows (sign out,
     sign in) have no destination to warm, and `useIntentPrefetch` is given a
     null warmer rather than being called conditionally — a hook cannot be. */
  const intent = useIntentPrefetch(
    useCallback(() => {
      if (href) prefetchRoute(href);
    }, [href]),
  );

  const inner = (
    <>
      {/* A fixed, centred cell rather than a bare span around the glyph: an
          inline svg sits on the text baseline, which left each icon a fraction
          low and by a different amount per glyph. */}
      <span className="grid h-6 w-6 shrink-0 place-items-center [&>svg]:block" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {/* `CountBadge`, not a second copy of it: the primitive adds the spring
          pop and an accessible name ("3 条未读"), which a hand-rolled span
          dropped. */}
      <CountBadge count={badge ?? 0} label={badge ? `${badge} 条未读` : undefined} />
    </>
  );

  const className = cn(
    ROW,
    active
      ? /* `secondary-container`: M3's own navigation-drawer active fill, and
           the pair this app already uses everywhere it means "selected". The
           previous 10% `bg-primary` tint was nearly invisible composited over
           the dark surface, leaving the ink to carry "you are here" alone; a
           tonal step reads in both schemes. */
        'bg-secondary-container text-on-secondary-container text-label-l-emphasized'
      : 'text-on-surface-variant text-label-l',
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
      scroll={false}
      href={href}
      onClick={onClick}
      /* Hover, focus and press each start the destination's *data*, not only its code. Next's own
         `<Link>` prefetch already warms the RSC payload and the chunk, and on this app that buys
         less than it looks like: every screen here is a client component that begins its reads in
         its first effect, so a warm chunk still arrives at an empty page. See `prefetchRoute`. */
      {...intent}
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
      {/* `pt-2 pb-1` — 8 above and 4 below a 20px `title-s` line box. A heading
          binds to what it introduces, so the space above has to be the larger
          one (the same 2:1 asymmetry the base heading rule uses). */}
      {label && <h2 className="text-title-s text-on-surface-variant px-4 pt-2 pb-1">{label}</h2>}
      {children}
    </div>
  );
}

/**
 * The drawer's navigation. Destinations grouped by what you're trying to do;
 * the browse/create groups are always present, signed in or not.
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
        {/* `scroll={false}` unconditionally: these two are the same control as
            the tab bar, and the tab machinery owns the scroller (it restores
            each tab's own offset). `lib/scrollMemory.ts` owns every case and
            skips a search-only change. */}
        <NavItem
          href="/"
          icon={<MdHome size={ICON.standard} />}
          label="主页"
          active={onHome && !forumTab}
          onClick={onNavigate}
        />
        <NavItem
          href="/?tab=forum"
          icon={<MdForum size={ICON.standard} />}
          label="论坛"
          active={onHome && forumTab}
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

      {/* `shrink-0` for the same reason as the structural rule in `AppLayout`:
          a 1px flex item in a column absorbs overflow and collapses to
          nothing. */}
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
