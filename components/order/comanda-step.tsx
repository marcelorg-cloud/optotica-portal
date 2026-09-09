'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ComandaStep({ orderId, clientName, dnp, lensDescription, laboratory, frameName, initial, confirmed }: {
  orderId: string;
  clientName: string;
  dnp: string;
  lensDescription: string;
  laboratory: string;
  frameName: string;
  initial: { heightOd: string; heightOe: string; bridge: string; diagonal: string; notes: string };
  confirmed: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  // Atualização otimista do rótulo "confirmado": muda na hora, sem esperar o
  // refresh da página inteira — o refresh continua acontecendo em segundo
  // plano pra manter o resto da página sincronizado. Não muda a lógica de
  // confirmação em si, só a velocidade percebida.
  const [localConfirmed, setLocalConfirmed] = useState(confirmed);
  const [prevConfirmed, setPrevConfirmed] = useState(confirmed);
  // Ressincroniza com o servidor quando o pai re-renderiza com um valor novo —
  // ajuste de estado durante o render, não em efeito (recomendado pelos docs
  // do React), evita o encadeamento de re-renders que o efeito causaria.
  if (confirmed !== prevConfirmed) {
    setPrevConfirmed(confirmed);
    setLocalConfirmed(confirmed);
  }

  async function save(confirm: boolean) {
    if (!formRef.current) return;
    setState('loading');
    setMessage('');
    const form = new FormData(formRef.current);
    const response = await fetch(`/api/professional/orders/${orderId}/fulfillment`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section: 'comanda',
        data: {
          measureHeightOd: form.get('heightOd'), measureHeightOe: form.get('heightOe'),
          measureBridge: form.get('bridge'), measureDiagonal: form.get('diagonal'),
          finalLabNotes: form.get('notes'), confirm
        }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      setState('idle');
      if (confirm) setLocalConfirmed(true);
      router.refresh();
    } else {
      setState('error');
      setMessage(payload.message || 'Não foi possível salvar.');
    }
  }

  return (
    <form className="stack" ref={formRef} onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <div className="grid grid-3">
        <div className="subsection"><h3>Paciente</h3>
          <div className="summary-row"><span>Nome</span><strong>{clientName}</strong></div>
          <div className="summary-row"><span>DNP</span><strong>{dnp}</strong></div>
        </div>
        <div className="subsection"><h3>Lente</h3>
          <div className="summary-row"><span>Tipo</span><strong>{lensDescription || 'Não definida'}</strong></div>
          <div className="summary-row"><span>Laboratório</span><strong>{laboratory || 'Não definido'}</strong></div>
        </div>
        <div className="subsection"><h3>Armação</h3>
          <div className="summary-row"><span>Modelo</span><strong>{frameName || 'Não definida'}</strong></div>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="field"><label>Altura OD (mm)</label><input name="heightOd" type="number" step="0.5" min="0" max="60" defaultValue={initial.heightOd} /></div>
        <div className="field"><label>Altura OE (mm)</label><input name="heightOe" type="number" step="0.5" min="0" max="60" defaultValue={initial.heightOe} /></div>
        <div className="field"><label>Ponte (mm)</label><input name="bridge" type="number" step="0.5" min="0" max="60" defaultValue={initial.bridge} /></div>
        <div className="field"><label>Diagonal maior (mm)</label><input name="diagonal" type="number" step="0.5" min="0" max="80" defaultValue={initial.diagonal} /></div>
      </div>

      <div className="field">
        <label>Observações laboratoriais finais</label>
        <textarea name="notes" rows={3} maxLength={500} defaultValue={initial.notes} placeholder="Montagem, acabamento, conferência e instruções especiais..." />
      </div>

      <div className="actions">
        <button className="button secondary" type="submit" disabled={state === 'loading'}>Salvar rascunho</button>
        <button className="button primary" type="button" disabled={state === 'loading'} onClick={() => save(true)}>
          {localConfirmed ? 'Comanda confirmada ✓' : 'Confirmar comanda final'}
        </button>
      </div>
      {message && state === 'error' && <p className="form-message error">{message}</p>}
    </form>
  );
}
