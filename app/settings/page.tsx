'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import Button from '@/components/Button';
import ErrorRetry from '@/components/ErrorRetry';
import { useAuthModal } from '@/components/AuthModal';
import PageHeader from '@/components/PageHeader';
import Skeleton from '@/components/Skeleton';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { useSession } from '@/lib/hooks';
import { isScreenQuiet, subscribeScreenQuiet } from '@/lib/overlay';
import { retrySettingsSync, useSettingsSyncState } from '@/lib/settingsSync';
import AccountPane from './AccountPane';
import PersonalisePane from './PersonalisePane';
import PreferencesPane from './PreferencesPane';
import { ROW_CLASS } from './SettingsRow';
import {
  dropQueuedSettingsAddress,
  isSettingsTab,
  landingTab,
  replaceSettingsAddress,
  settingsTabs,
  type SettingsTab,
} from './tabs';

const TAB_ROW_LABEL = '设置分区';
const noSubscription = () => () => {};
const notQuiet = () => false;

/**
 * /settings — 偏好 / 账户 / 个性化 (decision 23; see `tabs.ts` for what each holds and the signed-out
 * row). Split by what it holds: `PreferencesPane` (`LinesSection`), `AccountPane` and its dialogs,
 * `PersonalisePane` (`AppearanceSection`), `SettingsRow` (the one row anatomy), `useAccount`,
 * `identity`. The values are this device's and the account's, synced by `lib/settingsSync.ts`.
 *
 * The screen renders once the session is known: the server has neither the device's values nor
 * the session, so its render is the screen's shape — no tab row that could show a tab the visitor
 * is not offered, no defaults that would flip under the reader after hydration.
 */
export default function SettingsPage() {
  const { ready } = useSession();
  if (!ready) return <SettingsSkeleton />;
  return <SettingsScreen />;
}

function SettingsScreen() {
  const { token } = useSession();
  const { openAuth } = useAuthModal();
  const signedIn = token !== null;
  const tabParam = useSearchParams().get('tab');
  const requested = isSettingsTab(tabParam) ? tabParam : null;

  const [tab, setTab] = useState<SettingsTab>(() => landingTab(requested ?? 'preferences', signedIn));
  /* Signed out, a link into 账户 lands on 偏好 and is kept, to open once the visitor signs in. */
  const [pending, setPending] = useState<SettingsTab | null>(() =>
    !signedIn && requested && landingTab(requested, false) !== requested ? requested : null,
  );

  /* A link followed while the screen is up selects its tab (or lands, and is kept). */
  const [seen, setSeen] = useState(requested);
  if (seen !== requested) {
    setSeen(requested);
    if (requested && requested !== tab) {
      const landing = landingTab(requested, signedIn);
      setPending(landing === requested ? null : requested);
      setTab(landing);
    }
  }

  /* Signed in on the spot: the kept request opens once the sign-in dialog has gone, so the tab
     changes in view. */
  const quiet = useSyncExternalStore(signedIn && pending ? subscribeScreenQuiet : noSubscription, isScreenQuiet, notQuiet);
  if (signedIn && pending && quiet) {
    setPending(null);
    setTab(landingTab(pending, true));
  }

  /* The row never selects a tab it does not offer: signing out on 账户 lands on 偏好, and the
     choice is forgotten rather than waiting to reappear with the next sign-in. */
  if (landingTab(tab, signedIn) !== tab) setTab(landingTab(tab, signedIn));
  const shown = landingTab(tab, signedIn);

  /* The address names the tab on screen: corrected in place when it names one the row does not
     offer (or no tab at all), kept bare for 偏好 when it was bare. */
  useEffect(() => {
    const addressed = tabParam !== null;
    if (!addressed && shown === 'preferences') return;
    if (requested === shown) return;
    replaceSettingsAddress(shown);
  }, [shown, tabParam, requested]);
  useEffect(() => dropQueuedSettingsAddress, []);

  const select = (next: SettingsTab) => {
    setPending(null);
    setTab(next);
    replaceSettingsAddress(next);
  };

  const sync = useSettingsSyncState();

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title="设置"
        subtitle={signedIn ? '偏好与主题配色会随账号同步到你登录的设备' : '登录后，偏好与个性化设置会随账号同步'}
        /* 32dp, the title's own line height, so the header keeps its height when the action goes. */
        actions={
          signedIn ? undefined : (
            <Button size="xs" variant="tonal" onClick={() => openAuth('login')}>
              登录
            </Button>
          )
        }
      />
      {sync === 'failed' && (
        <div className="mb-4">
          <ErrorRetry
            size="inline"
            title="有设置尚未同步到账号"
            message="已保存在本设备，网络恢复后会自动重试"
            onRetry={retrySettingsSync}
          />
        </div>
      )}
      <Tabs tabs={settingsTabs(signedIn)} value={shown} onChange={select} label={TAB_ROW_LABEL} className="mb-6" />
      {/* Leaning: the three panes are static once mounted (AGENTS "lean"), and a pane still
          showing placeholders marks itself loading, which the lean stands down for. */}
      <TabPanes value={shown} lean>
        <TabPane value="preferences">
          <PreferencesPane onOpenAccount={() => select('account')} />
        </TabPane>
        {settingsTabs(signedIn).some((item) => item.value === 'account') && (
          <TabPane value="account">
            {/* One instance per account: a sign-in in another tab starts its dialogs afresh. */}
            <AccountPane key={token ?? 'signed-out'} />
          </TabPane>
        )}
        <TabPane value="personalise">
          <PersonalisePane signedIn={signedIn} />
        </TabPane>
      </TabPanes>
    </div>
  );
}

/** The screen's own shape while the session is unknown: header, tab row, rows. */
function SettingsSkeleton() {
  return (
    <div className="max-w-4xl mx-auto" data-page-loading>
      <PageHeader title="设置" subtitle={<span className="invisible">偏好与主题配色会随账号同步</span>} />
      <Skeleton className="mb-6 h-12 w-full rounded-sm" />
      {[4, 4].map((rows, section) => (
        <section key={section} className="mb-8">
          <Skeleton className="mb-4 h-7 w-28 rounded-xs" />
          <div>
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className={ROW_CLASS}>
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-32 rounded-xs" />
                  <Skeleton className="mt-1.5 h-3.5 w-48 max-w-full rounded-xs" />
                </div>
                <Skeleton className="h-8 w-13 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
