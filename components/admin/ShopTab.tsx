'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { showToast } from '@/components/Toast';
import FadeInImage from '@/components/FadeInImage';
import Checkbox from '@/components/Checkbox';
import Modal from '@/components/Modal';
import { MdStore, MdEdit, MdDelete, MdAdd } from 'react-icons/md';
import { SectionHeader, EmptyState, Spinner } from './';

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
    api.adminGetShopItems(token)
      .then((data) => {
        if (data.success) {
          setItems(data.items || []);
        }
      })
      .catch(() => showToast('加载商品失败', 'error'))
      .finally(() => setIsLoading(false));
  }, [token]);

  const resetForm = () => {
    setForm({ id: 0, name: '', description: '', image_url: '', price: 10, stock: 100, active: true });
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
    showShopConfirm(
      '确认删除',
      '确定要删除这个商品吗？',
      async () => {
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
      }
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon={<MdStore className="text-primary" size={24} />}
        title="小商店管理"
        onRefresh={loadItems}
      />

      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
          {isEditing ? <MdEdit size={20} /> : <MdAdd size={20} />}
          {isEditing ? '编辑商品' : '添加新商品'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">商品名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">图片URL</label>
            <input
              type="text"
              value={form.image_url}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">价格（金币）</label>
            <input
              type="number"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">库存</label>
            <input
              type="number"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm"
            />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">商品简介</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none text-sm resize-none"
          />
        </div>
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={form.active} onChange={(checked) => setForm({ ...form, active: checked })} />
            <span className="text-sm text-slate-700 dark:text-slate-300">上架展示</span>
          </div>
        </div>
        <div className="flex gap-3">
          {isEditing && (
            <button
              onClick={resetForm}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
          )}
          <button
            onClick={saveItem}
            className="px-4 py-2 text-sm font-medium text-white bg-primary hover:bg-primary/90 rounded-lg transition-colors"
          >
            {isEditing ? '保存修改' : '添加商品'}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">ID</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">商品</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">价格</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">库存</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">状态</th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700 dark:text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyState colSpan={6} message="" icon={<Spinner label="" />} />
            ) : items.length === 0 ? (
              <EmptyState colSpan={6} message="暂无商品" />
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-sm">#{item.id}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                        {item.image_url && (
                        <FadeInImage src={item.image_url} alt="" width={40} height={40} className="w-10 h-10 rounded object-cover" />
                      )}
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200">{item.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{item.description}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-amber-600">{item.price}</td>
                  <td className="px-4 py-3 text-sm">{item.stock}</td>
                  <td className="px-4 py-3">
                    {item.active === 1 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        上架中
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        已下架
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEdit(item)}
                        className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded transition-colors"
                      >
                        <MdEdit size={18} />
                      </button>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
                      >
                        <MdDelete size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={shopConfirmModalOpen}
        onClose={() => setShopConfirmModalOpen(false)}
        title={shopConfirmTitle}
        maxWidth="max-w-sm"
        footer={
          <>
            <button
              onClick={() => setShopConfirmModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleShopConfirmAction}
              className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
            >
              确认
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">{shopConfirmMessage}</p>
      </Modal>
    </div>
  );
}
