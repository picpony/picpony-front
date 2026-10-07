/**
 * A remark plugin: every newline inside a paragraph's text is a line break.
 *
 * The one line-break rule the two renderers share (AGENTS "Rich-text rhythm"): BBCode turns a
 * single newline into a break and a blank line into a paragraph, and so does Derpibooru's own
 * Markdown, which renders with hard breaks. CommonMark folds a single newline into a space, so
 * the same comment came out on one line or two depending on which renderer it reached. What
 * `remark-breaks` does, in the dozen lines it takes rather than a dependency: text nodes only,
 * so code keeps its own newlines.
 */

type MdNode = { type: string; value?: string; children?: MdNode[] };

function split(node: MdNode): MdNode[] {
  if (node.type !== 'text' || !node.value || !node.value.includes('\n')) return [node];
  const parts = node.value.split(/\r?\n/);
  const out: MdNode[] = [];
  parts.forEach((part, index) => {
    if (index > 0) out.push({ type: 'break' });
    if (part) out.push({ type: 'text', value: part });
  });
  return out;
}

function visit(node: MdNode) {
  if (!node.children) return;
  node.children = node.children.flatMap(split);
  for (const child of node.children) visit(child);
}

export function remarkHardBreaks() {
  return (tree: MdNode) => {
    visit(tree);
  };
}
