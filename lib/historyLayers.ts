'use client';

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { randomId, runWhenIdle } from '@/lib/utils';

/* ---------------------------------------------------------------------------
 * Back closes the topmost overlay — once, here, for every dialog, sheet, lightbox
 * and modal drawer in the app.
 *
 * An open layer owns one same-URL history entry above the one it was opened on:
 *
 *     [page] → [page + layer A] → [page + layer B]       (B opened over A)
 *
 * so the system Back gesture, the browser's button and `history.back()` all peel
 * the topmost layer and nothing else. Closing a layer any other way (Esc, ✕, the
 * scrim, confirm or cancel) steps back off its own entry, so history never keeps a
 * dead same-URL entry that would make the next Back press do nothing visible.
 *
 * **The entry is Next's own entry plus a marker.** The pushed state is a copy of the
 * current `history.state` — `__NA` and the router tree included — so Next's patched
 * `pushState` takes its internal fast path and dispatches nothing, and its `onPopState`
 * would restore the very tree already on screen. The image hero's ladder marker
 * (`__picponyImageHero`) is *moved aside* into this layer's marker rather than copied:
 * a copy would read as a second guard (the duplicate-pair hazard `restoreGuard`
 * guards against), while `lib/hero/history.ts` still needs to know which rung of
 * the ladder the layer sits on after a reload (`historyLayerBeneath`).
 *
 * **A pop between a layer entry and the entry beneath it is consumed.** Both have the
 * same URL and the same tree, so there is nothing for Next, the hero or the scroll
 * memory to do — and Next's `ACTION_RESTORE` for it would *discard* any router
 * navigation still pending (the ordering hazard that ejected 上一张/下一张, R10-001).
 * `consumeHistoryLayerPop` therefore stops the event's propagation; it is registered
 * as a capture listener on `window` as soon as this module loads, and
 * `lib/hero/history.ts` also calls it first thing, so the order in which the two
 * listeners were registered cannot matter. A pop that changes the URL (a multi-step
 * jump from the Back button's history menu) closes the layers it crossed and is left
 * to everyone else.
 *
 * **A navigation from inside a layer replaces the layers, it does not stack on them.**
 * Any foreign `pushState` — or a `replaceState` that changes the URL — made while a
 * layer entry is current is held back, the layer entries are unwound, the layers are
 * asked to close, and the write is replayed on the entry they were opened from:
 * `[page][new page]`, never `[page][page + layer][new page]`. The same hold applies to
 * any write that arrives while a traversal of ours is still in flight, which is what
 * makes "confirm, then navigate" safe without the call site knowing about history.
 * A same-URL `replaceState` (Next committing a refresh, a restore) keeps the marker.
 *
 * **Stale entries collapse by themselves.** A layer entry nothing owns — left by a
 * reload, a discarded tab being restored, or Forward onto a dialog that was closed —
 * is stepped off silently; a user's Back that lands on one continues to where it was
 * going.
 *
 * The image-detail overlay is *not* a layer: the hero ladder owns its entries. Its
 * layers (the lightbox, the report and tag dialogs) sit on top of the ladder's guard
 * and are transparent to it.
 *
 * API: `useHistoryLayer(isOpen, requestClose, options)` for any surface, or
 * `useOverlayLayer(..., { history: true })` from `lib/overlay.ts`, which `Modal` and
 * `Sheet` turn on by default (`closeOnBack={false}` opts out).
 * ------------------------------------------------------------------------ */

const LAYER_KEY = '__picponyLayer';
/** `lib/hero/history.ts`'s marker. Named here, not imported, so this module stays tiny. */
const HERO_KEY = '__picponyImageHero';
/** A same-document traversal lands in a few milliseconds; this is a missed one. */
const TRAVERSAL_TIMEOUT_MS = 1500;
/** A traversal that timed out may still arrive; it is not a user gesture when it does. */
const LATE_POP_MS = 5000;
/** Two traversals in a row that never landed: stop asking the browser for a third. */
const MAX_MISSED_TRAVERSALS = 2;
/**
 * How often a queued entry asks again while history is not ours to write (a hero
 * transaction, or a router that has not written its first state), and for how long.
 * A timer rather than an animation frame: a frame loop keeps the page producing frames
 * for its whole length, and every React commit queued behind it waited for the next one
 * (18ms measured, where an idle page commits in one or two).
 */
