import { cache } from 'react';
import { cookies } from 'next/headers';
import { SITE_STATUS_CACHE_TAG } from '@/lib/constants';
import { cacheSeconds } from '@/lib/serverMemo';
import { upstreamOrigin } from '@/lib/upstream.server';
import {
  parseBlockFilters,
  parsePublicBlacklist,
  PUBLIC_BLACKLIST_PAGE_LIMIT,
  type BlockFilters,
  type PublicBlacklist,
  type PublicBlacklistPage,
} from '@/lib/blockFilters';
import {
  BLOCK_FILTERS_CACHE_TAG,
  PUBLIC_BLACKLIST_CACHE_TAG,
  setRequestBootstrap,
} from '@/lib/blockFilters.server';
import { readRoutePolicyOnce, setRequestRoutePolicy } from '@/lib/imageLine.server';
import { readMaintenance, type MaintenanceState } from '@/lib/maintenance.server';
import type { InlineRoutePolicy } from '@/lib/route.server';

/**
 * Consolidated SSR public startup read (`GET /api/v1/bootstrap`, `site::bootstrap`): fetches
 * routing policy, maintenance status, system block-tag definitions and page 1 of the public image
 * blocklist in one round-trip, tagged with all three invalidation tags so any admin write through
 * `/api/v1/[...path]` expires it immediately. Falls back transparently to the individual endpoints
 * when talking to an older backend that lacks `/api/v1/bootstrap`.
 */

const BOOTSTRAP_TIMEOUT_MS = 1500;
const BOOTSTRAP_REVALIDATE_S = 30;
const MAX_MESSAGE_LENGTH = 500;
const DEV_PREVIEW_COOKIE = 'devMaintenancePreview';
const UPSTREAM_ORIGIN = upstreamOrigin();

export interface SiteBootstrap {
  routePolicy: InlineRoutePolicy;
  maintenance: MaintenanceState;
  blockFilters: BlockFilters;
  blacklist: PublicBlacklist;
}

interface RawBootstrap {
  routing_policy?: {
    policy?: {
      api_policy?: unknown;
      media_policy?: unknown;
      third_party_url?: unknown;
      third_party_pass_api_key?: unknown;
    };
  };
  maintenance?: {
    maintenance_mode?: unknown;
    maintenance_message?: unknown;
  };
  block_tags?: unknown;
  image_blocklist?: Partial<PublicBlacklistPage> & { blocks?: unknown };
}

async function readDevMaintenanceOverride(): Promise<MaintenanceState | null> {
  if (process.env.NODE_ENV !== 'development') return null;
  const preview = (await cookies()).get(DEV_PREVIEW_COOKIE)?.value;
  if (preview === undefined) return null;
  let message = preview;
  try {
    message = decodeURIComponent(preview);
  } catch {
    /* Not percent-encoded: taken as typed. */
  }
  return { active: true, message: message.slice(0, MAX_MESSAGE_LENGTH) };
}

async function readRemainingBlacklistPages(
  firstPage: number[],
  revision: number | undefined,
  signal: AbortSignal,
): Promise<number[] | null> {
  const ids = new Set<number>(firstPage);
  const revParam = typeof revision === 'number' && Number.isSafeInteger(revision) ? `&revision=${revision}` : '';
  for (let page = 2; ; page += 1) {
    const response = await fetch(
      `${UPSTREAM_ORIGIN}/api/v1/image-blocklist?page=${page}&limit=${PUBLIC_BLACKLIST_PAGE_LIMIT}${revParam}`,
      {
        signal,
        next: { revalidate: cacheSeconds(BOOTSTRAP_REVALIDATE_S), tags: [PUBLIC_BLACKLIST_CACHE_TAG] },
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<PublicBlacklistPage>;
    const blocks = parsePublicBlacklist(body);
    if (!blocks) return null;
    for (const id of blocks) ids.add(id);
    if (!body.has_more) break;
  }
  return [...ids].sort((a, b) => a - b);
}

async function fetchSiteBootstrapRaw(): Promise<SiteBootstrap | null> {
  try {
    const signal = AbortSignal.timeout(BOOTSTRAP_TIMEOUT_MS);
    const res = await fetch(`${UPSTREAM_ORIGIN}/api/v1/bootstrap`, {
      next: {
        revalidate: cacheSeconds(BOOTSTRAP_REVALIDATE_S),
        tags: [SITE_STATUS_CACHE_TAG, BLOCK_FILTERS_CACHE_TAG, PUBLIC_BLACKLIST_CACHE_TAG],
      },
      signal,
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as RawBootstrap;
    const policy = raw?.routing_policy?.policy;
    if (
      !policy ||
      typeof policy.api_policy !== 'string' ||
      typeof policy.media_policy !== 'string'
    ) {
      return null;
    }
    const maint = raw?.maintenance;
    if (!maint || typeof maint.maintenance_mode !== 'boolean') return null;
    const blockFilters = parseBlockFilters(raw?.block_tags);
    if (!blockFilters) return null;
    const page1 = parsePublicBlacklist(raw?.image_blocklist);
    if (!page1) return null;
    let blacklist: number[] = [...new Set(page1)].sort((a, b) => a - b);
    if (raw.image_blocklist?.has_more) {
      const whole = await readRemainingBlacklistPages(blacklist, raw.image_blocklist.revision, signal);
      if (!whole) return null;
      blacklist = whole;
    }
    const maintenance: MaintenanceState = maint.maintenance_mode
      ? {
          active: true,
          message: typeof maint.maintenance_message === 'string' ? maint.maintenance_message.trim() : '',
        }
      : { active: false, message: '' };
    const routePolicy: InlineRoutePolicy = {
      api: policy.api_policy,
      image: policy.media_policy,
      thirdPartyUrl: typeof policy.third_party_url === 'string' ? policy.third_party_url : '',
      thirdPartyPassApiKey: policy.third_party_pass_api_key === true,
      blockFilters,
      blacklist,
    };
    return { routePolicy, maintenance, blockFilters, blacklist };
  } catch {
    return null;
  }
}

export async function readSiteBootstrap(): Promise<{
  routePolicy: InlineRoutePolicy;
  maintenance: MaintenanceState;
}> {
  /* Register the shared promises synchronously before awaiting so parallel server children
     (`readRoutePolicyOnce`, `readBlockFilters`, `readPublicBlacklist`) attach to this single read
     instead of launching separate requests. */
  const rawPromise = fetchSiteBootstrapRaw();
  setRequestBootstrap(
    rawPromise.then((boot) => (boot ? { blockFilters: boot.blockFilters, blacklist: boot.blacklist } : null)),
  );
  setRequestRoutePolicy(rawPromise.then((boot) => (boot ? boot.routePolicy : null)));

  const [devOverride, boot] = await Promise.all([readDevMaintenanceOverride(), rawPromise]);
  if (boot) {
    return {
      routePolicy: boot.routePolicy,
      maintenance: devOverride ?? boot.maintenance,
    };
  }
  /* Legacy backend fallback (or transient `/bootstrap` error): use the original per-resource
     readers without duplicating any request. */
  const [routePolicy, maintenance] = await Promise.all([readRoutePolicyOnce(), readMaintenance()]);
  return { routePolicy, maintenance: devOverride ?? maintenance };
}

/** Once per SSR request. */
export const readSiteBootstrapOnce = cache(readSiteBootstrap);
