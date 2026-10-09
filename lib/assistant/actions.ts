import { obj, positiveId, str, type AssistantAction, type JsonObject } from './protocol';

export const READ_ENDPOINTS = new Set(['assistant_account_info', 'get_fave_folders', 'get_faves', 'get_tasks', 'get_recent_contacts', 'get_private_messages', 'get_tag_subscriptions', 'get_my_ponies']);
export const WRITE_ENDPOINTS = new Set(['claim_task', 'send_message', 'create_fave_folder', 'delete_fave_folders', 'merge_fave_folders', 'set_image_fave_folders', 'toggle_fave', 'batch_transfer_faves', 'add_tag_subscription', 'remove_tag_subscription', 'save_my_ponies']);
export class ActionRejected extends Error {}
const NAVIGATION: Record<string, { label: string; href: string }> = {
  home: { label: '图库', href: '/' }, forum: { label: '论坛', href: '/?tab=forum' }, search: { label: '搜索', href: '/search' },
  settings: { label: '设置', href: '/settings' }, personalise: { label: '个性化', href: '/settings?tab=personalise' },
  account: { label: '账户设置', href: '/settings?tab=account' }, tasks: { label: '任务', href: '/tasks' },
  favorites: { label: '收藏夹', href: '/favorites' }, messages: { label: '消息', href: '/messages' },
  shop: { label: '商店', href: '/shop' }, history: { label: '浏览历史', href: '/history' },
  subscriptions: { label: '标签订阅', href: '/subscriptions' }, about: { label: '关于', href: '/about' },
};
export const PAGE_CONTROLS = Object.entries(NAVIGATION).map(([id, { label }]) => ({ id: `nav.${id}`, label, kind: 'click', risk: 'read' }));
export function controlHref(id: unknown): string | null {
  return typeof id === 'string' && id.startsWith('nav.') ? NAVIGATION[id.slice(4)]?.href ?? null : null;
}

/** Same-origin, named application destinations only; no raw URL/DOM execution contract. */
export function assistantHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000 || /[\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, 'https://picpony.top');
    if (url.origin !== 'https://picpony.top' || url.username || url.password || url.hash) return null;
    if (!/^(\/(?:settings|tasks(?:\/coins)?|messages|favorites(?:\/folder\/[1-9]\d*)?|shop|history|subscriptions|about|policy|search)?|\/(?:pic|user|forum)\/[1-9]\d*)$/.test(url.pathname)) return null;
    const params = new URLSearchParams();
    for (const key of ['tab', 'q', 'sort', 'dir', 'page', 'tags', 'raw']) {
      const v = url.searchParams.get(key);
      if (v && v.length <= 800) params.set(key, v);
    }
    return url.pathname + (params.size ? `?${params}` : '');
  } catch { return null; }
}
export function actionIsWrite(action: AssistantAction): boolean {
  if (action.name === 'call_site_api') return !READ_ENDPOINTS.has(str(action.arguments.endpoint, 80));
  if (action.name === 'interact_page') return controlHref(action.arguments.control_id) === null;
  return !['get_page_controls', 'get_capabilities', 'search_images', 'set_search_filters', 'get_account_info', 'get_favorite_folders', 'get_favorite_contents', 'get_tasks', 'get_recent_contacts', 'get_private_messages', 'navigate', 'open_settings', 'open_main_folder', 'open_folder', 'open_image', 'start_folder_slideshow'].includes(action.name);
}
export function actionSupported(action: AssistantAction): boolean {
  if (action.name === 'call_site_api') return READ_ENDPOINTS.has(str(action.arguments.endpoint, 80)) || WRITE_ENDPOINTS.has(str(action.arguments.endpoint, 80));
  if (action.name === 'interact_page') return controlHref(action.arguments.control_id) !== null && action.arguments.action === 'click';
  return !actionIsWrite(action);
}
/**
 * What the confirmation card says an action does. `folderName` (review P5-O2) turns a folder id
 * into its name where the account's folder list is at hand: 「删除收藏夹：12、15」 asked somebody to
 * confirm an irreversible delete without saying what it deleted.
 */
