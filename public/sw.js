/**
 * PicPony's service worker. Hand-written; no Workbox.
 *
 * ## Its one job
 *
 * Make the static assets instant on a repeat visit and give an offline hard-refresh somewhere to
 * land. It is deliberately *not* an offline-first shell: this app's data layer already holds a
 * TTL'd cache with SWR, revalidation on tab return and real cancellation (`lib/resource.ts`), and
 * a second cache underneath it — one that cannot see request identity, staleness or the route
 * policy — would fight it rather than help.
 *
 * ## Rule zero
 *
 *     if (request.method !== 'GET') return;
 *
 * A bare `return`, not `respondWith`. Anything that is not a GET goes through the browser's own
 * stack untouched, which is what keeps uploads, sign-in and every mutation exactly as they are.
 *
 * ## What is never cached, and why each one would be a real bug
 *
 * - **Documents.** Since the SSR pass a document carries three request-scoped things: the first
 *   page of the feed on a 2-minute TTL; the inlined request-line policy, whose entire purpose is
 *   to be in force *before the session's first request*; and the `<html>` attributes derived from
 *   the appearance cookies. A cached document paints the previous visitor's theme — precisely the
 *   flash `COOKIE_KEYS` exists to prevent. Because the document always comes from the network it
 *   always names the current build's chunk URLs, which is also what makes the update story below
 *   work.
 * - **`/api.php`.** It carries the PHP session, and `app/api.php/[[...path]]/route.ts` exists
 *   solely to rewrite `Set-Cookie` so that session survives plain HTTP. A cached body plus a
 *   cached `Set-Cookie` on a shared device hands one user's session to the next.
 * - **`/relay`.** It validates protocol, host, port, credentials **and path**, and AGENTS.md
 *   states that the path check *is* the security of the endpoint. A cache would serve an old
 *   validated response for a URL the current policy may no longer allow, and it echoes the
 *   upstream `content-type`, so caching it stores third-party bytes under this origin.
 * - **`/search-api/*` and RSC payloads.** Both are data.
 * - **The three image proxy hosts** (`derpicdn.net`, `wsrv.nl`, `147052.xyz`). Cross-origin, and
 *   the `<img>` tags carry no `crossorigin`, so the responses are **opaque** — a 500 is
 *   indistinguishable from a 200, exactly the blindness AGENTS.md records the image *probes*
 *   hitting. Caching one would pin a dead line for the session and defeat `lib/imageLoader.ts`'s
 *   degrade ladder, which is the most carefully tuned failure path in the app. Opaque entries
 *   also bill ~7 MB each against the origin quota, and a single gallery page holds 50 thumbnails.
 *   `/_next/image` already covers the gallery.
 */

/* The version rides in the registration URL (`/sw.js?v=<buildId>`), because a file in `public/`
   cannot see a build-time variable — and a changing script URL is exactly what makes the browser
   byte-compare and find a new worker. */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const STATIC_CACHE = `picpony-static-${VERSION}`;
/* No version in the name: an optimised image is keyed on its own URL, which already contains the
   source id and every transform parameter, so it stays valid across deploys. Re-encoding the
   whole gallery on every release is the cost this avoids. */
const IMAGE_CACHE = 'picpony-images';
const IMAGE_LIMIT = 120;

/* A **static file**, not a routed page, and that distinction was measured rather than assumed.
   The worker serves this response at whatever URL the user asked for, so an `app/offline/page.tsx`
   was hydrated against `location.pathname === '/tasks'`, decided the route was `/tasks`, and
   re-rendered it as an app shell full of "加载失败". A fallback served under a foreign URL cannot
   be a routed page; this one carries no script at all. */
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  /* Guarded, because `Cache.addAll` rejects on any non-2xx and a rejected `waitUntil` fails the
     **whole install** - so one missing file would cost the static cache as well as the fallback.
     `public/` is not part of an `output: 'standalone'` bundle and may be served by something in
     front of the app, so a 404 here is a real deployment shape rather than a hypothetical. */
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .catch(() => {
        /* No offline fallback this generation; everything else still works. */
      }),
  );
  /* **No `skipWaiting()`, and that is this app in particular rather than caution in general.**
     It is a long-lived document with module-scope state — the resource store, a live hero
     session — and it now lazy-loads chunks. Swapping the worker mid-session means the page's
     already-loaded chunks are build N while the ones it is about to `import()` come from build
     N+1's cache: a `ChunkLoadError`, introduced by the very pass that added the dynamic imports.
     The new worker takes over at the next full load, which is what the browser does anyway. */
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('picpony-static-') && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  /* No `clients.claim()`, for the reason above: a page loaded without a controller must stay
     without one for its whole life. */
});