const RETRY_MS = 50;
const MAX_RETRIES = 80;

type LayerStatus =
  /** Open, waiting for its entry to be pushed. */
  | 'queued'
  /** Open, and its entry is in history. */
  | 'pushed'
  /** Closed, but its entry is still in history (a layer above it is open, or the step off it is in flight). */
  | 'dead'
  /** No entry in history. */
  | 'gone';

interface LayerMarker {
  v: 1;
  session: string;
  id: string;
  depth: number;
  /** The hero ladder's marker of the entry beneath the whole stack, moved aside. */
  beneath?: unknown;
}

/** One open surface's claim on history. Opaque outside this module. */
export interface HistoryLayer {
  readonly id: string;
  status: LayerStatus;
  /** The URL of its entry (the URL of the page it was opened on). */
  href: string;
  alive: boolean;
  parent: (() => HistoryLayer | null) | null;
  isOpen: () => boolean;
  dismissible: () => boolean;
  requestClose: () => void;
}

interface Traversal {
  timer: number;
}

interface HeldWrite {
  kind: 'push' | 'replace';
  data: unknown;
  unused: string;
  url?: string | URL | null;
}

type Writer = (data: unknown, unused: string, url?: string | URL | null) => void;

let session = '';
let initialized = false;
let sequence = 0;

/** Layers whose entries are in history, bottom first: `entries[i]` sits at depth `i + 1`. */
let entries: HistoryLayer[] = [];
let queue: HistoryLayer[] = [];
let traversal: Traversal | null = null;
let lateUntil = 0;
let missedTraversals = 0;
const held: HeldWrite[] = [];
let flushScheduled = false;
let retryTimer = 0;
let retries = 0;

/** The URL of the current entry as last observed — what a pop is leaving. */
let lastHref = '';
/** The current entry is a layer entry nobody owns (reload / restore). */
let orphan = false;
let orphanIndex: number | null = null;

let inner: { push: Writer; replace: Writer } | null = null;
let wrapped: { push: Writer; replace: Writer } | null = null;
let writing = false;

let gate: (() => boolean) | null = null;
const settleWaiters: Array<() => void> = [];
const decisions = new WeakMap<Event, boolean>();

function createId(prefix: string) {
  return `${prefix}:${randomId()}`;
}

function readMarker(state: unknown): LayerMarker | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[LAYER_KEY];
  if (!value || typeof value !== 'object') return null;
  const marker = value as Record<string, unknown>;
  if (
    marker.v !== 1 ||
    typeof marker.session !== 'string' ||
    typeof marker.id !== 'string' ||
    typeof marker.depth !== 'number'
  ) {
    return null;
  }
  return marker as unknown as LayerMarker;
}

function isOwn(marker: LayerMarker | null): marker is LayerMarker {
  return Boolean(marker && marker.session === session);
}

/** A state Next's router wrote: without `__NA` its `onPopState` reloads the page. */
function isRouterState(state: unknown): state is Record<string, unknown> {
  return Boolean(state && typeof state === 'object' && (state as Record<string, unknown>).__NA);
}

function withoutMarker(data: unknown): unknown {
  if (!data || typeof data !== 'object' || !(LAYER_KEY in (data as object))) return data;
  const copy = { ...(data as Record<string, unknown>) };
  delete copy[LAYER_KEY];
  return copy;
}

function withMarker(data: unknown, marker: LayerMarker): unknown {
  const base = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const copy: Record<string, unknown> = { ...base, [LAYER_KEY]: marker };
  delete copy[HERO_KEY];
  return copy;
}

/** Same document location for this protocol: path and query; a fragment is not a new page. */
function sameLocation(a: string, b: string) {
  try {
    const left = new URL(a, window.location.href);
    const right = new URL(b, window.location.href);
    return left.origin === right.origin && left.pathname === right.pathname && left.search === right.search;
  } catch {
    return a === b;
  }
}

function navigationIndex(): number | null {
  const nav = (window as unknown as { navigation?: { currentEntry?: { index?: number } | null } })
    .navigation;
  const index = nav?.currentEntry?.index;
  return typeof index === 'number' && index >= 0 ? index : null;
}

