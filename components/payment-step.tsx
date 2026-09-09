'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const METHODS: Array<{ value: string; label: string }> = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'Pix' },
  { value: 'link', label: 'Link de pagamento' },
  { value: 'maquina', label: 'Máquina de cartão' }
];

export function PaymentStep({ orderId, initialValue, initialMethod, confirmed }: {
  orderId: string;
  initialValue: string;
  initialMethod: string;
  confirmed: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(confirm: boolean) {
    if (!formRef.current) return;
    setState('loading');
    setMessage('');
    const form = new FormData(formRef.current);
    const response = await fetch(`/api/professional/orders/${orderId}/fulfillment`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'pagamento', data: { paymentValue: form.get('value'), paymentMethod: form.get('method'), confirm } })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setState('idle'); router.refresh(); }
    else { setState('error'); setMessage(payload.message || 'Não foi possível salvar.'); }
  }

  return (
    <form className="stack" ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <div className="grid grid-2">
        <div className="field">
          <label className="required">Valor final da venda</label>
          <div className="money"><input name="value" type="number" step="0.01" min="0" placeholder="0,00" defaultValue={initialValue} /></div>
          <div className="helper">O valor final apresentado ao cliente.</div>
        </div>
        <div className="field">
          <label>Forma de pagamento</label>
          <div className="choice-row">
            {METHODS.map((m) => (
              <label className="choice" key={m.value}>
                <input type="radio" name="method" value={m.value} defaultChecked={initialMethod === m.value || (!initialMethod && m.value === 'dinheiro')} />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="actions">
        <button className="button success" type="button" disabled={state === 'loading'} onClick={() => submit(true)}>
          {confirmed ? 'Pagamento confirmado ✓' : 'Confirmar pagamento'}
        </button>
      </div>
      {message && state === 'error' && <p className="form-message error">{message}</p>}
    </form>
  );
}
