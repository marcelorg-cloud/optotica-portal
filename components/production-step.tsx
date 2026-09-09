'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const FRAME_STATUSES = [
  { value: 'aguardando_pedido', label: 'Aguardando pedido' },
  { value: 'pedido_realizado', label: 'Pedido realizado' },
  { value: 'confirmado_fornecedor', label: 'Confirmado pelo fornecedor' },
  { value: 'indisponivel', label: 'Indisponível' }
];
const LENS_STATUSES = [
  { value: 'aguardando_envio', label: 'Aguardando envio' },
  { value: 'enviado_laboratorio', label: 'Enviado ao laboratório' },
  { value: 'confirmado_laboratorio', label: 'Confirmado pelo laboratório' },
  { value: 'em_producao', label: 'Em produção' },
  { value: 'pronta', label: 'Pronta' }
];

export function ProductionStep({ orderId, initialFrameStatus, initialFrameRef, initialLensStatus, initialLensRef }: {
  orderId: string; initialFrameStatus: string; initialFrameRef: string; initialLensStatus: string; initialLensRef: string;
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
        section: 'producao',
        data: {
          frameProductionStatus: form.get('frameStatus'), frameSupplierReference: form.get('frameRef'),
          lensProductionStatus: form.get('lensStatus'), lensLabReference: form.get('lensRef')
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setState('idle'); router.refresh(); }
    else { setState('error'); setMessage(payload.message || 'Não foi possível salvar.'); }
  }

  return (
    <form className="stack" ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid grid-2">
        <div className="subsection">
          <h3>Pedido da armação</h3>
          <div className="field"><label>Status</label>
            <select name="frameStatus" defaultValue={initialFrameStatus}>
              {FRAME_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ height: 10 }} />
          <div className="field"><label>Nº pedido fornecedor</label><input name="frameRef" defaultValue={initialFrameRef} maxLength={120} placeholder="Código / referência" /></div>
        </div>
        <div className="subsection">
          <h3>Produção da lente</h3>
          <div className="field"><label>Status</label>
            <select name="lensStatus" defaultValue={initialLensStatus}>
              {LENS_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ height: 10 }} />
          <div className="field"><label>Nº OS do laboratório</label><input name="lensRef" defaultValue={initialLensRef} maxLength={120} placeholder="Código / referência" /></div>
        </div>
      </div>
      <div className="actions"><button className="button primary" type="submit" disabled={state === 'loading'}>{state === 'loading' ? 'Salvando…' : 'Salvar status de produção'}</button></div>
      {message && state === 'error' && <p className="form-message error">{message}</p>}
    </form>
  );
}
