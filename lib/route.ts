/**
 * Request lines: which host answers a Derpibooru request, and who decides.
 *
 * Two independent axes: the **API line** rewrites Derpibooru `/api/` calls, the **image line**
 * rewrites derpicdn images; PicPony's own API base, avatars and banners are not part of it. A
 * line is a server-pushed policy, not a user preference: only when it says `auto` do the user's
 * own toggles get a vote — and when it is forced, their toggles report the forced value and go
 * disabled; that is the feature working, not a bug. The line is applied per request over the
 * canonical URL (the base constants stay immutable string literals — a bundler folds an `export
 * const` into every call site, so reassigning the module binding changes nothing), and the
 * policy is inlined into the document (see `lib/route.server.ts`) so `proxyFetch` never waits
 * on a client round trip for it.
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

// --- The catalogue ----------------------------------------------------------

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

// --- The user's own line preferences ----------------------------------------

/**
 * Read straight from `localStorage` per call, like `getBrowsingSettings` does. These live here
 * rather than in `BrowsingSettings` because they are the line axis; `usePicponyProxy` is the
 * *image* worker, and using it to gate the API proxy is the defect this module exists to undo.
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

// --- State: the server's policy, and the health `auto` resolves against -----

const policy = {
  api: 'auto' as ApiPolicy,
  image: 'auto' as ImagePolicy,
  thirdPartyUrl: '',
  thirdPartyPassApiKey: false,
};

/**
 * Which API line `auto` is currently on, plus the cooldown that keeps a failed one out. The
 * runtime flags are moved by failover alone, so resolution and announcement always agree.
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

// --- Subscription, for /settings' picker and status line --------------------

let version = 0;
const listeners = new Set<() => void>();

/**
 * Mirror the resolved image line into a cookie so SSR renders the same `<img src>` the client is
 * about to want — identical resolution on both sides, no hydration mismatch. Rewritten on every
 * change (the line moves during a session) and read only at SSR, so a value one navigation stale
 * costs a single corrected `src`, not a wrong one.
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

/* One severity per direction — a recovery arriving as a warning misreports itself. */
function announce(message: string | null, tone: LineNotice = 'warning') {
  if (message) notifier?.(message, tone);
}

// --- The policy, from the server --------------------------------------------

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

/** Where the server left the policy, if the server read one. Inlined by `app/layout.tsx` as a
 *  head script, so it is in force before the first effect in the tree runs. */
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
 * `proxyFetch` awaits this on every call — that await is what stops the first cold-load request
 * going out on the wrong host, and it cannot be left to a boundary whose mount order varies.
 * The document normally already carries the answer (`lib/route.server.ts` reads it during SSR
 * and `app/layout.tsx` inlines it), in which case this sends nothing; the client fetch is the
 * fallback for a server read that timed out or failed.
 *
 * **It never rejects**: any failure leaves the `auto` defaults in place, because a rejection
 * would lock every Derpibooru request behind one dead fetch.
 */
export function ensureRoutePolicy(): Promise<void> {
  ready ??= adoptInlinePolicy() ?? loadRoutePolicy();
  return ready;
}

/** Take the server's answer, or `null` if there is none. Synchronous, so even the very first
 *  `await ensureRoutePolicy()` settles in a microtask. */
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

/** Re-read the policy for /settings' refresh control — always a real request, since the inlined
 *  document is up to `SERVER_POLICY_REVALIDATE_S` old. The global is dropped so nothing can
 *  later adopt the value this call just superseded. */
export function refreshRoutePolicy(): Promise<void> {
  if (typeof window !== 'undefined') delete window.__picponyRoutePolicy;
  ready = loadRoutePolicy();
  return ready;
}

async function loadRoutePolicy(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    /* No `Authorization` header: the four route fields are served to anyone, and sending one
       would mean reaching into `lib/hooks.ts` — a `'use client'` module — from the request layer. */
    const res = await fetch(`${PICPONY_API_BASE}?action=get_maintenance_status&_t=${Date.now()}`, {
      cache: 'no-store',
    });
    const data = JSON.parse(await res.text()) as SiteStatusResponse;
    if (data?.success) applyRoutePolicy(data);
  } catch {
    /* Offline, an HTML error page, a renamed action — all mean "no policy", which is what the
       defaults already say. Swallowed rather than logged loudly; this runs on every cold load. */
  }
  /* Unconditional, so the failure path still brings the runtime line into step with what the
     device has stored; the emit also wakes /settings. */
  syncLinePrefs();
}

// --- Resolution -------------------------------------------------------------

export const apiPolicy = () => policy.api;
export const imagePolicy = () => policy.image;
export const isApiForced = () => policy.api !== 'auto';
export const isImageForced = () => policy.image !== 'auto';

