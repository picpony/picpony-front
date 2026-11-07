# Hero image-detail engine

Current contracts for `lib/hero/`. Read [Transitions](transitions.md) for route ownership, flightless containers and previous/next behaviour.

## Opening

`useHero` arms through `armImageHeroOpen` on card pointerdown, except while scrolling.

1. `HeroController.armOpen` mounts a Stage with the future session ID and `stage.phase === 'armed'`.
2. Keep the Stage and its back copy behind an empty clip until `data-image-hero-stage-ready` is set. Arming or entering `opening` alone must not reveal them.
3. `prepareArmedFlight` creates the plane, flyer and tracks in `holdHeroMotion`, paused at the first frame.
4. Activation adopts that ID, validates card/viewport geometry through `takePreparedFlight`, installs the tracks and leases, marks the Stage ready and releases motion.
5. Cancellation, another armed card or `HERO_ARM_TTL_MS` disposes the preparation.

Do not reread the landing box while held tracks already transform it. Flight preparation does not fetch or decode a sharper bitmap.

Mid-flight remeasurement uses `getHeroRestingDetailRect` to remove the window/counter-transform pair. Their sampled tracks can drift between keyframes; that drift is not a new layout destination. Real viewport and media-box changes still re-aim the flight.

The Stage subscribes only to the Hero runtime. `AppLayout` observes route commits; router suspension must not replace an in-flight Stage. Clear readiness before cancelling a departing Stage's tracks, and keep it clipped until React removes it. Seal a returning route before resetting its window or pull styles.

### Input

- Touch preparation runs in a microtask; browser gesture arbitration can hold timers and frames. Mouse preparation uses the existing deferred task.
- A valid armed touch opens on pointerup within the 15 px tap tolerance and a hold shorter than 450 ms. Consume its compatibility click, but never keyboard activation.
- Route activation work through `onActivate` so pointerup and click update the image sequence identically.
- During opening/landing/handoff, ignore requests for another image. Reopening the same image during a return turns the current flight forward; another image uses the existing retirement path.
- Keep click protection for each registered route, across opening, reversal and handoff. A press that starts during flight cannot activate detail content when released after landing; match its pointer within `HERO_PRESS_TAIL_MS`. A fresh settled press and keyboard activation remain available.
- Guard only the detail scroller. The floating Back control must work during every reopening turn.
- Prime pull layers on candidate pointerdown through `HeroPullController.prime`.

Opening and closing share the native input lease in `returnInput.ts`. A wheel's active flag clears after 160 ms, while its stream identity remains valid through the 320 ms quiet window. Promotion during that gap must retain the stream. DOM hit testing alone does not prove that the compositor changed scroll owners.

The lease survives Stage removal and visual handoff, without holding detail data or controls. A close immediately after handoff inherits the original receiver and its line/page units, even when that receiver is detached. A new open or navigation cancels the old lease. Confirm native takeover from a destination offset not written by the relay, and drain the final scheduled delta before ending an idle lease.

### Track construction

