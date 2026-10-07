'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useSlidingIndicator } from '@/lib/slidingIndicator';
import { useScrollFade } from '@/lib/useScrollFade';
import { useMediaQuery } from '@/lib/hooks';
import { MEDIA } from '@/lib/constants';
import { motionTier } from '@/lib/appearance';
import { cn } from '@/lib/utils';
import { CountBadge } from './Badge';
import { tabId, tabPanelId } from './TabPanes';

export type TabsVariant = 'underline' | 'pill' | 'rail';
export type TabsTone = 'primary' | 'warning';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Leading glyph. Size it 24 (`rail`) or 18–20 (`pill`); omit for `underline`. */
  icon?: ReactNode;
  /** Count rendered as a pill after the label; 0 hides it. */
  badge?: number;
  /** What the count means, read out in place of the bare number. Defaults to `N 条未读`. */
  badgeLabel?: string;
}

interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * `underline` — the default. A row of labels over a rule, with a 2dp indicator
   * gliding between them. M3's secondary tabs.
   *
   * `pill` — a floating segmented control, for a persistent switch that is not
   * part of the page's flow. The home route's 图库 / 论坛 pair.
   *
   * `rail` — a vertical list of pills for a side navigation. The admin console.
   */
  variant?: TabsVariant;
  /** Rail layout when its enclosure, rather than the viewport, decides the axis. */
  orientation?: 'horizontal' | 'vertical';
  /** Tints the indicator and the active label. `/tasks` runs on the warning role. */
  tone?: TabsTone;
  /**
   * `automatic` (the default) selects as the arrow keys move — right when switching is
   * cheap, because both panes are already mounted.
   *
   * `manual` moves only the focus; Enter or Space selects. For a row whose panels each
   * start a read when shown — the admin rail's fourteen sections — where arrowing from
   * the first to the last would load every panel on the way. WAI-ARIA's own guidance
   * for panels that are not instant.
   */
  activation?: 'automatic' | 'manual';
  className?: string;
  /** Accessible name for the tab list. */
  label?: string;
  /**
   * Overrides the `aria-controls` target. Defaults to `tabPanelId(value)`, which
   * is what `TabPane` renders — pass this only where two nested tab groups share
   * a value, or where the panel is not a `TabPane`.
   */
  panelId?: (value: T) => string;
}

/**
 * Room kept between a tab scrolled into view and the row's edge: the edge fade's width
 * (`scroll-fade-x`), so the tab the user is on is never inside the fade and the next one
 * peeks out from behind it — the only sign left, with the scrollbar hidden, that the row
 * goes on.
 */
const EDGE_ROOM = 32;

/**
 * Scroll `list` along its inline axis just enough to show `tab` with `EDGE_ROOM` to
 * spare. Its own scroll position only — `scrollIntoView` would also scroll every
 * ancestor, the page included, to a tab row the user may have scrolled past.
 */
function revealTab(list: HTMLElement, tab: HTMLElement, smooth: boolean) {
  if (list.scrollWidth <= list.clientWidth + 1) return;
  const listBox = list.getBoundingClientRect();
  const tabBox = tab.getBoundingClientRect();
  const start = tabBox.left - listBox.left - list.clientLeft + list.scrollLeft;
  const end = start + tabBox.width;
  let left: number | null = null;
  if (start - EDGE_ROOM < list.scrollLeft) left = start - EDGE_ROOM;
  else if (end + EDGE_ROOM > list.scrollLeft + list.clientWidth) left = end + EDGE_ROOM - list.clientWidth;
  if (left === null) return;
  list.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'instant' });
}

