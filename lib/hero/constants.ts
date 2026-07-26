'use client';

import type { HeroDirection } from './types';

export const HERO_HOST_SELECTOR = '[data-image-detail-host]';
export const HERO_BACKGROUND_SELECTOR = '[data-image-detail-background]';
export const HERO_BACKGROUND_VISUAL_SELECTOR = '[data-image-detail-background-visual]';
export const HERO_GALLERY_ANCHOR_SELECTOR = '[data-image-hero-gallery-anchor]';

export const HERO_ROUTE_TIMEOUT_MS = 4000;
export const SNAPSHOT_TTL = 2 * 60 * 1000;
// Browsers may keep a wheel/touch stream latched to its original scroller
// after the last dispatched event. Keep the outgoing receiver alive until the
// stream has been quiet long enough to make the next input a new native hit.
export const HERO_INPUT_TRANSFER_QUIET_MS = 320;

export const HERO_MAX_HEIGHT_DVH = 80;
export const HERO_MEDIA_BREAKPOINT_PX = 640;
export const HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX = 48;
export const HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX = 128;
export const HERO_MEDIA_MAX_WIDTH_PX = 1248;

export const HERO_DURATIONS: Record<HeroDirection, number> = {
  forward: 300,
  back: 245,
};
export const HERO_BACKGROUND_SINK_Y_PX = 10;
export const HERO_BACKGROUND_SINK_SCALE_DELTA = 0.015;
export const HERO_ARC_DISTANCE_RATIO = 0.035;
export const HERO_ARC_MAX_PX = 52;

export const MOTION_RESPONSE: Record<HeroDirection, {
  rate: number;
  initialVelocity: number;
}> = {
  forward: { rate: 6.2, initialVelocity: 0.55 },
  back: { rate: 6.8, initialVelocity: 0.7 },
};

// WAAPI interpolates between these fixed samples on every refresh rate.
export const HERO_KEYFRAME_SAMPLES: Record<HeroDirection, number> = {
  forward: 24,
  back: 20,
};

export const REVEAL_SURFACE_DELAY_MS = 16;
export const REVEAL_SURFACE_DURATION_MS = 295;
export const REVEAL_CONTENT_DURATION_MS = 255;
export const REVEAL_DELAY_MS = { chrome: 30, body: 60, default: 40 } as const;
export const REVEAL_DISTANCE_PX = { body: 12, default: 18 } as const;

export const TOUCH_AXIS_LOCK_PX = 6;
export const DRAG_ACTIVATION_PX = 6;
export const DISMISS_DISTANCE_PX = 120;
export const DISMISS_MIN_FLING_DISTANCE_PX = 48;
export const DISMISS_VELOCITY_PX_PER_MS = 0.5;
export const DRAG_RESISTANCE_PX = 360;
export const BACKGROUND_REVEAL_DISTANCE_PX = 260;
export const SURFACE_FADE_DISTANCE_PX = 140;
export const RELEASE_SAMPLE_WINDOW_MS = 120;

export const HERO_FRAME_CACHE_LIMIT = 4;
export const HERO_FRAME_MAX_DIMENSION = 1152;
export const HERO_FRAME_MAX_DPR = 1.875;

export function getTrackedTouch(touches: TouchList, touchIdentifier: number | null) {
  if (touchIdentifier === null) return null;
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index);
    if (touch?.identifier === touchIdentifier) return touch;
  }
  return null;
}
