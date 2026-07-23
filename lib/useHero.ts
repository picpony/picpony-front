'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import type Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PonyImage } from '@/lib/types/image';
import {
  cancelImageDetailPrefetch,
} from '@/lib/detail';
import {
  canAnimateImageHero,
  canSupersedeImageHeroClose,
  canUseImageHeroTransition,
  collapseSupersededImageHeroHistory,
  getActiveImageHeroKind,
  getImageHeroBackgroundLocation,
  interruptImageHero,
  navigateToImageWithHero,
  prepareImageHero,
  queueImageHeroOpen,
  warmImageHeroFrame,
  warmImageHero,
  type ImageHeroSnapshot,
} from '@/lib/hero';

type HeroLinkKind = 'card' | 'featured';
type NavigateHandler = NonNullable<ComponentProps<typeof Link>['onNavigate']>;
const HOVER_INTENT_DELAY = 70;
const FOCUS_INTENT_DELAY = 120;

export function useHeroLink<T extends HTMLElement>({
  image,
  sourceRef,
  previewSrc,
  canAnimate,
  kind,
}: {
  image: PonyImage | null;
  sourceRef: RefObject<T | null>;
  previewSrc: string;
  canAnimate: boolean;
  kind: HeroLinkKind;
}) {
  const router = useRouter();
  const preparedRef = useRef<ImageHeroSnapshot | null>(null);
  const lastActivationRef = useRef<{ imageId: number; at: number } | null>(null);
  const expiryTimerRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const cancelFrameWarmRef = useRef<(() => void) | null>(null);
  const href = image ? `/pic/${image.id}` : '#';

  const clearPrepared = useCallback(() => {
    if (expiryTimerRef.current !== null) {
      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    preparedRef.current = null;
  }, []);

  const cancelHoverIntent = useCallback((cancelDetail = false) => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    cancelFrameWarmRef.current?.();
    cancelFrameWarmRef.current = null;
    if (cancelDetail && image) cancelImageDetailPrefetch(image.id);
  }, [image]);

  const warmFrame = useCallback(() => {
    cancelFrameWarmRef.current?.();
    cancelFrameWarmRef.current = warmImageHeroFrame(sourceRef.current);
  }, [sourceRef]);

  const warmImmediately = useCallback(() => {
    if (!image) return;
    const lastActivation = lastActivationRef.current;
    const timestamp = Date.now();
    if (lastActivation?.imageId === image.id && timestamp - lastActivation.at < 1500) return;
    lastActivationRef.current = { imageId: image.id, at: timestamp };
    cancelHoverIntent();
    router.prefetch(href);
    void warmImageHero(image.id);
  }, [cancelHoverIntent, href, image, router]);

  const scheduleIntentWarm = useCallback((delay = HOVER_INTENT_DELAY) => {
    if (!image || hoverTimerRef.current !== null) return;
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      router.prefetch(href);
      void warmImageHero(image.id, 'background');
      warmFrame();
    }, delay);
  }, [href, image, router, warmFrame]);

  const prepare = useCallback(() => {
    // A closing transition leaves the gallery mounted and measurable, so a
    // new card can prepare its frame for a true visual preempt. Opening clicks
    // use the capture-phase interrupt/replay path instead.
    if (!image || getActiveImageHeroKind() === 'opening') return null;
    const prepared = preparedRef.current;
    if (prepared && Date.now() - prepared.createdAt < 1500) return prepared;

    clearPrepared();
    cancelFrameWarmRef.current?.();
    cancelFrameWarmRef.current = null;
    const next = prepareImageHero(
      image,
      sourceRef.current,
      canAnimate,
      previewSrc,
    );
    preparedRef.current = next;
    if (next) {
      expiryTimerRef.current = window.setTimeout(() => {
        if (preparedRef.current === next) preparedRef.current = null;
        expiryTimerRef.current = null;
      }, 1600);
    }
    return next;
  }, [canAnimate, clearPrepared, image, previewSrc, sourceRef]);

  const takePrepared = useCallback(() => {
    const prepared = preparedRef.current;
    clearPrepared();
    return prepared && Date.now() - prepared.createdAt < 1500
      ? prepared
      : prepare();
  }, [clearPrepared, prepare]);

  const startHeroOpen = useCallback((snapshot: ImageHeroSnapshot, preempt: 'none' | 'over-close') => {
    const source = sourceRef.current;
    if (!source) return;
    if (preempt === 'over-close') {
      // Fly immediately, parallel with the fading close. Collapse the closing
      // detail's history back to the gallery, then install this open on top;
      // continue the gallery background's motion into this open's sink.
      const backgroundLocation = getImageHeroBackgroundLocation() ?? undefined;
      const galleryHref = backgroundLocation
        ? `${backgroundLocation.pathname}${backgroundLocation.search}`
        : `${window.location.pathname}${window.location.search}`;
      void navigateToImageWithHero(
        snapshot,
        source,
        async (isCurrent) => {
          const collapsed = await collapseSupersededImageHeroHistory();
          if (!isCurrent()) return;
          if (!collapsed) {
            // `history.go()` should always dispatch popstate; this branch is a
            // containment fallback for embedded browsers that do not. Prefer
            // completing the requested navigation over leaving the UI stuck.
            router.replace(href, { scroll: false });
            return;
          }
          window.history.pushState(
            { ...window.history.state, picponyHero: href },
            '',
            galleryHref,
          );
          router.replace(href, { scroll: false });
        },
        (navigationHandled) => {
          if (!navigationHandled) window.history.back();
        },
        { detailHref: href, backgroundLocation, background: 'continue' },
      );
      return;
    }
    const originHref = `${window.location.pathname}${window.location.search}`;
    void navigateToImageWithHero(
      snapshot,
      source,
      () => {
        window.history.pushState(
          { ...window.history.state, picponyHero: href },
          '',
          originHref,
        );
        router.replace(href, { scroll: false });
      },
      (navigationHandled) => {
        if (!navigationHandled) window.history.back();
      },
      { detailHref: href },
    );
  }, [href, router, sourceRef]);

  const queueHeroOpen = useCallback((prepared?: ImageHeroSnapshot | null) => {
    const targetImage = image;
    queueImageHeroOpen(() => {
      const source = sourceRef.current;
      if (!targetImage || !source || !source.isConnected) {
        router.push(href, { scroll: false });
        return;
      }
      const queued = prepared && Date.now() - prepared.createdAt < 1500
        ? prepared
        : prepareImageHero(targetImage, source, canAnimate, previewSrc);
      if (queued && canUseImageHeroTransition(queued)) {
        startHeroOpen(queued, 'none');
      } else {
        router.push(href, { scroll: false });
      }
    });
  }, [canAnimate, href, image, previewSrc, router, sourceRef, startHeroOpen]);

  const handleNavigate: NavigateHandler = useCallback((event) => {
    if (!image) return;
    const activeKind = getActiveImageHeroKind();

    if (activeKind === 'opening') {
      // The full-screen Stage is pointer-transparent. Its capture-phase click
      // guard normally reverses A and replays B; keep the same safe behaviour
      // for keyboard/programmatic Link activation that reaches onNavigate.
      event.preventDefault();
      queueHeroOpen();
      interruptImageHero();
      return;
    }

    if (activeKind === 'closing') {
      // Latest wins: fly this open immediately, parallel with the fading close.
      event.preventDefault();
      const snapshot = takePrepared();
      const source = sourceRef.current;
      if (
        canSupersedeImageHeroClose() &&
        snapshot &&
        source &&
        canAnimateImageHero(snapshot)
      ) {
        startHeroOpen(snapshot, 'over-close');
      } else {
        // The flyer may already have committed its history traversal. Queue the
        // latest click until the gallery is idle instead of issuing a second
        // traversal into the same guard/base pair.
        queueHeroOpen(snapshot);
      }
      return;
    }

    const snapshot = takePrepared();
    const source = sourceRef.current;
    if (!snapshot || !source || !canUseImageHeroTransition(snapshot)) return;
    event.preventDefault();
    startHeroOpen(snapshot, 'none');
  }, [image, queueHeroOpen, sourceRef, startHeroOpen, takePrepared]);

  useEffect(() => {
    return () => {
      clearPrepared();
      cancelHoverIntent(true);
    };
  }, [cancelHoverIntent, clearPrepared]);

  return {
    href,
    sourceKey: image ? `${kind}:${image.id}` : '',
    prefetch: false as const,
    scroll: false as const,
    onPointerEnter: () => scheduleIntentWarm(),
    onPointerLeave: () => cancelHoverIntent(true),
    onPointerDown: (event: PointerEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        scheduleIntentWarm();
        return;
      }
      // Pointerdown also starts a native scroll gesture. Preparing here performs
      // a synchronous canvas capture and router prefetch before we know whether
      // this is a click or a swipe. Hover/focus intent still warms desktop
      // targets, while click/onNavigate prepares the snapshot once activation
      // is confirmed for every input type.
      return;
    },
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      warmImmediately();
      prepare();
    },
    onFocus: () => scheduleIntentWarm(FOCUS_INTENT_DELAY),
    onBlur: () => cancelHoverIntent(true),
    onNavigate: handleNavigate,
  };
}
