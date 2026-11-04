# Scrolling

Scroll ownership, paging and image delivery. Transition mechanics are in [Transitions](transitions.md); flight details are in [Hero engine](hero.md).

## Scroll containers

The body is `overflow: hidden`. The page scroller is `<main class="app-scroller">` in `AppLayout`, reached through `getAppScroller()`.

Use `scrollAppToTop` / `scrollAppToElement`, not `window.scrollTo`. Scroller children use `min-h-full`, not `min-h-dvh`.

| Container | Utility |
| --- | --- |
| Page-level scroller | `.main-scrollbar`, reserved gutter |
| Overlay scroller | `.popover-scrollbar`, no gutter |
| Horizontal chips or tabs | `.scrollbar-hide` |

## Scroll ownership

`lib/scrollMemory.ts` mounts once as `RouteScrollMemory`. Every router push/replace passes `scroll: false`; every Link passes `scroll={false}`.

| Change | Owner and result |
| --- | --- |
| New pathname | Route memory starts at zero |
| Back / Forward | Restore that history entry's offset |
| Page turn | Pagination scrolls to its anchor using the distance-based law |
| Tab switch | `startTabTransition` / `TabPanesDriver` |
| Back / Forward between search queries | Search restores after the matching results render |
| Image detail | Hero owns the detail and its background handoff |

The route owner depends on pathname, not query changes. Search traversal is detected from the rendered entry rather than a racing `popstate` listener.

An overlay closes onto the background node's current offset, including deliberate sequence repositioning. A remounted page still restores its entry offset.

Offsets use `window.navigation.currentEntry.key`, with the documented URL fallback. Do not merge private scroll keys into App Router's `history.state`. Next may retain an earlier scroll target even after a later `scroll: false`; its handler is not the app's restoration owner.

## Paging

- `Pagination` finds `[data-pagination-anchor]` through `closest()`; the marker must be an ancestor, not a sibling.
- An overlay's scrolling body also carries `data-app-scroll-container`. Modal and Sheet already supply it.
- Several pagers can share an enclosing anchor.
- Without `totalPages`, show only the current page and a possible next page.
- Retain rows during a page read with scoped `keepPrevious`; see [Data requests](data-requests.md#resource-snapshots).

Programmatic scrolling follows the square root of travel over the shared 360–1100 ms range, using the tab-strip response. Do not add a fixed-duration argument to `runScroll`. The off tier still positions immediately.

## Grid continuity

`StaggerGrid` is a sibling after its target grid and latches once per mount. Page turns and breakpoint reflows do not replay the entrance.

A cold load must not hide already painted SSR cards when the motion engine arrives. Decide engine availability once at mount and skip cascade when the route already owns entrance.

`FadeInImage` cross-fades its placeholder on the image's clock and removes it only after the slowest-speed watchdog. No visible card may become blank during a page turn.

## Tab offsets

Tab memory is keyed by pathname, tab-group position and tab name. Traversal retains it, a push clears that pathname, and a session change clears all tab offsets.

- Move the scroller only when the panel is effectively the page.
- If shared chrome above the panel exceeds `TAB_SHARED_CHROME_PX` (64 dp), keep the offset except for the settled-height clamp.
- A panel-page tab with no remembered offset uses zero; it must not inherit the previous tab's bottom.
- Record the outgoing offset before React commits, including reactive switches reached through navigation.
- The off tier uses the same positioning rules. `applyInstantTabScroll` is only the pre-engine fallback.
- During transit the panel keeps `max(H_out, H_in)`; clamp against the settled height and hide the footer until the run settles.

## Image delivery and SSR

`COOKIE_KEYS.imageLine` mirrors the resolved image line. `ImageLineProvider` makes server markup and the client's first attempt agree. Later retries read live policy; a stale cookie may cost one corrected attempt.

| Image | Delivery |
| --- | --- |
| Still gallery card | Raw Derpibooru URL through the optimizer once, then the visitor's browser-direct line with backoff |
| Animated gallery card | Bypass optimizer; `pickRendition` uses card width at up to 1.5× density |
| Detail final | Original CDN rendition via `shouldBypassImageOptimizer(true)` |

Do not send line-wrapped open proxy URLs into Next's optimizer. `MASONRY_CARD_SIZES` comes from the actual drawer, gutters and column cap. Development bypasses optimization, so verify production too.

## Flight sharpness

The flight paints the card's decoded bitmap into a canvas. The underlying detail image is not the flight's resolution.

- Capture decoded pixels using `getMediaPixelSize`, not density-corrected `naturalWidth`.
- Launch from the available card frame. Do not wait for a sharper preflight source.
- A decoded still-image final may repaint the flyer upward in resolution through `repaintHeroFrame`; geometry remains based on `flight.base`.
- Do not upgrade an animated source to frame zero.
- `warmImageHeroSource` / `warmedDetailFrames` are for previous/next steps only.
- A slow final can leave the opening flight on the card bitmap until landing. Do not enlarge every gallery download to eliminate that short-lived limit.

## Verification

| Command | Checks |
| --- | --- |
| `bun run net:scroll` | No empty grid frame during paging |
| `bun run net:tabs` | Tab height, remembered offsets and first-visit zero |
| `bun run net:tabnav` | Tab → detail → Back |
| `bun run perf:pageturn` | No blank in-view card or late hiding of painted cards |
| `bun run perf:sharpness:assert` | Controlled-CDN flyer upgrade before landing |

Measure image work at DPR 2. The sharpness probe must sample `.image-hero-flyer-image`, not the underlying detail layer.

`--fake-cdn` intercepts browser CDN requests; the optimizer still fetches on the server. Throttled fixture responses must delay fulfilment by payload size: CDP network emulation does not throttle a fulfilled response. Uncontrolled real-network sharpness runs report measurements without asserting the upgrade.
