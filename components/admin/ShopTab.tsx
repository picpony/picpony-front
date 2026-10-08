'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MdCardGiftcard, MdDeleteOutline, MdEdit, MdToll } from 'react-icons/md';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Checkbox from '@/components/Checkbox';
import DataTable, { type Column } from '@/components/DataTable';
import FadeInImage from '@/components/FadeInImage';
import IconButton from '@/components/IconButton';
import InlineEditorPanel, { captureInlineEditorLayout } from '@/components/InlineEditorPanel';
import { Input, Textarea } from '@/components/Input';
import SectionHeading from '@/components/SectionHeading';
import { showToast } from '@/components/Toast';
import { useConfirm } from '@/components/ConfirmDialog';
import { ICON } from '@/lib/icons';
import { getAssetUrl } from '@/lib/utils';
import { shopItems } from '@/lib/resources';
import * as adminApi from '@/lib/api/admin';
import SectionHeader from './SectionHeader';
import { AdminForm, FormActions, FormGrid } from './AdminForm';
import { AdminListAnchor, AdminPager, usePagedRows } from './paging';
import { defineAdminQuery, useAdminQuery, adminList, tableError } from './queries';
import { useAdminMutation } from './useAdminMutation';
import type { AdminPanelProps } from './registry';
import { isActive, shopForm, shopPayload, type ShopFormErrors, type ShopFormValues, type ShopItemRow } from './shop';
import { figureText } from './figures';
import Tabs from '@/components/Tabs';
import TabPanes, { TabPane } from '@/components/TabPanes';
import PurchasesPane from './catalogTools/PurchasesPane';
import CatalogImageInput from './catalogTools/CatalogImageInput';

const EMPTY: ShopItemRow[] = [];
const itemsQuery = defineAdminQuery<ShopItemRow[]>('shop', async (token, signal) => {
  const data = await adminApi.adminGetShopItems(token, signal);
  return adminList<ShopItemRow>(data, 'items', '商品');
});

function shopEditorId(itemId: number) {
  return `shop-inline-${itemId}-editor`;
}

/**
 * The item's picture at 56dp, requested at 56 (R9-023: it was asked for at 40 and drawn at 56).
 * A PicPony upload goes through the optimizer; another host is shown as it is, since
 * `images.remotePatterns` names picpony.top alone.
 */
function ItemThumb({ url }: { url?: string | null }) {
  const src = url ? getAssetUrl(url) : '';
  let unoptimized = true;
  try {
    unoptimized = new URL(src).hostname !== 'picpony.top';
  } catch {
    /* Not a URL at all: the glyph below. */
  }
  return (
    <span className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-container-highest text-on-surface-variant">
      {src ? (
        <FadeInImage src={src} unoptimized={unoptimized} alt="" fill sizes="56px" className="object-cover" />
      ) : (
        <MdCardGiftcard size={ICON.standard} aria-hidden="true" />
      )}
    </span>
  );
}

/**
 * 小商店 — the items the shop sells. A new item is added in the form above the list; an existing
 * one is edited under its own row (R9-021: editing filled the form at the top of the tab, 1,375px
 * above the row pressed). Price is a number with a coin glyph in the surface ink — a severity
 * colour on a price was decoration (R9-023).
 */
