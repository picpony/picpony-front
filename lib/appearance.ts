'use client';

/**
 * The five device-local appearance preferences, and their only owner — the `LS_KEYS`/`COOKIE_KEYS`
 * mapping lives here: colour scheme, palette, motion tier, motion speed, entrance animations. One
 * module because they are one concern with one shape: a stored setting that may say "follow the
 * system", a resolved value on `<html>` as an attribute or a class, a cookie so the server puts it
 * there before first paint, and a subscription so the app bar glyph and /settings dropdowns cannot
 * disagree. None syncs to the account (`darkMode` was never in `CloudSettings`) — these describe
 * the device, not the person. **Read the root, not the store:** `motionTier()`, `currentPalette()`
 * and `entranceMotion()` read the `<html>` attribute, not localStorage — that is what the CSS is
 * keyed on and therefore what is in force; a stored setting may say `system`, an attribute never does.
 */

import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import { COOKIE_KEYS, LS_KEYS, MEDIA } from './constants';
import {
  CUSTOM_PALETTE,
  DEFAULT_PALETTE,
  PALETTES,
  isPaletteId,
  type PaletteId,
} from './generated/themeColors';

export { CUSTOM_PALETTE, DEFAULT_PALETTE, PALETTES };
export type { PaletteId };

export type ColorScheme = 'light' | 'dark';
export type SchemeSetting = ColorScheme | 'system';

/** What is actually in force. Never `system` — that is a *setting*, not a tier. */
export type MotionTier = 'off' | 'reduced' | 'standard';
export type MotionSetting = MotionTier | 'system';
export type MotionSpeed = 'fast' | 'default' | 'slow';

/**
 * The three speeds, as a multiplier on every duration — speed scales everything via `--motion-scale`
 * (0.7/1/1.4, reciprocals, so the rhythm between durations is unchanged; separate tables on M3's
 * 50ms grid would have let it drift). The tier decides the **form** of motion, the speed its
 * **length**; only `off` ignores the speed (zero).
 */
export const MOTION_SPEED_SCALE: Record<MotionSpeed, number> = {
  fast: 0.7,
  default: 1,
  slow: 1.4,
};

/* `SchemeSetting` needs no validation list — derived from two booleans, not read as a string;
   the other two come straight out of storage. */
const MOTION_SETTINGS: readonly MotionSetting[] = ['off', 'reduced', 'standard', 'system'];
const MOTION_SPEEDS: readonly MotionSpeed[] = ['fast', 'default', 'slow'];

/* --- Storage: both halves are wrapped (localStorage throws in a private window in some
   engines; a failed persist must not take the page down). --- */

const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

function readStored(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no-op: the attribute and the cookie still carry this session */
  }
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
}

const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(value ?? '') ? (value as T) : fallback;

/* --- The stored settings ------------------------------------------------- */

/**
 * The colour-scheme setting: the two keys the app bar's cycle button has always written (`darkMode` +
 * `followSystemPrefersColorScheme`) collapsed to one three-way value — a single new key would log
 * every existing user out of their own preference.
 */
export function readSchemeSetting(): SchemeSetting {
  const follows = readStored(LS_KEYS.followSystemScheme);
  if (follows === null || follows === 'true') return 'system';
  return readStored(LS_KEYS.darkMode) === 'true' ? 'dark' : 'light';
}

export function readMotionSetting(): MotionSetting {
  return oneOf(readStored(LS_KEYS.motion), MOTION_SETTINGS, 'system');
}

export function readMotionSpeed(): MotionSpeed {
  return oneOf(readStored(LS_KEYS.motionSpeed), MOTION_SPEEDS, 'default');
}

/* No `readPalette`/`readEntranceMotion` beside these — deliberate: every reader wants the value in
   force (the `<html>` attribute), and the stored string is read only by the pre-paint script in
   `app/layout.tsx`, which cannot import from here; an uncalled reader drifts. */

/* --- Resolving `system` ------------------------------------------------- */

const matches = (query: string) =>
  typeof window !== 'undefined' && window.matchMedia(query).matches;

export const systemPrefersDark = () => matches(MEDIA.dark);
export const systemPrefersReducedMotion = () => matches(MEDIA.reducedMotion);

export function resolveScheme(setting: SchemeSetting): ColorScheme {
  if (setting !== 'system') return setting;
  return systemPrefersDark() ? 'dark' : 'light';
}

/** `reduce` maps to the **reduced** tier, not `off`: the OS asks for less movement — that is the
 * reduced tier; a user who wants nothing picks `off`. */
export function resolveMotionTier(setting: MotionSetting): MotionTier {
  if (setting !== 'system') return setting;
  return systemPrefersReducedMotion() ? 'reduced' : 'standard';
}

/* --- What is in force — read off `<html>` ------------------------------- */

