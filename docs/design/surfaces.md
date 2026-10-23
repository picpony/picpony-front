# Surfaces: shape, elevation, stacking and state layers

> Split out of `AGENTS.md`; read on demand. Cross-references such as "see Motion" or "under Shape" name sections listed in the index in `AGENTS.md`.

## Shape

The step is decided by the role, never by eye:

| Role                                            | Class          | Value |
| ----------------------------------------------- | -------------- | ----- |
| Button, FAB, avatar, circular icon button       | `rounded-full` | —     |
| Unread count pill, list row in a nav            | `rounded-full` | —     |
| Search field (`Input shape="pill"`, implied by `size="lg"`) | `rounded-full` | —     |
| Search suggestions (`Popover variant="search"`) | `rounded-2xl` | 28dp |
| Card, section surface, palette tile             | `rounded-md`   | 12dp  |
| Square icon button (back affordance, hovered)   | `rounded-md`   | 12dp  |
| Chip, small tag                                 | `rounded-sm`   | 8dp   |
| Tab hover tint / focus ring, top corners only   | `rounded-t-md` | 12dp  |
| Outlined text field (the `.m3-field` outline)   | `rounded-xl`   | 20dp  |
| Colour swatch, one-time-code box                | `rounded-xs`   | 4dp   |
| Filled text field, `Select shape="field"`       | `rounded-sm`   | 8dp   |
| Menu / listbox row, ordinary autocomplete row   | `rounded-sm`   | 8dp   |
| Menu, popover, ordinary autocomplete panel      | `rounded-lg`   | 16dp  |
| Badge, inline code, seam in a grouped list      | `rounded-xs`   | 4dp   |
| Snackbar / toast                                | `rounded-xs`   | 4dp   |
| Plain tooltip                                   | `rounded-xs`   | 4dp   |
| Navigation drawer, trailing corners only        | `rounded-r-lg` | 16dp  |
| Dialog, Sheet, large media                      | `rounded-2xl`  | 28dp  |
| Gallery thumbnail / grid tile, chat row         | `rounded-lg`   | 16dp  |
| Profile hero banner, `sm` and up                | `rounded-3xl`  | 32dp  |

The scale is M3's: 0 / 4 / 8 / 12 / 16 / 20 / 28 / 32 / 48, nothing between steps. `rounded-3xl` was 36dp — not one of them — the token moved rather than the two call sites, since 36 was only ever the distance between 28 and 48 split in half.

A **snackbar is 4dp** (`corner-extra-small`): a transient message, distinct from the rounder menu surface you act inside. The **navigation drawer rounds only its trailing corners**, and only while modal — a docked drawer is flush with the edge it docks to, so the rounding is `rounded-r-lg md:rounded-none`.

**A box inside another box does not take its own row of this table.** Nested corners are concentric when `inner = outer - gap`, and the eye reads a violation immediately: an inner corner rounder than `outer - gap` bulges toward the frame, a squarer one leaves a crescent of dead space. Look up the enclosure's radius, subtract the gap, and use that — the table gives the *outermost* box's step, not every box's. The rule only bites while the gap is small (treat roughly 8px as the line): two corners 16px apart are neighbours, not a ring inside a ring, and forcing the arithmetic produces a 0dp corner on something that should not have one — what `DetailBack` documents about itself.

Shortcut worth knowing: **a centred pill inside a pill is concentric for free, at every size** — `outer - gap` is always half the inner capsule's height, so the arithmetic can never be wrong. That is why /search's field is a 56dp pill rather than a 12dp box: the submit button and 以图搜图 sit in its trailing slot, and at 12dp with a 4px gap they would each need a remembered 8dp corner, whereas two ordinary pills in a pill are correct by construction. A square-cornered `Button` variant was added for the 12dp version and removed with it — `inner = outer` is the misreading of this rule, not the rule. **The pill is a shape (`shape="pill"`), not a size's** — `size="lg"` implies it, and the dense 40dp filter field (`SearchInput`), the tag-subscribe box and 搜原站标签's own search field ask for it outright, because a search field is one object at two heights and one corner: keyed on the height instead, the dense one would have had to become a 56dp bar to get its own shape. `Input` emits `data-shape` for all of them and `globals.css` writes the radius once.

