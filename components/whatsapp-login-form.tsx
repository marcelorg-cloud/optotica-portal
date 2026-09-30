'use client';

import { FormEvent, useState } from 'react';

type Account = { key: string; label: string };

export function WhatsAppLoginForm() {
  const [phone, setPhone] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setMessage(''); setAccounts([]); setCode('');
    try {
      const response = await fetch('/api/auth/whatsapp/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Não foi possível enviar o código.');
      setChallengeId(payload.challengeId);
      setMessage(payload.message);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha de conexão.'); }
    finally { setBusy(false); }
  }

  async function verify(token: string, accountKey?: string) {
    if (!challengeId || (!accountKey && token.length !== 6)) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/auth/whatsapp/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, code: token, ...(accountKey ? { accountKey } : {}) })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Não foi possível confirmar o código.');
      if (payload.requiresAccount) {
        setAccounts(payload.accounts || []);
        setMessage('Código confirmado. Escolha qual área deseja acessar.');
        return;
      }
      if (payload.redirectTo) { window.location.assign(payload.redirectTo); return; }
      throw new Error('Resposta de acesso inválida.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Falha de conexão.'); }
    finally { setBusy(false); }
  }

  if (accounts.length) return <div className="stack">
    <p className="form-message success" role="status">{message}</p>
    {accounts.map(account => <button key={account.key} type="button" className="button primary" disabled={busy}
      onClick={() => void verify(code, account.key)}>{account.label}</button>)}
  </div>;

  if (challengeId) return <form className="stack" onSubmit={event => { event.preventDefault(); void verify(code); }}>
    <label htmlFor="whatsapp-code">Código recebido no WhatsApp</label>
    <input id="whatsapp-code" value={code} type="text" inputMode="numeric" autoComplete="one-time-code"
      pattern="[0-9]*" maxLength={6} autoFocus placeholder="000000"
      onChange={event => {
        const value = event.target.value.replace(/\D/g, '').slice(0, 6);
        setCode(value);
        if (value.length === 6) void verify(value);
      }} />
    <button className="button primary" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Confirmando…' : 'Entrar'}</button>
    <button className="text-button" type="button" disabled={busy} onClick={() => { setChallengeId(''); setCode(''); setMessage(''); }}>Corrigir número</button>
    <button className="text-button" type="button" disabled={busy} onClick={() => void requestCode()}>Enviar outro código</button>
    {message && <p className="form-message" role="status">{message}</p>}
  </form>;

  return <form className="stack" onSubmit={requestCode}>
    <label htmlFor="whatsapp-phone">Seu WhatsApp com DDD</label>
    <input id="whatsapp-phone" value={phone} onChange={event => setPhone(event.target.value)} name="phone" type="tel"
      inputMode="tel" autoComplete="tel" required placeholder="(44) 99999-9999" />
    <button className="button primary" disabled={busy} type="submit">{busy ? 'Enviando…' : 'Receber código no WhatsApp'}</button>
    {message && <p className="form-message error" role="alert">{message}</p>}
  </form>;
}
