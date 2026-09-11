'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Supplier = { id: string; name: string; storeId: string; status: string };
type Product = {
  id: string;
  modelName: string;
  skuOptotica: string;
  lensWidthMm: number | null;
  lensHeightMm: number | null;
  measurementSource: string;
  status: string;
  supplierName: string | null;
  createdAt: string;
  colorCounts: Record<string, number>;
};

const STATUS_LABEL: Record<string, string> = { em_triagem: 'Em triagem', publicado: 'Publicado', arquivado: 'Arquivado' };

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload };
}

export function CatalogProductsPanel() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function applyLoad([productsRes, suppliersRes]: Awaited<ReturnType<typeof loadPair>>) {
    if (productsRes.ok) setProducts(productsRes.payload.products);
    if (suppliersRes.ok) setSuppliers(suppliersRes.payload.suppliers.filter((s: Supplier) => s.status === 'liberado'));
  }

  function loadPair() {
    return Promise.all([
      fetchJson('/api/admin/catalog/products'),
      fetchJson('/api/admin/catalog/suppliers')
    ]);
  }

  function load() {
    return loadPair().then(applyLoad);
  }

  useEffect(() => {
    loadPair().then(applyLoad);
  }, []);

  async function handleNewSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const { ok, payload } = await fetchJson('/api/admin/catalog/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.get('name'), storeId: form.get('storeId'), sellerId: form.get('sellerId') })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message || (ok ? 'Fornecedor liberado.' : 'Erro.') });
    if (ok) { event.currentTarget.reset(); setShowNewSupplier(false); load(); }
  }

  async function handleNewProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const { ok, payload } = await fetchJson('/api/admin/catalog/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId: form.get('supplierId'),
        supplierItemId: form.get('supplierItemId'),
        modelName: form.get('modelName'),
        skuOptotica: form.get('skuOptotica'),
        lensWidthMm: form.get('lensWidthMm') ? Number(form.get('lensWidthMm')) : undefined,
        lensHeightMm: form.get('lensHeightMm') ? Number(form.get('lensHeightMm')) : undefined
      })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message || (ok ? 'Produto criado.' : 'Erro.') });
    if (ok) { event.currentTarget.reset(); setShowNewProduct(false); load(); }
  }

  if (products === null) return <p className="muted">Carregando…</p>;

  return (
    <div>
      <div className="catalog-toolbar">
        <div>
          <h1 style={{ margin: '8px 0', fontSize: 28, letterSpacing: '-.04em' }}>Catálogo de Produtos</h1>
          <p className="muted" style={{ margin: 0 }}>Modelos importados do AliExpress, curados manualmente pelo master.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button secondary" type="button" onClick={() => setShowNewSupplier((v) => !v)}>+ Liberar fornecedor</button>
          <button className="button primary" type="button" onClick={() => setShowNewProduct((v) => !v)}>+ Novo produto</button>
        </div>
      </div>

      {message && <p className={`form-message ${message.kind}`}>{message.text}</p>}

      {showNewSupplier && (
        <form className="card catalog-inline-form" style={{ padding: 16, marginBottom: 16 }} onSubmit={handleNewSupplier}>
          <div className="field"><label>Nome da loja</label><input name="name" required minLength={2} /></div>
          <div className="field"><label>Store ID</label><input name="storeId" required /></div>
          <div className="field"><label>Seller ID (opcional)</label><input name="sellerId" /></div>
          <button className="button primary" type="submit" disabled={busy}>Liberar</button>
        </form>
      )}

      {showNewProduct && (
        <form className="card catalog-inline-form" style={{ padding: 16, marginBottom: 16 }} onSubmit={handleNewProduct}>
          <div className="field">
            <label>Fornecedor</label>
            <select name="supplierId" required>
              <option value="">Selecione</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Product ID (fornecedor)</label><input name="supplierItemId" required /></div>
          <div className="field"><label>Nome do modelo</label><input name="modelName" required minLength={2} /></div>
          <div className="field"><label>SKU (Optótica)</label><input name="skuOptotica" required /></div>
          <div className="field"><label>Largura (mm)</label><input name="lensWidthMm" type="number" step="0.1" /></div>
          <div className="field"><label>Altura (mm)</label><input name="lensHeightMm" type="number" step="0.1" /></div>
          <button className="button primary" type="submit" disabled={busy}>Criar produto</button>
        </form>
      )}

      {!suppliers.length && !showNewSupplier && (
        <p className="helper" style={{ marginBottom: 16 }}>Nenhum fornecedor liberado ainda — libere um antes de criar produtos.</p>
      )}

      {products.length ? (
        <div className="catalog-grid">
          {products.map((product) => {
            const counts = product.colorCounts;
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            return (
              <Link key={product.id} href={`/admin/catalogo/${product.id}`} className="card catalog-product-card">
                <div className="row">
                  <h3>{product.modelName}</h3>
                  <span className="pill">{STATUS_LABEL[product.status] || product.status}</span>
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                  SKU {product.skuOptotica} · {product.supplierName || 'sem fornecedor'} · {product.lensWidthMm ? `${product.lensWidthMm}mm` : 'sem medida'}
                </p>
                <div className="catalog-badges">
                  {counts.validada ? <span className="catalog-badge validada">{counts.validada} validada{counts.validada > 1 ? 's' : ''}</span> : null}
                  {counts.pendente ? <span className="catalog-badge pendente">{counts.pendente} pendente{counts.pendente > 1 ? 's' : ''}</span> : null}
                  {counts.incompleto ? <span className="catalog-badge incompleto">{counts.incompleto} incompleta{counts.incompleto > 1 ? 's' : ''}</span> : null}
                  {counts.rejeitada ? <span className="catalog-badge rejeitada">{counts.rejeitada} rejeitada{counts.rejeitada > 1 ? 's' : ''}</span> : null}
                  {!total && <span className="catalog-badge">sem cores ainda</span>}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="catalog-empty">Nenhum produto no catálogo ainda. Crie o primeiro acima.</div>
      )}
    </div>
  );
}
