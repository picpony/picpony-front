'use client';

import { motionTier } from '@/lib/appearance';

let player: Promise<typeof import('lottie-web/build/player/esm/lottie_light.min.js')> | null = null;
let search: Promise<unknown> | null = null;

/** Intent warming and playback share these promises; failed chunks remain retryable. */
export function loadLottiePlayer() {
  player ??= import('lottie-web/build/player/esm/lottie_light.min.js').catch((error) => {
    player = null;
    throw error;
  });
  return player;
}

export function loadSearchArtwork(): Promise<unknown> {
  search ??= import('@/lib/lottie/search.json').then((module) => module.default).catch((error) => {
    search = null;
    throw error;
  });
  return search;
}

/** A search gesture prepares the illustration before its route mounts. No eager player. */
export function warmSearchArtwork() {
  if (motionTier() !== 'standard') return;
  void Promise.all([loadLottiePlayer(), loadSearchArtwork()]).catch(() => {});
}
