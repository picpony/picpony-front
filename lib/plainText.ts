/**
 * A Derpibooru description as plain text — for a one-line teaser (the 近日推荐 banner), a
 * preview or an accessible name, anywhere the markup cannot be rendered.
 *
 * Philomena writes Markdown (and older rows still carry Textile), and a teaser that shows the
 * source reads as a rendering bug: `**bold**`, `[a link](https://…)`, `> quoted`, `||spoiler||`,
 * `\#tag`. The banner used to strip three hard-coded hashtags and `> ` from the first line and
 * printed the rest raw (R4-054). This removes the markup and keeps the words.
 *
 * Spoilered text is dropped rather than unwrapped: a teaser has no reveal, so printing it would
 * spoil it. Code blocks are dropped too; inline code keeps its text. Plain module.
 */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')
    .replace(/&#(\d+);/g, (_, code: string) => {
      const n = Number(code);
      return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    });
}

/** Strips the inline markup of one line of prose. */
function stripInline(line: string): string {
  return (
    line
      // Escaped characters are placeholders first, so the rules below cannot eat them.
      .replace(/\\([\\`*_{}[\]()#+\-.!|>~"@=])/g, (_, ch: string) => `\u0000${ch.charCodeAt(0)}\u0000`)
      // Spoilers: Markdown `||…||` and the Textile/BBCode `[spoiler]…[/spoiler]`.
      .replace(/\|\|[\s\S]*?\|\|/g, '')
      .replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '')
      // Images keep their alt text; links keep their text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // Textile links (`"text":url`) and images (`!url!`).
      .replace(/"([^"]+)":\S+/g, '$1')
      .replace(/!\S+?\.(?:png|jpe?g|gif|webp|svg)!/gi, '')
      // Inline code keeps its text.
      .replace(/`([^`]*)`/g, '$1')
      // Emphasis, strike, underline — only as a wrapper, never inside a word.
      .replace(/(\*\*|__|~~|==)(?=\S)([\s\S]*?\S)\1/g, '$2')
      .replace(/(^|[^\p{L}\p{N}])([*_+@])(?=\S)([^*_+@\n]*?\S)\2(?![\p{L}\p{N}])/gu, '$1$3')
      .replace(/\u0000(\d+)\u0000/g, (_, code: string) => String.fromCharCode(Number(code)))
  );
}

/** Line-level markup: headings, quotes, list markers, rules. */
function stripBlock(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*(?:>\s?)+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/, '')
    .replace(/^\s*(?:bq|h[1-6]|p)\.\s+/i, '');
}

/** Drops a run of social hashtags at either end — the tail of a description copied from a post. */
function trimHashtags(text: string): string {
  return text
    .replace(/(?:^|\s)(?:#[\p{L}\p{N}_]+\s*)+$/u, '')
    .replace(/^(?:#[\p{L}\p{N}_]+\s+)+/u, '')
    .trim();
}

/**
 * The first paragraph of `markup` with something readable in it, as plain text, cut to `max`
 * characters (with an ellipsis when cut). `''` when there is nothing to say.
 */
export function descriptionTeaser(markup: string | null | undefined, max = 150): string {
  if (!markup) return '';
  const source = markup.replace(/\r\n?/g, '\n').replace(/```[\s\S]*?(?:```|$)/g, '\n');
  for (const paragraph of source.split(/\n\s*\n/)) {
    const text = trimHashtags(
      decodeEntities(
        paragraph
          .split('\n')
          .map((line) => stripInline(stripBlock(line)))
          .join(' '),
      )
        .replace(/\s+/g, ' ')
        .trim(),
    );
    if (!text) continue;
    const chars = Array.from(text);
    return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : text;
  }
  return '';
}
