# Data requests

Resource reads, caching, SSR seeds, prefetch and settings synchronization. Transport rules are in [Backend API](backend-api.md).

## State ownership

| State | Owner | Key |
| --- | --- | --- |
| Server answers | `lib/resource.ts` | Read arguments |
| Screen state | `lib/screenState.ts` | Screen identity |
| Resource catalogue | `lib/resources.ts` or domain `queries.ts` | Domain-defined arguments |

Screens use `useResource`; they do not fetch directly. Use `useScreenStateFor` when the same screen component can represent different records.

Both stores are in memory. Reloading reloads data. The week-long tag-count and tag-translation caches are separate concerns.

## Resource snapshots

`useResource` returns `{ data, error, isLoading, isStale, isPrevious, refresh }`.

- Show a placeholder when `data === undefined`, not whenever `isLoading` is true.
- Keep existing data visible during refresh.
- Pass `SKIP` for an unselected tab, signed-out visitor or unresolved ID.
- Use `isNotFound`, `isRetryable` and `apiErrorMessage` from `lib/api/errors.ts`. Do not show raw engine errors.
- Paged lists pass `keepPrevious`. If `isPrevious` and `error` are both set, report the failed page turn.
- Scope retained pages by owner and content filter. `SKIP`, a new owner or a changed browsing fingerprint must discard the retained answer.
- Put a filter snapshot in both the resource key and the actual request; policy waits must not change what that key means.

### Refresh and sessions

`refetchInterval` refreshes mounted data quietly, with ±10% jitter. It skips hidden/offline periods and catches up on return. Current message intervals are ten seconds for an open conversation's newest page, 30 seconds for visible contacts and 60 seconds for the shell badge. Reading messages updates `unreadCounts` immediately.

Transport owns session expiry. A token-bearing 401 is confirmed by one `GET /me` per token unless that failing request already was `GET /me`. Token-checked cleanup cannot sign out a newer login. Report session expiry once.

PicPony reads default to a 15-second deadline, overridable by `timeoutMs`. Writes have no default deadline: aborting a client request does not establish that the server rejected it.

## SSR seeds

| Route | Server data |
| --- | --- |
| `/` | Addressed gallery page up to page 20 and anonymous featured image |
| `/?tab=forum` | Initial default forum list |
| `/about` | Team roster |
| `/user/[id]` | Profile header; missing users call `notFound()` |
| Direct `/pic/[id]` | Picture record and glossary names available in time |

The image overlay performs no server read. It starts from its list row. Personal data, search results and keyed featured-image reads remain client-side. A thread is never read on the server, including for metadata, because its read counts a view; it sets its title with `useDocumentTitle`.

### Seed and write contracts

Use `resource.seed(args, value, fetchedAt)` through `initial`; image detail uses `seedImageDetail`.

- Build resolved entries directly. A cold seed or write must not enqueue a fetch.
- Seed synchronously, including the first snapshot and `args`; rAF publication is too late for hydration.
- Preserve `Math.min(generatedAt, Date.now())`. Never relabel old RSC data as fresh.
- Seeding is a no-op on the server, where module state is shared across requests.
- Writes replace and cancel older work, preserve the existing entry's age and publish on the normal paint boundary.
- Imperative `read()` returns the current value, not an obsolete settled promise.
- First entry insertion registers lifecycle cleanup; subscriber placeholders remain distinct from real queued reads.

Keys are pure and identical on server and client. `lib/feedKeys.ts` supplies shared feed keys; `COOKIE_KEYS.browsing` mirrors the fingerprint. Hydration starts with the server fingerprint and adopts the device's after mount. A changed fingerprint shows a new placeholder instead of retaining differently filtered rows. An absent cookie means `DEFAULT_BROWSING_FINGERPRINT`.

### Home cache and filtering

The home feed uses one 120-second process memo with an inner `no-store` fetch. Expired entries await a real upstream response. A 429 or 5xx pauses SSR Derpibooru reads across fingerprints for 15 seconds, honouring `Retry-After` up to 60 seconds.

Do not seed random sorting, `本站讨论` or an unmirrorable browsing fingerprint. A forum deep link leaves the hidden gallery to its idle read. Apply the document's image line through `seedOnImageLine` and `featuredOnImageLine`.

The public blacklist applies to every Derpibooru image search, including `developer` mode. `buildSearchQuery` excludes the newest hundred IDs and `searchImagesByIds` filters them. The anonymous five-minute server cache is invalidated after accepted admin changes and included in the browsing fingerprint.

The featured banner and a directly opened picture are not searches. The banner still applies the device's content settings and spoiler cover.

## Search queries

`parseSearchFilters` / `composeQuery` in `lib/searchQuery.ts` read and update the committed query. Advanced conditions are not a second snippet appended blindly to it; removing an active chip updates the same query.

When site status enables semantic search, Chinese text without query syntax uses `semanticQuery` and `isSemanticText`. Keep the original words in `q`; after parsing, replace the URL with the resolved `tags=` so reloads and shared links reuse the result. `raw=1` searches the original text.

