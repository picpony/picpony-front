# Colour

Palette derivation, token use, focus and forced-colour behaviour. Shape and elevation belong to [Surfaces](surfaces.md).

## Token rules

- Use `--md-sys-color-*` through their utilities. Do not add raw colours, Tailwind palette classes or token alpha at call sites.
- Pair each container with its on-container role.
- `dark:` is for documented whole-asset changes such as the logo, not a second set of component colours.
- Supporting text uses `on-surface-variant`. `outline` is a boundary/non-text role, not normal text ink.
- Prose links use `link` / `link-hover` with a rest-state underline.
- Freeform user colours go through the existing colour or rich-text primitives; they are not component theme values.

| Role                             | Use                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `primary` + `on-primary`         | Filled controls, active pagination, checked switches and brand containers                                     |
| `primary-ink` + `on-primary-ink` | Brand-coloured marks on a surface and foreground drawn on them (such as checked checkboxes)                   |
| `on-primary-variant`             | App-bar icons and wordmark only                                                                               |
| `secondary-container` pair       | Tonal controls and committed selections                                                                       |
| `secondary-ink`                  | High-chroma ink in `secondary-container`'s hue family, for secondary-container and anticipatory press ripples |
| `chip-selected` pair             | Selected filter chips                                                                                         |
| `outline-variant`                | Dividers                                                                                                      |
| `outline`                        | Field boundaries                                                                                              |

Filled-button labels, selection discs, badges and previews retain `on-primary`; do not use the app bar's quieter ink there.

## Source of truth

[scripts/palette.mjs](../../scripts/palette.mjs) generates default declarations in `app/globals.css`, character palettes in `app/theme-palettes.css` and generated theme data in `lib/generated/`.

Use HCT for M3 tonal palettes. The categorical `accent-*` scale remains in OKLCH. Role-to-tone mappings follow the referenced M3 token sources; project refinements are explicit below.

`bun run colors` checks derivation, contrast and generated output. `bun run colors:write` installs it. Do not maintain a second hex table in documentation or hand-edit generated files.

## Built-in themes and harmony

The palette axis contains ten static built-ins, the dynamic time-of-day `sky` (`天空`) palette, and `custom`. `data-palette-hues="mono"` selects monochrome harmony; its absence selects multi-hue harmony.

Built-in source hues and guide citations live beside `THEMES`. Use the character guide's Fill row, not its Outline; mane/carapace choices are recorded where the coat cannot supply a usable colour.

### Dynamic sky palette

`sky` (`天空`) adapts across eight contiguous local-time phases covering 00:00–24:00 (`SKY_PHASES` in [scripts/palette.mjs](../../scripts/palette.mjs); scheduling in `lib/skyPalette.ts`):

| Phase       | Label  | Hours       | Scheme  |
| ----------- | ------ | ----------- | ------- |
| `midnight`  | `静夜` | 00:00–04:00 | `dark`  |
| `predawn`   | `拂晓` | 04:00–06:00 | `dark`  |
| `dawn`      | `晨曦` | 06:00–09:00 | `light` |
| `morning`   | `清昼` | 09:00–13:00 | `light` |
| `afternoon` | `晴午` | 13:00–17:00 | `light` |
| `sunset`    | `暮霞` | 17:00–19:00 | `light` |
| `twilight`  | `薄暮` | 19:00–21:00 | `dark`  |
| `starlight` | `星夜` | 21:00–24:00 | `dark`  |

- Each phase owns a single fixed scheme. While `sky` is active, light/dark switching (`跟随系统`, `主题模式` and the app-bar toggle) is disabled and OS scheme changes are ignored; the user's stored scheme preference is preserved and restored upon switching away from `sky`.
- Under monochrome harmony (`data-palette-hues="mono"`), each phase follows `SchemeTonalSpot` from its primary hue with tertiary reading secondary.
- Under multi-hue harmony, each phase uses bespoke atmospheric neutral/neutral-variant hues and restrained chromas alongside its secondary and tertiary colours while preserving all WCAG contrast floors, severity separation, `DislikeAnalyzer`, dark-container clarity, tile-separation and `focus`/`chip-selected` invariants.
- Generated rules live in `app/theme-palettes.css` under `html[data-palette='sky'][data-sky-phase='<id>']` and its `[data-palette-hues='mono']` delta, with `html.dark` toggled to the active phase's scheme so shared semantic, categorical and glass tokens match. `COOKIE_KEYS.skyPhase` carries the active phase for SSR (falling back to Beijing time when absent), and the inline pre-paint script in `app/layout.tsx` reconciles the browser's local hour before first paint.
- `AppLayout` advances the active phase at hour boundaries and on tab return; `FlutedGlass` refreshes its shader ink on `skyPhase` changes. `lib/settingsSync.ts` syncs `sky` through the `theme` cloud key.

