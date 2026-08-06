import Link from 'next/link';
import { MdHome, MdSearch } from 'react-icons/md';
import { buttonClasses } from '@/components/buttonStyles';

/**
 * 404. Previously Next's default, which is an unstyled English page — jarring
 * on a Chinese site and with no route back into the app.
 *
 * The two actions are `<Link>`s wearing `Button`'s shape rather than `Button`s:
 * a button inside an anchor is invalid, and this page is a server component so
 * there is no router to push from an `onClick`.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <p aria-hidden="true" className="text-primary/25 text-display-l leading-none select-none">
        404
      </p>
      <h1 className="text-headline-s text-on-surface mt-2 mb-2">这里什么都没有</h1>
      <p className="text-body-m text-on-surface-variant mb-8">
        页面可能已被删除，或者链接本来就不对。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className={buttonClasses({ variant: 'filled' })}>
          <MdHome size={18} aria-hidden="true" />
          回到首页
        </Link>
        <Link href="/search" className={buttonClasses({ variant: 'text' })}>
          <MdSearch size={18} aria-hidden="true" />
          去搜索
        </Link>
      </div>
    </div>
  );
}
