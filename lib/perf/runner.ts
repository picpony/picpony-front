'use client';

import { getAppScroller } from '@/lib/appScroller';
import { motionMode, motionSpeed } from '@/lib/appearance';
import {
  PERF_REPORT_VERSION,
  overallVerdict,
  saveReport,
  summarize,
  type PerfDevice,
  type PerfGlitches,
  type PerfReport,
  type PerfSample,
  type PerfScenario,
  type PerfScenarioId,
} from './report';
import { collectHardware, type PerfHardware } from './hardware';
import {
  firstFrameAfter,
  frameStats,
  longFrameStats,
  refreshInterval,
  round,
  type LongFrameEntry,
} from './stats';

/**
 * **The on-device performance run behind /perf.** A tap on 开始测试 hands this module the app's
 * router and leaves; the module outlives the page (it is a module, not a component), drives the
 * gallery and the image detail the way a hand would, and comes back to /perf with a report.
 *
 * It drives the real code paths with synthetic input — the same events the hero's own browser
 * tests send (`scripts/testHeroInteractions.py`): a press and release on a card (touch on a
 * touch screen, so the release opens; mouse plus click elsewhere), Escape on the window,
 * `history.back()`, a pointer pull on the detail and a horizontal swipe on its picture. Nothing
 * here reaches into the hero engine; it watches `data-image-hero-state` on `<html>` like the
 * tests do, so it measures what a user would get, not what the engine believes.
 *
 * Measurement is `requestAnimationFrame` timestamps (main-thread frames) plus long animation
 * frames (`PerformanceObserver`, Chromium) or long tasks. The arithmetic is in `stats.ts`.
 *
 * Loaded only by /perf through a dynamic import, so none of it is in any other route's bundle.
 */

export type PerfRunOptions = {
  rounds: number;
  /** The app router's push (`scroll: false`): the run moves to the gallery and back. */
  navigate: (href: string) => void;
  /** Where the run starts: a route with an image grid. */
  galleryHref?: string;
  /** Where the run returns with its report. */
  returnHref?: string;
  onDone?: (report: PerfReport) => void;
  /** The tester's 设备备注, carried into the report as written. */
  note?: string;
  /** A/B: hold the hero's corner still (`data-perf-no-corner`), to price its repaint. */
  noCorner?: boolean;
  /**
   * Which groups of scenarios to run (all by default). The refresh-rate calibration (`idle`)
   * always runs: every other row is judged against the interval it measures. Skipping a group
   * changes only which rows the report has, never how a row is measured.
   */
  include?: Partial<Record<PerfRunGroup, boolean>>;
};

/** The groups /perf can pick: 列表滚动, the open/step/close rows, 快速连续操作. */
export type PerfRunGroup = 'scroll' | 'hero' | 'stress';

/** Status steps a run of these groups announces: the chip's `x/y`. */
export function perfRunSteps(rounds: number, include: Partial<Record<PerfRunGroup, boolean>> = {}) {
  const on = (group: PerfRunGroup) => include[group] !== false;
  return 2 + (on('scroll') ? rounds : 0) + (on('hero') ? rounds * 3 : 0) + (on('stress') ? rounds * 4 : 0);
}

const THUMB_SELECTOR = '.image-card [data-image-hero-role="thumbnail"]';
const ROUTE_SCROLL_SELECTOR = '[data-image-hero-surface-id] .image-detail-overlay-scroll';
const MEDIA_SELECTOR = '[data-image-hero-surface-id] [data-image-detail-media]';
const DETAIL_SELECTOR = '[data-image-hero-surface-id] [data-image-hero-role="detail"]';
/** Everything that can be the picture on screen while it animates. */
const PICTURE_SELECTOR = `.image-hero-flyer-image, ${MEDIA_SELECTOR}`;
/** Phases in which the picture must be on screen, in the flyer or the detail. */
const ANIMATING_PHASES = new Set([
  'opening.flight',
  'opening.landed',
  'opening.handoff',
  'closing.flight',
  'reversing',
]);
const REST_PHASES = new Set(['gallery-idle', 'detail-idle']);

/**
 * How visible an element is: its own and its ancestors' opacity multiplied, 0 when hidden or
 * off screen. Animated values count (computed style includes running animations).
 */