/**
 * Bring the runtime line back in step with the stored preferences; called after a policy lands
 * and whenever /settings writes a toggle. Preferring the relay takes the accel line out of the
 * running — which is also why /settings shows 启用 API 加速 disabled while it is on.
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
  /* The window test comes first: the relay line is a browser-relative URL that Node's
     `fetch` rejects outright, and a *forced* `picpony_api` would otherwise slip past it. */
  if (typeof window === 'undefined') return 'direct';
  if (policy.api !== 'auto') return policy.api;
  const prefs = readLinePrefs();
  if (prefs.useHongKongRelay && apiState.hongKong) return 'picpony_api';
  if (prefs.useApiAccel && apiState.derpi) return 'api_accel';
  return 'direct';
}

/**
 * Priority: a forced policy, then the worker, then whichever host won the latency race, then the
 * plain CDN preference. The race is what makes `cdn` beatable by `direct` where the CDN is the
 * slower of the two.
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
 * Where an image goes when the worker has just failed it — the same ladder minus the worker
 * rung. The worker only leaves the running after the failure threshold, so until then
 * `resolveImageLine` would keep naming the line that just failed.
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

// --- Applying a line to a URL -----------------------------------------------

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
 * Rewrite a Derpibooru URL for one line. Every line starts from the canonical `derpibooru.org`
 * spelling: `trixiebooru.org` is the same site, and the accel worker and the relay both key
 * their caches on the canonical one.
 */
export function buildApiLineUrl(url: string, line: ApiLine): string {
  const derpiUrl = url.replace('trixiebooru.org', 'derpibooru.org');
  switch (line) {
    case 'api_accel':
      return PROXY_API_BASE + encodeURIComponent(derpiUrl);
    case 'picpony_api': {
      /* Our own path, not `cdn.picpony.top` — `app/relay/route.ts` explains why the browser
         cannot reach the relay directly. `xp_user` is the relay's per-user accounting,
         absent for a signed-out visitor. */
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
 * The write path's line, deliberately narrower: a POST cannot travel through a
 * `?url=`-style worker — the accel line answers `GET`/`HEAD`/`OPTIONS` only — so an upload has
 * exactly two possibilities, a third-party origin that speaks the whole Philomena API, or
 * Derpibooru itself.
 */
export function applyApiLineToWrite(url: string): string {
  return policy.api === 'third_party' ? buildApiLineUrl(url, 'third_party') : url;
}

// --- API failover — `auto` only ---------------------------------------------

/**
 * Statuses that mean "this line is not working", rather than "this request was wrong".
 *
 * 429 is deliberately excluded: a rate limit is counted against the caller, so failover does
 * not escape it — it spreads one visitor's limit onto every visitor of the line, and a 429
 * surfaces as itself. A 403 stays, because a proxy legitimately 403s when *it* is the problem —
 * but `proxyFetch` never fails over a 403 on a request that carried a key: that is a credential
 * answer, and no other host will answer it differently.
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
 * Move `auto` off the line that just failed; returns whether there was anywhere to go (`false`
 * means fall back on plain retries — every allowed line has been tried or is cooling down).
 * Under a **forced** policy this does nothing: a line the administrator pinned is not ours to
 * leave, and quietly reverting to direct is what would make 全站强制 meaningless.
 */
export function stepApiFailover(status?: number): boolean {
  if (policy.api !== 'auto') return false;
  const prefs = readLinePrefs();
  const busy = status === 403 || status === 503;

  /* Restore the invariant first: a runtime flag must never be set for a line the preference
     forbids. `syncLinePrefs` normally keeps it, but a preference written in another tab reaches
     `readLinePrefs` without reaching this state — the branches below would then announce leaving
     a line this session was never on, while resolving to the same host it just failed on. */
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
    /* Unreachable: `hongKong` implies the preference is on (the invariant above), which implies
       `resolveApiLine` returned `picpony_api` and `proxyFetch` took its retry-in-place path. If
       the relay is ever allowed to fail over, this is where its step goes. */
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

// --- Image line health: degrade, recover, race ------------------------------

/** Three failures on *distinct* URLs inside this window take a host out for everyone — one
 *  deleted picture (404 on every line) must not take a line down for the session. */
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
 * Probe with an `Image()` (a decoded bitmap), never a `fetch` — these hosts are image proxies,
 * and a `no-cors` fetch yields an opaque response that resolves on a 500 as readily as a 200,
 * so only a decoded bitmap is evidence the line actually works.
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
 * Lazy on purpose: it runs when an image has actually failed, and after a worker recovery
 * probe comes back down — never at boot, where it would spend two requests measuring a line
 * the visitor may never need. First success wins; if neither answers inside the deadline the
 * preference decides, so the race can delay a choice but never block one.
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
 * **Distinct** URLs: one broken image retried three times says nothing about the line — the
 * counter exists to tell "this picture is missing" from "this host is down". One deleted
 * picture 404s on every line and must not take a line out of the session.
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

