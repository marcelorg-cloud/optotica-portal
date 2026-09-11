'use client';

import { useEffect, useState } from 'react';

type Pending = {
  id: string; productId: string; colorName: string; productName: string; productSku: string;
  lensWidthMm: number | null; createdAt: string; originalImageUrl: string | null; processedImageUrl: string | null;
};
type Recent = { id: string; productName: string; colorName: string; status: string; rejectionReason: string | null; validatedAt: string | null };

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload };
}

export function CatalogReviewQueue() {
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  function load() {
    return fetchJson('/api/admin/catalog/review-queue').then(({ ok, payload }) => {
      if (ok) { setPending(payload.pending); setRecent(payload.recent); }
    });
  }

  useEffect(() => {
    fetchJson('/api/admin/catalog/review-queue').then(({ ok, payload }) => {
      if (ok) { setPending(payload.pending); setRecent(payload.recent); }
    });
  }, []);

  async function handleAction(item: Pending, action: 'validar' | 'rejeitar') {
    let reason: string | undefined;
    if (action === 'rejeitar') {
      reason = window.prompt('Motivo da rejeição:') || '';
      if (!reason) return;
    }
    setBusy(true);
    setMessage(null);
    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${item.productId}/images/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason })
    });
    setBusy(false);
    setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
    if (ok) load();
  }

  if (pending === null) return <p className="muted">Carregando…</p>;

  return (
    <div>
      <div className="dashboard-head">
        <div>
          <h1 style={{ fontSize: 28 }}>Fila de Aprovação — IA</h1>
          <p className="muted">Foto original enviada aguardando validação manual antes de valer para a prova online.</p>
        </div>
        <span className="pill">{pending.length} pendente{pending.length === 1 ? '' : 's'}</span>
      </div>

      {message && <p className={`form-message ${message.kind}`}>{message.text}</p>}

      {pending.length ? (
        <div className="catalog-review-grid">
          {pending.map((item) => (
            <div key={item.id} className="card catalog-review-card">
              <div className="catalog-compare">
                <div className="half">{item.originalImageUrl ? <img src={item.originalImageUrl} alt="Original" /> : 'sem foto'}</div>
                <div className="half">{item.processedImageUrl ? <img src={item.processedImageUrl} alt="Tratada" /> : 'aguardando tratamento'}</div>
              </div>
              <div className="catalog-review-meta">
                <strong>{item.productName} · {item.colorName}</strong>
                <small>SKU {item.productSku}{item.lensWidthMm ? ` · Largura ref. ${item.lensWidthMm}mm` : ''} · enviado {formatDate(item.createdAt)}</small>
              </div>
              <div className="catalog-review-actions">
                <button className="button primary small" type="button" disabled={busy} onClick={() => handleAction(item, 'validar')}>Aprovar</button>
                <button className="text-button danger" type="button" disabled={busy} onClick={() => handleAction(item, 'rejeitar')}>Rejeitar</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="catalog-empty">Nenhuma imagem pendente de aprovação.</div>
      )}

      <h2 style={{ margin: '36px 0 14px', fontSize: 18 }}>Revisadas recentemente</h2>
      <section className="card table-card">
        <div className="table-head"><span>Produto · Cor</span><span>Resultado</span><span>Quando</span><span></span></div>
        {recent.length ? recent.map((row) => (
          <div className="table-row" key={row.id}>
            <span>{row.productName} · {row.colorName}</span>
            <span className={`catalog-badge ${row.status}`}>{row.status === 'validada' ? 'Validada' : `Rejeitada${row.rejectionReason ? ` — ${row.rejectionReason}` : ''}`}</span>
            <time>{formatDate(row.validatedAt)}</time>
            <span></span>
          </div>
        )) : <div className="empty-state">Nenhuma revisão ainda.</div>}
      </section>
    </div>
  );
}
