'use client';

import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
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
}

interface StatChartProps {
  series: ChartSeries[];
  /** One already-formatted calendar label per bucket. */
  labels: string[];
  ariaLabel: string;
  loading?: boolean;
  /** Only the selected chart plays data feedback; concealed peers retain final paint. */
  active?: boolean;
  /** Controls stay outside the plot swap, so a view change preserves focus. */
  actions?: ReactNode;
  className?: string;
}

const TONE: Record<ChartTone, string> = {
  primary: 'text-primary-ink',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  neutral: 'text-on-surface-variant',
};
const AREA_TONE: Record<ChartTone, string> = {
  primary: 'text-primary-container',
  secondary: 'text-secondary-container',
  tertiary: 'text-tertiary-container',
  neutral: 'text-surface-container-low',
};

const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 48 };
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

function tickIndexes(count: number, limit: number): number[] {
  if (count <= limit) return Array.from({ length: count }, (_, index) => index);
  return Array.from({ length: limit }, (_, index) => Math.round((index / (limit - 1)) * (count - 1)));
}

const subscribeNothing = () => () => {};
const onClient = () => true;
const onServer = () => false;

function StatSeriesPaint({ dataKey, active, children }: {
  dataKey: string;
  active: boolean;
  children: ReactNode;
}) {
  const groupRef = useRef<SVGGElement>(null);
  const clientMounted = useSyncExternalStore(subscribeNothing, onClient, onServer);
  const canEnter = useRef(clientMounted);
  const [event, setEvent] = useState({ key: dataKey, category: 'entrance' as 'entrance' | 'feedback' });
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
    else if (previousMode.current !== null && previousMode.current !== mode) pending.current.value = false;
    previousMode.current = mode;
    const current = pending.current;
    const group = groupRef.current;
    const plot = group?.ownerSVGElement?.parentElement;
    const blockedEntrance = event.category === 'entrance' &&
      (!canEnter.current || !entranceMotion() || (plot && routeTransitActive(plot)));
    if (!group || !active || group.closest('[inert]') || tier === 'off' || blockedEntrance) {
      current.value = false;
      return;
    }
    if (!current.value) return;

    // Percent-based clips follow resizing without restarting. Hydration is not an entrance;
    // StrictMode's setup/cleanup/setup may replay an unfinished event before its first paint.
    const frames = tier === 'standard'
      ? [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }]
      : [{ opacity: 0 }, { opacity: 1 }];
    const animation = group.animate(frames, {
      ...springTiming('defaultEffects', event.category),
      delay: event.category === 'feedback' ? scaledMs(HANDOFF_MS, 'feedback') : 0,
      fill: 'backwards',
    });
    animation.onfinish = () => { current.value = false; };
    return () => { animation.cancel(); };
  }, [event, active, tier, scale]);

  return <g ref={groupRef} data-stat-series="">{children}</g>;
}

