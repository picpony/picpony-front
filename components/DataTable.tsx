'use client';

import { Component, Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { motionTier } from '@/lib/appearance';
import { springTiming } from '@/lib/springTiming';
import { dropMove, followersOf, insideConcealedPane, precedersOf, startMove } from '@/components/admin/tableMotion';
import Skeleton from './Skeleton';
import EmptyState from './EmptyState';
import ErrorRetry from './ErrorRetry';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T, index: number) => ReactNode;
  /** Promotes this cell to the row heading (largest text in the row). */
  primary?: boolean;
  /** Renders the cell as a bare control at the row's leading edge, with no
   *  label — the select-all checkbox column is the only user. */
  leading?: boolean;
  /** Renders the cell as a button group, pushed to the row's trailing edge. */
  actions?: boolean;
  /** Extra classes for the cell's value element (e.g. truncation) — on every
   *  kind of column, the primary one included. */
  className?: string;
  /**
   * The column's track in the wide layout, as a CSS grid track size. Defaults to
   * `minmax(0, 2fr)` for the primary column, `minmax(0, 1fr)` for a detail and
   * `auto` for the leading and action columns.
   */
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  loading?: boolean;
  /**
   * The failure's title — `{X}加载失败`, or the failed page's own — shown as a row of the table, above
   * any rows still on screen (a page turn that failed keeps the previous page's rows visible).
   */
  error?: string;
  /** The line under the title: the error's own sentence (`apiErrorMessage`). */
  errorDetail?: ReactNode;
  onRetry?: () => void;
  /**
   * Shown when `rows` is empty and not loading. A `string` is the common case
   * and is wrapped in `EmptyState` — it is not rendered raw. Pass a node only
   * when the empty body genuinely needs custom content.
   */
  empty?: string | ReactNode;
  skeletonRows?: number;
  className?: string;
  /** Renders an optional editor/details row immediately below its data row. */
  expandedRow?: (row: T, index: number) => ReactNode;
  /**
   * The list's identity — its page, its filter (`usePagedRows`' `listKey`). When it changes, the
   * new rows replace the old outright: a page turn or a narrowed search is not fifty rows leaving
   * and fifty arriving. A list whose rows share no key with the previous one is replaced the same
   * way without it.
   */
  listKey?: unknown;
}

type EntryKind = 'row' | 'error' | 'empty';

/** One block of the table body: a row (with its expanded editor), or the failure or empty row. */
interface Entry<T> {
  key: string;
  kind: EntryKind;
  row?: T;
  index: number;
  /** On its way out: still in the flow, its footprint collapsed, fading, taking no input. */
  leaving: boolean;
  /** What a leaving row keeps showing under it: its editor as it last rendered. */
  expanded?: ReactNode;
  /** A failure row's words, kept for its exit. */
  failure?: { title: string; detail?: ReactNode };
}

interface State<T> {
  entries: Entry<T>[];
  rows: readonly T[];
  status: '' | 'error' | 'empty';
  listKey: unknown;
  loading: boolean;
  /** The entries' keys and presence: an update that changes only their content moves nothing. */
  shape: string;
  /** False for a commit that replaced the list outright, or only dropped a finished leaver. */
  animate: boolean;
  /** The present rows' expanded nodes, rendered from this render's props. */
  expanded: Map<string, ReactNode>;
  /**
   * Each track's width when a leaver was dropped (`drop`), so an `auto` track does not narrow under
   * the rows that stay — `null` until a drop, and again once the list is replaced outright.
   */
  held: readonly number[] | null;
}

type Snapshot =
  | { skip: true }
  | { skip: false; rects: Map<Element, DOMRect>; radii: Map<Element, string>; around: HTMLElement[] }
  | null;

/** A box's four corners as one `border-radius` value. */
function radiusOf(style: CSSStyleDeclaration) {
  return `${style.borderTopLeftRadius} ${style.borderTopRightRadius} ${style.borderBottomRightRadius} ${style.borderBottomLeftRadius}`;
}

