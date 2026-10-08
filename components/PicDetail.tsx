'use client';

import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useOffline } from 'next/offline';
import {
  MdChevronLeft,
  MdChevronRight,
  MdDownload,
  MdFlag,
  MdIosShare,
  MdLibraryAdd,
  MdLink,
  MdOpenInNew,
  MdSend,
  MdShare,
  MdStar,
  MdStarBorder,
  MdTranslate,
} from 'react-icons/md';
import type { PicLightboxSlide } from '@/components/PicLightbox';
import { useAuthModal } from '@/components/AuthModal';
import Button from '@/components/Button';
import { buttonClasses } from '@/components/buttonStyles';
import CommentSection, { type ReplyTarget } from '@/components/CommentSection';
import DetailBack from '@/components/DetailBack';
import DetailHeader from '@/components/DetailHeader';
import DetailImage from '@/components/DetailImage';
import DetailVideo from '@/components/DetailVideo';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import IconButton from '@/components/IconButton';
import Menu, { type MenuAction } from '@/components/Menu';
import PageBack from '@/components/PageBack';
import { useShareToContact } from '@/components/ShareToContactDialog';
import Skeleton from '@/components/Skeleton';
import TagInfoModal from '@/components/TagInfoModal';
import TagList, {
  BATCH_SIZES,
  groupTags,
  visibleTagsOf,
  type TagSection,
  type VisibleTagLimits,
} from '@/components/TagList';
import { showToast } from '@/components/Toast';
import DetailDescription from '@/components/detail/DetailDescription';
import DetailSources from '@/components/detail/DetailSources';
import DetailVotes from '@/components/detail/DetailVotes';
import ImageTranslationStatus from '@/components/detail/ImageTranslationStatus';
import ReportDialog from '@/components/detail/ReportDialog';
import { apiErrorMessage, isNotFound, isRetryable } from '@/lib/api/errors';
import { readJson } from '@/lib/api/http';
import { shareThumbUrl } from '@/lib/api/messages';
import { addBrowsingHistory, reportImage } from '@/lib/api/picpony';
import { addPrivacyFave } from '@/lib/api/favorites';
import { getBrowsingSettings } from '@/lib/api/client';
import { favoritesHref, goesToPrivacySpace, resolveDefaultFolder, type DefaultFolder } from '@/lib/favorites';
import { favouriteImage, favouritesChanged, restoreFavourite, unfavouriteImage } from '@/lib/favoritesActions';
import { addPrivacyPictures } from '@/lib/favoritesPrivacy';
import { useSyncedSetting } from '@/lib/settingsSync';
import FolderPicker from '@/components/favorites/FolderPicker';
import { createShareLink, trackShare } from '@/lib/api/share';
import { useBackOrParent } from '@/lib/backNavigation';
import { LS_KEYS } from '@/lib/constants';
import { plainTextOf } from '@/lib/derpiMarkup';
import {
  peekImageDetail,
  peekImageDetailError,
  prefetchImageDetail,
  seedImageDetail,
  subscribeImageDetail,
} from '@/lib/detail';
import { downloadOriginal } from '@/lib/download';
import { describeImage } from '@/lib/imageDescription';
import { getRawImageUrl } from '@/lib/imageLoader';
import { getHeroMediaStyle } from '@/lib/hero/mediaBox';
import { useDetailStep } from '@/lib/hero/useDetailStep';
import { findDetailOriginLink, playDetailEntrance } from '@/lib/detailTransit';
import {
  bindImageHeroDismissGesture,
  findImageHeroCardLink,
  getImageHeroOrigin,
  getImageHeroRuntime,
  interruptImageHero,
  isImageHeroDetailDataPublishable,
  isImageHeroPublicationQuiet,
  leaveImageHeroOrphanLadder,
  markImageHeroRoutePreviewPaintable,
  markImageHeroRouteResolvedWithoutMedia,
  publishWhenHeroSettled,
  registerImageDetailClose,
  registerImageHeroRoute,
  requestImageHeroClose,
  subscribeImageHeroRuntime,
  updateImageHeroRouteTarget,
} from '@/lib/hero';
import { readToken, useEscapeBack, useSession, useStoredBoolean } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { useOverlayLayer } from '@/lib/overlay';
import { SKIP, useResource } from '@/lib/resource';
import { faveFolders, faveIds as faveIdsResource, translateSwitch } from '@/lib/resources';
import { scrollAppToElement } from '@/lib/scrollTo';
import { loadTagCounts } from '@/lib/tagCounts';
import { loadTagTranslations, peekTagTranslations, rememberTagTranslations } from '@/lib/tagTranslations';
import { useImageTranslation } from '@/lib/translation';
import type { DetailSeed, ImagePreview, PonyImage } from '@/lib/types/image';
import { cn, copyText } from '@/lib/utils';

/* The whole lightbox — core, plugins and stylesheet — behind one boundary (see `PicLightbox`).
   `loading` keeps the first open from suspending to the route's boundary, which would replace
   the whole detail with the route skeleton while the chunk arrives. */
const PicLightbox = dynamic(() => import('@/components/PicLightbox'), { ssr: false, loading: () => null });

/** Fetched on intent — a pointer arriving on the picture, a press, focus reaching its zoom control. */
function warmLightbox() {
  void import('@/components/PicLightbox');
}

type PicDetailProps = {
  presentation?: 'page' | 'overlay';
  /**
   * A direct load's record, read on the server (`lib/detail.server.ts`) and already on the
   * document's image line — `null` when that read did not land in time. Page presentation only.
   */
  seed?: DetailSeed | null;
};

function getServerDetail() {
  return null;
}

function readHeroSessionId() {
  return getImageHeroRuntime().sessionId;
}

/**
 * The picture's box, which the media fills. The box — not the media element — takes the hero's
 * geometry, so the step arrows can sit over the picture as its siblings; the media element is
 * still the landing target and measures exactly the box.
 */
const MEDIA_FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

const INITIAL_TAG_LIMIT = 80;
const INITIAL_RELATION_TAG_LIMIT = 32;

/** How long 显示更多 waits for the next batch's names before revealing it anyway. */
const SHOW_MORE_WAIT_MS = 1200;

const initialTagLimits = (imageId: number): VisibleTagLimits => ({
  imageId,
  artists: INITIAL_RELATION_TAG_LIMIT,
  ocs: INITIAL_RELATION_TAG_LIMIT,
  regular: INITIAL_TAG_LIMIT,
});

interface TagData {
  imageId: number;
  translations: Record<string, string | null>;
  counts: Record<string, number | null>;
}

const isRegularTag = (tag: string) => !tag.startsWith('artist:') && !tag.startsWith('oc:');

/**
 * The next batch's glossary names and counts, fetched before the batch is revealed — so its chips
 * appear with the names they keep instead of English words that change width a moment later.
 * Bounded: past `SHOW_MORE_WAIT_MS` the batch shows with what has arrived.
 */
function prepareTagBatch(
  tags: string[],
  { translations, counts }: { translations: boolean; counts: boolean },
): Promise<Omit<TagData, 'imageId'>> {
  const out: Omit<TagData, 'imageId'> = { translations: {}, counts: {} };
  const work: Promise<unknown>[] = [];
  if (translations && tags.length > 0) {
    work.push(loadTagTranslations(tags, (part) => Object.assign(out.translations, part)));
  }
  const regular = tags.filter(isRegularTag);
  if (counts && regular.length > 0) work.push(loadTagCounts(regular, (part) => Object.assign(out.counts, part)));
  const cap = new Promise<void>((resolve) => setTimeout(resolve, SHOW_MORE_WAIT_MS));
  return Promise.race([Promise.all(work).then(() => undefined, () => undefined), cap]).then(() => out);
}

// ---------------------------------------------------------------------------
// Sharing — the original front end's contract, through B3's `lib/api/share.ts`
// ---------------------------------------------------------------------------

/** Short links made this page life, per picture: a second copy does not store a second row. */
const shareLinks = new Map<number, string>();

const shareTitle = (id: number) => `分享一张精美的小马图（ID：${id}）`;

