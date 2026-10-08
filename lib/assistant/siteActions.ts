'use client';
import * as favorites from '@/lib/api/favorites';
import { createFolder, deleteFolders, favouriteImage, mergeFolders, setImageFolders, transferPictures, unfavouriteImage } from '@/lib/favoritesActions';
import { getTasks, claimTask } from '@/lib/api/tasks';
import { sendMessage } from '@/lib/api/messages';
import { addTagSubscription, lookupDerpiTag, removeTagSubscription } from '@/lib/api/tagSubscriptions';
import { getAvailablePonies, saveMyPonies, ponyNames } from '@/lib/api/desktopPonies';
import { myPonies } from '@/lib/desktopPonies/queries';
import { tasks, coinTransactions, recentContacts, conversationPage, sessionUser, tagSubscriptions } from '@/lib/resources';
import { SYNCED_SETTINGS } from '@/lib/settingsSync';
import { getBrowsingSettings } from '@/lib/api/client';
import { assertAssistantAccount, readAssistantSiteInfo, resolveAssistantSearch } from '@/lib/api/assistant';
import { searchHref, readSearchLocation, SEARCH_SORT_FIELDS } from '@/lib/searchState';
import { obj, positiveId, receiptData, str, type AssistantAction, type AssistantReceipt, type JsonObject } from './protocol';
import { ActionRejected, assistantHref, controlHref, PAGE_CONTROLS, requireId, requireIds, requireText, validateSiteSpec } from './actions';
import { transferSummary, type DefaultFolder } from '@/lib/favorites';
import { requestAssistantSlideshow } from './slideshow';

function folderSettings() {
  return {
    defaultFolder: SYNCED_SETTINGS.find(s => s.id === 'defaultFaveFolder')!.read() as DefaultFolder,
    publicIds: SYNCED_SETTINGS.find(s => s.id === 'publicFaveFolderIds')!.read() as number[] | null,
  };
}
function readQuery(endpoint: string, values: JsonObject): Record<string, number> {
  if (endpoint === 'get_faves') return { folder_id: values.folder_id === undefined ? 0 : requireId(values.folder_id) };
  if (endpoint === 'get_private_messages') return { with_user_id: requireId(values.with_user_id), page: positiveId(values.page) || 1 };
  return {};
}
const done = (summary: string, data: unknown = {}): Partial<AssistantReceipt> => ({ ok: true, summary, data: receiptData(data) });
const navigate = (href: string): Partial<AssistantReceipt> => ({ ...done('已准备打开页面，内容加载结果尚未确认'), defer_navigation: href, page_effect: { path: href, outcome: 'navigation_requested' } });

