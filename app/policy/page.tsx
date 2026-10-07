import { isPolicyTab, type PolicyTab } from './address';
import PolicyScreen from './PolicyScreen';

/**
 * Server shell for /policy: it reads `?tab=` so a link to one document arrives on it (R7-038),
 * and the screen takes that as its first tab. The documents themselves are static.
 */
export default async function PolicyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { tab } = await searchParams;
  const initialTab: PolicyTab = isPolicyTab(tab) ? tab : 'cookie';
  return <PolicyScreen initialTab={initialTab} />;
}
