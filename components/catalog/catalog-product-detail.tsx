'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser-client';

type Product = {
  id: string;
  modelName: string;
  skuOptotica: string;
  supplierItemId: string;
  lensWidthMm: number | null;
  lensHeightMm: number | null;
  measurementSource: string;
  status: string;
  supplierName: string | null;
  supplierStoreId: string | null;
  createdAt: string;
};

type ColorImage = {
  id: string;
  colorName: string;
  supplierSku: string | null;
  status: string;
  missingRequiredFields: string[];
  rejectionReason: string | null;
  validatedAt: string | null;
  originalImageUrl: string | null;
  processedImageUrl: string | null;
  hasSourceImageUrl: boolean;
};

const STATUS_LABEL: Record<string, string> = { em_triagem: 'Em triagem', publicado: 'Publicado', arquivado: 'Arquivado' };
const COLOR_STATUS_LABEL: Record<string, string> = { incompleto: 'Incompleto — falta foto', pendente: 'Pendente', validada: 'Validada', rejeitada: 'Rejeitada' };

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload };
}

async function uploadPhoto(productId: string, file: File): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  // Tudo dentro de um try/catch: uma falha de rede (fetch ou o upload direto
  // pro Storage) lança exceção em vez de devolver {error} — sem isso, o botão
  // que chamou esta função ficava "travado" (busy=true pra sempre, sem
  // nenhuma mensagem) porque o catch do handler nunca era alcançado. Achado
  // em produção (12/09/2026): usuário reportou "clico em Trocar foto e não
  // muda nada", mesmo já tendo escolhido um arquivo.
  try {
    const signRes = await fetchJson(`/api/admin/catalog/products/${productId}/images/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: file.type, size: file.size })
    });
    if (!signRes.ok) return { ok: false, message: signRes.payload.message || 'Não foi possível preparar o envio.' };
    const { error } = await getSupabaseBrowserClient().storage.from('catalog-product-photos').uploadToSignedUrl(signRes.payload.path, signRes.payload.token, file);
    if (error) return { ok: false, message: `Não foi possível enviar a foto (${error.message || 'erro desconhecido'}). Tente novamente.` };
    return { ok: true, path: signRes.payload.path };
  } catch (err) {
    return { ok: false, message: `Falha de conexão ao enviar a foto${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` };
  }
}

export function CatalogProductDetail({ productId }: { productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [colors, setColors] = useState<ColorImage[] | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const messageRef = useRef<HTMLParagraphElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNewColor, setShowNewColor] = useState(false);

  // A mensagem de sucesso/erro fica perto do topo da página — mas as ações
  // por cor (Trocar foto, Processar com IA etc.) ficam mais abaixo, na
  // grade de cores. Sem isso, um clique num card lá embaixo produz uma
  // mensagem que aparece fora da tela, dando a impressão de "não fez nada"
  // (achado em produção, 13/09/2026: usuário reportou "clico em Trocar foto
  // e não muda nada" mesmo depois da mensagem já estar aparecendo).
  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [message]);
  const newColorFileRef = useRef<File | null>(null);
  const fixFileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const replaceFileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  // Selecionar o arquivo é capturado em estado (via onChange), não lido do
  // DOM na hora do clique (via ref) — achado em produção (13/09/2026):
  // usuário reportava "Escolha um arquivo antes de clicar em Trocar foto"
  // mesmo depois de já ter escolhido um arquivo. Ler o arquivo pelo estado
  // do React, capturado no exato onChange do input, remove qualquer
  // dependência de timing entre a seleção e o clique — e mostrar o nome do
  // arquivo na tela dá uma confirmação visual de que a seleção realmente
  // "pegou" antes do usuário clicar em "Trocar foto"/"Adicionar foto".
  const [selectedFixFile, setSelectedFixFile] = useState<Record<string, File | null>>({});
  const [selectedReplaceFile, setSelectedReplaceFile] = useState<Record<string, File | null>>({});

  function applyLoad({ ok, payload }: Awaited<ReturnType<typeof fetchJson>>) {
    if (ok) { setProduct(payload.product); setColors(payload.colorImages); }
    else setMessage({ kind: 'error', text: payload.message || 'Produto não encontrado.' });
  }

  function load() {
    return fetchJson(`/api/admin/catalog/products/${productId}`).then(applyLoad);
  }

  useEffect(() => {
    fetchJson(`/api/admin/catalog/products/${productId}`).then(applyLoad);
  }, [productId]);

  async function handleSaveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelName: form.get('modelName'),
        skuOptotica: form.get('skuOptotica'),
        lensWidthMm: Number(form.get('lensWidthMm')),
        lensHeightMm: Number(form.get('lensHeightMm'))
      })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) load();
  }

  async function handlePublish(status: 'publicado' | 'arquivado') {
    setBusy(true);
    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) load();
  }

  async function handleNewColor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const colorName = String(form.get('colorName') || '');
    const supplierSku = String(form.get('supplierSku') || '') || undefined;
    const file = newColorFileRef.current;

    let originalImagePath: string | undefined;
    if (file) {
      const uploaded = await uploadPhoto(productId, file);
      if (!uploaded.ok) { setBusy(false); setMessage({ kind: 'error', text: uploaded.message }); return; }
      originalImagePath = uploaded.path;
    }

    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colorName, supplierSku, originalImagePath })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) { event.currentTarget.reset(); newColorFileRef.current = null; setShowNewColor(false); load(); }
  }

  async function handleAddMissingPhoto(colorImageId: string) {
    const file = selectedFixFile[colorImageId];
    if (!file) { setMessage({ kind: 'error', text: 'Escolha um arquivo antes de clicar em "Adicionar foto".' }); return; }
    setBusy(true);
    setMessage(null);
    // try/finally: garante que o botão nunca fique travado (busy preso em
    // true) e que sempre apareça alguma mensagem, mesmo se algo inesperado
    // (rede, etc.) der errado no meio do caminho.
    try {
      const uploaded = await uploadPhoto(productId, file);
      if (!uploaded.ok) { setMessage({ kind: 'error', text: uploaded.message }); return; }
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'completar', stillMissing: [], originalImagePath: uploaded.path })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
      setSelectedFixFile((prev) => ({ ...prev, [colorImageId]: null }));
      const input = fixFileInputs.current[colorImageId];
      if (input) input.value = '';
    }
  }

  async function handleReplacePhoto(colorImageId: string) {
    const file = selectedReplaceFile[colorImageId];
    if (!file) { setMessage({ kind: 'error', text: 'Escolha um arquivo antes de clicar em "Trocar foto".' }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const uploaded = await uploadPhoto(productId, file);
      if (!uploaded.ok) { setMessage({ kind: 'error', text: uploaded.message }); return; }
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trocar_foto', originalImagePath: uploaded.path })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
      setSelectedReplaceFile((prev) => ({ ...prev, [colorImageId]: null }));
      const input = replaceFileInputs.current[colorImageId];
      if (input) input.value = '';
    }
  }

  async function handleImportPhoto(colorImageId: string) {
    setBusy(true);
    setMessage(null);
    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/import-photo`, { method: 'POST' });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) load();
  }

  async function handleProcess(colorImageId: string) {
    setBusy(true);
    setMessage(null);
    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/process`, { method: 'POST' });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) load();
  }

  async function handleValidate(colorImageId: string, action: 'validar' | 'rejeitar') {
    let reason: string | undefined;
    if (action === 'rejeitar') {
      reason = window.prompt('Motivo da rejeição:') || '';
      if (!reason) return;
    }
    setBusy(true);
    setMessage(null);
    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) load();
  }

  if (!product || !colors) return <p className="muted">{message?.text || 'Carregando…'}</p>;

  return (
    <div>
      <div className="dashboard-head">
        <div>
          <p className="eyebrow">{STATUS_LABEL[product.status]}</p>
          <h1 style={{ fontSize: 28 }}>{product.modelName}</h1>
          <p className="muted">SKU {product.skuOptotica} · {product.supplierName || 'sem fornecedor'} · Product ID {product.supplierItemId}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {product.status !== 'publicado' && <button className="button primary" type="button" disabled={busy} onClick={() => handlePublish('publicado')}>Publicar</button>}
          {product.status !== 'arquivado' && <button className="button secondary" type="button" disabled={busy} onClick={() => handlePublish('arquivado')}>Arquivar</button>}
        </div>
      </div>

      {message && <p ref={messageRef} className={`form-message ${message.kind}`}>{message.text}</p>}

      <form className="card" style={{ padding: 20, marginBottom: 20 }} onSubmit={handleSaveProduct}>
        <div className="form-grid">
          <label>Nome do modelo<input name="modelName" defaultValue={product.modelName} required minLength={2} /></label>
          <label>SKU (Optótica)<input name="skuOptotica" defaultValue={product.skuOptotica} required /></label>
          <label>Largura da lente (mm)<input name="lensWidthMm" type="number" step="0.1" defaultValue={product.lensWidthMm ?? ''} required /></label>
          <label>Altura da lente (mm)<input name="lensHeightMm" type="number" step="0.1" defaultValue={product.lensHeightMm ?? ''} required /></label>
        </div>
        <p className="helper">Origem da medida: {product.measurementSource === 'manual' ? 'corrigida manualmente' : 'API do fornecedor'}. Product ID, SKU e loja ficam só neste painel — nunca aparecem para o paciente.</p>
        <button className="button primary" type="submit" disabled={busy}>Salvar alterações</button>
      </form>

      <div className="catalog-toolbar">
        <h2 style={{ margin: 0, fontSize: 18 }}>Cores e fotos de prova</h2>
        <button className="button secondary" type="button" onClick={() => setShowNewColor((v) => !v)}>+ Adicionar cor</button>
      </div>

      {showNewColor && (
        <form className="card" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 12 }} onSubmit={handleNewColor}>
          <div className="form-grid">
            <label>Nome da cor<input name="colorName" required /></label>
            <label>SKU do fornecedor (opcional)<input name="supplierSku" /></label>
          </div>
          <label>Foto real da armação nessa cor (opcional agora — sem foto, a cor entra como &quot;incompleto&quot;)
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { newColorFileRef.current = e.target.files?.[0] || null; }} />
          </label>
          <button className="button primary" type="submit" disabled={busy} style={{ justifySelf: 'start' }}>Adicionar cor</button>
        </form>
      )}

      {colors.length ? (
        <div className="catalog-color-grid">
          {colors.map((color) => (
            <div key={color.id} className="catalog-color-card">
              <div className="catalog-color-photos">
                <div className="half">
                  {color.originalImageUrl ? <img src={color.originalImageUrl} alt="Original" /> : 'sem foto'}
                </div>
                <div className="half">
                  {color.processedImageUrl ? <img src={color.processedImageUrl} alt="Tratada" /> : 'aguardando tratamento'}
                </div>
              </div>
              <div className="catalog-color-body">
                <div className="name"><span className="catalog-swatch" />{color.colorName}</div>
                {color.supplierSku && <span className="muted" style={{ fontSize: 11 }}>SKU {color.supplierSku}</span>}
                <span className={`catalog-badge ${color.status}`}>{COLOR_STATUS_LABEL[color.status] || color.status}</span>
                {color.rejectionReason && <span className="helper">Motivo: {color.rejectionReason}</span>}

                {color.status === 'incompleto' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {color.hasSourceImageUrl && (
                      <button className="button primary small" type="button" disabled={busy} onClick={() => handleImportPhoto(color.id)}>Importar do AliExpress</button>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      ref={(el) => { fixFileInputs.current[color.id] = el; }}
                      onChange={(e) => setSelectedFixFile((prev) => ({ ...prev, [color.id]: e.target.files?.[0] || null }))}
                    />
                    {selectedFixFile[color.id] && (
                      <span className="helper">Arquivo selecionado: {selectedFixFile[color.id]!.name}</span>
                    )}
                    <button className="button secondary small" type="button" disabled={busy} onClick={() => handleAddMissingPhoto(color.id)}>Adicionar foto{color.hasSourceImageUrl ? ' manualmente' : ''}</button>
                  </div>
                )}
                {color.status === 'pendente' && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="button secondary small" type="button" disabled={busy} onClick={() => handleProcess(color.id)}>
                      {color.processedImageUrl ? 'Reprocessar com IA' : 'Processar com IA'}
                    </button>
                    <button className="button primary small" type="button" disabled={busy} onClick={() => handleValidate(color.id, 'validar')}>Validar</button>
                    <button className="text-button danger" type="button" disabled={busy} onClick={() => handleValidate(color.id, 'rejeitar')}>Rejeitar</button>
                  </div>
                )}
                {(color.status === 'pendente' || color.status === 'rejeitada') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      ref={(el) => { replaceFileInputs.current[color.id] = el; }}
                      onChange={(e) => setSelectedReplaceFile((prev) => ({ ...prev, [color.id]: e.target.files?.[0] || null }))}
                    />
                    {selectedReplaceFile[color.id] ? (
                      <span className="helper">Arquivo selecionado: {selectedReplaceFile[color.id]!.name}</span>
                    ) : (
                      <span className="helper">Nenhum arquivo selecionado ainda</span>
                    )}
                    <button className="button secondary small" type="button" disabled={busy} onClick={() => handleReplacePhoto(color.id)}>Trocar foto (ex.: veio de lado, preciso de frente)</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="catalog-empty">Nenhuma cor cadastrada ainda.</div>
      )}
    </div>
  );
}
