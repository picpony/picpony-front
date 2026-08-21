'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import DetailHeader from '@/components/DetailHeader';
import DetailBack from '@/components/DetailBack';
import { getHeroMediaStyle } from '@/lib/hero/geometry';
import Skeleton from '@/components/Skeleton';
import {
  getImageHeroStage,
  interruptImageHero,
  observeImageHeroClientNavigation,
  registerImageHeroStage,
  subscribeImageHeroStage,
  type ImageHeroStageState,
} from '@/lib/hero';

const EMPTY_STAGE: ImageHeroStageState = { phase: 'idle', snapshot: null, sessionId: null };

function getServerStage() {
  return EMPTY_STAGE;
}

export default function HeroStage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const state = useSyncExternalStore(subscribeImageHeroStage, getImageHeroStage, getServerStage);
  const overlayRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const sessionId = state.sessionId;

  useEffect(() => {
    observeImageHeroClientNavigation(`${pathname}${search ? `?${search}` : ''}`);
  }, [pathname, search]);

  // The routed detail component may not have committed yet while an opening
  // flight is visible. Keep Escape owned by the mounted Stage so it reverses
  // the active session instead of falling through to browser navigation.
  useEffect(() => {
    if (sessionId === null || state.phase === 'idle') return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (!interruptImageHero()) return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sessionId, state.phase]);

  useLayoutEffect(() => {
    if (sessionId === null) return;
    const overlay = overlayRef.current;
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    const surface = surfaceRef.current;
    const target = targetRef.current;
    const anchor = anchorRef.current;
    if (!overlay || !scroller || !content || !surface || !target || !anchor) return;
    return registerImageHeroStage(sessionId, {
      overlay,
      scroller,
      content,
      surface,
      target,
      anchor,
      floatingBack: backRef.current,
    });
  }, [sessionId]);

  const forwardOpeningCardClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (state.phase !== 'opening' || event.defaultPrevented) return;
      const overlay = overlayRef.current;
      if (!overlay) return;
      for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
        const card = element.closest<HTMLAnchorElement>('a.image-hero-card-link');
        if (!card || overlay.contains(card)) continue;
        const thumbnail = card.querySelector<HTMLElement>('[data-image-hero-role="thumbnail"]');
        if (!thumbnail || Number(thumbnail.dataset.imageHeroId) === state.snapshot?.image.id)
          return;
        event.preventDefault();
        event.stopPropagation();
        card.click();
        return;
      }
    },
    [state.phase, state.snapshot?.image.id],
  );

  const snapshot = state.snapshot;
  if (state.phase === 'idle' || !snapshot) return null;
  // The stage is the geometry contract for the flight: it stays bound to the
  // click-time snapshot so a late title or metadata update cannot move the
  // landing target below the flyer. The real route receives the richer image
  // after the atomic handoff.
  const image = snapshot.image;

  return (
    <>
      <section
        ref={overlayRef}
        data-image-detail-overlay
        data-image-hero-stage
        data-image-hero-stage-state={state.phase}
        aria-hidden="true"
        className="pointer-events-auto absolute inset-0 z-hero-stage overflow-hidden"
      >
        <div
          ref={surfaceRef}
          data-image-detail-surface
          className="pointer-events-none absolute inset-0 bg-surface"
        />
        <div
          ref={scrollerRef}
          data-image-hero-stage-foreground
          data-image-hero-stage-scroll
          aria-hidden="true"
          className="image-detail-overlay-scroll main-scrollbar pointer-events-auto absolute inset-0 z-10 overflow-y-auto overscroll-contain touch-pan-y"
          onClick={forwardOpeningCardClick}
        >
          <div
            ref={contentRef}
            inert
            className="image-detail-overlay-content pointer-events-none relative min-h-full w-full"
          >
            {/* The container transform's fit target — see HERO_CONTENT_SELECTOR. */}
            <div data-image-detail-scale className="w-full origin-top-left">
            <div className="image-detail-page mx-auto max-w-5xl px-2 sm:px-4">
              <div className="flex flex-col rounded-md bg-transparent">
                <DetailHeader key={image.id} image={image} layout="stage" metadataReady={false} />
                <div className="relative flex min-h-[32dvh] w-full items-start justify-center px-4 pb-4 pt-2 sm:px-6 md:min-h-[48dvh]">
                  {/* The landing target is an ordinary in-flow flex item, because the routed
                      `DetailImage` is one too and the two must measure identically. It used
                      to be a second box inside `absolute inset-x-4`, so its
                      `width: min(100%, …)` resolved against a containing block 16px narrower
                      per side than the well's content box — the flyer landed 16px wider than
                      the picture it handed off to and snapped in on arrival. */}
                  <div
                    ref={targetRef}
                    data-image-hero-stage-target
                    data-image-hero-stage-id={image.id}
                    aria-hidden="true"
                    className="invisible relative flex-none overflow-hidden rounded-lg"
                    style={getHeroMediaStyle(image)}
                  />
                </div>
                <div
                  data-image-detail-reveal="body"
                  className="image-detail-stage-body bg-transparent p-4 sm:p-6"
                >
                  <div className="mx-auto w-full max-w-5xl">
                    <div aria-hidden="true" className="mb-6">
                      <div className="mb-1.5 flex justify-between">
                        <Skeleton className="h-4 w-14" />
                        <Skeleton className="h-4 w-14" delay={60} />
                      </div>
                      {/* 4dp, matching the routed vote track. The Stage and the route
                          must measure identically or the handoff shifts, and this was
                          `h-2.5` against a `h-1` bar. */}
                      <Skeleton className="h-1 w-full" delay={120} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
          <div
            ref={anchorRef}
            data-image-hero-stage-anchor
            aria-hidden="true"
            className="image-hero-stage-anchor"
          />
        </div>
      </section>
      {/* `passive`, which is what the prop was added for and what no call site had ever
          passed: while the Stage's copy rides along, the routed one is mounted too, so
          without it the app had two focusable 返回图片列表 buttons in the tab order and
          two in the accessibility tree.
          No `data-image-detail-reveal` here. Both back buttons carried `chrome`, and it
          was dead on both: the cascade is `overlay.querySelectorAll(...)` and these render
          as *siblings* of the overlay. The entrance comes from the `floatingBack` branch
          in `buildOverlayAnimations`, and the pull gesture reaches it through a compound
          selector on the element itself rather than a descendant one. */}
      <DetailBack
        ref={backRef}
        passive
        data-image-detail-back-button
        data-image-detail-floating-back="stage"
        data-image-hero-stage-back
        data-image-hero-stage-foreground
        onClick={() => {
          interruptImageHero();
        }}
        className="image-detail-back"
      />
    </>
  );
}