const ERROR_KEY = '\u0000error';
const EMPTY_KEY = '\u0000empty';
const NO_ROWS: readonly never[] = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isLeading = <T,>(col: Column<T>) => Boolean(col.leading);

function statusOf<T>(props: DataTableProps<T>, rows: readonly T[]): State<T>['status'] {
  if (props.error) return 'error';
  return rows.length === 0 ? 'empty' : '';
}

function entriesOf<T>(props: DataTableProps<T>, rows: readonly T[], status: State<T>['status']): Entry<T>[] {
  const result: Entry<T>[] = [];
  if (status === 'error') {
    result.push({ key: ERROR_KEY, kind: 'error', index: -1, leaving: false, failure: { title: props.error ?? '', detail: props.errorDetail } });
  }
  if (status === 'empty') result.push({ key: EMPTY_KEY, kind: 'empty', index: -1, leaving: false });
  rows.forEach((row, index) => {
    result.push({ key: String(props.rowKey(row, index)), kind: 'row', row, index, leaving: false });
  });
  return result;
}

/** Two lists of rows with nothing in common: a different page or a different list, not an edit. */
function disjoint<T>(previous: Entry<T>[], next: Entry<T>[]) {
  const before = new Set(previous.filter((entry) => entry.kind === 'row' && !entry.leaving).map((entry) => entry.key));
  const after = next.filter((entry) => entry.kind === 'row');
  return before.size > 0 && after.length > 0 && after.every((entry) => !before.has(entry.key));
}

/**
 * The new entries in order, with every entry that has just left — or was already leaving — kept
 * where it was: after the nearest entry before it that is still there (`PresenceList`'s rule). A
 * row leaving keeps the editor it last showed. An entry that comes back (撤销) is simply present.
 */
function merge<T>(previous: Entry<T>[], next: Entry<T>[], expanded: Map<string, ReactNode>): Entry<T>[] {
  const present = new Set(next.map((entry) => entry.key));
  let result = next;
  previous.forEach((entry, index) => {
    if (present.has(entry.key)) return;
    const leaving = entry.leaving ? entry : { ...entry, leaving: true, expanded: expanded.get(entry.key) };
    let anchor = -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      anchor = result.findIndex((candidate) => candidate.key === previous[i].key);
      if (anchor !== -1) break;
    }
    result = [...result.slice(0, anchor + 1), leaving, ...result.slice(anchor + 1)];
  });
  return result;
}

function shapeOf<T>(entries: Entry<T>[]) {
  return JSON.stringify(entries.map((entry) => (entry.leaving ? [entry.key] : entry.key)));
}

/** A row's own inline styles that leaving writes, and coming back clears. */
const RETIRED = ['borderRadius', 'marginTop', 'marginBottom', 'height', 'pointerEvents'] as const;

