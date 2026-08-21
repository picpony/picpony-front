<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design system

Material 3. The tokens live in `app/globals.css`; the primitives live in `components/`.
**Never re-type either at a call site** — that is how the app ended up with three
card radii, five scrollbar appearances and 29 hand-copied primary buttons.

## Use the primitive, not the class string

| Need                     | Use                                                        | Never                                             |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------- |
| Button                   | `components/Button.tsx`                                    | a `<button>` with `bg-primary text-on-primary …`  |
| Text input / textarea    | `Input` / `Textarea` / `Field` from `components/Input.tsx` | a bare `<input>` with border + focus-ring classes |
| Colour picker            | `ColorSwatch` (`components/Input.tsx`)                     | a bare `<input type="color">`                     |
| Radio button             | `components/Radio.tsx`                                     | a bare `<input type="radio">`                     |
| Slider / range           | `components/Slider.tsx`                                    | `<input type="range">` plus a global class        |
| A one-time code          | `components/CodeInput.tsx`                                 | six `<input maxLength={1}>` and a ref array       |
| On/off setting           | `components/ToggleSwitch.tsx` — `layout="row"` in a list   | a `justify-between` div with a bare switch in it  |
| Card / section surface   | `components/Card.tsx` — `interactive` makes it a `<button>` | `bg-surface-container-… rounded-… p-4`            |
| Dropdown (picks a value) | `components/Select.tsx`                                    | a hand-rolled absolutely-positioned menu          || Menu (runs a command)    | `components/Menu.tsx`                                      | a `role="menu"` div with no keyboard support      |
| Any other floating panel | `components/Popover.tsx`                                   | a fifth recipe for corner + elevation + border    |
| Dialog                   | `components/Modal.tsx`                                     | a hand-rolled scrim + panel                       |
| "Are you sure?"          | `useConfirm` (`components/ConfirmDialog.tsx`)              | `window.confirm`, or a `Modal` + 4 useStates      |
| Asking for one value     | `usePrompt` (`components/ConfirmDialog.tsx`)               | `window.prompt`                                   |
| Copying to the clipboard | `copyText` (`lib/utils.ts`)                                | `navigator.clipboard.writeText` with no fallback  |
| Reading the session      | `readUserInfo` / `readToken` (`lib/hooks.ts`), `useAuth` in a dependency array | `localStorage.getItem('user_info')` and a `JSON.parse` |
| Formatting a date        | `lib/format.ts` — four shapes, `zh-CN` fixed                | `toLocaleString` with an option object at the call site |
| A PicPony asset URL      | `getAssetUrl` / `getAvatarUrl` (`lib/utils.ts`)             | `` `https://picpony.top/${path}` `` — three join semantics were in use |
| Bounding a number        | `clamp` / `clamp01` (`lib/utils.ts`)                        | `Math.max(a, Math.min(b, v))`                     |
| An admin API call        | `import * as adminApi from '@/lib/api/admin'`               | `api.adminXxx` — `api` is a runtime spread, so it cannot tree-shake |
| Bottom sheet             | `components/Sheet.tsx`                                     | a `Modal` on a phone                              |
| Icon-only control        | `components/IconButton.tsx` — `variant="media"` on a photo | `p-2.5 rounded-full` around a glyph               |
| Icon control on the app bar | `IconButton` `variant="on-primary"`                     | a 48px box repeating `focus-ring-on-primary`      |
| A close / dismiss control | `IconButton` `dismiss`                                    | hand-writing the quarter-turn hover               |
| A hover/focus label      | it is automatic — `IconButton` shows its own               | `title=` on an icon-only control                  |
| A label on anything else | `useTooltip` (`components/Tooltip.tsx`)                     | `title=` where a real description is meant        |
| An icon's size           | `ICON` (`lib/icons.ts`) — `size={ICON.standard}`            | a number picked against the glyph beside it       |
| An icon inside a Button  | nothing — the primitive sizes its own slot                   | a `size` on the icon; author CSS beats the svg's `width` attribute, so it is inert |
| An icon inside a Badge   | nothing — `Badge` sizes it at 14 (`sm`) / 16 (`md`)          | `ICON.dense`; 18 makes the badge 2px taller than one without an icon |
| Heading above a card or list | `components/SectionHeading.tsx`                         | an `<h2 class="text-title-m-…">` written out      |
| Tag / status pill        | `components/Chip.tsx`                                      | —                                                 |
| Mark beside a name       | `components/Badge.tsx` — `tone="media"` on a photo          | an inline `<span>` with a container pair          |
| Unread count             | `CountBadge` (`components/Badge.tsx`)                       | a hand-clamped `99+` pill                         |
| Role beside a username   | `components/RoleBadge.tsx`                                 | `roleInfo(x).chip` on your own `<span>`           |
| Nothing here / it failed | `EmptyState` / `ErrorRetry`                                 | a centred `<p>` in a `<div>`                      |
| A progress meter         | `components/ProgressBar.tsx`                                | a `h-2` div with an animated `width`              |
| A tab row                | `components/Tabs.tsx` — `variant` picks the shape           | a button row with `role="tab"` and no arrow keys   |
| Tabbed panes             | `TabPanes` / `TabPane` (`components/TabPanes.tsx`)          | `{active === 'x' && …}`, or a `key` on the panel   |
| Chat message             | `components/ChatBubble.tsx`                                | a radius picked by eye                            |
| Overlay behaviour        | `lib/overlay.ts` hooks                                     | a second copy of the focus trap / scroll lock     |
| Press feedback           | `data-ripple` + `state-layer`                              | an active-scale utility                           |
| Component motion         | `spring-*` utilities / `spring()` (`lib/motion.ts`)         | a duration and a curve chosen independently        |
| Scroll-in reveal         | `useScrollReveal` (`lib/motion.ts`) — see note below       | mount-time fades                                  |
| Scrolling to an element  | `scrollAppToElement` (`lib/motion.ts`)                     | `el.scrollIntoView({ behavior: 'smooth' })`       |

**There is one tab control and it is `Tabs`.** There were four: `TabBar`, a
hand-rolled floating pill in `AppLayout`, the admin console's vertical rail, and
a fourth on /tasks. Three of them declared no ARIA roles at all — so the app's
primary navigation announced itself as a row of unlabelled buttons — and the one
that did declare `role="tab"` implemented none of the contract that role promises:
no arrow keys, no roving tab stop, no `aria-controls`. That is the same failure
`Menu` documents about the hand-rolled share menu, and it is worse than a plain
button row, because the user is told which keys to press and then they do nothing.

The fourth is the instructive one. /tasks had copied the whole structure —
`useSlidingIndicator`, an absolutely-positioned indicator, a `data-tab` attribute
per button — before the primitive was reachable, and in copying it reintroduced
the defect `TabBar`'s own comment recorded having fixed: an active tab
distinguished by colour with no weight contrast. A four-line incantation does not
survive being copied to a fourth screen. `variant` covers all three shapes
(`underline`, `pill`, `rail`) and `tone` covers /tasks' amber indicator.

**A tooltip is not `title`, and an icon button no longer needs to ask.** `title`
gives the OS font at the OS size with no token in it, a delay the page cannot set,
nothing reachable on a touch screen — and, the part that matters, no
`aria-describedby`, because `title` is a last-resort accessible *name* rather than
a description. So a screen reader either read it in place of the label or ignored
it. `IconButton` now renders an M3 plain tooltip from its own `aria-label` (or
`title`, or an explicit `tooltip`), which means all forty of them got one without a
call site changing, and it drops the native attribute so there is only one bubble.
Anything else that wants one takes `useTooltip`.

`useTooltip` is a hook rather than a wrapper component on purpose. A wrapper has
to either clone its child — which breaks on any component that does not forward a
ref — or introduce a box of its own, which changes the layout of every row it
lands in. A control already owns its element and its ref, so handing it props is
both simpler and layout-neutral.

`title` is still right for one thing: a hint on content that *already shows its
text*, where the attribute is supplementing rather than naming — a truncated tag
name, a relative timestamp's absolute value. Twenty-three of those remain and
should.

**`Card interactive` renders a `<button>`.** It used to render a `<div>` with a
cursor, a state layer and a ripple — a control no keyboard could reach and no
screen reader could name. It had no call sites, which is the only reason that
never shipped, and it is the same defect `DataTable`'s docstring records removing
when it dropped `onRowClick`. A prop that produces an inaccessible control is
worse than an absent one.

**And `Card as="a"` exists**, because the primitive could render only a `div` or a
`button` and four card-shaped `<Link>`s therefore hand-rolled the whole recipe —
including one string written out twice in one file. An anchor takes the same
block/left-align/focus treatment a button does; it just never takes `type` or
`disabled`.

`Avatar` has the matching escape hatch: `unoptimized` renders a native
`<img referrerPolicy="no-referrer">` for a host that is neither in `next.config.ts`'s
whitelist nor willing to serve a request carrying a `Referer`. `/about` had a second
avatar component (`MemberAvatar`) for exactly that, with its own box, its own error
state and a different fallback glyph.

Its `size` is a union — `32 | 40 | 48 | 56 | 'hero'` — rather than `number | string`,
so the four-step ladder is a constraint instead of a note in a docstring. The string
form used to be taken as arbitrary sizing classes, for the one avatar that changes size
at a breakpoint and therefore cannot be sized inline at all (an inline `width` beats any
class); `'hero'` is that case, and the 96 → 128 pair now lives in the component where
nothing else can invent a fifth box.

**Three primitives stand a default down when the call site names its own**, and the
pattern is worth recognising because `cn` is a plain join: emitting both leaves
Tailwind's output order to pick, which is not a decision anyone made. `Skeleton` does it
for a radius, `Badge` for `max-w`, and `ProgressBar` for `w-full` — the last one was
found the hard way, as a profile banner's XP bar that was 100% of the banner wide *and*
inset 24px from its left edge, so a quarter of it was clipped off the right end and read
as crooked.

**`Select`'s trigger is as wide as its widest option, not its current one.** A combobox
that resizes when you pick a value re-lays-out the row under the pointer that just chose
it; /settings' content filter did exactly that, because its options are 完全安全 (Safe)
and 中等限制 (Spoilers) and the trigger was shrink-to-fit. Every label is rendered into
one grid cell with all but the selected one `invisible` and `aria-hidden`, so the
browser's own intrinsic sizing takes the max and it stays true when the options change.
No measurement, no `min-w` to remember.

**`ToggleSwitch`'s press comes from pointer events, not `:active`.** AOSP reads it from
the `interactionSource`, and the difference is not academic: on a touch screen the
browser owns `:active`, and Chrome both delays applying it (so a scroll does not flash
every control it passes) and holds it for a minimum period afterwards. The visible
result on a tap was the handle still at its 28dp pressed width *after* it had finished
travelling to the other end — the grip cue outliving the grip. Off a real `pointerup`
the shrink and the travel start in the same frame and, both being `FastSpatial`, land
together; measured at 133ms for both. `pointercancel` and `pointerleave` are part of it,
or a press that turns into a scroll leaves the handle swollen.

`Spinner`'s colour is one `tone` axis — `primary` / `on-primary` / `inherit`. It was
`white?: boolean` plus `inheritColor?: boolean`: a raw colour name as a prop in a
system that forbids raw colours, an illegal fourth state nothing prevented, and a
mapping `Button` was doing at the call site from its own variant.


Press feedback is `data-ripple` plus the `state-layer` utility. This table used to
name a `usePressable` hook; nothing in the repo has ever defined one — the row was
the only occurrence of the string. Press lives in `spawnRipple` (`lib/motion.ts`)
and the `state-layer` utility in `globals.css`, and `Button`/`IconButton` already
carry both.

`useScrollReveal` (`lib/motion.ts`) is wired into the long-content screens —
/about's team groups, /settings' six sections, a forum thread's reply list. Pick
by *position*, not preference: on screen at commit uses `<Reveal>`, further down
uses this. /settings is the worked example of getting that wrong — it wrapped all
six sections in one mount-time `<Reveal>`, so the three below the fold had
finished revealing before you ever scrolled to them.

Four places it must **not** go, and the last two are why the list of call sites
is shorter than the list of long pages:

- **Above a gallery card.** It parks its targets at a `y` offset and the hero
  flight reads `getBoundingClientRect` on press.
- **Inside a `TabPanes` pane running `lean`** (i.e. /policy). The shared axis is
  already sampling the same nodes' `autoAlpha` and `y`.
- **Inside any tab pane whose content swaps**, `lean` or not — /user/[id],
  /messages, /favorites, the home route. The pane transition and the reveal would
  animate the same nodes on two different clocks.
- **Over content that already cascades on mount** — /tasks' rows stagger via
  their own delays, /admin's panel cross-fades as one block. A second entrance on
  top of the first is the "动画重叠" failure, not extra polish.

The hook owns three things a call site would otherwise get wrong. It refreshes
ScrollTrigger through a debounced `ResizeObserver`, because trigger positions are
computed once and ScrollTrigger auto-refreshes on resize and `load` and nothing
else — an image decoding after the batch is built moves every start line below
it. Its `batchMax` is a *function*, re-evaluated per refresh, because a flat
value put a whole phone screen into one batch and left the stagger nothing to
stagger. And it takes `useReducedMotion` rather than the one-shot read, because
this is one of the two hooks that keeps firing all session (the other is
`useStaggerGrid`) and so is one of the two where changing the preference midway
still has something to affect. It deliberately has no `refreshPriority`: that
option orders refreshes when one trigger's recalculation moves another's
measurements, which means pinning, and nothing here pins.

