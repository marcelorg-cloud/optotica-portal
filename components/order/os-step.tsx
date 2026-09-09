'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

const LENS_TYPES = ['Visão simples', 'Multifocal', 'Solar com grau', 'Antirreflexo'];
const LENS_INDEXES = ['1.50', '1.56', '1.60', '1.67', '1.74'];
const LENS_MATERIALS = ['Resina', 'Policarbonato', 'Trivex', 'Outro'];
const LENS_TREATMENTS = ['Antirreflexo', 'Verniz', 'Filtro azul', 'Fotossensível'];
const LABORATORY_SUGGESTIONS = ['Laboratório A', 'Laboratório B', 'Laboratório C'];

type EyeRx = { esferico: string; cilindrico: string; eixo: string; adicao: string };
type QuoteOption = { id: string; total: number; description: string; laboratory: string; notes: string };

function RxRow({ eye, label, value }: { eye: 'od' | 'oe'; label: string; value: EyeRx }) {
  return (
    <tr>
      <th>{label}</th>
      <td><input name={`${eye}-esferico`} type="number" step="0.25" min="-30" max="30" placeholder="+0,00" defaultValue={value.esferico} required /></td>
      <td><input name={`${eye}-cilindrico`} type="number" step="0.25" min="-30" max="30" placeholder="-0,00" defaultValue={value.cilindrico} required /></td>
      <td><input name={`${eye}-eixo`} type="number" step="1" min="0" max="180" placeholder="0°" defaultValue={value.eixo} required /></td>
      <td><input name={`${eye}-adicao`} type="number" step="0.25" min="0" max="6" placeholder="+0,00" defaultValue={value.adicao} required /></td>
    </tr>
  );
}

const EMPTY_EYE: EyeRx = { esferico: '0', cilindrico: '0', eixo: '0', adicao: '0' };