/** The link preview's line: the description's first words, else an invitation. */
function shareDescription(description: string | null | undefined): string {
  const text = plainTextOf(description).replace(/\s+/g, ' ').trim();
  if (!text) return '点击链接自动打开详情，快来看看吧~';
  const chars = Array.from(text);
  return chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : text;
}

/** The short link for the picture (the long one when the backend cannot make one). */
async function imageShareLink(image: ImagePreview, token: string | null): Promise<string> {
  const cached = shareLinks.get(image.id);
  if (cached) return cached;
  const link = await createShareLink(
    {
      targetUrl: new URL(`/pic/${image.id}`, window.location.origin).href,
      title: shareTitle(image.id),
      desc: shareDescription(image.description),
      imageUrl: shareThumbUrl(image.representations) || undefined,
      imageId: image.id,
    },
    { token },
  );
  if (link.short) shareLinks.set(image.id, link.url);
  return link.url;
}

async function copyLink(url: string, token: string | null): Promise<boolean> {
  if (!(await copyText(url))) return false;
  showToast('已复制分享链接', 'success');
  trackShare(token);
  return true;
}

/**
 * 复制链接. The link is made over the network first, and some browsers only allow a clipboard
 * write inside the gesture that asked for it — by the time the link exists that gesture can be
 * spent, so a copy that fails is offered again as a tap (B3's search share does the same).
 */
async function copyImageLink(image: ImagePreview, token: string | null): Promise<void> {
  const url = await imageShareLink(image, token);
  if (await copyLink(url, token)) return;
  showToast('分享链接已生成', 'info', {
    action: {
      label: '复制',
      onClick: () => {
        void copyLink(url, token).then((copied) => {
          if (!copied) showToast('复制失败，请检查浏览器的剪贴板权限', 'error');
        });
      },
    },
  });
}

/** 分享到其他应用: the system share sheet, with the same link and words. */
async function shareImageNatively(image: ImagePreview, token: string | null): Promise<void> {
  const url = await imageShareLink(image, token);
  const data: ShareData = { title: shareTitle(image.id), text: shareDescription(image.description), url };
  const open = () =>
    navigator.share(data).then(
      () => trackShare(token),
      (error: unknown) => {
        const name = error instanceof DOMException ? error.name : '';
        /* The reader closed the sheet: nothing to say. */
        if (name === 'AbortError') return;
        /* The gesture was spent waiting for the link: offer the sheet again, from a fresh tap. */
        if (name === 'NotAllowedError') {
          showToast('分享链接已生成', 'info', { action: { label: '分享', onClick: () => void open() } });
          return;
        }
        void copyImageLink(image, token);
      },
    );
  await open();
}

// ---------------------------------------------------------------------------
// The picture's actions, at module scope (the React Compiler lowers no `finally` in a component)
// ---------------------------------------------------------------------------

type Outcome = { ok: true } | { ok: false; message: string };
type FavePress =
  | { ok: true; kind: 'faved'; folderName: string }
  | { ok: true; kind: 'unfaved'; previous: number[] }
  | { ok: true; kind: 'privacy' }
  | { ok: true; kind: 'picker' }
  | { ok: false; message: string };

/**
 * One press on 收藏, in the original front end's order (`handleFaveClick`): a picture not yet
 * favourited that the auto-privacy rule claims goes to the privacy space instead; then, with
 * 一键收藏 off, the press opens the folder picker; otherwise it toggles — into the default
 * folder, or out of favourites altogether (`fave: false`, which cannot add; 撤销 puts it back).
 *
 * It starts from the shared complete index (`faveIds`), even when the press beats the screen's
 * first read: a cold key must not be written as a one-item list. Every cache that knows the
 * picture's state is corrected or re-read by `lib/favoritesActions.ts`.
 */
async function sendFavePress(
  token: string,
  image: PonyImage,
  choice: { oneTap: boolean; defaultFolder: DefaultFolder; autoPrivacy: boolean },
): Promise<FavePress> {
  try {
    const index = await faveIdsResource.read({ token });
    if (readToken() !== token) return { ok: false, message: '登录状态已改变，请重新操作' };
    const faved = index.ids.includes(image.id);
    const contentFilter = getBrowsingSettings().contentFilter;
    if (goesToPrivacySpace({ alreadyFaved: faved, autoPrivacy: choice.autoPrivacy, contentFilter, tags: image.tags })) {
      await addPrivacyFave(token, image);
      if (readToken() === token) { addPrivacyPictures(token, [image]); favouritesChanged(token); }
      return { ok: true, kind: 'privacy' };
    }
    if (!choice.oneTap) return { ok: true, kind: 'picker' };
    if (faved) {
      const { previous } = await unfavouriteImage(token, image.id);
      return { ok: true, kind: 'unfaved', previous };
    }
    /* A chosen folder that has since gone falls back to the main folder, as the list says. */
    let target = choice.defaultFolder;
    if (target.id > 0) {
      const list = faveFolders.peek({ token }).data ?? (await faveFolders.read({ token }).catch(() => null));
      if (list) target = resolveDefaultFolder(list.folders, target);
    }
    await favouriteImage(token, image.id, target.id);
    return { ok: true, kind: 'faved', folderName: target.name };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '收藏失败') };
  }
}

async function sendReport(token: string, imageId: number, reason: string): Promise<Outcome> {
  try {
    const data = await readJson<{ success?: unknown; message?: string; error?: string }>(
      await reportImage(token, imageId, reason),
    );
    if (data.success === true) return { ok: true };
    return { ok: false, message: data.error || data.message || '举报提交失败' };
  } catch (error) {
    return { ok: false, message: apiErrorMessage(error, '举报提交失败') };
  }
}

