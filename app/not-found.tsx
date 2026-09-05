import Link from 'next/link';
import { MdHome } from 'react-icons/md';
import EmptyState from '@/components/EmptyState';
import { buttonClasses } from '@/components/buttonStyles';
import { ICON } from '@/lib/icons';

/**
 * 404, through the shared `EmptyState` preset rather than `StatusView` directly (the
 * glyph slot carries the numeral, which is what makes a 404 recognisable at a glance).
 * It takes `StatusView`'s own glyph ink — the 404 and the route error are the app's two
 * error screens, which a user sees as one event, and must weigh the same.
 *
 * `fill` because this block *is* the route: without it the half-viewport floor left the
 * sentence in the upper third of an otherwise blank screen.
 *
 * One action, not two — the header on this route already carries a home link and search.
 * The action is a `<Link>` wearing `Button`'s shape: a button inside an anchor is
 * invalid, and this is a server component so there is no router to push from.
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
        <Link scroll={false} href="/" className={buttonClasses({ variant: 'filled' })}>
          <MdHome size={ICON.dense} aria-hidden="true" />
          回到首页
        </Link>
      }
    />
  );
}
