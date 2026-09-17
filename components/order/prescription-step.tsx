'use client';

import { useProcessingFeedback } from '@/components/processing-feedback';

import { PrescriptionNumberInput } from '@/components/prescription-number-input';
import { PrescriptionPreview } from '@/components/prescription-preview';
import { normalizePrescriptionNumber } from '@/lib/prescription-format';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type EyeRx = { esferico: string; cilindrico: string; eixo: string; adicao: string };

function RxRow({ eye, label, value, onValueChange }: { eye: 'od' | 'oe'; label: string; value: EyeRx; onValueChange: () => void }) {
  return (
    <tr>
      <th>{label}</th>
      <td><PrescriptionNumberInput name={`${eye}-esferico`} label={`Esférico ${label}`} initialValue={value.esferico} kind="sphere" onValueChange={onValueChange} /></td>
      <td><PrescriptionNumberInput name={`${eye}-cilindrico`} label={`Cilíndrico ${label}`} initialValue={value.cilindrico} kind="cylinder" onValueChange={onValueChange} /></td>
      <td><PrescriptionNumberInput name={`${eye}-eixo`} label={`Eixo ${label}`} initialValue={value.eixo} kind="axis" onValueChange={onValueChange} /></td>
      <td><PrescriptionNumberInput name={`${eye}-adicao`} label={`Adição ${label}`} initialValue={value.adicao} kind="addition" onValueChange={onValueChange} /></td>
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
export function PrescriptionStep({ orderId, initialOd, initialOe, initialObservations = '', locked }: {
  orderId: string;
  initialOd: EyeRx | null;
  initialOe: EyeRx | null;
  locked: boolean;
  initialObservations?: string;
}) {
  const router = useRouter();
  const [rxState, setRxState] = useState<'idle' | 'loading' | 'error'>('idle');
  useProcessingFeedback(rxState === 'loading', 'Salvando prescrição…');
  const [rxMessage, setRxMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  useProcessingFeedback(issuing, 'Emitindo prescrição…');
  const [dirty, setDirty] = useState(false);
  async function issue() {
    if (issuing) return;
    setIssuing(true); setRxMessage('');
    try {
      const response = await fetch(`/api/professional/orders/${orderId}/prescription/issue`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Não foi possível emitir.');
      if (typeof payload.url !== 'string' || !/^\/prescricao\/[a-f0-9-]+$/i.test(payload.url)) throw new Error('Documento indisponível. Tente novamente.');
      setPreviewUrl(payload.url);
    } catch (error) { setRxMessage(error instanceof Error ? error.message : 'Não foi possível emitir.'); }
    finally { setIssuing(false); }
  }

  async function submitRx(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setRxState('loading');
    setRxMessage('');
    const form = new FormData(event.currentTarget);
    const eye = (prefix: string) => ({
      esferico: normalizePrescriptionNumber(form.get(`${prefix}-esferico`)), cilindrico: normalizePrescriptionNumber(form.get(`${prefix}-cilindrico`)),
      eixo: form.get(`${prefix}-eixo`), adicao: normalizePrescriptionNumber(form.get(`${prefix}-adicao`))
    });
    try {
    const response = await fetch(`/api/professional/orders/${orderId}/prescription`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ od: eye('od'), oe: eye('oe'), observations: form.get('observations') })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setDirty(false); setRxState('idle'); setRxMessage('Receita salva. Você já pode emitir o documento.'); router.refresh(); }
    else { setRxState('error'); setRxMessage(payload.message || 'Não foi possível salvar a receita.'); }
    } catch { setRxState('error'); setRxMessage('Não foi possível salvar. Confira sua conexão e tente novamente.'); }
  }

  return (
    <div className="stack">
      {previewUrl && <PrescriptionPreview key={previewUrl} url={previewUrl} onClose={() => setPreviewUrl(null)} />}
      {locked && <div className="notice">🔒 Etapa bloqueada — Comanda final já confirmada.</div>}
      <form className="subsection prescription-editor" onSubmit={submitRx} onChange={() => setDirty(true)}>
        <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
        <h3>Receita</h3>
        <div className="rx-scroll">
          <table className="rx-table rx-table-compact">
            <thead><tr><th scope="col"></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>Adição</th></tr></thead>
            <tbody>
              <RxRow eye="od" label="OD" value={initialOd || EMPTY_EYE} onValueChange={() => setDirty(true)} />
              <RxRow eye="oe" label="OE" value={initialOe || EMPTY_EYE} onValueChange={() => setDirty(true)} />
            </tbody>
          </table>
        </div>
        <div className="prescription-notes-field">
          <label htmlFor={`prescription-observations-${orderId}`}>
            <span>Observações da prescrição</span>
            <small>Estas orientações constarão no documento do paciente.</small>
          </label>
          <textarea id={`prescription-observations-${orderId}`} name="observations" maxLength={1000} rows={4} defaultValue={initialObservations} placeholder="Digite orientações importantes para o paciente" />
        </div>
        <div className="actions">
          <button className="button primary" type="submit" disabled={rxState === 'loading'}>{rxState === 'loading' ? 'Salvando…' : 'Salvar receita'}</button>
        </div>

        </fieldset>
      </form>
      <div className="subsection"><h3>Documento com verificação</h3><p className="muted">Salve as alterações antes de emitir. A emissão usa os dados salvos, mantém o histórico e substitui a versão anterior quando houver mudanças.</p><button className="button secondary" type="button" disabled={dirty || issuing || rxState === 'loading' || !initialOd || !initialOe} onClick={issue}>{issuing ? 'Emitindo…' : 'Emitir / abrir prescrição com QR Code'}</button><p className="fine-print">Disponível para cadastro individual de profissional aprovado.</p></div>
      {rxMessage && <p role="status">{rxMessage}</p>}
    </div>
  );
}
