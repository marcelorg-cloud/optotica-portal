'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { formatCpfCnpj, onlyDigits } from '@/lib/br-documents';

// A ferramenta de medição usa câmera/canvas e carrega bibliotecas pesadas de
// visão computacional (MediaPipe/OpenCV) só quando é aberta — por isso é
// importada sob demanda (ssr:false) e nunca faz parte do bundle principal
// desta etapa.
const DnpPhotoTool = dynamic(() => import('./dnp-photo-tool').then((m) => m.DnpPhotoTool), { ssr: false });

export function ClientStep({
  orderId, clientName, whatsapp, initialDnpOd, initialDnpOe, initialDnpPhotoUrl, initialBirthDate, initialCpf, frameName, locked
}: {
  orderId: string;
  clientName: string;
  whatsapp: string;
  initialDnpOd: string;
  initialDnpOe: string;
  initialDnpPhotoUrl: string | null;
  initialBirthDate: string;
  initialCpf: string;
  frameName: string;
  locked: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [message, setMessage] = useState('');
  const [toolOpen, setToolOpen] = useState(false);
  const [dnpOd, setDnpOd] = useState(initialDnpOd);
  const [dnpOe, setDnpOe] = useState(initialDnpOe);
  const [dnpPhotoUrl, setDnpPhotoUrl] = useState(initialDnpPhotoUrl);
  const [birthDate, setBirthDate] = useState(initialBirthDate);
  const [cpf, setCpf] = useState(formatCpfCnpj(initialCpf));

  function onMeasured(odMm: number, oeMm: number, photoUrl: string | null) {
    setDnpOd(String(odMm));
    setDnpOe(String(oeMm));
    if (photoUrl) setDnpPhotoUrl(photoUrl);
    setToolOpen(false);
    setState('success');
    setMessage('DNP calculada e salva a partir da foto.');
    router.refresh();
  }

  async function submit() {
    if (!formRef.current) return;
    setState('loading');
    setMessage('');
    const form = new FormData(formRef.current);
    const response = await fetch(`/api/professional/orders/${orderId}/client`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dnpOd: form.get('dnpOd'), dnpOe: form.get('dnpOe'),
        birthDate: form.get('birthDate'), cpf: onlyDigits(String(form.get('cpf') || ''))
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setState('success'); setMessage('Dados atualizados.'); router.refresh(); }
    else { setState('error'); setMessage(payload.message || 'Não foi possível salvar.'); }
  }

  return (
    <form className="stack" ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="summary-grid">
        <div className="stat"><span>Paciente</span><strong>{clientName}</strong></div>
        <div className="stat"><span>WhatsApp</span><strong>{whatsapp}</strong></div>
        <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0, display: 'contents' }}>
          <div className="field"><label>Data de nascimento</label><input name="birthDate" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></div>
          <div className="field"><label>CPF</label><input name="cpf" type="text" inputMode="numeric" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(formatCpfCnpj(e.target.value))} maxLength={14} /></div>
          <div className="field"><label>DNP OD (mm)</label><input name="dnpOd" type="number" step="0.5" min="10" max="45" value={dnpOd} onChange={(e) => setDnpOd(e.target.value)} /></div>
          <div className="field"><label>DNP OE (mm)</label><input name="dnpOe" type="number" step="0.5" min="10" max="45" value={dnpOe} onChange={(e) => setDnpOe(e.target.value)} /></div>
        </fieldset>
        <div className="stat"><span>Armação</span><strong>{frameName || 'Ainda não escolhida'}</strong></div>
      </div>
      {!locked && (
        <div className="actions">
          <button className="button secondary" type="button" onClick={() => setToolOpen(true)}>📷 {dnpPhotoUrl ? 'Medir novamente com foto' : 'Medir com foto'}</button>
        </div>
      )}
      {dnpPhotoUrl ? (
        <div className="field">
          <label>Foto para DNP</label>
          {/* eslint-disable-next-line @next/next/no-img-element -- foto assinada do Storage, não passa pelo otimizador de imagens do Next */}
          <img className="dnp-client-photo" src={dnpPhotoUrl} alt="Foto usada para medir a DNP, com os pontos marcados" />
        </div>
      ) : (
        <div className="photo-box">Foto para DNP ainda não registrada — use &quot;Medir com foto&quot; acima.</div>
      )}
      {!locked && (
        <div className="actions">
          <button className="button primary" type="submit" disabled={state === 'loading'}>{state === 'loading' ? 'Salvando…' : 'Salvar dados'}</button>
        </div>
      )}
      {locked && <p className="notice">🔒 Dados do paciente bloqueados — Comanda final já confirmada.</p>}
      {message && (state === 'error' ? <p className="form-message error">{message}</p> : state === 'success' ? <p className="form-message success">{message}</p> : null)}
      {toolOpen && !locked && (
        <DnpPhotoTool orderId={orderId} onSaved={onMeasured} onClose={() => setToolOpen(false)} />
      )}
    </form>
  );
}
