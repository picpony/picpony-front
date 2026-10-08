'use client';

import { MdAddShoppingCart, MdCardGiftcard, MdLogin, MdToll } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import FadeInImage from '@/components/FadeInImage';
import Skeleton from '@/components/Skeleton';
import type { ShopItem } from '@/lib/api/shop';
import { formatCount, formatExactCount } from '@/lib/format';
import { ICON } from '@/lib/icons';
import { cn, getAssetUrl } from '@/lib/utils';

/**
 * The part of an action's label a narrow card leaves out: below the width the whole of
 * 加入购物车 needs beside its glyph (an 8.125rem content box — 20 + 8 + 5 × 14 + 2 × 16) the button
 * says 加入 / 登录 / 已达上限 instead of truncating to 加入…, its whole name still its label (D1-005).
 * A container query on the card's own text column, since the column count, not the viewport,
 * decides the card's width.
 */
const NARROW_HIDDEN = '@max-[8.125rem]/card:hidden';

/**
 * In the same narrow card the price's unit is left to its glyph and to a screen reader: an exact
 * seven-digit price beside its unit was a line too wide for a 320px phone's column, its 金币 fell
 * to a second line, and that card's price sat a line above its neighbour's.
 */
const NARROW_UNSEEN = '@max-[8.125rem]/card:sr-only';

/** The widths a card takes: half a phone, then a quarter of the widest column. */
const CARD_SIZES = '(min-width: 1024px) 18rem, 50vw';

/**
 * A PicPony upload goes through the optimizer; any other host an administrator typed into the
 * item cannot (`images.remotePatterns` names `picpony.top` alone, and an unlisted host is a
 * render error in production), so it is shown as it is.
 */
export function shopImageProps(imageUrl: string): { src: string; unoptimized: boolean } | null {
  const src = getAssetUrl(imageUrl);
  if (!src) return null;
  try {
    return { src, unoptimized: new URL(src).hostname !== 'picpony.top' };
  } catch {
    return null;
  }
}

/** The item's picture in the card's square, or the gift glyph the original shop drew without one. */
function ItemPicture({ item, sizes }: { item: ShopItem; sizes: string }) {
  const picture = shopImageProps(item.imageUrl);
  if (!picture) {
    return (
      <div className="grid h-full w-full place-items-center text-on-surface-variant" aria-hidden="true">
        <MdCardGiftcard size={ICON.display} />
      </div>
    );
  }
  return <FadeInImage src={picture.src} unoptimized={picture.unoptimized} alt="" fill sizes={sizes} className="object-cover" />;
}

/** The item's picture at a cart line's 48dp. */
export function ItemThumb({ item }: { item: ShopItem }) {
  return (
    <div className="relative size-12 shrink-0 overflow-hidden rounded-sm bg-surface-container-highest">
      <ItemPicture item={item} sizes="48px" />
    </div>
  );
}

export type ItemAction =
  | { kind: 'add'; onAdd: () => void }
  | { kind: 'full' }
  | { kind: 'sold-out' }
  | { kind: 'sign-in'; onSignIn: () => void };

/**
 * One item on sale: its picture in a square, name, description, price and stock, and the one
 * action the item allows right now. Not a control as a whole — the button is the control, and
 * nothing else on the card answers a press.
 *
 * **Every card has one structure** (D1-005): the price on a line of its own — the glyph and the
 * exact number never broken apart, and in a narrow card the unit left to the glyph — then the
 * stock, then what the cart holds, then the action, each on its own line at every width. Side by
 * side, the stock wrapped under a long price in one card and not in its neighbour, and two prices
 * in one row sat 19px apart.
 *
 * Sold out is said once, by the action itself (D1-016): the stock line stays, empty, so the card
 * keeps its neighbours' shape. A stock the shop did not state is unknown, not none (G2-023): the
 * line stays empty in the same way, and the item can be bought.
 */