function visibility(element: Element) {
  const box = element.getBoundingClientRect();
  if (
    box.width < 4 ||
    box.height < 4 ||
    box.bottom <= 0 ||
    box.right <= 0 ||
    box.top >= window.innerHeight ||
    box.left >= window.innerWidth
  )
    return 0;
  let opacity = 1;
  for (let node: Element | null = element; node && opacity > 0; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return 0;
    opacity *= Number.parseFloat(style.opacity) || 0;
  }
  return opacity;
}

/** The picture's total visibility on screen: flyer and detail media together (a crossfade). */
function pictureVisibility() {
  let total = 0;
  for (const element of document.querySelectorAll(PICTURE_SELECTOR)) total += visibility(element);
  return total;
}

class Cancelled extends Error {}

let active: PerfRun | null = null;

export function isPerfRunActive() {
  return active !== null;
}

export function startPerfRun(options: PerfRunOptions) {
  if (active) return false;
  active = new PerfRun(options);
  void active.run().finally(() => {
    active = null;
  });
  return true;
}

export function cancelPerfRun() {
  active?.cancel();
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

type LoafScript = {
  duration: number;
  invoker?: string;
  invokerType?: string;
  sourceURL?: string;
  sourceCharPosition?: number;
  forcedStyleAndLayoutDuration?: number;
};
type Loaf = PerformanceEntry & {
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: LoafScript[];
};

/**
 * One long animation frame in words: how much was script (and its two biggest callers, with the
 * chunk and offset so a build's source map can name them), how much forced layout inside script,
 * how much rendering before style (rAF callbacks), and how much style and layout. Long tasks carry
 * none of this.
 */
function describeLongFrame(entry: PerformanceEntry): string | undefined {
  const loaf = entry as Loaf;
  if (!loaf.scripts) return undefined;
  const end = loaf.startTime + loaf.duration;
  const scripts = loaf.scripts;
  const scriptMs = scripts.reduce((sum, s) => sum + s.duration, 0);
  const forced = scripts.reduce((sum, s) => sum + (s.forcedStyleAndLayoutDuration ?? 0), 0);
  const styleStart = loaf.styleAndLayoutStart || 0;
  const styleMs = styleStart ? end - styleStart : 0;
  const renderMs = loaf.renderStart && styleStart ? styleStart - loaf.renderStart : 0;
  const top = [...scripts]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 2)
    .filter((s) => s.duration >= 4)
    .map((s) => {
      const file = (s.sourceURL ?? '').split('/').pop() ?? '';
      const where = file ? ` ${file}:${s.sourceCharPosition ?? -1}` : '';
      return `${s.invoker || s.invokerType || '?'} ${Math.round(s.duration)}${where}`;
    });
  const parts = [`脚本 ${Math.round(scriptMs)}${top.length ? `（${top.join('；')}）` : ''}`];
  if (forced >= 1) parts.push(`其中强制布局 ${Math.round(forced)}`);
  if (renderMs >= 1) parts.push(`渲染回调 ${Math.round(renderMs)}`);
  parts.push(`样式布局 ${Math.round(styleMs)}`);
  return `${Math.round(loaf.duration)}ms = ${parts.join(' + ')}`;
}

function heroState() {
  return document.documentElement.dataset.imageHeroState ?? 'gallery-idle';
}

class PerfRun {
  private readonly frames: number[] = [];
  private readonly longFrames: LongFrameEntry[] = [];
  private readonly phases: Array<{ at: number; phase: string }> = [];
  private recording = false;
  private cancelled = false;
  private observer: PerformanceObserver | null = null;
  private phaseObserver: MutationObserver | null = null;
  private longFrameSource: PerfDevice['longFrameSource'] = 'none';
  private chip: HTMLDivElement | null = null;
  private chipText: HTMLSpanElement | null = null;
  private chipStep: HTMLSpanElement | null = null;
  private chipBar: HTMLSpanElement | null = null;
  private step = 0;
  private interval = 1000 / 60;
  private pointerId = 4000;
  private readonly touch = window.matchMedia('(pointer: coarse)').matches;
  private readonly samples = new Map<PerfScenarioId, PerfSample[]>();

  constructor(private readonly options: PerfRunOptions) {}

  cancel() {
    this.cancelled = true;
  }

  private runs(group: PerfRunGroup) {
    return this.options.include?.[group] !== false;
  }