export default function StatChart({ series, labels, ariaLabel, loading = false, active: isActive = true, actions, className = '' }: StatChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [width, setWidth] = useState(720);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<{ key: string; index: number } | null>(null);
  const count = labels.length;
  const contentKey = `${series.map((item) => item.key).join('|')}:${labels.join('|')}`;
  const dataKey = `${contentKey}:${series.map((item) => item.values.join(',')).join('|')}`;
  const hasData = count > 0 && series.length > 0;
  const plotWidth = Math.max(1, width - PAD.left - PAD.right);
  const maxValue = Math.max(0, ...series.flatMap((item) => item.values));
  const step = niceStep(maxValue / 4);
  const max = step * 4;
  const yTicks = [0, step, step * 2, step * 3, step * 4];
  const xTicks = tickIndexes(count, Math.min(6, Math.max(2, Math.floor(plotWidth / 72))));
  const active = !loading && selection?.key === contentKey && selection.index < count ? selection.index : null;
  const shown = active ?? count - 1;
  const pointX = (index: number) => PAD.left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
  const linePath = (item: ChartSeries) => item.values.map((value, index) =>
    `${index === 0 ? 'M' : 'L'}${pointX(index).toFixed(1)},${pointY(value, max).toFixed(1)}`,
  ).join(' ');

  /* Match SVG units to CSS pixels instead of shrinking the type scale with a fixed viewBox.
     ResizeObserver also follows the docked drawer and a pane becoming visible. */
  useLayoutEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const measure = () => {
      const next = Math.round(plot.getBoundingClientRect().width);
      if (next > 0) setWidth((current) => current === next ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);

  function selectAt(clientX: number) {
    if (loading || !hasData) return;
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - PAD.left) / plotWidth));
    setSelection({ key: contentKey, index: Math.round(ratio * (count - 1)) });
  }

  return (
    <figure className={cn('m-0 min-w-0', className)}>
      <figcaption className="sr-only">{ariaLabel}</figcaption>
      <div className="text-label-m mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {series.map((item) => (
            <span key={item.key} className="flex items-center gap-2 text-on-surface-variant">
              <span className={cn('h-1 w-4 rounded-full bg-current forced-mark', TONE[item.tone])} aria-hidden="true" />
              {item.label}
            </span>
          ))}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div ref={plotRef} className="min-w-0" aria-busy={loading || undefined}>
        <SwapContent contentKey={contentKey} active={isActive}>
          {hasData ? (
            <div
              role="group"
              aria-label={ariaLabel}
              aria-describedby={hintId}
              tabIndex={0}
              className="relative rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
              onPointerMove={(event) => {
                if (event.pointerType !== 'touch') selectAt(event.clientX);
              }}
              onPointerDown={(event) => selectAt(event.clientX)}
              onPointerCancel={() => setSelection(null)}
              onPointerLeave={(event) => {
                // Touch releases implicit capture before focus on some browsers. Keep the
                // tapped bucket until blur or cancellation, rather than resetting it on leave.
                if (event.pointerType !== 'touch' && !focused) setSelection(null);
              }}
              onFocus={() => {
                setFocused(true);
                setSelection((current) => current?.key === contentKey ? current : { key: contentKey, index: count - 1 });
              }}
              onBlur={() => {
                setFocused(false);
                setSelection(null);
              }}
              onKeyDown={(event) => {
                if (loading) return;
                let next: number;
                if (event.key === 'ArrowLeft') next = Math.max(0, shown - 1);
                else if (event.key === 'ArrowRight') next = Math.min(count - 1, shown + 1);
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = count - 1;
                else return;
                event.preventDefault();
                setSelection({ key: contentKey, index: next });
              }}
            >
              <svg viewBox={`0 0 ${width} ${HEIGHT}`} className="h-60 w-full" preserveAspectRatio="none" focusable="false" aria-hidden="true">
                {series.length === 1 && (
                  <path
                    d={`${linePath(series[0])} L${pointX(count - 1).toFixed(1)},${pointY(0, max).toFixed(1)} L${pointX(0).toFixed(1)},${pointY(0, max).toFixed(1)} Z`}
                    fill="currentColor"
                    className={cn(AREA_TONE[series[0].tone], 'forced-colors:hidden')}
                  />
                )}
                {yTicks.map((value) => {
                  const y = pointY(value, max);
                  return (
                    <g key={value}>
                      <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" className="text-outline-variant" />
                      <text x={PAD.left - 8} y={y + 4} textAnchor="end" fill="currentColor" className="text-label-s text-on-surface-variant tabular-nums">
                        {axisValue(value)}
                      </text>
                    </g>
                  );
                })}
                {xTicks.map((index) => (
                  <text key={index} x={pointX(index)} y={HEIGHT - 8} textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'} fill="currentColor" className="text-label-s text-on-surface-variant tabular-nums">
                    {labels[index]}
                  </text>
                ))}
                <StatSeriesPaint dataKey={dataKey} active={isActive}>
                  {series.map((item) => {
                    const path = linePath(item);
                    const lastX = pointX(count - 1);
                    const lastY = pointY(item.values[count - 1] ?? 0, max);
                    return (
                      <g key={item.key} className={TONE[item.tone]}>
                        <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                        <circle cx={lastX} cy={lastY} r={2.5} fill="currentColor" />
                      </g>
                    );
                  })}
                </StatSeriesPaint>
                {active !== null && (
                  <>
                    <line x1={pointX(active)} x2={pointX(active)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" className="text-outline" />
                    {series.map((item) => (
                      <circle key={item.key} cx={pointX(active)} cy={pointY(item.values[active] ?? 0, max)} r={3} fill="currentColor" className={TONE[item.tone]} />
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
          ) : (
            <div className="flex h-60 items-center justify-center">
              <EmptyState size="inline" title="此时间范围暂无数据" description="请选择其他日期范围" entrance={false} />
            </div>
          )}
        </SwapContent>
      </div>
      <p id={hintId} className="sr-only">使用左右方向键查看各日期的数据，Home 和 End 跳至首尾。</p>
      {/* Exact values occupy a stable row, not a pointer-only floating tooltip. Touch, keyboard
          and mouse all read the same data without covering the plot or animating its numbers. */}
      <div role="status" aria-live={focused ? 'polite' : 'off'} aria-atomic="true" className="mt-4 min-h-10 border-t border-outline-variant pt-3">
        {hasData && (
          <>
            <p className="text-label-m text-on-surface-variant tabular-nums">{labels[shown]}</p>
            <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {series.map((item) => (
                <div key={item.key} className="min-w-0">
                  <dt className="text-body-s text-on-surface-variant">{item.label}</dt>
                  <dd className="text-label-l text-on-surface tabular-nums wrap-anywhere">{formatExactCount(item.values[shown])}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </figure>
  );
}
