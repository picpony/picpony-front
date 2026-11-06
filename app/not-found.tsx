import { MdHome } from 'react-icons/md';
import EmptyState from '@/components/EmptyState';
import ButtonLink from '@/components/ButtonLink';

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
 * ButtonLink retains anchor semantics and the shared control presentation during SSR.
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
        <ButtonLink
          href="/"
          variant="filled"
          icon={<MdHome />}
        >
          回到首页
        </ButtonLink>
      }
    />
  );
}
