import { LS_KEYS } from '@/lib/constants';
import {
  VERDICT_LABEL,
  latencyVerdict,
  median,
  round,
  verdictOf,
  worseVerdict,
  type FrameStats,
  type LongFrameStats,
  type Verdict,
} from './stats';
import type { PerfHardware } from './hardware';

/**
 * The report a performance run (`lib/perf/runner.ts`) produces, and its two exports: the JSON
 * itself (for comparing devices by script) and a Markdown page (for reading, or pasting into an
 * issue). Pure apart from `localStorage`, which keeps the last report so /perf can show it again.
 */

export const PERF_REPORT_VERSION = 1;

export type PerfScenarioId =
  'idle' | 'scroll' | 'open' | 'step' | 'close-escape' | 'close-pull' | 'close-back' | 'stress';

export const SCENARIO_LABEL: Record<PerfScenarioId, string> = {
  idle: '静止基线',
  scroll: '列表滚动',
  open: '打开图片',
  step: '左右切换',
  'close-escape': '关闭（Esc）',
  'close-pull': '下拉关闭',
  'close-back': '关闭（返回）',
  stress: '快速连续操作',
};

/**
 * What the stress run watches besides frames: the picture going missing mid-animation. Each
 * frame of an animating phase must show the picture somewhere (the flyer, the detail's media or
 * the card); a frame that shows none is a vanished frame.
 */
export type PerfGlitches = {
  /** Operations fired (taps, closes, backs). */
  actions: number;
  /** Frames of an animating phase with the picture nowhere on screen. */
  vanishedFrames: number;
  /** Separate vanishing episodes (runs of vanished frames). */
  vanishes: number;
  /** Opens or closes that cut straight to the end state with no animating phase. */
  cuts: number;
  /** Runs that never came back to a resting state. */
  stuck: number;
  /** Runs whose closes went back past the list they opened from (an extra history step). */
  leftPage: number;
  /** The first few episodes, for the report: `+1234ms closing.flight 5 帧（同一张 · 间隔 150ms）`. */
  events: string[];
};

/** One run of one scenario. */
export type PerfSample = {
  /** The stress scenario's correctness watch; absent elsewhere. */
  glitches?: PerfGlitches;
  /** Input to the first frame that could show the response, ms; null where it does not apply. */
  latencyMs: number | null;
  /** Input to the settled screen (`detail-idle` / `gallery-idle`), ms. */
  settleMs: number | null;
  frames: FrameStats;
  longFrames: LongFrameStats;
  /** Whether the run reached its settled state; a run that did not is still reported. */
  completed: boolean;
  note?: string;
};

export type PerfScenario = {
  id: PerfScenarioId;
  label: string;
  samples: PerfSample[];
  summary: {
    latencyMs: number | null;
    settleMs: number | null;
    fps: number;
    smoothness: number;
    dropped: number;
    worstFrameMs: number;
    p95FrameMs: number;
    longFrames: number;
    blockingMs: number;
    verdict: Verdict;
    /**
     * The stress run's frames, judged like any other row's. Shown beside the pass/fail
     * `verdict` and kept out of `overallVerdict`: that one is about correctness only.
     */
    frameVerdict?: Verdict;
    glitches?: PerfGlitches;
  };
};

export type PerfDevice = {
  userAgent: string;
  platform: string;
  devicePixelRatio: number;
  screen: string;
  viewport: string;
  cores: number | null;
  memoryGb: number | null;
  connection: string | null;
  refreshHz: number;
  pointer: 'coarse' | 'fine';
  reducedMotion: boolean;
  /** The app's 动画 settings in force: tier, speed. */
  motion: string;
  /** Whether the browser reports long animation frames (Chromium 123+) or only long tasks. */
  longFrameSource: 'long-animation-frame' | 'longtask' | 'none';
  build: string;
  /** GPU, model and OS the browser reveals (`lib/perf/hardware.ts`); absent in older reports. */
  hardware?: PerfHardware;
  /** The tester's own 设备备注 (the CPU, which no browser API names). */
  note?: string;
  /** Run with the hero's corner animation held still (A/B). */
  noCorner?: boolean;
};