A **chip is 8dp, not a pill.** This table used to say `rounded-full`, contradicting `Chip.tsx` (the primitive always rendered the spec's 8dp); the cost was four filter chips in `/search` and the admin console hand-rolled as `rounded-full px-3 py-2` pills by someone reading this table rather than the component.

**Menu geometry is one nested family: 16dp panel, 8dp inset, 8dp row corner.** The 8dp inset is **`Popover`'s own**, on both variants — it is one half of the concentric arithmetic (a row's corner is the panel's less the inset), so a call site that forgot it got 8dp rows flush against a 16dp panel, with a crescent of surface at each corner; five of the seven menu panels passed `p-2` and /messages' people search was the one that forgot. A panel that is *not* a list of rows and supplies its own padding stands it down with `inset={false}` — one call site, the emoji picker, which wants none at its foot; a `className` cannot do it, since `cn` is a plain join and `p-2` beside `pt-2` leaves Tailwind's output order to decide the other three sides. `Popover`'s content wrapper supplies the 2dp inter-row gap. Rows have a 40dp minimum under a fine pointer and 48dp under a coarse pointer. `estimateMenuHeight` includes both the insets and these gaps.

**A row of a list a field suggests is `suggestionRow` (`components/Popover.tsx`), never a string at the call site.** Five screens offer one — /search, 订阅标签, a block or tag group's tag field, the glossary's Derpibooru lookup, /messages' people search — and five hand-copied recipes had drifted to three geometries, two of each number that matters: 8 and 20dp corners, 8 and 12dp inline padding, 12 and 16dp gaps, 40/48 and 56dp rows. One disagreed with *itself*: a two-line row declared the 40dp dense floor, estimated 48 and laid out at 50, and the estimate is what picks the panel's side. So the geometry lives beside the panel's, because it is derived from it, and the function returns the row's `height` for `estimateMenuHeight` as well as its classes — one number, stated once. `variant` must match the `Popover`'s; `lines: 2` raises a menu row to 56dp, since a 20dp label over an 18dp supporting line does not fit a dense row and 56 is the next step the scale offers. `py-1` at every size: the min-height decides each of these rows (the tallest content any holds is a `body-l` line over a `body-s` one, 46px), so the padding only governs a line that wraps. A row paints a press wave like every other list row in the app — `getOptionProps` carries `data-ripple`, and the delegated gate reads the `aria-disabled` beside it.

`Select` matches its trigger's width. Its row's 8dp inline padding plus the panel's 8dp inset align labels with the trigger's 16dp inset. The trailing mark reserves a 20dp slot, like the trigger arrow, and draws a 16dp `CheckGlyph weight="light"` inside it; selection changes opacity without adding width. A command menu may be intrinsically wider than its trigger: `matchAnchorWidth={false}` centres it on the trigger, then clamps it within the viewport. Do not widen a `Select` menu independently to hide an alignment problem.

**These corners are deliberate project refinements, not verbatim M3 component mappings.** The token sources still assign `CornerExtraSmall` to `MenuTokens.ContainerShape` and `OutlinedTextFieldTokens.ContainerShape`, and `CornerExtraSmallTop` to filled fields. The outlined field takes 20dp; this app chooses 8dp filled fields and 16dp menus with inset rows for the rounder, coherent surface requested here. Search suggestions keep their separate 28dp / 20dp / 8dp geometry.

When citing what the specification says, **read the token file, not a summary table**, and distinguish it from these stated divergences. The generated `androidx.compose.material3.tokens` sources are fetchable —

    base=https://android.googlesource.com/platform/frameworks/support/+/refs/heads/    androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3
    curl -s "$base/tokens/<Component>Tokens.kt?format=TEXT" | base64 -d

— every number in this file that says "M3 specifies" should be checkable that way; where a summary and a token file disagree, the token file is what generates the components.

Write the step you mean. A bare `rounded` resolves to `--radius` (4dp, same as `rounded-xs`) but says nothing about *why* — which is how 92 call sites ended up at 4dp with no role between them (icon buttons and badges that wanted `full`, skeleton bars that wanted whatever the thing they stand in for wants). `rounded-xs` is the step; use it where 4dp is the answer.

A **badge is a rounded rectangle and a count is a pill** — one row of this table split in two. M3's badge is round because M3's badge is a *number*: a dot, or a count no wider than it is tall (`CountBadge`). A badge carrying a word (Lv.13, 已核验, an earned badge's name) is a short block of text, and a full pill around text reads as a button that has lost its handler — the confusion `Chip` sits on the other side of. 4dp rather than the chip's 8dp because the box is only ~20px tall at `sm`, where an 8dp corner is 40% of the height and is a capsule again — pick the radius against the box, don't inherit it from a bigger relative.

A **chat message is a list row, not a lozenge** — 16dp, with the seams inside one turn cut to the grouped-list 4dp. It was 28dp on the argument that roundness *is* the semantics of a speech bubble; the argument lost to the thread it produced: at 28dp a two-word message is a capsule and a long one a stadium, so a column reads as a bag of lozenges, not something you can scan. What a thread keeps from the bubble is per-message width — each row only as wide as its own text, the ragged right edge carrying the rhythm of speech. The gap between rows of one turn is 2dp (`ListTokens.SegmentedGap`), which lets the 4dp seams close against each other. See `ChatBubble`.

**A direct message is plain text, and a card is not a bubble.** What was typed is what is shown: line breaks kept, links made clickable, `$emoji_<name>$` drawn as the picture — no Markdown (`app/messages/messageText.ts`; a line starting `1. ` became a list). Messages the original front end sent are BBCode and read into the same plain model. A shared picture, folder or privacy space is a card in its own surface, and one to three emoji alone draw large; both are `ChatBubble attachment`, with no bubble fill around them. Share cards are the original front end's wire format verbatim (`encodeShare` / `parseShare`, `lib/api/messages.ts`), so either front end renders the other's.

A **placeholder inherits the radius of the thing it replaces**, so `Skeleton` stands its own default down when the call site names one — `cn` is a plain join and does not resolve Tailwind conflicts, so passing a radius used to emit two and let output order decide.

`rounded-lg` is pinned to `HERO_TARGET_RADIUS_PX` in `lib/hero/constants.ts` — the shared-element flyer morphs its corner to that value on landing, so the two must stay equal.

## Elevation

`shadow-e1` … `shadow-e5` only. Never `shadow-sm/md/lg/xl` — tuned for a white page, invisible on the dark scheme's near-black surfaces. Depth comes from the `surface-container-*` tone scale first; a shadow is for things that genuinely float (dialogs, popovers, the FAB). The level is decided by the object, not by how much it should stand out:

| Object                                   | Level |
| ---------------------------------------- | ----- |
| Modal bottom sheet, search suggestions   | `e1`  |
| Menu popover / ordinary autocomplete, floating nav | `e2` |
| Dialog, FAB, snackbar                    | `e3`  |

**Ordinary controls and cards do not cast shadows, including on hover.** The user's visual direction is grounded tonal surfaces: buttons respond through their state layer and material, and `Card` variants through the surface scale. `elevated` remains a lighter surface variant for compatibility, with no rest or hover shadow. A pagination number, slider handle and table row are flat too. Shadows remain appropriate for a detached overlay whose overlap needs explaining — dialogs, sheets, menus and the floating nav — and stay on the shared elevation ladder. Do not blanket-remove box shadows: the keyboard ring and crop mask use that CSS mechanism without being elevation effects.

**The search suggestion view belongs to the search bar.** `Popover variant="search"` owns its matching width, 28dp corner, `surface-container-highest` and restrained `e1` overlap cue. Its 56dp suggestion rows sit 8dp inside the panel with 20dp corners and 2dp gaps. **Their 12dp inline padding is not a free number**: 8 + 12 = 20px is where `.m3-field[data-size='lg'] > .m3-field-lead` draws the field's own magnifier, and a 24dp leading slot plus `gap-3` carries the label to 56px, which is `--field-lead` — where the text you typed starts. Measured in Edge, the glyph and the label land on both of the field's columns exactly; at 8dp padding and a 16dp gap only the label did, and the row's glyph sat 4px inside the field's. The app's **other** 56dp search bar, 订阅标签, therefore gets this view too rather than a menu panel under a pill (its field carries no leading glyph, so only the row's own rhythm is shared). **It expands and shrinks rather than only fading** — see the motion note below. The list is **kept** while the next lookup is in flight (`keepPrevious` on `tagSuggestions`), replacing its rows when the answer lands rather than closing and reopening on every keystroke, and the panel's height follows that replacement instead of jumping. With nothing typed it lists the recent searches (`LS_KEYS.searchHistory`, the original front end's key), opened by a press, a clear or ArrowDown, never by focus alone. Ordinary menu popovers use the 16dp outer shape and anchored menu transition described below.

