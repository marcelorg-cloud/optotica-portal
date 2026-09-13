'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { parseAliexpressJson, type ParsedAliexpressColor } from '@/lib/catalog/parse-aliexpress-json';
import { FORMAT_OPTIONS, MATERIAL_OPTIONS, COLOR_VOCABULARY } from '@/lib/catalog/sku-standard';

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

  // "Colar JSON do AliExpress" (13/09/2026, pedido do usuário): em vez de
  // digitar nome do modelo/medidas à mão e depois cadastrar cor por cor
  // (como foi feito nos 5 modelos "peekaboo", via SQL escrito manualmente —
  // ver supabase/data/202609120001_...), o master cola aqui a resposta da
  // API "AliExpress Item Detail" (RapidAPI) que já usa hoje. O parser
  // (lib/catalog/parse-aliexpress-json.ts) só PRÉ-PREENCHE os campos do
  // formulário de sempre — nada é travado, tudo continua editável — e monta
  // a lista de cores detectadas abaixo, cada uma com nome editável e uma
  // caixinha pra incluir ou não. Se algum dado não vier no JSON, o campo
  // fica em branco, exatamente como se tivesse sido criado à mão.
  const [aliexpressText, setAliexpressText] = useState('');
  const [parseMessage, setParseMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  // Padrão de SKU/cor (13/09/2026): a "cor" de cada variante detectada no
  // JSON não é mais um texto livre editável — é `colorPrincipal`, escolhida
  // de uma lista fechada (sugerida automaticamente via
  // suggestPrincipalColor, sempre conferível/trocável antes de criar).
  const [parsedColors, setParsedColors] = useState<(ParsedAliexpressColor & { include: boolean; colorPrincipal: string })[]>([]);
  const [parsedGalleryUrls, setParsedGalleryUrls] = useState<string[]>([]);
  const supplierItemIdRef = useRef<HTMLInputElement | null>(null);
  const lensWidthRef = useRef<HTMLInputElement | null>(null);
  const lensHeightRef = useRef<HTMLInputElement | null>(null);

  // Achado em produção (13/09/2026, incidente "painel carregando mas não
  // abre"): quando a rota `/api/admin/catalog/products` falhava (ex.: a
  // migração de schema ainda não tinha rodado no Supabase e as colunas novas
  // não existiam), esta função só chamava `setProducts` no caminho de
  // sucesso — no de erro, não fazia NADA. Como a tela só sai da tela
  // "Carregando…" quando `products` deixa de ser `null`, o resultado era a
  // tela travada em "Carregando…" pra sempre, sem nenhuma mensagem de erro
  // visível. Agora, em caso de erro, `products` vira `[]` (lista vazia, tira
  // da tela de carregando) e a mensagem de erro da API aparece no topo.
  function applyLoad([productsRes, suppliersRes]: Awaited<ReturnType<typeof loadPair>>) {
    if (productsRes.ok) {
      setProducts(productsRes.payload.products);
    } else {
      setProducts([]);
      setMessage({ kind: 'error', text: productsRes.payload.message || 'Não foi possível carregar o catálogo de produtos.' });
    }
    if (suppliersRes.ok) {
      setSuppliers(suppliersRes.payload.suppliers.filter((s: Supplier) => s.status === 'liberado'));
    } else if (productsRes.ok) {
      // Só mostra este erro se o de produtos (mais importante) não já apareceu.
      setMessage({ kind: 'error', text: suppliersRes.payload.message || 'Não foi possível carregar os fornecedores.' });
    }
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
    loadPair().then(applyLoad).catch((err) => {
      setProducts([]);
      setMessage({ kind: 'error', text: `Falha de conexão ao carregar o catálogo${err instanceof Error ? `: ${err.message}` : ''}.` });
    });
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

  function handleParseAliexpress() {
    setParseMessage(null);
    try {
      const parsed = parseAliexpressJson(aliexpressText);
      if (supplierItemIdRef.current) supplierItemIdRef.current.value = parsed.supplierItemId || '';
      if (lensWidthRef.current) lensWidthRef.current.value = parsed.lensWidthMm ? String(parsed.lensWidthMm) : '';
      if (lensHeightRef.current) lensHeightRef.current.value = parsed.lensHeightMm ? String(parsed.lensHeightMm) : '';
      setParsedColors(parsed.colors.map((c) => ({ ...c, include: true, colorPrincipal: c.suggestedPrincipalColor || '' })));
      setParsedGalleryUrls(parsed.galleryImageUrls);
      setParseMessage({
        kind: 'success',
        text: parsed.colors.length
          ? `Encontrei ${parsed.colors.length} cor(es) e ${parsed.galleryImageUrls.length} foto(s) gerais do anúncio — confira a cor principal sugerida de cada uma antes de criar (nome do modelo continua manual: escolha formato e material abaixo).`
          : `Não encontrei cores com foto de variante nesse JSON — confira os campos preenchidos e adicione as cores depois, na tela do produto.`
      });
    } catch (err) {
      setParsedColors([]);
      setParsedGalleryUrls([]);
      setParseMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Não foi possível ler esse JSON.' });
    }
  }

  function updateParsedColor(index: number, patch: Partial<ParsedAliexpressColor & { include: boolean; colorPrincipal: string }>) {
    setParsedColors((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
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
        formatCode: form.get('formatCode'),
        materialCode: form.get('materialCode'),
        lensWidthMm: form.get('lensWidthMm') ? Number(form.get('lensWidthMm')) : undefined,
        lensHeightMm: form.get('lensHeightMm') ? Number(form.get('lensHeightMm')) : undefined
      })
    });

    if (!ok) {
      setBusy(false);
      setMessage({ kind: 'error', text: payload.message || 'Erro.' });
      return;
    }

    // Depois de criar o produto, cria também as cores e a galeria detectadas
    // no JSON colado (se houver) — mesmo padrão de chamadas já usado em
    // "Adicionar cor" (catalog-product-detail.tsx), só que em lote. Falha em
    // uma cor não cancela as outras; o resumo final conta os dois lados.
    const productId = payload.id as string;
    const colorsToCreate = parsedColors.filter((c) => c.include && c.colorPrincipal);
    let colorSuccessCount = 0;
    let colorFailCount = 0;
    for (const color of colorsToCreate) {
      const res = await fetchJson(`/api/admin/catalog/products/${productId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colorPrincipal: color.colorPrincipal,
          supplierColorName: color.supplierColorName,
          supplierSku: color.supplierSku || undefined,
          sourceImageUrl: color.sourceImageUrl || undefined
        })
      });
      if (res.ok) colorSuccessCount += 1;
      else colorFailCount += 1;
    }

    let galleryMessage = '';
    if (parsedGalleryUrls.length) {
      const galleryRes = await fetchJson(`/api/admin/catalog/products/${productId}/gallery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrls: parsedGalleryUrls })
      });
      galleryMessage = galleryRes.ok ? ` ${galleryRes.payload.message}` : ' Não foi possível salvar as fotos gerais da galeria.';
    }

    setBusy(false);
    const parts = [payload.message || 'Produto criado.'];
    if (colorsToCreate.length) parts.push(`${colorSuccessCount} cor(es) criada(s)${colorFailCount ? ` (${colorFailCount} falharam)` : ''}.`);
    if (galleryMessage) parts.push(galleryMessage.trim());
    setMessage({ kind: colorFailCount ? 'error' : 'success', text: parts.join(' ') });

    event.currentTarget.reset();
    setShowNewProduct(false);
    setAliexpressText('');
    setParsedColors([]);
    setParsedGalleryUrls([]);
    setParseMessage(null);
    load();
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
        <div className="card" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Colar JSON do AliExpress (opcional)</label>
            <p className="helper" style={{ margin: 0 }}>
              Cole aqui a resposta da API &quot;Item Detail&quot; (a mesma que você já copia hoje) — os campos abaixo são
              pré-preenchidos automaticamente e continuam editáveis; o que não vier fica em branco.
            </p>
            <textarea
              rows={4}
              value={aliexpressText}
              onChange={(e) => setAliexpressText(e.target.value)}
              placeholder='Cole aqui o JSON, ex.: {"result":{"item":{...}}}'
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <div>
              <button className="button secondary small" type="button" onClick={handleParseAliexpress} disabled={!aliexpressText.trim()}>
                Analisar JSON
              </button>
            </div>
            {parseMessage && <p className={`form-message ${parseMessage.kind}`} style={{ margin: 0 }}>{parseMessage.text}</p>}
          </div>

          <form className="catalog-inline-form" onSubmit={handleNewProduct}>
            <div className="field">
              <label>Fornecedor</label>
              <select name="supplierId" required>
                <option value="">Selecione</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Product ID (fornecedor)</label><input ref={supplierItemIdRef} name="supplierItemId" required /></div>
            <div className="field">
              <label>Formato</label>
              <select name="formatCode" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {FORMAT_OPTIONS.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Material</label>
              <select name="materialCode" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {MATERIAL_OPTIONS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select>
            </div>
            <p className="helper" style={{ gridColumn: '1 / -1', margin: 0 }}>
              O nome do modelo e o SKU (Optótica) são gerados automaticamente a partir do formato, material e do
              próximo número de modelo disponível — ver padrão de identificação de armações.
            </p>
            <div className="field"><label>Largura (mm)</label><input ref={lensWidthRef} name="lensWidthMm" type="number" step="0.1" /></div>
            <div className="field"><label>Altura (mm)</label><input ref={lensHeightRef} name="lensHeightMm" type="number" step="0.1" /></div>

            {parsedColors.length > 0 && (
              <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Cores detectadas — confira/ajuste a cor principal sugerida antes de criar</label>
                {parsedColors.map((color, index) => (
                  <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={color.include} onChange={(e) => updateParsedColor(index, { include: e.target.checked })} />
                    {color.sourceImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={color.sourceImageUrl} alt={color.supplierColorName} style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      <span style={{ width: 32, height: 32 }} />
                    )}
                    <select value={color.colorPrincipal} onChange={(e) => updateParsedColor(index, { colorPrincipal: e.target.value })} style={{ flex: 1 }}>
                      <option value="" disabled>Escolha a cor principal</option>
                      {COLOR_VOCABULARY.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <span className="muted" style={{ fontSize: 11 }}>{color.supplierColorName}</span>
                  </div>
                ))}
              </div>
            )}

            <button className="button primary" type="submit" disabled={busy}>Criar produto</button>
          </form>
        </div>
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
