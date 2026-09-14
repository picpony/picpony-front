<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Design system

Material 3. The tokens live in `app/globals.css`; the primitives live in `components/`.
**Never re-type either at a call site** — that is how the app ended up with three card
radii, five scrollbar appearances and 29 hand-copied primary buttons.

## Use the primitive, not the class string

| Need | Use | Never |
| --- | --- | --- |
| Button | `components/Button.tsx` | a `<button>` with `bg-primary text-on-primary …` |
| Text input / textarea | `Input` / `Textarea` / `Field` from `components/Input.tsx` | a bare `<input>` with border + focus-ring classes |
| An arbitrary colour field | `ColorSwatch` (`components/Input.tsx`) — a badge's own colour, in /admin | a bare `<input type="color">` |
| Choosing a theme colour | `PaletteSwatches` — one call site, /settings; the eleventh chip's own two dialogs are `ColorPicker` and `ImagePalettePicker` | a `Select` of colour *names*; `ColorSwatch` for any of the eleven, since the OS dialog speaks RGB where this system speaks HCT and shows a colour where a *theme* is being chosen |
| Radio button | `components/Radio.tsx` | a bare `<input type="radio">` |
| Slider / range | `components/Slider.tsx` | `<input type="range">` plus a global class |
| A one-time code | `components/CodeInput.tsx` | six `<input maxLength={1}>` and a ref array |
| On/off setting | `components/ToggleSwitch.tsx` — `layout="row"` in a list | a `justify-between` div with a bare switch in it |
| Card / section surface | `components/Card.tsx` — `interactive` makes it a `<button>` | `bg-surface-container-… rounded-… p-4` |
| Dropdown (picks a value) | `components/Select.tsx` | a hand-rolled absolutely-positioned menu |
| Menu (runs a command) | `components/Menu.tsx` | a `role="menu"` div with no keyboard support |
| Any other floating panel | `components/Popover.tsx` | a fifth recipe for corner + elevation + border |
| Dialog | `components/Modal.tsx` | a hand-rolled scrim + panel |
| A dialog's action row | `Modal`'s `footer` prop | your own flex row — two `fullWidth` buttons in one cannot fit, since `buttonClasses` always emits `shrink-0`, and a row inside the body scrolls away with the content |
| A tick in a selection control | `components/CheckGlyph.tsx` | `MdCheck`, or a second copy of the same path |
| "Are you sure?" | `useConfirm` (`components/ConfirmDialog.tsx`) | `window.confirm`, or a `Modal` + 4 useStates |
| Asking for one value | `usePrompt` (`components/ConfirmDialog.tsx`) | `window.prompt` |
| Copying to the clipboard | `copyText` (`lib/utils.ts`) | `navigator.clipboard.writeText` with no fallback |
| Reading the session | `useSession` for rendering (`ready` gates login prompts); `readUserInfo` / `readToken` for event-time reads; `updateUserInfo` for token-checked response writes (`lib/hooks.ts`) | reading localStorage in a render initializer, or overwriting a session from a stale response |
| Formatting a date | `lib/format.ts` — four shapes, `zh-CN` fixed | `toLocaleString` with an option object at the call site |
| A PicPony asset URL | `getAssetUrl` / `getAvatarUrl` (`lib/utils.ts`) | `` `https://picpony.top/${path}` `` — three join semantics were in use |
| Bounding a number | `clamp` / `clamp01` (`lib/utils.ts`) | `Math.max(a, Math.min(b, v))` |
| An admin API call | `import * as adminApi from '@/lib/api/admin'` | `api.adminXxx` — `api` is a runtime spread, so it cannot tree-shake |
| Bottom sheet | `components/Sheet.tsx` | a `Modal` on a phone |
| Icon-only control | `components/IconButton.tsx` — `variant="media"` on a photo | `p-2.5 rounded-full` around a glyph |
| Icon control on the app bar | `IconButton` `variant="on-primary"` | a 48px box repeating `focus-ring-on-primary` |
| A close / dismiss control | `IconButton` `dismiss` | hand-writing the quarter-turn hover |
| A hover/focus label | it is automatic — `IconButton` shows its own | `title=` on an icon-only control |
| A label on anything else | `useTooltip` (`components/Tooltip.tsx`) | `title=` where a real description is meant |
| An icon's size | `ICON` (`lib/icons.ts`) — `size={ICON.standard}` | a number picked against the glyph beside it |
| An icon inside a Button | nothing — the primitive sizes its own slot | a `size` on the icon; author CSS beats the svg's `width` attribute, so it is inert |
| An icon inside a Badge | nothing — `Badge` sizes it at 14 (`sm`) / 16 (`md`) | `ICON.dense`; 18 makes the badge 2px taller than one without an icon |
| Heading above a card or list | `components/SectionHeading.tsx` | an `<h2 class="text-title-m-…">` written out |
| Tag / status pill | `components/Chip.tsx` | — |
| Mark beside a name | `components/Badge.tsx` — `tone="media"` on a photo | an inline `<span>` with a container pair |
| Unread count | `CountBadge` (`components/Badge.tsx`) | a hand-clamped `99+` pill |
| Role beside a username | `components/RoleBadge.tsx` | `roleInfo(x).chip` on your own `<span>` |
| Nothing here / it failed | `EmptyState` / `ErrorRetry` | a centred `<p>` in a `<div>` |
| A progress meter | `components/ProgressBar.tsx` | a `h-2` div with an animated `width` |
| A tab row | `components/Tabs.tsx` — `variant` picks the shape | a button row with `role="tab"` and no arrow keys |
| Tabbed panes | `TabPanes` / `TabPane` (`components/TabPanes.tsx`) | `{active === 'x' && …}`, or a `key` on the panel |
| Chat message | `components/ChatBubble.tsx` | a radius picked by eye |
| Overlay behaviour | `lib/overlay.ts` hooks | a second copy of the focus trap / scroll lock |
| Press feedback | `data-ripple` + `state-layer` | an active-scale utility |
| Component motion | `spring-*` utilities / `spring()` (GSAP) or `springTiming()` (WAAPI) | a duration and a curve chosen independently |
| Entrance for a block | `components/Reveal.tsx` — plays on mount; see note below | a hand-rolled fade, or a scroll trigger |
| Scrolling to an element | `scrollAppToElement` (`lib/scrollTo.ts`) | `el.scrollIntoView({ behavior: 'smooth' })` |

**There is one tab control and it is `Tabs`.** The app once had four tab controls: three declared no ARIA roles at all, and the one that declared `role="tab"` implemented none of the contract that role promises — no arrow keys, no roving tab stop, no `aria-controls`. /tasks, which copied the structure (`useSlidingIndicator`, an absolutely-positioned indicator, a `data-tab` per button) before the primitive was reachable, reintroduced the defect `TabBar`'s own comment recorded as fixed: an active tab distinguished by colour with no weight contrast. `variant` covers all three shapes (`underline`, `pill`, `rail`) and `tone` covers /tasks' amber indicator.

**A tooltip is not `title`, and an icon button no longer needs to ask.** `title` gives the OS font at the OS size with no token in it, a delay the page cannot set, nothing reachable on touch — and no `aria-describedby`, because `title` is a last-resort accessible *name* rather than a description, so a screen reader either read it in place of the label or ignored it. `IconButton` renders an M3 plain tooltip from its own `aria-label` (or `title`, or an explicit `tooltip`) and drops the native attribute, so there is only one bubble; anything else that wants one takes `useTooltip`.

`useTooltip` is a hook rather than a wrapper component on purpose: a wrapper must either clone its child — which breaks on any component that does not forward a ref — or introduce a box of its own, which changes layout. A control already owns its element and ref, so handing it props is simpler and layout-neutral.

`title` is still right for one thing: a hint on content that *already shows its text* — a truncated tag name, a relative timestamp's absolute value — where the attribute supplements rather than names.

**`Modal`'s `footer` is one flex row, and it takes a leading member through `mr-auto`.** The row is `flex flex-wrap justify-end gap-3`, so the ordinary case is "spell the buttons in order and they land at the trailing edge". A member that belongs at the *leading* edge — /settings' 重新发送 beside 取消 and 验证邮箱 — takes `mr-auto`, not a nested flex wrapper: an auto margin in a `justify-end` row absorbs the free space to its right. The row wraps as a guard — a fourth action or a longer label then takes a second line instead of being clipped by the panel, which is how the /block-groups row failed. A dialog with two branches gives `footer` a conditional rather than moving the row back into the body.

**`Card interactive` renders a `<button>`.** A `<div>` with a cursor, a state layer and a ripple is a control no keyboard can reach and no screen reader can name — a prop that produces an inaccessible control is worse than an absent one.

**`Card as="a"` exists** so card-shaped `<Link>`s need not hand-roll the whole recipe: an anchor takes the same block/left-align/focus treatment a button does, it just never takes `type` or `disabled`.

`Avatar` has the matching escape hatch: `unoptimized` renders a native `<img referrerPolicy="no-referrer">` for a host that is neither in `next.config.ts`'s whitelist nor willing to serve a request carrying a `Referer` — do not grow a second avatar component for it.

Its `size` is a union — `32 | 40 | 48 | 56 | 'hero'` — rather than `number | string`, so the ladder is a constraint. `'hero'` is for the one avatar that changes size at a breakpoint and cannot be sized inline at all (an inline `width` beats any class); the 96 → 128 pair lives in the component.

**Three primitives stand a default down when the call site names its own** — `Skeleton` for a radius, `Badge` for `max-w`, `ProgressBar` for `w-full`. The pattern matters because `cn` is a plain join: emitting both leaves Tailwind's output order to pick, which is not a decision anyone made.

**`Select`'s trigger is as wide as its widest option, not its current one** — a combobox that resizes when you pick a value re-lays-out the row under the pointer that just chose it (/settings' content filter, options 完全安全 (Safe) and 中等限制 (Spoilers), did exactly that). Every label is rendered into one grid cell with all but the selected one `invisible` and `aria-hidden`, so the browser's own intrinsic sizing takes the max and it stays true when the options change. No measurement, no `min-w` to remember.

**`ToggleSwitch`'s press comes from pointer events, not `:active`.** On a touch screen the browser owns `:active` — Chrome delays applying it and holds it for a minimum period afterwards, so the handle could still sit at its pressed width after finishing its travel. Off a real `pointerup` the shrink and the travel start in the same frame and, both being `FastSpatial`, land together; `pointercancel` and `pointerleave` are part of it, or a press that turns into a scroll leaves the handle swollen.

`Spinner`'s colour is one `tone` axis — `primary` / `on-primary` / `inherit` — not `white?: boolean` plus `inheritColor?: boolean` (a raw colour name as a prop, an illegal fourth state, and a mapping `Button` did at the call site). Note `primary` resolves to **`primary-ink`**: the arc is a mark on a surface over a `secondary-container` track, and on the five palettes whose fill is a pale coat it measures **1.07–2.13:1** against its own `surface` where the ink measures 2.91–2.92 — every non-filled `Button`'s busy indicator.

Press feedback is `data-ripple` plus the `state-layer` utility; there is no `usePressable` hook — nothing in the repo defines one. Press lives in `spawnRipple` (`lib/ripple.ts`) and the `state-layer` utility in `globals.css`, and `Button`/`IconButton` already carry both.

**There is no scroll-driven reveal, and that is a decision rather than a gap.** `useScrollReveal` in `lib/motion.ts` is gone: it never had a call site, because an entrance cascade is for *picture* content — the gallery already has one in `useStaggerGridOn`, ordered by visual position rather than DOM order — while on text it makes rows the reader came for behave like an animation. It was also the only ScrollTrigger consumer, and `lib/motion.ts` registers its plugins at module scope, so the plugin shipped in the root chunk of all twenty routes to serve nothing.

`<Reveal>` is therefore the app's one general entrance helper, and it plays on mount. A below-the-fold reveal, if ever genuinely wanted, does not need ScrollTrigger — an `IntersectionObserver` rooted on the app scroller is a dozen lines, and `PicDetail` already has two. Four constraints carry over:

- **Never above a gallery card** — it parks targets at a `y` offset and the hero flight reads `getBoundingClientRect` on press.
- **Never inside a `TabPanes` pane running `lean`** (i.e. /policy) — the shared axis is already sampling the same nodes' `autoAlpha` and `y`.
- **Never inside any tab pane whose content swaps**, `lean` or not — /user/[id], /messages, /favorites, the home route: the pane transition and the reveal would animate the same nodes on two different clocks.
- **Never over content that already cascades on mount** — /tasks' rows stagger via their own delays, /admin's panel cross-fades as one block; a second entrance on top of the first is the "动画重叠" failure, not extra polish.

**An interactive element may not be nested inside another one.** A `<button>` inside an `<a>` is invalid HTML, and it fails invisibly: the gallery card's spoiler cover was a click-handled `<div>` inside the card's `<Link>`, so the only focusable node was the link — Tab landed on it and Enter navigated to the picture the cover exists to hide. Lift the second control out to be a *sibling* of the link and position it over the top. Where the enclosing element is genuinely the convenience target (the image detail's media box, which zooms on click), keep the container's handler as a pointer affordance and put a real control inside it, so the pointer path and the keyboard path both exist.

For an overlay that has to stay mounted through its own fade-out, `inert` (React 19) is the one attribute that removes it from the tab order and the accessibility tree together; `aria-hidden` alone leaves a focusable element inside a hidden subtree.

`EmptyState` and `ErrorRetry` are two presets over one `StatusView`, so a list that is empty and a list that failed have one silhouette. Both take `size="page" | "pane" | "inline"` — match the enclosure, because a half-viewport block inside a 120px well makes the well scroll.

**`inline` is one sentence and no glyph.** The default tray came to ~155px in wells that cap at 120 — the empty state itself made them scroll; at this size the words *are* the empty state, and a call site with something better to show can pass `icon`. `StatusView`'s outer wrapper is `w-full` for the same family of reason: in a flex enclosure it was a shrink-to-fit item pinned at the start of the row ("暂无标签" against the left edge of a `flex flex-wrap` well), and the obvious call-site fix cannot work — `className` lands on the inner shell, whose 100% resolves against the collapsed wrapper.

**Every** "nothing here" / "that failed" goes through them, including the ones that do not look like a list: the 404, the route error boundary, the image detail's failure, an admin table's empty body.

**`fill` is for the four screens whose entire content is the block** — the 404, the route error boundary, `/derpi/user/[id]`'s failure, and the image detail's failure in both of its presentations. `page`'s own floor is half the viewport, right under a page header and wrong when there is nothing else on screen; a list's empty state must not set it, or the page grows past the viewport.

**`fill` drops `page`'s `min-h-[50dvh]` floor**, and that is not tidying — a floor beside `flex-1` is a competitor, not a backstop. `[data-page-content]` has two in-flow children, the content wrapper *and* the footer (≈190–240px), so `flex-1` divides the space **above the footer**; once that space falls under 50dvh the floor overflows the column and the block lands at the top of the scroller. The block still centres in the region it owns rather than in the viewport, so with a footer present it reads slightly high by design.

The image detail needs threading rather than a prop: `fill` is `flex-1`, so every box between the block and the scroller has to be a flex column, and in the overlay presentation that chain runs through `.image-detail-overlay-content` and the container transform's own fit target — `renderDetailShell` takes a flag for it. It is `flex-1`, not a percentage height, and that is not a style choice: a percentage `min-height` only resolves against a *definite* parent height, and every box between here and the scroller gets its height from flex distribution, which Chrome treats as indefinite — `min-h-full` computed to `auto` and centred nothing. It also needs `[data-page-content]`'s inner wrapper to be a flex column, which it is.

**"Complete" is not "loaded".** `HTMLImageElement.complete` is true for an image that has **failed**, so a `complete` check alone marks a dead image as ready — `FadeInImage` removed its shimmer and left a blank card. The predicate is `complete && naturalWidth > 0`.

And it has to be **assigned, not raised**: the check runs on every change of the layered loader's `displaySrc` and must clear as well as set, or a card that showed anything once never shimmers again and returning to a page whose images had already failed once brings the cards back bare. `npm run perf:pageturn` asserts that count stays zero — every card in view must be showing a shimmer or the give-up plate.

**Loading is the destination's own shape, not a spinner.** A list loads as `Skeleton` rows in the row's own geometry, a grid as `ImageGridSkeleton`, a card as a card. A `Spinner` is for an action in flight — a submit button, an upload, an inline "querying…" — not for a page: a centred dot says "something is happening somewhere" and then reflows the whole screen when the content lands. The test is whether there is a destination shape *yet*, and the shape has to actually match: a placeholder whose spacing or thumbnail differs from the card it stands in re-spaces and shifts the list the moment content lands — the one thing a skeleton exists to prevent.

`Badge` is a *mark* and `Chip` is a *control*. If it has no click handler and no dismiss cross, it is a `Badge`.

**There are two text fields, and the label decides which.** They are one family — same 12dp corner, same tone vocabulary, same `.m3-field` shell — and they differ in exactly one thing, the boundary.

A **labelled** field is a slot in a form: it has a name that has to survive being filled, and it gets M3's *outlined* field with the label floating into the outline. That is the whole point of the pattern: an empty field and a filled one stop being different objects — with a stacked label, a form of six empty fields is six blank boxes with captions floating between them, the caption belonging to the box below as close as the one above.

An **unlabelled** field is not a form slot — a search box, an admin filter, a chat composer, a thing you type into and act on immediately, whose placeholder is its whole identity. It gets the *filled* treatment: `surface-container-high`, no border, no shadow; dressed as an outlined field it read as a form control whose label had failed to load, and it put the heaviest boundary around the least ceremonial thing on screen. The tone step is the same one the unselected filter chip takes and the same one `Select`'s trigger already had, so a filter bar is one material.

The notch is a real `<fieldset>`/`<legend>` pair, not a label painted over the border with a matching background: an M3 outlined field has no fill, so there is no colour to paint with, and a `<legend>` is the only thing in CSS that removes a section of a border. Two elements therefore carry the same words — the `<label>` the user reads and an invisible copy inside the `<legend>` whose only job is to be the right width. They stay in step because the legend's font-size is exactly 0.75x the label's and the label scales to 0.75 as it floats, 0.75 of `body-l` being `body-s`. All of that lives in `.m3-field` in globals.css, because it turns on `:focus-within` and `:placeholder-shown` matching against a *sibling*.

The `<fieldset>`'s negative top inset exists to cancel the UA drawing the top border through the vertical centre of the `<legend>`, so it must be zeroed when there is no legend — left in, an unlabelled 44dp field painted its line 6px above its own box. When a field's geometry looks *slightly* wrong, measure the painted line, not the element's rect.

**Focus is the same indicator on both, painted in the two places each boundary leaves room for.** The outlined field has no ring: its focused outline is `primary` at 2px — the ring's colour at the ring's weight, drawn as the control's boundary instead of as a second boundary outside it, since a control whose whole identity *is* a 1px outline cannot wear a ring around that outline without reading as two nested boxes. The filled field has no outline to nest inside, so it takes the ordinary ring. Both key off `:focus-within`, because the element wearing the indicator is the container and it is reporting on the control inside it.

**An unlabelled field can carry its own actions.** `trailing` puts controls inside the box — /search's submit and 以图搜图 live there. It is a flow item, not an overlay: one button, two, or a button with a word in it all fit with no width reserved at the call site, and the control shrinks by exactly the slot's width because the slot refuses to shrink and the control's `min-width: 0` lets it.

**One inset, all the way round the slot: 8dp** — `(56 - 40) / 2`, the field's height minus the control's, so it is not a chosen number, it is the only value that centres the control. Two different insets around one object is what reads as "the button is not centred"; it also makes the concentric-corner rule checkable, since `inner = outer - gap` needs a single `gap`. And only **one** control in the slot carries a container — the primary action: a field's trailing icon is a glyph at `on-surface-variant` (`TrailingIconColor`), so 以图搜图 is a `standard` icon button; two filled containers inside one pill gave the secondary action the primary one's voice.

Judge it per field, though: a search box is one field and one action pressed once, so collapsing them into a single object helps; a composer is the thing you live in while typing, and /messages briefly burying send and emoji inside the field was worse — three plain targets became one crowded box.

`Input` has **one height for a form slot and one for chrome**. Both the labelled and the unlabelled field are M3's 56dp, and `size="lg"` is M3's *search bar* — also 56dp, but a pill — for the single field on /search that is the whole point of its page. They differ in exactly one thing, the boundary. A labelled field with nothing to suggest is given a single-space placeholder, because `:placeholder-shown` is what tells the label whether the field is empty and it only matches while a placeholder exists.

`size="sm"` is the other axis — 40dp with `body-m`, matching `Select size="sm"` to the class string, for a field that is *chrome*: an admin filter, a control in an `.m3-row`. M3 offers no 40dp field, so this is a **stated divergence**, argued by the enclosure: the neighbours are a 40dp dropdown and a 32dp chip. It is unlabelled-only, because the notch's legend width, float distance and negative fieldset inset are all derived from 56dp, and a labelled field lives in a form column anyway. It takes **no `trailing` slot** — that inset is `(56 − 40) / 2`, so a 40dp box has no room to centre a 40dp control, and forbidding it is what keeps "one inset for every field size" true rather than forking it. `SearchInput` bakes it in rather than offering it, since every call site of that component is a filter bar.

A `Textarea` follows the same rule through its block padding rather than a fixed height, since it grows. Get the number by measuring: this app's `body-l` line box is 28px rather than the scale's 24, because the body line-heights run looser for Han glyphs (a documented divergence several sections down), so symmetric **14px** is what lands a one-row unlabelled textarea on `BARE_HEIGHT`'s 56dp. A derived number needs a line in the docstring saying what it was derived from, or the next scale change orphans it — 10px was correct while the unlabelled field was 48dp, and when 48 left the control-height scale the textarea was quietly left behind, ending up *shorter than the two buttons flanking it* in /messages' composer.

Both `Badge` and `Chip` are easy to write out by hand without noticing, because the class string is short and looks harmless: `rounded-full px-2 py-0.5 text-label-m` plus a container/ink pair was pasted at fifteen sites, in three type roles, each naming both halves of its colour. The tell is `rounded-full` on something holding text that is not a button — for a dismissible tag that is the wrong shape twice over, since a chip is 8dp.

`Button` variants, so a semantic action never has to be hand-rolled: `filled` · `tonal` · `accent` · `text` · `danger` · `danger-text` · `success` · `warning`. The four semantic ones take the scheme-independent `*-fill` pair rather than the `error`/`success`/`warning` *text* roles, which flip between schemes — a filled confirm button wearing a text role visibly swapped shade with the theme. `danger-text` exists because `variant="text"` plus a `className="text-error"` emits two colour utilities and lets Tailwind's output order decide which wins; `cn` is a plain join and resolves nothing.

**There is no outlined button**, and M3 does specify one. All four of its uses were a secondary action beside a filled primary one (取消 next to 保存, 重置 next to 检索), and at that job a 1dp keyline reads as a button that lost its fill rather than as a quieter button; `tonal` is the step M3 puts directly below `filled` for exactly this pairing, and it separates from the surface the way everything else here does, by a container tone rather than by an edge. Removed rather than left unused, because a variant that exists gets reached for. The same reasoning retired the filled field's border and the filter chip's: this app separates by tone.

`IconButton` keeps its `outlined` variant, and that is not an inconsistency — it is the one "switch that is currently off", which is what M3's outlined icon button means. It also owns the shape axis: `shape="square"` is the back affordance's 12dp corner.

## Colour

Only `--md-sys-color-*` tokens, via their Tailwind utilities (`bg-surface`, `text-on-surface-variant`, `border-outline-variant`, …). No raw hex, no `rgb()`, no Tailwind palette classes (`bg-slate-800`, `text-red-500`).

A `dark:` variant is almost always a bug: the token already flips. The legitimate uses are swapping a whole asset (`Logo.tsx`) and nothing else. Reach for the container/on-container pair instead of hand-picking a second tint.

Pair only within a role — `primary`/`on-primary`, `surface-container`/`on-surface`. Dividers use `outline-variant`; text-field borders use `outline`.

**`scripts/palette.mjs` generates every tonal value, and it is the authority.** Run `npm run colors` for the diff, the contrast table and the ten-theme matrix, `npm run colors:write` to write. Three products: the **default** theme's declarations are substituted in place in `globals.css` — it only touches `--md-sys-color-<token>: #hex;` lines, so the ~40 paragraphs of reasoning between them survive — while the nine character themes are written wholesale to `app/theme-palettes.css` and their brand colours to `lib/generated/themeColors.ts`. Both generated files are also *checked* on a plain run, so a stale one is a failure rather than a silent disagreement. It is **idempotent** against the current file, and it exits non-zero rather than writing if a tone lands off target, the neutral-variant palette's chroma moves, or any theme drifts from the default on any measured pair.

The basis is **HCT**, because that is the space M3 quotes its own numbers in: "neutral chroma 6" means 6 in HCT, and no single OKLCH chroma means the same thing at every lightness. Role → tone is verbatim from AOSP's `ColorLightTokens.kt` / `ColorDarkTokens.kt` (v0_210). `accent-*` stays in OKLCH and that is not an inconsistency — an even hue sweep at fixed lightness and chroma is the entire point of that scale, and OKLCH is where that relationship is expressible.

### The palette axis: eleven themes, and `primary` is not derived

`data-palette` on `<html>` selects one of ten built-in themes or the user's own. Each theme is **two literal hexes from the MLP-VectorClub colour guide** — the character's coat Fill for the light scheme and the *same surface's* Shadow Fill for the dark one. Nothing computes them, nothing rounds them, and `npm run colors` emits them byte for byte. Everything else is shared: the role→tone map, the harmony (M3's own, see below), the semantic ramps, and the three things still solved from those two fills.

**The rule reads the fill rather than deciding it.** Two earlier schemes failed by reasoning rather than looking: the seed's own tone (a property of the **artwork** — a pony is drawn pale so a black outline reads against it) scattered the ten across tones 37–90 with no rule behind the scatter; and a defensible, checkable rule (hue from the seed, tone from Material's 500 row, chroma held to the brand's) produced mud-or-shout yellows and pinned six of ten themes to the sRGB gamut edge. The colour that looked right was `#FAF5AB` — 小蝶's actual coat, which an artist chose — so the rule stopped trying to *decide* the brand fill and started *reading* it.

**The Shadow Fill is why the dark scheme needs no rule either.** Shading is the artist already answering "this same material, one step deeper", so the pair is guaranteed to read as one surface in two lights — exactly what `primary` is specified to be here (it does not invert between schemes). A tone shift computed from the light value is a second opinion about a question already answered: the guide's own shadow values sit within 0.9–7.5° of hue for six characters, and for the three where it drifts (瑞瑞 23°, 苹果嘉儿 15°, 邪茧 12°) the drift *is* the artwork — taking the artist's answer is the whole point.

#### What is still derived

| | |
| --- | --- |
| the ramp | the light fill's hue, at `rampChroma` |
| `on-primary` | white where white clears 3:1 on **both** bars, else the ramp's tone 20 |
| `primary-ink`, light | the lightest tone ≤ the light fill's that makes 2.9:1 on `surface` |
| `primary-ink`, dark | the darkest tone ≥ the dark fill's that makes 3:1 on the dark page |
| everything else | the role→tone map and the harmony, both M3's |

