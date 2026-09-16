'use client';

import { useProcessingFeedback } from '@/components/processing-feedback';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type PatientFrameChoice = { id: string; productId: string; modelName: string; colorName: string; imageUrl: string | null };

export function ClientFrameStep({ orderId, choices, selectedColorId, selectedFrameName, selectedColor, locked }: {
  orderId: string; choices: PatientFrameChoice[]; selectedColorId: string | null;
  selectedFrameName: string | null; selectedColor: string | null; locked: boolean;
}) {
  const router = useRouter();
  const [savingId, setSavingId] = useState<string | null>(null);
  useProcessingFeedback(savingId !== null, 'Salvando armação selecionada…');
  const [message, setMessage] = useState('');
  async function select(colorId: string) {
    if (locked || savingId || selectedColorId === colorId) return;
    setSavingId(colorId);
    setMessage('');
    try {
      const response = await fetch(`/api/client/orders/${orderId}/frame`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogColorImageId: colorId })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) router.refresh();
      else setMessage(payload.message || 'Não foi possível registrar a armação.');
    } catch { setMessage('Falha de conexão. Tente novamente.'); }
    finally { setSavingId(null); }
  }
  return <div className="stack">
    {selectedFrameName && <div className="notice">Sua escolha: <strong>{selectedFrameName}</strong> · {selectedColor}</div>}
    {locked && <div className="notice">Escolhas encerradas. Fale com seu profissional se precisar de ajuda.</div>}
    {!locked && <a className="button secondary" href="#armacao">Experimentar com minha foto</a>}
    {!choices.length && <p className="helper">Nenhuma armação disponível para novas escolhas no momento.</p>}
    <div className="grid grid-2">
      {choices.map((choice) => <div className="product-choice" key={choice.id}>
        <div className="product-img">{choice.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={choice.imageUrl} alt={`${choice.modelName} — ${choice.colorName}`} />
        )}</div>
        <div><strong>{choice.modelName}</strong><p className="helper">{choice.colorName}</p></div>
        <button className="button primary" type="button" disabled={locked || savingId !== null || selectedColorId === choice.id} onClick={() => select(choice.id)}>
          {selectedColorId === choice.id ? 'Selecionada' : savingId === choice.id ? 'Salvando…' : 'Escolher esta cor'}
        </button>
      </div>)}
    </div>
    {message && <p className="form-message error" role="alert">{message}</p>}
    <p className="helper">Confira os valores com seu profissional antes da confirmação do pedido.</p>
  </div>;
}
