'use client';

import { useRef, useState, type ReactNode } from 'react';
import {
  MdCheckCircle,
  MdCode,
  MdContentCopy,
  MdDescription,
  MdDownload,
  MdErrorOutline,
  MdExpandMore,
  MdInsights,
  MdShare,
  MdWarningAmber,
} from 'react-icons/md';
import Badge, { type BadgeTone } from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Collapse from '@/components/Collapse';
import Menu, { type MenuAction } from '@/components/Menu';
import ProgressBar from '@/components/ProgressBar';
import ScrollArea from '@/components/ScrollArea';
import SectionHeading from '@/components/SectionHeading';
import { formatDateTime } from '@/lib/format';
import { ICON } from '@/lib/icons';
import type { PerfReport, PerfSample, PerfScenario } from '@/lib/perf/report';
import { VERDICT_LABEL, type Verdict } from '@/lib/perf/stats';
import { clamp, cn } from '@/lib/utils';

const VERDICT_BADGE: Record<Verdict, BadgeTone> = {
  smooth: 'success',
  minor: 'warning',
  janky: 'error',
};

const SUMMARY_ICON: Record<Verdict, ReactNode> = {
  smooth: <MdCheckCircle size={ICON.standard} />,
  minor: <MdWarningAmber size={ICON.standard} />,
  janky: <MdErrorOutline size={ICON.standard} />,
};

/* Bare glyphs for Badge: Badge owns its own 14 / 16dp icon slot sizing. */
const BADGE_ICON: Record<Verdict, ReactNode> = {
  smooth: <MdCheckCircle />,
  minor: <MdWarningAmber />,
  janky: <MdErrorOutline />,
};

