'use client';

import { useProcessingFeedback } from '@/components/processing-feedback';

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
  orderId, clientName, whatsapp, initialDnpOd, initialDnpOe, initialDnpPhotoUrl, initialBirthDate, initialCpf, frameName, locked,
  initialFacePhotoStatus, initialFacePhotoUrl
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
  initialFacePhotoStatus: 'pendente' | 'validada' | null;
  initialFacePhotoUrl: string | null;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  useProcessingFeedback(state === 'loading', 'Salvando dados do paciente…');
  const [message, setMessage] = useState('');
  const [toolOpen, setToolOpen] = useState(false);
  const [dnpOd, setDnpOd] = useState(initialDnpOd);
  const [dnpOe, setDnpOe] = useState(initialDnpOe);
  const [dnpPhotoUrl, setDnpPhotoUrl] = useState(initialDnpPhotoUrl);
  const [birthDate, setBirthDate] = useState(initialBirthDate);
  const [cpf, setCpf] = useState(formatCpfCnpj(initialCpf));

  // "Foto de rosto para Prova Online" (15/09/2026) — separada da foto de
  // DNP acima (pedido explícito do usuário). `facePhotoStatus` null = ainda
  // nenhuma foto enviada nesta ficha; 'pendente' = já processada por IA,
  // aguardando o profissional validar; 'validada' = já é a foto oficial de
  // prova online do paciente (pode ter vindo de um atendimento anterior).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [facePhotoStatus, setFacePhotoStatus] = useState(initialFacePhotoStatus);
  const [facePhotoUrl, setFacePhotoUrl] = useState(initialFacePhotoUrl);
  const [faceBusy, setFaceBusy] = useState<'idle' | 'uploading' | 'validating'>('idle');
  useProcessingFeedback(faceBusy !== 'idle', 'Preparando foto do paciente…');
  const [faceMessage, setFaceMessage] = useState('');
  const [faceMessageKind, setFaceMessageKind] = useState<'success' | 'error' | ''>('');

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
    if (response.ok) { setState('success'); setMessage(payload.message || 'Dados atualizados.'); router.refresh(); }
    else { setState('error'); setMessage(payload.message || 'Não foi possível salvar.'); }
  }

  async function onFacePhotoSelected(file: File | undefined | null) {
    if (!file) return;
    setFaceBusy('uploading');
    setFaceMessage('Processando com IA — pode levar alguns segundos…');
    setFaceMessageKind('');
    const form = new FormData();
    form.append('photo', file);
    const response = await fetch(`/api/professional/orders/${orderId}/client/face-photo`, { method: 'POST', body: form });
    const payload = await response.json().catch(() => ({}));
    setFaceBusy('idle');
    if (response.ok) {
      setFacePhotoStatus('pendente');
      setFacePhotoUrl(payload.processedUrl || null);
      setFaceMessage(payload.message || 'Foto processada — confira e valide abaixo.');
      setFaceMessageKind('success');
    } else {
      // 15/09/2026: quando a API manda "detail" (erro real do Supabase),
      // mostra junto — evita depender dos logs da Vercel para descobrir a
      // causa (ex.: bucket ainda não criado no painel do Supabase).
      const detail = payload.detail ? ` (${payload.detail})` : '';
      setFaceMessage((payload.message || 'Não foi possível processar a foto.') + detail);
      setFaceMessageKind('error');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  }

  async function validateFacePhoto() {
    setFaceBusy('validating');
    setFaceMessage('');
    setFaceMessageKind('');
    const response = await fetch(`/api/professional/orders/${orderId}/client/face-photo`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'validar' })
    });
    const payload = await response.json().catch(() => ({}));
    setFaceBusy('idle');
    if (response.ok) {
      setFacePhotoStatus('validada');
      setFaceMessage(payload.message || 'Foto validada.');
      setFaceMessageKind('success');
    } else {
      const detail = payload.detail ? ` (${payload.detail})` : '';
      setFaceMessage((payload.message || 'Não foi possível validar a foto.') + detail);
      setFaceMessageKind('error');
    }
  }

  return (
    <form className="stack patient-step-form" ref={formRef} onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="summary-grid patient-data-grid">
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

      <section className="patient-photo-panel" aria-label="Fotos do atendimento">
        <div className="patient-photo-column">
          <p className="patient-photo-label">Foto para DNP</p>
          <div className="patient-photo-frame patient-photo-frame-dnp">
            {dnpPhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- foto assinada do Storage, não passa pelo otimizador de imagens do Next
              <img className="dnp-client-photo" src={dnpPhotoUrl} alt="Foto usada para medir a DNP, com os pontos marcados" />
            ) : (
              <span>Foto para DNP ainda não registrada</span>
            )}
          </div>
          {!locked && (
            <button className="button secondary" type="button" onClick={() => setToolOpen(true)}>📷 {dnpPhotoUrl ? 'Medir novamente com foto' : 'Medir com foto'}</button>
          )}
        </div>

        <div className="patient-photo-column">
          <p className="patient-photo-label">Foto para Prova Online</p>
          <div className="face-photo-preview patient-photo-frame">
            {facePhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- foto assinada do Storage, não passa pelo otimizador de imagens do Next
              <img src={facePhotoUrl} alt="Foto de rosto para prova online" />
            ) : (
              <span>Nenhuma foto de rosto enviada ainda</span>
            )}
          </div>
        </div>

        <div className="patient-photo-controls">
          <p className="helper">Use uma foto frontal. A IA neutraliza o fundo e equilibra a iluminação para a prova virtual.</p>
          {!locked && (
            <div className="patient-photo-actions">
              <button className="button secondary" type="button" disabled={faceBusy !== 'idle'} onClick={() => fileInputRef.current?.click()}>
                🖼️ {facePhotoUrl ? 'Trocar foto (escolher arquivo)' : 'Escolher arquivo'}
              </button>
              <button className="button secondary" type="button" disabled={faceBusy !== 'idle'} onClick={() => cameraInputRef.current?.click()}>
                📷 {facePhotoUrl ? 'Tirar outra foto' : 'Usar câmera'}
              </button>
              {facePhotoStatus === 'pendente' && (
                <button className="button primary" type="button" disabled={faceBusy !== 'idle'} onClick={validateFacePhoto}>
                  {faceBusy === 'validating' ? 'Validando…' : '✓ Validar foto'}
                </button>
              )}
              <input ref={fileInputRef} className="upload" type="file" accept="image/*" onChange={(e) => onFacePhotoSelected(e.target.files?.[0])} disabled={faceBusy !== 'idle'} />
              <input ref={cameraInputRef} className="upload" type="file" accept="image/*" capture="user" onChange={(e) => onFacePhotoSelected(e.target.files?.[0])} disabled={faceBusy !== 'idle'} />
            </div>
          )}
          <div className={`face-photo-status ${facePhotoStatus === 'validada' ? 'is-valid' : facePhotoStatus === 'pendente' ? 'is-pending' : ''}`} aria-live="polite">
            <strong>{facePhotoStatus === 'validada' ? 'Foto validada' : facePhotoStatus === 'pendente' ? 'Aguardando validação' : 'Foto não validada'}</strong>
            <span>{facePhotoStatus === 'validada' ? 'Oficial da Prova Online' : facePhotoStatus === 'pendente' ? 'Confira a imagem e valide' : 'Envie uma foto para continuar'}</span>
          </div>
        </div>
        {faceMessage && <p className={`form-message ${faceMessageKind} patient-photo-message`}>{faceMessage}</p>}
      </section>

      {!locked && (
        <div className="actions patient-save-actions">
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
