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
| On/off setting           | `components/ToggleSwitch.tsx` — `layout="row"` in a list   | a `justify-between` div with a bare switch in it  |
| Card / section surface   | `components/Card.tsx`                                      | `bg-surface-container-low rounded-… p-4`          |
| Dropdown (picks a value) | `components/Select.tsx`                                    | a hand-rolled absolutely-positioned menu          |
| Menu (runs a command)    | `components/Menu.tsx`                                      | a `role="menu"` div with no keyboard support      |
| Any other floating panel | `components/Popover.tsx`                                   | a fifth recipe for corner + elevation + border    |
| Dialog                   | `components/Modal.tsx`                                     | a hand-rolled scrim + panel                       |
| "Are you sure?"          | `useConfirm` (`components/ConfirmDialog.tsx`)              | `window.confirm`, or a `Modal` + 4 useStates      |
| Asking for one value     | `usePrompt` (`components/ConfirmDialog.tsx`)               | `window.prompt`                                   |
| Copying to the clipboard | `copyText` (`lib/utils.ts`)                                | `navigator.clipboard.writeText` with no fallback  |
| Bottom sheet             | `components/Sheet.tsx`                                     | a `Modal` on a phone                              |
| Icon-only control        | `components/IconButton.tsx` — `variant="media"` on a photo | `p-2.5 rounded-full` around a glyph               |
| Icon control on the app bar | `IconButton` `variant="on-primary"`                     | a 44px box repeating `focus-ring-on-primary`      |
| A close / dismiss control | `IconButton` `dismiss`                                    | hand-writing the quarter-turn hover               |
| Heading above a card or list | `components/SectionHeading.tsx`                         | an `<h2 class="text-title-m-…">` written out      |
| Tag / status pill        | `components/Chip.tsx`                                      | —                                                 |
| Mark beside a name       | `components/Badge.tsx` — `tone="media"` on a photo          | an inline `<span>` with a container pair          |
| Unread count             | `CountBadge` (`components/Badge.tsx`)                       | a hand-clamped `99+` pill                         |
| Role beside a username   | `components/RoleBadge.tsx`                                 | `roleInfo(x).chip` on your own `<span>`           |
| Nothing here / it failed | `EmptyState` / `ErrorRetry`                                 | a centred `<p>` in a `<div>`                      |
| Tabbed panes             | `TabPanes` / `TabPane` (`components/TabPanes.tsx`)          | `{active === 'x' && …}`, or a `key` on the panel   |
| Chat message             | `components/ChatBubble.tsx`                                | `rounded-2xl` picked by eye                       |
| Overlay behaviour        | `lib/overlay.ts` hooks                                     | a second copy of the focus trap / scroll lock     |
| Press feedback           | `data-ripple` + `state-layer`                              | an active-scale utility                           |
| Scroll-in reveal         | `useScrollReveal` (`lib/motion.ts`) — see note below       | mount-time fades                                  |
| Scrolling to an element  | `scrollAppToElement` (`lib/motion.ts`)                     | `el.scrollIntoView({ behavior: 'smooth' })`       |

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

**A text field's label floats into its outline.** It used to sit stacked above
the control, and the argument for that was that M3 allows both and changing ~40
forms bought nothing. It buys one thing, which is the whole point of the
pattern: an empty field and a filled one stop being different objects. With a
stacked label, a form of six empty fields is six blank boxes and six captions
floating between them — and the caption belonging to the box *below* it is
exactly as close as the one belonging to the box above.

The notch is a real `<fieldset>`/`<legend>` pair, not a label painted over the
border with a matching background: an M3 outlined field has no fill, so there is
no colour to paint with, and a `<legend>` is the only thing in CSS that removes a
section of a border. Two elements therefore carry the same words — the `<label>`
the user reads and an invisible copy inside the `<legend>` whose only job is to
be the right width. They stay in step because the legend's font-size is exactly
0.75x the label's and the label scales to 0.75 as it floats, 0.75 of `body-l`
being `body-s`. All of that lives in `.m3-field` in globals.css, because it turns
on `:focus-within` and `:placeholder-shown` matching against a *sibling*.

