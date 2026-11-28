/**
 * Assistant text formatting and incremental Markdown block splitting.
 *
 * The backend persona may separate conversational beats with `||`; this helper turns those into
 * paragraph breaks ONLY outside fenced code blocks, inline code spans, and GFM table rows so
 * expressions like `a || b`, search queries in user bubbles, and Markdown tables stay intact.
 */

const FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/;

function replaceOutsideInlineCode(line: string): string {
  if (!line.includes('||')) return line;
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let ticks = 0;
      while (i + ticks < line.length && line[i + ticks] === '`') ticks += 1;
      const delim = '`'.repeat(ticks);
      const close = line.indexOf(delim, i + ticks);
      if (close >= 0) {
        out += line.slice(i, close + ticks);
        i = close + ticks;
        continue;
      }
      out += delim;
      i += ticks;
      continue;
    }
    if (line[i] === '|' && line[i + 1] === '|') {
      out += '\n\n';
      i += 2;
      continue;
    }
    out += line[i];
    i += 1;
  }
  return out;
}

/**
 * Format assistant Markdown prose while keeping fenced code, inline code and GFM tables intact.
 * When `streaming` is true, holds back a solitary trailing `|` so a `||` delimiter split across
 * two SSE deltas never flashes a stray pipe character.
 */
export function formatAssistantMarkdown(raw: string, streaming = false): string {
  if (!raw) return '';
  let source = raw;
  if (streaming && source.endsWith('|') && !source.endsWith('||')) {
    /* Only hold back when the trailing line is not clearly a GFM table row. */
    const lastNl = source.lastIndexOf('\n');
    const lastLine = source.slice(lastNl + 1);
    if (!/^[ \t]*\|/.test(lastLine)) {
      source = source.slice(0, -1);
    }
  }
  if (!source.includes('||')) return source;

  const lines = source.split('\n');
  let fenceChar = '';
  let fenceLen = 0;
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (fenceChar) {
      out.push(line);
      const closeMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        fenceChar = '';
        fenceLen = 0;
      }
      continue;
    }
    const openMatch = line.match(FENCE_OPEN);
    if (openMatch) {
      fenceChar = openMatch[1][0];
      fenceLen = openMatch[1].length;
      out.push(line);
      continue;
    }
    /* Leave GFM table rows untouched (`| col1 | col2 |`). */
    if (trimmed.startsWith('|')) {
      out.push(line);
      continue;
    }
    out.push(replaceOutsideInlineCode(line));
  }
  return out.join('\n');
}

/**
 * Split streaming Markdown into immutable settled blocks and one trailing active block.
 *
 * Cuts only at blank lines (`\n\n`) that fall outside fenced code blocks and tables, keeping
 * reference-link definitions (`[id]: url`) attached to the active tail when present so earlier
 * settled paragraphs can be memoized and skip O(N²) re-parsing on every incoming SSE chunk.
 */
export function splitStreamingMarkdown(markdown: string): { settled: string[]; active: string } {
  if (!markdown) return { settled: [], active: '' };
  /* If link reference definitions appear anywhere, render as one document so references resolve. */
  if (/^[ \t]{0,3}\[[^\]]+\]:\s+\S/m.test(markdown)) {
    return { settled: [], active: markdown };
  }

  const lines = markdown.split('\n');
  const settled: string[] = [];
  let current: string[] = [];
  let fenceChar = '';
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fenceChar) {
      current.push(line);
      const closeMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
      if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
        fenceChar = '';
        fenceLen = 0;
      }
      continue;
    }
    const openMatch = line.match(FENCE_OPEN);
    if (openMatch) {
      fenceChar = openMatch[1][0];
      fenceLen = openMatch[1].length;
      current.push(line);
      continue;
    }
    const isBlank = line.trim() === '';
    if (isBlank && current.length > 0) {
      const next = lines[i + 1];
      /* Do not cut right before an indented continuation (nested list/blockquote) or EOF. */
      const nextIndented = next !== undefined && /^[ \t]+/.test(next) && next.trim() !== '';
      const hasMore = i + 1 < lines.length;
      if (hasMore && !nextIndented) {
        const block = current.join('\n').trimEnd();
        if (block) settled.push(block);
        current = [];
        continue;
      }
    }
    if (!isBlank || current.length > 0) {
      current.push(line);
    }
  }
  return { settled, active: current.join('\n') };
}
