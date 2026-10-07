import { type Metadata } from 'next';
import { cookies } from 'next/headers';
import { COOKIE_KEYS } from '@/lib/constants';
import { PrivacyTabHint } from './privacyTabHint';

export const metadata: Metadata = {
  title: '我的收藏',
};

/* The placeholder tab row is drawn on the server, which cannot read the device's 显示隐私空间;
   the settings sync mirrors it into a cookie for exactly this (FX-F9). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const showPrivacy = (await cookies()).get(COOKIE_KEYS.showPrivacyFaves)?.value === 'true';
  return <PrivacyTabHint value={showPrivacy}>{children}</PrivacyTabHint>;
}
