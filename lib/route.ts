/**
 * Request lines: which host answers a Derpibooru request, and who decides.
 *
 * There are **two independent axes** — the API line and the image line — and the
 * decision on each is made twice over. An administrator can pin the whole site to
 * one line through `api.php?action=get_maintenance_status`; only when that policy
 * says `auto` do the user's own toggles in /settings get a vote. This module owns
 * both halves, plus the runtime health that `auto` resolves against.
 *
 * Three things it deliberately is not:
 *
 * - **Not a preference in `lib/appearance.ts`'s sense.** No cookie, no attribute on
 *   `<html>`, no pre-paint script — those five are the *device's* and are echoed back to
 *   the server in a cookie, where this one is the server's and travels one way. It *is*
 *   inlined into the document, and the reason is not painting: nothing here changes a
 *   pixel. It is that `proxyFetch` awaits the policy before it will send anything, so
 *   fetching it on the client made it round 1 of every screen in the app and pushed every
 *   Derpibooru read into round 2 behind it. See `lib/route.server.ts`.
 * - **Not a swap of the base constants.** `DERPIBOORU_API_BASE` stays canonical and
 *   the line is applied per request, which is what the old frontend does and what
 *   sidesteps a bundler folding an `export const` string into 140 call sites.
 * - **Not about PicPony's own API.** `/api.php`, avatars and banners never change
 *   host. The policy rewrites Derpibooru `/api/` calls and derpicdn images, nothing
 *   else.
 */

import {
  COOKIE_KEYS,
  IMAGE_CDN_BASE,
  IMAGE_PROBE_URL,
  IMAGE_WORKER_BASE,
  LS_KEYS,
  PICPONY_API_BASE,
  PICPONY_RELAY_PATH,
  PROXY_API_BASE,
} from '@/lib/constants';
import type { SiteStatusResponse } from '@/lib/types/site';

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export type ApiLine = 'direct' | 'api_accel' | 'picpony_api' | 'third_party';
export type ImageLine = 'direct' | 'cdn' | 'picpony';
export type ApiPolicy = 'auto' | ApiLine;
export type ImagePolicy = 'auto' | ImageLine;

const API_POLICIES: readonly string[] = [
  'auto',
  'direct',
  'api_accel',
  'picpony_api',
  'third_party',
];
const IMAGE_POLICIES: readonly string[] = ['auto', 'direct', 'cdn', 'picpony'];

const API_LINE_LABELS: Record<ApiLine, string> = {
  direct: '直连',
  api_accel: 'API 加速 (derpibooru)',
  picpony_api: 'PicPony API',
  third_party: '第三方 API',
};

const IMAGE_LINE_LABELS: Record<ImageLine, string> = {
  direct: '直连',
  cdn: 'CDN 加速',
  picpony: 'PicPony 加速服务器',
};

// ---------------------------------------------------------------------------
// The user's own line preferences
// ---------------------------------------------------------------------------

/**
 * Read straight from `localStorage`, per call, like `getBrowsingSettings` does.
 *
 * These four live here rather than in `BrowsingSettings` because they are the line
 * axis and nothing else reads them. Note which axis each belongs to: `usePicponyProxy`
 * is the *image* worker, and using it to gate the API proxy is the defect this module
 * exists to undo.
 */
interface LinePrefs {
  useCdn: boolean;
  usePicponyProxy: boolean;
  useApiAccel: boolean;
  useHongKongRelay: boolean;
}

function readLinePrefs(): LinePrefs {
  if (typeof localStorage === 'undefined') {
    return {
      useCdn: false,
      usePicponyProxy: true,
      useApiAccel: true,
      useHongKongRelay: true,
    };
  }
  const ls = (k: string, def: string) => localStorage.getItem(k) ?? def;
  return {
    useCdn: ls(LS_KEYS.useCdn, 'false') === 'true',
    usePicponyProxy: ls(LS_KEYS.usePicponyProxy, 'true') !== 'false',
    useApiAccel: ls(LS_KEYS.useApiAccel, 'true') !== 'false',
    useHongKongRelay: ls(LS_KEYS.useHongKongRelay, 'true') !== 'false',
  };
}