const ms = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${Math.round(value)} ms`;
const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;

export default function ReportView({
  report,
  onDownload,
  onCopy,
  onShare,
}: {
  report: PerfReport;
  onDownload: (kind: 'json' | 'md') => void;
  onCopy: () => void;
  onShare?: () => void;
}) {
  const { device } = report;
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLButtonElement>(null);

  const counts: Record<Verdict, number> = { smooth: 0, minor: 0, janky: 0 };
  for (const scenario of report.scenarios) counts[scenario.summary.verdict] += 1;
  const totalScenarios = report.scenarios.length;

  const meta = [
    formatDateTime(report.createdAt),
    `每项 ${report.rounds} 轮`,
    device.noCorner ? '关闭圆角动画' : null,
    device.note ? `备注：${device.note}` : null,
  ].filter(Boolean);

  const exportItems: MenuAction[] = [
    { value: 'md', label: '下载 Markdown', icon: <MdDescription /> },
    { value: 'json', label: '下载 JSON', icon: <MdCode /> },
    ...(onShare ? [{ value: 'share', label: '分享报告', icon: <MdShare /> }] : []),
  ];

  const handleExport = (value: string) => {
    if (value === 'md' || value === 'json') onDownload(value);
    else if (value === 'share') onShare?.();
  };

  return (
    <div className="mb-8">
      <Card variant="elevated" padding="md" className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
            <span
              className={cn(
                'grid size-12 shrink-0 place-items-center rounded-full',
                report.overall === 'smooth' && 'bg-success-container text-on-success-container',
                report.overall === 'minor' && 'bg-warning-container text-on-warning-container',
                report.overall === 'janky' && 'bg-error-container text-on-error-container',
              )}
              aria-hidden="true"
            >
              {SUMMARY_ICON[report.overall]}
            </span>
            <div className="min-w-0">
              <p className="text-label-m text-on-surface-variant">总体结论</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <p className="text-headline-s-emphasized text-on-surface">
                  {VERDICT_LABEL[report.overall]}
                </p>
                {totalScenarios > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {counts.smooth > 0 && (
                      <Badge size="sm" tone="success">
                        流畅 {counts.smooth}
                      </Badge>
                    )}
                    {counts.minor > 0 && (
                      <Badge size="sm" tone="warning">
                        轻微卡顿 {counts.minor}
                      </Badge>
                    )}
                    {counts.janky > 0 && (
                      <Badge size="sm" tone="error">
                        卡顿 {counts.janky}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="tonal"
              icon={<MdContentCopy />}
              className="pointer-coarse:my-1"
              onClick={onCopy}
            >
              复制报告
            </Button>
            <Button
              ref={exportRef}
              size="xs"
              variant="surface"
              icon={<MdDownload />}
              trailingIcon={
                <MdExpandMore
                  className={cn(
                    'transition-transform spring-fast-spatial',
                    exportOpen && 'rotate-180',
                  )}
                />
              }
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              className="pointer-coarse:my-1"
              onClick={() => setExportOpen((value) => !value)}
            >
              导出
            </Button>
            <Menu
              open={exportOpen}
              onClose={() => setExportOpen(false)}
              anchorRef={exportRef}
              aria-label="导出测试报告"
              items={exportItems}
              onSelect={handleExport}
            />
          </div>
        </div>

        <p className="mt-3 border-t border-outline-variant pt-3 text-body-s tabular-nums wrap-anywhere text-on-surface-variant">
          {meta.join(' · ')}
        </p>

        {report.aborted && (
          <p className="mt-3 flex items-start gap-2 rounded-sm bg-error-container px-3 py-2.5 text-body-m text-on-error-container">
            <MdErrorOutline size={ICON.control} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 wrap-anywhere">测试未完成：{report.aborted}</span>
          </p>
        )}
      </Card>

      {totalScenarios > 0 && (
        <section aria-labelledby="perf-scenarios-title">
          <SectionHeading
            id="perf-scenarios-title"
            icon={<MdInsights size={ICON.control} />}
            aside={`共 ${totalScenarios} 项`}
          >
            场景明细
          </SectionHeading>
          {/* One grouped run: `.m3-row` owns the outer corners and 2px seams. */}
          <div>
            {report.scenarios.map((scenario) => (
              <ScenarioRow key={scenario.id} scenario={scenario} refreshHz={device.refreshHz} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function VerdictBadge({ verdict, stress }: { verdict: Verdict; stress?: boolean }) {
  return (
    <Badge size="md" tone={VERDICT_BADGE[verdict]} icon={BADGE_ICON[verdict]}>
      {stress ? (verdict === 'smooth' ? '通过' : '未通过') : VERDICT_LABEL[verdict]}
    </Badge>
  );
}

/**
 * One scenario of the report, a row of its grouped list. The collapsed header pairs the scenario's
 * headline numbers with an inline smoothness meter on wider columns; expanding reveals a two-zone
 * telemetry panel (smoothness hero gauge beside a compact 3×2 metric matrix), lightweight round
 * rows and long-frame breakdowns.
 */
function ScenarioRow({ scenario, refreshHz }: { scenario: PerfScenario; refreshHz: number }) {
  const s = scenario.summary;
  const stress = !!s.glitches;
  const incomplete = scenario.samples.filter((sample) => !sample.completed).length;
  const [open, setOpen] = useState(false);
  const headerId = `perf-scenario-${scenario.id}`;
  const panelId = `${headerId}-panel`;
  const smoothnessPct = clamp(Math.round(s.smoothness * 1000) / 10, 0, 100);

  return (
    <div className="m3-row @container/row bg-surface-container-low">
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={panelId}
        data-ripple=""
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'state-layer transition-ui flex w-full cursor-pointer touch-manipulation items-center gap-3 px-4 py-3 text-left focus-visible:inset-ring-2 focus-visible:outline-hidden focus-visible:focus-ring-inset',
          open ? 'rounded-t-[inherit] rounded-b-none' : 'rounded-[inherit]',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-label-l text-on-surface">{scenario.label}</span>
          <span className="mt-0.5 block text-body-s tabular-nums text-on-surface-variant">
            {stress
              ? `${s.glitches?.actions ?? 0} 次操作 · 消失 ${s.glitches?.vanishes ?? 0} · 卡住 ${s.glitches?.stuck ?? 0}`
              : `${s.fps} fps · 掉帧 ${s.dropped} · 最长帧 ${ms(s.worstFrameMs)}`}
          </span>
        </span>

        {!stress && (
          <span className="hidden shrink-0 items-center gap-2 @lg/row:flex" aria-hidden="true">
            <span className="w-11 text-right text-label-m tabular-nums text-on-surface-variant">
              {pct(s.smoothness)}
            </span>
            <span className="block h-1 w-16 overflow-hidden rounded-full bg-secondary-container forced-boundary">
              <span
                className="block h-full rounded-full bg-secondary forced-mark"
                style={{ width: `${smoothnessPct}%` }}
              />
            </span>
          </span>
        )}

        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <VerdictBadge verdict={s.verdict} stress={stress} />
          {stress && s.frameVerdict && <VerdictBadge verdict={s.frameVerdict} />}
        </span>
        <MdExpandMore
          size={ICON.standard}
          className={cn(
            'shrink-0 text-on-surface-variant transition-transform spring-fast-spatial',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      <Collapse open={open} id={panelId} role="region" aria-label={scenario.label}>
        <div className="@container flex flex-col gap-3.5 border-t border-outline-variant px-4 pt-3.5 pb-4">
          {incomplete > 0 && (
            <p className="flex items-center gap-2 rounded-sm bg-error-container px-3 py-2 text-body-s tabular-nums text-on-error-container">
              <MdErrorOutline size={ICON.dense} className="shrink-0" aria-hidden="true" />
              <span>{incomplete} 轮没有回到静止状态（未完成）</span>
            </p>
          )}

          {stress && s.glitches && <StressChecks scenario={scenario} />}

          <div>
            {stress && (
              <p className="mb-1.5 text-label-m text-on-surface-variant">
                帧数据{s.frameVerdict ? ` · ${VERDICT_LABEL[s.frameVerdict]}` : ''}
                （不计入总体结论）
              </p>
            )}
            <div className="flex flex-col gap-3 rounded-sm bg-surface-container px-3.5 py-3 forced-boundary @2xl:flex-row @2xl:items-center @2xl:gap-4">
              <div className="flex flex-col gap-1.5 @2xl:w-48 @2xl:shrink-0 @2xl:border-r @2xl:border-outline-variant @2xl:pr-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-label-m text-on-surface-variant">流畅度</span>
                  <span className="text-title-l-emphasized tabular-nums text-on-surface">
                    {pct(s.smoothness)}
                  </span>
                </div>
                <ProgressBar value={smoothnessPct} label={`${scenario.label} 流畅度`} />
                <div className="flex items-baseline justify-between gap-2 text-body-s tabular-nums">
                  <span className="text-label-l text-on-surface">{s.fps} fps</span>
                  <span className="text-on-surface-variant">目标 {refreshHz} Hz</span>
                </div>
              </div>

              <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-5 gap-y-2 border-t border-outline-variant pt-2.5 @md:grid-cols-3 @2xl:border-t-0 @2xl:pt-0">
                <Metric label="响应延迟" value={ms(s.latencyMs)} muted={s.latencyMs === null} />
                <Metric label="掉帧" value={String(s.dropped)} />
                <Metric label="P95 帧" value={ms(s.p95FrameMs)} />
                <Metric label="完成用时" value={ms(s.settleMs)} muted={s.settleMs === null} />
                <Metric label="最长帧" value={ms(s.worstFrameMs)} />
                <Metric label="长帧 / 阻塞" value={`${s.longFrames} / ${ms(s.blockingMs)}`} />
              </dl>
            </div>
          </div>

          <RoundsTable samples={scenario.samples} />

          <WorstFrames samples={scenario.samples} />
        </div>
      </Collapse>
    </div>
  );
}

/** One compact inline key-value metric cell inside the telemetry panel. */
function Metric({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <dt className="shrink-0 text-body-s text-on-surface-variant">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-right text-label-l tabular-nums',
          muted ? 'text-on-surface-variant' : 'text-on-surface',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function StressChecks({ scenario }: { scenario: PerfScenario }) {
  const g = scenario.summary.glitches;
  if (!g) return null;
  const completed = scenario.samples.every((sample) => sample.completed);
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [
    { label: '全部跑完', ok: completed, detail: completed ? '全部回到静止' : '有轮次未完成' },
    {
      label: '画面消失',
      ok: g.vanishes === 0,
      detail: g.vanishes === 0 ? '0 次' : `${g.vanishes} 次 / ${g.vanishedFrames} 帧`,
    },
    { label: '卡住', ok: g.stuck === 0, detail: `${g.stuck} 次` },
    { label: '多退一页', ok: g.leftPage === 0, detail: `${g.leftPage} 次` },
  ];

  return (
    <div>
      <p className="mb-1.5 text-label-m tabular-nums text-on-surface-variant">
        正确性检查 · 共 {g.actions} 次操作 · 直接切换 {g.cuts} 次（不计入结论）
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-sm bg-surface-container px-3.5 py-2.5 forced-boundary @xl:grid-cols-4">
        {checks.map((check) => (
          <li key={check.label} className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-label-m text-on-surface-variant">{check.label}</span>
              <Badge size="sm" tone={check.ok ? 'success' : 'error'}>
                {check.ok ? '通过' : '未通过'}
              </Badge>
            </div>
            <p className="mt-0.5 text-body-s tabular-nums text-on-surface">{check.detail}</p>
          </li>
        ))}
      </ul>
      {g.events.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1.5 text-label-m text-on-surface-variant">记录到的异常</p>
          <ul className="flex flex-col gap-1 rounded-sm bg-surface-container px-3.5 py-2.5 font-mono text-body-s tabular-nums wrap-anywhere text-on-surface forced-boundary">
            {g.events.map((event) => (
              <li key={event}>{event}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RoundsTable({ samples }: { samples: PerfSample[] }) {
  return (
    <div>
      <p className="mb-1.5 text-label-m text-on-surface-variant">各轮明细</p>
      <ScrollArea
        axis="x"
        className="rounded-sm bg-surface-container forced-boundary"
        viewportClassName="overflow-x-auto rounded-sm popover-scrollbar"
      >
        <table className="w-full min-w-128 text-left text-body-s tabular-nums">
          <thead className="text-label-m text-on-surface-variant">
            <tr className="border-b border-outline-variant">
              <th scope="col" className="px-3 py-1.5 whitespace-nowrap">
                轮
              </th>
              <th scope="col" className="px-3 py-1.5 text-right whitespace-nowrap">
                响应延迟
              </th>
              <th scope="col" className="px-3 py-1.5 text-right whitespace-nowrap">
                完成用时
              </th>
              <th scope="col" className="px-3 py-1.5 text-right whitespace-nowrap">
                帧数
              </th>
              <th scope="col" className="px-3 py-1.5 text-right whitespace-nowrap">
                掉帧
              </th>
              <th scope="col" className="px-3 py-1.5 text-right whitespace-nowrap">
                最长帧
              </th>
              <th scope="col" className="px-3 py-1.5 text-right whitespace-nowrap">
                长帧
              </th>
              <th scope="col" className="px-3 py-1.5 whitespace-nowrap">
                状态
              </th>
            </tr>
          </thead>
          <tbody className="text-on-surface">
            {samples.map((sample, index) => (
              <tr key={index} className="border-b border-outline-variant last:border-b-0">
                <td className="px-3 py-1.5 whitespace-nowrap">{index + 1}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">{ms(sample.latencyMs)}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">{ms(sample.settleMs)}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">{sample.frames.frames}</td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {sample.frames.dropped}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {ms(sample.frames.worstFrameMs)}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {sample.longFrames.count}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    {sample.completed ? (
                      <Badge size="sm" tone="success">
                        完成
                      </Badge>
                    ) : (
                      <Badge size="sm" tone="error">
                        未完成
                      </Badge>
                    )}
                    {sample.note && <span className="text-on-surface-variant">{sample.note}</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

type Breakdown = {
  totalMs: number;
  scriptMs: number;
  callers: string[];
  forcedMs: number;
  renderMs: number;
  styleMs: number;
};

/** Splits on `+` outside the full-width parentheses (a caller's name could carry a plus). */
function splitTop(text: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '（') depth += 1;
    if (char === '）') depth = Math.max(0, depth - 1);
    if (depth === 0 && char === '+') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

/**
 * The runner's words for a long frame (`describeLongFrame`):
 * `68 ms = 脚本 34（a 25 x.js:12；b 9）+ 其中强制布局 3 + 渲染回调 5 + 样式布局 30` (or legacy
 * `68ms = ...`), taken back apart for display. Null when it is not in that shape, and the text is
 * shown as written.
 */
function parseWorst(detail: string): Breakdown | null {
  const head = /^(\d+(?:\.\d+)?)\s*ms = (.*)$/.exec(detail.trim());
  if (!head) return null;
  const result: Breakdown = {
    totalMs: Number(head[1]),
    scriptMs: 0,
    callers: [],
    forcedMs: 0,
    renderMs: 0,
    styleMs: 0,
  };
  let known = false;
  for (const part of splitTop(head[2])) {
    const match = /^(脚本|其中强制布局|渲染回调|样式布局) (\d+(?:\.\d+)?)(?:（(.*)）)?$/.exec(
      part.trim(),
    );
    if (!match) return null;
    known = true;
    const value = Number(match[2]);
    if (match[1] === '脚本') {
      result.scriptMs = value;
      result.callers = match[3]
        ? match[3]
            .split('；')
            .map((caller) => caller.trim())
            .filter(Boolean)
        : [];
    } else if (match[1] === '其中强制布局') result.forcedMs = value;
    else if (match[1] === '渲染回调') result.renderMs = value;
    else result.styleMs = value;
  }
  return known ? result : null;
}

/* A 100%-stacked composition, like the detail's vote ratio: three parts, which a `ProgressBar`'s
   single value cannot express. Its geometry is the linear indicator's — 4dp over
   `secondary-container` — and its fills are the meter's neutral/accent pair, with `outline` for
   style and layout. */
const SEGMENTS = [
  { key: 'scriptMs', label: '脚本', fill: 'bg-secondary' },
  { key: 'renderMs', label: '渲染回调', fill: 'bg-tertiary' },
  { key: 'styleMs', label: '样式布局', fill: 'bg-outline' },
] as const;

function WorstFrames({ samples }: { samples: PerfSample[] }) {
  const worst = samples
    .map((sample, index) => ({ round: index + 1, detail: sample.longFrames.worst }))
    .filter((entry): entry is { round: number; detail: string } => !!entry.detail);
  if (!worst.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-label-m text-on-surface-variant">每一轮最长的长帧</p>
      <ul className="divide-y divide-outline-variant rounded-sm bg-surface-container forced-boundary">
        {worst.map(({ round, detail }) => (
          <li key={round} className="px-3.5 py-2.5">
            <WorstFrame round={round} detail={detail} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function WorstFrame({ round, detail }: { round: number; detail: string }) {
  const parsed = parseWorst(detail);
  if (!parsed) {
    return (
      <>
        <p className="text-label-l tabular-nums text-on-surface">第 {round} 轮</p>
        <p className="mt-1 text-body-s tabular-nums wrap-anywhere text-on-surface-variant">
          {detail}
        </p>
      </>
    );
  }
  const accounted = parsed.scriptMs + parsed.renderMs + parsed.styleMs;
  const scale = Math.max(parsed.totalMs, accounted, 1);
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-label-l tabular-nums text-on-surface">第 {round} 轮</p>
        <p className="text-title-s tabular-nums text-on-surface">{Math.round(parsed.totalMs)} ms</p>
      </div>
      <div
        className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-secondary-container forced-boundary"
        role="img"
        aria-label={detail}
      >
        {SEGMENTS.map((segment) =>
          parsed[segment.key] > 0 ? (
            <span
              key={segment.key}
              className={cn('h-full forced-mark', segment.fill)}
              style={{ width: `${(parsed[segment.key] / scale) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-body-s tabular-nums text-on-surface-variant">
        {SEGMENTS.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span className={cn('size-2 shrink-0 rounded-full', segment.fill)} aria-hidden="true" />
            {segment.label} {Math.round(parsed[segment.key])} ms
          </li>
        ))}
        {parsed.forcedMs > 0 && <li>其中强制布局 {Math.round(parsed.forcedMs)} ms</li>}
        {parsed.totalMs - accounted >= 1 && (
          <li>其他 {Math.round(parsed.totalMs - accounted)} ms</li>
        )}
      </ul>
      {parsed.callers.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {parsed.callers.map((caller) => (
            <li
              key={caller}
              className="rounded-xs bg-surface-container-high px-2.5 py-1 font-mono text-body-s wrap-anywhere text-on-surface forced-boundary"
            >
              {caller}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
