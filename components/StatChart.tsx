'use client';

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import EmptyState from '@/components/EmptyState';
import Skeleton from '@/components/Skeleton';
import SwapContent from '@/components/SwapContent';
import { cn } from '@/lib/utils';
import { formatExactCount } from '@/lib/format';
import { entranceMotion, scaledMs, useMotionScale, useMotionTier } from '@/lib/appearance';
import { routeTransitActive } from '@/lib/pageTransit';
import { HANDOFF_MS } from '@/lib/motionTokens';
import { springTiming } from '@/lib/springTiming';

/** Small, dependency-free time-series plots. Material roles own all chart ink and surfaces. */
export type ChartTone = 'primary' | 'secondary' | 'tertiary' | 'neutral';

export interface ChartSeries {
  key: string;
  label: string;
  values: number[];
  tone: ChartTone;
  /** The overview value for the same metric and time window as the plotted values. */
  summary: number | null;
}

export interface ChartBucket {
  key: string;
  tick: string;
  detail: string;
}

interface StatChartProps {
  series: ChartSeries[];
  buckets: ChartBucket[];
  overviewLabel: string;
  detailQualifier?: string;
  ariaLabel: string;
  loading?: boolean;
  /** Only the selected chart plays data feedback; concealed peers retain final paint. */
  active?: boolean;
  className?: string;
}

type Inspection = { key: string; index: number; source: 'hover' | 'select' };

const TONE: Record<ChartTone, string> = {
  primary: 'text-primary-ink',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  neutral: 'text-on-surface-variant',
};
/* Multi-series stroke patterns keep lines distinguishable under monochrome palettes
   (where `secondary` and `tertiary` share one ink) and for colour-vision deficiency. */
const SERIES_DASH: readonly (string | undefined)[] = [undefined, '6 3', '2 3', '8 3 2 3'];

const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 56 };
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/** Whole-count axes with round 1/2/5 steps, including when the maximum is only one. */
function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function axisValue(value: number): string {
  if (value >= 100_000_000) return `${Math.round(value / 10_000_000) / 10}亿`;
  if (value >= 10_000) return `${Math.round(value / 1_000) / 10}万`;
  return String(Math.round(value));
}

function pointY(value: number, max: number): number {
  return PAD.top + PLOT_H - (value / max) * PLOT_H;
}

/** Uniform integer stride so short ranges never drop a lone middle day (e.g. 11/18 of 7). */
function tickIndexes(count: number, limit: number): number[] {
  if (count <= limit) return Array.from({ length: count }, (_, index) => index);
  const stride = Math.ceil((count - 1) / Math.max(1, limit - 1));
  const indexes: number[] = [];
  for (let index = 0; index < count; index += stride) indexes.push(index);
  const last = indexes[indexes.length - 1];
  if (last !== count - 1) {
    if (count - 1 - last <= stride * 0.75 && indexes.length > 1)
      indexes[indexes.length - 1] = count - 1;
    else indexes.push(count - 1);
  }
  return indexes;
}

const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

