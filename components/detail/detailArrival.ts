'use client';

import { entranceMotion, motionTier, scaledMs } from '@/lib/appearance';
import { STAGGER, TRAVEL_PX } from '@/lib/motionTokens';
import { surfaceArrival } from '@/lib/springTiming';

/**
 * **Content that reaches an open detail after the picture has landed arrives as content does in
 * M3** — each block fading in on the default effects spring while it rises the standard 16dp on
 * the default spatial one, in reading order (`STAGGER`), the way `Reveal` brings in a screen.
 *
 * Inside a flight the staircase on the flight's own clock (`buildOverlayAnimations`) owns the
 * body; this is for what lands *after* it — the body published a beat after the handoff, the
 * thread under it, a record that changed what a block shows. Those used to cut in, which is the
 * "no M3 feel" of a detail filling in under the reader: a page of controls appearing in one frame
 * under a picture that had just moved so smoothly.
 *
 * Only while the detail is settled (`detail-idle`, or no hero session on a direct `/pic/:id`):
 * mid-flight the route is either sealed or carried by the flight, and a second entrance on top of
 * the flight's would read as two. Returns a cancel.
 */
export function playDetailArrival(
  blocks: Iterable<Element>,
  { distance = TRAVEL_PX.standard, delayMs = 0 }: { distance?: number; delayMs?: number } = {},
): () => void {
  if (typeof document === 'undefined' || !entranceMotion()) return () => {};
  const state = document.documentElement.dataset.imageHeroState;
  if (state && state !== 'detail-idle' && state !== 'gallery-idle') return () => {};
  const tier = motionTier('entrance');
  if (tier === 'off') return () => {};
  const reduced = tier === 'reduced';
  const rise = reduced ? TRAVEL_PX.small : distance;
  const step = reduced ? 0 : STAGGER.step;
  const { spatial, effects } = surfaceArrival('default', 'entrance');
  const running: Animation[] = [];
  let index = 0;
  for (const block of blocks) {
    if (!(block instanceof HTMLElement)) continue;
    const at = {
      delay: scaledMs(delayMs + Math.min(index * step, STAGGER.max) * 1000, 'entrance'),
      fill: 'backwards' as const,
    };
    /* Two animations, as `Reveal` has them: an opacity on an under-damped spring is clipped. The
       rise is on `translate`, not `transform`, so it composes with whatever transform the block
       already carries (a pull, a step) instead of replacing it. */
    running.push(
      block.animate([{ opacity: 0 }, { opacity: 1 }], { ...effects, ...at }),
      block.animate([{ translate: `0 ${rise}px` }, { translate: '0 0' }], { ...spatial, ...at }),
    );
    index += 1;
  }
  return () => {
    for (const animation of running) animation.cancel();
  };
}
