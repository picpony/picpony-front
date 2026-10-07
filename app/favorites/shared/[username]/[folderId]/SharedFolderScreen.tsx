'use client';

import { useRouter } from 'next/navigation';
import { MdFolderOff, MdPersonOff, MdPhotoLibrary } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { profileFaveFolders, sharedFaveIds } from '@/lib/resources';
import { apiErrorMessage, isApiError, isNotFound, isRetryable } from '@/lib/api/errors';
import { FAVE_PAGE_SIZE, faveFolderHref, favoritesHref, folderLabel, MAIN_FOLDER_NAME, sharedFolderHref } from '@/lib/favorites';
import { useBackOrParent } from '@/lib/backNavigation';
import { useFolderPage } from '@/lib/folderTransit';
import { useEscapeBack, useSession } from '@/lib/hooks';
import { useDocumentTitle } from '@/lib/useDocumentTitle';
import { formatCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import ImageGridSkeleton from '@/components/ImageGridSkeleton';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import Skeleton from '@/components/Skeleton';
import { FaveGridView, useFavePage } from '@/components/favorites/FaveGrid';
import { useAddressPage } from '@/components/favorites/useAddressPage';

function SharedSkeleton() {
  return (
    <div className="mx-auto max-w-7xl page-back-room-7xl" data-page-loading="">
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-40" />
      </div>
      <ImageGridSkeleton count={FAVE_PAGE_SIZE} />
    </div>
  );
}

/**
 * Somebody's public favourite folder — what a profile's 收藏夹 tab, a folder share card and the
 * original front end's `#mode=shared_faves` links open. Anonymous: the ids come from
 * `get_shared_faves`, and the pictures a page of fifty at a time (`favePictures`), through the
 * viewer's own content settings (C11).
 *
 * A folder its owner keeps private, an owner who does not exist, a folder that is not (or no
 * longer) there and a read that failed are four different answers, and each says which. The last
 * is cross-checked against the owner's public list, because `get_shared_faves` answers a folder id
 * that does not exist with an empty main folder.
 *
 * Opened from a profile's card, the page grows out of it and Back shrinks it into it again
 * (`lib/folderTransit.ts`). The card was drawn from that same public list, which is in the cache
 * then: the header is drawn from it — the card's own name and count — in the frame the page
 * mounts, rather than from a placeholder that changed shape under the landing when the folder's
 * read came in. The count is then the read's own (the list counts a repeated id twice).
 */
export default function SharedFolderScreen({ username, folderId }: { username: string; folderId: number }) {
  const router = useRouter();
  const back = useBackOrParent('/');
  useEscapeBack(back);
  const { user } = useSession();
  const own = typeof user?.username === 'string' && user.username === username;
  const read = useResource(sharedFaveIds, { username, folderId });
  const publicList = useResource(profileFaveFolders, folderId > 0 ? { username } : SKIP);
  const route = sharedFolderHref(username, folderId);
  const [page, setPage] = useAddressPage(route, false);
  const verified = folderId === 0 || publicList.data?.some((folder) => folder.id === folderId);
  const ids = verified ? read.data?.ids : undefined;
  const state = useFavePage({ ids, page, setPage, listKey: `fave-shared:${username}:${folderId}` });
  if (ids && page > state.totalPages) setPage(state.totalPages);

  const listed = folderId === 0 || !publicList.data || publicList.data.some((folder) => folder.id === folderId);
  /* The folder as the public list has it — the card's own name, so the header and the card that
     opened it agree, and what the header is drawn from while the folder's read is on its way. */
  const entry = folderId > 0 ? publicList.data?.find((folder) => folder.id === folderId) : undefined;
  const seeded = read.data === undefined && !read.error && entry !== undefined;
  const name = entry ? folderLabel(entry) : read.data?.folderName || (folderId === 0 ? MAIN_FOLDER_NAME : null);
  const pageRef = useFolderPage(route);
  useDocumentTitle(read.data && listed ? `${name ?? '收藏夹'} - ${username} 的收藏 - PicPony` : null);

  const pageBack = <PageBack onClick={back} />;
  const column = 'mx-auto flex w-full max-w-7xl flex-1 flex-col page-back-room-7xl';

  if (read.data === undefined && !seeded) {
    if (!read.error) {
      return (
        <>
          {pageBack}
          <SharedSkeleton />
        </>
      );
    }
    const error = read.error;
    return (
      <>
        {pageBack}
        <div className={column}>
          {isNotFound(error) ? (
            <EmptyState fill icon={<MdPersonOff size={ICON.display} />} title="用户不存在" description={`没有名为「${username}」的用户`} />
          ) : isApiError(error) && error.kind === 'envelope' && !isRetryable(error) ? (
            /* The owner's choice, in the backend's own words. */
            <EmptyState fill icon={<MdFolderOff size={ICON.display} />} title="无法查看该收藏夹" description={apiErrorMessage(error)} />
          ) : (
            <ErrorRetry
              fill
              title="收藏夹加载失败"
              message={apiErrorMessage(error)}
              onRetry={isRetryable(error) ? read.refresh : undefined}
            />
          )}
        </div>
      </>
    );
  }

  if (folderId > 0 && publicList.data === undefined) {
    return <>{pageBack}{publicList.error ? (
      <div className={column}><ErrorRetry fill title="收藏夹加载失败" message={apiErrorMessage(publicList.error)}
        onRetry={isRetryable(publicList.error) ? publicList.refresh : undefined} /></div>
    ) : <SharedSkeleton />}</>;
  }

  if (!listed) {
    return (
      <>
        {pageBack}
        <div className={column}>
          <EmptyState
            fill
            icon={<MdFolderOff size={ICON.display} />}
            title="收藏夹不存在或未公开"
            description={`${username} 没有公开该收藏夹`}
            action={
              own ? (
                <Button variant="tonal" onClick={() => router.push(favoritesHref(), { scroll: false })}>
                  管理我的收藏
                </Button>
              ) : undefined
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      {pageBack}
      <div ref={pageRef} data-folder-page={route} className={column}>
        <PageHeader
          title={name ?? '收藏夹'}
          subtitle={
            <span className="tabular-nums">
              {read.data?.username ?? username} 的收藏夹 · 共 {formatCount(read.data?.ids.length ?? entry?.itemCount ?? 0)} 张
            </span>
          }
          actions={
            own ? (
              <Button
                variant="tonal"
                onClick={() => router.push(folderId > 0 ? faveFolderHref(folderId) : favoritesHref(), { scroll: false })}
              >
                管理此收藏夹
              </Button>
            ) : undefined
          }
        />
        <div data-pagination-anchor="">
          <FaveGridView
            state={state}
            page={page}
            setPage={setPage}
            listKey={`fave-shared:${username}:${folderId}`}
            failureTitle="收藏加载失败"
            empty={<EmptyState size="pane" icon={<MdPhotoLibrary size={ICON.display} />} title="此收藏夹还没有图片" />}
          />
        </div>
      </div>
    </>
  );
}