/**
 * The one tab control, and the only one — it takes no other.
 *
 * **The keyboard contract, in full.** Arrow keys move between tabs and — with the
 * default automatic activation, which is what APG prescribes when switching is cheap
 * — select as they go; `activation="manual"` makes them move focus only, with Enter
 * or Space to select. Home and End jump the ends. Exactly one tab is in the tab order
 * at a time (the selected one), so Tab leaves the group rather than walking it — the
 * difference between a tab list and a toolbar.
 *
 * **A row that scrolls keeps its tab in view.** The selected tab is scrolled into the
 * row on mount and on every selection, and the focused one as focus moves, with the
 * row faded at whichever edge hides more tabs. A deep link to the fourteenth admin
 * section used to land with the selected tab 1,500px off-screen.
 *
 * **The indicator is a spring.** A tab indicator is the textbook M3 Expressive
 * spatial motion — a small object crossing a known distance where the settle is
 * the whole character — driven by `useSlidingIndicator` on the **standard**
 * scheme's default spatial spring, which is what `TabRow.kt` assigns. It sits *on*
 * the divider, covering it, as `TabRow` draws it.
 *
 * Pair with `TabPanes` / `TabPane`, which own the shared-axis pane transition.
 * The panes must be written in the same order as the tabs: direction is derived
 * from DOM order.
 */
