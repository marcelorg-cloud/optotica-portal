'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Quote = { id: string; total: number; description: string };

export function QuotesStep({ orderId, quotes, selectedQuoteId, locked }: {
  orderId: string; quotes: Quote[]; selectedQuoteId: string | null; locked: boolean;
}) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function select(quoteId: string) {
    if (locked || quoteId === selectedQuoteId) return;
    setSavingId(quoteId);
    setMessage('');
    const response = await fetch(`/api/client/orders/${orderId}/select-quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId })
    });
    const payload = await response.json().catch(() => ({}));
    setSavingId(null);
    if (response.ok) router.refresh();
    else setMessage(payload.message || 'Não foi possível selecionar o orçamento.');
  }

  return (
    <div className="stack">
      {quotes.length ? (
        <div className="os-list">
          {quotes.map((quote) => {
            const selected = quote.id === selectedQuoteId;
            return (
              <div
                key={quote.id}
                className={`os-item budget-option${selected ? ' selected-budget' : ''}`}
                onClick={() => select(quote.id)}
                role="button"
                tabIndex={0}
                style={{ cursor: locked ? 'default' : 'pointer' }}
              >
                <div>
                  <strong>{quote.description}</strong>
                  <small>{selected ? 'Selecionado' : savingId === quote.id ? 'Salvando…' : locked ? 'Pedido concluído' : 'Toque para selecionar'}</small>
                </div>
                <span className="price">R$ {quote.total.toFixed(2).replace('.', ',')}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-budget">Nenhum orçamento de lente foi adicionado pelo profissional ainda.</div>
      )}
      {message && <p className="form-message error">{message}</p>}
      <p className="notice">Você pode apenas escolher entre os orçamentos cadastrados pelo profissional. Laboratório e custos internos não são exibidos.</p>
    </div>
  );
}
