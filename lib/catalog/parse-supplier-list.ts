export type SupplierListingItem = {
  itemId: string;
  title: string;
  supplierSku: string | null;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
};

type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const scalar = (value: unknown): string | null => typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null;
const first = (...values: unknown[]): string | null => values.map(scalar).find(Boolean) || null;
const nested = (value: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((current, key) => object(current)?.[key], value);
const photo = (value: unknown): string | null => {
  const raw = scalar(value) || scalar(object(value)?.url) || scalar(object(value)?.imageUrl);
  if (!raw) return null;
  const url = raw.startsWith('//') ? `https:${raw}` : raw;
  return /^https:\/\/[^\s]+$/i.test(url) ? url : null;
};

// Uma resposta da busca da loja pode conter uma página, não necessariamente a
// loja inteira. A tela permite acrescentar páginas e deduplica por itemId.
export function parseSupplierList(raw: string, expectedStoreId?: string): SupplierListingItem[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error('JSON inválido. Copie a resposta completa da busca da loja.'); }
  const storeId = first(nested(data, 'result', 'storeId'), nested(data, 'storeId'), nested(data, 'data', 'storeId'));
  if (storeId && expectedStoreId && storeId !== expectedStoreId) {
    throw new Error(`Esta resposta pertence à loja ${storeId}, não à loja ${expectedStoreId}.`);
  }
  const roots = [data, nested(data, 'result'), nested(data, 'data'), nested(data, 'result', 'data')];
  const lists: unknown[] = [];
  for (const root of roots) {
    if (Array.isArray(root)) lists.push(root);
    for (const key of ['items', 'products', 'itemList', 'productList', 'list', 'results']) {
      const value = object(root)?.[key];
      if (Array.isArray(value)) lists.push(value);
      else if (Array.isArray(object(value)?.list)) lists.push(object(value)!.list);
    }
  }
  const list = lists.find((value) => Array.isArray(value)) as unknown[] | undefined;
  if (!list) throw new Error('Não encontrei uma lista de produtos neste JSON. Use a resposta de “Store Item Search”, não “Item Detail”.');
  const result = new Map<string, SupplierListingItem>();
  for (const entry of list) {
    const item = object(entry);
    if (!item) continue;
    const itemId = first(item.itemId, item.productId, item.product_id, item.item_id, item.id);
    if (!itemId || !/^\d{5,30}$/.test(itemId)) continue;
    const priceObject = object(item.price) || object(item.prices);
    const price = first(item.salePrice, item.discountPrice, item.price, priceObject?.salePrice, priceObject?.current, priceObject?.value, priceObject?.minPrice);
    if (result.has(itemId)) continue;
    result.set(itemId, {
      itemId,
      title: first(item.title, item.productTitle, item.name) || `Produto ${itemId}`,
      supplierSku: first(item.supplierSku, item.productSku, item.sku) || null,
      imageUrl: photo(item.imageUrl) || photo(item.image) || photo(item.productImage) || photo(item.thumbnail) || photo(Array.isArray(item.images) ? item.images[0] : null),
      price,
      currency: first(item.currency, item.currencyCode, priceObject?.currency, priceObject?.currencyCode)
    });
  }
  if (!result.size && list.length) throw new Error('A lista não contém Product IDs reconhecíveis. Confira o formato da resposta da API.');
  return [...result.values()];
}