export default function ShopItemCard({
  item,
  inCart,
  action,
}: {
  item: ShopItem;
  /** Pieces of this item in the cart. */
  inCart: number;
  action: ItemAction;
}) {
  const soldOut = item.stock !== null && item.stock <= 0;
  return (
    <Card variant="filled" padding="none" className="flex flex-col overflow-hidden">
      <div className="relative aspect-square w-full bg-surface-container-high">
        <ItemPicture item={item} sizes={CARD_SIZES} />
      </div>
      <div className="@container/card flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 wrap-anywhere text-title-m text-on-surface">{item.name}</h3>
        {item.description && (
          <p className="mt-1 line-clamp-2 wrap-anywhere text-body-s text-on-surface-variant" title={item.description}>
            {item.description}
          </p>
        )}
        <div className="mt-auto pt-3">
          {/* One baseline, the number's: the glyph is centred on the line and takes no part in it,
              so the group's baseline is its number's, which the unit then shares (the row's used
              to be the glyph's bottom edge, 5px off the stock beside it). */}
          <p className="flex flex-wrap items-baseline gap-x-1">
            <span className="inline-flex items-baseline gap-1 text-title-m-emphasized whitespace-nowrap text-on-surface tabular-nums">
              <MdToll size={ICON.dense} className="self-center text-primary-ink" aria-hidden="true" />
              {formatExactCount(item.price)}
            </span>
            <span className={cn('text-body-s text-on-surface-variant', NARROW_UNSEEN)}>金币</span>
          </p>
          <p className="mt-1 min-h-4 text-label-m text-on-surface-variant tabular-nums">
            {item.stock === null || soldOut ? '' : `库存 ${formatCount(item.stock)}`}
          </p>
          {/* Not a live region: 加入购物车's own toast already says what happened, once. */}
          <p className="min-h-4 text-label-m text-on-surface-variant tabular-nums">
            {inCart > 0 ? `购物车中 ${inCart} 件` : ''}
          </p>
        </div>
        <div className="mt-2">
          {action.kind === 'add' && (
            <Button variant="tonal" fullWidth icon={<MdAddShoppingCart />} aria-label="加入购物车" onClick={action.onAdd}>
              加入<span className={NARROW_HIDDEN}>购物车</span>
            </Button>
          )}
          {action.kind === 'full' && (
            <Button variant="tonal" fullWidth disabled aria-label="已达库存上限">
              已达<span className={NARROW_HIDDEN}>库存</span>上限
            </Button>
          )}
          {action.kind === 'sold-out' && (
            <Button variant="tonal" fullWidth disabled>
              已售罄
            </Button>
          )}
          {action.kind === 'sign-in' && (
            <Button variant="tonal" fullWidth icon={<MdLogin />} aria-label="登录后购买" onClick={action.onSignIn}>
              登录<span className={NARROW_HIDDEN}>后购买</span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * A card's placeholder, in the card's own geometry: the square, the name, two lines of
 * description, then the price, stock and cart lines at their own line heights, and the button.
 */
export function ShopItemCardSkeleton({ index }: { index: number }) {
  const delay = (index % 4) * 60;
  return (
    <Card variant="filled" padding="none" className="flex flex-col overflow-hidden" aria-hidden="true">
      <Skeleton className="aspect-square w-full rounded-none" delay={delay} />
      <div className="flex flex-1 flex-col p-4">
        <Skeleton className="h-6 w-3/4" delay={delay} />
        {/* Two lines of the description's `body-s`, the height it usually takes. */}
        <div className="mt-1 flex h-9 flex-col justify-center gap-2">
          <Skeleton className="h-3 w-full" delay={delay} />
          <Skeleton className="h-3 w-2/3" delay={delay} />
        </div>
        <div className="pt-3">
          <div className="flex h-6 items-center">
            <Skeleton className="h-5 w-16" delay={delay} />
          </div>
          <div className="mt-1 flex h-4 items-center">
            <Skeleton className="h-3 w-12" delay={delay} />
          </div>
          <div className="min-h-4" />
        </div>
        <Skeleton className="mt-2 h-10 w-full rounded-full" delay={delay} />
      </div>
    </Card>
  );
}
