# Component motion

Role assignments for shared components. Selection rules and preferences are defined in [Motion system](motion-system.md); numeric definitions stay in [lib/spring.ts](../lib/spring.ts).

## Controls and feedback

| Component or property | Arrival / change | Departure | Reference |
| --- | --- | --- | --- |
| Hover, focus, state layer, ink | `fastEffects` | `fastEffects` | State layers |
| Ripple | Compose `RippleAnimation`, held while pressed | Release after spread | `ripple()` |
| Button / icon-button pressed or selected corner | `defaultEffects` | `defaultEffects` | `Button.kt`, `IconButton.kt` |
| Switch handle | `fastSpatial` for travel, press and release; colour `fastEffects` | `fastSpatial` | `Switch.kt`; sprung press is a project refinement |
| Radio dot, checkbox pop, badge pop, reaction fill, icon swap | `fastSpatial`; opacity `fastEffects`; radio ring colour `defaultEffects` | Assigned effects fade | `RadioButton.kt` |
| Checkbox mark / box | Mark `defaultSpatial`, box `defaultEffects` | Box `fastEffects`; mark uses `CHECK_SNAP_DELAY_MS` | `Checkbox.kt` |
| Slider handle width | `fastSpatial`; position follows input directly | Same role | `Slider.kt` |
| Icon rotation, including dismiss | `fastSpatial` | `fastSpatial` | Project mapping |
| Grid selection mark | Box `fastSpatial`, colour `fastEffects` | `fastEffects` | Project mapping |
| Field label and notch | Bounds `layout`, ink `fastEffects` | Same split | `.m3-field` |
| Tab indicator / content colour | Indicator `defaultSpatial`, colour `defaultEffects` | Colour `fastEffects` | `TabRow.kt`, `Tab.kt` |

## Surfaces and layout

| Component | Arrival / change | Departure | Reference |
| --- | --- | --- | --- |
| Anchored menu, listbox, tooltip | Scale `fastSpatial`, opacity `fastEffects` | Same split | `DropdownMenu`, `Tooltip.kt` |
| Toast | Travel `fastSpatial`, opacity `fastEffects`; stack `layout` | Same split | `SnackbarHost` |
| `SwapContent` | `surfaceArrival('fast')` after `HANDOFF_MS` | `fastEffects` | `AnimatedContent` |
| Dialog | `surfaceArrival('default')` | `defaultEffects` | Project mapping |
| Sheet, side panel, modal drawer | `defaultSpatial` with edge skirt; scrim `defaultEffects` | Surface `fastEffects`, scrim `defaultEffects`; drag release `defaultSpatial` | `BottomSheet.kt`, `ModalNavigationDrawer` |
| Docked drawer / content width | `layout` | `layout` | Project mapping |
| Search suggestions | Height `slowSpatial`, fade `defaultEffects`; replacement height `layout` | Height `defaultSpatial`, fade `defaultEffects` | `rememberSearchBarState` |
| Collapsible panel | Bounds `layout`, content `defaultEffects` | Bounds `layout`, content `fastEffects` | `animateContentSize`, `expandVertically` |
| `FollowHeight`, `SizeSwap`, cart spacer | `layout` | `layout` | `animateContentSize`, `SizeTransform` |
| List/grid/table placement | `layout`; new grid card `defaultSpatial` + `defaultEffects` | `fastEffects` | `Modifier.animateItem` |
| Selection / cart bar | `surfaceArrival('default')` | `fastEffects` | Project mapping |
| Gallery cascade, `Reveal` | `surfaceArrival('default')`, `STAGGER` | No separate exit | Project mapping |

## Navigation and media

| Transition | Roles |
| --- | --- |
| Tab strip | `PAGER_SPRING`, launched at half its rate |
| Lightbox swipe / zoom | `PAGER_SPRING` / `layout` |
| Lightbox slide | Scale `defaultSpatial`, opacity `defaultEffects`; exit `defaultEffects` |
| Route fade through | Exit `fastEffects`, rise `defaultEffects`; arrival `slowEffects` after `HANDOFF_MS` |
| Hero, forum and folder container transform | `FLIGHT_SPRING` both ways; interruption retains the appropriate current pose/velocity |
| Hero swipe-down release | `layout`, remaining-travel timing and release velocity |
| Previous/next picture | Exit `fastEffects`; arrival `defaultSpatial` + `defaultEffects`; cancelled swipe `layout` |
| Detail without a shared card | `surfaceArrival('slow')` |
| Theme reveal | Radius spring from `lib/spring.ts`, clipped at full coverage |

## Progress

| Component | Role |
| --- | --- |
| Determinate meter, vote ratio | `PROGRESS_SPRING`; tone `fastEffects`; waiters use `COMPONENT_SPRING_MS.progress` |
| Top loading bar | `layout`, so completion does not wait for a slow progress settle |
| Indeterminate spinner / loading dots | `--ease-loop` |
| Skeleton shimmer | `--ease-sweep` |

The loop and ripple clocks are documented exceptions. A new component reuses a role from this table; verification follows [Motion system](motion-system.md#verification).