**An interactive element may not be nested inside another one.** A `<button>`
inside an `<a>` is invalid HTML, and it fails in exactly the way invalid HTML
does rather than in a way you can see: the gallery card's spoiler cover was a
click-handled `<div>` inside the card's `<Link>`, so the only focusable node on
the card was the link — Tab landed on it and Enter navigated to the picture the
cover exists to hide. Lift the second control out to be a *sibling* of the link
and position it over the top. Where the enclosing element is genuinely the
convenience target (the image detail's media box, which zooms on click), keep
the container's handler as a pointer affordance and put a real control inside
it, so the pointer path and the keyboard path both exist.

For an overlay that has to stay mounted through its own fade-out, `inert`
(React 19) is the one attribute that removes it from the tab order and the
accessibility tree together. `aria-hidden` alone leaves a focusable element
inside a hidden subtree, which is its own violation.

`EmptyState` and `ErrorRetry` are two presets over one `StatusView`, so a list
that is empty and a list that failed have one silhouette. Both take
`size="page" | "pane" | "inline"` — match the enclosure, because a half-viewport
block inside a 120px well makes the well scroll.

**Every** "nothing here" / "that failed" goes through them, including the ones
that do not look like a list: the 404, the route error boundary, the image
detail's failure, an admin table's empty body. There were nineteen hand-rolled
ones at the last count, in three type scales — `headline-s` for errors,
`title-m` for empties, bare `on-surface-variant` inside panels — and the reason
there were nineteen is that each was written next to the thing it belonged to
rather than reached for.

**`fill` is for the four screens whose entire content is the block** — the 404, the
route error boundary, `/derpi/user/[id]`'s failure, and the image detail's failure in
both of its presentations. `page`'s own floor is half the
viewport, which is right under a page header and wrong when there is nothing else on
screen: it leaves the sentence in the upper third. A list's empty state must not set it,
or the page grows past the viewport.

**`fill` drops `page`'s `min-h-[50dvh]` floor**, and that is not tidying — a floor beside
`flex-1` is a competitor, not a backstop. `[data-page-content]` has two in-flow children, the
content wrapper *and* the footer (≈190–240px), so `flex-1` divides the space **above the
footer**; once that space falls under 50dvh the floor overflows the column and the block
lands at the top of the scroller. Measured at 1280×620: 268px available, and before the fix
the 310px floor won. The block still centres in the region it owns rather than in the
viewport, so with a footer present it reads slightly high by design.

The image detail is the one that needs threading rather than a prop: `fill` is `flex-1`,
so every box between the block and the scroller has to be a flex column, and in the
overlay presentation that chain runs through `.image-detail-overlay-content` and the
container transform's own fit target. `renderDetailShell` takes a flag for it. `min-height:
100%` was tried there and computes to `auto`, because a height that comes from flex
distribution is indefinite in Chrome.

It is `flex-1`, not a percentage height, and that is not a style choice: a percentage
`min-height` only resolves against a *definite* parent height, and every box between
here and the scroller gets its height from flex distribution, which Chrome treats as
indefinite. `min-h-full` therefore computed to `auto` and centred nothing — the first
attempt at this shipped and did exactly that. It also needs
`[data-page-content]`'s inner wrapper to be a flex column, which it is; measured safe
because every route puts exactly one element in there.

**Loading is the destination's own shape, not a spinner.** A list loads as
`Skeleton` rows in the row's own geometry, a grid as `ImageGridSkeleton`, a card
as a card. A `Spinner` is for an action in flight — a submit button, an upload,
an inline "querying…" — not for a page, because a centred dot says "something is
happening somewhere" and then reflows the whole screen when the content lands.

The test is whether there is a destination shape *yet*. A puzzle image loading
into a box already sized to its own aspect ratio has one; a lightbox waiting on
an image whose dimensions are unknown does not. And the shape has to actually
match: the profile page's post placeholder was `space-y-4` with no thumbnail
against a `space-y-3` card that opens with an 80px cover, so the list re-spaced
vertically *and* shifted sideways the moment the posts landed — which is the one
thing a skeleton exists to prevent.

`Badge` is a *mark* and `Chip` is a *control*. If it has no click handler and no
dismiss cross, it is a `Badge`.

**There are two text fields, and the label decides which.** They are one family
— same 12dp corner, same tone vocabulary, same `.m3-field` shell — and they
differ in exactly one thing, the boundary.

A **labelled** field is a slot in a form: it has a name, that name has to survive
being filled, and it gets M3's *outlined* field with the label floating into the
outline. The label used to sit stacked above the control, and the argument for
that was that M3 allows both and changing ~40 forms bought nothing. It buys one
thing, which is the whole point of the pattern: an empty field and a filled one
stop being different objects. With a stacked label, a form of six empty fields is
six blank boxes and six captions floating between them — and the caption
belonging to the box *below* it is exactly as close as the one belonging to the
box above.

An **unlabelled** field is not a form slot. It is a search box, an admin filter,
a chat composer — a thing you type into and act on immediately, whose placeholder
is its whole identity. It gets the *filled* treatment: `surface-container-high`,
no border, no shadow. Dressed as an outlined field it read as a form control
whose label had failed to load, and it put the heaviest boundary on the screen
around the least ceremonial thing on it. The tone step is the same one the
unselected filter chip takes and the same one `Select`'s trigger already had, so
a filter bar of a search box and two dropdowns is now one material rather than
three.

The notch is a real `<fieldset>`/`<legend>` pair, not a label painted over the
border with a matching background: an M3 outlined field has no fill, so there is
no colour to paint with, and a `<legend>` is the only thing in CSS that removes a
section of a border. Two elements therefore carry the same words — the `<label>`
the user reads and an invisible copy inside the `<legend>` whose only job is to
be the right width. They stay in step because the legend's font-size is exactly
0.75x the label's and the label scales to 0.75 as it floats, 0.75 of `body-l`
being `body-s`. All of that lives in `.m3-field` in globals.css, because it turns
on `:focus-within` and `:placeholder-shown` matching against a *sibling*.

That `<fieldset>` carries a negative top inset whose entire job is to cancel the
UA drawing the top border through the vertical centre of the `<legend>` — so it
must be zeroed when there is no legend. It was not, and the cost was invisible in
review and obvious once measured: an unlabelled 44dp field painted its line 6px
above its own box, standing 50dp tall with its text 3px off the outline's centre.
When a field's geometry looks *slightly* wrong, measure the painted line, not the
element's rect.

**Focus is the same indicator on both, painted in the two places each boundary
leaves room for.** The outlined field has no ring: its focused outline is
`primary` at 2px, which is the ring's colour at the ring's weight, drawn as the
control's boundary instead of as a second boundary 2px outside the first — a
control whose whole identity *is* a 1px outline cannot wear a ring around that
outline without reading as two nested boxes. The filled field has no outline to
nest inside, so that objection does not apply and it takes the ordinary ring.
Both key off `:focus-within`, because the element wearing the indicator is the
container and it is reporting on the control inside it.

**An unlabelled field can carry its own actions.** `trailing` puts controls
inside the box — /search's submit and 以图搜图 live there. It is a flow item, not
an overlay, so one button, two, or a button with a word in it all fit with no
width reserved at the call site; the control shrinks by exactly the slot's width
because the slot refuses to shrink and the control's `min-width: 0` lets it.

**One inset, all the way round the slot: 8dp.** That is `(56 - 40) / 2` — the field's
height minus the control's — so it is not a chosen number, it is the only value that
centres the control. It read 4dp between the two controls against 8dp at the field's
edge, and two different insets around one object is what reads as "the button is not
centred": the eye takes the smaller gap as the intended margin and the larger one as
a mistake. It also makes the concentric-corner rule checkable, since `inner = outer -
gap` needs a single `gap`. And only **one** control in the slot carries a container —
the primary action. A field's trailing icon is a glyph at `on-surface-variant`
(`TrailingIconColor`), so 以图搜图 is a `standard` icon button; two filled containers
inside one pill gave the secondary action the primary one's voice.

Judge it per field, though, and the composer is the counter-example: /messages
briefly had send and emoji inside the field and it was worse. A search box is one
field and one action pressed once, so collapsing them into a single object helps.
A composer is the thing you live in while typing, and burying send in it turns
three plain targets into one crowded box.

`Input` has **one height for a form slot and one for chrome**, and the first split is
content rather than density: both the labelled and the unlabelled field are M3's 56dp,
and `size="lg"` is M3's *search bar* — also 56dp, but a pill, which exists for the
single field on /search that is the whole point of its page. The pair used to be 56/48
on the argument that a floating label needs two rows and an unlabelled one does not; 48
is not a height the spec offers for a field (`OutlinedTextFieldTokens.ContainerHeight`
is 56) and it left the two reading as different objects, which is the opposite of
what this section claims about them. They differ in exactly one thing, the boundary.
A labelled field with nothing to suggest is given a single-space placeholder,
because `:placeholder-shown` is what tells the label whether the field is empty and
it only matches while a placeholder exists.

`size="sm"` is the other axis — 40dp with `body-m`, matching `Select size="sm"` to the
class string, for a field that is *chrome*: an admin filter, a control in an `.m3-row`.
M3 offers no 40dp field, so this is a stated divergence, and its argument is the
enclosure: the neighbours are a 40dp dropdown and a 32dp chip, and every field in the
app being 56 made the filter the tallest thing on the densest screens. It is
unlabelled-only, because the notch's legend width, float distance and negative fieldset
inset are all derived from 56dp — and a labelled field lives in a form column anyway.
It takes **no `trailing` slot**: that inset is `(56 − 40) / 2`, so a 40dp box has no
room to centre a 40dp control, and forbidding it is what keeps "one inset for every
field size" true rather than forking it. `SearchInput` bakes it in rather than offering
it, since every call site of that component is a filter bar.

A `Textarea` follows the same rule through its block padding rather than a fixed
height, since it grows. Get the number by measuring, and note the measurement is not
the one the type scale predicts: this app's `body-l` line box is 28px rather than the
scale's 24, because the body line-heights run looser for Han glyphs (a documented
divergence several sections down). So symmetric **14px** is what lands a one-row
unlabelled textarea on `BARE_HEIGHT`'s 56dp.

It was 10px, and that is worth keeping as a warning: 10 was correct when an unlabelled
field was 48dp, and when 48 left the control-height scale the textarea was quietly left
behind — so a textarea and an input of the same kind sat a step apart. It surfaced in
the one place they sit side by side, /messages' composer, where the field ended up
*shorter than the two buttons flanking it*. A derived number needs a line in the
docstring saying what it was derived from, or the next scale change orphans it.

Both are easy to write out by hand without noticing, because the class string is
short and looks harmless: `rounded-full px-2 py-0.5 text-label-m` plus a
container/ink pair was pasted at fifteen sites, in three type roles, and each one
had to name both halves of its colour. The tell is `rounded-full` on something
holding text that is not a button — for a dismissible tag that is also the wrong
shape twice over, since a chip is 8dp.

`Button` variants, so a semantic action never has to be hand-rolled:
`filled` · `tonal` · `accent` · `text` · `danger` · `danger-text` ·
`success` · `warning`. The four semantic ones take the scheme-independent
`*-fill` pair rather than the `error`/`success`/`warning` *text* roles, which flip
between schemes — a filled confirm button wearing a text role visibly swapped
shade with the theme. `danger-text` exists because `variant="text"` plus a
`className="text-error"` emits two colour utilities and lets Tailwind's output
order decide which wins; `cn` is a plain join and resolves nothing.

**There is no outlined button**, and M3 does specify one. This had it, and all
four uses were a secondary action beside a filled primary one (取消 next to 保存,
重置 next to 检索) — at that job a 1dp keyline reads as a button that lost its
fill rather than as a quieter button. `tonal` is the step M3 puts directly below
`filled` for exactly this pairing, and it separates from the surface the way
everything else here does, by a container tone rather than by an edge. Removed
rather than left unused, because a variant that exists gets reached for. The same
reasoning retired the filled field's border and the filter chip's: this app
separates by tone.

`IconButton` keeps its `outlined` variant, and that is not an inconsistency — it
is the one "switch that is currently off", which is what M3's outlined icon
button means. It also owns the shape axis: `shape="square"` is the back
affordance's 12dp corner.

## Colour

Only `--md-sys-color-*` tokens, via their Tailwind utilities (`bg-surface`,
`text-on-surface-variant`, `border-outline-variant`, …). No raw hex, no `rgb()`,
no Tailwind palette classes (`bg-slate-800`, `text-red-500`).

A `dark:` variant is almost always a bug: the token already flips. The legitimate
uses are swapping a whole asset (`Logo.tsx`) and nothing else. Reach for the
container/on-container pair instead of hand-picking a second tint.

Pair only within a role — `primary`/`on-primary`, `surface-container`/`on-surface`.
Dividers use `outline-variant`; text-field borders use `outline`.

**`scripts/palette.mjs` generates every tonal value, and it is the authority.** Run
`npm run colors` for a diff and the contrast table, `npm run colors:write` to
substitute the declarations in place — it only touches
`--md-sys-color-<token>: #hex;` lines, so the ~40 paragraphs of reasoning between
them survive. It is **idempotent** against the current file, which is the check that
those values are still the recipe's output rather than someone's edit, and it exits
non-zero rather than writing if a tone lands off target or the neutral-variant
palette's chroma moves.

The basis is **HCT**, because that is the space M3 quotes its own numbers in: "neutral
chroma 6" means 6 in HCT, and no single OKLCH chroma means the same thing at every
lightness. Role → tone is verbatim from AOSP's `ColorLightTokens.kt` /
`ColorDarkTokens.kt` (v0_210). `accent-*` stays in OKLCH and that is not an
inconsistency — an even hue sweep at fixed lightness and chroma is the entire point of
that scale, and OKLCH is where that relationship is expressible.

To change the brand: edit `SEED` in the script, run it, paste, then update
`viewport.themeColor` in `app/layout.tsx` by hand (the browser reads that meta tag
before any stylesheet exists, so it cannot be a `var()`) and re-check `.logo-keyline`
against the Lottie artwork, whose hand-drawn roses do not follow the token.

**Which container step a component takes is the spec's decision, not the
designer's eye.** M3 names one per component, and getting it wrong is invisible in
isolation and obvious as a set — the app's four biggest surfaces were each off by
one step in the same direction, so nothing looked broken and nothing separated
from anything:

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

The progress row is the one that had drifted furthest, and it is worth stating in
full because it took six copies to notice. `LinearProgressIndicatorTokens` puts
`Height`, `TrackThickness` and `ActiveThickness` all at **4dp**, so there is no size
axis; the track is `secondary-container`; the indicator is `secondary` or a `*-fill`; the fill is
`scaleX` on a `transform-origin: left` box rather than an animated `width`, because
`width` is a layout property and one of these runs live inside the image overlay
while a flight is landing. Six hand-rolled tracks carried three heights (4 / 8 / 10,
the last not even on the 4dp grid), three track tones, two drive mechanisms and
**no `role="progressbar"` at all** — so no progress in the app was announced,
including the 词库 sync, which is the one place a user has to wait. `ProgressBar`
owns all of it. `TrackActiveSpace` (a 4dp gap between indicator and remaining track)
is knowingly not implemented: it needs the remaining track's leading edge to follow
the value, which is the layout work `scaleX` is there to avoid. `StopSize` is.

The dialog is the instructive one: it was `surface-container-lowest`, the *flattest*
step on the scale, so the one surface in the app meant to read as lifted off
everything else was painted lighter than the page behind it and relied entirely on
its shadow to separate. Tone first, shadow second, is the whole M3 depth recipe;
that had it exactly backwards.

The tooltip is the one place `inverse-surface` is right, and that is not in tension
with the snackbar's note further down. `inverse-surface` flips between schemes,
which is wrong for a **severity** — the same message must not arrive as a dark chip
in one theme and a light one in the other. A tooltip carries no severity; its whole
job is to contrast with whatever surface it is over, and flipping is how it keeps
doing that.

**An alpha on a token is a bug.** `bg-primary/10`, `border-error/40`,
`text-on-media/60` — each one has to be eyeballed once per scheme, and each one
drifts, because nothing makes the next call site pick the same number. The
symptom is always the same: the tint that looked right on the light surface is
nearly invisible composited over the dark one. Use the tone scale
(`surface-container-*`) or the container/on-container pair instead. If you need a
weight that no token has, add the token.

**There is now exactly one legitimate alpha at a call site**, and it is not a
colour: the `--md-sys-state-*` opacities, which are M3's own `StateTokens` numbers
and which reach call sites through `state-layer` rather than by hand.

The other two that used to be listed here are gone, and both were listed as
"legitimate" while being wrong:

- `bg-scrim/50` was described as "one value, three call sites". The value is
  **0.32** (`ScrimTokens.ContainerOpacity`), so all three were 56% too heavy — and
  there was a fourth, at 62%, hidden inside an arbitrary `shadow-[…]` in
  `ImageCropper`, which is what kept anyone from noticing the app had four. The dim
  is `bg-scrim-veil` now and the crop mask is `--md-sys-color-crop-mask`: two
  different objects, two tokens, no number at a call site. A crop mask being
  heavier than a dialog dim is a real distinction — it has to make "outside the
  crop" inactive while staying legible enough to aim with — and naming it is what
  makes that a decision rather than a stray weight.
- `bg-on-surface-variant/40` on the sheet's drag handle was not an M3 number at
  all. `SheetBottomTokens.DockedDragHandleColor` is `OnSurfaceVariant`, full
  strength, and `SheetDefaults` passes it unmodified.

The general shape of the fix is the same every time: if you need a weight no token
has, **add the token** — and if the thing you are weighting turns out to be a
different object from the one the existing token serves, that is the answer to why
the number kept drifting.

**An element `opacity-NN` used as an ink weight is the same bug.** The rule above
only ever named alphas *on tokens*, so the identical drift grew back through the
other door: a quoted reply preview dimmed to 70% in two components that had each
picked that number alone, an English tag name at 50%, a footer wordmark at 60%,
a banner icon at 80%. None of them agreed and none of them could, because there
was nothing to agree with. Reach for a *type role* first (a supporting line is
`body-s` under a `body-m`, not a faded copy of it), then for
`on-surface-variant`, then add a token. Element opacity is legitimate for motion
(a fade, a hover reveal, a collapsing `grid-rows-[0fr]`), for the gallery's
paging dim (one value, two matched call sites), and for `disabled-content`.

**Disabled content is `disabled-content` (38%), and nothing else.** M3 specifies
38% and the app used five weights — 40 on `IconButton` and `Pagination`'s arrows,
50 on `Button`, `Chip`, `Checkbox`, `ToggleSwitch`, `Select`'s trigger and
`DropZone`, 60 on `Input`, 70 on the captcha handle, and a lone 38 inside
`Select`'s menu. Two files disagreed with *themselves*: `Pagination` faded its
arrows and its numbers differently, and `Select`'s trigger and the menu it opens
did not match. It is a `@utility` in globals.css rather than a colour so that a
control's border, glyph, label and container fade together in one declaration,
and it composes with the variant: `disabled:disabled-content`.

**Text and marks on photography** have their own three roles, mirroring
`on-surface` / `on-surface-variant` / `outline-variant`, because a picture is not
a surface and none of the surface roles apply over one:

| On media                            | Role                 |
| ----------------------------------- | -------------------- |
| Primary ink — a title, a tag chip   | `text-on-media`      |
| Secondary ink — caption, meta, +N   | `text-on-media-variant` |
| A rule or track — crop guides, bars | `bg-media-outline`   |
| The plate ink sits on               | `bg-media-plate`     |

`bg-media-plate` is the one answer for a format badge, a score pill, a caption
bar or a hover veil. It replaced `bg-scrim/40`, `/50`, `/55` and `/60` — four
weights for one object, with the two that sat closest together on screen the
furthest apart.

**Focus** is one ring for the whole app: `focus-visible:ring-2 focus-ring`, or
`focus-ring-on-primary` for chrome on the app bar. Over a **photograph** it is
`focus-visible:inset-ring-2 focus-ring-on-media`, and the inward direction is not
optional: that ring resolves to `on-media`, i.e. white, and an outset white ring
puts its outer edge on the picture where a bright subject takes it to 1:1. Inward it
sits on the control's own `bg-media-plate`, where the worst case — a pure-white
subject under a 55% black plate — still measures 4.8:1. `IconButton
variant="media"` supplies that plate and switches the ring width itself; anything
else reaching for this needs one too. Never tint it per variant — a focus ring
answers "where is the keyboard", so it has to look identical on every control. It is
solid,
not tinted: `primary/40` composites to about 1.4:1 against a light surface, under the
3:1 WCAG 2.4.11 asks of a focus indicator.

**The ring is `secondary`**, which is what M3 names it — `FocusIndicatorColor` is
`Secondary` in `MenuTokens`, `SearchBarTokens`, the card tokens and the chip tokens
alike. It was `primary`, and the measurement is why that matters: on a filled button it
was `primary` on `primary`, i.e. **1:1**, so the app's most prominent control had no
visible focus state at all, and against the light surfaces it measures 2.94:1 and
2.39:1 — both under the 3:1 bar. `secondary` measures 6.15:1 / 5.00:1 light and
10.89:1 / 7.25:1 dark. The two exceptions exist because neither role has any guaranteed
contrast on the brand bar or over a picture.

**An outset ring is drawn on the surface *behind* the control, not on the control**, so
do not "fix" `Button variant="filled"` to use `focus-ring-on-primary`. `ring-2` is a
`box-shadow` painted just outside the border box: on a filled button those pixels are
the page, where `secondary` measures 6.15:1. The 2.09:1 figure in globals.css's table
is for a ring drawn *on* a primary-coloured surface, which happens on the app bar and
nowhere else — that is what `focus-ring-on-primary` is for, and `IconButton
variant="on-primary"` already carries it.

The third form is `focus-visible:inset-ring-2 focus-visible:focus-ring-inset`,
and it is the same ring painted inward rather than a second style. A ring is a
`box-shadow`, so an ancestor that paint-contains throws it away entirely — and
the app has two kinds that do: a gallery card (`.image-card` is
`contain: layout paint style`) and any media box clipping its corners with
`overflow-hidden rounded-*`. A full-bleed control inside one of those — the
spoiler cover, a zoom target — was rendering a focus indicator that was then
discarded. Reach for it only when the enclosure clips; everywhere else the ring
goes outside, where it does not eat 2px of the control.

The **outlined text field** has no ring, and that is not an exception to the rule
above so much as a fourth place the same ring is painted. Its focused state is
its own outline at `primary` and 2px — the ring's colour, at the ring's weight,
drawn as the control's boundary instead of as a second boundary 2px outside the
first. A control whose entire visual identity *is* a 1px outline cannot wear a
ring around that outline without reading as two nested boxes, and M3 specifies
the thickened outline as this control's indicator for that reason. The *filled*
field has no outline to nest inside, so it takes the ordinary ring — same
indicator, different place to put it. Everything else about both is unchanged,
including that the colour is the same on an error field: a focus ring answers
"where is the keyboard", never "what is wrong".

**`outline` is a boundary role, not an ink role.** It is built for a rule or a
text-field border and is specified to 3:1, which is the bar for a *non-text*
element. Measured against this app's own light surface it lands at 4.3:1 —
under the 4.5:1 WCAG AA asks of normal-size text — while in the dark scheme it
reaches 5.8:1 and passes. That asymmetry is why `text-outline` spread to 57
pieces of supporting text before anyone noticed: it is only wrong in one of the
two schemes, and it is the scheme people ship from less often. Supporting text
is `on-surface-variant` (8.5–9:1 light, 10:1 dark). `text-outline` on a *glyph*
is fine — 4.3:1 clears the 3:1 non-text bar.

**A state is a container, not a rule down the side.** An unread notification, a
selected row, a quoted reply — the reflex is a 3–4px coloured bar at the leading
edge, and the app had it in several places. M3 has no such element: the way a
list item says "unread" or "selected" is that it wears a container pair, and the
way a block of text says "quoted" is `<blockquote>`'s own treatment. So an unread
system message is `secondary-container` / `on-secondary-container` across the
whole row, and the bar is gone. Note the ink half is not optional: the row's
title and body have to *inherit* the on-container colour, so write
`text-on-surface`/`text-on-surface-variant` into the read branch only — a hard
`text-on-surface` on the heading survives the container change and leaves you
with a coloured row whose text still belongs to the old one.

The reply quote keeps its rule, because there the bar is not a state — it is the
one thing distinguishing quoted text from the reply around it, and it is what
`<blockquote>` has looked like for thirty years. It is 4px `primary` (the same
colour as the `<cite>` under it, so the quote and its attribution read as one
object) over a `surface-container-high` fill, which is the same tone step as
everything else in this file that means "a distinct block inside this one".

**A filter control that is not selected is a tone step, not a keyline.** The
unselected `Chip`, `Select`'s trigger and the filled text field all sit at
`surface-container-high` with no border and no shadow, so a filter bar reads as
one material. This is the same decision as the outlined `Button`'s removal, and
the shape section's concentric-corner note is its geometric half: this app
separates things by tone and by corner, not by edges.

Deliberate divergences from the spec, all commented where they live. Do not
"fix" them:

- `primary`, `*-fill`, `media-stage`, `on-media*` and `media-plate` do not invert
  between schemes. A brand colour, a graphic fill and anything sitting on a
  photograph must read as one constant material; only text roles flip. `primary` is
  the brand pink at **tone 61 light / 54 dark**, the one role off AOSP's tone map —
  and the *direction* is inverted too, which is worth stating because it looks like a
  mistake. M3 puts primary at P40 light / P80 dark because the brand has to separate
  from the surface it sits on and that surface is near-white in one scheme and
  near-black in the other, so the spec's light tone is the *darker* of the two. This
  app holds the pink instead of a tone of it, seven tones apart, which reads as one
  colour with a little separation from each ground.
  **What it costs, so nobody rediscovers it as a bug:** white ink on it is 3.08:1 light
  and 3.87:1 dark, under the 4.5:1 AA floor for 14px text — the label of every `filled`
  button, the active pagination number, the featured badge. It is not fixable in place:
  contrast is a function of the fill and the ink, and both levers have a visible price
  (a single tone at 48 clears it at 4.81:1 but reads deeper and duller; `on-primary` at
  P10 clears it at 5.71/4.54 but puts dark glyphs and a dark wordmark on the app bar).
  Neither is taken. The bar itself is not the failing case — glyphs and a wordmark are
  non-text and need 3:1. As *ink on a surface* the tone is 2.94:1 light / 4.79:1 dark,
  so `text-primary` is for a glyph or an emphasis mark, body text takes
  `on-surface-variant` and navigable text takes `link` — which is why that role exists.
- **Body** line-heights run looser than the spec and tracking runs at half the spec
  value, because Han glyphs fill the em box. The **label** roles do not — all six are
  at the spec exactly, and this line used to claim otherwise. `body-l` is 1.75 (the
  prose role, and `Textarea`'s block padding is derived from its 28px line box);
  `body-m` and `body-s` are 1.5, halfway back from the 1.65/1.6 they carried, because
  they are the app's metadata and supporting lines rather than paragraphs and the extra
  3px landed on every row in the app.
- `accent-*` is a _categorical_ scale (tag categories, staff roles), not a
  semantic one. `lib/tagCategories.ts` is the only thing allowed to pick a hue.
- **The top app bar is `primary`, not `surface`.** M3's app bar takes a surface
  role and elevates on scroll; this one is the brand bar, which is why
  `IconButton` has an `on-primary` variant and why `focus-ring-on-primary`
  exists. It is the one piece of chrome that does not sit on a surface.
- **The elevation shadows are half the spec's alpha.** M3 gives the key shadow
  30% black, tuned against a pure white page; these surfaces are a warm
  off-white that reads 30% black as dirt. Halved — but held *constant* across the
  five levels, which is the part that matters (see the Elevation section).
- **A snackbar is a `*-fill` tone, not `inverse-surface`.** The spec's role flips
  between schemes, so the same message would arrive as a dark chip or a light one
  depending on the theme; the four severities hold one saturated tone each.
- **`AuthModal` is `max-w-4xl`.** M3 caps a basic dialog at 560dp; this is a
  two-pane sign-in with an illustration beside the form, which is closer to a
  full-screen dialog than to a basic one.
- **The navigation drawer is 288dp, not 360.** `NavigationDrawerTokens.ContainerWidth`
  is 360, which is right for a drawer you dismiss. This one is *docked* from `md` up,
  so its width comes out of the content area rather than being laid over it — and on
  an image gallery those 72px are a column of thumbnails.
- **The docked drawer keeps the *modal* container colour.**
  `NavigationDrawerTokens.StandardContainerColor` is `Surface` and `ModalContainerColor`
  is `SurfaceContainerLow`; this drawer takes the latter in both states. The content
  beside it is a `surface` card inset from `sm` up, floating on a
  `surface-container-low` page — so giving the docked drawer `surface` would paint it
  the same tone as the card next to it and erase the boundary between them. On a phone
  the drawer is modal anyway, which is where the token's own value applies.
- **The unselected filter chip is a tone step, not a keyline.**
  `FilterChipTokens.FlatUnselectedOutlineColor` is `outline-variant` over no container
  at all; this app fills it with `surface-container-high` and drops the border, which
  is the same decision as removing the outlined button. It separates by tone.
- **Breakpoints are Tailwind's 640/768/1024/1280, not M3's window size classes**
  (600/840/1200/1600). Agreeing with the `sm:`/`md:`/`lg:` utilities every file
  already uses matters more here than agreeing with the spec's numbers, and
  `BREAKPOINTS` in `lib/constants.ts` is what anything branching in JS reads so
  the two cannot drift. Worth knowing when reading M3's adaptive-layout guidance:
  this app's `md` is not M3's medium.

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

The scale itself is M3's: 0 / 4 / 8 / 12 / 16 / 20 / 28 / 32 / 48, and there is
nothing between those steps. `rounded-3xl` was 36dp, which is not one of them —
the token moved rather than the two call sites, since 36 was only ever the
distance between 28 and 48 split in half.

Two rows are worth stating because the object looks like something it is not. A
**snackbar is 4dp**, `corner-extra-small`, and not the 8dp menu step it was
wearing: it is a transient message, not a surface you act inside. And the
**navigation drawer rounds only its trailing corners**, and only while it is
modal — a docked drawer is flush with the edge it is docked to, so the rounding
is `rounded-r-lg md:rounded-none`.

**A box inside another box does not take its own row of this table.** Nested
corners are concentric when `inner = outer - gap`, and the eye reads a violation
of that immediately: an inner corner rounder than `outer - gap` bulges toward the
frame, a squarer one leaves a visible crescent of dead space. So look up the
enclosure's radius, subtract the gap, and use that — the table gives you the
*outermost* box's step, not every box's.

The rule only bites while the gap is small. Two corners 16px apart are not a ring
inside a ring, they are neighbours, and forcing the arithmetic there produces a
0dp corner on something that should not have one — which is exactly what
`DetailBack` documents about itself. Treat roughly 8px as the line.

The shortcut worth knowing: **a centred pill inside a pill is concentric for
free, at every size.** `outer - gap` is always half the inner control's height
when the inner control is a capsule, so the arithmetic can never be wrong. That
is why /search's field is a 56dp pill rather than a 12dp box: the submit button
and 以图搜图 sit in its trailing slot, and at 12dp with a 4px gap they would each
have needed a remembered 8dp corner, whereas two ordinary pills in a pill are
correct by construction. A square-cornered `Button` variant was added for the
12dp version and then removed with it — `inner = outer` is the misreading of this
rule, not the rule.

A **chip is 8dp, not a pill.** This table used to say `rounded-full`, which
contradicted `Chip.tsx` — the primitive has always rendered the spec's 8dp — and
the contradiction had a cost: four filter chips in `/search` and the admin
console were hand-rolled as `rounded-full px-3 py-2` pills, presumably by
someone reading this table rather than the component.

**A menu and a text field are both 4dp, and getting there took two wrong turns
worth recording.** `Select` first rendered its menu at 4dp with a comment arguing
for it while the emoji picker rendered 8dp arguing the opposite; that was settled at
8dp by reading a spec *summary* which says the `small` step covers "text fields,
menus". The summary is wrong, or at least lossy: `MenuTokens.ContainerShape` and
`OutlinedTextFieldTokens.ContainerShape` are both `CornerExtraSmall`, and
`FilledTextFieldTokens.ContainerShape` is `CornerExtraSmallTop`. A chip, meanwhile,
is `CornerSmall` — 8dp — from `AssistChipTokens` and `FilterChipTokens` alike, which
is what this table said all along.

So the rule that came out of it is not about menus: **read the token file, not the
summary table.** The generated `androidx.compose.material3.tokens` sources are the
machine-readable form of the spec and they are fetchable —

    base=https://android.googlesource.com/platform/frameworks/support/+/refs/heads/    androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3
    curl -s "$base/tokens/<Component>Tokens.kt?format=TEXT" | base64 -d

— and every number in this file that says "M3 specifies" should be checkable that
way. Where a summary and a token file disagree, the token file is what generates
the components.

Write the step you mean. A bare `rounded` resolves to `--radius` (4dp, the same
as `rounded-xs`) but says nothing about *why*, which is how 92 call sites ended
up at 4dp with no role between them — icon buttons that wanted `full`, badges
that wanted `full`, skeleton bars that wanted whatever the thing they stand in
for wants. `rounded-xs` is the step; use it where 4dp is the answer.

A **badge is a rounded rectangle and a count is a pill**, which is one row of
this table split in two. M3's badge shape is round because M3's badge is a
*number* — a dot, or a count no wider than it is tall, which is what `CountBadge`
renders. A badge carrying a word (Lv.13, 已核验, an earned badge's name) is a
short block of text, and a full pill around text reads as a button that has lost
its handler, which is the same confusion `Chip` sits on the other side of. 4dp
rather than the chip's 8dp because the box is only ~20px tall at `sm`, where an
8dp corner is 40% of the height and is a capsule again — pick the radius against
the box, don't inherit it from a bigger relative.

A **chat message is a list row, not a lozenge** — 16dp, with the seams inside one
turn cut to the grouped-list 4dp. This used to be the 28dp step, on the argument
that roundness *is* the semantics of a speech bubble and that a bubble is the one
place a small element may take the largest one. The argument is real and it lost to
the thread it produced: at 28dp a two-word message is a capsule and a long one is a
stadium, so a column of them reads as a bag of lozenges rather than as something you
can scan. What a thread keeps from the bubble is per-message width — each row is
only as wide as its own text — and the ragged right edge is what carries the rhythm
of speech. The gap between rows of one turn is 2dp (`ListTokens.SegmentedGap`), which
is what lets the 4dp seams close against each other. See `ChatBubble`.

A **placeholder inherits the radius of the thing it replaces**, so `Skeleton`
stands its own default down when the call site names one. `cn` is a plain join
and does not resolve Tailwind conflicts, so passing a radius used to emit two and
let output order decide.

`rounded-lg` is pinned to `HERO_TARGET_RADIUS_PX` in `lib/hero/constants.ts` —
the shared-element flyer morphs its corner to that value on landing, so the two
must stay equal.

## Elevation

`shadow-e1` … `shadow-e5` only. Never `shadow-sm/md/lg/xl` — those are tuned for
a white page and are invisible on the dark scheme's near-black surfaces.

Depth comes from the `surface-container-*` tone scale first; a shadow is for
things that genuinely float (dialogs, popovers, the FAB).

The level is decided by the object, not by how much it should stand out:

| Object                                   | Level |
| ---------------------------------------- | ----- |
| Elevated card, modal bottom sheet        | `e1`  |
| **Menu, popover, autocomplete**, nav bar | `e2`  |
| Dialog, FAB, search, snackbar            | `e3`  |

Four floating surfaces sat at `e3` — the share menu, the emoji picker and two
autocompletes — which put a tray of emoji above `Modal`. `Popover` owns this now;
if you are typing an elevation onto a floating panel, you are hand-rolling one.

**Most things are level 0, including every button.** M3 puts the filled button at
level 0 at rest and level 1 on hover, and nothing else: pressed goes back to 0,
and the tonal, text and outlined variants have no elevation at any point. An
*icon* button is level 0 in all four of its variants. Both were a step high here —
`e1` at rest rising to `e2` — which is what made a row of buttons read as a row of
floating chips, and what made the hover lift invisible, since it was a step
between two shadows rather than the appearance of one. A pagination number, a
slider handle and a table row are level 0 too.

The list of things that legitimately float is short, and it is the three rows
above. If what you are reaching for is not one of them, the answer is a
`surface-container-*` step, not a shadow.

**The ladder holds its alpha constant and grows only its geometry.** That is how
M3 specifies it, and getting it backwards is invisible one level at a time and
obvious across the set: the shadows used to ramp 0.05 → 0.10 in the light scheme
*as well as* growing their blur, so five levels spanned a factor of two in alpha
and `e1` beside `e2` could not be told apart. If you are adding a level, copy the
alpha and change the geometry.

**The dark scheme is the one carve-out, and it is deliberate.** Its ladder does
ramp — 0.30 → 0.45 on the key layer, 0.20 → 0.32 on the ambient — because on a
near-black ground a shadow is not reporting height, it is the only thing
separating one surface from another, and the tonal steps already carry the height.
It also starts at the spec's full 0.30 rather than the halved value the light
scheme uses. Both are stated where the values live, in `globals.css`; do not
"fix" either to match the paragraph above.

## Stacking order

App-level layers are the `--z-*` tokens in globals.css, used through their
utilities (`z-dialog`, `z-popover`, `z-toast`, …). The order is stated once,
there, with the reason for each step. Fourteen raw values were in use before,
and two of them collided: `Toast` and `LoadingOverlay` were both at 9999, so
which covered which was decided by DOM order. The image detail's tag dialog
carried a hand-typed 9998 meaning "above everything", which in fact put it one
step *below* the lightbox and therefore behind it.

Layering *inside* one component — a preview over its own final image, a switch
handle over its own ripple — stays a small integer. Those neighbours are the
component's own children, and giving them tokens would imply they take part in
the global order, which is the one thing they must not do.

## Typography

The fifteen M3 roles: `text-display-*`, `text-headline-*`, `text-title-*`,
`text-body-*`, `text-label-*`. Never `text-sm`/`text-lg`/`text-[13px]`.

**Every one of the fifteen roles declares its own `font-weight` token**, and
`@layer base` gives `h1`–`h6` only a size and a line height. Adding
`font-bold`/`font-semibold` on top of a role overrides the token — don't.

Seven of them used to declare none — `display-*`, `headline-*`, `title-l` — on the
reasoning that `@layer base` owned the heading weight and a utility must not fight
the element. It does not survive a role landing on an element other than the one
it was imagined on: `text-headline-s` rendered **700** on `AuthModal`'s `<h1>`,
**600** on `Modal`'s `<h2>` — the same dialog-title role at two weights — 400 on a
`<span>`, and `text-headline-s-emphasized` at 500 came out *lighter* than either
heading. Three weights for one role, the emphasized one the lightest of them.
`TypeScaleTokens` gives all fifteen a base weight and the seven are uniformly
`WeightRegular`; utilities sit in a later layer than `@layer base`, so declaring it
is what makes a role render the same wherever it is put. **M3 headings are
Regular** — the heavier line is the `-emphasized` role, which is a decision at the
call site rather than a property of the tag.

A bare `font-medium` / `font-semibold` on an element with **no** type role is the
same bug wearing different clothes: the size then comes from whatever the parent
happens to be. Reach for the role's `-emphasized` twin instead — but check the
weight you are actually getting, because the twins are **not** all one value:
`label-*` and `title-m`/`title-s` step 500 → **700**, while `display-*`,
`headline-*`, `title-l` and `body-*` step 400 → **500**. This matters because
Tailwind's `font-medium` *is* 500: on `text-label-l`, whose own token is already
500, adding it changes nothing at all. Three pieces of shared chrome — the home
tab bar, `TabBar` and `Pagination` — marked their active item that way and so had
no weight contrast whatsoever, only colour.

Never emit two type roles on one element (`text-label-l` plus
`text-label-l-emphasized`). `cn` is a plain join; the winner is decided by
stylesheet order, not by which you wrote last. Put the role inside each branch of
the conditional so exactly one is ever applied.

The reverse reading is also gone: the body roles used to be described as the
exception that declared 400 "because they land on spans anywhere, including inside
a heading". That is true and it is now true of every role — a role that does not
declare its weight inherits one, and inheriting one is the bug.

## Rich-text rhythm

Two renderers put user prose on screen — `MarkdownRenderer` and
`BBCodeRenderer` — and the rule is that **they emit the same document**, so one
set of rules can space both. `.bbcode-content` and `.rich-text-content` are
styled together in globals.css and neither renderer styles its own output.

This was the source of the forum's spacing complaints, and neither cause was
where it looked. First, nothing gave a paragraph a margin: Tailwind's preflight
zeroes `p`, only `img`/`blockquote`/`pre` were given one back, and so consecutive
paragraphs touched while the space around a picture was set by something else
entirely. Second, BBCode did not *have* paragraphs — every `\n` became a `<br>`,
so a "paragraph break" was one line-height, and next to an image's own margin
plus the stray `<br>` beside it the two gaps could not agree. `bbcodeToSafeHtml`
now splits on blank lines into real `<p>`s, keeps single newlines as `<br>`, and
eats the line breaks that end up adjacent to a block element.

The spacing is in `em`, so it scales with the container and a reply's rhythm is
automatically tighter than an article's:

| Element      | `margin-block`             |
| ------------ | -------------------------- |
| `p`          | `0.75em`                   |
| `h1`–`h6`    | `1.25em 0.5em`             |
| `ul` / `ol`  | `0.75em` (+1.5em start pad)|
| `li`         | `0.25em`                   |
| img, video, blockquote, pre, table | `1em`    |

Which means **the container has to name a type role**, or the `em` is whatever it
inherited: a forum post's body is `body-l` (it is an article) and a reply's is
`body-m`. The post body carried no role at all and took its line-height from
`@layer base`, so the two blocks of prose on one page were set differently.

The `> :first-child` / `> :last-child` margin resets stay — they are what keeps
the last paragraph from pushing the action row down by a stray line.

## Copy

The UI is Chinese, and the conventions below are the whole of it. They are worth
writing down because every one of them had drifted in both directions at once, and
because the wrong half is invisible to anyone reading a single file.

| | |
| --- | --- |
| Ellipsis | `…`, never `...`. 44 sites used ASCII against 2 correct ones |
| Colon after a Chinese label | `：`, never `: ` |
| Comma inside a Chinese sentence | `，`. Half-width `,` only in a value the user types |
| Parentheses in Chinese prose | `（）`. Keep `( )` only where the parenthetical is a Latin identifier — `(banAnthro)`, `(GIF/视频)` |
| A Latin run beside CJK | one space: `图片 ID`, `API Key`. All ten no-space sites were in `components/admin/` |
| Toasts | no `！`. A snackbar is a status report; 7 of 291 shouted |
| Confirm body | `确定要…吗？`, with the formal 此/该 demonstrative. Never 这个, never a bracketed 【…】, never `！` |
| Confirm title / button | `确认X` / `确认`. `useConfirm` and `usePrompt` both default to 确认 |
| One verb per operation | 删除 destroys a record, 移除 detaches one, 清空 empties a list. `/history` used two of them for one button |
| Success | `已<verb>` (47 sites) rather than `<verb>成功` (28) |
| Failure | `{X}加载失败`, noun first. And one string for one condition: `网络错误` had six wordings across 24 sites |

The confirm register is the instructive one, because the copy split turned out to be
the *architecture* split seen from the other side: every tab that hand-rolled its own
`Modal` dropped the sentence-final 吗, and every tab that used `useConfirm` kept it.
Fixing one was fixing the other.

## Motion

**There are two motion systems and M3 draws the line between them, not taste.**
*Transitions* — something entering the screen, leaving it, or crossing it — are
easing plus duration, and that is the table further down. *Component* motion — a
handle travelling, a mark landing, a container growing out of its anchor — has
been **spring physics** since M3 Expressive, and it is the springs section below.

Reaching for `decelerate` on a switch handle is the mistake the split exists to
prevent. A bezier is a shape someone drew; a spring is a mass being pulled to a
target, and the eye can tell which it is looking at. That is the whole of what
"质感" means here, and it is why the app had none outside the hero flight: the
flight was the only real spring in the codebase, and no component could reach it.

### Springs — component motion

Nine responses, from M3's own generated token sets (`StandardMotionTokens` /
`ExpressiveMotionTokens`). Use them through the `spring-*` utilities in CSS or
`spring('name')` in GSAP, both of which carry the shape **and** its duration:

|            | standard        | expressive       | settle |
| ---------- | --------------- | ---------------- | ------ |
| fast spatial   | ζ0.9 k1400  | ζ0.6 k800        | 137 / 221ms |
| default spatial | ζ0.9 k700  | ζ0.8 k380        | 194 / 326ms |
| slow spatial   | ζ0.9 k300   | ζ0.8 k200        | 296 / 449ms |
| fast effects   | ζ1.0 k3800  | identical        | 108ms  |
| default effects | ζ1.0 k1600 | identical        | 166ms  |
| slow effects   | ζ1.0 k800   | identical        | 235ms  |

Pick by **what is changing**, then by how far it travels:

- **spatial** — it moves or resizes. Damping is below 1, so it may overshoot, and
  that overshoot is what reads as mass.
- **effects** — damping is exactly 1, critically damped, so it *cannot* overshoot.
  Usually that is what a fade or a recolour wants: an overshooting colour is a flash,
  and an overshooting opacity is **clipped** — a `linear()` value above 1 is capped,
  so the fade reaches full opacity early and then sits there. It is not only for
  fades, though. Reach for it whenever overshoot would be *wrong*, position included:
  M3 closes its own navigation drawer on `FastEffects` precisely because a panel that
  overshoots on the way out bounces back into view.

`expressive-fast-spatial` (ζ0.6) is the only visibly bouncy curve in the system —
8.4% overshoot, peaking at 63% of the run. It is for a small mark arriving in
place: an unread count, a favourite filling in, a radio dot landing. Anything
large wearing it reads as a wobble. And never put an `opacity` on it: its table is
above 1 from 45% to 97% of the run, so more than half of such a fade is the stall
described above — which is why the radio's dot and the icon-swap keyframe split
their scale and their opacity across the two families rather than sharing one.

**A component reaches for a *role*, not for a ζ and a k.** That is the shape of the
API in AOSP — `MotionSchemeKeyTokens.DefaultSpatial`, resolved by whichever
`MotionScheme` is in force — and it is the thing this app got structurally wrong for
a while: nine utilities exposing ζ and k directly meant the drawer picked standard's
slow tier, the tab indicator picked expressive's default tier, and the switch picked a
bezier. Three components, two schemes, one app. **This app's scheme is `standard`,**
which is also `MaterialTheme`'s own default; the expressive trio is a documented
exception for a small mark landing in place.

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
| Shared-element flight, opening | ζ0.9 spatial at `slowSpatial` (296ms) | the app's own family rule — it moves *and* resizes; `MaterialContainerTransform` runs `emphasized`, whose shape this is the nearest of the four to |
| Shared-element flight, closing | same shape at `defaultSpatial` (194ms) | `MaterialContainerTransform` returns faster than it enters (500:400); one tier down is that ratio on this ladder |
| Shared-element flight, swipe-release | `slow-spatial`, sliding to `fast-spatial` | `NavigationDrawer.kt`'s drag release — a gesture, so it keeps the spatial ζ0.9 |

A collapsible panel a press opens or closes is the drawer's case: the two drawer
springs, per direction, on every clock in the gesture.

Nine springs, **four shapes**. That is arithmetic rather than a shortcut:
normalise the timeline by the settle time and the curve depends only on the
damping ratio, with stiffness deciding duration alone. Verified numerically across
every stiffness that shares a damping ratio, to 1e-4. So globals.css ships four
`linear()` tables and nine durations, and the `spring-*` utilities pair them.

The two must never be split at a call site. A ζ0.6 shape on a 449ms clock is not
a slower bounce, it is a different object — which is why the pairing lives in the
utility and there is no `duration-spring-*` utility to reach for on its own.

Both renderers derive from one closed form in `lib/spring.ts`: CSS gets 32-point
`linear()` samples, GSAP gets the function itself registered as an ease, so the
scripted side has no interpolation error at all.

`--ease-spring` and `eases.spring` are gone. They were `cubic-bezier(0.18, 1.36,
0.5, 1)` and `back.out(1.55)` — two independent approximations of the same
physics, which is what a missing model looks like from the outside.

### Curves — transitions

M3 ships **two** easing sets and they are not interchangeable. `emphasized` is for
a large container transform or anything crossing the screen; `standard` is for a
small utilitarian change. Both have a decelerate and an accelerate variant:

| Token                          | Set        | Use                      |
| ------------------------------ | ---------- | ------------------------ |
| `--ease-standard`              | standard   | begins and ends on screen |
| `--ease-standard-decelerate`   | standard   | a small thing entering    |
| `--ease-standard-accelerate`   | standard   | a small thing leaving     |
| `--ease-emphasized`            | emphasized | a large container transform |
| `--ease-emphasized-decelerate` | emphasized | a page entering           |
| `--ease-emphasized-accelerate` | emphasized | a page leaving            |
| `--ease-symmetric`             | —          | an infinite alternating loop (reach for `--ease-loop`, its role name) |

`--ease-decelerate` / `--ease-accelerate` are **aliases of the emphasized pair**,
which is what every existing call site means by them. They were the only
decelerate and accelerate the app had, so every small utility transition was
reaching for a curve shaped for a full-window slide. Prefer the qualified name in
new code so which set is meant is stated rather than inherited.

In GSAP: `ease: 'standard' | 'standard-decelerate' | 'standard-accelerate' |
'decelerate' | 'accelerate' | 'emphasized' | 'symmetric' | 'loop'`.

**Every M3 curve is one-sided, and there is a third case neither verb covers.**
The tell is not the curve's name, it is where it spends the travel. Percentage of
the distance covered in each tenth of the duration:

| Curve                   | per tenth of the duration        | half-travel by |
| ----------------------- | -------------------------------- | -------------- |
| `emphasized-decelerate` | 62 16 8 5 3 2 1 1 0 0            | 7%             |
| `standard`              | 16 34 19 11 8 5 3 2 1 0          | 20%            |
| `emphasized-accelerate` | 1 2 3 4 6 8 11 14 20 32          | 82%            |
| `symmetric`             | 2 7 11 14 16 16 14 11 7 2        | 50%            |

The one-sidedness is deliberate and it is right for the two verbs M3 models:
*arrive* and *leave*. The front-loaded half of an arrival happens while the object
is still mostly off-screen, where nobody sees it.

A thing **travelling in place**, with both ends of its journey on screen, is
neither. It starts at rest and stops at rest, and on `standard` its fastest tenth
carries **97x** what its last tenth does — read, correctly, as a jump followed by
a stall. That third case is real, and **the answer to it is a spring, not this
third row** — see the panel note further down and the springs section above. What
survives here is only the *loop*: `--ease-symmetric` is 7.6:1 and identical at both
ends by construction, and `--ease-loop` is its role name, because a loop has no
arrival either and a one-sided curve makes its velocity discontinuous once per
cycle. **Reach for the role name.** Every non-loop use of `ease-symmetric` was a
travelling-in-place case that wanted the physics: seven determinate progress bars
had it, and they are `ProgressBar` on `spring-slow-effects` now.

**Vuetify is the reference for the arrangement**, and it is worth copying whole:
its navigation drawer uses *one* curve and *one* duration for both directions, and
its scrim shares both — `$navigation-drawer-transition-duration: 0.2s`,
`$navigation-drawer-transition-timing-function: settings.$standard-easing`,
resolving to Material **2**'s `cubic-bezier(0.4, 0, 0.2, 1)`. One curve serves
both directions because a symmetric one is the same shape read backwards, and the
scrim shares the clock because it is not a component fading in place — it is the
other half of the panel moving. M2's curve does ease in, which is the half M3
dropped, but it still tails off at 43:1, so what is borrowed is the arrangement
and the shape family, not the literal value; M2 easings remain a bug wherever the
tokens reach.

**If a container animates its size, check that its contents travel with it.** A
box shrinking under `overflow-hidden` whose child holds a fixed width does not
move that child — it guillotines it, and what is on screen is one edge sweeping
across stationary content while the neighbouring content slides at the curve's
rate. Two rates in one gesture, one of them zero. The drawer collapsed that way
for as long as it animated `width`, and it was blamed on the easing twice — first
on a bezier pair, then on a spring — because a timing function is the thing you
reach for when motion feels wrong, and no timing function can fix a part that is
not moving at all. Prefer translating the container and closing the layout behind
it with a negative margin: the contents come along because they are inside the
thing that moves, the box never resizes so its subtree never re-lays-out, and the
visible half of the motion is a composited `translate`.

The measurement that settles it is one line in the console — sample the *inner*
element's `getBoundingClientRect().left` per frame, not the container's. If it
reads `0 -> 0`, nothing you do to the curve will help. And sample per **decile of
the duration**, not "time at N% of travel": frame quantisation moves the
percentage marks by a whole frame, which is enough to invent a velocity spike that
no frame contains.

Still name the curve at every call site — the table below is what makes a
transition read as the right _kind_ of movement, and a bare `transition-opacity`
cannot know which one it is. `--default-transition-timing-function` is re-pointed
at `--ease-standard` (200ms) in `globals.css`, so a forgotten one degrades to a
system curve rather than to Material **2**'s, but that is a safety net, not the
convention.

A raw `cubic-bezier()` is a bug wherever the tokens can reach. Two exceptions,
both commented:

- The hero's `REVEAL_EASING`/`HIDE_EASING` and `Popover`'s `EASE_*` spell out
  their curves because they are handed to a Web Animations `easing:` string,
  where a failed `var()` would silently fall back to `ease`. Same for the top
  loader's `easing` prop in `app/layout.tsx`. The values _are_ the token values;
  keep them in sync. `Popover` additionally builds its spring easings through
  `springToLinear`, so those cannot drift by construction.
- The theme wipe is genuinely off-scale, for the same reason `.m3-progress-arc`
  *was*: what it animates is a **radius**, and what the eye reads is the area it
  sweeps, which goes as the square. Every M3 curve is one-sided and spends its
  travel up front, so squaring it finishes the wipe before it registers as one —
  measured as the fraction of screen flipped 150ms into 550: symmetric
  ease-in-out 3%, `emphasized` 65%, `decelerate` 87%. A radius wants a curve
  that is slow at both ends. `--ease-loop` is that curve and `.m3-progress-arc`
  uses it now; the wipe still spells it out, for the `var()` reason above.

`linear` is correct only for a spinner's rotation and for a keyframe track that
has already been sampled along a curve (the hero flight, the sink).

`emphasized` is two cubic segments, so it has no `cubic-bezier()` form — the CSS
token is a sampled `linear()` and GSAP takes the spec path. It hangs back, then
runs through the middle at 2.5x `standard`'s peak speed. That peak is why a
value tuned against `standard` cannot be carried over to it: `AXIS_LAG` in
`lib/motion.ts` had to drop from 0.07 to 0.032 to keep the same visual shear.

Durations: `DURATION` in `lib/motion.ts`, mirrored by Tailwind's `duration-*`.

| Situation                                     | Duration | Curve        |
| --------------------------------------------- | -------- | ------------ |
| Enters the screen                             | 400ms    | `decelerate` |
| Leaves the screen                             | 200ms    | `accelerate` |
| Begins and ends on screen (hover, colour)     | 200ms    | `standard`   |
| Large container transform                     | 500ms    | `emphasized` |
| Press down                                    | 100ms    | `standard`   |
| State layer settling in or out                | 150ms    | `standard`   |

Those six are the whole scale, and every duration in it is a step on M3's own
(50/100/150/200/250/300/350/400/450/500/…). A duration outside it is a bug —
`duration-150` is the state layer's and nothing else's, and it belongs to the
`state-layer` utility rather than to a call site.

**A panel travelling in place is not in this table at all**, and the road to that
answer is worth keeping. Three collapsible panels needed it — the navigation drawer,
/messages' contact rail, /search's advanced block — and none of the rows above fits:
such a panel starts at rest and stops at rest with both ends of its journey on screen,
where every M3 *curve* is one-sided (on `standard` the fastest tenth carries 97x the
last, read correctly as a jump then a stall). A symmetric bezier was invented for it,
measured well, and was still the wrong kind of answer: M3 stopped using curves for
this in 2025. `NavigationDrawer.kt` opens on a `DefaultSpatial` spring and closes on
`FastEffects`, and a spring leaves and arrives at zero velocity by construction. So
these belong to the springs section, per direction, with every clock in the gesture —
panel, scrim, row gap, label fade — on the same pair. `--ease-symmetric` survives for
the one thing it is genuinely alone in serving: a **loop**, which has no arrival.

**A determinate progress bar is the same case**, and it was the last holdout: seven
hand-rolled meters ran `duration-200` on the loop curve.
`ProgressIndicatorDefaults.ProgressAnimationSpec` is
`spring(dampingRatio = DampingRatioNoBouncy, stiffness = StiffnessVeryLow)` — a
critically damped spring, i.e. the *effects* family, chosen because a meter must not
overshoot: past 100% reads as more than full. AOSP's `StiffnessVeryLow` is 50, which
at this app's normalised rate settles in ~940ms, so what is borrowed is the family
and `spring-slow-effects` (ζ1.0, 235ms) is the tier — the softest the scheme offers.
`components/ProgressBar.tsx` owns it.

**Its neutral tone is `secondary`, and the spec says `primary`.**
`LinearProgressIndicatorTokens.ActiveIndicatorColor` is `Primary` over a
`SecondaryContainer` track, which separates cleanly in AOSP's scheme because primary is
P40 there. This app holds the brand pink instead of a tone of it, and the cost lands
exactly here: `primary` on `secondary-container` measures **2.39:1 light / 2.41:1 dark**,
under the 3:1 WCAG 1.4.11 asks of a non-text graphic — on a meter, the filled half against
the empty half *is* the content. `secondary` measures 5.00:1 / 5.47:1 and is the same
substitution the focus ring already made for the same reason. `primary` was removed from
the tone union rather than left available.

Vuetify remains the reference for the *arrangement* (one gesture, one clock, the scrim
sharing it) and not for the physics.

Two rows changed in this pass and both were off M3's scale. **Press down is
100ms**, `short2`; it read 120, which is not a step and which three call sites had
copied from each other. And **hover is 200ms, not 300** — this table said 300
while `transition-ui`, the utility every hover in the app actually uses, said 200,
so the rule and the implementation disagreed and the implementation was the one
being followed. 200 is `short4` and it is the answer; if two parts of one hover
gesture disagree, move the slower one down rather than the faster one up.

Anything genuinely *not* on the scale needs a line here saying so. Today that is
`--animate-page-transition`, whose keyframe runs 320ms behind an 80ms
backwards-filled delay: the total is 400 and the split is what makes the outgoing
clone's fade overlap the incoming page rather than abut it.

**The shared-element flight is a container transform, and that is a statement about
its structure, not its curve.** Getting it there took four passes, because the first
three re-tuned the timing while the arrangement stayed wrong.

The arrangement is Flutter's and Material Android's, which agree: **one growing,
clipping, rounded box, with the destination content laid out at its final size and
scaled to that box's current width.** `MaterialContainerTransform` computes
`currentEndBounds` from a `fitModeEvaluator` and masks it to the container;
`open_container.dart` writes the same thing as
`FittedBox(fit: BoxFit.fitWidth, alignment: topLeft)` inside a `SizedBox` of the
animated rect. Both grow the box to the **whole surface**
(`_rectTween.end = Offset.zero & navSize`), not to the picture's slot. In DOM terms the
mask is a `clip-path: inset(… round R)` on the overlay and the fit is a `translate` +
uniform `scale` on `[data-image-detail-scale]`, which is why that node exists: the
pull gesture already owns `.image-detail-overlay-content`, and a CSS-variable translate
and a WAAPI scale cannot compose on one element.

Before this, the detail side of a flight was `opacity` on the surface plane and nothing
else, with the routed page appearing when its seal lifted. A full-screen page arrived by
fading a rectangle in and un-hiding a page behind it while the picture flew past on a
separate path — two objects for one gesture, which no timing function can fix.

**296ms out, 194ms back — the spatial ladder's slow and default tiers**, and the two wrong
answers before it were wrong in opposite directions for the same reason: nobody had decided
which *kind* of clock a container transform runs on. It read `slowSpatial` both ways on the
claim that `MaterialContainerTransform` is "`motionDurationLong2` (300ms) either way"; that
citation was doubly false (300 is `DurationMedium2`, and the transform is not symmetric — it
reads `entering ? motionDurationLong2 : motionDurationMedium4`, which are **500** and
**400**). It then read 500/400, which are those real numbers, and 500ms was too slow to
live with. Both citations describe Android's *activity-level* transform, a gesture that
happens once per app launch; this one happens every time you look at a picture and go back.
So it belongs on the spring ladder the rest of the app's component motion uses, and the
asymmetry is Material's 500:400 taken to the nearest tiers — which is also what every row of
the duration table above already does. The 166ms `FastEffects` close remains wrong for its
own reason: it came from `NavigationDrawer.kt`, and a drawer *leaves* where a container
transform *returns*.

Three things the length has to fit, all checked: 24 samples per leg is 12.3ms per segment at
296 (under one frame — at 500 it was 21ms, so the curve's fastest region was being flattened
across 1.3 frames); the gallery card's chrome fades on a 200ms CSS transition that must
finish inside the flight; and `HERO_REVERSE_MIN_DURATION_MS` becomes reachable for the first
time, which is what it is for.

**The rest of the direction asymmetry lives in the thresholds**, which is where Material
keeps it — `DEFAULT_ENTER_THRESHOLDS` / `DEFAULT_RETURN_THRESHOLDS`:

| | enter | return |
| --- | --- | --- |
| surface cross-fade | 0 → 0.25 | **0.60 → 0.90** |
| corner (shape) mask | 0 → 0.75 | 0.30 → 0.90 |

The return row is the one that changes how the exit reads: the plane stays fully there
while the container shrinks and hands over to the thumbnail late, instead of blinking out
first and letting the picture travel afterwards. The corner threshold is also where
`HERO_RADIUS_LEAD` comes from — it is `1 / 0.75`, not a fitted number.

**The *content* does not take the return threshold, and that is a divergence.** Material's
0.60 → 0.90 is tuned for card-to-card, where the shrinking thing is about the size of what
it shrinks into. Here it is a full-screen article going home to a thumbnail, and holding it
opaque for the first 60% meant watching the whole page — heading, tags, description,
comments — scale down and fly into the card behind the picture: a second object making the
same trip. On the way back the content takes the *enter* window mirrored (0 → 0.25), so it
is gone in the first quarter; the surface plane keeps 0.60 → 0.90 so there is still
something to shrink, and the picture keeps its own morph.

**The path is the chord, on the spring's own progress, and it must stay monotone per axis.**
There used to be a *ballistic lift* — a parabola subtracted from the top edge, peaking
mid-flight, sized from a gravity term and the chord length. Two things were wrong and the
second is the visible one: the lift was keyed on **linear** time while the position ran on
the spring curve, so at the point where the spring has covered 97% of its travel the
parabola is still at 96% of its peak. The last 40% of every flight was therefore an
already-arrived picture sinking the remaining ~38px straight down. Measured on a 296ms
open, the rendered top ran 390 → 197 → 196 → 202 → 208 → 221 — past its landing edge by
26px and back — while width, height and left were monotone, which is what localised it.

It is also not a Material path. `MaterialContainerTransform` leaves `pathMotion` linear
unless a caller opts into `MaterialArcMotion`, and Compose's `SharedTransitionScope` lerps
the bounds outright. **`MaterialArcMotion` has since been implemented here and taken back
out, so do not reach for it a third time.** The arc is one quadratic Bézier through a
corner of the endpoints' bounding box, which collapses to two closed forms of one
parameter — one axis on `1 − (1−t)²`, the other on `t²` — i.e. a reparameterisation per
axis rather than a second clock. Keeping every edge monotone then forces the axis progress
to drive the box's *whole extent* on its axis (`left` and `width` together, `top` and
`height` together), because arcing the centre while the size ran on the plain progress sent
the left edge 38px past its landing column and back. That version measured clean — zero
edge reversals across four cards, one of them travelling leftward — and still had to go,
because pairing the axes puts the aspect ratio on the leading one: 169ms into a 500ms open
the box was **830 × 281**, an aspect of 2.95 where the thumbnail was 2.0 and the picture is
1.78, and the canvas is `object-cover` inside it. The middle of every flight was a hard
crop through a shape more extreme than either end. Material's own arc thresholds
(`DEFAULT_ENTER_THRESHOLDS_ARC`) are the tell: the arc is tuned for a full-width row or
card growing into a page, where the horizontal travel is near zero and the size delta is
small. A masonry thumbnail becoming a near-full-width photo is the opposite geometry.

**The standing check is per-decile monotonicity of all four rendered edges**; a flight that
passes an edge and returns is a bug however good the curve is. Both terms this file has
recorded removing failed it — one at the end of the leg, one in the middle — and both read
as a timing problem from the outside. **The second check is the aspect ratio**, which the
monotonicity check does not cover: it must stay between the two endpoints' aspects.

**The shape is one of the app's four, not a curve of its own.** `HERO_FLIGHT_RESPONSE`
takes ω in *normalised* time — the physical frequency times the leg's duration — and
within a family that product is a constant: 5.13 for every ζ0.9 spatial tier, 6.65 for
every ζ1.0 effects tier. So the family fixes the shape, `HERO_DURATIONS` fixes the tier,
and the flight reproduces `StandardMotionTokens` decile for decile to within 0.2 of a
point. Before this the hero's spring model was critically-damped-only, which is why it
*could* not reference the scheme: ζ was the missing parameter. A response must therefore
always be **spread** when it is rebuilt — reconstructing it field by field drops ζ back to
1 silently.

**And ζ is 0.9 — spatial — after a round trip through 1.0 that is the argument for it.**
The app's own rule for picking a family is the one that decides it: *spatial* is "it moves or
resizes", *effects* is "it fades or recolours, and must not overshoot". A container transform
moves **and** resizes, and this is the largest such motion in the app. It was moved to ζ1.0
on the strength of Compose's `BoundsTransform` being `DampingRatioNoBouncy` — a real citation,
but not an aesthetic one: Compose picks a *spring* for a shared element because a shared
element must be interruptible, and the no-bouncy ratio is a safe default for arbitrary user
content. `MaterialContainerTransform`, the same object with a fixed choreography, uses no
spring at all — it uses `motionEasingEmphasizedInterpolator`, and `emphasized` hangs back
before it runs. Of this app's four shapes, the one that hangs back is ζ0.9. Per tenth of the
leg: ζ1.0 is 14.5 24.2 21.1 15.3 10.1 6.4 3.9 2.3 1.3 0.8, peak in the second tenth,
fastest:last 31:1; ζ0.9 is 9.8 19.2 19.7 16.6 12.6 8.9 5.9 3.7 2.2 1.3, peak in the third,
15:1. The first starts abruptly and then crawls; the second reads as having mass.

The objection this replaces was that ζ0.9's monotonicity is "a property of where the window
stops rather than of the motion". Both halves are now checked rather than argued: the raw
spring's first peak is at `π/ω_d` = 1.40 in normalised time, past the end of any leg, and
`springProgress` normalises by `raw(1)`, so swept at 200 points the response is monotone with
`max = 1.00000` and `p(1) = 1.00000`. An *interrupted* leg re-solves from a measured velocity
and can then overshoot — true, deliberate, and exactly what the drag release has always done:
a reversal launched with a negative velocity dips before it recovers, and that dip is the
catch. One consequence worth having: the flight and the drag release are now the same shape
and differ only in duration, so the two ways of leaving a picture stop disagreeing about what
kind of object it is.

**It leaves from rest.** It was launched with `velocity ≈ 1` — already travelling at
the whole flight's average speed in its first frame — so its fastest tenth carried 46x
(out) and 64x (back) what its last one did. That is the one-sided profile the drawer
took three passes to remove, still living in the hero.

**Three exits, and `cause` is what picks between them.** A tap-back and a browser-back
run the container return above. A **swipe-down does not**: the finger has already put the
surface where it is via `--hero-pull-y` / `--hero-veil`, so the dismiss continues those
from their live values and never masks or scales anything — re-scaling under a spring
would be a second hand on the same object. M3 draws the same line for a drawer, settling
a *drag release* on `DefaultSpatial` while closing on `FastEffects`. The release slides
down the spatial ladder with the travel left — 296ms at a full drag, floored at 137ms for
a flick from near the top — and because ω is normalised it gets faster without getting a
different curve. `HeroCloseIntent.cause` used to be written in three places and read in
none; it selects the choreography now.

**The Stage and the route must measure identically, and "identical CSS" is not enough.**
The landing target is an ordinary in-flow flex item in the media well, because the routed
`DetailImage` is one too. It used to sit inside an `absolute inset-x-4` wrapper, so its
`width: min(100%, …)` resolved against a containing block 16px narrower per side — the
flyer landed 16px wider than the picture it handed off to and snapped in on arrival, on
every image wide enough for the width term to bind. When a handoff visibly jumps, compare
the two elements' *containing blocks*, not their style objects.

**And the detail's background surface had a clock of its own:** 270ms of
`emphasized-decelerate` starting with the flyer, against a 340ms flight — so the plane
finished arriving 70ms before the picture landed on it, and the two read as separate
events that merely began together. Its opacity is on the container's cross-fade interval
now. The content cascade above it keeps its own staircase but *only its position*: chrome,
header and body still arrive in reading order, while the block's opacity belongs to the
container once, because two nested opacities multiply and read as two entrances.

**And the staircase had the same defect from the other end.** It ran 400ms on
`emphasized-decelerate` with delays of 50/100/150, so the body finished at 550ms — the text
kept sliding for a quarter of a second after the picture had landed, which is its own kind
of "too slow". 400 + `emphasized-decelerate` is a correct pairing (that curve covers 62% of
its travel in the first tenth and only 400 gives it room) but it is the **page entering**
row, and these steps move 8, 16 and 24px. A 16px rise is a small thing entering: 200ms on
`standard-decelerate`. With delays of 0/50/100 the last step ends at 300 against a 296ms
flight, and measured on the built app the body's rise and the flyer's landing now finish in
the same frame (both t≈305).

**A box outside the host must not be clamped.** `formatHeroContainerClip` read
`Math.max(0, …)` on all four insets, and because `right`/`bottom` derive from the
already-clamped `left`/`top` the error compounded into a *translation*: the mask kept its
size and slid to the host's edge. Reproduced by scrolling the gallery down 260px and opening
the featured banner, which lives at the top of the page and is partly above the viewport by
then — the closing mask ended 236px below the thumbnail it was collapsing into, leaving that
band of detail surface on screen. Negative `inset()` values are valid CSS and Chromium
honours them (verified with `elementFromPoint` probes: the shape extends past that edge and
the other three still clip), so only the radius clamps. Any source scrolled past either edge
had this; the banner just makes it easy to hit.

`transition-ui` used to be listed here as a second exemption, at 200ms against a
table that said 300. It is not an exemption any more — the table says 200 and
`transition-ui` *is* the table, which is the state the two should have been in all
along. A lone element moved to 300 is still the bug rather than the utility.

The one thing that legitimately runs longer is a **composite** hover, where every
moving part shares one clock: the gallery tile's image scale, its veil and its
caption all settle together at 300ms, and that is a decision about the gesture
rather than about the element. If the parts of one gesture disagree, make them
agree — the tile veil was 200ms against its own image's 300ms scale, so one
gesture arrived in two instalments.

Always name the properties: `transition-[opacity,transform]`, never
`transition-all` — it animates layout properties too, and it is what made a
button's hover jitter while its shadow grew.

And always name the curve, even for a one-property fade. A bare
`transition-opacity` inherits `--default-transition-timing-function`, which is a
safety net pointed at `standard`, not a decision — it cannot know whether the
thing is arriving, leaving, or settling in place.

Anything decorative must collapse under `prefers-reduced-motion: reduce`. The
enumeration lives at the bottom of `globals.css`; GSAP helpers branch on
`prefersReducedMotion()`. Note that the enumeration has to cover **transitions**
as well as `@keyframes`: `transition-ui` lists `transform, translate, scale,
rotate` (it must — Tailwind compiles `translate-x-*` and `scale-*` to those
standalone properties), so for a long time the drawer still slid its full width,
the tab pill still translated, the switch handle still travelled and `Select`'s
chevron still rotated under the preference. One rule re-declaring
`transition-property` now drops every moving property while keeping colour,
opacity and shadow, because losing those would turn hover and focus into a
flicker rather than a state.

The `spring-*` utilities are covered by that rule automatically, because they set
only a timing function and a duration and are always composed with a
`transition-[…]` the enumeration already matches. A keyframe animation is not:
each `--animate-*` token needs its class listed in the reduced-motion block by
name. That block used to match on a substring of the `animate-[…]` arbitrary-value
syntax, which meant adding a sixth micro-interaction silently opted it out.

## Three traps that make a fix look applied when it is not

**A Tailwind variant needs its colon.** `peer-focus-ring` is not "the `focus-ring`
utility under the `peer-focus` variant" — it is a class name that matches no
utility, so it emits nothing at all. `Checkbox` and `ToggleSwitch` both carried it
next to `peer-focus-visible:ring-2`, which meant a 2px ring painted in
`currentColor` — taking the colour of whatever text happened to surround the
control, which is the exact failure `focus-ring` was added to end. The form that
works is `peer-focus-visible:focus-ring`. When you add one of these, grep the
built CSS for the escaped selector (`.focus-visible\:focus-ring`) rather than
assuming; a class that compiles to nothing looks identical in the source.

**Comments generate CSS.** Tailwind scans raw file text for class candidates and
does not skip comments, so a comment naming a class you just deleted can put it
straight back into the stylesheet. The cost is not weight — it is that you can no
longer grep the built CSS to prove a class is gone. When documenting a value you
removed, spell it in prose ("a 25% alpha on `ring-primary`") rather than as a
class name.

**The extractor is wider than it looks, and the earlier version of this note got the
line in the wrong place.** It claimed that anything with a `/`, a `[`, a `:` or a `-`
before a number "only registers in an attribute-like position" and so is safe to write
in prose. Re-measured against the built stylesheet, that is **false for the `:` and the
`-`**: a comment reading "it read `sm:px-26`" put `.sm\:px-26{padding-inline:…}` back
into the bundle, and so did a bare `p-5` and a `min-w-14`. Three dead rules, from three
sentences explaining why the values were removed.

What genuinely does *not* survive is the alpha and the bracket form — `ring-primary/20`,
`bg-black/55`, `scale-[1.02]` — plus a palette class that names a colour the theme does
not define (`bg-slate-800`, `text-red-500` resolve to nothing here). Everything else
should be assumed live. So the rule is simply: **do not write a class name in a comment
to say you removed it.** Spell the value — "a 104px inset", "20px of row padding" — and
the sentence still explains itself while the bundle stays clean.

The check is a grep of the built CSS for the escaped selector, and it only works for
names that are not also English words: **`rounded` will never grep clean**, because it
appears in a dozen legitimate sentences about corners. Pick the invariant you can
actually verify.

`@source not "../**/*.md"` at the top of globals.css is what keeps this file's own
"Never" column out of the bundle. Code comments are still scanned.

**A `{' '}` inside a flex or grid container is an extra item.** Prettier inserts
one whenever it breaks a JSX line where a literal space stood, and between two
block children it is invisible — so it accumulates. In a flex container it is not
invisible: a text node is an anonymous flex item, so it takes a `gap` of its own
*and* renders a space glyph. Measured on the sidebar's user block, a
`flex items-center gap-1.5` row with two of them between the level badge and the
verified name: about 16px of separation where 6px was written.

There were 697 in the app and 220 of them were inside a flex or grid container.
The other 477 are between inline text and are load-bearing — removing those joins
words — so this is not a search-and-replace. The distinction is the parent's
`display`, which means it needs the parser, not a regex: walk the JSX, find
elements whose `className` mentions `flex`/`grid`, and drop the string-literal
`' '` children of *those*. Left alone otherwise.

Two refinements from actually measuring the sweep, because the rule as first
written points at the wrong set:

- It is a **direct child** of a `display: flex` / `grid` element that becomes an
  anonymous item. A `{' '}` between two *block* children of a `space-y-*` div
  collapses to nothing — it is noise, not a gap.
- A `{' '}` **inside an inline element** pads that element's own text, which is
  visible when the element is itself a flex item: a
  `<span className="text-primary"> {n} / {total} </span>` in a `justify-between`
  row reads off-centre.

And the ones a `className` grep cannot see are the ones left: a fragment passed to
a **render prop** lands wherever the primitive puts it, so 24 spaces inside `Modal`
`footer`s became items in its `flex justify-end gap-3` row — 12px + a glyph + 12px
where `gap-3` was written.

## Transitions between screens

Three mechanisms, in order of how much they own:

| Change                          | Mechanism                             | Lives in                         |
| ------------------------------- | ------------------------------------- | -------------------------------- |
| Opening/closing an image        | Shared-element hero flight            | `lib/hero/**`                    |
| Gallery <-> forum, profile tabs | Shared axis (X), 500ms `emphasized`   | `playSharedAxis` / `useTabPanes` |
| Any other route                 | Cross-fade over an inert clone, 400ms | `lib/routeCrossFade.ts`          |

**Tabs.** Render `TabPanes` / `TabPane`; do not wire this by hand. Panes are
marked, never unmounted — `data-tab-pane="name"` plus `data-tab-pane-active` —
and stack in one CSS grid cell so both can be on screen at once. Never gate a
pane on `hidden` or `{cond && ...}`: the outgoing one has to survive the commit
or there is nothing to fade out. Never put a `key` on `[data-tab-panel]`; that
deletes the animation's own targets in the commit that starts it. Panes must be
written in the same order as the tabs above them — direction is derived from DOM
order. On the home page, call `startTabTransition` and
`router.push(..., { scroll: false })` in the same tick; screens whose tabs live
in local state need nothing beyond `TabPanes`, because the state update and its
layout effect are the same commit.

`lean` samples the wave over the blocks *inside* each pane, which requires those
blocks to survive the run — so it is **off by default**. A pane that fetches when
its tab is selected replaces its whole subtree within a few frames of the switch
starting, and GSAP is then animating detached nodes while the visible new ones
sit still: measured on the messages tabs as pane height collapsing 1887px → a
288px skeleton inside 70ms, with zero transformed descendants for the whole 500ms
run — a switch with no animation at all. Turn `lean` on only for panes that are
static once mounted (`/policy`).

**The home tab bar opts in, and it is the only thing that does.** `lean` has to be stated at
*both* of its call sites — `TabPanes` for the reactive path (a sidebar link, back/forward, the
`/forum` redirect) and `startTabTransition`'s fourth argument for the tap path. It is safe
there for a specific reason rather than by luck: the forum pane is mounted ahead of the tap on
an idle callback, so by the time you press it is holding its rows rather than a skeleton it is
about to replace. `/messages` is the counter-example and must stay without it.

**"Off by default" has now been true three times and false twice**, so check it rather
than trusting it: the option had a default in four places — `playSharedAxis`,
`runTabTransition`, `TabPanes` and `useTabPanes` — and the first two said `true` while the
last two said `false`. `startTabTransition` passes four arguments and therefore took the
parameter default, so the home page's *tab bar* ran the lean while its own comment and this
file both said it did not, and while the reactive path (a sidebar link, back/forward, the
`/forum` redirect) ran without it. One option, one default. Measured after the fix, with a
50-card gallery: two inline-transformed nodes inside the panes instead of every
near-viewport block, and the switch presenting at a 60fps median.

**The pane height tween must clip on one axis only, and with `clip`.** While
`[data-tab-panel]` is being morphed from the outgoing pane's height to the
incoming one's, it has to hide the overflow — but that panel *is* the centred
`max-w-*` content column, and `overflow: hidden` therefore cropped the shared
axis to the column for the whole 500ms: panes appeared and vanished at the text's
own edge instead of sliding past the information area's. It is `overflow-y`, and
the value is `clip` rather than `hidden` because `overflow-x: visible` beside
`overflow-y: hidden` is *computed to `auto`* by the spec — which would quietly
turn the panel into a horizontal scroll container — while `visible` beside `clip`
is legal and leaves the x axis alone. The horizontal clip is then back where it
belongs, on the scroller's `[data-axis-running='x']` rule.

The other half of the same complaint is that the height was measured once, at the
moment of the switch, when the entering pane still held its skeleton — so the
data landing a beat later moved the height again after the tween had finished.
`runTabTransition` now watches the entering pane with a `ResizeObserver` for a
couple of seconds and re-tweens on the same curve if it grows. Skeletons should
still be the right *length* (`PER_PAGE` rows, not eight), because a watcher that
has to correct by a whole row is a visible correction.

**A page gets a back affordance if, and only if, it is not in the sidebar.**
There was no rule, and the distribution showed it: `/search` and `/messages` had
one despite being one tap away in the drawer, while `/favorites`, `/history`,
`/tasks`, `/block-groups`, `/settings`, `/upload` and `/forum/create` — equally
top-level — had none, and `/about` and `/policy`, which are reachable only from
the footer and therefore need it most, had none either. So it now sits on exactly
the routes with no permanent entry point: both profiles, the forum thread,
`/about`, `/policy` and the image detail.

`/forum` looks like it belongs on that list and does not: `next.config.ts`
redirects the bare path to `/?tab=forum`, so `app/forum/page.tsx` never mounts
and the route you actually land on is the sidebar's own. (`/forum/[id]` and
`/forum/create` are unaffected — the redirect matches the exact path.) Check for
a redirect before deciding a route is deep.

