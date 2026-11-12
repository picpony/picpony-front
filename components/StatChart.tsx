'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatExactCount } from '@/lib/format';

/**
 * A time-series line chart for /stats.
 *
 * Deliberately dependency-free SVG: the page draws four small charts, and a charting library
 * would outweigh them. The x axis is time (one point per server bucket) and the y axis is a
 * count; the scale is nicened to 1/2/5 steps so gridlines read as round numbers.
 *
 * Colour comes from the M3 roles through `currentColor`, never a raw value: every series is a
 * `<g>` carrying its tone class, and the strokes, dots and legend swatch inherit it.
 */

export type ChartTone = 'primary' | 'secondary' | 'tertiary' | 'neutral';

export interface ChartSeries {
  /** Stable key for React; not shown. */
  key: string;
  label: string;
  values: number[];
  tone: ChartTone;
}

interface StatChartProps {
  series: ChartSeries[];
  /** One label per value — the bucket's calendar date, already formatted by the caller. */
  labels: string[];
  /** Read out as the chart's accessible name; it should summarise the direction, not the axes. */
  ariaLabel: string;
  /** The window is being re-read: a horizontal sweep crosses the plot until it lands. */
  loading?: boolean;
  /** Trailing controls on the legend row — the daily/cumulative view switch. */
  actions?: ReactNode;
  className?: string;
}

const TONE: Record<ChartTone, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  tertiary: 'text-tertiary',
  neutral: 'text-on-surface-variant',
};

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 48 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

