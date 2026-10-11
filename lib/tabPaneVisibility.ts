/**
 * Whether an element sits in a tab pane the stylesheet conceals. Read the pane's flags, never
 * its geometry: a layout read below `content-visibility: hidden` lays that subtree out just to
 * answer. A list changing in such a retained pane should settle without measuring or animating.
 */
export function insideConcealedPane(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (!node.hasAttribute('data-tab-pane')) continue;
    if (node.hasAttribute('data-tab-pane-done')) return true;
    if (
      !node.hasAttribute('data-tab-pane-active') &&
      !node.hasAttribute('data-tab-pane-leaving') &&
      !node.hasAttribute('data-tab-pane-entering')
    ) {
      return true;
    }
  }
  return false;
}
