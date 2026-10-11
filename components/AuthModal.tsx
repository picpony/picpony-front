'use client';

import { createContext, lazy, Suspense, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { MdClose } from 'react-icons/md';
import IconButton from './IconButton';
import Modal from './Modal';
import LottieIcon from './LottieIcon';
import Logo from './Logo';
import FollowHeight from './FollowHeight';
import Spinner from '@/components/Spinner';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { MEDIA } from '@/lib/constants';

// Modal owns focus, history and closing even while the form chunk is loading. Its body is
// mounted only when shown, so the shell never loads the forms merely to provide openAuth.
const AuthForms = lazy(() => import('./AuthForms'));

export type AuthView = 'login' | 'register' | 'reset';

interface AuthContextValue {
  isOpen: boolean;
  view: AuthView;
  openAuth: (view?: AuthView) => void;
  closeAuth: () => void;
  switchView: (view: AuthView) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuthModal() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthModal 必须在 AuthProvider 内使用');
  return ctx;
}

/**
 * A sign-up that is waiting for its e-mail code. It outlives the dialog — and, through
 * `sessionStorage`, a reload or a phone discarding the tab while the user fetches the code
 * from their mail app: without it, closing the dialog threw the verification step away for
 * good and signing up again failed because the account already existed. It ends when the code
 * is accepted or the user explicitly starts over. No password is kept.
 */
export interface PendingRegistration {
  userId: number;
  username: string;
  email: string;
}

const PENDING_REGISTRATION_KEY = 'picpony_pending_registration';

function readPendingRegistration(): PendingRegistration | null {
  try {
    const raw = sessionStorage.getItem(PENDING_REGISTRATION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingRegistration> | null;
    if (
      value &&
      typeof value.userId === 'number' &&
      typeof value.username === 'string' &&
      typeof value.email === 'string'
    ) {
      return { userId: value.userId, username: value.username, email: value.email };
    }
  } catch {
    // Storage can be disabled; the step then lasts as long as the page.
  }
  return null;
}

function writePendingRegistration(value: PendingRegistration | null) {
  try {
    if (value) sessionStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_REGISTRATION_KEY);
  } catch {
    // As above: the in-memory copy still carries the step for this page.
  }
}

/** Where a view switch hands the value the user already typed (忘记密码 carries the account). */
export interface ViewSwitch {
  view: AuthView;
  account?: string;
}

// 全局登录弹窗：登录/注册/找回共用，切换视图时窗口不关闭
export function AuthProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<AuthView>('login');
  // 验证码弹窗打开时禁用外层 Esc，避免误关整窗
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [flow, setFlow] = useState(0);
  /** A switch inside an open dialog plays the pane swap; the dialog's own entrance does not. */
  const [switched, setSwitched] = useState(false);
  const [prefillAccount, setPrefillAccount] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<PendingRegistration | null>(null);
  const flowRef = useRef(0);
  const openRef = useRef(false);

  const openAuth = useCallback((v: AuthView = 'login') => {
    openRef.current = true;
    setFlow(++flowRef.current);
    setCaptchaOpen(false);
    setSwitched(false);
    setPrefillAccount(undefined);
    // Read at the gesture, not during render: storage is not there on the server.
    setPending(readPendingRegistration());
    setView(v);
    setIsOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    openRef.current = false;
    flowRef.current += 1;
    setCaptchaOpen(false);
    setIsOpen(false);
  }, []);

  const switchTo = useCallback((next: ViewSwitch) => {
    setFlow(++flowRef.current);
    setCaptchaOpen(false);
    setSwitched(true);
    setPrefillAccount(next.account);
    setView(next.view);
  }, []);

  const switchView = useCallback((v: AuthView) => switchTo({ view: v }), [switchTo]);

  const updatePending = useCallback((value: PendingRegistration | null) => {
    writePendingRegistration(value);
    setPending(value);
  }, []);

  const value = useMemo(
    () => ({ isOpen, view, openAuth, closeAuth, switchView }),
    [isOpen, view, openAuth, closeAuth, switchView],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthModal
        isOpen={isOpen}
        view={view}
        onClose={closeAuth}
        onSwitch={switchTo}
        captchaOpen={captchaOpen}
        onCaptchaChange={setCaptchaOpen}
        flow={flow}
        switched={switched}
        prefillAccount={prefillAccount}
        pending={pending}
        onPendingChange={updatePending}
        isCurrentFlow={() => openRef.current && flowRef.current === flow}
      />
    </AuthContext.Provider>
  );
}