Scalar tracks use two keyframes plus `linear()` where supported, and the same progress samples as keyframes on Chrome 109. Arc and container tracks retain their samples. Start shared tracks with the flyer, not a frame later. The shared representation is documented in [Motion system](motion-system.md#browser-compatibility).

Read initial offsets and dimensions before inserting flight DOM and pass `HeroMotionOptions.preread`. Later rebuilds read current geometry. Sample each rectangle arc once through `sampleHeroRectArc` and reuse it across bow solving.

## Closing and pull

A close launches in the requesting task, with rect reads before the shell's microtask commit. `routes.freeze({deferInert})` installs the temporary pointer shield; `exposeGallery` releases the gallery after the animation is ready and applies the leaving detail's exclusion.

- Replay a tap caught by the closing shield once the gallery accepts input.
- Place the closing shield in the gallery scroller's premeasured scroll space, outside its covered content. Keep it absolute and allow native vertical panning; a fixed shield can latch a gesture to the non-scrolling document even when it is a DOM child of the gallery. Removing the shield must leave the gesture's native scroll owner intact.
- Freeze the departing detail before it can reclaim gallery focus.
- Input availability and off-screen content coverage are separate. Only `coverGallery` / `uncoverGallery` own `data-gallery-covered`.
- After `gallery-idle`, uncover slots in idle batches before removing that marker.
- Preserve newly chosen gallery focus and fresh wheel/touch streams; a continuing stream must not indefinitely block handoff.
- Keep the [input lease](#input) for a stream that began on the leaving route or Stage. Do not hold visual or history completion for it.
- Baseline each relay write after browser clamping. Fresh pointer/touch input and Ctrl-wheel release the old lease. Detached touch targets still report moves and endings to the shared input monitor.
- Cancelling movement does not end a held touch. The shared input monitor keeps the original target's state listener until its real end/cancel, window reset or existing touch-safety timeout. The ending retains any other active touches and leaves no listener or pending relay frame behind.
- Quiet, expiry and abort are distinct outcomes. A still-owned transfer can finish on budget expiry.

Pull uses the existing `DRAG_RESISTANCE_PX` rubber band and subtracts axis-lock slop at claim time. Horizontal picture stepping uses the same slop rule.

`HeroVelocityTracker` uses a 100 ms horizon, a 40 ms stop rule and a least-squares quadratic fit. A pointerup at the same position updates stopping, not velocity. A release reversing by at least 0.25 px/ms cancels dismissal/stepping regardless of distance.

Dismissal uses release velocity projected toward the card; away from it, launch from rest. The pull fades content while keeping the surface opaque. On release, the window returns to the card from its full host bounds and the content keeps the position the finger left it at. Reopening during dismissal aims at the resting media slot, removes the pull translation and continues the captured content opacities.

## Window, content and interruption

The window reveals a stationary page. Its content counter-transform is the exact inverse of the window transform.

- Header and body can cross-fade but do not travel within the window.
- The floating back control stays outside the window and fades in place.
- On return, a transparent image carries `--md-sys-color-surface` behind its alpha.
- The window's surface stays opaque in both directions, including pull dismissal. Container-return content uses `HERO_RETURN_FADE`; the shrinking window exposes the gallery.
- While returning, the window follows the gallery's native scroll with the flyer. Its content receives the inverse scroll translation and stays stationary. Reversals, remounted route mirrors and viewport rebuilds preserve that position; all scroll tracks leave with their motion owner.
- A superseded flyer fades immediately on FastEffects. Keep its card lease until its lifecycle releases it.

Interruptions use the rendered WAAPI clock and pose. An unresolved first frame has zero elapsed travel; setup time must not advance it. Rebuild the flyer and container together on viewport changes, toward a freshly measured untransformed host. Keep the remaining clock unless a pull owns it; real host/card destinations survive a rebase.

The gallery recedes to `HERO_BACKGROUND_SINK_SCALE` over the full flight spring. Do not compress its motion into an early progress window or apply another acceleration curve. Maintain its viewport-centred pivot while it is below one. Coalesce pointer samples once; the surface must not queue a second frame.

A gallery card's ancestors must finish with no residual transform. Inverse projection supports the Hero background scale and a detail's pull translation. Avoid backdrop blur on moving gallery content.

### Repeated interruption of one image

- Keep one flyer, canvas lease, session ID and history record through repeated open/Back turns. A new turn gets a new async owner; older continuations must not finish, navigate or release its pixels.
- Back always requests the gallery. Repeated Back during a return is consumed; Back during a reopening turn reverses it immediately. Never queue a page-level Back for a later settled state.
- Restore the history guard alongside a reopening close. Installing an already-current guard is idempotent. Queued collapses and guard restores must check that their turn still owns the intent before navigating or writing.
- A native traversal can unmount the detail route. Keep its resting media box, attach a remounted route to the running motion, and wait for paintable media before releasing the flyer.

## Data and handoff

`completeDetailRow` / `primeImageDetailFromRow` provide provisional first paint. The confirmed open revalidates the record.

`lib/detail.ts` keeps its two-minute TTL and 30-minute stale window so reopening does not replace usable data with skeletons. Comments prefetch after body publication and display immediately when cached.

The Stage, loading view and routed detail share `DetailActions` and the regular tag section frame. Show the controls and the `标签` heading from the first paint. Stage and loading copies are inert and have no tooltips. Keep routed controls mounted as values arrive, including after a metadata failure.

Tag values and rich content wait for `isDetailBodyPublishable`. Artists, OCs, description and sources arrive with their headings only when data exists; do not reserve empty placeholders for these optional sections. Publish tag values first, then the below-fold content in subsequent frames; comments can prerender inside hidden React `Activity`. Cached direct-page content needs no publication delay.

`FollowHeight` follows optional sections and tag-row height changes on the layout spring in the `list` category. Empty section wrappers have zero height and no gap; section spacing belongs inside the expanding content. One-row chip placeholders include the coarse-pointer margins; vote placeholders use the real row's type-role line height. Filling values must not move the media or actions. Tag visibility observers and settling timers wait until values are publishable. Late comment blocks use `playDetailArrival` on DefaultEffects at their final position.

When a preview fails, switch the media's DOM layer flag before publishing a decoded final as paintable. The parent React state may commit later; that must not expose a transparent target at handoff.

Keep published body content normally painted, without containment or skipped-content rules that can reveal blank space on the first scroll.

`scheduleDetailCodeWarm` warms, in separate idle slices, the detail module, the first card's route payload, deferred detail code and needed font glyphs. Code warmup must not introduce a backend record read or view count.

### Settled states and recovery

- `detail-idle` with no active session reveals the route for `runtime.imageId`, releases its freeze and seals other surfaces through `settleDetailSurface`.
- `recovering` without a session schedules recovery once history is quiet, then drains a queued tap.
- An opening scroll stream may retain the Stage within the existing handoff/quiet bounds.
- A terminal route without media sets `resolvedWithoutMedia`; missing targets must not hold an error screen behind a timeout.
- A failed reopening releases its motion and scroll owner before collapsing history. Seal the route before cancelling its window; a late fallback must not reset a newer flight.
- Back copies use `passive` and visibility-based handoff. They never add a second focusable control or restart opacity at landing.
- Chrome drawn only by the routed detail, such as zoom and step controls, stays hidden during flight unless the Stage has a matching copy.

Viewer stepping, orphan ladders and close-to-sequence focus belong to [Transitions](transitions.md#previous-and-next-picture).

## Rendering constraints

- Do not toggle inherited properties over the whole gallery during a flight. Keep the app scroller's inherited scrollbar values pinned at its child boundary.
- Hero-state selectors identify concrete classes/attributes; avoid universal descendants that invalidate the whole page.
- Promote the background transform only during flight, then release the layer.
- Defer description measurements until after commit and idle.
- Pass a known `initialScrollTop` when binding pull during adoption; avoid a fresh layout read in the reveal frame.
- Measure both scrollers' offsets and ranges before adoption. Align the hidden route before installing mirror tracks, skip unchanged scroll writes, and pass the measured baseline to scroll continuity and following. Scroll setters can force layout after style changes too.
- ResizeObserver may measure after layout; window invalidation follows the scheduler's read phase.
- Drawer cleanup restores panel styles only when its gesture actually touched the panel.

## Sharpness

Capture decoded pixels through `getMediaPixelSize`, not density-corrected `naturalWidth`. Start from the card bitmap and upgrade the canvas from a decoded still final during flight.

Do not warm a sharper opening source; neighbour warming is for steps. Production and development use different image delivery. Detailed rules and probes are in [Scrolling / Flight sharpness](scrolling.md#flight-sharpness).

## Verification

Run `bun run check`, `bun run test:hero` and `bun run test:overlays` after engine or detail changes. `bun run hero:path` verifies path and container geometry, including stationary content composition.

Hero browser fixtures block Service Workers before interception, so cached navigation cannot bypass their network answers. Use `bun run test:hero --profile=mobile` (or `desktop`, `wide`) to rerun one viewport profile; `--case=` further selects a scenario.

Useful scenarios:

- Native wheel/touch at return boundaries and delayed-data close.
- `shield-wheel` and `shield-touch` hold the first-frame shield long enough for the first native input to hit it, then continue the same gesture after removal. `shield-tap` verifies one replay and cleanup through reopening. A continuous wheel test uses a single CDP scroll gesture so a fresh stream cannot hide a bad initial latch.
- `continued-wheel`, `continued-opening-wheel` and `continued-touch` start one native stream before requesting Back, then assert movement after both animation completion and removal of the original scroller. `continued-wheel-reopen` verifies that a new Hero stops the old gallery relay.
- `opening-native-wheel` keeps one browser-generated wheel stream moving through opening handoff, checking full travel without a rebound and a fresh reopen at zero. `opening-native-wheel-close` also closes after handoff while the same stream continues, checking movement after both original surfaces leave.
- Rapid reopen/reversal, pull-follow, pull-retreat, pull-frame and pull-loading.
- `detail-content`, `detail-content-reduced` and `detail-content-off` hold the record through handoff, verify fixed controls and the regular tag heading, then fill optional sections and multiple tag rows. Assert retained nodes, stationary media/actions and the correct layout interpolation for each tier. `detail-content-empty` verifies that absent optional sections never appear.
- `landing-content-resize` repeatedly changes content below the media during flight. The final flyer must still match the resting media box within half a pixel.
- `repeat-open` covers prepared and unprepared launches of the same card; `return-surface` samples surface opacity, stationary content and header geometry through the return. `pull-reopen` verifies the resting landing slot after reversing a dismissal.
- `return-scroll-surface`, `return-scroll-fallback` and `return-scroll-reopen` keep a return unfinished while scrolling. The window and flyer must move together, content must stay stationary, and reopening must preserve the scrolled pose with or without `ScrollTimeline`.
- The `same-image-*` cases alternate eight or nine directions before either leg settles, using the Back button, Escape and browser Back from both opening and closing. Fast variants run sixteen turns near the first presented frame. Cover both final directions; assert one flyer and history token, then the exact original gallery history entry.
- `same-image-press-tail` holds a mouse or touch press through a reopening handoff. Assert that it cannot open a lightbox or cover the app bar, that a fresh click can, and that closing returns to the original gallery entry.
- Missing media, terminal errors, failed preview and late final decode.
- Keyboard focus, scrollbar continuity and transparency.
- Stepping by button, key and swipe, including pending pages and video controls.
- `node scripts/reviewBrowser.mjs --hero-stress` for burst recovery.

For a custom probe in PowerShell:

```powershell
$env:HERO_SCRIPT = 'scripts/probeHeroCost.py'
node scripts/reviewBrowser.mjs --mobile --pull
$env:HERO_SCRIPT = $null
```

`scripts/acceptHeroMatrix.py` is the acceptance harness selected with the same `HERO_SCRIPT` variable. `HERO_BROWSER_CHANNEL=chromium` selects bundled Chromium; `PYTHON` overrides the interpreter.

Use input timestamps and renderer draw/presented-frame evidence. Main-thread rAF gaps alone do not measure compositor smoothness; see [Performance](performance.md#measurement-rules).

## Device diagnostics

Open `/perf` from the diagnostics section in Settings. The runner loads on demand, exercises the gallery with synthetic input and returns a Markdown/JSON report.

- Default gallery: `/`; `/perf?gallery=/user/1` selects another same-origin path.
- Scenarios cover idle baseline, scroll, open, step and closing by Escape, pull and Back.
- Thresholds and arithmetic live in `lib/perf/stats.ts`.
- Reports use main-thread frames and omit the OS touch pipeline; they do not prove real-tap latency or compositor frame rate.
- A valid flightless settle is reported as such, not as a failure.
- Missing latency does not discard completed frame data; a timeout still fails.
- Keep the latest report in memory as well as `LS_KEYS.perfReport`, so denied storage cannot lose it.

## Known limitations

A rapid open A → Back → open A → open B can retain an extra detail entry, requiring another Back. Keep this case in recovery checks.

First Stage layout and bitmap capture remain press-time costs. Corner-radius tracks can lag during a busy main thread even when the transform remains smooth. Confirm their impact on a real device before assigning a frame-rate cause.
