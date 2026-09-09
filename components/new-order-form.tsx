'use client';

import { FormEvent, useState } from 'react';

const LENS_TYPES = ['Visão simples', 'Multifocal', 'Solar com grau', 'Antirreflexo'];
const LENS_INDEXES = ['1.50', '1.56', '1.60', '1.67', '1.74'];
const LENS_MATERIALS = ['Resina', 'Policarbonato', 'Trivex', 'Outro'];
const LENS_TREATMENTS = ['Antirreflexo', 'Verniz', 'Filtro azul', 'Fotossensível'];
const LABORATORY_SUGGESTIONS = ['Laboratório A', 'Laboratório B', 'Laboratório C'];

function EyeFields({ eye, label }: { eye: 'od' | 'oe'; label: string }) {
  return (
    <>
      <label htmlFor={`${eye}-esferico`}>{label} · Esférico</label>
      <input id={`${eye}-esferico`} name={`${eye}-esferico`} type="number" step="0.25" min="-30" max="30" defaultValue="0" required />
      <label htmlFor={`${eye}-cilindrico`}>{label} · Cilíndrico</label>
      <input id={`${eye}-cilindrico`} name={`${eye}-cilindrico`} type="number" step="0.25" min="-30" max="30" defaultValue="0" required />
      <label htmlFor={`${eye}-eixo`}>{label} · Eixo</label>
      <input id={`${eye}-eixo`} name={`${eye}-eixo`} type="number" step="1" min="0" max="180" defaultValue="0" required />
      <label htmlFor={`${eye}-adicao`}>{label} · Adição</label>
      <input id={`${eye}-adicao`} name={`${eye}-adicao`} type="number" step="0.25" min="0" max="6" defaultValue="0" required />
    </>
  );
}

export function NewOrderForm({ clientId }: { clientId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [orderNumber, setOrderNumber] = useState<number | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('loading');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const eye = (prefix: string) => ({
      esferico: form.get(`${prefix}-esferico`),
      cilindrico: form.get(`${prefix}-cilindrico`),
      eixo: form.get(`${prefix}-eixo`),
      adicao: form.get(`${prefix}-adicao`)
    });

    const response = await fetch('/api/professional/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        od: eye('od'),
        oe: eye('oe'),
        lensType: form.get('lensType'),
        lensIndex: form.get('lensIndex'),
        lensMaterial: form.get('lensMaterial'),
        lensTreatment: form.get('lensTreatment'),
        laboratory: form.get('laboratory'),
        price: form.get('price'),
        notes: form.get('notes')
      })
    });
    const payload = await response.json().catch(() => ({}));
    setState(response.ok ? 'success' : 'error');
    setMessage(payload.message || (response.ok ? 'Pedido criado.' : 'Não foi possível criar o pedido.'));
    if (response.ok) setOrderNumber(payload.orderNumber ?? null);
  }

  if (state === 'success') {
    return (
      <div className="form-message success" role="status">
        Pedido {orderNumber ? `#${orderNumber}` : ''} criado com sucesso. A etapa de armação, pagamento e produção ainda será adicionada em breve.
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 850, marginBottom: 8 }}>Receita</legend>
        <div className="form-grid">
          <EyeFields eye="od" label="OD" />
          <EyeFields eye="oe" label="OE" />
        </div>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 850, margin: '18px 0 8px' }}>Definição da lente</legend>
        <div className="form-grid">
          <label htmlFor="lensType">Tipo de lente
            <select id="lensType" name="lensType" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {LENS_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label htmlFor="lensIndex">Índice
            <select id="lensIndex" name="lensIndex" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {LENS_INDEXES.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label htmlFor="lensMaterial">Material
            <select id="lensMaterial" name="lensMaterial" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {LENS_MATERIALS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label htmlFor="lensTreatment">Tratamento
            <select id="lensTreatment" name="lensTreatment" required defaultValue="">
              <option value="" disabled>Selecione</option>
              {LENS_TREATMENTS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label htmlFor="laboratory">Laboratório
            <input id="laboratory" name="laboratory" list="laboratory-suggestions" required maxLength={120} />
            <datalist id="laboratory-suggestions">
              {LABORATORY_SUGGESTIONS.map((option) => <option key={option} value={option} />)}
            </datalist>
          </label>
        </div>
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 850, margin: '18px 0 8px' }}>Novo orçamento</legend>
        <label htmlFor="price">Valor do orçamento</label>
        <input id="price" name="price" type="number" step="0.01" min="0" required />
        <label htmlFor="notes">Observações</label>
        <textarea id="notes" name="notes" rows={3} maxLength={500} />
      </fieldset>

      <button className="button primary" disabled={state === 'loading'} type="submit">
        {state === 'loading' ? 'Salvando…' : 'Salvar orçamento e criar pedido'}
      </button>
      {message && state === 'error' && <p className="form-message error" role="status">{message}</p>}
    </form>
  );
}