export default function Tabs<T extends string = string>({
  tabs,
  value,
  onChange,
  variant = 'underline',
  orientation,
  tone = 'primary',
  activation = 'automatic',
  className = '',
  label = '标签页',
  panelId,
}: TabsProps<T>) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement, HTMLSpanElement>(value);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const revealed = useRef(false);
  /* The rail's active state is its own container fill, so it has nothing to
     slide; the other two glide a bar or a pill between the labels. */
  const atLeastMd = useMediaQuery(MEDIA.md);
  const vertical = variant === 'rail' && (orientation ? orientation === 'vertical' : atLeastMd);
  const manual = activation === 'manual';

  /* The roving tab stop as the first render had it — the server's markup and the hydrated
     tree — and from then on only the effect below moves it (G0-010). */
  const [firstValue] = useState(value);
  const tabSet = tabs.map((tab) => tab.value).join('\u0000');

  /* The selected tab into view: at once on the first placement (a deep link must not
     arrive with a glide), then on the motion tier's terms.

     **Then the roving tab stop, as a write after that read.** Written by React, `tabindex`
     changed in the commit's mutations, and on the tab that has just taken the focus that
     write recalculated style synchronously — with every invalidation of the switch pending
     (the panes' flags among them), 5–41ms of it at 4x CPU on a development build, inside the
     commit, and the read here then laid the page out again. After the read the style is
     clean, so the two tabs whose stop moves cost what their own attribute does. The keyboard
     sees no difference: the selection and the stop still change in one commit, before the
     frame. A tab mounted later (a tab set that changed) is set here too. */
  useLayoutEffect(() => {
    const list = containerRef.current;
    if (!list) return;
    const tab = list.querySelector<HTMLElement>(`[data-tab="${CSS.escape(value)}"]`);
    if (tab) {
      revealTab(list, tab, revealed.current && motionTier() !== 'off');
      revealed.current = true;
    }
    for (const button of list.querySelectorAll<HTMLElement>('[role="tab"]')) {
      const stop = button.dataset.tab === value ? 0 : -1;
      if (button.tabIndex !== stop) button.tabIndex = stop;
    }
  }, [containerRef, value, vertical, tabSet]);

  /* Which edges hide tabs, as two attributes the `scroll-fade-x` mask reads. A pill row never
     scrolls. */
  useScrollFade(containerRef, variant !== 'pill');

  const focusTab = (index: number) => {
    const tab = buttons.current[index];
    if (!tab) return;
    tab.focus();
    const list = containerRef.current;
    if (list) revealTab(list, tab, motionTier() !== 'off');
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const forward = vertical ? 'ArrowDown' : 'ArrowRight';
    const back = vertical ? 'ArrowUp' : 'ArrowLeft';
    const move = (next: number) => {
      event.preventDefault();
      const target = tabs[next];
      if (!target) return;
      /* Focus follows the arrow in both modes, so the browser announces the tab it
         lands on; only automatic activation selects it on the way. */
      if (!manual) onChange(target.value);
      focusTab(next);
    };
    switch (event.key) {
      case forward:
        move((index + 1) % tabs.length);
        break;
      case back:
        move((index - 1 + tabs.length) % tabs.length);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(tabs.length - 1);
        break;
    }
  };

  /* Where the accent lives depends on whether there *is* a bar.
     `underline` is M3's secondary tab set: the 2dp indicator carries the accent
     and the label carries `on-surface` — giving the label the accent too leaves
     the row with no ink hierarchy. `pill` and `rail` have no bar (their indicator
     *is* a container), so the selected item takes a container pair, and in this
     app that pair is `secondary-container` — what "selected" means everywhere
     here. `tone="warning"` keeps an accent on the underline set because it marks
     a tab group that is *about* a warning (/tasks) — a deliberate divergence. */
  const activeInk =
    variant === 'underline'
      ? tone === 'warning'
        ? 'text-warning'
        : 'text-on-surface'
      : 'text-on-secondary-container';
  const indicatorFill = tone === 'warning' ? 'bg-warning-fill' : 'bg-primary-ink';

  const tabButtons = tabs.map((tab, index) => {
    const selected = value === tab.value;
    return (
      <button
        key={tab.value}
        ref={(el) => {
          buttons.current[index] = el;
        }}
        data-tab={tab.value}
        /* `inner`: the wave is clipped by the host span below, so a 40dp pill tab's
           target can reach the 48dp floor across its container's padding. */
        data-ripple="inner"
        id={tabId(tab.value)}
        role="tab"
        type="button"
        aria-selected={selected}
        /* Only on the selected tab. An inactive `TabPane` is hidden, so it is not
           in the accessibility tree and a reference to it resolves to nothing;
           /admin mounts only the pane it is showing, so a reference to the others
           would dangle outright. The selected tab is the one whose panel the user
           is about to enter, and it always exists. */
        aria-controls={selected ? (panelId ?? tabPanelId)(tab.value) : undefined}
        /* Roving: one tab stop for the whole group — the first render's here, every later
           move in the layout effect above, so React never writes it during a switch. */
        tabIndex={tab.value === firstValue ? 0 : -1}
        onClick={() => onChange(tab.value)}
        onKeyDown={(event) => onKeyDown(event, index)}
        onFocus={(event) => {
          const list = containerRef.current;
          if (list) revealTab(list, event.currentTarget, motionTier() !== 'off');
        }}
        className={cn(
          'relative flex shrink-0 cursor-pointer items-center gap-2 spring-fast-effects transition-[color,background-color,box-shadow]',
          /* Chrome, not content: no long-press selection of the label, no double-tap
             zoom, and a 48px target under a finger. */
          'touch-target select-none touch-manipulation focus-visible:outline-hidden',
          /* A scrolling tab row clips an outside ring. Keep the indicator inside
             its own target, as menu rows do inside the same kind of enclosure. */
          variant === 'pill'
            ? 'focus-visible:ring-2 focus-ring'
            : 'focus-visible:inset-ring-2 focus-visible:focus-ring-inset',
          /* 48dp, M3's tab height. The pill's own rows are 40dp because they sit
             inside a 48dp container carrying 4dp of padding, which is what makes
             the pill concentric. */
          variant === 'underline' && 'h-12 px-4',
          variant === 'pill' && 'z-10 h-10 rounded-full px-5',
          variant === 'rail' && 'h-12 rounded-full px-4 text-left whitespace-nowrap',
          variant === 'rail' && (orientation ? vertical && 'w-full' : 'md:w-full'),
          /* `title-small`, both tab token sets' `LabelTextFont` — in M3 `TitleSmall`
             and `LabelLarge` are the same four values, so the pixels do not move;
             the role now matches the one the spec names for a tab.
             The role lives in the branches, never above them: one type role per
             element (`cn` is a plain join and resolves nothing), and the selected
             branch is what gives the active tab its weight contrast. */
          selected ? 'text-title-s-emphasized' : 'text-title-s',
          /* The `rail` paints its own container because it has no sliding
             indicator to paint one for it; `pill` gets the fill from the indicator
             behind it and only needs the ink. Both end up on the same pair — and,
             under forced colors, on the system's selection pair. */
          selected
            ? cn(variant === 'rail' && 'bg-secondary-container', activeInk, variant !== 'underline' && 'forced-selected')
            : 'text-on-surface-variant state-layer hover:text-on-surface',
        )}
      >
        <span data-ripple-host="" aria-hidden="true" />
        {tab.icon && (
          /* A fixed, centred cell rather than a bare glyph: an inline svg sits
             on the text baseline and inherits the line box, so each icon lands a
             fraction low and by a different amount per glyph. */
          <span className="grid shrink-0 place-items-center [&>svg]:block" aria-hidden="true">
            {tab.icon}
          </span>
        )}
        <span className={cn('grid min-w-0', variant === 'rail' && 'flex-1')}>
          {/* Reserve the emphasized label's width in both states, so selecting
              a tab cannot shove its neighbours or the moving indicator. */}
          <span aria-hidden="true" className="invisible col-start-1 row-start-1 truncate text-title-s-emphasized">
            {tab.label}
          </span>
          <span className="col-start-1 row-start-1 truncate">{tab.label}</span>
        </span>
        {/* `CountBadge`, not a fourth copy of the `99+` clamp; its meaning is read out. */}
        <CountBadge
          count={tab.badge ?? 0}
          label={tab.badgeLabel ?? (tab.badge ? `${tab.badge} 条未读` : undefined)}
        />
      </button>
    );
  });

  if (variant === 'rail') {
    return (
      <div
        ref={containerRef}
        role="tablist"
        aria-label={label}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        className={cn(
          'flex gap-1 overflow-x-auto scrollbar-hide scroll-fade-x',
          orientation ? vertical && 'flex-col' : 'md:flex-col',
          className,
        )}
      >
        {tabButtons}
      </div>
    );
  }

  if (variant === 'pill') {
    return (
      <div
        ref={containerRef}
        role="tablist"
        aria-label={label}
        /* `shadow-e2`, the nav-bar level. A floating segmented switch is
           navigation chrome, not a dialog; it was at level 3. */
        className={cn(
          'bg-surface-container-high relative flex items-center gap-1 rounded-full p-1 shadow-e2 forced-boundary',
          className,
        )}
      >
        <span
          ref={indicatorRef}
          aria-hidden="true"
          /* `secondary-container`, the app's "selected" pair — a state colour,
             not a plain raised tone, which read as a blank lozenge. Its ink is
             `on-secondary-container`, from `activeInk` above. No shadow: a
             selected segment is a filled container inside one, and M3 puts no
             elevation on it. */
          className="bg-secondary-container absolute top-1 bottom-1 left-0 z-0 rounded-full"
        />
        {tabButtons}
      </div>
    );
  }

  return (
    /* The divider is the wrapper's border and the row overlaps it by its own width,
       so the 2dp indicator (bottom of the row) is drawn *on* the divider, covering it
       under the selected tab — `TabRow`'s arrangement. It sat 1px above the rule, a
       pink bar with a grey hairline under it. */
    <div className={cn('border-outline-variant border-b', className)}>
      <div
        ref={containerRef}
        role="tablist"
        aria-label={label}
        /* The row scrolls horizontally rather than wrapping: several tab sets
           here are four Chinese labels wide plus badges, which overflowed a 390px
           viewport and pushed the indicator's measurement out of sync with what
           was visible. */
        className="scrollbar-hide scroll-fade-x relative -mb-px flex overflow-x-auto"
      >
        <span
          ref={indicatorRef}
          aria-hidden="true"
          /* 2dp and full-width of the tab: M3's *secondary* tab indicator, which
             is what a row of plain labels is. The primary tab's 3dp bar is for a
             tab set with icons above the labels. A painted mark, so forced colors
             repaints it in the system highlight rather than losing it. */
          className={cn('absolute bottom-0 left-0 h-0.5 rounded-full forced-mark', indicatorFill)}
        />
        {tabButtons}
      </div>
    </div>
  );
}
