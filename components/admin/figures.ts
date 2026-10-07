import { formatExactCount } from '@/lib/format';

/**
 * A figure off the wire — a price, a stock, a balance, a sort order — or `null` when it did not
 * arrive: absent, blank, a boolean, anything that is not a finite number. The console is where
 * these figures are set, so a missing one must not read as 0 (G4-015: an item whose price had not
 * arrived was listed as free, and its editor offered 0 to save). The same rule the user shop's
 * adapter follows. A negative figure is shown as it is: it is data the operator needs to see.
 */
export function figureOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** A figure in a table cell: exact and grouped (`formatExactCount`), or `—` when it did not arrive. */
export function figureText(value: unknown): string {
  const figure = figureOf(value);
  return figure === null ? '—' : formatExactCount(figure);
}

/** A figure in a form field: its digits, or empty when it did not arrive — the field then asks for it. */
export function figureField(value: unknown): string {
  const figure = figureOf(value);
  return figure === null ? '' : String(figure);
}
