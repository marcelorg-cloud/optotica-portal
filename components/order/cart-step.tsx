'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// "Carrinho" (16/09/2026) — tela nova, ADICIONAL às etapas "OS/Orçamento" e
// "Escolha da armação" (que continuam existindo do jeito que estão hoje,
// sem nenhuma mudança). Este componente não cria nenhum mecanismo novo de
// dados: ele só reúne, numa visão única, o que já existe em duas tabelas
// (`quotes` e `order_frame_reactions`, via reação "gostei") e reaproveita
// as MESMAS rotas de sempre:
// - Orçamentos: select-quote/route.ts (marcar o final) + uma rota nova,
//   quotes/[quoteId]/route.ts (DELETE), só pra remover um orçamento que não
//   será mais considerado.
// - Armações curtidas: frame/route.ts (confirmar a cor final) +
//   frame-reactions/route.ts (marcar a MESMA reação "gostei" de novo
//   desmarca — mesmo toggle já usado na Etapa 3, ver components/order/frame-step.tsx).
// Cadastrar orçamentos novos ou reagir a mais cores continua só nas etapas
// originais — este carrinho é puramente uma tela de revisão/curadoria final.
type QuoteOption = { id: string; total: number; description: string; laboratory: string; notes: string };
type LikedColor = {
  colorId: string;
  modelName: string;
  skuOptotica: string;
  colorName: string;
  colorVariantNumber: number | null;
  fotoOculosUrl: string | null;
  provaUrl: string | null;
  confirmed: boolean;
};

export function CartStep({ orderId, quotes, selectedQuoteId, likedColors, locked }: {
  orderId: string;
  quotes: QuoteOption[];
  selectedQuoteId: string | null;
  likedColors: LikedColor[];
  locked: boolean;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function selectQuote(quoteId: string) {
    if (locked || quoteId === selectedQuoteId || busyKey) return;
    setBusyKey(`select-${quoteId}`);
    setMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/select-quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId })
    });
    setBusyKey(null);
    if (response.ok) { router.refresh(); }
    else { const payload = await response.json().catch(() => ({})); setMessage(payload.message || 'Não foi possível selecionar o orçamento.'); }
  }

  async function removeQuote(quoteId: string) {
    if (locked || busyKey) return;
    setBusyKey(`remove-quote-${quoteId}`);
    setMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/quotes/${quoteId}`, { method: 'DELETE' });
    setBusyKey(null);
    if (response.ok) { router.refresh(); }
    else { const payload = await response.json().catch(() => ({})); setMessage(payload.message || 'Não foi possível remover o orçamento.'); }
  }

  async function confirmColor(colorId: string) {
    if (locked || busyKey) return;
    setBusyKey(`confirm-${colorId}`);
    setMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/frame`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogColorImageId: colorId })
    });
    setBusyKey(null);
    if (response.ok) { router.refresh(); }
    else { const payload = await response.json().catch(() => ({})); setMessage(payload.message || 'Não foi possível confirmar a armação.'); }
  }

  async function removeLiked(colorId: string) {
    if (locked || busyKey) return;
    setBusyKey(`remove-color-${colorId}`);
    setMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/frame-reactions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogColorImageId: colorId, status: 'gostei' })
    });
    setBusyKey(null);
    if (response.ok) { router.refresh(); }
    else { const payload = await response.json().catch(() => ({})); setMessage(payload.message || 'Não foi possível remover esta armação do carrinho.'); }
  }

  return (
    <div className="stack">
      {locked && <div className="notice">🔒 Etapa bloqueada — Comanda final já confirmada.</div>}
      <p className="helper">
        Revise os orçamentos de &quot;Lentes sugeridas&quot; e as armações marcadas GOSTEI em
        &quot;Escolha da armação&quot;. Selecione a combinação final para o pedido.
      </p>

      <div className="subsection">
        <h3>Orçamentos ({quotes.length})</h3>
        <div className="os-list">
          {quotes.length ? quotes.map((quote) => (
            <div key={quote.id} className={`os-item budget-option${quote.id === selectedQuoteId ? ' selected-budget' : ''}`}>
              <div
                style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: locked ? 'default' : 'pointer', flex: 1 }}
                onClick={() => selectQuote(quote.id)}
              >
                <input type="radio" name="carrinho_orcamento" readOnly checked={quote.id === selectedQuoteId} style={{ width: 'auto', marginTop: 4 }} />
                <div>
                  <strong>{quote.description}</strong>
                  <small>{quote.laboratory}{quote.notes ? ' · ' + quote.notes : ''}</small>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="price">R$ {quote.total.toFixed(2).replace('.', ',')}</div>
                <button
                  type="button" className="button secondary small"
                  disabled={locked || busyKey === `remove-quote-${quote.id}`}
                  onClick={(e) => { e.stopPropagation(); removeQuote(quote.id); }}
                >
                  {busyKey === `remove-quote-${quote.id}` ? 'Removendo…' : 'Remover'}
                </button>
              </div>
            </div>
          )) : <div className="empty-budget">Nenhum orçamento adicionado ainda — cadastre na etapa &quot;Lentes sugeridas&quot;.</div>}
        </div>
      </div>

      <div className="subsection">
        <h3>Armações curtidas ({likedColors.length})</h3>
        {likedColors.length === 0 && (
          <p className="helper">Nenhuma armação marcada GOSTEI ainda — reaja às cores na etapa &quot;Escolha da armação&quot;.</p>
        )}
        {likedColors.length > 0 && (
          <div className="grid grid-2">
            {likedColors.map((color) => (
              <div className="product-choice" key={color.colorId}>
                <div className="product-img">
                  {(color.provaUrl || color.fotoOculosUrl)
                    ? <img src={color.provaUrl || color.fotoOculosUrl || ''} alt={`${color.modelName} — cor ${color.colorName}`} />
                    : null}
                </div>
                <div>
                  <strong>{color.modelName}</strong>
                  <div className="helper">MODELO {color.skuOptotica} · cor {color.colorVariantNumber ?? ''} — {color.colorName}</div>
                  {color.confirmed && <span className="complete-tag">Confirmada</span>}
                </div>
                <div className="actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!color.confirmed && (
                    <button
                      type="button" className="button primary small"
                      disabled={locked || busyKey === `confirm-${color.colorId}`}
                      onClick={() => confirmColor(color.colorId)}
                    >
                      {busyKey === `confirm-${color.colorId}` ? 'Confirmando…' : 'Confirmar esta cor'}
                    </button>
                  )}
                  <button
                    type="button" className="button secondary small"
                    disabled={locked || busyKey === `remove-color-${color.colorId}`}
                    onClick={() => removeLiked(color.colorId)}
                  >
                    {busyKey === `remove-color-${color.colorId}` ? 'Removendo…' : 'Remover'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <p className="form-message error">{message}</p>}
    </div>
  );
}
