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
| Menu / Select option | 40 dp | 48 dp |
| Drawer navigation | 48 dp | 56 dp |
| Message contact | 64 dp | 64 dp |
| Drawer account | 64 dp | 64 dp |

Message contacts use a 40 dp portrait and 12 dp padding. The collapsed rail is 80 dp including its insets.

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
- Handle: 4 × 44 dp, narrowing to 2 dp on press.
- Gap around the handle: 6 dp.
- Position follows the input directly; only handle width animates.
- The painted track follows handle travel, with the native range's half-thumb inset preserved.
- Retain the inactive-side stop indicator.

Do not replace the handle with a circular knob or animate its position behind the finger.

## Navigation geometry

Drawer rows have 16 dp leading and 24 dp trailing padding, 24 dp icons, 12 dp label gaps and 12 dp outer inset. They use the density-dependent heights above and a pill shape.

The account block is a separate 64 dp surface with 16 dp corners, a 40 dp avatar and `title-s` name. Its leading content aligns with navigation; it does not take the selected-row pill.

The app bar uses `px-4 sm:px-26` independently of drawer columns. Its band remains 64 dp.

Do not add whole-control press scaling. Handle-specific press changes and the primitives' corner morphs remain defined by [Component motion](../motion.md).

## Verification

Run `bun run check`. Inspect narrow/wide content widths and fine/coarse pointers, including an open drawer. Check both painted bounds and hit regions; follow [CSS verification](../css-traps.md).
