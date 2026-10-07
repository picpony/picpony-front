'use client';

import { useEffect } from 'react';

/**
 * Names the document after something a screen only knows once its data is in — a thread's title.
 *
 * An effect alone loses: Next resolves a route's metadata after the page has mounted and writes
 * the layout's generic title over whatever the page set, on a cold load especially. So the title
 * is held while the screen is mounted, put back whenever the head changes; the next route's own
 * metadata takes over once this one unmounts.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