**A popover is a frame around a scroller, not a scroller.** `Popover` holds the 8dp inset and clips (`overflow: clip` — no scroll container, so nothing can scroll it to a stray offset); the rows scroll in a marked box inside that inset, with the rows' own corner. A padded scroll container gives its padding away the moment it scrolls: at any offset the content's top is above the padding box, so a row sat flush against the panel's top edge and ran **under its 28dp corners** (screenshotted), and the list read as bleeding out of the surface rather than sitting in it. The frame keeps the inset at both ends, puts the scrollbar 8dp inside the corner instead of across it, and cuts a half-scrolled row at a straight edge. The emoji picker wants this too — its caption is `sticky bottom-0` against "whichever surface scrolls the picker", and that is now the inner box, measured still flush with the panel's own bottom edge. Two consequences for callers: the scroller, not the panel, is what `PopoverHandle` hands you for scrolling, and a row's position inside it is read from **layout offsets, never rects** (`revealRow`, `lib/overlay.ts`) — a menu's panel carries a scale transform for its whole entrance and the search view's box carries a height animation, both of which a rect reports; measured against the scaled box, `Select` revealed the chosen row of twenty 448px short of it.

**The ladder holds its alpha constant and grows only its geometry** — that is how M3 specifies it, and backwards is invisible one level at a time and obvious across the set: the light shadows once ramped 0.05 → 0.10 *as well as* growing their blur, so five levels spanned a factor of two in alpha and `e1` beside `e2` could not be told apart. Adding a level: copy the alpha, change the geometry.