Draw it in every state, including loading and error. `/derpi/user/[id]` is the
cautionary case: its error branch dropped its own 返回上一页 button on the
grounds that "the leading back affordance is already chrome on this route", and
that route had never rendered one — so a Derpibooru profile that failed to load
was a dead end with no way out but the browser's own button.

**The back affordance is chrome, not content.** `PageBack` portals into
`[data-page-back-slot]`, a shim the shell renders as a sibling of the scroller.
Rendered inside `[data-page-content]` it was cloned by the route snapshot and
translated by the shared axis, so /search → /messages carried it a full window
out and back to the pixel it started on. It has no entrance animation on purpose:
between two screens that both have one, the node is remounted at the same
coordinate looking identical, and a fade would put a flash on every one of those
moves to smooth the rarer case where it genuinely appears.

**The image detail's own back affordance learned that rule the hard way.** It exists
twice during a flight — `HeroStage` renders a copy that rides along, `PicDetail` renders
the real one — and the handoff hides the first with `visibility` while revealing the
second. The route seal used to set `opacity: 0` as well, and `IconButton` carries
`opacity` in its transition list (for `disabled:disabled-content`), so lifting the seal
started a 200ms 0 → 1 ramp on a glyph that was already on screen a frame earlier: one
blink per open. The seal is `visibility` + `pointer-events` only now, which is also
strictly better for the sealed copy — `opacity: 0` left it focusable. Measured across the
handoff, the two copies swap at opacity 1 in the same frame. The riding copy takes
`DetailBack`'s `passive`, which is what that prop was added for; without it the app had
two focusable 返回图片列表 buttons for the length of every flight.

