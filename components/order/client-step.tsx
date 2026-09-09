'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ClientStep({ orderId, clientName, whatsapp, initialDnpOd, initialDnpOe, frameName, locked }: {
  orderId: string;
  clientName: string;
  whatsapp: string;
  initialDnpOd: string;
  initialDnpOe: string;
  frameName: string;
  locked: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [message, setMessage] = useState('');

  async function submit() {
    if (!formRef.current) return;
    setState('loading');
    setMessage('');
    const form = new FormData(formRef.current);
    const response = await fetch(`/api/professional/orders/${orderId}/client`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dnpOd: form.get('dnpOd'), dnpOe: form.get('dnpOe') })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setState('success'); setMessage('DNP atualizada.'); router.refresh(); }
    else { setState('error'); setMessage(payload.message || 'Não foi possível salvar.'); }
  }

  return (
    <form className="stack" ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="summary-grid">
        <div className="stat"><span>Paciente</span><strong>{clientName}</strong></div>
        <div className="stat"><span>WhatsApp</span><strong>{whatsapp}</strong></div>
        <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0, display: 'contents' }}>
          <div className="field"><label>DNP OD (mm)</label><input name="dnpOd" type="number" step="0.5" min="10" max="45" defaultValue={initialDnpOd} /></div>
          <div className="field"><label>DNP OE (mm)</label><input name="dnpOe" type="number" step="0.5" min="10" max="45" defaultValue={initialDnpOe} /></div>
        </fieldset>
        <div className="stat"><span>Armação</span><strong>{frameName || 'Ainda não escolhida'}</strong></div>
      </div>
      <div className="photo-box">Foto de prova online ainda não disponível nesta versão.</div>
      {!locked && (
        <div className="actions">
          <button className="button primary" type="submit" disabled={state === 'loading'}>{state === 'loading' ? 'Salvando…' : 'Salvar DNP'}</button>
        </div>
      )}
      {locked && <p className="notice">🔒 DNP bloqueada — Comanda final já confirmada.</p>}
      {message && (state === 'error' ? <p className="form-message error">{message}</p> : state === 'success' ? <p className="form-message success">{message}</p> : null)}
    </form>
  );
}