`Input` therefore has two heights, and the difference is content rather than
density: a floating label needs a label row and a text row, so a labelled field
takes M3's 56dp, and an unlabelled one — a search box, an admin filter — is one
row at 44dp. A labelled field with nothing to suggest is given a single-space
placeholder, because `:placeholder-shown` is what tells the label whether the
field is empty and it only matches while a placeholder exists.

Both are easy to write out by hand without noticing, because the class string is
short and looks harmless: `rounded-full px-2 py-0.5 text-label-m` plus a
container/ink pair was pasted at fifteen sites, in three type roles, and each one
had to name both halves of its colour. The tell is `rounded-full` on something
holding text that is not a button — for a dismissible tag that is also the wrong
shape twice over, since a chip is 8dp.

`Button` variants, so a semantic action never has to be hand-rolled:
`filled` · `tonal` · `accent` · `outlined` · `text` · `danger` · `danger-text` ·
`success` · `warning`. The four semantic ones take the scheme-independent
`*-fill` pair rather than the `error`/`success`/`warning` *text* roles, which flip
between schemes — a filled confirm button wearing a text role visibly swapped
shade with the theme. `danger-text` exists because `variant="text"` plus a
`className="text-error"` emits two colour utilities and lets Tailwind's output
order decide which wins; `cn` is a plain join and resolves nothing.

## Colour

Only `--md-sys-color-*` tokens, via their Tailwind utilities (`bg-surface`,
`text-on-surface-variant`, `border-outline-variant`, …). No raw hex, no `rgb()`,
no Tailwind palette classes (`bg-slate-800`, `text-red-500`).

A `dark:` variant is almost always a bug: the token already flips. The legitimate
uses are swapping a whole asset (`Logo.tsx`) and nothing else. Reach for the
container/on-container pair instead of hand-picking a second tint.

Pair only within a role — `primary`/`on-primary`, `surface-container`/`on-surface`.
Dividers use `outline-variant`; text-field borders use `outline`.

**An alpha on a token is a bug.** `bg-primary/10`, `border-error/40`,
`text-on-media/60` — each one has to be eyeballed once per scheme, and each one
drifts, because nothing makes the next call site pick the same number. The
symptom is always the same: the tint that looked right on the light surface is
nearly invisible composited over the dark one. Use the tone scale
(`surface-container-*`) or the container/on-container pair instead. If you need a
weight that no token has, add the token.

Three alphas are legitimate and all of them are M3 numbers, not taste:
`bg-on-surface-variant/40` (sheet drag handle), the `--md-sys-state-*`
opacities, and `bg-scrim/50` (the dim behind a dialog, sheet or drawer — one
value, three call sites).

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
`focus-ring-on-primary` for chrome on the app bar. Never tint it per variant —
a focus ring answers "where is the keyboard", so it has to look identical on
every control. It is solid, not tinted: `primary/40` composites to about 1.4:1
against a light surface, under the 3:1 WCAG 2.4.11 asks of a focus indicator.

The third form is `focus-visible:inset-ring-2 focus-visible:focus-ring-inset`,
and it is the same ring painted inward rather than a second style. A ring is a
`box-shadow`, so an ancestor that paint-contains throws it away entirely — and
the app has two kinds that do: a gallery card (`.image-card` is
`contain: layout paint style`) and any media box clipping its corners with
`overflow-hidden rounded-*`. A full-bleed control inside one of those — the
spoiler cover, a zoom target — was rendering a focus indicator that was then
discarded. Reach for it only when the enclosure clips; everywhere else the ring
goes outside, where it does not eat 2px of the control.