/** Every remote write below is an existing, reviewed application operation, preceded by a server claim. */
async function writeSite(token: string, endpoint: string, values: JsonObject): Promise<Partial<AssistantReceipt>> {
  assertAssistantAccount(token);
  const stillCurrent = () => assertAssistantAccount(token);
  switch (endpoint) {
    case 'claim_task': {
      const taskType = requireText(values.task_type, 60);
      const before = await getTasks(token); stillCurrent();
      if (taskType === 'login' && before.progress.daily?.login.claimed) return done('今日签到奖励已领取，未重复领取', { already_claimed: true });
      const result = await claimTask(token, taskType); stillCurrent();
      tasks.expire({ token }); coinTransactions.expire(); sessionUser.expire({ token });
      return done('已领取任务奖励', result);
    }
    case 'send_message': {
      const receiver = requireId(values.receiver_id);
      await sendMessage(token, receiver, requireText(values.content)); stillCurrent();
      recentContacts.expire({ token }); conversationPage.expire();
      return done('已发送私信', { receiver_id: receiver });
    }
    case 'create_fave_folder': {
      const folder = await createFolder(token, requireText(values.name, 30)); stillCurrent();
      return done('已创建收藏夹', { folder });
    }
    case 'delete_fave_folders': {
      const ids = requireIds(values.folder_ids);
      const list = await favorites.getFaveFolders(token); stillCurrent();
      if (ids.some(id => !list.folders.some(f => f.id === id && !f.isMain))) throw new ActionRejected('主收藏夹或不存在的收藏夹不能删除');
      await deleteFolders(token, ids); stillCurrent();
      return done('已删除收藏夹', { folder_ids: ids });
    }
    case 'merge_fave_folders': {
      const ids = requireIds(values.source_folder_ids), targetId = requireId(values.target_folder_id);
      const list = await favorites.getFaveFolders(token); stillCurrent();
      const target = list.folders.find(f => f.id === targetId);
      if (!target || ids.includes(targetId) || ids.some(id => !list.folders.some(f => f.id === id && !f.isMain))) throw new ActionRejected('合并目标无效，主收藏夹不能被合并移除');
      await mergeFolders(token, ids, { id: target.id, name: target.name }); stillCurrent();
      return done('已合并收藏夹', { folder_id: targetId });
    }
    case 'set_image_fave_folders': {
      const id = requireId(values.image_id), ids = requireIds(values.folder_ids, true);
      await setImageFolders(token, id, ids); stillCurrent();
      return done('已调整图片收藏夹', { image_id: id, folder_ids: ids });
    }
    case 'toggle_fave': {
      const id = requireId(values.image_id);
      if (values.fave === false) { await unfavouriteImage(token, id); stillCurrent(); return done('已取消收藏', { image_id: id }); }
      let folder = positiveId(values.folder_id) || folderSettings().defaultFolder.id;
      if (!folder) {
        const list = await favorites.getFaveFolders(token); stillCurrent();
        folder = list.folders.find(item => item.isMain)?.id ?? 0;
      }
      if (!folder) throw new ActionRejected('请先在收藏夹中确认默认收藏位置');
      await favouriteImage(token, id, folder); stillCurrent(); return done('已收藏图片', { image_id: id, folder_id: folder });
    }
    case 'batch_transfer_faves': {
      const ids = requireIds(values.image_ids), source = requireId(values.source_folder_id), targets = requireIds(values.target_folder_ids);
      const mode = values.mode;
      if (mode !== 'copy' && mode !== 'move' || targets.includes(source)) throw new ActionRejected('转移方式或目标收藏夹无效');
      const result = await transferPictures(token, { imageIds: ids, sourceFolderId: source, targetFolderIds: targets, mode }); stillCurrent();
      const sentence = transferSummary(result, mode, ids.length);
      return { ...done(sentence.text, result), ok: !sentence.partial, ...(sentence.partial ? { error: 'partial_result' } : {}) };
    }
    case 'add_tag_subscription': {
      const tag = await lookupDerpiTag(requireText(values.tag_name, 200)); stillCurrent();
      await addTagSubscription(token, tag.name, tag.count); stillCurrent(); tagSubscriptions.expire({ token });
      return done('已订阅标签', { tag: tag.name, image_count: tag.count });
    }
    case 'remove_tag_subscription': {
      const tag = requireText(values.tag_name, 200);
      await removeTagSubscription(token, tag); stillCurrent(); tagSubscriptions.expire({ token }); return done('已取消订阅标签', { tag });
    }
    case 'save_my_ponies': {
      const names = ponyNames(values.ponies);
      if (!Array.isArray(values.ponies) || names.length !== values.ponies.length) throw new ActionRejected('小马选择无效，最多六个角色');
      const available = await getAvailablePonies(); stillCurrent();
      if (!available.enabled || names.some(n => !available.ponies.some(p => p.name === n))) throw new ActionRejected('桌面小马或所选角色暂未开放');
      await saveMyPonies(token, names); stillCurrent(); myPonies.write({ token }, names); return done('已保存桌面小马', { ponies: names });
    }
    default: return { ok: false, summary: '此操作需要到对应页面手动完成', error: 'unsupported_action', data: {} };
  }
}

export function assistantPageContext(pageInstance: string): JsonObject {
  const location = window.location;
  const current = readSearchLocation(new URLSearchParams(location.search));
  const imageId = /^\/pic\/(\d+)/.exec(location.pathname)?.[1];
  const folderId = /^\/favorites\/folder\/(\d+)/.exec(location.pathname)?.[1];
  return {
    page_instance: pageInstance, path: location.pathname.startsWith('/favorites/privacy') ? '/favorites' : location.pathname, hash: '', title: 'PicPony',
    selected_image_id: positiveId(imageId) || null,
    collection: { type: folderId ? 'cloud_folder' : 'none', folder_id: positiveId(folderId) || null },
    current_search: { query: current.query || '*', sort: current.sort ?? 'created_at', direction: current.direction },
    controls: PAGE_CONTROLS,
  };
}

