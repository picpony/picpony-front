/** The /perf run's arithmetic (`lib/perf/stats.ts`) and report (`lib/perf/report.ts`); no browser. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { requireTypeStripping } from './tsResolve.mjs';

requireTypeStripping('testPerf');

const stats = await import('../lib/perf/stats.ts');
const report = await import('../lib/perf/report.ts');

const frames = (count, interval, start = 0) =>
  Array.from({ length: count }, (_, i) => start + i * interval);

test('the refresh interval is the median gap, so one long frame does not change the display', () => {
  const stamps = frames(60, 1000 / 60);
  stamps.splice(30, 0, stamps[29] + 40);
  for (let i = 31; i < stamps.length; i += 1) stamps[i] += 40;
  assert.ok(Math.abs(stats.refreshInterval(stamps) - 1000 / 60) < 0.01);
  assert.ok(Math.abs(stats.refreshInterval(frames(120, 1000 / 120)) - 1000 / 120) < 0.01);
  assert.equal(stats.refreshInterval([]), 1000 / 60);
});

test('a steady run drops nothing and reads smooth; a 100ms gap is five missing frames', () => {
  const interval = 1000 / 60;
  const steady = stats.frameStats(frames(61, interval), interval);
  assert.equal(steady.dropped, 0);
  assert.equal(steady.smoothness, 1);
  assert.equal(steady.fps, 60);
  assert.equal(stats.verdictOf(steady, interval), 'smooth');

  const hitch = [...frames(30, interval), ...frames(30, interval, 29 * interval + 100)];
  const s = stats.frameStats(hitch, interval);
  assert.equal(s.dropped, 5);
  assert.equal(s.hitches, 1);
  assert.equal(s.worstFrameMs, 100);
  assert.equal(stats.verdictOf(s, interval), 'janky');
});

test('a 120Hz display is held to its own frame', () => {
  const interval = 1000 / 120;
  const stamps = [...frames(60, interval), ...frames(60, interval, 59 * interval + 1000 / 60)];
  const s = stats.frameStats(stamps, interval);
  assert.equal(s.dropped, 1);
  assert.notEqual(stats.verdictOf(s, interval), 'janky');
});

test('the response frame is the first frame at or after the change; long frames overlap the window', () => {
  assert.equal(stats.firstFrameAfter([0, 16, 33, 50], 20), 33);
  assert.equal(stats.firstFrameAfter([0, 16], 20), null);
  const long = stats.longFrameStats(
    [
      { startTime: 0, duration: 80, blockingDuration: 30 },
      { startTime: 500, duration: 60 },
    ],
    50,
    400,
  );
  assert.deepEqual(long, { count: 1, worstMs: 80, blockingMs: 30 });
});

test('a scenario summary takes the worse of smoothness and response, and the Markdown names every scenario', () => {
  const interval = 1000 / 60;
  const smooth = stats.frameStats(frames(20, interval), interval);
  const sample = (latencyMs) => ({
    latencyMs,
    settleMs: 300,
    frames: smooth,
    longFrames: stats.longFrameStats([]),
    completed: true,
  });
  const fast = report.summarize('open', [sample(40), sample(60), sample(50)], interval);
  assert.equal(fast.summary.latencyMs, 50);
  assert.equal(fast.summary.verdict, 'smooth');
  const slow = report.summarize('open', [sample(250), sample(260)], interval);
  assert.equal(slow.summary.verdict, 'janky');
  const unfinished = report.summarize(
    'close-pull',
    [{ ...sample(40), completed: false }],
    interval,
  );
  assert.equal(unfinished.summary.verdict, 'janky');
  const full = {
    version: report.PERF_REPORT_VERSION,
    createdAt: '2026-11-01T08:00:00.000Z',
    rounds: 3,
    device: {
      userAgent: 'UA | x',
      platform: 'Linux',
      devicePixelRatio: 3,
      screen: '390×844',
      viewport: '390×844',
      cores: 8,
      memoryGb: 8,
      connection: null,
      refreshHz: 60,
      pointer: 'coarse',
      reducedMotion: false,
      motion: 'standard · default',
      longFrameSource: 'long-animation-frame',
      build: 'test',
    },
    scenarios: [fast, slow],
    overall: report.overallVerdict([fast, slow]),
  };
  assert.equal(full.overall, 'janky');
  const md = report.reportToMarkdown(full);
  assert.match(md, /\| 打开图片 \| 流畅 \| 50 ms/);
  assert.match(md, /UA \/ x/, 'a pipe in the user agent must not break the table');
  assert.equal(report.reportFileName(full, 'json'), 'picpony-perf-2026-11-01T08-00-00.json');
});

test('hardware: GPU names trimmed, phone SoC guessed', async () => {
  const hardware = await import('../lib/perf/hardware.ts');
  assert.equal(
    hardware.cleanRenderer(
      'ANGLE (AMD, AMD Radeon RX 6500 XT (0x0000743F) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ),
    'AMD Radeon RX 6500 XT',
  );
  assert.equal(
    hardware.cleanRenderer('ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2)'),
    'Adreno 830',
  );
  assert.equal(hardware.cleanRenderer('Apple GPU'), 'Apple GPU');
  assert.equal(hardware.socFromGpu('Adreno 830'), '骁龙 8 至尊版（推测）');
  assert.equal(hardware.socFromGpu('Mali-G720'), null);
  assert.equal(hardware.socFromGpu(null), null);
});

test('completed cuts keep their frame verdict without inventing a failed response', () => {
  const interval = 1000 / 60;
  const sample = {
    latencyMs: null,
    settleMs: 100,
    frames: stats.frameStats(frames(20, interval), interval),
    longFrames: stats.longFrameStats([]),
    completed: true,
    note: '没有飞行动画，直接切换',
  };
  for (const id of ['open', 'close-escape', 'close-pull', 'close-back']) {
    const cut = report.summarize(id, [sample], interval);
    assert.equal(cut.summary.latencyMs, null);
    assert.equal(cut.summary.verdict, 'smooth', `${id}: no flight is not a timeout`);
    assert.equal(report.summarize(id, [{ ...sample, completed: false }], interval).summary.verdict, 'janky');
    const stalled = { ...sample, frames: stats.frameStats(frames(20, interval * 3), interval) };
    assert.equal(report.summarize(id, [stalled], interval).summary.verdict, 'janky', 'real dropped frames still count');
    assert.equal(report.summarize(id, [sample, { ...sample, latencyMs: 250 }], interval).summary.verdict, 'janky', 'a measured slow response still counts');
  }
});

test('a completed report survives blocked storage and takes precedence over an older saved run', () => {
  const previous = { version: report.PERF_REPORT_VERSION, createdAt: '2026-11-01T08:00:00Z' };
  const current = { ...previous, createdAt: '2026-11-02T08:00:00Z' };
  const later = { ...previous, createdAt: '2026-11-02T09:00:00Z' };
  let stored = JSON.stringify(previous);
  let denied = false;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() { if (denied) throw new Error('Storage blocked'); return stored; },
      setItem(_key, value) { if (denied) throw new Error('Quota exceeded'); stored = value; },
    },
  });
  try {
    assert.deepEqual(report.loadReport(), previous);
    denied = true;
    assert.equal(report.loadReport(), null, 'a cold read also tolerates denied storage');
    report.saveReport(current);
    assert.equal(report.loadReport(), current, 'navigation can render and export the in-memory run');
    denied = false;
    assert.deepEqual(JSON.parse(stored), previous);
    assert.equal(report.loadReport(), current, 'the stale stored run must not replace the new one');
    report.saveReport(later);
    assert.deepEqual(JSON.parse(stored), later, 'storage is still attempted on the next run');
    assert.equal(report.loadReport(), later);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('the stress run keeps pass/fail on correctness and reports its frames as a verdict of their own', () => {
  const interval = 1000 / 60;
  const glitches = { actions: 4, vanishedFrames: 0, vanishes: 0, cuts: 0, stuck: 0, leftPage: 0, events: [] };
  const jankyFrames = stats.frameStats(
    Array.from({ length: 20 }, (_, i) => i * interval * 3),
    interval,
  );
  const sample = { latencyMs: null, settleMs: 300, frames: jankyFrames, longFrames: stats.longFrameStats([]), completed: true, glitches };
  const stress = report.summarize('stress', [sample, sample], interval);
  assert.equal(stress.summary.verdict, 'smooth');
  assert.equal(stress.summary.frameVerdict, 'janky');
  assert.equal(report.overallVerdict([stress]), 'smooth');
  const open = report.summarize('open', [{ ...sample, glitches: undefined, latencyMs: 40 }], interval);
  assert.equal(open.summary.frameVerdict, undefined);
});
