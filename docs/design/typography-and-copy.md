# Typography, rich text and copy

> Split out of `AGENTS.md`; read on demand. Cross-references such as "see Motion" or "under Shape" name sections listed in the index in `AGENTS.md`.

## Typography

The fifteen M3 roles: `text-display-*`, `text-headline-*`, `text-title-*`, `text-body-*`, `text-label-*`. Never `text-sm`/`text-lg`/`text-[13px]`.

**The Chinese face is the platform's own — except on Windows.** Geist for Latin; a Han glyph falls to `--font-han`, the one half of the stack that depends on the platform (`--font-sans` and `--font-mono` end in it because the theme block is `inline`, so an override of those tokens would miss every font utility). Everywhere but Windows it is the system face: PingFang SC by name, then Noto Sans CJK / Source Han Sans, then `sans-serif`, which Chromium resolves per script under `lang="zh-CN"` (HarmonyOS Sans on HarmonyOS, the system face on Android), and the Noto Sans SC web font only last — so those platforms download nothing. **On Windows the web font leads** (`html[data-os='windows']`, set from the request in `app/layout.tsx` and confirmed by the pre-paint script): the one face every Windows machine has is Microsoft YaHei, and beside Geist it reads as dated — the owner's call, which amends decision 16. YaHei only fills the moment before a slice arrives, and that swap redraws glyphs without moving anything (a Han glyph is one em wide in both, every type role fixes its line height); a slice is fetched once and then comes from cache. Two names are kept out on purpose: PingFang SC from the Windows stack and HarmonyOS Sans from both. On a desktop either exists only when installed by hand, often as a single weight, and the matcher then paints every weight in that one file — a machine with only the Black file rendered all body text black.

**Every one of the fifteen roles declares its own `font-weight` token** (`TypeScaleTokens`; the seven that used to declare none — `display-*`, `headline-*`, `title-l` — were uniformly `WeightRegular`), and `@layer base` gives `h1`–`h6` only a size and a line height. Never add `font-bold`/`font-semibold` on top of a role — it overrides the token — and a role that does not declare its weight inherits one, which is the bug: `text-headline-s` once rendered 700 on `AuthModal`'s `<h1>`, 600 on `Modal`'s `<h2>` (the same dialog-title role at two weights), 400 on a `<span>`, with the 500 `-emphasized` lighter than either. Utilities sit in a later layer than `@layer base`, so declaring it is what makes a role render the same wherever it is put. **M3 headings are Regular** — the heavier line is the `-emphasized` role, a decision at the call site, not a property of the tag.

A bare `font-medium` / `font-semibold` on an element with **no** type role takes its size from whatever the parent happens to be — reach for the role's `-emphasized` twin instead, but check the weight you are actually getting, because the twins are **not** all one value: `label-*` and `title-m`/`title-s` step 500 → **700**, while `display-*`, `headline-*`, `title-l` and `body-*` step 400 → **500**. Tailwind's `font-medium` *is* 500, so on `text-label-l`, whose own token is already 500, it changes nothing at all — which is how three pieces of shared chrome (the home tab bar, `TabBar`, `Pagination`) marked their active item with no weight contrast, only colour.

Never emit two type roles on one element (`text-label-l` plus `text-label-l-emphasized`): `cn` is a plain join, the winner is decided by stylesheet order, not by which you wrote last — put the role inside each branch of the conditional so exactly one is ever applied.

## Rich-text rhythm

Two renderers put user prose on screen — `MarkdownRenderer` and `BBCodeRenderer` — and the rule is that **they emit the same document**, so one set of rules spaces both: `.bbcode-content` and `.rich-text-content` are styled together in globals.css, and neither renderer styles its own output. A direct message goes through neither: it is plain text (see the chat message note under Shape).

The forum's spacing had two causes, neither where it looked: nothing gave a paragraph a margin (Tailwind's preflight zeroes `p`; only `img`/`blockquote`/`pre` were given one back, so consecutive paragraphs touched while the space around a picture came from something else), and BBCode did not *have* paragraphs — every `\n` became a `<br>`, so a "paragraph break" was one line-height that could not agree with an image's margin beside it. `bbcodeToSafeHtml` now splits on blank lines into real `<p>`s, keeps single newlines as `<br>`, and eats the line breaks that end up adjacent to a block element.

The spacing is in `em`, so it scales with the container and a reply's rhythm is automatically tighter than an article's:

| Element      | `margin-block`             |
| ------------ | -------------------------- |
| `p`          | `0.75em`                   |
| `h1`–`h6`    | `1.25em 0.5em`             |
| `ul` / `ol`  | `0.75em` (+1.5em start pad)|
| `li`         | `0.25em`                   |
| img, video, blockquote, pre, table | `1em`    |

