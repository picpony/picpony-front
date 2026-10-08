/**
 * The account fields' rules, once, with the sentence a form prints under the field.
 *
 * Sign-up, password reset and /settings' own forms all ask for the same three things, and
 * they had drifted apart: sign-up required 8–20 characters with a letter and a digit or
 * symbol while the reset form accepted any six, so a reset could create a password sign-up
 * would refuse — or be refused by the server with a message the form never prepared anyone
 * for. The rule is the backend's own, as the original front end checked it
 * (`/^(?=.*[A-Za-z])(?=.*[^A-Za-z]).{8,20}$/`), and it governs every new password.
 *
 * Every validator returns `null` for a valid value and otherwise the message, so a form can
 * write it straight into the field's `error`. A **login** password is not validated against
 * the rule: an account older than the rule must still be able to sign in.
 *
 * Nothing here truncates. A field with `maxLength` silently cut a 24-character password from a
 * manager to 20 — the manager stored 24, the account got 20, and every later sign-in failed —
 * so the limits are checked and reported instead of enforced by the input.
 *
 * No `'use client'` and no imports: forms, tests and server code can all reach it.
 */

export const USERNAME_MAX = 20;
export const EMAIL_MAX = 50;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 20;
/** Every one-time code this app sends is six digits. */
export const CODE_LENGTH = 6;

const USERNAME_CHARACTERS = /^[a-zA-Z0-9_\-一-龥]+$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Supporting text under a field, stating the rule before anyone breaks it. */
export const USERNAME_HINT = `字母、数字、_、- 或中文，最多 ${USERNAME_MAX} 个字符`;
export const PASSWORD_HINT = `${PASSWORD_MIN} 到 ${PASSWORD_MAX} 位，包含字母和数字或符号`;

export function validateUsername(value: string): string | null {
  const name = value.trim();
  if (!name) return '请输入用户名';
  if (name.length > USERNAME_MAX) return `用户名最多 ${USERNAME_MAX} 个字符`;
  if (!USERNAME_CHARACTERS.test(name)) return '用户名只能包含字母、数字、_、- 和中文';
  return null;
}

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return '请输入邮箱';
  if (email.length > EMAIL_MAX) return `邮箱最多 ${EMAIL_MAX} 个字符`;
  if (!EMAIL_SHAPE.test(email)) return '请输入有效的邮箱地址';
  return null;
}

/**
 * The account a password reset is for: a username or the account's email address, told apart
 * by the `@` — an address is checked as one, anything else against the username rule.
 */
export function validateAccount(value: string): string | null {
  const account = value.trim();
  if (!account) return '请输入用户名或邮箱';
  return account.includes('@') ? validateEmail(account) : validateUsername(account);
}

/** A password being chosen: sign-up, reset, change. Not trimmed — a space is a character. */
export function validateNewPassword(value: string): string | null {
  if (!value) return '请输入密码';
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    return `密码需为 ${PASSWORD_MIN} 到 ${PASSWORD_MAX} 位`;
  }
  if (!/[A-Za-z]/.test(value) || !/[^A-Za-z]/.test(value)) return '密码需包含字母和数字或符号';
  return null;
}

/**
 * The privacy space's password — the backend's rule, as the original front end checked it
 * (`/^[a-zA-Z0-9]{6,20}$/`): 6 to 20 letters or digits. It is not the account's password and
 * follows none of that rule.
 */
export const PRIVACY_PASSWORD_MIN = 6;
export const PRIVACY_PASSWORD_MAX = 20;
export const PRIVACY_PASSWORD_HINT = `${PRIVACY_PASSWORD_MIN} 到 ${PRIVACY_PASSWORD_MAX} 位字母或数字`;

/** A privacy password being chosen: created, or changed. Not trimmed — a space is a character, and refused. */
export function validatePrivacyPassword(value: string): string | null {
  if (!value) return '请输入隐私密码';
  if (value.length < PRIVACY_PASSWORD_MIN || value.length > PRIVACY_PASSWORD_MAX) {
    return `隐私密码需为 ${PRIVACY_PASSWORD_MIN} 到 ${PRIVACY_PASSWORD_MAX} 位`;
  }
  if (!/^[a-zA-Z0-9]+$/.test(value)) return '隐私密码只能包含字母和数字';
  return null;
}

/** The second copy of a new password. */
export function validatePasswordConfirmation(password: string, confirmation: string): string | null {
  if (!confirmation) return '请再次输入密码';
  if (confirmation !== password) return '两次输入的密码不一致';
  return null;
}

/** Only presence: see the module note on login passwords. */
/**
 * A Derpibooru API key: 20 characters of `[A-Za-z0-9_-]`, exactly what Philomena mints and what
 * the upload hop (`app/upload/submit/route.ts`'s `KEY_OK`) accepts. One rule for the user's own
 * 账户 dialog (review P5-F2) and the administrator's user editor (review P6-F4), so a key either
 * can save is one publishing takes.
 */
export const API_KEY_PATTERN = /^[A-Za-z0-9_-]{20}$/;
export const API_KEY_MESSAGE = 'API Key 应为 20 位字母、数字、- 或 _，请检查是否多复制或漏复制了字符';

export function validateApiKey(value: string): string | null {
  return API_KEY_PATTERN.test(value.trim()) ? null : API_KEY_MESSAGE;
}

export function validateRequired(value: string, message: string): string | null {
  return value.trim() ? null : message;
}

export function validateCode(value: string): string | null {
  const code = value.trim();
  if (!code) return '请输入验证码';
  if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)) return `请输入完整的 ${CODE_LENGTH} 位验证码`;
  return null;
}

/**
 * The fields of one form that failed, in the order they were given — the first is the one to
 * focus. `rules` maps a field name to its result; `null` results are dropped.
 */
export function collectErrors<Field extends string>(
  rules: ReadonlyArray<readonly [Field, string | null]>,
): { errors: Partial<Record<Field, string>>; first: Field | null } {
  const errors: Partial<Record<Field, string>> = {};
  let first: Field | null = null;
  for (const [field, message] of rules) {
    if (!message) continue;
    errors[field] = message;
    first ??= field;
  }
  return { errors, first };
}