export type PerfReport = {
  version: number;
  createdAt: string;
  rounds: number;
  device: PerfDevice;
  scenarios: PerfScenario[];
  overall: Verdict;
  /** Set when the run stopped early: cancelled, or the page could not be driven. */
  aborted?: string;
};

export function summarize(
  id: PerfScenarioId,
  samples: PerfSample[],
  interval: number,
): PerfScenario {
  const latencies = samples
    .map((sample) => sample.latencyMs)
    .filter((v): v is number => v !== null);
  const settles = samples.map((sample) => sample.settleMs).filter((v): v is number => v !== null);
  const frames = samples.reduce((sum, sample) => sum + sample.frames.frames, 0);
  const dropped = samples.reduce((sum, sample) => sum + sample.frames.dropped, 0);
  const worstFrameMs = Math.max(0, ...samples.map((sample) => sample.frames.worstFrameMs));
  const pooled: FrameStats = {
    frames,
    durationMs: samples.reduce((sum, sample) => sum + sample.frames.durationMs, 0),
    fps: round(median(samples.map((sample) => sample.frames.fps))),
    dropped,
    smoothness: frames + dropped > 0 ? round(frames / (frames + dropped), 3) : 1,
    worstFrameMs,
    p95FrameMs: Math.max(0, ...samples.map((sample) => sample.frames.p95FrameMs)),
    hitches: samples.reduce((sum, sample) => sum + sample.frames.hitches, 0),
  };
  const latencyMs = latencies.length ? round(median(latencies)) : null;
  let verdict = verdictOf(pooled, interval);
  // A completed cut has no flight response to time. Its frames still count, and a timed-out
  // run still fails below; an unavailable latency is not itself evidence of a stalled input.
  if (latencyMs !== null && id !== 'idle' && id !== 'scroll' && id !== 'step') {
    verdict = worseVerdict(verdict, latencyVerdict(latencyMs));
  }
  if (samples.some((sample) => !sample.completed)) verdict = 'janky';
  const glitches = sumGlitches(samples);
  /* The stress run judges correctness: its frames are rapid-fire overlapping flights that no
     user makes, so their drops say nothing the open/close rows have not; a glitch is the verdict. */
  let frameVerdict: Verdict | undefined;
  if (glitches && id === 'stress') {
    frameVerdict = verdictOf(pooled, interval);
    verdict = samples.every((sample) => sample.completed) ? 'smooth' : 'janky';
  }
  if (glitches && (glitches.vanishes > 0 || glitches.stuck > 0 || glitches.leftPage > 0))
    verdict = 'janky';
  return {
    id,
    label: SCENARIO_LABEL[id],
    samples,
    summary: {
      latencyMs,
      settleMs: settles.length ? round(median(settles)) : null,
      fps: pooled.fps,
      smoothness: pooled.smoothness,
      dropped,
      worstFrameMs,
      p95FrameMs: pooled.p95FrameMs,
      longFrames: samples.reduce((sum, sample) => sum + sample.longFrames.count, 0),
      blockingMs: round(samples.reduce((sum, sample) => sum + sample.longFrames.blockingMs, 0)),
      verdict,
      ...(frameVerdict ? { frameVerdict } : {}),
      glitches,
    },
  };
}

export function sumGlitches(samples: PerfSample[]): PerfGlitches | undefined {
  const all = samples.map((sample) => sample.glitches).filter((g): g is PerfGlitches => !!g);
  if (!all.length) return undefined;
  return {
    actions: all.reduce((sum, g) => sum + g.actions, 0),
    vanishedFrames: all.reduce((sum, g) => sum + g.vanishedFrames, 0),
    vanishes: all.reduce((sum, g) => sum + g.vanishes, 0),
    cuts: all.reduce((sum, g) => sum + g.cuts, 0),
    stuck: all.reduce((sum, g) => sum + g.stuck, 0),
    leftPage: all.reduce((sum, g) => sum + g.leftPage, 0),
    events: all.flatMap((g) => g.events).slice(0, 12),
  };
}

