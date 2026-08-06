'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import FadeInImage from '@/components/FadeInImage';
import Checkbox from '@/components/Checkbox';
import Modal from '@/components/Modal';
import { MdStore, MdEdit, MdDelete, MdAdd } from 'react-icons/md';
import DataTable, { type Column } from '@/components/DataTable';
import Chip from '@/components/Chip';
import { SectionHeader } from './';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Input, Textarea } from '@/components/Input';

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

  const [shopConfirmModalOpen, setShopConfirmModalOpen] = useState(false);
  const [shopConfirmTitle, setShopConfirmTitle] = useState('');
  const [shopConfirmMessage, setShopConfirmMessage] = useState('');
  const shopConfirmActionRef = useRef<(() => void) | null>(null);

  const showShopConfirm = (title: string, message: string, action: () => void) => {
    setShopConfirmTitle(title);
    setShopConfirmMessage(message);
    shopConfirmActionRef.current = action;
    setShopConfirmModalOpen(true);
  };

  const handleShopConfirmAction = () => {
    shopConfirmActionRef.current?.();
    setShopConfirmModalOpen(false);
  };

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.adminGetShopItems(token);
      if (data.success) {
        setItems(data.items || []);
      }
    } catch {
      showToast('加载商品失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api
      .adminGetShopItems(token)
      .then((data) => {
        if (data.success) {
          setItems(data.items || []);
        }
      })
      .catch(() => showToast('加载商品失败', 'error'))
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
      const res = await api.adminSaveShopItem(token, {
        ...form,
        active: form.active ? 1 : 0,
      });
      const data = await res.json();
      if (data.success) {
        showToast(editingItem ? '更新成功' : '添加成功', 'success');
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
    showShopConfirm('确认删除', '确定要删除这个商品吗？', async () => {
      try {
        const res = await api.adminDeleteShopItem(token, id);
        const data = await res.json();
        if (data.success) {
          showToast('删除成功', 'success');
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
              className="h-10 w-10 shrink-0 rounded object-cover"
            />
          )}
          <div className="min-w-0">
            <div className="text-on-surface font-medium">{item.name}</div>
            <div className="text-on-surface-variant line-clamp-1 text-body-s">{item.description}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'price',
      header: '价格',
      render: (item) => <span className="text-warning font-medium">{item.price}</span>,
    },
    { key: 'stock', header: '库存', render: (item) => item.stock },
    {
      key: 'state',
      header: '状态',
      render: (item) => (
        <Chip variant="input" tone={item.active === 1 ? 'success' : 'neutral'}>
          {item.active === 1 ? '上架中' : '已下架'}
        </Chip>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      actions: true,
      render: (item) => (
        <>
          <button
            onClick={() => startEdit(item)}
            className="touch-target state-layer text-warning rounded-full p-1.5"
            title="编辑"
            aria-label={`编辑 ${item.name}`}
          >
            <MdEdit size={18} />
          </button>
          <button
            onClick={() => deleteItem(item.id)}
            className="touch-target state-layer rounded-full p-1.5 text-error"
            title="删除"
            aria-label={`删除 ${item.name}`}
          >
            <MdDelete size={18} />
          </button>
        </>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdStore className="text-primary" size={24} />}
        title="小商店管理"
        onRefresh={loadItems}
      />

      <Card variant="outlined">
        <h3 className="font-semibold text-on-surface mb-4 flex items-center gap-2">
          {isEditing ? <MdEdit size={20} /> : <MdAdd size={20} />}
          {isEditing ? '编辑商品' : '添加新商品'}{' '}
        </h3>{' '}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {' '}
          <div>
            {' '}
            <Input
              label="商品名称"
              id="shoptab-f1"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />{' '}
          </div>{' '}
          <div>
            {' '}
            <Input
              label="图片URL"
              id="shoptab-f2"
              type="text"
              value={form.image_url}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
            />{' '}
          </div>{' '}
          <div>
            {' '}
            <Input
              label="价格（金币）"
              id="shoptab-f3"
              type="number"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
            />{' '}
          </div>{' '}
          <div>
            {' '}
            <Input
              label="库存"
              id="shoptab-f4"
              type="number"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value) || 0 })}
            />{' '}
          </div>{' '}
        </div>{' '}
        <div className="mb-4">
          {' '}
          <label className="block text-label-l text-on-surface mb-1" htmlFor="shoptab-f5">
            商品简介
          </label>{' '}
          <Textarea
            id="shoptab-f5"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="resize-none"
          />{' '}
        </div>{' '}
        <div className="flex items-center gap-4 mb-4">
          {' '}
          <div className="flex items-center gap-2 cursor-pointer">
            {' '}
            <Checkbox
              checked={form.active}
              onChange={(checked) => setForm({ ...form, active: checked })}
              aria-label="上架该商品"
            />{' '}
            <span className="text-body-m text-on-surface">上架展示</span>{' '}
          </div>{' '}
        </div>{' '}
        <div className="flex gap-3">
          {' '}
          {isEditing && (
            <Button variant="text" onClick={resetForm}>
              {' '}
              取消{' '}
            </Button>
          )}{' '}
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

      <Modal
        isOpen={shopConfirmModalOpen}
        onClose={() => setShopConfirmModalOpen(false)}
        title={shopConfirmTitle}
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setShopConfirmModalOpen(false)}
              className="px-4 py-2 text-label-l text-on-surface-variant hover:bg-surface-container-high rounded-full transition-ui"
            >
              取消
            </button>
            <Button variant="danger" onClick={handleShopConfirmAction}>
              确认
            </Button>
          </>
        }
      >
        <p className="text-body-m text-on-surface-variant">{shopConfirmMessage}</p>
      </Modal>
    </div>
  );
}
