import type { SyncedSetting } from '@/lib/settingsSync';
import { commitEntranceMode, type EntranceMode } from '@/lib/appearance';
import { COOKIE_KEYS, LS_KEYS } from '@/lib/constants';

export type MascotSize = 'small' | 'medium' | 'large' | 'xlarge';
export interface MascotSyncedValues {
  showMascot: boolean;
  mascotId: string;
  mascotSizeDesktop: MascotSize;
  mascotSizeMobile: MascotSize;
  introAnimation: EntranceMode;
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
/**
 * 入场动画 on this device: the current store's mode — `on`, what builds before the three modes
 * wrote, is 不阻塞 — else the original front end's boolean, else the default.
 */
export function introMode(current: unknown, legacy: unknown): EntranceMode {
  if (current === 'blocking' || current === 'non-blocking' || current === 'off') return current;
  if (current === 'on') return 'non-blocking';
  const enabled = booleanOf(current) ?? booleanOf(legacy);
  return enabled === false ? 'off' : 'non-blocking';
}
export function sizeOf(value: unknown): MascotSize | undefined {
  return value === 'small' || value === 'medium' || value === 'large' || value === 'xlarge' ? value : undefined;
}
export function mascotIdOf(value: unknown): string | undefined {
  if (value === 'auto' || value === '') return 'auto';
  const id = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? String(id) : undefined;
}

function setting<K extends keyof MascotSyncedValues & keyof typeof MASCOT_KEYS>(
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

/**
 * 入场动画, through the entrance-motion store (`commitEntranceMode`, which owns its key, cookie and
 * attribute). The original front end's `introAnimationEnabled` still says whether it plays at
 * all, and its local key is kept in step for it; whether it blocks is this app's own
 * `introAnimationBlocking`, which the original front end neither shows nor needs. An account that
 * says it plays without saying how leaves this device's choice of the two as it is.
 *
 * `cookie` has the sync engine mirror the mode into the server's cookie from storage every time it
 * starts, not only when it changes: 阻塞 is only in the first byte when the cookie says so, and a
 * cookie written by script lapses on its own (Safari keeps one seven days) while storage stays.
 */
const introAnimationSetting: SyncedSetting<EntranceMode> = {
  id: 'introAnimation',
  cloudKeys: ['introAnimationEnabled', 'introAnimationBlocking'],
  fallback: 'non-blocking',
  scope: 'device',
  cookie: COOKIE_KEYS.entranceMotion,
  read: () => introMode(readStored(LS_KEYS.entranceMotion), readStored(LS_KEYS.legacyIntroAnimation)),
  write: (value) => {
    writeStored(LS_KEYS.legacyIntroAnimation, String(value !== 'off'));
    commitEntranceMode(value);
  },
  fromCloud: (cloud) => {
    const enabled = booleanOf(cloud.introAnimationEnabled);
    const blocking = booleanOf(cloud.introAnimationBlocking);
    if (enabled === false) return 'off';
    if (blocking !== undefined) return blocking ? 'blocking' : 'non-blocking';
    if (enabled === undefined) return undefined;
    return introAnimationSetting.read() === 'off' ? 'non-blocking' : undefined;
  },
  toCloud: (value) => ({ introAnimationEnabled: value !== 'off', introAnimationBlocking: value === 'blocking' }),
  equals: (a, b) => a === b,
};

export const mascotSettings: readonly SyncedSetting<unknown>[] = [
  setting('showMascot', true, booleanOf),
  setting('mascotId', 'auto', mascotIdOf, LS_KEYS.legacyMascotId),
  setting('mascotSizeDesktop', 'large', sizeOf, LS_KEYS.legacyMascotSize),
  setting('mascotSizeMobile', 'medium', sizeOf, LS_KEYS.legacyMascotSize),
  introAnimationSetting as SyncedSetting<unknown>,
];

export const MASCOT_PIXELS = {
  desktop: { small: 120, medium: 180, large: 240, xlarge: 300 },
  mobile: { small: 90, medium: 120, large: 160, xlarge: 200 },
} as const;