  async run() {
    const { rounds, navigate } = this.options;
    const galleryHref = this.options.galleryHref ?? '/';
    const returnHref = this.options.returnHref ?? '/perf';
    let aborted: string | undefined;
    if (this.options.noCorner) document.documentElement.setAttribute('data-perf-no-corner', '');
    this.showChip();
    this.startRecording();
    try {
      this.status('正在打开图片列表…');
      navigate(galleryHref);
      const galleryPath = new URL(galleryHref, location.origin).pathname;
      await this.waitFor(
        () => location.pathname === galleryPath && this.thumbs().length > 0,
        20_000,
        '图片列表没有加载出来，请确认网络后重试',
      );
      await this.waitFor(() => heroState() === 'gallery-idle', 5_000, '画面没有回到列表');
      await this.bringGridIntoView();
      await this.waitForImages();
      await sleep(800);

      this.status('测量刷新率…');
      const idleStart = performance.now();
      await sleep(1200);
      const idleEnd = performance.now();
      this.interval = refreshInterval(this.frames.filter((t) => t >= idleStart && t <= idleEnd));
      this.add('idle', {
        latencyMs: null,
        settleMs: null,
        frames: frameStats(this.frames, this.interval, idleStart, idleEnd),
        longFrames: longFrameStats(this.longFrames, idleStart, idleEnd),
        completed: true,
      });

      for (let round = 0; round < rounds && this.runs('scroll'); round += 1) {
        this.status(`列表滚动 ${round + 1}/${rounds}`);
        await this.scrollScenario();
      }

      for (let round = 0; round < rounds && this.runs('hero'); round += 1) {
        const label = `第 ${round + 1}/${rounds} 轮`;
        this.status(`${label}：打开 → 左右切换 → Esc 关闭`);
        if (await this.openScenario(round * 3)) {
          await this.stepScenario();
          await this.closeScenario('close-escape');
        }
        this.status(`${label}：打开 → 下拉关闭`);
        if (await this.openScenario(round * 3 + 1)) await this.closeScenario('close-pull');
        this.status(`${label}：打开 → 返回关闭`);
        if (await this.openScenario(round * 3 + 2)) await this.closeScenario('close-back');
      }

      for (let round = 0; round < rounds && this.runs('stress'); round += 1) {
        await this.stressScenario(round, rounds);
      }
    } catch (error) {
      aborted =
        error instanceof Cancelled
          ? '已取消'
          : error instanceof Error
            ? error.message
            : String(error);
      if (heroState() !== 'gallery-idle') this.pressEscape();
    } finally {
      document.documentElement.removeAttribute('data-perf-no-corner');
      this.stopRecording();
      this.hideChip();
    }

    /* After the measuring: the probe creates a WebGL context, which must not land in a sample. */
    const hardware = await collectHardware().catch(() => undefined);
    const scenarios: PerfScenario[] = [];
    for (const [id, samples] of this.samples) scenarios.push(summarize(id, samples, this.interval));
    const report: PerfReport = {
      version: PERF_REPORT_VERSION,
      createdAt: new Date().toISOString(),
      rounds,
      device: this.device(hardware),
      scenarios,
      overall: overallVerdict(scenarios),
      aborted,
    };
    saveReport(report);
    this.options.onDone?.(report);
    navigate(returnHref);
    return report;
  }

  // ---------------------------------------------------------------------------
  // Scenarios
  // ---------------------------------------------------------------------------

  private async scrollScenario() {
    const scroller = getAppScroller();
    if (!scroller) return;
    this.check();
    const origin = scroller.scrollTop;
    const target = Math.min(
      origin + scroller.clientHeight * 3,
      scroller.scrollHeight - scroller.clientHeight,
    );
    if (target - origin < 100) return;
    const start = performance.now();
    scroller.scrollTo({ top: target, behavior: 'smooth' });
    await this.waitScrollSettled(scroller, target);
    scroller.scrollTo({ top: origin, behavior: 'smooth' });
    await this.waitScrollSettled(scroller, origin);
    const end = performance.now();
    this.add('scroll', {
      latencyMs: null,
      settleMs: round(end - start),
      frames: frameStats(this.frames, this.interval, start, end),
      longFrames: longFrameStats(this.longFrames, start, end),
      completed: true,
    });
    await this.quiet();
  }