The **text field** has no ring, and that is not an exception to the rule above
so much as a fourth place the same ring is painted. Its focused state is its own
outline at `primary` and 2px — the ring's colour, at the ring's weight, drawn as
the control's boundary instead of as a second boundary 2px outside the first. A
control whose entire visual identity *is* a 1px outline cannot wear a ring around
that outline without reading as two nested boxes, and M3 specifies the thickened
outline as this control's indicator for that reason. Everything else about it is
unchanged, including that it is the same colour on an error field: a focus ring
answers "where is the keyboard", never "what is wrong".

**`outline` is a boundary role, not an ink role.** It is built for a rule or a
text-field border and is specified to 3:1, which is the bar for a *non-text*
element. Measured against this app's own light surface it lands at 4.3:1 —
under the 4.5:1 WCAG AA asks of normal-size text — while in the dark scheme it
reaches 5.8:1 and passes. That asymmetry is why `text-outline` spread to 57
pieces of supporting text before anyone noticed: it is only wrong in one of the
two schemes, and it is the scheme people ship from less often. Supporting text
is `on-surface-variant` (8.5–9:1 light, 10:1 dark). `text-outline` on a *glyph*
is fine — 4.3:1 clears the 3:1 non-text bar.

Deliberate divergences from the spec, all commented in `globals.css`. Do not
"fix" them:

- `primary`, `*-fill`, `media-stage`, `on-media*` and `media-plate` do not invert
  between schemes. A brand colour, a graphic fill and anything sitting on a
  photograph must read as one constant material; only text roles flip.
- Body/label line-heights run looser and tracking runs at half the spec value,
  because Han glyphs fill the em box.
- `accent-*` is a _categorical_ scale (tag categories, staff roles), not a
  semantic one. `lib/tagCategories.ts` is the only thing allowed to pick a hue.

## Shape

The step is decided by the role, never by eye:

| Role                                            | Class          | Value |
| ----------------------------------------------- | -------------- | ----- |
| Button, FAB, avatar, circular icon button       | `rounded-full` | —     |
| Unread count pill, list row in a nav            | `rounded-full` | —     |
| Card, section surface, text field, colour swatch | `rounded-md`  | 12dp  |
| Chip, small tag                                 | `rounded-sm`   | 8dp   |
| Menu, popover, autocomplete                     | `rounded-sm`   | 8dp   |
| Badge, inline code, seam in a grouped list      | `rounded-xs`   | 4dp   |
| Dialog, Sheet, chat bubble, large media         | `rounded-2xl`  | 28dp  |
| Gallery thumbnail / grid tile                   | `rounded-lg`   | 16dp  |
| Profile hero banner, `sm` and up                | `rounded-3xl`  | 36dp  |

A **chip is 8dp, not a pill.** This table used to say `rounded-full`, which
contradicted `Chip.tsx` — the primitive has always rendered the spec's 8dp — and
the contradiction had a cost: four filter chips in `/search` and the admin
console were hand-rolled as `rounded-full px-3 py-2` pills, presumably by
someone reading this table rather than the component.

The same accident then happened in reverse. `Select` rendered its menu at 4dp
with a comment arguing for it, while the emoji picker rendered 8dp with a comment
arguing the opposite, so the two pieces of prose in the codebase contradicted
each other and this table agreed with neither implementation. The M3 shape scale
settles it: `small` (8dp) is specified for "text fields, **menus**", and 4dp
`extra-small` is for chips and snackbars. The code was wrong and the table was
right — which is the argument for reading the spec rather than measuring one
reference implementation and generalising from it.

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

A **chat bubble** takes the 28dp step, which is the one place a small element
legitimately takes the largest one: roundness *is* the semantics of a speech
bubble. Its tail corner is `rounded-sm`, and only the last bubble of a run has
one — see `ChatBubble`.

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
| Dialog, FAB, search                      | `e3`  |

Four floating surfaces sat at `e3` — the share menu, the emoji picker and two
autocompletes — which put a tray of emoji above `Modal`. `Popover` owns this now;
if you are typing an elevation onto a floating panel, you are hand-rolling one.

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

