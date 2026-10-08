'use client';

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

/** 显示隐私空间 as the request's cookie said (`COOKIE_KEYS.showPrivacyFaves`); read by the layout. */
const Hint = createContext(false);

export function PrivacyTabHint({ value, children }: { value: boolean; children: ReactNode }) {
  return <Hint.Provider value={value}>{children}</Hint.Provider>;
}

const subscribe = () => () => {};

/**
 * Whether 我的收藏 offers its 隐私空间 tab — as the server knew it until hydration has run, the
 * live setting after. `useSyncedSetting`'s server value is the fallback, so the placeholder row the
 * server drew had two tabs, and for an account showing the space it became three the moment the
 * page hydrated (FX-F9). The cookie the settings sync mirrors gives the server the right count;
 * the hydration pass keeps it, so nothing is replaced, and the live value takes over after.
 */
export function useShowPrivacyTab(live: boolean): boolean {
  const hint = useContext(Hint);
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? live : hint;
}