**A surface that is not a box casts its shadow as a filter.** A box shadow follows the border box, so a speech bubble's tail — a square of the bubble's own material turned 45° — cast none, and the bubble read as a card with a sticker on its edge. `--md-sys-elevation-filter-2` is level 2 as a `filter: drop-shadow` pair, which follows alpha, so the tail shadows with the body; the mascot's bubble and the ponies' speech wear it, and the mascot's silhouette takes `--md-sys-elevation-drop-2` / `-3` for the same reason. A filter re-rasterises whenever what is under it changes, so it belongs on a small surface that changes rarely — a bubble, a figure — never on a list row or a panel that scrolls.

**The dark scheme is the one carve-out, and it is deliberate.** Its ladder does ramp — 0.30 → 0.45 on the key layer, 0.20 → 0.32 on the ambient — and starts at the spec's full 0.30 rather than the halved light value, because on a near-black ground a shadow is not reporting height, it is the only thing separating one surface from another, and the tonal steps already carry the height. Both are stated where the values live, in `globals.css`; do not "fix" either to match the paragraph above.

## Stacking order

App-level layers are the `--z-*` tokens in globals.css, used through their utilities (`z-dialog`, `z-popover`, `z-toast`, …); the order is stated once, there, with the reason for each step. Fourteen raw values were in use before, and two collided — `Toast` and `LoadingOverlay` were both at 9999, cover-order decided by DOM order — and the image detail's tag dialog carried a hand-typed 9998 meaning "above everything" that in fact put it one step *below* the lightbox.

