'use client';

import { startTransition, useEffect, useId, useLayoutEffect, useState, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { MdDownload, MdOpenInNew, MdStar, MdStarBorder, MdShare, MdContentCopy, MdFlag, MdChevronLeft, MdChevronRight } from 'react-icons/md';
import Modal from '@/components/Modal';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Fullscreen from 'yet-another-react-lightbox/plugins/fullscreen';
import Download from 'yet-another-react-lightbox/plugins/download';
import Video from 'yet-another-react-lightbox/plugins/video';
import { api, Comment } from '@/lib/api';
import dynamic from 'next/dynamic';
const Lightbox = dynamic(() => import('yet-another-react-lightbox'), { ssr: false });
import { showToast } from '@/components/Toast';
import Spinner from '@/components/Spinner';
import DetailHeader from '@/components/DetailHeader';
import DetailBack from '@/components/DetailBack';
import DetailImage from '@/components/DetailImage';
import DetailVideo from '@/components/DetailVideo';
import TagList, { groupTags } from '@/components/TagList';
import CommentSection from '@/components/CommentSection';
import { getHeroMediaStyle } from '@/lib/hero/geometry';
import {
  peekImageDetail,
  prefetchImageDetail,
  subscribeImageDetail,
} from '@/lib/detail';
import {
  bindImageHeroDismissGesture,
  getImageHeroRuntime,
  getImageHeroOrigin,
  interruptImageHero,
  isImageHeroDetailDataPublishable,
  isImageHeroPublicationQuiet,
  markImageHeroRoutePreviewPaintable,
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

const INITIAL_TAG_LIMIT = 80;
const INITIAL_RELATION_TAG_LIMIT = 32;
const commentsInFlight = new Map<string, Promise<Comment[]>>();
const tagCountInFlight = new Map<string, Promise<{ tag: string; count: number | null }>>();

function getCommentsOnce(imageId: string) {
  const existing = commentsInFlight.get(imageId);
  if (existing) return existing;

  const request = api.getComments(imageId)
    .then((response) => response.success ? response.comments : [])
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

function getTagCountOnce(token: string, tag: string) {
  const existing = tagCountInFlight.get(tag);
  if (existing) return existing;

  const request = api.getDictionary(token, { keyword: tag, limit: 1 })
    .then((response) => {
      const match = response.success && response.tags
        ? response.tags.find((entry: DictionaryEntry) => entry.en === tag)
        : undefined;
      return { tag, count: match?.count ?? null };
    })
    .finally(() => {
      if (tagCountInFlight.get(tag) === request) tagCountInFlight.delete(tag);
    });
  tagCountInFlight.set(tag, request);
  return request;
}

function isDetailHeavyWorkBlocked(canPublish: () => boolean) {
  return document.visibilityState !== 'visible' || !canPublish();
}

/**
 * Publish only after controller-owned interaction settles. Runtime and
 * visibility subscriptions re-arm this once; there is no polling loop.
 */
function scheduleWhenDetailIdle(
  callback: () => void,
  {
    idle = true,
    canPublish = isImageHeroPublicationQuiet,
  }: {
    idle?: boolean;
    canPublish?: () => boolean;
  } = {},
) {
  let cancelled = false;
  let fired = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let idleCallback = 0;

  const clearScheduled = () => {
    if (firstFrame) cancelAnimationFrame(firstFrame);
    if (secondFrame) cancelAnimationFrame(secondFrame);
    if (idleCallback) window.cancelIdleCallback(idleCallback);
    firstFrame = 0;
    secondFrame = 0;
    idleCallback = 0;
  };

  const schedule = () => {
    clearScheduled();
    if (cancelled || fired || isDetailHeavyWorkBlocked(canPublish)) return;
    firstFrame = requestAnimationFrame(() => {
      firstFrame = 0;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = 0;
        if (cancelled || fired || isDetailHeavyWorkBlocked(canPublish)) return;
        const publish = () => {
          idleCallback = 0;
          if (cancelled || fired || isDetailHeavyWorkBlocked(canPublish)) return;
          fired = true;
          releaseRuntime();
          document.removeEventListener('visibilitychange', schedule);
          callback();
        };
        if (idle && 'requestIdleCallback' in window) {
          idleCallback = window.requestIdleCallback(publish, { timeout: 1200 });
        } else {
          publish();
        }
      });
    });
  };

  const releaseRuntime = subscribeImageHeroRuntime(schedule);
  document.addEventListener('visibilitychange', schedule);
  schedule();

  return () => {
    cancelled = true;
    clearScheduled();
    releaseRuntime();
    document.removeEventListener('visibilitychange', schedule);
  };
}
export default function PicDetail({ presentation = 'page' }: PicDetailProps) {
  const params = useParams();
  const router = useRouter();
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
  const prefetchedDetail = useSyncExternalStore(
    subscribeDetail,
    readDetail,
    getServerDetail,
  );
  const image = prefetchedDetail?.image ?? heroSeed?.image ?? null;
  const [revealedHeroSeedAt, setRevealedHeroSeedAt] = useState<number | null>(null);
  const [finalReadyId, setFinalReadyId] = useState<number | null>(null);
  const [deferredBodyId, setDeferredBodyId] = useState<number | null>(
    () => heroSeed ? null : imageId,
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
  const visibleTagLimits = visibleTags.imageId === imageId
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
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [isReporting, setIsReporting] = useState(false);

  // --- Lightbox state ---
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // --- Image navigation state ---
  const [navHistory, setNavHistory] = useState<number[]>([]);
  const [currentNavIndex, setCurrentNavIndex] = useState(-1);

  // --- Tag info modal state ---
  const [tagInfoModal, setTagInfoModal] = useState<{ open: boolean; tag: string; data: DictionaryEntry | null; loading: boolean }>({
    open: false, tag: '', data: null, loading: false
  });

  // --- Comment reply state ---
  const [replyTo, setReplyTo] = useState<{ id: number; username: string; body: string } | null>(null);
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

  const heroNavigation = useMemo(() => ({
    push: (href: string) => router.push(href, { scroll: false }),
    replace: (href: string) => router.replace(href, { scroll: false }),
  }), [router]);

  const handleDetailTargetChange = useCallback((ownerSurfaceId: string, target: HTMLDivElement | null) => {
    if (ownerSurfaceId !== surfaceId) return;
    detailTargetRef.current = target;
    updateImageHeroRouteTarget(surfaceId, target);
  }, [surfaceId]);

  const handlePreviewPaintable = useCallback((ownerSurfaceId: string, target: HTMLDivElement) => {
    if (ownerSurfaceId !== surfaceId) return;
    previewSurfaceRef.current = surfaceId;
    detailTargetRef.current = target;
    markImageHeroRoutePreviewPaintable(surfaceId, target);
  }, [surfaceId]);

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
    });
  }, [imageId, presentation, surfaceId]);

  const tokenRef = useRef<string | null>(null);

  // Load token once
  useEffect(() => {
    try {
      const userInfoStr = localStorage.getItem('user_info');
      if (userInfoStr) {
        const userInfo = JSON.parse(userInfoStr);
        tokenRef.current = userInfo.token || null;
      }
    } catch {}
  }, []);

  // Read "显示各标签数量" setting from localStorage
  const [showTagCounts, setShowTagCounts] = useState(false);
  useEffect(() => {
    const read = () => setShowTagCounts(localStorage.getItem('trixie_show_tag_counts') === 'true');
    read();
    window.addEventListener('settings_updated', read);
    return () => window.removeEventListener('settings_updated', read);
  }, []);

  // Tag count map: tag name → image count
  const [tagCounts, setTagCounts] = useState<Record<string, number | null>>({});
  useEffect(() => {
    if (!deferredBodyReady) return;
    if (!showTagCounts) return;
    if (!image?.tags || image.tags.length === 0) return;
    const token = tokenRef.current;
    if (!token) return;
    const uniqueTags = [...new Set(
      groupTags(image.tags).regularTags.slice(0, visibleTagLimits.regular),
    )];
    const missingTags = uniqueTags.filter((tag) => tagCounts[tag] === undefined);
    if (missingTags.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        missingTags.map((tag) => getTagCountOnce(token, tag)),
      );
      if (cancelled) return;
      const map: Record<string, number | null> = {};
      results.forEach(r => {
        if (r.status === 'fulfilled') {
          map[r.value.tag] = r.value.count;
        }
      });
      if (Object.keys(map).length > 0) {
        setTagCounts((current) => ({ ...current, ...map }));
      }
    })();
    return () => { cancelled = true; };
  }, [deferredBodyReady, image, showTagCounts, tagCounts, visibleTagLimits.regular]);

  // Dynamically import lightbox CSS
  useEffect(() => {
    if (!deferredBodyReady) return;
    let cancelled = false;
    const load = async () => {
      if (!cancelled) await import('yet-another-react-lightbox/styles.css');
    };
    void load();
    return () => { cancelled = true; };
  }, [deferredBodyReady]);

  // Track navigation context from sessionStorage
  useEffect(() => {
    if (!deferredBodyReady) return;
    let cancelled = false;
    try {
      const stored = sessionStorage.getItem('picpony_nav_history');
      if (stored) {
        const ids: number[] = JSON.parse(stored);
        const currentIdNum = Number(id);
        const idx = ids.indexOf(currentIdNum);
        if (idx !== -1) {
          queueMicrotask(() => {
            if (cancelled) return;
            setNavHistory(ids);
            setCurrentNavIndex(idx);
          });
        }
      }
    } catch {}
    return () => { cancelled = true; };
  }, [deferredBodyReady, id]);

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
        const stored = sessionStorage.getItem('picpony_nav_history');
        let ids: number[] = stored ? JSON.parse(stored) : [];
        const currentIdNum = image.id;
        if (!ids.includes(currentIdNum)) {
          ids.push(currentIdNum);
          if (ids.length > 200) ids = ids.slice(-200);
          sessionStorage.setItem('picpony_nav_history', JSON.stringify(ids));
        }
        const idx = ids.indexOf(currentIdNum);
        queueMicrotask(() => {
          if (cancelled) return;
          setCurrentNavIndex(idx);
          setNavHistory(ids);
        });
      } catch {}
    }
    return () => { cancelled = true; };
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
        const userInfoStr = localStorage.getItem('user_info');
        if (userInfoStr) {
          const userInfo = JSON.parse(userInfoStr);
          if (userInfo.token) {
            const res = await api.getFaves(userInfo.token);
            if (res.success && res.faves) {
              if (!cancelled) setIsFaved(res.faves.includes(Number(id)));
            }
          }
        }
      } catch (err) {
        console.error('Failed to get faves:', err);
      }
    };

    if (id) {
      void checkFaveStatus();
    }
    return () => { cancelled = true; };
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
        cancelBody = scheduleWhenDetailIdle(() => {
          if (!isMounted) return;
          startTransition(() => setDeferredBodyId(imageId));
        }, {
          canPublish: () => {
            if (!isImageHeroDetailDataPublishable(imageId)) return false;
            return getImageHeroRuntime().phase !== 'opening.flight';
          },
        });
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
      cancelPublication = scheduleWhenDetailIdle(() => {
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
    setIsLightboxOpen(true);
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setIsLightboxOpen(false);
  }, []);

  const handleFinalReady = useCallback((ownerSurfaceId?: string) => {
    if (presentation === 'overlay' && ownerSurfaceId !== surfaceId) return;
    setFinalReadyId(imageId);
  }, [imageId, presentation, surfaceId]);

  useEffect(() => {
    if (!finalReady) return;
    return scheduleWhenDetailIdle(() => {
      if (heroSeed) setRevealedHeroSeedAt(heroSeed.createdAt);
    }, {
      idle: false,
      canPublish: () => isImageHeroDetailDataPublishable(imageId),
    });
  }, [finalReady, heroSeed, imageId]);

  // --- Navigation handlers ---
  const handleNavigate = useCallback((direction: number) => {
    const newIndex = currentNavIndex + direction;
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
  }, [currentNavIndex, heroNavigation, id, imageId, navHistory, presentation, router]);

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
    dismissCanStartRef.current = () => (
      !isLightboxOpen &&
      !tagInfoModal.open &&
      !isReportModalOpen &&
      !isShareOpen
    );
  }, [isLightboxOpen, isReportModalOpen, isShareOpen, tagInfoModal.open]);

  useEffect(() => {
    if (presentation !== 'overlay') return;
    return bindImageHeroDismissGesture(
      surfaceId,
      () => dismissCanStartRef.current(),
      heroNavigation,
    );
  }, [heroNavigation, presentation, surfaceId]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        isLightboxOpen ||
        tagInfoModal.open ||
        isReportModalOpen ||
        isShareOpen ||
        replyTo
      ) {
        return;
      }

      event.preventDefault();
      handleBackToGallery();
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [
    handleBackToGallery,
    isLightboxOpen,
    isReportModalOpen,
    isShareOpen,
    replyTo,
    tagInfoModal.open,
  ]);

  // --- Tag info modal ---
  const handleTagClick = async (tag: string) => {
    setTagInfoModal({ open: true, tag, data: null, loading: true });
    try {
      const token = tokenRef.current;
      if (token) {
        const res = await api.getDictionary(token, {
          keyword: tag,
          limit: 5
        });
        if (res.success && res.tags) {
          const match = res.tags.find((t: DictionaryEntry) => t.en.toLowerCase() === tag.toLowerCase());
          setTagInfoModal(prev => ({ ...prev, data: match || null, loading: false }));
        } else {
          setTagInfoModal(prev => ({ ...prev, data: null, loading: false }));
        }
      } else {
        setTagInfoModal(prev => ({ ...prev, data: null, loading: false }));
      }
    } catch {
      setTagInfoModal(prev => ({ ...prev, data: null, loading: false }));
    }
  };

  // --- Comment reply ---
  const handleReply = (comment: Comment) => {
    setReplyTo({ id: comment.id, username: comment.username, body: comment.body });
    commentEditorMountRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleCancelReply = () => {
    setReplyTo(null);
  };

  // --- Fave toggle ---
  const handleToggleFave = async () => {
    let token = null;
    try {
      const userInfoStr = localStorage.getItem('user_info');
      if (userInfoStr) {
        token = JSON.parse(userInfoStr).token;
      }
    } catch (e) {
      console.error('Failed to parse user info', e);
    }

    if (!token) {
      showToast('请先登录', 'error');
      router.push('/login');
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
    let token = null;
    try {
      const userInfoStr = localStorage.getItem('user_info');
      if (userInfoStr) token = JSON.parse(userInfoStr).token;
    } catch {}
    if (!token) {
      showToast('请先登录', 'error');
      router.push('/login');
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
  const lightboxVideoType = lightboxFormat === 'WEBM'
    ? 'video/webm'
    : lightboxFormat === 'MP4'
      ? 'video/mp4'
      : null;
  const yarlSlides = image && imageSrc
    ? (lightboxVideoType
        ? [{
            type: 'video' as const,
            sources: [{ src: imageSrc, type: lightboxVideoType }],
            autoPlay: true,
            controls: true,
            loop: true,
          }]
        : [{
            src: imageSrc,
            alt: image.name || `Image ${image.id}`,
            width: image.width ?? undefined,
            height: image.height ?? undefined,
            download: {
              url: imageSrc,
              filename: `image-${image.id}.${getImageFormat(imageSrc).toLowerCase()}`,
            },
          }])
    : [];

  const zoomPlugin = Zoom;
  const counterPlugin = Counter;
  const fullscreenPlugin = Fullscreen;
  const downloadPlugin = Download;
  const videoPlugin = Video;

  const renderDetailShell = (content: React.ReactNode) => {
    if (presentation === 'page') return content;

    return (
      <>
      <section
        ref={overlayRef}
        data-image-detail-overlay
        data-image-hero-route-id={String(imageId)}
        data-image-hero-surface-id={surfaceId}
        role="region"
        aria-label="图片详情"
        className="image-detail-route absolute inset-0 z-40 overflow-hidden"
      >
        <div ref={overlaySurfaceRef} data-image-detail-surface className="absolute inset-0 bg-white dark:bg-slate-950" />
        <div ref={overlayScrollerRef} className="image-detail-overlay-scroll absolute inset-0 z-10 overflow-y-auto overscroll-contain">
          <div ref={overlayContentRef} className="image-detail-overlay-content relative min-h-full w-full">
            {content}
          </div>
        </div>
      </section>
      <DetailBack
        ref={overlayBackRef}
        data-image-detail-back-button
        data-image-detail-floating-back="route"
        data-image-detail-reveal="chrome"
        data-image-hero-route-id={String(imageId)}
        onClick={handleBackToGallery}
        className="absolute left-3 top-3 z-[46] sm:left-4 sm:top-4"
      />
      </>
    );
  };

  // --- Loading skeleton ---
  if (isLoading) {
    return renderDetailShell(
    <div className="image-detail-page max-w-7xl mx-auto px-2 sm:px-4 py-4 sm:py-6 animate-pulse">
      <div className="flex flex-col rounded-xl bg-transparent">
          <div className="image-detail-header-route p-4 sm:p-6">
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mb-4"></div>
            <div className="flex gap-4">
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-20"></div>
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-20"></div>
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-20"></div>
            </div>
          </div>
          <div className="relative flex min-h-[32vh] w-full items-start justify-center px-4 pb-4 pt-2 md:min-h-[48vh]">
            <div className="w-full h-full bg-slate-200 dark:bg-slate-700 rounded-lg absolute inset-4"></div>
          </div>
          <div
            data-image-detail-reveal="body"
            className="image-detail-deferred image-detail-stage-body flex flex-col bg-transparent p-4 sm:p-6"
          >
            <div className="mx-auto w-full max-w-5xl space-y-4">
              <div className="mb-2 flex justify-between">
                <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
              <div className="h-2.5 w-full rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-4 w-full rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (error || !image) {
    return renderDetailShell(
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4">加载失败</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6">图片可能不存在或已被删除</p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={handleBackToGallery}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            返回上一页
          </button>
          {navHistory.length > 0 && currentNavIndex > 0 && (
            <button
              onClick={() => handleNavigate(-1)}
              className="px-6 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              上一张
            </button>
          )}
        </div>
      </div>
    );
  }

  const preferMediumDetail = (image.size || 0) > 16 * 1024 * 1024 ||
    (image.width || 0) * (image.height || 0) > 40_000_000;
  const detailImageSrc = (preferMediumDetail ? image.representations?.medium : undefined) ||
    image.representations?.large ||
    image.representations?.medium ||
    image.representations?.full ||
    image.view_url ||
    '';
  const imageFormat = (image.format || detailImageSrc.split(/[?#]/)[0].split('.').pop() || '').toLowerCase();
  const isVideo = imageFormat === 'webm' || imageFormat === 'mp4';
  const detailVideoSrc = image.representations?.medium ||
    image.representations?.large ||
    image.representations?.full ||
    image.view_url ||
    '';
  const detailHeroStyle = getHeroMediaStyle({
    width: heroSeed?.image.width || image.width,
    height: heroSeed?.image.height || image.height,
  });

  return renderDetailShell(
    <div className={`image-detail-page max-w-7xl mx-auto px-2 sm:px-4 ${presentation === 'page' ? 'animate-fade-in' : ''}`}>
      <div className="bg-transparent flex flex-col rounded-xl">
        {/* === Title & Meta === */}
        {presentation === 'page' && (
          <div className="px-4 pt-4 sm:px-6 sm:pt-6">
          <DetailBack
            data-image-detail-back-button
            onClick={handleBackToGallery}
            className="mb-1"
          />
          </div>
        )}
        <DetailHeader
          key={image.id}
          image={image}
          layout={presentation}
          metadataReady={Boolean(prefetchedDetail)}
        />

        {/* === Image Display (clickable to open lightbox) === */}
        <div className="relative flex min-h-[32vh] w-full items-start justify-center px-4 pb-4 pt-2 md:min-h-[48vh]">
          {isVideo ? (
            <DetailVideo
              key={`${image.id}:${heroSeed?.createdAt ?? 0}`}
              imageId={image.id}
              previewSrc={heroSeed?.previewSrc}
              previewKind={heroSeed?.mediaType}
              finalSrc={detailVideoSrc}
              alt={image.name || `Video ${image.id}`}
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
              alt={image.name || `Image ${image.id}`}
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
          className="image-detail-deferred flex min-h-[80dvh] flex-col bg-transparent p-4 sm:p-6"
          // Isolate deferred body paint so late mount cannot blank the gallery
          // compositor layer under the overlay (mid-scroll "background vanished").
           style={{ contentVisibility: 'visible', contain: 'none' }}
        >
          <div className="max-w-5xl mx-auto w-full space-y-6">

            {/* Votes */}
            {!prefetchedDetail ? (
              <div
                aria-hidden="true"
                data-image-detail-score-loading
                className="mb-6 animate-pulse"
              >
                <div className="mb-2 flex justify-between">
                  <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                  <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="h-2.5 w-full rounded-full bg-slate-200 dark:bg-slate-700" />
              </div>
            ) : image.upvotes !== undefined && image.downvotes !== undefined && (
              <div className="mb-6">
                <div className="flex justify-between text-sm font-medium mb-1.5">
                  <span className="text-green-600 flex items-center gap-1">
                    <MdStar size={16} /> {image.upvotes}
                  </span>
                  <span className="text-red-500 flex items-center gap-1">
                    {image.downvotes} <MdStar size={16} />
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
                  {image.upvotes === 0 && image.downvotes === 0 ? (
                    <div className="bg-slate-300 dark:bg-slate-700 h-full w-full" />
                  ) : (
                    <>
                      <div
                        className="bg-green-500 h-full transition-all duration-500"
                        style={{ width: `${(image.upvotes / (image.upvotes + image.downvotes)) * 100}%` }}
                      />
                      <div
                        className="bg-red-500 h-full transition-all duration-500"
                        style={{ width: `${(image.downvotes / (image.upvotes + image.downvotes)) * 100}%` }}
                      />
                    </>
                  )}
                </div>
              </div>
            )}

            {deferredBodyReady && (
            <>
            {/* Action buttons */}
            <div className="flex items-center justify-center gap-3 mb-2">
              {/* Navigation */}
              {navHistory.length > 0 && (
                <>
                  <button
                    onClick={() => handleNavigate(-1)}
                    disabled={currentNavIndex <= 0}
                    title="上一张 (←)"
                    className="p-2.5 rounded-full transition-colors duration-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MdChevronLeft size={20} />
                  </button>
                  <button
                    onClick={() => handleNavigate(1)}
                    disabled={currentNavIndex >= navHistory.length - 1}
                    title="下一张 (→)"
                    className="p-2.5 rounded-full transition-colors duration-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <MdChevronRight size={20} />
                  </button>
                </>
              )}

              <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />

              <button
                onClick={handleToggleFave}
                disabled={isFaveLoading}
                title={isFaved ? '取消收藏' : '收藏'}
                className={`p-2.5 rounded-full transition-colors duration-200 ${
                  isFaved
                    ? 'text-yellow-600 border border-yellow-300 bg-yellow-50 hover:bg-yellow-100 dark:text-yellow-400 dark:border-yellow-700 dark:bg-yellow-900/20 dark:hover:bg-yellow-900/30'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-700'
                } disabled:opacity-50`}
              >
                {isFaveLoading ? (
                  <Spinner size="sm" />
                ) : isFaved ? (
                  <MdStar size={20} />
                ) : (
                  <MdStarBorder size={20} />
                )}
              </button>
              <div className="relative">
                <button
                  onClick={() => setIsShareOpen(!isShareOpen)}
                  title="分享"
                  className="p-2.5 rounded-full transition-colors duration-200 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-300 dark:hover:bg-slate-700"
                >
                  <MdShare size={20} />
                </button>
                {isShareOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsShareOpen(false)} />
                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-40 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 py-1 z-20 animate-fade-in">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(window.location.href);
                          showToast('链接已复制', 'success');
                          setIsShareOpen(false);
                        }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                      >
                        <MdContentCopy size={16} />
                        复制链接
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setIsReportModalOpen(true)}
                title="举报"
                className="p-2.5 rounded-full transition-colors duration-200 text-red-400 hover:text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30"
              >
                <MdFlag size={20} />
              </button>
            </div>

            {/* Description */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">简介</h3>
              {image.description ? (
                image.description.length > 100 || (image.description.match(/\n/g) || []).length >= 3 ? (
                  <div
                    className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-colors"
                    onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  >
                    <p className={`text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words ${!isDescriptionExpanded ? 'line-clamp-3' : ''}`}>
                      {image.description}
                    </p>
                    <div className="text-sm text-primary mt-2 font-medium text-center">
                      {isDescriptionExpanded ? '折叠简介' : '展开简介'}
                    </div>
                  </div>
                ) : (
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                    {image.description}
                  </p>
                )
              ) : (
                <p className="text-slate-400 italic bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">滚木</p>
              )}
            </div>

            {/* Source URL */}
            {image.source_url && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">来源</h3>
                <a
                  href={image.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-blue-600 hover:text-blue-800 break-all"
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
              imageId={imageId}
              onTagClick={handleTagClick}
              onShowMore={setVisibleTags}
            />

            {/* Action buttons */}
            <div className="pt-6 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleDownload}
                className="flex-1 px-2 py-1.5 rounded-xl font-medium text-base leading-relaxed bg-primary text-white shadow-sm hover:bg-[#555555] hover:shadow-md transition-all flex items-center justify-center gap-2"
              >
                <MdDownload size={22} />
                下载原图
              </button>
              <a
                href={`https://trixiebooru.org/${image.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-2 py-1.5 rounded-xl font-medium text-base leading-relaxed bg-[var(--sidebar-hover)] text-[var(--sidebar-text)] border border-gray-500/20 hover:opacity-80 transition-all flex items-center justify-center gap-2"
              >
                <MdOpenInNew size={20} />
                在 Derpibooru 查看
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
          'Close': '关闭 (Esc)',
          'Download': '下载',
          'Zoom in': '放大',
          'Zoom out': '缩小',
          'Enter Fullscreen': '全屏',
          'Exit Fullscreen': '退出全屏',
        }}
        carousel={{
          finite: true,
        }}
        download={{
          download: ({ slide, saveAs }) => {
            const s = slide as unknown as Record<string, unknown>;
            const dl = s.download;
            if (dl && typeof dl === 'object' && 'url' in dl) {
              saveAs((dl as { url: string; filename?: string }).url, (dl as { url: string; filename?: string }).filename);
            } else if (typeof s.src === 'string') {
              saveAs(s.src);
            }
          }
        }}
      />
      )}

      {/* ========== Tag Info Modal ========== */}
      <Modal
        isOpen={tagInfoModal.open}
        onClose={() => setTagInfoModal({ open: false, tag: '', data: null, loading: false })}
        title={tagInfoModal.tag}
        maxWidth="max-w-md"
        zIndex={9998}
      >
        {tagInfoModal.loading ? (
          <Spinner label="查询词库中..." className="py-8" />
        ) : tagInfoModal.data ? (
          <div className="space-y-3">
            {tagInfoModal.data.cn && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wider">中文翻译</span>
                <p className="text-slate-700 dark:text-slate-300 mt-1 font-medium">{tagInfoModal.data.cn}</p>
              </div>
            )}
            {tagInfoModal.data.description && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wider">标签简介</span>
                <p className="text-slate-600 dark:text-slate-400 mt-1 text-sm">{tagInfoModal.data.description}</p>
              </div>
            )}
            {tagInfoModal.data.cat && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wider">分类</span>
                <p className="text-slate-600 dark:text-slate-400 mt-1 text-sm">{tagInfoModal.data.cat}</p>
              </div>
            )}
            {tagInfoModal.data.aliases && tagInfoModal.data.aliases.length > 0 && (
              <div>
                <span className="text-xs text-slate-400 uppercase tracking-wider">别名</span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {tagInfoModal.data.aliases.map((alias, i) => (
                    <span key={i} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-xs rounded">{alias}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-6 text-slate-500 dark:text-slate-400">
            <p>词库中暂无此标签的详细信息</p>
            <p className="text-xs mt-2">登录后可以查询更多标签信息</p>
          </div>
        )}
        <div className="flex gap-3 mt-4">
          <button
            onClick={() => { router.push(`/search?q=${encodeURIComponent(tagInfoModal.tag)}`); setTagInfoModal(prev => ({ ...prev, open: false })); }}
            className="flex-1 px-3 py-2 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
          >
            搜索此标签
          </button>
        </div>
      </Modal>

      {/* ========== Report Modal ========== */}
      <Modal
        isOpen={isReportModalOpen}
        onClose={() => { if (!isReporting) { setIsReportModalOpen(false); setReportReason(''); } }}
        title="举报图片"
        zIndex={100}
        closeOnOverlayClick={!isReporting}
        footer={
          <>
            <button onClick={() => { setIsReportModalOpen(false); setReportReason(''); }} disabled={isReporting}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">取消</button>
            <button onClick={handleReport} disabled={isReporting || !reportReason.trim()}
              className="px-4 py-2 text-sm text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50">
              {isReporting ? '提交中...' : '提交举报'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          请描述违规原因，管理员将会审核处理。
        </p>
        <textarea
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="请详细描述违规原因..."
          rows={4}
          disabled={isReporting}
          className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none resize-none text-sm"
        />
      </Modal>
    </div>
  );
}