// ---------------------------------------------------------------------------
// State: the server's policy, and the runtime health `auto` resolves against
// ---------------------------------------------------------------------------

const policy = {
  api: 'auto' as ApiPolicy,
  image: 'auto' as ImagePolicy,
  thirdPartyUrl: '',
  thirdPartyPassApiKey: false,
};

/**
 * Which API line `auto` is currently sitting on, and the cooldown that keeps a
 * failed one out.
 *
 * `hongKong` and `derpi` start from the stored preferences and are then moved by
 * failover alone. The old frontend resolved its HK branch off the *preference*
 * while failover mutated a separate runtime flag, so "已切回直连" was announced
 * while the relay was still in use; reading the runtime flag here is a deliberate
 * divergence that makes the announcement true.
 */
const apiState = {
  hongKong: true,
  derpi: false,
  cooldownUntil: 0,
  revertTimer: 0,
};

/** Shared image-line health. `lib/imageLoader.ts` owns the probes that move it. */
const imageState = {
  workerAvailable: true,
  cdnAvailable: true,
  raceWinner: null as 'cdn' | 'direct' | null,
};

// ---------------------------------------------------------------------------
// Subscription, for /settings' picker and status line
// ---------------------------------------------------------------------------

let version = 0;
const listeners = new Set<() => void>();

/**
 * Mirror the resolved image line into a cookie so the server can render the same `<img src>` the
 * client is about to want.
 *
 * Written on every change rather than once, because the line moves during a session: the policy
 * lands, a line degrades, the user flips a switch. It is only ever read at SSR, so a value one
 * navigation stale costs a single corrected `src`, not a wrong one.
 */
function mirrorImageLineCookie() {
  if (typeof document === 'undefined') return;
  const line = resolveImageLine();
  document.cookie = `${COOKIE_KEYS.imageLine}=${line};path=/;max-age=${IMAGE_LINE_COOKIE_MAX_AGE};samesite=lax`;
}

/** A year, matching the appearance cookies. */
const IMAGE_LINE_COOKIE_MAX_AGE = 31_536_000;

function emit() {
  version += 1;
  mirrorImageLineCookie();
  for (const fn of listeners) fn();
}

export function subscribeRouteState(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** A counter rather than the state itself, so `useSyncExternalStore` sees a change. */
export function routeStateVersion() {
  return version;
}

/** How a switch announces itself. Registered by `AppLayout`, so `lib/` keeps out of `components/`. */
export type LineNotice = 'warning' | 'success';

let notifier: ((message: string, tone: LineNotice) => void) | null = null;

export function setLineNotifier(fn: (message: string, tone: LineNotice) => void) {
  notifier = fn;
}

/* One severity per direction. A recovery arriving as a warning misreports itself, and a
   snackbar's tone *is* its severity. */
function announce(message: string | null, tone: LineNotice = 'warning') {
  if (message) notifier?.(message, tone);
}

// ---------------------------------------------------------------------------
// The policy, from the server
// ---------------------------------------------------------------------------

/**
 * A third-party origin is only honoured if it is clean: `https:`, a hostname, and no
 * credentials, path, query or fragment of its own — the path and search come from the
 * Derpibooru URL being rewritten, so anything already there would be overwritten. An
 * unusable value degrades the policy to `auto` rather than being clamped into shape, which
 * is why a stray path is a rejection and not a silent `origin` read.
 */
function validThirdPartyOrigin(raw: string): string {
  try {
    const u = new URL(raw);
    if (
      u.protocol === 'https:' &&
      u.hostname &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.pathname === '' || u.pathname === '/')
    ) {
      return u.origin;
    }
  } catch {
    /* not a URL */
  }
  return '';
}

function applyRoutePolicy(status: SiteStatusResponse) {
  const thirdParty = validThirdPartyOrigin(status.global_api_third_party_url ?? '');
  const api = status.global_api_route_policy ?? 'auto';
  const usable = API_POLICIES.includes(api) && (api !== 'third_party' || thirdParty !== '');
  policy.api = usable ? (api as ApiPolicy) : 'auto';
  policy.thirdPartyUrl = thirdParty;
  policy.thirdPartyPassApiKey = status.global_api_third_party_pass_api_key === true;

  const image = status.global_image_route_policy ?? 'auto';
  policy.image = IMAGE_POLICIES.includes(image) ? (image as ImagePolicy) : 'auto';

  syncLinePrefs();
}