Which means **the container has to name a type role**, or the `em` is whatever it inherited: a forum post's body is `body-l` (it is an article) and a reply's is `body-m`. The `> :first-child` / `> :last-child` margin resets stay — they keep the last paragraph from pushing the action row down by a stray line.

**One line-break rule, in both renderers.** A newline is a line break and a blank line a paragraph — in `bbcodeToSafeHtml` and in `MarkdownRenderer` (`remarkHardBreaks`, `lib/markdownBreaks.ts`) — so a text lays out the same whichever renderer it reaches; it used to join lines through Markdown and keep them through BBCode (R6-049). `htmlToBBCode` writes a `<br>` as one newline and a paragraph as two, and a paragraph holding nothing but breaks is dropped (the original front end's `[p][br][/p]`, R6-050). Lists wear their markers (preflight removes them): disc, decimal, a circle when nested, the marker in `on-surface-variant`.

**A colour a writer chose is kept legible, and it is never an inline `color`.** `[color=]` renders `<span data-ink style="--rt-ink:…">` and the stylesheet clamps its lightness against the scheme (relative colour inside `light-dark()`, under `@supports`), so a dark ink picked on a light page stays readable on the dark one; `[bg=]` — the editor's 背景颜色 — is `data-highlight`, the colour at a 35% mix. **A picture** goes through the optimizer when it may fetch it (PicPony uploads, derpicdn's `/img/`; `getImageProps`), holds a placeholder until `complete && naturalWidth > 0` (`data-loading`, then `data-failed` after an error), loads lazily, and outside a link is a real button (`.rt-image`) that opens `PicLightbox` at that picture — inside a link the link takes the press. **A link** to this app (or to picpony.top) routes in place (`lib/richTextLinks.ts`); any other opens a new tab.

**A quote's surface is relative to its host**: `--rt-quote-surface`, defaulting to `surface-container-high`, one step up from a `surface-container-low` host — a reply row, and the thread's post card, which is `Card variant="elevated"` for that and because it is the tone of the list row it grows out of (the quote used to be a lighter hole in a `highest` card, R6-051). A host on a higher step sets the variable. The `<cite>` is `on-surface-variant`: it is text, not a mark.

**The editor writes only what the renderer draws** (`RichTextEditor`): bold, italic, underline, strike, colour, highlight, clear, two heading levels, lists, alignment (`[center]` / `[right]`), links, pictures and tables — no font size, indent, code block, picture width or full-width table, which have no BBCode form and vanished on publish (R6-043). Its row holds the tools that fit, most wanted first, and offers the rest behind 更多, whose expanded form wraps (planned from the row's own width, with a panel tool's arrow counted); `size` is the editing area — `post` 200 / 300px, `reply` 120 / 160px (phone / `sm` up), the fixed 300px without it. Import it with `dynamic()` and `EditorPlaceholder` (`components/RichTextEditorShell.tsx`) as `loading`, which is its footprint; the handle is `focus()`.

## Copy

The UI is Chinese, and the conventions below are the whole of it. Every one had drifted in both directions at once, and the wrong half is invisible to anyone reading a single file.

| | |
| --- | --- |
| Ellipsis | `…`, never `...` (44 sites used ASCII against 2 correct ones) |
| Colon after a Chinese label | `：`, never `: ` |
| Comma inside a Chinese sentence | `，`; half-width `,` only in a value the user types |
| Parentheses in Chinese prose | `（）`; keep `( )` only where the parenthetical is a Latin identifier — `(banAnthro)`, `(GIF/视频)` |
| A Latin run beside CJK | one space: `图片 ID`, `API Key` (all ten no-space sites were in `components/admin/`) |
| Toasts | no `！` — a snackbar is a status report (7 of 291 shouted) |
| Confirm body | `确定要…吗？`, with the formal 此/该 demonstrative; never 这个, never a bracketed 【…】, never `！` |
| Confirm title / button | `确认X` / `确认` (`useConfirm` and `usePrompt` both default to 确认) |
| One verb per operation | 删除 destroys a record, 移除 detaches one, 清空 empties a list (`/history` used two for one button) |
| Success | `已<verb>` (47 sites) rather than `<verb>成功` (28) |
| A finished run's line | `已<verb> N 张`, with `，M 张失败` — from the run's own counts (`runSummary`), in place of 正在…（N / N）; not a live region, since the run's toast says it |
| Failure | `{X}加载失败`, noun first; one string for one condition (`网络错误` had six wordings across 24 sites) — the line under it is the error's own `message`, from the one table in `lib/api/errors.ts` (`网络连接失败，请检查网络后再试`, `请求超时，请稍后再试`, `内容不存在或已被删除` …) |

The confirm register is the instructive one, because the copy split was the *architecture* split seen from the other side: every tab that hand-rolled its own `Modal` dropped the sentence-final 吗, and every tab that used `useConfirm` kept it. Fixing one was fixing the other.
