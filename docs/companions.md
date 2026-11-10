# Companions

Runtime rules for the mascot and desktop ponies. Source and licensing details belong to [asset provenance](../public/companions/ORIGIN.md).

## Loading and visibility

`CompanionHost` mounts after useful page paint. Companion code must not enter a route's initial document.

`CompanionRuntime` reads the account's selection; `PoniesRuntime`, its frame, stylesheet and catalogue wait for a non-empty selection. Latch loading per account so clearing the selection can fade out and undo can reuse the frame.

`useCompanionPresence` owns visibility:

- `present`: the document is visible.
- `away`: a modal layer, open picture, lightbox, on-screen keyboard, standalone picture page or admin console covers the companions.
- Ordinary navigation and Hero flight are not reasons to recreate the companions.
- Away pauses ponies in place and fades the mascot. `isScreenQuiet` is for interruptions such as announcements, not companion chrome.

The home pill publishes `--app-bottom-chrome` and `data-bottom-chrome`. The mascot follows the pill's arrival with the layout spring after the page handoff, and leaves on FastEffects; it uses the page clock gated by the ambient setting. The pony layer ends above that band.

## Mascot geometry and input

- Keep one stage box in expanded and collapsed states. Animate the plate, figure and collapse control inside it.
- Collapsed: a 56 dp FAB on `surface-container-high`, elevation 3, inner ripple and state layer.
- Keep the collapse control mounted, fading and inert while collapsed. Expansion greetings wait for the figure's transition, bounded by the motion watchdog.
- Hit testing follows `clip-path: path()` on the character outline. Transparent margins belong to the page.
- Outline expansion is 3 px for a mouse and 8 px for touch; use an ellipse while unavailable.
- Keep the collapse control's touch target 4 px clear of the character using `shapeLift`; the hit box has priority where they overlap.
- Hover exit uses `HOVER_GRACE_MS` so gaps within the outline do not restart the greeting.
- The collapse control remains visible for touch and steps aside while the bubble supplies its own close action.

`app/mascot-shape/route.ts` reads the outline server-side because the asset host cannot supply a CORS-safe canvas. Only the run-length outline leaves the handler. Pin the host and image path; reject queries, credentials and redirects, and bound bytes and pixels. Memoize successful answers only. `shapeHead` supplies the bubble anchor.

## Mascot motion and speech

Each transform owns a block box: `.pose`, `.squash`, `.react`. Inline spans do not visibly transform.

The press squashes about the feet on FastSpatial and grounds the hover lift. Use pointer events; touch waits for the tap timeout and quick taps retain `MIN_PRESS_MS`. The hop follows release. Do not add an idle breathing loop.

Speech rules:

- One utterance at a time; the outgoing bubble leaves on FastEffects before the next arrives.
- Hover greets once per visit and cannot replace an open tip. Tap requests another tip.
- Position over the head, within the scroller: 16 px clear of its left edge, no farther right than the art, bubble foot 14 px above the head.
- Avoid the collapse control while keeping the tail on the head.
- Hold for 1.5 s, or Space, to open `彩彩 AI`. Show the countdown after 350 ms.
- Releasing after the countdown appears cancels the hold; it must not become a tip or hop. The meter retains its value while fading.

Use the elevation filter tokens for alpha-shaped silhouettes and bubble tails. Do not apply a box shadow to transparent art margins.

## Desktop pony frame

The original Browser Ponies engine runs in the sandboxed opaque-origin `public/companions/ponies-frame.*` frame.

| Concern | Contract |
| --- | --- |
| Frame scheme | Keep `color-scheme: light` on the iframe so its canvas stays transparent |
| Layer geometry | Follow the content-area box; `z-companions` stays below page chrome |
| Frame geometry | Keep the frame window-sized; send a stage resize after two stable frames |
| Selection | Apply a configuration diff; retained ponies continue where they are |
| Pause | Keep independent `away` and keyboard-focus reasons; queue changes while held |
| Teardown | Hidden document, leaving the standard tier, or account change |
| Empty selection | Keep the frame for `EMPTY_GRACE_MS` so clear and undo retain continuity |
| Return | A pony returning within one minute reuses its saved position |

Do not resize the iframe on each drawer-animation frame. Ponies move with the content area's leading edge; out-of-stage ponies return into bounds.

Speech bubbles follow their sprite after rect reads, remain 8 px within the window, and retain their side while it fits. The `theme` message supplies container, text, corner, type and filter-shadow values because application CSS does not reach the frame.

Settings debounce a sequence of selection edits and keep the local draft until the resource publishes the saved selection. `PresenceList` owns lineup arrivals, removals and placement in the `list` category. Cells stay fixed while a departing pony fades beneath its replacement; restored selections reuse their existing entry.

## Verification

Run `bun run check`. Focused coverage includes `scripts/testMascotPreferences.mjs`, `scripts/testMascotShape.mjs`, `scripts/testPoniesStage.mjs` and `scripts/testPonyChooser.mjs`.

Verify the changed interaction in all relevant motion tiers, with mouse and touch input. Use the [motion system](motion-system.md) for spring roles and watchdogs.