function StatSeriesPaint({
  dataKey,
  active,
  children,
}: {
  dataKey: string;
  active: boolean;
  children: ReactNode;
}) {
  const groupRef = useRef<SVGGElement>(null);
  const clientMounted = useSyncExternalStore(subscribeNothing, onClient, onServer);
  const canEnter = useRef(clientMounted);
  const [event, setEvent] = useState({
    key: dataKey,
    category: 'entrance' as 'entrance' | 'feedback',
  });
  if (event.key !== dataKey) setEvent({ key: dataKey, category: 'feedback' });
  const pending = useRef({ event, value: true });
  const previousMode = useRef<string | null>(null);
  const entranceTier = useMotionTier('entrance');
  const entranceScale = useMotionScale('entrance');
  const feedbackTier = useMotionTier('feedback');
  const feedbackScale = useMotionScale('feedback');
  const tier = event.category === 'entrance' ? entranceTier : feedbackTier;
  const scale = event.category === 'entrance' ? entranceScale : feedbackScale;

  useLayoutEffect(() => {
    const changed = pending.current.event !== event;
    const mode = `${active}:${tier}:${scale}`;
    if (changed) pending.current = { event, value: true };
    else if (previousMode.current !== null && previousMode.current !== mode)
      pending.current.value = false;
    previousMode.current = mode;
    const current = pending.current;
    const group = groupRef.current;
    const plot = group?.ownerSVGElement?.parentElement;
    const blockedEntrance =
      event.category === 'entrance' &&
      (!canEnter.current || !entranceMotion() || (plot && routeTransitActive(plot)));
    if (!group || !active || group.closest('[inert]') || tier === 'off' || blockedEntrance) {
      current.value = false;
      return;
    }
    if (!current.value) return;

    // Percent-based clips follow resizing without restarting. Hydration is not an entrance;
    // StrictMode's setup/cleanup/setup may replay an unfinished event before its first paint.
    const frames =
      tier === 'standard'
        ? [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }]
        : [{ opacity: 0 }, { opacity: 1 }];
    const animation = group.animate(frames, {
      ...springTiming('defaultEffects', event.category),
      delay: event.category === 'feedback' ? scaledMs(HANDOFF_MS, 'feedback') : 0,
      fill: 'backwards',
    });
    animation.onfinish = () => {
      current.value = false;
    };
    return () => {
      animation.cancel();
    };
  }, [event, active, tier, scale]);

  return (
    <g ref={groupRef} data-stat-series="">
      {children}
    </g>
  );
}

