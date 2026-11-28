/**
 * A fixed overlay follows its anchor, not every scrolling region in the document.
 * In particular, scrolling the overlay's own options cannot move that anchor.
 * Both popovers and tooltips batch relevant events into one read per frame.
 */
export function observeAnchorReflow(anchor: HTMLElement, measure: () => void): () => void {
  let frame = 0;
  const onReflow = (event: Event) => {
    if (event.type === 'scroll' && event.target instanceof Node && !event.target.contains(anchor)) return;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };
  window.addEventListener('scroll', onReflow, { capture: true, passive: true });
  window.addEventListener('resize', onReflow, { passive: true });
  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('scroll', onReflow, true);
    window.removeEventListener('resize', onReflow);
  };
}
