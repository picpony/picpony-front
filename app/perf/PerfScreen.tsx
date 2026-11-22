'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MdInsights, MdMemory, MdPlayArrow, MdSpeed, MdTune } from 'react-icons/md';
import Button from '@/components/Button';
import Collapse from '@/components/Collapse';
import EmptyState from '@/components/EmptyState';
import { Input } from '@/components/Input';
import PageBack from '@/components/PageBack';
import PageHeader from '@/components/PageHeader';
import ProgressBar from '@/components/ProgressBar';
import Select from '@/components/Select';
import Skeleton from '@/components/Skeleton';
import Tabs, { type TabItem } from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { showToast } from '@/components/Toast';
import { ROW_CLASS, ROW_STACK_CLASS, SettingsRow, SettingsSection, SwitchRow } from '@/app/settings/SettingsRow';
import { LS_KEYS } from '@/lib/constants';
import { useEscapeBack } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { useMounted } from '@/lib/overlay';
import { collectHardware, type PerfHardware } from '@/lib/perf/hardware';
import { loadReport, reportFileName, reportToMarkdown, type PerfReport } from '@/lib/perf/report';
import type { PerfRunGroup } from '@/lib/perf/runner';
import { useScreenState } from '@/lib/screenState';
import { copyText } from '@/lib/utils';
import ReportView from './PerfReport';

/* Module scope: the React Compiler does not lower a dynamic import inside a component. */
const loadRunner = () => import('@/lib/perf/runner');

type PerfTab = 'perf-setup' | 'perf-report';

const PERF_TABS: TabItem<PerfTab>[] = [
  { value: 'perf-setup', label: '测试配置' },
  { value: 'perf-report', label: '测试报告' },
];

const ROUND_OPTIONS = [
  { value: '1', label: '1 轮' },
  { value: '3', label: '3 轮' },
  { value: '5', label: '5 轮' },
];

/** What each group of the run does, in the order the run takes them. */
const GROUPS: Array<{ id: PerfRunGroup; label: string; description: string }> = [
  { id: 'scroll', label: '列表滚动', description: '上下滚动首页图片列表' },
  {
    id: 'hero',
    label: '打开与关闭图片',
    description: '打开图片、左右切换，并依次用 Esc、下拉与返回关闭',
  },
  {
    id: 'stress',
    label: '快速连续操作',
    description: '不等动画结束连续打开、关闭与返回，检查画面是否消失或卡住',
  },
];

/** Status steps a run of these groups announces; `perfRunSteps` in the runner, which loads late. */
function runSteps(rounds: number, include: Record<PerfRunGroup, boolean>) {
  return (
    2 + (include.scroll ? rounds : 0) + (include.hero ? rounds * 3 : 0) + (include.stress ? rounds * 4 : 0)
  );
}

type DeviceFacts = { viewport: string; dpr: number; cores: number | null; pointer: string };

function readDeviceFacts(): DeviceFacts {
  return {
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    cores: navigator.hardwareConcurrency || null,
    pointer: window.matchMedia('(pointer: coarse)').matches ? '触摸' : '鼠标',
  };
}

function readStoredNote() {
  try {
    return localStorage.getItem(LS_KEYS.perfNote) ?? '';
  } catch {
    return '';
  }
}

/**
 * /perf: 开始测试 hands the app's router to the run (`lib/perf/runner.ts`, loaded on the tap) and
 * the run takes the screen over — it goes to the gallery, opens, steps, pulls and closes pictures,
 * and comes back here, where the last report is shown with its exports.
 *
 * The screen renders once mounted on the client: the server has neither the device's values nor its
 * stored report, so its render is the screen's own shape — matching `/settings` so tabs and values
 * land settled on first paint with no post-hydration flip.
 */
export default function PerfScreen() {
  const router = useRouter();
  const mounted = useMounted();

  /* Back is to 设置, where the entry is — not history: after a run the entry behind this one is the
     gallery the run drove. */
  const back = () => router.push('/settings', { scroll: false });
  useEscapeBack(back);

  return (
    <>
      <PageBack onClick={back} label="返回设置" />
      <div className="mx-auto w-full max-w-4xl page-back-room">
        {mounted ? <PerfReady /> : <PerfSkeleton />}
      </div>
    </>
  );
}