  /** Press and release a card; true once the detail has settled. */
  private async openScenario(index: number) {
    this.check();
    await this.quiet();
    const thumb = this.pickCard(index);
    if (!thumb) {
      this.add('open', this.failed('找不到可见的图片卡片'));
      return false;
    }
    const link = thumb.closest<HTMLAnchorElement>('a') ?? thumb;
    const box = thumb.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const pointerType = this.touch ? 'touch' : 'mouse';
    const pointerId = (this.pointerId += 1);
    this.firePointer(link, 'pointerdown', x, y, pointerType, pointerId, 1);
    if (pointerType === 'mouse') this.fireMouse(link, 'mousedown', x, y);
    await sleep(90);
    const input = performance.now();
    this.firePointer(link, 'pointerup', x, y, pointerType, pointerId, 0);
    if (pointerType === 'mouse') {
      this.fireMouse(link, 'mouseup', x, y);
      this.fireMouse(link, 'click', x, y);
    } else {
      /* A touch's own click trails the release by a frame or more; the release has opened the
         picture by then and the click is swallowed — sent anyway, so that path is measured too. */
      await nextFrame();
      if (heroState() === 'gallery-idle') this.fireMouse(link, 'click', x, y);
    }
    const sample = await this.measure(
      input,
      (phase) => phase.startsWith('opening'),
      'detail-idle',
      8_000,
    );
    this.add('open', sample);
    if (!sample.completed) {
      if (heroState() !== 'gallery-idle') {
        this.pressEscape();
        await this.waitFor(() => heroState() === 'gallery-idle', 5_000, '详情页无法关闭').catch(
          () => {},
        );
      }
      return false;
    }
    await sleep(500);
    return true;
  }

  /** A horizontal flick on the picture: 下一张. */
  private async stepScenario() {
    this.check();
    const media = document.querySelector<HTMLElement>(MEDIA_SELECTOR);
    const detail = document.querySelector<HTMLElement>(DETAIL_SELECTOR);
    if (!media || !detail) return;
    const before = detail.getAttribute('data-image-hero-id');
    const box = media.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const x0 = box.left + box.width * 0.8;
    const travel = -box.width * 0.6;
    const pointerId = (this.pointerId += 1);
    const start = performance.now();
    this.firePointer(media, 'pointerdown', x0, y, 'touch', pointerId, 1);
    for (let step = 1; step <= 8; step += 1) {
      await nextFrame();
      this.firePointer(
        media,
        'pointermove',
        x0 + (travel * step) / 8,
        y + step,
        'touch',
        pointerId,
        1,
      );
    }
    await nextFrame();
    this.firePointer(media, 'pointerup', x0 + travel, y + 8, 'touch', pointerId, 0);
    const changed = await this.waitFor(
      () => document.querySelector(DETAIL_SELECTOR)?.getAttribute('data-image-hero-id') !== before,
      3_000,
      '',
    ).then(
      () => true,
      () => false,
    );
    await sleep(600);
    const end = performance.now();
    this.add('step', {
      latencyMs: null,
      settleMs: round(end - start),
      frames: frameStats(this.frames, this.interval, start, end),
      longFrames: longFrameStats(this.longFrames, start, end),
      completed: changed,
      note: changed ? undefined : '没有下一张或未切换',
    });
  }

  private async closeScenario(id: 'close-escape' | 'close-pull' | 'close-back') {
    this.check();
    let input = performance.now();
    if (id === 'close-escape') {
      input = performance.now();
      this.pressEscape();
    } else if (id === 'close-back') {
      input = performance.now();
      history.back();
    } else {
      const route = document.querySelector<HTMLElement>(ROUTE_SCROLL_SELECTOR);
      if (!route) {
        this.add(id, this.failed('找不到详情页'));
        this.pressEscape();
        await this.waitFor(() => heroState() === 'gallery-idle', 5_000, '详情页无法关闭').catch(
          () => {},
        );
        return;
      }
      route.scrollTop = 0;
      await nextFrame();
      await nextFrame();
      const box = route.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + 100;
      const pointerId = (this.pointerId += 1);
      const dragStart = performance.now();
      this.firePointer(route, 'pointerdown', x, y, 'touch', pointerId, 1);
      for (let step = 1; step <= 12; step += 1) {
        await nextFrame();
        this.firePointer(route, 'pointermove', x, y + step * 14, 'touch', pointerId, 1);
      }
      await nextFrame();
      input = performance.now();
      this.firePointer(route, 'pointerup', x, y + 168, 'touch', pointerId, 0);
      /* The drag's own frames count towards this run: a pull that stutters under the finger is
         the jank this scenario exists to find. */
      const sample = await this.measure(
        input,
        (phase) => phase.startsWith('closing'),
        'gallery-idle',
        8_000,
        dragStart,
      );
      this.add(id, sample);
      await this.recoverToGallery();
      return;
    }
    const sample = await this.measure(
      input,
      (phase) => phase.startsWith('closing'),
      'gallery-idle',
      8_000,
    );
    this.add(id, sample);
    await this.recoverToGallery();
  }

