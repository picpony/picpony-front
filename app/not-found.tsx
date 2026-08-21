import Link from 'next/link';
import { MdHome } from 'react-icons/md';
import EmptyState from '@/components/EmptyState';
import { buttonClasses } from '@/components/buttonStyles';
import { ICON } from '@/lib/icons';

/**
 * 404. Previously Next's default, which is an unstyled English page — jarring
 * on a Chinese site and with no route back into the app.
 *
 * `EmptyState`, one of the two presets, rather than `StatusView` directly. It
 * rendered the base component because the glyph slot is the numeral rather than a
 * preset's own icon — but the presets take an `icon` override, so nothing needed
 * the base, and AGENTS.md names the 404 among the screens that must go through
 * them. This was the last of three direct `StatusView` uses.
 *
 * The glyph *is* the numeral, which is the one thing that makes a 404
 * recognisable at a glance. It takes `StatusView`'s own glyph ink (`outline`) rather
 * than overriding it: it read `outline-variant`, a divider tone at 1.6:1, so the 404
 * and the route error — the app's two error screens, which a user sees as one
 * event — put their glyph at two different weights.
 *
 * `fill` because this block *is* the route. Without it `page`'s half-viewport floor
 * left the sentence in the upper third of an otherwise blank screen.
 *
 * One action, not two. The header on this route already carries both a home
 * link (the wordmark) and search, so a second 去搜索 button in the middle of the
 * page was chrome repeated as content — the same reason the forum thread's
 * error state does not draw its own 返回.
 *
 * The action is a `<Link>` wearing `Button`'s shape rather than a `Button`: a
 * button inside an anchor is invalid, and this is a server component so there
 * is no router to push from an `onClick`.
 */
export default function NotFound() {
  return (
    <EmptyState
      fill
      icon={
        <span aria-hidden="true" className="text-display-l leading-none">
          404
        </span>
      }
      title="这里什么都没有"
      description="页面可能已被删除，或者链接本来就不对。"
      action={
        <Link href="/" className={buttonClasses({ variant: 'filled' })}>
          <MdHome size={ICON.dense} aria-hidden="true" />
          回到首页
        </Link>
      }
    />
  );
}
