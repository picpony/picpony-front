# PicPony front end: agent guide

PicPony is a Chinese-language pony gallery and community frontend built with Material 3.
This file contains global rules and reading routes. Detailed contracts live in [docs/](docs/README.md).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Workflow

1. Read the topic document in the routing table before editing that area.
2. Reuse existing primitives, tokens and domain APIs.
3. Run checks appropriate to the change; run `bun run check` before every commit.
4. Update the owning document when a contract changes. Follow the [writing guide](docs/writing-guide.md).

## Stack and commands

Next.js 16 App Router, standalone output, React Compiler through Babel, React 19,
TypeScript 5.9, Tailwind CSS 4, GSAP, Bun and Node.js ≥ 22.18. Development uses port 3100.
Exact versions and script definitions are in [package.json](package.json).

| Command | When |
| --- | --- |
| `bun run dev` | Local development |
| `bun run check` | Before every commit: whitespace, lint, types, unit suites and generated-output checks |
| `bun run architecture:check` | After changing import directions between `lib/`, `components/` and `app/` |
| `bun run colors:write`, `bun run motion:write`, `bun run emoji:write` | Regenerate owned output; never hand-edit it |
| `bun run test:hero`, `bun run test:overlays` | After changing image detail, Hero or overlays |
| `bun run net:audit` | After changing screen reads or prefetch |
| `bun run test:browser` | Browser regressions |
| `bun run perf:weight` and relevant probes | Bundle or interaction measurement |

`bun run format:check` rejects trailing whitespace on changed lines, including Markdown.

## Code ownership

| Path | Responsibility |
| --- | --- |
| `app/globals.css` | Design tokens: colour, shape, elevation, layers and motion |
| `components/` | Reusable primitives |
| `lib/resource.ts`, `lib/resources.ts` | Resource lifecycle and catalogue |
| `lib/api/` | Backend adapters; `http.ts` is the shared transport |
| `lib/spring.ts`, `lib/motion.ts`, `lib/motion/` | Spring definitions and motion implementations |
| `lib/hero/` | Image-detail shared-element engine |
| `lib/route.ts` | Request-line policy and maintenance state |
| `lib/generated/` | Generated output |

## Global rules

### Design and markup

Find the control in [Primitives](docs/design/primitives.md) before implementing it.

- Use `--md-sys-color-*` utilities. No raw colours, palette classes or token alpha at call sites.
  Use `disabled-content` for disabled ink; `dark:` is only for documented exceptions.
- Take corners from [Shape](docs/design/surfaces.md#shape). Use `shadow-e1` through `shadow-e5`
  only where elevation is required; ordinary controls and cards have no rest or hover shadow.
- Use `--z-*` utilities for application layers. Small local integers are allowed inside a component.
- Use the fifteen M3 type roles, never arbitrary sizes or Tailwind's generic text scale.
- Use `state-layer` and `data-ripple`. Hide native focus outlines with
  `focus-visible:outline-hidden`, never `outline-none`.
- Use the 4 dp spacing grid; half-steps are allowed in dense chrome. Lists/articles use
  `max-w-4xl`, image grids `max-w-7xl`; other widths follow [Layout](docs/design/layout.md).
- Never nest interactive elements. `Card interactive` renders a button. Commands default to
  `type="button"`.
- Loading uses the destination's shape. Spinners report actions; empty and failed states use
  `EmptyState` and `ErrorRetry`.

### UI copy

The product UI is Chinese. Use the shared confirmation, success and error wording, with
`lib/api/errors.ts` for error details. Exact punctuation, templates and action verbs are defined
in [Copy](docs/design/typography-and-copy.md#copy).

### Motion

Use the Material 3 Expressive spring roles through `spring-*`, `springTiming()`,
`surfaceArrival()` / `surfaceDeparture()`, or GSAP's `spring()`. Call sites do not choose curves
or durations. Respect tiers, speeds, custom categories and the documented exceptions.
Animation watchdogs use `MOTION_SPEED_SCALE.slow`. A changing `useGSAP` dependency list needs
`revertOnUpdate: true`. See [Motion system](docs/motion-system.md).

### Scrolling and navigation

The page scroller is `<main class="app-scroller">`; the body does not scroll.
Use `scrollAppToTop` / `scrollAppToElement`. Router navigation passes `scroll: false`;
links pass `scroll={false}`. `lib/scrollMemory.ts` owns route scroll restoration.

Every scroll container uses `.main-scrollbar`, `.popover-scrollbar` or `.scrollbar-hide`.
Use `min-h-full`, not `min-h-dvh`, inside the page scroller.

### Data and backend

Screens read resources rather than fetching directly. Paged lists pass `keepPrevious`;
scope retained data to its owner and filter. Speculation may move a request earlier, never add one.

The Rust backend is `https://api.picpony.top/api/v1/...`. Browsers reach it through the same-origin
API proxy. Success is a bare DTO; failure is non-2xx `{"error":{"code","message"}}`.
Sessions need a Bearer token and `auth_bind`; writes need `X-CSRF-Token`.
Never automatically repeat a write with an unknown outcome.

### Module boundaries and CSS

No import cycles or client paths to server modules. `lib/` does not import components or routes,
except the documented Hero code warmup. Keep heavy engines and feature forms outside the shell's
first document; use existing lazy boundaries. Keep `LS_KEYS`, `COOKIE_KEYS` and `MEDIA` complete.

For CSS fixes, verify emitted selectors and rendered geometry. Read [CSS verification](docs/css-traps.md)
before relying on variants, comment removal, inline transforms or stack margins.

## Read before you touch

| Area | Read first |
| --- | --- |
| Markdown, README, agent instructions | [Writing guide](docs/writing-guide.md) |
| Controls, dialogs, sheets, menus, tabs, toasts, loading and empty states | [Primitives](docs/design/primitives.md) |
| Colours, themes, focus, forced colors | [Colour](docs/design/colour.md) |
| Corners, elevation, layers, state and ripple | [Surfaces](docs/design/surfaces.md) |
| Fonts, rich text, UI strings | [Typography and copy](docs/design/typography-and-copy.md) |
| Widths, spacing, rows, controls and icons | [Layout](docs/design/layout.md) |
| Motion | [Motion system](docs/motion-system.md), then [Component motion](docs/motion.md) |
| Routes, Back, tabs, container transforms, lightbox | [Transitions](docs/transitions.md) |
| Image detail or `lib/hero/` | [Transitions](docs/transitions.md), then [Hero engine](docs/hero.md) |
| Scroll, paging, image lines and sharpness | [Scrolling](docs/scrolling.md) |
| Mascot and desktop ponies | [Companions](docs/companions.md) |
| Service Worker, offline, PWA | [Offline](docs/offline.md) |
| Bundles, React Compiler, Next upgrades, probes | [Performance](docs/performance.md) |
| Versions, security, lockfiles, patches | [Dependencies](docs/dependencies.md) |
| Imports, lazy loading, storage keys | [Module boundaries](docs/module-boundaries.md), [Architecture](docs/architecture-guide.md) |
| API adapters and auth | [Backend API](docs/backend-api.md) |
| Resources, caching, SSR, prefetch, settings sync | [Data requests](docs/data-requests.md) |
| Request lines, relay, maintenance, `proxy.ts` | [Request lines](docs/request-lines.md) |

All documentation follows the [documentation standard](docs/writing-guide.md). Source comments
link directly to current topic sections.
