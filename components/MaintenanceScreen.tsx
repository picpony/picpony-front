'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { MdConstruction } from 'react-icons/md';
import Button from './Button';
import StatusView from './StatusView';
import { useAuthModal } from './AuthModal';
import { COOKIE_KEYS } from '@/lib/constants';
import { clearUserInfo, useSession } from '@/lib/hooks';
import { picponyRequest, readJson } from '@/lib/api/http';
import type { SiteStatusResponse } from '@/lib/types/site';
import { ICON } from '@/lib/icons';

/**
 * Maintenance mode, for the two audiences it has.
 *
 * **A visitor gets this screen instead of the app** — `app/layout.tsx` renders it in place of
 * the shell when the server's status read says maintenance is on, so it is in the first byte
 * and nothing behind it starts a request the backend would refuse. **Staff keep the app**, with
 * `MaintenanceNotice` in its chrome saying why nobody else can see it.
 *
 * Who is staff is the backend's answer, not a role this device remembers: the status document
 * read *with the session's token* carries `is_admin`. The server cannot send that token, so it
 * goes by `COOKIE_KEYS.maintenanceStaff`, a hint this module writes from that answer and keeps
 * honest from both sides — the screen promotes a session the backend calls staff, the notice
 * demotes one it does not.
 */

const DEFAULT_MESSAGE = '服务器正在升级维护，暂时无法访问。给您带来的不便，敬请谅解。';
/** How often an open maintenance screen asks whether maintenance is over. */
const RECHECK_MS = 60_000;
const HINT_MAX_AGE_S = 30 * 24 * 60 * 60;

interface SiteAccess {
  maintenance: boolean;
  staff: boolean;
}

/** The status document as this session sees it. `null` when it could not be read. */
async function readSiteAccess(token: string | null, signal: AbortSignal): Promise<SiteAccess | null> {
  try {
    const res = await picponyRequest('get_maintenance_status', {
      token: token ?? undefined,
      query: { _t: Date.now() },
      signal,
    });
    if (!res.ok) return null;
    const body = await readJson<SiteStatusResponse>(res);
    if (body?.success !== true) return null;
    return { maintenance: body.maintenance_mode === true, staff: body.is_admin === true };
  } catch {
    return null;
  }
}

function writeStaffHint(staff: boolean) {
  try {
    document.cookie = `${COOKIE_KEYS.maintenanceStaff}=${staff ? '1' : ''};path=/;max-age=${staff ? HINT_MAX_AGE_S : 0};samesite=lax`;
  } catch {
    /* Cookies blocked: the server keeps rendering the screen, and a staff session is promoted
       again on each load — one extra read, never a wrong screen for a visitor. */
  }
}

function hasStaffHint(): boolean {
  try {
    return document.cookie.split('; ').includes(`${COOKIE_KEYS.maintenanceStaff}=1`);
  } catch {
    return false;
  }
}

/** A signed-out device is nobody's staff: drop a hint left by an earlier session, so the next
 *  maintenance does not render it the app for one load. For the shell, which is mounted only
 *  when the server did not render the screen. */
export function useStaleStaffHintCleanup() {
  const { token, ready } = useSession();
  useEffect(() => {
    if (ready && !token && hasStaffHint()) writeStaffHint(false);
  }, [ready, token]);
}

export default function MaintenanceScreen({ message }: { message: string }) {
  const router = useRouter();
  const { token, ready } = useSession();
  const { openAuth } = useAuthModal();
  /* The session the backend has said is not staff. Kept per token rather than as a flag, so
     signing out or into another account is a fresh question without a reset. */
  const [refusedToken, setRefusedToken] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const refused = token !== null && refusedToken === token;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let missed = false;

    const check = async () => {
      const access = await readSiteAccess(token, controller.signal);
      if (controller.signal.aborted || !access) return;
      if (access.maintenance && access.staff) writeStaffHint(true);
      /* Over, or this session may stay: the server renders the app from here. The server's
         copy of the status can trail by its reuse window, so an early "over" may render this
         screen again — the next check then asks again. */
      if (!access.maintenance || access.staff) {
        startRefresh(() => router.refresh());
        return;
      }
      if (token) setRefusedToken(token);
    };

    /* On a hidden tab the check waits for the tab to come back rather than spending a request
       nobody sees. */
    const tick = () => {
      if (document.visibilityState === 'visible') void check();
      else missed = true;
      timer = window.setTimeout(tick, RECHECK_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || !missed) return;
      missed = false;
      void check();
    };

    /* A visitor's first answer is the server's own, a moment old; a session's is not, since
       the server could not ask about it. */
    if (token) void check();
    timer = window.setTimeout(tick, RECHECK_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready, token, router]);

  const signOut = () => {
    if (token) clearUserInfo(token);
  };

  return (
    <main
      className="main-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
    >
      {/* The screen answers 200 under whatever URL was asked for (a layout cannot set a status),
          so a crawler visiting during maintenance must not index this text as that page's
          content. React hoists the tag into the head. */}
      <meta name="robots" content="noindex" />
      <StatusView
        fill
        icon={<MdConstruction size={ICON.display} />}
        title="服务维护中"
        description={
          <>
            {message || DEFAULT_MESSAGE}
            <span className="text-body-s mt-2 block">
              {refused ? '当前登录的账号在维护期间无法访问。' : '请稍后再来，或关注网站公告获取最新通知。'}
            </span>
          </>
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="filled" loading={refreshing} onClick={() => startRefresh(() => router.refresh())}>
              刷新
            </Button>
            {/* Shown once the session is known, so a signed-in device never flashes the wrong one. */}
            {ready &&
              (token ? (
                <Button variant="text" onClick={signOut}>
                  退出登录
                </Button>
              ) : (
                <Button variant="text" onClick={() => openAuth('login')}>
                  管理员登录
                </Button>
              ))}
          </div>
        }
      />
    </main>
  );
}

/**
 * The staff side: a row in the shell's chrome while maintenance is on, which is also where the
 * hint is kept honest — a session the backend no longer calls staff (signed out, demoted,
 * another account) is dropped back to the screen. Maintenance ending mid-session only retires
 * the row; nothing else about the app changes.
 */
export function MaintenanceNotice({ inert }: { inert?: boolean }) {
  const router = useRouter();
  const { token, ready } = useSession();
  const [over, setOver] = useState(false);

  useEffect(() => {
    if (!ready) return;
    /* No session, nothing to ask: the device is a visitor's. */
    if (!token) {
      writeStaffHint(false);
      router.refresh();
      return;
    }
    const controller = new AbortController();
    void readSiteAccess(token, controller.signal).then((access) => {
      if (controller.signal.aborted || !access) return;
      if (!access.maintenance) {
        setOver(true);
        return;
      }
      if (!access.staff) {
        writeStaffHint(false);
        router.refresh();
      }
    });
    return () => controller.abort();
  }, [ready, token, router]);

  if (over) return null;

  return (
    <div
      role="note"
      data-maintenance-notice
      inert={inert || undefined}
      className="bg-error-container text-on-error-container flex shrink-0 select-none items-center justify-center gap-2 py-1.5 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]"
    >
      <MdConstruction size={ICON.dense} className="shrink-0" aria-hidden="true" />
      <p className="text-body-s-emphasized min-w-0 text-center">网站当前处于维护模式，普通用户无法访问</p>
    </div>
  );
}