/** A round step (1, 2 or 5 × 10ⁿ) at or above `rough`, so four gridlines land on clean values. */
function niceStep(rough: number): number {
  if (!(rough > 0)) return 1;
  /* Counts are whole numbers, so the step never drops below 1 — otherwise four gridlines on a
     chart whose maximum is one would all read `0` or `1` after rounding. */
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

/** Axis ink stays short: full counts belong to the headline above the chart. */
function axisValue(value: number): string {
  if (value >= 100_000_000) return `${Math.round(value / 10_000_000) / 10}亿`;
  if (value >= 10_000) return `${Math.round(value / 1_000) / 10}万`;
  return String(Math.round(value));
}

function pointX(index: number, count: number): number {
  if (count <= 1) return PAD.left + PLOT_W / 2;
  return PAD.left + (index / (count - 1)) * PLOT_W;
}

function pointY(value: number, max: number): number {
  return PAD.top + PLOT_H - (value / max) * PLOT_H;
}

/** At most six labels, endpoints included, so the row reads as time rather than as confetti. */
function tickIndexes(count: number): number[] {
  if (count <= 6) return Array.from({ length: count }, (_, i) => i);
  const indexes = new Set<number>([0, count - 1]);
  for (let i = 1; i < 6; i += 1) indexes.add(Math.round((i / 6) * (count - 1)));
  return [...indexes].sort((a, b) => a - b);
}

export default function StatChart({ series, labels, ariaLabel, loading = false, actions, className = '' }: StatChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const count = labels.length;
  const maxValue = Math.max(0, ...series.flatMap((s) => s.values));
  const step = niceStep(maxValue / 4);
  const max = step * 4;
  const yTicks = [0, step, step * 2, step * 3, step * 4];
  const xTicks = count ? tickIndexes(count) : [];
  /* The area under a lone series gives the chart a direction; with several, overlapping fills
     turn the plot into mud, so only the strokes are drawn. */
  const area = series.length === 1;

  if (!count || !series.length) {
    return (
      <p className={cn('text-body-s text-on-surface-variant py-12 text-center', className)}>暂无数据</p>
    );
  }

  /* A bucket is highlighted only while the pointer is over the plot, and never over a stale
     chart that is being replaced. */
  const active = !loading && hover !== null && hover < count ? hover : null;
  const activeX = active === null ? 0 : pointX(active, count);
  const tooltipLeft = (activeX / WIDTH) * 100;
  /* Keep the tooltip inside the plot at both ends instead of letting it hang off the card. */
  const tooltipShift =
    activeX < PAD.left + PLOT_W * 0.2 ? '0' : activeX > PAD.left + PLOT_W * 0.8 ? '-100%' : '-50%';

  return (
    <figure className={cn('m-0', className)}>
      <figcaption className="sr-only">{ariaLabel}</figcaption>
      <div className="text-label-m mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((item) => (
            <span key={item.key} className="flex items-center gap-1.5 text-on-surface-variant">
              <span className={cn('h-0.5 w-4 rounded-full bg-current', TONE[item.tone])} aria-hidden="true" />
              {item.label}
            </span>
          ))}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div
        className={cn('relative', !loading && 'cursor-crosshair')}
        aria-busy={loading || undefined}
        onPointerMove={(event) => {
          if (loading || event.pointerType === 'touch') return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          const left = rect.left + (PAD.left / WIDTH) * rect.width;
          const width = ((WIDTH - PAD.left - PAD.right) / WIDTH) * rect.width;
          const ratio = Math.min(1, Math.max(0, (event.clientX - left) / width));
          setHover(Math.round(ratio * (count - 1)));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          focusable="false"
          aria-hidden="true"
        >
        {yTicks.map((value) => {
          const y = pointY(value, max);
          return (
            <g key={value} className="text-on-surface-variant">
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="opacity-20"
              />
              <text
                x={PAD.left - 8}
                y={y + 4}
                textAnchor="end"
                fill="currentColor"
                className="text-label-s tabular-nums"
              >
                {axisValue(value)}
              </text>
            </g>
          );
        })}
        {xTicks.map((index) => (
          <text
            key={index}
            x={pointX(index, count)}
            y={HEIGHT - 8}
            textAnchor={index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'}
            fill="currentColor"
            className="text-label-s text-on-surface-variant"
          >
            {labels[index]}
          </text>
        ))}
        {series.map((item) => {
          const path = item.values
            .map((value, index) => {
              const x = pointX(index, count).toFixed(1);
              const y = pointY(value, max).toFixed(1);
              return `${index === 0 ? 'M' : 'L'}${x},${y}`;
            })
            .join(' ');
          const lastX = pointX(count - 1, count);
          const lastY = pointY(item.values[count - 1] ?? 0, max);
          const baseY = pointY(0, max);
          return (
            <g key={item.key} className={TONE[item.tone]}>
              {area && (
                <path
                  d={`${path} L${lastX.toFixed(1)},${baseY.toFixed(1)} L${pointX(0, count).toFixed(1)},${baseY.toFixed(1)} Z`}
                  fill="currentColor"
                  className="opacity-10"
                />
              )}
              <path
                d={path}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              >
                <title>
                  {item.label}：{item.values[count - 1]}（{labels[count - 1]}）
                </title>
              </path>
              <circle cx={lastX} cy={lastY} r={2.5} fill="currentColor" />
            </g>
          );
        })}
        {active !== null && (
          <g className="text-outline-variant">
            <line
              x1={activeX}
              x2={activeX}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              className="opacity-60"
            />
          </g>
        )}
        {active !== null &&
          series.map((item) => (
            <circle
              key={`hover-${item.key}`}
              cx={activeX}
              cy={pointY(item.values[active] ?? 0, max)}
              r={3}
              fill="currentColor"
              className={TONE[item.tone]}
            />
          ))}
      </svg>
        {active !== null && (
          <div
            aria-hidden="true"
            className="bg-surface-container-highest text-on-surface shadow-e2 pointer-events-none absolute top-1 z-10 min-w-32 rounded-md px-2.5 py-1.5 text-label-s"
            style={{ left: `${tooltipLeft}%`, transform: `translateX(${tooltipShift})` }}
          >
            <p className="text-label-s-emphasized mb-1 tabular-nums">{labels[active]}</p>
            <ul className="flex flex-col gap-0.5">
              {series.map((item) => (
                <li key={item.key} className="flex items-center justify-between gap-3 tabular-nums">
                  <span className="text-on-surface-variant flex items-center gap-1.5">
                    <span
                      className={cn('h-0.5 w-3 rounded-full bg-current', TONE[item.tone])}
                      aria-hidden="true"
                    />
                    {item.label}
                  </span>
                  <span>{formatExactCount(item.values[active])}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {loading && (
          <span
            aria-hidden="true"
            className="skeleton pointer-events-none absolute rounded-md"
            /* Only the plotting rectangle: the y tick labels sit left of PAD.left and the x
               labels below PAD.bottom, so the sweep must stop short of both. */
            style={{
              left: `${(PAD.left / WIDTH) * 100}%`,
              right: `${(PAD.right / WIDTH) * 100}%`,
              top: `${(PAD.top / HEIGHT) * 100}%`,
              bottom: `${(PAD.bottom / HEIGHT) * 100}%`,
            }}
          />
        )}
      </div>
    </figure>
  );
}
