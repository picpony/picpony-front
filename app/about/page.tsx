'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MdGroup } from 'react-icons/md';
import Card from '@/components/Card';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import DeveloperGuideModal from '@/components/DeveloperGuideModal';
import { useReducedMotion } from '@/lib/motion';
import ErrorRetry from '@/components/ErrorRetry';
import Logo from '@/components/Logo';
import { api } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import PageBack from '@/components/PageBack';
import { useEscapeBack } from '@/lib/hooks';
import SectionHeading from '@/components/SectionHeading';

/** 成员头像：原生 img 避开 next/image 域名白名单与 QQ 防盗链（Referer），失败降级为图标 */
function MemberAvatar({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
        <MdGroup size={24} />
      </div>
    );
  }
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-surface-container-high">
      {/* eslint-disable-next-line @next/next/no-img-element -- 头像含 QQ 等白名单外域名，且需 no-referrer 防防盗链 */}
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

/** The Lottie composition's own frame, so the reserved box matches what lands. */
const TRACE_ASPECT = '3000 / 1053';

function TraceHeader({ onActivate }: { onActivate?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const clicksRef = useRef({ count: 0, last: 0 });
  /* Reactive, not the one-shot read this used to make: with the one-shot the
     branch below was decided at mount, so turning the preference on mid-session
     left the animation running until something else re-rendered the page. */
  const reduced = useReducedMotion();

  // 已登录状态下快速连点 10 次（点击间隔超 1.5s 重置）触发开发者向导
  const handleClick = () => {
    let token = '';
    try {
      token = JSON.parse(localStorage.getItem('user_info') || 'null')?.token || '';
    } catch {
      token = '';
    }
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
    if (reduced) return;
    let animation: { destroy: () => void } | null = null;
    let cancelled = false;
    Promise.all([
      import('lottie-web/build/player/esm/lottie_light.min.js'),
      import('@/lib/lottie/logoNonParallel.json').then((m) => m.default),
    ]).then(([player, data]) => {
      if (cancelled || !hostRef.current) return;
      animation = player.default.loadAnimation({
        container: hostRef.current,
        renderer: 'svg',
        loop: false, // 单次播放
        autoplay: true,
        animationData: data as object,
      });
    });
    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [reduced]);

  /* Under the preference this used to render an *empty* box: the effect
     returned before loading anything and nothing else drew the mark, so the page
     opened with a labelled 176px hole where the wordmark belongs. The static
     mark is the honest fallback — reduced motion asks for less movement, not
     less content. */
  if (reduced) {
    /* The static mark takes the same handler. Without it the developer guide
       would be unreachable for anyone with the preference on — an easter egg is
       still a feature, and reduced motion asks for less movement, not fewer
       affordances. `Logo` renders the mark, not a box, so the handlers go on a
       wrapper rather than through it. */
    return (
      <span
        className="mx-auto block w-44 select-none sm:w-56"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleClick}
      >
        <Logo className="h-auto w-full" />
      </span>
    );
  }

  /* `aspect-ratio` reserves the box before the player injects its SVG. Without
     it the host is 0px tall until the chunk resolves and then pushes the whole
     page down — a layout shift on every visit, on the one element above the
     fold. */
  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="PicPony"
      className="mx-auto w-44 select-none sm:w-56"
      style={{ aspectRatio: TRACE_ASPECT }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleClick}
    />
  );
}

interface TeamMember {
  id: number;
  name: string;
  role: string;
  category: 'developer' | 'manager' | 'editor' | 'special';
  avatar_url: string | null;
  account_avatar: string | null;
  link_url: string | null;
  order_num: number;
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
  return /^https?:\/\//.test(url) ? url : `https://picpony.top/${url}`;
}

// user:N → /user/N；无链接返回 null
function resolveMemberLink(linkUrl: string | null | undefined): string | null {
  if (!linkUrl) return null;
  if (linkUrl.startsWith('user:')) return `/user/${linkUrl.slice(5)}`;
  return null;
}

