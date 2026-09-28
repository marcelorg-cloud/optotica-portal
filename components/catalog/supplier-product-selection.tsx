'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { parseSupplierList, type SupplierListingItem } from '@/lib/catalog/parse-supplier-list';
import { FORMAT_OPTIONS, MATERIAL_OPTIONS } from '@/lib/catalog/sku-standard';

type Row = SupplierListingItem & { selected: boolean; formatCode: string; materialCode: string; state?: 'imported' | 'error'; message?: string; productId?: string };

export function SupplierProductSelection({ supplier, existing, onImported }: {
  supplier: { id: string; name: string; storeId: string };
  existing: { supplierId: string; supplierItemId: string; id: string }[];
  onImported: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [listingBusy, setListingBusy] = useState(false);
  const [listingProgress, setListingProgress] = useState('');
  const [automatic, setAutomatic] = useState(false);
  const [lastPage, setLastPage] = useState(0);
  const [morePages, setMorePages] = useState(true);
  const [progress, setProgress] = useState('');
  const [search, setSearch] = useState('');
  const [formatCode, setFormatCode] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const existingIds = new Map(existing.filter((product) => product.supplierId === supplier.id).map((product) => [product.supplierItemId, product.id]));

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/catalog/suppliers/${supplier.id}/listing?page=1`).then(async (response) => {
      const payload = await response.json();
      if (!active) return;
      if (!response.ok) { setMessage(payload.message || 'Não foi possível carregar a lista da loja.'); return; }
      if (!payload.configured) return;
      setAutomatic(true);
      setLastPage(1);
      setMorePages(payload.items.length > 0);
      setRows(payload.items.map((item: SupplierListingItem) => ({ ...item, selected: false, formatCode: '', materialCode: '' })));
    }).catch(() => { if (active) setMessage('A lista automática não carregou. Você pode colar o JSON abaixo.'); });
    return () => { active = false; };
  }, [supplier.id]);

  async function loadNextPage(all = false) {
    setListingBusy(true);
    try {
      const known = new Set(rows.map((row) => row.itemId));
      let page = lastPage;
      for (let attempt = 0; attempt < (all ? 50 : 1); attempt++) {
        page++;
        setListingProgress(`Carregando página ${page}…`);
        const response = await fetch(`/api/admin/catalog/suppliers/${supplier.id}/listing?page=${page}`);
        const payload = await response.json();
        if (!response.ok) { setMessage(payload.message || `Falha ao carregar a página ${page}.`); break; }
        setLastPage(page);
        const items = (payload.items as SupplierListingItem[]).filter((item) => !known.has(item.itemId));
        for (const item of items) known.add(item.itemId);
        if (items.length) setRows((old) => [...old, ...items.map((item) => ({ ...item, selected: false, formatCode, materialCode }))]);
        // Algumas buscas repetem a última página em vez de devolver [];
        // parar também nesse caso evita requisições e duplicatas sem fim.
        if (!payload.items.length || !items.length) { setMorePages(false); break; }
        if (attempt === 49) setMessage('50 páginas carregadas nesta rodada. Continue para consultar as próximas.');
      }
    } catch { setMessage('Falha de conexão ao carregar a próxima página.'); }
    finally { setListingProgress(''); setListingBusy(false); }
  }

  function addPage() {
    try {
      const parsed = parseSupplierList(raw, supplier.storeId);
      const known = new Set(rows.map((row) => row.itemId));
      const added = parsed.filter((item) => !known.has(item.itemId));
      setRows((old) => [...old, ...added.map((item) => ({ ...item, selected: false, formatCode, materialCode }))]);
      setMessage(`${added.length} produto(s) acrescentado(s). ${parsed.length - added.length} já constava(m) na lista.`);
      setRaw('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível analisar a lista.'); }
  }

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.itemId === id ? { ...row, ...patch } : row));
  }

  const visible = rows.filter((row) => `${row.title} ${row.itemId} ${row.supplierSku || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selectable = visible.filter((row) => !existingIds.has(row.itemId) && row.state !== 'imported');
  const selected = rows.filter((row) => row.selected && !existingIds.has(row.itemId) && row.state !== 'imported');
  const invalid = selected.filter((row) => !row.formatCode || !row.materialCode);

  async function importSelected() {
    if (!selected.length || invalid.length) return;
    setBusy(true);
    setMessage('');
    let imported = 0;
    let failed = 0;
    try {
      for (let i = 0; i < selected.length; i++) {
        const row = selected[i];
        setProgress(`Importando ${i + 1} de ${selected.length}: ${row.itemId}`);
        try {
          const response = await fetch('/api/admin/catalog/products', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ supplierId: supplier.id, supplierItemId: row.itemId, formatCode: row.formatCode, materialCode: row.materialCode })
          });
          const result = await response.json().catch(() => ({}));
          if (response.ok) {
            imported++;
            updateRow(row.itemId, { state: 'imported', selected: false, productId: result.id, message: 'Em triagem' });
          } else {
            failed++;
            updateRow(row.itemId, { state: 'error', message: result.message || 'Falha ao importar' });
          }
        } catch {
          failed++;
          updateRow(row.itemId, { state: 'error', message: 'Falha de conexão. Pode tentar novamente.' });
        }
      }
      setMessage(`${imported} produto(s) importado(s) para triagem${failed ? `; ${failed} com falha (podem ser tentados novamente)` : ''}. Abra cada produto para conferir cores, medidas e fotos antes de publicar.`);
      if (imported) onImported();
    } finally { setBusy(false); setProgress(''); }
  }

  return <section className="card" style={{ padding: 18, marginBottom: 20 }} aria-label={`Produtos da loja ${supplier.name}`}>
    <h2 style={{ marginTop: 0 }}>Produtos de {supplier.name}</h2>
    <p className="helper">Store ID {supplier.storeId}. {automatic ? 'Lista da loja carregada pela API. Continue pelas páginas para conferir todos os produtos.' : 'Cole a resposta JSON da busca de produtos da loja (Store Item Search). Para ver a loja inteira, acrescente cada página da resposta.'} Os produtos entram em triagem; foto e preço aqui são apenas referências da listagem.</p>
    <textarea rows={4} value={raw} disabled={busy} onChange={(event) => setRaw(event.target.value)} placeholder="Cole aqui o JSON de uma página da lista da loja" aria-label="JSON da lista de produtos da loja" style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      <button className="button secondary small" type="button" onClick={addPage} disabled={busy || !raw.trim()}>Acrescentar página</button>
      {automatic && morePages && <button className="button secondary small" type="button" onClick={() => void loadNextPage(true)} disabled={busy || listingBusy}>{listingBusy ? listingProgress : 'Carregar toda a loja'}</button>}
      {rows.length > 0 && <button className="button secondary small" type="button" onClick={() => { setRows([]); setMessage('Lista limpa.'); }} disabled={busy}>Limpar lista</button>}
    </div>
    {message && <p role="status" className="helper">{message}</p>}
    {rows.length > 0 && <>
      <div className="catalog-filter-panel" style={{ marginTop: 16 }}>
        <label className="field">Buscar na lista<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, Product ID ou SKU" /></label>
        <label className="field">Formato para selecionados<select value={formatCode} onChange={(event) => { const code = event.target.value; setFormatCode(code); setRows((old) => old.map((row) => row.selected && !existingIds.has(row.itemId) ? { ...row, formatCode: code } : row)); }}><option value="">Escolher</option>{FORMAT_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
        <label className="field">Material para selecionados<select value={materialCode} onChange={(event) => { const code = event.target.value; setMaterialCode(code); setRows((old) => old.map((row) => row.selected && !existingIds.has(row.itemId) ? { ...row, materialCode: code } : row)); }}><option value="">Escolher</option>{MATERIAL_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
        <span className="helper">{visible.length} de {rows.length} produtos</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0', flexWrap: 'wrap' }}>
        <label><input type="checkbox" disabled={busy || !selectable.length} checked={selectable.length > 0 && selectable.every((row) => row.selected)} onChange={(event) => { const ids = new Set(selectable.map((row) => row.itemId)); setRows((old) => old.map((row) => ids.has(row.itemId) ? { ...row, selected: event.target.checked, formatCode: row.formatCode || formatCode, materialCode: row.materialCode || materialCode } : row)); }} /> Selecionar todos os visíveis disponíveis</label>
        <strong>{selected.length} selecionado(s)</strong>
        <button className="button primary small" type="button" disabled={busy || !selected.length || invalid.length > 0} onClick={importSelected}>Trazer selecionados ao catálogo</button>
        {invalid.length > 0 && <span className="helper">Defina formato e material para {invalid.length} produto(s).</span>}
        {progress && <span role="status" className="helper">{progress}</span>}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {visible.map((row) => {
          const existingId = existingIds.get(row.itemId) || row.productId;
          return <div key={row.itemId} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, flexWrap: 'wrap' }}>
            <input type="checkbox" aria-label={`Selecionar ${row.title}`} disabled={busy || !!existingId} checked={!!row.selected && !existingId} onChange={(event) => updateRow(row.itemId, { selected: event.target.checked, formatCode: row.formatCode || formatCode, materialCode: row.materialCode || materialCode })} />
            {row.imageUrl ? <img src={row.imageUrl} alt="Uma cor do produto" loading="lazy" style={{ width: 60, height: 60, objectFit: 'contain', borderRadius: 6 }} /> : <span className="helper" style={{ width: 60 }}>Sem foto</span>}
            <div style={{ flex: '1 1 220px', minWidth: 180 }}><strong>{row.title}</strong><div className="helper">Product ID {row.itemId}{row.supplierSku ? ` · SKU ${row.supplierSku}` : ''} · {row.price ? `${row.currency ? `${row.currency} ` : ''}${row.price}` : 'Preço indisponível'}</div>{row.message && <small className="helper">{row.message}</small>}</div>
            {existingId ? <Link href={`/admin/catalogo/${existingId}`}>No catálogo →</Link> : <>
              <select aria-label={`Formato de ${row.title}`} disabled={busy} value={row.formatCode} onChange={(event) => updateRow(row.itemId, { formatCode: event.target.value })}><option value="">Formato</option>{FORMAT_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select>
              <select aria-label={`Material de ${row.title}`} disabled={busy} value={row.materialCode} onChange={(event) => updateRow(row.itemId, { materialCode: event.target.value })}><option value="">Material</option>{MATERIAL_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select>
            </>}
          </div>;
        })}
      </div>
    </>}
  </section>;
}