function nextFrameTwice(task: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(task));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Put ourselves in front of whatever `history.pushState` / `replaceState` are now. With no
 * layer entry current and no traversal of ours in flight, the wrapper only passes through
 * (and notes the URL, which is what tells a later pop where it is leaving from).
 *
 * **Once, and not again merely because something else is now on top.** The App Router
 * patches the pair in an effect, capturing whatever was installed — us — and calling it; a
 * function on top of ours is therefore normally one that calls ours, and wrapping *it* again
 * made a cycle (ours → the router's → ours …) that overflowed the stack on the first write,
 * so no layer entry was ever pushed. Whether we are still in the chain is observed instead
 * (`reached`, on our own writes): only a chain that demonstrably skipped us is taken over.
 */
function install() {
  const history = window.history as unknown as { pushState: Writer; replaceState: Writer };
  inner = { push: history.pushState, replace: history.replaceState };
  wrapped ??= {
    push: (data, unused, url) => intercept('push', data, unused, url),
    replace: (data, unused, url) => intercept('replace', data, unused, url),
  };
  history.pushState = wrapped.push;
  history.replaceState = wrapped.replace;
}

function ensureWrapped() {
  if (!wrapped || !inner) install();
}

/** Set by our wrapper on every call: an own write that did not set it went around us. */
let reached = false;

function write(kind: 'push' | 'replace', data: unknown, unused: string, url?: string | URL | null) {
  const writer = kind === 'push' ? inner?.push : inner?.replace;
  if (!writer) return;
  writer.call(window.history, data, unused, url);
}

function ownWrite(kind: 'push' | 'replace', data: unknown) {
  ensureWrapped();
  writing = true;
  reached = false;
  try {
    // No URL: the entry keeps the current one, fragment included. Through the top of the
    // chain, so every wrapper above ours sees it (the router takes its no-op path for it).
    if (kind === 'push') window.history.pushState(data, '');
    else window.history.replaceState(data, '');
  } finally {
    writing = false;
  }
  /* The pair was re-assigned by something that does not call us (a router remount restoring
     the functions it had captured before this module loaded): the write itself went through;
     go back on top of whatever is there now, which — not calling us — cannot form a cycle. */
  if (!reached) install();
}

function intercept(kind: 'push' | 'replace', data: unknown, unused: string, url?: string | URL | null) {
  reached = true;
  if (writing) {
    write(kind, data, unused, url);
    return;
  }
  try {
    // A traversal of ours is in flight: the write belongs to wherever it lands.
    if (traversal) {
      held.push({ kind, data, unused, url });
      return;
    }
    const current = readMarker(window.history.state);
    const target = url == null || url === '' ? window.location.href : String(url);
    if (current && kind === 'replace' && sameLocation(target, window.location.href)) {
      // Next committing a refresh or a restore on a layer's entry: it stays a layer entry.
      write(kind, withMarker(data, current), unused, url);
    } else if (!current || !entries.length || !isOwn(current)) {
      // An ordinary entry — or a stale layer entry, which collapses whenever it is reached.
      write(kind, withoutMarker(data), unused, url);
      if (kind === 'push') orphan = false;
    } else {
      // A navigation (or any other new entry) from inside the layers supersedes them.
      held.push({ kind, data, unused, url });
      supersede();
      return;
    }
  } catch {
    // The protocol must never cost the app a navigation.
    write(kind, data, unused, url);
  }
  lastHref = window.location.href;
}

function replayHeld() {
  while (held.length && !traversal) {
    const next = held.shift()!;
    intercept(next.kind, withoutMarker(next.data), next.unused, next.url);
  }
}

// ---------------------------------------------------------------------------
// Traversals
// ---------------------------------------------------------------------------

function traverse(delta: number) {
  if (traversal || !delta) return;
  const timer = window.setTimeout(expireTraversal, TRAVERSAL_TIMEOUT_MS);
  traversal = { timer };
  try {
    window.history.go(delta);
  } catch {
    expireTraversal();
  }
}

/** A traversal that never landed: trust the entry that is actually current. */
function expireTraversal() {
  if (!traversal) return;
  window.clearTimeout(traversal.timer);
  traversal = null;
  lateUntil = Date.now() + LATE_POP_MS;
  missedTraversals += 1;
  const marker = readMarker(window.history.state);
  const index = isOwn(marker) ? entries.findIndex((layer) => layer.id === marker.id) : -1;
  for (const layer of entries.splice(index + 1)) layer.status = 'gone';
  if (missedTraversals >= MAX_MISSED_TRAVERSALS) {
    // The browser is not honouring `history.go`: stop stepping and live with the entries.
    for (const layer of entries) layer.status = layer.status === 'dead' ? 'gone' : layer.status;
    entries = entries.filter((layer) => layer.status !== 'gone');
  }
  replayHeld();
  if (missedTraversals < MAX_MISSED_TRAVERSALS) collapse();
  scheduleFlush();
  resolveSettled();
}

/** Step down past every closed layer on top of the stack. */
function collapse() {
  if (traversal || !entries.length) return;
  let dead = 0;
  for (let i = entries.length - 1; i >= 0 && entries[i].status === 'dead'; i -= 1) dead += 1;
  if (!dead) return;
  const top = readMarker(window.history.state);
  // Somebody moved us off our own top entry without telling us: one step at a time.
  const onTop = isOwn(top) && top.id === entries[entries.length - 1].id;
  traverse(onTop ? -dead : -1);
}

/** Unwind every layer entry at once; the open layers are asked to close. */
function supersede() {
  if (!entries.length || traversal) return;
  const open = entries.filter((layer) => layer.status === 'pushed').reverse();
  const top = readMarker(window.history.state);
  const onTop = isOwn(top) && top.id === entries[entries.length - 1].id;
  for (const layer of entries) layer.status = 'dead';
  traverse(onTop ? -entries.length : -1);
  // Not synchronously: this can run inside React's commit (Next writes history from an
  // insertion effect), where scheduling an update is an error.
  queueMicrotask(() => {
    for (const layer of open) if (layer.alive) layer.requestClose();
  });
}

function resolveSettled() {
  if (traversal || entries.length) return;
  for (const resolve of settleWaiters.splice(0)) resolve();
}

// ---------------------------------------------------------------------------
// Pushes
// ---------------------------------------------------------------------------

function writable() {
  if (traversal) return false;
  if (gate && !gate()) return false;
  const phase = document.documentElement.dataset.imageHeroState;
  return !phase || phase === 'gallery-idle' || phase === 'detail-idle';
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    flush();
  });
}

