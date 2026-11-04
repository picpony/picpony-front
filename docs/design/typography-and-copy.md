# Typography and copy

Type roles, rendered rich text and Chinese UI wording. Controls are specified in [Primitives](primitives.md).

## Typography

Use the fifteen M3 roles: `text-display-*`, `text-headline-*`, `text-title-*`, `text-body-*` and `text-label-*`. Do not use generic text sizes or add a separate font-weight utility over a role.

Each role owns its weight, size, tracking and line height. Render exactly one role per element; `cn` joins classes without resolving conflicts.

| Role family | Regular → emphasized weight |
| --- | --- |
| `label-*`, `title-m`, `title-s` | 500 → 700 |
| `display-*`, `headline-*`, `title-l`, `body-*` | 400 → 500 |

Headings use their role's normal weight unless the call site explicitly chooses its emphasized form. Semantic heading level does not set the visual role.

### Font stack

Geist supplies Latin glyphs; `--font-han` supplies Han glyphs in both sans and monospace stacks.

- Outside Windows, prefer system fonts: PingFang SC, Noto Sans CJK / Source Han Sans, then script-aware sans-serif. The Noto Sans SC web font is last.
- On Windows, `html[data-os='windows']` puts the web font first, with Microsoft YaHei as the loading fallback.
- SSR and the pre-paint script must agree on the OS marker.
- Keep PingFang SC out of the Windows stack and do not explicitly prefer HarmonyOS Sans: manually installed single-weight files can override the entire weight range.

## Rich-text rhythm

`MarkdownRenderer` and `BBCodeRenderer` share stylesheet rules through `.rich-text-content` and `.bbcode-content`. Renderers do not independently style their output.

PicPony posts, replies and comments use explicit `format="bbcode"`. Derpibooru Markdown uses the Markdown path. Direct messages use the separate plain-text model described in [Surfaces](surfaces.md#chat-content).

A newline is a line break; a blank line starts a paragraph. `bbcodeToSafeHtml`, `remarkHardBreaks` and `htmlToBBCode` preserve that round trip. Drop break-only paragraphs and line breaks adjacent to block boundaries.

| Element | Block margin |
| --- | --- |
| Paragraph | `0.75em` |
| Heading | `1.25em 0.5em` |
| List | `0.75em`, plus `1.5em` start padding |
| List item | `0.25em` |
| Image, video, quote, code block, table | `1em` |

The host names a type role: post body `body-l`, reply `body-m`. Keep first/last-child margin resets. Restore list markers removed by preflight; use `on-surface-variant` for them.

### Colour, media and links

- Writer-selected colour uses `data-ink` and `--rt-ink`, with stylesheet lightness adjustment under `@supports`; never direct inline `color`.
- Background highlights use `data-highlight` at the shared mix.
- Supported uploaded images use the optimizer, load lazily and retain a placeholder until `complete && naturalWidth > 0`.
- An image outside a link is a real `.rt-image` button opening `PicLightbox`. Inside a link, the link owns activation.
- App/PicPony links route through `lib/richTextLinks.ts`; external links open separately.
- Quote colour is relative to the host through `--rt-quote-surface`. The default is `surface-container-high`; a higher host supplies its own value. Attribution text uses `on-surface-variant`.

### Editor

`RichTextEditor` exposes only formats the renderer supports: emphasis, colour/highlight, two heading levels, lists, alignment, links, images and tables.

Do not restore unsupported font size, indent, code-block, image-width or full-width-table controls. The toolbar exposes an overflow menu according to its own width.

Import through `dynamic()` with `EditorPlaceholder` from `RichTextEditorShell`. The public handle is `focus()`; `size` selects the post/reply editing area.

## Copy

The product UI is Chinese. These rules apply to strings, including loading, confirmation and error states.

| Concern | Rule |
| --- | --- |
| Ellipsis | `…`, not `...` |
| Chinese punctuation | `：`, `，`, `（）`; preserve Latin identifier syntax where needed |
| Latin beside CJK | One space: `图片 ID`, `API Key` |
| Toast | No final `！` |
| Confirmation body | `确定要…吗？`, using the formal demonstratives `此` / `该`; no decorative brackets |
| Confirmation title / button | `确认X` / `确认` |
| Destructive verbs | `删除` destroys a record; `移除` detaches; `清空` empties |
| Success | `已<verb>` |
| Completed batch | `已<verb> N 张`, optionally `，M 张失败`, from `runSummary` |
| Load failure title | `{X}加载失败` |
| Item removal label | `移除 {label}` |
| Error detail / retry | `lib/api/errors.ts`, using `apiErrorMessage` and retry classification |

Do not duplicate a completed batch's toast in a second live region. Use `useConfirm` / `usePrompt` instead of reimplementing their wording and behaviour.

## Verification

Run `bun run check`. Rich-text changes use `scripts/testRichText.mjs` and `scripts/testSanitizeHtml.mjs`; renderer geometry and font changes also need browser inspection in both schemes. Follow [CSS verification](../css-traps.md) for stylesheet changes.
