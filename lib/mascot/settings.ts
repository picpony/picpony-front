import type { SyncedSetting } from '@/lib/settingsSync';
import { commitEntranceMotion } from '@/lib/appearance';
import { LS_KEYS } from '@/lib/constants';

export type MascotSize = 'small' | 'medium' | 'large' | 'xlarge';
export interface MascotSyncedValues {
  showMascot: boolean;
  mascotId: string;
  mascotSizeDesktop: MascotSize;
  mascotSizeMobile: MascotSize;
  introAnimationEnabled: boolean;
}

declare module '@/lib/settingsSync' {
  // The interface must merge into the shared registry's public value contract.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SyncedValues extends MascotSyncedValues {}
}

export const MASCOT_KEYS = {
  showMascot: LS_KEYS.mascotVisible,
  mascotId: LS_KEYS.mascotId,
  mascotSizeDesktop: LS_KEYS.mascotSizeDesktop,
  mascotSizeMobile: LS_KEYS.mascotSizeMobile,
  introAnimationEnabled: LS_KEYS.legacyIntroAnimation,
  collapsed: LS_KEYS.mascotCollapsed,
} as const;

export function readStored(key: string): string | null {
  try { return typeof window === 'undefined' ? null : localStorage.getItem(key); } catch { return null; }
}
export function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* The account copy can still persist. */ }
}
export function booleanOf(value: unknown): boolean | undefined {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
}
export function introEnabled(current: unknown, legacy: unknown): boolean {
  if (current === 'on') return true;
  if (current === 'off') return false;
  return booleanOf(current) ?? booleanOf(legacy) ?? true;
}
export function sizeOf(value: unknown): MascotSize | undefined {
  return value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge' ? value : undefined;
}
export function mascotIdOf(value: unknown): string | undefined {
  if (value === 'auto' || value === '') return 'auto';
  const id = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? String(id) : undefined;
}

function setting<K extends keyof MascotSyncedValues>(
  id: K, fallback: MascotSyncedValues[K], parse: (value: unknown) => MascotSyncedValues[K] | undefined,
  legacyKey?: string,
): SyncedSetting<MascotSyncedValues[K]> {
  return {
    id, cloudKeys: [id], fallback, scope: 'device',
    read: () => parse(readStored(MASCOT_KEYS[id])) ?? (legacyKey ? parse(readStored(legacyKey)) : undefined) ?? fallback,
    write: value => writeStored(MASCOT_KEYS[id], String(value)),
    fromCloud: cloud => parse(cloud[id]) ?? (id.startsWith('mascotSize') ? parse(cloud.mascotSize) : undefined),
    toCloud: value => ({ [id]: value }),
    equals: (a, b) => a === b,
  };
}

export const mascotSettings: readonly SyncedSetting<unknown>[] = [
  setting('showMascot', true, booleanOf),
  setting('mascotId', 'auto', mascotIdOf, LS_KEYS.legacyMascotId),
  setting('mascotSizeDesktop', 'large', sizeOf, LS_KEYS.legacyMascotSize),
  setting('mascotSizeMobile', 'medium', sizeOf, LS_KEYS.legacyMascotSize),
  {
    ...setting('introAnimationEnabled', true, booleanOf),
    read: () => introEnabled(readStored(LS_KEYS.entranceMotion), readStored(MASCOT_KEYS.introAnimationEnabled)),
    write: (value: unknown) => {
      const enabled = value === true;
      writeStored(MASCOT_KEYS.introAnimationEnabled, String(enabled));
      commitEntranceMotion(enabled);
    },
  },
];

export const MASCOT_PIXELS = {
  desktop: { small: 120, medium: 180, large: 240, xlarge: 300 },
  mobile: { small: 90, medium: 120, large: 160, xlarge: 200 },
} as const;