### Fill and foreground policy

- Keep the established hue and approved light/deep register.
- `lib/clearColor.ts` defines the shared chroma rule: light caps at C36 and 96% of available gamut; deep caps at C48 and 72%.
- Built-in dark fills follow the same hue/register rule seven tones lower.
- Measure `rampChroma` at `CHROMA_REFERENCE_TONE`, not the pale fill's own narrow gamut.
- Stronger foreground derivation applies to built-ins and image recommendations. Manual and saved custom themes retain `exact-custom`.

| Role                 | Built-in policy                                                                                      | Exact custom policy                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `on-primary`         | White only if both fills reach 4.5:1; otherwise solve dark ink                                       | Existing white-at-3:1 / P20 rule                           |
| `primary-ink`        | Target 4.6:1, assert at least 4.5:1 on actual surface/highest/selected containers                    | Existing page-only 2.9:1 light / 3:1 dark rule             |
| `on-primary-ink`     | Solved per scheme against `primary-ink` to clear 4.5:1 (white in light, dark ramp tone in dark)      | Same 4.5:1 pairing against `primary-ink` per scheme        |
| `on-primary-variant` | 75% of on-primary contrast, floored at 4.5:1 and capped at on-primary; near-white tint capped at C22 | Same, or unchanged on-primary when already below the floor |

Keep `BRAND_SEED` / `BRAND_SEED_DARK` distinct from `BRAND_RAMP_SEED`. The first pair is the visible fill; the ramp seed retains the mascot's mane and its chroma basis.

### Monochrome harmony

Use `SchemeTonalSpot` harmony with secondary chroma 16, neutral 6 and neutral-variant 8. Tertiary roles read the secondary palette, so they do not introduce another hue.

The generator compares actual library palettes at the used tones. Do not replace that reference comparison with a check against only this repository's own constants.

### Multi-hue harmony

| Family                   | Meaning                                                              |
| ------------------------ | -------------------------------------------------------------------- |
| `secondary*`             | Character's second colour; broad selections and tracks               |
| `tertiary*`              | Small accents: selected favourite/like, level meter and status glyph |
| `focus`, `chip-selected` | TonalSpot secondary in both harmony modes                            |
| Default-theme neutrals   | Mascot coat hues on the shared neutral ladders                       |

Second colours may coincide between characters. Keep their documented sources rather than inventing separation.

Preserve the generator's hue, semantic-distance and disliked-colour guards. Built-in dark secondary containers use `deepSecondChroma`; that adjustment does not migrate saved custom themes. Light tertiary is a mark tone, not a normal-text `on-tertiary` pair.

Severity roles, categorical accents and media roles do not follow the theme. The unread count keeps its semantic fill; links, switches and checkboxes retain their brand roles. About-page glass material stays fixed while its shader ink follows the palette.

## Custom themes

One displayed hex is installed exactly. Recommendation generation happens before display, never again during confirmation. Stored seeds, manual choices and saved specs retain their exact derivation.

| Responsibility                 | Owner                                               |
| ------------------------------ | --------------------------------------------------- |
| Derivation                     | `lib/paletteRule.ts`, usable by server and client   |
| Import-free stored format      | `lib/paletteSpec.ts`                                |
| Exact colour and companion hue | `ColorPicker`                                       |
| Image recommendations          | `ImagePalettePicker`, `lib/imageRecommendations.ts` |
| Shared result preview          | `PalettePreview`, `PaletteTileFace`                 |
| Lazy loading                   | `lib/paletteLazy.ts`                                |
| Installation                   | `applyCustomPalette` in `lib/appearance.ts`         |

