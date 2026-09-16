'use client';

import {
  startTransition,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  MdDownload,
  MdOpenInNew,
  MdStar,
  MdStarBorder,
  MdShare,
  MdFlag,
  MdChevronLeft,
  MdChevronRight,
  MdThumbUp,
  MdThumbDown,
} from 'react-icons/md';
import Modal from '@/components/Modal';
import { cn, copyText } from '@/lib/utils';
import { useAuthModal } from '@/components/AuthModal';
import { api, type Comment } from '@/lib/api';
import dynamic from 'next/dynamic';
import { ICON } from '@/lib/icons';
import type { PicLightboxSlide } from '@/components/PicLightbox';
/* The whole lightbox — core *and* its five plugins — behind one boundary. See `PicLightbox`. */
const PicLightbox = dynamic(() => import('@/components/PicLightbox'), { ssr: false });
import { showToast } from '@/components/Toast';
import IconButton from '@/components/IconButton';
import Card from '@/components/Card';
import Menu, { type MenuAction } from '@/components/Menu';
import Skeleton from '@/components/Skeleton';
import DetailHeader from '@/components/DetailHeader';
import DetailBack from '@/components/DetailBack';
import PageBack from '@/components/PageBack';
import { readToken, useEscapeBack, useSession, useStoredBoolean } from '@/lib/hooks';
import { LS_KEYS } from '@/lib/constants';
import { SKIP, useResource } from '@/lib/resource';
import { faveIds as faveIdsResource, sharedFaveIds } from '@/lib/resources';
import { useOverlayLayer } from '@/lib/overlay';
import DetailImage from '@/components/DetailImage';
import DetailVideo from '@/components/DetailVideo';
import TagList, { groupTags } from '@/components/TagList';
import TagInfoModal from '@/components/TagInfoModal';
import { loadTagCounts } from '@/lib/tagCounts';
import { loadTagTranslations, tagTranslationKey } from '@/lib/tagTranslations';
import CommentSection from '@/components/CommentSection';
import Button, { buttonClasses } from '@/components/Button';
import ErrorRetry from '@/components/ErrorRetry';
import { Textarea } from '@/components/Input';
import { getHeroMediaStyle } from '@/lib/hero/geometry';
import { scrollAppToElement } from '@/lib/scrollTo';
import { peekImageDetail, prefetchImageDetail, subscribeImageDetail } from '@/lib/detail';
import {
  bindImageHeroDismissGesture,
  getImageHeroRuntime,
  getImageHeroOrigin,
  interruptImageHero,
  isImageHeroDetailDataPublishable,
  isImageHeroPublicationQuiet,
  markImageHeroRoutePreviewPaintable,
  markImageHeroRouteResolvedWithoutMedia,
  publishWhenHeroSettled,
  registerImageHeroRoute,
  requestImageHeroClose,
  requestImageHeroDetailRouteChange,
  subscribeImageHeroRuntime,
  updateImageHeroRouteTarget,
} from '@/lib/hero';

type PicDetailProps = {
  presentation?: 'page' | 'overlay';
};

function getServerDetail() {
  return null;
}

/**
 * The gallery's press order, as this screen's prev/next stack — read at first render so
 * the failure state's one action is gated on it without a late re-layout. Empty on the
 * server or when unparseable, so callers treat it as a plain array.
 */
const NAV_HISTORY_KEY = 'picpony_nav_history';

function readNavHistory(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = sessionStorage.getItem(NAV_HISTORY_KEY);
    const parsed = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'number') : [];
  } catch {
    return [];
  }
}

const INITIAL_TAG_LIMIT = 80;

/* A `Menu`, not a lone button: "分享" promises a menu (`aria-haspopup="menu"`) and
   future entries have an obvious home. */
const SHARE_ITEMS: MenuAction[] = [{ value: 'copy-link', label: '复制链接' }];

const INITIAL_RELATION_TAG_LIMIT = 32;
const commentsInFlight = new Map<string, Promise<Comment[]>>();

function getCommentsOnce(imageId: string) {
  const existing = commentsInFlight.get(imageId);
  if (existing) return existing;

  const request = api
    .getComments(imageId)
    .then((response) => (response.success ? response.comments : []))
    .catch((error) => {
      console.error('Failed to load comments:', error);
      return [];
    })
    .finally(() => {
      if (commentsInFlight.get(imageId) === request) commentsInFlight.delete(imageId);
    });
  commentsInFlight.set(imageId, request);
  return request;
}

