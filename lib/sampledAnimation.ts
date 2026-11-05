import { supportsLinearEasing } from '@/lib/spring';

export type ProgressSample = { offset: number; progress: number };
export type SampledTrack = { keyframes: Keyframe[]; easing: string };

/** Keep native two-keyframe tracks; Chrome 109 receives the same samples as keyframes.
 * Both run on the compositor without per-frame JS. See docs/motion-system.md#browser-compatibility. */
export function sampledTrack(
  samples: readonly ProgressSample[],
  frame: (progress: number) => Keyframe,
  fraction: (progress: number) => number = (progress) => progress,
): SampledTrack {
  if (!supportsLinearEasing()) {
    return {
      keyframes: samples.map(({ offset, progress }) => ({ ...frame(fraction(progress)), offset })),
      easing: 'linear',
    };
  }
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  return {
    keyframes: [frame(0), frame(1)],
    easing: `linear(${samples.map(({ offset, progress }) => `${round(fraction(progress))} ${round(offset * 100)}%`).join(',')})`,
  };
}

/** Adaptive subdivision shared by strip motion and its legacy keyframe representation. */
export function sampleEasing(ease: (t: number) => number, tolerance = 0.0015): ProgressSample[] {
  const samples = [{ offset: 0, progress: ease(0) }];
  const split = (t0: number, v0: number, t1: number, v1: number, depth: number) => {
    const mid = (t0 + t1) / 2;
    const value = ease(mid);
    if (depth < 4 || (depth < 12 && Math.abs(value - (v0 + v1) / 2) > tolerance)) {
      split(t0, v0, mid, value, depth + 1);
      split(mid, value, t1, v1, depth + 1);
    } else {
      samples.push({ offset: t1, progress: v1 });
    }
  };
  split(0, ease(0), 1, ease(1), 0);
  return samples;
}
