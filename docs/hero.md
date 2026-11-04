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

The Stage subscribes only to the Hero runtime. `AppLayout` observes route commits; router suspension must not replace an in-flight Stage. Clear readiness before cancelling a departing Stage's tracks, and keep it clipped until React removes it. Seal a returning route before resetting its window or pull styles.

### Input

- Touch preparation runs in a microtask; browser gesture arbitration can hold timers and frames. Mouse preparation uses the existing deferred task.
- A valid armed touch opens on pointerup within the 15 px tap tolerance and a hold shorter than 450 ms. Consume its compatibility click, but never keyboard activation.
- Route activation work through `onActivate` so pointerup and click update the image sequence identically.
- During opening/landing/handoff, ignore requests for another image. Reopening the same image during a return turns the current flight forward; another image uses the existing retirement path.
- Keep click protection for each registered route, across opening, reversal and handoff. A press that starts during flight cannot activate detail content when released after landing; match its pointer within `HERO_PRESS_TAIL_MS`. A fresh settled press and keyboard activation remain available.
- Guard only the detail scroller. The floating Back control must work during every reopening turn.
- Prime pull layers on candidate pointerdown through `HeroPullController.prime`.

### Track construction

Scalar tracks use two keyframes plus `linear()`; arc and container tracks retain their samples. Start shared tracks with the flyer, not a frame later.

Read initial offsets and dimensions before inserting flight DOM and pass `HeroMotionOptions.preread`. Later rebuilds read current geometry. Sample each rectangle arc once through `sampleHeroRectArc` and reuse it across bow solving.

## Closing and pull

A close launches in the requesting task, with rect reads before the shell's microtask commit. `routes.freeze({deferInert})` installs the temporary pointer shield; `exposeGallery` releases the gallery after the animation is ready and applies the leaving detail's exclusion.

- Replay a tap caught by the closing shield once the gallery accepts input.
- Freeze the departing detail before it can reclaim gallery focus.
- Input availability and off-screen content coverage are separate. Only `coverGallery` / `uncoverGallery` own `data-gallery-covered`.
- After `gallery-idle`, uncover slots in idle batches before removing that marker.
- Preserve newly chosen gallery focus and fresh wheel/touch streams; a continuing stream must not indefinitely block handoff.
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

The body can prerender inside hidden React `Activity` from the flight's row; record-dependent pieces still wait for the record. Make it visible only when `isDetailBodyPublishable` permits it. Publish the below-fold tail in subsequent frames; late visible content uses `playDetailArrival` on DefaultEffects, fading at its final position without a second spatial entrance.

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

Useful scenarios:

- Native wheel/touch at return boundaries and delayed-data close.
- Rapid reopen/reversal, pull-follow, pull-retreat, pull-frame and pull-loading.
- `repeat-open` covers prepared and unprepared launches of the same card; `return-surface` samples surface opacity, stationary content and header geometry through the return. `pull-reopen` verifies the resting landing slot after reversing a dismissal.
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
