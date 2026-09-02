'use client';

import { FormEvent, useState } from 'react';

export function ProfessionalLoginForm() {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('loading');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/professional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.get('email') })
    });
    const payload = await response.json().catch(() => ({}));
    setState(response.ok ? 'success' : 'error');
    setMessage(payload.message || (response.ok ? 'Verifique seu e-mail.' : 'Não foi possível solicitar o acesso.'));
  }

  return (
    <form onSubmit={submit} className="stack">
      <label htmlFor="professional-email">E-mail profissional</label>
      <input id="professional-email" name="email" type="email" autoComplete="email" required placeholder="voce@empresa.com.br" />
      <button className="button primary" disabled={state === 'loading'} type="submit">
        {state === 'loading' ? 'Enviando…' : 'Enviar Magic Link'}
      </button>
      {message && <p className={state === 'error' ? 'form-message error' : 'form-message success'} role="status">{message}</p>}
    </form>
  );
}