### Storage and first paint

Store the seed and optional companion choice, not CSS declarations, in `LS_KEYS.paletteCustom` and its cookie. A bare seed selects the automatic companion hue; a suffix can name a relation or exact hue.

SSR derives both schemes into `style#palette-custom`. Installation replaces that style; do not put palette declarations inline on `html`, where they would override dark selectors.

The pre-paint validation list permits `custom` only when this response includes usable CSS. Otherwise use default and recover from storage through `recoverCustomPalette`.

Selectors retain the `html` prefix so imported theme blocks outrank root defaults. Monochrome blocks add only the changed roles.

### Companion hue and picker

Custom multi-hue harmony uses one companion hue for secondary and tertiary. Automatic and relation presets use the shared guards and taper with seed chroma. An explicitly chosen hue is retained. Monochrome harmony hides that choice while preserving it for later.

`ColorPicker` cells are real `Hct.from()` results. Keep the hex, hue and selected cell in one atomic `Pick`; rounded hex values alone cannot identify a cell.

Both pickers:

- Load on intent, with a local loading boundary and first-open latch.
- Show the resulting light/dark theme through the shared preview.
- Install a confirmed colour from `Modal.onExited`, after the dialog leaves.
- Start the theme wipe from the opening control; compare the complete target spec.

### Image recommendations

- Use the deterministic `lib/quantize.ts` implementation, with the AOSP-seeded random source; do not switch to random-start library quantization.
- Add populations when final Lab centres round to one RGB key. Do not recount by a different nearest-centre pass.
- Group chromatic clusters by fixed hue anchors and rank families by opaque area, not vividness.
- Give each family a place before alternative light/deep versions, up to eight recommendations.
- Gray images keep their populated tones; transparent images return no recommendations; decode errors remain errors.
- Downsample by area, using the 112 × 112 cap and high-quality smoothing.
- An image companion needs the existing population, chroma and hue-gap guards. Area ranks candidates; near-equal populations use the 90° separation preference. Otherwise retain automatic.
- Recommendation adjustments never run on exact selection or saved values.

### Palette tiles

Use `PaletteTileFace`, not colour discs. The tile previews its own page, primary, selection and accent, even when another theme is active.

Built-ins and `sky` use generated faces (`THEME_FACES` and `SKY_FACES`); custom uses `data-palette-tones`. In `/settings`, twelve palette cards fill the settings column in a container-responsive grid (`3 / 4 / 6` columns at default / `@sm` / `@xl` so every row fills evenly at every width): each card is a 12 dp tonal radio button (`surface-container-high` at rest, `secondary-container` when selected) with a 4 dp bezel wrapping a 56 dp concentric (`8 dp`) `PaletteTileFace` preview at `-z-10`, the selected check badge and an emphasized `label-m` name. The `sky` card live-previews the current local time-of-day phase and reveals a read-only 24-hour phase strip when selected. `ImagePalettePicker` keeps its 4-column tile grid, and `ColorPicker` uses the compact 48 × 36 dp preview inside its companion-hue tiles. Focus uses the shared ring; forced colours supply a system boundary.

Arrow keys choose a palette, Home/End choose endpoints. Guard rapid changes against the wipe's target palette rather than the root's not-yet-committed value.

## Surface and media roles

| Component                           | Container                        |
| ----------------------------------- | -------------------------------- |
| Filled Card                         | `surface-container-highest`      |
| Elevated Card                       | `surface-container`              |
| Outlined Card                       | `surface` with `outline-variant` |
| Dialog                              | `surface-container-high`         |
| Sheet and drawer                    | `surface-container-low`          |
| Ordinary menu/popover               | `surface-container`              |
| Search suggestions and filled field | `surface-container-highest`      |
| Plain tooltip                       | `inverse-surface`                |
| Progress/slider track               | `secondary-container`            |

