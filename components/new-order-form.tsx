'use client';

import { FormEvent, useState } from 'react';

const LENS_TYPES = ['Visão simples', 'Multifocal', 'Solar com grau', 'Antirreflexo'];
const LENS_INDEXES = ['1.50', '1.56', '1.60', '1.67', '1.74'];
const LENS_MATERIALS = ['Resina', 'Policarbonato', 'Trivex', 'Outro'];
const LENS_TREATMENTS = ['Antirreflexo', 'Verniz', 'Filtro azul', 'Fotossensível'];
const LABORATORY_SUGGESTIONS = ['Laboratório A', 'Laboratório B', 'Laboratório C'];

function RxRow({ eye, label }: { eye: 'od' | 'oe'; label: string }) {
  return (
    <tr>
      <th>{label}</th>
      <td><input name={`${eye}-esferico`} type="number" step="0.25" min="-30" max="30" placeholder="+0,00" defaultValue="0" required /></td>
      <td><input name={`${eye}-cilindrico`} type="number" step="0.25" min="-30" max="30" placeholder="-0,00" defaultValue="0" required /></td>
      <td><input name={`${eye}-eixo`} type="number" step="1" min="0" max="180" placeholder="0°" defaultValue="0" required /></td>
      <td><input name={`${eye}-adicao`} type="number" step="0.25" min="0" max="6" placeholder="+0,00" defaultValue="0" required /></td>
    </tr>
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
      <div className="subsection">
        <h3>Receita</h3>
        <div className="rx-scroll">
          <table className="rx-table">
            <thead>
              <tr>
                <th></th>
                <th>Esférico</th>
                <th>Cilíndrico</th>
                <th>Eixo</th>
                <th>Adição</th>
              </tr>
            </thead>
            <tbody>
              <RxRow eye="od" label="OD" />
              <RxRow eye="oe" label="OE" />
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="subsection">
          <h3>Definição da lente</h3>
          <div className="grid grid-2">
            <div className="field">
              <label className="required" htmlFor="lensType">Tipo de lente</label>
              <select id="lensType" name="lensType" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {LENS_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lensIndex">Índice</label>
              <select id="lensIndex" name="lensIndex" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {LENS_INDEXES.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lensMaterial">Material</label>
              <select id="lensMaterial" name="lensMaterial" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {LENS_MATERIALS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lensTreatment">Tratamento</label>
              <select id="lensTreatment" name="lensTreatment" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {LENS_TREATMENTS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="field span-2">
              <label className="required" htmlFor="laboratory">Laboratório</label>
              <input id="laboratory" name="laboratory" list="laboratory-suggestions" placeholder="Digite ou escolha um laboratório" required maxLength={120} />
              <datalist id="laboratory-suggestions">
                {LABORATORY_SUGGESTIONS.map((option) => <option key={option} value={option} />)}
              </datalist>
              <div className="helper">O nome pode ser digitado livremente e passa a acompanhar este orçamento.</div>
            </div>
          </div>
        </div>

        <div className="subsection">
          <h3>Novo orçamento</h3>
          <div className="field">
            <label className="required" htmlFor="price">Valor do orçamento</label>
            <div className="money">
              <input id="price" name="price" type="number" step="0.01" min="0" placeholder="0,00" required />
            </div>
          </div>
          <div style={{ height: 10 }} />
          <div className="field">
            <label htmlFor="notes">Observações</label>
            <textarea id="notes" name="notes" rows={3} maxLength={500} placeholder="Condições, prazo, upgrade, observações do laboratório..." />
            <div className="helper">Estas observações acompanham o orçamento deste pedido.</div>
          </div>
        </div>
      </div>

      <div className="actions">
        <button className="button primary" disabled={state === 'loading'} type="submit">
          {state === 'loading' ? 'Salvando…' : 'Salvar orçamento e criar pedido'}
        </button>
      </div>
      {message && state === 'error' && <p className="form-message error" role="status">{message}</p>}
    </form>
  );
}
