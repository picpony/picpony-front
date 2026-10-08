'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Where the `@imageDetail` slot is in the tree, so what Next renders into it knows it is not the
 * page.
 *
 * **Next gives every parallel slot of a layout that segment's `loading.tsx`.** The loading module
 * is stored on the parent segment and applied to each of its slots (`layout-router.js` says as
 * much, and calls it an accident of the implementation), so the root route fallback is the
 * picture slot's fallback too. That slot is not in the page column: the shell renders it in the
 * content host beside the scroller, where the picture overlay is laid over the list. Whenever the
 * slot's segment waits for data — a Back or Forward whose entry the router cache no longer holds
 * (on the development server a saved file drops that cache in every open tab) — the route fallback
 * was laid out there: in flow at the host's top-left, with no gutter, its positioned placeholder
 * bars painted over the page that was already on screen, and staying for as long as the slot
 * waited. That was the "skeleton left behind" over /messages after a few levels of Back.
 *
 * The slot stands in for nothing on every route but a picture, and the picture overlay brings its
 * own loading state (`PicDetail`'s shell and placeholder, and the hero Stage during a flight); a
 * page-shaped placeholder is the wrong shape in both cases. So the route fallback renders only in
 * the page column — inside this boundary it is nothing, and the page stays as it is until the slot
 * has something to show.
 */
const InImageDetailSlot = createContext(false);

/** Wraps the `@imageDetail` slot in the shell. Renders no element of its own. */
export function ImageDetailSlot({ children }: { children: ReactNode }) {
  return <InImageDetailSlot.Provider value>{children}</InImageDetailSlot.Provider>;
}

/** The route fallback's markup, in the page column only — see `ImageDetailSlot`. */
export function PageFallback({ children }: { children: ReactNode }) {
  return useContext(InImageDetailSlot) ? null : children;
}