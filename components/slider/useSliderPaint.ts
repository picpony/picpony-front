import { useCallback, useLayoutEffect, useRef } from 'react';
import { useMotionScale, useMotionTier } from '@/lib/appearance';
import { sampleEasing, sampledTrack } from '@/lib/sampledAnimation';
import { SHAPE_SPEC, springEase } from '@/lib/spring';
import { shapeFor, springTiming } from '@/lib/springTiming';
import { clamp, clamp01 } from '@/lib/utils';
import { sliderPose } from './paint';

/** Keep every range track and handle on one bounded spring progress, without cutting its tail. */
function boundedRangeProgress(from: readonly number[], to: readonly number[], progress: number) {
  let low = -Infinity;
  let high = Infinity;
  for (let index = 0; index < from.length; index++) {
    const distance = to[index] - from[index];
    if (distance === 0) continue;
    const atMin = -from[index] / distance;
    const atMax = (1 - from[index]) / distance;
    low = Math.max(low, Math.min(atMin, atMax));
    high = Math.min(high, Math.max(atMin, atMax));
  }
  const gap = from[1] - from[0];
  const gapChange = (to[1] - to[0]) - gap;
  if (gapChange > 0) low = Math.max(low, -gap / gapChange);
  else if (gapChange < 0) high = Math.min(high, -gap / gapChange);
  return clamp(progress, low, high);
}

/** Select jumps share feedback's fastSpatial role; all other value changes stay immediate.
 * See docs/motion.md#controls-and-feedback and docs/design/layout.md#slider. */
export function useSliderPaint(fraction: number, disabled: boolean, endFraction?: number) {
  const railRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<HTMLSpanElement>(null);
  const endPositionRef = useRef<HTMLSpanElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  const inactiveRef = useRef<HTMLSpanElement>(null);
  const inactiveStartRef = useRef<HTMLSpanElement>(null);
  const animations = useRef<Animation[]>([]);
  const jumpFrom = useRef<readonly number[] | null>(null);
  const tier = useMotionTier('feedback');
  const scale = useMotionScale('feedback');

  const stop = useCallback(() => {
    for (const animation of animations.current) animation.cancel();
    animations.current = [];
  }, []);

  const queueJump = useCallback((from: readonly number[] | null) => {
    jumpFrom.current = from;
  }, []);

  const cancelJump = useCallback(() => {
    jumpFrom.current = null;
    stop();
  }, [stop]);

  useLayoutEffect(() => {
    const from = jumpFrom.current;
    jumpFrom.current = null;
    stop();
    const position = positionRef.current;
    const active = activeRef.current;
    const inactive = inactiveRef.current;
    if (disabled || tier === 'off' || !from || !position || !active || !inactive) return stop;
    const range = endFraction !== undefined;
    const endPosition = endPositionRef.current;
    const inactiveStart = inactiveStartRef.current;
    if (range && (!endPosition || !inactiveStart || from.length !== 2)) return stop;
    if (from[0] === fraction && (!range || from[1] === endFraction)) return stop;

    const distance = fraction - from[0];
    const endDistance = range ? endFraction - from[1] : 0;
    const samples = sampleEasing(springEase(SHAPE_SPEC[shapeFor('fastSpatial', 'feedback')]));
    const bounded = range
      ? (progress: number) => boundedRangeProgress(from, [fraction, endFraction], progress)
      : (progress: number) => (clamp01(from[0] + distance * progress) - from[0]) / distance;
    const poseAt = (progress: number) => sliderPose(
      from[0] + distance * progress,
      range ? from[1] + endDistance * progress : undefined,
    );
    const timing = springTiming('fastSpatial', 'feedback');
    const tracks: [HTMLElement, (progress: number) => Keyframe][] = [
      [position, (progress) => ({ transform: poseAt(progress).transform })],
      [active, (progress) => ({ clipPath: poseAt(progress).active })],
      [inactive, (progress) => ({ clipPath: poseAt(progress).inactive })],
    ];
    if (range && endPosition && inactiveStart) {
      tracks.push(
        [endPosition, (progress) => ({ transform: poseAt(progress).endTransform })],
        [inactiveStart, (progress) => ({ clipPath: poseAt(progress).inactiveStart })],
      );
    }
    animations.current = tracks.map(([element, frame]) => {
      const track = sampledTrack(samples, frame, bounded);
      return element.animate(track.keyframes, { ...timing, easing: track.easing });
    });
    return stop;
  }, [fraction, endFraction, disabled, tier, scale, stop]);

  return {
    railRef,
    positionRef,
    endPositionRef,
    activeRef,
    inactiveRef,
    inactiveStartRef,
    queueJump,
    stop,
    cancelJump,
    pose: sliderPose(fraction, endFraction),
  };
}