const root = () => (typeof document === 'undefined' ? null : document.documentElement);

export function currentPalette(): PaletteId {
  const value = root()?.dataset.palette;
  return isPaletteId(value) ? value : DEFAULT_PALETTE;
}

/** The seed behind the custom palette, or null when none is installed — read off `<html>` like
 * `currentPalette`: the attribute is what the injected `<style>` was built from, so it is what is
 * painted. Non-null even while another theme is in force (the eleventh chip's data). */
export function currentCustomSeed(): string | null {
  return root()?.dataset.paletteSeed ?? null;
}

/** The custom palette's two hexes, packed, or null when none is installed. The *string* is the
 * subscribed snapshot, not a parsed object — `useSyncExternalStore` compares by identity, so a
 * fresh object per call would re-render for ever; callers unpack. */
export function currentCustomTonesRaw(): string | null {
  return root()?.dataset.paletteTones ?? null;
}

/** Non-reactive convenience for `applyThemeColorMeta`, which is already inside a commit. */
export const currentCustomTones = () => unpackCustomTones(currentCustomTonesRaw());

export function currentScheme(): ColorScheme {
  return root()?.classList.contains('dark') ? 'dark' : 'light';
}

export function motionTier(): MotionTier {
  return oneOf(root()?.dataset.motion ?? null, ['off', 'reduced', 'standard'] as const, 'standard');
}

export function motionSpeed(): MotionSpeed {
  return oneOf(root()?.dataset.motionSpeed ?? null, MOTION_SPEEDS, 'default');
}

/**
 * Whether an entrance may play — the `data-entrance` attribute, present only when the answer is no.
 * Separate from the tier: the tier bounds motion a gesture you asked for may use; this decides
 * whether the app volunteers any (scroll reveal, results cascade, `Reveal`, splash — motion that
 * happens *to* you). Every reader is a call site, not a token: a `--motion-entrance` multiplier
 * beside `--motion-scale` had to come out — two keyframes serve entrances and gestures at once
 * (see globals.css). Route changes, pane swaps, overlays, status feedback are the tier's business.
 */
export function entranceMotion(): boolean {
  return root()?.dataset.entrance !== 'off';
}

/**
 * The multiplier JS applies by hand — CSS gets it free via `calc(<base> * var(--motion-scale))`;
 * WAAPI and GSAP take numbers. `off` returns 0: right for a duration, wrong for a `timeScale`
 * (see `setMotionScaleListener`). `reduced` reads the speed like `standard` does.
 */
export function motionScale(): number {
  if (motionTier() === 'off') return 0;
  return MOTION_SPEED_SCALE[motionSpeed()];
}

/** `ms` at the current speed, for a WAAPI `duration` or a GSAP seconds value. */
export const scaledMs = (ms: number) => ms * motionScale();

/* --- Applying — DOM only, no persistence: runs inside a View Transition capture, so
   synchronous and must not touch React. --- */

export function applyScheme(scheme: ColorScheme) {
  const el = root();
  if (!el) return;
  el.classList.toggle('dark', scheme === 'dark');
  writeCookie(COOKIE_KEYS.darkMode, String(scheme === 'dark'));
  applyThemeColorMeta(currentPalette(), scheme);
}

export function applyPalette(id: PaletteId) {
  const el = root();
  if (!el) return;
  el.dataset.palette = id;
  writeCookie(COOKIE_KEYS.palette, id);
  applyThemeColorMeta(id, currentScheme());
}

/**
 * The eleventh palette, resolved by `lib/paletteLazy.ts` and installed here without importing the
 * recipe — which keeps HCT out of every route that reads a preference.
 */
export interface CustomPaletteInstall {
  /** The user's hex, normalised. It **is** `primary` in the light scheme. */
  seed: string;
  /** The two `html[data-palette='custom']` blocks, ready to be a stylesheet. */
  css: string;
  /** `primary` and `on-primary` per scheme, for the chrome colour and the picker's chip. */
  tones: { light: PaletteTone; dark: PaletteTone };
}

/** Same two fields the ten built-ins carry in `lib/generated/themeColors.ts` — the eleventh
 * chip and the chrome draw with the same code. */
export interface PaletteTone {
  primary: string;
  onPrimary: string;
}

/**
 * The four hexes of a custom install, parked on `<html>` as one attribute rather than recomputed —
 * `applyThemeColorMeta` runs inside a View Transition capture, where a `getComputedStyle` would
 * force a synchronous style recalc. And the eleventh chip must show the user's colour **while
 * another theme is in force** — the chip cannot read the always-active tokens (reading
 * `--md-sys-color-primary` there paints whichever palette is active, which turned the custom chip
 * blue); the trap `lib/generated/themeColors.ts` avoids for the other ten.
 */
