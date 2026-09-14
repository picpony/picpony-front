'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import Skeleton, { SkeletonCircle } from '@/components/Skeleton';
import ErrorRetry from '@/components/ErrorRetry';
import { showToast } from '@/components/Toast';
import { disableDeveloperMode, enableDeveloperMode, getDeveloperStatus } from '@/lib/api/picpony';
import { MdCheckCircle, MdCancel, MdConstruction } from 'react-icons/md';
import { ICON } from '@/lib/icons';
import { readToken, useSession } from '@/lib/hooks';
import { LS_KEYS } from '@/lib/constants';

interface DevPrerequisites {
  logged_in?: boolean;
  api_bound?: boolean;
  level_gt_3?: boolean;
}

interface DeveloperGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 前置条件单项：满足显示勾选，未满足显示叉 */
function PreqRow({ label, met }: { label: string; met: boolean }) {
  return (
    <div className="flex items-center gap-2 text-body-m">
      {met ? (
        <MdCheckCircle className="text-success" size={ICON.dense} />
      ) : (
        <MdCancel className="text-error" size={ICON.dense} />
      )}
      {/* `on-surface-variant`, not `outline`: this is a label, and `outline` is
          the boundary role — 4.3:1 on the light surface, under the AA floor for
          text. */}
      <span className={met ? 'text-on-surface' : 'text-on-surface-variant'}>{label}</span>
    </div>
  );
}

/**
 * 开发者模式激活向导（参考旧前端 devPasswordModal + get_developer_status）。
 * 流程：打开时拉取开发者状态与前置条件 → 满足后输入 8 位维护密码 →
 * enable_developer_mode → 本地标记 + 广播事件（设置页据此显示"开发者模式"选项）。
 */
export default function DeveloperGuideModal({ isOpen, onClose }: DeveloperGuideModalProps) {
  const { token, ready } = useSession();
  const [status, setStatus] = useState<'loading' | 'ready' | 'banned' | 'error'>('loading');
  const [isDeveloper, setIsDeveloper] = useState(false);
  const [prerequisites, setPrerequisites] = useState<DevPrerequisites>({});
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const locked = useRef(false);

  // 每次打开时同步最新状态（重置 + 拉取均在微任务中，避免 effect 内同步 setState）
  useEffect(() => {
    const current = ++generation.current;
    locked.current = false;
    if (!isOpen || !ready) return;
    const controller = new AbortController();
    const isCurrent = () => generation.current === current && readToken() === token;
    queueMicrotask(() => {
      if (!isCurrent()) return;
      setStatus('loading');
      setError('');
      setPassword('');
      setSubmitting(false);
      if (!token) {
        // 未登录：前置条件全部不满足
        setPrerequisites({ logged_in: false, api_bound: false, level_gt_3: false });
        setIsDeveloper(false);
        setStatus('ready');
        return;
      }

      getDeveloperStatus(token, controller.signal)
        .then((data) => {
          if (!isCurrent()) return;
          if (!data?.success) throw new Error('开发者状态加载失败');
          if (data?.is_developer_banned) {
            setStatus('banned');
            return;
          }
          setIsDeveloper(!!data?.is_developer);
          setPrerequisites(data?.prerequisites || {});
          setStatus('ready');
        })
        .catch(() => {
          if (isCurrent()) setStatus('error');
        });
    });
    return () => {
      generation.current += 1;
      controller.abort();
    };
  }, [isOpen, token, ready, attempt]);

  const allMet = !!(prerequisites.logged_in && prerequisites.api_bound && prerequisites.level_gt_3);

  const changeMode = async (enabled: boolean) => {
    if (!isOpen || !token || readToken() !== token || locked.current) return;
    if (enabled && (password.length !== 8 || !allMet)) return;
    const current = generation.current;
    const isCurrent = () => generation.current === current && readToken() === token;
    locked.current = true;
    setSubmitting(true);
    setError('');
    try {
      const res = await (enabled ? enableDeveloperMode(token, password) : disableDeveloperMode(token));
      const data = await res.json().catch(() => null);
      if (readToken() !== token) return;
      if (!res.ok || data?.success !== true) {
        throw new Error(data?.error || data?.message || (enabled ? '开启失败' : '关闭失败'));
      }
      try {
        if (enabled) localStorage.setItem(LS_KEYS.developer, 'true');
        else localStorage.removeItem(LS_KEYS.developer);
      } catch {
        // The backend accepted the change even if this browser cannot persist it.
      }
      window.dispatchEvent(new Event('settings_updated'));
      window.dispatchEvent(new Event('developer_mode_changed'));
      // The accepted device setting outlives a closed form; UI feedback does not.
      if (!isCurrent()) return;
      setIsDeveloper(enabled);
      showToast(enabled ? '开发者模式已开启' : '开发者模式已关闭', enabled ? 'success' : 'info');
    } catch (failure) {
      if (!isCurrent()) return;
      const message = failure instanceof Error ? failure.message : '网络错误，请稍后再试';
      if (enabled) setError(message);
      else showToast(message, 'error');
    } finally {
      if (generation.current === current) locked.current = false;
      if (isCurrent()) setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="开发者模式"
      maxWidth="sm"
      closeOnOverlayClick={false}
      footer={status === 'ready' && (
        isDeveloper ? (
          <Button variant="tonal" onClick={() => changeMode(false)} loading={submitting}>
            关闭开发者模式
          </Button>
        ) : allMet ? (
          <Button
            variant="filled"
            onClick={() => changeMode(true)}
            loading={submitting}
            disabled={password.length !== 8}
          >
            确认开启
          </Button>
        ) : null
      )}
    >
      <div className="space-y-4">
        {/* The destination's own shape — three prerequisite rows — rather than
            a centred spinner: three bars say "a checklist is arriving here",
            in the geometry it arrives in. */}
        {status === 'loading' && (
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <SkeletonCircle size={18} delay={i * 90} />
                <Skeleton className="h-4 w-40" delay={i * 90 + 45} />
              </div>
            ))}
          </div>
        )}

        {status === 'banned' && (
          <p className="text-body-m text-error">您的开发者权限已被封禁，请联系管理员</p>
        )}

        {status === 'error' && (
          <ErrorRetry size="inline" title="开发者状态加载失败" onRetry={() => setAttempt((value) => value + 1)} />
        )}

        {status === 'ready' && (
          <>
            {isDeveloper ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-body-m text-primary-ink">
                  <MdConstruction size={ICON.control} />
                  当前已处于开发者模式
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <PreqRow label="用户已登录" met={!!prerequisites.logged_in} />
                  <PreqRow label="已绑定 Derpibooru API Key" met={!!prerequisites.api_bound} />
                  <PreqRow label="账户等级高于 3 级" met={!!prerequisites.level_gt_3} />
                </div>

                {allMet ? (
                  <div className="space-y-3">
                    <Input
                      label="维护密码"
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError('');
                      }}
                      maxLength={8}
                      autoComplete="current-password"
                      placeholder="请输入 8 位维护密码"
                      error={error || undefined}
                    />
                  </div>
                ) : (
                  <p className="text-body-s text-on-surface-variant">
                    满足以上条件后，方可开启开发者模式（不过滤任何标签内容）。
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
