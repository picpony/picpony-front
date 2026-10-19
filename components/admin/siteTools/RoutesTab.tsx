'use client';

import { applySavedRoutePolicy } from '@/lib/route';
import * as api from '@/lib/api/adminSiteTools';
import { apiRouteFields, imageRouteFields, fieldsPayload, routePayload } from '@/lib/adminSiteTools/model';
import type { SiteStatusResponse } from '@/lib/types/site';
import SectionHeading from '@/components/SectionHeading';
import { AdminNote } from '../AdminForm';
import SectionHeader from '../SectionHeader';
import { useAdminQuery } from '../queries';
import type { AdminPanelProps } from '../registry';
import { ConfigEditor, ReadState, protectedPanel } from './common';
import { routesQuery } from './queries';

const POLICY_LABELS = Object.fromEntries((apiRouteFields[0].options ?? []).map((o) => [o.value, o.label]));
/** How many of the latest automatic switches the panel lists. */
const HISTORY_SHOWN = 5;

/**
 * 全站线路: the one stored line every browser applies (`GET /routing-policy`), which the relay's
 * origin alert also switches to a third-party candidate and back. Both editors read the stored
 * value (`GET /admin/api-route-policy`, `/admin/image-route-policy`), and a save is applied to this
 * browser at once from the answer (its `global_*` keys are the patch `applySavedRoutePolicy` takes).
 */
function RoutesTab({ token }: AdminPanelProps) {
  const routes = useAdminQuery(routesQuery, token);
  const applied = (data: Record<string, unknown>) => {
    /* `applySavedRoutePolicy` takes only the `global_*` keys it knows, each checked for its type. */
    applySavedRoutePolicy(data as Partial<SiteStatusResponse>);
    routesQuery.invalidate(token);
  };
  const data = routes.data;
  return <div className="space-y-6">
    <SectionHeader section="routes" onRefresh={routes.refresh} isLoading={routes.refreshing} />
    <section className="space-y-4" aria-labelledby="admin-route-heading">
      <SectionHeading as="h3" id="admin-route-heading">全站生效线路</SectionHeading>
      <AdminNote>所有访客与用户的浏览器按此线路访问图库与图片；「按用户设置」由各自的偏好决定。中转服务检测到原站异常时会自动切换到第一个可用的第三方候选地址，恢复后切回原线路。</AdminNote>
      <ReadState title="全站线路加载失败" loading={routes.loading} error={routes.error} retry={routes.retryable ? routes.refresh : undefined}>
        {data && <>
          <ConfigEditor title="API 线路" token={token} initial={data.api} fields={apiRouteFields} validate={routePayload} save={(v) => api.saveApiRoute(token, v)} refresh={applied}
            confirmation={(v) => `确定要修改全站 API 线路吗？所有访客与用户都会受此规则影响。${v.third_party_pass_api_key ? '用户的 API Key 将会传给所配置的第三方服务。' : ''}`}>
            {(data.currentUrl || data.previousPolicy) && <AdminNote>
              {data.currentUrl ? `当前使用的第三方地址：${data.currentUrl}。` : ''}
              {data.previousPolicy ? `原站恢复后将切回「${POLICY_LABELS[data.previousPolicy] ?? data.previousPolicy}」。` : ''}
            </AdminNote>}
          </ConfigEditor>
          <ConfigEditor title="图片线路" token={token} initial={data.image} fields={imageRouteFields} validate={(v) => fieldsPayload(imageRouteFields, v)} save={(v) => api.saveImageRoute(token, v)} refresh={applied}
            confirmation={() => '确定要修改全站图片线路吗？所有访客与用户都会受此规则影响。'} />
          {data.history.length > 0 && <section className="space-y-2" aria-labelledby="admin-route-history-heading">
            <SectionHeading as="h3" id="admin-route-history-heading">自动切换记录</SectionHeading>
            <ul className="space-y-1 text-body-s text-on-surface-variant">
              {data.history.slice(-HISTORY_SHOWN).reverse().map((h, i) => <li key={`${h.time}:${i}`} className="wrap-anywhere">{h.time || '时间未记录'}（北京时间） · {h.url || '未记录地址'}{h.reason ? ` · ${h.reason}` : ''}</li>)}
            </ul>
          </section>}
        </>}
      </ReadState>
    </section>
  </div>;
}
export default protectedPanel(RoutesTab);
