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

/**
 * Matches a sanitizer entity cut off mid-token at the end of a fixed-length preview (such as
 * `/me/contacts`'s 120-character `preview` when `truncated` is true): `&`, `&a`, `&am`, `&amp`,
 * `&lt`, `&gt`, `&quo`, `&nbs`, `&#3`, `&#x2`, etc., without touching complete `;`-terminated
 * entities or non-entity tails like `R&D`.
 */
const TRUNCATED_ENTITY_TAIL =
  /&(?:a(?:m(?:p)?)?|l(?:t)?|g(?:t)?|q(?:u(?:o(?:t)?)?)?|n(?:b(?:s(?:p)?)?)?|#(?:3(?:9)?|x(?:2(?:7)?)?)?)?$/;

/** Drops an incomplete trailing sanitizer entity from a fixed-length truncated preview. */
export function stripTruncatedSanitizedEntity(text: string): string {
  return text.includes('&') ? text.replace(TRUNCATED_ENTITY_TAIL, '') : text;
}

export function decodeSanitizedText(text: string, options?: { truncated?: boolean }): string {
  const input = options?.truncated ? stripTruncatedSanitizedEntity(text) : text;
  return input.includes('&') ? input.replace(ENTITY, (whole, name: string) => CHARACTER[name] ?? whole) : input;
}