let ready: Promise<void> | null = null;

/**
 * Where the server left the policy, if it managed to read one.
 *
 * `app/layout.tsx` inlines it as a `<script>` rather than handing it to a client component,
 * because it has to be in force before the *first effect* in the tree runs — and effect order
 * across a tree is not something a layout can promise. A script in `<head>` executes before
 * hydration, so by the time anything can call `proxyFetch` the value is already here.
 */
declare global {
  interface Window {
    __picponyRoutePolicy?: {
      api?: string;
      image?: string;
      thirdPartyUrl?: string;
      thirdPartyPassApiKey?: boolean;
    };
  }
}

/**
 * Resolve the policy once, before anything is allowed to pick a line.
 *
 * `proxyFetch` awaits this on every call, which is the old frontend's
 * `window._maintenanceReady` gate expressed where it cannot be got wrong: a React
 * boundary would depend on mount order, and a request fired before the policy landed
 * would silently use the wrong host. After the first resolution it is a settled
 * promise, so the cost is one microtask.
 *
 * **The document normally already carries the answer**, in which case this sends nothing at all:
 * `lib/route.server.ts` reads it during SSR and `app/layout.tsx` inlines it. That is worth one
 * request and — the part that mattered — one *round*. Measured with `npm run net:audit` before the
 * change, `get_maintenance_status` was round 1 on every screen in the app and every Derpibooru read
 * was round 2 behind it, `/policy` included; against the real upstream on a slow link that gate was
 * over six seconds wide. The client fetch survives as the fallback for a server read that timed out
 * or failed, which is also the whole of what happens in a dev server with no backend.
 *
 * It **never rejects.** A failure of any kind leaves the `auto` defaults in place;
 * rejecting here would lock every Derpibooru request in the app behind a dead fetch.
 */
export function ensureRoutePolicy(): Promise<void> {
  ready ??= adoptInlinePolicy() ?? loadRoutePolicy();
  return ready;
}

/**
 * Take the server's answer, or `null` if there isn't one.
 *
 * Synchronous, so the returned promise is already settled and `await ensureRoutePolicy()` costs a
 * microtask on the very first call rather than only on later ones.
 */
function adoptInlinePolicy(): Promise<void> | null {
  if (typeof window === 'undefined') return null;
  const inline = window.__picponyRoutePolicy;
  if (!inline) return null;
  applyRoutePolicy({
    success: true,
    global_api_route_policy: inline.api,
    global_image_route_policy: inline.image,
    global_api_third_party_url: inline.thirdPartyUrl,
    global_api_third_party_pass_api_key: inline.thirdPartyPassApiKey,
  });
  return Promise.resolve();
}

/**
 * Re-read the policy, for /settings' refresh control.
 *
 * Always a real request: the point of the control is "tell me what the server says *now*", and the
 * inlined document is up to `SERVER_POLICY_REVALIDATE_S` old. The global is dropped so nothing can
 * later adopt the value this call just superseded.
 */
export function refreshRoutePolicy(): Promise<void> {
  if (typeof window !== 'undefined') delete window.__picponyRoutePolicy;
  ready = loadRoutePolicy();
  return ready;
}

async function loadRoutePolicy(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    /* No `Authorization` header: the four route fields are served to anyone, and only
       `is_admin` varies with the session. Sending one would mean reaching into
       `lib/hooks.ts` — a `'use client'` module — from the request layer. */
    const res = await fetch(`${PICPONY_API_BASE}?action=get_maintenance_status&_t=${Date.now()}`, {
      cache: 'no-store',
    });
    const data = JSON.parse(await res.text()) as SiteStatusResponse;
    if (data?.success) applyRoutePolicy(data);
  } catch {
    /* Offline, an HTML error page, a renamed action — all mean "no policy", which is
       what the defaults already say. Swallowed rather than logged loudly, because it
       runs on every cold load. */
  }
  /* Unconditionally, so the failure path still brings the runtime line into step with
     what the device has stored. It emits, which is also what wakes /settings up. */
  syncLinePrefs();
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export const apiPolicy = () => policy.api;
export const imagePolicy = () => policy.image;
export const isApiForced = () => policy.api !== 'auto';
export const isImageForced = () => policy.image !== 'auto';

