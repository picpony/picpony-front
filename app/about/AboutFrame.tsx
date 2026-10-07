'use client';

import type { ReactNode } from 'react';
import Card from '@/components/Card';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import SectionHeading from '@/components/SectionHeading';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import { useBackOrParent } from '@/lib/backNavigation';
import { useEscapeBack } from '@/lib/hooks';

/**
 * /about's frame — everything on the page that does not wait for anything: the back affordance,
 * the title, the plate's block, the introduction and the team card's own surface. The page fills
 * it (`AboutContent`: the glass, the wordmark, the roster) and so does its route's loading state
 * (`loading.tsx`, while the server reads the roster), so the two are one shape and the page lands
 * without moving, with its way back on screen throughout (G4-024).
 *
 * Reachable only from the footer, so not a sidebar destination — it carries the shared back
 * affordance (see AGENTS.md).
 */
export default function AboutFrame({ plate, team }: { plate?: ReactNode; team: ReactNode }) {
  const handleBack = useBackOrParent('/');
  useEscapeBack(handleBack);

  return (
    <>
      <PageBack onClick={handleBack} />
      <div className="page-back-room mx-auto max-w-4xl">
        <PageHeader title="关于本站" />

        {/* The plate is a large media block in the page's column, on the media corner (28dp),
            as a profile's banner sits in its own (D1-017). It used to bleed to the content
            area's edges and could not reach them: the scroller reserves its scrollbar gutter on
            both edges, outside the box its content paints into, so wherever a classic scrollbar
            is drawn the band stopped 10px short of the surface on either side, square-cut.

            A floor rather than a fixed height — the glass is a material, not a picture, and
            may grow. 288/384px: the reeds are sized off the height (`FluteConfig.frequency`),
            so a step moves their pitch too.

            `bg-glass-body` is the plate's own colour, not a surface step: what shows if
            WebGL is unavailable — or before the page has drawn it — is the material at rest,
            not a differently toned rectangle. */}
        <div className="relative mt-2 flex min-h-72 items-center justify-center overflow-hidden rounded-2xl bg-glass-body sm:min-h-96">
          {plate}
        </div>

        <Card variant="filled" padding="lg" className="mt-8">
          <SectionHeading className="mb-3">关于 PicPony</SectionHeading>
          <p className="text-body-m text-on-surface-variant">一个看图的网站，没了</p>
        </Card>

        {team}
      </div>
    </>
  );
}

/** 运营团队's surface and heading; the roster, its placeholder or its failure goes inside. */
export function TeamCard({ children }: { children: ReactNode }) {
  return (
    <Card variant="filled" padding="lg" className="mt-4">
      <SectionHeading>运营团队</SectionHeading>
      {children}
    </Card>
  );
}

/**
 * The roster's cells: a grid that shares the card's width (D1-008). Fixed 176px cells in a
 * wrapping row cut names at 92px of text and left up to a third of the card empty beside them;
 * on a phone they were one person per 92px row. Two columns there, and from `sm` as many 13rem
 * columns as fit, every one as wide as the card allows.
 */
export const ROSTER_GRID = 'grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] sm:gap-x-4 sm:gap-y-2';

/**
 * The roster's placeholder in the loaded state's own shape: group headings over the same grid of
 * member cells. A flat row with a different gap and no headings made the list re-space and grow
 * two heading rows when data landed.
 */
export function TeamSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      {[0, 1].map((g) => (
        <div key={g}>
          <Skeleton className="mb-3 h-5 w-20" delay={g * 120} />
          <div className={ROSTER_GRID}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex min-w-0 items-center gap-3 p-2">
                <SkeletonCircle size={48} delay={g * 120 + i * 80} />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-16 max-w-full" delay={g * 120 + i * 80 + 40} />
                  <Skeleton className="h-3 w-20 max-w-full" delay={g * 120 + i * 80 + 80} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
