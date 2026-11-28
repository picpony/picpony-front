/**
 * Pure time-of-day scheduling for the dynamic 天空 palette.
 *
 * Plain module with zero HCT or framework imports: shared by `app/layout.tsx` (SSR and inline
 * pre-paint schedule), `lib/appearance.ts` (live clock resolution) and `/settings` (phase labels
 * and ribbon preview).
 */

import {
  DEFAULT_SKY_PHASE,
  SKY_PHASES,
  isSkyPhaseId,
  type SkyPhaseEntry,
  type SkyPhaseId,
} from './generated/themeColors';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
/** Small buffer past the exact hour boundary so `getHours()` is reliably in the next phase. */
const BOUNDARY_BUFFER_MS = 250;

export type SkyPhase = (typeof SKY_PHASES)[number];

/** Resolve a SkyPhaseId to its generated metadata entry, falling back to `DEFAULT_SKY_PHASE`. */
export function skyPhaseEntry(id: unknown): SkyPhase {
  if (isSkyPhaseId(id)) {
    const found = SKY_PHASES.find((phase) => phase.id === id);
    if (found) return found;
  }
  return SKY_PHASES.find((phase) => phase.id === DEFAULT_SKY_PHASE) ?? SKY_PHASES[0];
}

/** The active 天空 phase for a local hour (`0..23`). */
export function skyPhaseForHour(hour: number): SkyPhase {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  return SKY_PHASES.find((phase) => normalized >= phase.startHour && normalized < phase.endHour) ?? SKY_PHASES[0];
}

/** The active 天空 phase at `date` in the device's local timezone. */
export function skyPhaseAt(date: Date = new Date()): SkyPhase {
  return skyPhaseForHour(date.getHours());
}

/**
 * Fallback 天空 phase at `date` on the Beijing calendar (UTC+8), used only at SSR when a visitor
 * has `palette=sky` without a `skyPhase` cookie yet. The inline pre-paint script immediately
 * refines this to the browser's local clock before first paint.
 */
export function skyPhaseAtBeijing(date: Date = new Date()): SkyPhase {
  const beijingHour = new Date(date.getTime() + BEIJING_OFFSET_MS).getUTCHours();
  return skyPhaseForHour(beijingHour);
}

const padHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** Formatted hour window, e.g. `09:00–13:00` or `21:00–24:00`. */
export function skyPhaseRangeLabel(phase: Pick<SkyPhaseEntry, 'startHour' | 'endHour'>): string {
  return `${padHour(phase.startHour)}–${padHour(phase.endHour)}`;
}

/**
 * Milliseconds until the next 天空 phase boundary from `date` in local time, including a small
 * positive buffer so the fired callback observes the new hour.
 */
export function msUntilNextSkyPhase(date: Date = new Date()): number {
  const current = skyPhaseAt(date);
  const next = new Date(date.getTime());
  if (current.endHour >= 24) {
    next.setHours(24, 0, 0, 0);
  } else {
    next.setHours(current.endHour, 0, 0, 0);
  }
  return Math.max(1000, next.getTime() - date.getTime() + BOUNDARY_BUFFER_MS);
}

/** Phases ordered from dawn (06:00) through midnight and predawn for the visual day→night strip. */
export const SKY_PHASES_DAY_FIRST: readonly SkyPhase[] = [
  ...SKY_PHASES.filter((phase) => phase.scheme === 'light'),
  ...SKY_PHASES.filter((phase) => phase.scheme === 'dark' && phase.startHour >= 12),
  ...SKY_PHASES.filter((phase) => phase.scheme === 'dark' && phase.startHour < 12),
];

/**
 * Compact `[startHour, id, isDark, primary]` rows embedded into `app/layout.tsx`'s inline
 * pre-paint script so first paint resolves the local sky phase without duplicating boundaries or
 * hex literals.
 */
export function skyPrePaintSchedule(): readonly (readonly [number, SkyPhaseId, 0 | 1, string])[] {
  return SKY_PHASES.map(
    (phase) => [phase.startHour, phase.id, phase.scheme === 'dark' ? 1 : 0, phase.primary] as const,
  );
}