/**
 * Bring the runtime line back in step with the stored preferences.
 *
 * Called after a policy lands and whenever /settings writes a toggle. Turning the
 * relay on takes the accel line out of the running, which is also why /settings shows
 * 启用 API 加速 disabled while it is on: with the relay preferred, that toggle has
 * nothing to select.
 */
export function syncLinePrefs() {
  const prefs = readLinePrefs();
  apiState.hongKong = prefs.useHongKongRelay;
  if (prefs.useHongKongRelay) {
    apiState.derpi = false;
    cancelApiRevert();
  }
  emit();
}

export function resolveApiLine(): ApiLine {
  /* The window test comes first, before the policy. The relay line is a browser-relative
     URL that Node's `fetch` rejects outright, and a *forced* `picpony_api` would otherwise
     return past this guard. */
  if (typeof window === 'undefined') return 'direct';
  if (policy.api !== 'auto') return policy.api;
  const prefs = readLinePrefs();
  if (prefs.useHongKongRelay && apiState.hongKong) return 'picpony_api';
  if (prefs.useApiAccel && apiState.derpi) return 'api_accel';
  return 'direct';
}

/**
 * Priority is the old frontend's and the order matters: a forced policy wins, then the
 * worker, then whichever host won the latency race, and only then the plain CDN
 * preference. The race is what makes `cdn` beatable by `direct` on a connection where
 * the CDN is the slower of the two.
 */
export function resolveImageLine(): ImageLine {
  if (policy.image !== 'auto') return policy.image;
  const prefs = readLinePrefs();
  if (prefs.usePicponyProxy && imageState.workerAvailable) return 'picpony';
  if (imageState.raceWinner === 'cdn' && prefs.useCdn && imageState.cdnAvailable) return 'cdn';
  if (imageState.raceWinner === 'direct') return 'direct';
  if (prefs.useCdn && imageState.cdnAvailable) return 'cdn';
  return 'direct';
}

/**
 * Where an image goes when the worker has just failed it.
 *
 * `resolveImageLine` cannot answer this: the worker only leaves the running after three
 * failures inside the window, so for the first two it would keep naming the line that
 * just failed. This is the same ladder minus the worker rung.
 */
export function resolveImageFallbackLine(): 'cdn' | 'direct' {
  if (policy.image !== 'auto') return policy.image === 'cdn' ? 'cdn' : 'direct';
  const prefs = readLinePrefs();
  if (imageState.raceWinner === 'direct') return 'direct';
  if (prefs.useCdn && imageState.cdnAvailable) return 'cdn';
  return 'direct';
}

/** The two labels /settings shows. `raceWon` marks a CDN chosen by measurement. */
export function currentLineLabels() {
  const api = resolveApiLine();
  const image = resolveImageLine();
  return {
    api: API_LINE_LABELS[api],
    image: IMAGE_LINE_LABELS[image],
    apiForced: isApiForced(),
    imageForced: isImageForced(),
    raceWon: !isImageForced() && image === 'cdn' && imageState.raceWinner === 'cdn',
  };
}

// ---------------------------------------------------------------------------
// Applying a line to a URL
// ---------------------------------------------------------------------------

/** Read inline rather than through `readUserInfo`, to keep `lib/hooks.ts` out of here. */
function currentUsername(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    const raw = localStorage.getItem(LS_KEYS.userInfo);
    if (!raw) return '';
    const info = JSON.parse(raw) as { username?: string };
    return typeof info?.username === 'string' ? info.username : '';
  } catch {
    return '';
  }
}

/**
 * Rewrite a Derpibooru URL for one line.
 *
 * Every line starts from the `derpibooru.org` spelling: `trixiebooru.org` is the same
 * site under its second name, and the accel worker and the relay both key their caches
 * on the canonical one.
 */
