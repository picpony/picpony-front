# Surfaces

Shape, elevation, stacking and interaction layers. Colour-role assignments are in [Colour](colour.md); component APIs are in [Primitives](primitives.md).

## Shape

Use the role's token. The radius scale is 0 / 4 / 8 / 12 / 16 / 20 / 28 / 32 / 48 dp.

| Role | Utility | Radius |
| --- | --- | --- |
| Button, FAB, avatar, circular icon control | `rounded-full` | Capsule/circle |
| Count badge, search field | `rounded-full` | Capsule |
| Card, section, palette tile, outlined field, rich-text editor, code box, colour swatch, hovered square icon control | `rounded-md` | 12 dp |
| Chip, filled field, ordinary menu/listbox row | `rounded-sm` | 8 dp |
| Tab state shape, top corners | `rounded-t-md` | 12 dp |
| Badge, inline code, grouped seam | `rounded-xs` | 4 dp |
| Snackbar and plain tooltip | `rounded-xs` | 4 dp |
| Menu and ordinary popover | `rounded-lg` | 16 dp |
| Modal drawer, trailing corners | `rounded-r-lg` | 16 dp |
| Dialog, sheet, large media, search suggestions | `rounded-2xl` | 28 dp |
| Gallery tile and chat row | `rounded-lg` | 16 dp |
| Profile banner from `sm` | `rounded-3xl` | 32 dp |

A docked drawer has no rounded docking edge. Use explicit steps rather than bare `rounded`. Skeletons inherit the replaced object's radius. Keep the Hero target radius consistent with `HERO_TARGET_RADIUS_PX`.

A grouped run — a list's rows, a drawer section's rows — takes `rounded-lg` on its own outer ends and `rounded-xs` on every seam inside. It is one block of material cut apart, not a stack of capsules: `.m3-row` for lists, `.sidebar-run` for the drawer.

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
| Row height | 40 dp | 56 dp |

`Popover` owns inset and gap. Use `inset={false}` only for content that supplies its own geometry. `suggestionRow` supplies both classes and height for `estimateMenuHeight`; its variant matches the panel. Two-line ordinary suggestions use 56 dp.

Select matches its trigger width: 8 dp row padding plus 8 dp panel inset align with the trigger's 16 dp inset. Reserve the 20 dp trailing slot even when the 16 dp check is absent. Command menus may use `matchAnchorWidth={false}`, centered and viewport-clamped.

Search rows use 12 dp inline padding, a 24 dp leading slot and 12 dp gap to align with the field. Keep recent searches, previous suggestions during refresh and height-following replacement in the same search panel.

### Specification and project refinements

Outlined fields at 12 dp, filled fields at 8 dp and menus at 16 dp are deliberate PicPony refinements. Do not describe them as the unmodified M3 component mapping.

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
| Modal bottom sheet, search suggestions, plain tooltip | `e1` |
| Menu, ordinary popover, floating navigation, collapsed mascot | `e2` |
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
| Pressed (static / off-motion fallback) | 0.10 |
| Press ripple (`--md-sys-ripple-opacity`) | 0.14 light / 0.18 dark |
| Dragged | 0.16 |

Hover requires `(hover: hover)`; keyboard focus does not. Selection controls (`Checkbox`, `Radio`, `ToggleSwitch`) use named groups and their own 40 dp circular state layers with centred press ripples across the full label. Keep disabled ripple hosts mounted; the delegated gate checks native and ARIA-disabled state. When motion is enabled, `[data-ripple]` controls omit the flat `:active::before` flash so the expanding wave carries pressed feedback cleanly (and touch scroll detection is never pre-empted by a frame-0 tint); the off-motion tier restores the 0.10 flat pressed state layer.

