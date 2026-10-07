'use client';

import { Component, type ReactNode } from 'react';
import { motionTier } from '@/lib/appearance';
import { focusLanding } from '@/lib/focusLanding';
import { springTiming } from '@/lib/springTiming';

export interface PresenceEntry<T> {
  item: T;
  key: string;
  /** On its way out: still rendered where it was, faded, and taking no input. */
  leaving: boolean;
}

interface Props<T> {
  items: readonly T[];
  getKey: (item: T) => string | number;
  /**
   * `list`: rows in one column — the rows after a change slide to their new place on an effects
   * spring, which cannot overshoot into the row beside them. `grid`: cards that change cells,
   * on the spatial spring (they move, and a cell is room enough for its 1–2% of overshoot);
   * a card arriving or leaving also scales a little, which a full-width row does not.
   */
  variant?: 'list' | 'grid';
  /**
   * The list's identity — a page, a filter. When it changes the new entries simply replace the
   * old: a page turn is not fifty rows leaving and fifty arriving (`Pagination` owns that move).
   */
  resetKey?: unknown;
  /**
   * Where focus goes when an entry that held it leaves with no entry left beside it — the last
   * row going: the list's heading, the field above it, a sheet's title. Asked at that moment, so
   * an element that arrives in the same commit (an empty state's heading) can be the answer. A
   * control is focused; anything else is a landing (`focusLanding`: no ring, the next Tab goes on
   * from it). Without it, a focus with nowhere to go stays where the browser leaves it.
   */
  fallbackFocus?: () => HTMLElement | null;
  /**
   * Renders the container and one element per entry, **each carrying `data-presence-key={key}`
   * on its root** — that is how an entry's element is found. The container takes `ref`; it may
   * hold other children (a table's header row), which are left alone.
   */
  children: (entries: PresenceEntry<T>[], ref: (node: HTMLElement | null) => void) => ReactNode;
}

interface State<T> {
  entries: PresenceEntry<T>[];
  items: readonly T[];
  /** The entries' keys and presence, so an update that changes only their content moves nothing. */
  shape: string;
  resetKey: unknown;
  /** False for the commit that replaced the list wholesale. */
  animate: boolean;
}

/**
 * Where a focus the removal takes away goes: the entries to try, nearest first — the one now in
 * the leaver's place, then the one before it — and which of its controls, counted like the one
 * that had the focus, so a run of deletes keeps the keyboard on the same control row after row.
 */
interface FocusPlan {
  candidates: string[];
  slot: number;
}

type Snapshot = { rects: Map<Element, DOMRect> | null; focus: FocusPlan | null } | null;

/** One running move per element across every list on the page, so nested lists hand over. */
const moving = new WeakMap<Element, Animation>();

function entriesFrom<T>(items: readonly T[], getKey: (item: T) => string | number): PresenceEntry<T>[] {
  return items.map((item) => ({ item, key: String(getKey(item)), leaving: false }));
}

/**
 * The new list in order, with every entry that has just left — or was already leaving — kept
 * where it was: after the nearest entry before it that is still there. An entry that comes back
 * (撤销) is simply present again.
 */
function merge<T>(previous: PresenceEntry<T>[], items: readonly T[], getKey: (item: T) => string | number, keepLeavers: boolean) {
  const next = entriesFrom(items, getKey);
  if (!keepLeavers) return next;
  const present = new Set(next.map((entry) => entry.key));
  let result = next;
  previous.forEach((entry, index) => {
    if (present.has(entry.key)) return;
    const leaving = entry.leaving ? entry : { ...entry, leaving: true };
    let anchor = -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      anchor = result.findIndex((candidate) => candidate.key === previous[i].key);
      if (anchor !== -1) break;
    }
    result = [...result.slice(0, anchor + 1), leaving, ...result.slice(anchor + 1)];
  });
  return result;
}

