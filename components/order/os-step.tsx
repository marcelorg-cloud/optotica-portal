'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

const LENS_TYPES = ['Visão simples', 'Multifocal', 'Solar com grau', 'Antirreflexo'];
const LENS_INDEXES = ['1.50', '1.56', '1.60', '1.67', '1.74'];
const LENS_MATERIALS = ['Resina', 'Policarbonato', 'Trivex', 'Outro'];
const LENS_TREATMENTS = ['Antirreflexo', 'Verniz', 'Filtro azul', 'Fotossensível'];
type LaboratoryOption = { id: string; name: string; isPrimary: boolean };

type QuoteOption = { id: string; total: number; description: string; laboratory: string; notes: string };
type MenuTierOption = {
  lensType: 'single_vision' | 'multifocal';
  tierNumber: number; isAddon: boolean; tierName: string; benefitPhrase: string | null;
  targetAudience: string | null; manufacturer: string | null; productLine: string | null;
  lensIndex: string | null; arTreatment: string | null; price: number;
};

const MENU_CATEGORY_LABELS: Record<MenuTierOption['lensType'], string> = {
  single_vision: 'Visão simples',
  multifocal: 'Multifocal'
};

// Etapa 3 "Lentes sugeridas" (16/09/2026) — antes era a mesma etapa "OS /
// Orçamento" que também continha a receita (OD/OE, ver
// components/order/prescription-step.tsx, novo, com a etapa 2 "Prescrição
// optométrica"). Pedido do usuário: separar em duas etapas próprias — esta
// ficou com o cardápio de lentes e os orçamentos, sem nenhuma mudança de
// comportamento além da separação visual (mesmas rotas de API de sempre:
// /quotes, /quotes/from-menu, /select-quote).
export function SuggestedLensesStep({ orderId, quotes, selectedQuoteId, locked, menuTiers = [], laboratoryOptions }: {
  orderId: string;
  quotes: QuoteOption[];
  selectedQuoteId: string | null;
  locked: boolean;
  menuTiers?: MenuTierOption[];
  laboratoryOptions: LaboratoryOption[];
}) {
  const router = useRouter();
  const [budgetState, setBudgetState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [budgetMessage, setBudgetMessage] = useState('');
  const [menuAddingKey, setMenuAddingKey] = useState<string | null>(null);
  const [menuMessage, setMenuMessage] = useState('');
  const [chosenLaboratoryId, setChosenLaboratoryId] = useState(laboratoryOptions.length === 1 ? laboratoryOptions[0].id : laboratoryOptions.find((lab) => lab.isPrimary)?.id || '');
  const laboratoryId = laboratoryOptions.some((lab) => lab.id === chosenLaboratoryId) ? chosenLaboratoryId : '';

  async function addFromMenu(lensType: MenuTierOption['lensType'], tierNumber: number) {
    const key = `${lensType}-${tierNumber}`;
    if (locked || menuAddingKey !== null) return;
    if (!laboratoryId) { setMenuMessage('Selecione um laboratório cadastrado no seu perfil.'); return; }
    setMenuAddingKey(key);
    setMenuMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/quotes/from-menu`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lensType, tierNumber, laboratoryId })
    });
    const payload = await response.json().catch(() => ({}));
    setMenuAddingKey(null);
    if (response.ok) { router.refresh(); }
    else { setMenuMessage(payload.message || 'Não foi possível adicionar este nível ao orçamento.'); }
  }

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
        laboratoryId, price: form.get('price'), notes: form.get('notes')
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
      {menuTiers.length > 0 && (
        <div className="subsection">
          <h3>Cardápio de lentes</h3>
          <div className="field">
            <label htmlFor="menu-laboratory">Laboratório do orçamento</label>
            <select id="menu-laboratory" value={laboratoryId} onChange={(event) => setChosenLaboratoryId(event.target.value)} disabled={locked || !laboratoryOptions.length}>
              <option value="" disabled>Selecione</option>
              {laboratoryOptions.map((lab) => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
            </select>
          </div>
          <div className="helper" style={{ marginBottom: 10 }}>
            Clique em um nível para adicionar um orçamento já pré-preenchido com a composição e o preço configurados. Você pode ajustar ou remover depois.
          </div>
          <div className="stack">
            {(['single_vision', 'multifocal'] as const).map((lensType) => {
              const tiersOfType = menuTiers.filter((t) => t.lensType === lensType);
              if (tiersOfType.length === 0) return null;
              return (
                <div className="menu-category-group" key={lensType}>
                  <p className="helper">{MENU_CATEGORY_LABELS[lensType]}</p>
                  <div className="os-list">
                    {tiersOfType.map((tier) => {
                      const key = `${lensType}-${tier.tierNumber}`;
                      return (
                        <div key={key} className={`os-item budget-option${tier.isAddon ? ' selected-budget' : ''}`} style={{ cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.75 : 1 }}
                          onClick={() => addFromMenu(lensType, tier.tierNumber)}>
                          <div>
                            <strong>{tier.tierName}{tier.isAddon ? ' · Grife' : ''}</strong>
                            <small>
                              {[tier.manufacturer, tier.productLine, tier.lensIndex, tier.arTreatment].filter(Boolean).join(' · ') || 'Composição a definir'}
                            </small>
                            {tier.benefitPhrase && <small>{tier.benefitPhrase}</small>}
                          </div>
                          <div className="price">
                            R$ {tier.price.toFixed(2).replace('.', ',')}
                            <div className="helper" style={{ marginTop: 4 }}>{menuAddingKey === key ? 'Adicionando…' : 'Adicionar ao orçamento'}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {menuMessage && <p className="form-message error">{menuMessage}</p>}
        </div>
      )}

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
                <select id="laboratory" name="laboratoryId" required value={laboratoryId} onChange={(event) => setChosenLaboratoryId(event.target.value)} disabled={!laboratoryOptions.length}>
                  <option value="" disabled>Selecione</option>
                  {laboratoryOptions.map((lab) => <option key={lab.id} value={lab.id}>{lab.name}</option>)}
                </select>
                {!laboratoryOptions.length && <span className="field-hint">Cadastre um laboratório em <a href="/profissional/cadastro">Meu perfil</a> para adicionar orçamentos.</span>}
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
          <button className="button primary" type="submit" disabled={budgetState === 'loading' || !laboratoryId}>{budgetState === 'loading' ? 'Salvando…' : 'Adicionar orçamento'}</button>
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