/** The screen's shape while waiting for client mount: header, tab strip, grouped rows. */
function PerfSkeleton() {
  return (
    <div data-page-loading aria-busy="true" aria-label="正在加载性能测试">
      <PageHeader
        title="性能测试"
        subtitle={<Skeleton className="h-5 w-72 max-w-full" />}
        actions={<Skeleton className="h-10 w-28 rounded-full" />}
      />
      <div className="mb-6 flex h-12 items-center border-b border-outline-variant" aria-hidden="true">
        {['w-16', 'w-16'].map((width, index) => (
          <div key={index} className="px-4">
            <Skeleton className={`h-4 ${width}`} delay={index * 80} />
          </div>
        ))}
      </div>
      {[3, 2].map((rows, section) => (
        <section key={section} className="mb-8" aria-hidden="true">
          <Skeleton className="mb-4 h-6 w-24 rounded-xs" />
          <div>
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className={ROW_CLASS}>
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-32 rounded-xs" delay={row * 60} />
                  <Skeleton className="mt-1.5 h-3.5 w-56 max-w-full rounded-xs" delay={row * 60 + 30} />
                </div>
                <Skeleton className="h-8 w-13 shrink-0 rounded-full" delay={row * 60 + 60} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PerfReady() {
  const router = useRouter();
  const [report] = useState<PerfReport | null>(() => loadReport());
  const [facts, setFacts] = useState<DeviceFacts>(() => readDeviceFacts());
  /* 设备备注: the CPU and anything else no browser API names. Kept, so a re-run need not retype it. */
  const [note, setNote] = useState<string>(() => readStoredNote());
  /* Returning from a run lands straight on the report; first visits open on setup. */
  const [tab, setTab] = useState<PerfTab>(() => (report ? 'perf-report' : 'perf-setup'));

  /* Remember the tester's run setup across the round trip to the gallery so 重新测试 repeats
     what was configured rather than snapping back to defaults. */
  const [rounds, setRounds] = useScreenState('perf:rounds', '3');
  const [noCorner, setNoCorner] = useScreenState('perf:noCorner', false);
  const [include, setInclude] = useScreenState<Record<PerfRunGroup, boolean>>('perf:include', {
    scroll: true,
    hero: true,
    stress: true,
  });
  const [starting, setStarting] = useState(false);
  const [hardware, setHardware] = useState<PerfHardware | null>(null);

  useEffect(() => {
    const sync = () => setFacts(readDeviceFacts());
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

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
    setNote(value);
    try {
      localStorage.setItem(LS_KEYS.perfNote, value);
    } catch {
      // Storage blocked: the note still rides this run.
    }
  };

  const roundCount = Number(rounds);
  const anyGroup = include.scroll || include.hero || include.stress;
  const steps = runSteps(roundCount, include);

  const start = () => {
    if (!anyGroup) return;
    setStarting(true);
    void loadRunner()
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

  const canShare = typeof navigator.share === 'function';
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

  const subtitle = starting
    ? '即将前往首页运行，进度显示在屏幕底部，可随时取消'
    : anyGroup
      ? `共 ${steps} 步 · 每项 ${roundCount} 轮${noCorner ? ' · 关闭圆角动画' : ''} · 在首页自动运行，期间请勿操作`
      : '请至少选择一项测试内容';

  return (
    <>
      <PageHeader
        title="性能测试"
        subtitle={subtitle}
        actions={
          <Button
            variant="filled"
            icon={<MdPlayArrow />}
            loading={starting}
            disabled={!anyGroup}
            onClick={start}
          >
            {report ? '重新测试' : '开始测试'}
          </Button>
        }
      />

      <Collapse open={starting}>
        {starting && (
          <div className="pb-4">
            <ProgressBar label="正在启动性能测试" />
          </div>
        )}
      </Collapse>

      <Tabs
        tabs={PERF_TABS}
        value={tab}
        onChange={setTab}
        label="性能测试视图"
        className="mb-6"
      />

      <TabPanes value={tab}>
        <TabPane value="perf-setup" inertWhenInactive>
          <SettingsSection
            title="测试项目"
            icon={<MdSpeed size={ICON.control} />}
            subtitle="开始前自动检测屏幕刷新率，所有结论均按本机刷新率判定"
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
          </SettingsSection>

          <SettingsSection title="运行设置" icon={<MdTune size={ICON.control} />}>
            <SettingsRow
              label="测试轮数"
              supporting="每项重复的次数，3 轮全部项目约 1.5 分钟"
              action={
                <Select
                  size="sm"
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
              description="保持图片开合过程圆角不变，用于对比圆角动画的开销"
              checked={noCorner}
              disabled={starting}
              onChange={setNoCorner}
            />
          </SettingsSection>

          <SettingsSection title="本机信息" icon={<MdMemory size={ICON.control} />}>
            <div className="m3-row @container/specs bg-surface-container-low p-4">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 @md/specs:grid-cols-2">
                <Fact label="GPU">
                  {hardware ? (hardware.gpu ?? '浏览器未提供') : '检测中…'}
                </Fact>
                {hardware?.os && <Fact label="系统 / 架构">{hardware.os}</Fact>}
                {hardware?.socGuess && <Fact label="芯片">{hardware.socGuess}</Fact>}
                {hardware?.model && <Fact label="机型代号">{hardware.model}</Fact>}
              </dl>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-outline-variant pt-3 @sm/specs:grid-cols-4">
                <Fact label="视口">{facts.viewport}</Fact>
                <Fact label="像素比">{`DPR ${facts.dpr}`}</Fact>
                <Fact label="CPU 核心">{facts.cores ? `${facts.cores} 核` : '未知'}</Fact>
                <Fact label="输入">{facts.pointer}</Fact>
              </dl>
            </div>
            <div className={ROW_STACK_CLASS}>
              <Input
                label="设备备注"
                helper="浏览器无法获取 CPU 型号，可填写于此并随报告导出，例如「E5-2690 v3 + RX 6500 XT」"
                value={note}
                maxLength={120}
                disabled={starting}
                onChange={(event) => changeNote(event.target.value)}
              />
            </div>
          </SettingsSection>
        </TabPane>

        <TabPane value="perf-report" inertWhenInactive>
          {report ? (
            <ReportView
              report={report}
              onDownload={download}
              onCopy={() => void copy()}
              onShare={canShare ? () => void share() : undefined}
            />
          ) : (
            <EmptyState
              size="pane"
              icon={<MdInsights size={ICON.display} />}
              title="暂无测试报告"
              description="点击「开始测试」后将自动运行并在此生成报告"
            />
          )}
        </TabPane>
      </TabPanes>
    </>
  );
}

/** One fact in the device row: a quiet caption over its tabular value. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-m text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 text-body-m tabular-nums wrap-anywhere text-on-surface">
        {children ?? '—'}
      </dd>
    </div>
  );
}
