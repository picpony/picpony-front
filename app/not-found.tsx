import Link from 'next/link';
import { MdHome } from 'react-icons/md';
import StatusView from '@/components/StatusView';
import { buttonClasses } from '@/components/buttonStyles';

/**
 * 404. Previously Next's default, which is an unstyled English page — jarring
 * on a Chinese site and with no route back into the app.
 *
 * It renders `StatusView` so this reads as the same kind of screen as every
 * other "there is nothing here" in the app — same geometry, same type scale,
 * same staggered entrance. Only the glyph differs, and here the glyph is the
 * numeral itself, which is the one thing that makes a 404 recognisable at a
 * glance.
 *
 * `outline-variant` for the numeral rather than a `primary/25` wash: the alpha
 * resolved to two very different weights between schemes — a barely-there pink
 * on the light surface and a heavy plum on the dark one — whereas the divider
 * tone is built to sit at the same low emphasis in both. It is decorative and
 * `aria-hidden`; the sentence below it carries the meaning.
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
    <StatusView
      icon={
        <span aria-hidden="true" className="text-outline-variant text-display-l leading-none">
          404
        </span>
      }
      title="这里什么都没有"
      description="页面可能已被删除，或者链接本来就不对。"
      action={
        <Link href="/" className={buttonClasses({ variant: 'filled' })}>
          <MdHome size={18} aria-hidden="true" />
          回到首页
        </Link>
      }
    />
  );
}
