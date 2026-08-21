'use client';

import { useRef, type ReactNode } from 'react';
import { useSlidingIndicator } from '@/lib/motion';
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
  /** Tints the indicator and the active label. `/tasks` runs on the warning role. */
  tone?: TabsTone;
  className?: string;
  /** Re-measure the indicator when the tab list mounts late (e.g. after fetch). */
  deps?: unknown[];
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
 * The one tab control.
 *
 * There were **four**, and they had drifted apart in every dimension a tab has:
 *
 *   `TabBar`              underlined, `role="tablist"`, no keyboard contract
 *   `AppLayout` pill      no ARIA roles at all, `shadow-e3` (the dialog step)
 *   `app/admin` rail      no ARIA roles, an icon that scaled 110% when active
 *   `app/tasks`           no ARIA roles, its own copy of the sliding-indicator
 *                         wiring, and an active tab distinguished by colour
 *                         alone — the exact defect `TabBar`'s own comment
 *                         records having fixed, grown back one screen over
 *
 * So three of the four told a screen reader nothing about being tabs, and the
 * one that did tell it made a promise it could not keep: `role="tab"` commits to
 * arrow-key navigation and a roving tab stop, and there was neither. That is the
 * same failure `Menu` was written to end — a control announcing a contract it has
 * not implemented is worse than a plain button row, because the user is told
 * which keys to press and then they do nothing.
 *
 * **The keyboard contract, in full.** Arrow keys move between tabs and select as
 * they go (automatic activation, which is what APG prescribes when switching is
 * cheap — and here both panes are already mounted, so it is). Home and End jump
 * the ends. Exactly one tab is in the tab order at a time, so Tab leaves the
 * group rather than walking it, which is the difference between a tab list and a
 * toolbar. Focus follows selection, so the browser announces the new tab.
 *
 * **The indicator is a spring.** A tab indicator is the textbook M3 Expressive
 * spatial motion — a small object crossing a known distance where the settle is
 * the whole character — and it is driven by `useSlidingIndicator`, which lands it on
 * the **standard** scheme's default spatial spring (ζ0.9 k700, 194ms), which is what
 * `TabRow.kt` assigns. It ran on a back-eased approximation of a spring, and then
 * briefly on the *expressive* scheme's tier — ζ0.8 k380 settling in 326ms — which is
 * the more general problem that pass was fixing.
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
  tone = 'primary',
  className = '',
  deps = [],
  label = '标签页',
  panelId,
}: TabsProps<T>) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement, HTMLSpanElement>(
    value,
    deps,
  );
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  /* The rail's active state is its own container fill, so it has nothing to
     slide; the other two glide a bar or a pill between the labels. */
  const vertical = variant === 'rail';

  const select = (index: number) => {
    const next = tabs[index];
    if (!next) return;
    onChange(next.value);
    // Focus follows selection: the browser then announces the tab that just
    // became current, which is what makes arrow navigation audible.
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const forward = vertical ? 'ArrowDown' : 'ArrowRight';
    const back = vertical ? 'ArrowUp' : 'ArrowLeft';
    const current = tabs.findIndex((tab) => tab.value === value);
    const step = (delta: number) => {
      event.preventDefault();
      select((current + delta + tabs.length) % tabs.length);
    };
    switch (event.key) {
      case forward:
        step(1);
        break;
      case back:
        step(-1);
        break;
      case 'Home':
        event.preventDefault();
        select(0);
        break;
      case 'End':
        event.preventDefault();
        select(tabs.length - 1);
        break;
    }
  };

  /* Where the accent lives depends on whether there *is* a bar.
     `underline` is M3's secondary tab set: the 2dp indicator carries the accent and
     the label carries `on-surface`
     (`SecondaryNavigationTabTokens.ActiveLabelTextColor`). Giving the label the
     accent as well leaves the row with no ink hierarchy, only two weights of pink.
     `pill` and `rail` have no bar — their indicator *is* a container — so the
     selected item takes a container pair, and in this app that pair is
     `secondary-container`: the sidebar's current route, a chosen `Select` option, a
     selected `Chip`, the current contact. Read as `on-surface` on a plain
     `surface-raised` pill the selected tab had no state colour at all, which is
     what made the floating home switch look unfinished.
     `tone="warning"` keeps an accent on the underline set because it marks a tab
     group that is *about* a warning (/tasks) — a deliberate divergence. */
  const activeInk =
    variant === 'underline'
      ? tone === 'warning'
        ? 'text-warning'
        : 'text-on-surface'
      : 'text-on-secondary-container';
  const indicatorFill = tone === 'warning' ? 'bg-warning-fill' : 'bg-primary';

  const tabButtons = tabs.map((tab, index) => {
    const selected = value === tab.value;
    return (
      <button
        key={tab.value}
        ref={(el) => {
          buttons.current[index] = el;
        }}
        data-tab={tab.value}
        data-ripple
        id={tabId(tab.value)}
        role="tab"
        type="button"
        aria-selected={selected}
        /* Only on the selected tab, and that is on the merits rather than a
           compromise. An inactive `TabPane` is `display: none`, so it is not in
           the accessibility tree and a reference to it resolves to nothing; and
           /admin mounts only the pane it is showing, so a reference to the other
           thirteen would dangle outright — which axe reports and AT cannot
           follow. The selected tab is the one whose panel the user is about to
           enter, and it always exists. */
        aria-controls={selected ? (panelId ?? tabPanelId)(tab.value) : undefined}
        /* Roving: one tab stop for the whole group. */
        tabIndex={selected ? 0 : -1}
        onClick={() => onChange(tab.value)}
        onKeyDown={onKeyDown}
        className={cn(
          'relative flex shrink-0 cursor-pointer items-center gap-2 outline-none transition-ui',
          'focus-visible:ring-2 focus-ring',
          /* 48dp, M3's tab height. `underline` had `py-3`, which came out at
             about 44 — near the right answer and on no scale. The `pill`'s own
             rows are 40dp because they sit inside a 48dp container that carries
             4dp of padding, which is what makes the pill concentric. */
          variant === 'underline' && 'h-12 px-4',
          variant === 'pill' && 'z-10 h-10 rounded-full px-5',
          variant === 'rail' && 'h-12 w-full rounded-full px-4 text-left whitespace-nowrap',
          /* `title-small`, which is `PrimaryNavigationTabTokens.LabelTextFont` and
             `SecondaryNavigationTabTokens.LabelTextFont` alike. Worth knowing that
             this is a *naming* fix and nothing else: in M3 `TitleSmall` and
             `LabelLarge` are the same four values (14sp / 20sp line height / 0.1
             tracking / Medium), and their emphasized twins are both Bold — this
             app's `--text-title-s` and `--text-label-l` are byte-identical too. So
             the pixels do not move; the role now matches the one the spec names for
             a tab, which is what makes it greppable.
             The role lives in the branches, never above them: a selected tab used to
             add a bare medium-weight utility on top of `text-label-l`, whose own
             token is already 500 — so the active tab got no weight contrast at all,
             only colour. Both roles must not be emitted on one element (`cn` is a
             plain join and resolves nothing), so each branch names exactly one. */
          selected ? 'text-title-s-emphasized' : 'text-title-s',
          /* The `rail` paints its own container because it has no sliding
             indicator to paint one for it; `pill` gets the fill from the indicator
             behind it and only needs the ink. Both end up on the same pair. */
          selected
            ? cn(variant === 'rail' && 'bg-secondary-container', activeInk)
            : 'text-on-surface-variant state-layer hover:text-on-surface',
        )}
      >
        {tab.icon && (
          /* A fixed, centred cell rather than a bare glyph: an inline <svg> sits
             on the text baseline and inherits the line box, so each icon lands a
             fraction low and by a different amount per glyph. */
          <span className="grid shrink-0 place-items-center [&>svg]:block" aria-hidden="true">
            {tab.icon}
          </span>
        )}
        <span className={variant === 'rail' ? 'min-w-0 flex-1 truncate' : undefined}>
          {tab.label}
        </span>
        {/* `CountBadge`, not a fourth copy of the `99+` clamp. */}
        <CountBadge count={tab.badge ?? 0} />
      </button>
    );
  });

  if (variant === 'rail') {
    return (
      <div
        ref={containerRef}
        role="tablist"
        aria-label={label}
        aria-orientation="vertical"
        className={cn('flex gap-1 overflow-x-auto md:flex-col', 'scrollbar-hide', className)}
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
          'bg-surface-container-high relative flex items-center gap-1 rounded-full p-1 shadow-e2',
          className,
        )}
      >
        <span
          ref={indicatorRef}
          aria-hidden="true"
          /* `secondary-container`, the app's "selected" pair, rather than the
             `surface-raised` house token — which is a *tone* and carries no state
             meaning, so the pill read as a blank white lozenge. Its ink is
             `on-secondary-container`, from `activeInk` above.
             The shadow goes with it: a selected segment is not a floating surface,
             it is a filled container inside one, and M3 puts no elevation on it. */
          className="bg-secondary-container absolute top-1 bottom-1 left-0 z-0 rounded-full"
        />
        {tabButtons}
      </div>
    );
  }

  return (
    <div className={cn('border-outline-variant border-b', className)}>
      <div
        ref={containerRef}
        role="tablist"
        aria-label={label}
        /* The row scrolls horizontally rather than wrapping: several tab sets
           here are four Chinese labels wide plus badges, which overflowed a 390px
           viewport and pushed the indicator's measurement out of sync with what
           was visible. */
        className="scrollbar-hide relative flex overflow-x-auto"
      >
        <span
          ref={indicatorRef}
          aria-hidden="true"
          /* 2dp and full-width of the tab: M3's *secondary* tab indicator, which
             is what a row of plain labels is. The primary tab's 3dp bar is for a
             tab set with icons above the labels. */
          className={cn('absolute bottom-0 left-0 h-0.5 rounded-full', indicatorFill)}
        />
        {tabButtons}
      </div>
    </div>
  );
}