Ripple paints a soft-feathered radial wave (`radial-gradient`, `--ripple-core`) at `z-index: -1` beside `state-layer::before` inside an isolated host (`[data-ripple]` / `[data-ripple-host]`), keeping labels, glyphs and avatars crisp above the wave while preserving `-z-10` miniature faces (`PaletteTileFace`) beneath it. The uniform inner core expands from a proportional droplet (`0.12–0.20` scaled smoothly by cover radius) to the host's bounding half-diagonal (`+ 2 px`, covering M3E press-morphed corners during long press) plus a `12–56 px` feathered rim on a fast-launch decelerating curve (`cubic-bezier(0.2, 0.8, 0.4, 1)`, 240–380 ms by cover radius, 75 ms linear fade-in), holds at `--md-sys-ripple-opacity` while pressed (including keyboard `Enter` / `Space` activation), then dissolves on `cubic-bezier(0.4, 0, 0.2, 1)` over 220 ms (140 ms on scroll cancel), freezing its resolved contact-time `color` read from the host before insertion so a quick tap neither forces a synchronous reflow nor snaps mid-spread. Selection controls mark `data-ripple-own` so nested containers never double-fire ripples.

Press-wave colour follows one rule: any control carrying colour within its ripple area — whether an active/filled container, a predicted coloured triggered state, a coloured indicator/border, or coloured text/icon — tints its press wave with a vivid role ink (not low-chroma Tone-10/90 `on-*-container` text ink); only purely neutral controls stay on neutral grey (`on-surface` / `on-surface-variant`).

- `primary` / `primary-container` / `chip-selected` / brand indicators: `Button` / `IconButton` `filled`, active `Pagination` pages and `IconButton variant="on-primary"` keep `on-primary` (`ripple-on-primary` on the app bar); `Button variant="accent"`, dragging `DropZone`, inactive `Pagination` pages, default `underline` tabs, `filter` / primary `Chip`s (both selected and unselected) and selection controls (`Checkbox`, `Radio`, `ToggleSwitch`) use `ripple-primary` (`primary-ink`).
- `secondary-container` (both active/selected and predicted unselected states): `Button` / `IconButton` `tonal`, `IconButton` `secondary` toggles and hovered `quiet`, `SidebarNav` links, `pill` / `rail` tabs, `Select` options, `ContactList` / `HistoryDialog` rows, `DetailLayoutSection` / `PoniesSettings` choices, `ColorPicker` mode tiles, toggle/panel editor toolbar buttons and `on-container` controls inside `secondary-container` use `ripple-secondary` (`secondary-ink`).
- Accent, semantic, categorical, media and palette tiles: `Button variant="tertiary"` and `selectedTone="tertiary"` `IconButton` toggles (both selected and unselected) use `ripple-tertiary`; `danger` / `success` / `warning` / `on-fill` filled buttons keep `on-fill` highlight over saturated fills; `danger-text` / `danger-quiet` controls, destructive `Menu` items, invalid `DropZone`, warning `underline` tabs, semantic `Chip`s and `on-container` controls in `warning-container` use `ripple-error` / `ripple-success` / `ripple-warning` (or `currentColor` where text already carries that role); categorical and badge chips keep their paired `currentColor`; media overlays use `ripple-on-media`; palette tiles use their own primary bar pair via `tileRippleStyle`.
- Purely neutral controls (default neutral grey): `surface` / `text` buttons, non-toggle `standard` / `outlined` and resting/touch `quiet` icon buttons, non-href `SidebarNav` actions, one-shot editor toolbar buttons, neutral unfilled `assist` / `input` chips, normal `Menu` items, `DropZone` (`idle` / `filled`), cards, list/suggestion rows, select triggers, pager arrows and collapsed `Mascot`.

`[data-ripple]` resets `--ripple-color` in `@layer base` so a parent tint never leaks into a nested control.

A roving keyboard cursor uses `state-layer-active`. Its old and new rows change immediately, without fading a trail. Committed selection uses `secondary-container`; selected chips use the dedicated `chip-selected` pair.

## Verification

Run `bun run check` and inspect changed CSS in the built output. For ripple changes use `bun run perf:ripple`; overlays also require `bun run test:overlays`.

Check nested corners, scrolling panel insets, disabled input, keyboard cursor and forced colours in the relevant primitives.
