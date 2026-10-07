'use client';

import { applySavedRoutePolicy } from '@/lib/route';
import * as api from '@/lib/api/adminSiteTools';
import { apiRouteFields, imageRouteFields, fieldsPayload, routePayload, savedRoutePatch, type Row, type Values } from '@/lib/adminSiteTools/model';
import { AdminNote } from '../AdminForm';
import SectionHeader from '../SectionHeader';
import { useAdminSelect } from '../queries';
import type { AdminPanelProps } from '../registry';
import { ConfigEditor, ReadState, protectedPanel } from './common';
import { selectToolsStatus, statusQuery } from './queries';

function RoutesTab({ token }: AdminPanelProps) {
  const read = useAdminSelect(statusQuery, token, selectToolsStatus);
  const committed = (axis: 'api' | 'image', data: Row, values: Values) => {
    applySavedRoutePolicy(savedRoutePatch(axis, values, data));
    statusQuery.invalidate(token);
  };
  return <div className="space-y-6">
    <SectionHeader section="routes" onRefresh={read.refresh} isLoading={read.refreshing} />
    <AdminNote>选择固定线路后，全站访客与用户将使用此线路。选择「按用户设置」恢复个人选择。</AdminNote>
    <ReadState title="全站线路加载失败" loading={read.loading} error={read.error} retry={read.retryable ? read.refresh : undefined}>
      {read.data && <>
        <ConfigEditor title="API 线路" token={token} initial={read.data.api} fields={apiRouteFields} validate={routePayload} save={(v) => api.saveApiRoute(token, v)} refresh={(data, values) => committed('api', data, values)} confirmation={(v) => `确定要修改全站 API 线路吗？${v.third_party_pass_api_key ? '用户的 API Key 将会传给所配置的第三方服务。' : '所有访客与用户都会受此规则影响。'}`} />
        <ConfigEditor title="图片线路" token={token} initial={read.data.image} fields={imageRouteFields} validate={(v) => fieldsPayload(imageRouteFields, v)} save={(v) => api.saveImageRoute(token, v)} refresh={(data, values) => committed('image', data, values)} confirmation={() => '确定要修改全站图片线路吗？所有访客与用户都会受此规则影响。'} />
      </>}
    </ReadState>
  </div>;
}
export default protectedPanel(RoutesTab);
