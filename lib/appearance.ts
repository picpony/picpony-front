'use client';

/**
 * The five device-local appearance preferences, and their only owner.
 *
 * Colour scheme, palette, motion tier, motion speed, entrance animations. They are one
 * module because they are one concern with one shape: a stored setting that may say "follow
 * the system", a
 * resolved value that lives on `<html>` as an attribute or a class, a cookie so the
 * server can put it there before first paint, and a subscription so the app bar and
 * /settings cannot disagree about which one is active.
 *
 * None of them syncs to the account. That is deliberate and it predates this module —
 * `darkMode` was never in `CloudSettings` — because these describe the device you are
 * reading on, not the person: a phone in a dark room and a desktop in daylight want
 * different answers, and a user who turns animations off on a laptop with a weak GPU
 * does not mean it about their phone.
 *
 * **Read the root, not the store.** `motionTier()` and `currentPalette()` read the
 * attribute rather than localStorage, because the attribute is what the CSS is keyed on
 * and therefore what is actually in force. The stored setting can say `system`; the
 * attribute never does.
 */

import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import { COOKIE_KEYS, LS_KEYS, MEDIA } from './constants';
import { DEFAULT_PALETTE, PALETTES, isPaletteId, type PaletteId } from './generated/themeColors';

export { DEFAULT_PALETTE, PALETTES };
export type { PaletteId };

export type ColorScheme = 'light' | 'dark';
export type SchemeSetting = ColorScheme | 'system';

/** What is actually in force. Never `system` — that is a *setting*, not a tier. */
export type MotionTier = 'off' | 'reduced' | 'standard';
export type MotionSetting = MotionTier | 'system';
export type MotionSpeed = 'fast' | 'default' | 'slow';

/**
 * The three speeds, as a multiplier on every duration in the app.
 *
 * 0.7 and 1.4 are reciprocals, so the ladder is symmetric about `default` in log space
 * and **the relative rhythm is unchanged**: the ratio between a 100ms press and a 150ms
 * state layer is the same at all three speeds. Three separate duration tables, each
 * rounded onto M3's 50ms grid, would have let those ratios drift — and the ratios are
 * what make one gesture read as one gesture. So M3's grid is what `default` declares,
 * and the other two are a scale of the whole system.
 *
 * Speed applies to the reduced tier too. It used to be standard-only, with `reduced`
 * pinned at its own 0.5 — so that tier both simplified every gesture *and* halved its
 * clock, which is two answers to one question. The tier decides the **form** of the
 * motion and the speed decides its **length**; they are orthogonal, and the only tier
 * that ignores the speed is `off`, where the length is zero.
 */
export const MOTION_SPEED_SCALE: Record<MotionSpeed, number> = {
  fast: 0.7,
  default: 1,
  slow: 1.4,
};

/* `SchemeSetting` needs no validation list: it is derived from two booleans rather than
   read as a string, so there is no unknown value it can take. The other two are read
   straight out of storage and do. */
const MOTION_SETTINGS: readonly MotionSetting[] = ['off', 'reduced', 'standard', 'system'];
const MOTION_SPEEDS: readonly MotionSpeed[] = ['fast', 'default', 'slow'];

/* ---------------------------------------------------------------------------
 * Storage. Both halves are wrapped: `localStorage` throws outright in a private
 * window in some engines, and a preference failing to persist must not take the page
 * down with it.
 * ------------------------------------------------------------------------ */

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

/* ---------------------------------------------------------------------------
 * The stored settings
 * ------------------------------------------------------------------------ */

/**
 * The colour-scheme setting.
 *
 * Stored as two keys rather than one, and they are not new: `darkMode` plus
 * `followSystemPrefersColorScheme` is what the app bar's cycle button has always
 * written, and rewriting them as one value would log every existing user out of their
 * own preference. The pair is collapsed to a single three-way setting here so nothing
 * downstream has to know there are two.
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

/* There is no `readPalette` or `readEntranceMotion` beside these two, and the asymmetry is
   deliberate: both had no consumer. Every reader of those two preferences wants the value
   *in force*, which is the attribute on `<html>` — `currentPalette()` and `entranceMotion()`
   below — and the stored string is only ever read by the pre-paint script in
   `app/layout.tsx`, which cannot import from here anyway. A reader nothing calls is a reader
   that drifts from the writer beside it without anything noticing. */

/* ---------------------------------------------------------------------------
 * Resolving `system`
 * ------------------------------------------------------------------------ */

