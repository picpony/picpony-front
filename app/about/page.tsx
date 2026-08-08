'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MdGroup } from 'react-icons/md';
import Card from '@/components/Card';
import FadeInImage from '@/components/FadeInImage';
import Skeleton from '@/components/Skeleton';
import { prefersReducedMotion } from '@/lib/motion';
import { api } from '@/lib/api';

function TraceHeader() {
  const hostRef = useRef<HTMLDivElement>(null);

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
      className="mx-auto w-44 sm:w-56"
    />
  );
}

interface TeamMember {
  id: number;
  name: string;
  role: string;
  category: 'developer' | 'manager' | 'editor' | 'special';
  avatar_url: string | null;
  link_url: string | null;
  order_num: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  developer: '开发团队',
  manager: '管理团队',
  editor: '小编团队',
  special: '特别鸣谢',
};

// 相对路径头像拼接 picpony.top 静态资源
function resolveAvatar(url: string | null | undefined): string | null {
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
                  const avatar = resolveAvatar(m.avatar_url);
                  const inner = (
                    <>
                      {avatar ? (
                        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-full bg-surface-container-high">
                          <FadeInImage src={avatar} alt={m.name} fill className="object-cover" />
                        </div>
                      ) : (
                        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
                          <MdGroup size={24} />
                        </div>
                      )}
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
  return (
    <div className="mx-auto max-w-4xl animate-fade-in px-4 py-8">
      <h1 className="mb-6 text-headline-s text-on-surface">关于网站</h1>

      <TraceHeader />

      <div className="mt-8">
        <Card variant="filled" padding="lg">
          <h2 className="mb-3 text-title-m text-on-surface">关于 PicPony</h2>
          <p className="text-body-m leading-relaxed text-on-surface-variant">
            一个看图的网站，没了
          </p>
        </Card>

        <TeamSection />
      </div>
    </div>
  );
}
