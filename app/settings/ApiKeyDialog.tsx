'use client';

import { useState } from 'react';
import { MdOpenInNew } from 'react-icons/md';
import Modal from '@/components/Modal';
import Button from '@/components/Button';
import { Input } from '@/components/Input';
import { showToast } from '@/components/Toast';
import { isRefusal, saveApikey, type UpstreamCredential } from '@/lib/api/picpony';
import { apiErrorMessage } from '@/lib/api/errors';
import { readToken } from '@/lib/hooks';
import { useFieldErrors } from '@/lib/useFieldErrors';
import { ICON } from '@/lib/icons';
import { validateApiKey } from '@/lib/validation';
import { saveAccountFields } from './useAccount';

const ACCOUNT_SETTINGS_URL = 'https://derpibooru.org/registrations/edit';
/* One string: JSX would join its lines with a space, which Chinese prose does not take after 。 */
const INTRO =
  '绑定后可同步你在 Derpibooru 的黑名单过滤等设置，不需要提供密码；内容分级仍按本站的内容筛选设置生效。' +
  '获取方法：登录 Derpibooru，打开账户设置（Account Settings），在 API Key 一栏点击显示并复制到下方。' +
  '保存时会先核验该 Key 属于哪个 Derpibooru 账号。';

/**
 * 绑定 API Key (`PUT /me/upstream-credential`). The backend checks the key against Derpibooru
 * itself before storing it, and answers with whose it is: a key Derpibooru refuses is not saved
 * (`INVALID_API_KEY`, said under the field); a working key whose owner has neither uploads nor
 * comments is saved with **no** identity (`no_activity`), and says so, rather than inventing one.
 * The key is also kept on this device, which reads Derpibooru with it — the backend never sends it
 * back.
 *
 * The field is a code, not prose: no capitalisation, correction or spell-check on a phone's
 * keyboard, no autofill, and a monospace face so a stray character can be seen. An empty field
 * saves nothing — unbinding is its own action on the row, behind a confirmation.
 */
export default function ApiKeyDialog({
  open,
  token,
  current,
  bound,
  revision,
  onSaved,
  onConflict,
  onClose,
}: {
  open: boolean;
  token: string;
  /** The key this device holds, or '' (another device may have bound one). */
  current: string;
  /** Whether the account has a key bound at all. */
  bound: boolean;
  /** The credential record's revision, which the write names. */
  revision: number;
  onSaved: (credential: UpstreamCredential) => void;
  /** The record changed meanwhile: the opener reads it again. */
  onConflict: () => void;
  onClose: () => void;
}) {
  const [key, setKey] = useState(current);
  const [busy, setBusy] = useState(false);
  const trimmed = key.trim();
  const form = useFieldErrors<'key'>(() => [
    ['key', !trimmed ? '请输入 API Key' : validateApiKey(trimmed)],
  ]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !form.check()) return;
    setBusy(true);
    try {
      const credential = await saveApikey(token, { api_key: trimmed, expected_revision: revision });
      if (readToken() !== token) return;
      onSaved(credential);
      saveAccountFields(token, { api_key: trimmed });
      const verified = credential.identity.status === 'verified';
      showToast(
        verified
          ? `已绑定，Derpibooru 账号为 ${credential.identity.name}`
          : '已绑定，该账号暂无上传或评论，无法确认 Derpibooru 用户名',
        verified ? 'success' : 'info',
      );
      onClose();
    } catch (error) {
      if (readToken() !== token) return;
      if (isRefusal(error, 'INVALID_API_KEY', 'INVALID_API_KEY_FORMAT')) {
        form.set('key', '该 API Key 无效，或没有访问 Derpibooru 的权限');
      } else {
        if (isRefusal(error, 'CREDENTIAL_CONFLICT')) onConflict();
        showToast(apiErrorMessage(error, '绑定失败'), 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title={bound ? '更换 API Key' : '绑定 API Key'}
      closeOnEscape={!busy}
      footer={
        <>
          <Button variant="text" type="button" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button
            variant="filled"
            type="submit"
            form="apikey-form"
            loading={busy}
            disabled={!trimmed || trimmed === current}
          >
            保存
          </Button>
        </>
      }
    >
      <form id="apikey-form" onSubmit={submit} noValidate className="space-y-4">
        <p className="text-body-m text-on-surface-variant">{INTRO}</p>
        <a
          href={ACCOUNT_SETTINGS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="prose-link text-body-m touch-target inline-flex items-center gap-1 focus-visible:ring-2 focus-ring"
        >
          打开 Derpibooru 账户设置
          <MdOpenInNew size={ICON.dense} aria-hidden="true" />
        </a>
        <Input
          {...form.field('key')}
          label="API Key"
          data-autofocus
          type="text"
          name="derpibooru-api-key"
          value={key}
          onChange={(event) => {
            setKey(event.target.value);
            form.clear('key');
          }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          className="font-mono"
          readOnly={busy}
        />
      </form>
    </Modal>
  );
}