/** 运营团队板块：按分类分组展示成员 */
function TeamSection() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Deferred so the reset is not a synchronous cascade inside the effect —
    // the same shape `/derpi/user/[id]` and the forum thread already use.
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(false);
    });
    api
      .getTeamMembers()
      .then((data: { success: boolean; members?: TeamMember[] }) => {
        if (cancelled) return;
        if (data?.success && Array.isArray(data.members)) setMembers(data.members);
        else setError(true);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryCount]);

  // 按分类分组，组内按 order_num 排序
  const groups = (['developer', 'manager', 'editor', 'special'] as const)
    .map((cat) => ({
      label: CATEGORY_LABELS[cat],
      items: members.filter((m) => m.category === cat).sort((a, b) => a.order_num - b.order_num),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <Card variant="filled" padding="lg" className="mt-4">
      <SectionHeading>运营团队</SectionHeading>

      {/* The skeleton is the loaded state's own shape: group headings over
          wrapped rows of member cards, on the same `space-y-5` and
          `gap-x-4 gap-y-5` rhythm. It used to be a flat row with a different gap
          and no headings at all, so the list re-spaced *and* grew two heading
          rows the moment the data landed — the one thing a skeleton exists to
          prevent. */}
      {loading && (
        <div className="space-y-5" aria-hidden="true">
          {[0, 1].map((g) => (
            <div key={g}>
              <Skeleton className="mb-3 h-5 w-20" delay={g * 120} />
              <div className="flex flex-wrap gap-x-4 gap-y-5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex w-full items-center gap-3 p-2 sm:w-44">
                    <SkeletonCircle size={64} delay={g * 120 + i * 80} />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-16" delay={g * 120 + i * 80 + 40} />
                      <Skeleton className="h-3 w-20" delay={g * 120 + i * 80 + 80} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* `ErrorRetry`, with a retry that actually retries. This was a bare
          sentence and no way to recover, so one transient network failure left
          the section empty until a full page reload. */}
      {!loading && error && (
        <ErrorRetry
          size="inline"
          title="运营团队信息加载失败"
          onRetry={() => setRetryCount((c) => c + 1)}
        />
      )}

      {!loading && !error && (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.label}>
              <h3 className="mb-3 text-label-l text-primary">{group.label}</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-5">
                {group.items.map((m) => {
                  const href = resolveMemberLink(m.link_url);
                  const avatar = resolveMemberAvatar(m);
                  const inner = (
                    <>
                      <MemberAvatar src={avatar ?? ''} alt={m.name} />
                      <div className="min-w-0">
                        <p className="truncate text-label-l text-on-surface">{m.name}</p>
                        <p className="mt-0.5 text-body-s text-on-surface-variant">{m.role}</p>
                      </div>
                    </>
                  );
                  return href ? (
                    <Link
                      key={m.id}
                      href={href}
                      data-ripple
                      /* Focus ring and ripple, like every other interactive row
                         in the app. Without them a keyboard user could reach
                         this link and see no indication they had. */
                      className="flex w-full items-center gap-3 rounded-md p-2 outline-none transition-ui state-layer focus-visible:ring-2 focus-ring sm:w-44"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={m.id} className="flex w-full items-center gap-3 p-2 sm:w-44">
                      {inner}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function AboutPage() {
  const router = useRouter();
  const [guideOpen, setGuideOpen] = useState(false);
  /* Reachable only from the footer, so it is not a sidebar destination and
     carries the shared back affordance — see the rule in AGENTS.md. */
  const handleBack = useCallback(() => router.back(), [router]);
  useEscapeBack(handleBack);

  return (
    <>
      <PageBack onClick={handleBack} title="返回 (Esc)" />
      <div className="mx-auto max-w-4xl pt-14">
      <PageHeader title="关于本站" />

      <TraceHeader onActivate={() => setGuideOpen(true)} />

      <div className="mt-8">
        <Card variant="filled" padding="lg">
          <SectionHeading className="mb-3">关于 PicPony</SectionHeading>
          <p className="text-body-m text-on-surface-variant">
            一个看图的网站，没了
          </p>
        </Card>

        <TeamSection />
      </div>
      <DeveloperGuideModal isOpen={guideOpen} onClose={() => setGuideOpen(false)} />
      </div>
    </>
  );
}
