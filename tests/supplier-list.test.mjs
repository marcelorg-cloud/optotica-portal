import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupplierList } from '../lib/catalog/parse-supplier-list.ts';

test('reads a supplier search page with one thumbnail, optional SKU and price', () => {
  const rows = parseSupplierList(JSON.stringify({ result: { storeId: '123', items: [
    { itemId: 1234567890, title: 'Armação', image: '//images.example/item.jpg', price: { current: '12.50', currency: 'USD' }, sku: 'AB-7' },
    { itemId: '2345678901', title: 'Outra', images: ['https://images.example/2.jpg'] },
    { itemId: '1234567890', title: 'Armação', image: '//images.example/item.jpg' }
  ] } }), '123');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].itemId, '1234567890');
  assert.equal(rows[0].imageUrl, 'https://images.example/item.jpg');
  assert.equal(rows[0].price, '12.50');
  assert.equal(rows[0].supplierSku, 'AB-7');
  assert.equal(rows[0].currency, 'USD');
  assert.equal(rows[1].price, null);
});

test('rejects the wrong store and a single item detail response', () => {
  assert.throws(() => parseSupplierList('{"storeId":"456","items":[]}', '123'), /loja 456/);
  assert.throws(() => parseSupplierList('{"result":{"item":{"itemId":1234567890}}}'), /Store Item Search/);
});