Layering *inside* one component — a preview over its own final image, a switch handle over its own ripple — stays a small integer: those neighbours are the component's own children, and giving them tokens would imply they take part in the global order, the one thing they must not do.

## State layers

Hover/focus/press are the `state-layer` utility — a tinted overlay at the M3 alpha, painted from the element's own `color`. Not `hover:bg-primary/90`, which must be written twice (light + dark) and drifts.

Hover requires `(hover: hover)`, matching Tailwind's variants; a touch tap must not leave a permanent hover tint. Keyboard focus remains independent of that query, including the gallery's media scrim. Selection controls use named groups so a surrounding card's hover cannot light up an untouched checkbox or radio. Ripple hosts stay mounted when disabled so an existing wave retains its clipping; the delegated press gate checks native `:disabled` (including fieldsets) and `aria-disabled` instead.

The four alphas are M3's, from `StateTokens`: **hover .08, focus .10, pressed .10, dragged .16**. Focus and pressed are deliberately *equal* — the focus ring is what distinguishes them, not the tint weight.

**A ripple is that same layer spreading from the point of contact**, so it holds one opacity for its whole life and then fades. Its value lives on `.ripple` in globals.css and reads the pressed token; `spawnRipple` drives only the scale and the fade-out.

**Its fade is one keyframe, and that is a rule rather than a shorthand.** A WAAPI keyframe list is *absolute*, where `gsap.to(el, { opacity: 0 })` starts from whatever the element currently is — `[{ opacity: 1 }, { opacity: 0 }]` does not mean "fade out from here". Written that way, with the fade's 300ms delay and no `backwards` fill, the wave jumped from the token's 0.10 to **1** at the instant the animation became in-effect and then fell: a full-strength `currentColor` flash at the end of every press. A single keyframe at offset 1 takes an **implicit start from the underlying value**, which is the token. The test for the next conversion: this is the only animated element whose **CSS sets a non-default opacity** and the only fade with a **delay and no `backwards` fill** — `Toast`, `Reveal`, `Popover` and the hero's retire fade all start from a CSS opacity of 1. `npm run perf:ripple` samples it per frame.

A **selection control needs its own state layer** and cannot use this utility. `Checkbox`, `Radio` and `ToggleSwitch` each paint a real 40dp circle instead: the utility keys on the element's own `:hover` and covers only that element, while what has to light up on a checkbox is a circle more than twice the width of the 18dp box, driven by a hover anywhere on its label.

**A roving cursor is `state-layer-active`.** `state-layer` keys on the element's own `:hover`/`:focus-visible`/`:active` and misses the one state a roving cursor creates — a row that is the keyboard's current item without being focused itself (focus is on the control, `aria-activedescendant` names the row). `state-layer-active` paints the same layer unconditionally at the focus weight, which is what the state is; `Select`'s listbox and /search's autocomplete both have exactly that cursor. **And it moves in one frame, both ends**: a cursor is a *position*, the same reason the slider's handle has no transition on its, so inside a `[role="listbox"]` or a `[role="menu"]` the layer's opacity is not transitioned at all. The utility paints at once, but the row the cursor *left* falls back to `state-layer`, whose own 150ms response then faded the old mark out behind the new one — measured per frame on one ArrowDown, the row left behind read 0.100, 0.049, 0.018 against the cursor's own 0.100, indistinguishable for the first frame, and under autorepeat (~33ms against a 150ms fade) four rows were lit at once. A menu moves real focus and had the identical trail, from the keyboard and from a pointer sweeping its rows. The cost is the fade on hovering a single row, which is what a native list does anyway. The cursor is not the *selection*: a chosen value takes the container pair `secondary-container` — what "selected" means everywhere in this app (the sidebar's route, a chosen `Select` option, the current contact), and under 多色 the theme's second colour; a selected `Chip` takes the `chip-selected` pair, the same thing in 单色's single hue, because an accent never wears a chip. A cursor row must not take `primary-container`, which says "committed" about a row the user has not committed to.
