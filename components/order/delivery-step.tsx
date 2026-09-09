'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const DESTINATIONS = [
  { value: 'loja', label: 'Loja' },
  { value: 'optometrista', label: 'Optometrista' },
  { value: 'cliente_final', label: 'Cliente final' }
];

export function DeliveryStep({ orderId, initialDestination, initialDate, initialReceivedBy, initialNotes, confirmed }: {
  orderId: string; initialDestination: string; initialDate: string; initialReceivedBy: string; initialNotes: string; confirmed: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function save(confirm: boolean) {
    if (!formRef.current) return;
    setState('loading');
    setMessage('');
    const form = new FormData(formRef.current);
    const response = await fetch(`/api/professional/orders/${orderId}/fulfillment`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section: 'entrega',
        data: {
          deliveryDestination: form.get('destination'), deliveryDate: form.get('date'),
          deliveryReceivedBy: form.get('receivedBy'), deliveryNotes: form.get('notes'), confirm
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setState('idle'); router.refresh(); }
    else { setState('error'); setMessage(payload.message || 'Não foi possível salvar.'); }
  }

  return (
    <form className="stack" ref={formRef} onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div className="grid grid-3">
        <div className="field"><label>Destino</label>
          <select name="destination" defaultValue={initialDestination || 'loja'}>{DESTINATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select>
        </div>
        <div className="field"><label>Data de envio / retirada</label><input name="date" type="date" defaultValue={initialDate} /></div>
        <div className="field"><label>Recebido por</label><input name="receivedBy" defaultValue={initialReceivedBy} maxLength={120} placeholder="Nome do responsável" /></div>
      </div>
      <div className="field"><label>Confirmação de entrega ao cliente final</label>
        <textarea name="notes" rows={3} maxLength={500} defaultValue={initialNotes} placeholder="Data, responsável, observações e eventuais ajustes realizados na entrega..." />
      </div>
      <div className="actions">
        <button className="button secondary" type="submit" disabled={state === 'loading'}>Salvar rascunho</button>
        <button className="button success" type="button" disabled={state === 'loading'} onClick={() => save(true)}>
          {confirmed ? 'Atendimento finalizado ✓' : 'Finalizar atendimento'}
        </button>
      </div>
      {message && state === 'error' && <p className="form-message error">{message}</p>}
    </form>
  );
}