function shapeOf<T>(entries: PresenceEntry<T>[]) {
  return JSON.stringify(entries.map((entry) => (entry.leaving ? [entry.key] : entry.key)));
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Every control an entry has, available now or not: the positions a focus's place is counted in. */
const CONTROL = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Can take a focus now: enabled, rendered, and in no inert, hidden or leaving subtree. */
function usable(el: HTMLElement): boolean {
  return !el.matches(':disabled') && !el.closest('[inert], [hidden], [aria-hidden="true"]') &&
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/**
 * An entry's controls in document order, the entry itself first when it is one — counted whether
 * or not they are available, so a control a row disables while its delete is out (its switch)
 * does not shift the place of the one beside it.
 */
function controlsOf(el: HTMLElement): HTMLElement[] {
  return [...(el.matches(CONTROL) ? [el] : []), ...el.querySelectorAll<HTMLElement>(CONTROL)];
}

/** The entry's control at `slot`, or — unavailable now — the available one nearest it. */
function controlAt(el: HTMLElement, slot: number): HTMLElement | null {
  const controls = controlsOf(el);
  const nearest = controls.map((_, index) => index).sort((a, b) => Math.abs(a - slot) - Math.abs(b - slot) || a - b);
  for (const index of nearest) if (usable(controls[index])) return controls[index];
  return null;
}

/** A focus nothing holds any more: on the document, detached, or inside an inert subtree. */
function lostFocus(active: Element | null): boolean {
  return !active || active === document.body || !active.isConnected || Boolean(active.closest('[inert]'));
}

/** Focus `target`: a control as itself, anything else as a landing (no ring, no scroll). */
function land(target: HTMLElement): boolean {
  if (target.matches(FOCUSABLE) && target.tabIndex >= 0) {
    target.focus({ preventScroll: true });
    return document.activeElement === target;
  }
  return focusLanding(target);
}

/**
 * A list whose rows arrive, leave and move instead of appearing, vanishing and jumping — the
 * presence primitive the app lacked, so every list fell back to the cut (a deleted row gone in one
 * frame and the rows under it 90px higher; 撤销 putting it back the same way).
 *
 * **FLIP, with the leaver taken out of the flow.** Before the commit every entry's box is read
 * (`getSnapshotBeforeUpdate`, the one lifecycle that sees the old DOM — so a class); after it, an
 * entry that left is pinned where it was (`position: absolute`, the container its containing
 * block) and fades out, while everything that moved — the rows after it, the cards that changed
 * cell, **and whatever follows the list on the page** up to its column — is given one transform
 * from where it was to where it is. Each is a compositor transform or opacity; nothing animates a
 * size. The pinned leaver is out of the flow, so removing it when its fade ends changes no layout,
 * and an interruption starts every move from where it is on screen (the snapshot is read with
 * running transforms included).
 *
 * Under 关闭 nothing is kept or moved. A press anywhere lands every move at once: a gallery card
 * must never be measured mid-move (AGENTS: no residual transform on a card's ancestor), and a
 * moving target is a hard one to hit.
 *
 * **A removal decides where its focus goes, in the commit that removes the entry, on every tier.**
 * Read before the commit, while the leaving entries are still in the DOM (under 关闭 the commit
 * removes them outright, and a focus inside went to the document with them): a focus inside an
 * entry that is leaving goes to the entry now in its place, else the one before it — to the same
 * control there, counted like the one that had it — else to `fallbackFocus`. A focus the removal
 * finds *lost* — on the document, or inside the confirmation that is leaving (inert) — is placed
 * the same way only when the call site said the removal is the user's (`claimFocus`): a confirmed
 * delete commits when its request lands, which can be before the dialog has returned the focus to
 * the row (it then finds the row leaving, or gone). A focus anywhere live is never moved, and a
 * removal nobody asked for (a re-read under a screen reader's focus) moves nothing.
 */
export default class PresenceList<T> extends Component<Props<T>, State<T>> {
  private container: HTMLElement | null = null;
  private readonly setContainer = (node: HTMLElement | null) => {
    if (node === this.container) return;
    this.container?.removeEventListener('focusin', this.noteFocus);
    this.container = node;
    node?.addEventListener('focusin', this.noteFocus);
  };
  private running = new Set<Animation>();
  private unmounted = false;
  /** Keys the call site is removing at the user's request (`claimFocus`), until they leave. */
  private claims = new Map<string, symbol>();
  /** The entry and control that last took a focus inside the list — what a claimed removal had. */
  private lastFocus: { key: string; slot: number } | null = null;

  constructor(props: Props<T>) {
    super(props);
    const entries = entriesFrom(props.items, props.getKey);
    this.state = { entries, items: props.items, shape: shapeOf(entries), resetKey: props.resetKey, animate: false };
  }

  static getDerivedStateFromProps<T>(props: Props<T>, state: State<T>): Partial<State<T>> | null {
    if (props.resetKey !== state.resetKey) {
      const entries = entriesFrom(props.items, props.getKey);
      return { entries, items: props.items, shape: shapeOf(entries), resetKey: props.resetKey, animate: false };
    }
    if (props.items === state.items) return null;
    const keepLeavers = typeof document !== 'undefined' && motionTier() !== 'off';
    const entries = merge(state.entries, props.items, props.getKey, keepLeavers);
    return { entries, items: props.items, shape: shapeOf(entries), animate: true };
  }

  /**
   * The call site is removing `keys` because the user asked it to — a delete confirmed in a
   * dialog — so when the commit that takes one out finds the focus lost, the focus is placed as if
   * it had been in that entry. Claim before the request, or before the write that removes the
   * entry; a claim lasts until its entry leaves. Call the returned function if the removal does
   * not happen (the request failed): a claim left standing would let a later re-read that drops
   * the same entry move a lost focus.
   */
  claimFocus(keys: Iterable<string | number>): () => void {
    const claim = Symbol('claim');
    const own = [...keys].map(String).filter((key) => this.state.entries.some((entry) => entry.key === key && !entry.leaving));
    for (const key of own) this.claims.set(key, claim);
    return () => {
      for (const key of own) if (this.claims.get(key) === claim) this.claims.delete(key);
    };
  }

  componentDidMount() {
    /* Reset here too: a development build unmounts and remounts every component once (StrictMode),
       and a leaver whose fade ended after that would otherwise never be dropped. */
    this.unmounted = false;
    window.addEventListener('pointerdown', this.landMoves, true);
  }

  componentWillUnmount() {
    this.unmounted = true;
    window.removeEventListener('pointerdown', this.landMoves, true);
    for (const animation of this.running) animation.cancel();
    this.running.clear();
    this.claims.clear();
  }

  getSnapshotBeforeUpdate(_props: Props<T>, previous: State<T>): Snapshot {
    if (!this.state.animate || previous.shape === this.state.shape || !this.container) return null;
    const focus = this.planFocus(previous);
    if (motionTier() === 'off') {
      /* Nothing moves; but an entry that comes back while it is still pinned — the tier went off
         during its fade — is unpinned, or it stays an invisible, inert box in the list. */
      const back = previous.entries.some((entry) => entry.leaving && this.state.entries.some((now) => now.key === entry.key && !now.leaving));
      return focus || back ? { rects: null, focus } : null;
    }
    const rects = new Map<Element, DOMRect>();
    for (const el of this.elements()) rects.set(el, el.getBoundingClientRect());
    for (const el of this.followers()) rects.set(el, el.getBoundingClientRect());
    return { rects, focus };
  }

  componentDidUpdate(_props: Props<T>, previous: State<T>, snapshot: Snapshot) {
    if (previous.resetKey !== this.state.resetKey) {
      this.claims.clear();
      this.lastFocus = null;
    }
    const container = this.container;
    if (!snapshot || !container) return;
    const wasLeaving = new Set(previous.entries.filter((entry) => entry.leaving).map((entry) => entry.key));
    const before = new Set(previous.entries.map((entry) => entry.key));
    const byKey = new Map<string, HTMLElement>();
    for (const el of this.elements()) byKey.set(el.dataset.presenceKey ?? '', el);

    /* Focus first, while a leaver still holding it is neither pinned nor inert. */
    if (snapshot.focus) {
      const departing = this.state.entries
        .filter((entry) => entry.leaving && !wasLeaving.has(entry.key))
        .flatMap((entry) => byKey.get(entry.key) ?? []);
      this.placeFocus(snapshot.focus, byKey, departing);
    }
    const rects = snapshot.rects;
    if (!rects) {
      for (const entry of this.state.entries) {
        const el = byKey.get(entry.key);
        if (el && !entry.leaving && wasLeaving.has(entry.key)) this.unpin(el);
      }
      return;
    }
    const grid = this.props.variant === 'grid';

    /* Writes: pin what has just left, unpin what came back, and drop every running move so the
       boxes read next are the layout's own. */
    const leavers: HTMLElement[] = [];
    let origin: DOMRect | null = null;
    for (const entry of this.state.entries) {
      const el = byKey.get(entry.key);
      if (!el) continue;
      if (entry.leaving && !wasLeaving.has(entry.key)) {
        const rect = rects.get(el);
        if (!rect) continue;
        origin ??= this.originOf(container);
        /* Out of the grouped list's run as it leaves (`.m3-row`'s corners and seams are counted
           among siblings), so the rows either side take their final shape as they move rather
           than snapping to it when the leaver is removed. Its own corners stay as they were. */
        if (el.classList.contains('m3-row')) {
          const style = getComputedStyle(el);
          el.style.borderRadius = `${style.borderTopLeftRadius} ${style.borderTopRightRadius} ${style.borderBottomRightRadius} ${style.borderBottomLeftRadius}`;
          el.classList.remove('m3-row');
          el.dataset.presenceRow = '';
        }
        Object.assign(el.style, {
          position: 'absolute',
          left: `${rect.left - origin.left}px`,
          top: `${rect.top - origin.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: '0',
          pointerEvents: 'none',
        });
        el.inert = true;
        leavers.push(el);
      } else if (!entry.leaving && wasLeaving.has(entry.key)) {
        this.unpin(el);
      }
    }
    const movers = [...this.elements().filter((el) => !leavers.includes(el) && !el.inert), ...this.followers()];
    for (const el of movers) moving.get(el)?.cancel();

    /* Reads: where everything is now. */
    const now = new Map(movers.map((el) => [el, el.getBoundingClientRect()] as const));

    /* Writes: every move, every arrival, every departure. */
    const move = springTiming(grid ? 'defaultSpatial' : 'defaultEffects');
    for (const el of movers) {
      const was = rects.get(el);
      const is = now.get(el)!;
      const key = el.dataset.presenceKey;
      if (!was) {
        /* Arriving (an entry that was not there before; followers always have a snapshot). */
        if (key !== undefined && !before.has(key)) {
          this.track(el.animate([{ opacity: 0 }, { opacity: 1 }], springTiming('defaultEffects')));
          if (grid) this.track(el.animate([{ transform: 'scale(0.92)' }, { transform: 'none' }], springTiming('defaultSpatial')));
        }
        continue;
      }
      const dx = was.left - is.left;
      const dy = was.top - is.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const animation = el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], move);
      moving.set(el, animation);
      this.track(animation);
    }
    for (const el of leavers) {
      const key = el.dataset.presenceKey ?? '';
      const fade = el.animate(
        grid ? [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.92)' }] : [{ opacity: 1 }, { opacity: 0 }],
        { ...springTiming('fastEffects'), fill: 'forwards' },
      );
      this.track(fade);
      fade.finished.then(() => this.drop(key), () => {});
    }
  }

  /** An entry that came back while leaving (撤销): back in the flow and the run, live, fading in. */
  private unpin(el: HTMLElement) {
    for (const prop of ['position', 'left', 'top', 'width', 'height', 'margin', 'pointerEvents', 'borderRadius'] as const) el.style[prop] = '';
    if (el.dataset.presenceRow !== undefined) {
      el.classList.add('m3-row');
      delete el.dataset.presenceRow;
    }
    el.inert = false;
    el.getAnimations().forEach((animation) => animation.cancel());
    this.track(el.animate([{ opacity: 0 }, { opacity: 1 }], springTiming('defaultEffects')));
  }

  /** The entries' elements, in document order. */
  private elements(): HTMLElement[] {
    return this.container ? [...this.container.querySelectorAll<HTMLElement>(':scope > [data-presence-key]')] : [];
  }

  /**
   * Where the focus goes if this commit takes it away, read before the commit: from an entry that
   * is leaving and holds it, or — claimed by the call site — from a lost focus. The claims of every
   * entry leaving are spent here, whatever the focus.
   */
  private planFocus(previous: State<T>): FocusPlan | null {
    const present = new Set(this.state.entries.filter((entry) => !entry.leaving).map((entry) => entry.key));
    const order = previous.entries.filter((entry) => !entry.leaving).map((entry) => entry.key);
    const departing = order.filter((key) => !present.has(key));
    if (departing.length === 0) return null;
    const claimed = departing.filter((key) => this.claims.delete(key));

    const byKey = new Map(this.elements().map((el) => [el.dataset.presenceKey ?? '', el] as const));
    const active = document.activeElement;
    let from: string | undefined;
    let slot = 0;
    if (active instanceof HTMLElement) from = departing.find((key) => byKey.get(key)?.contains(active));
    if (from !== undefined) {
      slot = Math.max(0, controlsOf(byKey.get(from)!).indexOf(active as HTMLElement));
    } else if (claimed.length > 0 && lostFocus(active)) {
      from = claimed[0];
      if (this.lastFocus?.key === from) slot = this.lastFocus.slot;
    }
    if (from === undefined) return null;

    const at = order.indexOf(from);
    const after = order.slice(at + 1).find((key) => present.has(key));
    const before = order.slice(0, at).reverse().find((key) => present.has(key));
    return { candidates: [after, before].filter((key): key is string => key !== undefined), slot };
  }

  /** Carries out a plan — unless something has put the focus somewhere live in the meantime. */
  private placeFocus(plan: FocusPlan, byKey: Map<string, HTMLElement>, departing: HTMLElement[]) {
    const active = document.activeElement;
    if (!lostFocus(active) && !departing.some((el) => el.contains(active))) return;
    for (const key of plan.candidates) {
      const el = byKey.get(key);
      const target = el ? controlAt(el, plan.slot) : null;
      if (target && land(target)) return;
    }
    const fallback = this.props.fallbackFocus?.();
    if (fallback) land(fallback);
  }

  /** Which entry, and which of its controls, a focus inside the list is on. */
  private readonly noteFocus = (event: FocusEvent) => {
    const container = this.container;
    let entry = event.target instanceof HTMLElement ? event.target : null;
    while (entry && entry.parentElement !== container) entry = entry.parentElement;
    const key = entry?.dataset.presenceKey;
    if (!entry || key === undefined) return;
    this.lastFocus = { key, slot: Math.max(0, controlsOf(entry).indexOf(event.target as HTMLElement)) };
  };

  /**
   * What comes after the list in its column and is on screen: the later siblings of the
   * container and of each of its ancestors, up to the page column. A list that shrinks would
   * otherwise pull all of it up in one frame while its own rows glide.
   */
  private followers(): HTMLElement[] {
    const result: HTMLElement[] = [];
    const bottom = window.innerHeight;
    let node: HTMLElement | null = this.container;
    while (node && !node.hasAttribute('data-page-content')) {
      for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        if (!(sibling instanceof HTMLElement)) continue;
        const rect = sibling.getBoundingClientRect();
        if (rect.height > 0 && rect.top < bottom + 200 && rect.bottom > -200) result.push(sibling);
      }
      node = node.parentElement;
    }
    return result;
  }

  /** The container's padding box on screen, which `position: absolute` children are placed against. */
  private originOf(container: HTMLElement): DOMRect {
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const rect = container.getBoundingClientRect();
    return new DOMRect(
      rect.left + container.clientLeft - container.scrollLeft,
      rect.top + container.clientTop - container.scrollTop,
      rect.width,
      rect.height,
    );
  }

  private track(animation: Animation) {
    this.running.add(animation);
    const forget = () => this.running.delete(animation);
    animation.finished.then(forget, forget);
  }

  /** A press lands every move where it is going (fades run on: nothing is aimed at a leaver). */
  private readonly landMoves = () => {
    for (const animation of this.running) {
      const keyframes = (animation.effect as KeyframeEffect | null)?.getKeyframes?.() ?? [];
      if (keyframes.some((frame) => typeof frame.transform === 'string' && frame.transform.startsWith('translate'))) animation.finish();
    }
  };

  /**
   * The leaver goes once its fade has ended, in a commit that measures and moves nothing: it is out
   * of the flow (and out of the grouped list's run, globals.css), so removing it changes no box.
   * Committed as a change of shape, it read every row mid-glide and restarted each glide from rest
   * — the fade (FastEffects) ends before the glides (DefaultSpatial / DefaultEffects) do, so every
   * delete stalled for two frames ~23px short of its cell.
   */
  private drop(key: string) {
    if (this.unmounted) return;
    this.setState((state) => {
      const entries = state.entries.filter((entry) => !(entry.key === key && entry.leaving));
      return { entries, shape: shapeOf(entries), animate: false };
    });
  }

  render() {
    return this.props.children(this.state.entries, this.setContainer);
  }
}
