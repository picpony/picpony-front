# Primitives

Compose the existing components; do not copy their class strings or interaction logic into pages. Paths below are relative to the repository root.

## Selection index

### Fields and choices

| Need | Use |
| --- | --- |
| Button | `components/Button.tsx`; commands default to `type="button"` |
| Navigation action | `ButtonLink`; renders a link with the shared button slots and `scroll={false}` |
| Text field / textarea | `Input`, `Textarea`, `Field` from `components/Input.tsx` |
| Search or filter | `SearchInput`: 40 dp `filter` by default, 56 dp standalone `search` |
| Arbitrary badge colour | `ColorSwatch`; shared `ColorPicker` with `hues="mono"` |
| Theme selection | `PaletteSwatches`, `ColorPicker`, `ImagePalettePicker` |
| Checkbox / radio | `Checkbox`, `Radio` |
| Slider | `Slider` |
| One-time code | `CodeInput` |
| On/off setting | `ToggleSwitch`; `layout="row"` in a settings list |
| Value dropdown | `Select`; `label` selects the outlined form slot |
| Text suggestions | `useCombobox` with `Popover` and `suggestionRow` |
| Selection tick | `CheckGlyph` |
| File drop | `DropZone` with `accept` and rejection handling |

### Surfaces and navigation

| Need | Use |
| --- | --- |
| Card / section | `Card`; `interactive` renders a button, `as="a"` an anchor |
| Command menu | `Menu` |
| Floating panel | `Popover` |
| Dialog | `Modal`; actions use its `footer` |
| Bottom sheet | `Sheet`; `onExited` for work after departure |
| Full-height docked surface | `SidePanel` |
| Confirm / one-value prompt | `useConfirm` / `usePrompt`; `rows: 1` uses Input and Enter confirms |
| Tabs | `Tabs` with `underline`, `pill` or `rail`; `TabPanes` / `TabPane` for content |
| Section heading | `SectionHeading`; `level="group"` for subgroups, `aside` for counts |
| Icon-only control | `IconButton` |
| Tooltip | Automatic on IconButton; `useTooltip` elsewhere |
| Hover-revealed caption/control | `hover-reveal` under its group |
| Account-required screen | `SignInRequired` after session readiness |
| Overlay behaviour | `lib/overlay.ts`; history through `useHistoryLayer` |

### Status, lists and media

| Need | Use |
| --- | --- |
| Tag control | `Chip` |
| Text/status mark | `Badge`; `tone="media"` over a photograph |
| Earned badge | `UserBadge`, `BadgeWall`, `BadgeEquipDialog`; parsing in `lib/userBadges.ts` |
| Thumbnail corner mark | `MediaBadge`; `corner` owns position and concentric shape |
| Unread count / user role | `CountBadge` / `RoleBadge` |
| Image collection | `MasonryGrid` and `ImageGridSkeleton` |
| Image batch selection | `MasonryGrid selection` |
| Empty / failed state | `EmptyState` / `ErrorRetry`; `statusViewBox` for matching placeholders |
| Route fallback | `PageFallback` from `components/ImageDetailSlot.tsx` |
| Loading shapes | `Skeleton`, `SkeletonCircle`, row/grid-specific skeletons |
| Progress value | `ProgressBar` |
| Action progress | `Spinner` or the button's loading state |
| Record table | `DataTable` |
| List entries added/removed | `PresenceList`; one departing block uses `PresenceBlock` |
| Content height | `FollowHeight`; replacement content uses the existing `SizeSwap` |
| Expand/collapse | `Collapse` |
| Directional content swap | `SwapContent` |
| Horizontal row edge fade | `useScrollFade` |
| Chat message | `ChatBubble` |
| Avatar | `Avatar` |
| Floating batch/cart actions | `SelectionBar` / `CartBar` |
| Transient status | `showToast`; `action` supplies its interactive part |

### Shared operations

