# Motion system

Spring roles, motion preferences and lifecycle rules. [Component motion](motion.md) assigns roles to specific components.

## Spring APIs

[lib/spring.ts](../lib/spring.ts) is the source of truth. Call sites choose a role, not a duration or easing curve.

| Runtime | API |
| --- | --- |
| CSS | Generated `spring-*` utilities and spring tokens |
| Web Animations | `springTiming`, `surfaceArrival`, `surfaceDeparture` from `lib/springTiming.ts` |
| GSAP | `spring`, `surfaceArrival`, `surfaceDeparture` through the existing motion boundary |

### Spring roles

| Role | Use |
| --- | --- |
| `fastSpatial` | Control movement, handle changes, small anchored surfaces |
| `defaultSpatial` | Partial-screen surface movement and tab indicators |
| `slowSpatial` | Large surface arrival and search expansion |
| `fastEffects` | State layers, outgoing colour, small fades and surfaces leaving the screen |
| `defaultEffects` | Incoming colour, scrims, dialog fades and corner morphs |
| `slowEffects` | Full-screen arrival fade |
| `layout` | Bounds following layout: placement, content height, collapse, docked drawer width |

The six spatial/effects roles follow Compose's `MotionScheme.expressive()`. `layout` is the project's critically damped content-size spring. Exact damping, stiffness and settle times remain in the source and generated tokens.

Named component springs also live there:

- `FLIGHT_SPRING`: Hero and container transforms.
- `PAGER_SPRING`: tab strip and lightbox paging.
- `PROGRESS_SPRING`: determinate values; waiters use `COMPONENT_SPRING_MS.progress`.
- Theme reveal: its radius spring ends when it first covers the screen.

Springs settle at 1/512 of their travel. Do not shorten that tail with a call-site cutoff.

### Role selection

1. If Compose implements the component, use its role for each property and direction, unless this repository documents a refinement.
2. Use spatial for movement, effects for colour/opacity and corner morphs. Use `layout` when bounds follow layout.
3. Otherwise choose fast/default/slow by control, partial-screen surface or full-screen surface.
4. Split arriving transform and opacity tracks with `surfaceArrival`.
5. Anchored surfaces keep their spatial scale spring on exit. Sheets, side panels and modal drawers leave on `fastEffects`; their scrims retain the assigned effects role.
6. Use `HANDOFF_MS` for a follower waiting on the leading surface. Do not invent a delay.

A screen-edge surface keeps its spatial spring and an `edge-skirt-*` for overshoot; it is not a layout follower.

Indeterminate loops, skeleton shimmer and Compose's ripple are explicit exceptions to spring timing. Ripple owns its held press, spread and release clock; consumers only use `data-ripple`.

### Browser compatibility

Keep the native `linear()` path when supported. `sampledTrack` in `lib/sampledAnimation.ts` represents the same curve as explicit keyframes on Chrome 109, preserving Hero travel, tab lean, fade windows and reversals without a per-frame JavaScript loop. Container transforms use the same physical progress samples.

CSS transitions and ordinary two-keyframe effects use the three `SPRING_BEZIER` fits from `lib/spring.ts` when `linear()` is absent. Their clocks, tiers and speed scaling are unchanged. Effects stay monotone; spatial fits retain overshoot. Unit checks bound normalized displacement error below 2% for effects/default spatial and 5.1% for fast spatial. `springTiming` and generated CSS share these values.

Tooltip first entry establishes its closed style before paint when `@starting-style` is unavailable. The existing CSS transitions then own entry, exit and interruption. Measure its untransformed dimensions so scale animation cannot feed back into placement.

## Tiers, speed and categories

`lib/appearance.ts` owns storage, cookies and resolved root attributes. Read the current attribute-backed value rather than interpreting storage at a call site.

