'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type EyeRx = { esferico: string; cilindrico: string; eixo: string; adicao: string };

function RxRow({ eye, label, value }: { eye: 'od' | 'oe'; label: string; value: EyeRx }) {
  return (
    <tr>
      <th>{label}</th>
      <td><input name={`${eye}-esferico`} type="number" step="0.25" min="-30" max="30" placeholder="+0,00" defaultValue={value.esferico} required /></td>
      <td><input name={`${eye}-cilindrico`} type="number" step="0.25" min="-30" max="30" placeholder="-0,00" defaultValue={value.cilindrico} required /></td>
      <td><input name={`${eye}-eixo`} type="number" step="1" min="0" max="180" placeholder="0°" defaultValue={value.eixo} required /></td>
      <td><input name={`${eye}-adicao`} type="number" step="0.25" min="0" max="6" placeholder="+0,00" defaultValue={value.adicao} required /></td>
    </tr>
  );
}

const EMPTY_EYE: EyeRx = { esferico: '0', cilindrico: '0', eixo: '0', adicao: '0' };

// Etapa 2 "Prescrição optométrica" (16/09/2026) — antes fazia parte da mesma
// etapa "OS / Orçamento" que também continha o cardápio de lentes e os
// orçamentos (ver components/order/os-step.tsx, agora renomeado pra
// SuggestedLensesStep). Pedido do usuário: separar em duas etapas próprias
// — esta cuida só da receita (OD/OE); a etapa seguinte ("Lentes sugeridas")
// ficou com tudo relacionado a orçamento. Nenhuma rota de API mudou —
// `/api/professional/orders/[orderId]/prescription` já salvava só a receita,
// separado de `/quotes` — a separação sempre existiu no backend, só não na
// tela.
export function PrescriptionStep({ orderId, initialOd, initialOe, locked }: {
  orderId: string;
  initialOd: EyeRx | null;
  initialOe: EyeRx | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [rxState, setRxState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [rxMessage, setRxMessage] = useState('');

  async function submitRx(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setRxState('loading');
    setRxMessage('');
    const form = new FormData(event.currentTarget);
    const eye = (prefix: string) => ({
      esferico: form.get(`${prefix}-esferico`), cilindrico: form.get(`${prefix}-cilindrico`),
      eixo: form.get(`${prefix}-eixo`), adicao: form.get(`${prefix}-adicao`)
    });
    const response = await fetch(`/api/professional/orders/${orderId}/prescription`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ od: eye('od'), oe: eye('oe') })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setRxState('idle'); router.refresh(); }
    else { setRxState('error'); setRxMessage(payload.message || 'Não foi possível salvar a receita.'); }
  }

  return (
    <div className="stack">
      {locked && <div className="notice">🔒 Etapa bloqueada — Comanda final já confirmada.</div>}
      <form className="subsection" onSubmit={submitRx}>
        <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0 }}>
        <h3>Receita</h3>
        <div className="rx-scroll">
          <table className="rx-table">
            <thead><tr><th></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>Adição</th></tr></thead>
            <tbody>
              <RxRow eye="od" label="OD" value={initialOd || EMPTY_EYE} />
              <RxRow eye="oe" label="OE" value={initialOe || EMPTY_EYE} />
            </tbody>
          </table>
        </div>
        <div className="actions">
          <button className="button primary" type="submit" disabled={rxState === 'loading'}>{rxState === 'loading' ? 'Salvando…' : 'Salvar receita'}</button>
        </div>
        {rxMessage && rxState === 'error' && <p className="form-message error">{rxMessage}</p>}
        </fieldset>
      </form>
    </div>
  );
}
