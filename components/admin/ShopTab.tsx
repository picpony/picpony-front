'use client';

import { useState } from 'react';
import { showToast } from '@/components/Toast';
import FadeInImage from '@/components/FadeInImage';
import Checkbox from '@/components/Checkbox';
import { MdStore, MdEdit, MdDelete, MdAdd } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import Badge from '@/components/Badge';
import { SectionHeader } from './';
import SectionHeading from '@/components/SectionHeading';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import Card from '@/components/Card';
import { Input, Textarea } from '@/components/Input';
import { ICON } from '@/lib/icons';
import * as adminApi from '@/lib/api/admin';
import { adminData, defineAdminQuery, useAdminQuery } from './queries';
import { useAdminMutation } from './useAdminMutation';

interface ShopItem {
  id: number;
  name: string;
  description: string;
  image_url: string | null;
  price: number;
  stock: number;
  active: number;
}

const EMPTY_FORM = {
  id: 0,
  name: '',
  description: '',
  image_url: '',
  price: 10,
  stock: 100,
  active: true,
};

const itemsQuery = defineAdminQuery<ShopItem[]>('shop', async (token, signal) => {
  const data = await adminApi.adminGetShopItems(token, signal);
  return adminData(data, data.items || []);
});

export default function ShopTab({ token }: { token: string }) {
  const mutation = useAdminMutation(token);
  const read = useAdminQuery(itemsQuery, token);
  const items = read.data ?? [];
  const isLoading = read.loading;
  const loadItems = read.refresh;
  const saveMutation = useAdminMutation(token);
  const saving = saveMutation.busy;
  const [form, setForm] = useState(EMPTY_FORM);
  const isEditing = form.id !== 0;

  const { confirmThen, confirmDialog } = useConfirm();

  const resetForm = () => {
    setForm(EMPTY_FORM);
  };

  const startEdit = (item: ShopItem) => {
    if (saveMutation.isPending() || mutation.isPending()) return;
    setForm({
      id: item.id,
      name: item.name,
      description: item.description || '',
      image_url: item.image_url || '',
      price: item.price,
      stock: item.stock,
      active: item.active === 1,
    });
  };

  const saveItem = async () => {
    if (saveMutation.isPending() || mutation.isPending()) return;
    if (!form.name.trim()) {
      showToast('请输入商品名称', 'error');
      return;
    }
    if (!Number.isSafeInteger(form.price) || form.price < 0 || !Number.isSafeInteger(form.stock) || form.stock < 0) {
      showToast('价格和库存必须是非负整数', 'error');
      return;
    }
    await saveMutation.run(
      () => adminApi.adminSaveShopItem(token, {
        ...form,
        active: form.active ? 1 : 0,
      }),
      () => {
        showToast(isEditing ? '已更新' : '已添加', 'success');
        resetForm();
      },
      '保存失败',
      { onCommitted: loadItems },
    );
  };

  const deleteItem = (id: number) => {
    confirmThen('确认删除', '确定要删除此商品吗？', async () => {
      if (saveMutation.isPending()) return;
      await mutation.run(
        () => adminApi.adminDeleteShopItem(token, id),
        () => showToast('已删除', 'success'),
        '删除失败',
        { onCommitted: () => {
          itemsQuery.write(token, (previous) => previous?.filter((item) => item.id !== id) ?? []);
          loadItems();
        } },
      );
    });
  };

  const shopColumns: Column<ShopItem>[] = [
    { key: 'id', header: 'ID', render: (item) => `#${item.id}` },
    {
      key: 'item',
      header: '商品',
      primary: true,
      render: (item) => (
        <div className="flex items-center gap-3">
          {item.image_url && (
            <FadeInImage
              src={item.image_url}
              alt=""
              width={40}
              height={40}
              className="size-14 shrink-0 rounded-sm object-cover"
            />
          )}
          <div className="min-w-0">
            <div className="text-body-m-emphasized text-on-surface">{item.name}</div>
            <div className="text-on-surface-variant line-clamp-1 text-body-s">{item.description}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: '价格',
      render: (item) => <span className="text-body-m-emphasized text-warning">{item.price}</span>,
    },
    { key: 'stock', header: '库存', render: (item) => item.stock },
    {
      key: 'state',
      header: '状态',
      render: (item) => (
        /* A mark, not a control — see the same note in `ReportsTab`. */
        <Badge tone={item.active === 1 ? 'success' : 'neutral'} size="md">
          {item.active === 1 ? '上架中' : '已下架'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (item) => (
        <>
          <IconButton
            size="sm"
            disabled={saving || mutation.busy}
            onClick={() => startEdit(item)}
            icon={<MdEdit size={ICON.dense} />}
            aria-label={`编辑 ${item.name}`} className="text-primary-ink"
          />
          <IconButton
            size="sm"
            onClick={() => deleteItem(item.id)}
            disabled={mutation.busy || saving}
            icon={<MdDelete size={ICON.dense} />}
            aria-label={`删除 ${item.name}`} variant="danger-text"
          />
        </>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdStore size={ICON.standard} />}
        title="小商店管理"
        onRefresh={loadItems}
      />

      <Card variant="transparent">
        <SectionHeading
          as="h3"
          className="mb-4"
          icon={isEditing ? <MdEdit size={ICON.control} /> : <MdAdd size={ICON.control} />}
        >
          {isEditing ? '编辑商品' : '添加新商品'}
        </SectionHeading>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          
          <div>
            <Input
              label="商品名称"
              id="shoptab-f1"
              type="text"
              value={form.name}
              disabled={saving}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Input
              label="图片 URL"
              id="shoptab-f2"
              type="text"
              value={form.image_url}
              disabled={saving}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
            />
          </div>
          <div>
            <Input
              label="价格（金币）"
              id="shoptab-f3"
              type="number"
              value={form.price}
              min={0}
              disabled={saving}
              onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Input
              label="库存"
              id="shoptab-f4"
              type="number"
              value={form.stock}
              min={0}
              disabled={saving}
              onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value) || 0 })}
            />
          </div>
        </div>
        <div className="mb-4">
          <Textarea
            label="商品简介"
            id="shoptab-f5"
            value={form.description}
            disabled={saving}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="resize-none"
          />
        </div>
        <div className="flex items-center gap-4 mb-4">
          
          {/* The visible words *are* the accessible name — `Checkbox`'s `label`
              renders them inside its own `<label>`, so what a screen reader
              hears cannot drift from what the eye reads. */}
          <Checkbox
            checked={form.active}
            disabled={saving}
            onChange={(checked) => setForm({ ...form, active: checked })}
            label="上架展示"
          />
        </div>
        <div className="flex gap-3">
          
          {isEditing && (
            <Button variant="text" onClick={resetForm} disabled={saving || mutation.busy}>
              取消
            </Button>
          )}
          <Button variant="filled" onClick={saveItem} loading={saving} disabled={mutation.busy}>
            {isEditing ? '保存修改' : '添加商品'}
          </Button>
        </div>
      </Card>

      <DataTable<ShopItem>
        columns={shopColumns}
        rows={items}
        rowKey={(item) => item.id}
        loading={isLoading}
        error={read.error}
        onRetry={loadItems}
        empty="暂无商品"
      />

      {confirmDialog}
    </div>
  );
}