const matches = (query: string) =>
  typeof window !== 'undefined' && window.matchMedia(query).matches;

export const systemPrefersDark = () => matches(MEDIA.dark);
export const systemPrefersReducedMotion = () => matches(MEDIA.reducedMotion);

export function resolveScheme(setting: SchemeSetting): ColorScheme {
  if (setting !== 'system') return setting;
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * `reduce` maps to the **reduced** tier, not to `off`.
 *
 * Before there was a reduced tier the two were the same thing and the OS preference
 * switched twenty-odd animations off outright. What the preference asks for is less
 * movement, which is what the reduced tier is; a user who wants nothing at all can say
 * so, and now has somewhere to say it.
 */
export function resolveMotionTier(setting: MotionSetting): MotionTier {
  if (setting !== 'system') return setting;
  return systemPrefersReducedMotion() ? 'reduced' : 'standard';
}

/* ---------------------------------------------------------------------------
 * What is in force — read off `<html>`
 * ------------------------------------------------------------------------ */

const root = () => (typeof document === 'undefined' ? null : document.documentElement);

export function currentPalette(): PaletteId {
  const value = root()?.dataset.palette;
  return isPaletteId(value) ? value : DEFAULT_PALETTE;
}

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
 * Whether an entrance may play, read off the root like every other in-force value.
 *
 * A separate switch from the tier because it answers a different question. The tier is about
 * *how much* motion a gesture you asked for may use; this is about whether the app volunteers
 * any — the scroll reveal, the grid cascade, `Reveal`, `Logo`'s draw-on, the splash. Those are
 * the ones that happen *to* you, and on a screen you visit twenty times a day they are the
 * first thing anybody wants to stop.
 *
 * The attribute is present only when the answer is no. **Every reader of it is a call site,
 * not a token**: it shipped with a `--motion-entrance` multiplier beside `--motion-scale` and
 * that had to come out, because two keyframes serve entrances and gesture responses at once
 * (see the note in globals.css). A route transition, a pane swap, an overlay opening and
 * status feedback are the tier's business; this switch is only for motion nothing asked for.
 */
export function entranceMotion(): boolean {
  return root()?.dataset.entrance !== 'off';
}

/**
 * The multiplier JS has to apply by hand.
 *
 * CSS gets this for free — every duration token is `calc(<base> * var(--motion-scale))`
 * and the tier rules set that variable. WAAPI and GSAP take numbers, so they read it
 * from here. `off` returns 0, which is right for a duration and wrong for a `timeScale`;
 * see `setMotionScaleListener`.
 *
 * `reduced` reads the speed like `standard` does: the tier changes which animation plays,
 * not how long it takes.
 */
export function motionScale(): number {
  if (motionTier() === 'off') return 0;
  return MOTION_SPEED_SCALE[motionSpeed()];
}

/** `ms` at the current speed, for a WAAPI `duration` or a GSAP seconds value. */
export const scaledMs = (ms: number) => ms * motionScale();

/* ---------------------------------------------------------------------------
 * Applying — DOM only, no persistence
 *
 * These are what runs inside a View Transition's capture callback, so they must be
 * synchronous and must not touch React.
 * ------------------------------------------------------------------------ */

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
 * The browser's own chrome colour.
 *
 * `<meta name="theme-color">` is read before any stylesheet exists, so it cannot be a
 * `var()`. It is rendered by `app/layout.tsx` from the cookies rather than by Next's
 * `viewport.themeColor`, because that export is a static array and cannot express ten
 * palettes — and because the App Router re-renders metadata on a client navigation,
 * which would undo a mutation of Next's own tag.
 *
 * The tag carries no `media`: it reports the scheme the *app* is in, which can differ
 * from the OS's. Keying it on the media query — which is what the two generated tags
 * used to do — meant forcing dark mode on a light desktop left the browser painting its
 * chrome the light colour.
 */
export function applyThemeColorMeta(id: PaletteId, scheme: ColorScheme) {
  const entry = PALETTES.find((p) => p.id === id) ?? PALETTES[0];
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.removeAttribute('media');
    meta.content = entry[scheme].primary;
  }
}

/* ---------------------------------------------------------------------------
 * The store
 *
 * One version counter for all five, because a component that cares about one of them
 * re-rendering when another moves costs a render and saves five subscriptions.
 * ------------------------------------------------------------------------ */

let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const fn of listeners) fn();
}