**`data-image-detail-reveal` does not reach either copy**, and both used to carry it:
the cascade is `overlay.querySelectorAll(...)` and both back buttons render as *siblings*
of the overlay. Their entrance is the `floatingBack` branch of `buildOverlayAnimations`.

**Routes.** `RouteCrossFade` snapshots the outgoing page in
`getSnapshotBeforeUpdate` (the only lifecycle that runs before React mutates the
DOM) and fades that inert clone out while `pageIn` fades the new page in. The
two overlap because `--animate-page-transition` carries an 80ms delay with a
backwards fill.

**The hero owns the same pixels.** Every other transition stands down while a
flight is in progress — gate on
`getImageHeroRuntime().phase === 'gallery-idle' && !background`. Inside
`lib/motion.ts` that gate is the registered `setHeroBusyCheck` predicate (a seam
rather than an import, so `lib/motion` does not drag the hero controller into
every bundle); the theme wipe and the tab shared axis both consult it, because the
first freezes rendering to snapshot a frame the flyer is moving through and the
second sets `overflow-x: clip` on the very scroller that hosts the flight layer.

And nothing may leave a residual `transform` on an ancestor of a gallery card: the
flight reads `getBoundingClientRect` on press, and only a transform on
`[data-image-detail-background-visual]` is compensated for. Always settle with
`clearProps`, never `translate3d(0,0,0)`. This is easy to breach from a distance —
`pageIn` is a fade *plus a 12px rise* under a `both` fill, and
`[data-page-content]` is an ancestor of every card, so for as long as the plain
route cross-fade relied on that keyframe to bring the new page in, arriving at `/`
from any route outside `ROUTE_CELL` left a ~400ms window in which a tap launched
the flyer from a box up to 12px above the thumbnail. The plain branch now drives
the entrance itself, on opacity alone.