#### The harmony is M3's, verbatim

```
secondaryPalette:      hue,        chroma 16
tertiaryPalette:       hue + 60°,  chroma 24
neutralPalette:        hue,        chroma  6
neutralVariantPalette: hue,        chroma  8
```

These four numbers were once offsets reverse-engineered out of globals.css — `#755360`, `#894d1f`, `#7f7378` — kept because changing them would move the default theme, not because they were correct: measured against the spec they were secondary chroma **19.4** (21% high), tertiary **+57.31° chroma 37.1** (55% high) and neutralVariant **−9.48° chroma 6.7**, with only `neutral` already exact. Switching cost **18 declarations** in the default theme (`outline`, `on-surface-variant` and `outline-variant` among them, the two most repeated non-brand colours in the app); the measured pairs did not move (`outline`/`surface` is still 4.27:1 light and 5.83:1 dark). Paid once.

**The chroma stays flat even though `primary`'s is not.** M3 pairs a constant secondary 16 with a constant primary 36 — a ratio of 0.44 — while this app's primary ramp runs **45.5–79.4**, so the ratio here lands between **0.202** (碧琪, chroma 79.4) and **0.352** (邪茧, chroma 45.5). Making secondary proportional would restore the ratio and would *not* be M3: the spec's number is a constant, and a focus ring that gets louder on the more saturated themes is a focus ring answering a question about the brand rather than about the keyboard.

**ASSERTION 8 is what makes any of this checkable.** ASSERTION 2 measures emitted chroma against *this repo's own* constant, so it is self-referential — a dependency bump that retuned TonalSpot would have passed every check in the file. ASSERTION 8 builds a real `SchemeTonalSpot` per theme and compares all four palettes at every tone the role map uses; `primary` is excluded, because the library pins it flat at 36 and this app's is `rampChroma`. It passes today for all ten, and it fires on a **one-unit** chroma drift.

**`error` deliberately does not follow M3, and that is not an oversight.** The spec pins it at hue 25 / chroma 84; this one is hue 22 / chroma 67.2 — the three degrees are worth nothing either way. What matters is that `success` (chroma 43.9) and `warning` (chroma 39.0) have **no M3 equivalent at all** (the spec has no such roles), and taking 84 for the one ramp that has a spec would make the error toast visibly louder than the success toast beside it — a severity ordering nobody chose. The three are tuned as a set.

**`rampChroma` is measured at `CHROMA_REFERENCE_TONE` (61), not at the fill's own tone, and that is the one non-obvious line in `lib/paletteRule.ts`.** A pale fill is pale because it sits where the gamut is *narrow* — `#FAF5AB` is chroma 30 at tone 95 where only 62 is available, while at tone 61 the same hue holds 67. Reading the chroma at the fill's tone built the entire primary palette at chroma 20 and made `primary-ink` — the colour of every glyph, tab indicator, checkbox and focused field outline in the app — come out `#a69166`, a khaki-grey; measured at tone 61 that theme's ink is `#9c9700`, a clean gold, and across the ten the inks run chroma 40–79 with no muddy member. ASSERTION 6 is that floor.

The consequence to carry: **a theme's fill and its ink are allowed to be very different colours** — 小蝶's bar is a cream and her ink is a gold. That is correct (one answers a question about a surface and the other about a mark) and it is what lets a pale-coated character have a usable theme at all; under the old rule three themes had `ink != fill`, now eight do.

| id | 标签 | primary 浅 / 深 | primary-ink 浅 | on-primary | 出处 |
| --- | --- | --- | --- | --- | --- |
| `default` | 默认 | `#e06c9f` / `#cb5b8d` | = fill | white | 品牌，无出处可取 |
| `applejack` | 苹果嘉儿 | `#faba62` / `#ef9c54` | `#ca8501` | `#462b00` | 毛色 Fill / Shadow Fill |
| `fluttershy` | 小蝶 | `#faf5ab` / `#f3e488` | `#9c9700` | `#343200` | 毛色 Fill / Shadow Fill |
| `lyra` | 天琴 | `#8cffdb` / `#62dfb2` | `#00a785` | `#00382b` | 毛色 Fill / Shadow Fill |
| `chrysalis` | 邪茧 | `#1e837f` / `#00454a` | `#008581` | white | 甲壳上段 中段 / 前段 |
| `rainbow` | 云宝黛西 | `#9bdbf5` / `#8cc7e7` | `#01a0c6` | `#003544` | 毛色 Fill / Shadow Fill |
| `luna` | 露娜 | `#363e7a` / `#282d5a` | `#27359e` | white | 毛色 Fill / Shadow Fill |
| `rarity` | 瑞瑞 | `#5e50a0` / `#4a1767` | `#5e4ab5` | white | 鬃毛 Fill / 渐变暗部 |
| `twilight` | 暮光闪闪 | `#cc9cdf` / `#bf89d1` | `#bd77dc` | `#500670` | 毛色 Fill / Shadow Fill |
| `pinkie` | 碧琪 | `#eb458b` / `#bb1c76` | = fill | white | 鬃毛 Fill / Outline |
| `custom` | 自定义 | the user's hex / derived | — | — | 选择颜色，或 从图片取色 |

Three characters have no usable coat and take the next feature the guide gives them, which is also what ASSERTION 4 guards. **Cite the Fill row, not the Outline** — the Outline is the dark line drawn around a shape rather than the colour a character reads as. 瑞瑞's coat **Fill** is `#EAEEF0` at chroma 5.3 (her Outline `#BDC1C2` is 4.9 — a white pony either way) and 邪茧's is `#2A2A2A` at chroma 1.0, so they take a mane and a carapace. 碧琪 takes her mane because her coat **Fill** is hue 353.2 against the brand's 355.7 — the same colour, two degrees apart.

#### Three divergences, all deliberate, none to be "fixed"

- **Three dark bars have no boundary against the dark page.** 邪茧, 露娜 and 瑞瑞's Shadow Fill lands at tone 20–26 against a tone-6 page, measuring **1.42–1.72:1** where WCAG 1.4.11 asks 3:1. The alternative measured worse: lifting them to the tone-42 floor makes 露娜's *dark* bar lighter than her light one (28 → 41), the "came out lighter in dark than in light" defect this repo has already shipped once. The white ink on those bars is 10.8–13.1:1, so nothing on them is unreadable — what is lost is the bar's edge, and for a night-sky character that is close to the intent. `DARK_SEPARATION` still governs `primary-ink` in dark, and still governs the *custom* palette's derived fill.
- **Two light bars have no boundary either**, for the mirror reason: 小蝶 1.07:1 and 天琴 1.15:1 against their own near-white page — both characters are drawn at tone 93–95. Their bars read by their dark ink rather than by an edge, which is how a yellow-branded app has always looked.
- **露娜 and 瑞瑞 are 13.8° apart in hue**, under ASSERTION 5's 15° bar, and are the second named exemption beside 默认/碧琪. They are separated by **tone** — 28 against 39, a near-navy beside an indigo — where 默认/碧琪 are separated by chroma. 露娜's *mane* would clear the bar outright at 20.5°; her coat was chosen over it anyway.

#### Eight assertions

