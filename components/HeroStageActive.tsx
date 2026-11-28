'use client';

import { useLayoutEffect, useRef } from 'react';
import DetailHeader from '@/components/DetailHeader';
import DetailBack from '@/components/DetailBack';
import { getHeroMediaStyle } from '@/lib/hero/mediaBox';
import DetailActions from '@/components/detail/DetailActions';
import DetailTagSkeleton from '@/components/detail/DetailTagSections';
import DetailVotes from '@/components/detail/DetailVotes';
import { completeDetailRow } from '@/lib/detailRow';
import { interruptImageHero, registerImageHeroStage } from '@/lib/hero/runtime';
import type { ImageHeroSnapshot, ImageHeroStageState } from '@/lib/hero/types';

export interface HeroStageActiveProps {
  phase: Exclude<ImageHeroStageState['phase'], 'idle'>;
  snapshot: ImageHeroSnapshot;
  sessionId: number | null;
}

/**
 * The active Hero Stage surface, dynamically imported by `HeroStage` so routes that never open a
 * picture do not pay for `DetailHeader`/`DetailBack`/`DetailActions`/`DetailVotes` in their first
 * document. Warmed on gallery mount after first paint and on card pointer/focus intent so arming
 * and opening render synchronously with zero frame delay.
 */
export default function HeroStageActive({ phase, snapshot, sessionId }: HeroStageActiveProps) {
  const overlayRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const fixedAnchorRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

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
      fixedAnchor: fixedAnchorRef.current,
      floatingBack: backRef.current,
    });
  }, [sessionId]);

  // The stage is the geometry contract for the flight: it stays bound to the
  // click-time snapshot so a late title or metadata update cannot move the
  // landing target below the flyer. The real route receives the richer image
  // after the atomic handoff.
  const image = snapshot.image;
  /* The card's row, when it already is the full record (a Derpibooru list row is). */
  const record = completeDetailRow(image);

  return (
    <>
      {/* Before the overlay in the DOM: a Stage copy after the section was the last node of the
          flight's surface (the routed copy is the first element of its dialog now, so it is the
          first Tab stop — R10-008). Positioned, so the order changes nothing on screen.
          `passive`: while the Stage's copy rides along, the routed one is mounted too — it
          never takes focus, is out of the accessibility tree, and takes no ripple. No
          `data-image-detail-reveal` on either copy: the cascade never reaches them. Their
          entrance is the `floatingBack` branch in `buildOverlayAnimations`, and the pull
          gesture reaches them through a compound selector on the element itself. */}
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
      <section
        ref={overlayRef}
        data-image-detail-overlay
        data-image-hero-stage
        data-image-hero-stage-state={phase}
        aria-hidden="true"
        className="pointer-events-auto absolute inset-0 z-hero-stage overflow-hidden"
      >
        {/* The container transform's window, and the counter-scale that makes
            the content's accumulated transform uniform. Inert until
            `buildContainerAnimations` drives them — and neither may ever hold a
            resting transform: a transform is a containing block for
            fixed-position descendants. Both boxes are `absolute inset-0`, so
            inserting them changes no geometry; the route's shell must stay
            structurally identical to this. */}
        <div data-image-detail-clip className="image-detail-clip absolute inset-0">
          <div data-image-detail-unclip className="image-detail-unclip absolute inset-0">
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
            >
              <div
                ref={contentRef}
                inert
                className="image-detail-overlay-content pointer-events-none relative min-h-full w-full"
              >
                {/* The container transform's cross-fade block — see HERO_CONTENT_SELECTOR. */}
                <div data-image-detail-crossfade className="w-full">
                  <div className="image-detail-page mx-auto max-w-5xl px-2 sm:px-4">
                    <div className="image-detail-shell flex flex-col rounded-md bg-transparent">
                      <DetailHeader key={image.id} image={image} layout="stage" pending={record === null} />
                      <div
                        data-image-detail-media-pane
                        className="image-detail-media-pane relative flex w-full items-start justify-center px-4 pb-4 pt-2 sm:px-6"
                      >
                        {/* The landing target is an ordinary in-flow flex item, because
                      the routed `DetailImage` is one too and the two must measure
                      identically — a second box inside an absolutely-positioned
                      wrapper resolved its width against a containing block 16px
                      narrower per side, and the flyer landed wide and snapped in. */}
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
                        className="image-detail-body image-detail-stage-body bg-transparent p-4 sm:p-6"
                      >
                        <div className="image-detail-body-inner mx-auto flex w-full max-w-5xl flex-col gap-5">
                          <DetailActions
                            imageId={image.id}
                            passive
                            canTranslate={Boolean(image.view_url) && snapshot.mediaType !== 'video'}
                            center={<DetailVotes image={record} pending={record === null} />}
                          />
                          <DetailTagSkeleton />
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
            {/* Non-scrolling plane inside `[data-image-detail-unclip]` for sticky split targets:
                sits outside the scroller so scrolling the right feed mid-flight never drags the
                flyer off the stationary left pane. */}
            <div
              ref={fixedAnchorRef}
              data-image-hero-fixed-anchor
              aria-hidden="true"
              className="image-hero-stage-anchor"
            />
          </div>
        </div>
      </section>
    </>
  );
}