**The gallery's blurs stand down too, and that one came out of measuring rather than
reasoning.** Every thumbnail carries three `Badge tone="media"` marks and that tone
includes a backdrop blur, so a 50-card grid holds on the order of 150 backdrop-filter
regions — and for the whole flight the grid is moving, because
`[data-image-detail-background-visual]` carries the depth sink. A backdrop filter re-samples
whatever is behind it whenever that moves. `html[data-image-hero-transition]` drops
`backdrop-filter` inside that subtree for the length of the flight; the plate under each
mark is an opaque 55% black, so there is nothing to see while it lasts.

**Chrome that appears only on one side of the handoff is chrome that jumps.** The detail's
zoom control is `opacity-100` below `sm` and hover-revealed above it, while `HeroStage`'s
landing target renders no children at all — so on a phone the frame that hands the picture
over conjured a 40dp button into its corner, and the frame that starts a close took it away.
`html[data-image-hero-transition] [data-image-detail-zoom]` stands it down for the length of a
flight. Anything else added inside the media box needs the same treatment or a twin on the
Stage.

**A viewport change mid-flight has to re-aim the container, not just the flyer.** `rebuild()`
did only the flyer for a long time, and the mask is a `clip-path: inset()` expressed against
the *host's* border box — so when the host resized, the same four numbers landed somewhere
else and the keyframes were still aimed at the old box. On a phone the trigger is the address
bar collapsing. Measured at 400px wide with the flight 90ms in and the height changed by 60px:
the flyer moved 19px in that frame while the mask jumped **682 → 784**, then converged on the
pre-resize host and finished 8px short of the new one. `rebuildContainer` rebases it from
wherever it is toward freshly measured boxes; after the fix the same test converges on 791
against a host of 792. A one-frame jump of a full-screen mask is the artefact that reads worse
the lower the refresh rate, because it *is* the difference between two adjacent frames — do not
reach for the frame rate when that is the complaint.