Dialog rows step to `surface-container-highest`, and filled `DropZone` uses `surface="dialog"` to step to `surface-container-highest` inside dialogs. When a dialog row hosts filled `surface-container-highest` controls (such as `SettingsRow surface="dialog"`), the row steps down to `surface-container` instead so its controls keep a distinct edge. Quote surfaces follow their host; see [rich text](typography-and-copy.md#colour-media-and-links). Elevation levels are owned by [Surfaces](surfaces.md#elevation).

On photographs use `on-media`, `on-media-variant`, `media-outline` and `media-plate`; surface roles do not guarantee contrast there.

Use `ProgressBar` for a 4 dp determinate track and translated rounded fill. The omitted active-track gap and end stop are deliberate refinements; the Slider keeps its own stop. A low-contrast empty track is not fixed by adding a detached end dot.

## Alpha and disabled content

Use container tones or add an owned token instead of adding alpha to a colour.

- Scrims use `bg-scrim-veil`; a destructive confirmation uses `bg-scrim-danger`; cropping uses `--md-sys-color-crop-mask`.
- Sheet drag handles use full-strength `on-surface-variant`.
- State opacity comes through `state-layer`, not a copied number.
- Element opacity is for motion, `paging-dim` or `disabled-content`, not secondary text weight.
- Disabled content uses `disabled-content` at 38%; busy controls retain active material.

Owned alpha colours use `rgb(var(--md-sys-color-*-rgb) / alpha)` so Chrome 109 keeps the same opacity. Scrim and on-media channels are scheme-independent. `scripts/palette.mjs` and `paletteBlocksCss` generate on-surface channels beside the source colour for both built-in and custom palettes, including SSR. Keep channel use inside existing tokens and primitives; it does not permit call-site alpha.

Filled-field hover composites the on-surface state layer in `fieldset::before`; `::after` remains the focus ring. This preserves the sRGB mix and its opacity transition without a runtime `color-mix()` requirement. Static OKLCH accents retain their source values and receive build-time fallbacks.

## Focus

The ordinary ring is the theme's TonalSpot secondary in both harmony modes. It identifies keyboard position consistently; it is not recoloured for each button variant.

| Context                            | Treatment                                                   |
| ---------------------------------- | ----------------------------------------------------------- |
| Ordinary control                   | `focus-visible:ring-2 focus-ring`                           |
| App bar                            | `focus-ring-on-primary`                                     |
| Photograph                         | Inset ring with `focus-ring-on-media` over a media plate    |
| Paint-clipped control              | `focus-visible:inset-ring-2 focus-visible:focus-ring-inset` |
| Floating companion without a plate | Shared ring plus 2 px `ring-offset-surface`                 |

An outset ring is over the surrounding page, so filled buttons retain the ordinary ring. The app-bar exception is for controls on the bar.

Outlined fields use their own 2 px `primary-ink` boundary, with an `on-surface` floating label. Invalid outlined fields keep error boundary and label. Filled fields use the ordinary focus ring, taking precedence over an error ring.

### Forced colours

Forced colours remove box-shadow rings and flatten container tones. Preserve the system Highlight outline and use:

- `forced-boundary` for tone-separated surfaces.
- `forced-selected` for selected containers.
- `forced-mark` for paint-only indicators.

Use `focus-visible:outline-hidden`, never `outline-none`. The fallback applies to focused controls, fields and roving cursors.

## Known contrast exceptions

Exact custom themes retain their established contrast limits. Pale built-in fill boundaries, close-hue character pairs and some small accent-container/severity pairs are reported exceptions in the generator, not claims that every boundary reaches 3:1.

The primary family is not subject to the accent's semantic-distance guard. Severity ramps are tuned as a set rather than copying M3 error chroma while leaving success/warning unrelated. Do not remove these exceptions or tighten a threshold without revisiting the design decision.

## Changing and verifying palettes

1. Edit the source decision in `THEMES`, including guide citations.
2. Run `bun run colors:write`.
3. For a brand-fill change, update the two literals requested by the generator in `lib/paletteSpec.ts`; retain the ramp seed and check the wordmark against its artwork.
4. Add a new role in both root scheme blocks once; subsequent generation maintains it.
5. Run `bun run check` and inspect both harmony modes, light/dark, custom values and forced colours.

Palette checks cover derivation, contrast, reference harmony, separation and generated output. `scripts/testImageRecommendations.mjs` covers recommendation and quantizer regressions. Moving HCT imports also requires `bun run perf:weight` to confirm that the engine remains outside initial route documents.
