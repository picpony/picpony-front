'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MdGroup } from 'react-icons/md';
import Card from '@/components/Card';
import Skeleton from '@/components/Skeleton';
import DeveloperGuideModal from '@/components/DeveloperGuideModal';
import { prefersReducedMotion } from '@/lib/motion';
import { api } from '@/lib/api';

/** 成员头像：原生 img 避开 next/image 域名白名单与 QQ 防盗链（Referer），失败降级为图标 */
function MemberAvatar({ src, alt }: { src: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
        <MdGroup size={24} />
      </div>
    );
  }
  return (
    <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-surface-container-high">
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

function TraceHeader({ onActivate }: { onActivate?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const clicksRef = useRef({ count: 0, last: 0 });

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
    // 动效偏好减弱时不加载动画
    if (prefersReducedMotion()) return;
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
  }, []);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="PicPony"
      className="mx-auto w-44 select-none sm:w-56"
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

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  // 按分类分组，组内按 order_num 排序
  const groups = (['developer', 'manager', 'editor', 'special'] as const)
    .map((cat) => ({
      label: CATEGORY_LABELS[cat],
      items: members.filter((m) => m.category === cat).sort((a, b) => a.order_num - b.order_num),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <Card variant="filled" padding="lg" className="mt-4">
      <h2 className="mb-4 text-title-m text-on-surface">运营团队</h2>

      {loading && (
        <div className="flex flex-wrap gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="flex w-44 items-center gap-3">
              <Skeleton className="h-16 w-16 flex-shrink-0 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-16 rounded" />
                <Skeleton className="h-3 w-20 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="text-body-m text-on-surface-variant">运营团队信息加载失败，请稍后重试</p>
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
                        <p className="mt-0.5 text-body-s text-outline">{m.role}</p>
                      </div>
                    </>
                  );
                  return href ? (
                    <Link
                      key={m.id}
                      href={href}
                      className="flex w-44 items-center gap-3 rounded-md p-2 transition-ui hover:bg-surface-container-high"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={m.id} className="flex w-44 items-center gap-3 p-2">
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
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <div className="mx-auto max-w-4xl animate-fade-in px-4 py-8">
      <h1 className="mb-6 text-headline-s text-on-surface">关于本站</h1>

      <TraceHeader onActivate={() => setGuideOpen(true)} />

      <div className="mt-8">
        <Card variant="filled" padding="lg">
          <h2 className="mb-3 text-title-m text-on-surface">关于 PicPony</h2>
          <p className="text-body-m leading-relaxed text-on-surface-variant">
            一个看图的网站，没了
          </p>
        </Card>

        <TeamSection />
      </div>

      <DeveloperGuideModal isOpen={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