**A route with no media has to say so.** The handoff waits for a route with a paintable preview
*and* a target, and only `DetailImage`/`DetailVideo` set either — so the failure branch could
never satisfy it and the wait ran to `HERO_DETAIL_ROUTE_TIMEOUT_MS`: an image that turned out
not to exist left the error page sealed and the screen blank for **30 seconds**.
`resolvedWithoutMedia` on the registration is the terminal answer that lets the container
transform finish and the error surface in its place; the closing path already fell back to a
plain history collapse when `route.target` is null.

**Measure presented frames, not `requestAnimationFrame` gaps.** A composited animation
keeps running while the main thread is busy, so rAF intervals report main-thread cadence
and say nothing about what the display got — the two disagreed by a factor of two here. A
CDP screencast (`Page.startScreencast`, `everyNthFrame: 1`) yields one event per presented
frame, and a full-viewport composited transform on an otherwise idle page is the control
that proves the harness can reach 60. What that showed: the flight presents at **36fps**
against 60 idle, and **no single animated track is responsible** — cancelling the flyer's
corner morph, the container mask, the content fit and every skeleton shimmer, together, was
worth about one frame per second. The cost is the detail route's first render and first
paint landing inside the flight window (~190ms of React work in a production build), spread
evenly across it. The blur rule above was the only change that moved the number (27 → 36).