export function actionLabel(action: AssistantAction, folderName?: (id: number) => string | undefined): string {
  const folders = (value: unknown) => foldersLabel(value, folderName);
  const folder = (value: unknown) => foldersLabel([value], folderName);
  const args = action.arguments;
  const params = obj(args.parameters);
  if (action.name === 'call_site_api') {
    const labels: Record<string, string> = {
      claim_task: `领取任务奖励（${str(params.task_type, 40) === 'login' ? '每日签到' : str(params.task_type, 40)}）`,
      send_message: `向用户 ${positiveId(params.receiver_id)} 发送私信：${str(params.content, 4000)}`,
      create_fave_folder: `创建收藏夹「${str(params.name, 80)}」`, delete_fave_folders: `删除收藏夹及其中记录：${folders(params.folder_ids)}`,
      merge_fave_folders: `将收藏夹 ${folders(params.source_folder_ids)} 合并至 ${folder(params.target_folder_id)}`,
      set_image_fave_folders: `调整图片 ${positiveId(params.image_id)} 的收藏夹：${folders(params.folder_ids)}`,
      toggle_fave: `${params.fave === false ? '取消收藏' : '收藏'}图片 ${positiveId(params.image_id)}`,
      batch_transfer_faves: `${params.mode === 'move' ? '移动' : '复制'}图片 ${idsLabel(params.image_ids)} 至收藏夹 ${folders(params.target_folder_ids)}`,
      add_tag_subscription: `订阅标签「${str(params.tag_name, 120)}」`, remove_tag_subscription: `取消订阅标签「${str(params.tag_name, 120)}」`,
      save_my_ponies: `保存桌面小马：${Array.isArray(params.ponies) ? params.ponies.filter(v => typeof v === 'string').join('、').slice(0, 500) : ''}`,
    };
    return labels[str(args.endpoint, 80)] || (READ_ENDPOINTS.has(str(args.endpoint, 80)) ? '读取站内信息' : '此操作需要在对应页面手动完成');
  }
  if (action.name === 'interact_page') return PAGE_CONTROLS.find(c => c.id === args.control_id)?.label ?? '此控件需要手动操作';
  const labels: Record<string, string> = { search_images: '查找图片', set_search_filters: '调整搜索条件', navigate: '打开站内页面', open_settings: '打开设置', open_folder: '打开收藏夹', open_main_folder: '打开主收藏夹', start_folder_slideshow: '放映收藏夹', open_image: '打开图片', get_capabilities: '查看支持的功能', get_page_controls: '查看页面入口', get_account_info: '读取账户摘要', get_tasks: '读取任务进度', get_favorite_folders: '读取收藏夹', get_favorite_contents: '读取收藏内容', get_recent_contacts: '读取最近联系人', get_private_messages: '读取私信' };
  return labels[action.name] ?? '此操作需要手动完成';
}
function foldersLabel(value: unknown, name?: (id: number) => string | undefined): string {
  if (!Array.isArray(value)) return '';
  return value.map(positiveId).filter(Boolean).map((id) => {
    const known = name?.(id);
    return known ? `「${known.slice(0, 40)}」(${id})` : String(id);
  }).join('、');
}
function idsLabel(value: unknown): string {
  return Array.isArray(value) ? value.map(positiveId).filter(Boolean).join('、') : '';
}
export function requireId(value: unknown): number {
  const id = positiveId(value);
  if (!id) throw new ActionRejected('操作目标无效，未执行');
  return id;
}
export function requireIds(value: unknown, allowEmpty = false): number[] {
  if (!Array.isArray(value) || value.length > 200 || !allowEmpty && !value.length) throw new ActionRejected('操作目标无效，未执行');
  return [...new Set(value.map(requireId))];
}
export function requireText(value: unknown, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ActionRejected('操作内容无效，未执行');
  return value.trim();
}
export function validateSiteSpec(action: AssistantAction, raw: unknown): { endpoint: string; method: 'GET' | 'POST'; values: JsonObject } {
  const request = obj(raw);
  const endpoint = str(request.endpoint, 80);
  const method = request.method;
  if (endpoint !== action.arguments.endpoint || method !== 'GET' && method !== 'POST' || method === 'GET' && !READ_ENDPOINTS.has(endpoint) || method === 'POST' && !WRITE_ENDPOINTS.has(endpoint)) {
    throw new Error('此操作不在已支持的站内操作中，请到对应页面手动完成');
  }
  const values = obj(method === 'GET' ? request.query : request.body);
  if (Object.keys(values).some(key => /token|password|secret|authorization|user_id|url|headers|action/i.test(key) && !['with_user_id'].includes(key))) throw new Error('操作包含不可代填的信息，未执行');
  const reviewed = obj(action.arguments.parameters);
  const targets: Record<string, string[]> = {
    claim_task: ['task_type'], send_message: ['receiver_id', 'content'], create_fave_folder: ['name'],
    delete_fave_folders: ['folder_ids'], merge_fave_folders: ['source_folder_ids', 'target_folder_id'],
    set_image_fave_folders: ['image_id', 'folder_ids'], toggle_fave: ['image_id', 'folder_id', 'fave'],
    batch_transfer_faves: ['image_ids', 'source_folder_id', 'target_folder_ids', 'mode'],
    add_tag_subscription: ['tag_name'], remove_tag_subscription: ['tag_name'], save_my_ponies: ['ponies'],
  };
  for (const key of targets[endpoint] ?? []) {
    if (Object.hasOwn(values, key) !== Object.hasOwn(reviewed, key) || !sameParameter(values[key], reviewed[key])) throw new Error('服务器操作与已核对的内容不一致，未执行');
  }
  return { endpoint, method, values };
}

function sameParameter(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => sameParameter(value, b[i]));
  if (typeof a === 'number' && typeof b === 'string' || typeof b === 'number' && typeof a === 'string') return String(a) === String(b);
  return false;
}