function retryLater() {
  if (retryTimer) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = 0;
    flush();
  }, RETRY_MS);
}

function ancestorsFirst(batch: HistoryLayer[]) {
  const ordered: HistoryLayer[] = [];
  const visit = (layer: HistoryLayer) => {
    if (ordered.includes(layer)) return;
    const parent = layer.parent?.() ?? null;
    if (parent && batch.includes(parent)) visit(parent);
    ordered.push(layer);
  };
  batch.forEach(visit);
  return ordered;
}

function flush() {
  if (!queue.length) return;
  if (traversal) return;
  if (entries.length && entries[entries.length - 1].status === 'dead') {
    collapse();
    return;
  }
  if (!writable() || !isRouterState(window.history.state)) {
    // A hero transaction, or a router that has not written its first state yet. A layer
    // still works without its entry, so this does not wait forever (about four seconds).
    if (retries < MAX_RETRIES) {
      retries += 1;
      retryLater();
      return;
    }
    for (const layer of queue.splice(0)) layer.status = 'gone';
    retries = 0;
    return;
  }
  retries = 0;
  const batch = ancestorsFirst(queue.splice(0));
  for (const layer of batch) {
    if (layer.status !== 'queued') continue;
    if (!layer.isOpen()) {
      layer.status = 'gone';
      continue;
    }
    push(layer);
  }
}

function push(layer: HistoryLayer) {
  const state = window.history.state as Record<string, unknown>;
  // Over another layer entry (ours, or a stale one) the ladder marker is already aside.
  const top = readMarker(state);
  const beneath = top ? top.beneath : state[HERO_KEY];
  const marker: LayerMarker = {
    v: 1,
    session,
    id: layer.id,
    depth: entries.length + 1,
    ...(beneath === undefined ? {} : { beneath }),
  };
  const copy: Record<string, unknown> = { ...state };
  delete copy[HERO_KEY];
  delete copy[LAYER_KEY];
  copy[LAYER_KEY] = marker;
  try {
    ownWrite('push', copy);
  } catch {
    layer.status = 'gone';
    return;
  }
  layer.status = 'pushed';
  layer.href = window.location.href;
  lastHref = layer.href;
  entries.push(layer);
  orphan = false;
  missedTraversals = 0;
}

