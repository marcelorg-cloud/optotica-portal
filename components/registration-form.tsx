'use client';

import { FormEvent, useState } from 'react';

export function RegistrationForm() {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setState('loading');
    setMessage('');
    const form = new FormData(formElement);
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: form.get('fullName'),
        email: form.get('email'),
        acceptedTerms: form.get('acceptedTerms') === 'on'
      })
    });
    const payload = await response.json().catch(() => ({}));
    setState(response.ok ? 'success' : 'error');
    setMessage(payload.message || (response.ok ? 'Confira seu e-mail.' : 'Não foi possível concluir o cadastro.'));
    if (response.ok) formElement.reset();
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label htmlFor="registration-name">Nome completo</label>
      <input id="registration-name" name="fullName" type="text" autoComplete="name" minLength={2} maxLength={120} required />

      <label htmlFor="registration-email">E-mail</label>
      <input id="registration-email" name="email" type="email" autoComplete="email" required />

      <label className="check-row" htmlFor="registration-terms">
        <input id="registration-terms" name="acceptedTerms" type="checkbox" required />
        <span>Estou ciente de que meus dados serão usados para criar e proteger meu acesso ao Portal Optótica.</span>
      </label>

      <button className="button primary" disabled={state === 'loading'} type="submit">
        {state === 'loading' ? 'Enviando…' : 'Iniciar cadastro profissional'}
      </button>
      {message && <p className={state === 'error' ? 'form-message error' : 'form-message success'} role="status">{message}</p>}
    </form>
  );
}
