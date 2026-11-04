# Offline and PWA

Service Worker caching, offline navigation and installation. Resource caching remains owned by [Data requests](data-requests.md).

## Service Worker scope

[public/sw.js](../public/sw.js) is handwritten. It caches static assets and provides a hard-refresh fallback; it is not an offline-first application shell.

Non-GET requests return without `respondWith`, leaving writes to the browser's normal transport.

| Request | Policy |
| --- | --- |
| Documents and navigations | Network only; on failure serve `/offline.html` |
| `/_next/static/*` | Cache first, with network fallback |
| `/_next/image*` | Stale-while-revalidate, LRU 120, unversioned cache |
| `/api/v1`, `/relay`, `/search-api/*`, RSC payloads | Do not intercept |
| `derpicdn.net`, `wsrv.nl`, `147052.xyz` | Do not intercept |

The exclusions preserve request identity:

- Documents contain the current feed seed, request-line policy and appearance cookies.
- API responses belong to accounts and may carry session cookies.
- Relay responses depend on the current URL validation policy.
- Cross-origin image responses are opaque. Caching them could retain a failed line and bypass the image loader's recovery.

## Updates and registration

Do not call `skipWaiting()` or `clients.claim()`. An active document may still lazy-load its build's chunks. A future “new version ready” prompt and its message handler must be introduced together; there is currently no update message handler.

[components/ServiceWorker.tsx](../components/ServiceWorker.tsx) registers on idle with `?v=<buildId>` and `updateViaCache: 'none'`. Keep the matching cache headers in `next.config.ts`.

Registration is disabled under `navigator.webdriver`. Plain-CDP probes do not set that flag, so they must send `Network.setBypassServiceWorker` before installing network stubs. The Service Worker probe must retain worker control.

## Offline behaviour

`public/offline.html` is a static, script-free document. It can be served at any failed navigation URL without route hydration. Its default-palette colours are a deliberate exception to token-only styling because the application stylesheet is unavailable.

Next's `experimental.useOffline` keeps soft navigation, prefetch, RSC fetches and Server Actions pending across a disconnection. It does not replace the hard-refresh fallback.

`OfflineBanner` is shell chrome below the app bar, included in `--app-chrome-bottom`, with a separate status region. It opens after one second continuously offline and closes after 1.5 seconds continuously online; do not bind its layout directly to every connectivity flip.

## Manifest and icons

- `app/manifest.ts` omits `theme_color`; `app/layout.tsx` supplies it from the selected palette cookie.
- `background_color` controls the installed application's splash.
- `bun run icons` generates 192 px, 512 px and maskable 512 px icons from the existing mark.
- Maskable artwork stays inside the 80%-diameter safe circle. Update the mark and generator together.

## Verification

Run `bun run check`, then `bun run perf:sw` for worker behaviour. Check installation icons after artwork changes.

The offline probe stops the server instead of emulating a page-only network failure: the worker fetches from its own thread.
