'use client';

import { useCallback, type MouseEvent, type ReactNode } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { useIntentPrefetch } from '@/lib/useIntentPrefetch';
import { prefetchRoute } from '@/lib/prefetchRoute';
import { requestHomeTab, type HomeTab } from '@/lib/homeTabs';
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
  MdBookmarks,
  MdSettings,
  MdDashboard,
  MdLogout,
  MdRssFeed,
  MdStorefront,
} from 'react-icons/md';
import { useBackgroundSearchParams } from './BackgroundLocation';
import { useSubscriptionUpdates } from './subscriptions/actions';
import { CountBadge } from './Badge';
import Spinner from './Spinner';
import { cn } from '@/lib/utils';
import { isPlainActivation } from '@/lib/richTextLinks';
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
  /**
   * Set while an image-detail overlay covers the page: the row of that very page closes the
   * overlay (its own 返回) instead of pushing a second copy of the page beneath it. Returns
   * whether it handled the press; when it did not, the row navigates as usual.
   */
  onReselect?: () => boolean;
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
  'focus-visible:outline-hidden transition-ui state-layer',
  'focus-visible:ring-2 focus-ring',
);

/**
 * The row's trailing slot: the unread count, or — while this row's navigation is on its way
 * (a slow network, or offline, where `useOffline` holds it pending until the connection
 * returns) — a small progress ring, so the row that was pressed says it heard. Only a Link's
 * descendant can read its status, hence a component of its own.
 */
function RowTrailing({ badge, badgeLabel }: { badge?: number; badgeLabel?: string }) {
  const { pending } = useLinkStatus();
  if (pending) return <Spinner size="sm" tone="inherit" label="正在打开" />;
  return <CountBadge count={badge ?? 0} label={badge ? (badgeLabel ?? `${badge} 条未读`) : undefined} />;
}

