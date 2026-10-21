# Motion standard — Material 3 Expressive

Source of truth: `lib/spring.ts`. This page is the per-component assignment; the rules are in
`AGENTS.md` → Motion. Every row names a role, never a number.

| Object | Arrives / moves | Leaves | Compose reference |
| --- | --- | --- | --- |
| Hover, focus, state layer, ink | `fastEffects` | `fastEffects` | state layers |
| Press feedback | ripple (Compose `RippleAnimation`), held while pressed | 150ms fade after release + spread | `ripple()` |
| Button / icon button press morph | `fastSpatial` on `border-radius` via `data-pressed` | `fastSpatial` | `ButtonDefaults.pressedShape`, `IconButton` shapes |
| Switch handle (travel, press swell, release) | `fastSpatial` | `fastSpatial` | `Switch.kt` |
| Radio dot, checkbox pop, badge pop, reaction fill, icon swap | `fastSpatial` (+ `fastEffects` on any opacity) | — | `RadioButton`, `Checkbox` |
| Grid selection mark (gallery select mode) | box scale `fastSpatial`, colours `fastEffects` | `fastEffects` | — |
| Floating selection / cart bar | travel `defaultSpatial`, opacity `defaultEffects` (`surfaceArrival('default')`) | `fastEffects` | — |
| Checkbox tick drawing | `fastEffects`, after `HANDOFF_MS` | `fastEffects` | — |
| Slider handle width | `fastSpatial` (position follows the finger, no motion) | — | `Slider.kt` |
| Icon turning (chevrons, refresh, sort, dismiss ×) | `fastSpatial` | `fastSpatial` | — |
| Anchored menu / listbox / tooltip | scale `fastSpatial`, opacity `fastEffects` | `fastEffects` | `DropdownMenu` |
| Toast | drop `fastSpatial`, opacity `fastEffects`; the stack closing up `layout` | `fastEffects` | — |
| In-place content swap (`SwapContent`) | `surfaceArrival('fast')` after `HANDOFF_MS` | `fastEffects` | `AnimatedContent` |
| Dialog | `surfaceArrival('default')` | `defaultEffects` | — |
| Bottom sheet, side panel, phone drawer | `layout` (docks to its edge) | `defaultEffects`; drag release short of dismiss → `layout` | `ModalBottomSheet`, `ModalNavigationDrawer` |
| Docked drawer / content width | `layout` both ways | `layout` | — |
| Collapsible panel (messages rail, search filters, upload options, offline banner, description fold, inline editor, search view) | `layout` both ways (content opacity: `defaultEffects` in, `fastEffects` out) | — | `animateContentSize`, `expandVertically` |
| Box following its content (`FollowHeight`, `SizeSwap`, cart spacer) | `layout` | `layout` | `animateContentSize`, `SizeTransform` |
| List / grid placement (`PresenceList`, `MasonryGrid`, `DataTable`) | `layout`; a new grid card scales in on `defaultSpatial`, fades on `defaultEffects` | `fastEffects` | `Modifier.animateItem` |
| Tab indicator | `defaultSpatial` | — | `TabRow.kt` |
| Tab strip (pane pager) | `PAGER_SPRING` (ζ1 k400, Compose pager snap), launched at half its rate | — | `HorizontalPager` snap |
| Lightbox swipe / zoom | `layout` | — | `HorizontalPager` snap |
| Lightbox slide arriving | scale `defaultSpatial`, opacity `defaultEffects` | `defaultEffects` | — |
| Page / route change | fade through: leaving `fastEffects` (rise `defaultEffects`), arriving `slowEffects` after `HANDOFF_MS` | — | Material fade through |
| Image hero flight, forum / folder container transform | `FLIGHT_SPRING` (ζ1 k1000, ~268ms) over its settle time, both ways; interruptions relaunch the same spring with the current velocity | same | `SharedTransitionLayout` `DefaultBoundsTransform` |
| Hero swipe-down release | `layout`, duration by travel left, launched at the finger's speed | — | — |
| Picture step (prev/next) | in: `defaultSpatial` + `defaultEffects`; out: `fastEffects`; un-paged swipe returns on `layout` | — | Material shared axis |
| Detail arriving with no card | `surfaceArrival('slow')` | — | — |
| Gallery cascade, `Reveal` | per item `surfaceArrival('default')`, `STAGGER` | — | — |
| Theme circular reveal | the **radius** on ζ0.8 k100 (expressive spatial damping), cut at its first crossing of the farthest corner — the overshoot is off screen | — | — |
| Determinate meter (`ProgressBar`, vote ratio) | `PROGRESS_SPRING` (ζ1 k50) | same | `ProgressIndicatorDefaults.ProgressAnimationSpec` |
| Top loading bar | `layout` (not `PROGRESS_SPRING`: its finish waits one settle before fading, and k50's ~1.2s would hold a finished bar on screen) | — | — |
| Indeterminate spinners, loading dots, skeleton shimmer | `--ease-loop` / `--ease-sweep` (not motion to a target) | — | — |
