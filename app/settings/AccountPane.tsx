'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  MdEdit,
  MdImage,
  MdLink,
  MdLinkOff,
  MdLock,
  MdMarkEmailRead,
  MdPerson,
  MdPhotoCamera,
  MdShield,
  MdVerifiedUser,
} from 'react-icons/md';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import ErrorRetry from '@/components/ErrorRetry';
import FadeInImage from '@/components/FadeInImage';
import ImageCropper from '@/components/ImageCropper';
import SignInRequired from '@/components/SignInRequired';
import Skeleton from '@/components/Skeleton';
import Spinner from '@/components/Spinner';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { saveApikey, uploadAvatar, uploadBanner } from '@/lib/api/picpony';
import { readEnvelope } from '@/lib/api/http';
import { apiErrorMessage } from '@/lib/api/errors';
import { readToken } from '@/lib/hooks';
import { ICON } from '@/lib/icons';
import { changeSyncedSetting, useSyncedSetting } from '@/lib/settingsSync';
import { getAssetUrl, validateImageFile } from '@/lib/utils';
import ApiKeyDialog from './ApiKeyDialog';
import EmailDialog, { type EmailStep } from './EmailDialog';
import PasswordDialog from './PasswordDialog';
import ProfileDialog, { profileOf } from './ProfileDialog';
import UsernameDialog from './UsernameDialog';
import { detectDerpiIdentity, isRealIdentity } from './identity';
import { RowButton, SettingsRow, SettingsSection, SwitchRow } from './SettingsRow';
import { emailVerified, saveAccountFields, text, useAccount, type Account } from './useAccount';
import AssistantSettings from '@/components/assistant/AssistantSettings';

type DialogKind = 'username' | 'password' | 'email' | 'profile' | 'apikey';