  // ---------------------------------------------------------------------------
  // Stress: fast, overlapping operations, watched for the picture going missing
  // ---------------------------------------------------------------------------

  /**
   * Taps, Escapes and Backs fired without waiting for the previous one to finish, at gaps that
   * land in every part of a flight. Frame stats are kept, but what this measures is correctness:
   * every frame of an animating phase must show the picture (`pictureVisibility`).
   */
  private async stressScenario(pass: number, rounds: number) {
    const groups: Array<{ name: string; run: (cards: HTMLElement[]) => Promise<number> }> = [
      {
        name: '同一张快速开关',
        run: async ([a]) => {
          let actions = 0;
          for (const gap of [70, 140, 220, 320, 140, 70]) {
            await this.tapCard(a);
            await sleep(gap);
            this.closeIfOpen();
            await sleep(gap / 2);
            actions += 2;
          }
          return actions;
        },
      },
      {
        name: '不同图片快速开关',
        run: async (cards) => {
          let actions = 0;
          for (const [index, gap] of [90, 180, 60, 260].entries()) {
            await this.tapCard(cards[index % cards.length]);
            await sleep(gap);
            this.closeIfOpen();
            await sleep(30);
            actions += 2;
          }
          return actions;
        },
      },
      {
        name: '关闭中再打开',
        run: async ([a, b]) => {
          await this.tapCard(a);
          await this.waitFor(() => heroState() === 'detail-idle', 8_000, '').catch(() => {});
          this.closeIfOpen();
          await sleep(120);
          await this.tapCard(a);
          await sleep(150);
          this.closeIfOpen();
          await sleep(90);
          await this.tapCard(b);
          return 5;
        },
      },
      {
        name: '打开中返回再打开',
        run: async ([a, b]) => {
          await this.tapCard(b);
          await sleep(100);
          if (heroState() !== 'gallery-idle') history.back();
          await sleep(60);
          await this.tapCard(b);
          await sleep(200);
          if (heroState() !== 'gallery-idle') history.back();
          await sleep(30);
          await this.tapCard(a);
          return 5;
        },
      },
    ];

    for (const [index, group] of groups.entries()) {
      this.check();
      this.status(`快速连续操作 ${pass + 1}/${rounds}：${group.name}`);
      await this.quiet();
      const cards = [0, 1, 2, 3].map((n) => this.pickCard(pass * 4 + index + n));
      if (cards.some((card) => !card)) {
        this.add('stress', this.failed('可见的图片卡片不够'));
        return;
      }
      const start = performance.now();
      const page = window.location.pathname + window.location.search;
      const watch = this.watchPicture(start, group.name);
      let actions = 0;
      try {
        actions = await group.run(cards as HTMLElement[]);
      } finally {
        /* Let the last operation finish: rest within 8 s, or it is stuck. */
        const settled = await this.waitFor(() => REST_PHASES.has(heroState()), 8_000, '').then(
          () => true,
          () => false,
        );
        await sleep(200);
        await nextFrame();
        const end = performance.now();
        const glitches = watch.stop(actions, settled ? 0 : 1);
        glitches.cuts = this.countCuts(start, end);
        if (!settled) {
          glitches.events.push(`${group.name}：停在 ${heroState()}，8 秒没有回到静止`);
        }
        /* Back from the detail must land on the list it opened from; one step further means the
           close consumed a history entry that was not its own. */
        const now = window.location.pathname + window.location.search;
        const atList = heroState() === 'gallery-idle';
        if (atList && now !== page) {
          glitches.leftPage += 1;
          glitches.events.push(`${group.name}：关闭后离开了原页面（${page} → ${now}）`);
        }
        this.add('stress', {
          latencyMs: null,
          settleMs: round(end - start),
          frames: frameStats(this.frames, this.interval, start, end),
          longFrames: longFrameStats(this.longFrames, start, end),
          completed: settled,
          note: settled ? group.name : `${group.name}：8 秒内没有停下`,
          glitches,
        });
        await this.recoverToGallery().catch(() => {});
      }
      /* Off the list: the remaining groups have no cards to tap. */
      if (window.location.pathname + window.location.search !== page) return;
    }
  }

