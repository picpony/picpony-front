'use client';

import AboutFrame, { TeamCard, TeamSkeleton } from './AboutFrame';

/**
 * /about while its server reads the team roster (`page.tsx`, up to its 2.5s cap): the page itself,
 * less what waits — the glass and the wordmark on the plate, the roster in its card. The shared
 * route fallback stood a generic silhouette in its place with no way back (G4-024); this is the
 * page's own frame, so its back affordance is there from the first frame and nothing moves when
 * the roster lands.
 *
 * `data-page-loading` on the roster's placeholder holds the footer back until the real list's
 * length is known.
 */
export default function AboutLoading() {
  return (
    <>
      <div role="status" className="sr-only">加载中…</div>
      <AboutFrame
        team={
          <TeamCard>
            <div data-page-loading>
              <TeamSkeleton />
            </div>
          </TeamCard>
        }
      />
    </>
  );
}