| Axis | Choices | Effect |
| --- | --- | --- |
| Motion | `off` / `reduced` / `standard` / `custom` | Kind of motion |
| Speed | `fast` / `default` / `slow` / `custom` | Clock scale: 0.7 / 1 / 1.4 |
| Entrance | `blocking` / `non-blocking` / `off` | Unrequested entrances and splash behaviour |

Custom motion and speed share the categories in `lib/motionPreferences.ts`. A preset replaces only its own axis. The first custom edit inherits the active preset; later visits retain saved edits.

Use `motionTier(category)`, `motionScale(category)` and their hooks. Pass the same category to `scaledMs`, `springTiming` and `spring`. The default is `feedback`; `motionMode()` describes the overall selection, not an individual animation.

- Keep unscaled CSS base durations. A disabled feedback category must not disable other categories through a shared multiplier.
- GSAP's global clock carries feedback speed; category ratios apply once.
- `data-motion-spring="overlay"` scopes surface timing without changing its child controls.
- Built CSS durations use the appropriate motion scale, except documented indeterminate indicators and third-party stylesheets.
- System reduced motion resolves to `reduced`. App-specific settings take precedence over the media query.
- `no-motion:` is the off-tier variant; do not substitute Tailwind's media-query-only `motion-reduce:`.

### Reduced and off behaviour

Reduced motion keeps fades, short travel, state layers, ripple and indicators. It removes Hero/container flights, full-window travel, stagger, overshoot, decorative loops and all Lottie playback.

Use `TRAVEL_PX.small` / `--motion-travel-small` for the shared 8 px reduced travel. Standard entrance travel uses `TRAVEL_PX.standard`. Reduced spatial springs retain their duration but use the critically damped shape. Skeleton shimmer continues under reduced motion.

The off tier removes transitions but preserves:

- Indeterminate progress, slowed rather than frozen.
- Determinate values, without interpolation.
- Direct finger-controlled position; only the release animation is gated.
- Scroll restoration and other position state.

Do not leave a rotate/scale hover end state snapping into place under the off tier.

### Animation watchdogs

A timer bounding an animation uses `MOTION_SPEED_SCALE.slow`, not the current speed or unscaled duration. Speed can change after the timer is scheduled. Prefer animation completion signals with this watchdog as a bound.

## Entrance and splash

`entranceMotion()` gates volunteered entrances such as `Reveal` and the gallery cascade. Route changes, pane swaps, overlays and status feedback belong to their motion tier.

Do not add a second global duration multiplier for entrance: some keyframes serve both user actions and mount effects.

`SplashScreen` follows `entranceMode()`:

| Mode | Completion |
| --- | --- |
| `non-blocking`, default | Document load and a presented frame; can end mid-signature |
| `blocking` | Signature completes and holds for its defined pause |
| `off` | No entrance or splash |

The server includes the splash only when preferences permit; pre-paint attributes must agree before it shows. Reduced/off tiers do not run Lottie or hold the page behind an empty splash.

Keep the CSS deadline, `INTRO_LATEST_START_MS`, late-takeover handling and `noscript` escape. While covered, the splash blocks pointer input; it stops blocking as soon as it leaves and remains decorative to assistive technology.

Entrance synchronization uses `introAnimationEnabled` and `introAnimationBlocking`; see [settings sync](data-requests.md#settings-synchronization).

## GSAP lifecycle

A changing `useGSAP` dependency list must set `revertOnUpdate: true`, or keep changing values in refs and reduce dependencies. Otherwise listeners, Observers and ScrollTriggers can accumulate.

Preserve the explicit React Compiler boundaries described in [Performance](performance.md#react-compiler).

## Verification

Run `bun run motion:write` after changing spring definitions, then `bun run check`. Inspect built CSS when changing duration utilities.

Use the affected browser checks: `bun run test:motion`, `bun run test:drawer`, `bun run test:tab-press`, or the [Hero verification](hero.md#verification). Verify standard, reduced and off states, custom category isolation and speed changes during an active run.