type ShopTabValue = 'shop-items' | 'shop-purchases' | 'shop-legacy';
export default function ShopTab({ token }: AdminPanelProps) {
  const [tab, setTab] = useState<ShopTabValue>('shop-items');
  const [visited, setVisited] = useState<ShopTabValue[]>(['shop-items']);
  if (!visited.includes(tab)) setVisited([...visited, tab]);
  const read = useAdminQuery(itemsQuery, token);
  const items = read.data ?? EMPTY;
  const paged = usePagedRows(items, null);
  const addMutation = useAdminMutation(token);
  const saveMutation = useAdminMutation(token);
  const deleteMutation = useAdminMutation(token);
  const { confirm, confirmThen, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<{ id: number; closing: boolean } | null>(null);
  const [addSession, setAddSession] = useState(0);
  const [uploading, setUploading] = useState<number | null>(null);
  const dirtyRef = useRef(false);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  /* The shop page reads its own list; a write here makes that one stale too. */
  const committed = () => {
    read.refresh();
    shopItems.invalidate();
  };

  const add = (payload: Record<string, unknown>) =>
    void addMutation.run(
      () => adminApi.adminSaveShopItem(token, payload),
      () => {
        showToast(`已添加商品「${String(payload.name)}」`, 'success');
        setAddSession((session) => session + 1);
      },
      '添加失败',
      { onCommitted: committed },
    );

  const save = (item: ShopItemRow, payload: Record<string, unknown>) =>
    void saveMutation.run(
      () => adminApi.adminSaveShopItem(token, payload),
      () => {
        showToast(`已保存商品「${String(payload.name)}」`, 'success');
        setEditing((current) => (current?.id === item.id ? { id: item.id, closing: true } : current));
      },
      '保存失败',
      { key: item.id, onCommitted: committed },
    );

  const remove = (item: ShopItemRow) =>
    confirmThen(
      '确认删除商品',
      `确定要删除商品「${item.name}」吗？删除后商店中将不再出售该商品。`,
      () => void deleteMutation.run(
        () => adminApi.adminDeleteShopItem(token, item.id),
        () => showToast(`已删除商品「${item.name}」`, 'success'),
        '删除失败',
        {
          key: item.id,
          onCommitted: () => {
            setEditing((current) => (current?.id === item.id ? null : current));
            itemsQuery.write(token, (previous) => previous?.filter((row) => row.id !== item.id) ?? []);
            committed();
          },
        },
      ),
    );

  const openEditor = async (item: ShopItemRow, trigger: HTMLElement) => {
    if (uploading !== null) return;
    if (editing && saveMutation.isPending(editing.id)) return;
    if (editing && editing.id !== item.id && !editing.closing && dirtyRef.current) {
      const current = items.find((row) => row.id === editing.id);
      const discard = await confirm({
        title: '确认放弃修改',
        message: `确定要放弃对商品「${current?.name ?? ''}」的修改吗？`,
      });
      if (!discard) return;
    }
    captureInlineEditorLayout(trigger);
    dirtyRef.current = false;
    setEditing({ id: item.id, closing: false });
  };

  const closeEditor = () => {
    if (uploading !== null) return;
    if (!editing || saveMutation.isPending(editing.id)) return;
    setEditing({ ...editing, closing: true });
  };

  const columns: Column<ShopItemRow>[] = [
    {
      key: 'item',
      header: '商品',
      primary: true,
      render: (item) => (
        <span className="flex min-w-0 items-center gap-3">
          <ItemThumb url={item.image_url} />
          <span className="min-w-0">
            <span className="block text-body-m-emphasized text-on-surface">{item.name}</span>
            {item.description && (
              <span className="line-clamp-2 text-body-s text-on-surface-variant">{item.description}</span>
            )}
          </span>
        </span>
      ),
    },
    { key: 'id', header: 'ID', width: 'auto', render: (item) => `#${item.id}` },
    {
      key: 'price',
      header: '价格',
      width: 'auto',
      render: (item) => (
        <span className="inline-flex items-center gap-1 tabular-nums text-on-surface">
          <MdToll size={ICON.dense} aria-hidden="true" className="text-on-surface-variant" />
          {figureText(item.price)}
        </span>
      ),
    },
    { key: 'stock', header: '库存', width: 'auto', render: (item) => <span className="tabular-nums">{figureText(item.stock)}</span> },
    {
      key: 'state',
      header: '状态',
      width: 'auto',
      render: (item) => (
        <Badge tone={isActive(item.active) ? 'success' : 'neutral'} size="md">
          {isActive(item.active) ? '上架中' : '已下架'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (item) => {
        const open = editing?.id === item.id && !editing.closing;
        const busy = saveMutation.pendingKeys.has(item.id) || deleteMutation.pendingKeys.has(item.id);
        return (
          <>
            <IconButton
              size="sm"
              icon={<MdEdit />}
              aria-label={`编辑商品 ${item.name}`}
              aria-expanded={open}
              aria-controls={shopEditorId(item.id)}
              disabled={busy && !open}
              onClick={(event) => {
                if (open) closeEditor();
                else void openEditor(item, event.currentTarget);
              }}
            />
            <IconButton
              size="sm"
              variant="danger-text"
              icon={<MdDeleteOutline />}
              aria-label={`删除商品 ${item.name}`}
              loading={deleteMutation.pendingKeys.has(item.id)}
              disabled={saveMutation.pendingKeys.has(item.id)}
              onClick={() => remove(item)}
            />
          </>
        );
      },
    },
  ];

  const renderEditor = (item: ShopItemRow) => {
    if (editing?.id !== item.id) return null;
    const current = items.find((row) => row.id === item.id) ?? item;
    return (
      <InlineEditorPanel
        key={item.id}
        id={shopEditorId(item.id)}
        label={`编辑商品 ${current.name}`}
        isClosing={editing.closing}
        onExitComplete={() => setEditing((state) => (state?.id === item.id && state.closing ? null : state))}
        onEscape={saveMutation.pendingKeys.has(item.id) ? undefined : closeEditor}
      >
        <ShopItemForm
          token={token}
          onUploadBusy={(busy) => setUploading(busy ? current.id : null)}
          item={current}
          heading={`编辑商品 · ${current.name}`}
          submitLabel="保存修改"
          busy={saveMutation.pendingKeys.has(item.id)}
          onSubmit={(payload) => save(current, payload)}
          onCancel={closeEditor}
          onDirtyChange={setDirty}
        />
      </InlineEditorPanel>
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader section="shop" onRefresh={tab === 'shop-items' ? read.refresh : undefined} isLoading={read.refreshing} />
      <Tabs value={tab} onChange={setTab} activation="manual" label="商店管理分区" tabs={[{ value: 'shop-items', label: '商品管理' }, { value: 'shop-purchases', label: '消费记录' }, { value: 'shop-legacy', label: '旧版流水' }]} />
      <TabPanes value={tab}>
      <TabPane value="shop-items"><div className="space-y-6">
      <div className="space-y-4">
        <ShopItemForm
          token={token}
          key={addSession}
          heading="添加商品"
          submitLabel="添加商品"
          busy={addMutation.busy}
          onSubmit={add}
        />
      </div>
      <section aria-labelledby="admin-shop-items-heading" className="space-y-4">
        <SectionHeading as="h3" id="admin-shop-items-heading">商品列表</SectionHeading>
        <AdminListAnchor>
          <DataTable<ShopItemRow>
            columns={columns}
            rows={paged.rows}
            listKey={paged.listKey}
            rowKey={(item) => item.id}
            expandedRow={renderEditor}
            loading={read.loading}
            skeletonRows={5}
            {...tableError('商品加载失败', read.error)}
            onRetry={read.retryable ? read.refresh : undefined}
            empty="暂无商品"
          />
          <AdminPager
            page={paged.page}
            totalPages={paged.totalPages}
            onPageChange={(page) => {
              setEditing(null);
              paged.setPage(page);
            }}
            summary={read.data ? `共 ${paged.total} 件商品` : undefined}
          />
        </AdminListAnchor>
      </section>
      </div></TabPane>
      <TabPane value="shop-purchases">{visited.includes('shop-purchases') && <PurchasesPane token={token} />}</TabPane>
      <TabPane value="shop-legacy">{visited.includes('shop-legacy') && <PurchasesPane token={token} legacy />}</TabPane>
      </TabPanes>
      {confirmDialog}
    </div>
  );
}

/** One item's fields: the add form above the list and the editor under a row are this one form. */
function ShopItemForm({
  token,
  onUploadBusy,
  item,
  heading,
  submitLabel,
  busy: submitting,
  onSubmit,
  onCancel,
  onDirtyChange,
}: {
  token: string;
  onUploadBusy?: (busy: boolean) => void;
  item?: ShopItemRow;
  heading: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const busy = submitting || uploading;
  const [values, setValues] = useState<ShopFormValues>(() => shopForm(item));
  const [errors, setErrors] = useState<ShopFormErrors>({});
  const prefix = item ? `shop-${item.id}` : 'shop-new';

  const initial = shopForm(item);
  const dirty = (Object.keys(initial) as (keyof ShopFormValues)[]).some((key) => initial[key] !== values[key]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const set = <K extends keyof ShopFormValues>(field: K, value: ShopFormValues[K]) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (field in errors) setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const submit = () => {
    if (busy) return;
    const result = shopPayload(values, item);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    onSubmit(result.payload);
  };

  return (
    /* Above the list this form is the region, named by its heading; under a row the editor's panel
       is (`InlineEditorPanel`'s label), so the form inside it is not a second landmark (G4-031). */
    <AdminForm onSubmit={submit} aria-labelledby={item ? undefined : `${prefix}-heading`}>
      <SectionHeading as="h3" id={`${prefix}-heading`}>{heading}</SectionHeading>
      <FormGrid>
        <Input
          id={`${prefix}-name`}
          label="商品名称"
          required
          autoComplete="off"
          placeholder="例如：专属头像框"
          value={values.name}
          readOnly={busy}
          error={errors.name}
          onChange={(event) => set('name', event.target.value)}
        />
        <Input
          id={`${prefix}-image`}
          label="图片链接"
          autoComplete="off"
          spellCheck={false}
          value={values.imageUrl}
          readOnly={busy}
          helper="留空则显示礼物图标"
          onChange={(event) => set('imageUrl', event.target.value)}
        />
        <Input
          id={`${prefix}-price`}
          label="价格（金币）"
          inputMode="numeric"
          autoComplete="off"
          value={values.price}
          readOnly={busy}
          error={errors.price}
          onChange={(event) => set('price', event.target.value)}
        />
        <Input
          id={`${prefix}-stock`}
          label="库存"
          inputMode="numeric"
          autoComplete="off"
          value={values.stock}
          readOnly={busy}
          error={errors.stock}
          onChange={(event) => set('stock', event.target.value)}
        />
      </FormGrid>
      <CatalogImageInput token={token} kind="shop" disabled={submitting} onUploaded={(url) => set('imageUrl', url)} onBusy={(value) => { setUploading(value); onUploadBusy?.(value); }} />
      <Textarea
        id={`${prefix}-description`}
        label="商品简介"
        rows={3}
        className="resize-none"
        value={values.description}
        readOnly={busy}
        onChange={(event) => set('description', event.target.value)}
      />
      <Checkbox
        checked={values.active}
        disabled={busy}
        onChange={(checked) => set('active', checked)}
        label="上架展示"
      />
      <FormActions>
        {onCancel && (
          <Button type="button" variant="text" onClick={onCancel} disabled={busy}>
            取消
          </Button>
        )}
        <Button type="submit" variant="filled" loading={busy}>
          {submitLabel}
        </Button>
      </FormActions>
    </AdminForm>
  );
}
