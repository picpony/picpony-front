# Module boundaries

Dependency directions, lazy loading and shared state ownership. Start with the [architecture guide](architecture-guide.md) for the module map.

## Dependency rules

- No static runtime import cycles; client code must not reach server-only modules.
- `lib/` must not import `components/` or routes. The one allowed exception is the dynamic `hero/media.ts` → `PicDetail.tsx` code warmup.
- Import API functions from their owning `lib/api/*` adapter and types from `lib/types/*`.
- Public reads belong to public adapters. Admin panels import `* as adminApi from '@/lib/api/admin'` inside the lazy registry.
- Libraries publish notifications through [lib/toast.ts](../lib/toast.ts). [components/Toast.tsx](../components/Toast.tsx) owns rendering and re-exports `showToast` for UI callers.
- Subscription addresses belong to `lib/subscriptionHref.ts`; spoiler hydration context belongs to `lib/spoilerContext.ts`.

`bun run architecture:check` checks aliases, relative imports, re-exports and literal dynamic imports. Runtime cycles, server reachability and the shell's static dependency graph are separate checks.

## Motion modules

[lib/motion.ts](../lib/motion.ts) is the public facade. Implementations in `lib/motion/` import their direct collaborators, never the facade.

| Module | Responsibility |
| --- | --- |
| `engine.ts` | GSAP registration, curves, springs and speed |
| `theme.ts`, `drawer.ts`, `grid.ts` | Their respective interaction lifecycles |
| `tabGeometry.ts` | Geometry reads and motion planning |
| `sharedAxis.ts` | Web Animations playback and style restoration |
| `tabs.ts` | React state, scroll and pane coordination |

GSAP-free helpers stay outside the engine: `appScroller.ts`, `motionTokens.ts`, `pageTransit.ts`, `tabIntent.ts`, `tabScroll.ts`, `springTiming.ts`, `slidingIndicator.ts` and `scrollTo.ts`.

## Initial document and lazy boundaries

GSAP, the Hero engine, Markdown, auth forms, the palette engine and admin API must stay out of the shell's initial static graph.

| Feature | Boundary |
| --- | --- |
| General motion | `lib/motionLazy.tsx` |
| Hero | Shell imports `lib/hero/runtime.ts` or `lib/hero/input.ts`; image features load the engine |
| Markdown | `MarkdownRenderer` lazily loads `MarkdownDocument` |
| Rich-text editor | `dynamic()` with `EditorPlaceholder` |
| Authentication | `AuthModal` owns the live dialog; only `AuthForms` is lazy |
| Captcha and sheet | Dynamic import plus a “has opened” latch |
| Palette generation | Loaded by the theme picker |
| Admin panels | Lazy registry; visited panels stay mounted to retain drafts |

A component mounted with `isOpen={false}` still loads its dynamic chunk. Use a latch when it must wait for first use, and keep the component mounted through its exit.

The Hero engine binds to the runtime through `bindImageHeroEngine`; before binding, forwarded calls return the no-flight result. Guard browser binding and teardown on `window`, because module evaluation also happens during SSR.

Auth loading must preserve Close, Escape, Back and focus handling before form code arrives. Only the currently owned flow may focus the new form; an already chosen control wins.

## Synchronous fallback before motion loads

An event handler must not await a lazy chunk before `preventDefault()` or its state update.

| Entry | Immediate fallback |
| --- | --- |
| `changeScheme`, `changePalette`, `changeCustomPalette`, `changePaletteHues` | Matching `commit*` preference write |
| `startTabTransition` | Record the outgoing offset |
| `TabPanesMotion` | `applyInstantTabScroll` and React pane selection |
| `StaggerGrid` | Show the cards without an entrance |
| `DrawerSwipe` | Button, scrim and Escape still work |
| Route cross-fade | `captureRouteSnapshot` returns `null` |

The shell warms common motion through `runWhenIdle`. Hooks remain unconditional inside loaded child components; do not pass hooks as props. The caller owns refs from its first render.

`routeCrossFade.ts` owns capture; `routeCrossFadePlay.ts` owns playback. Gate capture before cloning when playback is unavailable. Forum transitions use the same split and warm on post intent.

## State ownership

- `lib/appearance.ts` owns appearance storage, cookies, resolved root attributes and subscriptions. Read `motionTier()`, `currentPalette()` and `entranceMotion()` from the root attributes; stored values may still mean “system”.
- Appearance stays GSAP-free. Motion registers callbacks such as `setMotionScaleListener` instead of creating an import back to the engine.
- `LS_KEYS`, `COOKIE_KEYS` and `MEDIA` are complete registries. Add keys and media queries there, not as call-site literals.
- SSR-visible preferences need a cookie and must use the server value until hydration. Synced cookies are mirrored on install and sync startup.
- Palette and entrance synchronization belongs to [Data requests](data-requests.md#settings-synchronization).

A gallery card must not subscribe to router context just to navigate on press. The shell supplies navigation once; `useHeroLink` reads `getImageHeroNavigation()` at event time.

Declaring a resource is pure. Its first entry insertion through `touch` registers it for clear/refresh, including subscriber placeholders, browser seeds and acknowledged writes. Server seeds and pure `peek` calls do not register it. This keeps unused resources removable and private data covered by logout cleanup.

Favourites mutations belong to `lib/favoritesActions.ts`. Confirmed favourites and shares expire that account's task resource; stale responses must not refresh a different account.

## Generated output and server transport

Never hand-edit `lib/generated/`. Use the matching `colors:write`, `motion:write` or `emoji:write` script.

Browser `API_V1` is relative so it reaches the same-origin cookie-rewriting proxy. Server code uses `upstreamOrigin()`; see [Backend API](backend-api.md#browser-and-server-paths).

## Verification

- Run `bun run architecture:check` after changing dependencies between modules.
- Run `bun run perf:weight` against a production build after moving a lazy boundary. A clean import graph alone does not prove smaller document chunks.
- Auth boundaries also need `bun run test:ui` and `bun run test:auth-loading`.
- Motion changes use the checks in [Motion system](motion-system.md#verification) and [Hero engine](hero.md#verification).
