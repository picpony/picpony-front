import type { Metadata } from 'next';
import CoinLedger from './CoinLedger';

export const metadata: Metadata = { title: '金币明细' };

/** 金币明细 — the account's coin ledger. Token-gated, so everything is read in the browser. */
export default function CoinLedgerPage() {
  return <CoinLedger />;
}
