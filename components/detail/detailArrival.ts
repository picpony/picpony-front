'use client';

import { entranceMotion, motionTier } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';

/**
 * Late detail content fades in at its final position, just like the content inside a flight.
 * Only settled details accept this entrance; see docs/hero.md#data-and-handoff.
 */
export function playDetailArrival(
  blocks: Iterable<Element>,
): () => void {
  if (typeof document === 'undefined' || !entranceMotion()) return () => {};
  const state = document.documentElement.dataset.imageHeroState;
  if (state && state !== 'detail-idle' && state !== 'gallery-idle') return () => {};
  if (motionTier('entrance') === 'off') return () => {};
  const effects = springTiming('defaultEffects', 'entrance');
  const running: Animation[] = [];
  for (const block of blocks) {
    if (!(block instanceof HTMLElement)) continue;
    running.push(
      block.animate([{ opacity: 0 }, { opacity: 1 }], { ...effects, fill: 'backwards' }),
    );
  }
  return () => {
    for (const animation of running) animation.cancel();
  };
}
