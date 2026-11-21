'use client';

/**
 * Shared bottom-chrome clearance registry (`--app-bottom-chrome` / `data-bottom-chrome`).
 *
 * The home route's `TabNavBar`, `/shop`'s `CartBar` and `/favorites`' `SelectionBar` all float
 * over the bottom of the content column. Registering each active bar's height here lets the
 * mascot and desktop ponies lift cleanly above whichever bar is currently visible without
 * competing writes or redundant document-wide custom-property restyles.
 */
const entries = new Map<object, { height: number; visible: boolean }>();
let writtenHeight = '';
let writtenVisible = false;

function sync() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  let maxVisibleHeight = 0;
  let maxRetainedHeight = 0;
  let anyVisible = false;
  for (const entry of entries.values()) {
    if (entry.height > maxRetainedHeight) maxRetainedHeight = entry.height;
    if (entry.visible && entry.height > 0) {
      anyVisible = true;
      if (entry.height > maxVisibleHeight) maxVisibleHeight = entry.height;
    }
  }
  const effectiveHeight = anyVisible ? maxVisibleHeight : maxRetainedHeight;
  const nextHeight = effectiveHeight > 0 ? `${effectiveHeight}px` : '';
  if (nextHeight !== writtenHeight) {
    writtenHeight = nextHeight;
    if (nextHeight) root.style.setProperty('--app-bottom-chrome', nextHeight);
    else root.style.removeProperty('--app-bottom-chrome');
  }
  if (anyVisible !== writtenVisible) {
    writtenVisible = anyVisible;
    if (anyVisible) root.setAttribute('data-bottom-chrome', '');
    else root.removeAttribute('data-bottom-chrome');
  }
}

export function setBottomChrome(owner: object, height: number, visible: boolean) {
  const rounded = Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0;
  if (rounded === 0) {
    entries.delete(owner);
  } else {
    entries.set(owner, { height: rounded, visible });
  }
  sync();
}

export function clearBottomChrome(owner: object) {
  if (!entries.delete(owner)) return;
  sync();
}