export function buildApiLineUrl(url: string, line: ApiLine): string {
  const derpiUrl = url.replace('trixiebooru.org', 'derpibooru.org');
  switch (line) {
    case 'api_accel':
      return PROXY_API_BASE + encodeURIComponent(derpiUrl);
    case 'picpony_api': {
      /* Our own path, not `cdn.picpony.top` — see `app/relay/route.ts` for why the
         browser cannot reach the relay directly. `xp_user` is the relay's per-user
         accounting and is absent for a signed-out visitor. */
      let out = `${PICPONY_RELAY_PATH}?url=${encodeURIComponent(derpiUrl)}`;
      const user = currentUsername();
      if (user) out += `&xp_user=${encodeURIComponent(user)}`;
      return out;
    }
    case 'third_party': {
      try {
        const from = new URL(derpiUrl);
        const to = new URL(policy.thirdPartyUrl);
        to.pathname = from.pathname;
        to.search = from.search;
        to.hash = '';
        if (!policy.thirdPartyPassApiKey) to.searchParams.delete('key');
        return to.toString();
      } catch {
        throw new Error('第三方 API 地址无效');
      }
    }
    default:
      return url;
  }
}

/**
 * The write path's line, and it is deliberately narrower.
 *
 * A POST cannot travel through a `?url=`-style worker — the accel line answers
 * `GET`/`HEAD`/`OPTIONS` only — so an upload has exactly two possibilities: a
 * third-party origin that speaks the whole Philomena API, or Derpibooru itself. The
 * old frontend reaches the same split from the other side, by excluding POST from its
 * request queue while its global `fetch` patch still rewrites the third-party case.
 */
export function applyApiLineToWrite(url: string): string {
  return policy.api === 'third_party' ? buildApiLineUrl(url, 'third_party') : url;
}

// ---------------------------------------------------------------------------
// API failover — `auto` only
// ---------------------------------------------------------------------------

/**
 * Statuses that mean "this line is not working", rather than "this request was wrong".
 *
 * The old frontend also lists **429**, and that one is left out deliberately: a rate limit is
 * counted against the caller, so moving to a shared worker does not escape it — it spreads
 * one visitor's limit onto every visitor of that line. It also made `handleDerpiError`'s
 * dedicated 429 message unreachable. A 429 now surfaces as itself.
 *
 * 403 stays, because a proxy legitimately 403s when *it* is the problem — but see
 * `proxyFetch`, which will not fail over on a 403 for a request that carried an API key,
 * since that is a credential answer and no other host will answer it differently.
 */
export const API_FAILOVER_STATUSES: readonly number[] = [500, 502, 504, 403, 503, 501];

const COOLDOWN_MS = 30_000;
/** A backup line answering 403/503 is overloaded, not broken; keep off it for longer. */
const COOLDOWN_BUSY_MS = 600_000;
/** How long `auto` is allowed to sit on the backup line before trying home again. */
const BACKUP_TTL_MS = 10_000;

function cancelApiRevert() {
  if (apiState.revertTimer) {
    clearTimeout(apiState.revertTimer);
    apiState.revertTimer = 0;
  }
}

function scheduleApiRevert() {
  cancelApiRevert();
  if (typeof window === 'undefined') return;
  apiState.revertTimer = window.setTimeout(() => {
    apiState.revertTimer = 0;
    apiState.derpi = false;
    apiState.cooldownUntil = Date.now() + COOLDOWN_MS;
    emit();
    announce('备用 API 到期，已切回直连');
  }, BACKUP_TTL_MS);
}

/**
 * Move `auto` off the line that just failed, and announce it.
 *
 * Returns whether there was anywhere to go. `false` means the caller should fall back
 * on plain retries — every line the preferences allow has now been tried or is cooling
 * down. Under a **forced** policy this does nothing at all and returns `false`: a line
 * the administrator pinned is not ours to leave, and quietly reverting to direct is
 * what would make 全站强制 meaningless.
 */