export async function dispatchAssistantAction(token: string, pageInstance: string, action: AssistantAction, claim: JsonObject): Promise<Partial<AssistantReceipt>> {
  assertAssistantAccount(token);
  const args = action.arguments;
  if (action.name === 'call_site_api') {
    const spec = validateSiteSpec(action, claim.request);
    if (spec.method === 'GET') return done('已读取站内信息', await readAssistantSiteInfo(token, spec.endpoint, readQuery(spec.endpoint, spec.values)));
    return writeSite(token, spec.endpoint, spec.values);
  }
  if (action.name === 'get_page_controls') return done('已读取当前可用的页面入口', { page_instance: pageInstance, controls: PAGE_CONTROLS });
  if (action.name === 'interact_page') {
    const control = obj(claim.control);
    const href = controlHref(control.control_id);
    if (control.page_instance !== pageInstance || control.control_id !== args.control_id || control.action !== 'click' || !href) return { ok: false, summary: '该控件已失效或需要手动操作，未执行', error: 'manual_control', data: {} };
    return navigate(href);
  }
  if (action.name === 'get_capabilities') return done('可查找图片、打开页面、读取账户摘要与私信、管理收藏和订阅、领取奖励、发送私信。账户安全、隐私解锁和未支持的操作需在页面手动处理。', { controls: PAGE_CONTROLS });
  if (action.name === 'navigate') {
    const href = assistantHref(args.path);
    return href ? navigate(href) : { ok: false, summary: '此地址不是支持的站内页面，未打开', error: 'unsupported_destination', data: {} };
  }
  if (action.name === 'open_settings') return navigate('/settings');
  if (action.name === 'start_folder_slideshow') {
    const id = positiveId(args.folder_id) || positiveId(/^\/favorites\/folder\/(\d+)/.exec(window.location.pathname)?.[1]);
    if (!id) throw new Error('请先打开要放映的收藏夹');
    const result = await requestAssistantSlideshow({ token, folderId: id, page: positiveId(new URLSearchParams(window.location.search).get('page')) || 1 });
    assertAssistantAccount(token);
    return done(`已开始放映收藏夹第 ${result.page} 页的 ${result.count} 张图片${result.withheld ? `，跳过 ${result.withheld} 张当前不能展示的图片` : ''}`, { folder_id: id, page: result.page, total_pages: result.totalPages, page_images: result.count, scope: 'current_page', slideshow_active: true });
  }
  if (action.name === 'open_image') return navigate(`/pic/${requireId(args.image_id)}`);
  if (action.name === 'open_folder' || action.name === 'open_main_folder') {
    const list = await favorites.getFaveFolders(token); assertAssistantAccount(token);
    const folder = action.name === 'open_main_folder' ? list.folders.find(f => f.isMain) : list.folders.find(f => f.id === requireId(args.folder_id));
    if (!folder) throw new Error('未找到该收藏夹');
    return navigate(`/favorites/folder/${folder.id}`);
  }
  if (action.name === 'search_images' || action.name === 'set_search_filters') {
    const current = readSearchLocation(new URLSearchParams(window.location.search));
    const hasQuery = Object.hasOwn(args, 'query');
    const query = hasQuery ? requireText(args.query, 300) : current.query || '*';
    const mode = args.query_mode === 'refine' || action.name === 'set_search_filters' ? 'refine' : 'new';
    const resolution = hasQuery ? await resolveAssistantSearch(query, mode, current.query || '*') : { tags: current.tags ?? [query], receipt: {} };
    assertAssistantAccount(token);
    const rating = str(args.rating, 30), contentFilter = getBrowsingSettings().contentFilter;
    if (rating === 'suggestive' && contentFilter === 'safe' || ['questionable', 'explicit'].includes(rating) && contentFilter !== 'developer') throw new Error('当前内容过滤器不允许此分级，请在设置中手动调整');
    if (rating && !['safe', 'suggestive', 'questionable', 'explicit', 'all'].includes(rating)) throw new Error('搜索分级无效');
    const tags = [...resolution.tags]; if (rating && rating !== 'all' && !tags.includes(rating)) tags.push(rating);
    const sort = str(args.sort, 40) || current.sort || 'created_at';
    if (!(SEARCH_SORT_FIELDS as readonly string[]).includes(sort)) throw new Error('此排序方式暂不支持，请在搜索页面选择');
    const href = searchHref(query, sort, args.direction === 'asc' ? 'asc' : args.direction === 'desc' ? 'desc' : current.direction, 1, { tags });
    return { ...navigate(href), data: { ...resolution.receipt, query, final_query: tags.join(', '), sort }, summary: '搜索条件已确认，将打开结果页面；图片数量尚未确认' };
  }
  const reads: Record<string, string> = { get_account_info: 'assistant_account_info', get_favorite_folders: 'get_fave_folders', get_favorite_contents: 'get_faves', get_tasks: 'get_tasks', get_recent_contacts: 'get_recent_contacts', get_private_messages: 'get_private_messages' };
  if (reads[action.name]) return done('已读取站内信息', await readAssistantSiteInfo(token, reads[action.name], readQuery(reads[action.name], args)));
  return { ok: false, summary: '此操作需要到对应页面手动完成', error: 'unsupported_action', data: {} };
}
