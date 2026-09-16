'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// "Carrinho" (16/09/2026), área do próprio paciente — mesma ideia da tela
// nova do profissional (ver components/order/cart-step.tsx): reúne os
// orçamentos preparados pelo profissional e as armações que ELE marcou
// GOSTEI no atendimento, pra revisão num só lugar.
//
// Diferença deliberada em relação à versão do profissional: aqui só a
// SELEÇÃO de orçamento é uma ação de escrita (reaproveita a mesma rota que
// já existe em "Escolher lente", /api/client/orders/[orderId]/select-quote)
// — remover um orçamento continua sendo só o profissional, no atendimento.
// A lista de armações curtidas é só CONSULTA: confirmar a cor final e
// removê-la da lista de curtidas também continuam com o profissional. Isso
// evita misturar dois sistemas de escolha de armação diferentes que ainda
// coexistem neste projeto (o catálogo novo, com reações, só tem rota de
// escrita para o profissional; a escolha de armação do PRÓPRIO paciente,
// na seção "Escolher armação" desta mesma página, é noutro catálogo,
// mais antigo, sem relação com GOSTEI/TALVEZ/OCULTAR).
type QuoteOption = { id: string; total: number; description: string };
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

export function ClientCartStep({ orderId, quotes, selectedQuoteId, likedColors, locked }: {
  orderId: string;
  quotes: QuoteOption[];
  selectedQuoteId: string | null;
  likedColors: LikedColor[];
  locked: boolean;
}) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function select(quoteId: string) {
    if (locked || savingId || quoteId === selectedQuoteId) return;
    setSavingId(quoteId);
    setMessage('');
    try {
    const response = await fetch(`/api/client/orders/${orderId}/select-quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) router.refresh();
    else setMessage(payload.message || 'Não foi possível selecionar o orçamento.');
    } catch { setMessage('Falha de conexão. Tente novamente.'); }
    finally { setSavingId(null); }
  }

  return (
    <div className="stack">
      <div className="subsection">
        <h3>Orçamentos ({quotes.length})</h3>
        {quotes.length ? (
          <div className="os-list">
            {quotes.map((quote) => {
              const selected = quote.id === selectedQuoteId;
              return (
                <button
                  key={quote.id}
                  className={`os-item budget-option${selected ? ' selected-budget' : ''}`}
                  onClick={() => select(quote.id)}
                  type="button"
                  disabled={locked || savingId !== null}
                  aria-pressed={selected}
                  style={{ cursor: locked ? 'default' : 'pointer' }}
                >
                  <div>
                    <strong>{quote.description}</strong>
                    <small>{selected ? 'Selecionado' : savingId === quote.id ? 'Salvando…' : locked ? 'Somente consulta' : 'Toque para selecionar'}</small>
                  </div>
                  <span className="price">R$ {quote.total.toFixed(2).replace('.', ',')}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="empty-budget">Nenhum orçamento de lente foi adicionado pelo profissional ainda.</div>
        )}
        {message && <p className="form-message error">{message}</p>}
      </div>

      <div className="subsection">
        <h3>Armações curtidas pelo profissional ({likedColors.length})</h3>
        {likedColors.length === 0 && (
          <p className="helper">Seu optometrista ainda não marcou nenhuma armação como GOSTEI durante o atendimento.</p>
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
                  <div className="helper">cor {color.colorVariantNumber ?? ''} — {color.colorName}</div>
                  {color.confirmed && <span className="complete-tag">Escolha final</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="notice">Revise sua escolha em “Escolher armação”. O profissional confirma a comanda antes da produção.</p>
      </div>
    </div>
  );
}
