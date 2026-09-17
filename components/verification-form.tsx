'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useProcessingFeedback } from '@/components/processing-feedback';
import { useRouter } from 'next/navigation';
export function VerificationForm({ endpoint, children, buttonLabel }: { endpoint: string; children: ReactNode; buttonLabel: string }) {
  const router = useRouter();
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  useProcessingFeedback(busy, 'Enviando documentação…');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy) return;
    const body = new FormData(form);
    if (endpoint === '/api/professional/verification' && (body.get('termsRead') !== 'yes' || body.get('acceptedTerms') !== 'yes' || body.get('publicDocumentsConsent') !== 'yes')) {
      setMessage('Leia os termos até o final e marque os aceites antes de enviar.'); return;
    }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'POST', body });
      const data = await response.json();
      setMessage(data.message || (response.ok ? 'Dados enviados.' : 'Não foi possível enviar.'));
      if (response.ok) { form.reset(); router.refresh(); }
    } catch { setMessage('Não foi possível enviar. Confira sua conexão e tente novamente.'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="stack"><fieldset disabled={busy} className="verification-files" style={{ border: 0, padding: 0, margin: 0 }}>{children}<button className="button primary" type="submit">{busy ? 'Enviando…' : buttonLabel}</button></fieldset><p role="status">{message}</p></form>;
}