function NavItem({
  href,
  icon,
  label,
  active,
  current = active,
  badge,
  badgeLabel,
  homeTab,
  onClick,
  onReselect,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
  active?: boolean;
  /** The row's own destination is the page on screen — not only lit for it, as 论坛 is in a thread. */
  current?: boolean;
  badge?: number;
  /** What the count means, read out with it. Defaults to unread messages (`N 条未读`). */
  badgeLabel?: string;
  /** A home tab: on `/` the row is the pill's own control, not a navigation. */
  homeTab?: HomeTab;
  onClick?: () => void;
  onReselect?: () => boolean;
}) {
  /* Only the rows that navigate. The drawer's two `<button>` rows (sign out,
     sign in) have no destination to warm, and `useIntentPrefetch` is given a
     null warmer rather than being called conditionally — a hook cannot be. */
  const intent = useIntentPrefetch(
    useCallback(() => {
      if (href) prefetchRoute(href);
    }, [href]),
  );

  const glyph = (
    /* A fixed, centred cell rather than a bare span around the glyph: an inline svg sits on
       the text baseline, which left each icon a fraction low and by a different amount per
       glyph. */
    <span className="grid h-6 w-6 shrink-0 place-items-center [&>svg]:block" aria-hidden="true">
      {icon}
    </span>
  );
  const text = <span className="min-w-0 flex-1 truncate text-left">{label}</span>;

  const className = cn(
    ROW,
    active
      ? /* `secondary-container`: M3's own navigation-drawer active fill, and
           the pair this app already uses everywhere it means "selected". */
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
        {glyph}
        {text}
        <CountBadge count={badge ?? 0} label={badge ? `${badge} 条未读` : undefined} />
      </button>
    );
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || !isPlainActivation(event)) return;
    /* Under an image detail, the row of the page the detail covers is a way back to it, as
       re-selecting the current destination is in a native navigation bar: the picture flies
       home to its card, and history keeps no second copy of the page — nor a hard cut to it.
       An open phone drawer is unwound by the hero's own traversal (`settleHistoryLayers`). */
    if (current && onReselect?.()) event.preventDefault();
    /* On the home route the two home rows switch the pane through the pill — the same
       transition and the same history model (`lib/homeTabs.ts`) — instead of pushing a
       navigation the pill itself would never make. */
    else if (homeTab && requestHomeTab(homeTab)) event.preventDefault();
    onClick?.();
  };

  return (
    <Link
      scroll={false}
      href={href}
      onClick={handleClick}
      /* Hover, focus and press each start the destination's *data*, not only its code. Next's own
         `<Link>` prefetch already warms the RSC payload and the chunk, and on this app that buys
         less than it looks like: every screen here is a client component that begins its reads in
         its first effect, so a warm chunk still arrives at an empty page. See `prefetchRoute`. */
      {...intent}
      data-ripple
      aria-current={active ? 'page' : undefined}
      className={className}
    >
      {glyph}
      {text}
      <RowTrailing badge={badge} badgeLabel={badgeLabel} />
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
 * The drawer's navigation. Destinations grouped by what you're trying to do; the browse
 * group and 设置 are always present — /settings holds device-local preferences (theme,
 * palette, motion, content filter, request lines) a visitor needs as much as a member — and
 * the account groups appear signed in.
 */
export default function SidebarNav({
  user,
  backgroundPathname,
  unread,
  onNavigate,
  onLogout,
  onReselect,
}: SidebarNavProps) {
  const searchParams = useBackgroundSearchParams();
  const onHome = backgroundPathname === '/';
  const forumTab = searchParams.get('tab') === 'forum';
  /* A thread belongs to 论坛: the destination stays lit while you read one. */
  const inThread = backgroundPathname.startsWith('/forum/') && backgroundPathname !== '/forum/create';
  const staff = isStaff(user?.role);
  /* 标签订阅's count: the new pictures across the account's subscriptions (the original's badge). */
  const subscriptionUpdates = useSubscriptionUpdates();

  return (
    <nav aria-label="主导航" className="flex flex-1 select-none flex-col gap-1 px-3 pb-3">
      <Section>
        {/* `scroll={false}` unconditionally: these two are the same control as the tab
            bar, and the tab machinery owns the scroller (it restores each tab's own offset).
            `lib/scrollMemory.ts` owns every other case and skips a search-only change. */}
        <NavItem
          href="/"
          icon={<MdHome size={ICON.standard} />}
          label="主页"
          active={onHome && !forumTab}
          homeTab="gallery"
          onClick={onNavigate}
          onReselect={onReselect}
        />
        <NavItem
          href="/?tab=forum"
          icon={<MdForum size={ICON.standard} />}
          label="论坛"
          active={(onHome && forumTab) || inThread}
          current={onHome && forumTab}
          homeTab="forum"
          onClick={onNavigate}
          onReselect={onReselect}
        />
        <NavItem
          href="/search"
          icon={<MdSearch size={ICON.standard} />}
          label="搜索"
          active={backgroundPathname === '/search'}
          onClick={onNavigate}
          onReselect={onReselect}
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
            onReselect={onReselect}
          />
          <NavItem
            href="/forum/create"
            icon={<MdEditNote size={ICON.standard} />}
            label="发布帖子"
            active={backgroundPathname === '/forum/create'}
            onClick={onNavigate}
            onReselect={onReselect}
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
            onReselect={onReselect}
          />
          <NavItem
            href="/subscriptions"
            icon={<MdRssFeed size={ICON.standard} />}
            label="标签订阅"
            active={backgroundPathname === '/subscriptions' || backgroundPathname.startsWith('/subscriptions/')}
            current={backgroundPathname === '/subscriptions'}
            badge={subscriptionUpdates}
            badgeLabel={`${subscriptionUpdates} 张新图片`}
            onClick={onNavigate}
            onReselect={onReselect}
          />
          <NavItem
            href="/messages"
            icon={<MdNotifications size={ICON.standard} />}
            label="消息"
            active={backgroundPathname === '/messages'}
            badge={unread}
            onClick={onNavigate}
            onReselect={onReselect}
          />
          <NavItem
            href="/history"
            icon={<MdHistory size={ICON.standard} />}
            label="浏览历史"
            active={backgroundPathname === '/history'}
            onClick={onNavigate}
            onReselect={onReselect}
          />
          <NavItem
            href="/tasks"
            icon={<MdEmojiEvents size={ICON.standard} />}
            label="任务"
            active={backgroundPathname === '/tasks'}
            onClick={onNavigate}
            onReselect={onReselect}
          />
          <NavItem
            href="/shop"
            icon={<MdStorefront size={ICON.standard} />}
            label="金币商店"
            active={backgroundPathname === '/shop'}
            onClick={onNavigate}
            onReselect={onReselect}
          />
          <NavItem
            href="/block-groups"
            icon={<MdShield size={ICON.standard} />}
            label="屏蔽组"
            active={backgroundPathname === '/block-groups'}
            onClick={onNavigate}
            onReselect={onReselect}
          />
          <NavItem
            href="/tag-groups"
            icon={<MdBookmarks size={ICON.standard} />}
            label="标签组"
            active={backgroundPathname === '/tag-groups'}
            onClick={onNavigate}
            onReselect={onReselect}
          />
        </Section>
      )}

      {/* The rule before the settings group, drawn in every state now that the group is: it
          separates where you can go from the app's own controls. `shrink-0` for the same
          reason as the structural rule in `AppLayout`: a 1px flex item in a column absorbs
          overflow and collapses to nothing. */}
      <div className="bg-outline-variant mx-4 my-2 h-px shrink-0" />

      <Section>
        <NavItem
          href="/settings"
          icon={<MdSettings size={ICON.standard} />}
          label="设置"
          active={backgroundPathname === '/settings'}
          onClick={onNavigate}
          onReselect={onReselect}
        />
        {staff && (
          <NavItem
            href="/admin"
            icon={<MdDashboard size={ICON.standard} />}
            label="管理面板"
            active={backgroundPathname.startsWith('/admin')}
            current={backgroundPathname === '/admin'}
            onClick={onNavigate}
            onReselect={onReselect}
          />
        )}
        {user && <NavItem icon={<MdLogout size={ICON.standard} />} label="登出" onClick={onLogout} />}
      </Section>
    </nav>
  );
}