export function stepApiFailover(status?: number): boolean {
  if (policy.api !== 'auto') return false;
  const prefs = readLinePrefs();
  const busy = status === 403 || status === 503;

  /* Restore the invariant before deciding: a runtime flag must never be set for a line the
     preference forbids. `syncLinePrefs` normally keeps it, but a preference written in
     another tab reaches `readLinePrefs` without ever reaching this state — and the branches
     below would then announce leaving a line this session was never on, while resolving to
     the same host it just failed on. */
  if (!prefs.useHongKongRelay) apiState.hongKong = false;
  if (!prefs.useApiAccel) apiState.derpi = false;

  if (apiState.derpi) {
    apiState.derpi = false;
    cancelApiRevert();
    if (prefs.useHongKongRelay) {
      apiState.hongKong = true;
      emit();
      announce('API 加速异常，已切换至香港服务器中转');
      return true;
    }
    apiState.cooldownUntil = Date.now() + (busy ? COOLDOWN_BUSY_MS : COOLDOWN_MS);
    emit();
    announce(busy ? '备用 API 压力过大，已切回直连' : '备用 API 异常，已切回直连');
    return true;
  }

  if (apiState.hongKong) {
    /* Unreachable, and left as an assertion rather than a branch. `hongKong` implies the
       preference is on (the invariant above), which implies `resolveApiLine` returned
       `picpony_api`, which implies `proxyFetch` took its retry-in-place path and never called
       this function. The old frontend has the same shape and a toast — 「香港服务器中转异常，
       已切回直连」— that therefore never fires. If the relay is ever allowed to fail over,
       this is where its step goes. */
    return false;
  }

  if (prefs.useApiAccel && Date.now() >= apiState.cooldownUntil) {
    apiState.derpi = true;
    scheduleApiRevert();
    emit();
    announce('直连异常，已切换至备用 API');
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Image line health: degrade, recover, race
// ---------------------------------------------------------------------------

/** Three failures on *distinct* URLs inside this window take a host out for everyone. */
const DEGRADE_WINDOW = 10_000;
const DEGRADE_COUNT = 3;
const WORKER_RECOVERY_MS = 30_000;
const CDN_RECOVERY_MS = 15_000;
/** One probe's own ceiling, and the whole race's. */
const PROBE_TIMEOUT_MS = 8_000;
const RACE_DEADLINE_MS = 5_000;
const NOTIFY_COOLDOWN_MS = 5_000;

type FailureLog = { time: number; url: string }[];

const health = {
  workerRecovering: false,
  cdnRecovering: false,
  raceRunning: false,
  workerFailures: [] as FailureLog,
  cdnFailures: [] as FailureLog,
  lastNotifiedAt: 0,
};

/** A recovery is good news that can arrive several times a minute; throttle it. */
function announceThrottled(message: string, tone: LineNotice = 'success') {
  const now = Date.now();
  if (now - health.lastNotifiedAt < NOTIFY_COOLDOWN_MS) return;
  health.lastNotifiedAt = now;
  announce(message, tone);
}

/**
 * Probe with an `Image()` rather than a `fetch`.
 *
 * These hosts are image proxies, so a decoded bitmap is the only evidence that
 * actually means "this line works". `fetch(HEAD, { mode: 'no-cors' })` — what this
 * repo used before — yields an opaque response that resolves on a 500 as readily as on
 * a 200, so a dead line probed as healthy and the degrade was undone immediately.
 */
function probeImage(url: string, timeout = PROBE_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') {
      reject(new Error('no Image'));
      return;
    }
    const img = new Image();
    let settled = false;
    const timer = window.setTimeout(() => finish(false), timeout);
    function finish(ok: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      if (ok) resolve();
      else reject(new Error('probe failed'));
    }
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = url;
  });
}

const probeUrl = (base: string) =>
  `${base}${encodeURIComponent(IMAGE_PROBE_URL)}&_t=${Date.now()}`;

/**
 * Race the CDN against a direct fetch and keep the winner.
 *
 * Lazy on purpose: it runs when an image has actually failed, and after a worker
 * recovery probe comes back down — never at boot, where it would spend two requests
 * measuring a line the visitor may never need. First success wins; if neither answers
 * inside the deadline the preference decides, so the race can delay a choice but never
 * block one.
 */
