/**
 * The shop form's rules as plain functions, held to the original console's contract
 * (`oldfe/admin.html`, `saveShopItem`):
 *
 *   admin_save_shop_item { id (0 for a new item), name, description, image_url, price, stock, active }
 *
 * Price and stock are whole numbers of at least 0, refused on their own fields — an empty or
 * malformed field used to become 0 silently (`parseInt || 0`), so a typo put an item on sale for
 * nothing. A figure the row did not carry opens empty rather than as 0 (G4-015), so a save cannot
 * write a price nobody typed.
 */

import { figureField } from './figures';
import { assetUrl } from '@/lib/adminCatalogTools/model';

export interface ShopItemRow {
  id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price?: number | string | null;
  stock?: number | string | null;
  active?: number | string | boolean | null;
}

export interface ShopFormValues {
  name: string;
  description: string;
  imageUrl: string;
  price: string;
  stock: string;
  active: boolean;
}

export type ShopFormErrors = Partial<Record<'name' | 'imageUrl' | 'price' | 'stock', string>>;

export function isActive(value: unknown): boolean {
  return value === true || Number(value) === 1;
}

export function shopForm(item?: ShopItemRow | null): ShopFormValues {
  if (!item) return { name: '', description: '', imageUrl: '', price: '10', stock: '100', active: true };
  return {
    name: item.name ?? '',
    description: item.description ?? '',
    imageUrl: item.image_url ?? '',
    price: figureField(item.price),
    stock: figureField(item.stock),
    active: isActive(item.active),
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
  item?: ShopItemRow | null,
): { payload: Record<string, unknown>; errors?: undefined } | { payload?: undefined; errors: ShopFormErrors } {
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
      id: item?.id ?? 0,
      name,
      description: values.description.trim(),
      image_url: imageUrl,
      price,
      stock,
      active: values.active ? 1 : 0,
    },
  };
}
