'use client';

import { useEffect } from 'react';
import { settingsSyncBridge } from '@/lib/resources';
import { bindSettingsSync } from '@/lib/settingsSync';

/**
 * Starts the settings sync (`lib/settingsSync.ts`) on every route once the app has mounted: from
 * then on it follows the session, adopts the account's settings from each account read and writes
 * this device's changes back. Renders nothing. Mounted by the root layout, beside the other
 * app-wide services, rather than bound where a module is evaluated.
 */
export default function SettingsSync() {
  useEffect(() => bindSettingsSync(settingsSyncBridge), []);
  return null;
}
