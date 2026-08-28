'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MdEdit,
  MdPerson,
  MdImage,
  MdSearch,
  MdFilterList,
  MdVisibility,
  MdSpeed,
  MdSecurity,
  MdNotifications,
  MdHome,
  MdVerifiedUser,
  MdLinkOff,
  MdPalette,
  MdBrightness6,
  MdAnimation,
  MdRefresh,
  MdRoute,
  MdSpeed as MdSpeedIcon,
} from 'react-icons/md';
import { showToast } from '@/components/Toast';
import Badge from '@/components/Badge';
import Spinner from '@/components/Spinner';
import FadeInImage from '@/components/FadeInImage';
import ToggleSwitch from '@/components/ToggleSwitch';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import Button from '@/components/Button';
import ImageCropper from '@/components/ImageCropper';
import { api } from '@/lib/api';
import { proxyFetch, readJson } from '@/lib/api/client';
import { useAuthModal } from '@/components/AuthModal';
import { Input, Textarea } from '@/components/Input';
import PageHeader from '@/components/PageHeader';
import SectionHeading from '@/components/SectionHeading';
import PaletteSwatches from '@/components/PaletteSwatches';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import { ICON } from '@/lib/icons';
import { readUserInfo } from '@/lib/hooks';
import { DERPIBOORU_API_BASE, LS_KEYS } from '@/lib/constants';
import { changeScheme } from '@/lib/motionLazy';
import {
  commitEntranceMotion,
  commitMotion,
  useEntranceMotion,
  useMotionSetting,
  useMotionSpeed,
  useMotionTier,
  useSchemeSetting,
  type MotionSetting,
  type MotionSpeed,
  type SchemeSetting,
} from '@/lib/appearance';
import {
  apiPolicy,
  currentLineLabels,
  imagePolicy,
  raceImageLines,
  refreshRoutePolicy,
  subscribeRouteState,
  syncLinePrefs,
  type ApiPolicy,
  type ImagePolicy,
} from '@/lib/route';
import { getAssetUrl, processImageFile } from '@/lib/utils';

/* Radius and the 2px seam come from `.m3-row` (globals.css), which shapes a run
   of rows as one cut block rather than as separate floating cards.
   Two variants rather than one string plus an override, because `align-items` can only be
   spelled once: the palette row used to append `items-start` to a base carrying
   `items-center`, which renders left-aligned only for as long as Tailwind happens to emit
   `.items-center` first. Change the base to `items-end` some day and the swatch grid
   silently re-centres, with no diff at that call site to explain it. */
const rowBase =
  'm3-row flex flex-wrap justify-between gap-x-2 gap-y-3 p-4 sm:gap-x-4 bg-surface-container-low transition-ui state-layer';
const rowClass = `${rowBase} items-center sm:flex-nowrap`;
/** A row whose control needs the full width under its label — the palette picker's ten chips. */
const rowStackedClass = `${rowBase} flex-col items-start`;
/* The label column of a row. `min-w-0` is what lets a long value truncate
   instead of pushing the action out of the card. */
const rowLabelClass = 'min-w-0 flex-1';
/* A row's primary label, matching `ToggleSwitch layout="row"`'s own — `label-l` on
   `on-surface`, with 2px to the supporting line under it, which is `body-s` on
   `on-surface-variant`. It read `body-m`/`on-surface-variant` at 4px, i.e. the
   supporting role in the primary slot, so a row holding a `Select` and a row holding
   a switch announced two different hierarchies inside one card. */
const labelClass = 'text-label-l text-on-surface mb-0.5';
const valueClass = 'text-body-m-emphasized text-on-surface';

/** The two halves of this screen: what the device remembers, and what the account does. */
type SettingsTab = 'personalise' | 'general';

/** 计算年龄 */
function calcAge(birthday: string): number {
  if (!birthday) return 0;
  const birth = new Date(birthday);
  if (isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function lsGet(key: string, def: string): string {
  if (typeof window === 'undefined') return def;
  return localStorage.getItem(key) ?? def;
}
function lsBool(key: string, def: boolean): boolean {
  if (typeof window === 'undefined') return def;
  const v = localStorage.getItem(key);
  if (v === null) return def;
  return v === 'true';
}
function lsSet(key: string, val: string | boolean) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, String(val));
}

/**
 * 外观 — the five device-local appearance preferences, and the whole of the 个性化 tab.
 *
 * It renders **outside** the cloud-config gate the rest of this page sits behind, which is
 * also what makes it a tab of its own: that gate exists so a default cannot be written back
 * over a value the server has not returned yet, and none of these five has a server value, so
 * behind it they would be dimmed and inert for the length of a fetch they are not waiting on.
 * The tab split says the same thing in the UI — this side is the device, the other side is the
 * account.
 *
 * `lsGet`/`lsSet` are not used here either. These are owned by `lib/appearance`, which keeps
 * the stored keys, the cookie, the attribute on `<html>` and the subscription in one place —
 * the reason the app bar's glyph and the 主题模式 row below cannot disagree about which mode
 * is on, which two independent `useState`s could not have managed.
 *
 * **No supporting lines.** Four of these rows carried one, and all four were implementation
 * notes: "七套配色共用同一套色调映射与对比度", "等比缩放全站时长，不改变各段动画之间的节奏".
 * Those are true, they are the sort of thing this repo writes down at length — in `AGENTS.md`,
 * where the audience is whoever changes the code. A settings row needs a name.
 *
 * 主题模式 is new rather than moved: until now the only way to change the colour scheme was
 * the app bar's three-state cycle button, which is not a discoverable control and does not
 * say what the third state is.
 */
function AppearanceSection() {
  const schemeSetting = useSchemeSetting();
  const motionSetting = useMotionSetting();
  const motionSpeed = useMotionSpeed();
  const motionTier = useMotionTier();
  const entrances = useEntranceMotion();

  /* Speed applies to every tier that has a length, which is both of the tiers that animate:
     the tier decides the form and the speed decides the clock. It used to be standard-only,
     because `reduced` carried its own 0.5 — that is gone, and with it the one row on this
     page that was disabled while still describing what it would do.
     Disabled rather than hidden, because a control that vanishes is a control the user has to
     rediscover, and `disabled-content` says why it is unavailable. */
  const speedAvailable = motionTier !== 'off';

  return (
    <section className="mb-8">
      <SectionHeading icon={<MdPalette size={ICON.control} />} subtitle="仅保存在本设备，不随账号同步">
        外观
      </SectionHeading>

      <div className={rowStackedClass}>
        <div className={rowLabelClass}>
          <p className={labelClass}>主题配色</p>
        </div>
        <PaletteSwatches className="w-full" />
      </div>

      <div className={rowClass}>
        <div className="flex items-center gap-2">
          <MdBrightness6 size={ICON.control} className="text-outline" />
          <div className={rowLabelClass}>
            <p className={labelClass}>主题模式</p>
          </div>
        </div>
        <Select
          size="sm"
          value={schemeSetting}
          onChange={(v) => changeScheme(v as SchemeSetting)}
          aria-label="主题模式"
          className="w-full sm:w-auto"
          options={[
            { value: 'system', label: '跟随系统' },
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
          ]}
        />
      </div>

      <div className={rowClass}>
        <div className="flex items-center gap-2">
          <MdAnimation size={ICON.control} className="text-outline" />
          <div className={rowLabelClass}>
            <p className={labelClass}>动画效果</p>
          </div>
        </div>
        {/* Three options, not four. 跟随系统 was one of them and it is gone: the OS
            preference still decides what an unset value resolves to — `readMotionSetting`
            defaults to `system` and `resolveMotionTier` maps `reduce` to 减弱 — but the
            *control* shows the tier that is in force, so a visitor whose system asks for
            less motion sees 减弱动画 selected rather than a label that only says where the
            answer came from. Picking any option fixes it; nothing has to be migrated,
            because `system` remains the stored value until then. */}
        <Select
          size="sm"
          value={motionTier}
          onChange={(v) => commitMotion(v as MotionSetting, motionSpeed)}
          aria-label="动画效果"
          className="w-full sm:w-auto"
          options={[
            { value: 'off', label: '关闭动画' },
            { value: 'reduced', label: '减弱动画' },
            { value: 'standard', label: '标准动画' },
          ]}
        />
      </div>

      <div className={rowClass}>
        <div className="flex items-center gap-2">
          <MdSpeedIcon size={ICON.control} className="text-outline" />
          <div className={rowLabelClass}>
            <p className={labelClass}>动画速度</p>
          </div>
        </div>
        <Select
          size="sm"
          value={motionSpeed}
          disabled={!speedAvailable}
          onChange={(v) => commitMotion(motionSetting, v as MotionSpeed)}
          aria-label="动画速度"
          className="w-full sm:w-auto"
          options={[
            { value: 'fast', label: '快速' },
            { value: 'default', label: '默认' },
            { value: 'slow', label: '缓慢' },
          ]}
        />
      </div>

      {/* `layout="row"` so the label leads and the switch sits at the trailing edge, which
          is the reading order every other value row on this page has. */}
      <div className={rowClass}>
        <ToggleSwitch
          layout="row"
          checked={entrances}
          onChange={commitEntranceMotion}
          disabled={motionTier === 'off'}
          label="入场动画"
        />
      </div>
    </section>
  );
}

