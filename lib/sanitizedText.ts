/**
 * The Rust backend runs every message, forum post and comment body through its HTML sanitizer
 * (`src/sanitize.rs` `html`, ammonia) before storing it — the same text whether it is BBCode or
 * plain words. Re-serialising escapes the text: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, a
 * no-break space → `&nbsp;` (and `"` → `&quot;` inside an attribute). The front end renders these
 * bodies as plain text or BBCode, which escape on their own, so the entities are turned back into
 * their characters once, here, before that. Exactly the set the serializer writes, in one pass —
 * so `&amp;lt;` (a literal `&lt;` the author typed) comes back as `&lt;`, never `<`.
 */
const ENTITY = /&(amp|lt|gt|quot|nbsp|#39|#x27);/g;
const CHARACTER: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: '\u00a0',
  '#39': "'",
  '#x27': "'",
};

export function decodeSanitizedText(text: string): string {
  return text.includes('&') ? text.replace(ENTITY, (whole, name: string) => CHARACTER[name] ?? whole) : text;
}
