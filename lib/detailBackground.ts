'use client';

import { isHistoryLayerState } from '@/lib/historyLayers';
import type { ImageHeroBackgroundLocation } from '@/lib/hero/types';

/** The source of a plain intercepted navigation has no hero ladder to remember it for us. */
const backgrounds = new Map<string, Readonly<ImageHeroBackgroundLocation>>();

/** Next 16's history tree gains refresh URLs/flags when an intercepted entry is restored.
 * Only segments and parallel children identify the cached page; the remaining tuple fields
 * describe how to refresh it. Read-only compatibility with the installed FlightRouterState. */
function routeIdentity(value: unknown, depth = 0): unknown {
  if (depth > 40 || !Array.isArray(value) || value.length < 2) return null;
  const [segment, routes] = value;
  if ((typeof segment !== 'string' && !Array.isArray(segment)) || !routes || typeof routes !== 'object' || Array.isArray(routes)) return null;
  const children: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(routes).sort()) {
    const child = routeIdentity(routes[name], depth + 1);
    if (child === null) return null;
    children[name] = child;
  }
  return [segment, children];
}

function keys(pathname: string): string[] {
  if (typeof window === 'undefined' || window.location.pathname !== pathname) return [];
  const state = window.history.state;
  // A temporary drawer/dialog entry is not another picture entry. Its open view retains the
  // current background, and the history layer returns to the saved entry on dismissal.
  if (isHistoryLayerState(state)) return [];
  const navigation = (window as unknown as {
    navigation?: { currentEntry?: { key?: string } | null };
  }).navigation;
  if (navigation?.currentEntry?.key) return [`entry:${navigation.currentEntry.key}`];
  try {
    // No history writes. A URL alone conflates one picture opened over different lists or
    // searches. Keep the query-bearing page segments, without mutable router refresh hints.
    const saved = state?.__PRIVATE_NEXTJS_INTERNALS_TREE;
    const identity = routeIdentity(saved?.tree ?? saved);
    return [`state:${pathname}${window.location.search}:${JSON.stringify(identity ?? state)}`];
  } catch {
    // A foreign/cyclic history value does not justify inventing a remembered background.
    return [];
  }
}

export function readDetailBackground(pathname: string): Readonly<ImageHeroBackgroundLocation> | null {
  for (const key of keys(pathname)) {
    const remembered = backgrounds.get(key);
    if (remembered) return remembered;
  }
  return null;
}

/** Record after the router commits its entry; a render may run before that URL is written. */
export function rememberDetailBackground(pathname: string, background: ImageHeroBackgroundLocation): void {
  const remembered = Object.freeze({ pathname: background.pathname, search: background.search });
  for (const key of keys(pathname)) backgrounds.set(key, remembered);
}
