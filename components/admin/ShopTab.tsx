'use client';

import { useState, useEffect, useCallback } from 'react';
import { showToast } from '@/components/Toast';
import FadeInImage from '@/components/FadeInImage';
import Checkbox from '@/components/Checkbox';
import { MdStore, MdEdit, MdDelete, MdAdd } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import IconButton from '@/components/IconButton';
import Badge from '@/components/Badge';
import { SectionHeader } from './';
import Button from '@/components/Button';
import { useConfirm } from '@/components/ConfirmDialog';
import Card from '@/components/Card';
import { Input, Textarea } from '@/components/Input';
import { ICON } from '@/lib/icons';
/* A namespace import, and it is the point: `lib/api.ts`'s `api` is a runtime
   spread and therefore un-tree-shakeable, so while the admin surface was in it
   every gallery route shipped all 48 of these. Only the eleven admin tabs
   import it now, and each is already its own `dynamic` chunk. */
import * as adminApi from '@/lib/api/admin';

interface ShopItem {
  id: number;
  name: string;
  description: string;
  image_url: string | null;
  price: number;
  stock: number;
  active: number;
}

export default function ShopTab({ token }: { token: string }) {
  const [items, setItems] = useState<ShopItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState<ShopItem | null>(null);
  const [form, setForm] = useState({
    id: 0,
    name: '',
    description: '',
    image_url: '',
    price: 10,
    stock: 100,
    active: true,
  });

  const { confirmThen, confirmDialog } = useConfirm();

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await adminApi.adminGetShopItems(token);
      if (data.success) {
        setItems(data.items || []);
      }
    } catch {
      showToast('商品加载失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    adminApi
      .adminGetShopItems(token)
      .then((data) => {
        if (data.success) {
          setItems(data.items || []);
        }
      })
      .catch(() => showToast('商品加载失败', 'error'))
      .finally(() => setIsLoading(false));
  }, [token]);

  const resetForm = () => {
    setForm({
      id: 0,
      name: '',
      description: '',
      image_url: '',
      price: 10,
      stock: 100,
      active: true,
    });
    setEditingItem(null);
    setIsEditing(false);
  };

  const startEdit = (item: ShopItem) => {
    setEditingItem(item);
    setForm({
      id: item.id,
      name: item.name,
      description: item.description || '',
      image_url: item.image_url || '',
      price: item.price,
      stock: item.stock,
      active: item.active === 1,
    });
    setIsEditing(true);
  };

  const saveItem = async () => {
    if (!form.name.trim()) {
      showToast('请输入商品名称', 'error');
      return;
    }
    try {
      const res = await adminApi.adminSaveShopItem(token, {
        ...form,
        active: form.active ? 1 : 0,
      });
      const data = await res.json();
      if (data.success) {
        showToast(editingItem ? '已更新' : '已添加', 'success');
        resetForm();
        loadItems();
      } else {
        showToast(data.error || '保存失败', 'error');
      }
    } catch {
      showToast('保存失败', 'error');
    }
  };

  const deleteItem = async (id: number) => {
    confirmThen('确认删除', '确定要删除此商品吗？', async () => {
      try {
        const res = await adminApi.adminDeleteShopItem(token, id);
        const data = await res.json();
        if (data.success) {
          showToast('已删除', 'success');
          loadItems();
        } else {
          showToast(data.error || '删除失败', 'error');
        }
      } catch {
        showToast('删除失败', 'error');
      }
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
            onClick={() => startEdit(item)}
            icon={<MdEdit size={ICON.dense} />}
            aria-label={`编辑 ${item.name}`} className="text-primary"
          />
          <IconButton
            size="sm"
            onClick={() => deleteItem(item.id)}
            icon={<MdDelete size={ICON.dense} />}
            aria-label={`删除 ${item.name}`} className="text-error"
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
        <h3 className="text-label-l text-on-surface mb-4 flex items-center gap-2">
          {isEditing ? <MdEdit size={ICON.control} /> : <MdAdd size={ICON.control} />}
          {isEditing ? '编辑商品' : '添加新商品'}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          
          <div>
            {' '}
            <Input
              label="商品名称"
              id="shoptab-f1"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            {' '}
            <Input
              label="图片 URL"
              id="shoptab-f2"
              type="text"
              value={form.image_url}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
            />
          </div>
          <div>
            {' '}
            <Input
              label="价格（金币）"
              id="shoptab-f3"
              type="number"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div>
            {' '}
            <Input
              label="库存"
              id="shoptab-f4"
              type="number"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value) || 0 })}
            />
          </div>
        </div>
        <div className="mb-4">
          {' '}
          <label className="block text-label-l text-on-surface-variant mb-1" htmlFor="shoptab-f5">
            商品简介
          </label>
          <Textarea
            id="shoptab-f5"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="resize-none"
          />
        </div>
        <div className="flex items-center gap-4 mb-4">
          
          {/* The visible words *are* the accessible name — `Checkbox`'s `label`
              renders them inside its own `<label>`. This was a `<span>` beside the
              box with a differently-worded `aria-label` on the box, so a screen
              reader heard "上架该商品" while the eye read "上架展示", and the
              `cursor-pointer` on the wrapper promised a click target the text did
              not have. */}
          <Checkbox
            checked={form.active}
            onChange={(checked) => setForm({ ...form, active: checked })}
            label="上架展示"
          />
        </div>
        <div className="flex gap-3">
          
          {isEditing && (
            <Button variant="text" onClick={resetForm}>
              {' '}
              取消
            </Button>
          )}
          <Button variant="filled" onClick={saveItem}>
            {' '}
            {isEditing ? '保存修改' : '添加商品'}
          </Button>
        </div>
      </Card>

      <DataTable<ShopItem>
        columns={shopColumns}
        rows={items}
        rowKey={(item) => item.id}
        loading={isLoading}
        empty="暂无商品"
      />

      {confirmDialog}
    </div>
  );
}
