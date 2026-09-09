'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = [
  { value: 'aguardando', label: 'Aguardando' },
  { value: 'em_montagem', label: 'Em montagem' },
  { value: 'em_conferencia', label: 'Em conferência' },
  { value: 'concluida', label: 'Concluída' }
];

export function AssemblyStep({ orderId, initialFrameReceived, initialLensReceived, initialStatus, initialNotes }: {
  orderId: string; initialFrameReceived: boolean; initialLensReceived: boolean; initialStatus: string; initialNotes: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit() {
    if (!formRef.current) return;
    setState('loading');
    setMessage('');
    const form = new FormData(formRef.current);
    const response = await fetch(`/api/professional/orders/${orderId}/fulfillment`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section: 'montagem',
        data: {
          frameReceivedCheck: form.get('frameReceived') === 'sim',
          lensReceivedCheck: form.get('lensReceived') === 'sim',
          assemblyStatus: form.get('status'), assemblyNotes: form.get('notes')
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setState('idle'); router.refresh(); }
    else { setState('error'); setMessage(payload.message || 'Não foi possível salvar.'); }
  }

  return (
    <form className="stack" ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid grid-3">
        <div className="field"><label>Armação recebida</label>
          <select name="frameReceived" defaultValue={initialFrameReceived ? 'sim' : 'nao'}><option value="nao">Não</option><option value="sim">Sim</option></select>
        </div>
        <div className="field"><label>Lentes recebidas</label>
          <select name="lensReceived" defaultValue={initialLensReceived ? 'sim' : 'nao'}><option value="nao">Não</option><option value="sim">Sim</option></select>
        </div>
        <div className="field"><label>Status da montagem</label>
          <select name="status" defaultValue={initialStatus}>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </div>
      </div>
      <div className="field"><label>Conferência final</label>
        <textarea name="notes" rows={3} maxLength={500} defaultValue={initialNotes} placeholder="Conferência de grau, eixo, DNP, altura, acabamento e integridade da armação..." />
      </div>
      <div className="actions"><button className="button primary" type="submit" disabled={state === 'loading'}>{state === 'loading' ? 'Salvando…' : 'Salvar montagem'}</button></div>
      {message && state === 'error' && <p className="form-message error">{message}</p>}
    </form>
  );
}