ASSERTION 1 (tone fidelity, now skipping the five roles that are literal hexes rather than ramp positions) · 2 (the neutral-variant palette is at the chroma the recipe asked for — its second form is *gone*: comparing against globals.css's current values froze whatever the file happened to hold, so when the harmony moved to M3's numbers the check fired and, because failures flush before `--write` runs, **blocked the very write that would have legitimised the change**; the hand-edit case is covered better by the CHANGED/idempotence check, which tests every token rather than three) · 3 (the `spread`/`floor`/`report` matrix) · 4 (**a built-in fill must define a hue** — chroma ≥ 15; this is the check that picks 瑞瑞's and 邪茧's rows for them, and it is deliberately *not* applied to the user's colour: ten themes chosen from a colour guide can afford to insist on a hue, and a person who wants a grey theme is not making a mistake. `rampChroma` tapers its chroma floor to zero as a fill runs out of hue, so `#808080` lands on a near-monochrome scheme — M3's own `SchemeMonochrome` reached from the other direction — rather than on a grey bar over a randomly-hued ramp; the taper is inert above chroma 15, so no built-in theme is touched by it) · 5 (the hue wheel and its two exemptions; the tightest gap that is *not* an exemption is 天琴 against 邪茧 at 18.6°) · 6 (**every `primary-ink` is chroma ≥ 35** — the checkable form of the `CHROMA_REFERENCE_TONE` argument above) · 7 (no theme's `primary` is `DislikeAnalyzer.isDisliked`) · 8 (**the harmony matches a real `SchemeTonalSpot`**, at every tone the role map uses, for all ten themes — the one check that is not self-referential, see the harmony section).

#### The eleventh palette: the user's own colour

One hex, through either of two doors — 选择颜色, where a colour is named, or 从图片取色, where one is found. Both set `primary` directly, exactly as a character's coat Fill does: **there is one rule in this system and the custom palette is not an exception to it.** Only the dark fill differs, because the ten get a second hex from the guide and this one has no artist to ask — `deriveTheme` falls back to seven tones down, floored against the dark page.

Nothing about it is generated, so it is **not** in `lib/generated/themeColors.ts`'s `PALETTES` array; that file carries only the id, because `PaletteId` is what every consumer validates against and a union that cannot express the palette the user chose is a union that silently downgrades them to the default.

| Concern | Where |
| --- | --- |
| The recipe | `lib/paletteRule.ts` — no `'use client'`, so all three consumers can import it |
| Naming a colour | `components/ColorPicker.tsx` — a `Modal`, and the app's own rather than the OS's |
| Finding one in a picture | `components/ImagePalettePicker.tsx` — its own dialog, not a section of the other |
| What either one shows | `components/PalettePreview.tsx`, shared, so the two cannot disagree |
| The seed | `LS_KEYS.paletteCustom` and `COOKIE_KEYS.paletteCustom`, a seven-character hex |
| First paint | `app/layout.tsx` derives it server-side into `<style id="palette-custom">` |
| Re-deriving | `lib/paletteLazy.ts`, a dynamic-import seam like `lib/motionLazy.tsx` |
| Installing | `applyCustomPalette` in `lib/appearance.ts` — replaces that same `<style>` |
| The wipe | `changeCustomPalette`, which guards on the **seed** rather than the id |
| The chip | an eleventh radio in `PaletteSwatches`, disabled until a colour exists |
| The chip's face | `components/PaletteChipFace.tsx`, shared with the ten and with both dialogs |
| Image extraction | `sourceColorsFromPixels` + `imageOptions`, both in the lazy chunk |

Nine things about it are load-bearing:

- **The cookie carries the seed, not the sixty declarations.** A stored *output* goes stale the moment the rule moves — exactly what happened to the ten twice — and re-deriving costs one HCT run, memoised by `deriveThemeCached`.
- **The server derives it.** `lib/paletteRule.ts` is a plain module, so `app/layout.tsx` ships all sixty declarations in the first byte. No client equivalent: the pre-paint script runs before any stylesheet resolves and cannot carry HCT, and the lazy chunk lands after several paints.
- **A `<style>`, never inline properties on `<html>`.** Inline beats every selector including `html.dark[data-palette='custom']`, so a scheme flip would keep painting the light values. As a stylesheet the specificity is (0,1,1)/(0,2,1) — exactly as the generated file — so `applyScheme` needs no knowledge of it, and the rules come from the same `paletteBlocksCss` as `theme-palettes.css`: they cannot diverge.
- **The pre-paint script's `C` object is the validation list**, gaining `custom` only when *this request's* cookie carried a usable seed; a stored `custom` with nothing rendered for it falls back to `default` rather than a palette no stylesheet answers to (one line, malformed and cleared-cookie alike).
- **The chip cannot read the tokens** — they are always the *active* theme's, so its first draft turned 露娜's blue the moment you selected 露娜. `applyCustomPalette` parks the four hexes (`primary`/`on-primary`, per scheme) on `<html>` as `data-palette-tones`, left there when you switch away.
- **A `dynamic()` dialog needs `loading`, and its absence is a page-level bug.** Both dialogs are `dynamic()` — together a 32-cell gamut-aware grid, a hue rail and Monet's quantiser — and without `loading` the component **suspends** to the *route's* boundary: the first press of 选择颜色 replaced all of /settings with its route skeleton. `loading: () => null` moves the boundary onto the dialog, whose own skeleton covers the gap. Each also holds a one-way "has ever opened" latch, or `dynamic()` fetches at mount and a user who only names a colour still pays for the quantiser.
- **The extraction is Monet's ranking.** `QuantizerCelebi` then `Score`: proportion × 100 × **0.7**, plus `(chroma − 48) × w` with **`w` asymmetric — 0.3 above the target, 0.1 below**; the filter drops chroma < 5 **and** proportion ≤ **0.01**; the hue spread sweeps **90° down to 15°** taking the first bar that yields `desired` — 15° is the floor, not the rule, and **fewer than `desired` may come back** — and "proportion" is the summed share of a 30° hue neighbourhood, not a cluster's own share. AOSP's ranking is Monet's `ColorScheme.score()`, this arithmetic verbatim (`ACCENT1_CHROMA = 48`, `MIN_CHROMA = 5`, `proportion > 0.01`, `for (i in 90 downTo minimumHueDistance)`) with a hard cap of 4 instead of `desired`; `Score.score()` is not what ThemePicker calls.
- **Google Blue was reachable; testing chroma was not enough.** When the filter leaves nothing, `Score` returns its own `fallbackColorARGB` — `#4285f4`, a colour not in the picture (Monet's fallback is a *different* blue, `#1b6ef3`). The old guard (any cluster with chroma ≥ 5) missed the **0.01 proportion** cutoff: a red patch on a grey field filtered out at 0.1–1.0% of the frame, surviving only from 2%. The test is *identity* now — every real candidate is a key of the quantised map, the fallback is not — covering both cases in one line; a greyscale image gets its own most populous tones spread 12 apart.
- **The downsample is an area, not an edge**: `WallpaperColors.java` caps `MAX_WALLPAPER_EXTRACTION_AREA = 112 × 112` and rescales by `sqrt(cap / area)` ("aspect ratio independent"); it was a 128px longest edge. One deliberate divergence: `imageSmoothingQuality: 'high'` where AOSP scales with `filter = false` (nearest neighbour) — at a 30× reduction it samples one pixel in nine hundred and can delete the small saturated subject that then trips the cutoff above.

**An image gives seeds, and a seed is installed verbatim. There is no style axis, and taking it out is the fix for "取的色很奇怪".** AOSP's unit is a **(seed, style) pair**: `ColorProvider.kt` crosses `styleList = [TONAL_SPOT, SPRITZ, VIBRANT, EXPRESSIVE]` with the seeds `ColorScheme.getSeedColors` ranks out of the wallpaper (MONOCHROMATIC spliced in at index 1; 16-qpr2 takes two seeds — the eight chips Android shows). Transcribed correctly, and wrong here: a style puts `primary` at M3's **P40 light / P80 dark**, and three of the five do not keep the seed's hue. For a sunset orange `#e8762c` lifted out of a photograph:

```
tonalSpot   #8c4e29   a dark brown
neutral     #71594e   a grey-brown
vibrant     #9c4400   a dark rust
expressive  #595799   a purple      (the hue rotated 240°)
monochrome  #5e5e5e   grey
```

All five are tone 40 — none is the colour in the picture, and the app bar came out dark and muddy either way. AOSP gets away with it because **its app bar is `surface`**; this app's is `primary`, the largest area on screen, so M3's "correct" P40 placement is the one thing it cannot take: a role's right tone is a function of how much screen it covers, the direct cause of several divergences here. So `deriveTheme` takes one hex and no mode; `PaletteStyle`, `stylePalettes`, `styledBrandTones` and `normalizeStyle` are gone; `LS_KEYS`/`COOKIE_KEYS` no longer carry a style. What remains is what was always right: the extraction, and the ranked seeds it yields.

- **Both dialogs open on the consequence, not on a swatch.** `<input type="color">` carries none of this app's tokens, speaks RGB or HSV where the whole system speaks HCT, and shows a *colour* where the thing being chosen is a *theme*. `PalettePreview` is the shared answer: the bar with its own ink, the `primary-ink` every non-bar role will take, and what the dark scheme becomes.
- **In `ColorPicker`, every cell is a real `Hct.from()` result, not a gradient**: sRGB's gamut in HCT is an irregular solid, so a gradient offers values the browser then clips and a user can aim at one colour and land on another. Chroma is a *fraction of what is available* at that hue and tone (at tone 95 a hue may hold a third of what it holds at 60). It holds **one** piece of state, the hex, coordinates read back out each render — three synced coordinates is three effects writing state synchronously, which the React Compiler's lint rejects.
- **Two dialogs rather than one.** One dialog with two entry points held two models at once (a `picked` option *and* a hex, each clearing the other) and a confirm button ambiguous about which it was sending. They ask different questions: *what colour* (rail and grid) vs *which of these* (a short list nothing can be typed into).

HCT is behind that dynamic import for a reason and must stay there: `npm run perf:weight` plus a grep of the built chunks must keep showing the HCT chunk in **no** route's document. `warmPalette()` fetches it from `PaletteSwatches`' own mount — /settings is the only screen that pays for it, resident long before either dialog is opened.

**`primary` is a fill role; `primary-ink` is the brand as a mark.** Same hue, at whichever tone can be read on the page. Where the brand is ink rather than a container, read it: `text-primary-ink` — a selected glyph, the checkbox's box, the tab indicator, the slider's fill, the focused field's outline, a quoted block's rule. Use `primary` where the thing is a container with `on-primary` over it: the app bar, a `filled` button, the switch track, the active pagination pill. Rule of thumb: could you put a label inside it? (An earlier role of the same name served links *and* active states and did neither well; this one has a single job and cannot invert — never lighter than the brand in light, never darker in dark.)

**What follows the theme and what does not.** A theme re-skins the *system*; it is not a licence to recolour everything:

| Follows | Fixed in all eleven |
| --- | --- |
| `primary` / `primary-ink` / `secondary` / `tertiary` families | `error` / `success` / `warning` — a severity that changes colour with a theme is not a severity |
| every `surface` step, `on-surface`, `inverse-*` | the four `*-fill` + `on-fill`, for the same reason and because they already do not flip between schemes |
| `on-surface-variant`, `outline`, `outline-variant` | `accent-*` — a categorical scale; a 分级 chip that changed hue per theme would change meaning |
| `focus*`, through their `var()` indirection on `secondary` | `glass-body` / `glass-body-b` / `glass-sheen` — the /about plate's own material: the two ends of its field and its specular. Their 21-code separation is the plate's most load-bearing number, not a tint — the reference measures 12.3 code values of span at chroma 3.8 and reads as white silk |
| `link` / `link-hover` — the brand hue at P40 / P80 | `media-*`, `on-media*`, `scrim` — things sitting on a photograph |
| the /about plate's *ink*, which reads `primary` at run time — the one role that follows the palette without a token of its own, because a shader uniform is where a `var()` cannot reach | the wordmark. `.logo-keyline` is `currentColor` and the Lottie roses are hand-drawn pink; a brand mark does not recolour with a user preference |

**Links follow the palette, and the underline is what pays for it.** The old fixed blue left every link ignoring the theme (blue is a link's affordance, but the argument left the source URL under a picture off-theme too). They are the brand hue at a text tone now (6.12–6.19:1 on light `surface`, 10.81–10.94:1 dark, vs the old blue's 6.34 / 10.09 — a hue swap with no legibility change), and prose links carry a **rest-state underline** so the affordance no longer rests on hue. The underline is what pays for the swap: under the old blue a link sat 22.6° from 云宝黛西's brand and 23.0° from 瑞瑞's in OKLab hue — close enough to read as one colour — and now it *is* that hue (0.2°–2.1° from `primary-ink` across the ten), so the line is the only thing left distinguishing a link from an emphasis mark.

The selectors carry `html` (`html[data-palette='x']`, `html.dark[data-palette='x']`) and that is load-bearing: `@import` has to precede every rule, so the generated blocks land *above* `:root`, and `:root` and `[data-palette=x]` are both specificity (0,1,0). With the element name they are (0,1,1)/(0,2,1) and beat `:root` and `.dark` whatever the order.

To **add** a theme: one entry in `THEMES` in `scripts/palette.mjs` — an id, a label, a light hex, a dark hex, a note saying which rows of the guide they are — then `npm run colors:write`; the CSS, the swatch colours and the `<meta name="theme-color">` values are all products of that run. To **move the brand**: edit `BRAND_SEED`/`BRAND_SEED_DARK` in `lib/paletteRule.ts`, run it, and re-check `.logo-keyline` against the Lottie artwork. There is no lightness knob any more — a fill is a hex somebody drew, so retuning one means reading a different row of the guide. The hand-copy step (two literals in `viewport.themeColor`) is gone: that export carries no `themeColor` at all, because a static array cannot express eleven palettes (one per-user) and mutating Next's own tag does not survive a client navigation — the tag is rendered from the cookie in `app/layout.tsx`.

**Which container step a component takes is the spec's decision, not the designer's eye.** M3 names one per component; wrong is invisible in isolation and obvious as a set (the app's four biggest surfaces were each off one step in the same direction, so nothing separated from anything):

| Component            | Container                     | Elevation |
| -------------------- | ----------------------------- | --------- |
| Filled card          | `surface-container-highest`    | 0         |
| Elevated card        | `surface-container-low`        | 1         |
| Outlined card        | `surface` + `outline-variant`  | 0         |
| Dialog               | `surface-container-high`       | 3         |
| Modal bottom sheet   | `surface-container-low`        | 1         |
| Menu / popover       | `surface-container`            | 2         |
| Plain tooltip        | `inverse-surface`              | 0         |
| Navigation drawer    | `surface-container-low`        | 1 (modal) |
| Filled text field    | `surface-container-highest`    | 0         |
| Progress track, slider track | `secondary-container`  | —         |

The progress row had drifted furthest. `LinearProgressIndicatorTokens` puts `Height`, `TrackThickness` and `ActiveThickness` all at **4dp** — no size axis; the track is `secondary-container`; the indicator is `secondary` or a `*-fill`; the fill is `scaleX` on a `transform-origin: left` box, not an animated `width`, because `width` is a layout property and one instance runs live inside the image overlay while a flight is landing. Six hand-rolled tracks carried three heights (4 / 8 / 10, the last off the 4dp grid), three track tones, two drive mechanisms and **no `role="progressbar"` at all** — no progress was announced, including the 词库 sync, the one place a user waits. `ProgressBar` owns all of it. `TrackActiveSpace` (a 4dp gap between indicator and remaining track) is knowingly not implemented: it needs the remaining track's leading edge to follow the value, the layout work `scaleX` exists to avoid. **`StopSize` is not implemented either — a divergence, not an omission.** Both attempts read as a detached mark on a meter that is mostly not full: a 4dp square in the fill's colour at `right-0`, clipped into a nub by the track's `rounded-full`; then a round dot concentric with the cap in the track's on-container (`on-secondary-container` measures 13.32:1 light / 7.24:1 dark against the track, vs the fill colour's 5.00:1) hidden above 98% — and `experience % 100` is 0–99, so it can never cover the dot.

M3's rule for the dot is conditional and this app meets it: required when the track's contrast against the container behind it falls under 3:1, and `secondary-container` measures 1.23:1 light / 1.99:1 dark against `surface` and **1.00:1** against `surface-container-highest` — the empty half of the track is invisible on that step. If that ever needs fixing, give the *track* contrast rather than a mark at the end of an invisible one. `Slider` keeps its own stop indicator and should: its track is 16dp with an 8dp cap, so a 4dp dot inset on the inactive side reads as part of the track, not a fragment of a fill.

The dialog was `surface-container-lowest`, the *flattest* step: the one surface meant to read as lifted off everything was painted lighter than the page behind it and relied entirely on its shadow. Tone first, shadow second is the whole M3 depth recipe; that had it backwards.

The tooltip is the one place `inverse-surface` is right — no tension with the snackbar's note below. `inverse-surface` flips between schemes, which is wrong for a **severity**: the same message must not arrive as a dark chip in one theme and a light one in the other. A tooltip carries no severity; its whole job is to contrast with whatever surface it is over, and flipping is how it keeps doing that.

**An alpha on a token is a bug.** `bg-primary/10`, `border-error/40`, `text-on-media/60` — each eyeballed once per scheme, each drifting, because nothing makes the next call site pick the same number; the tint that looked right on light is nearly invisible over dark. Use the tone scale (`surface-container-*`) or the container/on-container pair. If you need a weight no token has, add the token.

**There is now exactly one legitimate alpha at a call site**, and it is not a colour: the `--md-sys-state-*` opacities, M3's own `StateTokens` numbers, reaching call sites through `state-layer` rather than by hand. Two former entries were listed "legitimate" and were wrong:

- `bg-scrim/50`, "one value, three call sites": the value is **0.32** (`ScrimTokens.ContainerOpacity`), so all three were 56% too heavy — and a fourth, at 62%, hid inside an arbitrary `shadow-[…]` in `ImageCropper`. The dim is `bg-scrim-veil` now and the crop mask is `--md-sys-color-crop-mask`: two different objects, two tokens, no number at a call site. A crop mask being heavier than a dialog dim is a real distinction — it has to make "outside the crop" inactive while staying legible enough to aim with.
- `bg-on-surface-variant/40` on the sheet's drag handle was not an M3 number at all: `SheetBottomTokens.DockedDragHandleColor` is `OnSurfaceVariant`, full strength, and `SheetDefaults` passes it unmodified.

The fix has the same shape every time: need a weight no token has → **add the token**; and if the thing you are weighting turns out to be a different object from the one the existing token serves, that is why the number kept drifting.

**An element `opacity-NN` used as an ink weight is the same bug.** The rule above only named alphas *on tokens*, so the identical drift grew back: a quoted reply preview at 70% in two components that each picked the number alone, an English tag name at 50%, a footer wordmark at 60%, a banner icon at 80% — none could agree, because there was nothing to agree with. Reach for a *type role* first (a supporting line is `body-s` under a `body-m`, not a faded copy of it), then `on-surface-variant`, then add a token. Element opacity is legitimate for motion (a fade, a hover reveal, a collapsing `grid-rows-[0fr]`), for the gallery's paging dim (one value, two matched call sites), and for `disabled-content`.

**Disabled content is `disabled-content` (38%), and nothing else.** M3 specifies 38%; the app used five weights — 40 on `IconButton` and `Pagination`'s arrows, 50 on `Button`, `Chip`, `Checkbox`, `ToggleSwitch`, `Select`'s trigger and `DropZone`, 60 on `Input`, 70 on the captcha handle, a lone 38 inside `Select`'s menu — with two files disagreeing with *themselves* (`Pagination`'s arrows vs its numbers; `Select`'s trigger vs the menu it opens). It is a `@utility` in globals.css rather than a colour so a control's border, glyph, label and container fade together in one declaration, and it composes with the variant: `disabled:disabled-content`.

**Text and marks on photography** have their own roles, mirroring `on-surface` / `on-surface-variant` / `outline-variant` — a picture is not a surface, and none of the surface roles apply over one:

| On media                            | Role                 |
| ----------------------------------- | -------------------- |
| Primary ink — a title, a tag chip   | `text-on-media`      |
| Secondary ink — caption, meta, +N   | `text-on-media-variant` |
| A rule or track — crop guides, bars | `bg-media-outline`   |
| The plate ink sits on               | `bg-media-plate`     |

`bg-media-plate` is the one answer for a format badge, a score pill, a caption bar or a hover veil. It replaced `bg-scrim/40`, `/50`, `/55` and `/60` — four weights for one object, the two closest on screen the furthest apart.

**Focus** is one ring for the whole app: `focus-visible:ring-2 focus-ring`, or `focus-ring-on-primary` for chrome on the app bar. Over a **photograph** it is `focus-visible:inset-ring-2 focus-ring-on-media`, and the inward direction is not optional: that ring resolves to `on-media` (white), and an outset white ring puts its outer edge on the picture where a bright subject takes it to 1:1; inward it sits on the control's own `bg-media-plate`, where the worst case — a pure-white subject under a 55% black plate — still measures 4.8:1. `IconButton variant="media"` supplies that plate and switches the ring width itself; anything else reaching for this needs one too. Never tint it per variant — a focus ring answers "where is the keyboard", so it must look identical on every control — and it is solid, not tinted: `primary/40` composites to about 1.4:1 against a light surface, under the 3:1 WCAG 2.4.11 asks of a focus indicator.

**The ring is `secondary`** — M3's own name: `FocusIndicatorColor` is `Secondary` in `MenuTokens`, `SearchBarTokens`, the card tokens and the chip tokens alike. It was `primary`: on a filled button that was `primary` on `primary`, **1:1** — the app's most prominent control had no visible focus state — and against the light surfaces 2.94:1 / 2.39:1, both under the 3:1 bar; `secondary` measures 6.15:1 / 5.00:1 light and 10.89:1 / 7.25:1 dark. The two exceptions exist because neither role has any guaranteed contrast on the brand bar or over a picture.

**An outset ring is drawn on the surface *behind* the control, not on the control** — do not "fix" `Button variant="filled"` to use `focus-ring-on-primary`. `ring-2` is a `box-shadow` painted just outside the border box: on a filled button those pixels are the page, where `secondary` measures 6.15:1. The 2.09:1 figure in globals.css's table is for a ring drawn *on* a primary-coloured surface — the app bar, and nowhere else — which is what `focus-ring-on-primary` is for; `IconButton variant="on-primary"` already carries it.

The third form is `focus-visible:inset-ring-2 focus-visible:focus-ring-inset` — the same ring painted inward, not a second style. A ring is a `box-shadow`, so an ancestor that paint-contains throws it away entirely, and the app has two kinds that do: a gallery card (`.image-card` is `contain: layout paint style`) and any media box clipping its corners with `overflow-hidden rounded-*`. A full-bleed control inside one of those — the spoiler cover, a zoom target — rendered a focus indicator that was then discarded. Reach for it only when the enclosure clips; everywhere else the ring goes outside, where it does not eat 2px of the control.

The **outlined text field** has no ring — not an exception but a fourth place the same ring is painted: its focused state is its own outline at `primary` and 2px, the ring's colour at the ring's weight drawn as the control's boundary instead of a second boundary 2px outside the first. A control whose entire visual identity *is* a 1px outline cannot wear a ring around it without reading as two nested boxes, and M3 specifies the thickened outline as this control's indicator for that reason. The *filled* field has no outline to nest inside, so it takes the ordinary ring. Everything else is unchanged, including the colour on an error field: a focus ring answers "where is the keyboard", never "what is wrong".

**`outline` is a boundary role, not an ink role.** It is built for a rule or a text-field border and is specified to 3:1 — the bar for a *non-text* element. Against this app's light surface it lands at 4.3:1, under the 4.5:1 WCAG AA asks of normal-size text; the dark scheme reaches 5.8:1 and passes. That asymmetry is why `text-outline` spread to 57 pieces of supporting text unnoticed: it is only wrong in one scheme, the one people ship from less often. Supporting text is `on-surface-variant` (8.5–9:1 light, 10:1 dark). `text-outline` on a *glyph* is fine — 4.3:1 clears the 3:1 non-text bar.

**A state is a container, not a rule down the side.** The reflex for an unread notification, a selected row, a quoted reply is a 3–4px coloured bar at the leading edge; M3 has no such element — a list item says "unread"/"selected" by wearing a container pair, and a block of text says "quoted" by `<blockquote>`'s own treatment. So an unread system message is `secondary-container` / `on-secondary-container` across the whole row, and the bar is gone. The ink half is not optional: the row's title and body must *inherit* the on-container colour, so write `text-on-surface`/`text-on-surface-variant` into the read branch only — a hard `text-on-surface` on the heading survives the container change and leaves a coloured row whose text still belongs to the old one.

The reply quote keeps its rule, because there the bar is not a state — it is what distinguishes quoted text from the reply around it, and what `<blockquote>` has looked like for thirty years. It is 4px `primary` (the same colour as the `<cite>` under it, so quote and attribution read as one object) over a `surface-container-high` fill — the same tone step as everything else here meaning "a distinct block inside this one".

**A filter control that is not selected is a tone step, not a keyline.** The unselected `Chip`, `Select`'s trigger and the filled text field all sit at `surface-container-high` with no border and no shadow, so a filter bar reads as one material. Same decision as the outlined `Button`'s removal, and the shape section's concentric-corner note is its geometric half: this app separates things by tone and by corner, not by edges.

Deliberate divergences from the spec, all commented where they live. Do not "fix" them:

- `primary`, `*-fill`, `media-stage`, `on-media*` and `media-plate` do not invert between schemes: a brand colour, a graphic fill and anything sitting on a photograph must read as one constant material; only text roles flip. `primary` is the brand pink at **tone 61 light / 54 dark**, the one role off AOSP's tone map — and the *direction* is inverted too, which looks like a mistake: M3 puts primary at P40 light / P80 dark so the brand separates from a near-white/near-black surface, making the spec's light tone the *darker* of the two; this app holds the pink instead of a tone of it, seven tones apart, one colour with a little separation from each ground. Those two hexes are *given*, not derived — the brand has no artwork to read a coat Fill from, so it is the one theme whose pair is stated rather than transcribed (see the palette-axis section; five of the ten palettes are light enough to take dark ink instead). **What it costs, so nobody rediscovers it as a bug:** white ink on it is 3.08:1 light / 3.87:1 dark, under the 4.5:1 AA floor for 14px text — the label of every `filled` button, the active pagination number, the featured badge. Not fixable in place: both levers have a visible price (a single tone at 48 clears it at 4.81:1 but reads deeper and duller; `on-primary` at P10 clears it at 5.55/4.41 but puts dark glyphs and a dark wordmark on the app bar) — neither is taken *for this seed*. The bar itself is not the failing case: glyphs and a wordmark are non-text and need 3:1. As *ink on a surface* the tone is 2.94:1 light / 4.79:1 dark — hence the brand-as-a-mark role: `text-primary-ink` for a glyph or emphasis mark, body text `on-surface-variant`, navigable text `link`.
- **Body** line-heights run looser than the spec and tracking at half the spec value, because Han glyphs fill the em box; the **label** roles do not — all six are at the spec exactly (this line used to claim otherwise). `body-l` is 1.75 (the prose role; `Textarea`'s block padding derives from its 28px line box); `body-m`/`body-s` are 1.5, halfway back from the 1.65/1.6 they carried — they are metadata and supporting lines, not paragraphs, and the extra 3px landed on every row in the app.
- `accent-*` is a _categorical_ scale (tag categories, staff roles), not a semantic one. `lib/tagCategories.ts` is the only thing allowed to pick a hue.
- **The top app bar is `primary`, not `surface`.** M3's app bar takes a surface role and elevates on scroll; this one is the brand bar — hence `IconButton`'s `on-primary` variant and `focus-ring-on-primary`. It is the one piece of chrome that does not sit on a surface.
- **The elevation shadows are half the spec's alpha.** M3's 30% key shadow is tuned against a pure white page; these warm off-white surfaces read it as dirt. Halved — but held *constant* across the five levels, which is the part that matters (see the Elevation section).
- **A snackbar is a `*-fill` tone, not `inverse-surface`.** The spec's role flips between schemes, so the same message would arrive as a dark chip or a light one depending on the theme; the four severities hold one saturated tone each.
- **`AuthModal` is `max-w-4xl`.** M3 caps a basic dialog at 560dp; this is a two-pane sign-in with an illustration beside the form, closer to a full-screen dialog than to a basic one.
- **The navigation drawer is 288dp, not 360.** `NavigationDrawerTokens.ContainerWidth` is 360, right for a drawer you dismiss; this one is *docked* from `md` up, so its width comes out of the content area — and on an image gallery those 72px are a column of thumbnails.
- **The docked drawer keeps the *modal* container colour.** `NavigationDrawerTokens.StandardContainerColor` is `Surface`, `ModalContainerColor` is `SurfaceContainerLow`; this drawer takes the latter in both states — the content beside it is a `surface` card inset from `sm` up on a `surface-container-low` page, and giving the docked drawer `surface` would erase the boundary between them. On a phone it is modal anyway, which is where the token's own value applies.
- **The unselected filter chip is a tone step, not a keyline.** `FilterChipTokens.FlatUnselectedOutlineColor` is `outline-variant` over no container at all; this app fills it with `surface-container-high` and drops the border — the same decision as removing the outlined button. It separates by tone.
- **Breakpoints are Tailwind's 640/768/1024/1280, not M3's window size classes** (600/840/1200/1600). Agreeing with the `sm:`/`md:`/`lg:` utilities every file already uses matters more here than the spec's numbers, and `BREAKPOINTS` in `lib/constants.ts` is what anything branching in JS reads so the two cannot drift. When reading M3's adaptive-layout guidance: this app's `md` is not M3's medium.

## Shape

The step is decided by the role, never by eye:

| Role                                            | Class          | Value |
| ----------------------------------------------- | -------------- | ----- |
| Button, FAB, avatar, circular icon button       | `rounded-full` | —     |
| Unread count pill, list row in a nav            | `rounded-full` | —     |
| Search bar (`Input size="lg"`)                  | `rounded-full` | —     |
| Card, section surface                           | `rounded-md`   | 12dp  |
| Square icon button (the back affordance)        | `rounded-md`   | 12dp  |
| Chip, small tag                                 | `rounded-sm`   | 8dp   |
| Text field, colour swatch, one-time-code box    | `rounded-xs`   | 4dp   |
| Menu, popover, autocomplete                     | `rounded-xs`   | 4dp   |
| Badge, inline code, seam in a grouped list      | `rounded-xs`   | 4dp   |
| Snackbar / toast                                | `rounded-xs`   | 4dp   |
| Plain tooltip                                   | `rounded-xs`   | 4dp   |
| Navigation drawer, trailing corners only        | `rounded-r-lg` | 16dp  |
| Dialog, Sheet, large media                      | `rounded-2xl`  | 28dp  |
| Gallery thumbnail / grid tile, chat row         | `rounded-lg`   | 16dp  |
| Profile hero banner, `sm` and up                | `rounded-3xl`  | 32dp  |

The scale is M3's: 0 / 4 / 8 / 12 / 16 / 20 / 28 / 32 / 48, nothing between steps. `rounded-3xl` was 36dp — not one of them — the token moved rather than the two call sites, since 36 was only ever the distance between 28 and 48 split in half.

A **snackbar is 4dp** (`corner-extra-small`), not the 8dp menu step it wore: a transient message, not a surface you act inside. The **navigation drawer rounds only its trailing corners**, and only while modal — a docked drawer is flush with the edge it docks to, so the rounding is `rounded-r-lg md:rounded-none`.

**A box inside another box does not take its own row of this table.** Nested corners are concentric when `inner = outer - gap`, and the eye reads a violation immediately: an inner corner rounder than `outer - gap` bulges toward the frame, a squarer one leaves a crescent of dead space. Look up the enclosure's radius, subtract the gap, and use that — the table gives the *outermost* box's step, not every box's. The rule only bites while the gap is small (treat roughly 8px as the line): two corners 16px apart are neighbours, not a ring inside a ring, and forcing the arithmetic produces a 0dp corner on something that should not have one — what `DetailBack` documents about itself.

Shortcut worth knowing: **a centred pill inside a pill is concentric for free, at every size** — `outer - gap` is always half the inner capsule's height, so the arithmetic can never be wrong. That is why /search's field is a 56dp pill rather than a 12dp box: the submit button and 以图搜图 sit in its trailing slot, and at 12dp with a 4px gap they would each need a remembered 8dp corner, whereas two ordinary pills in a pill are correct by construction. A square-cornered `Button` variant was added for the 12dp version and removed with it — `inner = outer` is the misreading of this rule, not the rule.

A **chip is 8dp, not a pill.** This table used to say `rounded-full`, contradicting `Chip.tsx` (the primitive always rendered the spec's 8dp); the cost was four filter chips in `/search` and the admin console hand-rolled as `rounded-full px-3 py-2` pills by someone reading this table rather than the component.

**A menu and a text field are both 4dp**, once settled wrong at 8dp by a spec *summary* saying the `small` step covers "text fields, menus". The summary is wrong, or at least lossy: `MenuTokens.ContainerShape` and `OutlinedTextFieldTokens.ContainerShape` are both `CornerExtraSmall`, `FilledTextFieldTokens.ContainerShape` is `CornerExtraSmallTop`; a chip is `CornerSmall` — 8dp — from `AssistChipTokens` and `FilterChipTokens` alike, which is what this table said all along.

So the rule is not about menus: **read the token file, not the summary table.** The generated `androidx.compose.material3.tokens` sources are the machine-readable form of the spec and are fetchable —

    base=https://android.googlesource.com/platform/frameworks/support/+/refs/heads/    androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3
    curl -s "$base/tokens/<Component>Tokens.kt?format=TEXT" | base64 -d

— every number in this file that says "M3 specifies" should be checkable that way; where a summary and a token file disagree, the token file is what generates the components.

Write the step you mean. A bare `rounded` resolves to `--radius` (4dp, same as `rounded-xs`) but says nothing about *why* — which is how 92 call sites ended up at 4dp with no role between them (icon buttons and badges that wanted `full`, skeleton bars that wanted whatever the thing they stand in for wants). `rounded-xs` is the step; use it where 4dp is the answer.

A **badge is a rounded rectangle and a count is a pill** — one row of this table split in two. M3's badge is round because M3's badge is a *number*: a dot, or a count no wider than it is tall (`CountBadge`). A badge carrying a word (Lv.13, 已核验, an earned badge's name) is a short block of text, and a full pill around text reads as a button that has lost its handler — the confusion `Chip` sits on the other side of. 4dp rather than the chip's 8dp because the box is only ~20px tall at `sm`, where an 8dp corner is 40% of the height and is a capsule again — pick the radius against the box, don't inherit it from a bigger relative.

A **chat message is a list row, not a lozenge** — 16dp, with the seams inside one turn cut to the grouped-list 4dp. It was 28dp on the argument that roundness *is* the semantics of a speech bubble; the argument lost to the thread it produced: at 28dp a two-word message is a capsule and a long one a stadium, so a column reads as a bag of lozenges, not something you can scan. What a thread keeps from the bubble is per-message width — each row only as wide as its own text, the ragged right edge carrying the rhythm of speech. The gap between rows of one turn is 2dp (`ListTokens.SegmentedGap`), which lets the 4dp seams close against each other. See `ChatBubble`.

A **placeholder inherits the radius of the thing it replaces**, so `Skeleton` stands its own default down when the call site names one — `cn` is a plain join and does not resolve Tailwind conflicts, so passing a radius used to emit two and let output order decide.

`rounded-lg` is pinned to `HERO_TARGET_RADIUS_PX` in `lib/hero/constants.ts` — the shared-element flyer morphs its corner to that value on landing, so the two must stay equal.

## Elevation

`shadow-e1` … `shadow-e5` only. Never `shadow-sm/md/lg/xl` — tuned for a white page, invisible on the dark scheme's near-black surfaces. Depth comes from the `surface-container-*` tone scale first; a shadow is for things that genuinely float (dialogs, popovers, the FAB). The level is decided by the object, not by how much it should stand out:

| Object                                   | Level |
| ---------------------------------------- | ----- |
| Elevated card, modal bottom sheet        | `e1`  |
| **Menu, popover, autocomplete**, nav bar | `e2`  |
| Dialog, FAB, search, snackbar            | `e3`  |

Four floating surfaces sat at `e3` (share menu, emoji picker, two autocompletes), putting a tray of emoji above `Modal`; `Popover` owns this now — typing an elevation onto a floating panel is hand-rolling one. **Most things are level 0, including every button**: M3 puts the filled button at level 0 at rest and level 1 on hover, and nothing else — pressed returns to 0, the tonal/text/outlined variants have no elevation at any point, and an *icon* button is level 0 in all four variants. Both were a step high here (`e1` at rest rising to `e2`), which made a row of buttons read as floating chips and hid the hover lift — a step between two shadows rather than the appearance of one. A pagination number, a slider handle and a table row are level 0 too. The list that legitimately floats is the three rows above; anything else gets a `surface-container-*` step, not a shadow.

**The ladder holds its alpha constant and grows only its geometry** — that is how M3 specifies it, and backwards is invisible one level at a time and obvious across the set: the light shadows once ramped 0.05 → 0.10 *as well as* growing their blur, so five levels spanned a factor of two in alpha and `e1` beside `e2` could not be told apart. Adding a level: copy the alpha, change the geometry.

**The dark scheme is the one carve-out, and it is deliberate.** Its ladder does ramp — 0.30 → 0.45 on the key layer, 0.20 → 0.32 on the ambient — and starts at the spec's full 0.30 rather than the halved light value, because on a near-black ground a shadow is not reporting height, it is the only thing separating one surface from another, and the tonal steps already carry the height. Both are stated where the values live, in `globals.css`; do not "fix" either to match the paragraph above.

## Stacking order

App-level layers are the `--z-*` tokens in globals.css, used through their utilities (`z-dialog`, `z-popover`, `z-toast`, …); the order is stated once, there, with the reason for each step. Fourteen raw values were in use before, and two collided — `Toast` and `LoadingOverlay` were both at 9999, cover-order decided by DOM order — and the image detail's tag dialog carried a hand-typed 9998 meaning "above everything" that in fact put it one step *below* the lightbox.

Layering *inside* one component — a preview over its own final image, a switch handle over its own ripple — stays a small integer: those neighbours are the component's own children, and giving them tokens would imply they take part in the global order, the one thing they must not do.

## Typography

The fifteen M3 roles: `text-display-*`, `text-headline-*`, `text-title-*`, `text-body-*`, `text-label-*`. Never `text-sm`/`text-lg`/`text-[13px]`.

**Every one of the fifteen roles declares its own `font-weight` token** (`TypeScaleTokens`; the seven that used to declare none — `display-*`, `headline-*`, `title-l` — were uniformly `WeightRegular`), and `@layer base` gives `h1`–`h6` only a size and a line height. Never add `font-bold`/`font-semibold` on top of a role — it overrides the token — and a role that does not declare its weight inherits one, which is the bug: `text-headline-s` once rendered 700 on `AuthModal`'s `<h1>`, 600 on `Modal`'s `<h2>` (the same dialog-title role at two weights), 400 on a `<span>`, with the 500 `-emphasized` lighter than either. Utilities sit in a later layer than `@layer base`, so declaring it is what makes a role render the same wherever it is put. **M3 headings are Regular** — the heavier line is the `-emphasized` role, a decision at the call site, not a property of the tag.

A bare `font-medium` / `font-semibold` on an element with **no** type role takes its size from whatever the parent happens to be — reach for the role's `-emphasized` twin instead, but check the weight you are actually getting, because the twins are **not** all one value: `label-*` and `title-m`/`title-s` step 500 → **700**, while `display-*`, `headline-*`, `title-l` and `body-*` step 400 → **500**. Tailwind's `font-medium` *is* 500, so on `text-label-l`, whose own token is already 500, it changes nothing at all — which is how three pieces of shared chrome (the home tab bar, `TabBar`, `Pagination`) marked their active item with no weight contrast, only colour.

Never emit two type roles on one element (`text-label-l` plus `text-label-l-emphasized`): `cn` is a plain join, the winner is decided by stylesheet order, not by which you wrote last — put the role inside each branch of the conditional so exactly one is ever applied.

## Rich-text rhythm

Two renderers put user prose on screen — `MarkdownRenderer` and `BBCodeRenderer` — and the rule is that **they emit the same document**, so one set of rules spaces both: `.bbcode-content` and `.rich-text-content` are styled together in globals.css, and neither renderer styles its own output.

The forum's spacing had two causes, neither where it looked: nothing gave a paragraph a margin (Tailwind's preflight zeroes `p`; only `img`/`blockquote`/`pre` were given one back, so consecutive paragraphs touched while the space around a picture came from something else), and BBCode did not *have* paragraphs — every `\n` became a `<br>`, so a "paragraph break" was one line-height that could not agree with an image's margin beside it. `bbcodeToSafeHtml` now splits on blank lines into real `<p>`s, keeps single newlines as `<br>`, and eats the line breaks that end up adjacent to a block element.

The spacing is in `em`, so it scales with the container and a reply's rhythm is automatically tighter than an article's:

| Element      | `margin-block`             |
| ------------ | -------------------------- |
| `p`          | `0.75em`                   |
| `h1`–`h6`    | `1.25em 0.5em`             |
| `ul` / `ol`  | `0.75em` (+1.5em start pad)|
| `li`         | `0.25em`                   |
| img, video, blockquote, pre, table | `1em`    |

Which means **the container has to name a type role**, or the `em` is whatever it inherited: a forum post's body is `body-l` (it is an article) and a reply's is `body-m`. The `> :first-child` / `> :last-child` margin resets stay — they keep the last paragraph from pushing the action row down by a stray line.

## Copy

The UI is Chinese, and the conventions below are the whole of it. Every one had drifted in both directions at once, and the wrong half is invisible to anyone reading a single file.

| | |
| --- | --- |
| Ellipsis | `…`, never `...` (44 sites used ASCII against 2 correct ones) |
| Colon after a Chinese label | `：`, never `: ` |
| Comma inside a Chinese sentence | `，`; half-width `,` only in a value the user types |
| Parentheses in Chinese prose | `（）`; keep `( )` only where the parenthetical is a Latin identifier — `(banAnthro)`, `(GIF/视频)` |
| A Latin run beside CJK | one space: `图片 ID`, `API Key` (all ten no-space sites were in `components/admin/`) |
| Toasts | no `！` — a snackbar is a status report (7 of 291 shouted) |
| Confirm body | `确定要…吗？`, with the formal 此/该 demonstrative; never 这个, never a bracketed 【…】, never `！` |
| Confirm title / button | `确认X` / `确认` (`useConfirm` and `usePrompt` both default to 确认) |
| One verb per operation | 删除 destroys a record, 移除 detaches one, 清空 empties a list (`/history` used two for one button) |
| Success | `已<verb>` (47 sites) rather than `<verb>成功` (28) |
| Failure | `{X}加载失败`, noun first; one string for one condition (`网络错误` had six wordings across 24 sites) |

The confirm register is the instructive one, because the copy split was the *architecture* split seen from the other side: every tab that hand-rolled its own `Modal` dropped the sentence-final 吗, and every tab that used `useConfirm` kept it. Fixing one was fixing the other.

## Motion

**There are two motion systems and M3 draws the line between them, not taste.** *Transitions* — something entering the screen, leaving it, or crossing it — are easing plus duration; that is the tables below. *Component* motion — a handle travelling, a mark landing, a container growing out of its anchor — has been **spring physics** since M3 Expressive; that is the springs section. Reaching for `decelerate` on a switch handle is the mistake the split exists to prevent: a bezier is a shape someone drew, a spring is a mass being pulled to a target, and the eye can tell which it is looking at. That is the whole of what "质感" means here.

### Springs — component motion

Nine responses, from M3's own generated token sets (`StandardMotionTokens` / `ExpressiveMotionTokens`). Use them through the `spring-*` utilities in CSS or `spring('name')` in GSAP — both carry the shape **and** its duration:

|            | standard        | expressive       | settle |
| ---------- | --------------- | ---------------- | ------ |
| fast spatial   | ζ0.9 k1400  | ζ0.6 k800        | 137 / 221ms |
| default spatial | ζ0.9 k700  | ζ0.8 k380        | 194 / 326ms |
| slow spatial   | ζ0.9 k300   | ζ0.8 k200        | 296 / 449ms |
| fast effects   | ζ1.0 k3800  | identical        | 108ms  |
| default effects | ζ1.0 k1600 | identical        | 166ms  |
| slow effects   | ζ1.0 k800   | identical        | 235ms  |

Pick by **what is changing**, then by how far it travels:

- **spatial** — it moves or resizes. Damping is below 1, so it may overshoot, and that overshoot is what reads as mass.
- **effects** — damping is exactly 1, critically damped, so it *cannot* overshoot. Usually that is what a fade or a recolour wants: an overshooting colour is a flash, and an overshooting opacity is **clipped** — a `linear()` value above 1 is capped, so the fade reaches full opacity early and then sits there. Not only fades: reach for it whenever overshoot would be *wrong*, position included — M3 closes its own navigation drawer on `FastEffects` because a panel that overshoots on the way out bounces back into view.

`expressive-fast-spatial` (ζ0.6) is the only visibly bouncy curve in the system — 8.4% overshoot, peaking at 63% of the run. It is for a small mark arriving in place: an unread count, a favourite filling in, a radio dot landing; anything large wearing it reads as a wobble. And never put an `opacity` on it: its table is above 1 from 45% to 97% of the run, which is why the radio's dot and the icon-swap keyframe split their scale and their opacity across the two families.

**A component reaches for a *role*, not for a ζ and a k** — the shape of the API in AOSP (`MotionSchemeKeyTokens.DefaultSpatial`, resolved by whichever `MotionScheme` is in force). Nine utilities exposing ζ and k directly is how the drawer once picked standard's slow tier, the tab indicator expressive's default tier, and the switch a bezier. **This app's scheme is `standard`**, which is also `MaterialTheme`'s own default; the expressive trio is a documented exception for a small mark landing in place.

The assignments, each taken from the component's own source rather than guessed:

| Object | Spring | From |
| --- | --- | --- |
| Navigation drawer, opening (and drag release) | `default-spatial` | `NavigationDrawer.kt` |
| Navigation drawer, closing | `fast-effects` | `NavigationDrawer.kt` |
| Menu, popover, autocomplete | `fast-spatial` + `fast-effects` | `Menu.kt` |
| Tooltip | `fast-effects` | `Tooltip.kt` |
| Tab indicator | `default-spatial` | `TabRow.kt` |
| Switch handle | `fast-spatial` | `Switch.kt` |
| Bottom sheet | `default-effects` | `ModalBottomSheet.kt` |
| Slider | none *on position* — a slider reports where the input is, and a transition would put the mark behind the finger. Its handle's *width* is a state and does spring (`fast-spatial`) | `Slider.kt` |
| Button pressed corner | none — see the control-height section for why the morph came out | — |
| Shared-element flight, opening | `fastOutSlowIn` over **250ms** (M3 `medium1`) — *not* a ladder tier | a from-rest leg flies a curve, so its length is a step on M3's duration scale rather than a spring settle time; the ζ0.9 spatial spring is the *interruption* model and its `rate` is normalised, so it fits any clock |
| Shared-element flight, closing | same curve, same 250ms | Flutter's Hero rides one route animation, so a push and a pop are one duration read both ways; the direction difference lives in the thresholds |
| Shared-element flight, swipe-release | `slow-spatial`, sliding to `fast-spatial` | `NavigationDrawer.kt`'s drag release — a gesture, so it keeps the spatial ζ0.9 |

A collapsible panel a press opens or closes is the drawer's case: the two drawer springs, per direction, on every clock in the gesture.

Nine springs, **four shapes** — arithmetic, not a shortcut: normalise the timeline by the settle time and the curve depends only on the damping ratio, stiffness deciding duration alone (verified to 1e-4). So globals.css ships four `linear()` tables and nine durations, and the `spring-*` utilities pair them. **The two must never be split at a call site**: a ζ0.6 shape on a 449ms clock is not a slower bounce, it is a different object — the pairing lives in the utility and there is no `duration-spring-*` utility to reach for on its own.

Both renderers derive from one closed form in `lib/spring.ts`: CSS gets 32-point `linear()` samples, GSAP the function itself registered as an ease, so the scripted side has no interpolation error. `--ease-spring` and `eases.spring` are gone — they were `cubic-bezier(0.18, 1.36, 0.5, 1)` and `back.out(1.55)`, two independent approximations of the same physics.

### Curves — transitions

M3 ships **two** easing sets and they are not interchangeable: `emphasized` is for a large container transform or anything crossing the screen; `standard` is for a small utilitarian change. Both have a decelerate and an accelerate variant:

| Token                          | Set        | Use                      |
| ------------------------------ | ---------- | ------------------------ |
| `--ease-standard`              | standard   | begins and ends on screen |
| `--ease-standard-decelerate`   | standard   | a small thing entering    |
| `--ease-standard-accelerate`   | standard   | a small thing leaving     |
| `--ease-emphasized`            | emphasized | a large container transform |
| `--ease-emphasized-decelerate` | emphasized | a page entering           |
| `--ease-emphasized-accelerate` | emphasized | a page leaving            |
| `--ease-symmetric`             | —          | an infinite alternating loop (reach for `--ease-loop`, its role name) |

`--ease-decelerate` / `--ease-accelerate` are **aliases of the emphasized pair**, which is what every existing call site means by them — they were the only decelerate and accelerate the app had, so every small utility transition was reaching for a curve shaped for a full-window slide. Prefer the qualified name in new code.

In GSAP: `ease: 'standard' | 'standard-decelerate' | 'standard-accelerate' | 'decelerate' | 'accelerate' | 'emphasized' | 'symmetric' | 'loop'`.

**Every M3 curve is one-sided, and there is a third case neither verb covers.** The tell is not the curve's name, it is where it spends the travel — percentage of the distance covered in each tenth of the duration:

| Curve                   | per tenth of the duration        | half-travel by |
| ----------------------- | -------------------------------- | -------------- |
| `emphasized-decelerate` | 62 16 8 5 3 2 1 1 0 0            | 7%             |
| `standard`              | 16 34 19 11 8 5 3 2 1 0          | 20%            |
| `emphasized-accelerate` | 1 2 3 4 6 8 11 14 20 32          | 82%            |
| `symmetric`             | 2 7 11 14 16 16 14 11 7 2        | 50%            |

The one-sidedness is deliberate and right for the two verbs M3 models, *arrive* and *leave*: the front-loaded half of an arrival happens while the object is still mostly off-screen.

A thing **travelling in place**, with both ends of its journey on screen, is neither: it starts and stops at rest, and on `standard` its fastest tenth carries **97x** what its last tenth does — read, correctly, as a jump followed by a stall. **The answer is a spring, not a third row** (see the panel note below). What survives here is only the *loop*: `--ease-symmetric` is 7.6:1 and identical at both ends by construction, and `--ease-loop` is its role name, because a loop has no arrival and a one-sided curve makes its velocity discontinuous once per cycle. **Reach for the role name** — every non-loop use of `ease-symmetric` was a travelling-in-place case that wanted the physics; the seven determinate progress bars that had it are `ProgressBar` on `spring-slow-effects` now.

**Vuetify is the reference for the arrangement**, and it is worth copying whole: its navigation drawer uses *one* curve and *one* duration for both directions, and its scrim shares both — `$navigation-drawer-transition-duration: 0.2s`, `$navigation-drawer-transition-timing-function: settings.$standard-easing`, resolving to Material **2**'s `cubic-bezier(0.4, 0, 0.2, 1)`. One curve serves both directions because a symmetric one is the same shape read backwards, and the scrim shares the clock because it is not a component fading in place — it is the other half of the panel moving. M2's curve still tails off at 43:1, so what is borrowed is the arrangement and the shape family, not the literal value; M2 easings remain a bug wherever the tokens reach.

**If a container animates its size, check that its contents travel with it.** A box shrinking under `overflow-hidden` whose child holds a fixed width does not move that child — it guillotines it: one edge sweeping across stationary content while the neighbouring content slides at the curve's rate, two rates in one gesture, one of them zero. Prefer translating the container and closing the layout behind it with a negative margin: the contents come along because they are inside the thing that moves, the box never resizes so its subtree never re-lays-out, and the visible half of the motion is a composited `translate`. The measurement that settles it is one line in the console — sample the *inner* element's `getBoundingClientRect().left` per frame, not the container's; if it reads `0 -> 0`, no curve will help. And sample per **decile of the duration**, not "time at N% of travel": frame quantisation moves the percentage marks by a whole frame, enough to invent a velocity spike that no frame contains.

Still name the curve at every call site — a bare `transition-opacity` cannot know which kind of movement a transition is. `--default-transition-timing-function` is re-pointed at `--ease-standard` (200ms) in `globals.css`, so a forgotten one degrades to a system curve rather than to Material **2**'s, but that is a safety net, not the convention.

A raw `cubic-bezier()` is a bug wherever the tokens can reach. Two exceptions, both commented:

- The hero's `REVEAL_EASING`/`HIDE_EASING` and `Popover`'s `EASE_*` spell out their curves because they are handed to a Web Animations `easing:` string, where a failed `var()` would silently fall back to `ease` — same for the top loader's `easing` prop in `app/layout.tsx`. The values _are_ the token values; keep them in sync. `Popover` additionally builds its spring easings through `springToLinear`, so those cannot drift by construction.
- The theme wipe is genuinely off-scale, for the same reason `.m3-progress-arc` *was*: it animates a **radius**, and what the eye reads is the area swept, which goes as the square. Every M3 curve is one-sided and spends its travel up front, so squaring it finishes the wipe before it registers as one — measured as the fraction of screen flipped 150ms into 550: symmetric ease-in-out 3%, `emphasized` 65%, `decelerate` 87%. A radius wants a curve that is slow at both ends: `--ease-loop` is that curve and `.m3-progress-arc` uses it now; the wipe still spells it out, for the `var()` reason above.

`linear` is correct only for a spinner's rotation and for a keyframe track that has already been sampled along a curve (the hero flight, the sink).

`emphasized` is two cubic segments, so it has no `cubic-bezier()` form — the CSS token is a sampled `linear()` and GSAP takes the spec path. It hangs back, then runs through the middle at 2.5x `standard`'s peak speed, which is why a value tuned against `standard` cannot be carried over: `AXIS_LAG` in `lib/motion.ts` had to drop from 0.07 to 0.032 to keep the same visual shear.

Durations: `DURATION` in `lib/motion.ts`, mirrored by Tailwind's `duration-*`.

| Situation                                     | Duration | Curve        |
| --------------------------------------------- | -------- | ------------ |
| Enters the screen                             | 400ms    | `decelerate` |
| Leaves the screen                             | 200ms    | `accelerate` |
| Begins and ends on screen (hover, colour)     | 200ms    | `standard`   |
| Large container transform                     | 500ms    | `emphasized` |
| Press down                                    | 100ms    | `standard`   |
| State layer settling in or out                | 150ms    | `standard`   |

Those six are the whole scale, and every duration in it is a step on M3's own (50/100/150/200/250/300/350/400/450/500/…). A duration outside it is a bug — `duration-150` is the state layer's and nothing else's, and it belongs to the `state-layer` utility rather than to a call site.

**That scale is what the 默认 speed declares.** 快速 and 缓慢 scale the whole system by 0.7 and 1.4, so a *rendered* duration in those tiers is not itself a step on the grid; the grid constrains the base values, and the reciprocal pair keeps the ratio between any two of them intact. Every base goes through `--motion-scale` (see the three-tiers section). The CSS names are semantic (`duration-standard`, `duration-exit`, `duration-enter`, `duration-emphasized`, `duration-press`, `duration-state`, `duration-composite`); the numeric `duration-200` form still works and still scales, but it cannot say whether it means "settling in place" or "leaving" — prefer the role.

**A panel travelling in place is not in this table at all.** Three collapsible panels needed it — the navigation drawer, /messages' contact rail, /search's advanced block — and no row fits: such a panel starts and stops at rest with both ends of its journey on screen, where every M3 *curve* is one-sided. A symmetric bezier was invented for it, measured well, and was still the wrong kind of answer: M3 stopped using curves for this in 2025 — `NavigationDrawer.kt` opens on a `DefaultSpatial` spring and closes on `FastEffects`, and a spring leaves and arrives at zero velocity by construction. So these belong to the springs section, per direction, with every clock in the gesture — panel, scrim, row gap, label fade — on the same pair. `--ease-symmetric` survives for the one thing it is alone in serving: a **loop**, which has no arrival.

**A determinate progress bar is the same case.** Seven hand-rolled meters ran `duration-200` on the loop curve; `ProgressIndicatorDefaults.ProgressAnimationSpec` is `spring(dampingRatio = DampingRatioNoBouncy, stiffness = StiffnessVeryLow)` — critically damped, i.e. the *effects* family, chosen because a meter must not overshoot: past 100% reads as more than full. AOSP's `StiffnessVeryLow` is 50, which at this app's normalised rate settles in ~940ms, so what is borrowed is the family, and `spring-slow-effects` (ζ1.0, 235ms) is the tier — the softest the scheme offers. `components/ProgressBar.tsx` owns it.

**Its neutral tone is `secondary`, and the spec says `primary`.** `LinearProgressIndicatorTokens.ActiveIndicatorColor` is `Primary` over a `SecondaryContainer` track, which separates cleanly in AOSP's scheme because primary is P40 there. This app holds the brand pink instead of a tone of it, and the cost lands exactly here: `primary` on `secondary-container` measures **2.39:1 light / 2.41:1 dark**, under the 3:1 WCAG 1.4.11 asks of a non-text graphic — on a meter, the filled half against the empty half *is* the content. `secondary` measures 5.00:1 / 5.47:1 and is the same substitution the focus ring already made; `primary` was removed from the tone union.

Vuetify remains the reference for the *arrangement* (one gesture, one clock, the scrim sharing it), not for the physics.

Two rows were off M3's scale: **press down is 100ms** (`short2` — it read 120, which is not a step and which three call sites had copied from each other), and **hover is 200ms, not 300** — the table said 300 while `transition-ui`, the utility every hover actually uses, said 200, so the implementation was the one being followed. 200 is `short4`; if two parts of one hover gesture disagree, move the slower one down rather than the faster one up.

Anything genuinely *not* on the scale needs a line here saying so. Today that is `--animate-page-transition`, whose keyframe runs 320ms behind an 80ms backwards-filled delay: the total is 400 and the split is what makes the outgoing clone's fade overlap the incoming page rather than abut it.

**The shared-element flight is a container transform, and that is a statement about its structure, not its curve.** The arrangement is Flutter's and Material Android's, which agree: **one growing, clipping, rounded box, with the destination content laid out at its final size and scaled to that box's current width.** `MaterialContainerTransform` computes `currentEndBounds` from a `fitModeEvaluator` and masks it to the container; `open_container.dart` writes the same thing as `FittedBox(fit: BoxFit.fitWidth, alignment: topLeft)` inside a `SizedBox` of the animated rect. Both grow the box to the **whole surface** (`_rectTween.end = Offset.zero & navSize`), not to the picture's slot. **In DOM terms that is one composited `transform` on a clipping wrapper, and there is no separate fit track at all.** `[data-image-detail-clip]` is a host-sized box carrying `overflow: clip`, a circular `border-radius` and `translate3d(dx, dy, 0) scale(sx, sy)`; `[data-image-detail-unclip]` inside it carries `scale(f/sx, f/sy)`, where `f = max(sx, sy)` — the accumulated content transform is a uniform `scale(f)` with a top-left translate, a `FittedBox`, so the pair *is* the fit. Both need `transform-origin: 0 0`, and neither may hold a resting transform, because a transform is a containing block for fixed-position descendants; they get one from the leg's first frame until `settle()` cancels it, and nothing fixed renders inside that subtree anyway (YARL portals to `document.body`).

**`f` is `max(sx, sy)` — cover — and fitting always to width was a measured artefact.** The window's aspect mid-leg runs between the card's and the host's while the content inside it always has the host's, so whenever `sx < sy` a band `host.height · (sy − sx)` of the window has nothing painted in it — wide-desktop-only, since a portrait card against a landscape host is the only place the two scales separate — and that band was the "part of the bottom is cut off, only on a wide desktop" report: nothing was cropping the picture, the surface behind it was ending early. `MaterialContainerTransform` has exactly this as `FIT_MODE_AUTO`: the axis is chosen per transition rather than fixed. Fitting to the larger scale clips the content on the other axis instead, which is what `overflow: clip` is for and what "masked to the container" means; what gets clipped is the centred `max-w-5xl` column's empty outer margin.

**The compensator is emitted as a two-component `scale()` with one component exactly 1**, not as `scaleY(...)` or `scaleX(...)`: the fit axis can change hands inside one leg, and a `scaleY` keyframe beside a `scaleX` one is a transform-list mismatch that drops WAAPI onto matrix interpolation for that segment. Written as a pair the interpolation stays componentwise and continuous through the crossing, where both components are 1 (between-sample anisotropy 0.441%, against 4.5% for the single-axis form).

**The mask is not an animated `clip-path` — that is the difference between compositing and not.** `clip-path` is compositable only as a Finch-gated native paint worklet (`compositor_animations.cc:79-84`, `:354-368` needs `CompositeClipPathAnimationEnabled()` or falls to `DefaultToUnsupportedProperty` — why two recent Chromiums on one device disagreed), and `property_tree_manager.cc:984-1035` makes `ShaderBasedRRect` return `nullopt` for **any** clip node carrying a `clip-path`, which `:1183-1187` turns into `RenderSurfaceReason::kClipPath`. A circular `border-radius` instead gives `mask_filter_info` with `is_fast_rounded_corner` and no render surface. Two corollaries: the clip must be `overflow: clip` on **both** axes (`NeedsInnerBorderRadiusClip` requires `ShouldClipOverflowAlongBothAxis()`; a single-axis clip silently squares the corner), and the corner must be **one circular value** (`RoundedCornersF` is four scalars; an elliptical radius costs a mask layer) — the construction's only visual compromise, the corner being elliptical on screen wherever the box is not host-shaped, up to 4.44:1 at take-off, where the opaque flyer covers it.

**The corner is divided by `min(sx, sy)` and rounded up.** Both screen radii are then at least `R`, so the window's cut provably contains the flyer's circular-`R` cut; dividing by `sx` or rounding to nearest under-cuts and leaves slivers of `bg-surface` outside the picture's corner at take-off, which is where the eye is.

**`[data-image-detail-scale]` is `[data-image-detail-crossfade]` now, and carries one property: the content's opacity.** It could not become the window itself — the pull gesture already owns `.image-detail-overlay-content`, and a CSS-variable translate and a WAAPI transform cannot compose on one element; nor move onto the compensator — that node is an ancestor of `[data-image-detail-surface]`, which has its own fade on the back leg, and two nested opacities multiply into two entrances.

**The flight layer gets the exact inverse of the window, on an opening leg only.** The plane's anchor cannot leave the scroller — `sizePlaneLayer` puts the layer at the scroll offset captured at take-off, inside a node that scrolls with the content, which is the whole of why the flyer follows ordinary and inertial scrolling at zero per-frame cost — so instead of moving it out of the window, it carries `scale(1/sx) translate(-dx, -dy)`, which accumulates to the identity. `transform-origin: 0 0` on that layer is load-bearing: the default `50% 50%` would displace the flyer by hundreds of pixels. The track is built iff the window `contains()` the layer, not by testing the direction — containment is self-correcting for both legs, for every `moveFlightToPlane`, and for the reduced and dismiss paths. Dropping the scroll term is deliberate and an improvement: the landing target is inside the scaled subtree, so both move by `sx · Δ` and the flyer tracks it for the whole leg.

**`npm run hero:path` covers all of it**, over 36 legs at 97 samples each: the accumulated content transform is isotropic (1e-16) **and equal to `max(sx, sy)`**, so a fit that leaves part of the window unpainted is a failing check; clip ∘ compensator ∘ counter parses back to the identity from the *emitted strings* (1e-13 — the string level is what catches writing the counter's two functions in the wrong order, an error that compiles and only shows on a device you are not holding); the visible box reconstructed from the pose is the arc's own rect; landing is exact to the character; corner containment holds and the browser's radius clamp never binds; `unprojectHeroContainerRect` round-trips; and the between-sample anisotropy WAAPI introduces by lerping the two scales independently stays under 0.6% (measured 0.441%).

**Every box in that matrix is measured now** — it used to place its media wells at hard-coded origins that were not inside the hosts it compared them against (the destination at 1440 sat at x 104 while the overlay starts at 300), so the containment check passed while the shipped app was flattening the picture on real geometry. Card rects and host boxes come out of a browser on the fixture gallery at 1440, 1920 and 390, the well derived from the host the way the layout derives it. The wide desktop is in there for a specific reason: four 308px columns against a well capped at 944 and centred mean a flight from an *outer* column is a long, mostly horizontal move into a box that straddles the card vertically — the geometry where the two corner arcs bow in opposite screen directions; nothing at 1440 or 390 has that shape, which is why "on a wide screen the two columns near the edges have too weak a parabola" was invisible to the harness.

**Containment is judged on what is visible, not on the raw rects.** The visible loss is `(picture ∩ host) \ window`: the overlay and `[data-image-detail-host]` are both `overflow: hidden` on one box, so a picture edge outside *that* is clipped whether the window holds it or not. Solving on the clipped rect is worth real bow — a card whose box extends 488px below the fold spends most of its early flight outside the overlay, and refusing to notice cost it its whole arc (bow 0.13 against 1.00); the raw escape reaches 67px on the shipped matrix and every pixel of it is outside the overlay, while the visible escape stays under 1px.

**The gallery's depth cue is a scale, and it is a window on the leg's travel rather than the leg.** It was a *translate* (8px down, then 24) — the wrong verb: a sink is a recede, not a displacement, and sliding the grid down the screen pushed the top row out of the fold. It is `scale(0.95)` now, which is `AuthModal`'s own gesture when the captcha dialog opens over it — cited rather than picked. Its `transform-origin` is the **viewport's** centre inside the scroller, written from the live scroll offset once per leg, because `[data-image-detail-background-visual]`'s box is the whole scrollable content and an element-centred origin on something several viewports tall flings the visible rows.

And it ramped 1:1 with the flight, so it reached full depth exactly when the window had grown over the whole host and there was nothing left to see it against (measured: 5.3px down at 155ms of a 194ms leg, 8px down at 310ms — behind an opaque surface; a cue whose peak is occluded is a cue that does not exist). `HERO_BACKGROUND_SINK_WINDOW` spends it over the first 60% of the travel and mirrors on the way home (0.4 → 1), because the grid is *revealed* rather than covered on a return. 0.45 ended too early — the recede was over while the box was still visibly growing, so the two halves of one gesture stopped at different times; later than 0.6 is not free either, since the window has covered most of the host by 0.75.

A scale on this layer does not make Chromium re-raster it: `cc` takes the raster scale from the maximum the animation reaches, and this animation's maximum is 1 — the identity it starts from — so the existing raster stands and the shrink is a GPU downscale; what is left is a slight softening while the grid recedes, which is what receding looks like. It still wants a check on a phone before it is treated as free.

**296ms, mirrored — `slowSpatial` both ways, which is Flutter's arrangement.** Flutter's Hero has no duration of its own: `_HeroFlight` rides the route's animation, so a push and a pop are the same animation played forwards and backwards, one duration and one curve. The answers that came first were wrong in instructive ways: 296/166 from `NavigationDrawer.kt` (a drawer *leaves* where this *returns*); 500/400, `MaterialContainerTransform`'s real durations (`entering ? motionDurationLong2 : motionDurationMedium4`, not "300ms either way") — correct citation, wrong subject, an *activity-level* transform, and 500ms too slow to live with; 296/194, taking the asymmetry to the nearest tiers — the open was right and the return read as snatched (194 is the tier for a switch handle; this is a full-screen box collapsing to a thumbnail). The direction difference lives entirely in the thresholds now, which is where Material keeps it too.

**The *duration and the shape* mirror; the path does not.** `createHeroPointArc` puts the circle's centre on an axis through whichever endpoint owns the larger delta, so swapping the pair mirrors the arc rather than retracing it — on a masonry-tile pair, the forward pose at `p` and the back pose at `1 − p` sit up to **170px** apart mid-flight. Flutter has the identical property, since `MaterialApp` builds a fresh `MaterialRectArcTween(begin, end)` per flight. Going out and coming back are the same gesture, not the same picture reversed.

**250ms is off the spring ladder on purpose, and the two tiers either side are why.** `defaultSpatial` (194ms) reads snatched and `slowSpatial` (296ms) reads slack, and there is nothing between them on the ladder — the tell being that the ladder's entries are *spring settle times*, and a from-rest leg flies a Bézier. The only spring here is the interruption model, whose `rate` is normalised so its shape is independent of the clock. So the flight is a transition, its shape is a curve, and its length is a step on M3's own duration scale, of which 250 is `medium1`. One consequence: an interrupted leg is a ζ0.9 spatial spring settling in 250ms — a real member of that family, not one of its three named tiers.

**It went down to `defaultSpatial` (194ms) once and came back, and the round trip is the lesson.** Its *length* was never what made the flight read slow — it was flat: the path was flying 2-5% of its chord because the crop budget and a shared containment bow had eaten the arc, the content arrived with the box instead of following it, and the depth cue peaked behind an opaque surface; once those were fixed the same 194ms read as snatched. **When a transition reads wrong, check what it is doing before changing how long it takes** — a duration is the cheapest knob and the least likely to be the fault.

Three things the length has to fit, all checked: `HERO_PROGRESS_SAMPLES` is 48 per leg, so 250ms is 5.21ms per segment (under one frame at 120Hz; at 500 with 24 it was 21ms, flattening the curve's fastest region across 1.3 frames); the gallery card's chrome fades on a 200ms CSS transition that must finish inside the flight; and the reveal staircase is expressed as fractions of the leg rather than milliseconds, so it cannot outlive it. 48 rather than 32 because the *spring* is the harder curve to table and the reverse leg is its worst case: the largest linear-interpolation error between samples is 0.332% for the flight curve but 0.609% for the ζ0.9 spring at the −0.5 launch velocity a reversal saturates to (32 brings those to 0.189% and 0.353%). `HERO_REVERSE_MIN_DURATION_MS`'s 90ms floor is **inert** at these durations — the ratio bottoms out at 0.35, so the shortest reverse is 104ms and it would take a leg under 257ms to reach it.

**The rest of the direction asymmetry lives in the thresholds** — `DEFAULT_ENTER_THRESHOLDS` / `DEFAULT_RETURN_THRESHOLDS`:

| | enter | return |
| --- | --- | --- |
| surface cross-fade | 0 → 0.25 | **0.60 → 0.90** |
| corner (shape) mask | 0 → 0.75 | 0.30 → 0.90 |

**Every one of those windows is evaluated on the leg's `progress`, not on its wall clock**, which is what `MaterialContainerTransform` does (it applies `ProgressThresholds` to the animator's *interpolated* fraction). The fades used to be four keyframes at raw time offsets while the mask's corner already used the eased progress — one gesture measured two ways, the literal answer to "the curve and the rate are not coordinated". The forward leg barely moves (`0 → 0.25` ended at 74ms on the clock, ends at 75.6ms on travel); the back leg is where it shows — the surface's `0.60 → 0.90` was 178 → 266ms and is 116 → 187ms, so the plane hands over to the thumbnail when the box has actually got most of the way home. The flyer's own corner reads the same row of the shape table as the container's in *both* directions (it used to hold the enter row's reciprocal and apply it either way; invisible today, since both `ImageCard` and `FeaturedBanner` treat their thumbnail with the same corner as `HERO_TARGET_RADIUS_PX`, so the flyer's radius track interpolates 16 to 16).

The return row is the one that changes how the exit reads: the plane stays fully there while the container shrinks and hands over to the thumbnail late, instead of blinking out first. The corner threshold is also where `HERO_RADIUS_LEAD` comes from — it is `1 / 0.75`, not a fitted number.

**The *content* does not take the return threshold, and that is a divergence.** Material's 0.60 → 0.90 is tuned for card-to-card, where the shrinking thing is about the size of what it shrinks into; here it is a full-screen article going home to a thumbnail, and holding it opaque for the first 60% meant watching the whole page — heading, tags, description, comments — scale down and fly into the card behind the picture: a second object making the same trip. On the way back the content takes the *enter* window mirrored (0 → 0.25), so it is gone in the first quarter; the surface plane keeps 0.60 → 0.90 so there is still something to shrink, and the picture keeps its own morph.

**The path is Flutter's Hero path — `MaterialRectArcTween`, two opposite corners on two circular arcs.** Two predecessors, do not reach for either: a *ballistic lift* keyed on **linear** time while the position ran on the spring, so at the point the spring had covered 97% of its travel the parabola was still at 96% of its peak — the last 40% of every flight was an already-arrived picture sinking the remaining ~38px, and the rendered top ran past its landing edge by 26px and back; and Material Android's opt-in `MaterialArcMotion`, one quadratic Bézier through a corner of the endpoints' bounding box (a per-axis reparameterisation), which fails in whichever of two ways you build it — arcing the centre while the size runs on plain progress sends an edge 38px past its landing column and back, and pairing each axis's whole extent onto its own quadratic fixes the edges and puts the aspect ratio on the leading axis (measured **830 × 281** mid-flight, an aspect of 2.95 where the thumbnail was 2.0 and the picture 1.78).

`MaterialRectArcTween` is a different construction from both, and it *is* the Material default (`MaterialApp` installs `createRectTween: (a, b) => MaterialRectArcTween(a, b)`). It interpolates **corners rather than a box** — pick the diagonal whose direction best matches the travel, send those two opposite corners along circular arcs, rebuild the rect from them. The radius comes out of the chord and the shorter delta, `r = |AB|² / (2·Δshort)`, which bounds every sweep under 90°, so each edge is one coordinate of one monotone arc for any pair of boxes.

**Two standing checks, and they are in tension — which is why there is a `bow`.** The first is per-decile monotonicity of all four rendered edges: a flight that passes an edge and returns is a bug however good the curve. The second is the crop: the flyer's canvas is `object-cover`, so the visible fraction of the picture is `min(a / aBase, aBase / a)` — a function of the box's instantaneous aspect and nothing else — and it has to approach the destination's aspect *monotonically*. Corner arcs pass the first and fail the second (the lead and trail arcs have different radii, and the difference between their bows is a size change); the centre-arc form (Flutter's own `MaterialRectCenterArcTween`) passes the second and fails the first. No construction has neither.

So the arc is blended toward its own chord by `bow ∈ [0, 1]`, solved per box-pair as the largest value whose crop retracement stays inside `HERO_ARC_CROP_BUDGET` (24%). A convex combination of two same-direction monotone functions is monotone, so the edge check holds by construction at any bow, and the full Flutter arc survives untouched wherever it is already safe. At bow 1 the visible fraction un-cropped to nearly full, handed back 22 points and un-cropped again inside 300ms, with half the geometry matrix retracing 12–32% — the "the flight is not coherent" complaint, and no timing function touches it.

**There are two bows, not one, and conflating them cost the picture its arc.** The window has to hold the picture (`[data-image-detail-clip]` is `overflow: clip`, so anything the flyer does outside it is a visible crop), and the window's rect pair is not the flyer's, so the two arcs pick their tangent axis from different endpoints and can leave along different axes. One shared scalar, reduced until the pair fit, turned the reported crop into a reported *flatness*: on the three destination shapes where containment binds it solved to **0.020 / 0.079 / 0.233** — the picture flew a straight line. It is now `bow(picture)` for the crop budget and `bow(window)` for containment (`solveHeroArcContainBows`), and the *window* is the one that gives way, because the window is the arc at fault: from a 240×240 card to a 1312×780 host its aspect excursion at full bow is 24–59% past its own endpoints, so mid-flight it is a far flatter box than either end and too short to hold the picture (the same three pairs now measure 16.2% / 12.2% / 7.7%). Where nothing clips the picture — a dismiss, and the closing leg, whose flyer is planted in the gallery plane — the two share, both then fully on screen.

That solve **scans and then refines; a bisection is wrong rather than coarse.** Escape is not monotone in the window's bow: on some pairs the feasible band is an interior interval (one reads 13.0 3.3 0.0 0.0 0.0 4.3 12.5 … px per tenth), because a flat window is a plain corner-chord interpolation whose own aspect stops tracking the picture's. And when *no* window holds the picture, the picture is reduced against the **friendliest** window rather than against a flat one — on a 1920×1080 grid with a tall picture opened from the bottom row, the escape runs 74.6px at window bow 0 down to 63.1px at bow 1, so reducing against the flat window (the only one where feasibility is provable) throws away most of the arc for nothing. Bow 0 stays as the backstop.

**The crop budget is what limits the outer columns on a wide screen, and the trade there is 1:1.** In a masonry grid the card's aspect *is* the picture's, so the cover fraction is 1 at both ends and any mid-flight aspect excursion is a pure there-and-back; and with two corner arcs the excursion *is* the bow. For the commonest geometry in the app you cannot buy arc without buying pump — they are one quantity measured two ways. Swept on the real 1920 and 2560 grids, the outer columns are budget-bound on every case and their deviation tracks the budget almost linearly: 2.5-4.6% at 12%, 3.8-7.0% at 18%, 5.1-9.4% at 24%. 24% is what ships (browser-measured after the change, the left column reads 8.3% where it read 4.5%, the right 6.6% where it read 0.3%).

The construction that separates arc from pump is a **centre arc with the size on the lerp** — a constant aspect makes the retrace identically zero (measured on all nineteen wide-screen pairs) — but it is not shipped, because its own limiter, edge monotonicity, is harsher and less predictable: on the same nineteen it lands between 0.3% and 16.7% and is *flatter* than the corner form on nine of them (the centre's deviation moves both edges of an axis together; solved bows 0.05–0.66). Selecting between the two per pair would beat both and is the open option. **Per-corner bows matched so the two corners deviate equally** removes the size term almost entirely (crop retrace ≈ 0) and destroys the arc, because the centre's deviation is the *average* of the two corners' and they measure 2 vs 96, 5 vs 46, 12 vs 103 — matching means keeping the smaller. Do not reach for either.

**Both checks are a command now, not prose: `npm run hero:path`.** It imports the app's own `geometry.ts`, `progress.ts` and `constants.ts` through a `module.registerHooks` resolve hook — no build step, no new dependency, Node 22.18+ — sweeps a matrix of thirteen realistic box pairs in both directions, and exits non-zero. Prose is why the crop check was failing in shipped code for as long as it was: nobody had run it. It asserts containment too — that the picture never leaves the window, and that the *picture* never has to give up bow to achieve it — and prints both bows beside the shipped and the previous deviation, so a change to either lever is a diff in a table. If you touch the path, the arc, either bow or the sample count, that command is the thing that says whether you were right.

**And `emphasized` does not fit this clock** — the answer to "unify the curve with the rest of the app". It is the token the motion table names for a large container transform and what `MaterialContainerTransform` runs, and at this clock it is unusable: one decile carries **54.2%** of the travel, the fastest tenth takes **2.7ms at 250ms** — well under a frame either way — and a 60Hz frame straddles a ~30-point jump, hundreds of pixels on a full-screen travel. Its 32-sample table error is 2.159% against `fastOutSlowIn`'s 0.189%, so it would need roughly 110 keyframes as well. It works at the 500ms the shared axis pairs it with (biggest single-frame jump 22 points) and needs ≥450ms to present at all — the duration already recorded as too slow to live with here. `standard` is the other candidate and gives up the hang-back — 15.6% of the travel in its first tenth against 2.6% — which is the recognisable thing about a Flutter hero. So the flight keeps `fastOutSlowIn`, and what unifies it with the rest of the app is the *arc* and the choreography rather than the easing.

**The shape is `Curves.fastOutSlowIn`, which is what Flutter's Hero actually flies.** `_HeroFlightManifest.animation` wraps the route's animation in `CurvedAnimation(curve: Curves.fastOutSlowIn, reverseCurve: Curves.fastOutSlowIn.flipped)`, and `FlippedCurve` is `1 − curve(1 − t)`, so a pop presents the same profile as a push. Per tenth of the leg it travels 2.6 10.8 23.3 24.6 16.2 10.0 6.2 3.7 1.9 0.6 — peak at 30%, half travel at 35%, fastest:last 41:1.

**A spring cannot be given that shape, and that is why this is a curve rather than a tier.** The whole difference is the first fifth: the curve hangs back, 2.6% of the travel in its first tenth against the ζ0.9 spring's 9.8%, and then goes. A spring released from rest has its peak velocity at `arccos(ζ)/ω_d`; normalised by settle time that lands at 15–20% for every tier this app ships (ζ1.0 at 15%, ζ0.9 at 20%), and *lowering* ζ moves it earlier rather than later, because a longer settle window stretches the tail more than the head. "Almost still, then away" is not reachable by retuning ζ.

**The ζ0.9 spring is still here, and it is the interruption model.** Every leg that has to leave at a speed something is *already* travelling at is a spring — a reversal, a mid-flight rebuild, a drag release — because a cubic Bézier's launch slope is `y1/x1`, fixed by its own shape, while `solveSpringVelocity` is exact in both damping regimes; a mid-flight resize therefore converts an uninterrupted leg from the curve to a spring, forced rather than chosen. `rate` is ω in *normalised* time, so within a family that product is a constant — 5.13 for every ζ0.9 spatial tier, 6.65 for every ζ1.0 effects tier — which is what lets a reverse pick its own duration without picking a different curve, and it reproduces `StandardMotionTokens` `DefaultSpatial` decile for decile to within 0.2 of a point. ζ0.9 rather than ζ1.0 by the app's own family rule: a container transform moves **and** resizes, so it is spatial. Per tenth, ζ1.0 is 14.5 24.2 21.1 15.3 10.1 6.4 3.9 2.3 1.3 0.8 (peak second tenth, 31:1) against ζ0.9's 9.8 19.2 19.7 16.6 12.6 8.9 5.9 3.7 2.2 1.3 (peak third, 15:1) — the first starts abruptly and then crawls.

There is no longer a spread to remember: `relaunch()` in `lib/hero/progress.ts` is the only place a launch velocity is solved, so the hazard this file used to document — that rebuilding a response field by field drops ζ back to 1 silently, which had shipped — is structurally gone. An interrupted leg *can* overshoot: a reversal launched with a negative velocity dips before it recovers, and that dip is the catch; `hero:path` asserts monotonicity of the from-rest models and deliberately exempts the negative-velocity one.

**Both ends leave from rest.** `y'(0) = 3·y1 = 0` and `y'(1) = 3·(1 − y2) = 0` exactly, and the check asserts it rather than trusting the constant, because the constants read `{ rate: 7.0, velocity: 0.9 }` for a long time while claiming otherwise — the flyer already travelling at the whole flight's average speed in its first frame, fastest tenth carrying 46x (out) and 64x (back) what its last one did.

**Three exits, and `cause` is what picks between them.** A tap-back and a browser-back run the container return above. A **swipe-down does not**: the finger has already put the surface where it is via `--hero-pull-y` / `--hero-veil`, so the dismiss continues those from their live values and never masks or scales anything — re-scaling under a spring would be a second hand on the same object. M3 draws the same line for a drawer, settling a *drag release* on `DefaultSpatial` while closing on `FastEffects`. The release slides down the spatial ladder with the travel left — 296ms at a full drag, floored at 137ms for a flick from near the top — and because ω is normalised it gets faster without getting a different curve. `HeroCloseIntent.cause` used to be written in three places and read in none; it selects the choreography now.

**The Stage and the route must measure identically, and "identical CSS" is not enough.** The landing target is an ordinary in-flow flex item in the media well, because the routed `DetailImage` is one too. It used to sit inside an `absolute inset-x-4` wrapper, so its `width: min(100%, …)` resolved against a containing block 16px narrower per side — the flyer landed 16px wider than the picture it handed off to and snapped in on arrival. When a handoff visibly jumps, compare the two elements' *containing blocks*, not their style objects.

**The detail's background surface had a clock of its own:** 270ms of `emphasized-decelerate` starting with the flyer, against a 340ms flight — the plane finished arriving 70ms before the picture landed, two separate events that merely began together; its opacity is on the container's cross-fade interval now. The content cascade keeps its own staircase but *only its position*: header and body still arrive in reading order, while the block's opacity belongs to the container once, because two nested opacities multiply and read as two entrances. Two steps, not three — the cascade is a descendant query on the overlay and both back buttons render as its *siblings*, so nothing in the app carries `data-image-detail-reveal="chrome"`; their entrance is the `floatingBack` branch, which legitimately keeps its own clock (it renders outside the overlay, the mask never reaches it, and it is a control appearing beside the surface rather than a block inside the box).

**The staircase had the same defect from the other end.** It ran 400ms on `emphasized-decelerate` with delays of 50/100/150, so the body finished at 550ms — the text kept sliding for a quarter of a second after the picture landed. It is 200ms on `standard-decelerate` with delays of 0/50/100 now, but `0 + 100 + 200 = 300` against a 296ms flight is not "they stop together": the body's window ended at 1.0135 of the leg, and the targets during an open are the *Stage's* nodes, which the handoff replaces with the route's untransformed ones — so a window ending past `p = 1` leaves a residual transform on the node in the frame that swaps them; and a positional rise is spatial by this file's own family rule, so a transition-table bezier was a second shape inside a gesture the box was already giving a shape to.

So the steps are **windows on the leg's own progress** now — `HERO_REVEAL_WINDOW`, sampled from the same table the mask, the fit, both fades and the depth sink read. The values are today's timing translated into travel rather than new timing (`p(50/296) = 0.088`, `p(250/296) = 0.986`, `p(100/296) = 0.469`), so each step starts and stops within a millisecond of where it did, the body now ends exactly with the flyer, and none of it can drift when `HERO_DURATIONS` moves.

**A box outside the host must not be clamped.** `formatHeroContainerClip` read `Math.max(0, …)` on all four insets, and because `right`/`bottom` derive from the already-clamped `left`/`top` the error compounded into a *translation*: the mask kept its size and slid to the host's edge. Reproduced by scrolling the gallery down 260px and opening the featured banner — the closing mask ended 236px below the thumbnail it was collapsing into. Negative `inset()` values are valid CSS and Chromium honours them (verified with `elementFromPoint` probes: the shape extends past that edge and the other three still clip), so only the radius clamps.

`transition-ui` is not an exemption: the table says 200 and `transition-ui` *is* the table. A lone element moved to 300 is still the bug rather than the utility.

The one thing that legitimately runs longer is a **composite** hover, where every moving part shares one clock: the gallery tile's image scale, its veil and its caption all settle together at 300ms — a decision about the gesture rather than about the element. If the parts of one gesture disagree, make them agree — the tile veil was 200ms against its own image's 300ms scale, so one gesture arrived in two instalments.

Always name the properties: `transition-[opacity,transform]`, never `transition-all` — it animates layout properties too, and it is what made a button's hover jitter while its shadow grew. And always name the curve, even for a one-property fade: a bare `transition-opacity` inherits `--default-transition-timing-function`, which is a safety net pointed at `standard`, not a decision — it cannot know whether the thing is arriving, leaving, or settling in place.

### Three tiers and three speeds

The animation preference is **关闭 / 减弱 / 标准**, and independently a speed of **快速 / 默认 / 缓慢** and a switch for **入场动画**. `lib/appearance.ts` owns all of it and writes `data-motion` / `data-motion-speed` / `data-entrance` onto `<html>`; `app/layout.tsx` puts them there from cookies at SSR and corrects them from localStorage before the first paint, so the tier is never wrong on a cold load and the CSS never has to wait for React.

**The two axes are orthogonal: the tier decides what kind of motion plays, the speed decides how long it takes.** 减弱 once carried its own 0.5 scale as well as stripping travel, so choosing "less motion" answered one question twice and the tier that most needed to feel calm instead felt broken. Speed applies to both tiers that animate; only 关闭 ignores it, because its length is zero.

`prefers-reduced-motion` reaches this **through** the attribute rather than around it: `system` is resolved in JS and `reduce` maps to **减弱, not 关闭**. What the preference asks for is less movement, and a user who wants none at all now has somewhere to say so. There is no 跟随系统 *option* in the control — the stored value is `system` until something is picked, and the select shows the tier that resolved, so a visitor whose OS asks for less motion sees 减弱动画 rather than a label that only says where the answer came from. The scripting-off floor is one blunt rule in a `<noscript><style>` in the layout.

**Everything is one variable.** Every duration in the app is `calc(<base> * var(--motion-scale))`; the speed rules do nothing but set that number — 0.7 / 1 / 1.4, and **0** for 关闭. Two consequences:

- **The keyframe enumeration is gone** — a duration derived from the scale obeys the tier by construction. The invariant: *every `transition-duration` and `animation-duration` in the built CSS goes through `--motion-scale`* — greppable (a duration reached through `var(--transition-duration-*)` or `var(--duration-spring-*)` satisfies it), and the only exceptions are the four indeterminate progress indicators, each of which says why beside its value, plus the two third-party stylesheets.
- **The M3 duration scale is what 默认 declares.** 快速 and 缓慢 are an equal scaling of the whole system, so a scaled value is not itself a step on the 50ms grid — and that is the point. 0.7 and 1.4 are reciprocals, so the *ratios* between the parts of one gesture (a 100ms press against a 150ms state layer) are identical at all three speeds, which three separately-rounded duration tables could not have promised.

Scaling a spring's clock is legitimate where scaling one of its two halves would not be: normalised by settle time the curve depends only on ζ, so a uniform scale is the same spring at a different speed.

**A wall-clock timer that bounds an animation takes `MOTION_SPEED_SCALE.slow`, not the animation's own number and not the live speed.** Every duration in the CSS now stretches by up to 1.4, so a `setTimeout` written against the unscaled figure fires inside the motion it was meant to outlast: it unmounted `Modal` at 71% of its fade, dropped the splash overlay's full-screen `bg-surface` at roughly 0.6 opacity, and pushed both tab bars' routes ~200ms into a slide. The *maximum* rather than the current value, because the number bounds the animation and the speed can change between the two reads; holding an already-invisible node 40% longer costs nothing. Four call sites do this (`lib/overlay.ts`, `components/LoadingOverlay.tsx`, `components/AppLayout.tsx`, `app/admin/page.tsx`), and a fifth that needs it is a bug you will only see at 缓慢.

**入场动画 is the third axis, and it is a call-site decision rather than a token.** It answers a different question from the tier: the tier is about how much motion a gesture *you* asked for may use, and this is about whether the app volunteers any of its own — the scroll reveal, the grid cascade, `Reveal`, `Logo`'s draw-on, the splash. `entranceMotion()` reads `data-entrance` off `<html>`, and the invariant is *an animation is an entrance iff its call site reads `entranceMotion()`*.

It shipped as a second CSS multiplier, `--motion-entrance`, and that had to come out, because **two keyframes serve both kinds at once.** `--animate-page-transition` is a cold mount's own fade *and* the route cross-fade's incoming half *and* `AuthModal`'s login/register pane swap; `--animate-fade-in` is a gallery skeleton appearing *and* the captcha's success state. Multiplying the token therefore suppressed a pane swap the user had just asked for, while `playRouteCrossFade` — which sets `animation: none` and drives the fade itself — ignored the preference on the path most navigations take; and `--animate-detail-arrive`, the substitute the two lower tiers get for the hero flight, turned a tapped thumbnail into a hard cut. A route transition, a pane swap, an overlay opening and status feedback are the *tier's* business; only motion nothing asked for is this switch's. What it gives up is four CSS mount fades that keep playing with the switch off (the gallery skeleton, the dev banner, the admin panel, the upload preview), all 400ms on opacity alone.

**减弱 is basic motion, not absent motion**, and that is the rule to check a new branch against:

> Keep the fades, the short travels, the state layers, the ripple, the indicator that slides. Drop the performance: the container-transform flight, a slide across the whole window, stagger, overshoot, decorative loops, Lottie playback.

Two readings of that rule: **"Drop Lottie playback" means every Lottie**, including the ones whose call sites argue they are a response rather than a performance — `LottieIcon` gated on `off` alone while its two call sites are a 3257×2148 login illustration filling 60% of a dialog and /search's 3000×1553 empty state, both behind a 60KB player, and `Logo`'s hover trace warmed that player on an idle callback; both are standard-only now. **And the skeleton shimmer is not a decorative loop**: it is the same class as the four indeterminate indicators, a band that says "this is a placeholder, not content", so it keeps looping under 减弱 and only `off` stops it. (The first version of the rule said *keep opacity and colour, drop travel, scale, rotation and stagger* — a fair description of 关闭, and it left 减弱 with nothing moving anywhere, because the CSS block it named re-declared `transition-property` without `transform`: the drawer did not slide, the switch handle did not travel, the tab indicator did not glide, a determinate meter's `scaleX` snapped. That block is `off`-only now.)

**8px is the weak form's travel, and it has to be the same 8px everywhere.** `Reveal`, the grid, `Toast`, the route clone, the detail's own arrive keyframe, the floating back button and the swipe-dismiss all take it under 减弱; two of those last three were zeroing it, which made them the only things in the app that faded in with no travel at all on the tier whose whole point is that something still moves.

Overshoot is the one part a stylesheet can remove on its own, and it takes three declarations because nine springs share four `linear()` tables: `html[data-motion='reduced']` points the three under-damped shapes at the critically damped one, so a handle still travels and simply stops when it arrives; `spring()` in `lib/motion.ts` does the same substitution for GSAP. Everything else is per-component, because "what the basic form of this gesture is" is not a question CSS can answer: a cross-fade with a 24px shift where there was a full-window slide (the shared axis), a half-height rise where there was a full one (`Reveal`, the grid, `Toast`, the route clone), no cascade where there was one, and the hero flight replaced by the detail route's own fade — that last one on measurement rather than principle, since the flight is the most expensive thing the app does (36fps on a machine that idles at 60) and this tier's audience is a device that cannot afford it.

JS reads `motionTier()` — `prefersReducedMotion()` and `useReducedMotion()` are **deleted**, not aliased, because at more than twenty of their thirty call sites the "reduced" branch was a bare `return`: an absent animation rather than a weaker one, and an alias would have left every one of them quietly meaning 关闭 for a user who asked for less.

**关闭 has four documented exceptions**, and they are the answer to "why is something still moving": indeterminate progress (`Spinner`, `.m3-progress-*`, the top loader) slows rather than stopping, because a frozen ring claims the opposite of what it means; a determinate meter still shows its *value*, only the transition between values goes; a position the finger is holding is the input's own projection, not an animation — the drag itself is never gated, only the release; and a scroll offset is state, so every tier still lands on it and only the travel is dropped.

`no-motion:` is the call-site variant, and it replaces Tailwind's built-in `motion-reduce:`, which is a media query and therefore cannot see the app's own setting. Its five uses all do one job: standing a hover *end state* down, because the off tier drops `rotate`/`scale` from the transition list and what is left without a guard is the same 180° turn arriving in one frame. It matches `off` alone — it was `low-motion` and matched 减弱 too, which was right only while that tier stripped transforms. Unlike `dark`, it is built on `:is()` rather than `:where()` — it exists to beat the utility beside it, so it needs that specificity.

The `spring-*` utilities are covered by the transition rule automatically, because they set only a timing function and a duration and are always composed with a `transition-[…]` it already matches.

## Three traps that make a fix look applied when it is not

**A Tailwind variant needs its colon.** `peer-focus-ring` is not "the `focus-ring` utility under the `peer-focus` variant" — it is a class name that matches no utility, so it emits nothing at all. `Checkbox` and `ToggleSwitch` both carried it next to `peer-focus-visible:ring-2`, which meant a 2px ring painted in `currentColor` — taking the colour of whatever text happened to surround the control, which is the exact failure `focus-ring` was added to end. The form that works is `peer-focus-visible:focus-ring`. When you add one of these, grep the built CSS for the escaped selector (`.focus-visible\:focus-ring`) rather than assuming; a class that compiles to nothing looks identical in the source.

**Comments generate CSS.** Tailwind scans raw file text for class candidates and does not skip comments, so a comment naming a class you just deleted can put it straight back into the stylesheet. The cost is not weight — it is that you can no longer grep the built CSS to prove a class is gone. When documenting a value you removed, spell it in prose ("a 25% alpha on `ring-primary`") rather than as a class name. Measured: a `.tsx` comment does it (a note reading "it read `py-10`" put `.py-10` back into the bundle, from a component where the class appears nowhere else), while a comment inside `app/globals.css` does **not** — `motion-reduce` and `duration-200` are both named in comments there and neither emits a rule; do not lean on that asymmetry, the rule is the same in both files because it is the one you can remember. The extractor is wider than it looks, and an earlier version of this note got the line in the wrong place: it claimed anything with a `/`, a `[`, a `:` or a `-` before a number "only registers in an attribute-like position" and is safe in prose — **false for the `:` and the `-`**. A comment reading "it read `sm:px-26`" put `.sm\:px-26{padding-inline:…}` back into the bundle, and so did a bare `p-5` and a `min-w-14`. What genuinely does *not* survive is the alpha and the bracket form — `ring-primary/20`, `bg-black/55`, `scale-[1.02]` — plus a palette class that names a colour the theme does not define (`bg-slate-800`, `text-red-500` resolve to nothing here); everything else should be assumed live. So the rule is simply: **do not write a class name in a comment to say you removed it.** Spell the value — "a 104px inset", "20px of row padding" — and the sentence still explains itself while the bundle stays clean. The check is a grep of the built CSS for the escaped selector, and it only works for names that are not also English words: **`rounded` will never grep clean**, because it appears in a dozen legitimate sentences about corners — pick the invariant you can actually verify. `@source not "../**/*.md"` at the top of globals.css is what keeps this file's own "Never" column out of the bundle; code comments are still scanned.

**A `{' '}` inside a flex or grid container is an extra item.** Prettier inserts one whenever it breaks a JSX line where a literal space stood, and between two block children it is invisible — so it accumulates. In a flex container it is not invisible: a text node is an anonymous flex item, so it takes a `gap` of its own *and* renders a space glyph. Measured on the sidebar's user block, a `flex items-center gap-1.5` row with two of them between the level badge and the verified name: about 16px of separation where 6px was written. There were 697 in the app and 220 of them were inside a flex or grid container; the other 477 are between inline text and are load-bearing — removing those joins words — so this is not a search-and-replace. The distinction is the parent's `display`, which means it needs the parser, not a regex: walk the JSX, find elements whose `className` mentions `flex`/`grid`, and drop the string-literal `' '` children of *those*. Two refinements from measuring the sweep, because the rule as first written points at the wrong set: it is a **direct child** of a `display: flex` / `grid` element that becomes an anonymous item (a `{' '}` between two *block* children of a `space-y-*` div collapses to nothing — noise, not a gap); and a `{' '}` **inside an inline element** pads that element's own text, which is visible when the element is itself a flex item (a `<span className="text-primary"> {n} / {total} </span>` in a `justify-between` row reads off-centre). And the ones a `className` grep cannot see are the ones left: a fragment passed to a **render prop** lands wherever the primitive puts it, so 24 spaces inside `Modal` `footer`s became items in its `flex justify-end gap-3` row — 12px + a glyph + 12px where `gap-3` was written.

## Transitions between screens

Three mechanisms, in order of how much they own:

| Change                          | Mechanism                             | Lives in                         |
| ------------------------------- | ------------------------------------- | -------------------------------- |
| Opening/closing an image        | Shared-element hero flight            | `lib/hero/**`                    |
| Gallery <-> forum, profile tabs | Shared axis (X), 500ms `emphasized`   | `playSharedAxis` / `useTabPanesOn` |
| Any other route                 | Cross-fade over an inert clone, 400ms | `lib/routeCrossFade.ts`          |

**A tab change writes the URL synchronously, with `history.pushState`.** Not `router.push`: a tab is a query parameter on the route you are already on, and treating it as a navigation makes it an RSC request inside a transition that **races any other navigation started nearby** — and it was *deferred* by `TAB_PUSH_COALESCE_MS`, so it could land after the user had gone somewhere else and overwrite it. Measured over five runs, tapping 论坛 and opening a thread 200ms later gave three different answers — the thread opened once, the queued tab update clobbered it twice, and twice both navigations were lost, leaving the gallery pane on screen under a tab bar still reading 论坛; tapping 论坛 then 搜索 left the URL reading `/?tab=forum` while `/search` was the route rendering, and the route cross-fade never ran because the pathname it watches never changed. Cancelling the queued write when the tab bar unmounts does **not** fix it — the timer fires while the other navigation is still committing, so it wins the race anyway; removing the queue does. Next integrates native `pushState`/`replaceState` into its own router and syncs `usePathname` and `useSearchParams`, so the panes and the pill still see the change; nothing is started, so nothing can race, and a tab switch stops costing an RSC round trip. The coalescing window survives as the **push-vs-replace** decision, which is all it was buying: the first change in a burst adds a history entry and the rest rewrite it. `npm run net:tabnav` is the regression check — it taps a tab, opens a thread after a configurable gap, and asserts where back lands.

**Tabs.** Render `TabPanes` / `TabPane`; do not wire this by hand. Panes are marked, never unmounted — `data-tab-pane="name"` plus `data-tab-pane-active` — and stack in one CSS grid cell so both can be on screen at once. Never gate a pane on `hidden` or `{cond && ...}`: the outgoing one has to survive the commit or there is nothing to fade out. Never put a `key` on `[data-tab-panel]`; that deletes the animation's own targets in the commit that starts it. Panes must be written in the same order as the tabs above them — direction is derived from DOM order. On the home page, call `startTabTransition` and `router.push(..., { scroll: false })` in the same tick; screens whose tabs live in local state need nothing beyond `TabPanes`, because the state update and its layout effect are the same commit.

`lean` samples the wave over the blocks *inside* each pane, which requires those blocks to survive the run — so it is **off by default**. A pane that fetches when its tab is selected replaces its whole subtree within a few frames of the switch starting, and GSAP is then animating detached nodes while the visible new ones sit still: measured on the messages tabs as pane height collapsing 1887px → a 288px skeleton inside 70ms, with zero transformed descendants for the whole 500ms run — a switch with no animation at all. Turn `lean` on only for panes that are static once mounted, which today means `/policy` and the home page. **The home tab bar opts in, and it and `/policy` are the only two that do.** `lean` has to be stated at *both* of its call sites — `TabPanes` for the reactive path (a sidebar link, back/forward, the `/forum` redirect) and `startTabTransition`'s fourth argument for the tap path. It is safe there for a specific reason rather than by luck: the forum pane is mounted ahead of the tap on an idle callback, so by the time you press it is holding its rows rather than a skeleton it is about to replace. `/messages` is the counter-example and must stay without it. **"Off by default" has now been true three times and false twice**, so check it rather than trusting it: the option had a default in four places — `playSharedAxis`, `runTabTransition`, `TabPanes` and `useTabPanesOn` — and the first two said `true` while the last two said `false`, and `startTabTransition` passes four arguments and therefore took the parameter default, so the home page's *tab bar* ran the lean while its own comment and this file both said it did not. One option, one default, and a screen that wants it says so at both call sites — which the home page now does. The lean's cost is real and it is not what made the switch drop frames: with a 50-card gallery it is sixteen to forty inline transforms and sixteen to forty promoted compositor layers per frame, against two without it (that figure is why the option existed, and a measurement taken with it *off* once recorded a 60fps median, which is not a measurement of the shipped configuration). What actually cost the frames was the `height` tween described below, running on the ancestor of every one of those promoted cards: a layout pass per frame invalidates all fifty geometries and re-rasters the promoted ones. Remove the layout work and the node count is affordable — do not reach for the node count first.

**Nothing animates the pane box, and the panel's clip is two style writes.** `[data-tab-panel]` used to have its `height` pinned to the outgoing pane's and tweened to the incoming one's over the same 500ms as the slide, so the page's height changed with the motion rather than in one frame at the end of it. Both halves were wrong. The pin was a no-op dressed as a fix: the panel is a grid with both panes in one cell and both hold a box for the run, so its natural height already *is* the taller of the two — all the tween added was a forced shrink to the outgoing height at the start, which is the only reason it needed to clip at all. And what it bought is invisible: the one in-flow element below the panel on every `TabPanes` screen is the shell footer, and `.page-chrome` is `opacity: 0` with `transition: none` for the whole transit, coming back on 400ms decelerate only after `endTransit()` runs in the same `onSettle` as the release — so the footer is never rendered at a pre-settle position. The content above does not move, because the pre-run clamp against the page's *final* scrollable height guarantees the offset survives the shrink.

The clip survives, because the outgoing pane is translated by `leavingOffsetY` — the difference between the two tabs' remembered offsets, which can be most of a screen — and without it that paints over the footer for the length of the run. It is `overflow-y`, not `overflow`: the panel *is* the centred `max-w-*` content column, and clipping both axes cropped the shared axis to the column for the whole 500ms, so panes appeared and vanished at the text's own edge instead of sliding past the information area's. The value is `clip` rather than `hidden` because `overflow-x: visible` beside `overflow-y: hidden` is *computed to `auto`* by the spec — which would quietly turn the panel into a horizontal scroll container — while `visible` beside `clip` is legal and leaves the x axis alone; the horizontal clip stays where it belongs, on the scroller's `[data-axis-running='x']` rule. It is written with the pane flags rather than after the measurements, so the run costs one style invalidation in the pointer handler instead of two.

`watchPaneGrowth` went with the tween: it was a `ResizeObserver` that re-tweened the same `height` for 2.5 seconds after settle, to absorb the case the tween could not — the height is measured at the moment of the switch, when a pane that fetches on selection still holds its skeleton, so the data landing a beat later moved the height again after the motion had visibly finished. A late change is now an ordinary reflow, like every other data arrival in the app, and `restoreAnchor` puts `overflow-anchor` back at settle so a shrink above the viewport is absorbed by scroll anchoring rather than by a tween on a layout property. Skeletons still have to be the right *length* (`PER_PAGE` rows, not eight) — that requirement got stricter, not looser.

**A page gets a back affordance if, and only if, it is not in the sidebar.** There was no rule, and the distribution showed it: `/search` and `/messages` had one despite being one tap away in the drawer, while `/favorites`, `/history`, `/tasks`, `/block-groups`, `/settings`, `/upload` and `/forum/create` — equally top-level — had none, and `/about` and `/policy`, which are reachable only from the footer and therefore need it most, had none either. So it now sits on exactly the routes with no permanent entry point: both profiles, the forum thread, `/about`, `/policy` and the image detail. `/forum` looks like it belongs on that list and does not: `next.config.ts` redirects the bare path to `/?tab=forum`, so `app/forum/page.tsx` never mounts and the route you actually land on is the sidebar's own (`/forum/[id]` and `/forum/create` are unaffected — the redirect matches the exact path). Check for a redirect before deciding a route is deep. Draw it in every state, including loading and error: `/derpi/user/[id]` is the cautionary case — its error branch dropped its own 返回上一页 button on the grounds that "the leading back affordance is already chrome on this route", and that route had never rendered one, so a Derpibooru profile that failed to load was a dead end with no way out but the browser's own button.

**The back affordance is chrome, not content.** `PageBack` portals into `[data-page-back-slot]`, a shim the shell renders as a sibling of the scroller. Rendered inside `[data-page-content]` it was cloned by the route snapshot and translated by the shared axis, so /search → /messages carried it a full window out and back to the pixel it started on. It has no entrance animation on purpose: between two screens that both have one, the node is remounted at the same coordinate looking identical, and a fade would put a flash on every one of those moves to smooth the rarer case where it genuinely appears. The image detail's own back affordance learned that rule the hard way: it exists twice during a flight — `HeroStage` renders a copy that rides along, `PicDetail` renders the real one — and the handoff hides the first with `visibility` while revealing the second. The route seal used to set `opacity: 0` as well, and `IconButton` carries `opacity` in its transition list (for `disabled:disabled-content`), so lifting the seal started a 200ms 0 → 1 ramp on a glyph that was already on screen a frame earlier: one blink per open. The seal is `visibility` + `pointer-events` only now, which is also strictly better for the sealed copy — `opacity: 0` left it focusable; measured across the handoff, the two copies swap at opacity 1 in the same frame. The riding copy takes `DetailBack`'s `passive`, which is what that prop was added for; without it the app had two focusable 返回图片列表 buttons for the length of every flight. **`data-image-detail-reveal` does not reach either copy**, and both used to carry it: the cascade is `overlay.querySelectorAll(...)` and both back buttons render as *siblings* of the overlay; their entrance is the `floatingBack` branch of `buildOverlayAnimations`.

**Routes.** `RouteCrossFade` snapshots the outgoing page in `getSnapshotBeforeUpdate` (the only lifecycle that runs before React mutates the DOM) and fades that inert clone out while `pageIn` fades the new page in. The two overlap because `--animate-page-transition` carries an 80ms delay with a backwards fill.

**The hero owns the same pixels.** Every other transition stands down while a flight is in progress — gate on `getImageHeroRuntime().phase === 'gallery-idle' && !background`. Inside `lib/motion.ts` that gate is the registered `setHeroBusyCheck` predicate (a seam rather than an import, so `lib/motion` does not drag the hero controller into every bundle); the theme wipe and the tab shared axis both consult it, because the first freezes rendering to snapshot a frame the flyer is moving through and the second sets `overflow-x: clip` on the very scroller that hosts the flight layer.

And nothing may leave a residual `transform` on an ancestor of a gallery card: the flight reads `getBoundingClientRect` on press, and only a transform on `[data-image-detail-background-visual]` is compensated for. Always settle with `clearProps`, never `translate3d(0,0,0)`. This is easy to breach from a distance — `pageIn` is a fade *plus a 12px rise* under a `both` fill, and `[data-page-content]` is an ancestor of every card, so for as long as the plain route cross-fade relied on that keyframe to bring the new page in, arriving at `/` from any route outside `ROUTE_CELL` left a ~400ms window in which a tap launched the flyer from a box up to 12px above the thumbnail. The plain branch now drives the entrance itself, on opacity alone.

**The gallery has no blurs to stand down any more, and that is the fix rather than the workaround.** `Badge tone="media"` carried a small backdrop blur and three of those ride every gallery thumbnail, so a 50-card grid held on the order of 150 backdrop-filter regions — each re-sampling what is behind it on every frame the grid moved, and the grid moves in the hero flight, the tab shared axis and every route cross-fade. Measured on presented compositor frames: 28fps with them live, 31fps without. Three CSS rules used to suppress `backdrop-filter` inside the moving subtree per transition; the blur is gone from the tone instead, so the cost is gone everywhere rather than suppressed in three places, and the legibility figure that justifies the plate (4.8:1 for a pure-white subject under black at 55%) never included the blur anyway. The tombstone is in globals.css where the rules were.

**Chrome that appears only on one side of the handoff is chrome that jumps.** The detail's zoom control is `opacity-100` below `sm` and hover-revealed above it, while `HeroStage`'s landing target renders no children at all — so on a phone the frame that hands the picture over conjured a 40dp button into its corner, and the frame that starts a close took it away. `html[data-image-hero-transition] [data-image-detail-zoom]` stands it down for the length of a flight. Anything else added inside the media box needs the same treatment or a twin on the Stage.

**A viewport change mid-flight has to re-aim the container, not just the flyer.** `rebuild()` did only the flyer for a long time, and the window is a pose expressed against the *host's* box — so when the host resized, the same numbers landed somewhere else and the keyframes were still aimed at the old box. On a phone the trigger is the address bar collapsing. Measured at 400px wide with the flight 90ms in and the height changed by 60px: the flyer moved 19px in that frame while the mask jumped **682 → 784**, then converged on the pre-resize host and finished 8px short of the new one; `rebuildContainer` rebases it from wherever it is toward a freshly measured host, and after the fix the same test converges on 791 against a host of 792. Re-reading the host is safe because the overlay is the one node in that chain that never carries a transform — which is also why `createPlane` takes it as the plane's origin rather than the scroller, whose rect *is* the scaled box once a leg is running. A one-frame jump of a full-screen mask is the artefact that reads worse the lower the refresh rate, because it *is* the difference between two adjacent frames — do not reach for the frame rate when that is the complaint.

**A route with no media has to say so.** The handoff waits for a route with a paintable preview *and* a target, and only `DetailImage`/`DetailVideo` set either — so the failure branch could never satisfy it and the wait ran to `HERO_DETAIL_ROUTE_TIMEOUT_MS`: an image that turned out not to exist left the error page sealed and the screen blank for **30 seconds**. `resolvedWithoutMedia` on the registration is the terminal answer that lets the container transform finish and the error surface in its place; the closing path already fell back to a plain history collapse when `route.target` is null.

**Measure presented frames, not `requestAnimationFrame` gaps.** *The figures in this paragraph predate the curve, bow and single-clock pass and have not been reproduced since; re-measure before quoting them.* A composited animation keeps running while the main thread is busy, so rAF intervals report main-thread cadence and say nothing about what the display got — the two disagreed by a factor of two here. A CDP screencast (`Page.startScreencast`, `everyNthFrame: 1`) yields one event per presented frame, and a full-viewport composited transform on an otherwise idle page is the control that proves the harness can reach 60. What that showed: the flight presents at **36fps** against 60 idle, and **no single animated track is responsible** — cancelling the flyer's corner morph, the container mask, the content fit and every skeleton shimmer, together, was worth about one frame per second. The cost is the detail route's first render and first paint landing inside the flight window (~190ms of React work in a production build), spread evenly across it; the blur rule above was the only change that moved the number (27 → 36).

**The ~190ms attribution has now been re-measured and it does not hold — do not act on it.** Measured on a production build against a 50-card gallery, four opens, `Performance.getMetrics` deltas between the tap and `opening.landed` (medians): `ScriptDuration` **50ms**, `RecalcStyleDuration` **54ms**, `LayoutDuration` **3.6ms**, `TaskDuration` **220ms**, over a tap-to-landed wall time of **384ms**; between `landed` and `detail-idle` the same counters read 3ms / 11ms / 0.4ms. So the route's commit *is* inside the window, but it is a fifth of the window's cost rather than three quarters of it — style recalculation is the same size, and `TaskDuration` exceeds script plus style plus layout by more than double, which puts the remainder in paint and raster. Two consequences. **Deferring the route's chrome to `opening.landed` is not worth it**: it would move part of 50ms out of a window that is spending 220ms, in exchange for the picture landing and the metadata arriving as two separate events — the failure this file names repeatedly — plus a real risk to the header-height contract the handoff depends on; it was planned and then dropped on this measurement. **And the leg is not the whole flight**: 250ms of `HERO_DURATIONS` against 384ms tap-to-landed means roughly 130ms is spent before the flyer moves, which is where `frameCache`'s press-path warming and the cache count now aim.

One caveat on the harness: a headless *and* a headed Chromium on this machine both cap the presented-frame control at 46fps, so presented frame rate could not be measured here at all — only main-thread occupancy, which is machine-independent. The 36fps figure above still needs a device with a real compositor to re-confirm.

## State layers

Hover/focus/press are the `state-layer` utility — a tinted overlay at the M3 alpha, painted from the element's own `color`. Not `hover:bg-primary/90`, which must be written twice (light + dark) and drifts.

The four alphas are M3's, from `StateTokens`: **hover .08, focus .10, pressed .10, dragged .16**. Focus and pressed are deliberately *equal* — the focus ring is what distinguishes them, not the tint weight.

**A ripple is that same layer spreading from the point of contact**, so it holds one opacity for its whole life and then fades. Its value lives on `.ripple` in globals.css and reads the pressed token; `spawnRipple` drives only the scale and the fade-out.

**Its fade is one keyframe, and that is a rule rather than a shorthand.** A WAAPI keyframe list is *absolute*, where `gsap.to(el, { opacity: 0 })` starts from whatever the element currently is — `[{ opacity: 1 }, { opacity: 0 }]` does not mean "fade out from here". Written that way, with the fade's 300ms delay and no `backwards` fill, the wave jumped from the token's 0.10 to **1** at the instant the animation became in-effect and then fell: a full-strength `currentColor` flash at the end of every press. A single keyframe at offset 1 takes an **implicit start from the underlying value**, which is the token. The test for the next conversion: this is the only animated element whose **CSS sets a non-default opacity** and the only fade with a **delay and no `backwards` fill** — `Toast`, `Reveal`, `Popover` and the hero's retire fade all start from a CSS opacity of 1. `npm run perf:ripple` samples it per frame.

A **selection control needs its own state layer** and cannot use this utility. `Checkbox`, `Radio` and `ToggleSwitch` each paint a real 40dp circle instead: the utility keys on the element's own `:hover` and covers only that element, while what has to light up on a checkbox is a circle more than twice the width of the 18dp box, driven by a hover anywhere on its label.

**A roving cursor is `state-layer-active`.** `state-layer` keys on the element's own `:hover`/`:focus-visible`/`:active` and misses the one state a roving cursor creates — a row that is the keyboard's current item without being focused itself (focus is on the control, `aria-activedescendant` names the row). `state-layer-active` paints the same layer unconditionally at the focus weight, which is what the state is; `Select`'s listbox and /search's autocomplete both have exactly that cursor. The cursor is not the *selection*: a chosen value takes the container pair `secondary-container` — what "selected" means everywhere in this app (the sidebar's route, a chosen `Select` option, a selected `Chip`, the current contact). A cursor row must not take `primary-container`, which says "committed" about a row the user has not committed to.

## Layout

Spacing is the 4dp grid (Tailwind's default scale). Half-steps (`gap-1.5`, `py-0.5`) are fine for dense chrome; arbitrary values are not.

**The page column is decided by what is in it, and there are two answers.**

| Content | Width |
| --- | --- |
| A list of rows, or an article | `max-w-4xl` |
| A masonry / image grid | `max-w-7xl` |

Ten screens are lists — forum, messages, history, tasks, policy, about, settings, block-groups and both forum sub-pages — and they all sit at `4xl`. Three are grids and sit at `7xl`. Nothing else is a page column. The trap is a screen that holds both: the home page's two tabs share one panel, and a pane whose content is a list takes the list width regardless of what its neighbour needs.

A form is neither, and may be narrower — `/upload` is `2xl` on purpose (a 560px field column is easier to fill in than a 900px one); the admin console is `6xl` because it is data tables. `5xl` is the fifth and last: a **media-led detail column** — both profile pages and the image detail, where a banner or a picture is the subject and the text sits under it. It is not a general-purpose middle width; a screen that is a list still takes `4xl` even if it happens to be 1000px of list.

**A block inside a column is not a column**, and this is where a sixth width comes from. A block takes the width of whatever it *is*, and the answer is one of the five; if it is not, that is the signal the block is being sized by eye. (/search is a `7xl` page whose field and advanced-filter panel are a *form*, so both take the form column's `2xl` — not a `3xl` that is on no list.)

**A page has one gutter and the shell already draws it.** `[data-page-content]` is `p-4 sm:p-6`, so a screen that wraps its sections in another `p-6` insets them 40px on a phone and 48px on a desktop — invisible in review because nothing looks broken, the column is just narrower than every other screen's. A section is a heading and the block under it; the block's own tone (`.m3-row`, `Card`) is what makes it a surface.

**A structural divider is drawn in every state.** If a rule separates two regions of the drawer, it does not blink on and off with the contents of one of them — signed out the top block is still a block, it just says 未登录. (The rule *inside* the nav, between 我的 and the settings group, is a different thing and stays conditional: signed out there is no group above it.)

**A row has one reading order.** Label at the leading edge, control at the trailing edge — that is what M3's list is. A switch dropped into such a list *without* `layout="row"` renders control-then-label and leaves the right-hand half of the row empty.

### The control-height scale

**Two rules, and the second one is the one that gets forgotten.** The step set is 32 / 40 / 56 with nothing between — every step is a container height some token actually names, which is the whole point of writing it down (eight heights were once in use because nothing stated one). But a step set alone does not decide anything — that is how a 56dp dropdown ended up in a row whose other three controls were 32dp switches.

**Rule 1 — the touch floor is a *touch* floor.** M3's 48dp is WCAG 2.5.5's AAA figure and it answers a finger. A pointer's floor is WCAG 2.2 **SC 2.5.8 — 24×24 CSS px**, at AA. `--touch-floor` in globals.css is 48px and drops to 24px under `@media (pointer: fine)`; `touch-target` (a hit area, no layout change) and `touch-size` (a real `min-height`/`min-width`, for a control carrying `data-ripple`, which clips a pseudo-element away) both read it. Applying 48 to a mouse is not a free margin: `state-layer` keys on `:hover`, so a region wider than the paint lights the control up while the cursor is visibly outside it, and neighbours in a dense row start answering for each other. Two `@custom-variant`s, `pointer-coarse:` and `pointer-fine:`, express the axis at a call site; `MEDIA.pointerCoarse` / `MEDIA.pointerFine` are the JS twins so the two cannot drift.

Do not reach for `touch-target` on an inline target inside prose — SC 2.5.8 exempts one, and a 48px band on a line in a 28px-leading paragraph steals clicks from the lines above and below.

**Rule 2 — a control's step is decided by its enclosure, not by its type.** This is what "coordinated" means, and it is checkable: look at what the control's neighbours are, not at what the control is called.

| Enclosure | Step | Text |
| --- | ---- | ---- |
| A form column — a slot you fill in | 56 | `body-l` |
| The chat composer's field | 56 | `body-l` |
| A control *beside* a field (the composer's emoji and send) | 40 | — |
| A filter bar, an admin surface, or inside an `.m3-row` | 40 | `body-m` |
| An app-bar action | 48 | — |
| Dense chrome: a table row's actions, a chip's dismiss cross | 32 | `label-l` |

The composer row is the worked example of the middle two: its accessories are 40 — what the field itself says a control beside it should be, the trailing-slot inset in globals.css being `(56 − 40) / 2`, the field's own arithmetic for centring an accessory. Matching the field at 56 produced an 88px band for one line of text. The field stays 56 because that is the part you type into, and the row's padding is where the height was actually spent (`p-2`, so 72px).

**The app bar is the one place the pointer axis is switched off**, with one declaration: the `<header>` sets `--touch-floor: 48px`, so every `touch-size` inside it lands at 48 whatever the pointer is. Those five controls are the app's most-used and sit alone on a 64dp coloured band; at 40dp they read as small glyphs rather than the bar's chrome.

**A row is a different kind of object from a control** (M3 separates them too — `ListTokens` has its own heights). Row heights take the density step:

| Row | pointer | touch |
| --- | ---- | ---- |
| Menu row, `Select` option row | 40 | 48 |
| Drawer navigation row | 48 | 56 |
| Two-line list item (`/messages`' contact row) | 72 | 72 |
| The drawer's account block | 64 | 64 |

The contact row is `ItemTwoLineContainerHeight` at **every** density; the density step was tried on it and taken back out, because the collapsed contact rail's width is *derived* from that height (row height + the list's 8px inset either side, which makes the row square so the 40dp portrait centres itself) — a row three other numbers depend on is the wrong place to spend a step.

The account block is **64 with `ListTokens`' own 40dp avatar**, deliberately *not* a two-line list item even though it has two lines: it is the drawer's header, above thirteen 48dp links. 64 is one step down from the 72 list-row height with the spec's avatar intact, leaving 12px above and below the text stack — exactly M3's own item padding. 56 with a 32dp avatar made the one portrait in the shell the smallest one in the app (32 is the *dense* step, for a chat turn). Its name is `title-s`, matching the `label-l` size of every link below it.

**The page-content wrapper is a flex column, and `[&>*]:w-full` goes with it.** The column exists so `StatusView`'s `fill` can be `flex-1`. The `w-full` is not decoration: a flex item in a column is stretched on the cross axis by `align-items: stretch` **unless it has an auto margin there** — an auto cross-axis margin absorbs the free space and disables the stretch. Every page root in this app is `mx-auto max-w-*`, so without it all of them fall back to shrink-to-fit. If you touch that wrapper, measure a **width** on a tab switch, not just a height.

So **48 is still not a control size** — no field, button or icon-button token in the spec is 48. It is the touch floor and the pointer-side drawer row.

| Step | What takes it |
| ---- | --- |
| 32 | `Button size="xs"`, `IconButton size="sm"`, `Chip` |
| 40 | the default: `Button`, `IconButton`, `Select size="sm"`, `Input size="sm"`, a menu row, `Pagination`, a control beside a field |
| 48 | a tab (`PrimaryNavigationTabTokens.ContainerHeight`), an app-bar action, the drawer row under a pointer, and `--touch-floor` under a finger |
| 56 | `Button size="lg"`, a labelled or unlabelled `Input`, the search bar, `Select`, `ColorSwatch`, `CodeInput`, the chat composer's field, the drawer row under a finger |
| 64 | the top app bar (`AppBarSmallTokens.ContainerHeight`, at every density — the band is not repeated chrome, so the density rule does not apply to it); the drawer's account block |
| 72 | a two-line list item (`ListTokens.ItemTwoLineContainerHeight`), at every density |

**A 40dp field is this app's own step, not the spec's** (`OutlinedTextFieldTokens.ContainerHeight` is 56 and M3 offers nothing else). A field in a filter bar or a list row is *chrome*: its neighbours are a 40dp dropdown and a 32dp chip, and matching them matters more than matching a token written for a phone form. Two fences keep it from spreading — it is unlabelled-only (the labelled field's notch geometry is all derived from 56dp) and it takes no `trailing` slot, since that inset is `(56 − 40) / 2` and a 40dp box has no room for a 40dp control. `SearchInput` bakes it in rather than offering it, because every call site of that component is a filter.

Three figures went: **28** is below M3's smallest button; **36** sat between extra-small 32 and small 40, on no scale; **44** is Apple's touch figure rather than Material's, this app's own invention.

One consequence: **the two text fields are the same height.** They differ in exactly one thing, the boundary, which is what the Input section always claimed (48 was never a number the spec offered). The dense step is a different axis — the enclosure — and applies to neither of them in a form.

`Button size="sm"` is gone rather than retuned: at 40dp it was `md`, and two names for one box is the problem, not the fix. Its 32 call sites moved to `xs`, because every one had been chosen to be *smaller* than the default and that intent maps to M3's extra-small.

Button padding is **16 / 16 / 24** by size and the icon gap is 8 at every size — `IconLabelSpace` does not vary in the token set, which is why a 32dp button and a 56dp one put the same air between glyph and label. `ButtonXSmallTokens.LeadingSpace` is 16dp, the same as small's; only the medium step widens.

The **glyph size belongs to the button**, not to the call site: `IconSize` is 20 at extra-small and small, 24 at medium, and both `Button` and `IconButton` size their own icon slot.

**A press does not morph the corner**, and the spec does specify that it should (`ButtonSmallTokens.PressedContainerShape` is `CornerSmall` (8dp), `ButtonMediumTokens`' is `CornerMedium` (12dp)) — both were implemented and came out anyway; they were animated `border-radius` only, deliberately not a transform. On a pill the corner has nowhere to travel *to* that reads as feedback. Press feedback is the state layer and the ripple, which is what every other control in the app uses. A **selected** icon button is still a rounded square rather than a circle, per `SelectedContainerShapeRound` — that is a state, not a press.

### The icon-size scale

**18 / 20 / 24 / 36 / 48**, through `ICON` in `lib/icons.ts` — `size={ICON.standard}`, never a number.

| Name | dp | What takes it |
| --- | -- | --- |
| `dense` | 18 | inside a chip, or beside a line of metadata |
| `control` | 20 | inside a button or a dense icon button |
| `standard` | 24 | the default: a list row, a nav row, an app-bar action, a field adornment |
| `large` | 36 | a large FAB's glyph, or one prominent affordance |
| `display` | 48 | an illustration: the glyph over an empty state or an error |

Below 18 a Material Symbol's strokes stop resolving and it reads as a smudge rather than a shape. **`Badge`'s glyph is the one thing below that floor, and it is the primitive's own number rather than a call site's**: 14 at `sm`, 16 at `md`. The floor is about a glyph that is a control's *only* content and has to be aimed at; a badge's glyph is inside a 20 or 24px box, paired with a digit or a word at 11–12px, and read as part of that phrase. It is also measurable: the badge's line box is 16px, so an 18dp glyph makes a badge with an icon 2px taller than one without.

`Avatar` and `SkeletonCircle` are **not** on this scale: they take a box size, not a glyph size. An avatar's steps are 32 / 40 / 48 / 56, with 40 the default because that is `ListTokens`' leading-avatar size.

### The slider does not look like the old slider

`Slider`'s geometry is M3 Expressive's (`SliderTokens` v2_3_5) and the instinct on seeing it is to "fix" it back: the track is **16dp** tall, not 4, and the handle is a **4dp-wide vertical pill 44dp tall**, not a 20dp circle. Two details carry most of the character and both look like bugs if you do not know they are the spec:

- **The handle sits in a 6dp gap.** The track is visibly *cut* on both sides of it rather than passing behind it — that gap is what makes a thick track read as two segments with a position between them instead of a progress bar with a lump on it.
- **The handle narrows on press**, 4dp to 2dp. Not grows. M3 gives no control size feedback that *adds* mass on press, and a handle that swells under the finger hides the value it is reporting.

Nothing about the position is transitioned, also deliberately: a slider reports where the input is, and a transition on the fill or the handle puts the mark behind the finger for the whole drag. The only animated property is the handle's width, which is a state rather than a position.

Touch targets: use a primitive and the question does not arise. Anything with a custom box under `--touch-floor` — 48px under a coarse pointer (M3's minimum and WCAG 2.5.5's AAA figure), 24px under a fine one (WCAG 2.2 SC 2.5.8 at AA) — needs `touch-target`, which expands the _hit area_ with a centred pseudo-element without changing the layout. It cannot be combined with `data-ripple`, which clips its overflow; those controls take `touch-size` instead, which raises the box itself to the same floor. See the control-height section for the two rules. `Chip` at 32dp and `Button size="xs"` are documented exceptions, on the same rule M3 states as "the touch target may extend beyond the component bounds".

**A chip has one height, 32dp.** `AssistChipTokens.ContainerHeight` and `FilterChipTokens.ContainerHeight` are both 32 and the token set offers no second figure — there is nothing for a `size` prop to choose between.

**A drawer row's padding is asymmetric, and that is the spec's.** `NavigationDrawer.kt`'s item is `padding(start = 16.dp, end = 24.dp)` — the extra 8dp is there because a trailing element (an unread count) needs more air than a leading one. The asymmetry holds at both densities, because it is about the badge rather than the height. The row is a pill (`ActiveIndicatorShape`) at 48dp under a pointer and `ActiveIndicatorHeight`'s 56 under a finger, its icon is 24dp, the gaps either side of the label are 12dp, and the item is inset 12dp from the drawer's own edge (`NavigationDrawerItemDefaults.ItemPadding`).

The account block above those rows is **not** one of them. It is a two-line list item — avatar, name, supporting line — so it takes `ListTokens`: a 16dp corner (`ItemSelectedContainerShape`), 16dp leading, a 40dp avatar, and 64dp / 72dp per pointer against `ItemTwoLineContainerHeight`'s 72. It must not wear the rows' pill shape, which is how those rows mean "you are here". Its avatar still starts on the same 28dp leading column as every nav icon — the part that has to agree.

The **app bar does not join that column**: it is `px-4 sm:px-26` — 16px on a phone, 104px from `sm` up — breathing room around the brand rather than a derivation. The bar spans both the drawer and the content area and belongs to neither, so aligning it to either one's grid is a false precision.

The name is `title-m` rather than `ListTokens.ItemLabelTextFont`'s `body-large`, and that is a stated divergence: same 16px, at `TitleMedium`'s weight and its 1.5 leading instead of the prose role's 1.75. A name in a control is a label, and the 4px that returns is what lets the 64dp box keep M3's own vertical padding. **The 72 has two consumers** — this block and `/messages`' contact row — and they move together; moving one alone is a divergence with no scale behind it. The contact rail's collapsed width is derived from that row (row height + the list's 8px inset either side, so the row comes out square and the portrait centres itself), so it moves too: 80px / 88px.

`Button` ships `responsiveLabel` to collapse to a square icon button below `sm` — use it in any row that would otherwise overflow on a phone.

No press-shrink. M3 gives no size feedback on press; the state layer and the ripple carry it. `active:scale` utilities is not used anywhere and should not come back — besides being off-spec, a control mid-transform corrupts the rect the hero flight reads on press. Two named exceptions, both from a component's own token set rather than from taste: the **switch handle** grows 24 → 28dp on press (`md-switch`'s `PressedHandleWidth`) and the **slider handle** narrows 4 → 2dp. A handle is the one control whose whole job is to be gripped, and M3 gives it a grip cue; nothing else gets one.

## Scrolling

`<body>` is `overflow: hidden`. The page scroller is `<main class="app-scroller">` in `components/AppLayout.tsx`, reachable via `getAppScroller()`. `window.scrollTo` is a no-op — use `scrollAppToTop` / `scrollAppToElement`.

Every scroll container carries `.main-scrollbar` (page-level, reserves its gutter), `.popover-scrollbar` (overlays, no gutter) or `.scrollbar-hide` (a horizontally scrolled chip row or tab rail, where a visible bar is chrome the row cannot afford). Never leave one unstyled: the browser default is a different width and colour, and the app then appears to change its scrollbar as you navigate.

Never give a child of the scroller `min-h-dvh` — the scroller is already shorter than the viewport (header + margins), so it forces a permanent scrollbar. Use `min-h-full`.

### Vertical position has one owner

`lib/scrollMemory.ts`, mounted once in `AppLayout` as `<RouteScrollMemory>`, and **every `router.push`/`replace` and every `<Link>` in the app passes `scroll: false`**. That is not a per-call-site decision; a new one that forgets it is a bug, and the flag is only a suppression — the position is written explicitly.

Four situations, and the last two are one rule:

| a new pathname | jump to 0. A new page starts at its top |
| back / forward | restore what that history entry had |
| a page turn (`?page=`) | `Pagination` owns it, and it **positions rather than travels** — see below |
| a tab switch (`?tab=`) | `startTabTransition` / `useTabPanesOn` own it |

The owner depends on `pathname` alone, so it does not run for a search-only change at all — which is stronger than testing for one. The image detail stays the hero subsystem's, guarded both by `heroOwnsScreen()` and by a `/pic/` test for a cold load.

**Next's own handler is off rather than merely overridden.** It does reach the app scroller (`layout-router.js` falls through to `domNode.scrollIntoView()`), but it is the one writer that cannot consult `heroOwnsScreen()`, it tests the segment's top against `document.documentElement.clientHeight` rather than the scroller's box, `block: 'start'` lands on the segment's top edge rather than on `scrollTop === 0`, it fires after the commit and so races `RouteCrossFade`, and it ends with `domNode.focus()`, moving focus to the route segment. `scroll: false` is also not a hard opt-out: `completeSoftNavigation` neutralises the *current* navigation's targets while leaving an earlier unconsumed `scrollRef` live.

**Offsets are keyed per history entry, not per URL** — `window.navigation.currentEntry.key`, with a URL fallback whose one observable difference is documented at the call site. Do not merge a key into `history.state`: the App Router rebuilds that object on every commit and drops anything it does not own, which `lib/hero/history.ts` already spends three mechanisms working around.

**A page turn glides on the distance law, like every other programmatic scroll, and there is no fixed-length escape hatch.** `scrollAppToElement` scales its tween with the square root of the travel (360–1100ms), so the *rate* is non-linear in the distance: a short hop is brisk, a long one takes its time. Hold the duration still and the speed rises with however far you happened to be scrolled.

**`npm run perf:pageturn` asserts the predicate, not the mechanism: no in-view card may be blank during a page turn, and none may be hidden after a cold load has painted it.** The lesson behind it, learned over three passes: when a transition reads wrong, check what is on screen during it before changing how long it lasts — the glide was blamed for blank travel that `FadeInImage`'s dropped placeholder caused, and fixing the placeholder is what made the honest duration affordable. Reaching for the duration or the easing is the mistake the report invites; both times the fault was which bitmap was on screen. Standing rules from the same stretch:

- `<StaggerGrid>` is a **sibling after** the grid it targets (a parent's ref attaches only after its children's layout effects run, so nesting it meant the mount pass found no root), and the hook **latches once per mount**: a page turn is a content replacement inside a grid that never left the screen — the motion carrying it is the glide, and a second entrance on top is the 动画重叠 failure. A breakpoint reflow no longer replays it either: a resize is not an arrival.
- **The cascade must not play on a cold load at all.** `/` renders its first feed page on the server, so on a cold load the cards are painted before the engine arrives and the cascade would park fifty visible cards at `autoAlpha: 0`. `StaggerGrid` decides **once, at mount**, on whether the engine is already resident: a client navigation or a warm second visit cascades; a cold load does not, and nothing subscribes to the load to change its mind. `warmMotion()` still fetches the engine on an idle callback for every other consumer.
- `FadeInImage`'s placeholder **cross-fades rather than unmounting**: the skeleton fades out on the image's own clock, released one `MOTION_SPEED_SCALE.slow`-scaled duration later — the wall-clock rule, because a timer written against the unscaled figure fires inside the motion it is meant to outlast.
- `runScroll` takes no length argument: a parameter with no call sites is one the next screen reaches for.

**The server cannot see which image line this device is on.** `resolveImageLine()` reads `localStorage` and the fetched route policy; in Node it falls back to the defaults and emits the proxy line for everybody — a visitor who had turned the image proxy off got a hydration mismatch on every card, and React does not patch mismatched attributes, so their preference was ignored for the whole first screen. `COOKIE_KEYS.imageLine` is the answer, in the same shape as `browsing`: `lib/route.ts` mirrors its own resolution into the cookie on every change, and `app/layout.tsx` hands it down through `ImageLineProvider` so the client's first render asks the same question. `createInitialAttempt` takes the line as an argument for that first attempt only; the failover ladder still reads the live answer, so a stale cookie costs one corrected attempt. A first visit has no cookie and uses the defaults on both sides, and the cookie written during that load makes every load after it exact.

**The detail's picture is served as the CDN made it, not re-encoded.** `next.config.ts` sets `images.unoptimized` in development, so dev has always shown the untouched file; production put it through `/_next/image`, and at identical pixel dimensions (the optimizer clamps to the source) one real picture went 373,365 bytes → 170,826 at `q=82` (46%), 217,511 at `q=88` (58%) — less than half the bytes for the same resolution, plus **3–4 seconds of this server's CPU** per variant. `shouldBypassImageOptimization` covers Derpibooru's own derivatives now — `large`, `medium`, `small`, the thumbs — matched on the *raw* URL, since the image line may have wrapped it in a proxy's `?url=`. They are already size-appropriate files off a CDN; it gives up bytes (373KB against 171KB for an opened picture) and that is the right way round: the picture *is* the content here, and it now arrives in one hop. Gallery cards keep the optimizer, where a 308px card from a 1280px source is a real saving.

**The flight paints a `<canvas>` blitted from the gallery card's bitmap, and that — not the detail's `<img>` — is what flight sharpness is a property of.** `launchFlight` hands `createHeroFlight` the snapshot's `previewFrame`, which `captureHeroFrame` draws from the card's own `<img>`; `[data-image-detail-layer]` — preview and final alike — is the surface *underneath* it. In production the card is correctly sized *for a card* (304px from `/_next/image`) and the 944px flight box blows it up **3.11x**; in development the card holds 800px raw (`images.unoptimized`) and the same box is **1.18x**. So `warmedDetailFrames` (`lib/hero/media.ts`) rasterises a detail-sized source on the intent ladder and `prepareImageHero` hands **that** canvas to the flight.

**And the rung it warms is `medium`, not the `large` the detail displays.** Priced on the probe's shaped CDN at 10Mbps, `medium` is 110KB arriving in **132ms** where `large` is 370KB arriving in **344ms**; with the 70ms intent delay and a decode on top, large needs over 430ms of hover before the flight can use it and medium needs about 230ms. The flight warms the *smallest rung that is sharp enough*: 800px against the 944px well is **1.18x** — development's own figure. Those bytes are not speculative waste: the same URL becomes `previewSrc`, so the detail's preview layer paints it too (where it used to paint the card's 384px variant at 2.46x). One fetch, two consumers. The picture the user then looks at is still `large`, fetched by the final layer as always, landing at 0.74x. The `<img>` is dropped once the canvas exists, because retaining 24 decoded 1280x853 bitmaps is ~105MB; the canvas is already the unit `heroFrameCache` budgets in pixels. Animated sources are excluded rather than captured — a fresh decode is at frame 0, and taking off on a frame the user was not looking at is a visible jump.

**The cold tap is still the floor, and it is inherent.** `onPointerDown` starts the warm, which is the earliest honest moment (a touch screen has no hover, and pointerdown-to-click is ≥100ms) — but a tap with no hover cannot paint bytes that have not arrived, so frame 0 is the card's bitmap and the leg runs at 3.11x before the final layer lands sharp at ~430ms. Closing that would mean enlarging every card: measured through the optimizer at q=75 on three real pictures, the card's variant costs 62KB and the next step up 103KB — **+2MB on a fifty-card page** to improve the first 250ms of the few cards anyone opens. Not taken.

Probe rules that came out of that search, all load-bearing: measure image work at **DPR 2** — `npm run perf:sharpness` takes `PROBE_DPR`, and a fix that is perfect at DPR 1 can be inert on a phone. `scripts/probeHeroSharpness.mjs` must sample the flight's own canvas (`.image-hero-flyer-image`), not `[data-image-detail-layer]`, which answers "what will this look like once it has landed" and never "what does the flight look like"; `npm run perf:sharpness:warm` **asserts** the flight's canvas is bigger than the card's bitmap. `--throttle=<mbps>` shapes the faked CDN by delaying each fulfillment in proportion to the rung's weight and **must not be `Network.emulateNetworkConditions`** — a CDP-fulfilled response is synthesised inside the browser and is not subject to it, so it reports `transferSize: 0` and measures localhost; the rungs are padded to their real weights with a tEXt chunk. The probe's `--fake-cdn` answers the **browser's** derpicdn requests with a locally generated checkerboard PNG (checkerboard, because a flat image is sharp at every scale); it intercepts CDP, which cannot reach the Next server, so `/_next/image` still fetches through the real optimizer and the card-versus-flight comparison stays honest. The assertion is skipped without that flag, so a plain `npm run perf:sharpness` remains a report.

**Every pager needs a `[data-pagination-anchor]`, and it has to be an *ancestor* of the pager.** `Pagination` finds it with `closest()`, which fails silently: a marker on the list with the pager as its *sibling* is one the pager cannot see, and the turn falls back exactly as if there were none. Several pagers may share one enclosing anchor (a profile's four tabs use the box that holds the tab row and the panes), and a pager handed to a list component as `children` is inside its anchor by construction. A pager inside a dialog needs a *scroller* as well: the box with `overflow-y: auto` carries `data-app-scroll-container`, which `Pagination` also finds with `closest()` — `Modal`'s body has it, `Sheet`'s body has it, and so does the one nested `max-h-[60vh]` list in the admin console, which matters because the dialog's body is an ancestor of it and would otherwise be found first.

**The per-tab memory is keyed on the panel element**, not on the tab name. Tab values are unique app-wide, but the collision is between *instances of one screen*: `posts`/`uploads`/`faves`/`comments` carried an offset from one profile to the next. A `WeakMap` on the panel also answers "when is it cleared", since `[data-page-content]` is keyed on the pathname.

**A tab switch only moves the scroller when the panel is the page.** The memory is what makes leaving the gallery at row 20 and coming back land on row 20 — but applying it on a screen with a header above the panel drags that header, which reads as a jump. So the decision is a property of the *screen*, measured rather than assumed — `panelTop`, the shared chrome above `[data-tab-panel]`, is **24px on the home route** (the page gutter; the tab pill is fixed chrome outside the scroller), **209px on /policy** (page header and tab row) and **697px on a profile** (banner, name, level bar, tab row). Above `TAB_SHARED_CHROME_PX`, the app bar's own 64dp, the scroller is left alone and only `finalMax`'s clamp can move it. Per-screen rather than per-scroll-position on purpose: a rule that fires depending on how far you happen to have scrolled is not one a user can learn.

**And it positions under the 关闭 tier.** A scroll position is state, not decoration; the preference asks for less movement, not for less positioning. `applyInstantTabScroll` runs after the commit, where the arriving pane is the only one with a box and the clamp is the browser's real maximum rather than a prediction — and it applies the same `panelTop` test, which is the half that must not be dropped: without it, turning the preference on is what makes a profile's 697px jump reachable again. What it can restore is bounded by who *records*: the origin's offset is written by every animated run and by the tab bar's own tap path, so under the preference a screen reached through the tab bar remembers both directions, while a tab reached only by a sidebar link or the back button has nothing recorded. A future screen with a low `panelTop` and no tap path would need a pre-commit hook the reactive path does not have.

**A tab with no remembered offset opens at its own top — on a screen whose panel is the page.** "Stay exactly where you are" is right on a screen with shared chrome and is the same bug wearing the other face where the panel *is* the page: measured at 1440×900, leave the gallery at 1500, switch to a forum whose whole content is 1708 against a 768px scrollport, and `finalMax` is 1160 — the carried-over offset clamps to exactly the maximum and **the forum opens on its last row**. Both paths take the `?? 0` (`applyTabScroll` and `applyInstantTabScroll`), and the memory is untouched: switching back still lands on 1500. `node scripts/netAuditTabHeight.mjs` asserts all three numbers. It also checks the transit: during the run the panel measures `max(H_out, H_in)`, so a tall gallery leaves ~2000px under a short forum for 500ms — deliberate (see `runTabTransition`), invisible because the footer is held at `opacity: 0` for the transit and the offset is clamped against the *settled* height.

## `useGSAP`

`@gsap/react`'s `useGSAP` does **not** run your cleanup on a dependency change unless you pass `revertOnUpdate: true`. Without it, listeners, `Observer`s and `ScrollTrigger`s accumulate on every dep change. Pass it, or keep the changing value in a ref and shrink the dependency list.

## Offline, and the service worker

`public/sw.js` is hand-written; there is no Workbox. Its job is narrow on purpose: make the static assets instant on a repeat visit, and give an offline hard refresh somewhere to land. It is **not** an offline-first shell — `lib/resource.ts` already holds a TTL'd cache with SWR, revalidation on tab return and real cancellation, and a second cache underneath it, one that cannot see request identity or staleness or the route policy, would fight it.

Rule zero is `if (request.method !== 'GET') return;` — a bare `return`, not `respondWith`, so every mutation goes through the browser's own stack untouched.

| | |
| --- | --- |
| Documents / navigations | network only; the `catch` serves `/offline.html` |
| `/_next/static/*` | cache-first, **network fallback** |
| `/_next/image*` | stale-while-revalidate, LRU 120, cache name **unversioned** |
| `/api.php`, `/relay`, `/search-api/*`, RSC payloads | never touched |
| `derpicdn.net`, `wsrv.nl`, `147052.xyz` | never touched |

Each "never" is a bug avoided rather than a preference:

- **Documents** carry three request-scoped things since the SSR pass — the first page of the feed on a 2-minute TTL, the inlined request-line policy (whose whole purpose is to be in force *before* the session's first request), and the `<html>` attributes from the appearance cookies. A cached document paints the previous visitor's theme, which is exactly the flash `COOKIE_KEYS` exists to prevent. It is also the update mechanism: the document always names the current build's chunk URLs, and `/_next/static/*`'s network fallback is what lets a client still running an old document fetch a chunk this cache has never seen.
- **`/api.php`** carries the PHP session, and its route handler exists solely to rewrite `Set-Cookie` so that session survives plain HTTP. A cached body plus a cached `Set-Cookie` on a shared device hands one user's session to the next.
- **`/relay`** validates protocol, host, port, credentials **and path**, and this file states that the path check *is* the security of the endpoint. A cache serves an old validated response for a URL the current policy may no longer allow, and it echoes the upstream `content-type`.
- **The three image proxies** are cross-origin with no `crossorigin` on the `<img>`, so their responses are **opaque** — a 500 is indistinguishable from a 200, the same blindness the image *probes* hit. One cached failure pins a dead line for the session and defeats `lib/imageLoader.ts`'s degrade ladder. Opaque entries also bill ~7 MB each against the origin quota and a gallery page holds fifty. `/_next/image` already covers the gallery.

**No `skipWaiting()` and no `clients.claim()`**, and that is this app rather than caution in general: it is a long-lived document with a module-scope resource store and a live hero session, and it now lazy-loads chunks. Swapping the worker mid-session means the page's loaded chunks are build N while the ones it is about to `import()` come from build N+1's cache — a `ChunkLoadError`. A `message` listener is there for a future "new version ready" prompt; there is no UI for it.

**`/offline.html` is a static file, not a route.** The worker serves the cached response at the URL the user asked for, so a fallback served under a foreign URL cannot be a routed page — the `app/offline/page.tsx` version was hydrated against `location.pathname === '/tasks'` and re-rendered as an app shell full of 加载失败. It carries no script, no font and no request, and its three colours are the default palette's spelled out — a knowing divergence from the token rule, because this document is outside the design system's reach by construction.

`experimental.useOffline` is the other half and they do not overlap: it keeps a soft navigation, prefetch, RSC fetch or Server Action **pending and retrying** through a drop, which the worker cannot do; the worker covers the one case no retry reaches, a hard refresh with nothing on the wire. `<OfflineBanner>` is what tells the user why something is taking a while — without it, "pending" and "broken" look the same.

`app/manifest.ts` omits **`theme_color`** deliberately: the app has eleven palettes, so any single value is wrong for nine, and `app/layout.tsx` already renders that tag from the palette cookie — the same reason Next's own `viewport.themeColor` export was removed. `background_color` paints only the installed app's splash. `npm run icons` produces 192px, 512px and maskable 512px icons from the existing square mark; the maskable artwork fits wholly inside the 80%-diameter safe circle. Keep the source mark and generator together when changing the installed-app artwork.

Registration is `components/ServiceWorker.tsx`, on an idle callback, with a `?v=<buildId>` query (a file in `public/` cannot read a build-time variable, and a changing script URL is what makes the browser find a new worker) and `updateViaCache: 'none'` (without it the browser may satisfy its own update check from the HTTP cache and never see one; `next.config.ts`'s `headers()` covers the other half of that failure). It opts out under `navigator.webdriver` so `npm run net:audit` measures the code rather than a cache.

## The React Compiler

On, through **Babel**, with `experimental.turbopackRustReactCompiler` deliberately off.

**The Rust port emits nothing here.** The built client chunks contain **0** memo-cache call sites against **356** with the Babel transform; the only `useMemoCache` references left are React's own runtime definitions. A compiler that silently optimises no files is worse than one that is off, because the flag says otherwise. The count is one grep over `.next/static/chunks/*.js` for the compiler's slot idiom, and it belongs in any Next upgrade; `next.config.ts` spells the command out beside the flag.

**What it buys** (`npm run perf:metrics`, `Performance.getMetrics` deltas, median of 9): a tab switch's `ScriptDuration` 0.076s → 0.062s, **−18%**; a cold load of `/` 0.211s → 0.223s, +6%. That is memoisation's usual shape — the first render pays to fill the caches and every render after it collects — and the trade is taken because a cold load happens once while the interactions happen all session. (A 5-sample run reported the cold regression at +33%; it is noise at that size.)

**What it costs is bytes**, and that half is not noise: `npm run perf:weight` puts `/policy` at 270,655 brotli with the compiler on against 254,873 with it off — **+15.8 KB on every route**, which is the memo-cache code itself. 16 KB is downloaded once and then cached, while the 14ms per interaction repeats all session, so the trade is taken — but if this app ever optimises for a first visit on a slow link above everything else, this is the first flag to reconsider, and one `reactCompiler: false` reverses it.

It was enabled **last** on purpose, so anything it broke would be attributable to it. The risk surface here is not the usual one:

- **Render-phase writes** exist on purpose and each is guarded by an *identity* comparison — `lib/resource.ts`'s `setRetained` against `snapshot.data`, and `AppLayout`'s drawer and background-location state. A memoised snapshot that changed identity for an unchanged value loops rather than merely re-renders, so this is the first place to look.
- **`useGSAP`'s `dependencies`** is a runtime argument the compiler does not model while still memoising the values fed into it. How often those identities change is how often the GSAP context is disposed, which is the accumulated-`Observer` bug this file already records. `lib/motion.ts` and `components/Sheet.tsx` pass hand-tuned lists and two of those call sites omit `revertOnUpdate` on purpose, so both carry **`'use no memo'`** for the first release. Lift them one file at a time with `npm run net:tabs` and `npm run hero:path` as guardrails.
- `RouteCrossFade` is **not** a risk: it is a class component, which the compiler does not touch.

A bailout is information, not noise — it says that file was not optimised.

## Measuring it

Seven probes beside the four checks, all driving Edge over CDP against the same stubbed upstream as `net:audit`. None asserts; they print, and the numbers in this file come from them.

| | |
| --- | --- |
| `npm run perf:weight [routes…]` | every `<script src>` a document pulls, raw and brotli |
| `npm run perf:metrics [runs]` | `Performance.getMetrics` deltas for a cold load and a tab switch |
| `npm run perf:hydration [routes…]` | content in the first byte, and console warnings |
| `npm run perf:motion` | the lazy chunks warmed; the indicator glides; the cross-fade clone exists |
| `npm run perf:sw` | the worker controls; what is in its caches; a dead-origin navigation |
| `npm run perf:ripple` | a press wave's computed opacity per frame — peak must be the token, 0.1 |
| `npm run net:tabnav [w] [back] [gap]` | tab tap → open a thread → back; where it lands and which pane shows |
| `npm run perf:pageturn` | a gallery page turn per frame: scroll offset, and what each in-view card shows |
| `npm run perf:sharpness [w]` | the flight's bitmap vs the box it is painted into, on real images |
| `npm run perf:glass [w] [h]` | the /about plate, rendered to a PNG on the CPU — a design instrument, not a check. Every field of its four config objects is sweepable by name (`--refraction=`, `--momentum=`, `--detail=`, `--flank=`, …), plus `--colorA= --colorB= --sheen= --hue=`; `--stroke` walks a cursor through all four ink directions. One documented exception: two config objects declare `speed`, so the reeds' creep is `--fluteSpeed` and the flow's clock is `--swirlSpeed`. Note it renders on the CPU and so never compiles the GLSL — a shader change needs a browser as well |

`perf:sw` stops the **server** rather than emulating offline, and that is not a shortcut: `Network.emulateNetworkConditions` is scoped to the page target and does not reach the service worker's own thread, so the worker's `fetch()` kept succeeding and the first version of that probe reported the app rendering normally "offline".

## Module boundaries

### GSAP is not in any route's first document

**Measured**: 42–45 KB brotli (126 KB raw) off every one of the twenty-odd routes, verified by listing each document's `<script src>` set and grepping the files for `CustomEase`. Zero routes reach `lib/motion.ts` through a static import; the check is a graph walk over `from '@/…'` / `from './…'` edges with `import type` and `import()` excluded, and it must keep answering **0**. The engine used to arrive even on `/policy` because `lib/motion.ts` registers GSAP and five plugins at module scope, so *any* static import of it pulls the lot.

**Turbopack decides the chunks, not the import graph.** Cutting two shell edges moved the module graph and moved **nothing else**: a lazy import only buys bytes once the *last* static importer is gone. Do not measure this by reading the graph — measure the documents.

Four kinds of fix, and which one applies is decided by what the code actually wanted:

- **It never wanted GSAP.** `getAppScroller`/`heroOwnsScreen` (`lib/appScroller.ts`), `DURATION` and the curve literals (`lib/motionTokens.ts`), `beginPageTransit` and the theme-wipe guard (`lib/pageTransit.ts`), `setTabIntent` (`lib/tabIntent.ts`), the per-tab scroll memory and `applyInstantTabScroll` (`lib/tabScroll.ts`), the reduced-tier spring substitution (`lib/springTiming.ts`). Each is a few lines; between them they were most of the reach — a `querySelector`, a reference count and a one-line setter were putting an animation engine into the shell of every screen.
- **It wanted an animation, but not this engine.** `useSlidingIndicator` (the tab indicator's glide) is `lib/slidingIndicator.ts` on Web Animations; `Reveal`'s cascade is WAAPI; `scrollAppToTop`/`scrollAppToElement` are `lib/scrollTo.ts` on rAF. The tab indicator is the instructive one: four lines of GSAP inside `components/Tabs.tsx`, which `AppLayout` mounts and eight route pages also import.
- **It is genuinely rare.** `CaptchaModal` and `Sheet` are `dynamic()`. Both needed a *latch* as well: each was rendered unconditionally with an `isOpen={false}`, so `dynamic()` alone would have fetched the chunk at mount. A one-way "has ever opened" flag fixes that and keeps the exit animation, which conditional rendering on `isOpen` would have taken away.
- **It is common but deferrable.** `lib/motionLazy.tsx` — see below.

### `lib/motionLazy.tsx`, and the rule that makes it safe

Six entry points behind one dynamic import: `changeScheme`, `changePalette`, `startTabTransition`, `<DrawerSwipe>`, `<TabPanesMotion>`, `<StaggerGrid>`. `warmMotion()` and `warmRouteCrossFade()` are called from the shell inside `runWhenIdle`, so in practice the engine is resident long before any of them is reached.

**Nothing in it awaits inside an event handler**, and that is the whole rule. An `await` before `preventDefault()` loses the gesture; an `await` before a state write puts a frame of nothing on screen. So every entry point does what the **关闭 tier** already does — a real, shipped, documented path — and starts the load in the background:

| Entry point | Fallback before the chunk lands |
| --- | --- |
| `changeScheme` / `changePalette` | `commitScheme` / `commitPalette` — the preference is written, it just does not wipe |
| `startTabTransition` | record the outgoing offset and return, which is its own `off` branch line for line |
| `<TabPanesMotion>` | `applyInstantTabScroll`; the panes still swap, on React's `data-tab-pane-active` |
| `<StaggerGrid>` | nothing — an entrance's absent form is the cards being there, i.e. 入场动画 off |
| `<DrawerSwipe>` | nothing — one swipe; the button, the scrim and Escape are not this hook's |
| route cross-fade | `captureRouteSnapshot` returns `null`, so the navigation is a cut |

A user who beats the chunk loses **one** interaction's animation, never the interaction.

**Two of the three hooks had to change shape, because a hook cannot live behind an `import()`.** `useDrawerSwipe` became a component that renders `null` — mounted only once the module exists, so its hook call is unconditional for its whole life. `useTabPanes` and `useStaggerGrid` return a **ref**, which the caller needs in its first render, before the engine exists; so they are `useTabPanesOn(ref, …)` / `useStaggerGridOn(ref, …)` now — the caller owns the `useRef`. The old two-argument forms are gone rather than kept as wrappers: two ways to call one hook is how their defaults came to disagree.

**And `lib/routeCrossFade.ts` is split rather than lazy-per-call.** The GSAP half is `lib/routeCrossFadePlay.ts`; the front half keeps the snapshot, the layer and the cell map. The gate is in `captureRouteSnapshot`, not in `playRouteCrossFade`, and that ordering is the point: cloning a page that nothing can animate leaves a stale frame frozen over the new one, which is worse than no transition. `lib/forumTransition.ts` is split the same way, and its warm is driven by the gesture — `rememberForumOrigin` *is* a press on a post, and the detail route is a network round trip away, so the chunk is fetched exactly when it is about to be needed.

**`lib/appearance.ts` owns the five device-local appearance preferences** — colour scheme, palette, motion tier, motion speed, entrance animations — and it is the only module that reads or writes them. They are one concern with one shape: a stored setting that may say "follow the system", a resolved value on `<html>`, a cookie so the server can put it there before first paint, and one subscription so the app bar's glyph and /settings' dropdowns cannot disagree. Read the **root**, not the store: `motionTier()`, `currentPalette()` and `entranceMotion()` read the attribute, because that is what the CSS is keyed on and therefore what is in force — a stored setting can say `system`, an attribute never does.

It is deliberately GSAP-free. `lib/motion` registers a callback through `setMotionScaleListener` that sets `gsap.globalTimeline.timeScale` — a seam rather than an import, for the same reason `setHeroBusyCheck` is one: this module is reached by anything that reads a preference. The `off` tier is clamped there rather than here, because a `timeScale` of 0 stops the clock instead of collapsing the duration. `changeScheme` / `changePalette` live in `lib/motion` beside `circularReveal`, because what they are is a *wipe* with a one-line preference write inside it.

**`lib/generated/` is script output.** Nothing in it is hand-edited and `npm run colors` fails if it is stale.

**`lib/api.ts`'s `api` is a runtime spread, so it cannot be tree-shaken.** Every importer of it pulls every member, and 39 files import it — including `app/page.tsx`, `ImageCard`, `MasonryGrid` and `FeaturedBanner`. So the admin surface is **not** in it and is **not** re-exported from it: the eleven admin tabs do `import * as adminApi from '@/lib/api/admin'`, and each of them is already a `dynamic(…, { ssr: false })` chunk. (While those 48 functions were spread into `api`, the home page shipped the entire admin console's API layer.) Splitting the rest of the object into named re-exports is still the end state. The same reasoning moved `getTeamMembers` out of the admin module: it is a public, tokenless read that `/about` renders.

**`PICPONY_API_BASE` is relative on purpose** — the browser's request has to go through `app/api.php/[[...path]]/route.ts`, which rewrites the backend's `Secure` session cookie so it survives plain HTTP. Node's `fetch` rejects a relative URL, so anything running on the server uses `PICPONY_API_ORIGIN` with it. A server component reaching for the relative form throws `Failed to parse URL`.

**`LS_KEYS` is complete and has to stay that way.** It covered 9 of the 27 keys the app writes, so 32 call sites restated a literal that *was* in the table — 25 of them in `app/settings/page.tsx`, which is now the largest *consumer* of the table (66 literals went), and `AppLayout` goes through `lib/appearance` rather than writing `darkMode` and `followSystemPrefersColorScheme` by hand.

**`COOKIE_KEYS` is its sibling, and it exists because the two sets are not the same.** Six preferences are mirrored into a cookie so `app/layout.tsx` can put them on `<html>` at SSR; without that the first paint is the default theme and the pre-paint script corrects it, which is a visible flash of the wrong brand on every cold load. `darkMode`'s cookie name matches its storage key and `sidebarCollapsed`'s does not, which is precisely why the mapping is a table rather than a derivation.

**`MEDIA` holds every `matchMedia` string, including the two preference queries.** `(prefers-color-scheme: dark)` was hand-typed at three sites and `(prefers-reduced-motion: reduce)` at four — seven copies of two strings, in the two places where a typo fails silently by never matching.

## Data requests

**A screen does not fetch. It reads a resource, and the resource decides whether that costs a request.** `lib/resource.ts` is the primitive, `lib/resources.ts` is the catalogue, and `useResource(forumThread, { id })` is the whole of the call site. `npm run net:audit` is the request ledger that argues for the layer: before it, the shell asked twice and re-asked on every navigation, screens re-read what they had just read on a remount, screens read in series when they could read in parallel, and screens read things nobody asked for.

### The two stores, and why they are two

| What | Where | Keyed on |
| --- | --- | --- |
| What the server said | `lib/resource.ts` | the arguments of the read |
| What this screen was showing | `lib/screenState.ts` | a string the screen picks |

`lib/pageCache.ts` was both at once, and using it meant lifting your whole render into one snapshot object — which is why only three components ever adopted it. Split apart, a remount reads its page number from `useScreenState` and its rows from the resource cache, and paints in the first frame with neither a skeleton nor a request.

`useScreenStateFor` is the same thing scoped to a record. Two profiles are two screens sharing a component, and a flat key carries page 4 of one into the other. Unique is not the same as sufficient.

### Reading a snapshot

`useResource` returns `{ data, error, isLoading, isStale, refresh }`, and **`data` and `isLoading` are independent on purpose**. A cached screen refreshing underneath has both; that is the entire point of the layer. So:

- the *placeholder* branches on `data === undefined`
- a *dim* may branch on `isLoading`
- branching the placeholder on `isLoading` puts a skeleton over content that is already correct, which undoes the reason for having a cache at all

Pass `SKIP` for a read that should not happen yet — an unselected tab, a signed-out visitor, an id that has not resolved. That is the mechanism that stops a screen paying for content nobody asked for.

**A paged list must pass `keepPrevious`, and forgetting it is a scroll bug rather than a data one.** Changing the page changes the key, and a key with nothing cached reports `data === undefined` — the rows unmount for one round trip, the scroll container collapses, the browser clamps `scrollTop` to the new tiny maximum, and the page snaps to the very top with the pager's own scroll-to-the-list undone. `node scripts/netAuditScroll.mjs` samples the card count every frame across a page turn and fails on a single empty frame, because one commit is enough. It is off by default because for an unpaged screen it is wrong: showing the *previous* profile while the next one loads is worse than a skeleton.

**Pass a scope string when a paged list changes owner or content filter.** `keepPrevious: true`
retains pages within the resource; a string made from `userId` and `contentFilter` retains only
within that scope. A new profile or filter drops the old answer immediately, including when the
new read fails. Disabling a read with `SKIP` also clears its retained answer. The Derpi uploader
resource puts the filter snapshot in both its key and its actual request, so a preference change
while waiting for route policy cannot store an unfiltered answer under a safe key.

### Arriving with the answer: `seed` and `initial`

Three screens render their first read on the server and hand it down: `/` (the first page of the gallery), `/about` (the team roster) and `/user/[id]` (the profile header, not the four tabs). Each has a `.server.ts` module beside it, a server shell that awaits it, and an island that takes it as a prop and passes it to `useResource` as `initial`.

**The seam is `resource.seed(args, value, fetchedAt)`.** Both `seed` and `write` build a resolved `Entry` directly: a cold write must not call `create`, because `enqueue` → `pump` → `job.run()` starts a fetch synchronously. `seed` additionally preserves the server's timestamp and publishes its first snapshot synchronously; ordinary writes retain the existing entry's age and publish on a paint boundary. A write replaces the old entry and cancels its work, so an older response cannot undo a successful mutation. Imperative `read()` returns the current value, including after a write or background refresh; an already-settled first-read promise is not a mutable cache.

Four details of it are load-bearing:

- **The snapshot is built synchronously, not through `publish()`.** `publish` is rAF-bound and hydration renders before the next frame — a seed that went through it would arrive one frame late, which is exactly the skeleton flash it exists to remove.
- **`args` is set.** It is what `expire()` and `bindResourceRefresh` re-read from; a seed without it is invisible to "the tab came back after a minute".
- **`fetchedAt` is `Math.min(generatedAt, Date.now())`.** An RSC payload can be minutes old, and stamping it "just fetched" would pin stale HTML for a whole TTL. The clamp only ever errs toward *stale*, never toward *fresh*.
- **It is a no-op on the server** (`typeof window === 'undefined'`). `lib/resource.ts` is a `'use client'` module, and such a module is still *evaluated in Node* during SSR — so its module-scope `store` is shared across concurrent requests. Seeding there would hand one visitor's feed to another's render.

**The keys have to agree on both sides, and key functions must be pure.** `homeFeed` used to read the browsing fingerprint out of `localStorage` *inside* its key function — a hydration mismatch the moment content comes from the key. It takes `{page, sort, fp}` now, and `COOKIE_KEYS.browsing` mirrors `browsingFingerprint()`'s own output so the server can compute the same string. The island renders its first frame with the **server's** fingerprint and switches to the device's after mount: identical, and there is no mismatch; different, and the key changes once, costing one request with `keepPrevious` holding the server's rows on screen. `DEFAULT_BROWSING_FINGERPRINT` is what an *absent* cookie means — without it the server keyed on `''` while the browser keyed on `safe|-|d|-|`, and the seed never applied.

**What does not move, and why.** `featuredImage` stays on the client: `getFeatured` puts the user's Derpibooru API key in the URL, so a shared server cache would leak it. `/favorites`, `/history`, `/tasks`, `/messages` and `/block-groups` are token-gated and the token is in `localStorage`, which the server cannot read — moving them means moving auth into a cookie, which is a security decision rather than a performance one. `/search` reads `searchParams` and would explode the cache key. And the forum pane is already `api: 0` on tap, mounted on an idle callback, so SSR would only add bytes for the majority who never open it.

### Speculation may move a request earlier. It may never add one.

That is the rule, and `npm run net:audit` asserts it: every journey's request count may fall and may not rise. Three consequences:

- **Prefetch is intent-driven, never idle.** `useIntentPrefetch` is `useHeroLink`'s ladder with the gallery card taken out of it — hover at 70ms, focus at 120ms, press immediately, cancel on leave, gated by `isScrollLikelyActive()`. `prefetchRoute` maps a path to the reads that path starts, in one table rather than scattered across the components that link there.
- **The obvious pagination win is not taken.** Warming page *n+1* as soon as page *n* settles was written and removed: it is a request for a page that may never be looked at, on every paged screen. What survives is the intent ladder on the controls, which buys the same head start and costs nothing until somebody reaches for them.
- **Guessing cannot starve a real read.** Background work is capped at two of the four concurrent slots, so a prefetch can never take the last one. `saveData` and the two slowest `effectiveType`s switch speculation off entirely — the concurrency cap protects latency, and nothing but that switch protects *bytes*.

**A `<Link>` prefetch is not a data prefetch.** Next warms the RSC payload and the chunk when the link is in the viewport, which is real and is not the expensive half: every screen here is a client component that starts its reads in its first effect, so a warm chunk still arrives at an empty page.

### Coming back

`bindResourceRefresh`, mounted once in the shell, re-reads what is on screen when the tab returns after a minute away and whenever the network reconnects. It **expires rather than invalidates**, and that is the whole difference between a refresh and a reload: every mounted screen keeps what it is showing and re-reads underneath, with no loading state. Dropping the entries instead would empty every screen in the app in one frame.

`expire` also has to *start* the re-read rather than merely mark: `useResource`'s effect is keyed on the resource and the key, and neither changes when a value goes stale. The entry holds its own args for this.

`invalidate` preserves mounted subscribers and immediately re-reads their keys; deleting the listener slot would leave an unchanged key permanently empty. `clearAllResources` is separate: signing out aborts and drops every entry without issuing requests for the old account. `node scripts/testResources.mjs` checks these distinctions and the races between reads, refreshes and writes.

### Two mistakes this layer made, both worth not repeating

**A subscriber arrives before the reader.** `useSyncExternalStore` subscribes during render and the read happens in the effect a tick later, so every mounted component creates a listener slot for a key nothing has requested; it must not be confused with a real queued entry (a resolved promise that carries nothing — every migrated screen went silent at once). `Entry.placeholder` is the distinction.

**And the ledger called it a triumph.** The home page "improved" from five requests to one, with the gallery empty behind it, because the only assertion was an upper bound. An upper bound cannot tell an optimisation from a breakage. `net:audit` now also holds a floor — a step that read something before must still read something, and a step whose own content request was identified before must still identify it.

### `npm run net:audit`

Drives Edge over CDP through a fixed set of journeys and counts requests per step. It asserts **counts** and the **round** of each step's own content request; wall-clock timings are printed and asserted nowhere, which is the same split `palette.mjs` draws between a `floor` pair and a `report` pair.

The upstream is **stubbed** (`netAuditFixtures.mjs`), and not because it is down: `proxyFetch`'s retry ladder turns one logical read into one *or* three depending on which line is reachable, so the count stops being a property of the code. `--live` runs against the real thing for a payload-shape check and refuses to write a baseline. A second fixture server is handed to `next start` through `PICPONY_UPSTREAM_ORIGIN`, because CDP intercepts the *browser* and reaches nothing the server does — without it the SSR-side policy read could not be measured at all.

Two numbers it reports and does not assert: the maximum `rounds` over a step (an idle-scheduled request inherits depth it does not owe), and chrome reads — `get_user`, `get_unread_counts`, `get_announcement` — are excluded from the rounds chain entirely, because they fire on every screen in parallel and were making `contentRound` race.

**A third column, `srv`, and a third round value, `r0`.** Once a read moves to the server, CDP cannot see it — from the ledger's point of view the request vanished, which is indistinguishable from the screen having stopped loading, precisely what the floor exists to catch. So the fixture server that `PICPONY_UPSTREAM_ORIGIN` points at now tallies what the Next server asks it for. `srv` is that count, `r0` means "this screen's own read was already in the first byte", and the two assertions split by what is reproducible:

- **The ceiling is applied twice** — to browser requests, which is what a user waits on, and to `api + srv`, because "speculation may move a request earlier, never add one" is a rule about requests and not about which process sends them.
- **The floor counts both layers**, and asks only "did this step read anything, anywhere". A step that reads nothing on either side is a screen that has stopped loading.

`get_maintenance_status` is excluded from `srv` for the same reason `get_user` is excluded from the rounds chain: the server does it on every route, including ones that read nothing.

Two harness facts make `srv` assertable, both load-bearing: the tally is cleared before each step (the `r0` classification tests that list — a stale tally would mark a later screen's content as "already in the first byte", the one failure the floor exists to catch), and Next's Data Cache persists to disk (`.next/cache/fetch-cache`) — and, contrary to what this file once said, an explicit `next: { revalidate }` is **not** vetoed by an upstream `Cache-Control: no-store`; the veto applies to the default heuristic, not to an explicit instruction. `PICPONY_SERVER_MEMO_TTL_MS=0` is what the harness sets, and it reaches **both** caches through `cacheSeconds` (`lib/serverMemo.ts`) — the memo and the `revalidate` argument share one number. It has to be both or it is neither: either cache alone serves the second journey to open `/` from memory, and from outside a cache hit and a screen that has stopped loading are the same observation.

**In-flight coalescing is not caching and survives the switch.** `/user/[id]` has two callers per request — `generateMetadata` and the page — and Next renders them concurrently, so a slot that is only written on resolution has both miss and both fetch. The memo joins an **unsettled** slot whatever the TTL says, which is de-duplication rather than staleness.

**A server-side read is reached by `<Link>` prefetching, not only by a visit.** The footer links to /about from every route, Next prefetches the RSC payload of every visible link, and rendering that payload runs the read — so without a cache in front of it, one page view *anywhere* becomes one upstream fetch. All three `.server.ts` reads go through `createServerMemo`, and any future one should too.

### What is not in the catalogue

**The opened picture.** `lib/detail.ts` holds that one, and it is where this layer's machinery came from: TTL, LRU, priority queue, concurrency cap, real cancellation and a paint-bound notification tuned so a response can never land inside a hero flight's geometry frame. It stays separate because its publication is gated on `imageHeroController.isDetailDataPublishable`; `ResourceOptions.publishGate` is the seam that would let it fold in, and folding it in has not been done.

**`/messages`' three list reads.** That screen keeps `lib/pageCache.ts`, and it is the last consumer; its per-pane `loading`/`error`/`silent` system already hand-rolls much of what this layer does. The unread counts *were* unified; the lists were left.

**Persistence.** The store is a `Map` and a reload genuinely reloads, which is `pageCache`'s own rule. `lib/tagCounts.ts` and `lib/tagTranslations.ts` keep their own localStorage caches on week-long TTLs; that is a different problem, and keeping it separate is what stops this from growing a quota policy.

## Request lines

**A line is not a user preference — it is a policy the server pushes.** `api.php?action=get_maintenance_status` carries four fields besides the maintenance ones, and an administrator uses them to pin every visitor to one Derpibooru API line and one image line. `lib/route.ts` owns all of it. When the policy is anything but `auto` the user's own toggles in /settings report the forced value and go disabled — so "the line switches are all greyed out" is this feature *working*, not a bug.

**Two axes, and they are independent.** The API policy rewrites Derpibooru `/api/` calls; the image policy rewrites derpicdn images. PicPony's own `/api.php`, its avatars and its banners never change host, so `PICPONY_API_BASE`, `getAssetUrl`'s host and the proxy route's upstream are not part of this at all.

| API line | URL |
| --- | --- |
| `direct` | `trixiebooru.org/api/v1/json/…` unchanged |
| `api_accel` | `PROXY_API_BASE` + the encoded `derpibooru.org` URL — a Worker, `GET`/`HEAD`/`OPTIONS` only |
| `picpony_api` | our own `/relay?url=…&xp_user=…` |
| `third_party` | an admin-supplied origin, with the Derpibooru path and search copied onto it |

| Image line | URL |
| --- | --- |
| `direct` | `derpicdn.net/…` unchanged |
| `cdn` | `IMAGE_CDN_BASE` + encoded |
| `picpony` | `IMAGE_WORKER_BASE` + encoded, plus a thumbnail marker |

**Every line is applied per request, over the canonical URL.** `DERPIBOORU_API_BASE` stays what it is and `buildApiLineUrl` rewrites at call time. The alternative — making the base constants mutable — cannot work: `export const '…'` is a string literal that a bundler is free to fold into all 140 call sites, so reassigning the module binding changes nothing.

**`proxyFetch` awaits `ensureRoutePolicy()` on every call**, and that await is the whole guarantee. Resolved, it costs a microtask; unresolved, it is what stops the first request of a cold load from going out on the default host while the site is pinned somewhere else. It is the old frontend's `window._maintenanceReady` moved somewhere it cannot be got wrong — a React boundary would depend on mount order. It **never rejects**: any failure leaves the `auto` defaults in place, because a rejection there would lock every Derpibooru request in the app behind one dead fetch.

**A forced line is not ours to leave, and neither is the relay.** Under a forced policy — or on `picpony_api` under `auto` — a failure is retried in place, three times, and then thrown. Falling quietly back to direct is what would make 全站强制 meaningless, and the relay in particular exists for the visitor whose direct connection does not work. The same rule holds for images: a forced image policy has no ladder, so `resolveNextAttempt` converges on the named line — including *snapping to* it, since an `<img>` built before the policy landed starts on the wrong tier and retrying that tier in place would never reach the forced one.

**What that costs, stated because it is the sharp edge of the design.** `useHongKongRelay` defaults on, so `auto` resolves to the relay for anyone who has not touched the switch — and the relay does not fail over. If it is down, those visitors get an error even where direct works. The cascade that is actually reachable is therefore **direct → accel → direct-with-cooldown**, and only for users who turned the relay off; cooldown is 30s, or 10 minutes on a 403/503. `stepApiFailover`'s relay step is unreachable for the same reason and says so where it sits.

**Only a network throw and the proxy statuses retry**, and three exclusions are load-bearing. A **cancellation** is not a failure of anything: retrying re-`fetch`es an aborted signal, and on the `auto` cascade it would announce two line switches because the pointer left a gallery card. **429** is left out of the failover list that the old frontend includes — a rate limit is counted against the caller, so moving to a shared worker spreads one visitor's limit onto every visitor of that line (and it made `handleDerpiError`'s dedicated 429 message unreachable). A **403 on a request that carried a key** is about the key: no other line answers it differently, so failing over spends six requests and two snackbars on a revoked credential. Note that `readJson` turns a dead line into `{ success: false }` rather than an exception, which is why the decision is made on `res.ok` and the status inside `proxyFetch`.

**The image line is applied in the data layer, once.** `applyImageLine` runs inside `lib/api/derpi.ts` for every image-bearing response, not at the screens — the featured banner, the opened picture and both profile grids render their URLs directly, so a policy applied only in the two gallery maps never reached them. It is idempotent (strip the wrapper, then apply the current one), which is what makes the surviving call sites harmless and what lets a forced `direct` policy unwrap a URL that arrived pre-wrapped.

**`/relay` exists because the relay checks `Origin`.** `cdn.picpony.top/relay` allows `picpony.top` and `www.picpony.top` and 403s everything else, so the browser cannot use that line from this app's origin at all. `app/relay/route.ts` makes the hop server-side, where the `Origin` is ours to set. It forwards `GET`/`HEAD` only and validates protocol, host, port, credentials **and path** — **that check is the security of the endpoint**, not a tidiness check: without the path restriction a bare `?url=https://derpibooru.org/` serves third-party HTML *from this origin* on an unauthenticated GET, in the origin that holds the session token, because the upstream `content-type` is echoed through. A 3xx is rejected rather than passed on: the browser would follow it back to the host whose `Origin` check this route exists to satisfy. `xp_user` is bounded and charset-checked because it is unauthenticated — it is the relay's per-user accounting label and anyone can claim any value for it.

**Three things were quietly wrong before and are worth not reintroducing.** `usePicponyProxy` is the *image* worker's toggle, and it was gating the API proxy as well, so one switch steered both pipelines. The fourth line — `picpony_hk_relay`, the relay, and the old frontend's *default* — was missing entirely, so this app's out-of-the-box line was the accel Worker while the old one had always been the relay. And the image degrade constants had drifted from the live ones (a 30s window against 10s, one 60s recovery against 30s and 15s) with no CDN-versus-direct race at all, so the `raceWinner` rung in `resolveImageLine` had nothing to read.

**The image probes use an `Image()`, not a `fetch`.** These hosts are image proxies, so a decoded bitmap is the only evidence that means "this line works". A no-cors `HEAD` yields an opaque response that resolves on a 500 as readily as on a 200, so a dead line probed as healthy undid its own degrade. The race is lazy: it runs when an image has actually failed and after a recovery probe comes back down, never at boot. Both hosts take the same three-distinct-URLs-in-10s threshold — the CDN used to be dropped on its first failure, and one deleted picture 404s on every line.

**Two things to know rather than fix.** When the server sets `global_api_third_party_pass_api_key`, the user's Derpibooru API key is forwarded in the query string to the third-party origin. That is the old frontend's behaviour and the flag is the server's to set, so this app follows it — but it is a credential leaving for a host neither end controls, and the `false` branch (which strips the key) has to keep working. And the key transits *our* server too: `getFeatured` and identity detection put `key=` in the URL, and on the relay line that whole URL becomes a query parameter of `/relay`, so it lands in this server's access log as well as the relay's.