export function OsStep({ orderId, initialOd, initialOe, quotes, selectedQuoteId, locked }: {
  orderId: string;
  initialOd: EyeRx | null;
  initialOe: EyeRx | null;
  quotes: QuoteOption[];
  selectedQuoteId: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [rxState, setRxState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [rxMessage, setRxMessage] = useState('');
  const [budgetState, setBudgetState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [budgetMessage, setBudgetMessage] = useState('');

  // Seleção de orçamento com atualização visual otimista: marca a opção
  // escolhida na hora do clique (sem esperar o roundtrip + refresh da página
  // inteira), evitando a lentidão percebida ao trocar de orçamento. O
  // router.refresh() continua rodando em segundo plano pra manter o resto da
  // página (resumo, indicador da etapa) sincronizado — a lógica de seleção em
  // si não muda.
  const [localSelectedQuoteId, setLocalSelectedQuoteId] = useState(selectedQuoteId);
  const [prevSelectedQuoteId, setPrevSelectedQuoteId] = useState(selectedQuoteId);
  const [selectMessage, setSelectMessage] = useState('');
  // Ressincroniza com o servidor quando o pai re-renderiza com um valor novo
  // (ex.: outra aba selecionou outro orçamento) — ajuste de estado durante o
  // render, não em efeito, como recomendado pelos docs do React.
  if (selectedQuoteId !== prevSelectedQuoteId) {
    setPrevSelectedQuoteId(selectedQuoteId);
    setLocalSelectedQuoteId(selectedQuoteId);
  }

  async function submitRx(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setRxState('loading');
    setRxMessage('');
    const form = new FormData(event.currentTarget);
    const eye = (prefix: string) => ({
      esferico: form.get(`${prefix}-esferico`), cilindrico: form.get(`${prefix}-cilindrico`),
      eixo: form.get(`${prefix}-eixo`), adicao: form.get(`${prefix}-adicao`)
    });
    const response = await fetch(`/api/professional/orders/${orderId}/prescription`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ od: eye('od'), oe: eye('oe') })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setRxState('idle'); router.refresh(); }
    else { setRxState('error'); setRxMessage(payload.message || 'Não foi possível salvar a receita.'); }
  }

  async function submitBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    setBudgetState('loading');
    setBudgetMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/professional/orders/${orderId}/quotes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lensType: form.get('lensType'), lensIndex: form.get('lensIndex'),
        lensMaterial: form.get('lensMaterial'), lensTreatment: form.get('lensTreatment'),
        laboratory: form.get('laboratory'), price: form.get('price'), notes: form.get('notes')
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) { setBudgetState('idle'); (event.target as HTMLFormElement).reset(); router.refresh(); }
    else { setBudgetState('error'); setBudgetMessage(payload.message || 'Não foi possível salvar o orçamento.'); }
  }

  async function selectQuote(quoteId: string) {
    if (locked || quoteId === localSelectedQuoteId) return;
    const previous = localSelectedQuoteId;
    setLocalSelectedQuoteId(quoteId);
    setSelectMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/select-quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quoteId })
    });
    if (response.ok) {
      router.refresh();
    } else {
      const payload = await response.json().catch(() => ({}));
      setLocalSelectedQuoteId(previous);
      setSelectMessage(payload.message || 'Não foi possível selecionar o orçamento.');
    }
  }

  return (
    <div className="stack">
      {locked && <div className="notice">🔒 Etapa bloqueada — Comanda final já confirmada.</div>}
      <form className="subsection" onSubmit={submitRx}>
        <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0 }}>
        <h3>Receita</h3>
        <div className="rx-scroll">
          <table className="rx-table">
            <thead><tr><th></th><th>Esférico</th><th>Cilíndrico</th><th>Eixo</th><th>Adição</th></tr></thead>
            <tbody>
              <RxRow eye="od" label="OD" value={initialOd || EMPTY_EYE} />
              <RxRow eye="oe" label="OE" value={initialOe || EMPTY_EYE} />
            </tbody>
          </table>
        </div>
        <div className="actions">
          <button className="button primary" type="submit" disabled={rxState === 'loading'}>{rxState === 'loading' ? 'Salvando…' : 'Salvar receita'}</button>
        </div>
        {rxMessage && rxState === 'error' && <p className="form-message error">{rxMessage}</p>}
        </fieldset>
      </form>

      <form onSubmit={submitBudget}>
        <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0 }}>
        <div className="grid grid-2">
          <div className="subsection">
            <h3>Definição da lente</h3>
            <div className="grid grid-2">
              <div className="field"><label className="required" htmlFor="lensType">Tipo de lente</label>
                <select id="lensType" name="lensType" required defaultValue="">
                  <option value="" disabled>Selecione</option>
                  {LENS_TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="lensIndex">Índice</label>
                <select id="lensIndex" name="lensIndex" required defaultValue="">
                  <option value="" disabled>Selecione</option>
                  {LENS_INDEXES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="lensMaterial">Material</label>
                <select id="lensMaterial" name="lensMaterial" required defaultValue="">
                  <option value="" disabled>Selecione</option>
                  {LENS_MATERIALS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field"><label htmlFor="lensTreatment">Tratamento</label>
                <select id="lensTreatment" name="lensTreatment" required defaultValue="">
                  <option value="" disabled>Selecione</option>
                  {LENS_TREATMENTS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="field span-2"><label className="required" htmlFor="laboratory">Laboratório</label>
                <input id="laboratory" name="laboratory" list="laboratory-suggestions" placeholder="Digite ou escolha um laboratório" required maxLength={120} />
                <datalist id="laboratory-suggestions">{LABORATORY_SUGGESTIONS.map((o) => <option key={o} value={o} />)}</datalist>
              </div>
            </div>
          </div>

          <div className="subsection">
            <h3>Novo orçamento</h3>
            <div className="field"><label className="required" htmlFor="price">Valor do orçamento</label>
              <div className="money"><input id="price" name="price" type="number" step="0.01" min="0" placeholder="0,00" required /></div>
            </div>
            <div style={{ height: 10 }} />
            <div className="field"><label htmlFor="notes">Observações</label>
              <textarea id="notes" name="notes" rows={3} maxLength={500} placeholder="Condições, prazo, upgrade, observações do laboratório..." />
              <div className="helper">Estas observações acompanham este orçamento.</div>
            </div>
          </div>
        </div>

        <div className="actions">
          <button className="button primary" type="submit" disabled={budgetState === 'loading'}>{budgetState === 'loading' ? 'Salvando…' : 'Adicionar orçamento'}</button>
        </div>
        {budgetMessage && budgetState === 'error' && <p className="form-message error">{budgetMessage}</p>}
        </fieldset>
      </form>

      <div className="subsection">
        <h3>Ordens de serviço / orçamentos</h3>
        <div className="helper" style={{ marginBottom: 10 }}>Cadastre quantas opções forem necessárias. Depois selecione a melhor opção para seguir com o pedido.</div>
        <div className="os-list">
          {quotes.length ? quotes.map((quote) => (
            <div
              key={quote.id}
              className={`os-item budget-option${quote.id === localSelectedQuoteId ? ' selected-budget' : ''}${locked ? ' locked' : ''}`}
              style={locked ? { cursor: 'default', opacity: 0.75 } : undefined}
              onClick={() => selectQuote(quote.id)}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <input type="radio" name="orcamento_escolhido" readOnly checked={quote.id === localSelectedQuoteId} style={{ width: 'auto', marginTop: 4 }} />
                <div>
                  <strong>{quote.description}</strong>
                  <small>{quote.laboratory}{quote.notes ? ' · ' + quote.notes : ''}</small>
                </div>
              </div>
              <div className="price">R$ {quote.total.toFixed(2).replace('.', ',')}</div>
            </div>
          )) : <div className="empty-budget">Nenhum orçamento adicionado ainda.</div>}
        </div>
        {selectMessage && <p className="form-message error">{selectMessage}</p>}
      </div>
    </div>
  );
}