| Need | Use |
| --- | --- |
| Copy text / random ID / clamp | `copyText`, `randomId`, `clamp` / `clamp01` in `lib/utils.ts` |
| Share link | `createShareLink` in `lib/api/share.ts`; long-link fallback |
| Share to a contact | `useShareToContact`; render its `shareDialog` once |
| User lookup | `useUserSearch` |
| Tag subscription | `SubscribeButton`; addresses through `subscriptionHref` |
| Session rendering | `useSession`; gate login prompts on `ready` |
| Event-time session read / checked update | `readUserInfo`, `readToken`, `updateUserInfo` |
| Date/time / current clock | `lib/format.ts`; `useNow()` for relative time |
| Day grouping | `beijingDateKey`, not the displayed day label |
| Exact / signed count | `formatExactCount` / `formatSignedCount` |
| Admin numeric field | `figureText` / `figureField`; absent means `—` or empty |
| Error detail and retry | `apiErrorMessage`, `isRetryable`, `isNotFound` |
| Gender/race values | `lib/profileFields.ts` |
| Asset/avatar URL | `getAssetUrl` / `getAvatarUrl` |
| Admin API | Named adapter exports, or `* as adminApi from '@/lib/api/admin'` in admin panels |
| Scroll to content | `scrollAppToTop` / `scrollAppToElement` |
| Motion | Existing spring APIs; [Component motion](../motion.md) |
| General mount entrance | `Reveal`, subject to the restrictions below |

Do not use browser confirm/prompt, naked clipboard writes, secure-context-only UUID generation, copied option lists or the retired runtime API aggregate.

## Buttons, icons and semantics

Button variants are `filled`, `tonal`, `surface`, `accent`, `text`, `on-fill`, `danger`, `danger-text`, `success` and `warning`. Semantic fills use the shared `*-fill` pairs. There is no outlined Button variant; secondary actions use the existing tonal/surface/text choices.

`ButtonLink` shares Button's icon slots, responsive labels, inner ripple host and pressed shape. Pass icons through `icon` / `trailingIcon`; do not copy the button recipe onto navigation links. External links retain their `target` / `rel` and use `prefetch={false}`. Text links in prose keep the prose-link treatment.

`Button variant="on-fill"` supplies snackbar actions with `on-fill` ink and an inset contrasting focus ring. Do not override a text button's colour at the call site.

IconButton owns its glyph size and tooltip:

- `media` over a photograph; `on-primary` on the app bar.
- `quiet` for pinned page controls: neutral circle at rest, tonal square under a pointer.
- `outlined` remains available for an off toggle.
- `dismiss` supplies dismissal rotation.
- `shape="square"` responds to an enclosing frame.
- `toggle` reports both true and false `aria-pressed`; its accessible label stays stable. `selected` alone is visual state.
- Corner morphs use DefaultEffects, rotation FastSpatial and material FastEffects through `transition-icon-button`.

Pressed corners take precedence over hover and remain unchanged when a held pointer leaves or re-enters. IconButton uses 8 dp at its 32 / 40 dp steps and 12 dp at 56 dp. An explicit corner class suppresses both hover and pressed shape changes, including for `quiet`.

A loading Button/IconButton keeps its footprint, material and focus. It uses `aria-disabled`, `aria-busy` and blocked activation; native `disabled` is for unavailable controls. Loading wins when both props are set. Spinners inherit the intended ink without moving the label.

Spinner takes `tone="primary"`, `"on-primary"` or `"inherit"`. Its primary ink is `primary-ink`, not the pale primary fill.

Use `ICON` for standalone icons. Button and Badge size their own icon slots. Delete uses `MdDeleteOutline`; repeated row deletes use `danger-quiet`. Navigation rows use the outlined glyph at rest and the filled glyph on the active row (`MdOutlineHome` / `MdHome`). Pick a pair whose paths actually differ: `storefront`, `edit_note` and `rss_feed` are ink-identical in both Material Icons sets, and the magnifier has no filled form.

Never nest interactive elements. Spoiler toggles, retry buttons and drop-zone targets are siblings of the primary link/control. A pointer convenience handler still needs a real keyboard control.

DropZone sends rejected types to `onReject`, or to `onFile` for caller validation when no rejection handler exists. It must not silently discard the drop. Its filled state is quiet; brand material is reserved for dragging.

Name a section from its visible heading with `aria-labelledby`. When `SectionHeading` has actions, put the naming ID on the text span; its own ID belongs to the wrapper.

## Fields

