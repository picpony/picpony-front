'use client';

import * as api from '@/lib/api/adminSiteTools';
import { textTranslationFields, textTranslationPayload } from '@/lib/adminSiteTools/model';
import { AdminNote } from '../AdminForm';
import SectionHeader from '../SectionHeader';
import { useAdminQuery } from '../queries';
import type { AdminPanelProps } from '../registry';
import { ConfigEditor, ReadState, protectedPanel } from './common';
import { textTranslationQuery } from './queries';

/**
 * 文本翻译: the Azure Translator settings the site's 翻译 actions use (`GET`/`PUT
 * /admin/text-translation`). The key is write-only — the read gives only whether one is saved and
 * its mask, and the form's key field always starts empty ("留空保留").
 */
function TextTranslationTab({ token }: AdminPanelProps) {
  const read = useAdminQuery(textTranslationQuery, token);
  return <div className="space-y-6">
    <SectionHeader section="text-translation" onRefresh={read.refresh} isLoading={read.refreshing} />
    <ReadState title="文本翻译设置加载失败" loading={read.loading} error={read.error} retry={read.retryable ? read.refresh : undefined}>
      {read.data && <ConfigEditor title="Azure 文本翻译" token={token} initial={read.data.values} fields={textTranslationFields} validate={textTranslationPayload}
        save={(v) => api.saveTextTranslation(token, v)} refresh={() => textTranslationQuery.invalidate(token)}
        confirmation={(v) => `确定要保存文本翻译设置吗？${v.clear_key ? '已保存的密钥将被清除，文本翻译将无法使用。' : '全站的文本翻译将使用新设置。'}`}>
        <AdminNote>{read.data.hasKey ? `已保存密钥：${read.data.masked}。留空即可保留。` : '尚未保存密钥，启用前请先填写。'}</AdminNote>
      </ConfigEditor>}
    </ReadState>
  </div>;
}
export default protectedPanel(TextTranslationTab);