/* Memoised, and that is a fix rather than an optimisation: `window.matchMedia()` returns a
   **new** object every call, so building the pair inside `subscribe` meant `removeEventListener`
   was handed a different `MediaQueryList` than `addEventListener` had been. It is masked today
   because the first subscriber is the app shell and never unmounts, so the count never returns
   to zero — but any arrangement where it did would leak a retained query per cycle. */
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
 * Re-resolve the motion tier against the OS, for a `system` setting.
 *
 * The counterpart to the colour scheme's own watcher, and its absence was a regression:
 * `subscribe`'s listener above only bumps the version, and the hooks then read
 * `motionTier()`, which reads the attribute — an attribute nobody had rewritten. So with
 * 跟随系统 selected, turning on the OS's reduce-motion setting changed nothing at all until
 * a reload: `--motion-scale` stayed 1, the hero kept flying, GSAP's `timeScale` was
 * untouched. The deleted `useReducedMotion()` subscribed to the query for exactly this
 * reason, and the deleted `@media` blocks were live by construction.
 *
 * Storage is not rewritten — the stored value is already `system`; what changes is what
 * `system` resolves to. `AppLayout` mounts the listener.
 */
export function refreshSystemMotion() {
  if (readMotionSetting() !== 'system') return;
  applyMotion(resolveMotionTier('system'), readMotionSpeed());
  emit();
}

/**
 * A seam rather than an import, for the reason `setHeroBusyCheck` is one: this module is
 * reached by anything that reads a preference, and `lib/motion` drags GSAP with it.
 *
 * `lib/motion` registers a callback that sets `gsap.globalTimeline.timeScale`, which is
 * how one line reaches every GSAP tween and delay in the app. Note it must not be handed
 * a scale of 0 — a `timeScale` of 0 stops the clock instead of collapsing the duration —
 * so the `off` tier is handled there, not here.
 */
let motionScaleListener: ((scale: number) => void) | null = null;

export function setMotionScaleListener(fn: (scale: number) => void) {
  motionScaleListener = fn;
  fn(motionScale());
}

/* ---------------------------------------------------------------------------
 * Committing — persist, apply, then tell React
 *
 * The order is load-bearing twice over.
 *
 * `apply` before `emit`, because the hooks read the *root*: `useScheme` asks the class
 * list and `usePalette` asks the attribute, so a re-render queued before the DOM write
 * would report the value that is being replaced. That was a real defect — the app bar's
 * glyph showed the previous mode until something unrelated re-rendered it.
 *
 * `flushSync` around `emit`, because the caller is usually inside `circularReveal`'s
 * `startViewTransition` callback. Both the DOM write and React's commit have to land in
 * that one synchronous block or the transition snapshots a frame where only one of them
 * has happened.
 * ------------------------------------------------------------------------ */

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

/* ---------------------------------------------------------------------------
 * Hooks
 *
 * The server snapshots are the *defaults*, not the cookies, and they have to be: a
 * snapshot function cannot read a request. So a page whose cookie says otherwise renders
 * once with the default and re-renders after hydration — which is what `useMediaQuery`
 * already does here, and what `useSyncExternalStore` exists to make safe. Nothing
 * visible depends on it, because the *paint* comes from the attribute the server put on
 * `<html>`, not from these.
 * ------------------------------------------------------------------------ */

function useAppearance<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribe, read, () => serverValue);
}

export const useSchemeSetting = () => useAppearance(readSchemeSetting, 'system' as SchemeSetting);
export const useScheme = () => useAppearance(currentScheme, 'light' as ColorScheme);
export const usePalette = () => useAppearance(currentPalette, DEFAULT_PALETTE);
export const useMotionSetting = () => useAppearance(readMotionSetting, 'system' as MotionSetting);
export const useMotionSpeed = () => useAppearance(motionSpeed, 'default' as MotionSpeed);
export const useEntranceMotion = () => useAppearance(entranceMotion, true);

/**
 * The reactive tier, for the two hooks that keep firing all session — `useStaggerGrid`
 * and `useScrollReveal`. Everything else reads `motionTier()` at the moment it animates,
 * which is later and therefore fresher.
 *
 * The server value is `standard` for the reason its predecessor's was "animations on":
 * it matches the CSS, which only opts out under an attribute the server sets, so the
 * first paint cannot disagree with it.
 */
export const useMotionTier = () => useAppearance(motionTier, 'standard' as MotionTier);

/** `version` is exported for tests and for a dev-tools panel; nothing in the app reads it. */
export const appearanceVersion = () => version;
export { subscribe as subscribeAppearance };