/* **There is deliberately no `message` handler calling `skipWaiting()`.**

   One was here, reserved for a future "a new version is ready" prompt, and it was reachable by
   any same-origin script: an extension's PWA helper, a console one-liner, a future button wired
   up without re-reading the paragraph above. `skipWaiting()` on its own is enough to re-associate
   a client that *was* controlled - `clients.claim()` only matters for one that never was - so
   that single line re-enabled exactly the mid-session swap this worker exists to avoid, where the
   page's loaded chunks are build N while its next `import()` resolves against build N+1's cache.
   When there is a prompt to wire up, add the handler and the UI in the same change. */

/** Trim the image cache to `IMAGE_LIMIT`, oldest insertion first. */
async function trimImages(cache) {
  const keys = await cache.keys();
  const excess = keys.length - IMAGE_LIMIT;
  for (let i = 0; i < excess; i += 1) await cache.delete(keys[i]);
}

/**
 * Run work that must never affect what the page receives.
 *
 * Two rules in one helper. **Errors are swallowed**, because a cache write is not part of the
 * response: the image branch used to `await cache.put()` inside the very promise chain it
 * returned, so a `QuotaExceededError` turned a *successful* 200 into `Response.error()` - and a
 * failed image is precisely the signal `lib/imageLoader.ts` reads as "this image line is down",
 * so one storage-full event would have stepped the whole session down the degrade ladder for
 * pictures the server had delivered intact. And the work is handed to **`waitUntil`**, so the
 * browser keeps the worker alive long enough for the write and the trim to finish rather than
 * terminating it the moment the response has been delivered.
 */
function background(event, work) {
  const guarded = work.catch(() => {
    /* Storage full, storage blocked, or the worker is going away. Nothing here is load-bearing. */
  });
  try {
    event.waitUntil(guarded);
  } catch {
    /* The event's lifetime has already ended; the work still runs, just unprotected. */
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /* An RSC payload is data wearing a document's URL, so it has to be tested before the navigation
     branch — `RSC` is the header Next sets on those requests. */
  if (request.headers.get('RSC')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).catch(() => undefined).then((cached) => cached ?? Response.error()),
      ),
    );
    return;
  }

  /* Lower-cased, because Next's route matching is case-insensitive by default
     (`caseSensitiveRoutes` is false) while `startsWith` is not - so `/API.php?action=get_user`
     reaches the PHP session proxy and `/RELAY?url=` reaches the relay while missing both guards.
     Nothing downstream caches today, so this is a guard against the next branch someone adds
     rather than a live hole, and these two lines are the ones documented as the security
     boundary of those endpoints. */
  const path = url.pathname.toLowerCase();
  if (path.startsWith('/api.php') || path === '/relay') return;
  if (path.startsWith('/search-api/')) return;

  if (path.startsWith('/_next/static/')) {
    /* Cache-first with a network fallback. The fallback covers a chunk this generation's cache has
       simply not seen yet - a client on an old document, or one never requested before - while the
       origin still has the file. It does **not** survive a redeploy of that chunk: a
       content-hashed URL that no longer exists 404s, `response.ok` is false, and `import()` throws
       either way. What protects a mid-session deploy is the absence of `skipWaiting()`, not this
       branch. Content-hashed URLs are what make the hit branch safe. */
    event.respondWith(
      caches.match(request).catch(() => undefined).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              background(
                event,
                caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)),
              );
            }
            return response;
          }),
      ),
    );
    return;
  }

  if (path === '/_next/image') {
    /* Stale-while-revalidate. A thumbnail that has already been decoded once should never make the
       user wait again, and the bytes behind a given optimised URL never change. These are
       same-origin and non-opaque - our own re-encoded bytes rather than the CDN's - which is why
       this is the one image path safe to hold, and why the three cross-origin proxies need no rule
       of their own beyond the origin check above.

       **Every cache interaction here is optional.** Opening the store, reading it, writing it and
       trimming it can each fail on a device with storage blocked or full, and none of them may
       change what the page gets - see `background`. */
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMAGE_CACHE).catch(() => null);
        const cached = cache ? await cache.match(request).catch(() => undefined) : undefined;
        if (cached) {
          if (cache) {
            background(
              event,
              fetch(request).then(async (response) => {
                if (!response.ok) return;
                await cache.put(request, response.clone());
                await trimImages(cache);
              }),
            );
          }
          return cached;
        }
        const response = await fetch(request);
        if (cache && response.ok) {
          const copy = response.clone();
          background(event, cache.put(request, copy).then(() => trimImages(cache)));
        }
        return response;
      })(),
    );
  }
});
