# Hero (image detail) engine

> Split out of `AGENTS.md`; read on demand. Cross-references such as "see Motion" or "under Shape" name sections listed in the index in `AGENTS.md`.

The current contracts of `lib/hero/`, condensed from the 2026-10 investigation rounds. Read with
`docs/transitions.md` (the hero sections there) before touching the engine.

## Opening: the press builds it, the click plays it

- `useHero` → `armImageHeroOpen` on a card's `pointerdown` (not during a fling: `isScrollMoving`).
  `HeroController.armOpen` mounts the Stage under the session id the open will use
  (`stage.phase === 'armed'`), hidden with an empty `clip-path` — never `visibility`,
  `pointer-events` or `inert`: those inherit, and lifting them restyles the whole Stage inside the
  click.
- Right after the press, `prepareArmedFlight` builds the plane, the flyer and every track inside
  `holdHeroMotion` (created, parsed, paused at frame 0). The click adopts the armed id
  (`adoptArmed`), checks the card rect and viewport (`takePreparedFlight` — the landing box is *not*
  re-read: the held container tracks already scale it), applies the card leases and calls
  `HeroMotion.release()`. Anything else (pointercancel, another card, `HERO_ARM_TTL_MS`) disposes it.
- Nothing is fetched or decoded at the press; the flight-upgrade watch starts at launch.
- **Touch must build in a microtask.** While a finger is down and Blink does not yet know whether it
  is a scroll, it holds back timers, `scheduler.postTask` (even `user-blocking`) and frames. A mouse
  press builds in a `setTimeout(0)`.
- **Scalar tracks are two keyframes + `linear()`** (`ScalarTrack`): fades, reveal rises and the
  sink. Same frames, far cheaper per `animate()`, and `linear()` timing runs on the compositor. The
  flyer and container tracks stay per-sample: they are arcs, not scalars.
- **Shared tracks are not deferred past the first frame**: the forward spring covers ~5% of its
  travel in one frame and ~17% in two, so a late window visibly lags the flyer.
- **Pull layers are promoted on the candidate pointerdown** (`data-image-hero-pull-ready`,
  `HeroPullController.prime`), so the first dragged frame moves layers instead of creating them.
- The drawer gesture's cleanup (`useDrawerSwipe`) hands styles back only when a gesture actually
  touched the panel (gated on `touched`), so opening does not restyle the page.

## Closing and the pull

- **A close never waits for a restyle.** The flight launches synchronously in the task that asked
  for the close (rect reads before the shell's microtask commit); a transparent shield
  (`routes.freeze({deferInert})`) holds the pointer; `HeroController.exposeGallery` — once the
  flyer's animation is ready, plus one frame — lifts the gallery's `inert` (`runtime.galleryExposed`,
  read by `AppLayout`'s `closeHoldsGallery`), puts `inert` and the leaving marker on the detail, all
  in one task, under a flight the compositor keeps moving. Both ways of cutting input (`inert`,
  `pointer-events`) restyle a subtree, so neither may flip inside a frame that must move.
- **The rubber band stays** (owner decision): y = raw / (1 + raw / `DRAG_RESISTANCE_PX`), 360; x
  follows at the same ratio once the vertical drag is claimed. The axis-lock slop (6px) is
  subtracted at the slop boundary, Flutter-style, so the claim is not a jump. The 上一张/下一张
  swipe uses the same slop rule.
- **Release velocity is `HeroVelocityTracker`** (`lib/hero/velocity.ts`): 100ms horizon, 40ms stop
  rule (also against the pointerup's time), least-squares quadratic. A pointerup at the last move's
  position feeds only the stop rule. A release moving back (≥0.25px/ms against the drag) cancels
  both the dismiss and the step, however far it got.
- **The dismiss leaves at the finger's speed** when the release heads towards the card
  (`releaseSpeedAlong` → `createHeroLeg({speed})`). Away from the card (pulling down, card above) it
  launches from rest.
- **The sink has no velocity step** (`easeSinkWindow`): forward eases out to rest at p 0.6, back is a
  smoothstep from rest at p 0.4. Depth 0.95.

## Settled states and recovery

- **`detail-idle` enforces a visible detail.** With no session running, `setPhase('detail-idle')`
  reveals the live route of `runtime.imageId` (owner checks bypassed, freeze lease released) and
  seals the rest (`settleDetailSurface`). This is what prevents "stuck on the list, address bar on
  `/pic/:id`" when a re-tap turns a close around and history walks forward into a newly mounted
  overlay registration.
- `recovering` with no session is not terminal: `scheduleIdleRecovery` restores the guard (or
  collapses from the provisional rung) once history is quiet, then drains a queued tap.
- **Scroll during the open:** the handoff holds the Stage while a scroll stream latched to it is
  still running (≤600ms, 120ms quiet).
- **Handoff:** the detail body is pre-rendered hidden (`<Activity mode="hidden">`) once the flight's
  record exists, so the post-landing publish is a visibility switch; the `PicDetail` chunk is warmed
  once on gallery idle.
- Known residual: open A → Back → open A → open B can leave A's detail entry under B, so one Back
  from B lands on A's detail (consistent and interactive, one extra Back).

## Sharpness

- The press-time capture sizes its canvas from the **decoded** pixels (`getMediaPixelSize`,
  `lib/hero/dom.ts`), never `naturalWidth`: for a `next/image` with a `w`-descriptor `srcset`,
  `naturalWidth` is density-corrected, so a 2× screen captured below the card's on-screen
  resolution. Production-only (dev serves bare `src`).
- **No pre-take-off warm** of the detail final (owner decision; see "Nothing sharper is required
  before take-off" in `docs/scrolling.md`). The flyer sharpens in the air from the routed final
  (`upgrade.ts`). The detail final is Derpibooru's own rendition, not re-encoded by `/_next/image`
  (`lib/detailFinalSource.ts`).

## Measuring

- `HERO_SCRIPT=scripts/probeHeroCost.py node scripts/reviewBrowser.mjs --mobile [--close|--pull]`
  (390px, 4× CPU): every main-thread task over 40ms with its children, plus User Timing marks.
- `scripts/acceptHeroMatrix.py` (via `HERO_SCRIPT`) is the acceptance harness: latency from the
  input's own `timeStamp` to the renderer's draw of the commit carrying the response
  (`heroProbeMark`, gated on `__HERO_PROBE__`); dropped frames during compositor animation; longest
  main-thread task; per-move p95; scroll-update latency from `InputLatency::GestureScrollUpdate`
  (`RENDERER_SWAP`). `--off=arm` turns the press build off for A/B.
- Two traps: `PipelineReporter`'s `scroll_state` says MAIN_THREAD on any page with a stylesheet (use
  the latency components' `RENDERING_SCHEDULED_MAIN`), and "presented" includes headless software-GL
  display — budget on the renderer's draw.
- `node scripts/reviewBrowser.mjs --hero-stress` (random open/Back/Esc/re-tap bursts, asserts a
  consistent settled screen); `--hero-open-probe [--cpu=4] [--no-scroll]` (phase timeline, body
  visibility). `HERO_BROWSER_CHANNEL=chromium` runs `test:hero` on bundled Chromium;
  `PYTHON=python3` overrides the interpreter. `test:hero` covers `pull-follow`, `pull-retreat`,
  `pull-frame`, `pull-loading`.
