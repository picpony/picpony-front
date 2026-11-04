# Backend API

Protocol and transport rules for the Rust backend at [api.picpony.top](https://api.picpony.top). Resource caching belongs to [Data requests](data-requests.md); Derpibooru routing belongs to [Request lines](request-lines.md).

## Protocol

- The API surface is `/api/v1/...`. The path ID is authoritative; a conflicting body ID returns 400. GET requests have no body.
- A successful response is a bare JSON DTO, or 204 without a body. There is no `success` envelope.
- A failure is non-2xx with `{"error":{"code","message"}}`.
- Login and registration return `{ token, csrf_token, expires_in }`. Read the profile with `GET /me`.
- A session needs both `Authorization: Bearer <token>` and the backend's `HttpOnly` `auth_bind` cookie. Writes also send `X-CSRF-Token`.
- Retryable UI operations such as posting, replying and messaging carry an `Idempotency-Key`. Never automatically retry a write whose outcome is unknown.

## Transport and adapters

[lib/api/http.ts](../lib/api/http.ts) owns transport:

| API | Use |
| --- | --- |
| `api()` | Decoded responses |
| `apiRequest()` + `readApi()` | A stream, header or other access to the `Response` |
| `ApiError` | HTTP status and backend code; `network` / `timeout` for transport failures |

A 404 maps to `notFound`; `notFoundStatuses` adds endpoint-specific cases. Preserve the backend message as `serverMessage`; user-facing errors use [lib/api/errors.ts](../lib/api/errors.ts).

A `CSRF_MISMATCH` refusal happens before the handler runs. Transport refreshes via `GET /auth/csrf` and sends the request once more. Other failures are not automatically retried.

Adapters map Rust's actual field names to domain types. Validate real inputs and nullable fields; do not add speculative aliases or coercions for fields whose types are guaranteed. `readObject` and `listOf` remain appropriate for third-party Derpibooru and image-search responses.

## Browser and server paths

The browser uses the same-origin [API proxy](../app/api/v1/[...path]/route.ts). It:

- Forwards only the backend cookies, removing application preference cookies.
- Removes `Secure` from the returned `auth_bind` cookie when the incoming request is plain HTTP.
- Bounds bodyless requests at 30 seconds; upload bodies use the `BODY_IDLE_MS` pacing rule.
- Expires public filter, blacklist and site-status caches after accepted admin writes.

Server readers and route handlers use `upstreamOrigin()` from [lib/upstream.server.ts](../lib/upstream.server.ts) and append `/api/v1/...`; they do not fetch the relative browser proxy URL. `PICPONY_API_ORIGIN` is the public asset origin, not the backend origin.

## Verification

Run `bun run check` after transport or adapter changes. The focused suites are `scripts/testApiTransport.mjs`, `scripts/testApiErrors.mjs` and `scripts/testSessionAndTags.mjs`. If reads change, also run `bun run net:audit`.
