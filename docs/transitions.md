# Screen transitions

Navigation, tabs, container transforms and picture stepping. Spring selection belongs to [Motion system](motion-system.md); image-flight mechanics belong to [Hero engine](hero.md).

## Transition selection

| Change | Mechanism | Owner |
| --- | --- | --- |
| Open/close an image from a card | Shared-element flight | `lib/hero/` |
| Open/close a forum thread | Row ↔ post container transform | `forumContainer.ts`, `forumTransitionPlay.ts` |
| Open/close a folder | Card ↔ visible page-column container transform | `folderTransit.ts`, `folderTransitPlay.ts` |
| Open an image from a history row | Row ↔ overlay container transform | `detailTransit.ts`, `detailTransitPlay.ts` |
| Image with no usable origin | Surface arrival/fade | Detail transit |
| Previous/next picture | Shared axis X in the existing viewer | `hero/useDetailStep.ts`, `hero/step.ts` |
| Tabs and mapped top-level routes | Shared axis X | `playSharedAxis`, `TabPanesDriver`, `tabStrip.ts` |
| Other routes | Fade through over an inert clone | `routeCrossFade.ts` |

Paths in the owner column are under `lib/`. Heavy playback code stays behind the existing [lazy boundaries](module-boundaries.md#initial-document-and-lazy-boundaries).

## Container transforms

Forum, folder and flightless detail share `containerTransformPlay.ts`; route containers use `routeContainerPlay.ts`.

- Use `FLIGHT_SPRING` both ways. Copies remain unscaled, anchored to the container; translated clipping boxes keep circular corners.
- Use the shared content-fade windows sequentially, so outgoing and incoming text do not double.
- Start the route's compositor fade with the container through `playUnderContainer`.
- `expectRouteContainer` holds the old page past `data-route-fallback` while the destination arrives, within its existing bound.
- Warm a client page's complete route payload through `prefetchRoutePayload`. Domain-data prefetch still follows [Data requests](data-requests.md#prefetch-and-scheduling).
- Start each leg pending, so the first presented frame shows its first pose rather than elapsed pre-paint work.
- A return uses the visible portion of its source. An off-screen or concealed destination falls back to the route fade.
- Finish on scroll or press when required by the owning interaction. Reduced motion uses the route fade; off cuts.

A flight can survive its departing owner long enough for the arriving page to claim and turn it. Preserve the display-clock pose and the existing reversal rule; unclaimed layers fade in place. StrictMode remounts adopt the running layer instead of restarting it.

### Folder and history origins

A folder's target is the visible page column, not just its header. Keep the header stable at mount using the cached own-folder list or public-profile seed. Batch-selection presses do not record an opening origin. `handoffFade` reveals changes that arrived beneath the copy.

History rows use `data-detail-origin` and `rememberDetailOrigin`. Warm the record and still preview alongside the route; retain loading images in the visual clone so they can complete.

- Capture the picture and header first; defer the detail body.
- A copy stacks locally at zero and includes its back affordance.
- Play exit when closing starts, not only at unmount. Clear the seal's hidden state on the copy.
- A same-overlay remount adopts its existing entrance.

`useHistorySequence` follows displayed day-group order and excludes undo-held rows. Reveal through the history page's own state and find the new `data-detail-origin` before close geometry is measured.

## Tab state and history

Use `Tabs`, `TabPanes` and `TabPane`. Keep pane order identical to tab order.

- Panes stay mounted in one grid cell, selected through `data-tab-pane-active`.
- Do not use conditional unmounting, `hidden` or a changing key on the panel.
- Conceal inactive panes with `content-visibility: hidden`; the stylesheet supplies the unsupported-browser fallback.
- Inspect concealed state through attributes, including all enclosing panes, not geometry.
- Only an active pane with no focusable contents needs `tabIndex=0`.
- Prerender a concealed pane once on idle and after relevant font changes.
- `TabPanesDriver` snapshots pane flags and offsets before React mutates them. Keep reads before writes.

In-page tabs use local state. Addressable settings/admin tabs replace their query in place so Back leaves the screen. Omitted account-only tabs resolve to an available tab and correct the address.

The home gallery/forum pill is the exception:

1. Gallery → forum pushes one native history entry.
2. Forum → gallery goes back if the preceding entry is this route's gallery, otherwise replaces.
3. A cold forum entry establishes a gallery entry beneath it.
4. Drawer entries on the home route use `requestHomeTab`.
5. Call `startTabTransition` before `writeHomeTab`; do not use `router.push` or a delayed navigation queue.
6. Wait for overlay history to settle. Write the URL after the first shown frame, flush on new input and cancel on traversal.

### Priming and interruption

`primeTabTransition` prepares the held first pose on press. Release starts playback; cancelled scrolls and long presses release the prime. Mouse priming follows its ripple frame.

The selection commit follows the first presented frame through `afterFirstFrame`, or flushes on the next input. The indicator uses cached geometry from ResizeObserver.

`turnStrip` starts from the displayed pose with the existing launch-speed and remaining-distance rule. Do not replace it with `Animation.reverse()`. A switch to a third tab settles the current run before starting another.

### Window and lean

Standard shared-axis movement uses `PAGER_SPRING`. On wide screens, `columnWindow` includes the column and faded margin; where masking is unavailable or space is narrow, use the scroller window. A bounded region such as the admin content area declares `data-tab-window`.

`TabPanes lean` applies only on the existing home, policy, messages, settings, favourites, tasks and profile panels. Admin panels do not lean.

- Derive visible blocks from structure, not call-site markers.
- Use `lagSampler` / `leanDepth` and the shared `LEAN_LAG_MS`; the panel's visible top is the depth origin.
- Limit work to visible blocks, at most 32 per pane.
- Each block uses one compositor transform and shared parsed keyframes; no per-frame layout or style loop.
- Reversals continue from the strip's recorded history.
- If either visible pane contains first-load `data-page-loading`, slide it as one plane.
- Reduced motion drops lean and uses the shared 8 px travel. Off still applies the correct pane and scroll state.

### Height and footer

Do not animate panel height. Both panes naturally hold `max(H_out, H_in)` during the run.

Shared-chrome screens retain `holdFloor` while needed to keep the current offset reachable. Release it when scrolling no longer needs it. Other screens clamp against the settled height; see [tab offsets](scrolling.md#tab-offsets).

Clip the run vertically with `overflow-y: clip`, leaving horizontal movement to the scroller or marked window. Restore scroll anchoring at settle. Late content changes use normal reflow.

The footer travels with its page during route changes. Tabs alone hold it with `data-page-transit` and release it on DefaultEffects. First-load placeholders use `data-page-loading`; `pageLoadingHold.ts` marks the footer with `data-page-held`. Do not replace that targeted marker with a page-wide `:has()` rule.

## Admin panes and inline editors

`components/admin/registry.tsx` owns panels and role gates; the rail uses manual activation. Unvisited panels do not read, and visited panels retain drafts.

`sections.ts` owns section names and icons; `SectionHeader` consumes them. Shared reads use `sharedQueries.ts` and `useAdminSelect`, preserving derived-view identity.

Inline editors use `InlineEditorPanel`. Capture with `captureInlineEditorLayout` before opening and retain through `onExitComplete`. The translated clip and surface share layout motion with `DataTable`; do not animate `clip-path` or restart on a StrictMode remount.

## Back and focus

Show a back affordance on routes without a permanent sidebar entry, including loading and error states. Check redirects before treating a route as deep.

`PageBack` portals into `data-page-back-slot`, before the scroller in tab order. It and `useEscapeBack` share `useBackOrParent(parent)`: return to an in-app entry, otherwise replace with the parent.

Reserve space with the appropriate `page-back-room*` utility. Do not add independent page padding or an entrance on every remount. When only one route has the control, it fades with that route.

When navigation removes focus, focus the incoming heading or main after it is visible. Do not steal focus on initial hydration or while Hero/modal layers own it.

Return origins use `data-return-focus` and take precedence over the heading. Wait for a temporarily hidden origin, focus without scrolling and preserve any newer user focus.

## Route ownership

`RouteCrossFade` captures in `getSnapshotBeforeUpdate` and sets `data-route-transit` before child layout effects. `Reveal` and gallery cascade stand down for that entrance. Finish finite entry animations without stopping progress indicators.

Plain routes fade the outgoing clone on FastEffects and the incoming page on SlowEffects after `HANDOFF_MS`. Start playback after the commit's first frame; do not add incoming translation that corrupts Hero geometry. Keep query-container behaviour in visual clones.

Other transitions stand down while Hero owns the pixels. Use the runtime gate and `setHeroBusyCheck` seam, without importing the engine into general motion.

## Previous and next picture

A sequence records activation through `openFromSequence`; the viewer reads `useImageNeighbours`. A viewer with no sequence has no invented neighbours.

- Step in one existing tree; never call the router or remount the detail for a step.
- `useDetailStep` owns the shown image. Reset per-image state at the swap, not from a lagging URL.
- The shared axis fades out, performs one swap, then arrives. Reset the overlay scroller at the swap.
- Horizontal swipe follows the finger, rubber-bands at an end and uses release velocity. A video accepts paging outside its controls band.
- If the next page is pending, join that read and advance once when it arrives.
- Arrow keys ignore modifiers, IME, fields and controls that own those keys.
- A second press or flick takes over the current step. Teardown must never leave a pinned pose after the finger is gone.
- Step buttons remain pinned as dialog chrome, unavailable at a true end and busy while the next page loads.

`imageHeroHistory.retarget` replaces the detail base URL and restores its guard without growing history. Wait for the swap and idle, or flush for close. A traversal that overtakes the rewrite cancels it; never write the detail URL onto the list's entry.

Closing calls `revealInImageSequence` before measuring the return. After `STEP_REVEAL_TIMEOUT_MS`, use a flightless close. Focus the revealed card without scrolling only if focus is still lost.

Reloaded orphan ladders collapse to their original list. A cold detail without a ladder returns within the app or replaces with `/`. Browser-coalesced Forward during a close may never reach the page; Forward after settlement reopens normally.

## Verification

Run the relevant `bun run test:hero`, `bun run test:overlays`, `bun run test:tab-press`, `bun run net:tabs` and `bun run net:tabnav`.

Measure presented frames and release-to-response latency using [Performance](performance.md#measurement-rules). Cover real input, rapid reversal, missing data, shared chrome, reload and focus.
