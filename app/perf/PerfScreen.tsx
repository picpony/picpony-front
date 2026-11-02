'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  MdCheckCircle,
  MdContentCopy,
  MdDownload,
  MdErrorOutline,
  MdExpandMore,
  MdInsights,
  MdMemory,
  MdPlayArrow,
  MdShare,
  MdSpeed,
  MdTune,
  MdWarningAmber,
} from 'react-icons/md';
import Badge, { type BadgeTone } from '@/components/Badge';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import { Input } from '@/components/Input';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import ProgressBar from '@/components/ProgressBar';
import SectionHeading from '@/components/SectionHeading';
import Select from '@/components/Select';
import { showToast } from '@/components/Toast';
import { SettingsRow, SettingsSection, SwitchRow } from '@/app/settings/SettingsRow';
import { ICON } from '@/lib/icons';
import { LS_KEYS } from '@/lib/constants';
import { useMounted } from '@/lib/overlay';
import { useEscapeBack } from '@/lib/hooks';
import { collectHardware, type PerfHardware } from '@/lib/perf/hardware';
import {
  loadReport,
  reportFileName,
  reportToMarkdown,
  type PerfReport,
  type PerfSample,
  type PerfScenario,
} from '@/lib/perf/report';
import type { PerfRunGroup } from '@/lib/perf/runner';
import { VERDICT_LABEL, type Verdict } from '@/lib/perf/stats';
import { cn, copyText } from '@/lib/utils';

const ROUND_OPTIONS = [
  { value: '1', label: '1 轮' },
  { value: '3', label: '3 轮' },
  { value: '5', label: '5 轮' },
];

/** What each group of the run does, in the order the run takes them. */
const GROUPS: Array<{ id: PerfRunGroup; label: string; description: string }> = [
  { id: 'scroll', label: '列表滚动', description: '上下滚动首页的图片列表' },
  {
    id: 'hero',
    label: '打开与关闭图片',
    description: '打开图片，左右切换，再用 Esc、下拉和返回三种方式关闭',
  },
  {
    id: 'stress',
    label: '快速连续操作',
    description: '不等动画结束就连续打开、关闭、返回，检查画面有没有消失或卡住',
  },
];

/** Status steps a run of these groups announces; `perfRunSteps` in the runner, which loads late. */
function runSteps(rounds: number, include: Record<PerfRunGroup, boolean>) {
  return (
    2 + (include.scroll ? rounds : 0) + (include.hero ? rounds * 3 : 0) + (include.stress ? rounds * 4 : 0)
  );
}

const VERDICT_BADGE: Record<Verdict, BadgeTone> = {
  smooth: 'success',
  minor: 'warning',
  janky: 'error',
};

const VERDICT_ICON: Record<Verdict, ReactNode> = {
  smooth: <MdCheckCircle />,
  minor: <MdWarningAmber />,
  janky: <MdErrorOutline />,
};

