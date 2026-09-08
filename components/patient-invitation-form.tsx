'use client';

import { FormEvent, useState } from 'react';

export function PatientInvitationForm() {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [invitation, setInvitation] = useState<{ url: string; qr: string; expiresAt: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setState('loading');
    setMessage('');
    setInvitation(null);
    const form = new FormData(formElement);
    const response = await fetch('/api/professional/patient-invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: form.get('fullName'),
        whatsapp: form.get('whatsapp')
      })
    });
    const payload = await response.json().catch(() => ({}));
    setState(response.ok ? 'success' : 'error');
    setMessage(payload.message || (response.ok ? 'Convite criado.' : 'Não foi possível criar o convite.'));
    if (response.ok && payload.invitationUrl && payload.qrDataUrl) {
      setInvitation({ url: payload.invitationUrl, qr: payload.qrDataUrl, expiresAt: payload.expiresAt });
    }
    if (response.ok) formElement.reset();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="patient-name">Nome completo do paciente</label>
      <input id="patient-name" name="fullName" type="text" autoComplete="name" minLength={2} maxLength={120} required />
      <label htmlFor="patient-whatsapp">WhatsApp do paciente</label>
      <input id="patient-whatsapp" name="whatsapp" type="tel" autoComplete="tel" placeholder="(44) 99999-9999" required />
      <button className="button primary" disabled={state === 'loading'} type="submit">
        {state === 'loading' ? 'Criando…' : 'Gerar QR Code e link de 24 horas'}
      </button>
      {message && <p className={state === 'error' ? 'form-message error' : 'form-message success'} role="status">{message}</p>}
      {invitation && (
        <section className="invitation-result">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="qr" src={invitation.qr} alt="QR Code do convite de paciente" />
          <a className="button whatsapp" href={invitation.url} target="_blank" rel="noopener noreferrer">Abrir convite</a>
          <button className="button secondary" type="button" onClick={() => navigator.clipboard.writeText(invitation.url)}>Copiar link</button>
          <p className="fine-print">Válido até {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(invitation.expiresAt))}. O vínculo só será criado após o paciente enviar a mensagem no WhatsApp.</p>
        </section>
      )}
    </form>
  );
}