Timeout/unavailable results fall back to the typed query with an explanation. Model-result feedback is offered only when the model produced the tags and uses the sign-in captcha flow. The pending/result row's geometry belongs to [Primitives](design/primitives.md#search-toolbar).

## Prefetch and scheduling

Speculation may move a read earlier; it must not add unused reads.

- `useIntentPrefetch`: hover at 70 ms, focus at 120 ms, mouse/pen press immediately, touch after the 100 ms tap timeout. Cancel on leave or scroll intent.
- Keep route-to-read mapping in `prefetchRoute`.
- Forum detail data warms on press only. Hover/focus and its pager must not count views.
- Container-transform destinations may warm their complete route payload through `prefetchRoutePayload`; their server render does not read the record.
- Next Link prefetch warms code/RSC, not a client component's domain reads.
- Do not fetch page n+1 when page n settles. Pager intent may prefetch it.
- Exceptions: the home route mounts its hidden pane on idle; the image viewer reads ahead within `PAGE_READ_AHEAD` pictures of the list's end in the travel direction.
- `saveData` and the two slowest connection types disable speculation.

Each `picpony` and `derpi` lane has four slots, at most two for background work. Image detail uses the same Derpibooru lane. Abandon obsolete first reads so visible content gets the slot.

## Refresh, invalidation and private data

| Operation | Contract |
| --- | --- |
| `expire` | Keep data and start a background read |
| `invalidate` | Keep mounted subscribers; schedule reread in a microtask |
| `write` | Replace the answer and cancel stale work |
| `clearAllResources` | Abort and drop entries without fetching for the old account |

A same-tick invalidate followed by an authoritative write should send no redundant request. Failed or dropped refreshes leave the original timestamp stale.

`bindResourceRefresh` refreshes visible resources after a minute away or on network reconnection. Every new server reader uses `createServerMemo`; visible Link prefetch can invoke it before navigation. In-flight coalescing remains active even with TTL zero.

Private favourites and their image sequence are memory-only and cleared on lock, expiry or session change. Presence runs every five seconds only while visible; leaving sends inactive with keepalive. Shared private answers hide on leave and are rechecked on return. Never persist passwords.

Image detail stays in `lib/detail.ts` because publication is gated by `isDetailDataPublishable`. It shares the lane scheduler and preserves errors for `peekImageDetailError`; do not fold it into ordinary resources without retaining the publication gate.

## Request ledger

`bun run net:audit` uses stubbed upstreams and Edge over CDP. `--live` checks real payloads and must not write a baseline.

- Assert browser and combined browser/server request ceilings.
- Keep a content floor: a screen must still produce its expected read.
- Assert the content request's round; `r0` means server-seeded content.
- Report timings and maximum rounds without asserting wall-clock speed.
- Wait for documents, RSC payloads and server activity as well as counted APIs. A step that never settles fails at its deadline.
- Clear server tallies per step. Use `PICPONY_SERVER_MEMO_TTL_MS=0` to disable both the process memo and any Next cache revalidation for deterministic runs; retain in-flight coalescing.
- Chrome reads remain counted but are outside the content-round chain. Maintenance and public-blacklist server reads are excluded from `srv`.
- Visitor tracking is excluded on both layers and disabled in development, automation/headless browsers and signed-in sessions.

`scripts/netAuditActivity.mjs` owns the quiet-window boundary. CDP only observes browser requests, so the fixture server must also tally SSR requests.

## Settings synchronization

`lib/settingsSync.ts` owns `SYNCED_SETTINGS`. `SettingsSync` starts it after mounting; do not start it during module evaluation.

Each entry declares storage keys, cloud keys, fallback and scope. Account reads adopt cloud settings; local changes debounce for 600 ms.

- Send the whole settings object: the backend replaces rather than merges it. Preserve unmanaged cloud keys and refresh a cloud copy older than one minute.
- Persist pending changes per account in `LS_KEYS.settingsSyncPending`. Older cloud responses must not overwrite newer local edits.
- A failed write retains the local setting, reports once and offers a retry action. Retry on reconnect, tab return or the next change, backing off to five minutes.
- `device` scope survives logout and can fill a missing cloud key. `account` scope resets on logout and never takes its initial value from another account's device state.
- Scheme, motion tier, speed and custom motion maps stay device-only.
- Palette sync uses `theme`, `themeCustomSeed`, `themeCustomAccent` and `themeHues`. Write `null` for an automatic custom accent.
- Entrance mode also syncs, through `introAnimationEnabled` and `introAnimationBlocking`. Its `device` scope controls logout retention, not whether it synchronizes. An enabled-only setting preserves an existing active mode.
- The `spoilers` filter requires a saved age of at least 16 on the Beijing calendar; the `developer` filter requires developer mode. Recheck on logout, account reads and profile saves.

Add a setting through one registry entry. Mirror SSR-visible values into cookies on installation and sync startup.

## Verification

Run `bun run check`. Read or prefetch changes also need `bun run net:audit`; paging changes need `bun run net:scroll`.

Focused tests include `scripts/testResources.mjs`, `scripts/testNetAuditActivity.mjs`, `scripts/testSettingsSync.mjs` and `scripts/testPalette.mjs`.