const ms = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${Math.round(value)} ms`;
const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;

type DeviceFacts = { viewport: string; dpr: number; cores: number | null; pointer: string };

/**
 * /perf: 开始测试 hands the app's router to the run (`lib/perf/runner.ts`, loaded on the tap) and
 * the run takes the screen over — it goes to the gallery, opens, steps, pulls and closes pictures,
 * and comes back here, where the last report is shown with its exports. While it runs, its progress
 * is the runner's own status card (it outlives this route).
 */
export default function PerfScreen() {
  const router = useRouter();
  const [rounds, setRounds] = useState('3');
  const [noCorner, setNoCorner] = useState(false);
  const [include, setInclude] = useState<Record<PerfRunGroup, boolean>>({
    scroll: true,
    hero: true,
    stress: true,
  });
  const [starting, setStarting] = useState(false);
  /* 设备备注: the CPU and anything else no browser API names. Kept, so a re-run need not retype it. */
  const [edited, setEdited] = useState<string | null>(null);
  const [hardware, setHardware] = useState<PerfHardware | null>(null);
  useEffect(() => {
    let live = true;
    void collectHardware().then((found) => {
      if (live) setHardware(found);
    });
    return () => {
      live = false;
    };
  }, []);
  const changeNote = (value: string) => {
    setEdited(value);
    try {
      localStorage.setItem(LS_KEYS.perfNote, value);
    } catch {
      // Storage blocked: the note still rides this run.
    }
  };
  /* Read once mounted: the server has neither the device nor its storage. The run comes back to
     this route, which mounts afresh, so the stored report is current whenever this reads it. */
  const mounted = useMounted();
  const storedNote = useMemo(() => {
    if (!mounted) return '';
    try {
      return localStorage.getItem(LS_KEYS.perfNote) ?? '';
    } catch {
      return '';
    }
  }, [mounted]);
  const note = edited ?? storedNote;
  const report = useMemo<PerfReport | null>(() => (mounted ? loadReport() : null), [mounted]);
  const facts = useMemo<DeviceFacts | null>(
    () =>
      mounted
        ? {
            viewport: `${window.innerWidth}×${window.innerHeight}`,
            dpr: window.devicePixelRatio,
            cores: navigator.hardwareConcurrency || null,
            pointer: window.matchMedia('(pointer: coarse)').matches ? '触摸' : '鼠标',
          }
        : null,
    [mounted],
  );

  /* Back is to 设置, where the entry is — not history: after a run the entry behind this one is the
     gallery the run drove. */
  const back = () => router.push('/settings', { scroll: false });
  useEscapeBack(back);

  const roundCount = Number(rounds);
  const anyGroup = include.scroll || include.hero || include.stress;
  const steps = runSteps(roundCount, include);

  const start = () => {
    if (!anyGroup) return;
    setStarting(true);
    void import('@/lib/perf/runner')
      .then(({ startPerfRun }) => {
        /* `/perf?gallery=/search?q=…` runs on another grid; only a same-origin path is taken. */
        const gallery = new URLSearchParams(window.location.search).get('gallery');
        const started = startPerfRun({
          rounds: roundCount,
          galleryHref:
            gallery && gallery.startsWith('/') && !gallery.startsWith('//') ? gallery : '/',
          navigate: (href) => router.push(href, { scroll: false }),
          note,
          noCorner,
          include,
        });
        if (!started) {
          setStarting(false);
          showToast('测试已在进行中', 'info');
        }
      })
      .catch(() => {
        setStarting(false);
        showToast('测试工具加载失败', 'error');
      });
  };

  const download = (kind: 'json' | 'md') => {
    if (!report) return;
    const body = kind === 'json' ? JSON.stringify(report, null, 2) : reportToMarkdown(report);
    const blob = new Blob([body], { type: kind === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = reportFileName(report, kind);
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copy = async () => {
    if (!report) return;
    try {
      if (!(await copyText(reportToMarkdown(report)))) {
        showToast('复制失败，请改用下载', 'error');
        return;
      }
      showToast('已复制报告', 'success');
    } catch {
      showToast('复制失败，请改用下载', 'error');
    }
  };

  const canShare = mounted && typeof navigator.share === 'function';
  const share = async () => {
    if (!report) return;
    const file = new File([JSON.stringify(report, null, 2)], reportFileName(report, 'json'), {
      type: 'application/json',
    });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'PicPony 性能测试报告' });
      } else {
        await navigator.share({ title: 'PicPony 性能测试报告', text: reportToMarkdown(report) });
      }
    } catch {
      // Dismissed by the user, or the platform refused: nothing to report.
    }
  };

  return (
    <>
      <PageBack onClick={back} />
      <div className="mx-auto w-full max-w-4xl page-back-room">
        <PageHeader
          title="性能测试"
          subtitle="在这台设备上自动打开、切换、拖动和关闭图片，并滚动列表，测量动画是否流畅、操作是否跟手"
        />

        <Card variant="filled" padding="lg" className="mt-6 mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <span
                className="grid size-12 shrink-0 place-items-center rounded-full bg-primary-container text-on-primary-container"
                aria-hidden="true"
              >
                <MdSpeed size={ICON.standard} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-title-m text-on-surface">
                  {starting
                    ? '正在启动测试…'
                    : anyGroup
                      ? `共 ${steps} 步 · 每项 ${roundCount} 轮${noCorner ? ' · 关闭圆角动画' : ''}`
                      : '请至少选择一项测试内容'}
                </p>
                <p className="mt-1 text-body-m text-on-surface-variant">
                  {starting
                    ? '马上会跳到首页开始测试，进度显示在屏幕底部，可以随时取消。'
                    : '测试在首页进行，期间请不要触碰屏幕或切换应用，结束后自动回到这里显示报告。'}
                </p>
              </div>
            </div>
            <Button
              variant="filled"
              icon={<MdPlayArrow />}
              loading={starting}
              disabled={!anyGroup}
              onClick={start}
              className="shrink-0 max-sm:w-full"
            >
              {report ? '重新测试' : '开始测试'}
            </Button>
          </div>
          {starting && <ProgressBar className="mt-4" label="正在启动性能测试" />}
        </Card>

        <SettingsSection
          title="测试内容"
          icon={<MdTune size={ICON.control} />}
          subtitle="开始前会先测一次刷新率，之后的结论都按这台设备的刷新率来判断"
        >
          {GROUPS.map((group) => (
            <SwitchRow
              key={group.id}
              label={group.label}
              description={group.description}
              checked={include[group.id]}
              disabled={starting}
              onChange={(on) => setInclude((current) => ({ ...current, [group.id]: on }))}
            />
          ))}
          <SettingsRow
            label="轮数"
            supporting="每项重复的次数，轮数越多结果越稳定，3 轮全部项目约 1.5 分钟"
            action={
              <Select
                value={rounds}
                onChange={setRounds}
                options={ROUND_OPTIONS}
                aria-label="测试轮数"
                disabled={starting}
              />
            }
          />
          <SwitchRow
            label="对照：关闭圆角动画"
            description="让图片打开和关闭时的圆角保持不变，与正常结果对比圆角动画的开销"
            checked={noCorner}
            disabled={starting}
            onChange={setNoCorner}
          />
        </SettingsSection>

        <section className="mb-8" aria-labelledby="perf-device-title">
          <SectionHeading id="perf-device-title" icon={<MdMemory size={ICON.control} />}>
            本机
          </SectionHeading>
          <Card variant="filled" padding="lg">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
              <Fact label="视口">{facts?.viewport}</Fact>
              <Fact label="像素比">{facts && `DPR ${facts.dpr}`}</Fact>
              <Fact label="CPU 核心">{facts && (facts.cores ? `${facts.cores} 核` : '未知')}</Fact>
              <Fact label="输入">{facts?.pointer}</Fact>
              <Fact label="GPU" wide>
                {hardware ? (hardware.gpu ?? '浏览器未提供') : mounted ? '检测中…' : null}
              </Fact>
              {hardware?.socGuess && (
                <Fact label="芯片" wide>
                  {hardware.socGuess}
                </Fact>
              )}
              {hardware?.model && <Fact label="机型代号">{hardware.model}</Fact>}
              {hardware?.os && (
                <Fact label="系统 / 架构" wide>
                  {hardware.os}
                </Fact>
              )}
            </dl>
            <Input
              fieldClassName="mt-6"
              label="设备备注"
              helper="浏览器读不到 CPU 型号，可以写在这里，会一起写进报告，例如“E5-2690 v3 + RX 6500 XT”"
              value={note}
              maxLength={120}
              onChange={(event) => changeNote(event.target.value)}
            />
          </Card>
        </section>

        {report ? (
          <ReportView
            report={report}
            onDownload={download}
            onCopy={() => void copy()}
            onShare={canShare ? () => void share() : undefined}
          />
        ) : (
          mounted && (
            <EmptyState
              size="pane"
              icon={<MdInsights size={ICON.display} />}
              title="还没有测试报告"
              description="点击“开始测试”，在这台设备上跑一遍"
            />
          )
        )}
      </div>
    </>
  );
}

/** One fact in the device card: a caption over its value; `wide` takes two columns. */
function Fact({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <dt className="text-label-m text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 text-body-l wrap-anywhere text-on-surface">{children ?? '—'}</dd>
    </div>
  );
}

function ReportView({
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
  const counts = { smooth: 0, minor: 0, janky: 0 };
  for (const scenario of report.scenarios) counts[scenario.summary.verdict] += 1;
  const meta = [
    new Date(report.createdAt).toLocaleString('zh-CN'),
    `${device.refreshHz} Hz`,
    `每项 ${report.rounds} 轮`,
    device.noCorner ? '已关闭圆角动画' : null,
    device.note ? `备注：${device.note}` : null,
  ].filter(Boolean);

  return (
    <section aria-labelledby="perf-report-title">
      <SectionHeading
        id="perf-report-title"
        icon={<MdInsights size={ICON.control} />}
        actions={
          <>
            <Button size="xs" variant="tonal" icon={<MdContentCopy />} onClick={onCopy}>
              复制
            </Button>
            <Button size="xs" variant="tonal" icon={<MdDownload />} onClick={() => onDownload('md')}>
              Markdown
            </Button>
            <Button size="xs" variant="tonal" icon={<MdDownload />} onClick={() => onDownload('json')}>
              JSON
            </Button>
            {onShare && (
              <Button size="xs" variant="tonal" icon={<MdShare />} onClick={onShare}>
                分享
              </Button>
            )}
          </>
        }
      >
        测试报告
      </SectionHeading>

      <Card variant="filled" padding="lg">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
            <span
              className={cn(
                'grid size-12 shrink-0 place-items-center rounded-full [&>svg]:size-7',
                report.overall === 'smooth' && 'bg-success-container text-on-success-container',
                report.overall === 'minor' && 'bg-warning-container text-on-warning-container',
                report.overall === 'janky' && 'bg-error-container text-on-error-container',
              )}
              aria-hidden="true"
            >
              {VERDICT_ICON[report.overall]}
            </span>
            <div className="min-w-0">
              <p className="text-label-m text-on-surface-variant">总体结论</p>
              <p className="text-headline-s-emphasized text-on-surface">
                {VERDICT_LABEL[report.overall]}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge size="md" tone="success">
              流畅 {counts.smooth}
            </Badge>
            <Badge size="md" tone="warning">
              轻微卡顿 {counts.minor}
            </Badge>
            <Badge size="md" tone="error">
              卡顿 {counts.janky}
            </Badge>
          </div>
        </div>
        <p className="mt-4 text-body-s wrap-anywhere text-on-surface-variant">{meta.join(' · ')}</p>
        {report.aborted && (
          <p className="mt-3 flex items-start gap-2 rounded-sm bg-error-container px-3 py-2 text-body-m text-on-error-container">
            <MdErrorOutline size={ICON.control} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 wrap-anywhere">测试没有跑完：{report.aborted}</span>
          </p>
        )}
      </Card>

      <div className="mt-6 flex flex-col gap-3">
        {report.scenarios.map((scenario) => (
          <ScenarioCard key={scenario.id} scenario={scenario} />
        ))}
      </div>

    </section>
  );
}

function VerdictBadge({ verdict, stress }: { verdict: Verdict; stress?: boolean }) {
  return (
    <Badge size="md" tone={VERDICT_BADGE[verdict]} icon={VERDICT_ICON[verdict]}>
      {stress ? (verdict === 'smooth' ? '通过' : '未通过') : VERDICT_LABEL[verdict]}
    </Badge>
  );
}

function ScenarioCard({ scenario }: { scenario: PerfScenario }) {
  const s = scenario.summary;
  const stress = !!s.glitches;
  const incomplete = scenario.samples.filter((sample) => !sample.completed).length;
  return (
    <details
      className="group rounded-md bg-surface-container-low forced-boundary"
      open={s.verdict !== 'smooth' || (s.frameVerdict && s.frameVerdict !== 'smooth') || undefined}
    >
      <summary className="state-layer flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 rounded-md p-4 focus-visible:outline-hidden focus-visible:ring-2 focus-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 basis-32 text-title-s text-on-surface">{scenario.label}</span>
        <span className="order-last w-full text-body-s tabular-nums text-on-surface-variant sm:order-none sm:w-auto">
          {stress
            ? `${s.glitches?.actions ?? 0} 次操作 · 消失 ${s.glitches?.vanishes ?? 0} · 卡住 ${s.glitches?.stuck ?? 0}`
            : `${s.fps} fps · 掉帧 ${s.dropped} · 最长帧 ${ms(s.worstFrameMs)}`}
        </span>
        <VerdictBadge verdict={s.verdict} stress={stress} />
        {stress && s.frameVerdict && <VerdictBadge verdict={s.frameVerdict} />}
        <MdExpandMore
          size={ICON.standard}
          className="shrink-0 text-on-surface-variant group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="flex flex-col gap-5 px-4 pb-4">
        {incomplete > 0 && (
          <p className="text-body-m text-error">
            {incomplete} 轮没有回到静止状态（未完成）
          </p>
        )}

        {stress && s.glitches && <StressChecks scenario={scenario} />}

        <div>
          {stress && (
            <p className="mb-2 text-label-m text-on-surface-variant">
              帧数据{s.frameVerdict ? ` · ${VERDICT_LABEL[s.frameVerdict]}` : ''}（不计入总体结论）
            </p>
          )}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="响应延迟" value={ms(s.latencyMs)} />
            <Metric label="完成用时" value={ms(s.settleMs)} />
            <Metric label="平均帧率" value={`${s.fps} fps`} />
            <Metric label="流畅度" value={pct(s.smoothness)} />
            <Metric label="掉帧" value={String(s.dropped)} />
            <Metric label="最长帧" value={ms(s.worstFrameMs)} />
            <Metric label="P95 帧" value={ms(s.p95FrameMs)} />
            <Metric label="长帧 / 阻塞" value={`${s.longFrames} / ${ms(s.blockingMs)}`} />
          </dl>
        </div>

        <RoundsTable samples={scenario.samples} />

        <WorstFrames samples={scenario.samples} />
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-sm bg-surface-container-high px-3 py-2">
      <dt className="text-label-s text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 text-title-m tabular-nums wrap-anywhere text-on-surface">{value}</dd>
    </div>
  );
}

function StressChecks({ scenario }: { scenario: PerfScenario }) {
  const g = scenario.summary.glitches;
  if (!g) return null;
  const completed = scenario.samples.every((sample) => sample.completed);
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [
    { label: '全部跑完', ok: completed, detail: completed ? '每一轮都回到了静止状态' : '有一轮没有回到静止状态' },
    {
      label: '画面消失',
      ok: g.vanishes === 0,
      detail: g.vanishes === 0 ? '0 次' : `${g.vanishes} 次，共 ${g.vanishedFrames} 帧`,
    },
    { label: '卡住', ok: g.stuck === 0, detail: `${g.stuck} 次` },
    { label: '多退一页', ok: g.leftPage === 0, detail: `${g.leftPage} 次` },
  ];
  return (
    <div>
      <p className="mb-2 text-label-m text-on-surface-variant">正确性检查 · 共 {g.actions} 次操作</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {checks.map((check) => (
          <li
            key={check.label}
            className="flex items-center gap-3 rounded-sm bg-surface-container-high px-3 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-label-l text-on-surface">{check.label}</span>
              <span className="block text-body-s text-on-surface-variant">{check.detail}</span>
            </span>
            <Badge
              size="md"
              tone={check.ok ? 'success' : 'error'}
              icon={check.ok ? <MdCheckCircle /> : <MdErrorOutline />}
            >
              {check.ok ? '通过' : '未通过'}
            </Badge>
          </li>
        ))}
        <li className="flex items-center gap-3 rounded-sm bg-surface-container-high px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block text-label-l text-on-surface">直接切换</span>
            <span className="block text-body-s text-on-surface-variant">没有动画、直接跳到结果，不计入结论</span>
          </span>
          <Badge size="md" tone="neutral">
            {g.cuts} 次
          </Badge>
        </li>
      </ul>
      {g.events.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-label-m text-on-surface-variant">记录到的异常</p>
          <ul className="flex flex-col gap-1 rounded-sm bg-surface-container-high px-3 py-2 text-body-s tabular-nums wrap-anywhere text-on-surface">
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
      <p className="mb-2 text-label-m text-on-surface-variant">每一轮</p>
      <div className="overflow-x-auto rounded-sm bg-surface-container-high main-scrollbar">
        <table className="w-full min-w-136 text-left text-body-s tabular-nums">
          <thead className="text-label-m text-on-surface-variant">
            <tr className="border-b border-outline-variant">
              <th scope="col" className="px-3 py-2 whitespace-nowrap">轮</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">响应延迟</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">完成用时</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">帧数</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">掉帧</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">最长帧</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">长帧</th>
              <th scope="col" className="px-3 py-2 whitespace-nowrap">状态</th>
            </tr>
          </thead>
          <tbody className="text-on-surface">
            {samples.map((sample, index) => (
              <tr key={index} className="border-b border-outline-variant last:border-b-0">
                <td className="px-3 py-2 whitespace-nowrap">{index + 1}</td>
                <td className="px-3 py-2 whitespace-nowrap">{ms(sample.latencyMs)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{ms(sample.settleMs)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{sample.frames.frames}</td>
                <td className="px-3 py-2 whitespace-nowrap">{sample.frames.dropped}</td>
                <td className="px-3 py-2 whitespace-nowrap">{ms(sample.frames.worstFrameMs)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{sample.longFrames.count}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    {sample.completed ? (
                      <Badge tone="success">完成</Badge>
                    ) : (
                      <Badge tone="error">未完成</Badge>
                    )}
                    {sample.note && <span className="text-on-surface-variant">{sample.note}</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
 * `68ms = 脚本 34（a 25 x.js:12；b 9）+ 其中强制布局 3 + 渲染回调 5 + 样式布局 30`, taken back apart
 * for display. Null when it is not in that shape, and the text is shown as written.
 */
function parseWorst(detail: string): Breakdown | null {
  const head = /^(\d+(?:\.\d+)?)ms = (.*)$/.exec(detail.trim());
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
    const match = /^(脚本|其中强制布局|渲染回调|样式布局) (\d+(?:\.\d+)?)(?:（(.*)）)?$/.exec(part.trim());
    if (!match) return null;
    known = true;
    const value = Number(match[2]);
    if (match[1] === '脚本') {
      result.scriptMs = value;
      result.callers = match[3] ? match[3].split('；').map((caller) => caller.trim()).filter(Boolean) : [];
    } else if (match[1] === '其中强制布局') result.forcedMs = value;
    else if (match[1] === '渲染回调') result.renderMs = value;
    else result.styleMs = value;
  }
  return known ? result : null;
}

const SEGMENTS = [
  { key: 'scriptMs', label: '脚本', fill: 'bg-primary' },
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
      <p className="mb-2 text-label-m text-on-surface-variant">每一轮最长的长帧</p>
      <ul className="flex flex-col gap-2">
        {worst.map(({ round, detail }) => (
          <li key={round} className="rounded-sm bg-surface-container-high px-3 py-3">
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
        <p className="text-label-l text-on-surface">第 {round} 轮</p>
        <p className="mt-1 text-body-s wrap-anywhere text-on-surface-variant">{detail}</p>
      </>
    );
  }
  const accounted = parsed.scriptMs + parsed.renderMs + parsed.styleMs;
  const scale = Math.max(parsed.totalMs, accounted, 1);
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-label-l text-on-surface">第 {round} 轮</p>
        <p className="text-title-s tabular-nums text-on-surface">{Math.round(parsed.totalMs)} ms</p>
      </div>
      <div
        className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-container-highest forced-boundary"
        role="img"
        aria-label={detail}
      >
        {SEGMENTS.map((segment) =>
          parsed[segment.key] > 0 ? (
            <span
              key={segment.key}
              className={cn('h-full', segment.fill)}
              style={{ width: `${(parsed[segment.key] / scale) * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-body-s tabular-nums text-on-surface-variant">
        {SEGMENTS.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span className={cn('size-2 shrink-0 rounded-full', segment.fill)} aria-hidden="true" />
            {segment.label} {Math.round(parsed[segment.key])} ms
          </li>
        ))}
        {parsed.forcedMs > 0 && <li>其中强制布局 {Math.round(parsed.forcedMs)} ms</li>}
        {parsed.totalMs - accounted >= 1 && <li>其他 {Math.round(parsed.totalMs - accounted)} ms</li>}
      </ul>
      {parsed.callers.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {parsed.callers.map((caller) => (
            <li
              key={caller}
              className="rounded-xs bg-surface-container-highest px-2 py-1 font-mono text-body-s wrap-anywhere text-on-surface"
            >
              {caller}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
