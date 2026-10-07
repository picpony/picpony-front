'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnimationItem } from 'lottie-web';
import Link from 'next/link';
import FlutedGlass from '@/components/FlutedGlass';
import DeveloperGuideModal from '@/components/DeveloperGuideModal';
import {
  entranceMotion,
  motionScale,
  motionTier,
  useEntranceMotion,
  useMotionSpeed,
  useMotionTier,
} from '@/lib/appearance';
import { loadLottiePlayer } from '@/lib/lottieAssets';
import EmptyState from '@/components/EmptyState';
import ErrorRetry from '@/components/ErrorRetry';
import { apiErrorMessage, isRetryable } from '@/lib/api/errors';
import Logo from '@/components/Logo';
import { useResource } from '@/lib/resource';
import { teamMembers, type TeamMember } from '@/lib/resources';
import type { TeamSeed } from '@/lib/team.server';
import { readToken } from '@/lib/hooks';
import { getAssetUrl } from '@/lib/utils';
import Avatar from '@/components/Avatar';
import AboutFrame, { ROSTER_GRID, TeamCard, TeamSkeleton } from './AboutFrame';

/* Module scope: the React Compiler does not lower a dynamic `import()` inside a component. */
const loadTrace = () =>
  Promise.all([loadLottiePlayer(), import('@/lib/lottie/logoNonParallel.json').then((m) => m.default)]);

/** The Lottie composition's own frame, so the reserved box matches what lands. */
const TRACE_ASPECT = '3000 / 1053';
/** One width for the mark: two branches below draw it, and separate copies drifted. */
const MARK_WIDTH = 'w-48 sm:w-64';