## State layers

Hover/focus/press are the `state-layer` utility — a tinted overlay at the M3
alpha, painted from the element's own `color`. Not `hover:bg-primary/90`, which
has to be written twice (light + dark) and drifts.

The four alphas are M3's, from `StateTokens`: **hover .08, focus .10, pressed .10,
dragged .16**. Focus and pressed are deliberately *equal* — the focus ring is what
distinguishes them, not the tint weight. Pressed read .12 here until this pass,
which is the figure an older Material Web token set shipped, so every press in
the app was 20% heavier than the spec's on the one utility every control reuses.

**A ripple is that same layer spreading from the point of contact**, so it holds
one opacity for its whole life and then fades. Its value lives on `.ripple` in
globals.css and reads the pressed token; `spawnRipple` drives only the scale and
the fade-out. It used to open at .18 and settle to .12 — two numbers, neither of
them a token, the first half again the spec's — which read as a flash followed by
a wash rather than as one gesture.

A **selection control needs its own state layer** and cannot use this utility.
`Checkbox`, `Radio` and `ToggleSwitch` each paint a real 40dp circle instead,
because the utility keys on the element's own `:hover` and covers only that
element, while what has to light up on a checkbox is a circle more than twice the
width of the 18dp box, driven by a hover anywhere on its label. Two of the three
had no state layer at all before this pass, so hover and focus on the app's
most-used form control were a border colour change on an 18px box.

**A roving cursor is `state-layer-active`.** `state-layer` keys on the element's
own `:hover` / `:focus-visible` / `:active`, which covers everything the pointer or
the tab key can reach — and misses the one state a roving cursor creates: a row
that is the keyboard's current item without being focused itself, because focus is
on the control and `aria-activedescendant` names the row. `Select`'s listbox and
/search's autocomplete both have exactly that cursor and both marked it with
`state-layer`, a class that paints *nothing* until a pointer happens to be over
the row — so arrowing through either list moved the scroll and announced the item
and showed a sighted keyboard user no cursor whatsoever. `state-layer-active`
paints the same layer unconditionally at the focus weight, which is what the state
is: the keyboard is here.

