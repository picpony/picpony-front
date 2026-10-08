'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { getSavedSiteStatus, getServerSiteStatus, subscribeSavedSiteStatus } from '@/lib/siteStatus';
import type { SemanticSearchConfig } from '@/lib/semanticConfig';

function useSavedStatus() {
  return useSyncExternalStore(subscribeSavedSiteStatus, getSavedSiteStatus, getServerSiteStatus);
}

export function useMaintenanceStatus(initial: boolean): boolean {
  return useSavedStatus().maintenance ?? initial;
}

export function useSemanticConfig(initial: SemanticSearchConfig): SemanticSearchConfig {
  const patch = useSavedStatus().semantic;
  return useMemo(() => patch ? { ...initial, ...patch } : initial, [initial, patch]);
}