/* What the server renders for the 当前线路 row. `resolveApiLine` answers `direct` on the server
   and no policy is ever loaded there, so these are the SSR truth rather than a placeholder;
   `ready` is what keeps the row from claiming a line before the client has read one. */
const INITIAL_LINES = {
  ready: false,
  apiLabel: '直连',
  imageLabel: '直连',
  apiForced: false,
  imageForced: false,
  forcedApi: 'auto' as ApiPolicy,
  forcedImage: 'auto' as ImagePolicy,
};

type CloudSettings = {
  contentFilter?: string;
  showTagCounts?: boolean;
  banAnthro?: boolean;
  banDiscomfort?: boolean;
  onlyPony?: boolean;
  showChineseTags?: boolean;
  useCdn?: boolean;
  usePicponyProxy?: boolean;
  useApiAccel?: boolean;
  useHongKongRelay?: boolean;
  showUploads?: boolean;
  showFaves?: boolean;
  showPosts?: boolean;
  showComments?: boolean;
  emailNotifMessage?: boolean;
  emailNotifReply?: boolean;
  defaultHomeSort?: string;
  defaultSearchSort?: string;
};

export default function SettingsPage() {
  const { openAuth } = useAuthModal();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentUsername, setCurrentUsername] = useState('');
  const [currentAvatar, setCurrentAvatar] = useState('');
  const [currentBanner, setCurrentBanner] = useState('');
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [isBannerUploading, setIsBannerUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  // The picked file is staged here rather than uploaded straight away; the
  // cropper is what eventually produces the blob that gets sent.
  const [avatarPick, setAvatarPick] = useState<File | null>(null);
  const [bannerPick, setBannerPick] = useState<File | null>(null);

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const [currentApiKey, setCurrentApiKey] = useState('');
  const [derpiUserId, setDerpiUserId] = useState('');
  const [derpiUsername, setDerpiUsername] = useState('');
  const [isVerifyLoading, setIsVerifyLoading] = useState(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [isClearApiKeyModalOpen, setIsClearApiKeyModalOpen] = useState(false);

  const [currentEmail, setCurrentEmail] = useState('');
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [showVerifyInput, setShowVerifyInput] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileBio, setProfileBio] = useState('');
  const [profileGender, setProfileGender] = useState('保密');
  const [profileBirthday, setProfileBirthday] = useState('');
  const [profileRace, setProfileRace] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);

  const [contentFilter, setContentFilter] = useState<string>('safe');
  // Defaults only on first render so SSR HTML matches the client hydrate pass.
  // localStorage is applied after mount (see effect below).
  const [showTagCounts, setShowTagCounts] = useState(false);
  const [banAnthro, setBanAnthro] = useState(false);
  const [banDiscomfort, setBanDiscomfort] = useState(true);
  const [onlyPony, setOnlyPony] = useState(false);
  const [showChineseTags, setShowChineseTags] = useState(true);

  const [useCdn, setUseCdn] = useState(false);
  const [usePicponyProxy, setUsePicponyProxy] = useState(true);
  const [useApiAccel, setUseApiAccel] = useState(true);
  const [useHongKongRelay, setUseHongKongRelay] = useState(true);
  const [refreshingLines, setRefreshingLines] = useState(false);

  /* The line in force, which is not only this user's business: an administrator can pin the
     whole site to one, in which case the four toggles below report that value and stop being
     editable. Subscribed rather than read once, because a failover can move it while this page
     is open.
     `useState` + an effect rather than `useSyncExternalStore`, and that is the same rule the
     rest of this page follows: the server renders the defaults and localStorage is applied
     after mount. A store's client snapshot is read during hydration, so it would report the
     device's real line against server HTML built from the SSR fallback — and those differ on
     the *default* configuration, since the server always resolves `direct`. */
  const [lines, setLines] = useState(INITIAL_LINES);
  useEffect(() => {
    const read = () => {
      const l = currentLineLabels();
      setLines({
        ready: true,
        apiLabel: l.api,
        imageLabel: l.raceWon ? `${l.image}（竞速优选）` : l.image,
        apiForced: l.apiForced,
        imageForced: l.imageForced,
        forcedApi: apiPolicy(),
        forcedImage: imagePolicy(),
      });
    };
    read();
    return subscribeRouteState(read);
  }, []);

  const [showUploads, setShowUploads] = useState(true);
  const [showFaves, setShowFaves] = useState(true);
  const [showPosts, setShowPosts] = useState(true);
  const [showComments, setShowComments] = useState(true);

  const [emailNotifMessage, setEmailNotifMessage] = useState(true);
  const [emailNotifReply, setEmailNotifReply] = useState(true);

  const [defaultHomeSort, setDefaultHomeSort] = useState('created_at');
  const [defaultSearchSort, setDefaultSearchSort] = useState('created_at');

  // 云端配置获取完成前禁用整页交互（防止默认值误写 localStorage/云端）
  const [settingsReady, setSettingsReady] = useState(false);

  /** 设置 / 个性化. Local state — see the note above `<Tabs>`. */
  const [tab, setTab] = useState<SettingsTab>('general');

  const [userToken, setUserToken] = useState('');
  const [isDeveloper, setIsDeveloper] = useState(false);

  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [bannerLoaded, setBannerLoaded] = useState(false);

  /* `Modal` keeps the panel mounted through its own exit animation, so these
     just flip the flag — the previous 200ms setTimeout dance existed only to
     hold the hand-rolled overlay on screen long enough to animate out. The
     in-flight guards stay: a half-submitted form should not be dismissable. */
  const closeModal = () => {
    if (isLoading) return;
    setIsModalOpen(false);
    setNewUsername('');
  };
  const closePasswordModal = () => {
    if (passwordLoading) return;
    setIsPasswordModalOpen(false);
    setOldPassword('');
    setNewPassword('');
  };
  const closeApiKeyModal = () => {
    if (apiKeyLoading) return;
    setIsApiKeyModalOpen(false);
    setNewApiKey('');
  };
  const closeEmailModal = () => {
    if (emailLoading) return;
    setIsEmailModalOpen(false);
    setNewEmail('');
    setVerifyCode('');
    setShowVerifyInput(false);
  };
  const closeProfileModal = () => {
    if (profileLoading) return;
    setIsProfileModalOpen(false);
  };

  const syncSettingsToCloud = useCallback(
    async (overrides?: CloudSettings) => {
      if (!userToken) return;
      const settings: CloudSettings = overrides ?? {
        contentFilter,
        showTagCounts,
        banAnthro,
        banDiscomfort,
        onlyPony,
        showChineseTags,
        useCdn,
        usePicponyProxy,
        useApiAccel,
        useHongKongRelay,
        showUploads,
        showFaves,
        showPosts,
        showComments,
        emailNotifMessage,
        emailNotifReply,
        defaultHomeSort,
        defaultSearchSort,
      };
      try {
        await api.updateSettings(userToken, { settings });
      } catch (err) {
        console.warn('云端同步设置失败:', err);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('settings_updated'));
      }
    },
    [
      userToken,
      contentFilter,
      showTagCounts,
      banAnthro,
      banDiscomfort,
      onlyPony,
      showChineseTags,
      useCdn,
      usePicponyProxy,
      useApiAccel,
      useHongKongRelay,
      showUploads,
      showFaves,
      showPosts,
      showComments,
      emailNotifMessage,
      emailNotifReply,
      defaultHomeSort,
      defaultSearchSort,
    ],
  );

  const updateSetting = useCallback(
    <K extends keyof CloudSettings>(
      key: K,
      value: NonNullable<CloudSettings[K]>,
      lsKey: string,
      setter: (v: NonNullable<CloudSettings[K]>) => void,
    ) => {
      lsSet(lsKey, value);
      setter(value);
      syncSettingsToCloud({ [key]: value } as CloudSettings);
    },
    [syncSettingsToCloud],
  );

  const applyCloudSettings = useCallback((cloudSettings: CloudSettings | null) => {
    if (!cloudSettings) return;

    const apply = <K extends keyof CloudSettings>(
      key: K,
      lsKey: string,
      setter: (v: NonNullable<CloudSettings[K]>) => void,
    ) => {
      const val = cloudSettings[key];
      if (val !== undefined && val !== null) {
        lsSet(lsKey, val);
        setter(val as NonNullable<CloudSettings[K]>);
      }
    };

    apply('contentFilter', LS_KEYS.contentFilter, setContentFilter);
    apply('showTagCounts', LS_KEYS.showTagCounts, setShowTagCounts);
    apply('banAnthro', LS_KEYS.banAnthro, setBanAnthro);
    apply('banDiscomfort', LS_KEYS.banDiscomfort, setBanDiscomfort);
    apply('onlyPony', LS_KEYS.onlyPony, setOnlyPony);
    apply('showChineseTags', LS_KEYS.showChineseTags, setShowChineseTags);
    apply('useCdn', LS_KEYS.useCdn, setUseCdn);
    apply('usePicponyProxy', LS_KEYS.usePicponyProxy, setUsePicponyProxy);
    apply('useApiAccel', LS_KEYS.useApiAccel, setUseApiAccel);
    apply('useHongKongRelay', LS_KEYS.useHongKongRelay, setUseHongKongRelay);
    /* The account's stored lines have just landed in localStorage, so the request layer
       has to be told to re-read them — otherwise this session keeps resolving against
       whatever the device had before signing in. */
    syncLinePrefs();
    apply('showUploads', LS_KEYS.showUploads, setShowUploads);
    apply('showFaves', LS_KEYS.showFaves, setShowFaves);
    apply('showPosts', LS_KEYS.showPosts, setShowPosts);
    apply('showComments', LS_KEYS.showComments, setShowComments);
    apply('emailNotifMessage', LS_KEYS.emailNotifMessage, setEmailNotifMessage);
    apply('emailNotifReply', LS_KEYS.emailNotifReply, setEmailNotifReply);
    apply('defaultHomeSort', LS_KEYS.homeSort, setDefaultHomeSort);
    apply('defaultSearchSort', LS_KEYS.searchSort, setDefaultSearchSort);
  }, []);

  useEffect(() => {
    const user = readUserInfo();
    if (!user) {
      openAuth('login');
      // 无云端配置可等，直接恢复交互
      queueMicrotask(() => setSettingsReady(true));
      return;
    }
    try {
      queueMicrotask(() => {
        setCurrentUsername(String(user.username ?? ''));
        setCurrentAvatar(String(user.avatar ?? ''));
        setUserToken(user.token || '');

        const dev = localStorage.getItem(LS_KEYS.developer) === 'true';
        setIsDeveloper(dev);
      });

      api
        .getUser(user.token)
        // Same empty-body hazard as `AppLayout`'s own `get_user` call — and
        // here it lands as an unhandled rejection, since nothing follows.
        .then((res) => readJson(res))
        .then((data) => {
          if (data.success && data.user) {
            const u = data.user;
            setCurrentApiKey(u.api_key || '');
            setDerpiUserId(u.derpi_user_id || '');
            setDerpiUsername(u.derpi_username || '');
            if (u.api_key) localStorage.setItem(LS_KEYS.derpiApiKey, u.api_key);
            else localStorage.removeItem(LS_KEYS.derpiApiKey);

            if (u.avatar) {
              const fullUrl = u.avatar.startsWith('http')
                ? u.avatar
                : getAssetUrl(u.avatar);
              setCurrentAvatar(fullUrl);
              const updatedUser = { ...user, avatar: fullUrl };
              localStorage.setItem(LS_KEYS.userInfo, JSON.stringify(updatedUser));
            }

            setCurrentEmail(u.email || '');
            setIsEmailVerified(u.email_verified === 1);
            setCurrentBanner(u.banner || '');
            setProfileBio(u.bio || '');
            setProfileGender(u.gender || '保密');
            setProfileBirthday(u.birthday || '');
            setProfileRace(u.race || '');

            if (u.settings) {
              const cloudSettings: CloudSettings =
                typeof u.settings === 'string' ? JSON.parse(u.settings) : u.settings;
              applyCloudSettings(cloudSettings);
            }
          }
        })
        .catch((err) => console.error('Failed to fetch user info', err))
        // 云端配置获取结束（成功应用或失败）才解除页面锁定
        .finally(() => setSettingsReady(true));
    } catch (e) {
      console.error('Failed to parse user info', e);
    }
  }, [applyCloudSettings, openAuth]);

  // Hydrate preference toggles from localStorage after mount so the first
  // client render stays identical to SSR (avoids ToggleSwitch className mismatch).
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setShowTagCounts(lsBool(LS_KEYS.showTagCounts, false));
      setBanAnthro(lsBool(LS_KEYS.banAnthro, false));
      setBanDiscomfort(lsBool(LS_KEYS.banDiscomfort, true));
      setOnlyPony(lsBool(LS_KEYS.onlyPony, false));
      setShowChineseTags(lsBool(LS_KEYS.showChineseTags, true));
      setUseCdn(lsBool(LS_KEYS.useCdn, false));
      setUsePicponyProxy(lsBool(LS_KEYS.usePicponyProxy, true));
      setUseApiAccel(lsBool(LS_KEYS.useApiAccel, true));
      setUseHongKongRelay(lsBool(LS_KEYS.useHongKongRelay, true));
      setShowUploads(lsBool(LS_KEYS.showUploads, true));
      setShowFaves(lsBool(LS_KEYS.showFaves, true));
      setShowPosts(lsBool(LS_KEYS.showPosts, true));
      setShowComments(lsBool(LS_KEYS.showComments, true));
      setEmailNotifMessage(lsBool(LS_KEYS.emailNotifMessage, true));
      setEmailNotifReply(lsBool(LS_KEYS.emailNotifReply, true));
      setDefaultHomeSort(lsGet(LS_KEYS.homeSort, 'created_at'));
      setDefaultSearchSort(lsGet(LS_KEYS.searchSort, 'created_at'));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 开发者模式激活/关闭后（关于页向导广播）即时刷新，让下拉框选项跟上
  useEffect(() => {
    const read = () => setIsDeveloper(localStorage.getItem(LS_KEYS.developer) === 'true');
    window.addEventListener('developer_mode_changed', read);
    return () => window.removeEventListener('developer_mode_changed', read);
  }, []);

  useEffect(() => {
    const storedFilter = lsGet(LS_KEYS.contentFilter, 'safe');
    let validFilter = storedFilter;
    if (!['safe', 'spoilers', 'developer'].includes(storedFilter)) {
      validFilter = 'safe';
    }
    if (validFilter === 'spoilers') {
      const age = calcAge(profileBirthday);
      if (!userToken || age < 16) {
        validFilter = 'safe';
        lsSet(LS_KEYS.contentFilter, 'safe');
      }
    }
    if (validFilter === 'developer' && !isDeveloper) {
      validFilter = 'safe';
      lsSet(LS_KEYS.contentFilter, 'safe');
    }
    queueMicrotask(() => setContentFilter(validFilter));
  }, [userToken, profileBirthday, isDeveloper]);

  const handleAvatarPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    /* `processImageFile`, not the type-and-size check written out. It was inline
       here, again 48 lines below with one number changed, and twice more elsewhere —
       four copies of the byte arithmetic the helper's `maxSizeMB` parameter exists
       for, all emitting `请选择图片文件` where the helper says 请选择有效的图片文件. */
    try {
      await processImageFile(file, 5);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '请选择有效的图片文件', 'error');
      return;
    }
    setAvatarPick(file);
    // Cleared now, not on close: picking the same file twice in a row fires no
    // change event otherwise, and the cropper would never reopen.
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAvatarCropped = async (blob: Blob) => {
    setIsAvatarUploading(true);
    try {
      const user = readUserInfo();
      if (!user) throw new Error('未登录');
      const file = new File([blob], `avatar.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, {
        type: blob.type,
      });
      const res = await api.uploadAvatar(user.token, file);
      const data = await res.json();
      if (data.success) {
        showToast('头像上传成功', 'success');
        setAvatarPick(null);
        const fullUrl = data.avatar_url.startsWith('http')
          ? data.avatar_url
          : getAssetUrl(data.avatar_url);
        setCurrentAvatar(fullUrl);
        const updatedUser = { ...user, avatar: fullUrl };
        localStorage.setItem(LS_KEYS.userInfo, JSON.stringify(updatedUser));
        window.dispatchEvent(new Event('user_info_updated'));
      } else {
        showToast(data.message || '上传失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请稍后再试', 'error');
    } finally {
      setIsAvatarUploading(false);
    }
  };

  const handleBannerPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await processImageFile(file, 10);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '请选择有效的图片文件', 'error');
      return;
    }
    setBannerPick(file);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const handleBannerCropped = async (blob: Blob) => {
    setIsBannerUploading(true);
    try {
      const user = readUserInfo();
      if (!user) throw new Error('未登录');
      const file = new File([blob], `banner.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, {
        type: blob.type,
      });
      const res = await api.uploadBanner(user.token, file);
      const data = await res.json();
      if (data.success) {
        showToast('Banner 上传成功', 'success');
        setBannerPick(null);
        const fullUrl = data.banner_url.startsWith('http')
          ? data.banner_url
          : getAssetUrl(data.banner_url);
        setCurrentBanner(fullUrl);
        const updatedUser = { ...user, banner: fullUrl };
        localStorage.setItem(LS_KEYS.userInfo, JSON.stringify(updatedUser));
        window.dispatchEvent(new Event('user_info_updated'));
      } else {
        showToast(data.message || '上传失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请稍后再试', 'error');
    } finally {
      setIsBannerUploading(false);
    }
  };

  const handleApiKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = newApiKey.trim();
    if (key) {
      const keyRegex = /^\S{20}$/;
      if (!keyRegex.test(key)) {
        showToast(
          'API Key 格式不正确！请检查是否漏选或多复制了空格。Derpibooru 的 API Key 为 20 位字符',
          'error',
        );
        return;
      }
    }
    setApiKeyLoading(true);
    try {
      const user = readUserInfo();
      if (!user) throw new Error('未登录');
      const res = await api.saveApikey(user.token, {
        api_key: key,
        derpi_user_id: derpiUserId,
        derpi_username: derpiUsername,
      });
      const data = await res.json();
      if (data.success) {
        showToast('Derpibooru API Key 已保存', 'success');
        setCurrentApiKey(key);
        localStorage.setItem(LS_KEYS.derpiApiKey, key);
        closeApiKeyModal();
        window.dispatchEvent(new Event('user_info_updated'));
      } else {
        showToast(data.message || '配置失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请稍后再试', 'error');
    } finally {
      setApiKeyLoading(false);
    }
  };

  // Detect user identity from Derpibooru API
  const detectRealIdentity = useCallback(async (apiKey: string) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
      try {
        // 1. Try my:uploads
        const uploadsRes = await proxyFetch(
          `${DERPIBOORU_API_BASE}/search/images?q=my:uploads&per_page=1&key=${encodeURIComponent(apiKey)}`,
        );
        if (uploadsRes.status === 401 || uploadsRes.status === 403) return null;
        if (uploadsRes.ok) {
          const data = await uploadsRes.json();
          if (data.images && data.images.length > 0) {
            return { id: data.images[0].uploader_id, name: data.images[0].uploader };
          }
        } else {
          throw new Error(`HTTP ${uploadsRes.status}`);
        }
        // 2. Try my:comments
        const commentsRes = await proxyFetch(
          `${DERPIBOORU_API_BASE}/search/comments?q=my:comments&per_page=1&key=${encodeURIComponent(apiKey)}`,
        );
        if (commentsRes.status === 401 || commentsRes.status === 403) return null;
        if (commentsRes.ok) {
          const data = await commentsRes.json();
          if (data.comments && data.comments.length > 0) {
            return { id: data.comments[0].user_id, name: data.comments[0].author };
          }
        } else {
          throw new Error(`HTTP ${commentsRes.status}`);
        }
        // 3. Fallback: key is valid but user has no uploads/comments
        return { id: 'new_user', name: 'PicPony 绑定账号' };
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    return null;
  }, []);

  const handleVerifyIdentity = async () => {
    if (!currentApiKey) return;
    setIsVerifyLoading(true);
    try {
      const identity = await detectRealIdentity(currentApiKey);
      if (!identity) {
        showToast('身份核验失败：无法通过该 API Key 找到您的身份，请确认 Key 是否正确', 'error');
        return;
      }
      setDerpiUserId(identity.id);
      setDerpiUsername(identity.name);
      const user = readUserInfo();
      if (user) {
        await api.saveApikey(user.token, {
          api_key: currentApiKey,
          derpi_user_id: identity.id,
          derpi_username: identity.name,
        });
        localStorage.setItem(LS_KEYS.derpiApiKey, currentApiKey);
        window.dispatchEvent(new Event('user_info_updated'));
      }
      showToast(`核验成功，已确认您的身份：${identity.name}`, 'success');
      window.dispatchEvent(new Event('user_info_updated'));
    } catch {
      showToast('核验请求失败（API 限流/网络问题），请稍后再试', 'error');
    } finally {
      setIsVerifyLoading(false);
    }
  };

  const handleClearApiKey = () => {
    if (!currentApiKey) return;
    setIsClearApiKeyModalOpen(true);
  };

  const handleClearApiKeyConfirm = async () => {
    setIsClearApiKeyModalOpen(false);
    try {
      const user = readUserInfo();
      if (!user) return;
      await api.saveApikey(user.token, {
        api_key: '',
        derpi_user_id: '',
        derpi_username: '',
      });
      setCurrentApiKey('');
      setDerpiUserId('');
      setDerpiUsername('');
      localStorage.removeItem(LS_KEYS.derpiApiKey);
      window.dispatchEvent(new Event('user_info_updated'));
      showToast('API Key 已解除绑定', 'success');
    } catch {
      showToast('操作失败', 'error');
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oldPassword.trim() || !newPassword.trim()) {
      showToast('密码不能为空', 'error');
      return;
    }
    setPasswordLoading(true);
    try {
      const user = readUserInfo();
      if (!user) throw new Error('未登录');
      const res = await api.changePassword(user.token, {
        old_password: oldPassword,
        new_password: newPassword,
      });
      const data = await res.json();
      if (data.success) {
        showToast('密码修改成功，即将重新登录', 'success');
        closePasswordModal();
        setTimeout(() => {
          localStorage.removeItem(LS_KEYS.userInfo);
          window.dispatchEvent(new Event('user_info_updated'));
          openAuth('login');
        }, 1500);
      } else {
        showToast(data.message || '修改失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请稍后再试', 'error');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) {
      showToast('用户名不能为空', 'error');
      return;
    }
    setIsLoading(true);
    try {
      const user = readUserInfo();
      if (!user) throw new Error('未登录');
      const res = await api.changeUsername(user.token, newUsername.trim());
      const data = await res.json();
      if (data.success) {
        showToast('用户名已更新', 'success');
        setCurrentUsername(newUsername.trim());
        const updatedUser = { ...user, username: newUsername.trim() };
        localStorage.setItem(LS_KEYS.userInfo, JSON.stringify(updatedUser));
        window.dispatchEvent(new Event('user_info_updated'));
        closeModal();
      } else {
        showToast(data.message || '修改失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请稍后再试', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) {
      showToast('请输入邮箱', 'error');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      showToast('请输入有效的邮箱地址', 'error');
      return;
    }

    setEmailLoading(true);
    try {
      const user = readUserInfo();
      if (!user) throw new Error('未登录');
      const res = await api.updateEmail(user.token, newEmail.trim());
      const data = await res.json();
      if (data.success) {
        setCurrentEmail(newEmail.trim());
        setIsEmailVerified(false);
        setShowVerifyInput(true);
        showToast('邮箱已更新，请查收验证码', 'success');
      } else {
        showToast(data.message || '更新失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请稍后再试', 'error');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (!verifyCode.trim()) {
      showToast('请输入验证码', 'error');
      return;
    }
    setEmailLoading(true);
    try {
      const user = readUserInfo();
      if (!user) return;
      const res = await api.verifyEmail(user.token, verifyCode.trim());
      const data = await res.json();
      if (data.success) {
        setIsEmailVerified(true);
        setShowVerifyInput(false);
        showToast('邮箱验证成功', 'success');
        closeEmailModal();
      } else {
        showToast(data.message || '验证失败', 'error');
      }
    } catch {
      showToast('验证失败', 'error');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsResending(true);
    try {
      const user = readUserInfo();
      if (!user) return;
      const res = await api.resendVerifyCode(user.token);
      const data = await res.json();
      if (data.success) {
        showToast('验证码已重新发送', 'success');
      } else {
        showToast(data.message || '发送失败', 'error');
      }
    } catch {
      showToast('发送失败', 'error');
    } finally {
      setIsResending(false);
    }
  };

  const handleProfileSubmit = async () => {
    setProfileLoading(true);
    try {
      const user = readUserInfo();
      if (!user) throw new Error('未登录');
      const res = await api.saveProfile(user.token, {
        bio: profileBio,
        gender: profileGender,
        birthday: profileBirthday,
        race: profileRace,
      });
      const data = await res.json();
      if (data.success) {
        showToast('个人资料已更新', 'success');
        window.dispatchEvent(new Event('user_info_updated'));
        closeProfileModal();
      } else {
        showToast(data.message || '保存失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '网络错误，请稍后再试', 'error');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleContentFilterChange = (val: string) => {
    if (val === 'developer' && !isDeveloper) {
      showToast('您还未激活开发者模式', 'warning');
      return;
    }
    if (val === 'spoilers') {
      if (!userToken) {
        showToast('请登录后才能选择此过滤器', 'warning');
        return;
      }
      const age = calcAge(profileBirthday);
      if (age < 16) {
        showToast('您未设置年龄或年龄不允许此选项', 'warning');
        return;
      }
    }
    setContentFilter(val);
    lsSet(LS_KEYS.contentFilter, val);
    syncSettingsToCloud({ contentFilter: val });
    showToast(
      `内容过滤器已切换至：${val === 'safe' ? '安全模式' : val === 'spoilers' ? '中等限制' : '开发者模式'}`,
      'info',
    );
  };

  /* All four line writers end with `syncLinePrefs()`. The request layer re-reads these
     keys from localStorage on every call, but *which line it is currently sitting on* is
     separate runtime state — and turning the relay on has to take the accel line out of
     the running, which is the same coupling the old frontend does in `mt()`. */
  const handleUseCdnChange = (val: boolean) => {
    setUseCdn(val);
    lsSet(LS_KEYS.useCdn, val);
    syncLinePrefs();
    syncSettingsToCloud({ useCdn: val });
  };

  const handleUsePicponyProxyChange = (val: boolean) => {
    setUsePicponyProxy(val);
    lsSet(LS_KEYS.usePicponyProxy, val);
    if (val) {
      setUseCdn(true);
      lsSet(LS_KEYS.useCdn, true);
    }
    syncLinePrefs();
    syncSettingsToCloud({ usePicponyProxy: val, useCdn: val || useCdn });
  };

  /* No API-key gate, and that is a deliberate divergence from the old frontend. The accel line
     is a `?url=` worker that needs no credential — `buildApiLineUrl` just wraps whatever URL it
     is given — so gating the switch on a key created a state nobody could leave: the row read
     off and was permanently disabled while the stored value stayed on, and `stepApiFailover`
     went on using the line the UI said was unavailable. */
  const handleUseApiAccelChange = (val: boolean) => {
    setUseApiAccel(val);
    lsSet(LS_KEYS.useApiAccel, val);
    syncLinePrefs();
    syncSettingsToCloud({ useApiAccel: val });
  };

  const handleUseHongKongRelayChange = (val: boolean) => {
    setUseHongKongRelay(val);
    lsSet(LS_KEYS.useHongKongRelay, val);
    syncLinePrefs();
    syncSettingsToCloud({ useHongKongRelay: val });
  };

  /* Re-read the site policy and re-measure the image lines. The policy is fetched once
     per load, so without this the only way to notice an administrator switching lines is
     to reload. The race reports through the same subscription rather than this promise —
     it can take up to five seconds and there is no reason to hold the button that long. */
  const handleRefreshLines = async () => {
    setRefreshingLines(true);
    raceImageLines();
    await refreshRoutePolicy();
    setRefreshingLines(false);
  };

  const sortOptions = [
    { value: 'created_at', label: '上传时间' },
    { value: 'updated_at', label: '更新时间' },
    { value: 'score', label: '评分' },
    { value: 'wilson_score', label: 'Wilson 评分' },
    { value: 'relevance', label: '相关度' },
    { value: 'random', label: '随机' },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title="设置" />
      {/* Two tabs, and the line between them is not a matter of taste: 设置 is what the
          account does and 个性化 is what this device remembers. That is also why only one
          side needs the gate below — see `AppearanceSection`. 设置 leads because it is the
          page's own name and the reason most visits happen; the pane order matches, because
          `TabPanes` derives its direction from DOM order.

          Local state rather than `?tab=`. `/policy` does the same, and `AGENTS.md` says why:
          a tab whose value lives in `useState` needs nothing but `TabPanes`, because the
          state update and its layout effect are the same commit. The URL form exists for
          screens that have to be linkable into a tab, and buys an optimistic-state dance
          plus a coalesced `router.push` that this page has no use for.

          No `lean`: the 设置 pane replaces most of its subtree the moment the cloud config
          lands, which is exactly the case `AGENTS.md` names as the counter-example. */}
      <Tabs
        tabs={[
          { value: 'general', label: '设置' },
          { value: 'personalise', label: '个性化' },
        ]}
        value={tab}
        onChange={setTab}
        label="设置分区"
        className="mb-6"
      />
      <TabPanes value={tab}>
        <TabPane value="general">
      {/* The cloud config gate: until the fetch resolves the page is dimmed and
          inert, so a default value cannot be written back over a setting the server
          has not returned yet.
          `disabled-content` (38%), not a third `opacity-50`. The gallery's paging dim
          is a documented pair — one value, two matched call sites on / and /favorites
          — and this was quietly a third, for a different purpose: the gallery is
          *replacing* content the user can still read, while this is a form that
          cannot be used yet. That is what "disabled" means, and M3 gives it 38%.
          200ms `standard`, which is what the two gallery sites use and what the
          comment here already claimed. */}
      <div
        aria-busy={!settingsReady}
        /* `aria-busy` belongs on the gate, not on the page. It sat on the `max-w-4xl`
           wrapper, which since the split encloses the tablist *and* the 个性化 pane — so a
           screen-reader user switching tabs to turn animations off was told the region was
           still loading, which is the one state the split exists to keep out of that pane. */
        className={`transition-[opacity] duration-standard ease-[var(--ease-standard)] ${
          settingsReady ? '' : 'disabled-content pointer-events-none'
        }`}
      >
      {/* No entrance animation. This is a settings form — rows of switches and
          values the user came here to change, not content to be revealed. Both
          the mount-time `<Reveal>` that used to wrap these sections and the
          scroll reveal that replaced it made a control列 arrive like an article.
          Entrance cascades are for picture content. */}
      <div>
        <section className="mb-8">
          <div>
            <SectionHeading icon={<MdPerson size={ICON.control} />}>账户设置</SectionHeading>

            <div className={rowClass}>
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16 rounded-full overflow-hidden bg-surface-container-highest shrink-0">
                  {currentAvatar ? (
                    <>
                      {!avatarLoaded && (
                        <div className="absolute inset-0 flex items-center justify-center text-outline z-10">
                          <MdPerson size={ICON.standard} />
                        </div>
                      )}
                      <FadeInImage
                        key={currentAvatar}
                        src={currentAvatar}
                        alt="头像预览"
                        fill
                        /* `w-16 h-16`. A `fill` image with no `sizes` resolves to `100vw`. */
                        sizes="64px"
                        className="object-cover"
                        onLoad={() => setAvatarLoaded(true)}
                      />
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-on-surface-variant text-headline-s-emphasized">
                      {currentUsername ? currentUsername.charAt(0).toUpperCase() : '?'}
                    </div>
                  )}
                  {isAvatarUploading && (
                    <div className="bg-media-plate absolute inset-0 flex items-center justify-center">
                      <Spinner tone="on-primary" />
                    </div>
                  )}
                </div>
                <div className={rowLabelClass}>
                  <p className={labelClass}>用户头像</p>
                  <p className="text-body-s text-on-surface-variant">支持 JPG、PNG、GIF 格式，最大 5MB</p>
                </div>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleAvatarPick}
                accept="image/*"
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={!currentUsername}
                loading={isAvatarUploading}
                icon={<MdEdit size={ICON.dense} />}
                title="修改头像"
              >
                修改头像
              </Button>
            </div>

            <div className={rowClass}>
              <div className="flex items-center gap-4">
                <div className="relative w-24 h-14 rounded-md overflow-hidden bg-surface-container-highest shrink-0">
                  {currentBanner ? (
                    <>
                      {!bannerLoaded && (
                        <div className="absolute inset-0 flex items-center justify-center text-outline z-10">
                          <MdImage size={ICON.control} />
                        </div>
                      )}
                      <FadeInImage
                        key={currentBanner}
                        src={
                          currentBanner.startsWith('http')
                            ? currentBanner
                            : getAssetUrl(currentBanner)
                        }
                        alt="横幅预览"
                        fill
                        /* `w-24 h-14`. Same reason as the avatar preview above. */
                        sizes="96px"
                        className="object-cover"
                        onLoad={() => setBannerLoaded(true)}
                      />
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-outline">
                      <MdImage size={ICON.control} />
                    </div>
                  )}
                  {isBannerUploading && (
                    <div className="bg-media-plate absolute inset-0 flex items-center justify-center">
                      <Spinner tone="on-primary" />
                    </div>
                  )}
                </div>
                <div className={rowLabelClass}>
                  <p className={labelClass}>个人 Banner</p>
                  <p className="text-body-s text-on-surface-variant">建议尺寸 1200×300，最大 10MB</p>
                </div>
              </div>
              <input
                type="file"
                ref={bannerInputRef}
                onChange={handleBannerPick}
                accept="image/*"
                className="hidden"
              />
              <Button
                onClick={() => bannerInputRef.current?.click()}
                disabled={!currentUsername}
                loading={isBannerUploading}
                icon={<MdImage size={ICON.dense} />}
                title="上传 Banner"
              >
                上传 Banner
              </Button>
            </div>

            <div className={rowClass}>
              <div className={rowLabelClass}>
                <p className={labelClass}>用户名</p>
                <p className={valueClass}>{currentUsername || '未登录'}</p>
              </div>
              <Button
                onClick={() => setIsModalOpen(true)}
                disabled={!currentUsername}
                icon={<MdEdit size={ICON.dense} />}
                title="修改用户名"
              >
                修改用户名
              </Button>
            </div>

            <div className={rowClass}>
              <div className={rowLabelClass}>
                <p className={labelClass}>账号密码</p>
                <p className={valueClass}>********</p>
              </div>
              <Button
                onClick={() => setIsPasswordModalOpen(true)}
                disabled={!currentUsername}
                icon={<MdEdit size={ICON.dense} />}
                title="修改密码"
              >
                修改密码
              </Button>
            </div>

            <div className={rowClass}>
              <div className={rowLabelClass}>
                <p className={labelClass}>邮箱</p>
                <p className={valueClass}>
                  {currentEmail || '未设置'}
                  {currentEmail && (
                    <Badge
                      tone={isEmailVerified ? 'success' : 'warning'}
                      size="sm"
                      className="ml-2"
                    >
                      {isEmailVerified ? '已验证' : '未验证'}
                    </Badge>
                  )}
                </p>
              </div>
              <Button
                onClick={() => {
                  setNewEmail(currentEmail);
                  setIsEmailModalOpen(true);
                }}
                disabled={!currentUsername}
                icon={<MdEdit size={ICON.dense} />}
                title={currentEmail ? '修改邮箱' : '绑定邮箱'}
              >
                {currentEmail ? '修改' : '绑定'}
              </Button>
            </div>

            <div className={rowClass}>
              <div className={rowLabelClass}>
                <p className={labelClass}>个人资料</p>
                <p className="text-body-s text-on-surface-variant">
                  {profileBio
                    ? profileBio.substring(0, 30) + (profileBio.length > 30 ? '…' : '')
                    : '点击编辑个人简介、性别、生日'}
                </p>
              </div>
              <Button
                onClick={() => setIsProfileModalOpen(true)}
                disabled={!currentUsername}
                icon={<MdEdit size={ICON.dense} />}
                title="编辑个人资料"
              >
                编辑
              </Button>
            </div>

            <div className={rowClass}>
              <div className={rowLabelClass}>
                <p className={labelClass}>Derpibooru API Key</p>
                <p className={valueClass}>
                  {currentApiKey
                    ? `${currentApiKey.substring(0, 4)}...${currentApiKey.substring(currentApiKey.length - 4)}`
                    : '未配置'}
                </p>
                {derpiUsername && (
                  <p className="text-body-s text-success mt-1">已验证身份：{derpiUsername}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {currentApiKey && (
                  <>
                    <Button
                      onClick={handleVerifyIdentity}
                      disabled={!currentUsername}
                      loading={isVerifyLoading}
                      variant="tonal"
                      icon={<MdVerifiedUser size={ICON.dense} />}
                      title="核验身份"
                      responsiveLabel
                    >
                      去核验
                    </Button>
                    <Button
                      onClick={handleClearApiKey}
                      disabled={!currentUsername}
                      variant="text"
                      icon={<MdLinkOff size={ICON.dense} />}
                      title="解除绑定"
                      responsiveLabel
                      className="text-error hover:bg-error-container hover:text-on-error-container"
                    >
                      解除绑定
                    </Button>
                  </>
                )}
                <Button
                  onClick={() => {
                    setNewApiKey(currentApiKey);
                    setIsApiKeyModalOpen(true);
                  }}
                  disabled={!currentUsername}
                  icon={<MdEdit size={ICON.dense} />}
                  title={currentApiKey ? '修改配置' : '去配置'}
                  responsiveLabel
                >
                  {currentApiKey ? '修改配置' : '去配置'}
                </Button>
              </div>
            </div>
          </div>
        </section>
        <section className="mb-8">
          <div>
            <SectionHeading icon={<MdFilterList size={ICON.control} />}>内容筛选</SectionHeading>

            <div className={rowClass}>
              <div className={rowLabelClass}>
                <p className={labelClass}>内容分级过滤器</p>
                <p className="text-body-s text-on-surface-variant">
                  {contentFilter === 'safe' && '仅显示安全内容'}
                  {contentFilter === 'spoilers' && '拦截限制级内容（需 16 岁以上）'}
                  {contentFilter === 'developer' && '开发者模式，显示所有内容'}
                </p>
              </div>
              {/* `size="sm"` — 40dp, not the field's 56. This control sits in an
                  `.m3-row` whose next three siblings hold a 32dp `ToggleSwitch`, so
                  at 56 it made this row 88px against their 78 and read as 1.75x the
                  control below it. A control's step comes from its enclosure: in a
                  row it matches the row's other controls, which also puts the row's
                  height back under the control of its *text*. */}
              <Select
                size="sm"
                value={contentFilter}
                onChange={handleContentFilterChange}
                aria-label="内容分级过滤器"
                className="w-full sm:w-auto"
                options={[
                  { value: 'safe', label: '完全安全 (Safe)' },
                  { value: 'spoilers', label: '中等限制 (Spoilers)' },
                  ...(isDeveloper ? [{ value: 'developer', label: '开发者模式' }] : []),
                ]}
              />
            </div>

            <div className={rowClass}>
              <ToggleSwitch
                layout="row"
                checked={banAnthro}
                onChange={(v) => updateSetting('banAnthro', v, LS_KEYS.banAnthro, setBanAnthro)}
                label="禁止类人生物 (马头人)"
                description="隐藏 anthropomorphic 标签的图片"
              />
            </div>

            <div className={rowClass}>
              <ToggleSwitch
                layout="row"
                checked={banDiscomfort}
                onChange={(v) =>
                  updateSetting('banDiscomfort', v, LS_KEYS.banDiscomfort, setBanDiscomfort)
                }
                label="屏蔽可能令您不适的内容"
                description="隐藏血腥、恐怖等内容"
              />
            </div>

            <div className={rowClass}>
              <ToggleSwitch
                layout="row"
                checked={onlyPony}
                onChange={(v) => updateSetting('onlyPony', v, LS_KEYS.onlyPony, setOnlyPony)}
                label="只看小马 (含类马)"
                description="仅显示 pony 相关标签的图片"
              />
            </div>
          </div>
        </section>
        <section className="mb-8">
          <div>
            <SectionHeading icon={<MdVisibility size={ICON.control} />}>显示偏好</SectionHeading>

            <div className={rowClass}>
              <ToggleSwitch
                layout="row"
                checked={showTagCounts}
                onChange={(v) =>
                  updateSetting('showTagCounts', v, LS_KEYS.showTagCounts, setShowTagCounts)
                }
                label="显示各标签数量"
                description="在标签列表旁显示图片计数"
              />
            </div>

            <div className={rowClass}>
              <ToggleSwitch
                layout="row"
                checked={showChineseTags}
                onChange={(v) =>
                  updateSetting(
                    'showChineseTags',
                    v,
                    LS_KEYS.showChineseTags,
                    setShowChineseTags,
                  )
                }
                label="显示中文标签 (beta)"
                description="启用中文标签名翻译"
              />
            </div>

            <div className={rowClass}>
              <div className="flex items-center gap-2">
                <MdHome size={ICON.control} className="text-outline" />
                <div className={rowLabelClass}>
                  <p className={labelClass}>首页瀑布流默认排序</p>
                </div>
              </div>
              <Select
                size="sm"
                value={defaultHomeSort}
                onChange={(v) => {
                  setDefaultHomeSort(v);
                  lsSet(LS_KEYS.homeSort, v);
                  syncSettingsToCloud({ defaultHomeSort: v });
                }}
                aria-label="首页瀑布流默认排序"
                className="w-full sm:w-auto"
                options={sortOptions}
              />
            </div>

            <div className={rowClass}>
              <div className="flex items-center gap-2">
                <MdSearch size={ICON.control} className="text-outline" />
                <div className={rowLabelClass}>
                  <p className={labelClass}>搜索默认排序</p>
                </div>
              </div>
              <Select
                size="sm"
                value={defaultSearchSort}
                onChange={(v) => {
                  setDefaultSearchSort(v);
                  lsSet(LS_KEYS.searchSort, v);
                  syncSettingsToCloud({ defaultSearchSort: v });
                }}
                aria-label="搜索默认排序"
                className="w-full sm:w-auto"
                options={sortOptions}
              />
            </div>
          </div>
        </section>
        <section className="mb-8">
          <div>
            <SectionHeading
              icon={<MdSpeed size={ICON.control} />}
              actions={
                <Button
                  size="xs"
                  variant="tonal"
                  icon={<MdRefresh />}
                  loading={refreshingLines}
                  onClick={handleRefreshLines}
                >
                  重新检测
                </Button>
              }
            >
              性能与加速
            </SectionHeading>

            {/* Which line is actually in use, which is not always what the switches below
                say: an administrator can pin the whole site to one, and a failover can
                move it mid-session. Read-only — the row reports, the switches ask. */}
            <div className={rowClass}>
              <div className="flex items-center gap-2">
                <MdRoute size={ICON.control} className="text-outline" />
                <div className={rowLabelClass}>
                  <p className={labelClass}>当前线路</p>
                  <p className={valueClass}>
                    {lines.ready ? `API：${lines.apiLabel} ｜ 图片：${lines.imageLabel}` : '检测中…'}
                  </p>
                </div>
              </div>
              {(lines.apiForced || lines.imageForced) && (
                <Badge tone="warning" size="sm">
                  全站强制
                </Badge>
              )}
            </div>

            <div className={rowClass}>
              <ToggleSwitch
                layout="row"
                checked={lines.imageForced ? lines.forcedImage === 'cdn' : useCdn}
                onChange={handleUseCdnChange}
                disabled={lines.imageForced}
                label="启用图片 CDN 加速"
                description={
                  lines.imageForced ? '图片线路已被全站强制指定' : '通过 wsrv.nl 加速图片加载'
                }
              />
            </div>

            <div className={rowClass}>
              <ToggleSwitch
                layout="row"
                checked={lines.imageForced ? lines.forcedImage === 'picpony' : usePicponyProxy}
                onChange={handleUsePicponyProxyChange}
                disabled={lines.imageForced}
                label="启用 PicPony 加速服务器 (beta)"
                description={
                  lines.imageForced
                    ? '图片线路已被全站强制指定'
                    : '通过 PicPony 代理服务器加载图片，开启后自动启用 CDN 作为下一档'
                }
              />
            </div>

            <div className={rowClass}>
              <ToggleSwitch
                layout="row"
                checked={lines.apiForced ? lines.forcedApi === 'picpony_api' : useHongKongRelay}
                onChange={handleUseHongKongRelayChange}
                disabled={lines.apiForced}
                label="启用 PicPony API"
                description={
                  lines.apiForced
                    ? 'API 线路已被全站强制指定'
                    : '通过 PicPony 中转访问 Derpibooru，直连不通时的首选线路'
                }
              />
            </div>

            {/* Disabled while the relay is on rather than hidden: with the relay preferred
                this toggle has nothing left to select, and `disabled-content` says so
                where a vanished row would just have to be rediscovered. */}
            <div className={rowClass}>
              <ToggleSwitch
                layout="row"
                checked={lines.apiForced ? lines.forcedApi === 'api_accel' : useApiAccel}
                onChange={handleUseApiAccelChange}
                disabled={lines.apiForced || useHongKongRelay}
                label="启用 API 加速"
                description={
                  lines.apiForced
                    ? 'API 线路已被全站强制指定'
                    : useHongKongRelay
                      ? '已优先使用 PicPony API，关闭后此项可选'
                      : '通过备用 API 代理提升请求稳定性'
                }
              />
            </div>
          </div>
        </section>
        <section className="mb-8">
          <div>
            <SectionHeading
              icon={<MdSecurity size={ICON.control} />}
              subtitle="控制您的个人主页上对外显示的内容"
            >
              隐私设置
            </SectionHeading>

            <div>
              {[
                {
                  key: 'showUploads' as const,
                  label: '公开我的上传',
                  val: showUploads,
                  setter: setShowUploads,
                  lsKey: LS_KEYS.showUploads,
                },
                {
                  key: 'showFaves' as const,
                  label: '公开我的收藏',
                  val: showFaves,
                  setter: setShowFaves,
                  lsKey: LS_KEYS.showFaves,
                },
                {
                  key: 'showPosts' as const,
                  label: '公开我的帖子',
                  val: showPosts,
                  setter: setShowPosts,
                  lsKey: LS_KEYS.showPosts,
                },
                {
                  key: 'showComments' as const,
                  label: '公开我的评论',
                  val: showComments,
                  setter: setShowComments,
                  lsKey: LS_KEYS.showComments,
                },
              ].map((item) => (
                <div key={item.key} className={rowClass}>
                  <ToggleSwitch
                    layout="row"
                    checked={item.val}
                    onChange={(v) => updateSetting(item.key, v, item.lsKey, item.setter)}
                    label={item.label}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="mb-8">
          <div>
            <SectionHeading
              icon={<MdNotifications size={ICON.control} />}
              subtitle="选择接收哪些邮件通知（需要先绑定邮箱）"
            >
              通知偏好
            </SectionHeading>
            <div>
              <div className={rowClass}>
                <ToggleSwitch
                  layout="row"
                  checked={emailNotifMessage}
                  onChange={(v) =>
                    updateSetting(
                      'emailNotifMessage',
                      v,
                      LS_KEYS.emailNotifMessage,
                      setEmailNotifMessage,
                    )
                  }
                  label="有人给我发私信"
                  description="当收到新私信时发送邮件通知"
                />
              </div>
              <div className={rowClass}>
                <ToggleSwitch
                  layout="row"
                  checked={emailNotifReply}
                  onChange={(v) =>
                    updateSetting(
                      'emailNotifReply',
                      v,
                      LS_KEYS.emailNotifReply,
                      setEmailNotifReply,
                    )
                  }
                  label="有人回复我的帖子/评论"
                  description="当帖子或评论被回复时发送邮件通知"
                />
              </div>
            </div>
          </div>
        </section>
      </div>
      <ImageCropper
        file={avatarPick}
        onClose={() => setAvatarPick(null)}
        onCropped={handleAvatarCropped}
        aspect={1}
        shape="circle"
        outputWidth={512}
        title="调整头像"
        busy={isAvatarUploading}
      />
      <ImageCropper
        file={bannerPick}
        onClose={() => setBannerPick(null)}
        onCropped={handleBannerCropped}
        aspect={4}
        outputWidth={1600}
        outputHeight={400}
        title="调整个人横幅"
        busy={isBannerUploading}
      />
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title="修改用户名"
        footer={
          <>
            <Button variant="text" type="button" onClick={closeModal} disabled={isLoading}>
              取消
            </Button>
            <Button
              variant="filled"
              type="submit"
              form="username-form"
              loading={isLoading}
              disabled={!newUsername.trim()}
            >
              确认修改
            </Button>
          </>
        }
      >
        <form id="username-form" onSubmit={handleUsernameSubmit}>
          <label htmlFor="new-username" className="block text-label-l text-on-surface mb-2">
            新用户名
          </label>
          <Input
            id="new-username"
            data-autofocus
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="请输入新用户名"
            disabled={isLoading}
          />
        </form>
      </Modal>
      <Modal
        isOpen={isPasswordModalOpen}
        onClose={closePasswordModal}
        title="修改密码"
        footer={
          <>
            <Button
              variant="text"
              type="button"
              onClick={closePasswordModal}
              disabled={passwordLoading}
            >
              取消
            </Button>
            <Button
              variant="filled"
              type="submit"
              form="password-form"
              loading={passwordLoading}
              disabled={!oldPassword.trim() || !newPassword.trim()}
            >
              确认修改
            </Button>
          </>
        }
      >
        <form id="password-form" onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <label htmlFor="old-password" className="block text-label-l text-on-surface mb-2">
              原密码
            </label>
            <Input
              id="old-password"
              data-autofocus
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="请输入原密码"
              disabled={passwordLoading}
            />
          </div>
          <div>
            <label htmlFor="new-password" className="block text-label-l text-on-surface mb-2">
              新密码
            </label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="请输入新密码"
              disabled={passwordLoading}
            />
          </div>
        </form>
      </Modal>
      <Modal
        isOpen={isApiKeyModalOpen}
        onClose={closeApiKeyModal}
        title="配置 API Key"
        footer={
          <>
            <Button
              variant="text"
              type="button"
              onClick={closeApiKeyModal}
              disabled={apiKeyLoading}
            >
              取消
            </Button>
            <Button variant="filled" type="submit" form="apikey-form" loading={apiKeyLoading}>
              确认保存
            </Button>
          </>
        }
      >
        <form id="apikey-form" onSubmit={handleApiKeySubmit}>
          <label htmlFor="derpi-api-key" className="block text-label-l text-on-surface mb-2">
            Derpibooru API Key
          </label>
          <Input
            id="derpi-api-key"
            data-autofocus
            type="text"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            placeholder="请输入你的 API Key"
            disabled={apiKeyLoading}
          />
          <p className="text-body-s text-on-surface-variant mt-2">
            通过绑定 Derpibooru API Key 可同步黑名单过滤等设置。
            <br /> 获取方法：登录 Derpibooru → Account Settings → API Key 区域。{' '}
          </p>
        </form>
      </Modal>
      <Modal
        isOpen={isClearApiKeyModalOpen}
        onClose={() => setIsClearApiKeyModalOpen(false)}
        title="解除绑定 API Key"
        footer={
          <>
            <Button
              variant="text"
              onClick={() => setIsClearApiKeyModalOpen(false)}
              data-ripple
            >
              取消
            </Button>
            <Button variant="danger" onClick={handleClearApiKeyConfirm} data-ripple>
              确认解除
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant">
          确定要解除 Derpibooru API Key
          的绑定吗？解除后部分功能（如黑名单过滤同步）将无法使用。{' '}
        </p>
      </Modal>
      <Modal
        isOpen={isEmailModalOpen}
        onClose={closeEmailModal}
        title="邮箱设置"
        /* One `footer` with two branches rather than an action row inside each half of the
           body. Both halves used to hand-roll their own, which is the defect the /block-groups
           dialog is the worked example of: the buttons sat inside the body's scroller, so on a
           short viewport with the verification step open 验证邮箱 scrolled out of view while
           every sibling dialog on this screen pinned its own.
           重新发送 keeps the leading edge through `mr-auto` — an auto margin in `Modal`'s
           `justify-end` row absorbs the space to its right — where it used to need a nested
           flex wrapper around the two buttons. */
        footer={
          showVerifyInput ? (
            <>
              <button
                onClick={handleResendCode}
                disabled={isResending}
                className="prose-link text-body-m focus-visible:ring-2 focus-ring disabled:disabled-content mr-auto"
              >
                {isResending ? '发送中…' : '重新发送'}
              </button>
              <Button variant="text" type="button" onClick={closeEmailModal} disabled={emailLoading}>
                取消
              </Button>
              <Button
                variant="filled"
                onClick={handleVerifyEmail}
                disabled={emailLoading || !verifyCode.trim()}
              >
                {emailLoading ? '验证中…' : '验证邮箱'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="text" type="button" onClick={closeEmailModal} disabled={emailLoading}>
                取消
              </Button>
              <Button
                variant="filled"
                onClick={handleEmailSubmit}
                disabled={emailLoading || !newEmail.trim()}
              >
                {emailLoading ? '提交中…' : '更新邮箱'}
              </Button>
            </>
          )
        }
      >
        {!showVerifyInput ? (
          /* No `space-y-*` wrapper: this half is one field now that its action row has moved
             to the footer, and the other half keeps one because it holds two blocks. */
          <div>
            <label htmlFor="new-email" className="block text-label-l text-on-surface mb-2">
              新邮箱地址
            </label>
            <Input
              id="new-email"
              data-autofocus
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="example@email.com"
              disabled={emailLoading}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-primary-container text-on-primary-container text-body-m rounded-md p-3">
              验证码已发送至 {newEmail}，请查收{' '}
            </div>
            <div>
              <label htmlFor="email-code" className="block text-label-l text-on-surface mb-2">
                验证码
              </label>
              <Input
                id="email-code"
                data-autofocus
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="请输入验证码"
                disabled={emailLoading}
              />
            </div>
          </div>
        )}
      </Modal>
      <Modal
        isOpen={isProfileModalOpen}
        onClose={closeProfileModal}
        title="编辑个人资料"
        maxWidth="lg"
        footer={
          <>
            <Button
              variant="text"
              type="button"
              onClick={closeProfileModal}
              disabled={profileLoading}
            >
              取消
            </Button>
            <Button variant="filled" onClick={handleProfileSubmit} disabled={profileLoading}>
              {profileLoading ? '保存中…' : '保存资料'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="profile-bio" className="block text-label-l text-on-surface mb-2">
              个人简介 (Bio)
            </label>
            <Textarea
              id="profile-bio"
              data-autofocus
              value={profileBio}
              onChange={(e) => setProfileBio(e.target.value)}
              rows={3}
              maxLength={500}
              className="resize-none"
              placeholder="介绍一下你自己…"
            />
            <p className="text-body-s text-on-surface-variant mt-1">{profileBio.length}/500</p>
          </div>
          <div>
            <p className="block text-label-l text-on-surface mb-2">性别</p>
            <Select
              value={profileGender}
              onChange={setProfileGender}
              className="w-full"
              aria-label="性别"
              options={[
                { value: '保密', label: '保密' },
                { value: '男', label: '男' },
                { value: '女', label: '女' },
                { value: '武装直升机', label: '其他' },
              ]}
            />
          </div>
          <div>
            <label htmlFor="profile-birthday" className="block text-label-l text-on-surface mb-2">
              生日
            </label>
            <Input
              id="profile-birthday"
              type="date"
              value={profileBirthday}
              onChange={(e) => setProfileBirthday(e.target.value)}
            />
          </div>
          <div>
            <p className="block text-label-l text-on-surface mb-2">种族</p>
            <Select
              value={profileRace}
              onChange={setProfileRace}
              className="w-full"
              placeholder="未设置"
              aria-label="种族"
              options={[
                { value: '', label: '未设置' },
                { value: 'Earth Pony', label: '陆马' },
                { value: 'Unicorn', label: '独角兽' },
                { value: 'Pegasus', label: '飞马' },
                { value: 'Alicorn', label: '天角兽' },
                { value: 'Bat Pony', label: '蝙蝠小马' },
                { value: 'Changeling', label: '幻形灵' },
                { value: 'Other', label: '其他' },
              ]}
            />
          </div>
        </div>
      </Modal>
      </div>
        </TabPane>
        <TabPane value="personalise">
          <AppearanceSection />
        </TabPane>
      </TabPanes>
    </div>
  );
}
