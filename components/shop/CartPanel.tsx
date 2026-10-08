'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { MdAdd, MdClose, MdRemove, MdShoppingCartCheckout, MdToll } from 'react-icons/md';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import IconButton from '@/components/IconButton';
import PresenceBlock from '@/components/PresenceBlock';
import PresenceList from '@/components/PresenceList';
import Skeleton from '@/components/Skeleton';
import { statusViewBox } from '@/components/StatusView';
import { buttonClasses } from '@/components/buttonStyles';
import { formatExactCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { shortfall, type CartEntry, type CartSummary } from './cartModel';
import { MAX_LINE_QUANTITY } from './cartStore';
import FollowHeight from '@/components/FollowHeight';
import { ItemThumb } from './ShopItemCard';

interface CartPanelProps {
  /** `null` while the shop's answer has not landed: the lines cannot be priced yet. */
  summary: CartSummary | null;
  /** The shop's answer failed, so the lines cannot be priced at all (the item list says why). */
  itemsFailed: boolean;
  /** Lines stored, for the placeholder's length. */
  storedLines: number;
  balance: number | null;
  /** A checkout is running: 结算 is busy, and the lines cannot change under the purchase. */
  busy: boolean;
  onQuantity: (id: number, quantity: number, limit: number) => void;
  onRemove: (id: number) => void;
  onCheckout: () => void;
  /** Where the surface's own heading goes: the docked panel has one, the sheet's is its title. */
  heading?: React.ReactNode;
  /** The container tone the panel sits on, for its sticky footer to match. */
  surface: 'docked' | 'sheet';
}

/**
 * The rows' dividers, between rows that stay. A row on its way out (`PresenceList` makes it
 * `inert`) is out of the run at once, so the row that will follow it is drawn as it will be — a
 * divider kept on the row after a leaver used to vanish a frame after the fade, and a leaver's own
 * kept the cut it had above a row that had already moved up.
 */
const DIVIDED = '[&>li]:border-outline-variant [&>li:not([inert])~li:not([inert])]:border-t';

/** `−  2  +`: two 32dp controls either side of the count, the count read out as it changes. */
function Stepper({
  name,
  quantity,
  limit,
  locked,
  onChange,
}: {
  name: string;
  quantity: number;
  limit: number;
  locked: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div role="group" aria-label={`${name} 的数量`} className="flex items-center gap-1">
      <IconButton size="sm" aria-label="减少一件" icon={<MdRemove />} disabled={locked || quantity <= 1} onClick={() => onChange(quantity - 1)} />
      <span className="min-w-8 text-center text-label-l-emphasized text-on-surface tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <IconButton
        size="sm"
        aria-label="增加一件"
        icon={<MdAdd />}
        disabled={locked || quantity >= Math.min(limit, MAX_LINE_QUANTITY)}
        onClick={() => onChange(quantity + 1)}
      />
    </div>
  );
}

/**
 * One line, in one structure whatever its numbers (D1-016): the picture beside two rows — the
 * name and what a piece costs with the cross at the end of the first, the stepper and the line's
 * total at the end of the second. The second row spans the text column and the cross's, so an
 * exact eight-digit total still sits beside the stepper in the docked panel's 320dp; only an
 * absurd one wraps, under it and still at the end. A line the shop can no longer sell has the
 * first row alone.
 */
function EntryRow({
  presenceKey,
  entry,
  locked,
  onQuantity,
  onRemove,
}: { presenceKey: string; entry: CartEntry; locked: boolean } & Pick<CartPanelProps, 'onQuantity' | 'onRemove'>) {
  const name = entry.kind === 'gone' ? entry.line.name || `商品 #${entry.line.id}` : entry.item.name;
  /* Three states, three voices (G3-024): a refusal is an error; a quantity the app lowered to the
     stock is a warning — still buyable, but not what was asked for; a price is supporting text. */
  let note: { text: string; tone: 'variant' | 'warning' | 'error' };
  if (entry.kind === 'gone') note = { text: '该商品已下架，无法购买', tone: 'error' };
  else if (entry.kind === 'sold-out') note = { text: '已售罄，无法购买', tone: 'error' };
  else if (entry.adjusted) note = { text: `库存仅剩 ${entry.quantity} 件，已按库存计算`, tone: 'warning' };
  else note = { text: `${formatExactCount(entry.item.price)} 金币/件`, tone: 'variant' };

  return (
    <li data-presence-key={presenceKey} className="flex items-start gap-3 py-3">
      {entry.kind === 'gone' ? (
        <div className="size-12 shrink-0 rounded-sm bg-surface-container-highest" aria-hidden="true" />
      ) : (
        <ItemThumb item={entry.item} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 wrap-anywhere text-body-m text-on-surface">{name}</p>
            <p
              className={cn(
                'text-body-s',
                note.tone === 'error' ? 'text-error' : note.tone === 'warning' ? 'text-warning' : 'text-on-surface-variant',
              )}
            >
              {note.text}
            </p>
          </div>
          <IconButton
            size="sm"
            dismiss
            aria-label={`移除 ${name}`}
            icon={<MdClose />}
            disabled={locked}
            onClick={() => onRemove(entry.line.id)}
          />
        </div>
        {entry.kind === 'ok' && (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Stepper
              name={name}
              quantity={entry.quantity}
              limit={entry.item.stock ?? MAX_LINE_QUANTITY}
              locked={locked}
              onChange={(next) => onQuantity(entry.item.id, next, entry.item.stock ?? MAX_LINE_QUANTITY)}
            />
            <span className="ml-auto text-label-l-emphasized whitespace-nowrap text-on-surface tabular-nums">
              {formatExactCount(entry.item.price * entry.quantity)} 金币
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

type FooterPart = { key: 'totals' } | { key: 'shortfall'; short: number } | { key: 'checkout' };

/**
 * What 结算 stands on: the total against the balance, the shortfall, and the button.
 *
 * The shortfall comes and goes as the total crosses the balance — a line removed, a quantity
 * changed — so the footer's three parts are a presence list of their own: the shortfall fades in
 * or out where it stands, saying what it last said, while 结算 glides by its height. Appearing or
 * vanishing in the commit, it moved 结算 40px in a frame, and inside a bottom-anchored sheet the
 * button then drifted back as the surface settled.
 */
function CartFooter({
  summary,
  balance,
  busy,
  tone,
  onCheckout,
}: { summary: CartSummary; balance: number | null; busy: boolean; tone: string; onCheckout: () => void }) {
  const short = shortfall(summary.total, balance);
  const parts: FooterPart[] = [{ key: 'totals' }, ...(short > 0 ? [{ key: 'shortfall', short } as const] : []), { key: 'checkout' }];
  return (
    <PresenceList items={parts} getKey={(part) => part.key} variant="list">
      {(entries, ref) => (
        /* On the surface's own tone, so lines scrolling under it do not show through. */
        <div ref={ref} className={cn('sticky bottom-0 mt-2 border-t border-outline-variant pt-3 pb-1', tone)}>
          {entries.map(({ item: part, key }) => {
            if (part.key === 'totals') {
              return (
                <dl key={key} data-presence-key={key} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-body-m text-on-surface-variant">合计（{summary.pieces} 件）</dt>
                    <dd className="inline-flex items-center gap-1 text-title-m-emphasized whitespace-nowrap text-on-surface tabular-nums">
                      <MdToll size={ICON.dense} className="self-center text-primary-ink" aria-hidden="true" />
                      {formatExactCount(summary.total)} 金币
                    </dd>
                  </div>
                  {balance !== null && (
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-body-s text-on-surface-variant">我的金币</dt>
                      <dd className="text-body-s text-on-surface-variant tabular-nums">{formatExactCount(balance)}</dd>
                    </div>
                  )}
                </dl>
              );
            }
            if (part.key === 'shortfall') {
              return (
                <div key={key} data-presence-key={key} className="pt-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="text-body-s text-error" role="status">
                      金币不足，还差 {formatExactCount(part.short)} 金币
                    </p>
                    <Link scroll={false} href="/tasks" className={buttonClasses({ variant: 'text', size: 'xs' })}>
                      去做任务赚金币
                    </Link>
                  </div>
                </div>
              );
            }
            return (
              <div key={key} data-presence-key={key} className="pt-3">
                <Button
                  variant="filled"
                  fullWidth
                  icon={<MdShoppingCartCheckout />}
                  loading={busy}
                  /* Never native `disabled` while busy: that drops the focus the busy button holds. */
                  disabled={!busy && (summary.pieces === 0 || short > 0)}
                  onClick={onCheckout}
                >
                  结算
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </PresenceList>
  );
}

/**
 * The placeholder in the shape of what will land, so the landing changes the surface as little as
 * the content allows: the lines and the footer for a stored cart, the empty state's two lines for
 * an empty one. No `data-page-loading`: the item list's own placeholder holds the footer.
 */
function CartSkeleton({ storedLines, tone }: { storedLines: number; tone: string }) {
  if (storedLines === 0) {
    return (
      <div className={statusViewBox('inline')} aria-hidden="true">
        <div className="text-body-m"><Skeleton className="inline-block h-3 w-24 align-middle" /></div>
        <div className="text-body-m"><Skeleton className="inline-block h-3 w-36 align-middle" /></div>
      </div>
    );
  }
  return (
    <div aria-hidden="true">
      <ul className={DIVIDED}>
        {Array.from({ length: Math.min(storedLines, 4) }, (_, index) => (
          <li key={index} className="flex items-start gap-3 py-3">
            {/* The thumbnail's own corner (G3-021). */}
            <Skeleton className="size-12 shrink-0 rounded-sm" delay={index * 60} />
            <div className="min-w-0 flex-1">
              <div className="text-body-m"><Skeleton className="inline-block h-3 w-2/3 align-middle" delay={index * 60} /></div>
              <div className="text-body-s"><Skeleton className="inline-block h-2.5 w-1/3 align-middle" delay={index * 60} /></div>
              <div className="mt-1 flex h-8 items-center justify-between gap-3">
                <Skeleton className="h-8 w-26 rounded-full" delay={index * 60} />
                <Skeleton className="h-3 w-14" delay={index * 60} />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className={cn('mt-2 border-t border-outline-variant pt-3 pb-1', tone)}>
        <div className="flex h-6 items-center justify-between">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="mt-1 flex h-4.5 items-center justify-between">
          <Skeleton className="h-2.5 w-12" />
          <Skeleton className="h-2.5 w-10" />
        </div>
        <Skeleton className="mt-3 h-10 w-full rounded-full" />
      </div>
    </div>
  );
}

/**
 * The cart's content — lines, the total and 结算 — for either surface that holds it: the docked
 * panel beside the items on a wide column, the bottom sheet on a narrow one.
 *
 * **The total is stated against the balance before anything is pressed**: 结算 is unavailable
 * (native `disabled` — it genuinely cannot run) with the shortfall said beside it, rather than
 * discovered as the backend's refusal after the confirmation. A line the shop can no longer sell
 * (sold out, withdrawn) stays visible and out of the total until it is removed, so nothing leaves
 * the cart without the user seeing it go.
 *
 * **Lines come and go in place** (M1-015): a removed line fades where it stood while the lines
 * under it and the footer glide up, an added one fades in where it lands (`PresenceList`); the
 * last line leaving fades the list and its footer out over the empty state arriving on the
 * pane-swap clock, and the first line arriving does the same the other way (`PresenceBlock`).
 * The surface follows: the docked card's edge and the sheet's top travel with the content
 * (`FollowHeight`) instead of snapping to it.
 *
 * **The money is exact** (G3-001): `formatExactCount` on every price, total, balance and shortfall
 * — a purchase confirmation that says 1.2万 cannot be checked against a ledger that says 12,345.
 *
 * While a checkout runs the lines are locked: what is being bought was read when it started, and
 * a quantity changed under it would be shown as bought.
 */
export default function CartPanel({
  summary,
  itemsFailed,
  storedLines,
  balance,
  busy,
  onQuantity,
  onRemove,
  onCheckout,
  heading,
  surface,
}: CartPanelProps) {
  const footerTone = surface === 'sheet' ? 'bg-surface-container-low' : 'bg-surface-container-highest';
  const face = summary === null ? null : summary.entries.length === 0 ? 'empty' : 'list';

  /* Where the focus goes when the line that held it leaves with no line beside it (N2): the docked
     panel's own heading, or the sheet's title — inside the surface the focus was in, never the
     document (in the sheet, never outside the modal). A landing, as after a docked checkout. */
  const rootRef = useRef<HTMLDivElement>(null);
  const landing = () => {
    const root = rootRef.current;
    if (!root) return null;
    const heading = root.querySelector<HTMLElement>(':scope > h2');
    if (heading) return heading;
    const dialog = root.closest<HTMLElement>('[role="dialog"]');
    const title = dialog?.getAttribute('aria-labelledby');
    return (title ? document.getElementById(title) : null) ?? dialog;
  };

  /* A face that replaces the other in answer to a change arrives on the pane-swap clock; the one
     the cart lands on when the shop's answer comes is simply there. */
  const [shownFace, setShownFace] = useState(face);
  const [arrived, setArrived] = useState<'list' | 'empty' | null>(null);
  if (shownFace !== face) {
    setShownFace(face);
    if (shownFace !== null && face !== null) setArrived(face);
  }

  let body: React.ReactNode;
  if (summary === null && itemsFailed) {
    body = <p className="py-3 text-body-m text-on-surface-variant">商品信息未能加载，暂时无法结算</p>;
  } else if (summary === null) {
    body = <CartSkeleton storedLines={storedLines} tone={footerTone} />;
  } else {
    const entries = summary.entries;
    body = (
      <>
        <PresenceBlock show={entries.length > 0} fallbackFocus={landing}>
          <div className={cn(arrived === 'list' && 'animate-page-transition')}>
            <PresenceList items={entries} getKey={(entry) => entry.line.id} variant="list" fallbackFocus={landing}>
              {(rows, ref) => (
                <ul ref={ref} aria-label="购物车中的商品" className={DIVIDED}>
                  {rows.map(({ item: entry, key }) => (
                    <EntryRow
                      key={key}
                      presenceKey={key}
                      entry={entry}
                      locked={busy}
                      onQuantity={onQuantity}
                      onRemove={onRemove}
                    />
                  ))}
                </ul>
              )}
            </PresenceList>
            <CartFooter summary={summary} balance={balance} busy={busy} tone={footerTone} onCheckout={onCheckout} />
          </div>
        </PresenceBlock>
        <PresenceBlock show={entries.length === 0}>
          <div className={cn(arrived === 'empty' && 'animate-page-transition')}>
            {/* Its entrance stands down where it replaces the list: that swap is the press's
                answer, faded on the pane-swap clock, not an entrance the app volunteers. */}
            <EmptyState size="inline" entrance={arrived !== 'empty'} title="购物车是空的" description="在商品上点「加入购物车」" />
          </div>
        </PresenceBlock>
      </>
    );
  }

  return (
    <FollowHeight>
      <div ref={rootRef} className="flex min-h-0 flex-col">
        {heading}
        {/* Positioned: a face on its way out leaves where it stood, out of the flow. */}
        <div className="relative">{body}</div>
      </div>
    </FollowHeight>
  );
}
