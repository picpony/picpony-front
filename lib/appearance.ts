'use client';

/**
 * The six appearance preferences, and their only owner — the `LS_KEYS`/`COOKIE_KEYS`
 * mapping lives here: colour scheme, palette, 配色方案 (多色 / 单色), motion tier, motion speed,
 * entrance animations. One module because they are one concern with one shape: a stored setting
 * that may say "follow the system", a resolved value on `<html>` as an attribute or a class, a
 * cookie so the server puts it there before first paint, and a subscription so the app bar glyph
 * and /settings dropdowns cannot disagree. Four stay on the device — the scheme, the motion tier,
 * the speed and entrance motion describe the device, not the person (the original front end never
 * synced `darkMode`). The palette follows the account, as the original front end's `theme` did,
 * and 配色方案 and the custom palette's 副色相 travel with it — they are part of what "my theme"
 * means: `lib/settingsSync.ts` notices a new stored choice through this module's subscription and
 * writes it, and on sign-in commits the account's through `commitPalette` / `commitCustomPalette`
 * / `commitPaletteHues` — this module stays the only writer of the keys.
 * **Read the root, not the store:** `motionTier()`, `currentPalette()`
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
import {
  formatCustomSpec,
  packTones,
  parseAccent,
  parseCustomSpec,
  sameCustomSpec,
  unpackCustomTones,
  type AccentChoice,
  type CustomSpec,
  type CustomTones,
  type FaceScheme,
  type PaletteHues,
  type PaletteTone,
  type ThemeFace,
} from './paletteSpec';

export { CUSTOM_PALETTE, DEFAULT_PALETTE, PALETTES, packTones, unpackCustomTones };
export type { AccentChoice, CustomSpec, CustomTones, FaceScheme, PaletteHues, PaletteId, PaletteTone, ThemeFace };

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
  try {
    document.cookie = `${name}=${value};path=/;max-age=${COOKIE_MAX_AGE};samesite=lax`;
  } catch {
    /* A sandboxed or opaque-origin frame throws on any cookie write. The attribute and
       storage still carry the preference; only the server's first paint loses it. */
  }
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
 * painted. Non-null even while another theme is in force (the eleventh tile's data). */
export function currentCustomSeed(): string | null {
  return root()?.dataset.paletteSeed ?? null;
}

/** The installed custom palette's 副色相 — `null` for 自动, and while none is installed. A
 * primitive, so it is a stable snapshot for `useSyncExternalStore` as it is. */
export function currentCustomAccent(): AccentChoice {
  return parseAccent(root()?.dataset.paletteAccent) ?? null;
}

/** The installed custom palette's spec — what `recoverCustomPalette` compares storage with. */
export function currentCustomSpec(): CustomSpec | null {
  const seed = currentCustomSeed();
  return seed ? { seed, accent: currentCustomAccent() } : null;
}

/** The custom palette's tile hexes, packed, or null when none is installed. The *string* is the
 * subscribed snapshot, not a parsed object — `useSyncExternalStore` compares by identity, so a
 * fresh object per call would re-render for ever; callers unpack. */
export function currentCustomTonesRaw(): string | null {
  return root()?.dataset.paletteTones ?? null;
}

/** 配色方案 in force: `mono` only while the attribute says so — 多色 is its absence. */
export function currentPaletteHues(): PaletteHues {
  return root()?.dataset.paletteHues === 'mono' ? 'mono' : 'multi';
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
 * whether the app volunteers any (results cascade, `Reveal`, the app bar mark's boot draw-on — motion that
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
 * 配色方案. The attribute is present only for 单色, so 多色 — the default — is the absence the
 * CSS needs no selector for; the cookie carries both, so the server renders the one chosen.
 * `primary` is the same in both, so the chrome colour does not move.
 */
export function applyPaletteHues(hues: PaletteHues) {
  const el = root();
  if (!el) return;
  if (hues === 'mono') el.dataset.paletteHues = 'mono';
  else delete el.dataset.paletteHues;
  writeCookie(COOKIE_KEYS.paletteHues, hues);
}

/**
 * The eleventh palette, resolved by `lib/paletteLazy.ts` and installed here without importing the
 * recipe — which keeps HCT out of every route that reads a preference.
 */
export interface CustomPaletteInstall {
  /** The user's hex, normalised. It **is** `primary` in the light scheme. */
  seed: string;
  /** Its 副色相: `null` for 自动. */
  accent: AccentChoice;
  /** The `html[data-palette='custom']` blocks, both 配色方案, ready to be a stylesheet. */
  css: string;
  /**
   * What the chrome colour and the picker's eleventh tile are drawn from, parked on `<html>` as
   * `data-palette-tones` rather than recomputed — `applyThemeColorMeta` runs inside a View
   * Transition capture, where a `getComputedStyle` would force a synchronous style recalc. And the
   * tile must show the user's colour **while another theme is in force**, which no token read can
   * give (reading `--md-sys-color-primary` there paints whichever palette is active, which turned
   * the custom chip blue once); the trap `lib/generated/themeColors.ts` and `themeFaces.ts` avoid
   * for the other ten. Packed by `packTones` (`lib/paletteSpec.ts`), which `app/layout.tsx` uses
   * at SSR too.
   */
  tones: CustomTones;
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
  if (install.accent === null) delete el.dataset.paletteAccent;
  else el.dataset.paletteAccent = String(install.accent);
  el.dataset.paletteTones = packTones(install.tones);
  writeCookie(COOKIE_KEYS.paletteCustom, formatCustomSpec(install));
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

/* --- The store: one version counter for all six — a component caring about one re-rendering
   when another moves costs a render and saves six subscriptions. --- */

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
  writeStored(LS_KEYS.paletteCustom, formatCustomSpec(install));
  applyCustomPalette(install);
  writeStored(LS_KEYS.palette, CUSTOM_PALETTE);
  applyPalette(CUSTOM_PALETTE);
  flushSync(emit);
}

export function commitPaletteHues(hues: PaletteHues) {
  writeStored(LS_KEYS.paletteHues, hues);
  applyPaletteHues(hues);
  flushSync(emit);
}

/**
 * Put the user's own palette back when the request that rendered this document could not.
 *
 * The first paint of a custom palette needs its spec cookie (the server derives the
 * declarations; the pre-paint script cannot). With the cookie gone — expired, cleared, or a
 * browser refusing cookies — the page painted the default brand and *stayed* there, although
 * storage still said `custom` with a seed: the two stores disagreed and /settings showed 默认.
 * The same holds for a cookie that names another spec than storage does. Called once after
 * mount by the shell: derives the palette on the lazy HCT chunk and installs it with no wipe
 * (nothing was asked of the user), which also rewrites both cookies. A no-op — and no chunk —
 * in every other case.
 */
export function recoverCustomPalette(): void {
  if (readStored(LS_KEYS.palette) !== CUSTOM_PALETTE) return;
  const spec = parseCustomSpec(readStored(LS_KEYS.paletteCustom));
  if (!spec) return;
  if (currentPalette() === CUSTOM_PALETTE && sameCustomSpec(currentCustomSpec(), spec)) return;
  void import('./paletteLazy')
    .then(({ resolveCustomPalette }) => resolveCustomPalette(spec))
    .then((install) => {
      /* The user may have picked another palette while the chunk was on its way. */
      if (!install || readStored(LS_KEYS.palette) !== CUSTOM_PALETTE
        || !sameCustomSpec(parseCustomSpec(readStored(LS_KEYS.paletteCustom)), spec)) return;
      commitCustomPalette(install);
    })
    .catch(() => {
      /* The recipe chunk failed: the default brand stays, as it would have anyway. */
    });
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
/** `serverValue` is the scheme the server painted, when the caller knows it (the app bar gets it
 *  from the cookie), so a glyph that follows the scheme renders the same on both sides of
 *  hydration instead of correcting itself after it. */
export const useScheme = (serverValue: ColorScheme = 'light') =>
  useAppearance(currentScheme, serverValue);
export const usePalette = () => useAppearance(currentPalette, DEFAULT_PALETTE);
export const useCustomSeed = () => useAppearance(currentCustomSeed, null as string | null);
export const useCustomAccent = () => useAppearance(currentCustomAccent, null as AccentChoice);
export const useCustomTonesRaw = () => useAppearance(currentCustomTonesRaw, null as string | null);
export const usePaletteHues = () => useAppearance(currentPaletteHues, 'multi' as PaletteHues);
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

