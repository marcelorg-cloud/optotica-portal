'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Variant = { color: string; image?: string; qty?: number };
type Frame = { id: string; name: string; kind: string; variants: Variant[] };

export function FrameStep({ orderId, frames, selectedFrameName, selectedColor, locked }: {
  orderId: string;
  frames: Frame[];
  selectedFrameName: string | null;
  selectedColor: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [colorByFrame, setColorByFrame] = useState<Record<string, string>>(
    Object.fromEntries(frames.map((f) => [f.id, f.variants[0]?.color || '']))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function select(frameId: string) {
    if (locked) return;
    const color = colorByFrame[frameId];
    if (!color) return;
    setSavingId(frameId);
    setMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/frame`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frameId, color })
    });
    const payload = await response.json().catch(() => ({}));
    setSavingId(null);
    if (response.ok) router.refresh();
    else setMessage(payload.message || 'Não foi possível registrar a armação.');
  }

  return (
    <div className="stack">
      {locked && <div className="notice">🔒 Etapa bloqueada — Comanda final já confirmada.</div>}
      {selectedFrameName && (
        <div className="notice">Armação selecionada: <strong>{selectedFrameName}</strong> · cor {selectedColor}</div>
      )}
      <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0 }}>
      <div className="grid grid-2">
        {frames.map((frame) => {
          const color = colorByFrame[frame.id] || '';
          const variant = frame.variants.find((v) => v.color === color) || frame.variants[0];
          const isSelected = selectedFrameName === frame.name && selectedColor === color;
          return (
            <div className="product-choice" key={frame.id}>
              <div className="product-img">{variant?.image ? <img src={variant.image} alt={frame.name} referrerPolicy="no-referrer" /> : null}</div>
              <div>
                <strong>{frame.name}</strong>
                <div className="helper">{frame.kind}</div>
                <select
                  value={color}
                  onChange={(e) => setColorByFrame((prev) => ({ ...prev, [frame.id]: e.target.value }))}
                  style={{ marginTop: 8 }}
                >
                  {frame.variants.map((v) => (
                    <option key={v.color} value={v.color} disabled={!v.qty}>{v.color}{!v.qty ? ' (indisponível)' : ''}</option>
                  ))}
                </select>
              </div>
              <button className="button primary" type="button" disabled={savingId === frame.id || !variant?.qty} onClick={() => select(frame.id)}>
                {isSelected ? 'Selecionada' : savingId === frame.id ? 'Salvando…' : 'Selecionar'}
              </button>
            </div>
          );
        })}
      </div>
      </fieldset>
      {message && <p className="form-message error">{message}</p>}
      <p className="helper">O valor do conjunto, incluindo as lentes, será informado pelo optometrista no orçamento.</p>
    </div>
  );
}
