# Layout

Page columns, spacing, control sizes and responsive enclosure rules. Visual shapes belong to [Surfaces](surfaces.md).

## Columns and spacing

Use the 4 dp grid. Half-steps such as `gap-1.5` are allowed in dense chrome; arbitrary spacing values are not.

| Content | Column |
| --- | --- |
| Rows or article | `max-w-4xl` |
| Masonry/image grid, shop grid | `max-w-7xl` |
| Form, upload, search/filter form inside a grid page | `max-w-2xl` |
| Media-led detail or profile | `max-w-5xl` |
| Admin tables | `max-w-6xl` |

A tab or block takes the width of its own role. Do not widen a list because the neighbouring pane is a grid, or invent a sixth intermediate width.

The shell provides `p-4 sm:p-6` on `data-page-content`. Do not duplicate that gutter on each page. Its inner flex-column wrapper retains `[&>*]:w-full` so `mx-auto max-w-*` children stretch correctly.

## Rows and responsive regions

- A row reads label first, control last. Use `ToggleSwitch layout="row"` or `SettingsRow`.
- Label slots use `min-w-0 flex-1`. Settings use `label-l` over `body-s`; the leading slot is for media.
- A non-interactive row has no state layer.
- Each parent holds one run of `.m3-row` siblings. Use another parent for another run.
- Structural dividers remain when either region is empty or signed out.
- Responsive header actions depend on column width, not the current number of digits.
- Equal-width buttons in a column/row layout use `flex-1` only in the row mode; the column already stretches them.
- Use `Button responsiveLabel` when a narrow row needs icon-only actions.

Search filters and blocking groups use container queries. Messages need 42 rem for an 18 rem contact pane and a 24 rem conversation. Below that, an open conversation becomes a full-height modal view beside the scroller with its own history layer. Measure the column, not the viewport; retain the contact-collapse preference across resizing.

