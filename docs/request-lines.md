# Request lines and maintenance

Server-pushed Derpibooru API/image routing and maintenance state. [lib/route.ts](../lib/route.ts) owns policy; PicPony's own backend protocol is covered by [Backend API](backend-api.md).

## Policy and maintenance

API and image lines are independent. They do not change PicPony's `/api/v1`, avatars, banners or asset origin.

A forced server policy overrides local switches. Settings show the named line with a forced-policy badge and hide switches for that axis.

`app/layout.tsx` renders `MaintenanceScreen` before route reads when maintenance is enabled. Staff retain the shell with a notice. `COOKIE_KEYS.maintenanceStaff` is an SSR hint corrected from the backend's `is_admin` answer in both directions, not authorization.

`lib/maintenance.server.ts` shares the policy read's URL and options and fails open. The development-only `devMaintenancePreview` cookie previews the screen without changing the backend switch.

## Line mapping

| API line | Destination |
| --- | --- |
| `direct` | Canonical `trixiebooru.org/api/v1/json/...` |
| `api_accel` | `PROXY_API_BASE` plus encoded Derpibooru URL; GET / HEAD / OPTIONS only |
| `picpony_api` | Same-origin `/relay?url=…&xp_user=…` |
| `third_party` | Admin-supplied origin with the Derpibooru path and query |

| Image line | Destination |
| --- | --- |
| `direct` | Canonical `derpicdn.net` URL |
| `cdn` | `IMAGE_CDN_BASE` plus encoded URL |
| `picpony` | `IMAGE_WORKER_BASE` plus encoded URL and thumbnail marker |

Apply policy per request over a canonical URL. Do not mutate exported base constants.

`proxyFetch` awaits `ensureRoutePolicy()` on every call. The policy promise never rejects and waits at most two seconds when the document has no policy. A failure retains `auto`; a later answer governs subsequent requests.

`applyImageLine` runs in `lib/api/derpi.ts` for every image-bearing response. It strips an existing wrapper before applying the current policy, including forced direct.

## API keys and rate limits

- A keyed read on `api_accel` uses the same-origin relay so the third-party acceleration Worker does not receive the key.
- `third_party` strips `key=` unless `global_api_third_party_pass_api_key` is enabled.
- A write on a third-party line goes directly to Derpibooru through `applyApiLineToWrite`.
- `xp_user` is an untrusted accounting label, never identity or authorization.
- `/relay` and `/upload/submit` are limited per address: 600 reads per minute and 30 submissions per ten minutes. Exceeding the limit returns 429.

Keys forwarded in URL queries can reach access logs on this server and the relay. Keep the key-stripping branch working even when an administrator enables forwarding.

The current caches and rate limits are process-local. Multi-instance deployment requires the shared storage described in the [architecture guide](architecture-guide.md#deployment).

## Failure and recovery

Forced API lines and `picpony_api` retry in place under the existing three-attempt policy; they do not silently change origin. Forced image lines also stay on the selected line, correcting a pre-policy URL if necessary.

Under `auto`, `useHongKongRelay` defaults on. The relay has no failover. For users who disable it, the reachable ladder is direct → acceleration → direct with cooldown.

| Rule | Value or behaviour |
| --- | --- |
| API cooldown | 30 seconds; ten minutes after 403 / 503 |
| Direct recovery probe | After ten seconds, then exponential backoff up to ten minutes |
| API attempt deadline | 12 seconds |
| Whole retry ladder | 25 seconds, including pauses |
| Line notices | Once per line notice per session |

Only network failures and designated proxy statuses retry. Cancellation, 429 and keyed-request 403 must not trigger failover. A GET resolves only with an OK response; exhausted failures retain their last status in `ApiError`. A user search's 400 is `kind: 'syntax'` and does not offer a retry action.

Image probes use a decoded `Image()`, not an opaque no-CORS fetch. Probing starts after an actual image failure or a recovery probe, not at boot. Both hosts use three distinct failed URLs within ten seconds before degrading.

## Relay and response boundaries

`app/relay/route.ts` makes the server-side hop required by the relay's Origin allowlist.

- Forward GET / HEAD only.
- Validate protocol, host, port, credentials and path. Path validation prevents serving third-party HTML from this origin.
- Reject redirects.
- Bound and validate `xp_user`.
- Preserve the handler's response sandbox policy.

`next.config.ts` applies `frame-ancestors 'self'`, `X-Frame-Options`, `nosniff` and `strict-origin-when-cross-origin`. Exclude `/api/v1`, `/relay`, `/share.php` and `/upload/submit`, whose handlers own their policies; a second config policy can replace the handler's sandbox. Proxies remove upstream server-identifying headers.

Short links are created through `POST /api/v1/share-links`. Visiting `/share.php?id=...` redirects to the backend's preview page instead of serving its user-supplied HTML from this origin.

## Thread-link redirect

`proxy.ts` handles only `/?post=N` and redirects to `/forum/N`. Keep its matcher narrow. A config redirect would preserve the `post` query; in-post links already use the client-side `inAppHref` mapping.

## Verification

Run `bun run check`; routing changes are covered by `scripts/testRouteFallback.mjs`, `scripts/testSiteStatus.mjs`, `scripts/testApiTransport.mjs` and `scripts/testProxyPacing.mjs`. Changes to screen reads also require `bun run net:audit`.
