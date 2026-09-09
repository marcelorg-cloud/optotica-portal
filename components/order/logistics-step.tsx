'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Milestone = { key: string; label: string; hint: string; at: string | null };

function formatDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function Timeline({ title, milestones, onMark, pendingKey }: {
  title: string; milestones: Milestone[]; onMark: (key: string) => void; pendingKey: string | null;
}) {
  return (
    <div className="subsection">
      <h3>{title}</h3>
      <div className="timeline">
        {milestones.map((m) => (
          <div className={`timeline-item${m.at ? ' done' : ''}`} key={m.key}>
            <div className="timeline-icon">{m.at ? '✓' : ''}</div>
            <div>
              <strong>{m.label}</strong>
              <small>{m.hint}</small>
              {!m.at && (
                <div style={{ marginTop: 6 }}>
                  <button className="button secondary" type="button" disabled={pendingKey === m.key} onClick={() => onMark(m.key)} style={{ minHeight: 34, padding: '0 12px', fontSize: 11 }}>
                    {pendingKey === m.key ? 'Salvando…' : 'Marcar concluído'}
                  </button>
                </div>
              )}
            </div>
            <div className="timeline-date">{formatDate(m.at) || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LogisticsStep({ orderId, frameShippedAt, frameReceivedAt, lensConfirmedAt, lensReadyAt }: {
  orderId: string; frameShippedAt: string | null; frameReceivedAt: string | null; lensConfirmedAt: string | null; lensReadyAt: string | null;
}) {
  const router = useRouter();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function mark(key: string) {
    setPendingKey(key);
    setMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/fulfillment`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'logistica', data: { milestone: key } })
    });
    const payload = await response.json().catch(() => ({}));
    setPendingKey(null);
    if (response.ok) router.refresh();
    else setMessage(payload.message || 'Não foi possível atualizar.');
  }

  return (
    <div className="stack">
      <div className="grid grid-2">
        <Timeline
          title="Armação"
          pendingKey={pendingKey}
          onMark={mark}
          milestones={[
            { key: 'frame_shipped', label: 'Em trânsito', hint: 'Fornecedor enviou o pedido.', at: frameShippedAt },
            { key: 'frame_received', label: 'Recebida', hint: 'Disponível para montagem.', at: frameReceivedAt }
          ]}
        />
        <Timeline
          title="Lentes"
          pendingKey={pendingKey}
          onMark={mark}
          milestones={[
            { key: 'lens_confirmed', label: 'Laboratório confirmou', hint: 'OS aceita para produção.', at: lensConfirmedAt },
            { key: 'lens_ready', label: 'Prontas', hint: 'Lentes disponíveis para montagem.', at: lensReadyAt }
          ]}
        />
      </div>
      {message && <p className="form-message error">{message}</p>}
    </div>
  );
}
