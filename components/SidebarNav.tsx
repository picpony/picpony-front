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
import { cn } from '@/lib/utils';
import { isStaff } from '@/lib/roles';

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

/* 48px rows. The previous `py-2` gave ~36px, under the comfortable touch
   target, and this drawer is the only navigation on a phone. */
const ROW = cn(
  'flex h-12 w-full items-center gap-3 rounded-full px-4',
  'text-label-l outline-none transition-ui',
  'focus-visible:ring-2 focus-visible:ring-primary/40',
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
      {!!badge && (
        <span className="bg-error-fill text-on-fill text-label-s-emphasized leading-none tabular-nums flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </>
  );

  const className = cn(
    ROW,
    active
      ? // A filled pill at container strength dominated the drawer — the active
        // row read louder than the page content beside it. Tinted at state-layer
        // weight instead, so it marks position without competing.
        'bg-primary/10 text-primary font-medium'
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
      {label && <h2 className="text-label-m text-outline px-4 pt-3 pb-1 tracking-wide">{label}</h2>}
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
          icon={<MdHome size={22} />}
          label="主页"
          active={onHome && !forumTab}
          scroll={onHome ? false : undefined}
          onClick={onNavigate}
        />
        <NavItem
          href="/?tab=forum"
          icon={<MdForum size={22} />}
          label="论坛"
          active={onHome && forumTab}
          scroll={onHome ? false : undefined}
          onClick={onNavigate}
        />
        <NavItem
          href="/search"
          icon={<MdSearch size={22} />}
          label="搜索"
          active={backgroundPathname === '/search'}
          onClick={onNavigate}
        />
      </Section>

      {user && (
        <Section label="创作">
          <NavItem
            href="/upload"
            icon={<MdCloudUpload size={22} />}
            label="发布图片"
            active={backgroundPathname === '/upload'}
            onClick={onNavigate}
          />
          <NavItem
            href="/forum/create"
            icon={<MdEditNote size={22} />}
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
            icon={<MdCollectionsBookmark size={22} />}
            label="我的收藏"
            active={backgroundPathname === '/favorites'}
            onClick={onNavigate}
          />
          <NavItem
            href="/messages"
            icon={<MdNotifications size={22} />}
            label="消息"
            active={backgroundPathname === '/messages'}
            badge={unread}
            onClick={onNavigate}
          />
          <NavItem
            href="/history"
            icon={<MdHistory size={22} />}
            label="浏览历史"
            active={backgroundPathname === '/history'}
            onClick={onNavigate}
          />
          <NavItem
            href="/tasks"
            icon={<MdEmojiEvents size={22} />}
            label="任务"
            active={backgroundPathname === '/tasks'}
            onClick={onNavigate}
          />
          <NavItem
            href="/block-groups"
            icon={<MdShield size={22} />}
            label="屏蔽组"
            active={backgroundPathname === '/block-groups'}
            onClick={onNavigate}
          />
        </Section>
      )}

      {user && <div className="bg-outline-variant mx-4 my-2 h-px" />}

      <Section>
        {user && (
          <NavItem
            href="/settings"
            icon={<MdSettings size={22} />}
            label="设置"
            active={backgroundPathname === '/settings'}
            onClick={onNavigate}
          />
        )}
        {staff && (
          <NavItem
            href="/admin"
            icon={<MdDashboard size={22} />}
            label="管理面板"
            active={backgroundPathname.startsWith('/admin')}
            onClick={onNavigate}
          />
        )}
        {user && <NavItem icon={<MdLogout size={22} />} label="登出" onClick={onLogout} />}
      </Section>
    </nav>
  );
}
