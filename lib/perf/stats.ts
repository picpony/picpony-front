/**
 * The arithmetic of a performance run: what a list of frame timestamps, long animation frames and
 * input times says about smoothness. Pure — no DOM — so `scripts/testPerf.mjs` checks it in Node,
 * and the runner (`lib/perf/runner.ts`) only collects the numbers.
 *
 * **What a frame is here.** Every number below is read off `requestAnimationFrame`, i.e. the
 * frames the *main thread* produced. A compositor animation (the flyer's transform, the window's
 * scale) can keep moving while the main thread stalls, so a stall here is not always a visible
 * stutter of the picture — but it is always a stutter of anything the main thread drives (the
 * pull, the swipe, the window's corner, a scroll handler) and a delay for the next touch. That is
 * the honest reading, and the report says so.
 */

export type FrameStats = {
  /** Frames the main thread produced in the window. */
  frames: number;
  /** Window length, ms. */
  durationMs: number;
  /** Mean frames per second over the window. */
  fps: number;
  /** Frames that should have been there and were not (gaps past 1.5 refresh intervals). */
  dropped: number;
  /** `frames / (frames + dropped)`, 0–1. */
  smoothness: number;
  /** Longest gap between two frames, ms. */
  worstFrameMs: number;
  /** 95th percentile frame gap, ms. */
  p95FrameMs: number;
  /** Gaps of 50ms or more — a hitch anyone notices. */
  hitches: number;
};

export type LongFrameStats = {
  /** Long animation frames (≥ 50ms) the browser reported, or long tasks where LoAF is missing. */
  count: number;
  /** The longest one, ms. */
  worstMs: number;
  /** Sum of `blockingDuration` (time past 50ms in each), ms: how long input would have waited. */
  blockingMs: number;
  /** The longest frame taken apart (LoAF only): where its time went. */
  worst?: string;
};

export type Verdict = 'smooth' | 'minor' | 'janky';

export const VERDICT_LABEL: Record<Verdict, string> = {
  smooth: '流畅',
  minor: '轻微卡顿',
  janky: '卡顿',
};

/** Median of a list (0 for an empty one). */
export function median(values: readonly number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Nearest-rank percentile, `p` in 0–100 (0 for an empty list). */
export function percentile(values: readonly number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

/**
 * The display's refresh interval from an idle stretch of frames: the median gap, snapped to a
 * plausible range (240Hz … 20Hz). The median, not the mean, because one stray long frame in the
 * calibration second must not make a 60Hz screen look like 50Hz.
 */
export function refreshInterval(timestamps: readonly number[]) {
  const gaps: number[] = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    const gap = timestamps[index] - timestamps[index - 1];
    if (gap > 0) gaps.push(gap);
  }
  const value = median(gaps);
  if (!(value > 0)) return 1000 / 60;
  return Math.min(50, Math.max(1000 / 240, value));
}

/** Frame statistics for the timestamps inside `[from, to]`, against the refresh interval. */
export function frameStats(
  timestamps: readonly number[],
  interval: number,
  from = -Infinity,
  to = Infinity,
): FrameStats {
  const inside = timestamps.filter((time) => time >= from && time <= to);
  const gaps: number[] = [];
  let dropped = 0;
  let hitches = 0;
  for (let index = 1; index < inside.length; index += 1) {
    const gap = inside[index] - inside[index - 1];
    gaps.push(gap);
    if (gap > interval * 1.5) dropped += Math.max(1, Math.round(gap / interval) - 1);
    if (gap >= 50) hitches += 1;
  }
  const durationMs = inside.length > 1 ? inside[inside.length - 1] - inside[0] : 0;
  const frames = inside.length;
  return {
    frames,
    durationMs: round(durationMs),
    fps: durationMs > 0 ? round(((frames - 1) * 1000) / durationMs) : 0,
    dropped,
    smoothness: frames + dropped > 0 ? round(frames / (frames + dropped), 3) : 1,
    worstFrameMs: round(gaps.length ? Math.max(...gaps) : 0),
    p95FrameMs: round(percentile(gaps, 95)),
    hitches,
  };
}

export type LongFrameEntry = {
  startTime: number;
  duration: number;
  blockingDuration?: number;
  /** LoAF's breakdown, already in words: `68ms = 脚本 34（#document.onclick 25）+ 样式布局 30`. */
  detail?: string;
};

/** Long animation frames (or long tasks) overlapping `[from, to]`. */
export function longFrameStats(
  entries: readonly LongFrameEntry[],
  from = -Infinity,
  to = Infinity,
): LongFrameStats {
  const inside = entries.filter(
    (entry) => entry.startTime <= to && entry.startTime + entry.duration >= from,
  );
  const longest = inside.reduce<LongFrameEntry | null>(
    (best, entry) => (!best || entry.duration > best.duration ? entry : best),
    null,
  );
  return {
    ...(longest?.detail ? { worst: longest.detail } : {}),
    count: inside.length,
    worstMs: round(inside.length ? Math.max(...inside.map((entry) => entry.duration)) : 0),
    blockingMs: round(
      inside.reduce(
        (sum, entry) => sum + (entry.blockingDuration ?? Math.max(0, entry.duration - 50)),
        0,
      ),
    ),
  };
}

/**
 * The first frame that started at or after `time` — the frame that can carry a change made at
 * `time` — or null when the window ended first.
 */
export function firstFrameAfter(timestamps: readonly number[], time: number) {
  for (const stamp of timestamps) if (stamp >= time) return stamp;
  return null;
}

/**
 * One word for a stretch of motion. Thresholds are in refresh intervals, so a 120Hz phone is
 * held to its own frame rather than to 60Hz: under 2% of frames missing with no gap past 2.5
 * frames is smooth; under 8% and no gap of 100ms is a minor hitch; anything else is janky.
 */
export function verdictOf(stats: FrameStats, interval: number): Verdict {
  const missing = 1 - stats.smoothness;
  if (missing <= 0.02 && stats.worstFrameMs <= interval * 2.5) return 'smooth';
  if (missing <= 0.08 && stats.worstFrameMs < 100) return 'minor';
  return 'janky';
}

/**
 * The word for a response time — input to the first frame that shows the answer. 100ms is the
 * line past which a tap stops feeling instant (RAIL); 200ms is the INP "good" bound.
 */
export function latencyVerdict(ms: number | null): Verdict {
  if (ms === null) return 'janky';
  if (ms <= 100) return 'smooth';
  if (ms <= 200) return 'minor';
  return 'janky';
}

/** The worse of two verdicts. */
export function worseVerdict(a: Verdict, b: Verdict): Verdict {
  const rank: Record<Verdict, number> = { smooth: 0, minor: 1, janky: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
