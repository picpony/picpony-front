import { clamp } from '@/lib/utils';

export interface RangeValue {
  start: number;
  end: number;
}

export type RangeHandle = 'start' | 'end';

export function sameRange(a: RangeValue, b: RangeValue) {
  return a.start === b.start && a.end === b.end;
}

/** Match native range's step grid, including a maximum which is not itself on the grid. */
export function snapRangeValue(value: number, min: number, max: number, step: number) {
  const index = Math.min(
    Math.round((clamp(value, min, max) - min) / step),
    Math.floor((max - min) / step + 1e-10),
  );
  return clamp(Number((min + index * step).toPrecision(15)), min, max);
}

export function normalizeRange(
  value: RangeValue,
  min: number,
  max: number,
  step: number,
): RangeValue {
  const start = snapRangeValue(value.start, min, max, step);
  const end = snapRangeValue(value.end, min, max, step);
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Switch the active role at a crossing; the stationary physical handle must not drift. */
export function moveRangeHandle(
  value: RangeValue,
  handle: RangeHandle,
  next: number,
): { value: RangeValue; handle: RangeHandle } {
  if (handle === 'start') {
    return next > value.end
      ? { value: { start: value.end, end: next }, handle: 'end' }
      : { value: { start: next, end: value.end }, handle };
  }
  return next < value.start
    ? { value: { start: next, end: value.start }, handle: 'start' }
    : { value: { start: value.start, end: next }, handle };
}
