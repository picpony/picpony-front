'use client';

import type { ReactNode } from 'react';
import Card from '@/components/Card';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import SectionHeading from '@/components/SectionHeading';
import { PageLoadingIndicator } from '@/components/LoadingIndicator';
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
 * affordance (docs/transitions.md#back-and-focus).
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
        <div className="forced-boundary relative flex min-h-72 items-center justify-center overflow-hidden rounded-2xl bg-glass-body sm:min-h-96">
          {plate}
        </div>

        <Card variant="elevated" padding="lg" className="mt-6">
          <p className="text-body-m text-on-surface-variant">一个看图的网站<br />其中 114514 行代码由 AK 生成</p>
        </Card>

        {team}
      </div>
    </>
  );
}

/** 运营团队's surface and heading; the roster, its placeholder or its failure goes inside. */
export function TeamCard({ children }: { children: ReactNode }) {
  return (
    <Card variant="filled" padding="lg" className="@container/roster mt-4">
      <SectionHeading>运营团队</SectionHeading>
      {children}
    </Card>
  );
}

/**
 * The roster's cells: a grid that shares the card's width (D1-008). Single column below `26rem`
 * so 320–390px phones never crush member names next to the 48px avatar and trailing chevron;
 * from `26rem` up, as many `13rem` columns as fit the card's container width.
 */
export const ROSTER_GRID =
  'grid grid-cols-1 gap-y-1 @[26rem]/roster:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] @[26rem]/roster:gap-x-4 @[26rem]/roster:gap-y-2';

/** Placeholder while dynamic team roster groups and member counts are loading. */
export function TeamSkeleton() {
  return <PageLoadingIndicator size="pane" indicatorSize="md" label="正在加载团队成员…" className="min-h-48" />;
}