| Role | Treatment |
| --- | --- |
| Named form value | Labelled, outlined, 56 dp |
| Immediate search/filter input | Unlabelled, filled |
| Standalone search | Pill, 56 dp |
| Dense filter | Unlabelled 40 dp; one 32 dp trailing action |

The shared `.m3-field` shell owns geometry. See [Layout](layout.md#control-heights) and [Surfaces](surfaces.md#shape) for sizes and corners.

- `FieldLabel` supplies the visible label and matching fieldset/legend notch for Input, Textarea and labelled Select.
- Label/legend font size, weight and tracking stay coordinated. Remove the fieldset's negative inset when there is no legend.
- A labelled empty field still needs a placeholder so `:placeholder-shown` can match.
- Trailing actions participate in flow; the label's width excludes their column. Do not overlay them on long labels.
- Inset is derived from field and control heights. Only the primary action in a search slot gets a filled container.
- Small typed fields use 16 px text under coarse pointers to prevent iOS focus zoom. Do not disable browser zoom instead.
- Password fields use the shared visibility toggle, with the duplicate native eye suppressed.
- A one-line unlabelled Textarea uses padding derived from the shared line height and 56 dp field height.
- Select keeps the intrinsic width of its widest option, not only its selected value.
- `useCombobox` owns keyboard handling. Do not preselect the first suggestion and turn Enter into an unintended selection.

Outlined focus thickens the existing boundary; filled focus uses the shared ring. Invalid-state precedence is specified in [Colour / Focus](colour.md#focus).

### Search toolbar

Keep the 40 dp field-toolbar family together: filled fields, Select and `Button variant="surface"`. Expansion uses a disclosure arrow and `aria-expanded` / `aria-controls`, not a selected Chip.

The toolbar stays between the search field and results in success, empty and failure states. Sort/direction and advanced/reset form wrapping groups. `Select shape="pill"` belongs to this toolbar.

`SemanticLine` keeps one row height across pending, tags and fallback states. Use its sentence shimmer and `SwapContent`, not a fabricated progress percentage. Query parsing rules belong to [Data requests](../data-requests.md#search-queries).

## Cards, badges and avatars

- `Card interactive` is a button; `Card as="a"` does not receive button-only attributes.
- Badge is a mark; Chip is a control. An input Chip with only `onRemove` has a text label and one dismiss control named with the operation and item label, following the [copy contract](typography-and-copy.md#copy).
- Avatar supports 32 / 40 / 48 / 56 and responsive `hero`. Use `unoptimized` for the documented native no-referrer path; `priority` is for the profile's largest paint.
- `Skeleton` yields its default radius when explicitly supplied. Badge yields its default maximum width.
- `ProgressBar` and `Field` yield their full-width default through supported width overrides; a breakpoint-only Field width retains the mobile default.

`cn` is a plain join. Do not rely on class order to resolve two conflicting utilities.

## Tabs and entrances

Tabs own ARIA relationships, roving focus, keyboard navigation and selected-tab visibility. Use manual activation when choosing a panel starts a read. A scrolling rail scrolls itself, never the page.

A `rail` tab passes the outlined mark as `icon` and the filled one as `activeIcon`; the selected tab swaps to the filled form, the same rest/active pair navigation rows use. Where Material Icons draws the pair identically, omit `activeIcon` and let the selected container, the emphasized label and the ink carry the state.

Account-only tabs are omitted from both Tabs and TabPanes when signed out; a public screen does not need a sign-in wall in each missing tab. A protected screen uses SignInRequired instead of opening login on arrival.

Pane lifecycle, address writes and motion belong to [Transitions](../transitions.md#tab-state-and-history).

`Reveal` runs on client mount, not over already painted SSR content. Do not place it:

- Above a gallery card whose geometry Hero measures.
- Inside a leaning or swapping tab pane.
- Over content with an existing entrance cascade.
- Under a route entrance that already owns the same pixels.

There is no general scroll-driven reveal helper. Use the existing entrance ownership instead of adding another animation clock.

## Overlays and history

`Menu focusOnOpen={false}` supports contextual actions without moving text focus. Keyboard
navigation still moves focus once it enters the menu. `handleRef` exposes the shared popover's
frame and scroller for focus ownership checks; ordinary menus keep their default initial focus.
Menu owns a 24 dp leading icon slot and SVG size; icon size must not inherit its label's font size.

Use the overlay hooks for focus, scroll locks and dismissal. A normal modal makes the app root inert; `aria-hidden` alone is insufficient.

- Modal scrim and panel are siblings so opacity does not multiply.
- Reverse from the current animated pose; a drag cancels settling before taking over.
- Only one scrim is visible across a handoff between dialogs.
- A question that destroys something tints the scrim red: `Modal danger`, or `tone: 'danger'` on `useConfirm`. The veil carries a slow diagonal hatch that the reduced tier stops and the off tier removes; the tint is opt-in, so a delete confirmation names the tone, and every other dialog keeps the neutral veil. An action the user can undo — logging out, unbinding a key — answers with `filled`, never `danger`.
- Keep exiting surfaces mounted but excluded from interaction.
- A gesture ends on release, cancellation, external state changes, disablement or unmount. Cleanup must restore React's state.
- Use Modal's wrapping `footer`; `mr-auto` supplies a leading action. Do not duplicate a footer in the scrolling body.
- Keep the header/body gap at 8 + 8 dp so a floating field label is not clipped.
- Use `Modal returnFocus` for a stable focus destination when its opener may become disabled
  or be replaced. The overlay still preserves a newer focus choice outside the departing panel.

Modal, Sheet, confirm/prompt and lightbox use one same-URL history layer. Back closes only the topmost dismissible layer. Closing another way unwinds its entry; navigation unwinds layers before writing the new page. Stale entries are skipped. Non-dismissible surfaces consume Back.

Hero detail is not an ordinary history layer. Its ladder owns the entries; consumers that traverse history first await `settleHistoryLayers()`.

### Image-detail exception

The detail overlay blocks its background list while keeping app-bar and docked-drawer chrome available. It is a non-modal dialog with `containFocus: false`, not an app-wide `aria-modal`.

Covered tab stops are skipped before Tab's default action through `skipCoveredTabStops`. Do not replace that gallery performance exception with a late focus redirect.

The skip link targets the detail. Reselecting the background destination closes it; navigating elsewhere retains a return path to it. `detailBackground.ts` preserves the original background per history entry, including its fallback without the Navigation API.

## Loading and failure

Use the destination's geometry: skeleton rows, ImageGridSkeleton or a card placeholder. A spinner reports an action, not an entire page.

| Enclosure | StatusView preset |
| --- | --- |
| Page below a header | `size="page"` |
| Pane or bounded well | `size="pane"` |
| Small inline result | `size="inline"`, text by default |
| Entire missing/failed screen | `fill`, with the page's h1 |

A fill state uses a continuous flex-column chain and no competing half-viewport minimum. A list's empty state does not use fill.

Use `entrance={false}` when a surrounding swap already animates the result. Do not delay a heading that must receive focus.

`PageFallback` prevents a route-shaped `loading.tsx` from appearing in the parallel image-detail slot. The detail supplies its own loading state.

An image is loaded only when `complete && naturalWidth > 0`. Recompute that boolean on every `displaySrc` change, including clearing it. A failed image retains a failure plate/retry; a paused shimmer still paints its placeholder.

`useTagNames` distinguishes unresolved `undefined`, no translation `null` and a translated name. Keep a correctly typed placeholder, then reveal through `NameFade`; do not flash the raw tag as a temporary translation.

## Lists, grids and presence

MasonryGrid owns aspect ratios, column placement, gaps, image links, list semantics, comment-count reads and image sequence activation.

- Reuse it for uploads, favourites and subscription galleries. Profile uploads are a Derpibooru uploader search, not a PicPony uploads action.
- Use `createPagedSequence` for cross-page previous/next and return reveal.
- Keep one image-ID-keyed flat list across responsive column counts.
- In a swapping tab, disable grid/skeleton entrance and retain the read key after first selection.
- Skeleton count matches the requested page size and uses the shared aspect mix.
- `PagedImages` reserves placeholder layout before its delayed visibility.
- A geometry-only record uses `ImagePreview`; do not invent vote counts.
- Name image cards by `describeImage`, not upload filenames.
- The grid reads `siteCommentCounts` once per page without delaying cards; pass `siteComments` when already available.
- Spoiler covers are opaque controls beside the link, keeping it inert until revealed.
- Retry controls are siblings of the link.
- A page of the same list may be deferred; a different `listKey` replaces old rows immediately.
- Chunk rendering must still fill the current viewport before paint, including a restored deep offset.
- Slots keep their own aspect height and size/layout containment. Do not add below-image content outside that box or paint-contain a slot needed by an entrance.
- Pause off-screen shimmer; do not hide its placeholder.

Batch mode keeps geometry and Hero paths intact. Space toggles, Shift extends, and Escape/Back leaves the selection layer. SelectionBar/CartBar retain their hidden state and spacer through exit.

Content inserted above masonry must compensate only actual offset movement; browser scroll anchoring is not reliable for absolute slots. Use `FailedTurnHold` for the existing failed-page-turn case. Background profiles read their own route props, not the foreground image's `useParams()`.

`Collapse` owns its layout and opacity transitions on the `list` category. Closing always hides and inerts its contents; an explicit `inert` or `aria-hidden` also applies while open. Its child controls retain their own feedback category.

### Removal and focus

PresenceList snapshots focus before the removal commit on every tier.

- Focus from a removed entry moves to the equivalent control in the next entry, then previous, then `fallbackFocus`.
- Disabled controls still count when matching control positions.
- If focus is already lost, claim a user-requested removal with `claimFocus([key])`; release the claim if removal fails.
- Passive refresh removals move focus only when it was inside the removed entry.
- Preserve newer user focus over later dialog restoration.
- PresenceBlock also accepts a fallback. Last-row removal, clear and undo must provide their landing in the relevant commit.

DataTable owns its subgrid presence. It shares one column grid, switches to labelled pairs by container width, keeps departing rows in flow and holds an auto-track width until list replacement. Pass `listKey` from `usePagedRows` / `useShownListKey` so paging replaces rows rather than treating them as individual deletions.

## Tooltips and action feedback

IconButton derives its tooltip from its accessible label; other elements use `useTooltip`. Keep one bubble, hoverable under a pointer, and preserve the touch long-press cancellation/click-suppression rules. Links retain their native long-press menu.

The first portal appearance uses `@starting-style`; later transitions reverse from the current pose. Native `title` is only a supplementary hint on text already shown, such as a truncated name.

Press feedback is `data-ripple` plus `state-layer`. Touch waits for the tap timeout, quick taps flush it and scrolling cancels it. Use an inner ripple host where clipping would otherwise remove the hit region.

The about-page developer-guide wordmark is the documented pointer-only hidden entry. Do not turn that exception into a pattern for ordinary controls.

## Dates, subscriptions and uncertain writes

`lib/format.ts` reads and prints Beijing time with fixed `zh-CN`. UTC exceptions use `parseBackendUtcTime`: history `view_time` / `last_view_time`, glossary-history `created_at` and maintenance-password `updated_at`. Unspecified epoch units use the existing magnitude parser. Relative displays use `useNow()`.

SubscribeButton resolves aliases and the live Derpibooru count before saving. Confirmed share/favourite operations expire the account's task resource; do not increment task progress locally.

Unknown admin-write outcomes use `CatalogOutcomeUnknown` or `WriteOutcomeUnknown`, held by `useCatalogMutation` and `MutationResult`. This includes lost answers, non-501 server failures and unreadable successful bodies. Keep an unresolved-outcome status until the user acknowledges checking the records, retain announcement/focus and then return to the recorded origin. Never automatically repeat the write.

## Verification

Run `bun run check` and the affected browser suites:

| Change | Command |
| --- | --- |
| Primitive behaviour | `bun run test:primitives` |
| Presence and focus | `bun run test:presence` |
| Drawer | `bun run test:drawer` |
| Tab press/cancellation | `bun run test:tab-press` |
| Dialogs and layers | `bun run test:overlays` |
| Real screen composition | `bun run test:ui` |

Use [CSS verification](../css-traps.md) after class changes. Image-detail changes also follow [Hero verification](../hero.md#verification).