  /** Escape only while something is open: on the bare list it is a real Back and leaves the page. */
  private closeIfOpen() {
    if (heroState() !== 'gallery-idle') this.pressEscape();
  }

  /** Tap where a card is: the event goes to whatever is on top there now, as a finger's would. */
  private async tapCard(card: HTMLElement): Promise<Element | null> {
    /* The list remounted under us (it should not): nothing sane to tap. */
    if (!card.isConnected) return null;
    const box = card.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const target = document.elementFromPoint(x, y) ?? document.body;
    const pointerType = this.touch ? 'touch' : 'mouse';
    const pointerId = (this.pointerId += 1);
    this.firePointer(target, 'pointerdown', x, y, pointerType, pointerId, 1);
    if (pointerType === 'mouse') this.fireMouse(target, 'mousedown', x, y);
    await sleep(40);
    this.firePointer(target, 'pointerup', x, y, pointerType, pointerId, 0);
    if (pointerType === 'mouse') {
      this.fireMouse(target, 'mouseup', x, y);
      this.fireMouse(target, 'click', x, y);
    } else {
      await nextFrame();
      if (target.isConnected) this.fireMouse(target, 'click', x, y);
    }
    return target;
  }

  /** Every frame until stopped: an animating phase with the picture nowhere is a vanished frame. */
  private watchPicture(start: number, label: string) {
    const glitches: PerfGlitches = {
      actions: 0,
      vanishedFrames: 0,
      vanishes: 0,
      cuts: 0,
      stuck: 0,
      leftPage: 0,
      events: [],
    };
    let running = true;
    let episode: { at: number; phase: string; frames: number } | null = null;
    const close = () => {
      if (!episode) return;
      glitches.vanishes += 1;
      if (glitches.events.length < 6) {
        glitches.events.push(
          `${label} +${Math.round(episode.at - start)}ms ${episode.phase} 消失 ${episode.frames} 帧`,
        );
      }
      episode = null;
    };
    const tick = (time: number) => {
      if (!running) return;
      const phase = heroState();
      if (ANIMATING_PHASES.has(phase) && pictureVisibility() < 0.3) {
        glitches.vanishedFrames += 1;
        if (episode) episode.frames += 1;
        else episode = { at: time, phase, frames: 1 };
      } else {
        close();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return {
      stop: (actions: number, stuck: number) => {
        running = false;
        close();
        glitches.actions = actions;
        glitches.stuck = stuck;
        return glitches;
      },
    };
  }

  /** Rest to the other rest with no animating phase between: an open or close that cut. */
  private countCuts(start: number, end: number) {
    const seen = this.phases.filter((p) => p.at >= start && p.at <= end).map((p) => p.phase);
    let cuts = 0;
    for (let index = 1; index < seen.length; index += 1) {
      const from = seen[index - 1];
      const to = seen[index];
      if (REST_PHASES.has(from) && REST_PHASES.has(to) && from !== to) cuts += 1;
    }
    return cuts;
  }

  // ---------------------------------------------------------------------------
  // Measuring
  // ---------------------------------------------------------------------------

  /**
   * From `input` to the settled `settle` phase: the response frame is the first frame that
   * started after the hero entered a phase `responded` accepts.
   */
  private async measure(
    input: number,
    responded: (phase: string) => boolean,
    settle: string,
    timeout: number,
    windowStart = input,
  ): Promise<PerfSample> {
    let completed = true;
    try {
      /* Settled after the input — with a flight, or without one: the hero falls back to a plain
         cut when it cannot fly (a card scrolled off screen after a step), and that is reported
         as such rather than waited out. */
      await this.waitFor(
        () =>
          heroState() === settle &&
          this.phases.some((p) => p.at >= input && (responded(p.phase) || p.phase === settle)),
        timeout,
        '',
      );
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      completed = false;
    }
    const settledAt = this.phases.find((p) => p.at >= input && p.phase === settle)?.at ?? null;
    /* Two frames past the settle, so a hitch in the settling commit is inside the window. */
    await nextFrame();
    await nextFrame();
    const end = performance.now();
    const respondedAt = this.phases.find((p) => p.at >= input && responded(p.phase))?.at;
    const frame = respondedAt === undefined ? null : firstFrameAfter(this.frames, respondedAt);
    return {
      latencyMs: frame === null ? null : round(frame - input),
      settleMs: settledAt === null ? null : round(settledAt - input),
      frames: frameStats(this.frames, this.interval, windowStart, end),
      longFrames: longFrameStats(this.longFrames, windowStart, end),
      completed,
      note: !completed
        ? `${Math.round(timeout / 1000)} 秒内没有完成`
        : respondedAt === undefined
          ? '没有飞行动画，直接切换'
          : undefined,
    };
  }

  private failed(note: string): PerfSample {
    return {
      latencyMs: null,
      settleMs: null,
      frames: frameStats([], this.interval),
      longFrames: longFrameStats([]),
      completed: false,
      note,
    };
  }

  private add(id: PerfScenarioId, sample: PerfSample) {
    const list = this.samples.get(id) ?? [];
    list.push(sample);
    this.samples.set(id, list);
  }

  private startRecording() {
    this.recording = true;
    const tick = (time: number) => {
      if (!this.recording) return;
      this.frames.push(time);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const supported =
      (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) || [];
    const type = supported.includes('long-animation-frame')
      ? 'long-animation-frame'
      : supported.includes('longtask')
        ? 'longtask'
        : null;
    if (type) {
      this.longFrameSource = type;
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longFrames.push({
            startTime: entry.startTime,
            duration: entry.duration,
            blockingDuration: (entry as PerformanceEntry & { blockingDuration?: number })
              .blockingDuration,
            detail: describeLongFrame(entry),
          });
        }
      });
      try {
        this.observer.observe({ type, buffered: false });
      } catch {
        this.longFrameSource = 'none';
      }
    }
    const root = document.documentElement;
    this.phaseObserver = new MutationObserver(() => {
      this.phases.push({ at: performance.now(), phase: heroState() });
    });
    this.phaseObserver.observe(root, {
      attributes: true,
      attributeFilter: ['data-image-hero-state'],
    });
  }

