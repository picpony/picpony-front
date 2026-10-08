/**
 * Visitor statistics (`track_visitor`, decision 15) — the rules, with no browser in them, so they
 * can be tested; `components/VisitorTracker.tsx` supplies the browser.
 *
 * The original front end's contract (`main-D7X40lKR.js` ≈538700), kept:
 * - an anonymous random id in `LS_KEYS.visitorId` (its own key, so an id it stored is kept),
 *   valid when it matches `/^[A-Za-z0-9_-]{16,96}$/` and replaced when it does not;
 * - `{visitor_id, path}` once at load, then every ten minutes while the tab is in view and on
 *   returning to it — never while hidden, never with one already in flight, never within a
 *   minute of the last;
 * - **a signed-in visitor is not counted** — the original skipped whenever a session was stored.
 *
 * Changed, on purpose:
 * - **only a production build sends** (the dev server proxies to the real backend, and the
 *   team's own sessions must not count) and **never a browser under automation or a headless
 *   one** (`navigator.webdriver`, a `Headless…` user agent): the suites and probes would count
 *   themselves;
 * - **the path is the pathname alone** — never the query (search words, share ids) and never the
 *   hash. The original sent `pathname + hash`, which on its single-page site was where the
 *   search words lived (`#q=…`, `#mode=shared_search&user=…&q=…`); no route of this app reads a
 *   hash, the only ones that reach it are those old share links (rewritten on arrival), and an
 *   in-page anchor tells a visit count nothing. A segment that is the visitor's own words or a
 *   share's identity (a subscription's tag, a shared folder's owner) is replaced by its route's
 *   name, for the same reason the query is dropped.
 */

/** The original front end's validity rule for a stored id. */
const VISITOR_ID = /^[A-Za-z0-9_-]{16,96}$/;
/** The original's cap on a path. */
const MAX_PATH = 255;
/** Between two counts while the tab is in view. */
export const VISIT_INTERVAL_MS = 10 * 60 * 1000;
/** The least time between two counts. */
export const VISIT_MIN_GAP_MS = 60 * 1000;

export function isVisitorId(value: unknown): value is string {
  return typeof value === 'string' && VISITOR_ID.test(value);
}

/**
 * A fresh anonymous id in the original's shape (`v<time>-<random>-<random>`), its random part
 * from the platform's generator when there is one.
 */
export function newVisitorId(now: number = Date.now(), random: (bytes: Uint8Array) => void = fillRandom): string {
  const bytes = new Uint8Array(16);
  random(bytes);
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const part = (from: number) =>
    Array.from(bytes.subarray(from, from + 8), (byte) => alphabet[byte % alphabet.length]).join('');
  return `v${now.toString(36)}-${part(0)}-${part(8)}`;
}

function fillRandom(bytes: Uint8Array) {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
    return;
  }
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
}

/** Paths whose segments carry a visitor's words or a share's identity, and what they become. */
const PRIVATE_SEGMENTS: readonly [RegExp, string][] = [
  [/^\/subscriptions\/[^/]+\/?$/, '/subscriptions/[tag]'],
  [/^\/favorites\/shared\/[^/]+\/[^/]+\/?$/, '/favorites/shared/[username]/[folderId]'],
  [/^\/favorites\/privacy\/[^/]+\/?$/, '/favorites/privacy/[ownerId]'],
];

/** What `track_visitor` is told about where the visitor is: see the module note. */
export function visitorPath(pathname: string): string {
  let path = pathname.split(/[?#]/)[0] || '/';
  if (!path.startsWith('/')) path = `/${path}`;
  for (const [pattern, name] of PRIVATE_SEGMENTS) {
    if (pattern.test(path)) {
      path = name;
      break;
    }
  }
  return Array.from(path).slice(0, MAX_PATH).join('');
}

/**
 * Whether this build, in this browser, may count visits at all: a production build, in a browser
 * that is neither under automation nor headless. A headless browser is a script rather than a
 * visitor, and it is how the repo's own probes run — `net:*` and `perf:*` drive Edge over plain
 * CDP, where `webdriver` is false (measured: headless Edge 154 reports `webdriver: false` and a
 * `HeadlessChrome/154` user agent), so without this test every such run against a production
 * build would count itself.
 */
export function trackingAllowed(
  env: string | undefined,
  navigatorLike: { webdriver?: boolean; userAgent?: string } | undefined,
): boolean {
  if (env !== 'production' || !navigatorLike || navigatorLike.webdriver === true) return false;
  return !/Headless/.test(navigatorLike.userAgent ?? '');
}

export interface VisitorTrackerDeps {
  now: () => number;
  /** `document.visibilityState === 'hidden'`. */
  isHidden: () => boolean;
  isSignedIn: () => boolean;
  /** The stored id, or `null`; `store` keeps a new one. */
  readId: () => string | null;
  storeId: (id: string) => void;
  pathname: () => string;
  /** The request. Must never reject; its settling ends the in-flight guard. */
  send: (visitorId: string, path: string) => Promise<void>;
}

/** One tracker per page life: `visit()` is the original's `a()`, guards and all. */
export function createVisitorTracker(deps: VisitorTrackerDeps) {
  let inFlight = false;
  let lastSent: number | null = null;

  const id = () => {
    const stored = deps.readId();
    if (isVisitorId(stored)) return stored;
    const fresh = newVisitorId(deps.now());
    deps.storeId(fresh);
    return fresh;
  };

  return {
    /** Count this visit unless a guard says not to; resolves once the request settled (or at once). */
    async visit(): Promise<boolean> {
      if (deps.isHidden() || inFlight || deps.isSignedIn()) return false;
      if (lastSent !== null && deps.now() - lastSent < VISIT_MIN_GAP_MS) return false;
      inFlight = true;
      lastSent = deps.now();
      try {
        await deps.send(id(), visitorPath(deps.pathname()));
      } finally {
        inFlight = false;
      }
      return true;
    },
  };
}