function requeue(layer: HistoryLayer) {
  if (!layer.alive || layer.status === 'queued' || layer.status === 'pushed') return;
  layer.status = 'queued';
  queue.push(layer);
  scheduleFlush();
}

// ---------------------------------------------------------------------------
// Pops
// ---------------------------------------------------------------------------

function handlePop(event: PopStateEvent): boolean {
  const from = lastHref;
  lastHref = window.location.href;
  const ownTraversal = traversal;
  if (ownTraversal) {
    window.clearTimeout(ownTraversal.timer);
    traversal = null;
    missedTraversals = 0;
  }
  const late = !ownTraversal && lateUntil > Date.now();
  if (late) lateUntil = 0;
  const ours = Boolean(ownTraversal) || late;

  const landed = readMarker(event.state);
  const hadEntries = entries.length > 0;
  const wasOrphan = orphan;
  if (!ours && !hadEntries && !landed && !wasOrphan) return false;

  const sameUrl = sameLocation(from, window.location.href);
  const index = isOwn(landed) ? entries.findIndex((layer) => layer.id === landed.id) : -1;
  const popped = entries.splice(index + 1);
  const dismissed = popped.filter((layer) => layer.status === 'pushed').reverse();
  for (const layer of popped) layer.status = 'gone';

  let step = false;
  orphan = false;
  if (landed && index < 0) {
    // A layer entry nothing owns — a reload, a restore, Forward onto a closed dialog.
    orphan = true;
    orphanIndex = navigationIndex();
    step = true;
  } else if (!ours && wasOrphan && !landed && sameUrl) {
    // The user's Back left a stale entry for the page beneath it — the same page, so the
    // press would have done nothing visible. Carry on to where it was going.
    const now = navigationIndex();
    step = orphanIndex === null || now === null || now < orphanIndex;
  }

  // Top first, as Esc would have taken them.
  for (const layer of dismissed) {
    if (!sameUrl) {
      // The page itself is being left; its surfaces go with it.
      if (layer.alive) layer.requestClose();
      continue;
    }
    if (!layer.dismissible()) {
      // Not dismissible right now (an export in flight): Back is swallowed, not obeyed.
      requeue(layer);
      continue;
    }
    layer.requestClose();
    // A close request the surface declined leaves it open without its entry; give it back.
    nextFrameTwice(() => {
      if (layer.status === 'gone' && layer.isOpen()) requeue(layer);
    });
  }

  if (step) {
    traverse(-1);
  } else {
    replayHeld();
    collapse();
    scheduleFlush();
  }
  resolveSettled();
  return sameUrl;
}

/**
 * Handle a `popstate` that belongs to the layer protocol. Returns true, having stopped the
 * event, when the pop only moved between a layer entry and the entry beneath it — nothing
 * else (Next, the hero, the scroll memory) may act on it. Idempotent per event, so both the
 * listener registered here and `lib/hero/history.ts`'s own call can run it.
 */
export function consumeHistoryLayerPop(event: PopStateEvent): boolean {
  const known = decisions.get(event);
  if (known !== undefined) return known;
  let consumed = false;
  try {
    consumed = handlePop(event);
  } catch {
    consumed = false;
  }
  decisions.set(event, consumed);
  if (consumed) event.stopImmediatePropagation();
  return consumed;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

function initialize() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  session = createId('s');
  lastHref = window.location.href;
  /* Installed now, while the module loads — before the App Router patches the pair in its
     own effect, so the router wraps us rather than the reverse, and its unmount cleanup
     restores us along with the native functions. Wrapped later (a lazily loaded chunk),
     `ensureWrapped` takes whatever is installed at that moment instead. */
  ensureWrapped();
  window.addEventListener('popstate', consumeHistoryLayerPop, { capture: true });
  if (readMarker(window.history.state)) {
    // A reload (or a discarded tab restored) landed on a layer entry with nothing open.
    orphan = true;
    orphanIndex = navigationIndex();
    const stepOff = () => {
      if (!orphan || traversal || !readMarker(window.history.state)) return;
      if (!writable()) {
        runWhenIdle(stepOff, 1000);
        return;
      }
      traverse(-1);
    };
    runWhenIdle(stepOff, 1000);
  }
}

