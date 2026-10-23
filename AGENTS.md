<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PicPony front end — agent guide

PicPony is a pony picture gallery and community front end: gallery, forum and personal space on one
Material 3 design system, desktop and phone, installable as a PWA. The UI copy is Chinese.

This file holds only what applies to **every** change. Everything else lives in `docs/`, one file
per subject. **Before you edit an area, open the doc the routing table names for it** — those files
carry the full contracts, the measurements and the history behind each rule.

## Stack and commands

Next.js 16 (App Router, `standalone`, React Compiler via Babel) · React 19 · TypeScript 5.9 ·
Tailwind CSS 4 · GSAP · Bun + Node ≥ 22.18. Dev server on port 3100.

| Command | When |
| --- | --- |
| `bun run dev` | local development |
| `bun run check` | **before every commit**: whitespace, lint, types, all `node --test` suites, palette, motion tokens, hero path, emoji |
| `bun run architecture:check` | after moving imports between `lib/`, `components/`, `app/` |
| `bun run colors:write` / `motion:write` / `emoji:write` | regenerate `lib/generated/` and token output — never hand-edit it |
| `bun run test:hero`, `test:overlays` | after touching the image detail, `lib/hero/` or any overlay |
| `bun run test:browser`, `net:audit`, `perf:*` | browser regressions, the request ledger, probes (Edge over CDP) |

`format:check` rejects trailing whitespace on changed lines, Markdown included.

## Where things live

| Path | Owns |
| --- | --- |
| `app/globals.css` | every design token (colour, shape, elevation, `--z-*`, motion tables) |
| `components/` | the primitives; a call site composes them, it never re-creates them |
| `lib/resource.ts`, `lib/resources.ts` | the data layer and its catalogue |
| `lib/api/` | adapters for the Rust `/api/v1` backend; `lib/api/http.ts` is the one transport |
| `lib/spring.ts`, `lib/motion.ts`, `lib/motion/` | the motion system and its implementations |
| `lib/hero/` | the image-detail shared-element engine |
| `lib/route.ts` | server-pushed request lines and maintenance |
| `lib/generated/` | script output |

## Rules that apply everywhere

**Design system.** Material 3. Tokens are in `app/globals.css`, primitives in `components/`.
**Never re-type either at a call site** — that is how the app ended up with three card radii, five
scrollbar appearances and 29 hand-copied primary buttons. Before writing any control, find its row in
`docs/design/primitives.md` (Button, Input/Field, SearchInput, Select, Menu, Popover, Modal, Sheet,
SidePanel, Card, Chip, Badge, Tabs/TabPanes, IconButton, Tooltip, EmptyState/ErrorRetry, Skeleton,
MasonryGrid, PresenceList, showToast, useConfirm/usePrompt, …).

- **Colour:** only `--md-sys-color-*` tokens through their utilities. No hex, `rgb()`, Tailwind
  palette classes, or an alpha on a token. A `dark:` variant is almost always a bug. Disabled content
  is `disabled-content`.
- **Shape:** the corner comes from the role table in `docs/design/surfaces.md`, never by eye.
- **Elevation:** `shadow-e1`…`e5` only, never `shadow-sm/md/lg/xl`; ordinary controls and cards cast
  no shadow, even on hover. Depth comes from `surface-container-*` first.
- **Stacking:** app layers use the `--z-*` utilities (`z-dialog`, `z-popover`, `z-toast`…), never a
  raw z-index. Layering inside one component stays a small integer.
- **Type:** the fifteen M3 roles (`text-display-*` … `text-label-*`), never `text-sm` or `text-[13px]`.
- **State:** hover/focus/press is the `state-layer` utility plus `data-ripple`, never `hover:bg-*/90`.
  Hide the engine outline with `focus-visible:outline-hidden`, never `outline-none`.
- **Spacing:** the 4dp grid; half-steps are fine in dense chrome, arbitrary values are not. Page
  column: rows or an article `max-w-4xl`, an image grid `max-w-7xl` (others in `docs/design/layout.md`).
- **Markup:** never nest an interactive element inside another. `Card interactive` is a `<button>`.
  Commands default to `type="button"`.
- **Loading** takes the destination's own shape (skeleton rows, `ImageGridSkeleton`); a spinner is
  for an action. Every empty or failed state is `EmptyState` / `ErrorRetry`.

**Copy (Chinese UI).** `…` not `...`; `：` and `，` in Chinese text; `（）` except around a Latin
identifier; one space between a Latin run and CJK (`图片 ID`). Toasts never end in `！`. Confirm
body `确定要…吗？`, title and button `确认X` / `确认`. 删除 destroys, 移除 detaches, 清空 empties.
Success is `已<verb>`; failure is `{X}加载失败`, with the line under it from `lib/api/errors.ts`.

**Motion.** Every motion is a Material 3 Expressive spring. No call site picks a duration or a
curve: pick a role (`fastSpatial`, `defaultEffects`, `layout`, …) through the `spring-*` utilities,
`springTiming()` / `surfaceArrival()` / `surfaceDeparture()` (WAAPI) or `spring()` (GSAP). Respect
the three tiers and speeds; a wall-clock timer that bounds an animation uses
`MOTION_SPEED_SCALE.slow`. `useGSAP` needs `revertOnUpdate: true` when its dependencies change.

