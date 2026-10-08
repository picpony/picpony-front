/**
 * The team form's rules as plain functions — what a save sends, and how a member's card links —
 * held to the original console's contract (`oldfe/admin.html`, `saveTeamMember`):
 *
 *   add_team_member / update_team_member { [id], name, role, category, user_id, avatar_url, link_url, order_num }
 *
 * **A member is linked by binding an account** (R9-022). /about makes a card a link only for
 * `link_url = user:<id>`, so the form no longer invites a GitHub address that would be saved and
 * then silently not be a link. Binding 关联站内用户 ID sets `user_id` (so /about shows the account's
 * current avatar) and `link_url = user:<id>`, as the original console's 快捷导入 did. A stored
 * external link is kept as it is while no account is bound — it was somebody's data — and is
 * replaced only by binding one.
 */

import { roleInfo, type Role } from '@/lib/roles';
import { figureField } from './figures';

export type TeamCategory = 'developer' | 'manager' | 'editor' | 'special';

export const TEAM_CATEGORIES: { value: TeamCategory; label: string }[] = [
  { value: 'developer', label: '开发团队' },
  { value: 'manager', label: '管理团队' },
  { value: 'editor', label: '小编团队' },
  { value: 'special', label: '特别鸣谢' },
];

export interface TeamMemberRow {
  id: number;
  name: string;
  role?: string | null;
  category?: string | null;
  user_id?: number | string | null;
  account_avatar?: string | null;
  avatar_url?: string | null;
  link_url?: string | null;
  order_num?: number | string | null;
  /** The editors' automatic ranking by glossary contributions (the backend keeps the top 16). */
  auto_editor_rank?: number | string | null;
  auto_editor_count?: number | string | null;
}

export interface TeamFormValues {
  name: string;
  title: string;
  category: TeamCategory;
  userId: string;
  avatarUrl: string;
  order: string;
}

export type TeamFormErrors = Partial<Record<'name' | 'userId' | 'order', string>>;

function category(value: unknown): TeamCategory {
  return TEAM_CATEGORIES.some((option) => option.value === value) ? (value as TeamCategory) : 'special';
}

/** A positive account id, or 0 for none. */
export function boundUser(value: unknown): number {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export function teamForm(member?: TeamMemberRow | null): TeamFormValues {
  if (!member) return { name: '', title: '', category: 'developer', userId: '', avatarUrl: '', order: '0' };
  const uid = boundUser(member.user_id);
  return {
    name: member.name ?? '',
    title: member.role ?? '',
    category: category(member.category),
    userId: uid ? String(uid) : '',
    avatarUrl: member.avatar_url ?? '',
    /* A sort order the row did not carry opens empty — which a save sends as 0, the form's own
       reading of a blank — rather than as a 0 that was never stored (G4-015). */
    order: figureField(member.order_num),
  };
}

/** A stored link that is not an account link — somebody's homepage the form does not edit. */
export function externalLink(link: string | null | undefined): string | null {
  const value = (link ?? '').trim();
  return value && !value.startsWith('user:') ? value : null;
}

/** The card's link for a member bound to `userId` (0 for none), given what was stored. */
export function linkFor(userId: number, stored: string | null | undefined): string {
  if (userId) return `user:${userId}`;
  return externalLink(stored) ?? '';
}

/** The save's body, or the fields' errors. */
export function teamPayload(
  values: TeamFormValues,
  member?: TeamMemberRow | null,
): { payload: Record<string, unknown>; errors?: undefined } | { payload?: undefined; errors: TeamFormErrors } {
  const errors: TeamFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = '请填写成员姓名';
  const uidText = values.userId.trim();
  const userId = boundUser(uidText);
  if (uidText && (!/^\d+$/.test(uidText) || !userId)) errors.userId = '站内用户 ID 须为正整数';
  const orderText = values.order.trim();
  if (orderText && !/^-?\d+$/.test(orderText)) errors.order = '排序号须为整数';
  if (Object.keys(errors).length > 0) return { errors };
  const payload: Record<string, unknown> = {
    name,
    role: values.title.trim(),
    category: values.category,
    user_id: userId,
    avatar_url: values.avatarUrl.trim(),
    link_url: linkFor(userId, member?.link_url),
    order_num: orderText ? Number(orderText) : 0,
  };
  if (member) payload.id = member.id;
  return { payload };
}

/** A title and a column suggested by an account's role — the original console's 快捷导入. */
export function suggestion(role: unknown): { title: string; category: TeamCategory } {
  const value = typeof role === 'string' ? role : '';
  if (value === 'super_admin' || value === 'admin' || value === 'editor') {
    const category: TeamCategory = value === 'super_admin' ? 'developer' : value === 'admin' ? 'manager' : 'editor';
    return { title: roleInfo(value as Role).label, category };
  }
  return { title: '社区成员', category: 'special' };
}