/** What every view receives from the dialog. */
export interface AuthFormProps {
  headingId: string;
  onSwitch: (next: ViewSwitch) => void;
  onCaptchaChange: (open: boolean) => void;
  onSuccess: () => void;
  isCurrentFlow: () => boolean;
  /** Typed input exists: a stray tap on the scrim must not throw it away. */
  onDirtyChange: (dirty: boolean) => void;
  /** Put focus in a form when it arrives, including a deferred first load. */
  focusOnMount: boolean;
  /** Under a mouse the first field takes focus; under a finger that would raise the keyboard. */
  finePointer: boolean;
  /** The account typed on the sign-in form, handed to the reset form. */
  prefillAccount?: string;
  pending: PendingRegistration | null;
  onPendingChange: (value: PendingRegistration | null) => void;
}

function AuthModal({
  isOpen,
  view,
  onClose,
  onSwitch,
  captchaOpen,
  onCaptchaChange,
  flow,
  switched,
  prefillAccount,
  pending,
  onPendingChange,
  isCurrentFlow,
}: {
  isOpen: boolean;
  view: AuthView;
  onClose: () => void;
  onSwitch: (next: ViewSwitch) => void;
  captchaOpen: boolean;
  onCaptchaChange: (open: boolean) => void;
  flow: number;
  switched: boolean;
  prefillAccount?: string;
  pending: PendingRegistration | null;
  onPendingChange: (value: PendingRegistration | null) => void;
  isCurrentFlow: () => boolean;
}) {
  const headingId = useId();
  const finePointer = useMediaQuery(MEDIA.pointerFine);
  /* Keyed on the flow, so a fresh form never inherits the last one's answer: each form
     reports its own state after it mounts. */
  const [dirtyFlow, setDirtyFlow] = useState<number | null>(null);
  const onDirtyChange = useCallback(
    (dirty: boolean) => setDirtyFlow((current) => (dirty ? flow : current === flow ? null : current)),
    [flow],
  );
  const dirty = dirtyFlow === flow;

  const shared: Omit<AuthFormProps, 'onSuccess'> = {
    headingId,
    onSwitch,
    onCaptchaChange,
    isCurrentFlow,
    onDirtyChange,
    // A cold lazy form arrives after Modal has focused its loading state.
    focusOnMount: true,
    finePointer,
    prefillAccount,
    pending,
    onPendingChange,
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="4xl"
      aria-labelledby={headingId}
      bodyClassName="p-0"
      closeOnEscape={!captchaOpen}
      // 已输入内容时，点击遮罩不关闭（关闭按钮、Esc 与返回键仍然有效）
      closeOnOverlayClick={!dirty}
      hideCloseButton
      // 整个窗口组件在验证码弹窗打开时缩小让位，带动画
      // 独立 scale 属性与 Modal 的 WAAPI transform 分开，保留嵌套弹层的层级反馈
      panelClassName={cn(
        'transition-[scale] spring-default-spatial',
        captchaOpen ? 'scale-95' : 'scale-100',
      )}
    >
      {/* 手机高度跟随内容自适应，桌面保持固定较高高度 */}
      <div className="flex md:min-h-[640px]">
        <div
          aria-hidden="true"
          className="hidden md:flex md:w-3/5 items-center justify-center bg-surface-container-low"
        >
          <LottieIcon
            className="w-4/5 max-w-md"
            load={() => import('@/lib/lottie/login.json').then((m) => m.default)}
            /* 3257×2148, the composition's own box. Reserving it matters more here
               than on /search: this pane is 60% of a 640px-tall dialog, so an
               unreserved host let the form column decide the height and then
               resized it when the chunk landed. */
            aspect={3257 / 2148}
            /* The wordmark, which is what /about already falls back to under
               reduced motion — so this pane is never empty. */
            fallback={<Logo className="h-auto w-2/3" />}
          />
        </div>
        {/* flex-col + my-auto：内容短时垂直居中。The dialog's body is the one scroller;
            pretty wrapping reaches every helper line under the fields, so no rule
            ends on a lone character. */}
        <div className="relative flex w-full flex-col p-6 text-pretty sm:p-8 md:w-2/5">
          <IconButton
            onClick={onClose}
            aria-label="关闭"
            dismiss
            /* Where every dialog's ✕ sits: 16dp from the trailing edge, centred on the
               first 32dp line (the same place `Modal`'s own header puts it). */
            className="absolute right-4 top-5 z-10 hover:text-on-surface"
            icon={<MdClose size={ICON.standard} />}
          />
          <FollowHeight className="my-auto">
            <div
              key={`${view}:${flow}`}
              /* A view switch owns this fade; opening the dialog already fades its panel. */
              className={cn(switched && 'animate-page-transition')}
            >
              <Suspense fallback={
                <div>
                  <h2 id={headingId} tabIndex={-1} data-autofocus className="sr-only">
                    {view === 'login' ? '登录' : view === 'register' ? '注册' : '找回密码'}
                  </h2>
                  <Spinner label="加载中" className="min-h-80" />
                </div>
              }>
                <AuthForms {...shared} view={view} onSuccess={onClose} />
              </Suspense>
            </div>
          </FollowHeight>
        </div>
      </div>
    </Modal>
  );
}