/** `abcd••••••••wxyz` — the key's ends, enough to recognise it, never the whole. */
function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}${'•'.repeat(8)}${key.slice(-4)}` : '•'.repeat(key.length);
}

/**
 * 账户 — everything that belongs to the signed-in account. Signed out it is one sign-in prompt
 * (decision 4: never an auto-opened dialog, never rows of controls with no account behind them).
 */
export default function AccountPane() {
  const account = useAccount();
  if (!account) {
    return <SignInRequired size="pane" description="登录后可管理个人主页、账户安全与隐私" />;
  }
  return <AccountSections account={account} />;
}

function AccountSections({ account }: { account: Account }) {
  const { token, record, status } = account;
  const { confirm, confirmDialog } = useConfirm();

  const username = text(record.username);
  const avatar = text(record.avatar);
  const banner = text(record.banner);
  const email = text(record.email);
  const verified = emailVerified(record);
  const apiKey = text(record.api_key);
  const derpiName = text(record.derpi_username);
  const identified = isRealIdentity(record.derpi_user_id, record.derpi_username);
  const profile = profileOf(record);
  /* A field the stored session does not hold is unknown until the read answers — shown as a
     placeholder while it loads and as unreadable if it failed, never as "not set". */
  const has = (field: string) => field in record;
  const unknown = (field: string) => !has(field) && status !== 'ready';
  /* A placeholder on screen marks the pane as loading: the tab switch then slides it as one
     plane rather than leaning rows whose values are about to land, and the footer waits. */
  const reading = status === 'loading' && ['username', 'bio', 'email', 'api_key'].some((field) => !has(field));

  /* Each dialog mounts on its first opening and remounts on every later one — the remount is its
     reset — and stays mounted through its exit animation. */
  const [open, setOpen] = useState<DialogKind | null>(null);
  const [opens, setOpens] = useState<Record<DialogKind, number>>({
    username: 0, password: 0, email: 0, profile: 0, apikey: 0,
  });
  const [emailStep, setEmailStep] = useState<EmailStep>('change');
  const emailAction = useRef<HTMLButtonElement>(null);
  const keyAction = useRef<HTMLButtonElement>(null);
  const unbindAction = useRef<HTMLButtonElement>(null);
  /* A success that removes the control it began from — 验证 once the address is verified, 绑定
     once a key is bound, 解除绑定 once it is not — has no opener to return focus to, so focus goes
     to the row's remaining action instead of falling to the page. A dialog's handoff is settled
     when it closes (its opener still there: the overlay's own return stands); 解除绑定's when the
     request ends, and only if nothing else has taken the focus meanwhile. */
  const handoff = useRef<{ from: Element | null; to: RefObject<HTMLButtonElement | null>; dialog: boolean } | null>(null);
  useEffect(() => {
    const pending = handoff.current;
    if (!pending || (pending.dialog && open !== null)) return;
    if (pending.from?.isConnected) {
      if (pending.dialog) handoff.current = null;
      return;
    }
    handoff.current = null;
    if (pending.dialog || document.activeElement === document.body) pending.to.current?.focus({ preventScroll: true });
  });
  const show = (kind: DialogKind) => {
    const to = kind === 'email' ? emailAction : kind === 'apikey' ? keyAction : null;
    handoff.current = to ? { from: document.activeElement, to, dialog: true } : null;
    setOpens((previous) => ({ ...previous, [kind]: previous[kind] + 1 }));
    setOpen(kind);
  };
  const closeDialog = () => setOpen(null);

  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const [avatarPick, setAvatarPick] = useState<File | null>(null);
  const [bannerPick, setBannerPick] = useState<File | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [keyBusy, setKeyBusy] = useState<'verify' | 'unbind' | null>(null);

  const pick = (kind: 'avatar' | 'banner') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    /* Cleared now, not on close: picking the same file twice in a row fires no change event. */
    event.target.value = '';
    if (!file) return;
    try {
      validateImageFile(file, kind === 'avatar' ? 5 : 10);
    } catch (error) {
      showToast(apiErrorMessage(error, '请选择有效的图片文件'), 'error');
      return;
    }
    if (kind === 'avatar') setAvatarPick(file);
    else setBannerPick(file);
  };

  const upload = (kind: 'avatar' | 'banner') => async (blob: Blob) => {
    if (uploading) return;
    setUploading(kind);
    const file = new File([blob], `${kind}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
    try {
      const data = await readEnvelope<{ avatar_url?: unknown; banner_url?: unknown }>(
        await (kind === 'avatar' ? uploadAvatar(token, file) : uploadBanner(token, file)),
      );
      if (readToken() !== token) return;
      const url = text(kind === 'avatar' ? data.avatar_url : data.banner_url);
      if (url) saveAccountFields(token, { [kind]: url });
      if (kind === 'avatar') setAvatarPick(null);
      else setBannerPick(null);
      showToast(kind === 'avatar' ? '已更换头像' : '已更换横幅', 'success');
    } catch (error) {
      if (readToken() === token) {
        showToast(apiErrorMessage(error, kind === 'avatar' ? '头像上传失败' : '横幅上传失败'), 'error');
      }
    } finally {
      setUploading(null);
    }
  };

  /** 核验: ask the key whose it is again, and save what it says — including "nobody". */
  const verifyIdentity = async () => {
    if (keyBusy || !apiKey) return;
    setKeyBusy('verify');
    try {
      const identity = await detectDerpiIdentity(apiKey);
      if (readToken() !== token) return;
      if (identity.status === 'invalid') {
        showToast('该 API Key 已失效或没有访问权限，请重新绑定', 'error');
        return;
      }
      const derpi = identity.status === 'verified'
        ? { derpi_user_id: identity.id, derpi_username: identity.name }
        : { derpi_user_id: '', derpi_username: '' };
      await readEnvelope(await saveApikey(token, { api_key: apiKey, ...derpi }));
      if (readToken() !== token) return;
      saveAccountFields(token, derpi);
      if (identity.status === 'verified') showToast(`已核验，Derpibooru 账号为 ${identity.name}`, 'success');
      else showToast('该账号暂无上传或评论，无法确认 Derpibooru 用户名', 'info');
    } catch (error) {
      if (readToken() === token) showToast(apiErrorMessage(error, '核验失败'), 'error');
    } finally {
      setKeyBusy(null);
    }
  };

  const unbind = async () => {
    if (keyBusy) return;
    const confirmed = await confirm({
      title: '确认解除绑定',
      message: '确定要解除该 Derpibooru API Key 的绑定吗？解除后将不再同步 Derpibooru 的黑名单过滤等设置。',
      tone: 'danger',
    });
    if (!confirmed || readToken() !== token) return;
    setKeyBusy('unbind');
    handoff.current = { from: unbindAction.current, to: keyAction, dialog: false };
    try {
      await readEnvelope(await saveApikey(token, { api_key: '', derpi_user_id: '', derpi_username: '' }));
      if (readToken() !== token) return;
      saveAccountFields(token, { api_key: '', derpi_user_id: '', derpi_username: '' });
      showToast('已解除绑定', 'success');
    } catch (error) {
      handoff.current = null;
      if (readToken() === token) showToast(apiErrorMessage(error, '解除绑定失败'), 'error');
    } finally {
      setKeyBusy(null);
    }
  };

  const showUploads = useSyncedSetting('showUploads');
  const showFaves = useSyncedSetting('showFaves');
  const showPosts = useSyncedSetting('showPosts');
  const showComments = useSyncedSetting('showComments');
  const hideIpLocation = useSyncedSetting('hideIpLocation');

  const placeholder = <Skeleton aria-hidden="true" className="mt-1 h-3.5 w-32 rounded-xs" />;
  const unreadable = '无法读取';

  return (
    <div data-page-loading={reading ? '' : undefined}>
      {status === 'error' && (
        <div className="mb-6">
          <ErrorRetry
            size="inline"
            title="账户信息加载失败"
            message={apiErrorMessage(account.error, '下方显示的是上次保存在本设备上的信息')}
            onRetry={account.retry}
          />
        </div>
      )}

      <SettingsSection title="个人主页" icon={<MdPerson size={ICON.control} />} subtitle="他人访问你的主页时看到的内容">
        <SettingsRow
          label="头像"
          supporting="JPG、PNG 或 GIF，不超过 5 MB"
          leading={
            <div className="relative shrink-0">
              <Avatar size={56} src={avatar} name={username} />
              {uploading === 'avatar' && (
                <div className="bg-media-plate text-on-media absolute inset-0 flex items-center justify-center rounded-full">
                  <Spinner tone="inherit" />
                </div>
              )}
            </div>
          }
          action={
            <RowButton
              label="更换头像"
              icon={<MdPhotoCamera />}
              onClick={() => avatarInput.current?.click()}
              loading={uploading === 'avatar'}
              collapse={false}
            >
              更换
            </RowButton>
          }
        />
        <SettingsRow
          label="主页横幅"
          supporting="宽高比 4:1，不超过 10 MB"
          leading={
            <div className="bg-surface-container-high text-on-surface-variant relative grid h-14 w-24 shrink-0 place-items-center overflow-hidden rounded-md">
              <MdImage size={ICON.control} aria-hidden="true" />
              {banner && (
                <FadeInImage
                  key={banner}
                  src={getAssetUrl(banner)}
                  alt="主页横幅"
                  fill
                  sizes="96px"
                  className="object-cover"
                />
              )}
              {uploading === 'banner' && (
                <div className="bg-media-plate text-on-media absolute inset-0 flex items-center justify-center">
                  <Spinner tone="inherit" />
                </div>
              )}
            </div>
          }
          action={
            <RowButton
              label="更换横幅"
              icon={<MdImage />}
              onClick={() => bannerInput.current?.click()}
              loading={uploading === 'banner'}
              collapse={false}
            >
              更换
            </RowButton>
          }
        />
        <SettingsRow
          label="用户名"
          supporting={unknown('username') ? placeholder : username || unreadable}
          action={
            <RowButton label="修改用户名" icon={<MdEdit />} onClick={() => show('username')} disabled={!username} collapse={false}>
              修改
            </RowButton>
          }
        />
        <SettingsRow
          label="个人资料"
          supporting={
            unknown('bio') ? placeholder : (
              <span className="line-clamp-1">{profile.bio || '简介、性别、生日与种族'}</span>
            )
          }
          action={
            <RowButton label="编辑个人资料" icon={<MdEdit />} onClick={() => show('profile')} collapse={false}>
              编辑
            </RowButton>
          }
        />
      </SettingsSection>

      <SettingsSection title="账户安全" icon={<MdLock size={ICON.control} />}>
        <SettingsRow
          label="密码"
          supporting="修改后需要重新登录"
          action={
            <RowButton label="修改密码" icon={<MdEdit />} onClick={() => show('password')} collapse={false}>
              修改
            </RowButton>
          }
        />
        <SettingsRow
          label="邮箱"
          badge={
            email ? (
              <Badge tone={verified ? 'success' : 'warning'} size="sm">
                {verified ? '已验证' : '未验证'}
              </Badge>
            ) : undefined
          }
          supporting={unknown('email') ? placeholder : email || (has('email') ? '未绑定' : unreadable)}
          action={
            <>
              {email && !verified && (
                <RowButton
                  label="验证邮箱"
                  icon={<MdMarkEmailRead />}
                  onClick={() => {
                    setEmailStep('verify');
                    show('email');
                  }}
                >
                  验证
                </RowButton>
              )}
              <RowButton
                ref={emailAction}
                label={email ? '更换邮箱' : '绑定邮箱'}
                icon={<MdEdit />}
                onClick={() => {
                  setEmailStep('change');
                  show('email');
                }}
                disabled={!email && !has('email')}
                collapse={Boolean(email && !verified)}
              >
                {email ? '更换' : '绑定'}
              </RowButton>
            </>
          }
        />
      </SettingsSection>

      <SettingsSection title="Derpibooru 账号" icon={<MdLink size={ICON.control} />}>
        <SettingsRow
          label="API Key"
          badge={
            apiKey ? (
              <Badge tone={identified ? 'success' : 'warning'} size="sm">
                {identified ? '已核验' : '未核验'}
              </Badge>
            ) : undefined
          }
          supporting={
            unknown('api_key')
              ? placeholder
              : apiKey
                ? identified
                  ? `Derpibooru 账号：${derpiName}`
                  : `${maskKey(apiKey)}，尚未确认所属账号`
                : '绑定后可同步 Derpibooru 的黑名单过滤等设置'
          }
          action={
            /* Keyed: without keys the unbound row's 绑定 would be reused as the bound row's 核验,
               and a focus handed back to "the button that opened the dialog" would land on a
               different action. */
            apiKey ? (
              <>
                <RowButton
                  key="verify"
                  label="核验身份"
                  icon={<MdVerifiedUser />}
                  onClick={verifyIdentity}
                  loading={keyBusy === 'verify'}
                  disabled={keyBusy === 'unbind'}
                >
                  核验
                </RowButton>
                <RowButton
                  key="unbind"
                  ref={unbindAction}
                  label="解除绑定"
                  variant="danger-text"
                  icon={<MdLinkOff />}
                  onClick={unbind}
                  loading={keyBusy === 'unbind'}
                  disabled={keyBusy === 'verify'}
                >
                  解除绑定
                </RowButton>
                <RowButton
                  key="change"
                  ref={keyAction}
                  label="更换 API Key"
                  icon={<MdEdit />}
                  onClick={() => show('apikey')}
                  disabled={keyBusy !== null}
                >
                  更换
                </RowButton>
              </>
            ) : (
              <RowButton
                key="bind"
                ref={keyAction}
                label="绑定 API Key"
                icon={<MdLink />}
                onClick={() => show('apikey')}
                disabled={!has('api_key') && status !== 'ready'}
                collapse={false}
              >
                绑定
              </RowButton>
            )
          }
        />
      </SettingsSection>

      <SettingsSection
        title="隐私"
        icon={<MdShield size={ICON.control} />}
        subtitle="他人访问你的个人主页时能看到哪些内容"
      >
        <SwitchRow label="公开我的上传" checked={showUploads} onChange={(v) => changeSyncedSetting('showUploads', v)} />
        <SwitchRow
          label="公开我的收藏"
          description="关闭后个人主页不显示任何收藏夹；开启时只显示设为公开的收藏夹"
          checked={showFaves}
          onChange={(v) => changeSyncedSetting('showFaves', v)}
        />
        <SwitchRow label="公开我的帖子" checked={showPosts} onChange={(v) => changeSyncedSetting('showPosts', v)} />
        <SwitchRow label="公开我的评论" checked={showComments} onChange={(v) => changeSyncedSetting('showComments', v)} />
        <SwitchRow
          label="隐藏 IP 属地"
          description="他人查看你的主页时，IP 属地显示为已隐藏"
          checked={hideIpLocation}
          onChange={(v) => changeSyncedSetting('hideIpLocation', v)}
        />
      </SettingsSection>

      <AssistantSettings />

      <input type="file" ref={avatarInput} onChange={pick('avatar')} accept="image/*" hidden />
      <input type="file" ref={bannerInput} onChange={pick('banner')} accept="image/*" hidden />
      <ImageCropper
        file={avatarPick}
        onClose={() => setAvatarPick(null)}
        onCropped={upload('avatar')}
        aspect={1}
        shape="circle"
        outputWidth={512}
        title="调整头像"
        busy={uploading === 'avatar'}
      />
      <ImageCropper
        file={bannerPick}
        onClose={() => setBannerPick(null)}
        onCropped={upload('banner')}
        aspect={4}
        outputWidth={1600}
        outputHeight={400}
        title="调整主页横幅"
        busy={uploading === 'banner'}
      />

      {opens.username > 0 && (
        <UsernameDialog key={opens.username} open={open === 'username'} token={token} current={username} onClose={closeDialog} />
      )}
      {opens.password > 0 && (
        <PasswordDialog key={opens.password} open={open === 'password'} token={token} username={username} onClose={closeDialog} />
      )}
      {opens.email > 0 && (
        <EmailDialog
          key={opens.email}
          open={open === 'email'}
          token={token}
          email={email}
          initialStep={emailStep}
          onClose={closeDialog}
        />
      )}
      {opens.profile > 0 && (
        <ProfileDialog key={opens.profile} open={open === 'profile'} token={token} saved={profile} onClose={closeDialog} />
      )}
      {opens.apikey > 0 && (
        <ApiKeyDialog key={opens.apikey} open={open === 'apikey'} token={token} current={apiKey} onClose={closeDialog} />
      )}
      {confirmDialog}
    </div>
  );
}