export default function StatChart({
  series,
  buckets,
  overviewLabel,
  detailQualifier,
  ariaLabel,
  loading = false,
  active: isActive = true,
  className = '',
}: StatChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const areaGradId = `stat-area-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [width, setWidth] = useState(720);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<Inspection | null>(null);
  const count = buckets.length;
  const contentKey = `${series.map((item) => item.key).join('|')}:${buckets.map((bucket) => bucket.key).join('|')}`;
  const dataKey = `${contentKey}:${series.map((item) => item.values.join(',')).join('|')}`;
  const hasData = count > 0 && series.length > 0;
  const plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const maxValue = Math.max(0, ...series.flatMap((item) => item.values));
  const step = niceStep(maxValue / 4);
  const max = step * 4;
  const yTicks = [0, step, step * 2, step * 3, step * 4];
  const xTicks = tickIndexes(count, Math.min(7, Math.max(2, Math.floor(plotWidth / 72))));
  // Never carry a hovered bucket into another view or revive it on returning to a tab.
  const valid =
    selection && isActive && !loading && selection.key === contentKey && selection.index < count;
  if (selection && !valid) setSelection(null);
  const active = valid ? selection.index : null;
  const bucket = active === null ? null : buckets[active];
  const pointX = (index: number) =>
    PAD.left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
  const linePath = (item: ChartSeries) =>
    item.values
      .map(
        (value, index) =>
          `${index === 0 ? 'M' : 'L'}${pointX(index).toFixed(1)},${pointY(value, max).toFixed(1)}`,
      )
      .join(' ');

  // Keep axis type at CSS-pixel size without forcing layout in concealed tab panes.
  useLayoutEffect(() => {
    const plot = plotRef.current;
    if (!plot || !isActive) return;
    const measure = (pixels: number) => {
      const next = Math.round(pixels);
      if (next > 0) setWidth((current) => (current === next ? current : next));
    };
    measure(plot.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(plot);
    return () => observer.disconnect();
  }, [isActive]);

  function inspect(index: number, source: Inspection['source'], toggle = false) {
    setSelection((current) => {
      if (current?.key === contentKey && current.index === index && current.source === source)
        return toggle ? null : current;
      return { key: contentKey, index, source };
    });
  }

  function selectAt(clientX: number, source: Inspection['source'], toggle = false) {
    if (loading || !hasData) return;
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - PAD.left) / plotWidth));
    inspect(Math.round(ratio * (count - 1)), source, toggle);
  }

  return (
    <figure className={cn('@container m-0 min-w-0', className)}>
      <figcaption className="sr-only">{ariaLabel}</figcaption>
      {hasData ? (
        <div
          role="status"
          aria-live={focused && (!selection || selection.source === 'select') ? 'polite' : 'off'}
          aria-atomic="true"
          className="mb-4 border-b border-outline-variant pb-3"
        >
          <p className="text-label-m text-on-surface-variant tabular-nums">
            {bucket ? (
              <>
                <time dateTime={bucket.key}>{bucket.detail}</time>
                {detailQualifier && ` · ${detailQualifier}`}
              </>
            ) : (
              overviewLabel
            )}
          </p>
          <dl
            className={cn(
              'mt-2 grid gap-x-4 gap-y-2',
              series.length > 2
                ? 'grid-cols-2 @lg:grid-cols-4'
                : series.length === 2 && 'grid-cols-2',
            )}
          >
            {series.map((item, seriesIndex) => {
              const dash =
                series.length > 1 ? SERIES_DASH[seriesIndex % SERIES_DASH.length] : undefined;
              return (
                <div key={item.key} className="min-w-0">
                  <dt className="text-label-m text-on-surface-variant flex items-center gap-2">
                    <svg
                      width={18}
                      height={6}
                      viewBox="0 0 18 6"
                      className={cn(
                        'shrink-0 forced-colors:text-[color:CanvasText]',
                        TONE[item.tone],
                      )}
                      aria-hidden="true"
                    >
                      <line
                        x1={1}
                        x2={17}
                        y1={3}
                        y2={3}
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeDasharray={dash}
                      />
                    </svg>
                    {item.label}
                  </dt>
                  <dd className="text-headline-s text-on-surface tabular-nums wrap-anywhere">
                    {formatExactCount(active === null ? item.summary : item.values[active])}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ) : loading ? (
        <div aria-hidden="true" className="mb-4 border-b border-outline-variant pb-3">
          <Skeleton className="h-4 w-24" />
          <div
            className={cn(
              'mt-2 grid gap-x-4 gap-y-2',
              series.length > 2
                ? 'grid-cols-2 @lg:grid-cols-4'
                : series.length === 2 && 'grid-cols-2',
            )}
          >
            {(series.length > 0 ? series : [{ key: 'placeholder' }]).map((item, idx) => (
              <div key={item.key} className="min-w-0">
                <Skeleton className="h-4 w-16" delay={idx * 40} />
                <Skeleton className="mt-1 h-7 w-24" delay={idx * 40 + 40} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div ref={plotRef} className="min-w-0" aria-busy={loading || undefined}>
        <SwapContent contentKey={contentKey} active={isActive}>
          {hasData ? (
            <div
              role="group"
              aria-label={ariaLabel}
              aria-describedby={hintId}
              tabIndex={0}
              className="relative select-none touch-manipulation rounded-sm cursor-crosshair focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
              onPointerMove={(event) => {
                if (event.pointerType !== 'touch') selectAt(event.clientX, 'hover');
              }}
              onPointerDown={(event) => {
                if (event.isPrimary && event.button === 0)
                  selectAt(event.clientX, 'select', event.pointerType === 'touch');
              }}
              onPointerCancel={() => setSelection(null)}
              onPointerLeave={() =>
                setSelection((current) => (current?.source === 'hover' ? null : current))
              }
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                setSelection(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && active !== null) {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelection(null);
                  return;
                }
                if (loading) return;
                let next: number;
                if (event.key === 'ArrowLeft')
                  next = active === null ? count - 1 : Math.max(0, active - 1);
                else if (event.key === 'ArrowRight')
                  next = active === null ? 0 : Math.min(count - 1, active + 1);
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = count - 1;
                else return;
                event.preventDefault();
                inspect(next, 'select');
              }}
            >
              <svg
                viewBox={`0 0 ${width} ${HEIGHT}`}
                className="h-60 w-full"
                focusable="false"
                aria-hidden="true"
              >
                {series.length === 1 && (
                  <defs>
                    <linearGradient
                      id={areaGradId}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                      className={TONE[series[0].tone]}
                    >
                      <stop
                        offset="0%"
                        stopColor="currentColor"
                        style={{ stopOpacity: 'var(--md-sys-chart-area-opacity)' }}
                      />
                      <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                )}
                {yTicks.map((value) => {
                  const y = pointY(value, max);
                  const baseline = value === 0;
                  return (
                    <g key={value}>
                      <line
                        x1={PAD.left}
                        x2={width - PAD.right}
                        y1={y}
                        y2={y}
                        stroke="currentColor"
                        strokeWidth={1}
                        strokeDasharray={baseline ? undefined : '2 3'}
                        vectorEffect="non-scaling-stroke"
                        className={baseline ? 'text-outline' : 'text-outline-variant'}
                      />
                      <text
                        x={PAD.left - 8}
                        y={y + 4}
                        textAnchor="end"
                        fill="currentColor"
                        className="text-label-s text-on-surface-variant tabular-nums"
                      >
                        {axisValue(value)}
                      </text>
                    </g>
                  );
                })}
                {xTicks.map((index) => (
                  <text
                    key={index}
                    x={pointX(index)}
                    y={HEIGHT - 8}
                    textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}
                    fill="currentColor"
                    className="text-label-s text-on-surface-variant tabular-nums"
                  >
                    {buckets[index].tick}
                  </text>
                ))}
                <StatSeriesPaint dataKey={dataKey} active={isActive}>
                  {series.length === 1 && (
                    <path
                      d={`${linePath(series[0])} L${pointX(count - 1).toFixed(1)},${pointY(0, max).toFixed(1)} L${pointX(0).toFixed(1)},${pointY(0, max).toFixed(1)} Z`}
                      fill={`url(#${areaGradId})`}
                      className={cn(TONE[series[0].tone], 'forced-colors:hidden')}
                    />
                  )}
                  {series.map((item, seriesIndex) => {
                    const path = linePath(item);
                    const lastX = pointX(count - 1);
                    const lastY = pointY(item.values[count - 1] ?? 0, max);
                    const dash =
                      series.length > 1 ? SERIES_DASH[seriesIndex % SERIES_DASH.length] : undefined;
                    return (
                      <g key={item.key} className={TONE[item.tone]}>
                        <path
                          d={path}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeDasharray={dash}
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle cx={lastX} cy={lastY} r={2.5} fill="currentColor" />
                      </g>
                    );
                  })}
                </StatSeriesPaint>
                {active !== null && (
                  <>
                    <line
                      x1={pointX(active)}
                      x2={pointX(active)}
                      y1={PAD.top}
                      y2={HEIGHT - PAD.bottom}
                      stroke="currentColor"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      className="text-outline"
                    />
                    {series.map((item) => (
                      <g key={item.key} className={TONE[item.tone]}>
                        <circle
                          cx={pointX(active)}
                          cy={pointY(item.values[active] ?? 0, max)}
                          r={7}
                          fill="currentColor"
                          style={{ fillOpacity: 'var(--md-sys-chart-halo-opacity)' }}
                        />
                        <circle
                          cx={pointX(active)}
                          cy={pointY(item.values[active] ?? 0, max)}
                          r={3.5}
                          fill="currentColor"
                        />
                      </g>
                    ))}
                  </>
                )}
              </svg>
              {loading && (
                <Skeleton
                  variant="overlay"
                  className="pointer-events-none absolute rounded-sm"
                  style={{ left: PAD.left, right: PAD.right, top: PAD.top, bottom: PAD.bottom }}
                />
              )}
            </div>
          ) : loading ? (
            <Skeleton className="h-60 w-full rounded-sm" />
          ) : (
            <div className="flex h-60 items-center justify-center">
              <EmptyState
                size="inline"
                title="此时间范围暂无数据"
                description="请选择其他日期范围"
                entrance={false}
              />
            </div>
          )}
        </SwapContent>
      </div>
      <p id={hintId} className="sr-only">
        使用左右方向键查看各时段的数据，Home 和 End 跳至首尾，Esc 返回汇总。
      </p>
    </figure>
  );
}