The cursor is not the *selection*. A chosen value takes the container pair —
`secondary-container`, which is what "selected" means everywhere in this app (the
sidebar's route, a chosen `Select` option, a selected `Chip`, the current contact).
/search's autocomplete was filling its cursor row with `primary-container`, which
said "committed" about a row the user had not committed to.

## Layout

Spacing is the 4dp grid (Tailwind's default scale). Half-steps (`gap-1.5`,
`py-0.5`) are fine for dense chrome; arbitrary values are not.

**The page column is decided by what is in it, and there are two answers.**

| Content                                     | Width         |
| ------------------------------------------- | ------------- |
| A list of rows, or an article                | `max-w-4xl`   |
| A masonry / image grid                       | `max-w-7xl`   |

Ten screens are lists — forum, messages, history, tasks, policy, about,
settings, block-groups and both forum sub-pages — and they all sit at `4xl`.
Three are grids and sit at `7xl`. Nothing else is a page column.

The trap is a screen that holds both. The home page's two tabs share one panel,
so the forum pane inherited the gallery's `7xl` and the *same list* was 1280px
there and 896px on `/forum`: a row's title at the far left and its reply count
1100px away with nothing in between. A pane whose content is a list takes the
list width regardless of what its neighbour needs.

A form is neither, and may be narrower — `/upload` is `2xl` on purpose, because a
560px field column is easier to fill in than a 900px one. The admin console is
`6xl` because it is data tables.

`5xl` is the fifth and last: a **media-led detail column** — both profile pages
and the image detail, where a banner or a picture is the subject and the text
sits under it. It is not a general-purpose middle width; a screen that is a list
still takes `4xl` even if it happens to be 1000px of list.

**A block inside a column is not a column**, and this is where a sixth width comes
from. `/search` is a `7xl` page because a grid of pictures fills it, and inside that
it holds a field and an advanced-filter panel — a *form*, so both take the form
column's `2xl`. They read `3xl`, which is on no list, and before that the field was
`3xl` against the panel's `2xl`, so the panel was 48px narrower per side than its own
trigger. A block takes the width of whatever it *is*, and the answer is one of the
five; if it is not, that is the signal the block is being sized by eye.

**A page has one gutter and the shell already draws it.**
`[data-page-content]` is `p-4 sm:p-6`, so a screen that wraps its sections in
another `p-6` insets them 40px on a phone and 48px on a desktop — and it is
invisible in review because nothing looks broken, the column is just narrower
than every other screen's. /settings had six of them, each also painted
`bg-surface`, which is the scroller's own colour: six "cards" the exact tone of
the page behind them, doing nothing but the padding. A section is a heading and
the block under it; the block's own tone (`.m3-row`, `Card`) is what makes it a
surface.

**A structural divider is drawn in every state.** The sidebar's rule between the
user block and the navigation was conditional on being signed in, on the
reasoning that signed out there is no account for it to enclose. That is reading
the line as a box around the user; it is not one. It is the seam between two
regions of the drawer, both of which are there either way — signed out the top
block is still a block, it just says 未登录 — so the drawer lost its only
horizontal structure in exactly the state where a new visitor sees it first. If a
rule separates two regions, it does not blink on and off with the contents of one
of them. (The rule *inside* the nav, between 我的 and the settings group, is a
different thing and stays conditional: signed out there is no group above it.)

**A row has one reading order.** Label at the leading edge, control at the
trailing edge — that is what M3's list is, and it is what every value row
already did. A switch dropped into such a list *without* `layout="row"` renders
control-then-label and leaves the right-hand half of the row empty, so a
settings card alternated between two opposite reading orders down its own
length.

### The control-height scale

**Two rules, and the second one is the one that gets forgotten.** The step set is
32 / 40 / 56 with nothing between — every step is a container height some token
actually names, which is the whole point of writing it down: there were eight heights
in use (28, 32, 36, 40, 44, 48, 56, 64) because nothing stated one, so each control
was sized against the one next to it rather than against the system. But a step set
alone does not decide anything, and that is how a 56dp dropdown ended up in a row
whose other three controls were 32dp switches.

**Rule 1 — the touch floor is a *touch* floor.** M3's 48dp is WCAG 2.5.5's AAA figure
and it answers a finger. A pointer's floor is WCAG 2.2 **SC 2.5.8 — 24×24 CSS px**, at
AA. `--touch-floor` in globals.css is 48px and drops to 24px under
`@media (pointer: fine)`; `touch-target` (a hit area, no layout change) and
`touch-size` (a real `min-height`/`min-width`, for a control carrying `data-ripple`,
which clips a pseudo-element away) both read it. Applying 48 to a mouse is not a free
margin: `state-layer` keys on `:hover`, so a region wider than the paint lights the
control up while the cursor is visibly outside it, and neighbours in a dense row start
answering for each other. Two `@custom-variant`s, `pointer-coarse:` and
`pointer-fine:`, express the axis at a call site; `MEDIA.pointerCoarse` /
`MEDIA.pointerFine` are the JS twins so the two cannot drift.

Do not reach for `touch-target` on an inline target inside prose — SC 2.5.8 exempts
one, and a 48px band on a line in a 28px-leading paragraph steals clicks from the
lines above and below.

**Rule 2 — a control's step is decided by its enclosure, not by its type.** This is
what "coordinated" means, and it is checkable: look at what the control's neighbours
are, not at what the control is called.

| Enclosure | Step | Text |
| --- | ---- | ---- |
| A form column — a slot you fill in | 56 | `body-l` |
| The chat composer's field | 56 | `body-l` |
| A control *beside* a field (the composer's emoji and send) | 40 | — |
| A filter bar, an admin surface, or inside an `.m3-row` | 40 | `body-m` |
| An app-bar action | 48 | — |
| Dense chrome: a table row's actions, a chip's dismiss cross | 32 | `label-l` |

The composer row is the worked example of the middle two, and it took three passes.
Its accessories were 56 to match the field, on the reasoning that three equal boxes put
the glyphs on one axis — and an 88px band for one line of text is what that produced.
40 is what the field itself says a control beside it should be: the trailing-slot inset
in globals.css is `(56 − 40) / 2`, the field's own arithmetic for centring an accessory.
The field stays 56 because that is the part you type into, and the row's padding is
where the height was actually spent (`p-2`, so 72px).

**The app bar is the one place the pointer axis is switched off**, and it is done with
one declaration rather than five: the `<header>` sets `--touch-floor: 48px`, so every
`touch-size` inside it lands at 48 whatever the pointer is. Those five controls are the
app's most-used, they sit alone on a 64dp coloured band, and at 40dp with the desktop
inset either side they read as small glyphs rather than as the bar's chrome. 48 is M3's
touch target taken as a box, which is what they were before any of this.

**A row is a different kind of object from a control**, and M3 separates them too
(`ListTokens` has its own heights). Row heights take the density step:

| Row | pointer | touch |
| --- | ---- | ---- |
| Menu row, `Select` option row | 40 | 48 |
| Drawer navigation row | 48 | 56 |
| Two-line list item (`/messages`' contact row) | 72 | 72 |
| The drawer's account block | 64 | 64 |

The last two are the instructive pair. The contact row is `ItemTwoLineContainerHeight`
at **every** density, and the density step was tried on it and taken back out: the
collapsed contact rail's width is *derived* from that height (row height + the list's
8px inset either side, which is what makes the row square so the 40dp portrait centres
itself with no centring rule), and moving the height without the padding put the
portrait 4px above centre. A row three other numbers depend on is the wrong place to
spend a step.

The account block is **64 with `ListTokens`' own 40dp avatar**, and it is deliberately
*not* a two-line list item even though it has two lines. It is the drawer's header — one
of them, above thirteen 48dp links. 72 is the list row's height; 64 is one step down with
the spec's avatar intact, which leaves 12px above and below the text stack, i.e. exactly
M3's own item padding. 56 with a 32dp avatar was tried and the avatar was too small: 32
is the *dense* step, for a chat turn, and it made the one portrait in the shell the
smallest one in the app. Its name is `title-s`, matching the `label-l` size of every link
below it; at `title-m` it was the only 16px in the drawer.

**The page-content wrapper is a flex column, and `[&>*]:w-full` goes with it.** The
column exists so `StatusView`'s `fill` can be `flex-1`. The `w-full` is not decoration:
a flex item in a column is stretched on the cross axis by `align-items: stretch`
**unless it has an auto margin there**, because an auto cross-axis margin absorbs the
free space and disables the stretch. Every page root in this app is `mx-auto max-w-*`,
so without it all of them fall back to shrink-to-fit — /messages measured 755px on one
tab and 240px on the next, the forum list narrowed the same way, and the skeletons went
with them. If you touch that wrapper, measure a **width** on a tab switch, not just a
height.

So **48 is still not a control size** — no field, button or icon-button token in the
spec is 48. What it is, is the touch floor and the pointer-side drawer row.

| Step | What takes it |
| ---- | ----------------------------------------------------------------- |
| 32   | `Button size="xs"`, `IconButton size="sm"`, `Chip` |
| 40   | the default: `Button`, `IconButton`, `Select size="sm"`, `Input size="sm"`, a menu row, `Pagination`, a control beside a field |
| 48   | a tab (`PrimaryNavigationTabTokens.ContainerHeight`), an app-bar action, the drawer row under a pointer, and `--touch-floor` under a finger |
| 56   | `Button size="lg"`, a labelled or unlabelled `Input`, the search bar, `Select`, `ColorSwatch`, `CodeInput`, the chat composer's field, the drawer row under a finger |
| 64   | the top app bar (`AppBarSmallTokens.ContainerHeight`, at every density — the band is not repeated chrome, so the density rule does not apply to it); the drawer's account block |
| 72   | a two-line list item (`ListTokens.ItemTwoLineContainerHeight`), at every density |

**A 40dp field is this app's own step, not the spec's**, and it needs saying because
`OutlinedTextFieldTokens.ContainerHeight` is 56 and M3 offers nothing else. A field in
a filter bar or a list row is *chrome*: its neighbours are a 40dp dropdown and a 32dp
chip, and matching them matters more than matching a token written for a phone form.
Two fences keep it from spreading — it is unlabelled-only (the labelled field's notch
geometry is all derived from 56dp) and it takes no `trailing` slot, since that inset
is `(56 − 40) / 2` and a 40dp box has no room for a 40dp control. `SearchInput` bakes
it in rather than offering it, because every call site of that component is a filter.

Three figures went. **28** is below M3's smallest button. **36** sat between the
extra-small 32 and the small 40, on no scale at all. **44** is Apple's touch figure
rather than Material's, and was this app's own invention for "comfortable on a phone".

One consequence worth stating: **the two text fields are the same height.** The
labelled/unlabelled pair used to be 56/48 on the argument that a floating label needs
two rows; the argument is fine and 48 was not a number the spec offered. They differ
in exactly one thing, the boundary, which is what the Input section always claimed.
The dense step is a different axis — the enclosure — and applies to neither of them in
a form.

`Button size="sm"` is gone rather than retuned: at 40dp it was `md`, and two names
for one box is the problem, not the fix. Its 32 call sites moved to `xs`, because
every one of them had been chosen to be *smaller* than the default and that intent
maps to M3's extra-small.

Button padding is **16 / 16 / 24** by size and the icon gap is 8 at every size —
`IconLabelSpace` does not vary in the token set, which is why a 32dp button and a
56dp one put the same air between glyph and label. Those were 10/14/20/24 and
4/6/8/8, and the extra-small step then read 12 on the assumption that a smaller
button wants proportionally less air: `ButtonXSmallTokens.LeadingSpace` is 16dp, the
same as small's. Only the medium step widens.

The **glyph size belongs to the button**, not to the call site: `IconSize` is 20 at
extra-small and small, 24 at medium, and both `Button` and `IconButton` now size their
own icon slot. Leaving it to callers is how one 40dp icon button held an 18dp glyph
while another held 24.

**A press does not morph the corner**, and the spec does specify that it should.
`ButtonSmallTokens.PressedContainerShape` is `CornerSmall` (8dp), `ButtonMediumTokens`'
is `CornerMedium` (12dp); both were implemented here on `fast-spatial`, animating
`border-radius` only — deliberately not a transform, since a control mid-`transform`
corrupts the rect the hero flight reads on press. They came out anyway. On a pill the
corner has nowhere to travel *to* that reads as feedback: the box keeps its
dimensions and only the ends flatten, so a 40dp pill dropping to 8dp for 137ms reads
as the control turning into a different component. Press feedback is the state layer
and the ripple, which is what every other control in the app uses.
A **selected** icon button is still a rounded square rather than a circle, per
`SelectedContainerShapeRound` — that is a state, not a press.

### The icon-size scale

**18 / 20 / 24 / 36 / 48**, through `ICON` in `lib/icons.ts` —
`size={ICON.standard}`, never a number.

| Name       | dp | What takes it                                              |
| ---------- | -- | ---------------------------------------------------------- |
| `dense`    | 18 | inside a chip, or beside a line of metadata                 |
| `control`  | 20 | inside a button or a dense icon button                      |
| `standard` | 24 | the default: a list row, a nav row, an app-bar action, a field adornment |
| `large`    | 36 | a large FAB's glyph, or one prominent affordance            |
| `display`  | 48 | an illustration: the glyph over an empty state or an error   |

There were **fourteen** sizes across 285 call sites — 12, 14, 16, 18, 20, 22, 24,
32, 36, 40, 44, 48, 56, 64 — and the cause is simply that this table did not
exist. A gallery card's score used 12, a chip's check 14, a button's leading icon
16 and the sidebar 22, none of which is a size Material defines. Below 18 a
Material Symbol's strokes stop resolving and it reads as a smudge rather than a
shape, which is what the 12s and 14s were doing.

**`Badge`'s glyph is the one thing below that floor, and it is the primitive's own
number rather than a call site's.** 14 at `sm`, 16 at `md`. The floor is about a glyph
that is a control's *only* content and has to be aimed at; a badge's glyph is inside a
20 or 24px box, paired with a digit or a word at 11–12px, and read as part of that
phrase. It is also measurable rather than a matter of taste: the badge's line box is
16px, so an 18dp glyph makes a badge with an icon 2px taller than one without — which is
how a profile's role badge came to stand at 24px beside a 已核验 badge at 26, and why the
gallery thumbnail's count pills read as all icon and no number.

`Avatar` and `SkeletonCircle` are **not** on this scale: they take a box size, not
a glyph size. An avatar's steps are 32 / 40 / 48 / 56, with 40 the default because
that is `ListTokens`' leading-avatar size.

### The slider does not look like the old slider

`Slider`'s geometry is M3 Expressive's (`SliderTokens` v2_3_5) and it is worth
writing down because the instinct on seeing it is to "fix" it back: the track is
**16dp** tall, not 4, and the handle is a **4dp-wide vertical pill 44dp tall**, not
a 20dp circle. Two details carry most of the character and both look like bugs if
you do not know they are the spec:

- **The handle sits in a 6dp gap.** The track is visibly *cut* on both sides of it
  rather than passing behind it. That gap is what makes a thick track read as two
  segments with a position between them instead of a progress bar with a lump on it.
- **The handle narrows on press**, 4dp to 2dp. Not grows. M3 gives no control size
  feedback that *adds* mass on press, and a handle that swells under the finger
  hides the value it is reporting.

Nothing about the position is transitioned, also deliberately: a slider reports
where the input is, and a transition on the fill or the handle puts the mark behind
the finger for the whole drag. The only animated property is the handle's width,
which is a state rather than a position.

Touch targets: use a primitive and the question does not arise. Anything with a
custom box under `--touch-floor` — 48px under a coarse pointer (M3's minimum and WCAG
2.5.5's AAA figure), 24px under a fine one (WCAG 2.2 SC 2.5.8 at AA) — needs
`touch-target`, which expands the _hit area_ with a centred pseudo-element without
changing the layout. It cannot be combined with `data-ripple`, which clips its
overflow; those controls take `touch-size` instead, which raises the box itself to the
same floor. See the control-height section for the two rules. `Chip` at 32dp and
`Button size="xs"` are documented exceptions, on the same rule M3 states as "the touch
target may extend beyond the component bounds".

**A chip has one height, 32dp.** `AssistChipTokens.ContainerHeight` and
`FilterChipTokens.ContainerHeight` are both 32 and the token set offers no second
figure, so there is nothing for a `size` prop to choose between — it had two (36, then
40), and the 40 was this file's own doing: it moved there to land on the control-height
scale, which was the right instinct applied to the wrong kind of object.

**A drawer row's padding is asymmetric, and that is the spec's.**
`NavigationDrawer.kt`'s item is `padding(start = 16.dp, end = 24.dp)` — the extra 8dp
is there because a trailing element (an unread count) needs more air than a leading
one. It read 16/16 here, which crowded the badge against the drawer's edge. The
asymmetry holds at both densities, because it is about the badge rather than the
height. The row is a pill (`ActiveIndicatorShape`) at 48dp under a pointer and
`ActiveIndicatorHeight`'s 56 under a finger, its icon is 24dp, the gaps either side of
the label are 12dp, and the item is inset 12dp from the drawer's own edge
(`NavigationDrawerItemDefaults.ItemPadding`). Thirteen rows at 56 measured 930px of
column against a 736px phone viewport, which is what the step down is for.

The account block above those rows is **not** one of them. It is a two-line list item
— avatar, name, supporting line — so it takes `ListTokens`: a 16dp corner
(`ItemSelectedContainerShape`), 16dp leading, a 40dp avatar, and 64dp / 72dp per
pointer against `ItemTwoLineContainerHeight`'s 72. It was a 56dp pill borrowed from the
rows, and that is what made it read *smaller* than the links under it at the same
height: two lines and an avatar crushed into a box built for one line of `label-large`,
wearing the shape those rows use to mean "you are here". Its avatar still starts on the
same 28dp leading column as every nav icon, which is the part that has to agree.

The **app bar does not join that column**, and that was tried: its inset was pulled to
16/20px so its first glyph landed on the drawer's 28px line, and the result read as the
wordmark shoved into the corner. It is `px-4 sm:px-26` — 16px on a phone, 104px from
`sm` up — which is breathing room around the brand rather than a derivation. The reason
available if one is wanted: the bar spans both the drawer and the content area and
belongs to neither, so aligning it to either one's grid is a false precision.

The name is `title-m` rather than `ListTokens.ItemLabelTextFont`'s `body-large`, and
that is a stated divergence: same 16px, at `TitleMedium`'s weight and its 1.5 leading
instead of the prose role's 1.75. A name in a control is a label, and the 4px that
returns is what lets the 64dp box keep M3's own vertical padding rather than crushing
it. **The 72 has two consumers** — this block and `/messages`' contact row — and they
move together; moving one alone is what produced a 64dp contact row with no scale
behind it once before. The contact rail's collapsed width is derived from that row
(row height + the list's 8px inset either side, so the row comes out square and the
portrait centres itself), so it moves too: 80px / 88px.

`Button` ships `responsiveLabel` to collapse to a square icon button below `sm`
— use it in any row that would otherwise overflow on a phone.

No press-shrink. M3 gives no size feedback on press; the state layer and the
ripple carry it. `active:scale` utilities is not used anywhere and should not come back
— besides being off-spec, a control mid-transform corrupts the rect the hero
flight reads on press.

Two named exceptions, both from a component's own token set rather than from taste:
the **switch handle** grows 24 → 28dp on press (`md-switch`'s `PressedHandleWidth`)
and the **slider handle** narrows 4 → 2dp. A handle is the one control whose whole
job is to be gripped, and M3 gives it a grip cue; nothing else gets one.

## Scrolling

`<body>` is `overflow: hidden`. The page scroller is `<main class="app-scroller">`
in `components/AppLayout.tsx`, reachable via `getAppScroller()`. `window.scrollTo`
is a no-op — use `scrollAppToTop` / `scrollAppToElement`.

Every scroll container carries `.main-scrollbar` (page-level, reserves its gutter),
`.popover-scrollbar` (overlays, no gutter) or `.scrollbar-hide` (a horizontally
scrolled chip row or tab rail, where a visible bar is chrome the row cannot afford).
Never leave one unstyled: the browser default is a different width and colour, and
the app then appears to change its scrollbar as you navigate.

Never give a child of the scroller `min-h-dvh` — the scroller is already shorter
than the viewport (header + margins), so it forces a permanent scrollbar. Use
`min-h-full`.

## `useGSAP`

`@gsap/react`'s `useGSAP` does **not** run your cleanup on a dependency change
unless you pass `revertOnUpdate: true`. Without it, listeners, `Observer`s and
`ScrollTrigger`s accumulate on every dep change. Pass it, or keep the changing
value in a ref and shrink the dependency list.

## Module boundaries

**`lib/api.ts`'s `api` is a runtime spread, so it cannot be tree-shaken.** Every
importer of it pulls every member, and 39 files import it — including `app/page.tsx`,
`ImageCard`, `MasonryGrid` and `FeaturedBanner`. So the admin surface is **not** in
it and is **not** re-exported from it: the eleven admin tabs do
`import * as adminApi from '@/lib/api/admin'`, and each of them is already a
`dynamic(…, { ssr: false })` chunk. While those 48 functions were spread into `api`,
the home page shipped the entire admin console's API layer. Splitting the rest of the
object into named re-exports is still the end state.

The same reasoning moved `getTeamMembers` out of the admin module: it is a public,
tokenless read that `/about` renders, and it was the one thing forcing that page to
reach the admin surface.

**`PICPONY_API_BASE` is relative on purpose** — the browser's request has to go
through `app/api.php/[[...path]]/route.ts`, which rewrites the backend's `Secure`
session cookie so it survives plain HTTP. Node's `fetch` rejects a relative URL, so
anything running on the server uses `PICPONY_API_ORIGIN` with it. A server component
reaching for the relative form throws `Failed to parse URL`, which is what left
`app/user/[id]/layout.tsx`'s `generateMetadata` serving its fallback title on every
request since it was written.

**`LS_KEYS` is complete and has to stay that way.** It covered 9 of the 27 keys the
app writes, so 32 call sites restated a literal that *was* in the table — 25 of them
in `app/settings/page.tsx`, the one module whose entire job is settings persistence.
