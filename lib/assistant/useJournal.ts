'use client';
import { useSyncExternalStore } from 'react';
import { JOURNAL_EVENT, readJournalText } from './journal';

function subscribe(listener: () => void) {
  window.addEventListener(JOURNAL_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(JOURNAL_EVENT, listener); window.removeEventListener('storage', listener); };
}
export function useJournalText(accountId: string, suffix: string): string | null {
  return useSyncExternalStore(subscribe, () => readJournalText(accountId, suffix), () => null);
}
