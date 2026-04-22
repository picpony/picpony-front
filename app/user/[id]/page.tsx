'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import FadeInImage from '@/components/FadeInImage';
import { MdPerson, MdCake, MdAccessTime, MdInfoOutline } from 'react-icons/md';
import { LuSettings2 } from 'react-icons/lu';

interface UserProfile {
  id: number;
  username: string;
  avatar: string;
  banner: string;
  role: string;
  bio: string;
  gender: string;
  birthday: string;
  created_at: string;
  derpi_username: string;
  derpi_user_id: string;
  settings: {
    videoPreview: boolean;
    showTagCounts: boolean;
    banAnthro: boolean;
    onlyPony: boolean;
    useCdn: boolean;
    contentFilter: string;
    theme: string;
  };
  has_api_key: boolean;
}

export default function UserProfilePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    if (id) {
      api.getUserProfile(id)
        .then((res) => {
          if (isMounted) {
            if (res.success && res.user) {
              setProfile(res.user);
            } else {
              setError(res.message || '获取用户资料失败');
            }
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (isMounted) {
            setError(err.message || '获取用户资料失败');
            setIsLoading(false);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="animate-pulse bg-white min-h-screen">
        <div className="bg-slate-200 h-48 sm:h-64 md:h-80 w-full rounded-2xl sm:rounded-3xl mt-4 sm:mt-6 mx-auto max-w-[96%] sm:max-w-[98%]"></div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="pb-8 relative pt-12 sm:pt-16">
            <div className="absolute -top-12 sm:-top-16 left-0 w-24 h-24 sm:w-32 sm:h-32 bg-slate-300 rounded-full border-4 border-white"></div>
            <div className="h-8 bg-slate-200 rounded w-1/3 mb-4 mt-2 sm:mt-4"></div>
            <div className="h-4 bg-slate-200 rounded w-1/4 mb-6"></div>
            <div className="space-y-4">
              <div className="h-4 bg-slate-200 rounded w-full"></div>
              <div className="h-4 bg-slate-200 rounded w-5/6"></div>
              <div className="h-4 bg-slate-200 rounded w-4/6"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold text-slate-800 mb-4">加载失败</h2>
        <p className="text-slate-600 mb-6">{error || '用户可能不存在'}</p>
        <button
          onClick={() => router.back()}
          className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
        >
          返回上一页
        </button>
      </div>
    );
  }

  const roleColors: Record<string, string> = {
    admin: 'bg-red-100 text-red-700 border-red-200',
    moderator: 'bg-blue-100 text-blue-700 border-blue-200',
    user: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  const getRoleBadge = (role: string) => {
    const defaultColor = 'bg-slate-100 text-slate-700 border-slate-200';
    const colorClass = roleColors[role.toLowerCase()] || defaultColor;
    const displayRole = role.charAt(0).toUpperCase() + role.slice(1);

    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-md border ${colorClass}`}>
        {displayRole}
      </span>
    );
  };

  return (
    <div className="animate-fade-in bg-white min-h-screen">
      <div className="h-48 sm:h-64 md:h-80 relative bg-slate-100 rounded-2xl sm:rounded-3xl overflow-hidden mt-4 sm:mt-6 mx-auto max-w-[96%] sm:max-w-[98%]">
        {profile.banner ? (
          <img
            src={`https://picpony.top/${profile.banner}`}
            alt={`${profile.username}'s banner`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-r from-primary/20 to-primary/40 flex items-center justify-center">
            <MdPerson size={64} className="text-white/50" />
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        <div className="pb-8 relative pt-12 sm:pt-16">
          <div className="absolute -top-12 sm:-top-16 left-0">
            <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-white overflow-hidden bg-white">
              {profile.avatar ? (
                <img
                  src={`https://picpony.top/${profile.avatar}`}
                  alt={`${profile.username}'s avatar`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-primary/10 flex items-center justify-center">
                  <span className="text-3xl sm:text-4xl text-primary font-bold">
                    {profile.username.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6 mt-2 sm:mt-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 break-all">
                  {profile.username}
                </h1>
                {getRoleBadge(profile.role)}
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-500 mt-3">
                {profile.gender && profile.gender !== '保密' && (
                  <div className="flex items-center gap-1.5">
                    <MdPerson size={18} />
                    <span>{profile.gender}</span>
                  </div>
                )}
                {profile.birthday && (
                  <div className="flex items-center gap-1.5">
                    <MdCake size={18} />
                    <span>{profile.birthday}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <MdInfoOutline size={18} />
                  <span>
                    {profile.bio ? (
                      <p className="text-slate-400 whitespace-pre-wrap leading-relaxed text-sm sm:text-base">
                        {profile.bio}
                      </p>
                    ) : (
                      <p className="text-slate-400 italic text-sm">滚木</p>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <MdAccessTime size={18} />
                  <span>加入于 {new Date(profile.created_at).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
            </div>
          </div>

          {(profile.derpi_username || profile.derpi_user_id) && (
            <div className="mb-8">
              <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
                连接的账号
              </h3>
              <div className="flex flex-wrap gap-4">
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-1 min-w-[200px]">
                  <span className="text-xs font-semibold text-slate-500 uppercase">Derpibooru</span>
                  {profile.derpi_username ? (
                    <span className="text-slate-800 font-medium">{profile.derpi_username}</span>
                  ) : (
                    <span className="text-slate-800 font-medium">ID: {profile.derpi_user_id}</span>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
