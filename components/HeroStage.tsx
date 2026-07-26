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
  const state = useSyncExternalStore(
    subscribeImageHeroStage,
    getImageHeroStage,
    getServerStage,
  );
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

  const forwardOpeningCardClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (state.phase !== 'opening' || event.defaultPrevented) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    for (const element of document.elementsFromPoint(event.clientX, event.clientY)) {
      const card = element.closest<HTMLAnchorElement>('a.image-hero-card-link');
      if (!card || overlay.contains(card)) continue;
      const thumbnail = card.querySelector<HTMLElement>('[data-image-hero-role="thumbnail"]');
      if (!thumbnail || Number(thumbnail.dataset.imageHeroId) === state.snapshot?.image.id) return;
      event.preventDefault();
      event.stopPropagation();
      card.click();
      return;
    }
  }, [state.phase, state.snapshot?.image.id]);

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
      className="pointer-events-auto absolute inset-0 z-[44] overflow-hidden"
    >
      <div ref={surfaceRef} data-image-detail-surface className="pointer-events-none absolute inset-0 bg-white dark:bg-slate-950" />
      <div
        ref={scrollerRef}
        data-image-hero-stage-foreground
        data-image-hero-stage-scroll
        aria-hidden="true"
        className="image-detail-overlay-scroll pointer-events-auto absolute inset-0 z-10 overflow-y-auto overscroll-contain touch-pan-y"
        onClick={forwardOpeningCardClick}
      >
        <div
          ref={contentRef}
          inert
          className="image-detail-overlay-content pointer-events-none relative min-h-full w-full"
        >
          <div className="image-detail-page mx-auto max-w-7xl px-2 sm:px-4">
            <div className="flex flex-col rounded-xl bg-transparent">
              <DetailHeader key={image.id} image={image} layout="stage" metadataReady={false} />
              <div className="relative flex min-h-[32vh] w-full items-start justify-center px-4 pb-4 pt-2 md:min-h-[48vh]">
                <div
                  className="pointer-events-none absolute inset-x-4 top-2 z-20 flex justify-center"
                >
                  <div
                    ref={targetRef}
                    data-image-hero-stage-target
                    data-image-hero-stage-id={image.id}
                    className="invisible relative flex-none overflow-hidden rounded-lg"
                    style={getHeroMediaStyle(image)}
                  >
                  </div>
                </div>
                <div
                  aria-hidden="true"
                  className="invisible flex-none"
                  style={getHeroMediaStyle(image)}
                />
              </div>
              <div
                data-image-detail-reveal="body"
                className="image-detail-stage-body bg-transparent p-4 sm:p-6"
              >
                <div className="mx-auto w-full max-w-5xl">
                  <div aria-hidden="true" className="mb-6 animate-pulse">
                    <div className="mb-2 flex justify-between">
                      <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                      <span className="h-4 w-14 rounded bg-slate-200 dark:bg-slate-700" />
                    </div>
                    <div className="h-2.5 w-full rounded bg-slate-200 dark:bg-slate-700" />
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
    <DetailBack
      ref={backRef}
      data-image-detail-back-button
      data-image-detail-floating-back="stage"
      data-image-detail-reveal="chrome"
      data-image-hero-stage-back
      data-image-hero-stage-foreground
      onClick={() => { interruptImageHero(); }}
      className="pointer-events-auto absolute left-3 top-3 z-[46] sm:left-4 sm:top-4"
    />
    </>
  );
}
