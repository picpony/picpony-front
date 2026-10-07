'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { MdReceiptLong, MdShoppingCart, MdStorefront, MdToll } from 'react-icons/md';
import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import PageHeader from '@/components/PageHeader';
import { buttonClasses } from '@/components/buttonStyles';
import { useAuthModal } from '@/components/AuthModal';
import { useConfirm } from '@/components/ConfirmDialog';
import { showToast } from '@/components/Toast';
import type { ShopItem } from '@/lib/api/shop';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import { focusLanding } from '@/lib/focusLanding';
import { formatExactCount } from '@/lib/format';
import { readToken, useSession } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { SKIP, useResource } from '@/lib/resource';
import { sessionUser, shopItems } from '@/lib/resources';
import CartBar from './CartBar';
import CartPanel from './CartPanel';
import { cartPieces, resolveCart, shortfall, type CartSummary } from './cartModel';
import { addToCart, CART_STORAGE_REFUSED, cartAccount, MAX_LINE_QUANTITY, removeFromCart, setCartQuantity, useCart } from './cartStore';
import { balanceOf, runCheckout } from './checkout';
import ShopItemCard, { ShopItemCardSkeleton, type ItemAction } from './ShopItemCard';

const loadCartSheet = () => import('@/components/Sheet');
const Sheet = dynamic(loadCartSheet, { ssr: false, loading: () => null });
const warmCartSheet = () => { void loadCartSheet().catch(() => {}); };

/** 金币明细, the account's coin ledger (D2's screen under /tasks): where a purchase is recorded. */
const TRANSACTIONS_HREF = '/tasks/coins';

/**
 * The column width, in rem, from which the cart sits beside the items instead of in a sheet —
 * the same `@4xl` step of the `shop` container the layout's classes use, so the two cannot
 * disagree.
 */
const DOCKED_REM = 56;

/** What the cart sheet shows — held as it was while a checkout runs and while the sheet leaves. */
interface SheetView {
  summary: CartSummary | null;
  itemsFailed: boolean;
  storedLines: number;
  balance: number | null;
  busy: boolean;
}

/** How many placeholder cards a first load shows: a row and a half at every column count. */
const SKELETON_CARDS = 6;

/**
 * Whether the column is wide enough to dock the cart. The layout itself is CSS (a container
 * query); this only tells the sheet to stand down when the column grows past the step while it
 * is open, since the docked panel then shows the same cart.
 */