/**
 * Admin data table: a `.m3-row` grouped list with real columns.
 *
 * **Two layouts, chosen by the table's own width** (a container query — the admin
 * console's rail and the app drawer take width that the viewport cannot see). Wide,
 * it is a table: one grid for the whole block, every row a subgrid of it, so a
 * header label sits over the values it names and the `auto` tracks (the leading
 * control, the actions) size to the widest cell in the column rather than per row —
 * the header used to be a separate wrap of labels that aligned with nothing. Narrow,
 * a row is a card of its own: the heading, then each detail as a labelled pair
 * (名称：值), then the actions — and the header row, which would label nothing, is gone.
 *
 * A `primary` column becomes the row heading, an `actions` column renders as a
 * trailing button group, and `leading` columns render as bare leading controls
 * (the select-all checkbox is the only user). An `expandedRow` spans the whole row
 * and stays a sibling of the rows, which the inline editor's layout animation reads.
 *
 * Rows sit one tone step (`surface-container`) above the admin panel they are laid
 * on (`surface-container-low`); on the same step the rows were the panel, and only
 * the header was visible.
 *
 * Owns the loading state as row-shaped skeletons (a `{loading ? <Spinner/> : rows}`
 * ternary collapses the list to nothing and snaps it back).
 *
 * **Rows come and go with presence** — `PresenceList`'s behaviour, on a table: a deleted row fades
 * where it was while the rows after it, and whatever follows the table, glide up into its place; an
 * arriving row fades in as the rows after it glide down; the failure and empty rows are entries of
 * the same list, so the last row leaving cross-fades into 暂无数据 (M1-031: a row vanished and the
 * rows under it jumped). FLIP, and a class for the one lifecycle that sees the old DOM
 * (`getSnapshotBeforeUpdate`). Unlike `PresenceList` the leaver **stays in the flow**: a wide row
 * is a subgrid, and a box taken out of the flow is not a grid item, so it cannot be a subgrid — its
 * cells would re-flow for the length of the fade. Instead its footprint is collapsed (its height
 * frozen, a negative bottom margin of its height and seam) so the layout already has the rows
 * after it where they will end, and the leaver is held at the place it was drawn while it fades.
 * Out of the run as it leaves (`data-presence-row`, globals.css), so its neighbours take their
 * final corners and seams at once, and removed once faded in a commit that changes no box. Every
 * track is a compositor `transform` or `opacity`. A table that shrinks at the end of a scrolled page
 * makes the browser clamp the scroll offset, and everything above it drops; that is measured like
 * any other move, so the heading, the forms and the rail glide down on the rows' clock.
 *
 * A change of `listKey`, a list sharing no row with the previous one, the first load and the
 * 关闭 tier replace the rows outright; a table in a concealed tab pane moves nothing. A press
 * anywhere lands the glides, so nothing is aimed at a moving row. Focus in a leaving row moves to
 * the next row (else the previous one, else the empty row) before the row turns inert.
 *
 * Call sites build their `columns` array as a plain `const` in the component body
 * rather than a module-level factory taking the row handlers: passing a handler
 * staged in a ref as an argument to a function invoked during render trips
 * `react-hooks/refs`; referencing it from inside a `render` closure does not.
 *
 * There is deliberately no `onRowClick`: it made the row a `<div onClick>` — a
 * control no keyboard could reach, inside rows that already carry real buttons.
 * A row that needs to do something puts a button in the `actions` column; a row
 * that needs to expand uses `expandedRow`.
 */
export default class DataTable<T> extends Component<DataTableProps<T>, State<T>> {
  private root: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;
  private readonly setRoot = (node: HTMLDivElement | null) => {
    this.root = node;
  };
  private readonly setBody = (node: HTMLDivElement | null) => {
    this.body = node;
  };
  /** This table's glides, which a press lands. */
  private moving = new Set<Animation>();
  /** Each leaving element's fade (and hold), cancelled if the row comes back. */
  private fading = new WeakMap<Element, Animation>();
  /** The row given the run's opening shape while the rows above it leave (`fitFirstRow`). */
  private patched: HTMLElement | null = null;
  private unmounted = false;

  constructor(props: DataTableProps<T>) {
    super(props);
    this.state = {
      entries: [],
      rows: NO_ROWS,
      status: '',
      listKey: props.listKey,
      loading: true,
      shape: '',
      animate: false,
      expanded: new Map(),
      held: null,
    };
  }