export function raceImageLines() {
  if (health.raceRunning || typeof window === 'undefined') return;
  health.raceRunning = true;
  let decided = false;
  const settle = (winner: 'cdn' | 'direct') => {
    if (decided) return;
    decided = true;
    health.raceRunning = false;
    imageState.raceWinner = winner;
    emit();
  };
  probeImage(probeUrl(IMAGE_CDN_BASE)).then(() => settle('cdn')).catch(() => {});
  probeImage(`${IMAGE_PROBE_URL}?_t=${Date.now()}`).then(() => settle('direct')).catch(() => {});
  window.setTimeout(() => {
    if (decided) return;
    const prefs = readLinePrefs();
    settle(prefs.useCdn && imageState.cdnAvailable ? 'cdn' : 'direct');
  }, RACE_DEADLINE_MS);
}

/**
 * Note one failure on a host, and report whether that host is now out.
 *
 * **Distinct** URLs, because a single broken image retried three times says nothing about the
 * line — the whole point of the counter is to tell "this picture is missing" from "this host
 * is down". Both hosts get the same threshold: the CDN used to be dropped on its first
 * failure, so one deleted picture — which 404s on every line — took the CDN out of the
 * session for every other image in the app.
 */
function noteFailure(log: FailureLog, rawUrl: string): { log: FailureLog; tripped: boolean } {
  const now = Date.now();
  const clean = rawUrl.replace(/[&?]retry=\d+/g, '');
  const kept = log.filter((f) => now - f.time < DEGRADE_WINDOW);
  if (!kept.some((f) => f.url === clean)) kept.push({ time: now, url: clean });
  return kept.length >= DEGRADE_COUNT ? { log: [], tripped: true } : { log: kept, tripped: false };
}

export function recordWorkerFailure(rawUrl: string) {
  const { log, tripped } = noteFailure(health.workerFailures, rawUrl);
  health.workerFailures = log;
  if (tripped && imageState.workerAvailable) {
    imageState.workerAvailable = false;
    emit();
    startWorkerRecovery();
  }
}

export function recordCdnFailure(rawUrl: string) {
  const { log, tripped } = noteFailure(health.cdnFailures, rawUrl);
  health.cdnFailures = log;
  if (tripped && imageState.cdnAvailable) {
    imageState.cdnAvailable = false;
    emit();
    startCdnRecovery();
  }
}

function startWorkerRecovery() {
  if (health.workerRecovering || typeof window === 'undefined') return;
  health.workerRecovering = true;
  window.setTimeout(probeWorkerRecovery, WORKER_RECOVERY_MS);
}

function probeWorkerRecovery() {
  /* A hidden tab does not need a line; retry when it comes back rather than probing three
     images every thirty seconds forever in every tab the user has left open. */
  if (typeof document !== 'undefined' && document.hidden) {
    window.setTimeout(probeWorkerRecovery, WORKER_RECOVERY_MS);
    return;
  }
  probeImage(probeUrl(IMAGE_WORKER_BASE))
    .then(() => {
      imageState.workerAvailable = true;
      imageState.raceWinner = null;
      health.workerRecovering = false;
      emit();
      announceThrottled('服务器完成冷却，已恢复至 PicPony 加速服务器');
    })
    .catch(() => {
      /* Still down. Measure the two lines that are left while we wait. */
      raceImageLines();
      window.setTimeout(probeWorkerRecovery, WORKER_RECOVERY_MS);
    });
}

function startCdnRecovery() {
  if (health.cdnRecovering || typeof window === 'undefined') return;
  health.cdnRecovering = true;
  window.setTimeout(probeCdnRecovery, CDN_RECOVERY_MS);
}

function probeCdnRecovery() {
  if (typeof document !== 'undefined' && document.hidden) {
    window.setTimeout(probeCdnRecovery, CDN_RECOVERY_MS);
    return;
  }
  probeImage(probeUrl(IMAGE_CDN_BASE))
    .then(() => {
      imageState.cdnAvailable = true;
      imageState.raceWinner = null;
      health.cdnRecovering = false;
      emit();
      announceThrottled('CDN 加速已恢复');
    })
    .catch(() => {
      window.setTimeout(probeCdnRecovery, CDN_RECOVERY_MS);
    });
}

