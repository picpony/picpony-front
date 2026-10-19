/**
 * The shop form's rules as plain functions, held to the backend's contract
 * (`POST /admin/shop/items`, `PUT /admin/shop/items/{id}` with the row's `expected_revision`):
 *
 *   { name, description, image_url (null for none), price, stock, active }
 *
 * Price and stock are whole numbers of at least 0, refused on their own fields — an empty or
 * malformed field used to become 0 silently (`parseInt || 0`), so a typo put an item on sale for
 * nothing.
 */

import { assetUrl } from '@/lib/adminCatalogTools/model';
import type { AdminShopItem, ShopItemBody } from '@/lib/api/admin';

export type ShopItemRow = AdminShopItem;

export interface ShopFormValues {
  name: string;
  description: string;
  imageUrl: string;
  price: string;
  stock: string;
  active: boolean;
}

export type ShopFormErrors = Partial<Record<'name' | 'imageUrl' | 'price' | 'stock', string>>;

export function shopForm(item?: ShopItemRow | null): ShopFormValues {
  if (!item) return { name: '', description: '', imageUrl: '', price: '10', stock: '100', active: true };
  return {
    name: item.name ?? '',
    description: item.description ?? '',
    imageUrl: item.image_url ?? '',
    price: String(item.price),
    stock: String(item.stock),
    active: item.active,
  };
}

function count(text: string): number | null {
  const value = text.trim();
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function shopPayload(
  values: ShopFormValues,
): { payload: ShopItemBody; errors?: undefined } | { payload?: undefined; errors: ShopFormErrors } {
  const errors: ShopFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = '请填写商品名称';
  const price = count(values.price);
  if (price === null) errors.price = '价格须为不小于 0 的整数';
  const stock = count(values.stock);
  if (stock === null) errors.stock = '库存须为不小于 0 的整数';
  /* The mascot's and the ponies' rule (review P6-O2): an `http://` or credentialed address would be
     mixed content on the shop's HTTPS page, or hand a password to every buyer's browser. Empty is
     a product without a picture. */
  const imageUrl = values.imageUrl.trim();
  if (imageUrl) {
    try { assetUrl(imageUrl); } catch (error) { errors.imageUrl = error instanceof Error ? error.message : '请输入有效的图片链接'; }
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    payload: {
      name,
      description: values.description.trim(),
      image_url: imageUrl || null,
      price: price as number,
      stock: stock as number,
      active: values.active,
    },
  };
}