/** The picture's own record over the list's row, and a row that is a video over one that is not. */
function mediaFacts(image: ImagePreview) {
  const reps = image.representations ?? {};
  const preferMedium = (image.size || 0) > 16 * 1024 * 1024 || (image.width || 0) * (image.height || 0) > 40_000_000;
  const imageSrc =
    (preferMedium ? reps.medium : undefined) || reps.large || reps.medium || reps.full || image.view_url || '';
  const format = (image.format || imageSrc.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  const isVideo = format === 'webm' || format === 'mp4';
  const videoSrc = reps.medium || reps.large || reps.full || image.view_url || '';
  const fullSrc = reps.full || image.view_url || '';
  return { reps, imageSrc, format, isVideo, videoSrc, fullSrc };
}

// ---------------------------------------------------------------------------
// The loading placeholder, shared with the route's streaming fallback
// ---------------------------------------------------------------------------

/**
 * The detail's shape while its record is on the way: the two metadata rows, a media well, and
 * the body under it. Also the direct load's streaming fallback (`DetailPageFallback`), so the
 * first byte and the client's own placeholder are one shape.
 */
function DetailSkeleton({ gutter = '', page = false }: { gutter?: string; page?: boolean }) {
  return (
    <div
      data-page-loading={page ? '' : undefined}
      className={cn('image-detail-page mx-auto max-w-5xl', page && 'page-back-room-5xl', gutter)}
    >
      <div className="flex flex-col rounded-md bg-transparent">
        {/* `DetailHeader`'s real shape: two centred one-line rows. Each row opens with an empty
            run of the rows' own type — a strut — so it is exactly one `body-m` line tall, as the
            real rows are; a fixed height would be a guess at the line box. */}
        <div className="image-detail-header-route px-4 py-3 sm:px-6">
          <div className="flex flex-col items-center gap-y-1 text-body-m">
            <div className="flex items-center justify-center gap-x-3 sm:gap-x-4">
              <span aria-hidden="true">{'​'}</span>
              <Skeleton className="h-4 w-28" delay={60} />
              <Skeleton className="h-4 w-14" delay={120} />
              <Skeleton className="h-4 w-10" delay={180} />
            </div>
            <div className="flex items-center justify-center gap-x-3 sm:gap-x-4">
              <span aria-hidden="true">{'​'}</span>
              <Skeleton className="h-4 w-20" delay={90} />
              <Skeleton className="h-4 w-8" delay={150} />
              <Skeleton className="h-4 w-20" delay={210} />
            </div>
          </div>
        </div>
        <div className="relative flex min-h-[32dvh] w-full items-start justify-center px-4 pt-2 pb-4 sm:px-6 md:min-h-[48dvh]">
          {/* Inset only: a width or height beside it would replace the computed insets. */}
          <Skeleton className="absolute inset-4 rounded-lg" delay={90} />
        </div>
        <div className="image-detail-stage-body flex flex-col bg-transparent p-4 sm:p-6">
          <div className="mx-auto w-full max-w-5xl space-y-6">
            <div>
              <div className="mb-1.5 flex justify-between">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-14" delay={60} />
              </div>
              <Skeleton className="h-1 w-full rounded-full" delay={120} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-10 w-28 rounded-full" delay={150} />
              <Skeleton className="h-10 w-40 rounded-full" delay={180} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A direct load's first byte while the server reads the picture (up to its 2.5s bound): the
 * detail's own placeholder and its back affordance — drawn in every state, loading included.
 */
export function DetailPageFallback() {
  const back = useBackOrParent('/');
  useEscapeBack(back);
  return (
    <div className="relative">
      <PageBack onClick={back} label="返回图片列表" />
      <DetailSkeleton page />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The detail
// ---------------------------------------------------------------------------

export default function PicDetail({ presentation = 'page', seed = null }: PicDetailProps) {
  const params = useParams();
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const session = useSession();
  const overlayRef = useRef<HTMLElement>(null);
  const overlayScrollerRef = useRef<HTMLDivElement>(null);
  /** What the step's shared axis moves: the overlay's cross-fade block, or the page's column. */
  const stepContentRef = useRef<HTMLDivElement>(null);
  /** Whether something layered over the detail owns input — read at event time by the step. */
  const stepBlockedRef = useRef<() => boolean>(() => false);
  /* The picture on screen is the step's, not the route's: 上一张 / 下一张 change it in place,
     and the route (and its `[id]`) stays the one the viewer opened on — see `useDetailStep`. */
  const {
    imageId,
    neighbours: stepNeighbours,
    loading: stepLoading,
    step: stepTo,
    bindSwipe,
    isStepping,
  } = useDetailStep({
    routeId: Number(params.id),
    contentRef: stepContentRef,
    rootRef: presentation === 'overlay' ? overlayRef : stepContentRef,
    scrollerRef: presentation === 'overlay' ? overlayScrollerRef : null,
    isBlocked: () => stepBlockedRef.current(),
    onError: (error) => showToast(apiErrorMessage(error), 'error'),
  });
  /* The session id alone: every other runtime field changes several times per flight and on
     every step, and this is the largest tree on screen — subscribed to the whole runtime, it
     re-rendered at the press of every 上一张 / 下一张, in the frame the step starts. */
  const heroSessionId = useSyncExternalStore(subscribeImageHeroRuntime, readHeroSessionId, readHeroSessionId);
  const routeInstanceId = useId();
  const surfaceId = useMemo(() => `hero-route:${imageId}:${routeInstanceId}`, [imageId, routeInstanceId]);
  // Latch the seed for this route id: a live read would flip to null when the module
  // snapshot expires and remount the media mid-view. Re-read on a new runtime session,
  // when a fresh controller-owned snapshot may exist for this otherwise stable route id.
  const heroSeed = useMemo(() => {
    void heroSessionId;
    return getImageHeroOrigin(imageId);
  }, [imageId, heroSessionId]);

  /* A direct load's server-read record. Installed in the record cache during render — the
     resource layer's own `initial` precedent: idempotent (an entry already there is left alone),
     browser-only, and an effect would be a frame late for the hydrating pass that must not
     disagree with the server's HTML. */
  const pageSeed = presentation === 'page' && seed?.id === imageId ? seed : null;
  const seedImage = pageSeed?.image ?? null;
  const seedNotFound = pageSeed !== null && pageSeed.image === null;
  if (seedImage && pageSeed) seedImageDetail(seedImage, pageSeed.generatedAt);

  const subscribeDetail = useCallback((listener: () => void) => subscribeImageDetail(imageId, listener), [imageId]);
  const readDetail = useCallback(() => peekImageDetail(imageId), [imageId]);
  const readDetailError = useCallback(() => peekImageDetailError(imageId), [imageId]);
  const prefetchedDetail = useSyncExternalStore(subscribeDetail, readDetail, getServerDetail);
  const recordError = useSyncExternalStore(subscribeDetail, readDetailError, getServerDetail);
  /** The picture's full record — the list's row is not one (a profile's row has no uploader). */
  const record = prefetchedDetail?.image ?? seedImage;
  const image = record ?? heroSeed?.image ?? null;
  /**
   * The media box is latched per route id, seeded once per image, so the width source
   * (hero seed record vs detail record) never switches under it and the box cannot
   * resize a beat after landing.
   *
   * Set during render rather than in an effect, so a new route id never paints a frame at
   * the previous image's aspect ratio.
   */
  const [latchedMedia, setLatchedMedia] = useState<{ id: number; width: number; height: number } | null>(null);
  const seedWidth = heroSeed?.image.width || image?.width || 0;
  const seedHeight = heroSeed?.image.height || image?.height || 0;
  if (seedWidth > 0 && seedHeight > 0 && latchedMedia?.id !== imageId) {
    setLatchedMedia({ id: imageId, width: seedWidth, height: seedHeight });
  }
  const latchedMediaBox = latchedMedia?.id === imageId ? latchedMedia : null;

  const [revealedHeroSeedAt, setRevealedHeroSeedAt] = useState<number | null>(null);
  const [finalReadyId, setFinalReadyId] = useState<number | null>(null);
  const [deferredBodyId, setDeferredBodyId] = useState<number | null>(() => (heroSeed ? null : imageId));
  const [visibleTags, setVisibleTags] = useState<VisibleTagLimits>(() => initialTagLimits(imageId));
  /* Keyed by image id, like `finalReadyId`: the route is reused across detail↔detail
     navigations, so a per-image answer must not outlive its image. */
  const [previewFailedId, setPreviewFailedId] = useState<number | null>(null);
  const [mediaUnavailableId, setMediaUnavailableId] = useState<number | null>(null);
  const previewFailed = previewFailedId === imageId;
  const mediaUnavailable = mediaUnavailableId === imageId;
  /* `!previewFailed` is what turns a dead preview into a visible final rather than a
     stalled handoff: the preview layer is `z-10` and opaque while `heroActive`, so
     dropping the flag is the CSS swap — the same one `revealedHeroSeedAt` performs on a
     normal open. A seeded image with dead media is not a page that failed. */
  const isHeroPreview = Boolean(
    heroSeed?.image.id === imageId && heroSeed.createdAt !== revealedHeroSeedAt && !previewFailed,
  );
  // A Hero snapshot is already a confirmed navigation intent. Start the final
  // request on the first route render; input activity only controls publishing.
  const preloadFinal = Boolean(heroSeed);
  const finalReady = finalReadyId === imageId;
  const deferredBodyReady = deferredBodyId === imageId;
  const visibleTagLimits = visibleTags.imageId === imageId ? visibleTags : initialTagLimits(imageId);

  /* What the screen is: the picture, a picture that does not exist, a read that failed, or the
     read still on its way. A deleted picture is not an outage — it gets no 重试. */
  const notFound = !image && (seedNotFound || (recordError !== null && isNotFound(recordError)));
  const loadFailed = !image && !notFound && recordError !== null;
  const isLoading = !image && !notFound && !loadFailed;
  /** The list's row is on screen but the record behind it could not be read. */
  const bodyError = image !== null && record === null && recordError !== null ? recordError : null;
  /* Offline, a record still on its way is not "loading" — nothing will arrive until the network
     does, so its placeholders give way to saying so, and the read runs again on reconnect. */
  const offline = useOffline();
  const recordPending = record === null && recordError === null && !offline;

  const favesRead = useResource(faveIdsResource, deferredBodyReady && session.token ? { token: session.token } : SKIP);
  const isFaved = favesRead.data?.ids.includes(imageId) ?? false;
  const [favePending, setFavePending] = useState<{ imageId: number; token: string } | null>(null);
  const faveBusy = favePending?.imageId === imageId && favePending.token === session.token;
  const oneTapFave = useSyncedSetting('defaultFaveToMain');
  const defaultFolder = useSyncedSetting('defaultFaveFolder');
  const autoPrivacy = useSyncedSetting('autoPrivacyFaves');
  const showPrivacySpace = useSyncedSetting('showPrivacyFaves');
  /* 收藏到…, per picture: stepping to the next one closes it. */
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const pickerOpen = pickerFor === imageId && session.token !== null;

  const [shareMenu, setShareMenu] = useState<{ imageId: number; native: boolean } | null>(null);
  const shareOpen = shareMenu?.imageId === imageId;
  const [sharingId, setSharingId] = useState<number | null>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const { share: shareToContact, shareDialog } = useShareToContact();

  /* The report's words are kept per picture for the life of the view: a failed submit, a sign-in
     asked for mid-sentence, a dialog closed and opened again — none of them loses them. */
  const [report, setReport] = useState<{ imageId: number; open: boolean; reason: string }>({
    imageId,
    open: false,
    reason: '',
  });
  const reportState = report.imageId === imageId ? report : { imageId, open: false, reason: '' };
  const [reportBusy, setReportBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  /* The route used to remount for every picture, so its per-picture state reset itself. A step
     keeps it mounted: what belongs to one picture resets when the picture changes (the rest is
     keyed by image id already). */
  const [stateImageId, setStateImageId] = useState(imageId);
  if (stateImageId !== imageId) {
    setStateImageId(imageId);
    setReplyTo(null);
    setSelectedTag(null);
  }
  const composerRef = useRef<HTMLDivElement>(null);
  const overlayContentRef = useRef<HTMLDivElement>(null);
  const overlaySurfaceRef = useRef<HTMLDivElement>(null);
  const overlayBackRef = useRef<HTMLButtonElement>(null);
  const detailTargetRef = useRef<HTMLDivElement>(null);
  const previewSurfaceRef = useRef<string | null>(null);

  const heroNavigation = useMemo(
    () => ({
      push: (href: string) => router.push(href, { scroll: false }),
      replace: (href: string) => router.replace(href, { scroll: false }),
    }),
    [router],
  );

  const handleDetailTargetChange = useCallback(
    (ownerSurfaceId: string, target: HTMLDivElement | null) => {
      if (ownerSurfaceId !== surfaceId) return;
      detailTargetRef.current = target;
      updateImageHeroRouteTarget(surfaceId, target);
    },
    [surfaceId],
  );

  const handlePreviewPaintable = useCallback(
    (ownerSurfaceId: string, target: HTMLDivElement) => {
      if (ownerSurfaceId !== surfaceId) return;
      previewSurfaceRef.current = surfaceId;
      detailTargetRef.current = target;
      markImageHeroRoutePreviewPaintable(surfaceId, target);
    },
    [surfaceId],
  );

  /* Both are overlay-only in practice, and that is a property of `surfaceId`: it is passed
     down only in the overlay presentation, and the media components will not report a
     failure without one — the failure they answer is a flight stranded waiting for a
     paintable layer. The id comparison keeps a stale surface's report off the live one. */
  const handlePreviewFailed = useCallback(
    (ownerSurfaceId: string) => {
      if (ownerSurfaceId !== surfaceId) return;
      setPreviewFailedId(imageId);
    },
    [imageId, surfaceId],
  );

  const handleMediaUnavailable = useCallback(
    (ownerSurfaceId: string) => {
      if (ownerSurfaceId !== surfaceId) return;
      setMediaUnavailableId(imageId);
    },
    [imageId, surfaceId],
  );

  useLayoutEffect(() => {
    if (presentation !== 'overlay') return;
    const overlay = overlayRef.current;
    const scroller = overlayScrollerRef.current;
    const content = overlayContentRef.current;
    const surface = overlaySurfaceRef.current;
    if (!overlay || !scroller || !content || !surface) return;
    return registerImageHeroRoute({
      surfaceId,
      imageId,
      overlay,
      scroller,
      content,
      surface,
      target: detailTargetRef.current,
      floatingBack: overlayBackRef.current,
      previewPaintable: previewSurfaceRef.current === surfaceId,
      resolvedWithoutMedia: false,
    });
  }, [imageId, presentation, surfaceId]);

  /* An open nothing flew into — from a history row, a link in a comment, Forward — still arrives:
     out of the row it was pressed in, or with the plain arrival (`lib/detailTransit.ts`). Before
     the first paint, and once per overlay: a step to the next picture keeps this one, and the
     picture is read off the overlay's own route id, which a step does not change. */
  useLayoutEffect(() => {
    if (presentation !== 'overlay' || !overlayRef.current) return;
    return playDetailEntrance(overlayRef.current);
  }, [presentation]);

  /**
   * Tell the controller there will never be anything to hand off to, so the container
   * transform can finish and the failure surface in its place — otherwise a failed load
   * leaves the flight waiting out a 30s timeout with this page sealed behind it. Two terms
   * for two failures: no picture at all (the record failed and no row stands in for it), and
   * both media layers reporting they will never paint.
   */
  const resolvedWithoutMedia = presentation === 'overlay' && (notFound || loadFailed || mediaUnavailable);
  useEffect(() => {
    if (!resolvedWithoutMedia) return;
    markImageHeroRouteResolvedWithoutMedia(surfaceId);
  }, [resolvedWithoutMedia, surfaceId]);

  /* The picture's name in the tab while the viewer is open over the list (the list's own title
     comes back on close). A direct load's title is the route's metadata. */
  useEffect(() => {
    if (presentation !== 'overlay') return;
    const previous = document.title;
    document.title = `#${imageId} - PicPony`;
    return () => {
      document.title = previous;
    };
  }, [imageId, presentation]);

  /* One visit per picture, once its record is in (a profile's row has no uploader yet). The
     mounted detail records it, so a prefetch alone never does. */
  const recordedVisitRef = useRef<number | null>(null);
  useEffect(() => {
    const token = session.token;
    if (!token || !record || recordedVisitRef.current === record.id) return;
    recordedVisitRef.current = record.id;
    const reps = record.representations ?? {};
    void addBrowsingHistory(token, {
      image_id: record.id,
      preview_url: getRawImageUrl(reps.thumb || reps.small || reps.large || record.view_url || ''),
      uploader: record.uploader || '匿名用户',
    }).catch(() => {});
  }, [record, session.token]);

  /* The server's glossary names go into the browser's cache, so the next picture that shares
     tags with this one starts with them. */
  const seedTranslations = pageSeed?.translations ?? null;
  useEffect(() => {
    if (seedTranslations) rememberTagTranslations(seedTranslations);
  }, [seedTranslations]);

  // ---- Tags: glossary names and counts ----
  const showTagCounts = useStoredBoolean(LS_KEYS.showTagCounts);
  const showChineseTags = useStoredBoolean(LS_KEYS.showChineseTags, true);
  const tags = image?.tags;
  /* What is known when the list first renders is simply there: a direct load's names came with
     the document, an overlay's from the browser's cache (the overlay is never a hydrating pass,
     so reading the cache here cannot disagree with server HTML). The rest arrive below. */
  const [tagData, setTagData] = useState<TagData>(() => ({
    imageId,
    translations: presentation === 'overlay' ? peekTagTranslations(tags ?? []) : { ...(seedTranslations ?? {}) },
    counts: {},
  }));
  const currentTagData =
    tagData.imageId === imageId ? tagData : { imageId, translations: peekTagTranslations(tags ?? []), counts: {} };
  if (tagData.imageId !== imageId) setTagData(currentTagData);
  const [preparing, setPreparing] = useState<{ imageId: number; section: TagSection } | null>(null);

  const limitArtists = visibleTagLimits.artists;
  const limitOcs = visibleTagLimits.ocs;
  const limitRegular = visibleTagLimits.regular;
  useEffect(() => {
    if (!tags?.length || (!showChineseTags && !showTagCounts)) return;
    const visible = visibleTagsOf(groupTags(tags), {
      imageId,
      artists: limitArtists,
      ocs: limitOcs,
      regular: limitRegular,
    });
    let cancelled = false;
    let pending: Omit<TagData, 'imageId'> | null = null;
    let cancelPublish: (() => void) | null = null;
    /* Requested as soon as the tags are known — the flight's window included — but written to
       state only once the flight has landed: this is the largest tree on screen. */
    const collect = (kind: 'translations' | 'counts', part: Record<string, string | number | null>) => {
      if (cancelled) return;
      if (!pending) pending = { translations: {}, counts: {} };
      Object.assign(pending[kind], part);
      if (cancelPublish) return;
      cancelPublish = publishWhenHeroSettled(
        () => {
          cancelPublish = null;
          const next = pending;
          pending = null;
          if (cancelled || !next) return;
          setTagData((state) =>
            state.imageId !== imageId
              ? state
              : {
                  imageId,
                  translations: Object.keys(next.translations).length
                    ? { ...state.translations, ...next.translations }
                    : state.translations,
                  counts: Object.keys(next.counts).length ? { ...state.counts, ...next.counts } : state.counts,
                },
          );
        },
        { idle: false, canPublish: () => isImageHeroDetailDataPublishable(imageId) },
      );
    };
    if (showChineseTags) void loadTagTranslations(visible, (part) => collect('translations', part));
    const regular = visible.filter(isRegularTag);
    if (showTagCounts && regular.length > 0) void loadTagCounts(regular, (part) => collect('counts', part));
    return () => {
      cancelled = true;
      cancelPublish?.();
    };
  }, [imageId, limitArtists, limitOcs, limitRegular, showChineseTags, showTagCounts, tags]);

  /* 显示更多: the batch's names first, then the batch — its chips appear once, as they stay. */
  const handleShowMore = (section: TagSection) => {
    if (!tags?.length || preparing?.imageId === imageId) return;
    const limits = visibleTagLimits;
    const next: VisibleTagLimits = { ...limits, [section]: limits[section] + BATCH_SIZES[section] };
    const groups = groupTags(tags);
    const shown = new Set(visibleTagsOf(groups, limits));
    const added = visibleTagsOf(groups, next).filter((tag) => !shown.has(tag));
    const targetId = imageId;
    setPreparing({ imageId: targetId, section });
    void prepareTagBatch(added, { translations: showChineseTags, counts: showTagCounts }).then((data) => {
      setPreparing((current) => (current?.imageId === targetId ? null : current));
      setTagData((state) =>
        state.imageId !== targetId
          ? state
          : {
              imageId: targetId,
              translations: { ...state.translations, ...data.translations },
              counts: { ...state.counts, ...data.counts },
            },
      );
      setVisibleTags(next);
    });
  };

  // ---- The record, and the body under the picture ----
  /* The read starts (or joins the one a hover started) on the first render; a failure lands in
     the record cache's error slot, which the screen reads. Not re-run on the answer: after a
     failure, re-running would retry in a loop. A server that answered 404 is taken at its word. */
  useEffect(() => {
    if (seedNotFound) return;
    void prefetchImageDetail(imageId).catch(() => {});
  }, [imageId, seedNotFound]);

  const retryRecord = useCallback(() => {
    void prefetchImageDetail(imageId).catch(() => {});
  }, [imageId]);

  /* Back online: a read that failed for want of a network tries again by itself. */
  const recordFailedRetryably = recordError !== null && isRetryable(recordError);
  useEffect(() => {
    if (!recordFailedRetryably) return;
    window.addEventListener('online', retryRecord);
    return () => window.removeEventListener('online', retryRecord);
  }, [recordFailedRetryably, retryRecord]);

  // Fetch and final-media decode start immediately. Only the sizeable body subtree
  // waits for resolved detail plus an idle slice, so its mount cannot steal the first
  // event of a newly started wheel/touch stream.
  const hasRecord = record !== null;
  const hasRecordError = recordError !== null;
  useEffect(() => {
    if (heroSeed && !hasRecord && !hasRecordError && !offline) return;
    return publishWhenHeroSettled(() => startTransition(() => setDeferredBodyId(imageId)), {
      canPublish: () => {
        if (!isImageHeroDetailDataPublishable(imageId)) return false;
        /* The whole `opening.` family, not just `opening.flight`: publication stays true
           across `landed` and `handoff`, so the body's mount could land in the handoff frame
           — the frame that must be pixel-identical on both sides. */
        return !getImageHeroRuntime().phase.startsWith('opening.');
      },
    });
  }, [hasRecord, hasRecordError, heroSeed, imageId, offline]);

  // ---- Lightbox ----
  const handleOpenLightbox = useCallback(() => {
    if (!isImageHeroPublicationQuiet()) return;
    /* Record where the detail image is, so the viewer grows out of the picture you
       tapped rather than the middle of the screen. */
    const media = document.querySelector<HTMLElement>('[data-image-hero-role="detail"]');
    const root = document.documentElement;
    if (media) {
      const rect = media.getBoundingClientRect();
      root.style.setProperty('--m3-lightbox-origin-x', `${rect.left + rect.width / 2}px`);
      root.style.setProperty('--m3-lightbox-origin-y', `${rect.top + rect.height / 2}px`);
    } else {
      root.style.removeProperty('--m3-lightbox-origin-x');
      root.style.removeProperty('--m3-lightbox-origin-y');
    }
    setIsLightboxOpen(true);
  }, []);

  const handleCloseLightbox = useCallback(() => setIsLightboxOpen(false), []);

  const handleFinalReady = useCallback(
    (ownerSurfaceId?: string) => {
      if (presentation === 'overlay' && ownerSurfaceId !== surfaceId) return;
      setFinalReadyId(imageId);
    },
    [imageId, presentation, surfaceId],
  );

  useEffect(() => {
    if (!finalReady) return;
    return publishWhenHeroSettled(
      () => {
        if (heroSeed) setRevealedHeroSeedAt(heroSeed.createdAt);
      },
      { idle: false, canPublish: () => isImageHeroDetailDataPublishable(imageId) },
    );
  }, [finalReady, heroSeed, imageId]);

  // ---- Navigation ----
  const backOrParent = useBackOrParent('/');
  const handleBackToGallery = useCallback(() => {
    if (interruptImageHero()) return;

    if (presentation === 'page') {
      /* A page is either a cold entry — back through history when the entry behind is the
         app's, otherwise up to the gallery in place of this entry, never a push (R4-041) — or
         a reload of an open overlay, whose ladder is still in history with nothing behind it:
         that collapses to the list it was opened from, its search and page intact (R10-003). */
      const orphan = leaveImageHeroOrphanLadder();
      if (!orphan) {
        backOrParent();
        return;
      }
      void orphan.collapsed.then((landed) => {
        if (!landed) router.replace(orphan.background, { scroll: false });
      });
      return;
    }
    void requestImageHeroClose({ imageId, navigation: heroNavigation, cause: 'button' });
  }, [backOrParent, heroNavigation, imageId, presentation, router]);

  /* **Modal to the list, not to the app.** The overlay covers the content area and nothing else:
     the list beneath goes `inert` once the picture has landed, while the app bar and the drawer
     stay live beside it — exactly as they are on the detail's own page, where a direct visit
     always had them. Making them inert as well left a docked drawer and an app bar on screen that
     no click reached. So focus enters on open and returns to the card on close, but Tab may leave
     for the chrome (`containFocus: false`), and the section is a non-modal dialog. */
  useOverlayLayer(presentation === 'overlay' && !isLightboxOpen, overlayRef, {
    containFocus: false,
    onClose: () => {
      if (replyTo) setReplyTo(null);
      else handleBackToGallery();
    },
    /* The card of the picture on screen, in the active pane (a profile keeps uploads and
       favourites both mounted, and the same picture can be in each). A card still on a page
       the list has yet to turn to is not here: the controller focuses it once revealed. */
    returnFocus: () => findImageHeroCardLink(imageId) ?? findDetailOriginLink(imageId),
  });

  /* The drawer row of the very page this overlay covers means 返回 (`SidebarNav`'s reselect):
     the shell reaches this 返回 through the runtime, since it must not import the engine. */
  useEffect(() => {
    if (presentation !== 'overlay') return;
    return registerImageDetailClose(handleBackToGallery);
  }, [handleBackToGallery, presentation]);

  /* An arrow a step made unavailable (the list's true end) cannot keep focus, and the browser
     would drop it on the document at the next frame: hand it to the other arrow first. */
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement) || !active.disabled) return;
    const group = active.closest<HTMLElement>('[data-image-detail-step]');
    if (!group) return;
    const sibling = [...group.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button !== active && !button.disabled,
    );
    (sibling ?? overlayRef.current)?.focus({ preventScroll: true });
  });

  // Stable dismiss bind: rebinding on isLoading/modal state disposed the gesture
  // mid-pull and made pull-to-dismiss feel random.
  const dismissCanStartRef = useRef<() => boolean>(() => true);
  const layered = isLightboxOpen || selectedTag !== null || reportState.open || shareOpen;

  useLayoutEffect(() => {
    stepBlockedRef.current = () => layered;
    /* A step moving the content (or a finger paging it) and a pull are two hands on one
       surface: whichever started first keeps it. */
    dismissCanStartRef.current = () => !layered && !isStepping();
  }, [isStepping, layered]);

  useEffect(() => {
    if (presentation !== 'overlay') return;
    return bindImageHeroDismissGesture(surfaceId, () => dismissCanStartRef.current(), heroNavigation);
  }, [heroNavigation, presentation, surfaceId]);

  /* Escape leaves the screen — unless something is layered over it, which owns the key and
     closes itself first; a reply in progress is dropped before the screen is left. */
  useEscapeBack(handleBackToGallery, !layered && !replyTo);
  useEffect(() => {
    if (!replyTo || layered) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setReplyTo(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [layered, replyTo]);

  // ---- Comments ----
  const handleReply = (target: ReplyTarget) => {
    setReplyTo(target);
    /* The overlay presentation scrolls its own container, not the app scroller. */
    scrollAppToElement(composerRef.current, {
      scroller: presentation === 'page' ? undefined : overlayScrollerRef.current,
    });
  };

  // ---- The one-click image translation (decision 15) ----
  const facts = image ? mediaFacts(image) : null;
  /* The service keys its cache on the original's raw URL — the same string on every line. */
  const translationSource = facts && !facts.isVideo && image?.view_url ? getRawImageUrl(image.view_url) : null;
  const translationEnabled = useSyncExternalStore(
    (listener) => translateSwitch.subscribe({}, listener),
    () => translateSwitch.peek({}).data,
    () => undefined,
  );
  const translateOff = translationEnabled === false;
  const [checkingSwitchId, setCheckingSwitchId] = useState<number | null>(null);
  const imageTranslation = useImageTranslation(translateOff ? null : translationSource, {
    onFinished: () => showToast('翻译完成，已显示译图', 'success'),
    onBroken: () => showToast('译图暂时无法显示，已恢复原图', 'error'),
  });
  const translationBusy =
    checkingSwitchId === imageId ||
    imageTranslation.phase === 'requesting' ||
    imageTranslation.phase === 'queued' ||
    imageTranslation.phase === 'translating' ||
    imageTranslation.phase === 'loading';
  /* The site switch is read on the first press, not on every picture: an administrator's switch
     is not worth a request per visit, and a press that finds it off hides the control. */
  const handleTranslate = () => {
    if (imageTranslation.phase !== 'idle') {
      imageTranslation.toggle();
      return;
    }
    const targetId = imageId;
    const start = imageTranslation.toggle;
    setCheckingSwitchId(targetId);
    translateSwitch.read({}).then(
      (enabled) => {
        setCheckingSwitchId((current) => (current === targetId ? null : current));
        if (!enabled) {
          showToast('图片翻译暂未开放', 'info');
          return;
        }
        start();
      },
      (error: unknown) => {
        setCheckingSwitchId((current) => (current === targetId ? null : current));
        showToast(apiErrorMessage(error, '图片翻译暂时不可用'), 'error');
      },
    );
  };

  // ---- Actions ----
  const handleToggleFave = () => {
    const token = readToken();
    if (!token) {
      openAuth('login');
      return;
    }
    if (!image || faveBusy) return;
    /* The full record when it has landed — the privacy space stores it whole — else the row. */
    const target = (record ?? image) as PonyImage;
    const targetId = target.id;
    setFavePending({ imageId: targetId, token });
    void sendFavePress(token, target, { oneTap: oneTapFave, defaultFolder, autoPrivacy }).then((outcome) => {
      setFavePending((current) => (current?.imageId === targetId && current.token === token ? null : current));
      /* A different account now: nothing of this answer is said to it. */
      if (readToken() !== token) return;
      if (!outcome.ok) {
        showToast(outcome.message, 'error');
        return;
      }
      if (outcome.kind === 'picker') {
        setPickerFor(targetId);
      } else if (outcome.kind === 'privacy') {
        showToast('露骨图片已自动收藏到隐私空间', 'info', {
          action: showPrivacySpace
            ? { label: '查看', onClick: () => router.push(favoritesHref('privacy'), { scroll: false }) }
            : { label: '设置', onClick: () => router.push('/settings', { scroll: false }) },
        });
      } else if (outcome.kind === 'faved') {
        showToast(`已收藏到「${outcome.folderName}」`, 'success', {
          action: { label: '更改', onClick: () => setPickerFor(targetId) },
        });
      } else {
        showToast('已取消收藏', 'success', {
          action: {
            label: '撤销',
            onClick: () =>
              void restoreFavourite(token, targetId, outcome.previous, defaultFolder.id).catch((error: unknown) =>
                showToast(apiErrorMessage(error, '撤销失败'), 'error'),
              ),
          },
        });
      }
    });
  };

  const handleOpenFolderPicker = () => {
    if (!readToken()) {
      openAuth('login');
      return;
    }
    if (image) setPickerFor(image.id);
  };

  const handleShareSelect = (value: string) => {
    if (!image) return;
    const token = readToken();
    if (value === 'contact') {
      shareToContact({ kind: 'image', imageId: image.id, thumbUrl: shareThumbUrl(image.representations) });
      return;
    }
    const targetId = image.id;
    const done = () => setSharingId((current) => (current === targetId ? null : current));
    setSharingId(targetId);
    const task = value === 'native' ? shareImageNatively(image, token) : copyImageLink(image, token);
    void task.then(done, done);
  };

  const handleDownload = () => {
    if (!image || downloadingId === image.id) return;
    const source = { id: image.id, url: facts?.fullSrc ?? '', format: image.format };
    if (!source.url) {
      showToast('原图地址缺失，无法下载', 'error');
      return;
    }
    const targetId = image.id;
    const done = () => setDownloadingId((current) => (current === targetId ? null : current));
    setDownloadingId(targetId);
    void downloadOriginal(source).then(done, () => {
      done();
      showToast('原图下载失败', 'error', {
        action: {
          label: '在新标签页打开',
          onClick: () => window.open(getRawImageUrl(source.url), '_blank', 'noopener,noreferrer'),
        },
      });
    });
  };

  const handleReportPress = () => {
    if (!readToken()) {
      openAuth('login');
      return;
    }
    setReport({ ...reportState, open: true });
  };

  const handleReportSubmit = () => {
    const reason = reportState.reason.trim();
    if (!reason || reportBusy) return;
    const token = readToken();
    if (!token) {
      /* The session ended mid-sentence: sign in, and the words are still here afterwards. */
      openAuth('login');
      return;
    }
    const targetId = imageId;
    setReportBusy(true);
    void sendReport(token, targetId, reason).then((outcome) => {
      setReportBusy(false);
      if (!outcome.ok) {
        showToast(outcome.message, 'error');
        return;
      }
      showToast('已提交举报，感谢反馈', 'success');
      setReport((current) => (current.imageId === targetId ? { imageId: targetId, open: false, reason: '' } : current));
    });
  };

  // ---- Lightbox slides ----
  const lightboxSlides: PicLightboxSlide[] = [];
  if (image && facts?.fullSrc) {
    const videoType = facts.format === 'webm' ? 'video/webm' : facts.format === 'mp4' ? 'video/mp4' : null;
    if (facts.isVideo && videoType) {
      lightboxSlides.push({
        type: 'video' as const,
        sources: [{ src: facts.fullSrc, type: videoType }],
        autoPlay: true,
        controls: true,
        loop: true,
      });
    } else {
      /* What is on screen: the translation while it is shown. */
      const translated = imageTranslation.shown ? imageTranslation.url : null;
      lightboxSlides.push({
        src: translated ?? facts.fullSrc,
        alt: translated ? `${describeImage(image)}（译图）` : describeImage(image),
        width: image.width || undefined,
        height: image.height || undefined,
      });
    }
  }

  /* The overlay's own horizontal inset, and only where there is not one already: in the
     `page` presentation `[data-page-content]` already insets. Horizontal only — a geometry
     contract: `HeroStage` renders the landing target inside `image-detail-page mx-auto
     max-w-5xl px-2 sm:px-4` with no vertical padding, and the Stage and this must produce
     pixel-identical boxes or the handoff visibly shifts. If this gains vertical padding, the
     Stage gains the same padding in the same commit. */
  const overlayGutter = presentation === 'overlay' ? 'px-2 sm:px-4' : '';

  /**
   * `centred` threads the `StatusView fill` chain: `fill` is `flex-1`, so every box
   * between the block and the scroller must be a flex column or the `1` has nothing to
   * divide.
   */
  const renderDetailShell = (content: ReactNode, centred = false) => {
    if (presentation === 'page') {
      return (
        <div
          ref={stepContentRef}
          tabIndex={-1}
          className={cn('relative focus-visible:outline-hidden', centred && 'flex flex-1 flex-col')}
        >
          <PageBack onClick={handleBackToGallery} label="返回图片列表" />
          {content}
        </div>
      );
    }

    return (
      <section
        ref={overlayRef}
        data-image-detail-overlay
        data-image-hero-route-id={String(imageId)}
        data-image-hero-surface-id={surfaceId}
        role="dialog"
        aria-label="图片详情"
        tabIndex={-1}
        className="image-detail-route absolute inset-0 z-detail-overlay overflow-hidden"
      >
        {/* The dialog's first element, so it is the first Tab stop — it is the first thing on
            screen (R10-008). Absolutely placed, so nothing moves; outside the window and
            counter-scale below, so the container transform never scales it. No
            `data-image-detail-reveal`: its entrance is the `floatingBack` branch of
            `buildOverlayAnimations`, and the pull gesture reaches it by a compound selector. */}
        <DetailBack
          ref={overlayBackRef}
          data-image-detail-back-button
          data-image-detail-floating-back="route"
          data-image-hero-route-id={String(imageId)}
          aria-keyshortcuts="Escape"
          title="返回图片列表 (Esc)"
          onClick={handleBackToGallery}
          className="image-detail-back"
        />
        {/* 上一张 / 下一张 in the list the picture was opened from (decision 19): the
            dialog's trailing actions, pinned opposite the back affordance and in its shape.
            Hidden outright when the picture belongs to no list; at a true end an arrow is
            unavailable, and it shows the wait while the next page loads. Absent from the
            hero Stage, so they stand down during a flight (globals.css); the pull fades
            them with the back affordance (`data-image-detail-chrome`). */}
        {stepNeighbours.inSequence && (
          <div data-image-detail-step data-image-detail-chrome className="image-detail-step">
            <IconButton
              variant="tonal"
              size="md"
              shape="square"
              icon={<MdChevronLeft />}
              aria-label="上一张"
              disabled={stepNeighbours.previous === null && !stepNeighbours.canLoadPrevious}
              loading={stepLoading === -1}
              onClick={() => stepTo(-1)}
            />
            <IconButton
              variant="tonal"
              size="md"
              shape="square"
              icon={<MdChevronRight />}
              aria-label="下一张"
              disabled={stepNeighbours.next === null && !stepNeighbours.canLoadNext}
              loading={stepLoading === 1}
              onClick={() => stepTo(1)}
            />
          </div>
        )}
        {/* The container transform's window and counter-scale, structurally identical
            to `HeroStage`'s pair (the handoff depends on that), inert until
            `buildContainerAnimations` drives them. */}
        <div data-image-detail-clip className="image-detail-clip absolute inset-0">
          <div data-image-detail-unclip className="image-detail-unclip absolute inset-0">
            <div ref={overlaySurfaceRef} data-image-detail-surface className="absolute inset-0 bg-surface" />
            <div
              ref={overlayScrollerRef}
              className="image-detail-overlay-scroll main-scrollbar absolute inset-0 z-10 overflow-y-auto overscroll-contain"
            >
              <div
                ref={overlayContentRef}
                className={cn('image-detail-overlay-content relative min-h-full w-full', centred && 'flex flex-col')}
              >
                {/* The container transform's cross-fade block — see HERO_CONTENT_SELECTOR — and
                    what a step's shared axis moves (`useDetailStep`); the two never run together. */}
                <div ref={stepContentRef} data-image-detail-crossfade className={cn('w-full', centred && 'flex flex-1 flex-col')}>
                  {content}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  // --- Loading ---
  if (isLoading) {
    /* Never a landing target — the flight is over before this can mount — so it is free to
       carry the vertical padding the real render must not. */
    return renderDetailShell(<DetailSkeleton gutter={overlayGutter} page={presentation === 'page'} />);
  }

  // --- A picture that does not exist, or a read that failed ---
  if (notFound || loadFailed || !image || !facts) {
    /* `fill`, because this block is the whole screen in both presentations. The list's own
       exits stay offered: step past a picture that is gone. */
    const canPrevious = stepNeighbours.previous !== null || stepNeighbours.canLoadPrevious;
    const canNext = stepNeighbours.next !== null || stepNeighbours.canLoadNext;
    /* Offline, the read runs again by itself on reconnect: no 重试 to press meanwhile. */
    const retryable = loadFailed && !offline && isRetryable(recordError);
    const stepActions = stepNeighbours.inSequence && (canPrevious || canNext);
    const actions =
      stepActions || retryable ? (
        <div className="flex flex-wrap justify-center gap-3">
          {retryable && (
            <Button variant="filled" onClick={retryRecord}>
              重试
            </Button>
          )}
          {stepActions && canPrevious && (
            <Button variant="tonal" loading={stepLoading === -1} onClick={() => stepTo(-1)}>
              上一张
            </Button>
          )}
          {stepActions && canNext && (
            <Button variant="tonal" loading={stepLoading === 1} onClick={() => stepTo(1)}>
              下一张
            </Button>
          )}
        </div>
      ) : undefined;
    return renderDetailShell(
      notFound ? (
        <EmptyState fill title="图片不存在" description="该图片可能已被删除" action={actions} />
      ) : (
        <ErrorRetry
          fill
          title="图片加载失败"
          message={offline ? '网络不可用，恢复后自动加载' : apiErrorMessage(recordError)}
          action={actions}
        />
      ),
      true,
    );
  }

  const detailHeroStyle = getHeroMediaStyle(latchedMediaBox ?? { width: image.width, height: image.height });
  /* A direct load has no card to borrow a bitmap from: the record's thumbnail stands in until
     the full picture is decoded (a still — an animated thumbnail would restart the animation). */
  const directPreview =
    !heroSeed && !facts.isVideo && facts.format !== 'gif' && !image.animated ? facts.reps.thumb || undefined : undefined;
  const previewSrc = heroSeed?.previewSrc ?? directPreview;
  const canTranslate = Boolean(translationSource) && !translateOff;
  const shareItems: MenuAction[] = [
    { value: 'copy', label: '复制链接', icon: <MdLink size={ICON.standard} /> },
    ...(shareMenu?.native ? [{ value: 'native', label: '分享到其他应用', icon: <MdIosShare size={ICON.standard} /> }] : []),
    { value: 'contact', label: '分享给联系人', icon: <MdSend size={ICON.standard} /> },
  ];

  return renderDetailShell(
    <div className={cn('image-detail-page mx-auto max-w-5xl', presentation === 'page' && 'page-back-room-5xl', overlayGutter)}>
      <div className="flex flex-col rounded-md bg-transparent">
        {/* Title and measurements. The back affordance is `renderDetailShell`'s, both
            presentations — an inline copy would be a second one. */}
        <DetailHeader
          key={image.id}
          image={image}
          layout={presentation}
          pending={recordPending}
          referenceNow={pageSeed?.generatedAt ?? null}
        />

        {/* The picture. No minimum height: the box already has the picture's aspect ratio, and a
            floor under a small picture was a band of empty well. The Stage's well matches. */}
        <div className="relative flex w-full items-start justify-center px-4 pt-2 pb-4 sm:px-6">
          {/* The picture's box, and where a finger pages (decision 19). It takes the hero
              geometry — an in-flow flex item exactly like the Stage's landing target — and the
              media fills it. It leaves `pan-x` out of its touch action, so the browser never
              claims a horizontal drag (the pull-down and pinch keep theirs). A video pages too,
              except from the band along its bottom edge, where its own controls take the drag. */}
          <div
            ref={bindSwipe}
            data-image-detail-media
            className="relative flex-none touch-pan-y touch-pinch-zoom"
            style={detailHeroStyle}
            onPointerEnter={warmLightbox}
            onPointerDown={warmLightbox}
            onFocus={warmLightbox}
          >
            {facts.isVideo ? (
              <DetailVideo
                key={`${image.id}:${heroSeed?.createdAt ?? 0}`}
                imageId={image.id}
                previewSrc={heroSeed?.previewSrc}
                previewKind={heroSeed?.mediaType}
                finalSrc={facts.videoSrc}
                alt={describeImage(image)}
                style={MEDIA_FILL}
                heroActive={isHeroPreview}
                preloadFinal={preloadFinal}
                surfaceId={presentation === 'overlay' ? surfaceId : undefined}
                onTargetChange={handleDetailTargetChange}
                onPreviewReady={handlePreviewPaintable}
                onFinalReady={handleFinalReady}
                onPreviewFailed={handlePreviewFailed}
                onMediaUnavailable={handleMediaUnavailable}
              />
            ) : (
              <DetailImage
                key={`${image.id}:${heroSeed?.createdAt ?? 0}`}
                imageId={image.id}
                previewSrc={previewSrc}
                finalSrc={facts.imageSrc}
                alt={describeImage(image)}
                width={image.width}
                height={image.height}
                style={MEDIA_FILL}
                heroActive={isHeroPreview}
                preloadFinal={preloadFinal}
                surfaceId={presentation === 'overlay' ? surfaceId : undefined}
                onTargetChange={handleDetailTargetChange}
                onPreviewReady={handlePreviewPaintable}
                onFinalReady={handleFinalReady}
                onPreviewFailed={handlePreviewFailed}
                onMediaUnavailable={handleMediaUnavailable}
                onOpen={handleOpenLightbox}
                translationSrc={imageTranslation.url}
                showTranslation={imageTranslation.shown}
                onTranslationError={imageTranslation.reportBroken}
              />
            )}
          </div>
        </div>

        {/* The body: votes, the picture's actions, its tags, its description and sources, and
            the comments — in that order on screen and for the keyboard. */}
        <div
          data-image-detail-reveal="body"
          className="image-detail-deferred flex min-h-[var(--image-detail-body-min-height)] flex-col bg-transparent p-4 sm:p-6"
          // Ordinary painted content, deliberately: skipping or containing this subtree made
          // the first scroll after a handoff reveal blank space (see the deferred-body rule in
          // globals.css). Stated inline so no utility can reintroduce the isolation.
          style={{ contentVisibility: 'visible', contain: 'none' }}
        >
          <div className="mx-auto w-full max-w-5xl space-y-6">
            <DetailVotes image={record} pending={recordPending} />
            {deferredBodyReady &&
              (record === null && offline ? (
                <ErrorRetry size="inline" title="网络不可用" message="恢复后自动加载图片信息" />
              ) : bodyError !== null ? (
                <ErrorRetry
                  size="inline"
                  title={isNotFound(bodyError) ? '图片不存在或已被删除' : '图片信息加载失败'}
                  message={isNotFound(bodyError) ? undefined : apiErrorMessage(bodyError)}
                  onRetry={isRetryable(bodyError) ? retryRecord : undefined}
                />
              ) : (
                <>
                  {/* The picture's actions: saving it (the reason most people are here) and its
                      page upstream, then favourite, share, translate and report. */}
                  {/* One wrapping row: the two buttons lead, the icon group trails — beside them
                      while the line holds all of it, on a line of its own (centred on a phone, at
                      the trailing edge above) when it does not. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="filled"
                        icon={<MdDownload />}
                        loading={downloadingId === image.id}
                        onClick={handleDownload}
                      >
                        下载原图
                      </Button>
                      <a
                        href={`https://trixiebooru.org/${image.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="在 Derpibooru 查看（在新标签页打开）"
                        className={buttonClasses({ variant: 'tonal' })}
                      >
                        <MdOpenInNew aria-hidden="true" />在 Derpibooru 查看
                      </a>
                    </div>
                    <div className="mx-auto flex items-center gap-1 sm:me-0 sm:ms-auto">
                      <IconButton
                        toggle
                        selected={isFaved}
                        selectedTone="tertiary"
                        loading={faveBusy}
                        aria-label="收藏"
                        icon={isFaved ? <MdStar className="animate-star-burst" /> : <MdStarBorder />}
                        onClick={handleToggleFave}
                      />
                      <IconButton
                        aria-label="收藏到…"
                        aria-haspopup="dialog"
                        aria-expanded={pickerOpen}
                        icon={<MdLibraryAdd />}
                        onClick={handleOpenFolderPicker}
                      />
                      <IconButton
                        ref={shareButtonRef}
                        aria-label="分享"
                        aria-haspopup="menu"
                        aria-expanded={shareOpen}
                        loading={sharingId === image.id}
                        icon={<MdShare />}
                        onClick={() =>
                          setShareMenu(
                            shareOpen ? null : { imageId, native: typeof navigator.share === 'function' },
                          )
                        }
                      />
                      <Menu
                        open={shareOpen}
                        onClose={() => setShareMenu(null)}
                        anchorRef={shareButtonRef}
                        aria-label="分享"
                        items={shareItems}
                        onSelect={handleShareSelect}
                      />
                      {canTranslate && (
                        <IconButton
                          toggle
                          selected={imageTranslation.shown}
                          loading={translationBusy}
                          aria-label="图片翻译"
                          icon={<MdTranslate />}
                          onClick={handleTranslate}
                        />
                      )}
                      <IconButton aria-label="举报" icon={<MdFlag />} onClick={handleReportPress} />
                    </div>
                  </div>
                  {canTranslate && <ImageTranslationStatus translation={imageTranslation} />}
                  <TagList
                    tags={image.tags}
                    visibleTagLimits={visibleTagLimits}
                    translations={showChineseTags ? currentTagData.translations : undefined}
                    counts={showTagCounts ? currentTagData.counts : undefined}
                    onTagClick={setSelectedTag}
                    onShowMore={handleShowMore}
                    preparing={preparing?.imageId === imageId ? preparing.section : null}
                  />
                  <DetailDescription description={image.description} />
                  <DetailSources image={image} />
                  <CommentSection
                    imageId={imageId}
                    derpiCount={record?.comment_count}
                    replyTo={replyTo}
                    onReply={handleReply}
                    onCancelReply={() => setReplyTo(null)}
                    composerRef={composerRef}
                    scrollerRef={presentation === 'overlay' ? overlayScrollerRef : null}
                  />
                </>
              ))}
          </div>
        </div>
      </div>
      {isLightboxOpen && (
        <PicLightbox open={isLightboxOpen} close={handleCloseLightbox} slides={lightboxSlides} onDownload={handleDownload} />
      )}
      <TagInfoModal tag={selectedTag} onClose={() => setSelectedTag(null)} />
      <ReportDialog
        open={reportState.open}
        reason={reportState.reason}
        busy={reportBusy}
        onReasonChange={(reason) => setReport({ ...reportState, reason })}
        onSubmit={handleReportSubmit}
        onClose={() => setReport({ ...reportState, open: false })}
      />
      {shareDialog}
      {session.token && (
        <FolderPicker key={`${session.token}:${imageId}`} open={pickerOpen} token={session.token} imageId={imageId} onClose={() => setPickerFor((current) => current === imageId ? null : current)} />
      )}
    </div>,
  );
}
