'use client';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useProcessingFeedback } from '@/components/processing-feedback';
import { useRouter } from 'next/navigation';
export function VerificationForm({ endpoint, children, buttonLabel }: { endpoint: string; children: ReactNode; buttonLabel: string }) {
  const router = useRouter();
  const [busy,setBusy] = useState(false);
  const [saved,setSaved] = useState(false);
  const [message,setMessage] = useState('');
  const [failed,setFailed] = useState(false);
  const messageRef = useRef<HTMLDivElement>(null);
  const review = endpoint.startsWith('/api/admin/verification/');
  useProcessingFeedback(busy, review ? 'Salvando decisão documental…' : 'Enviando documentação…');
  function showMessage(text: string, isError: boolean) {
    setMessage(text); setFailed(isError);
    requestAnimationFrame(() => {
      messageRef.current?.focus({ preventScroll: true });
      messageRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy || saved) return;
    const body = new FormData(form);
    if (endpoint === '/api/professional/verification' && (body.get('termsRead') !== 'yes' || body.get('acceptedTerms') !== 'yes' || body.get('publicDocumentsConsent') !== 'yes')) {
      showMessage('Leia os termos até o final e marque os aceites antes de enviar.', true); return;
    }
    setBusy(true); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'POST', body });
      const data = await response.json().catch(() => null);
      if (response.ok && (!data || typeof data.message !== 'string')) {
        showMessage('O servidor não retornou a confirmação. Atualize a página para consultar o status antes de tentar novamente.', true);
        return;
      }
      showMessage(data?.message || (response.ok ? 'Dados enviados.' : response.status === 413 ? 'Os arquivos ultrapassaram o limite de envio. Cada PDF deve ter até 1 MB.' : 'Não foi possível salvar. Os dados preenchidos foram mantidos para tentar novamente.'), !response.ok);
      if (response.ok) { setSaved(true); if (!review) form.reset(); router.refresh(); }
    } catch { showMessage('Não foi possível salvar. Confira sua conexão e tente novamente; a confirmação ainda não foi recebida.', true); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="stack"><div ref={messageRef} tabIndex={-1} role={failed ? 'alert' : 'status'} className={message ? `verification-result ${failed ? 'is-error' : 'is-success'}` : undefined}>{message}</div><fieldset disabled={busy || saved} className="verification-files" style={{ border: 0, padding: 0, margin: 0 }}>{children}<button className="button primary" type="submit">{saved ? 'Salvo' : busy ? (review ? 'Salvando…' : 'Enviando…') : buttonLabel}</button></fieldset></form>;
}
