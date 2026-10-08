'use client';

import { useRouter } from 'next/navigation';
import type { MouseEvent } from 'react';
import { MdChevronRight, MdFolderShared, MdImage, MdLock } from 'react-icons/md';
import Card from '@/components/Card';
import FadeInImage from '@/components/FadeInImage';
import { shareHref, type ShareTarget } from '@/lib/api/messages';
import { ICON } from '@/lib/icons';
import { shareThumbSrc } from './messageText';

/**
 * A shared picture, favourites folder or privacy space, drawn as the card it was sent as —
 * the whole card is one link, the clear tap target the old raw `[image_share:…]` text never was.
 *
 * A real anchor (`Card as="a"`), so it can be middle-clicked, copied and long-pressed like a
 * link; a plain click navigates in the app. The picture opens the image detail (`/pic/<id>`)
 * on its own, with no list to step through. The folder's page is `/favorites/shared/<owner>/
 * <folderId>` and the privacy space's `/favorites/privacy/<ownerId>`, the favourites screens'.
 *
 * The thumbnail goes through the viewer's own image line (`FadeInImage resilient`), with the
 * give-up plate when every line fails; the URL in the message is the raw one — drawn only from
 * Derpibooru's and PicPony's own hosts (`shareThumbSrc`), since the sender wrote it.
 */
export default function ShareCard({ target }: { target: ShareTarget; own?: boolean }) {
  const router = useRouter();
  const href = shareHref(target);
  const navigate = (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    router.push(href, { scroll: false });
  };

  if (target.kind === 'image') {
    const thumb = shareThumbSrc(target.thumbUrl);
    return (
      <Card
        as="a"
        href={href}
        onClick={navigate}
        variant="filled"
        padding="none"
        interactive
        className="w-56 max-w-full overflow-hidden"
      >
        <span className="relative block h-36 w-full bg-surface-container-high">
          {thumb ? (
            <FadeInImage
              src={thumb}
              alt={`图片 #${target.imageId}`}
              fill
              sizes="224px"
              resilient
              proxyThumb
              className="object-cover"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-on-surface-variant" aria-hidden="true">
              <MdImage size={ICON.large} />
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 px-3 py-2.5">
          <MdImage size={ICON.dense} aria-hidden="true" className="shrink-0 text-on-surface-variant" />
          <span className="min-w-0 flex-1 truncate text-label-l text-on-surface">分享了一张图片</span>
          <span className="shrink-0 text-label-m text-on-surface-variant tabular-nums">#{target.imageId}</span>
        </span>
      </Card>
    );
  }

  const folder = target.kind === 'fave-folder';
  return (
    <Card
      as="a"
      href={href}
      onClick={navigate}
      variant="filled"
      padding="sm"
      interactive
      className="w-64 max-w-full"
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-secondary-container text-on-secondary-container"
        >
          {folder ? <MdFolderShared size={ICON.standard} /> : <MdLock size={ICON.standard} />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-title-s text-on-surface">
            {folder ? target.folderName : `${target.ownerName} 的隐私空间`}
          </span>
          <span className="truncate text-body-s text-on-surface-variant">
            {folder ? `${target.ownerUsername} 分享的收藏夹` : '输入密码后查看'}
          </span>
        </span>
        <MdChevronRight size={ICON.standard} aria-hidden="true" className="shrink-0 text-on-surface-variant" />
      </span>
    </Card>
  );
}