export default function PicDetail({ presentation = 'page' }: PicDetailProps) {
  const params = useParams();
  const router = useRouter();
  const { openAuth } = useAuthModal();
  const session = useSession();
  const id = params.id as string;
  const imageId = Number(id);
  const heroRuntime = useSyncExternalStore(
    subscribeImageHeroRuntime,
    getImageHeroRuntime,
    getImageHeroRuntime,
  );
  const routeInstanceId = useId();
  const surfaceId = useMemo(
    () => `hero-route:${imageId}:${routeInstanceId}`,
    [imageId, routeInstanceId],
  );
  // Latch the seed for this route id: a live read would flip to null when the module
  // snapshot expires and remount the media mid-view. Re-read on a new runtime session,
  // when a fresh controller-owned snapshot may exist for this otherwise stable route id.
  const heroSeed = useMemo(() => {
    void heroRuntime.sessionId;
    return getImageHeroOrigin(imageId);
  }, [imageId, heroRuntime.sessionId]);
  const subscribeDetail = useCallback(
    (listener: () => void) => subscribeImageDetail(imageId, listener),
    [imageId],
  );
  const readDetail = useCallback(() => peekImageDetail(imageId), [imageId]);
  const prefetchedDetail = useSyncExternalStore(subscribeDetail, readDetail, getServerDetail);
  const image = prefetchedDetail?.image ?? heroSeed?.image ?? null;
  /**
   * The media box is latched per route id, seeded once per image, so the width source
   * (hero seed record vs detail record) never switches under it and the box cannot
   * resize a beat after landing.
   *
   * Set during render rather than in an effect, so a new route id never paints a frame at
   * the previous image's aspect ratio.
   */
  const [latchedMedia, setLatchedMedia] = useState<{
    id: number;
    width: number;
    height: number;
  } | null>(null);
  const seedWidth = heroSeed?.image.width || image?.width || 0;
  const seedHeight = heroSeed?.image.height || image?.height || 0;
  if (seedWidth > 0 && seedHeight > 0 && latchedMedia?.id !== imageId) {
    setLatchedMedia({ id: imageId, width: seedWidth, height: seedHeight });
  }
  const latchedMediaBox = latchedMedia?.id === imageId ? latchedMedia : null;


  const [revealedHeroSeedAt, setRevealedHeroSeedAt] = useState<number | null>(null);
  const [finalReadyId, setFinalReadyId] = useState<number | null>(null);
  const [deferredBodyId, setDeferredBodyId] = useState<number | null>(() =>
    heroSeed ? null : imageId,
  );
  const [visibleTags, setVisibleTags] = useState({
    imageId,
    artists: INITIAL_RELATION_TAG_LIMIT,
    ocs: INITIAL_RELATION_TAG_LIMIT,
    regular: INITIAL_TAG_LIMIT,
  });
  const [detailError, setDetailError] = useState<{ id: number; error: Error } | null>(null);
  /* Both keyed by image id, like `finalReadyId`: the route is reused across
     detail↔detail navigations, so a per-image answer must not outlive its image. */
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
  const visibleTagLimits =
    visibleTags.imageId === imageId
      ? visibleTags
      : {
          imageId,
          artists: INITIAL_RELATION_TAG_LIMIT,
          ocs: INITIAL_RELATION_TAG_LIMIT,
          regular: INITIAL_TAG_LIMIT,
        };
  const error = detailError?.id === imageId ? detailError.error : null;
  const isLoading = !image && !error;
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const favesRead = useResource(
    faveIdsResource,
    deferredBodyReady && session.token ? { token: session.token } : SKIP,
  );
  const isFaved = favesRead.data?.includes(imageId) ?? false;
  const [favePending, setFavePending] = useState<{ imageId: number; token: string } | null>(null);
  const faveRequest = useRef(0);
  const faveBusy = useRef(false);
  const isFaveLoading = favePending?.imageId === imageId && favePending?.token === session.token;
  useEffect(() => {
    faveBusy.current = false;
    return () => { faveRequest.current += 1; };
  }, [imageId, session.token]);

  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(true);
  const [commentsViewport, setCommentsViewport] = useState({ imageId, ready: false });
  const [isShareOpen, setIsShareOpen] = useState(false);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  // --- Lightbox state ---
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // --- Image navigation state ---
  /**
   * Nav history is read during the first render, not from an effect: the failure state's
   * one action (上一张) is gated on it, and an effect-learned answer mounts at least one
   * paint after the block — adding a 24px margin plus a 40dp button to a centred column
   * lifts the block 32px ("appears lower, then jumps up").
   *
   * `sessionStorage` is unavailable while rendering on the server, hence the guard; the
   * lazy initialiser runs once per mount on the client, before first paint.
   */
  const [navHistory, setNavHistory] = useState<number[]>(() => readNavHistory());
  const currentNavIndex = useMemo(() => navHistory.indexOf(Number(id)), [navHistory, id]);
  /**
   * Whether this screen can offer 上一张, decided **once, at mount** — deliberately not
   * derived from `currentNavIndex`, which moves as the press order grows. The button only
   * needs to know whether a previous picture *is* reachable, and that is settled at mount;
   * a later change would re-lay-out the failure state's block (see above).
   */
  const [hasNavPrevious] = useState(() => {
    const ids = readNavHistory();
    const index = ids.indexOf(Number(id));
    return index > 0 || (index === -1 && ids.length > 0);
  });

  // --- Tag info modal state ---
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // --- Comment reply state ---
  const [replyTo, setReplyTo] = useState<{ id: number; username: string; body: string } | null>(
    null,
  );
  const commentEditorMountRef = useRef<HTMLDivElement>(null);
  const commentsSectionRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLElement>(null);
  const overlayScrollerRef = useRef<HTMLDivElement>(null);
  const overlayContentRef = useRef<HTMLDivElement>(null);
  const overlaySurfaceRef = useRef<HTMLDivElement>(null);
  const overlayBackRef = useRef<HTMLButtonElement>(null);
  const detailTargetRef = useRef<HTMLDivElement>(null);
  const previewSurfaceRef = useRef<string | null>(null);
  const shouldLoadComments = commentsViewport.imageId === imageId && commentsViewport.ready;

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

  /**
   * Tell the controller there will never be anything to hand off to, so the container
   * transform can finish and the error surface in its place — otherwise a failed load
   * leaves the flight waiting out a 30s timeout with this page sealed behind it.
   */
  /* Two terms for two failures: `error` is the detail *record* failing (unreachable during
     a flight — it can only be set when there is no hero seed), while `mediaUnavailable` is
     both media layers reporting they will never paint. A record can resolve with no
     paintable media; deliberate — the branch below renders the picture's box, not the
     error state, for that case. */
  const resolvedWithoutMedia = presentation === 'overlay' && (Boolean(error) || mediaUnavailable);
  useEffect(() => {
    if (!resolvedWithoutMedia) return;
    markImageHeroRouteResolvedWithoutMedia(surfaceId);
  }, [resolvedWithoutMedia, surfaceId]);

  // Wait for the detail record: a profile preview has no uploader metadata yet.
  // The effect belongs to the mounted detail, so prefetch alone never records a visit.
  const historyImage = prefetchedDetail?.image;
  useEffect(() => {
    const token = readToken();
    if (!token || !historyImage) return;
    const reps = historyImage.representations ?? {};
    const previewUrl = reps.thumb || reps.small || reps.large || historyImage.view_url;
    void api
      .addBrowsingHistory(token, {
        image_id: historyImage.id,
        preview_url: previewUrl,
        uploader: historyImage.uploader || '匿名',
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one visit per resolved image id
  }, [historyImage?.id]);

  const showTagCounts = useStoredBoolean(LS_KEYS.showTagCounts);
  const showChineseTags = useStoredBoolean(LS_KEYS.showChineseTags, true);

  // Tag count map: tag name → image count
  const [tagCounts, setTagCounts] = useState<Record<string, number | null>>({});

  // 词库中文翻译：剥离前缀的小写标签名 → 中文（null = 词库未收录）
  const [tagTranslations, setTagTranslations] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!deferredBodyReady) return;
    if (!showChineseTags) return;
    if (!image?.tags || image.tags.length === 0) return;
    const groups = groupTags(image.tags);
    const visibleTags = [
      ...groups.artists.slice(0, visibleTagLimits.artists),
      ...groups.ocs.slice(0, visibleTagLimits.ocs),
      ...groups.regularTags.slice(0, visibleTagLimits.regular),
    ];
    /* 翻译 key 由 lib/tagTranslations 内部剥前缀转小写；这里只取画面上没见过的标签。 */
    const missingTags = visibleTags.filter(
      (tag) => !Object.hasOwn(tagTranslations, tagTranslationKey(tag)),
    );
    if (missingTags.length === 0) return;
    let cancelled = false;
    void loadTagTranslations(missingTags, (translations) => {
      if (cancelled) return;
      setTagTranslations((current) => ({ ...current, ...translations }));
    });
    return () => {
      cancelled = true;
    };
  }, [
    deferredBodyReady,
    image,
    showChineseTags,
    tagTranslations,
    visibleTagLimits.artists,
    visibleTagLimits.ocs,
    visibleTagLimits.regular,
  ]);

  useEffect(() => {
    if (!deferredBodyReady) return;
    if (!showTagCounts) return;
    if (!image?.tags || image.tags.length === 0) return;
    const uniqueTags = [
      ...new Set(groupTags(image.tags).regularTags.slice(0, visibleTagLimits.regular)),
    ];
    const missingTags = uniqueTags.filter((tag) => tagCounts[tag] === undefined);
    if (missingTags.length === 0) return;
    let cancelled = false;
    /* Batched and cached in `lib/tagCounts`; cached ones land in the same tick, so a
       tag list seen before paints its numbers without a request. */
    void loadTagCounts(missingTags, (counts) => {
      if (cancelled) return;
      setTagCounts((current) => ({ ...current, ...counts }));
    });
    return () => {
      cancelled = true;
    };
  }, [deferredBodyReady, image, showTagCounts, tagCounts, visibleTagLimits.regular]);

  // Dynamically import lightbox CSS
  useEffect(() => {
    if (!deferredBodyReady) return;
    let cancelled = false;
    const load = async () => {
      if (!cancelled) await import('yet-another-react-lightbox/styles.css');
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [deferredBodyReady]);

  /* The comment-editor IntersectionObserver that used to live here is gone with what it
     gated: `CommentComposer` renders a placeholder button and mounts the editor on press,
     so the 774KB raw / 176KB brotli editor chunk is paid for by intent. The ref survives
     because the reply flow still scrolls to it. */

  useEffect(() => {
    if (!deferredBodyReady) return;
    const element = commentsSectionRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setCommentsViewport({ imageId, ready: true });
        observer.disconnect();
      },
      { rootMargin: '160px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [deferredBodyReady, imageId]);

  // Save current image ID to navigation history
  useEffect(() => {
    if (!deferredBodyReady) return;
    let cancelled = false;
    if (image) {
      try {
        let ids = readNavHistory();
        const currentIdNum = image.id;
        if (!ids.includes(currentIdNum)) {
          ids.push(currentIdNum);
          if (ids.length > 200) ids = ids.slice(-200);
          sessionStorage.setItem(NAV_HISTORY_KEY, JSON.stringify(ids));
        }
        /* Still deferred only to satisfy the lint rule against a synchronous `setState`
           in an effect: nothing on screen waits for this any more. */
        queueMicrotask(() => {
          if (cancelled) return;
          setNavHistory(ids);
        });
      } catch {}
    }
    return () => {
      cancelled = true;
    };
  }, [deferredBodyReady, image]);

  // Keyboard shortcuts (for detail page only - YARL handles its own)
  useEffect(() => {
    if (isLightboxOpen) return;
    if (selectedTag !== null) return;
    if (isReportModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (isShareOpen) setIsShareOpen(false);
        if (replyTo) setReplyTo(null);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen, selectedTag, isReportModalOpen, isShareOpen, replyTo]);

  const fetchComments = useCallback(() => getCommentsOnce(id), [id]);

  useEffect(() => {
    let isMounted = true;
    let cancelBody = () => {};

    if (id) {
      void prefetchImageDetail(imageId).catch((err: Error) => {
        if (isMounted && !heroSeed) setDetailError({ id: imageId, error: err });
      });

      // Fetch and final-media decode start immediately. Only the sizeable body subtree
      // waits for resolved detail plus an idle slice, so its mount cannot steal the first
      // event of a newly started wheel/touch stream.
      if (!heroSeed || prefetchedDetail) {
        cancelBody = publishWhenHeroSettled(
          () => {
            if (!isMounted) return;
            startTransition(() => setDeferredBodyId(imageId));
          },
          {
            canPublish: () => {
              if (!isImageHeroDetailDataPublishable(imageId)) return false;
              /* The whole `opening.` family, not just `opening.flight`: publication stays
                 true across `landed` and `handoff`, so the body's mount could land in the
                 handoff frame — the frame that must be pixel-identical on both sides and
                 writes scroll position in a batched read/write pass. A React commit of
                 this size there is the worst possible moment for it. */
              return !getImageHeroRuntime().phase.startsWith('opening.');
            },
          },
        );
      }
    }

    return () => {
      isMounted = false;
      cancelBody();
    };
  }, [heroSeed, id, imageId, prefetchedDetail]);

  useEffect(() => {
    if (!deferredBodyReady || !shouldLoadComments || !id) return;
    let isMounted = true;
    let cancelPublication = () => {};
    void (async () => {
      await Promise.resolve();
      if (!isMounted) return;
      const nextComments = await fetchComments();
      if (!isMounted) return;
      cancelPublication = publishWhenHeroSettled(() => {
        if (!isMounted) return;
        setComments(nextComments);
        setIsLoadingComments(false);
      });
    })();
    return () => {
      isMounted = false;
      cancelPublication();
    };
  }, [deferredBodyReady, fetchComments, id, shouldLoadComments]);

  // --- Lightbox handlers ---
  const handleOpenLightbox = useCallback(() => {
    if (!isImageHeroPublicationQuiet()) return;
    /* Record where the detail image is, so the viewer grows out of the picture you
       tapped rather than the middle of the screen. A simplified M3 container transform —
       the full shared-element morph is `lib/hero`'s, and a same-route overlay must not
       hand it a second surface to own. Origin alone makes the connection read. */
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

  const handleCloseLightbox = useCallback(() => {
    setIsLightboxOpen(false);
  }, []);

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
      {
        idle: false,
        canPublish: () => isImageHeroDetailDataPublishable(imageId),
      },
    );
  }, [finalReady, heroSeed, imageId]);

  // --- Navigation handlers ---
  const handleNavigate = useCallback(
    (direction: number) => {
      /* An id not in the press order sits *after* its end, not before its start: the
         appending effect needs the image record, which a failed load never produces, so
         the index stays −1 while the error is on screen — and −1 + −1 used to fall
         through to 「已是第一张」, the one button that state offers doing nothing. */
      const from = currentNavIndex === -1 ? navHistory.length : currentNavIndex;
      const newIndex = from + direction;
      if (newIndex >= 0 && newIndex < navHistory.length) {
        const targetId = navHistory[newIndex];
        if (targetId !== Number(id)) {
          const href = `/pic/${targetId}`;
          if (presentation === 'overlay') {
            router.prefetch(href);
            void prefetchImageDetail(targetId, { priority: 'immediate' });
            void requestImageHeroDetailRouteChange({
              imageId,
              detailHref: href,
              navigation: heroNavigation,
            });
          } else {
            router.push(href, { scroll: false });
          }
        }
      } else {
        showToast(direction > 0 ? '已是最后一张' : '已是第一张', 'info');
      }
    },
    [currentNavIndex, heroNavigation, id, imageId, navHistory, presentation, router],
  );

  const handleBackToGallery = useCallback(() => {
    if (interruptImageHero()) return;

    if (presentation === 'page' && !getImageHeroOrigin(imageId)) {
      router.push('/', { scroll: false });
      return;
    }
    void requestImageHeroClose({
      imageId,
      navigation: heroNavigation,
      cause: 'button',
    });
  }, [heroNavigation, imageId, presentation, router]);

  useOverlayLayer(presentation === 'overlay' && !isLightboxOpen, overlayRef, {
    onClose: () => {
      if (replyTo) setReplyTo(null);
      else handleBackToGallery();
    },
    additionalRefs: [overlayBackRef],
    returnFocus: () => document.querySelector<HTMLElement>(
      `[data-image-hero-role="thumbnail"][data-image-hero-id="${imageId}"]`,
    )?.closest<HTMLAnchorElement>('a') ?? null,
  });

  // Stable dismiss bind: rebinding on isLoading/modal state disposed the gesture
  // mid-pull and made pull-to-dismiss feel random.
  const dismissCanStartRef = useRef<() => boolean>(() => true);

  useLayoutEffect(() => {
    dismissCanStartRef.current = () =>
      !isLightboxOpen && selectedTag === null && !isReportModalOpen && !isShareOpen;
  }, [isLightboxOpen, isReportModalOpen, isShareOpen, selectedTag]);

  useEffect(() => {
    if (presentation !== 'overlay') return;
    return bindImageHeroDismissGesture(
      surfaceId,
      () => dismissCanStartRef.current(),
      heroNavigation,
    );
  }, [heroNavigation, presentation, surfaceId]);

  /* Escape leaves the screen — unless something is layered over it, in which case that
     thing owns the key and closes itself first (the keydown handler near the top clears
     `isShareOpen` and `replyTo`). */
  useEscapeBack(
    handleBackToGallery,
    !isLightboxOpen && selectedTag === null && !isReportModalOpen && !isShareOpen && !replyTo,
  );

  // --- Comment reply ---
  const handleReply = (comment: Comment) => {
    setReplyTo({ id: comment.id, username: comment.username, body: comment.body });
    /* The overlay presentation scrolls its own container, not the app scroller — which
       is why a bare `scrollIntoView` could not say *which* scroller and handed the jump
       to the browser's own curve. `scrollAppToElement` takes the scroller and lands the
       target's top edge at the top. */
    scrollAppToElement(commentEditorMountRef.current, {
      scroller: presentation === 'page' ? undefined : overlayScrollerRef.current,
    });
  };

  const handleCancelReply = () => {
    setReplyTo(null);
  };

  // --- Fave toggle ---
  const handleShareSelect = useCallback((value: string) => {
    if (value !== 'copy-link') return;
    /* `copyText`, not a raw clipboard write — that has no fallback on a non-secure
       origin and the toast then lied about it. */
    void copyText(window.location.href).then((ok) =>
      showToast(ok ? '链接已复制' : '复制失败，请手动复制地址栏链接', ok ? 'success' : 'error'),
    );
  }, []);

  const handleToggleFave = async () => {
    const token = readToken();
    if (!token) {
      showToast('请先登录', 'error');
      openAuth('login');
      return;
    }

    if (faveBusy.current || !image || token !== session.token) return;

    const targetId = image.id;
    const run = ++faveRequest.current;
    const isCurrent = () => run === faveRequest.current && readToken() === token;
    faveBusy.current = true;
    setFavePending({ imageId: targetId, token });
    try {
      /* Start from the shared complete list, even when the button is pressed before its
         first status read lands. Writing a one-item array on a cold key loses other faves. */
      const knownIds = await faveIdsResource.read({ token });
      if (!isCurrent()) return;
      const res = await api.toggleFave(token, targetId);
      const data = await res.json();
      /* Once the server has accepted a mutation, its cache correction survives navigation.
         UI feedback is still scoped to this detail; account changes discard both. */
      if (readToken() !== token) return;
      if (data.success) {
        const newFavedStatus = data.is_faved !== undefined ? Boolean(data.is_faved) : !knownIds.includes(targetId);
        faveIdsResource.write({ token }, (previous) => {
          const ids = previous ?? knownIds;
          return newFavedStatus
            ? (ids.includes(targetId) ? ids : [targetId, ...ids])
            : ids.filter((faveId) => faveId !== targetId);
        });
        if (typeof session.user?.username === 'string') {
          sharedFaveIds.expire({ username: session.user.username });
        }
        if (isCurrent()) showToast(newFavedStatus ? '收藏成功' : '已取消收藏', 'success');
      } else if (isCurrent()) {
        showToast(data.message || '操作失败', 'error');
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Toggle fave error:', err);
      showToast('操作失败', 'error');
    } finally {
      if (isCurrent()) {
        faveBusy.current = false;
        setFavePending(null);
      }
    }
  };

  // --- Download ---
  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!image?.representations?.full && !image?.view_url) {
      showToast('无法下载：图片地址缺失', 'error');
      return;
    }
    const downloadUrl = image.representations?.full || image.view_url || '';
    try {
      const response = await fetch(downloadUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const fileName = downloadUrl.split('/').pop() || `image-${image!.id}`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      window.open(downloadUrl, '_blank');
    }
  };

  // --- Report ---
  const handleReport = async () => {
    if (!reportReason.trim()) {
      showToast('请填写举报原因', 'error');
      return;
    }
    const token = readToken();
    if (!token) {
      showToast('请先登录', 'error');
      openAuth('login');
      return;
    }
    setIsReporting(true);
    try {
      const res = await api.reportImage(token, Number(id), reportReason);
      const data = await res.json();
      if (data.success) {
        showToast('举报已提交，感谢您的反馈', 'success');
        setIsReportModalOpen(false);
        setReportReason('');
      } else {
        showToast(data.message || '提交失败', 'error');
      }
    } catch {
      showToast('提交失败', 'error');
    } finally {
      setIsReporting(false);
    }
  };

  // --- Helpers ---
  const getImageFormat = (url: string): string => {
    const lower = url.split(/[?#]/, 1)[0].toLowerCase();
    if (lower.endsWith('.webm')) return 'WEBM';
    if (lower.endsWith('.mp4')) return 'MP4';
    if (lower.endsWith('.png')) return 'PNG';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'JPEG';
    if (lower.endsWith('.gif')) return 'GIF';
    if (lower.endsWith('.webp')) return 'WEBP';
    if (lower.endsWith('.svg')) return 'SVG';
    return '未知';
  };

  // Build YARL slides array
  const imageSrc = image?.representations?.full || image?.view_url || '';
  const lightboxFormat = getImageFormat(imageSrc);
  const lightboxVideoType =
    lightboxFormat === 'WEBM' ? 'video/webm' : lightboxFormat === 'MP4' ? 'video/mp4' : null;
  const yarlSlides: PicLightboxSlide[] =
    image && imageSrc
      ? lightboxVideoType
        ? [
            {
              type: 'video' as const,
              sources: [{ src: imageSrc, type: lightboxVideoType }],
              autoPlay: true,
              controls: true,
              loop: true,
            },
          ]
        : [
            {
              src: imageSrc,
              alt: image.name || `图片 #${image.id}`,
              width: image.width ?? undefined,
              height: image.height ?? undefined,
              download: {
                url: imageSrc,
                filename: `image-${image.id}.${getImageFormat(imageSrc).toLowerCase()}`,
              },
            },
          ]
      : [];

  /* The overlay's own horizontal inset, and only where there is not one already: in the
     `page` presentation `[data-page-content]` already insets, and a second one stacked
     to 24/40px. The overlay is portalled outside that wrapper and does need its own.
     Horizontal only — a geometry contract, not a preference: `HeroStage` renders the
     landing target inside `image-detail-page mx-auto max-w-5xl px-2 sm:px-4` with no
     vertical padding, and the stage and this must produce pixel-identical boxes or the
     handoff visibly shifts. Vertical padding here drops the media well 16/24px below
     the box the flyer was aimed at, so the picture lands and then hops. If this gains
     vertical padding, the stage gains the same padding in the same commit. */
  const overlayGutter = presentation === 'overlay' ? 'px-2 sm:px-4' : '';

  /**
   * `centred` threads the `StatusView fill` chain: `fill` is `flex-1`, so every box
   * between the block and the scroller must be a flex column or the `1` has nothing to
   * divide. The scroller is `absolute inset-0` (definite height); `min-h-full` on the
   * content wrapper resolves against it; from there down it is flex distribution.
   * `min-height: 100%` on the block itself computes to `auto` — a height from flex
   * distribution is indefinite in Chrome — and centred nothing.
   */
  const renderDetailShell = (content: React.ReactNode, centred = false) => {
    if (presentation === 'page') {
      /* A direct link to /pic/123 gets the same pinned 返回图库 as a gallery arrival —
         the placement is `PageBack`'s (shared by four screens; see its comment for why
         it is a zero-height sticky strip). */
      return (
        <div className={cn('relative', centred && 'flex flex-1 flex-col')}>
          <PageBack onClick={handleBackToGallery} title="返回图库 (Esc)" label="返回图片列表" />
          {content}
        </div>
      );
    }

    return (
      <>
        <section
          ref={overlayRef}
          data-image-detail-overlay
          data-image-hero-route-id={String(imageId)}
          data-image-hero-surface-id={surfaceId}
          role="dialog"
          aria-modal="true"
          aria-label="图片详情"
          tabIndex={-1}
          className="image-detail-route absolute inset-0 z-detail-overlay overflow-hidden"
        >
          {/* The container transform's window and counter-scale, structurally identical
              to `HeroStage`'s pair (the handoff depends on that), inert until
              `buildContainerAnimations` drives them. Both `absolute inset-0`, so the
              `StatusView fill` chain below is unaffected: `flex-1` starts at
              `.image-detail-overlay-content`, under the absolutely positioned scroller. */}
          <div data-image-detail-clip className="image-detail-clip absolute inset-0">
            <div data-image-detail-unclip className="image-detail-unclip absolute inset-0">
          <div
            ref={overlaySurfaceRef}
            data-image-detail-surface
            className="absolute inset-0 bg-surface"
          />
          <div
            ref={overlayScrollerRef}
            className="image-detail-overlay-scroll main-scrollbar absolute inset-0 z-10 overflow-y-auto overscroll-contain"
          >
            <div
              ref={overlayContentRef}
              className={cn(
                'image-detail-overlay-content relative min-h-full w-full',
                centred && 'flex flex-col',
              )}
            >
              {/* The container transform's cross-fade block — see HERO_CONTENT_SELECTOR. */}
              <div
                data-image-detail-crossfade
                className={cn('w-full', centred && 'flex flex-1 flex-col')}
              >
                {content}
              </div>
            </div>
          </div>
            </div>
          </div>
        </section>
        {/* No `data-image-detail-reveal`: this renders as a *sibling* of the overlay, and
            the reveal cascade queries inside the overlay only. Its entrance is the
            `floatingBack` branch of `buildOverlayAnimations`; the pull gesture reaches it
            through a compound selector rather than a descendant one. */}
        <DetailBack
          ref={overlayBackRef}
          data-image-detail-back-button
          data-image-detail-floating-back="route"
          data-image-hero-route-id={String(imageId)}
          onClick={handleBackToGallery}
          className="image-detail-back"
        />
      </>
    );
  };

  // --- Loading skeleton ---
  if (isLoading) {
    return renderDetailShell(
      /* The skeleton is never a landing target — the flight is over before this can
         mount — so it is free to carry the vertical padding the real render must not. */
      <div className={cn('image-detail-page max-w-5xl mx-auto py-4 sm:py-6', overlayGutter)}>
        <div className="flex flex-col rounded-md bg-transparent">
          {/* Matches `DetailHeader`'s real shape: three centred metadata cells, no
              visible title (the `<h1>` is `sr-only`). A mismatched skeleton re-spaces
              the row when the data lands. */}
          <div className="image-detail-header-route p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <Skeleton className="h-5 w-28" delay={60} />
              <Skeleton className="h-5 w-16" delay={120} />
              <Skeleton className="h-5 w-12" delay={180} />
            </div>
          </div>
          <div className="relative flex min-h-[32dvh] w-full items-start justify-center px-4 pb-4 pt-2 sm:px-6 md:min-h-[48dvh]">
            {/* Inset only — a width/height beside it would *replace* the computed
                right/bottom insets, making the placeholder 32px wider than its box and
                overflowing the media well on both axes. */}
            <Skeleton className="absolute inset-4 rounded-md" delay={90} />
          </div>
          <div
            data-image-detail-reveal="body"
            className="image-detail-deferred image-detail-stage-body flex flex-col bg-transparent p-4 sm:p-6"
          >
            <div className="mx-auto w-full max-w-5xl space-y-4">
              <div className="mb-2 flex justify-between">
                <Skeleton className="h-4 w-14" />
                <Skeleton className="h-4 w-14" delay={60} />
              </div>
              <Skeleton className="h-2.5 w-full" delay={120} />
              <Skeleton className="h-4 w-2/3" delay={180} />
              <Skeleton className="h-4 w-full" delay={240} />
            </div>
          </div>
        </div>
      </div>,
    );
  }

  // --- Error state ---
  if (error || !image) {
    /* `ErrorRetry`, not `StatusView` directly — this screen is one of the AGENTS.md
       presets. `fill`, because this block *is* the whole screen in both presentations;
       `page`'s half-viewport floor would centre it in the upper third of a full-height
       scroller. The only action offered is 上一张: the overlay already draws its own
       back affordance top-left. */
    return renderDetailShell(
      <ErrorRetry
        fill
        message="图片可能不存在或已被删除"
        action={
          hasNavPrevious && (
            <Button variant="tonal" onClick={() => handleNavigate(-1)}>
              上一张
            </Button>
          )
        }
      />,
      true,
    );
  }

  const preferMediumDetail =
    (image.size || 0) > 16 * 1024 * 1024 || (image.width || 0) * (image.height || 0) > 40_000_000;
  const detailImageSrc =
    (preferMediumDetail ? image.representations?.medium : undefined) ||
    image.representations?.large ||
    image.representations?.medium ||
    image.representations?.full ||
    image.view_url ||
    '';
  const imageFormat = (
    image.format ||
    detailImageSrc.split(/[?#]/)[0].split('.').pop() ||
    ''
  ).toLowerCase();
  const isVideo = imageFormat === 'webm' || imageFormat === 'mp4';
  const detailVideoSrc =
    image.representations?.medium ||
    image.representations?.large ||
    image.representations?.full ||
    image.view_url ||
    '';
  const detailHeroStyle = getHeroMediaStyle(
    latchedMediaBox ?? { width: image.width, height: image.height },
  );

  return renderDetailShell(
    <div className={cn('image-detail-page max-w-5xl mx-auto', overlayGutter)}>
      <div className="bg-transparent flex flex-col rounded-md">
        {/* === Title & Meta === (back affordance is `renderDetailShell`'s, both
            presentations — an inline copy would be a second one) */}
        <DetailHeader
          key={image.id}
          image={image}
          layout={presentation}
          metadataReady={Boolean(prefetchedDetail)}
        />

        {/* === Image Display (clickable to open lightbox) === */}
        <div className="relative flex min-h-[32dvh] w-full items-start justify-center px-4 pb-4 pt-2 sm:px-6 md:min-h-[48dvh]">
          {isVideo ? (
            <DetailVideo
              key={`${image.id}:${heroSeed?.createdAt ?? 0}`}
              imageId={image.id}
              previewSrc={heroSeed?.previewSrc}
              previewKind={heroSeed?.mediaType}
              finalSrc={detailVideoSrc}
              alt={image.name || `视频 #${image.id}`}
              style={detailHeroStyle}
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
              previewSrc={heroSeed?.previewSrc}
              finalSrc={detailImageSrc}
              alt={image.name || `图片 #${image.id}`}
              width={image.width}
              height={image.height}
              style={detailHeroStyle}
              heroActive={isHeroPreview}
              preloadFinal={preloadFinal}
              surfaceId={presentation === 'overlay' ? surfaceId : undefined}
              onTargetChange={handleDetailTargetChange}
              onPreviewReady={handlePreviewPaintable}
              onFinalReady={handleFinalReady}
              onPreviewFailed={handlePreviewFailed}
              onMediaUnavailable={handleMediaUnavailable}
              onOpen={handleOpenLightbox}
            />
          )}
        </div>

        {/* === Detail Info === */}
        <div
          data-image-detail-reveal="body"
          className="image-detail-deferred flex min-h-[var(--image-detail-body-min-height)] flex-col bg-transparent p-4 sm:p-6"
          // Isolate deferred body paint so late mount cannot blank the gallery
          // compositor layer under the overlay (mid-scroll "background vanished").
          style={{ contentVisibility: 'visible', contain: 'none' }}
        >
          
          <div className="max-w-5xl mx-auto w-full space-y-6">
            {/* Votes — no extra bottom margin: the column is already spaced at 24px
                between siblings, and this block carried it twice. */}
            {!prefetchedDetail ? (
              <div aria-hidden="true" data-image-detail-score-loading>
                <div className="mb-1.5 flex justify-between">
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-4 w-14" delay={60} />
                </div>
                {/* Matches the real track below: the skeleton must not shift the row
                    when the votes land. */}
                <Skeleton className="h-1 w-full rounded-full" delay={120} />
              </div>
            ) : (
              image.upvotes !== undefined &&
              image.downvotes !== undefined && (
                <div>
                  <div className="flex justify-between text-label-l mb-1.5">
                    <span className="text-on-surface flex items-center gap-1">
                      <MdThumbUp size={ICON.dense} className="text-success" aria-label="赞" />
                      {image.upvotes}
                    </span>
                    <span className="text-on-surface flex items-center gap-1">
                      {image.downvotes}
                      <MdThumbDown size={ICON.dense} className="text-error" aria-label="踩" />
                    </span>
                  </div>
                  <div className="relative w-full h-1 bg-secondary-container rounded-full overflow-hidden">
                    {/* With no votes the bare track shows through — the track colour is
                        the M3 progress-track token (`secondary-container`, 4dp tall). */}
                    {image.upvotes === 0 && image.downvotes === 0 ? null : (
                      <>
                        {/* Deliberately not a `ProgressBar`: a 100%-stacked two-segment
                            *ratio* with a both-zero state, which `value`/`max` cannot
                            express. `scaleX` on two full-width absolute bars, not
                            animated width on two flex items — animating width reflows
                            the row every frame while this runs live during overlay
                            paging, exactly when layout work is least affordable.
                            Absolute, because a scaled flex item still occupies its
                            unscaled basis: two 100%-wide flex items would shrink to
                            50/50 and the scale would apply to the wrong box; anchored
                            at opposite edges they tile exactly ([0, r] and [r, 1]).
                            `spring-slow-effects`, the same spring `ProgressBar` takes:
                            critically damped, and an overshoot would push one segment
                            over the other. */}
                        <div
                          className="bg-success-fill spring-slow-effects absolute inset-y-0 left-0 w-full origin-left transition-transform"
                          style={{
                            transform: `scaleX(${image.upvotes / (image.upvotes + image.downvotes)})`,
                          }}
                        />
                        <div
                          className="bg-error-fill spring-slow-effects absolute inset-y-0 left-0 w-full origin-right transition-transform"
                          style={{
                            transform: `scaleX(${image.downvotes / (image.upvotes + image.downvotes)})`,
                          }}
                        />
                      </>
                    )}
                  </div>
                </div>
              )
            )}
            {deferredBodyReady && (
              <>
                {/* Secondary actions: one primitive for all five, so the box is sized
                    by `IconButton`, not by hand around a 20px glyph. */}
                {/* Wrap: the controls plus the divider total ~249px against a 240px
                    content box on a 320px viewport, so the row overflows rather than
                    wrapping. The divider is decorative and goes first on a phone,
                    where the wrap already separates the groups. */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {navHistory.length > 0 && (
                    <>
                      <IconButton
                        onClick={() => handleNavigate(-1)}
                        disabled={currentNavIndex <= 0}
                        aria-label="上一张"
                        icon={<MdChevronLeft size={ICON.control} />}
                      />
                      <IconButton
                        onClick={() => handleNavigate(1)}
                        disabled={currentNavIndex >= navHistory.length - 1}
                        aria-label="下一张"
                        icon={<MdChevronRight size={ICON.control} />}
                      />
                    </>
                  )}
                  {/* Dividers are `outline-variant`. This was
                      `surface-container-highest`, which is a *surface* tone and
                      lands almost invisible on the container it divides. */}
                  <div className="mx-1 h-6 w-px bg-outline-variant max-sm:hidden" />
                  <IconButton
                    onClick={handleToggleFave}
                    loading={isFaveLoading}
                    selected={isFaved}
                    aria-label={isFaved ? '取消收藏' : '收藏'}
                    icon={
                      isFaved ? (
                        <MdStar
                          size={ICON.control}
                          className="animate-star-burst"
                        />
                      ) : (
                        <MdStarBorder size={ICON.control} />
                      )
                    }
                  />
                  <div className="relative">
                    <IconButton
                      ref={shareButtonRef}
                      onClick={() => setIsShareOpen(!isShareOpen)}
                      aria-label="分享"
                      aria-expanded={isShareOpen}
                      aria-haspopup="menu"
                      icon={<MdShare size={ICON.control} />}
                    />
                    {/* `Menu`, not a hand-rolled panel. This one announced
                        itself as `role="menu"` and then implemented none of the
                        contract — no arrow keys, no Escape, no focus
                        management — and caught outside clicks with a
                        full-screen transparent div instead of the overlay hooks
                        that already existed. */}
                    <Menu
                      open={isShareOpen}
                      onClose={() => setIsShareOpen(false)}
                      anchorRef={shareButtonRef}
                      aria-label="分享"
                      items={SHARE_ITEMS}
                      onSelect={handleShareSelect}
                    />
                  </div>
                  <IconButton
                    onClick={() => setIsReportModalOpen(true)}
                    aria-label="举报"
                    className="hover:text-error"
                    icon={<MdFlag size={ICON.control} />}
                  />
                </div>
                {/* Description */}
                <div>
                  {/* No `tracking-wider`: the label roles already carry a
                      tracking token, deliberately set to half the M3 figure
                      because Han glyphs fill the em box. Widening it here put
                      this one heading out of step with every other. */}
                  <h3 className="mb-2 text-label-m-emphasized text-on-surface-variant">简介</h3>
                  {image.description ? (
                    image.description.length > 100 ||
                    (image.description.match(/\n/g) || []).length >= 3 ? (
                      /* `Card interactive`, which renders a real `<button>` — the
                         whole surface is one control. It was a hand-written
                         `rounded-md border border-outline-variant
                         bg-surface-container-low p-4` plus a state layer and a
                         focus ring, i.e. the outlined card's recipe on a tone step
                         that is neither of the card variants, spelled out here and
                         again on both non-interactive branches below.
                         `aria-expanded` is what makes the collapsed state readable
                         rather than merely visible. */
                      <Card
                        variant="outlined"
                        interactive
                        aria-expanded={isDescriptionExpanded}
                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                      >
                        <p
                          className={`text-body-m text-on-surface whitespace-pre-wrap break-words ${!isDescriptionExpanded ? 'line-clamp-3' : ''}`}
                        >
                          {image.description}
                        </p>
                        <span className="text-label-l text-primary-ink mt-2 block text-center">
                          {isDescriptionExpanded ? '折叠简介' : '展开简介'}
                        </span>
                      </Card>
                    ) : (
                      <Card variant="outlined">
                        <p className="text-body-m text-on-surface whitespace-pre-wrap break-words">
                          {image.description}
                        </p>
                      </Card>
                    )
                  ) : (
                    <Card variant="outlined">
                      {/* No `italic`. The rich-text layer states the app's one
                          typographic prohibition and states why — Han has no true
                          italic, so the browser synthesises a slant that is not a
                          typeface. A placeholder sentence is exactly where it is
                          tempting and exactly where it looks wrong. */}
                      <p className="text-body-m text-on-surface-variant">
                        滚木
                      </p>
                    </Card>
                  )}
                </div>
                {/* Source URL */}
                {image.source_url && (
                  <div>
                    <h3 className="text-label-m-emphasized text-on-surface-variant mb-2">
                      来源
                    </h3>
                    <a
                      href={image.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="prose-link touch-target inline-block break-words focus-visible:ring-2 focus-ring"
                    >
                      {image.source_url}
                    </a>
                  </div>
                )}
                <TagList
                  tags={image.tags}
                  visibleTagLimits={visibleTagLimits}
                  showTagCounts={showTagCounts}
                  tagCounts={tagCounts}
                  tagTranslations={showChineseTags ? tagTranslations : undefined}
                  onTagClick={setSelectedTag}
                  onShowMore={setVisibleTags}
                />
                {/* Action buttons.
                    Two `flex-1` buttons of equal weight read as a choice
                    between equals — but downloading is the reason you are on
                    this screen and "view upstream" is a footnote. M3 pairs a
                    filled primary with a *tonal* secondary and sizes both to
                    their content; only below `sm` do they go full-width, where
                    a thumb needs the whole line. */}
                <div className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
                  <Button
                    onClick={handleDownload}
                    variant="filled"
                    size="lg"
                    className="max-sm:w-full"
                    icon={<MdDownload />}
                  >
                    下载原图
                  </Button>
                  <a
                    href={`https://trixiebooru.org/${image.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="在 Derpibooru 查看（在新标签页打开）"
                    className={buttonClasses({
                      variant: 'tonal',
                      size: 'lg',
                      className: 'max-sm:w-full',
                    })}
                  >
                    <MdOpenInNew size={ICON.control} aria-hidden="true" />在 Derpibooru 查看
                  </a>
                </div>
                <CommentSection
                  comments={comments}
                  isLoadingComments={isLoadingComments}
                  imageId={imageId}
                  replyTo={replyTo}
                  commentsSectionRef={commentsSectionRef}
                  commentEditorMountRef={commentEditorMountRef}
                  fetchComments={fetchComments}
                  handleReply={handleReply}
                  handleCancelReply={handleCancelReply}
                  setComments={setComments}
                />
              </>
            )}
          </div>
        </div>
      </div>
      {/* ========== YARL Fullscreen Lightbox (replaces custom lightbox) ========== */}
      {isLightboxOpen && (
        <PicLightbox open={isLightboxOpen} close={handleCloseLightbox} slides={yarlSlides} />
      )}
      <TagInfoModal tag={selectedTag} onClose={() => setSelectedTag(null)} />
      {/* ========== Report Modal ========== */}{' '}
      <Modal
        isOpen={isReportModalOpen}
        onClose={() => {
          if (!isReporting) {
            setIsReportModalOpen(false);
            setReportReason('');
          }
        }}
        title="举报图片"
        closeOnOverlayClick={!isReporting}
        footer={
          <>
            <Button
              variant="text"
              onClick={() => {
                setIsReportModalOpen(false);
                setReportReason('');
              }}
              disabled={isReporting}
            >
              取消
            </Button>
            <Button
              variant="danger"
              onClick={handleReport}
              loading={isReporting}
              disabled={!reportReason.trim()}
            >
              {isReporting ? '提交中…' : '提交举报'}
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant mb-4">
          请描述违规原因，管理员将会审核处理。
        </p>
        <Textarea
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="请详细描述违规原因…"
          rows={4}
          disabled={isReporting}
          className="resize-none"
        />
      </Modal>
    </div>,
  );
}