if (typeof window !== 'undefined') initialize();

interface OpenOptions {
  requestClose: () => void;
  isOpen: () => boolean;
  dismissible: () => boolean;
  parent: (() => HistoryLayer | null) | null;
}

function openLayer(options: OpenOptions): HistoryLayer {
  initialize();
  sequence += 1;
  const layer: HistoryLayer = {
    id: createId(`l${sequence}`),
    status: 'queued',
    href: window.location.href,
    alive: true,
    parent: options.parent,
    isOpen: () => layer.alive && options.isOpen(),
    dismissible: options.dismissible,
    requestClose: options.requestClose,
  };
  queue.push(layer);
  scheduleFlush();
  return layer;
}

function releaseLayer(layer: HistoryLayer) {
  layer.alive = false;
  if (layer.status === 'queued') {
    queue = queue.filter((candidate) => candidate !== layer);
    layer.status = 'gone';
    return;
  }
  if (layer.status !== 'pushed') return;
  layer.status = 'dead';
  collapse();
}

export interface HistoryLayerOptions {
  /** `false` keeps this surface out of history: Back then leaves the screen as it always did. */
  enabled?: boolean;
  /**
   * `false` while the surface refuses to be dismissed (Esc is off, an export is running):
   * Back is swallowed rather than obeyed, the way a native non-cancellable dialog ignores it.
   */
  dismissible?: boolean;
  /** The layer this one was opened from, so two layers opening in one commit stack in order. */
  parent?: RefObject<HistoryLayer | null> | null;
}

/**
 * Give a surface its own Back: while `isOpen`, one same-URL history entry is pushed for it,
 * and a Back press that pops that entry calls `requestClose` (which must close the surface —
 * a refusal is detected and the entry given back). When the surface closes any other way,
 * its entry is stepped off. Returns the layer handle, for `parent` chaining.
 *
 *     useHistoryLayer(drawerOpen, () => setDrawerOpen(false));
 */
export function useHistoryLayer(
  isOpen: boolean,
  requestClose: () => void,
  options: HistoryLayerOptions = {},
): RefObject<HistoryLayer | null> {
  const { enabled = true, dismissible = true, parent = null } = options;
  const handle = useRef<HistoryLayer | null>(null);
  const active = isOpen && enabled;
  const latest = useRef({ requestClose, dismissible, active });
  useLayoutEffect(() => {
    latest.current = { requestClose, dismissible, active };
  });

  useEffect(() => {
    if (!active) return;
    const layer = openLayer({
      requestClose: () => latest.current.requestClose(),
      isOpen: () => latest.current.active,
      dismissible: () => latest.current.dismissible,
      parent: parent ? () => parent.current : null,
    });
    handle.current = layer;
    return () => {
      if (handle.current === layer) handle.current = null;
      releaseLayer(layer);
    };
  }, [active, parent]);

  return handle;
}

/** The history state is a layer entry (ours, or a stale one from before a reload). */
export function isHistoryLayerState(state: unknown): boolean {
  return readMarker(state) !== null;
}

/**
 * The hero ladder's marker of the entry beneath a layer entry, in the shape
 * `readHeroHistoryMarker` reads — so the ladder can treat a dialog above its guard as the
 * guard it is standing on. Null for any other state.
 */
export function historyLayerBeneath(state: unknown): Record<string, unknown> | null {
  const marker = readMarker(state);
  if (!marker || marker.beneath === undefined) return null;
  return { [HERO_KEY]: marker.beneath };
}

/**
 * Resolves once no layer entry is current and no traversal of ours is in flight — unwinding
 * (and closing) any open layers first. `lib/hero/history.ts` awaits this before every
 * traversal of its own, whose step counts assume they start on a ladder entry.
 */
export function settleHistoryLayers(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!traversal && !entries.length) return Promise.resolve();
  return new Promise<void>((resolve) => {
    settleWaiters.push(resolve);
    if (!traversal) {
      if (entries.some((layer) => layer.status === 'pushed')) supersede();
      else collapse();
    }
    resolveSettled();
  });
}

/**
 * The history owner that must not be interleaved with (the hero's traversal queue) registers
 * whether it is stable; layer entries are only pushed while it is.
 */
export function setHistoryLayerGate(next: (() => boolean) | null) {
  gate = next;
}