  private stopRecording() {
    this.recording = false;
    this.observer?.disconnect();
    this.phaseObserver?.disconnect();
  }

  // ---------------------------------------------------------------------------
  // Driving the page
  // ---------------------------------------------------------------------------

  /** Every card of the visible grid (an inactive tab pane's are skipped). */
  private thumbs() {
    return [...document.querySelectorAll<HTMLElement>(THUMB_SELECTOR)].filter(
      (thumb) => !thumb.closest('[data-tab-pane]:not([data-tab-pane-active])'),
    );
  }

  /** Scroll so the grid's first card sits under the app bar: a profile's grid starts below its header. */
  private async bringGridIntoView() {
    const scroller = getAppScroller();
    const first = this.thumbs()[0];
    if (!scroller || !first) return;
    scroller.scrollTop = 0;
    await nextFrame();
    const top = first.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.4) scroller.scrollTop = Math.max(0, top - 120);
    await nextFrame();
  }

  private cards() {
    return this.thumbs().filter((thumb) => {
      /* Loaded and revealed: a card whose picture has not faded in cannot fly (the hero falls back
         to a plain navigation), and that would measure the fallback instead of the animation. */
      const image = thumb.querySelector('img');
      if (
        !image ||
        !(image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1')
      )
        return false;
      const box = thumb.getBoundingClientRect();
      if (box.width < 40 || box.height < 40) return false;
      /* Wholly on screen, clear of the app bar and the bottom chrome. */
      return (
        box.top >= 72 &&
        box.bottom <= window.innerHeight - 72 &&
        box.left >= 0 &&
        box.right <= window.innerWidth
      );
    });
  }

  private pickCard(index: number) {
    const cards = this.cards();
    return cards.length ? cards[index % cards.length] : null;
  }

  private async waitForImages() {
    await this.waitFor(() => this.cards().length >= 2, 15_000, '图片没有加载出来').catch(
      (error) => {
        if (error instanceof Cancelled) throw error;
      },
    );
  }

  private firePointer(
    target: Element,
    type: string,
    x: number,
    y: number,
    pointerType: string,
    pointerId: number,
    buttons: number,
  ) {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType,
        isPrimary: true,
        button: type === 'pointermove' ? -1 : 0,
        buttons,
        clientX: x,
        clientY: y,
      }),
    );
  }

  private fireMouse(target: Element, type: string, x: number, y: number) {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        detail: 1,
        clientX: x,
        clientY: y,
      }),
    );
  }

  private pressEscape() {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  }

  private async recoverToGallery() {
    if (heroState() === 'gallery-idle') return;
    this.pressEscape();
    await this.waitFor(() => heroState() === 'gallery-idle', 5_000, '详情页无法关闭');
  }

  /** The gallery at rest: no flight, and the frame after a short pause. */
  private async quiet() {
    await this.waitFor(() => heroState() === 'gallery-idle', 8_000, '画面没有回到列表');
    await sleep(400);
  }

  private async waitScrollSettled(scroller: HTMLElement, target: number) {
    let last = -1;
    let still = 0;
    const deadline = performance.now() + 4_000;
    while (performance.now() < deadline) {
      this.check();
      await nextFrame();
      const top = scroller.scrollTop;
      still = Math.abs(top - last) < 0.5 ? still + 1 : 0;
      last = top;
      if (still >= 6 && Math.abs(top - target) < 2) return;
      if (still >= 30) return;
    }
  }

  private async waitFor(predicate: () => boolean, timeout: number, message: string) {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      this.check();
      if (performance.now() > deadline) throw new Error(message || '超时');
      await nextFrame();
    }
  }

  private check() {
    if (this.cancelled) throw new Cancelled();
  }

  // ---------------------------------------------------------------------------
  // Report and chrome
  // ---------------------------------------------------------------------------

  private device(hardware?: PerfHardware): PerfDevice {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { effectiveType?: string; downlink?: number };
    };
    const tier = motionMode();
    return {
      userAgent: navigator.userAgent,
      platform:
        (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
          ?.platform ?? navigator.platform,
      devicePixelRatio: window.devicePixelRatio,
      screen: `${screen.width}×${screen.height}`,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      cores: navigator.hardwareConcurrency || null,
      memoryGb: nav.deviceMemory ?? null,
      connection: nav.connection?.effectiveType
        ? `${nav.connection.effectiveType}${nav.connection.downlink ? `，${nav.connection.downlink} Mbps` : ''}`
        : null,
      refreshHz: Math.round(1000 / this.interval),
      pointer: this.touch ? 'coarse' : 'fine',
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      motion: `${tier} · ${motionSpeed()}`,
      longFrameSource: this.longFrameSource,
      build: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev',
      hardware,
      note: this.options.note?.trim() || undefined,
      noCorner: this.options.noCorner || undefined,
    };
  }

  /**
   * A small status card with a cancel button, built outside React so it survives the route
   * changes the run makes. One fixed layer the gallery does not lay out around: the step it is on
   * (`3/26`), what that step does, and a bar for how far along the run is.
   */
  private showChip() {
    const chip = document.createElement('div');
    chip.setAttribute('role', 'status');
    chip.setAttribute('data-perf-run-chip', '');
    chip.className =
      'fixed left-1/2 bottom-6 z-toast flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 overflow-hidden rounded-lg bg-inverse-surface py-2.5 pl-4 pr-2 text-inverse-on-surface shadow-e3';
    const body = document.createElement('span');
    body.className = 'flex min-w-0 flex-1 flex-col gap-1';
    const head = document.createElement('span');
    head.className = 'flex items-center gap-2 text-label-m text-inverse-on-surface';
    const title = document.createElement('span');
    title.textContent = '性能测试中 · 请勿操作';
    const step = document.createElement('span');
    step.className = 'tabular-nums text-inverse-primary';
    head.append(title, step);
    const text = document.createElement('span');
    text.className = 'min-w-0 text-label-l wrap-anywhere';
    text.textContent = '准备中…';
    const track = document.createElement('span');
    track.className = 'relative mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-outline';
    const bar = document.createElement('span');
    bar.className = 'absolute inset-y-0 left-0 block w-0 rounded-full bg-inverse-primary';
    track.append(bar);
    body.append(head, text, track);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.className =
      'state-layer shrink-0 rounded-full px-3 py-2 text-label-l text-inverse-primary focus-visible:outline-hidden';
    cancel.addEventListener('click', () => this.cancel());
    chip.append(body, cancel);
    document.body.append(chip);
    this.chip = chip;
    this.chipText = text;
    this.chipStep = step;
    this.chipBar = bar;
  }

  private status(message: string) {
    if (!this.chipText) return;
    const total = perfRunSteps(this.options.rounds, this.options.include);
    this.step = Math.min(total, this.step + 1);
    this.chipText.textContent = message;
    if (this.chipStep) this.chipStep.textContent = `${this.step}/${total}`;
    if (this.chipBar) this.chipBar.style.width = `${Math.round(((this.step - 1) / total) * 100)}%`;
  }

  private hideChip() {
    this.chip?.remove();
    this.chip = null;
    this.chipText = null;
    this.chipStep = null;
    this.chipBar = null;
  }
}