Image detail supports an optional side-by-side split layout (`html[data-detail-layout='split']`), configured under `个性化` in `/settings`: a 50/50 CSS grid with a sticky left media pane and a scrollable right info feed capped at `max-w-4xl`, keeping one scroll container and identical DOM order across both layouts. It activates at 56 rem on `image-detail-frame` / `image-detail-chrome` (53 rem on `page` inside `[data-page-content]`'s horizontal padding) and falls back to the stacked layout below that threshold. In split mode, overlay step arrows move to the top-right corner of the left pane so they never overlap scrolling comments. Direct `/pic/[id]` loads match the overlay pixel-for-pixel and terminate the centre divider on a bottom hairline above the site footer.

The image-detail secondary action capsule uses a 40 dp height with 32 dp `IconButton size="sm"` controls, a 4 dp vertical inset and at least 4 dp at each end. Ordinary controls keep their round shape so hover follows the capsule's concentric ends; selection and press retain the primitive's corner morphs. Wide rows match the primary actions' total width, expanding when coarse-pointer controls need a 16 dp gap to preserve a 48 dp target pitch. Stage, loading and live detail use the same `DetailActions` geometry.

## Control heights

The enclosure selects the height; pointer type selects the minimum target.

| Enclosure | Height | Type |
| --- | --- | --- |
| Form field | 56 dp | `body-l` |
| Dense chat field and accessories | 48 dp | `body-l` for text |
| Filter/admin toolbar or row control | 40 dp | `body-m` text, `label-l` choices/actions |
| App-bar action | 48 dp | Primitive-owned |
| Dense row action or chip dismiss | 32 dp | `label-l` |

A 40 dp text field is a project refinement and is unlabelled only. It reserves one 32 dp trailing control. Labelled fields retain the 56 dp notch geometry.

Both ordinary labelled and unlabelled inputs are 56 dp. `size="lg"` selects the 56 dp search pill, not a larger form field. Button uses the default 40 dp step.

| Component step | Uses |
| --- | --- |
| 32 dp | `Button size="xs"`, `IconButton size="sm"`, Chip |
| 40 dp | Default Button/IconButton, small Input/Select, Pagination |
| 48 dp | Tabs, app-bar actions, chat composer, pointer drawer row |
| 56 dp | Large Button/IconButton, ordinary fields, search, Select, ColorSwatch, CodeInput |
| 64 dp | Top app bar, drawer account block, message contact row |
| 72 dp | Standard two-line list item and touch toggle row |

Button inline padding is 16 / 16 / 24 dp across its size steps, with an 8 dp icon gap. Button and IconButton own their glyph sizes.

### Touch targets

`--touch-floor` is 48 px and becomes 24 px under `pointer: fine`. Use `touch-target` for an expanded hit region or `touch-size` when the actual box must grow. The app bar and dense chat composer set a local 48 dp floor at both densities.

Clipping can remove an expanded target. Primitives use `data-ripple="inner"` with a separate clipping host, or grow the box. Each part of a split Chip has its own target. Coarse-pointer chips reserve vertical margin so wrapped rows meet on a 48 dp pitch.

Do not expand inline prose links into surrounding lines. Keep `touch-manipulation` and `select-none` on control primitives.

### Dense rows and chat composer

| Row | Fine pointer | Coarse pointer |
| --- | --- | --- |
| Menu / Select option | 40 dp | 40 dp |
| Drawer navigation | 48 dp | 56 dp |
| Message contact | 64 dp | 64 dp |
| Drawer account | 64 dp | 64 dp |

Message contacts use a 40 dp portrait with 12 dp leading and 20 dp trailing padding when expanded (12 dp symmetric when collapsed) so trailing timestamps stay clear of the pill's arc. The collapsed rail is 80 dp including its insets.

Menu, Select and one-line menu suggestions share a 40 dp row on mouse and touch. This is a
PicPony refinement; neither narrow triggers nor pointer density change their row height.

`ChatComposer` is an editable filled-field shell with its own undo history and rendered emoji. A 28 px line plus 10 px padding per side gives its 48 dp field; 8 dp around the field and accessories gives a 64 dp single-line row. Content grows to 160 px, then scrolls.

## Icon sizes

Use `ICON` from `lib/icons.ts`; do not choose a literal at the call site.

| Name | Size | Use |
| --- | --- | --- |
| `dense` | 18 dp | Chip or metadata |
| `control` | 20 dp | Small control |
| `standard` | 24 dp | Row, navigation, app bar, field adornment |
| `large` | 36 dp | Prominent affordance |
| `display` | 48 dp | Status illustration |

Primitive-owned supporting marks are exceptions: Badge uses 14 / 16 dp, and Select uses a 16 dp light check inside a 20 dp slot. Do not override them with `ICON.dense`.

Avatar/SkeletonCircle take box sizes, not icon roles. Avatar supports 32 / 40 / 48 / 56 and the responsive `hero` size.

## Slider

Keep the M3 Expressive geometry:

- Track: 16 dp.
- Handle: a fixed 4 × 44 dp box, with ink narrowing smoothly to 2 dp on `fastSpatial` under press or keyboard focus.
- Handle translation during dragging and keyboard input remains immediate; releasing does not move its centre.
- Reserve a 6 dp gap around the unpressed handle box, including while the ink is narrowed.
- Track corners: 8 dp at the outer ends, 2 dp towards the handle. The inner corner is a slider-specific shape.
- The painted track follows handle travel, with the native range's half-thumb inset preserved.
- Retain the 4 dp inactive-side stop indicator, inset 6 dp from the end.
- The native input has a 48 dp-high hit region and a fixed 44 dp-wide grab target.

These dimensions and the fixed handle box follow Compose's [SliderTokens](https://android.googlesource.com/platform/frameworks/support/+/refs/heads/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/SliderTokens.kt) and [Slider.kt](https://android.googlesource.com/platform/frameworks/support/+/refs/heads/androidx-main/compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/Slider.kt) (`ThumbContent`, `TrackInsideCornerSize`). The inset around the native web thumb is a PicPony adaptation.

Select jump is a PicPony addition: clicking the track commits the native value immediately and animates the handle position and both track clips together on `fastSpatial`. A second click starts from the currently painted position. Clamp spatial overshoot to the value range; reduced motion removes overshoot, and off skips interpolation. Use the shared `feedback` tier and speed.

Clip the full-width translated paint box to the control's bounds so it cannot widen an enclosing scroller. The clip must fit the handle's focus ring; keep the native input outside it.

Dragging, keyboard input and externally supplied values paint immediately. Pointer movement takes over an unfinished jump, and release does not launch another animation. Cancellation, blur, disabling and unmounting clear unfinished motion. Do not replace the handle with a circular knob or make it lag behind a drag.

`RangeSlider` shares the single slider's native geometry, paint and select-jump spring. Its two labelled native ranges keep ordered values; crossing transfers the active handle without moving the stationary endpoint. `onValueChange` reports a draft, while `onCommit` reports one changed range on pointer release or a native keyboard/assistive-technology step. Cancellation or focus loss discards an unfinished pointer draft without submitting it. External values and bounds synchronize the control. `DateRangeSlider` only converts calendar days and renders the two date labels; it does not own a second gesture or animation implementation.

Run `bun run test:slider` against the production build for press/release, select jump, drag interruption, keyboard input, endpoints, touch cancellation and motion preferences. Follow [CSS verification](../css-traps.md) for emitted selectors and rendered geometry.

## Navigation geometry

From the `md` breakpoint (768 px), the app-bar sidebar button cycles through expanded (288 dp), icons (80 dp) and hidden (0 dp of page space). Width, translation and the page's reclaimed space use the same overlay-category `layout` spring. Labels fade with effects springs; section headings collapse on the layout clock. The icon rail keeps accessible destination names, tooltips, active indicators and unread badges. Both visible modes replace the home page's bottom navigation pill.

During docked resizing, content lays out once at the destination width. Up to 32 visible blocks then interpolate their painted position and size using compositor transforms on the drawer's overlay `layout` clock. Cards remain whole, and concealed tab panes are skipped before measurement. The scroller keeps the wider scrolling window while the shell clips it to the moving bounds, so old card positions remain visible during narrowing; the floating scrollbar follows the visible page edge. Read destination widths and timing from the active CSS transitions. Rapid clicks start from the currently painted bounds. Completion, cancellation, viewport resize, page input and unmount release the temporary widths and transforms; motion off and the phone's modal drawer do not hold them.

Desktop mode is remembered in localStorage (`sidebar_collapsed`) and mirrored in the `sidebarCollapsed` cookie for SSR. Values are `expanded`, `icons` and `hidden`; legacy `false` and `true` restore expanded and hidden. Below `md`, the sidebar remains an independent open/closed modal drawer, starts closed and never writes the desktop preference.

Drawer rows have 16 dp leading and 24 dp trailing padding, 24 dp icons, 12 dp label gaps and 12 dp outer inset. They use the density-dependent heights above and a pill shape.

Icon-only rows retain the leading icon position, use 16 dp trailing padding and omit the label gap. Unread badges sit at the indicator's upper trailing edge. The account block uses 8 dp symmetric padding in the icon rail, keeping its 40 dp avatar centred.

During navigation, an icon-only row replaces its 24 dp glyph with a progress ring and omits the trailing `正在打开` indicator. The original glyph returns when navigation settles. Expanded desktop and phone rows retain the trailing progress ring and text.

The account block is a separate 64 dp surface with 16 dp corners, a 40 dp avatar and `title-s` name. Its leading content aligns with navigation; it does not take the selected-row pill.

The app bar uses `px-4 sm:px-26` independently of drawer columns. Its band remains 64 dp.

Do not add whole-control press scaling. Handle-specific press changes and the primitives' corner morphs remain defined by [Component motion](../motion.md).

## Verification

Run `bun run check`. Run `bun run test:sidebar` against a production build after changing sidebar modes; it checks the desktop cycle, layout frames, interrupted transitions, stored preferences and the independent phone drawer. Inspect narrow/wide content widths and fine/coarse pointers, including an open drawer. Check both painted bounds and hit regions; follow [CSS verification](../css-traps.md).

Use `bun run test:sidebar --performance` to also report nine production sidebar transitions at 1440 × 900, DPR 1 and 4× CPU slowdown. The report separates script, style and layout cost; rAF frame intervals measure main-thread responsiveness.
