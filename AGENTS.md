<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design system

Material 3. The tokens live in `app/globals.css`; the primitives live in `components/`.
**Never re-type either at a call site** — that is how the app ended up with three
card radii, five scrollbar appearances and 29 hand-copied primary buttons.

## Use the primitive, not the class string

| Need                   | Use                                                        | Never                                             |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| Button                 | `components/Button.tsx`                                    | a `<button>` with `bg-primary text-on-primary …`  |
| Text input / textarea  | `Input` / `Textarea` / `Field` from `components/Input.tsx` | a bare `<input>` with border + focus-ring classes |
| Card / section surface | `components/Card.tsx`                                      | `bg-surface-container-low rounded-… p-4`          |
| Dropdown               | `components/Select.tsx`                                    | a hand-rolled absolutely-positioned menu          |
| Dialog                 | `components/Modal.tsx`                                     | a hand-rolled scrim + panel                       |
| Bottom sheet           | `components/Sheet.tsx`                                     | —                                                 |
| Tag / status pill      | `components/Chip.tsx`                                      | —                                                 |
| Press feedback         | `usePressable` (`lib/motion.ts`)                           | `active:scale-95`                                 |
| Scroll-in reveal       | `useScrollReveal` (`lib/motion.ts`)                        | mount-time fades                                  |

## Colour

Only `--md-sys-color-*` tokens, via their Tailwind utilities (`bg-surface`,
`text-on-surface-variant`, `border-outline-variant`, …). No raw hex, no `rgb()`,
no Tailwind palette classes (`bg-slate-800`, `text-red-500`).

A `dark:` variant is almost always a bug: the token already flips. The legitimate
uses are swapping a whole asset (`Logo.tsx`) and nothing else. Reach for the
container/on-container pair instead of hand-picking a second tint.

Pair only within a role — `primary`/`on-primary`, `surface-container`/`on-surface`.
Dividers use `outline-variant`; text-field borders use `outline`.

Deliberate divergences from the spec, all commented in `globals.css`. Do not
"fix" them:

- `primary`, `*-fill` and `media-stage` do not invert between schemes. A brand
  colour and a graphic fill must read as one constant material; only text roles flip.
- Body/label line-heights run looser and tracking runs at half the spec value,
  because Han glyphs fill the em box.
- `accent-*` is a _categorical_ scale (tag categories, staff roles), not a
  semantic one. `lib/tagCategories.ts` is the only thing allowed to pick a hue.

## Shape

The step is decided by the role, never by eye:

| Role                                            | Class          | Value |
| ----------------------------------------------- | -------------- | ----- |
| Button, Chip, FAB, avatar, circular icon button | `rounded-full` | —     |
| Card, grouped-list block, section surface       | `rounded-md`   | 12dp  |
| Text field, Select menu, small tag              | `rounded-sm`   | 8dp   |
| Dialog, Sheet, large media container            | `rounded-2xl`  | 28dp  |
| Gallery thumbnail / grid tile                   | `rounded-lg`   | 16dp  |

`rounded-lg` is pinned to `HERO_TARGET_RADIUS_PX` in `lib/hero/constants.ts` —
the shared-element flyer morphs its corner to that value on landing, so the two
must stay equal.

## Elevation

`shadow-e1` … `shadow-e5` only. Never `shadow-sm/md/lg/xl` — those are tuned for
a white page and are invisible on the dark scheme's near-black surfaces.

Depth comes from the `surface-container-*` tone scale first; a shadow is for
things that genuinely float (dialogs, popovers, the FAB).

## Typography

The fifteen M3 roles: `text-display-*`, `text-headline-*`, `text-title-*`,
`text-body-*`, `text-label-*`. Never `text-sm`/`text-lg`/`text-[13px]`.

`title-*` and `label-*` carry their own `font-weight` token, and `@layer base`
gives `h1`–`h6` theirs. Adding `font-bold`/`font-semibold` on top of those
overrides the token — don't.

## Motion

Curves: `ease-[var(--ease-standard)]`, `--ease-decelerate`, `--ease-accelerate`,
`--ease-emphasized`, `--ease-spring`. In GSAP:
`ease: 'standard' | 'decelerate' | 'accelerate' | 'emphasized' | 'spring'`.
Still name the curve at every call site — the table below is what makes a
transition read as the right _kind_ of movement, and a bare `transition-opacity`
cannot know which one it is. `--default-transition-timing-function` is re-pointed
at `--ease-standard` (200ms) in `globals.css`, so a forgotten one degrades to a
system curve rather than to Material **2**'s, but that is a safety net, not the
convention.

A raw `cubic-bezier()` is a bug wherever the tokens can reach. Two exceptions,
both commented:

- The hero's `REVEAL_EASING`/`HIDE_EASING` and `Select`'s `EASE_*` spell out
  `decelerate`/`standard`/`accelerate` because they are handed to a Web
  Animations `easing:` string, where a failed `var()` would silently fall back
  to `ease`. Same for the top loader's `easing` prop in `app/layout.tsx`. The
  values _are_ the token values; keep them in sync.
- The theme wipe is genuinely off-scale, for the same reason `.m3-progress-arc`
  is: what it animates is a **radius**, and what the eye reads is the area it
  sweeps, which goes as the square. Every M3 curve is one-sided and spends its
  travel up front, so squaring it finishes the wipe before it registers as one —
  measured as the fraction of screen flipped 150ms into 550: symmetric
  ease-in-out 3%, `emphasized` 65%, `decelerate` 87%. A radius wants a curve
  that is slow at both ends and no token is.

