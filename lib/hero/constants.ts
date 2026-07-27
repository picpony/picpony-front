'use client';

import type { SpringResponse } from './spring';
import type { HeroDirection } from './types';

// ---------------------------------------------------------------------------
// DOM contracts
// ---------------------------------------------------------------------------

export const HERO_BACKGROUND_SELECTOR = '[data-image-detail-background]';
export const HERO_BACKGROUND_VISUAL_SELECTOR = '[data-image-detail-background-visual]';
export const HERO_GALLERY_ANCHOR_SELECTOR = '[data-image-hero-gallery-anchor]';
export const HERO_REVEAL_SELECTOR = '[data-image-detail-reveal]';
export const HERO_SURFACE_SELECTOR = '[data-image-detail-surface]';

// ---------------------------------------------------------------------------
// Lifecycle timings
// ---------------------------------------------------------------------------

export const HERO_ROUTE_TIMEOUT_MS = 4000;
export const SNAPSHOT_TTL = 2 * 60 * 1000;
/**
 * Browsers may keep a wheel/touch stream latched to its original scroller after
 * the last dispatched event. Keep the outgoing receiver alive until the stream
 * has been quiet long enough to make the next input a new native hit.
 */
export const HERO_INPUT_TRANSFER_QUIET_MS = 320;

// ---------------------------------------------------------------------------
// Media box geometry — the Stage landing target and the routed detail media
// MUST render pixel-identical boxes, so both derive from these.
// ---------------------------------------------------------------------------

export const HERO_MAX_HEIGHT_DVH = 80;
export const HERO_MEDIA_BREAKPOINT_PX = 640;
export const HERO_MEDIA_MOBILE_HORIZONTAL_PADDING_PX = 48;
export const HERO_MEDIA_DESKTOP_HORIZONTAL_PADDING_PX = 128;
export const HERO_MEDIA_MAX_WIDTH_PX = 1248;

// ---------------------------------------------------------------------------
// Flight motion
// ---------------------------------------------------------------------------

export const HERO_DURATIONS: Record<HeroDirection, number> = {
  forward: 340,
  back: 280,
};

/**
 * Critically-damped response per direction. A high launch velocity spends most
 * of the distance in the first ~40% of the timeline, so the flight reads as an
 * immediate answer to the tap; the high rate then settles the remainder into a
 * sub-pixel tail instead of a visible drift.
 */
export const HERO_FLIGHT_RESPONSE: Record<HeroDirection, SpringResponse> = {
  forward: { rate: 7.0, velocity: 0.9 },
  back: { rate: 7.4, velocity: 1.05 },
};

/**
 * WAAPI interpolates between these fixed samples at the display refresh rate.
 * Denser than needed for visual fidelity and far cheaper than rebuilding a
 * 120fps table on every reverse.
 */
export const HERO_FLIGHT_SAMPLES: Record<HeroDirection, number> = {
  forward: 24,
  back: 20,
};

/**
 * Corner radius resolves ahead of position: the shape has already become the
 * destination's shape while the box is still travelling. Reads as deliberate
 * rather than as a rectangle that morphs on arrival.
 */
export const HERO_RADIUS_LEAD = 1.45;
export const HERO_TARGET_RADIUS_PX = 8;

/** Ballistic lift. Outbound throws higher; the return is flatter and quicker. */
export const HERO_ARC_GRAVITY_PX_PER_S2 = 2400;
export const HERO_ARC_DISTANCE_RATIO = 0.035;
export const HERO_ARC_DISTANCE_MAX_PX = 22;
export const HERO_ARC_MIN_PX = 14;
export const HERO_ARC_MAX_PX = 52;
export const HERO_ARC_SCALE: Record<HeroDirection, number> = {
  forward: 1,
  back: 0.72,
};

/** Reverse duration scales with how much of the trip is left to undo. */
export const HERO_REVERSE_MIN_DURATION_MS = 90;
export const HERO_REVERSE_BASE_RATIO = 0.35;
export const HERO_REVERSE_TRAVEL_RATIO = 0.65;

/** Depth cue applied to the gallery behind the detail surface. */
export const HERO_BACKGROUND_SINK_Y_PX = 10;
export const HERO_BACKGROUND_SINK_SCALE_DELTA = 0.015;

// ---------------------------------------------------------------------------
// Content reveal cascade — surface, then chrome, then header, then body.
// ---------------------------------------------------------------------------

export const REVEAL_SURFACE_DELAY_MS = 0;
export const REVEAL_SURFACE_DURATION_MS = 270;
export const REVEAL_CONTENT_DURATION_MS = 285;
export const REVEAL_DELAY_MS = {
  chrome: 45,
  header: 65,
  body: 95,
  default: 65,
} as const;
export const REVEAL_DISTANCE_PX = {
  chrome: 10,
  header: 16,
  body: 22,
  default: 16,
} as const;
export const REVEAL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const HIDE_EASING = 'cubic-bezier(0.4, 0, 1, 1)';
export const HIDE_DISTANCE_PX = 10;

// ---------------------------------------------------------------------------
// Pull-to-dismiss gesture
// ---------------------------------------------------------------------------

export const TOUCH_AXIS_LOCK_PX = 6;
export const DRAG_ACTIVATION_PX = 6;
export const DISMISS_DISTANCE_PX = 120;
export const DISMISS_MIN_FLING_DISTANCE_PX = 48;
export const DISMISS_VELOCITY_PX_PER_MS = 0.5;
export const DRAG_RESISTANCE_PX = 360;
export const BACKGROUND_REVEAL_DISTANCE_PX = 260;
export const SURFACE_FADE_DISTANCE_PX = 140;
export const RELEASE_SAMPLE_WINDOW_MS = 120;

/**
 * Release settle. The spring is driven by the measured fling speed, so a fast
 * flick snaps back decisively while a slow release sinks home gently — a fixed
 * bezier gave both the same lethargic tail.
 */
export const PULL_RELEASE_DURATION_MS = 300;
export const PULL_RELEASE_MIN_DURATION_MS = 170;
export const PULL_RELEASE_RESPONSE: SpringResponse = { rate: 7.2, velocity: 0.6 };
export const PULL_RELEASE_SAMPLES = 20;

// ---------------------------------------------------------------------------
// Frame capture
// ---------------------------------------------------------------------------

export const HERO_FRAME_CACHE_LIMIT = 4;
export const HERO_FRAME_MAX_DIMENSION = 1152;
export const HERO_FRAME_MAX_DPR = 1.875;

/**
 * Viewport changes below this many pixels are ignored. iOS reports continuous
 * `visualViewport` scroll while the address bar collapses; rebuilding the
 * flight on each of those events restarts the spring every frame.
 */
export const HERO_VIEWPORT_REBUILD_EPSILON_PX = 1;
