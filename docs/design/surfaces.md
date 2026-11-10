# Surfaces

Shape, elevation, stacking and interaction layers. Colour-role assignments are in [Colour](colour.md); component APIs are in [Primitives](primitives.md).

## Shape

Use the role's token. The radius scale is 0 / 4 / 8 / 12 / 16 / 20 / 28 / 32 / 48 dp.

| Role | Utility | Radius |
| --- | --- | --- |
| Button, FAB, avatar, circular icon control | `rounded-full` | Capsule/circle |
| Count badge, navigation row, search field | `rounded-full` | Capsule |
| Card, section, palette tile, hovered square icon control | `rounded-md` | 12 dp |
| Chip, filled field, ordinary menu/listbox row | `rounded-sm` | 8 dp |
| Tab state shape, top corners | `rounded-t-md` | 12 dp |
| Outlined field | `rounded-xl` | 20 dp |
| Colour swatch, code box, badge, inline code, grouped seam | `rounded-xs` | 4 dp |
| Snackbar and plain tooltip | `rounded-xs` | 4 dp |
| Menu and ordinary popover | `rounded-lg` | 16 dp |
| Modal drawer, trailing corners | `rounded-r-lg` | 16 dp |
| Dialog, sheet, large media, search suggestions | `rounded-2xl` | 28 dp |
| Gallery tile and chat row | `rounded-lg` | 16 dp |
| Profile banner from `sm` | `rounded-3xl` | 32 dp |

A docked drawer has no rounded docking edge. Use explicit steps rather than bare `rounded`. Skeletons inherit the replaced object's radius. Keep the Hero target radius consistent with `HERO_TARGET_RADIUS_PX`.

### Nested surfaces

For nearby nested corners, use `inner = outer - gap`; do not give an inset object the outer radius again. This applies to tight insets, not unrelated corners separated by broad content spacing.

A centred pill within a pill is concentric at any size. Search uses `shape="pill"` at both 40 and 56 dp; shape must not depend only on height.

Menus form one family:

| Part | Ordinary menu | Search suggestions |
| --- | --- | --- |
| Outer radius | 16 dp | 28 dp |
| Panel inset | 8 dp | 8 dp |
| Row radius | 8 dp | 20 dp |
| Row gap | 2 dp | 2 dp |
| Row height | 40 / 48 dp by pointer | 56 dp |

`Popover` owns inset and gap. Use `inset={false}` only for content that supplies its own geometry. `suggestionRow` supplies both classes and height for `estimateMenuHeight`; its variant matches the panel. Two-line ordinary suggestions use 56 dp.

Select matches its trigger width: 8 dp row padding plus 8 dp panel inset align with the trigger's 16 dp inset. Reserve the 20 dp trailing slot even when the 16 dp check is absent. Command menus may use `matchAnchorWidth={false}`, centered and viewport-clamped.

Search rows use 12 dp inline padding, a 24 dp leading slot and 12 dp gap to align with the field. Keep recent searches, previous suggestions during refresh and height-following replacement in the same search panel.

### Specification and project refinements

Outlined fields at 20 dp, filled fields at 8 dp and menus at 16 dp are deliberate PicPony refinements. Do not describe them as the unmodified M3 component mapping.

For a specification claim, consult the [Compose Material 3 token sources](https://android.googlesource.com/platform/frameworks/support/+/refs/heads/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/) and name the relevant component token. The repository's recorded refinement governs local implementation.

### Chat content

Chat messages are text-width rows with 16 dp outer corners, 4 dp grouped seams and 2 dp gaps within a turn.

Direct messages use the plain model in `app/messages/messageText.ts`: preserve breaks, linkify URLs and render emoji tokens. Existing BBCode messages normalize into that model; do not parse new direct messages as Markdown.

Shared pictures, folders and privacy spaces render as attachment cards without a second bubble fill. One to three standalone emoji also use attachment treatment. Keep the shared wire format in `encodeShare` / `parseShare`.

A reply that is prose rather than a message passes `plain` to `ChatBubble`: no fill, no padding, no corner seams, and the column keeps its full width, because nothing is being held inside a shape. The 彩彩 AI panel answers this way — only the visitor's own lines are bubbles. The speaker's side and the run spacing still apply.

## Elevation

Use `shadow-e1` through `shadow-e5`. Tone provides the first depth cue; ordinary controls and cards have no rest or hover shadow, including `Card variant="elevated"`.

| Floating surface | Level |
| --- | --- |
| Modal bottom sheet, search suggestions | `e1` |
| Menu, ordinary popover, floating navigation | `e2` |
| Dialog, FAB, snackbar | `e3` |

Keyboard rings and crop masks use box-shadow without being elevation; do not remove them as decorative shadows.

A popover is a clipping frame around an inner scroller. Keep its insets outside scrolling content and return that inner scroller from `PopoverHandle`. Reveal rows using layout offsets, not transformed bounding rects.

The light elevation ladder keeps alpha constant while geometry changes. The dark ladder intentionally increases key and ambient alpha; preserve the token policy in `app/globals.css`.

Alpha-shaped surfaces use filter elevation: `--md-sys-elevation-filter-2` for bubble tails and `--md-sys-elevation-drop-2` / `-3` for mascot silhouettes. Restrict filters to small, infrequently changing surfaces.

## Stacking order

Application layers use the `--z-*` utilities from `app/globals.css`, such as `z-dialog`, `z-popover` and `z-toast`. Do not add raw application z-index values.

Children inside one component may use small local integers; they are not members of the global layer scale.

## State layers

Use `state-layer` with `data-ripple`, not per-control hover colours.

| State | Alpha |
| --- | --- |
| Hover | 0.08 |
| Focus | 0.10 |
| Pressed | 0.10 |
| Dragged | 0.16 |

Hover requires `(hover: hover)`; keyboard focus does not. Selection controls use named groups and their own 40 dp circular state layers. Keep disabled ripple hosts mounted; the delegated gate checks native and ARIA-disabled state.

Ripple keeps the pressed token's opacity while spreading, then fades. A delayed WAAPI fade uses an implicit underlying start, not an explicit opacity of one.

A roving keyboard cursor uses `state-layer-active`. Its old and new rows change immediately, without fading a trail. Committed selection uses `secondary-container`; selected chips use the dedicated `chip-selected` pair.

## Verification

Run `bun run check` and inspect changed CSS in the built output. For ripple changes use `bun run perf:ripple`; overlays also require `bun run test:overlays`.

Check nested corners, scrolling panel insets, disabled input, keyboard cursor and forced colours in the relevant primitives.