**Scrolling.** `<body>` does not scroll; the page scroller is `<main class="app-scroller">`.
`window.scrollTo` does nothing — use `scrollAppToTop` / `scrollAppToElement`. Every
`router.push`/`replace` and every `<Link>` passes `scroll: false`; `lib/scrollMemory.ts` owns
vertical position. Every scroll container carries `.main-scrollbar`, `.popover-scrollbar` or
`.scrollbar-hide`. Never `min-h-dvh` inside the scroller — use `min-h-full`.

**Data.** A screen does not fetch: it reads a resource (`useResource(forumThread, { id })`) and the
resource decides whether that costs a request. A paged list passes `keepPrevious`. A speculative
read may move a request earlier, never add one. Check `bun run net:audit` when a screen's reads
change.

**Backend.** The backend is Rust at `api.picpony.top`, whole surface `/api/v1/...`, reached
same-origin through `app/api/v1/[...path]/route.ts`. A 2xx is the bare DTO (no `success` field); a
failure is non-2xx `{"error":{"code","message"}}`. Session = Bearer token + `auth_bind` cookie, and
every write carries `X-CSRF-Token`. The PHP API (`?action=`) is gone — never reintroduce it. Never
auto-retry a write whose outcome is unknown.

**Module boundaries.** No import cycles; the client never reaches server modules; `lib/` does not
import `components/` or routes (one listed exception). GSAP, the hero engine, Markdown, auth forms,
the palette engine and the admin API stay out of the shell's first document — load them through
`lib/motionLazy.tsx` or a dynamic import. `LS_KEYS`, `COOKIE_KEYS` and `MEDIA` stay complete.

**Verify CSS fixes in the built output.** A class can compile to nothing and look correct in the
source. Read `docs/css-traps.md` once: a variant needs its colon (`peer-focus-visible:focus-ring`),
a class named in a `.tsx` comment is emitted, a transform does not apply to an inline box, a child's
`mb-0` cancels `space-y`.

## Read before you touch

| You are changing… | Read first |
| --- | --- |
| any control, dialog, sheet, menu, tabs, toast, empty/loading state | `docs/design/primitives.md` |
| colour, themes, palettes, links, focus rings, forced colors | `docs/design/colour.md` |
| corners, shadows, z-order, hover/press/ripple | `docs/design/surfaces.md` |
| fonts, rich text (Markdown/BBCode), any user-facing string | `docs/design/typography-and-copy.md` |
| page width, gutters, rows, control or icon sizes, sliders, chips | `docs/design/layout.md` |
| anything that moves | `docs/motion-system.md`, then `docs/motion.md` (per-component roles) |
| route changes, back affordance, tabs, container transforms, lightbox | `docs/transitions.md` |
| the image detail or `lib/hero/` | `docs/transitions.md` and `docs/hero.md` |
| scroll position, pagers, page turns, image lines and sharpness | `docs/scrolling.md` |
| the mascot or desktop ponies | `docs/companions.md` |
| `public/sw.js`, offline, PWA | `docs/offline.md` |
| bundle size, React Compiler, Next upgrades, probes | `docs/performance.md` |
| imports, lazy loading, `lib/` layout, storage keys | `docs/module-boundaries.md` and `docs/architecture-guide.md` |
| an API adapter or auth | `docs/backend-api.md` |
| resources, caching, SSR seeds, prefetch, settings sync | `docs/data-requests.md` |
| request lines, the relay, maintenance mode, `proxy.ts` | `docs/request-lines.md` |

## Section index

Code comments cite sections by name ("AGENTS: Request lines", "AGENTS → Focus"). They now live here:

| Section | File |
| --- | --- |
| Use the primitive, not the class string | `docs/design/primitives.md` |
| Colour | `docs/design/colour.md` |
| Shape | `docs/design/surfaces.md` |
| Elevation | `docs/design/surfaces.md` |
| Stacking order | `docs/design/surfaces.md` |
| State layers | `docs/design/surfaces.md` |
| Typography | `docs/design/typography-and-copy.md` |
| Rich-text rhythm | `docs/design/typography-and-copy.md` |
| Copy | `docs/design/typography-and-copy.md` |
| Layout | `docs/design/layout.md` |
| Five traps that make a fix look applied when it is not | `docs/css-traps.md` |
| Motion | `docs/motion-system.md` |
| `useGSAP` | `docs/motion-system.md` |
| Transitions between screens | `docs/transitions.md` |
| Hero (settled states, following the hand, the press builds the open) | `docs/hero.md` |
| Scrolling | `docs/scrolling.md` |
| Companions: the mascot and the desktop ponies | `docs/companions.md` |
| Offline, and the service worker | `docs/offline.md` |
| The React Compiler | `docs/performance.md` |
| Measuring it | `docs/performance.md` |
| Module boundaries | `docs/module-boundaries.md` |
| 后端已迁移到 Rust /api/v1（api.picpony.top） | `docs/backend-api.md` |
| Data requests | `docs/data-requests.md` |
| Request lines | `docs/request-lines.md` |

Sub-headings (Focus, The springs, The control-height scale, The two stores, …) stay under their
section; `grep -rn "^#" docs/` finds any of them.

## Keeping this guide useful

- Add a new rule to the doc that owns its subject, not here. Only a rule every change must obey,
  in its one-line form, belongs in this file; add a routing row when you add a doc.
- State the rule first and the reason after it; keep measurements and incident write-ups in the doc.
- Dated investigations (like the hero rounds) go in their subject's doc under a dated heading, and
  are folded into the rules once they settle.
- When a section moves, update the index above so code comments keep resolving.