  static getDerivedStateFromProps<T>(props: DataTableProps<T>, state: State<T>): Partial<State<T>> {
    /* Belt and braces: the admin reads already guarantee an array (`adminList`), but a
       `{ success: true, users: {} }` once reached this component as `rows` and took the
       whole console down on `rows.map`. A non-array is an empty table here, not a crash. */
    const rows: readonly T[] = Array.isArray(props.rows) ? props.rows : NO_ROWS;
    if (props.loading) {
      return { entries: [], rows, status: '', listKey: props.listKey, loading: true, shape: '', animate: false, expanded: new Map(), held: null };
    }
    const status = statusOf(props, rows);
    let entries = state.entries;
    let animate = false;
    let held = state.held;
    if (state.loading || !Object.is(props.listKey, state.listKey) || rows !== state.rows || status !== state.status) {
      const next = entriesOf(props, rows, status);
      const keepLeavers = typeof document !== 'undefined' && motionTier() !== 'off';
      if (state.loading || !Object.is(props.listKey, state.listKey) || disjoint(state.entries, next) || !keepLeavers) {
        entries = next;
        /* Rows that replace the list outright size their own tracks: nothing on screen is held. */
        held = null;
      } else {
        entries = merge(state.entries, next, state.expanded);
        animate = true;
      }
    }
    const expanded = new Map<string, ReactNode>();
    if (props.expandedRow) {
      for (const entry of entries) {
        if (entry.kind !== 'row' || entry.leaving) continue;
        const node = props.expandedRow(entry.row as T, entry.index);
        if (node !== null && node !== undefined && node !== false) expanded.set(entry.key, node);
      }
    }
    return { entries, rows, status, listKey: props.listKey, loading: false, shape: shapeOf(entries), animate, expanded, held };
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
    for (const animation of this.moving) animation.cancel();
    this.moving.clear();
  }

  getSnapshotBeforeUpdate(_props: DataTableProps<T>, previous: State<T>): Snapshot {
    if (!this.state.animate || previous.shape === this.state.shape || !this.body || !this.root) return null;
    if (motionTier() === 'off' || insideConcealedPane(this.root)) return { skip: true };
    const view = window.innerHeight;
    /* What follows the table moves with its rows; what precedes it moves when the table shrinks at
       the end of the page and the browser clamps the scroll offset — carried down on the same clock
       instead of dropping in one frame. */
    const around = [...followersOf(this.root, { top: -view, bottom: view * 2 }), ...precedersOf(this.root, { top: -view, bottom: view })];
    const rects = new Map<Element, DOMRect>();
    const radii = new Map<Element, string>();
    /* Each row's corners as they are now: a row that leaves keeps them, even when the same commit
       hands its place in the run to another (the last row's corners, to an arriving 暂无数据). */
    for (const el of Array.from(this.body.children)) {
      rects.set(el, el.getBoundingClientRect());
      radii.set(el, radiusOf(getComputedStyle(el)));
    }
    for (const el of around) rects.set(el, el.getBoundingClientRect());
    return { skip: false, rects, radii, around };
  }