`linear` is correct only for a spinner's rotation and for a keyframe track that
has already been sampled along a curve (the hero flight, the sink).

`emphasized` is two cubic segments, so it has no `cubic-bezier()` form — the CSS
token is a sampled `linear()` and GSAP takes the spec path. It hangs back, then
runs through the middle at 2.5x `standard`'s peak speed. That peak is why a
value tuned against `standard` cannot be carried over to it: `AXIS_LAG` in
`lib/motion.ts` had to drop from 0.07 to 0.032 to keep the same visual shear.

Durations: `DURATION` in `lib/motion.ts`, mirrored by Tailwind's `duration-*`.

| Situation                                            | Duration | Curve        |
| ---------------------------------------------------- | -------- | ------------ |
| Enters the screen                                    | 400ms    | `decelerate` |
| Leaves the screen                                    | 200ms    | `accelerate` |
| Begins and ends on screen (hover, colour, indicator) | 300ms    | `standard`   |
| Large container transform                            | 500ms    | `emphasized` |
| Press down                                           | 120ms    | `standard`   |

Always name the properties: `transition-[opacity,transform]`, never
`transition-all` — it animates layout properties too, and it is what made a
button's hover jitter while its shadow grew.

Anything decorative must collapse under `prefers-reduced-motion: reduce`. The
enumeration lives at the bottom of `globals.css`; GSAP helpers branch on
`prefersReducedMotion()`.

## Transitions between screens

Three mechanisms, in order of how much they own:

| Change                          | Mechanism                             | Lives in                         |
| ------------------------------- | ------------------------------------- | -------------------------------- |
| Opening/closing an image        | Shared-element hero flight            | `lib/hero/**`                    |
| Gallery <-> forum, profile tabs | Shared axis (X), 500ms `emphasized`   | `playSharedAxis` / `useTabPanes` |
| Any other route                 | Cross-fade over an inert clone, 400ms | `lib/routeCrossFade.ts`          |

**Tabs.** Panes are marked, never unmounted — `data-tab-pane="name"` plus
`data-tab-pane-active` — and stack in one CSS grid cell so both can be on screen
at once. Never gate a pane on `hidden` or `{cond && ...}`: the outgoing one has
to survive the commit or there is nothing to fade out. Never put a `key` on
`[data-tab-panel]`; that deletes the animation's own targets in the commit that
starts it. Call `startTabTransition` and `router.push(..., { scroll: false })`
in the same tick — there is nothing to wait for.

**Routes.** `RouteCrossFade` snapshots the outgoing page in
`getSnapshotBeforeUpdate` (the only lifecycle that runs before React mutates the
DOM) and fades that inert clone out while `pageIn` fades the new page in. The
two overlap because `--animate-page-transition` carries an 80ms delay with a
backwards fill.

**The hero owns the same pixels.** Every other transition stands down while a
flight is in progress — gate on
`getImageHeroRuntime().phase === 'gallery-idle' && !background`. And nothing may
leave a residual `transform` on an ancestor of a gallery card: the flight reads
`getBoundingClientRect` on press, and only a transform on
`[data-image-detail-background-visual]` is compensated for. Always settle with
`clearProps`, never `translate3d(0,0,0)`.

## State layers

Hover/focus/press are the `state-layer` utility — a tinted overlay at the M3
alpha, painted from the element's own `color`. Not `hover:bg-primary/90`, which
has to be written twice (light + dark) and drifts.

## Layout

Spacing is the 4dp grid (Tailwind's default scale). Half-steps (`gap-1.5`,
`py-0.5`) are fine for dense chrome; arbitrary values are not.

Touch targets: `Button`'s own scale (36 / 40 / 48px) is the sanctioned one —
use the primitive and the question does not arise. Anything with a custom box
under 44px needs the `touch-target` utility, which expands the _hit area_ with a
centred pseudo-element without changing the layout. It cannot be combined with
`data-ripple`, which clips its overflow; those controls need a genuinely bigger
box. `Chip` at `h-8` is a documented exception.

`Button` ships `responsiveLabel` to collapse to a square icon button below `sm`
— use it in any row that would otherwise overflow on a phone.

No press-shrink. M3 gives no size feedback on press; the state layer and the
ripple carry it. `active:scale-*` is not used anywhere and should not come back
— besides being off-spec, a control mid-transform corrupts the rect the hero
flight reads on press.

## Scrolling

`<body>` is `overflow: hidden`. The page scroller is `<main class="app-scroller">`
in `components/AppLayout.tsx`, reachable via `getAppScroller()`. `window.scrollTo`
is a no-op — use `scrollAppToTop` / `scrollAppToElement`.

Every scroll container carries `.main-scrollbar` (page-level, reserves its gutter)
or `.popover-scrollbar` (overlays, no gutter). Never leave one unstyled: the
browser default is a different width and colour, and the app then appears to
change its scrollbar as you navigate.

Never give a child of the scroller `min-h-dvh` — the scroller is already shorter
than the viewport (header + margins), so it forces a permanent scrollbar. Use
`min-h-full`.

## `useGSAP`

`@gsap/react`'s `useGSAP` does **not** run your cleanup on a dependency change
unless you pass `revertOnUpdate: true`. Without it, listeners, `Observer`s and
`ScrollTrigger`s accumulate on every dep change. Pass it, or keep the changing
value in a ref and shrink the dependency list.