function TraceHeader({ onActivate }: { onActivate?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<AnimationItem | null>(null);
  const clicksRef = useRef({ count: 0, last: 0 });
  /* Reactive, not one-shot: with the one-shot the branch below was decided at mount, so
     turning the preference on mid-session left the animation running until something
     else re-rendered the page. */
  const tier = useMotionTier();
  const speed = useMotionSpeed();
  const entrance = useEntranceMotion();
  const staticMark = tier !== 'standard' || !entrance;
  const [traceUnavailable, setTraceUnavailable] = useState(false);

  // 已登录状态下快速连点 10 次（点击间隔超 1.5s 重置）触发开发者向导
  const handleClick = () => {
    const token = readToken();
    if (!token) return;
    const now = Date.now();
    const ref = clicksRef.current;
    ref.count = now - ref.last > 1500 ? 1 : ref.count + 1;
    ref.last = now;
    if (ref.count >= 10) {
      ref.count = 0;
      onActivate?.();
    }
  };

  useEffect(() => {
    if (staticMark) return;
    let animation: AnimationItem | null = null;
    let cancelled = false;
    loadTrace().then(([player, data]) => {
      if (
        cancelled || !hostRef.current || motionTier() !== 'standard' || !entranceMotion()
      ) return;
      animation = player.default.loadAnimation({
        container: hostRef.current,
        renderer: 'svg',
        loop: false, // 单次播放
        autoplay: true,
        animationData: data as object,
      });
      animationRef.current = animation;
      animation.setSpeed(1 / motionScale());
    }).catch(() => {
      if (!cancelled) setTraceUnavailable(true);
    });
    return () => {
      cancelled = true;
      animation?.destroy();
      if (animationRef.current === animation) animationRef.current = null;
    };
  }, [staticMark]);

  useEffect(() => {
    if (motionTier() === 'standard') animationRef.current?.setSpeed(1 / motionScale());
  }, [speed]);

  /* Under the preference an *empty* box used to render: the effect returned before
     loading anything, leaving a labelled 176px hole where the wordmark belongs. The
     static mark is the honest fallback — reduced motion asks for less movement, not
     less content. */
  if (staticMark || traceUnavailable) {
    /* The static mark takes the same handler — without it the developer guide would be
       unreachable for anyone with the preference on. `Logo` renders the mark, not a
       box, so the handlers go on a wrapper rather than through it.

       The width goes on `Logo`, not the wrapper: `Logo`'s root is an inline-block, so a
       full-width mask inside it resolves against a shrink-to-fit box the mask is itself
       supposed to size — circular, and it collapsed the mark to nothing. Only the
       reduced-motion branch took this path, which is why it went unseen.

       The keyline sits on the wrapper so the two colours can differ: the halo is
       `currentColor` of whatever carries the filter, the mask's fill is `currentColor`
       of whatever carries the mask — plate outside, ink inside. A halo in the ink colour
       would only thicken the mark instead of knocking it out of the texture behind it.
       `glass-body` rather than a surface step, because the plate is what is actually
       behind the mark; the two used to disagree by 28 code values, turning the halo into
       an outline. */
    return (
      <span
        className="logo-keyline logo-keyline-plate block text-glass-body select-none"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleClick}
      >
        <Logo className={`h-auto text-on-surface ${MARK_WIDTH}`} />
      </span>
    );
  }

  /* `aspect-ratio` reserves the box before the player injects its SVG — without it the
     host is 0px tall until the chunk resolves and then pushes the whole page down, a
     layout shift on every visit, above the fold. The plate behind it does not read this
     box: the glass has no keep-out, by decision — it is a material, not an image, so
     there is nothing behind the mark for the mark to be clear of.

     `logo-keyline` is what keeps that decision from reading as clutter, the same
     treatment the brand bar's mark gets. The filter draws a 1px halo in `currentColor`,
     so `currentColor` must be the *plate's* own body, not the page's ink: a halo in the
     glass colour knocks the mark out of the texture behind it; a halo in `on-surface`
     would only thicken it.

     The press counter sits on a plain wrapper, as in the branch above, and the image is only an
     image (G4-029): on the `img` role itself it made an interactive picture that no key could
     press. The guide stays a pointer gesture by design — an easter egg — so it has no keyboard
     path; giving it a real entry point is the owner's call. */
  return (
    <div className={`select-none ${MARK_WIDTH}`} onMouseDown={(e) => e.preventDefault()} onClick={handleClick}>
      <div
        ref={hostRef}
        role="img"
        aria-label="PicPony"
        className="logo-keyline logo-keyline-plate text-glass-body w-full"
        style={{ aspectRatio: TRACE_ASPECT }}
      />
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  developer: '开发团队',
  manager: '管理团队',
  editor: '小编团队',
  special: '特别鸣谢',
};

// 头像选择：account_avatar 优先，为 null 时降级 avatar_url；相对路径拼接 picpony.top
function resolveMemberAvatar(
  m: Pick<TeamMember, 'account_avatar' | 'avatar_url'>,
): string | null {
  const url = m.account_avatar || m.avatar_url;
  if (!url) return null;
  return getAssetUrl(url);
}

// user:N → /user/N；无链接返回 null
function resolveMemberLink(linkUrl: string | null | undefined): string | null {
  if (!linkUrl) return null;
  if (linkUrl.startsWith('user:')) return `/user/${linkUrl.slice(5)}`;
  return null;
}

/** 运营团队板块：按分类分组展示成员 */
function TeamSection({ teamSeed }: { teamSeed: TeamSeed | null }) {
  /* `initial` is the roster the server already fetched, handed down as a prop: two
     effects, one gate — `getServerSnapshot` returns it so SSR renders real names, and
     `seed` installs it so the first `read` finds a fresh entry and sends no request.
     `null` (upstream slow or unhappy) falls back to the client fetch. */
  const read = useResource(teamMembers, {}, { initial: teamSeed ?? undefined });
  const members = read.data ?? [];
  const loading = read.data === undefined && read.error === undefined;
  /* A failure only stands in for the roster when there is no roster to show: a background
     re-read that fails leaves the names on screen. */
  const error = read.data === undefined && read.error !== undefined;

  // 按分类分组，组内按 order_num 排序
  const groups = (['developer', 'manager', 'editor', 'special'] as const)
    .map((cat) => ({
      label: CATEGORY_LABELS[cat],
      items: members.filter((m) => m.category === cat).sort((a, b) => a.order_num - b.order_num),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <TeamCard>
      {loading && <TeamSkeleton />}

      {/* `ErrorRetry` with a retry that actually retries — a bare sentence gave no
          way to recover from one transient network failure. */}
      {!loading && error && (
        <ErrorRetry
          size="inline"
          title="运营团队加载失败"
          message={apiErrorMessage(read.error)}
          onRetry={isRetryable(read.error) ? read.refresh : undefined}
        />
      )}

      {!loading && !error && groups.length === 0 && <EmptyState size="inline" title="暂无团队成员" />}

      {!loading && !error && groups.length > 0 && (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.label}>
              {/* A label over its rows, in supporting ink: `primary-ink` is the brand as a mark
                  and measured 2.39:1 on this card as text (R7-010). */}
              <h3 className="mb-3 text-label-l text-on-surface-variant">{group.label}</h3>
              <div className={ROSTER_GRID}>
                {group.items.map((m) => {
                  const href = resolveMemberLink(m.link_url);
                  const avatar = resolveMemberAvatar(m);
                  const inner = (
                    <>
                      <Avatar src={avatar} name={m.name} size={48} unoptimized />
                      <div className="min-w-0">
                        {/* The name is the cell's content: two lines before it is cut (OD-6), its
                            whole text still in `title`. A long Latin handle breaks inside the
                            word rather than overflowing; the grid stretches every cell in a row to
                            the tallest and each centres on its avatar, so the avatars stay level. */}
                        <p className="line-clamp-2 wrap-anywhere text-label-l text-on-surface" title={m.name}>{m.name}</p>
                        {/* One line, its whole text in `title` (D1-008): wrapped in a narrow cell,
                            a role left one character on a line of its own (「小马维基数据支 / 持」). */}
                        <p className="mt-0.5 truncate text-body-s text-on-surface-variant" title={m.role}>
                          {m.role}
                        </p>
                      </div>
                    </>
                  );
                  return href ? (
                    <Link
                      scroll={false}
                      key={m.id}
                      href={href}
                      data-ripple
                      /* Focus ring and ripple, like every other interactive row in the
                         app — without them a keyboard user could reach this link and see
                         no indication they had. */
                      className="flex min-w-0 items-center gap-3 rounded-md p-2 transition-ui state-layer focus-visible:outline-hidden focus-visible:ring-2 focus-ring"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={m.id} className="flex min-w-0 items-center gap-3 p-2">
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </TeamCard>
  );
}

export default function AboutContent({ teamSeed }: { teamSeed: TeamSeed | null }) {
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <>
      <AboutFrame
        plate={
          <>
            <FlutedGlass />
            {/* `relative` keeps the mark above the glass: siblings at the same z-index, so
                paint order is DOM order and only a *positioned* element takes part in it.
                Without it the plate covers the mark and swallows its clicks. */}
            <div className="relative">
              <TraceHeader onActivate={() => setGuideOpen(true)} />
            </div>
          </>
        }
        team={<TeamSection teamSeed={teamSeed} />}
      />
      <DeveloperGuideModal isOpen={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}
