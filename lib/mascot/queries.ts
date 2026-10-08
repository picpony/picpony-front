'use client';

import { defineResource } from '@/lib/resource';
import { getMascotConfig, getMascotShape, type MascotConfig } from '@/lib/api/mascot';
import type { MascotShape } from '@/lib/mascot/shapeModel';

export const mascotConfig = defineResource<{ selected: string }, MascotConfig>({
  name: 'mascot-config', key: ({ selected }) => selected,
  fetch: ({ selected }, signal) => getMascotConfig(selected, signal), ttl: 300_000, maxEntries: 8,
});

/* An upload's address names its content, so its silhouette holds for as long as the page does. */
export const mascotShape = defineResource<{ src: string }, MascotShape>({
  name: 'mascot-shape', key: ({ src }) => src,
  fetch: ({ src }, signal) => getMascotShape(src, signal), ttl: 6 * 60 * 60 * 1000, maxEntries: 4,
});
