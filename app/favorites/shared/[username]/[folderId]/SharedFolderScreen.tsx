'use client';

import { useRouter } from 'next/navigation';
import { MdFolderOff, MdPersonOff, MdPhotoLibrary } from 'react-icons/md';
import { SKIP, useResource } from '@/lib/resource';
import { profileFaveFolders, sharedFaveIds } from '@/lib/resources';
import { apiErrorMessage, isApiError, isNotFound, isRetryable } from '@/lib/api/errors';
import { FAVE_PAGE_SIZE, faveFolderHref, favoritesHref, folderLabel, sharedFolderHref, type FaveOwner } from '@/lib/favorites';
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
 * original front end's `#mode=shared_faves` links open. Anonymous when the owner is named by id:
 * the ids come from `get_shared_faves`, and the pictures a page of fifty at a time
 * (`favePictures`), through the viewer's own content settings (C11). A link naming the owner by
 * username is resolved first (`GET /users/by-username/{username}`, public).
 *
 * An owner who does not exist (404 `USER_NOT_FOUND`), a folder that is not there or not public
 * (404 `FOLDER_NOT_FOUND`, or absent from the owner's public list — an owner who hides favourites
 * answers an empty one) and a read that failed are different answers, and each says which. The
 * folder's name comes from that public list (the folder read names none).
 *
 * Opened from a profile's card, the page grows out of it and Back shrinks it into it again
 * (`lib/folderTransit.ts`). The card was drawn from that same public list, which is in the cache
 * then: the header is drawn from it — the card's own name and count — in the frame the page
 * mounts, rather than from a placeholder that changed shape under the landing when the folder's
 * read came in. The count is then the read's own (the list counts a repeated id twice).
 */
export default function SharedFolderScreen({ owner, folderId }: { owner: FaveOwner; folderId: number }) {
  const router = useRouter();
  const back = useBackOrParent('/');
  useEscapeBack(back);
  const { user } = useSession();
  const read = useResource(sharedFaveIds, { ...owner, folderId });
  const publicList = useResource(profileFaveFolders, folderId > 0 ? owner : SKIP);
  const username = read.data?.username ?? ('username' in owner ? owner.username : null);
  const ownerKey = 'ownerId' in owner ? `~${owner.ownerId}` : owner.username;
  const own = read.data
    ? Number(user?.id) === read.data.ownerId
    : typeof user?.username === 'string' && user.username === username;
  const route = sharedFolderHref(owner, folderId);
  const [page, setPage] = useAddressPage(route, false);
  const listed = folderId === 0 || !publicList.data || publicList.data.some((folder) => folder.id === folderId);
  const ids = listed ? read.data?.ids : undefined;
  const state = useFavePage({ ids, page, setPage, listKey: `fave-shared:${ownerKey}:${folderId}` });
  if (ids && page > state.totalPages) setPage(state.totalPages);

  /* The folder as the public list has it — the card's own name, so the header and the card that
     opened it agree, and what the header is drawn from while the folder's read is on its way. */
  const entry = folderId > 0 ? publicList.data?.find((folder) => folder.id === folderId) : undefined;
  const seeded = read.data === undefined && !read.error && entry !== undefined;
  const name = entry ? folderLabel(entry) : folderId === 0 ? '公开收藏' : null;
  const pageRef = useFolderPage(route);
  useDocumentTitle(read.data && listed ? `${name ?? '收藏夹'} - ${username ?? '用户'} 的收藏 - PicPony` : null);
  const folderMissing = isApiError(read.error) && read.error.code === 'FOLDER_NOT_FOUND';

  const pageBack = <PageBack onClick={back} />;
  const column = 'mx-auto flex w-full max-w-7xl flex-1 flex-col page-back-room-7xl';

  if (read.data === undefined && !seeded && !folderMissing) {
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
            <EmptyState fill icon={<MdPersonOff size={ICON.display} />} title="用户不存在" description={username ? `没有名为「${username}」的用户` : '该用户不存在或已注销'} />
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

  if (!listed || folderMissing) {
    return (
      <>
        {pageBack}
        <div className={column}>
          <EmptyState
            fill
            icon={<MdFolderOff size={ICON.display} />}
            title="收藏夹不存在或未公开"
            description={username ? `${username} 没有公开该收藏夹` : '该收藏夹不存在或未公开'}
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
              {username ?? '用户'} 的收藏夹 · 共 {formatCount(read.data?.ids.length ?? entry?.itemCount ?? 0)} 张
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
            listKey={`fave-shared:${ownerKey}:${folderId}`}
            failureTitle="收藏加载失败"
            empty={<EmptyState size="pane" icon={<MdPhotoLibrary size={ICON.display} />} title="此收藏夹还没有图片" />}
          />
        </div>
      </div>
    </>
  );
}
