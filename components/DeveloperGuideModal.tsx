'use client';

import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import Spinner from '@/components/Spinner';
import { showToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { MdCheckCircle, MdCancel, MdConstruction } from 'react-icons/md';

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
        <MdCheckCircle className="text-primary" size={18} />
      ) : (
        <MdCancel className="text-error" size={18} />
      )}
      <span className={met ? 'text-on-surface' : 'text-outline'}>{label}</span>
    </div>
  );
}

/**
 * 开发者模式激活向导（参考旧前端 devPasswordModal + get_developer_status）。
 * 流程：打开时拉取开发者状态与前置条件 → 满足后输入 8 位维护密码 →
 * enable_developer_mode → 本地标记 + 广播事件（设置页据此显示"开发者模式"选项）。
 */
export default function DeveloperGuideModal({ isOpen, onClose }: DeveloperGuideModalProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'banned'>('loading');
  const [isDeveloper, setIsDeveloper] = useState(false);
  const [prerequisites, setPrerequisites] = useState<DevPrerequisites>({});
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const tokenRef = useRef('');

  // 每次打开时同步最新状态（重置 + 拉取均在微任务中，避免 effect 内同步 setState）
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatus('loading');
      setError('');
      setPassword('');
      setSubmitting(false);
      let token = '';
      try {
        token = JSON.parse(localStorage.getItem('user_info') || 'null')?.token || '';
      } catch {
        token = '';
      }
      tokenRef.current = token;

      if (!token) {
        // 未登录：前置条件全部不满足
        setPrerequisites({ logged_in: false, api_bound: false, level_gt_3: false });
        setIsDeveloper(false);
        setStatus('ready');
        return;
      }

      api
        .getDeveloperStatus(token)
        .then((data) => {
          if (cancelled) return;
          if (data?.is_developer_banned) {
            setStatus('banned');
            return;
          }
          setIsDeveloper(!!data?.is_developer);
          setPrerequisites(data?.prerequisites || {});
          setStatus('ready');
        })
        .catch(() => {
          if (!cancelled) setStatus('ready');
        });
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const allMet = !!(prerequisites.logged_in && prerequisites.api_bound && prerequisites.level_gt_3);

  const broadcast = () => {
    window.dispatchEvent(new Event('settings_updated'));
    window.dispatchEvent(new Event('developer_mode_changed'));
  };

  const handleSubmit = async () => {
    if (password.length < 8) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await api.enableDeveloperMode(tokenRef.current, password);
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        localStorage.setItem('picpony_developer', 'true');
        setIsDeveloper(true);
        broadcast();
        showToast('开发者模式已开启', 'success');
      } else {
        setError(data?.error || '密码错误');
      }
    } catch {
      setError('网络错误，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisable = async () => {
    setSubmitting(true);
    try {
      const res = await api.disableDeveloperMode(tokenRef.current);
      const data = await res.json().catch(() => ({}));
      if (data?.success) {
        localStorage.removeItem('picpony_developer');
        setIsDeveloper(false);
        broadcast();
        showToast('开发者模式已关闭', 'info');
      } else {
        showToast(data?.error || '关闭失败', 'error');
      }
    } catch {
      showToast('网络错误，请稍后再试', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="开发者模式"
      maxWidth="max-w-sm"
      closeOnOverlayClick={false}
    >
      <div className="space-y-4">
        {status === 'loading' && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {status === 'banned' && (
          <p className="text-body-m text-error">您的开发者权限已被封禁，请联系管理员</p>
        )}

        {status === 'ready' && (
          <>
            {isDeveloper ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-body-m text-primary">
                  <MdConstruction size={20} />
                  当前已处于开发者模式
                </div>
                <Button variant="tonal" size="sm" onClick={handleDisable} disabled={submitting}>
                  {submitting ? '处理中...' : '关闭开发者模式'}
                </Button>
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
                      type="password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError('');
                      }}
                      maxLength={8}
                      autoComplete="current-password"
                      placeholder="请输入 8 位维护密码"
                      aria-label="维护密码"
                    />
                    {error && <p className="text-body-s text-error">{error}</p>}
                    <Button
                      variant="filled"
                      size="sm"
                      onClick={handleSubmit}
                      disabled={submitting || password.length < 8}
                    >
                      {submitting ? '验证中...' : '确认开启'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-body-s text-outline">
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
