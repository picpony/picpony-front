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
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Download from 'yet-another-react-lightbox/plugins/download';
import Video from 'yet-another-react-lightbox/plugins/video';
import { api, Comment } from '@/lib/api';
import dynamic from 'next/dynamic';
import { ICON } from '@/lib/icons';
const Lightbox = dynamic(() => import('yet-another-react-lightbox'), { ssr: false });
import { showToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import IconButton from '@/components/IconButton';
import Card from '@/components/Card';
import Menu, { type MenuAction } from '@/components/Menu';
import Skeleton from '@/components/Skeleton';
import DetailHeader from '@/components/DetailHeader';
import DetailBack from '@/components/DetailBack';
import PageBack from '@/components/PageBack';
import { readToken, useEscapeBack } from '@/lib/hooks';
import DetailImage from '@/components/DetailImage';
import DetailVideo from '@/components/DetailVideo';
import TagList, { groupTags } from '@/components/TagList';
import { loadTagCounts } from '@/lib/tagCounts';
import { loadTagTranslations } from '@/lib/tagTranslations';
import CommentSection from '@/components/CommentSection';
import Button, { buttonClasses } from '@/components/Button';
import ErrorRetry from '@/components/ErrorRetry';
import EmptyState from '@/components/EmptyState';
import { Textarea } from '@/components/Input';
import { getHeroMediaStyle } from '@/lib/hero/geometry';
import { scrollAppToElement } from '@/lib/motion';
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

interface DictionaryEntry {
  id: number;
  en: string;
  cn: string;
  cat: string;
  count: number;
  description: string;
  aliases: string[];
}

type PicDetailProps = {
  presentation?: 'page' | 'overlay';
};

function getServerDetail() {
  return null;
}

/**
 * The gallery's press order, as this screen's prev/next stack.
 *
 * A module-level read so the first render can use it: the failure state's only action is
 * gated on it, and learning it from an effect meant the block re-laid-out one paint later.
 * Returns an empty list on the server and on anything unparseable, so every caller can
 * treat it as a plain array.
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

/* One entry today. It is a `Menu` rather than a lone button because "分享"
   already promised a menu — the trigger has carried `aria-haspopup="menu"` all
   along — and because the next entry (复制图片直链, 举报) has an obvious home. */
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
  // Latch the seed for this route id. A live read on every render would flip
  // to null when the module snapshot expires and remount the media mid-view.
  const heroSeed = useMemo(() => {
    // Runtime session changes are the signal that a fresh controller-owned
    // snapshot may now exist for this otherwise stable route id.
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
   * The media box is latched per route id.
   *
   * It was `heroSeed?.image.width || image.width` — the listing record while a seed
   * existed, the detail record otherwise. `heroSeed` is memoised on
   * `heroRuntime.sessionId`, which changes when a flight ends, so the released snapshot
   * came back null and the width source switched from one record to the other at exactly
   * that moment. Where the two records disagree, the box resized a beat after landing.
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
  const isHeroPreview = Boolean(
    heroSeed?.image.id === imageId && heroSeed.createdAt !== revealedHeroSeedAt,
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
  const [isFaved, setIsFaved] = useState(false);
  const [isFaveLoading, setIsFaveLoading] = useState(false);

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
   * Read during the first render, not from an effect, because the failure state's one
   * action is gated on it.
   *
   * It used to be a `useEffect` gated on `deferredBodyReady` that then deferred its own
   * `setState` through a `queueMicrotask`, so `上一张` mounted at least one paint after the
   * block did — and adding a 24px margin plus a 40dp button to a `justify-center` column
   * lifts the whole block **32px**. That is the "it appears lower, then jumps up" report,
   * and after a hero open it could arrive much later still, because `deferredBodyReady`
   * waits for `publishWhenHeroSettled`.
   *
   * `sessionStorage` is not available while this renders on the server, hence the guard
   * rather than a bare read; the lazy initialiser then runs exactly once per mount on the
   * client, before the first paint.
   */
  const [navHistory, setNavHistory] = useState<number[]>(() => readNavHistory());
  const currentNavIndex = useMemo(() => navHistory.indexOf(Number(id)), [navHistory, id]);
  /**
   * Whether this screen can offer 上一张, decided **once, at mount**.
   *
   * Deliberately not derived from `currentNavIndex`, which moves: the effect below appends
   * the current id to the press order as soon as the image record lands, so an image reached
   * directly goes from "not in history" to "last in history" a paint or two after the first
   * one. In the failure state that is the only action on screen, and adding a 24px margin
   * plus a 40dp button to a `justify-center` column lifts the whole block **32px** — the
   * "it appears lower, then jumps up" report. What the button needs to know is whether there
   * *is* a previous picture, and that is already true at mount either way.
   */
  const [hasNavPrevious] = useState(() => {
    const ids = readNavHistory();
    const index = ids.indexOf(Number(id));
    return index > 0 || (index === -1 && ids.length > 0);
  });

  // --- Tag info modal state ---
  const [tagInfoModal, setTagInfoModal] = useState<{
    open: boolean;
    tag: string;
    data: DictionaryEntry | null;
    loading: boolean;
  }>({
    open: false,
    tag: '',
    data: null,
    loading: false,
  });

  // --- Comment reply state ---
  const [replyTo, setReplyTo] = useState<{ id: number; username: string; body: string } | null>(
    null,
  );
  const [commentEditorMountId, setCommentEditorMountId] = useState<number | null>(null);
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
  const shouldMountCommentEditor = commentEditorMountId === imageId;

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
   * Tell the controller when there will never be anything to hand off to.
   *
   * The handoff waits for a route with a paintable preview *and* a target, and only
   * `DetailImage`/`DetailVideo` provide either — so a failed load left the flight waiting
   * out `HERO_DETAIL_ROUTE_TIMEOUT_MS` with this page sealed behind it, i.e. 30 seconds of
   * blank. Saying so explicitly lets the container transform finish and the error surface in
   * its place, which is what every other resolution does.
   */
  /* The same condition the failure branch renders on: after the loading check, `error ||
     !image` can only be true when `error` is set. Written as the one term so the flag and
     the branch cannot drift apart. */
  const resolvedWithoutMedia = presentation === 'overlay' && Boolean(error);
  useEffect(() => {
    if (!resolvedWithoutMedia) return;
    markImageHeroRouteResolvedWithoutMedia(surfaceId);
  }, [resolvedWithoutMedia, surfaceId]);

  const tokenRef = useRef<string | null>(null);

  // Load token once
  useEffect(() => {
    tokenRef.current = readToken();
  }, []);

  // 记录浏览历史：登录用户打开图片详情时同步到云端（与完整版前端
  // openModal 里的 add_browsing_history 一致），fire-and-forget。
  // 依赖 image?.id：同一张图只在 id 变化时记录一次，prefetch 详情不算浏览。
  useEffect(() => {
    const token = tokenRef.current;
    if (!token || !image) return;
    const reps = image.representations ?? {};
    const previewUrl = reps.thumb || reps.small || reps.large || image.view_url;
    void api
      .addBrowsingHistory(token, {
        image_id: image.id,
        preview_url: previewUrl,
        uploader: image.uploader || '匿名',
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只需跟随 image.id
  }, [image?.id]);

  // Read "显示各标签数量" setting from localStorage
  const [showTagCounts, setShowTagCounts] = useState(false);
  useEffect(() => {
    const read = () => setShowTagCounts(localStorage.getItem('trixie_show_tag_counts') === 'true');
    read();
    window.addEventListener('settings_updated', read);
    return () => window.removeEventListener('settings_updated', read);
  }, []);

  // Read "显示中文标签" setting from localStorage (默认开启)
  const [showChineseTags, setShowChineseTags] = useState(true);
  useEffect(() => {
    const read = () =>
      setShowChineseTags(localStorage.getItem('picpony_show_chinese_tags') !== 'false');
    read();
    window.addEventListener('settings_updated', read);
    return () => window.removeEventListener('settings_updated', read);
  }, []);

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
    /* 翻译 key 由 lib/tagTranslations 内部统一剥前缀转小写，这里只关心
       画面上还没见过的标签。 */
    const missingTags = visibleTags.filter(
      (tag) => tagTranslations[tag.toLowerCase()] === undefined,
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
    /* Batched and cached in `lib/tagCounts`, and reported per batch — the
       cached ones land in the same tick, so a tag list you have seen before
       paints its numbers without a request. */
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

  useEffect(() => {
    if (!deferredBodyReady || !shouldLoadComments) return;
    const element = commentEditorMountRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setCommentEditorMountId(imageId);
        observer.disconnect();
      },
      { rootMargin: '500px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [deferredBodyReady, id, image?.id, imageId, shouldLoadComments]);

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
        /* Still deferred, and now that is only about the lint rule against a synchronous
           `setState` in an effect: nothing on screen waits for this any more, because the
           press order was read during the first render and the failure state's action is
           decided from that read. */
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
    if (tagInfoModal.open) return;
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
  }, [isLightboxOpen, tagInfoModal.open, isReportModalOpen, isShareOpen, replyTo]);

  const fetchComments = useCallback(() => getCommentsOnce(id), [id]);

  useEffect(() => {
    if (!deferredBodyReady) return;
    let cancelled = false;
    const checkFaveStatus = async () => {
      try {
        const token = readToken();
        if (token) {
          const res = await api.getFaves(token);
          if (res.success && res.faves) {
            if (!cancelled) setIsFaved(res.faves.includes(Number(id)));
          }
        }
      } catch (err) {
        console.error('Failed to get faves:', err);
      }
    };

    if (id) {
      void checkFaveStatus();
    }
    return () => {
      cancelled = true;
    };
  }, [deferredBodyReady, id]);

  useEffect(() => {
    let isMounted = true;
    let cancelBody = () => {};

    if (id) {
      void prefetchImageDetail(imageId).catch((err: Error) => {
        if (isMounted && !heroSeed) setDetailError({ id: imageId, error: err });
      });

      // Fetching and final-media decode start immediately. Only the sizeable
      // body subtree waits for resolved detail plus an idle slice, so its mount
      // cannot steal the first event of a newly started wheel/touch stream.
      if (!heroSeed || prefetchedDetail) {
        cancelBody = publishWhenHeroSettled(
          () => {
            if (!isMounted) return;
            startTransition(() => setDeferredBodyId(imageId));
          },
          {
            canPublish: () => {
              if (!isImageHeroDetailDataPublishable(imageId)) return false;
              return getImageHeroRuntime().phase !== 'opening.flight';
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
    /* Record where the detail image is, so the viewer grows out of the picture
       you just tapped rather than out of the middle of the screen. This is a
       simplified M3 container transform — the real shared-element morph belongs
       to `lib/hero`, and borrowing that machinery for a same-route overlay
       would mean handing it a second surface to own. Origin is enough to make
       the connection read. */
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
      /* An id that is not in the press order sits *after* its end, not before its start.
         That is the failure state's case: the effect that appends the current id needs the
         image record, which a failed load never produces, so `currentNavIndex` stays −1 for
         as long as the error is on screen — and `-1 + -1` used to fall through to
         「已是第一张」, i.e. the one button that state offers did nothing. */
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

  // Stable dismiss bind: rebinding on isLoading/modal state disposed the gesture
  // mid-pull (data arrival) and made pull-to-dismiss feel random.
  const dismissCanStartRef = useRef<() => boolean>(() => true);

  useLayoutEffect(() => {
    dismissCanStartRef.current = () =>
      !isLightboxOpen && !tagInfoModal.open && !isReportModalOpen && !isShareOpen;
  }, [isLightboxOpen, isReportModalOpen, isShareOpen, tagInfoModal.open]);

  useEffect(() => {
    if (presentation !== 'overlay') return;
    return bindImageHeroDismissGesture(
      surfaceId,
      () => dismissCanStartRef.current(),
      heroNavigation,
    );
  }, [heroNavigation, presentation, surfaceId]);

  /* Escape leaves the screen — unless something is layered over it, in which
     case that thing owns the key and closes itself first (see the handler at
     the top of the file, which is what clears `isShareOpen` and `replyTo`). */
  useEscapeBack(
    handleBackToGallery,
    !isLightboxOpen && !tagInfoModal.open && !isReportModalOpen && !isShareOpen && !replyTo,
  );

  // --- Tag info modal ---
  const handleTagClick = async (tag: string) => {
    setTagInfoModal({ open: true, tag, data: null, loading: true });
    try {
      const token = tokenRef.current;
      if (token) {
        const res = await api.getDictionary(token, {
          keyword: tag,
          limit: 5,
        });
        if (res.success && res.tags) {
          const match = res.tags.find(
            (t: DictionaryEntry) => t.en.toLowerCase() === tag.toLowerCase(),
          );
          setTagInfoModal((prev) => ({ ...prev, data: match || null, loading: false }));
        } else {
          setTagInfoModal((prev) => ({ ...prev, data: null, loading: false }));
        }
      } else {
        setTagInfoModal((prev) => ({ ...prev, data: null, loading: false }));
      }
    } catch {
      setTagInfoModal((prev) => ({ ...prev, data: null, loading: false }));
    }
  };

  // --- Comment reply ---
  const handleReply = (comment: Comment) => {
    setReplyTo({ id: comment.id, username: comment.username, body: comment.body });
    /* The overlay presentation scrolls its own container, not the app scroller,
       which is why this used to be a bare `scrollIntoView({ behavior: 'smooth' })`
       — there was no way to say *which* scroller. That handed the jump to the
       browser's own curve, so the same action glided differently depending on
       whether the picture had been opened from the gallery or reached directly.
       `scrollAppToElement` already lands the target's top edge at the top, which
       is what `block: 'start'` was asking for. */
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
    /* `copyText`, not `navigator.clipboard.writeText` — the latter has no
       fallback on a non-secure origin and the toast then lied about it. */
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

    if (isFaveLoading || !image) return;

    setIsFaveLoading(true);
    try {
      const res = await api.toggleFave(token, image.id);
      const data = await res.json();
      if (data.success) {
        const newFavedStatus = data.is_faved !== undefined ? data.is_faved : !isFaved;
        setIsFaved(newFavedStatus);
        showToast(newFavedStatus ? '收藏成功' : '已取消收藏', 'success');
      } else {
        showToast(data.message || '操作失败', 'error');
      }
    } catch (err) {
      console.error('Toggle fave error:', err);
      showToast('操作失败', 'error');
    } finally {
      setIsFaveLoading(false);
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
  const yarlSlides =
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

  const zoomPlugin = Zoom;
  const counterPlugin = Counter;
  const fullscreenPlugin = Fullscreen;
  const downloadPlugin = Download;
  const videoPlugin = Video;

  /* The shell's own inset, and only where there is not one already: in the `page`
     presentation `[data-page-content]` is already `p-4 sm:p-6`, so carrying a second
     one here stacked them to 24/40px and made this screen's column narrower than
     every other route's for no stated reason. The overlay is portalled outside that
     wrapper and does need its own.
     **Horizontal only, and that is a geometry contract rather than a preference.**
     `HeroStage` renders the landing target inside `image-detail-page mx-auto
     max-w-5xl px-2 sm:px-4` — no vertical padding — and `geometry.ts` states that the
     stage and this must produce pixel-identical boxes or the handoff visibly shifts.
     A `py-*` here moves the media well down by 16/24px relative to the box the flyer
     was aimed at, so the picture lands and then hops. If this gains vertical padding,
     the stage gains the same padding in the same commit. */
  const overlayGutter = presentation === 'overlay' ? 'px-2 sm:px-4' : '';

  /**
   * `centred` is the `StatusView fill` chain, and it has to be threaded through here
   * because `fill` is `flex-1` rather than a percentage height — every box between the
   * block and the scroller has to be a flex column or the `1` has nothing to divide.
   * The scroller is `absolute inset-0`, so its height is definite; `min-h-full` on the
   * content wrapper resolves against it; and from there down it is flex distribution.
   * `min-height: 100%` on the block itself was tried and computes to `auto`, because a
   * height that comes from flex distribution is indefinite in Chrome — that is the
   * failure this replaces, and it centred nothing.
   */
  const renderDetailShell = (content: React.ReactNode, centred = false) => {
    if (presentation === 'page') {
      /* Opening a link to /pic/123 directly used to drop you on bare content
         with no way back except the browser button, while arriving from the
         gallery gave you a pinned 返回图库. Same screen, two different chromes.

         The placement now comes from `PageBack`, which is the same construct
         four screens share — see its comment for why it is a zero-height
         sticky strip. `data-image-detail-back-button` is not carried across:
         nothing reads it, here or anywhere. */
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
          role="region"
          aria-label="图片详情"
          className="image-detail-route absolute inset-0 z-detail-overlay overflow-hidden"
        >
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
              {/* The container transform's fit target — see HERO_CONTENT_SELECTOR. */}
              <div
                data-image-detail-scale
                className={cn('w-full origin-top-left', centred && 'flex flex-1 flex-col')}
              >
                {content}
              </div>
            </div>
          </div>
        </section>
        {/* No `data-image-detail-reveal`: this renders as a *sibling* of the overlay, and
            the reveal cascade is `overlay.querySelectorAll(HERO_REVEAL_SELECTOR)`, so the
            `chrome` role it used to carry never matched anything. Its entrance is the
            `floatingBack` branch of `buildOverlayAnimations`, and the pull gesture reaches
            it through a compound selector rather than a descendant one. */}
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
          {/* The header's own shape, which is three centred metadata cells and no
              visible title — `DetailHeader` renders its `<h1>` `sr-only`. This drew a
              half-width title bar above a left-aligned row, so the placeholder stood
              in for something the header deliberately does not paint and the row
              jumped from left to centre when the data landed. A skeleton that does
              not match is the one thing a skeleton exists to prevent. */}
          <div className="image-detail-header-route p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              <Skeleton className="h-5 w-28" delay={60} />
              <Skeleton className="h-5 w-16" delay={120} />
              <Skeleton className="h-5 w-12" delay={180} />
            </div>
          </div>
          <div className="relative flex min-h-[32dvh] w-full items-start justify-center px-4 pb-4 pt-2 sm:px-6 md:min-h-[48dvh]">
            {/* `inset-4` alone. With `w-full h-full` beside it the width and height
                won — they are not shorthands for the insets, they *replace* what the
                right and bottom insets computed — so the placeholder was 32px wider
                than its own box and overflowed the media well on both axes. */}
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
    /* `ErrorRetry`, not `StatusView` directly. AGENTS.md names the image detail's
       failure among the screens that must go through the presets, and this had
       re-typed the preset's glyph and its default title by hand because
       `ErrorRetry` took only `onRetry` — it has an `action` slot now.
       The 返回上一页 button is gone because this overlay already draws
       `DetailBack` in its top-left corner, so the screen was offering the same
       exit twice in two places; what is left is the one action specific to being
       mid-gallery.
       `fill`, because this block *is* the whole screen in both presentations —
       the fourth such case after the 404, the route boundary and the Derpibooru
       profile. Without it the block took `page`'s half-viewport floor and centred
       itself in the top half of a full-height scroller, i.e. sat in the upper
       third with nothing under it. */
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
        {/* === Title & Meta ===
            No back button here: `renderDetailShell` pins one for both
            presentations now, so an inline copy would be a second one. */}
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
            {/* Votes.
                `mb-6` removed from both branches: the column is already
                `space-y-6`, so this block carried the gap twice and sat 24px
                further from the actions than any other pair on the page. */}
            {!prefetchedDetail ? (
              <div aria-hidden="true" data-image-detail-score-loading>
                <div className="mb-1.5 flex justify-between">
                  <Skeleton className="h-4 w-14" />
                  <Skeleton className="h-4 w-14" delay={60} />
                </div>
                {/* `h-1`, matching the real track below. It was `h-2.5`, standing
                    in for a 4dp bar, so the row shifted 6px the moment the votes
                    landed — which is the one thing a placeholder exists to
                    prevent. */}
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
                    {/* With no votes the track shows through on its own — that branch
                        used to paint `-highest` over a `-high` track, i.e. two surface
                        steps for one object, neither of them the progress-track token
                        (`ProgressIndicatorTokens.TrackColor` = `secondary-container`,
                        4dp; this was 2.5dp). */}
                    {image.upvotes === 0 && image.downvotes === 0 ? null : (
                      <>
                        {/* Not a `ProgressBar`, and that is deliberate: this is a
                            100%-stacked two-segment *ratio* with a both-zero state,
                            which `value`/`max` cannot express.
                            `scaleX` on two full-width absolute bars, not animated
                            `width` on two flex items. Animating `width` reflows the
                            row every frame, and this runs live while paging between
                            images inside the overlay — exactly when the hero flight
                            is finishing and least able to afford layout work.

                            Absolute rather than flex because a scaled flex item
                            still occupies its unscaled basis: two items at
                            `width: 100%` would shrink to 50/50 and the scale would
                            be applied to the wrong box. Anchored at opposite edges
                            they tile exactly — the up bar covers [0, r] and the
                            down bar, scaled from its right edge, covers [r, 1].

                            `spring-slow-effects`, the same spring `ProgressBar`
                            takes: `ProgressIndicatorDefaults.ProgressAnimationSpec`
                            is critically damped, and an overshoot here would push one
                            segment over the other. It ran `duration-200` with
                            `--ease-symmetric`, which is the *loop* curve, under a
                            comment claiming the 300ms `standard` row — neither of
                            which was what the code did.
                            The `motion-reduce:` guard is gone with them: the global
                            reduced-motion rule re-declares `transition-property` with
                            `!important`, so Tailwind's un-important
                            `motion-reduce:transition-none` never won anyway. */}
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
                {/* Secondary actions.
                    One primitive for all five, which took three dialects out of
                    a single flex row: two of these were `hover:bg-surface-
                    container-high` (the alpha-tint hack `state-layer` replaces),
                    two were `state-layer` already but with different hover
                    colours, and every one of them wrote `p-2.5 rounded-full` by
                    hand — a 40dp box only because a 20px glyph happened to be
                    inside it. `IconButton` sizes the box, not the glyph. */}
                {/* `flex-wrap`: six `shrink-0` controls plus the divider come to
                    ~249px, against a 240px content box on a 320px viewport in the
                    page presentation — so the row overflowed rather than wrapping.
                    The divider is decorative and goes first on a phone, where the
                    wrap already separates the groups. */}
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
                        <span className="text-label-l text-primary mt-2 block text-center">
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
                      className="text-link touch-target inline-block break-words hover:text-link-hover hover:underline rounded-xs outline-none focus-visible:ring-2 focus-ring"
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
                  imageId={imageId}
                  onTagClick={handleTagClick}
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
                    icon={<MdDownload size={ICON.control} />}
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
                  shouldMountCommentEditor={shouldMountCommentEditor}
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
        <Lightbox
          open={isLightboxOpen}
          close={handleCloseLightbox}
          slides={yarlSlides}
          plugins={[zoomPlugin, counterPlugin, fullscreenPlugin, downloadPlugin, videoPlugin]}
          zoom={{
            maxZoomPixelRatio: 3,
            scrollToZoom: true,
          }}
          counter={{ separator: ' / ' }}
          labels={{
            Close: '关闭 (Esc)',
            Download: '下载',
            'Zoom in': '放大',
            'Zoom out': '缩小',
            'Enter Fullscreen': '全屏',
            'Exit Fullscreen': '退出全屏',
          }}
          carousel={{
            finite: true,
          }}
          /* The lightbox ships its own loading ring — a plain CSS spin at a
             constant rate — which is the one place in the app that was not the
             M3 indicator. `render.iconLoading` is the sanctioned override, so
             it becomes `Spinner` like everything else. `tone="inherit"` because
             this sits on `media-stage`, whose ink is `on-media`, not either of
             the two roles the `white` flag can pick between. */
          render={{
            iconLoading: () => (
              <span className="text-on-media">
                <Spinner size="lg" tone="inherit" track />
              </span>
            ),
          }}
          download={{
            download: ({ slide, saveAs }) => {
              const s = slide as unknown as Record<string, unknown>;
              const dl = s.download;
              if (dl && typeof dl === 'object' && 'url' in dl) {
                saveAs(
                  (dl as { url: string; filename?: string }).url,
                  (dl as { url: string; filename?: string }).filename,
                );
              } else if (typeof s.src === 'string') {
                saveAs(s.src);
              }
            },
          }}
        />
      )}
      {/* ========== Tag Info Modal ========== */}
      <Modal
        isOpen={tagInfoModal.open}
        onClose={() => setTagInfoModal({ open: false, tag: '', data: null, loading: false })}
        title={tagInfoModal.tag}
        maxWidth="md"
      >
        {' '}
        {tagInfoModal.loading ? (
          <Spinner label="查询词库中…" className="py-8" />
        ) : tagInfoModal.data ? (
          <div className="space-y-3">
            {' '}
            {tagInfoModal.data.cn && (
              <div>
                {' '}
                <span className="text-label-m-emphasized text-on-surface-variant">
                  中文翻译
                </span>
                <p className="text-body-m text-on-surface mt-1">{tagInfoModal.data.cn}</p>
              </div>
            )}{' '}
            {tagInfoModal.data.description && (
              <div>
                {' '}
                <span className="text-label-m-emphasized text-on-surface-variant">
                  标签简介
                </span>
                <p className="text-on-surface-variant mt-1 text-body-m">
                  {tagInfoModal.data.description}
                </p>
              </div>
            )}{' '}
            {tagInfoModal.data.cat && (
              <div>
                {' '}
                <span className="text-label-m-emphasized text-on-surface-variant">分类</span>
                <p className="text-on-surface-variant mt-1 text-body-m">
                  {tagInfoModal.data.cat}
                </p>
              </div>
            )}{' '}
            {tagInfoModal.data.aliases && tagInfoModal.data.aliases.length > 0 && (
              <div>
                {' '}
                <span className="text-label-m-emphasized text-on-surface-variant">别名</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  
                  {tagInfoModal.data.aliases.map((alias, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant text-label-m rounded-xs"
                    >
                      {alias}
                    </span>
                  ))}
                </div>
              </div>
            )}{' '}
          </div>
        ) : (
          <EmptyState
            size="inline"
            title="词库中暂无此标签的详细信息"
            description="登录后可以查询更多标签信息"
          />
        )}{' '}
        <div className="flex gap-3 mt-4">
          
          <Button
            variant="accent"
            fullWidth
            onClick={() => {
              router.push(`/search?q=${encodeURIComponent(tagInfoModal.tag)}`);
              setTagInfoModal((prev) => ({ ...prev, open: false }));
            }}
          >
            搜索此标签
          </Button>
        </div>
      </Modal>
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