const FIELDS = ['primary', 'onPrimary'] as const;
const packTones = (t: { light: PaletteTone; dark: PaletteTone }) =>
  [...FIELDS.map((f) => t.light[f]), ...FIELDS.map((f) => t.dark[f])].join(' ');

export function unpackCustomTones(
  value: string | null | undefined,
): { light: PaletteTone; dark: PaletteTone } | null {
  const parts = (value ?? '').split(' ');
  if (parts.length !== FIELDS.length * 2) return null;
  const at = (offset: number) =>
    Object.fromEntries(FIELDS.map((f, i) => [f, parts[offset + i]])) as unknown as PaletteTone;
  return { light: at(0), dark: at(FIELDS.length) };
}

/** Where the injected rules live. The server renders one with the same id at SSR. */
const CUSTOM_STYLE_ID = 'palette-custom';

/**
 * Install the custom palette's rules and remember what they were built from.
 * A single `<style>` appended to `<head>`, **not** inline properties on `<html>`: an inline
 * style beats every selector including `html.dark[data-palette='custom']`, so a scheme flip
 * would silently keep painting the light values and `applyScheme` would have to rewrite all
 * thirty. As a stylesheet the specificity matches the generated file — (0,1,1) and (0,2,1),
 * above `:root` and `.dark` — and `applyScheme` needs no knowledge of it.
 */
export function applyCustomPalette(install: CustomPaletteInstall) {
  const el = root();
  if (!el) return;
  let style = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = CUSTOM_STYLE_ID;
    document.head.append(style);
  }
  style.textContent = install.css;
  el.dataset.paletteSeed = install.seed;
  el.dataset.paletteTones = packTones(install.tones);
  writeCookie(COOKIE_KEYS.paletteCustom, install.seed);
}

export function applyMotion(tier: MotionTier, speed: MotionSpeed) {
  const el = root();
  if (!el) return;
  el.dataset.motion = tier;
  el.dataset.motionSpeed = speed;
  writeCookie(COOKIE_KEYS.motion, tier);
  writeCookie(COOKIE_KEYS.motionSpeed, speed);
  motionScaleListener?.(motionScale());
}

export function applyEntranceMotion(on: boolean) {
  const el = root();
  if (!el) return;
  /* Present only when off, so "on" is the absence of an attribute and there is nothing to
     write on the overwhelmingly common path. The cookie carries both values because the
     server has to know which one to render. */
  if (on) delete el.dataset.entrance;
  else el.dataset.entrance = 'off';
  writeCookie(COOKIE_KEYS.entranceMotion, on ? 'on' : 'off');
}

/**
 * The browser's own chrome colour. `<meta name="theme-color">` is read before any stylesheet
 * exists, so it cannot be a `var()`. Rendered by `app/layout.tsx` from the cookies rather than
 * Next's static `viewport.themeColor`: that cannot express ten palettes, and the App Router
 * re-renders metadata on client navigation, which would undo a mutation of Next's tag. It carries
 * no `media`: it reports the scheme the *app* is in, which can differ from the OS's. The custom
 * palette is not in `PALETTES`, so it reads the tones `applyCustomPalette` parked on `<html>`;
 * the `?? PALETTES[0]` fallback guards unknown ids.
 */
export function applyThemeColorMeta(id: PaletteId, scheme: ColorScheme) {
  const custom = id === CUSTOM_PALETTE ? currentCustomTones() : null;
  const color =
    custom?.[scheme].primary ?? (PALETTES.find((p) => p.id === id) ?? PALETTES[0])[scheme].primary;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.removeAttribute('media');
    meta.content = color;
  }
}

/* --- The store: one version counter for all five — a component caring about one re-rendering
   when another moves costs a render and saves five subscriptions. --- */

let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const fn of listeners) fn();
}

/* Memoised, and that is a correctness fix: `window.matchMedia()` returns a **new** object every call,
   so building the pair inside `subscribe` handed `removeEventListener` a different `MediaQueryList`
   than `addEventListener` had — masked today because the app-shell subscriber never unmounts, but a
   count returning to zero would leak a retained query per cycle. */
let mediaCache: MediaQueryList[] | null = null;
const systemMedia = () =>
  (mediaCache ??= [window.matchMedia(MEDIA.dark), window.matchMedia(MEDIA.reducedMotion)]);

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (listeners.size === 1) for (const m of systemMedia()) m.addEventListener('change', emit);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) for (const m of systemMedia()) m.removeEventListener('change', emit);
  };
}

/**
 * Re-resolve the motion tier against the OS, for a `system` setting — the counterpart to the colour
 * scheme's own watcher. `subscribe`'s listener only bumps the version, and the hooks then read
 * `motionTier()`, i.e. the attribute — an attribute nobody had rewritten, so with 跟随系统 selected,
 * turning on the OS's reduce-motion changed nothing until a reload. Storage is not rewritten (the
 * stored value is already `system`; what changes is what it resolves to). `AppLayout` mounts it.
 */
