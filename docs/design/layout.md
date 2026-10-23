# Layout

> Split out of `AGENTS.md`; read on demand. Cross-references such as "see Motion" or "under Shape" name sections listed in the index in `AGENTS.md`.

Page columns, gutters, rows, control-height and icon-size scales, sliders, chips.

Spacing is the 4dp grid (Tailwind's default scale). Half-steps (`gap-1.5`, `py-0.5`) are fine for dense chrome; arbitrary values are not.

**The page column is decided by what is in it, and there are two answers.**

| Content | Width |
| --- | --- |
| A list of rows, or an article | `max-w-4xl` |
| A masonry / image grid | `max-w-7xl` |

Twelve screens are lists — forum, messages, history, tasks, policy, about, settings, block-groups, tag-groups, subscriptions and both forum sub-pages — and they all sit at `4xl`. /block-groups and /tag-groups are one grouped run of rows each, drawn by one row (`components/groups/GroupRow.tsx`), not a grid of cards. Three are grids and sit at `7xl`, and so do the two that came with the shop and the subscriptions: /shop (a grid of items, its cart docked beside them from `@4xl`) and a subscription's gallery (`/subscriptions/[tag]`). Nothing else is a page column. The trap is a screen that holds both: the home page's two tabs share one panel, and a pane whose content is a list takes the list width regardless of what its neighbour needs.

A form is neither, and may be narrower — `/upload` is `2xl` on purpose (a 560px field column is easier to fill in than a 900px one); the admin console is `6xl` because it is data tables. `5xl` is the fifth and last: a **media-led detail column** — both profile pages and the image detail, where a banner or a picture is the subject and the text sits under it. It is not a general-purpose middle width; a screen that is a list still takes `4xl` even if it happens to be 1000px of list.

**A block inside a column is not a column**, and this is where a sixth width comes from. A block takes the width of whatever it *is*, and the answer is one of the five; if it is not, that is the signal the block is being sized by eye. (/search is a `7xl` page whose field and advanced-filter panel are a *form*, so both take the form column's `2xl` — not a `3xl` that is on no list.)

**A page has one gutter and the shell already draws it.** `[data-page-content]` is `p-4 sm:p-6`, so a screen that wraps its sections in another `p-6` insets them 40px on a phone and 48px on a desktop — invisible in review because nothing looks broken, the column is just narrower than every other screen's. A section is a heading and the block under it; the block's own tone (`.m3-row`, `Card`) is what makes it a surface.

**A structural divider is drawn in every state.** If a rule separates two regions of the drawer, it does not blink on and off with the contents of one of them — signed out the top block is still a block, it just says 未登录. (The rule *inside* the nav, between 我的 and the settings group, is a different thing and stays conditional: signed out there is no group above it.)

**A row has one reading order.** Label at the leading edge, control at the trailing edge — that is what M3's list is. A switch dropped into such a list *without* `layout="row"` renders control-then-label and leaves the right-hand half of the row empty. /settings holds this with one anatomy, `SettingsRow` (`app/settings/SettingsRow.tsx`). The label column is `min-w-0 flex-1`, so a long value wraps inside it and the control stays trailing at every width; below `sm`, an action collapses to its glyph (`RowButton`) instead of dropping under the label. There is one type pairing, `label-l` over `body-s`, and the leading slot is for media only. The row wears no state layer, because it is not a control: a row that lit up on hover answered nothing, and a switch row lit twice.

**A header's shape is decided by its column, never by a number in it.** /shop's actions (the balance and 金币明细) are one block, as wide as the column (`100cqw`) below the shop column's md step and beside the title from it. Under 21rem the balance's words go to the glyph and to a screen reader. Laid out by its content, one more digit re-wrapped the header and the page jumped 44 px under the leaving sheet. A screen with a figure in its header actions does the same, or `PageHeader` gains a breakpoint for it.

**A grouped list is one run of `.m3-row` siblings per parent.** The last row's corner is `:nth-last-child(1 of .m3-row)`; the sibling `:has()` it replaced was re-matched on every inline style the tab wave (since removed) wrote to a forum row (a trace of one 图库 → 论坛 switch counted 327 `:has()` invalidations on those rows). Every parent in the app holds exactly one run; a second run needs a parent of its own.

**A pane split follows its content width.** Search filters and blocking groups use container queries; private messages need 42rem for an 18rem contact list and a 24rem conversation. Below that, contacts and the thread share one column, including on a tablet with the app drawer open — and there an open conversation is a **full-height view of its own**: portalled into the content host beside the scroller (the page column is a size container, so nothing fixed can escape it), a modal layer with its own history entry, so the system Back closes it back to the list (`useOverlayLayer` with `history`). JS decides which, by measuring the column, because the choice is whether a layer exists. The contact-collapse preference survives resizing and only applies while both panes fit. The message composer is a deliberate 48dp dense field (28px line + 10px padding per side), with the same local 48dp floor on its accessories; ordinary form fields remain 56dp. It is an editable box in the filled field shell rather than a textarea (`ChatComposer`), so a picked emoji is the picture itself and not its `$emoji_…$` token; it grows with its content to a 160px cap and then scrolls, and it keeps its own undo history, because the engine's cannot see an insertion the page made.

## The control-height scale

**Two rules, and the second one is the one that gets forgotten.** The step set is 32 / 40 / 56 with nothing between — every step is a container height some token actually names, which is the whole point of writing it down (eight heights were once in use because nothing stated one). But a step set alone does not decide anything — that is how a 56dp dropdown ended up in a row whose other three controls were 32dp switches.

**Rule 1 — the touch floor is a *touch* floor.** M3's 48dp is WCAG 2.5.5's AAA figure and it answers a finger. A pointer's floor is WCAG 2.2 **SC 2.5.8 — 24×24 CSS px**, at AA. `--touch-floor` in globals.css is 48px and drops to 24px under `@media (pointer: fine)`; `touch-target` (a hit area, no layout change) and `touch-size` (a real `min-height`/`min-width`, for a control whose own box clips a pseudo-element away — `data-ripple` does, unless the wave paints into an inner host; see the touch-target note) both read it. Applying 48 to a mouse is not a free margin: `state-layer` keys on `:hover`, so a region wider than the paint lights the control up while the cursor is visibly outside it, and neighbours in a dense row start answering for each other. Two `@custom-variant`s, `pointer-coarse:` and `pointer-fine:`, express the axis at a call site; `MEDIA.pointerCoarse` / `MEDIA.pointerFine` are the JS twins so the two cannot drift.

Do not reach for `touch-target` on an inline target inside prose — SC 2.5.8 exempts one, and a 48px band on a line in a 28px-leading paragraph steals clicks from the lines above and below.

**Rule 2 — a control's step is decided by its enclosure, not by its type.** This is what "coordinated" means, and it is checkable: look at what the control's neighbours are, not at what the control is called.

| Enclosure | Step | Text |
| --- | ---- | ---- |
| A form column — a slot you fill in | 56 | `body-l` |
| The dense chat composer's field | 48 | `body-l` |
| The chat composer's emoji and send controls | 48, through the row's local touch floor | — |
| A filter bar, an admin surface, or inside an `.m3-row` | 40 | `body-m` for typed text; `label-l` for choices and commands |
| An app-bar action | 48 | — |
| Dense chrome: a table row's actions, a chip's dismiss cross | 32 | `label-l` |

The composer is the stated dense exception: its 28px prose line plus 10px block padding on each side makes a 48dp field. The row sets a local 48dp touch floor so both accessories match it at every pointer density. With 8dp around the trio, the one-line composer is 64dp tall; growing text increases the field until its scrolling cap. Ordinary form fields retain their 56dp baseline.

**The app bar sets its own 48dp floor**, so every `touch-size` inside its `<header>` lands at 48 whatever the pointer is. Those controls sit on a 64dp coloured band. The dense chat composer separately sets the same local floor to match its field; neither changes the global pointer-dependent floor for other controls.

**A row is a different kind of object from a control** (M3 separates them too — `ListTokens` has its own heights). Row heights take the density step:

| Row | pointer | touch |
| --- | ---- | ---- |
| Menu row, `Select` option row | 40 | 48 |
| Drawer navigation row | 48 | 56 |
| Compact two-line contact row (`/messages`) | 64 | 64 |
| The drawer's account block | 64 | 64 |

The contact row keeps the compact **64dp at every density** (owner refinement): a 40dp portrait with 12dp padding, balancing the 40dp search and collapse control above it. Its collapsed rail is derived from the same geometry — 64dp plus the list's 8dp inset either side, or 80dp. The row, portrait, skeleton and collapsed width move together; no pointer-dependent step changes the rail's geometry.

The account block is **64 with `ListTokens`' own 40dp avatar**, deliberately *not* a two-line list item even though it has two lines: it is the drawer's header, above sixteen 48dp links. 64 is one step down from the 72 list-row height with the spec's avatar intact, leaving 12px above and below the text stack — exactly M3's own item padding. 56 with a 32dp avatar made the one portrait in the shell the smallest one in the app (32 is the *dense* step, for a chat turn). Its name is `title-s`, matching the `label-l` size of every link below it.

**The page-content wrapper is a flex column, and `[&>*]:w-full` goes with it.** The column exists so `StatusView`'s `fill` can be `flex-1`. The `w-full` is not decoration: a flex item in a column is stretched on the cross axis by `align-items: stretch` **unless it has an auto margin there** — an auto cross-axis margin absorbs the free space and disables the stretch. Every page root in this app is `mx-auto max-w-*`, so without it all of them fall back to shrink-to-fit. If you touch that wrapper, measure a **width** on a tab switch, not just a height.

**48 is not a general-purpose control size.** It is the touch floor and the pointer-side drawer row, plus the explicitly dense chat composer above. Do not turn that local exception into a second ordinary form-field height.

| Step | What takes it |
| ---- | --- |
| 32 | `Button size="xs"`, `IconButton size="sm"`, `Chip` |
| 40 | the default: `Button`, `IconButton`, `Select size="sm"`, `Input size="sm"`, a menu row, `Pagination`, a control beside a field |
| 48 | a tab (`PrimaryNavigationTabTokens.ContainerHeight`), an app-bar action, the dense chat composer and its accessories, the drawer row under a pointer, and `--touch-floor` under a finger |
| 56 | `Button size="lg"`, a labelled or unlabelled `Input`, the search bar, `Select`, `ColorSwatch`, `CodeInput`, the drawer row under a finger |
| 64 | the top app bar (`AppBarSmallTokens.ContainerHeight`, at every density — the band is not repeated chrome, so the density rule does not apply to it); the drawer's account block; the compact contact row |
| 72 | a two-line list item (`ListTokens.ItemTwoLineContainerHeight`), at every density |

**A 40dp field is this app's own step, not the spec's** (`OutlinedTextFieldTokens.ContainerHeight` is 56 and M3 offers nothing else). A field in a filter bar or a list row is *chrome*: its neighbours are a 40dp dropdown and a 32dp chip, and matching them matters more than matching a token written for a phone form. Two fences keep it from spreading — it is unlabelled-only (the labelled field's notch geometry is all derived from 56dp) and its `trailing` slot takes a single 32dp control, on the same inset formula as every size, `(40 − 32) / 2`. This is `SearchInput`'s default `filter` variant; standalone people search uses its 56dp `search` variant.

Three figures went: **28** is below M3's smallest button; **36** sat between extra-small 32 and small 40, on no scale; **44** is Apple's touch figure rather than Material's, this app's own invention.

One consequence: **the two ordinary text fields are the same height.** Their boundary and corner differ, as described in the Input section; both remain 56dp in a form. The dense steps belong to their own enclosures and do not change that form baseline.

`Button size="sm"` is gone rather than retuned: at 40dp it was `md`, and two names for one box is the problem, not the fix. Its 32 call sites moved to `xs`, because every one had been chosen to be *smaller* than the default and that intent maps to M3's extra-small.

Button padding is **16 / 16 / 24** by size and the icon gap is 8 at every size — `IconLabelSpace` does not vary in the token set, which is why a 32dp button and a 56dp one put the same air between glyph and label. `ButtonXSmallTokens.LeadingSpace` is 16dp, the same as small's; only the medium step widens.

The **glyph size belongs to the button**, not to the call site: `IconSize` is 20 at extra-small and small, 24 at medium, and both `Button` and `IconButton` size their own icon slot.

**A press does not morph the corner**, and the spec does specify that it should (`ButtonSmallTokens.PressedContainerShape` is `CornerSmall` (8dp), `ButtonMediumTokens`' is `CornerMedium` (12dp)) — both were implemented and came out anyway; they were animated `border-radius` only, deliberately not a transform. On a pill the corner has nowhere to travel *to* that reads as feedback. Press feedback is the state layer and the ripple, which is what every other control in the app uses. A **selected** icon button is still a rounded square rather than a circle, per `SelectedContainerShapeRound` — that is a state, not a press.

## The icon-size scale

**18 / 20 / 24 / 36 / 48**, through `ICON` in `lib/icons.ts` — `size={ICON.standard}`, never a number.

| Name | dp | What takes it |
| --- | -- | --- |
| `dense` | 18 | inside a chip, or beside a line of metadata |
| `control` | 20 | inside a button or a dense icon button |
| `standard` | 24 | the default: a list row, a nav row, an app-bar action, a field adornment |
| `large` | 36 | a large FAB's glyph, or one prominent affordance |
| `display` | 48 | an illustration: the glyph over an empty state or an error |

Below 18 a standalone Material Symbol stops resolving clearly. **Supporting marks have explicit primitive-owned exceptions**: `Badge` uses 14 at `sm` and 16 at `md`; `Select` draws its 16dp light `CheckGlyph` inside a reserved 20dp slot. These marks accompany text and are not separate targets. The badge's line box is 16px, so an 18dp glyph would make a badge with an icon 2px taller than one without; the listbox's reserved slot similarly keeps selection from moving its label.

`Avatar` and `SkeletonCircle` are **not** on this scale: they take a box size, not a glyph size. An avatar's steps are 32 / 40 / 48 / 56, with 40 the default because that is `ListTokens`' leading-avatar size.

## The slider does not look like the old slider

`Slider`'s geometry is M3 Expressive's (`SliderTokens` v2_3_5) and the instinct on seeing it is to "fix" it back: the track is **16dp** tall, not 4, and the handle is a **4dp-wide vertical pill 44dp tall**, not a 20dp circle. Two details carry most of the character and both look like bugs if you do not know they are the spec:

- **The handle sits in a 6dp gap.** The track is visibly *cut* on both sides of it rather than passing behind it — that gap is what makes a thick track read as two segments with a position between them instead of a progress bar with a lump on it.
- **The handle narrows on press**, 4dp to 2dp. Not grows. M3 gives no control size feedback that *adds* mass on press, and a handle that swells under the finger hides the value it is reporting.

Nothing about the position is transitioned, also deliberately: a slider reports where the input is, and a transition on the fill or the handle puts the mark behind the finger for the whole drag. The only animated property is the handle's width, which is a state rather than a position.

**The painted track spans the handle's travel, not the box.** The native thumb's centre only travels from half its width to the far end less half its width, and the handle is drawn there; a track painted edge to edge left an active stub at the minimum with the handle standing 22px in, so the minimum read as above it (and the maximum mirrored it). **Focus is on the handle**, as M3 draws it — the ring used to wrap the whole 44dp-tall control in a pill.

Touch targets: use a primitive and the question does not arise — `Button` (every size), `IconButton`, `Chip` (its label and its cross), `Select`'s trigger and `Tabs` reach `--touch-floor` themselves. Anything with a custom box under it — 48px under a coarse pointer (M3's minimum and WCAG 2.5.5's AAA figure), 24px under a fine one (WCAG 2.2 SC 2.5.8 at AA) — needs `touch-target`, which grows a pseudo-element by negative insets to the floor on whichever axis falls short: the layout does not change, and a control that already clears the floor answers for exactly its own box (under a mouse, that is every control). `touch-target-block` grows the block axis only, for two targets side by side in one control (a chip's label and its cross). A box that clips throws the pseudo-element away, and `data-ripple` clips its wave; such a control either takes `touch-size`, which raises the box itself, or — what the primitives do — carries `data-ripple="inner"` and paints its wave into a `[data-ripple-host]` first child that does the clipping instead. Under a finger a chip also takes 4dp of margin above and below, so an 8dp-gapped row wraps on a 48dp pitch and each 48dp target meets the next row's rather than covering it — the layout Compose's `minimumInteractiveComponentSize` reserves. `Chip` at 32dp and `Button size="xs"` keep their painted size; the target extends beyond the component bounds, as M3 states it. The same primitives carry `touch-manipulation` (no double-tap zoom on a pager or a like) and `select-none` (a long press on a label does not select it). See the control-height section for the two rules.

**A chip has one height, 32dp.** `AssistChipTokens.ContainerHeight` and `FilterChipTokens.ContainerHeight` are both 32 and the token set offers no second figure — there is nothing for a `size` prop to choose between.

**A drawer row's padding is asymmetric, and that is the spec's.** `NavigationDrawer.kt`'s item is `padding(start = 16.dp, end = 24.dp)` — the extra 8dp is there because a trailing element (an unread count) needs more air than a leading one. The asymmetry holds at both densities, because it is about the badge rather than the height. The row is a pill (`ActiveIndicatorShape`) at 48dp under a pointer and `ActiveIndicatorHeight`'s 56 under a finger, its icon is 24dp, the gaps either side of the label are 12dp, and the item is inset 12dp from the drawer's own edge (`NavigationDrawerItemDefaults.ItemPadding`).

The account block above those rows is **not** one of them. It is a two-line list item — avatar, name, supporting line — so it takes `ListTokens`: a 16dp corner (`ItemSelectedContainerShape`), 16dp leading, a 40dp avatar, and 64dp at every density against `ItemTwoLineContainerHeight`'s 72 (the step down argued above). It must not wear the rows' pill shape, which is how those rows mean "you are here". Its avatar still starts on the same 28dp leading column as every nav icon — the part that has to agree.

The **app bar does not join that column**: it is `px-4 sm:px-26` — 16px on a phone, 104px from `sm` up — breathing room around the brand rather than a derivation. The bar spans both the drawer and the content area and belongs to neither, so aligning it to either one's grid is a false precision.

The name is `title-m` rather than `ListTokens.ItemLabelTextFont`'s `body-large`, and that is a stated divergence: same 16px, at `TitleMedium`'s weight and its 1.5 leading instead of the prose role's 1.75. A name in a control is a label, and the 4px that returns is what lets the 64dp box keep M3's own vertical padding. `/messages`' contact row deliberately keeps that compact 64dp step at every density (owner refinement above), with a 40dp portrait and an 80dp collapsed rail; the toggle row's touch step remains 72dp.

`Button` ships `responsiveLabel` to collapse to a square icon button below `sm` — use it in any row that would otherwise overflow on a phone.

No press-shrink. M3 gives no size feedback on press; the state layer and the ripple carry it. `active:scale` utilities is not used anywhere and should not come back — besides being off-spec, a control mid-transform corrupts the rect the hero flight reads on press. Two named exceptions, both from a component's own token set rather than from taste: the **switch handle** grows 24 → 28dp on press (`md-switch`'s `PressedHandleWidth`) and the **slider handle** narrows 4 → 2dp. A handle is the one control whose whole job is to be gripped, and M3 gives it a grip cue; nothing else gets one.