function useDocked(column: React.RefObject<HTMLDivElement | null>): boolean {
  const [docked, setDocked] = useState(false);
  useLayoutEffect(() => {
    const element = column.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setDocked(element.clientWidth >= DOCKED_REM * rem);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [column]);
  return docked;
}

/**
 * 金币商店 (decision 15): the items on sale, a cart, and the checkout.
 *
 * **Browsing needs no account**; buying does. Signed out, each item offers 登录后购买, which
 * opens the sign-in dialog when pressed — never on arrival (decision 4). Signed in, the cart is
 * the account's own (`cartStore`) and survives a reload.
 *
 * **The cart is a real surface**: on a wide column it is a panel docked beside the items, always
 * in view; on a narrow one a floating bar says what it holds and opens it as a bottom sheet.
 *
 * **Checking out** is confirmed with the total (`useConfirm`), stated against the balance before
 * anything is pressed, busy while it runs, and ends with the backend's own sentence (or 已购买) —
 * after which the balance, the stock, /tasks and the badge wall are all read again
 * (`runCheckout`). Every figure of money is exact (G3-001).
 *
 * **The sheet holds what it showed** while a checkout runs and while it leaves (M1-016): the
 * purchase takes its lines out of the cart before the sheet is told to close, and the sheet used
 * to flip to 购物车是空的 and collapse 267px in the frame it began to slide away. It shows the
 * cart as it last was while open and idle; a sheet opened again shows the live one from its
 * first frame, so the hold never needs releasing.
 */
export default function ShopScreen() {
  const { user, token, ready } = useSession();
  const { openAuth } = useAuthModal();
  const { confirm, confirmDialog } = useConfirm();
  const account = token ? cartAccount(user) : null;
  const read = useResource(shopItems, ready ? { token } : SKIP);
  const lines = useCart(account);
  const balance = token ? balanceOf(user) : null;
  const items = read.data;
  const summary = useMemo(() => (items ? resolveCart(lines, items) : null), [items, lines]);
  const badge = summary ? summary.shown : cartPieces(lines);

  const columnRef = useRef<HTMLDivElement>(null);
  const dockedHeadingRef = useRef<HTMLHeadingElement>(null);
  const dockedHeadingId = useId();
  const itemsHeadingId = useId();
  const docked = useDocked(columnRef);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMounted, setSheetMounted] = useState(false);
  if (sheetOpen && !sheetMounted) setSheetMounted(true);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  /* The items a docked checkout is buying, until they have left the cart and 结算 is idle again. */
  const landing = useRef<readonly number[] | null>(null);

  /* The balance is money: whatever the session says, ask the account again on arrival. The
     shell folds the answer back into storage, and this screen re-renders with it. */
  useEffect(() => {
    if (token) sessionUser.expire({ token });
  }, [token]);

  /* Wide enough to dock: the panel shows the same cart, so the sheet goes. Adjusted during render
     (the documented pattern for state that follows a value), so no frame shows both. */
  if (docked && sheetOpen) setSheetOpen(false);
  /* Signed out while the sheet was open (another tab, an expired session): nothing to show. */
  if (!account && sheetOpen) setSheetOpen(false);

  /* The sheet's content: the live cart while the sheet is open and idle, else the last of it. A
     checkout's purchase empties the cart in a render of its own before the sheet is closed, and
     signing out empties it in the render that closes the sheet — neither may reach a sheet that
     is busy or leaving. */
  const itemsFailed = items === undefined && read.error !== undefined;
  const sheetLive = sheetOpen && !busy && Boolean(account) && !docked;
  const [sheetView, setSheetView] = useState<SheetView>({ summary, itemsFailed, storedLines: lines.length, balance, busy });
  if (
    sheetLive &&
    (sheetView.summary !== summary ||
      sheetView.itemsFailed !== itemsFailed ||
      sheetView.storedLines !== lines.length ||
      sheetView.balance !== balance ||
      sheetView.busy)
  ) {
    setSheetView({ summary, itemsFailed, storedLines: lines.length, balance, busy: false });
  }
  const sheetShows: SheetView = sheetLive
    ? { summary, itemsFailed, storedLines: lines.length, balance, busy }
    : sheetOpen
      ? { ...sheetView, busy }
      : sheetView;

  const actionFor = (item: ShopItem): ItemAction => {
    if (item.stock !== null && item.stock <= 0) return { kind: 'sold-out' };
    if (!token || !account) return { kind: 'sign-in', onSignIn: () => openAuth('login') };
    /* A stock the shop did not state is no limit but the cart's own (G2-023): the checkout's
       answer is the backend's to give. */
    const limit = item.stock ?? MAX_LINE_QUANTITY;
    const inCart = lines.find((line) => line.id === item.id)?.quantity ?? 0;
    if (inCart >= limit) return { kind: 'full' };
    return {
      kind: 'add',
      onAdd: () => {
        if (addToCart(account, item, limit) === null) {
          showToast(CART_STORAGE_REFUSED, 'error');
          return;
        }
        showToast(
          '已加入购物车',
          'success',
          docked ? undefined : { action: { label: '查看', onClick: () => setSheetOpen(true) } },
        );
      },
    };
  };

  const checkout = async () => {
    if (running.current || !token || !account || !summary || summary.pieces === 0) return;
    if (shortfall(summary.total, balance) > 0) return;
    const confirmed = await confirm({
      title: '确认结算',
      message: `确定要花费 ${formatExactCount(summary.total)} 金币购买 ${summary.pieces} 件商品吗？`,
      tone: 'filled',
    });
    if (!confirmed || running.current) return;
    running.current = true;
    setBusy(true);
    /* Marked before the request: the purchase takes its lines out of the cart inside it, and that
       commit may land before this function resumes. */
    if (docked) landing.current = summary.purchasable.map(({ item }) => item.id);
    const outcome = await runCheckout(token, account, summary.purchasable);
    running.current = false;
    setBusy(false);
    if (outcome.kind !== 'done') landing.current = null;
    /* Withheld before any request (G3-022): said as itself, never as 结算失败 — and said even
       though the session moved, since that is the very thing to say. */
    if (outcome.kind === 'stale-session') {
      showToast(outcome.message, 'warning');
      return;
    }
    if (readToken() !== token) return;
    if (outcome.kind !== 'done') {
      showToast(outcome.kind === 'refused' ? `结算失败：${outcome.message}` : outcome.message, 'error');
      return;
    }
    showToast(outcome.message, 'success');
    /* The sheet leaves showing what it bought, its 结算 still busy: nothing changes as it goes. */
    setSheetView((view) => ({ ...view, busy: true }));
    setSheetOpen(false);
  };

  /* After a docked checkout the panel's 结算 held the focus, and it is gone with the lines (made
     inert in the commit that takes them out) or, with an unbuyable line left, disabled: the
     panel's heading takes the focus — a landing, so no ring — and the keyboard stays in the cart
     it was in. Decided in the commit that takes the bought lines out (and, while 结算 is still
     busy in it, again in the one that frees it): a frame later the focus had already fallen to the
     document, so a check for "on the document" found it still on the inert button and let it
     fall. A focus put anywhere live is left alone, and the confirmation's own later return of
     focus then keeps it (`lib/overlay.ts`). */
  useLayoutEffect(() => {
    const bought = landing.current;
    if (!bought || lines.some((line) => bought.includes(line.id))) return;
    const heading = dockedHeadingRef.current;
    const panel = heading?.closest('aside');
    const active = document.activeElement;
    const lost =
      !(active instanceof HTMLElement) ||
      active === document.body ||
      Boolean(panel?.contains(active) && (active.closest('[inert]') || active.matches(':disabled')));
    if (!lost && busy) return;
    landing.current = null;
    if (heading && lost) focusLanding(heading);
  }, [lines, busy]);

  /* A write storage refuses changes nothing and says why, as 加入购物车 does (G3-006). */
  const handlers = {
    onQuantity: (id: number, quantity: number, limit: number) => {
      if (account && !setCartQuantity(account, id, quantity, limit)) showToast(CART_STORAGE_REFUSED, 'error');
    },
    onRemove: (id: number) => {
      if (account && !removeFromCart(account, [id])) showToast(CART_STORAGE_REFUSED, 'error');
    },
    onCheckout: () => void checkout(),
  };

  let content: React.ReactNode;
  if (!ready || (items === undefined && read.error === undefined)) {
    content = (
      <div data-page-loading className="grid grid-cols-2 gap-3 @xl/items:grid-cols-3 @3xl/items:grid-cols-4">
        {Array.from({ length: SKELETON_CARDS }, (_, index) => (
          <ShopItemCardSkeleton key={index} index={index} />
        ))}
      </div>
    );
  } else if (items === undefined) {
    content = (
      <ErrorRetry
        size="pane"
        title="商品加载失败"
        message={apiErrorMessage(read.error)}
        onRetry={isRetryable(read.error) ? read.refresh : undefined}
      />
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        size="pane"
        icon={<MdStorefront size={ICON.display} />}
        title="暂无在售商品"
        description="新的商品上架后会显示在这里"
      />
    );
  } else {
    content = (
      /* Named by the section's heading, not twice. */
      <ul className="grid grid-cols-2 gap-3 @xl/items:grid-cols-3 @3xl/items:grid-cols-4">
        {items.map((item) => (
          /* A grid of its own, so the card fills the cell and a row's cards share one height. */
          <li key={item.id} className="grid">
            <ShopItemCard
              item={item}
              inCart={lines.find((line) => line.id === item.id)?.quantity ?? 0}
              action={actionFor(item)}
            />
          </li>
        ))}
      </ul>
    );
  }

  const cartLabel = badge > 0 ? `购物车，${badge} 件商品` : '购物车';

  return (
    <div ref={columnRef} className="@container/shop mx-auto w-full max-w-7xl">
      <PageHeader
        title="金币商店"
        subtitle={ready && !token ? '登录后即可用金币兑换商品' : undefined}
        actions={
          token ? (
            /* One block, which below the column's md step (28rem) is as wide as the column, so it
               always takes a row of its own there, and from the step on always shares the title's:
               the header's shape is the column's, never the balance's (N1). Laid out by its
               content, one more digit pushed 金币明细 onto a second row — the header 84px tall in
               the frame a purchase landed, and the page clamped 44px under the leaving sheet. At
               the step the title and a ten-digit balance need 447px of the 448. */
            <div className="flex flex-wrap items-center gap-2 @max-md/shop:w-[100cqw]">
              {balance !== null && (
                <span className="inline-flex h-10 items-center gap-1.5 text-body-m text-on-surface-variant">
                  <MdToll size={ICON.control} className="text-primary-ink" aria-hidden="true" />
                  {/* One run of text: the full-width colon carries its own space, and the row's gap
                      after it read as a double one (D1-016). In a column under 21rem the words are
                      left to the glyph and to a screen reader, as a narrow item card leaves a
                      price's unit: the words, a ten-digit balance and 金币明细 need 335px, and at
                      320 a longer balance put 金币明细 on a third line (132px against 84). */}
                  <span>
                    <span className="@max-[21rem]/shop:sr-only">我的金币：</span>
                    <span className="text-title-m-emphasized text-on-surface tabular-nums">{formatExactCount(balance)}</span>
                  </span>
                </span>
              )}
              <Link scroll={false} href={TRANSACTIONS_HREF} className={buttonClasses({ variant: 'text' })}>
                <MdReceiptLong aria-hidden="true" />
                金币明细
              </Link>
            </div>
          ) : ready ? (
            <Button variant="filled" onClick={() => openAuth('login')}>
              登录
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-start gap-6">
        {/* A real heading for the items (G3-003): the outline was the page's h1 straight to each
            card's h3, with the cart's h2 after the list. Visually it is the page title's. */}
        <section aria-labelledby={itemsHeadingId} className="@container/items min-w-0 flex-1">
          <h2 id={itemsHeadingId} className="sr-only">
            在售商品
          </h2>
          {content}
        </section>
        {account && (
          /* Docked beside the items on a wide column; below the step it is the sheet's. The card
             follows its content as lines come and go (`CartPanel`'s own box). */
          <aside aria-labelledby={dockedHeadingId} className="sticky top-6 hidden w-80 shrink-0 @4xl/shop:block">
            <Card variant="filled" padding="md">
              <CartPanel
                summary={summary}
                itemsFailed={itemsFailed}
                storedLines={lines.length}
                balance={balance}
                busy={busy}
                {...handlers}
                surface="docked"
                heading={
                  <h2
                    ref={dockedHeadingRef}
                    id={dockedHeadingId}
                    className="mb-1 flex items-center gap-2 text-title-m text-on-surface"
                  >
                    <MdShoppingCart size={ICON.standard} className="text-on-surface-variant" aria-hidden="true" />
                    购物车
                  </h2>
                }
              />
            </Card>
          </aside>
        )}
      </div>

      {account && (
        /* Narrow only: what the cart holds, floating over the list, and the way into it. It floats
           (e2) because it overlaps the items; at the list's end it rests in its own room after them. */
        <CartBar
          active={badge > 0}
          pieces={badge}
          summary={summary ? `合计 ${formatExactCount(summary.total)} 金币` : `${badge} 件商品`}
          label={`查看${cartLabel}`}
          onOpen={() => setSheetOpen(true)}
          onWarm={warmCartSheet}
        />
      )}

      {/* Behind its one-way latch, or `dynamic()` fetches the sheet's chunk at mount for a cart
          nobody opens (the latch was kept and never applied). */}
      {sheetMounted && (
        <Sheet isOpen={sheetOpen} onClose={() => setSheetOpen(false)} title="购物车">
          <CartPanel {...sheetShows} {...handlers} surface="sheet" />
        </Sheet>
      )}
      {confirmDialog}
    </div>
  );
}