export function refreshSystemMotion() {
  if (readMotionSetting() !== 'system') return;
  applyMotion(resolveMotionTier('system'), readMotionSpeed());
  emit();
}

/**
 * A seam rather than an import, like `setHeroBusyCheck`: this module is reached by anything that
 * reads a preference, and `lib/motion` drags GSAP with it. `lib/motion` registers a callback that
 * sets `gsap.globalTimeline.timeScale` — one line reaching every GSAP tween and delay in the app.
 * It must not be handed a scale of 0 (a `timeScale` of 0 stops the clock instead of collapsing the
 * duration), so the `off` tier's clamp is handled there, not here.
 */
let motionScaleListener: ((scale: number) => void) | null = null;

export function setMotionScaleListener(fn: (scale: number) => void) {
  motionScaleListener = fn;
  fn(motionScale());
}

/* --- Committing — persist, apply, then tell React. The order is load-bearing twice over.
   `apply` before `emit`: the hooks read the *root* (class list / attribute), so a re-render queued
   before the DOM write would report the value being replaced, not the new one. `flushSync` around
   `emit`: the caller is usually inside `circularReveal`'s `startViewTransition` callback, and both
   the DOM write and React's commit must land in that one synchronous block or the transition
   snapshots a frame where only one has. --- */

export function commitScheme(setting: SchemeSetting) {
  writeStored(LS_KEYS.followSystemScheme, String(setting === 'system'));
  if (setting !== 'system') writeStored(LS_KEYS.darkMode, String(setting === 'dark'));
  applyScheme(resolveScheme(setting));
  flushSync(emit);
}

export function commitPalette(id: PaletteId) {
  writeStored(LS_KEYS.palette, id);
  applyPalette(id);
  flushSync(emit);
}

/**
 * Switch to the custom palette, or re-derive it from a new seed. The rules go in *before* the
 * attribute, so there is never a frame where `<html>` says `custom` and no stylesheet answers to
 * it — that frame paints the default theme, and inside a View Transition it is the captured one.
 */
export function commitCustomPalette(install: CustomPaletteInstall) {
  writeStored(LS_KEYS.paletteCustom, install.seed);
  applyCustomPalette(install);
  writeStored(LS_KEYS.palette, CUSTOM_PALETTE);
  applyPalette(CUSTOM_PALETTE);
  flushSync(emit);
}

export function commitMotion(setting: MotionSetting, speed: MotionSpeed) {
  writeStored(LS_KEYS.motion, setting);
  writeStored(LS_KEYS.motionSpeed, speed);
  applyMotion(resolveMotionTier(setting), speed);
  flushSync(emit);
}

export function commitEntranceMotion(on: boolean) {
  writeStored(LS_KEYS.entranceMotion, on ? 'on' : 'off');
  applyEntranceMotion(on);
  flushSync(emit);
}

/* --- Hooks: the server snapshots are the *defaults*, not the cookies — a snapshot function
   cannot read a request, so a page whose cookie says otherwise renders once with the default and
   re-renders after hydration (what `useSyncExternalStore` exists to make safe); nothing visible
   depends on it, since the *paint* comes from the attribute the server put on `<html>`. --- */

function useAppearance<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribe, read, () => serverValue);
}

export const useSchemeSetting = () => useAppearance(readSchemeSetting, 'system' as SchemeSetting);
export const useScheme = () => useAppearance(currentScheme, 'light' as ColorScheme);
export const usePalette = () => useAppearance(currentPalette, DEFAULT_PALETTE);
export const useCustomSeed = () => useAppearance(currentCustomSeed, null as string | null);
export const useCustomTonesRaw = () => useAppearance(currentCustomTonesRaw, null as string | null);
export const useMotionSetting = () => useAppearance(readMotionSetting, 'system' as MotionSetting);
export const useMotionSpeed = () => useAppearance(motionSpeed, 'default' as MotionSpeed);
export const useEntranceMotion = () => useAppearance(entranceMotion, true);

/**
 * The reactive tier, for the hook that keeps firing all session (`useStaggerGrid` re-runs on every
 * page of results); everything else reads `motionTier()` at the moment it animates — later, so
 * fresher. Server value `standard` matches the CSS, which only opts out under an attribute the
 * server sets, so the first paint cannot disagree.
 */
export const useMotionTier = () => useAppearance(motionTier, 'standard' as MotionTier);

/** `version` is exported for tests and for a dev-tools panel; nothing in the app reads it. */
export const appearanceVersion = () => version;
export { subscribe as subscribeAppearance };