  componentDidUpdate(_props: DataTableProps<T>, previous: State<T>, snapshot: Snapshot) {
    const body = this.body;
    if (!body) return;
    if (snapshot?.skip) {
      /* Nobody can see this change (a concealed pane): the leavers go at once. */
      if (this.state.entries.some((entry) => entry.leaving)) this.dropAll();
      return;
    }
    if (!snapshot) {
      this.fitFirstRow();
      return;
    }
    const wasLeaving = new Set(previous.entries.filter((entry) => entry.leaving).map((entry) => entry.key));
    const before = new Set(previous.entries.map((entry) => entry.key));
    const groups = this.groups();

    /* Reads for the rows leaving now: how each sits, before anything is written. */
    const leaving: Array<{ key: string; els: HTMLElement[] }> = [];
    const coming: HTMLElement[] = [];
    for (const entry of this.state.entries) {
      const els = groups.get(entry.key);
      if (!els) continue;
      if (entry.leaving && !wasLeaving.has(entry.key)) leaving.push({ key: entry.key, els });
      else if (!entry.leaving && wasLeaving.has(entry.key)) coming.push(...els);
    }
    for (const { els } of leaving) this.handOffFocus(els);
    /* A row coming back fades in from where its fade-out has got to. */
    const opacities = new Map(coming.map((el) => [el, getComputedStyle(el).opacity] as const));
    const frozen = leaving.flatMap(({ els }) => els).map((el) => {
      const style = getComputedStyle(el);
      return {
        el,
        marginTop: parseFloat(style.marginTop) || 0,
        height: el.getBoundingClientRect().height,
        radius: snapshot.radii.get(el) ?? radiusOf(style),
        opacity: style.opacity,
      };
    });

    /* Writes: each leaver out of the run, its footprint collapsed in the flow; each returning row
       back as it was; then every running glide dropped, so the boxes read next are the layout's. */
    for (const { el, marginTop, height, radius } of frozen) {
      dropMove(el);
      Object.assign(el.style, {
        borderRadius: radius,
        marginTop: `${marginTop}px`,
        height: `${height}px`,
        /* Its height and the seam above it: the next row's top lands where this one's was, in a
           grid (no margin collapsing) and in a block (the negative margin collapses with the next
           row's seam) alike. */
        marginBottom: `${-(height + marginTop)}px`,
        pointerEvents: 'none',
      });
      if (el.classList.contains('m3-row')) {
        el.classList.remove('m3-row');
        el.dataset.presenceRow = '';
      }
      el.inert = true;
    }
    for (const el of coming) {
      this.fading.get(el)?.cancel();
      this.fading.delete(el);
      for (const prop of RETIRED) el.style[prop] = '';
      if (el.dataset.presenceRow !== undefined) {
        el.classList.add('m3-row');
        delete el.dataset.presenceRow;
      }
      el.inert = false;
    }
    this.fitFirstRow();
    const retired = new Set(this.state.entries.filter((entry) => entry.leaving).flatMap((entry) => groups.get(entry.key) ?? []));
    const movers = [
      ...Array.from(body.children).filter((el): el is HTMLElement => el instanceof HTMLElement && !retired.has(el)),
      ...snapshot.around.filter((el) => el.isConnected),
    ];
    for (const el of movers) dropMove(el);

    /* Reads: where everything is now. */
    const now = new Map(movers.map((el) => [el, el.getBoundingClientRect()] as const));
    const held = new Map(frozen.map(({ el }) => [el, el.getBoundingClientRect()] as const));

    /* Writes: every glide, every arrival, every departure. */
    const glide = springTiming('defaultEffects');
    const fadeIn = springTiming('defaultEffects');
    const arrived = new Set(this.state.entries.filter((entry) => !entry.leaving && !before.has(entry.key)).flatMap((entry) => groups.get(entry.key) ?? []));
    for (const el of movers) {
      const was = snapshot.rects.get(el);
      const is = now.get(el);
      if (!is) continue;
      if (!was) {
        if (arrived.has(el)) el.animate([{ opacity: 0 }, { opacity: 1 }], fadeIn);
        continue;
      }
      const dy = was.top - is.top;
      if (Math.abs(dy) < 0.5 || is.height === 0) continue;
      this.track(startMove(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], glide));
    }
    for (const el of coming) el.animate([{ opacity: opacities.get(el) ?? '0' }, { opacity: 1 }], fadeIn);
    const fadeOut = { ...springTiming('fastEffects'), fill: 'forwards' as const };
    for (const { key, els } of leaving) {
      els.forEach((el, index) => {
        const was = snapshot.rects.get(el);
        const is = held.get(el);
        const dy = was && is ? was.top - is.top : 0;
        const from = frozen.find((entry) => entry.el === el)?.opacity ?? '1';
        /* Held where it was drawn: collapsing its footprint moved its box (the row's editor up onto
           the row, a leaver after another up onto that one). */
        const hold = Math.abs(dy) >= 0.5 ? `translateY(${dy}px)` : 'none';
        const fade = el.animate([{ opacity: from, transform: hold }, { opacity: 0, transform: hold }], fadeOut);
        this.fading.set(el, fade);
        if (index === 0) fade.finished.then(() => this.drop(key), () => {});
      });
    }
  }

  /** Each entry's elements in document order: its keyed element and the unkeyed ones after it (its editor). */
  private groups(): Map<string, HTMLElement[]> {
    const groups = new Map<string, HTMLElement[]>();
    let current: HTMLElement[] | null = null;
    for (const el of Array.from(this.body?.children ?? [])) {
      if (!(el instanceof HTMLElement)) continue;
      const key = el.dataset.presenceKey;
      if (key !== undefined) {
        current = [el];
        groups.set(key, current);
      } else if (current && !el.hasAttribute('data-table-header')) {
        current.push(el);
      }
    }
    return groups;
  }

  /**
   * Narrow, the header row is not displayed but still opens the run as far as the sibling rules
   * can tell, so globals.css gives the first data row the run's opening shape. While the rows
   * above it leave, the row that will be first is given that shape here (no seam, the large top
   * corners), and given it back once they are gone — or it would take it in one frame at the end.
   */
  private fitFirstRow() {
    const body = this.body;
    const previous = this.patched;
    let target: HTMLElement | null = null;
    const header = body?.firstElementChild;
    if (header instanceof HTMLElement && header.nextElementSibling?.hasAttribute('data-presence-row')
      && getComputedStyle(header).display === 'none') {
      let el: Element | null = header.nextElementSibling;
      while (el?.hasAttribute('data-presence-row')) el = el.nextElementSibling;
      if (el instanceof HTMLElement && el.classList.contains('m3-row')) target = el;
    }
    if (previous === target) return;
    if (previous) {
      previous.style.marginTop = '';
      previous.style.borderStartStartRadius = '';
      previous.style.borderStartEndRadius = '';
    }
    if (target) {
      target.style.marginTop = '0px';
      target.style.borderStartStartRadius = 'var(--radius-lg)';
      target.style.borderStartEndRadius = 'var(--radius-lg)';
    }
    this.patched = target;
  }

  /** Focus inside a leaving row goes to the next row, else the previous one, else the empty row. */
  private handOffFocus(els: HTMLElement[]) {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !els.some((el) => el.contains(active))) return;
    const groups = this.groups();
    const present = this.state.entries.filter((entry) => !entry.leaving);
    const own = this.state.entries.findIndex((entry) => groups.get(entry.key)?.[0] === els[0]);
    const order = this.state.entries.map((entry) => entry.key);
    const after = present.filter((entry) => order.indexOf(entry.key) > own);
    const beforeIt = present.filter((entry) => order.indexOf(entry.key) < own).reverse();
    for (const entry of [...after, ...beforeIt]) {
      const target = groups.get(entry.key)?.[0]?.querySelector<HTMLElement>(FOCUSABLE);
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }
    groups.get(EMPTY_KEY)?.[0]?.focus({ preventScroll: true });
  }

  private track(animation: Animation) {
    this.moving.add(animation);
    const forget = () => this.moving.delete(animation);
    animation.finished.then(forget, forget);
  }

  /** A press lands every glide where it is going (fades run on: nothing is aimed at a leaver). */
  private readonly landMoves = () => {
    for (const animation of this.moving) animation.finish();
  };

  /**
   * The leaver goes once its fade has ended, in a commit that measures and moves nothing: its
   * footprint is already collapsed and it is out of the run, so removing it changes no box.
   *
   * **Nor any column.** A wide row is a subgrid, so a leaver still sizes the `auto` tracks (the
   * leading control, the actions) while it fades; when it held the widest cell of one, removing it
   * narrowed that track and every row's cells stepped sideways in one frame. So the tracks are read
   * here, with the leaver still laid out, and each `auto` one is held at that width (`held`) — a
   * floor, not a fixed size, so a wider cell arriving still widens it. Holding rather than gliding:
   * a `grid-template-columns` animation lays the whole table out every frame, and a column a little
   * wider than its widest cell is not a defect. The next outright replacement lets go.
   */
  private drop(key: string) {
    if (this.unmounted) return;
    const held = this.trackWidths();
    this.setState((state) => {
      const entries = state.entries.filter((entry) => !(entry.key === key && entry.leaving));
      if (entries.length === state.entries.length) return null;
      return { entries, shape: shapeOf(entries), animate: false, held: held ?? state.held };
    });
  }

  /** Each track's laid-out width, or `null` where the table is not a grid (its narrow layout). */
  private trackWidths(): number[] | null {
    if (!this.body) return null;
    const template = getComputedStyle(this.body).gridTemplateColumns;
    if (!template || template === 'none') return null;
    const widths = template.trim().split(/\s+/).map(parseFloat);
    return widths.length && widths.every(Number.isFinite) ? widths : null;
  }

  private dropAll() {
    this.setState((state) => {
      const entries = state.entries.filter((entry) => !entry.leaving);
      return { entries, shape: shapeOf(entries), animate: false };
    });
  }

  render() {
    const { columns, loading = false, error, errorDetail, onRetry, empty, skeletonRows = 6, className = '' } = this.props;
    const leading = columns.filter(isLeading);
    const heading = columns.find((c) => c.primary && !isLeading(c)) ?? null;
    const details = columns.filter((c) => !c.primary && !c.actions && !isLeading(c));
    const actions = columns.filter((c) => c.actions);

    /* One track per cell the rows render, in the order they render them. An `auto` track held across
       a drop (`drop`) keeps its width as a floor, while the columns still match the hold. */
    const specs = [
      ...(leading.length ? ['auto'] : []),
      ...(heading ? [heading.width ?? 'minmax(0, 2fr)'] : []),
      ...details.map((col) => col.width ?? 'minmax(0, 1fr)'),
      ...(actions.length ? ['auto'] : []),
    ];
    const held = this.state.held?.length === specs.length ? this.state.held : null;
    const tracks = specs.map((spec, index) => (held && spec === 'auto' ? `minmax(${held[index]}px, auto)` : spec)).join(' ');

    /* A row: its own wrapping flex line when narrow, a subgrid of the table when wide. */
    const rowLayout =
      'flex flex-wrap items-center gap-x-4 gap-y-2 @2xl/table:grid @2xl/table:grid-cols-subgrid @2xl/table:gap-y-0';

    const renderRow = (entry: Entry<T>) => {
      const row = entry.row as T;
      const i = entry.index;
      return (
        <Fragment key={entry.key}>
          <div
            data-presence-key={entry.key}
            className={cn(
              'm3-row p-4 @2xl/table:items-center',
              rowLayout,
              /* The tone is flat and stays flat: this row is not a control.
                 Nothing hovers here except the buttons in the `actions`
                 column, which carry their own state layer. */
              'bg-surface-container',
            )}
          >
            {leading.length > 0 && (
              <div className="flex shrink-0 items-center gap-2">
                {leading.map((col) => (
                  <div key={col.key} className={col.className}>
                    {col.render(row, i)}
                  </div>
                ))}
              </div>
            )}

            {heading && (
              <div className={cn('text-title-s text-on-surface min-w-0 break-words', heading.className)}>
                {heading.render(row, i)}
              </div>
            )}

            {details.map((col) => (
              <span key={col.key} className={cn('text-body-m text-on-surface min-w-0 break-words', col.className)}>
                {/* The column's name, beside its value, where there is no header
                    row above to name it. */}
                <span className="text-on-surface-variant @2xl/table:hidden">
                  {col.header}
                  {'：'}
                </span>
                {col.render(row, i)}
              </span>
            ))}

            {actions.length > 0 && (
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2 @2xl/table:ml-0 @2xl/table:justify-self-end">
                {actions.map((col) => (
                  <div key={col.key} className={cn('flex flex-wrap items-center gap-2', col.className)}>
                    {col.render(row, i)}
                  </div>
                ))}
              </div>
            )}
          </div>
          {entry.leaving ? entry.expanded : this.state.expanded.get(entry.key)}
        </Fragment>
      );
    };

    const renderEntry = (entry: Entry<T>) => {
      if (entry.kind === 'row') return renderRow(entry);
      if (entry.kind === 'error') {
        const failure = entry.leaving ? entry.failure : { title: error ?? '', detail: errorDetail };
        return (
          <div key={entry.key} data-presence-key={entry.key} className="m3-row bg-surface-container">
            <ErrorRetry size="inline" title={failure?.title ?? ''} message={failure?.detail} onRetry={entry.leaving ? undefined : onRetry} />
          </div>
        );
      }
      /* ---- Empty: `EmptyState`, like every other "nothing here" in the app.
           `inline` because it sits in a table body that already has a header row
           above it. A string `empty` is wrapped rather than spliced. Focusable by
           script only: it is where focus goes when the last row leaves. ---- */
      return (
        <div
          key={entry.key}
          data-presence-key={entry.key}
          tabIndex={-1}
          className="m3-row bg-surface-container focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
        >
          {typeof empty === 'string' || empty == null ? <EmptyState size="inline" title={empty ?? '暂无数据'} /> : empty}
        </div>
      );
    };

    return (
      <div
        ref={this.setRoot}
        className={cn('@container/table w-full', className)}
        aria-busy={loading || undefined}
        data-page-loading={loading ? '' : undefined}
      >
        <div
          ref={this.setBody}
          /* Every direct child spans the grid, so a status row or an expanded editor is
             a full-width member of the block and the rows' sibling chain is unbroken. */
          className="@2xl/table:grid @2xl/table:gap-x-4 [&>*]:col-span-full"
          style={{ gridTemplateColumns: tracks }}
        >
          {/* ---- Header: column names, first row of the cut block. Wide layout only:
               narrow, each value carries its own label. ---- */}
          <div
            data-table-header=""
            className="m3-row hidden bg-surface-container-high px-4 py-3 @2xl/table:grid @2xl/table:grid-cols-subgrid @2xl/table:items-center"
          >
            {leading.length > 0 && (
              <div className="flex items-center gap-2">
                {leading.map((col) => (
                  <div key={col.key}>{col.header}</div>
                ))}
              </div>
            )}
            {heading && <span className="text-label-l text-on-surface-variant min-w-0">{heading.header}</span>}
            {details.map((col) => (
              <span key={col.key} className="text-label-l text-on-surface-variant min-w-0">
                {col.header}
              </span>
            ))}
            {actions.length > 0 && (
              <span className="text-label-l text-on-surface-variant justify-self-end">{actions[0].header}</span>
            )}
          </div>

          {/* ---- Loading: rows in the row's own geometry ----
               Each placeholder is laid out exactly as a row is — the same cells in the same
               subgrid tracks when wide, the same wrapping heading/labelled pairs/actions when
               narrow, the same padding and tone — so the list does not re-space when its rows
               land. They sit directly in the container: wrapping them in a <div> would break
               the `.m3-row` sibling chain and give the header row the "last row" corner. */}
          {loading &&
            Array.from({ length: skeletonRows }, (_, i) => (
              <div
                key={`skeleton-${i}`}
                aria-hidden="true"
                className={cn('m3-row p-4 @2xl/table:items-center', rowLayout, 'bg-surface-container')}
              >
                {leading.length > 0 && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Skeleton className="size-5 rounded-xs" delay={i * 80} />
                  </div>
                )}
                {heading && (
                  <div className="min-w-0">
                    <Skeleton className="h-5 w-32 max-w-full" delay={i * 80} />
                  </div>
                )}
                {details.map((col, j) => (
                  <span key={col.key} className="min-w-0">
                    <Skeleton className="h-4 w-20 max-w-full" delay={i * 80 + 40 + j * 20} />
                  </span>
                ))}
                {actions.length > 0 && (
                  <div className="ml-auto flex items-center justify-end gap-2 @2xl/table:ml-0 @2xl/table:justify-self-end">
                    <Skeleton className="size-8 rounded-full" delay={i * 80 + 60} />
                    <Skeleton className="size-8 rounded-full" delay={i * 80 + 80} />
                  </div>
                )}
              </div>
            ))}

          {/* ---- The failure, the empty row and the rows: one continuous cut block,
               like a settings list, whose entries come and go with presence. ---- */}
          {!loading && this.state.entries.map(renderEntry)}
        </div>
      </div>
    );
  }
}