export function overallVerdict(scenarios: PerfScenario[]): Verdict {
  return scenarios
    .filter((scenario) => scenario.id !== 'idle')
    .reduce<Verdict>((worst, scenario) => worseVerdict(worst, scenario.summary.verdict), 'smooth');
}

const ms = (value: number | null) => (value === null ? '—' : `${value} ms`);
const pct = (value: number) => `${round(value * 100, 1)}%`;

/** The report as a Markdown page: device, a summary table, then every run. */
export function reportToMarkdown(report: PerfReport) {
  const { device } = report;
  const lines: string[] = [];
  lines.push(`# PicPony 性能测试报告`);
  lines.push('');
  lines.push(`- 时间：${new Date(report.createdAt).toLocaleString('zh-CN')}`);
  lines.push(`- 总体：**${VERDICT_LABEL[report.overall]}**（每项 ${report.rounds} 轮）`);
  if (report.aborted) lines.push(`- 未完成：${report.aborted}`);
  lines.push('');
  lines.push('## 设备');
  lines.push('');
  lines.push(`| 项目 | 值 |`);
  lines.push(`| --- | --- |`);
  const cell = (value: string) => value.replace(/\|/g, '/');
  if (device.note) lines.push(`| 设备备注 | ${cell(device.note)} |`);
  const hw = device.hardware;
  if (hw) {
    lines.push(`| GPU | ${hw.gpu ? cell(hw.gpu) : '浏览器未提供'} |`);
    if (hw.socGuess) lines.push(`| 芯片 | ${cell(hw.socGuess)} |`);
    if (hw.model) lines.push(`| 机型代号 | ${cell(hw.model)} |`);
    if (hw.os) lines.push(`| 系统 / 架构 | ${cell(hw.os)} |`);
    if (hw.gpuAdapter) lines.push(`| WebGPU | ${cell(hw.gpuAdapter)} |`);
    if (hw.gpuRaw && hw.gpuRaw !== hw.gpu) lines.push(`| GPU 原始字符串 | ${cell(hw.gpuRaw)} |`);
  }
  lines.push(`| 刷新率 | ${device.refreshHz} Hz |`);
  lines.push(
    `| 屏幕 / 视口 | ${device.screen} / ${device.viewport}（DPR ${device.devicePixelRatio}） |`,
  );
  lines.push(
    `| CPU 核心 / 内存 | ${device.cores ?? '未知'} / ${device.memoryGb === null ? '未知' : `${device.memoryGb} GB`} |`,
  );
  lines.push(`| 指针 | ${device.pointer === 'coarse' ? '触摸' : '鼠标'} |`);
  lines.push(
    `| 动画设置 | ${device.motion}${device.reducedMotion ? '（系统要求减弱动态效果）' : ''} |`,
  );
  lines.push(`| 网络 | ${device.connection ?? '未知'} |`);
  lines.push(`| 长帧数据 | ${device.longFrameSource} |`);
  if (device.noCorner) lines.push('| 对照 | 关闭圆角动画 |');
  lines.push(`| 版本 | ${device.build} |`);
  lines.push(`| UA | ${device.userAgent.replace(/\|/g, '/')} |`);
  lines.push('');
  lines.push('## 汇总');
  lines.push('');
  lines.push(
    '| 场景 | 结论 | 响应延迟 | 完成用时 | 平均帧率 | 流畅度 | 掉帧 | 最长帧 | P95 帧 | 长帧 / 阻塞 |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const scenario of report.scenarios) {
    const s = scenario.summary;
    lines.push(
      `| ${scenario.label} | ${s.glitches ? `${s.verdict === 'smooth' ? '通过' : '未通过'}${s.frameVerdict ? ` · ${VERDICT_LABEL[s.frameVerdict]}` : ''}` : VERDICT_LABEL[s.verdict]} | ${ms(s.latencyMs)} | ${ms(s.settleMs)} | ${s.fps} | ${pct(s.smoothness)} | ${s.dropped} | ${s.worstFrameMs} ms | ${s.p95FrameMs} ms | ${s.longFrames} / ${s.blockingMs} ms |`,
    );
  }
  const stress = report.scenarios.find((scenario) => scenario.summary.glitches);
  const g = stress?.summary.glitches;
  if (g) {
    lines.push('');
    lines.push('## 快速连续操作');
    lines.push('');
    lines.push(
      `- ${g.actions} 次操作：画面消失 ${g.vanishes} 次（共 ${g.vanishedFrames} 帧），直接切换没有动画 ${g.cuts} 次，卡住 ${g.stuck} 次，多退一页 ${g.leftPage} 次`,
    );
    for (const event of g.events) lines.push(`- ${event}`);
  }
  lines.push('');
  lines.push('## 每一轮');
  for (const scenario of report.scenarios) {
    lines.push('');
    lines.push(`### ${scenario.label}`);
    lines.push('');
    lines.push('| 轮 | 响应延迟 | 完成用时 | 帧数 | 掉帧 | 最长帧 | 长帧 | 备注 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    scenario.samples.forEach((sample, index) => {
      lines.push(
        `| ${index + 1} | ${ms(sample.latencyMs)} | ${ms(sample.settleMs)} | ${sample.frames.frames} | ${sample.frames.dropped} | ${sample.frames.worstFrameMs} ms | ${sample.longFrames.count} | ${sample.completed ? (sample.note ?? '') : `未完成${sample.note ? `：${sample.note}` : ''}`} |`,
      );
    });
    const worst = scenario.samples
      .map((sample, index) => [index + 1, sample.longFrames.worst] as const)
      .filter((pair): pair is readonly [number, string] => !!pair[1]);
    if (worst.length) {
      lines.push('');
      for (const [round, detail] of worst) lines.push(`- 第 ${round} 轮最长的长帧：${detail}`);
    }
  }
  lines.push('');
  lines.push('## 怎么读');
  lines.push('');
  lines.push(
    '- 帧数据来自 `requestAnimationFrame`，即主线程产出的帧。合成线程上的动画（图片的位移和缩放）在主线程卡住时仍可能继续，所以掉帧不一定都看得见，但手指拖动、圆角和下一次点击一定会受影响。',
  );
  lines.push(
    '- 掉帧：两帧间隔超过 1.5 个刷新周期时，按缺了几帧计数。流畅度 = 实际帧 /（实际帧 + 掉帧）。',
  );
  lines.push(
    '- 响应延迟：从脚本发出输入到第一帧开始的时间。真实触摸还要加上系统把触摸送到浏览器的时间（通常 10–30ms）。',
  );
  lines.push(
    '- 快速连续操作：不等上一个动画结束就点开、关闭、返回。动画中的每一帧都检查图片（飞行中的图或详情页的图）是否还在屏幕上；有一帧不在就算“画面消失”，结论直接记为卡顿。',
  );
  lines.push(
    '- 结论：缺帧不超过 2% 且没有超过 2.5 帧的停顿为流畅；不超过 8% 且没有 100ms 的停顿为轻微卡顿；打开和关闭还要求响应延迟不超过 100ms（流畅）/ 200ms（轻微）。',
  );
  return lines.join('\n');
}

export function reportFileName(report: PerfReport, extension: 'json' | 'md') {
  const stamp = report.createdAt.replace(/[:.]/g, '-').slice(0, 19);
  return `picpony-perf-${stamp}.${extension}`;
}

/** The current document's latest run survives navigation even when storage refuses it. */
let lastReport: PerfReport | null = null;

export function saveReport(report: PerfReport) {
  lastReport = report;
  try {
    localStorage.setItem(LS_KEYS.perfReport, JSON.stringify(report));
  } catch {
    // Storage full or blocked: the run's page still shows it from memory.
  }
}

export function loadReport(): PerfReport | null {
  if (lastReport) return lastReport;
  try {
    const raw = localStorage.getItem(LS_KEYS.perfReport);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PerfReport;
    return parsed?.version === PERF_REPORT_VERSION ? parsed : null;
  } catch {
    return null;
  }
}
