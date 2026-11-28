'use client';

import RangeSlider from '@/components/RangeSlider';
import { formatChineseDay, type StatsWindow } from '@/lib/statsDates';

interface DateRangeSliderProps {
  /** Earliest selectable day, `YYYY-MM-DD`. */
  min: string;
  /** Latest selectable day, `YYYY-MM-DD`. */
  max: string;
  value: StatsWindow;
  onCommit: (next: StatsWindow) => void;
  className?: string;
}

const DAY_MS = 86_400_000;

function dayIndex(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
}

function dayFromIndex(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar-only adapter; shared numeric range owns drafts, input, paint and commit deduplication.
 * See docs/design/layout.md#slider. */
export default function DateRangeSlider({ min, max, value, onCommit, className = '' }: DateRangeSliderProps) {
  return (
    <RangeSlider
      min={dayIndex(min)}
      max={dayIndex(max)}
      step={1}
      value={{ start: dayIndex(value.start), end: dayIndex(value.end) }}
      onCommit={(next) => onCommit({ start: dayFromIndex(next.start), end: dayFromIndex(next.end) })}
      startLabel="开始日期"
      endLabel="结束日期"
      aria-label="日期范围"
      valueText={(index) => formatChineseDay(dayFromIndex(index))}
      className={className}
      renderValue={(shown) => (
        <div className="text-label-s text-on-surface-variant mt-1 flex min-h-6 items-center justify-between gap-3 tabular-nums">
          <span>{formatChineseDay(dayFromIndex(shown.start))}</span>
          <span>{formatChineseDay(dayFromIndex(shown.end))}</span>
        </div>
      )}
    />
  );
}
