'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
export function VerificationForm({ endpoint, children, buttonLabel }: { endpoint: string; children: ReactNode; buttonLabel: string }) {
  const router = useRouter();
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'POST', body: new FormData(form) });
      const data = await response.json();
      setMessage(data.message || (response.ok ? 'Dados enviados.' : 'Não foi possível enviar.'));
      if (response.ok) { form.reset(); router.refresh(); }
    } catch { setMessage('Não foi possível enviar. Confira sua conexão e tente novamente.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="stack"><fieldset disabled={busy} className="verification-files" style={{ border: 0, padding: 0, margin: 0 }}>{children}<button className="button primary" type="submit">{busy ? 'Enviando…' : buttonLabel}</button></fieldset><p role="status">{message}</p></form>;
}