`title-*` and `label-*` carry their own `font-weight` token, and `@layer base`
gives `h1`–`h6` theirs. Adding `font-bold`/`font-semibold` on top of those
overrides the token — don't.

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

The heading roles deliberately carry no weight token — `@layer base` owns h1–h6's
weight — so a `display-*`/`headline-*` utility must not fight the element. The
body roles are the opposite and *do* declare 400, because they land on spans
anywhere, including inside a heading, where they were inheriting the h1's 700 and
being beaten back with a bare `font-normal` at the call site.

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
| State layer settling in or out                       | 150ms    | `standard`   |

Those six are the whole scale. A duration outside it is a bug — `duration-150`
is the state layer's and nothing else's, and it belongs to the `state-layer`
utility rather than to a call site.

Two systems are exempt and both are commented where they live. The
shared-element flight (`lib/hero/constants.ts`) is spring-driven: its 340/280ms
are the envelope a sampled `HERO_FLIGHT_RESPONSE` is fitted to, and its reveal
cascade (270/285ms at 45/65/95ms offsets) is timed against that envelope, so
rounding any one of them to a token value desynchronises the rest. The other is
`transition-ui`, which is 200ms because it is the app-wide UI transition and
every hover in the app settles on it together; a lone element moved to 300 is
the bug, not the utility. Where a hover has more than one moving part, make them
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
standalone properties), so for a long time the drawer still slid 288px, the tab
pill still translated, the switch handle still travelled and `Select`'s chevron
still rotated under the preference. One rule re-declaring `transition-property`
now drops every moving property while keeping colour, opacity and shadow, because
losing those would turn hover and focus into a flicker rather than a state.

## Two traps that make a fix look applied when it is not

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
does not skip comments, so a comment naming a class you just deleted puts it
straight back into the stylesheet. 13 of the classes this document and the code
comments describe as removed or forbidden were still being shipped — including two
Tailwind palette classes and the `active:scale` utilities this file says "should not come
back". The cost is not weight, it is that you can no longer grep the CSS to prove
a class is gone. When documenting a value you removed, spell it in prose ("a 25%
alpha on `ring-primary`") rather than as the class.

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


## State layers

Hover/focus/press are the `state-layer` utility — a tinted overlay at the M3
alpha, painted from the element's own `color`. Not `hover:bg-primary/90`, which
has to be written twice (light + dark) and drifts.

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

**A page has one gutter and the shell already draws it.**
`[data-page-content]` is `p-4 sm:p-6`, so a screen that wraps its sections in
another `p-6` insets them 40px on a phone and 48px on a desktop — and it is
invisible in review because nothing looks broken, the column is just narrower
than every other screen's. /settings had six of them, each also painted
`bg-surface`, which is the scroller's own colour: six "cards" the exact tone of
the page behind them, doing nothing but the padding. A section is a heading and
the block under it; the block's own tone (`.m3-row`, `Card`) is what makes it a
surface.

**A row has one reading order.** Label at the leading edge, control at the
trailing edge — that is what M3's list is, and it is what every value row
already did. A switch dropped into such a list *without* `layout="row"` renders
control-then-label and leaves the right-hand half of the row empty, so a
settings card alternated between two opposite reading orders down its own
length.

Touch targets: `Button`'s own scale (36 / 40 / 48px) is the sanctioned one —
use the primitive and the question does not arise. Anything with a custom box
under 44px needs the `touch-target` utility, which expands the _hit area_ with a
centred pseudo-element without changing the layout. It cannot be combined with
`data-ripple`, which clips its overflow; those controls need a genuinely bigger
box. `Chip` at `h-8` is a documented exception.

`Button` ships `responsiveLabel` to collapse to a square icon button below `sm`
— use it in any row that would otherwise overflow on a phone.

No press-shrink. M3 gives no size feedback on press; the state layer and the
ripple carry it. `active:scale` utilities is not used anywhere and should not come back
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
