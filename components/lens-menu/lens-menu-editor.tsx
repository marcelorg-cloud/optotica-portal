'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CatalogItem, MenuTier, LensType } from '@/app/profissional/cardapio/page';

const DEFAULT_NAMES: Record<number, string> = {
  1: 'Essencial',
  2: 'Recomendado',
  3: 'Premium',
  4: 'Grife'
};

const CATEGORY_LABELS: Record<LensType, string> = {
  single_vision: 'Visão simples',
  multifocal: 'Multifocal'
};

// Ordem em que as abas aparecem — visão simples primeiro por ser o
// atendimento mais comum no dia a dia.
const CATEGORIES: LensType[] = ['single_vision', 'multifocal'];

type TierForm = {
  tierNumber: number;
  isAddon: boolean;
  tierName: string;
  benefitPhrase: string;
  targetAudience: string;
  catalogItemId: string;
  manufacturer: string;
  productLine: string;
  lensIndex: string;
  arTreatment: string;
  price: string;
  active: boolean;
};

function emptyTier(tierNumber: number): TierForm {
  return {
    tierNumber,
    isAddon: tierNumber === 4,
    tierName: DEFAULT_NAMES[tierNumber] || `Nível ${tierNumber}`,
    benefitPhrase: '',
    targetAudience: '',
    catalogItemId: '',
    manufacturer: '',
    productLine: '',
    lensIndex: '',
    arTreatment: '',
    price: '',
    active: true
  };
}

function fromInitial(tier: MenuTier): TierForm {
  return {
    tierNumber: tier.tier_number,
    isAddon: tier.is_addon,
    tierName: tier.tier_name || DEFAULT_NAMES[tier.tier_number] || `Nível ${tier.tier_number}`,
    benefitPhrase: tier.benefit_phrase || '',
    targetAudience: tier.target_audience || '',
    catalogItemId: tier.catalog_item_id || '',
    manufacturer: tier.manufacturer || '',
    productLine: tier.product_line || '',
    lensIndex: tier.lens_index || '',
    arTreatment: tier.ar_treatment || '',
    price: tier.price != null ? String(tier.price) : '',
    active: tier.active
  };
}

function formatPrice(v: number) {
  return v.toFixed(2).replace('.', ',');
}

function CatalogPicker({ items, onPick }: { items: CatalogItem[]; onPick: (item: CatalogItem) => void }) {
  const [term, setTerm] = useState('');
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((it) => `${it.manufacturer} ${it.product_line} ${it.lens_index} ${it.base_variant} ${it.ar_treatment}`.toLowerCase().includes(q))
      .slice(0, 60);
  }, [items, term]);

  return (
    <div className="field">
      <label>Buscar no catálogo de laboratórios</label>
      <input
        placeholder="Ex.: Haytek Pro ID, Varilux, Prolight Blue Max..."
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      {term.trim() && (
        <div className="catalog-results">
          {filtered.length ? filtered.map((it) => (
            <button
              type="button"
              key={it.id}
              className="catalog-result-item"
              onClick={() => { onPick(it); setTerm(''); }}
            >
              <strong>{it.manufacturer} — {it.product_line}</strong>
              <small>{[it.lens_index, it.base_variant, it.ar_treatment].filter(Boolean).join(' · ')}</small>
              <span className="price">R$ {formatPrice(it.price)}</span>
            </button>
          )) : <div className="helper">Nenhum item encontrado nesta categoria — tente outro termo, ou preencha manualmente abaixo.</div>}
        </div>
      )}
    </div>
  );
}

function TierCard({ tier, items, onChange, onRemove, removable }: {
  tier: TierForm;
  items: CatalogItem[];
  onChange: (next: TierForm) => void;
  onRemove?: () => void;
  removable: boolean;
}) {
  const set = <K extends keyof TierForm>(key: K, value: TierForm[K]) => onChange({ ...tier, [key]: value });

  return (
    <div className={`subsection tier-card${tier.isAddon ? ' tier-addon' : ''}`}>
      <div className="tier-card-head">
        <span className="tier-number-badge">{tier.tierNumber}</span>
        <div className="field span-2" style={{ flex: 1 }}>
          <label className="required">Nome do nível</label>
          <input value={tier.tierName} maxLength={80} onChange={(e) => set('tierName', e.target.value)} placeholder="Ex.: Essencial, Recomendado, Premium..." />
        </div>
        {removable && (
          <button type="button" className="button secondary" onClick={onRemove}>Remover 4ª opção</button>
        )}
      </div>

      <div className="grid grid-2">
        <div className="field">
          <label>Frase de benefício (não ficha técnica)</label>
          <textarea rows={2} maxLength={300} value={tier.benefitPhrase} onChange={(e) => set('benefitPhrase', e.target.value)}
            placeholder="Ex.: Menos reflexo pra dirigir à noite e mais conforto o dia todo." />
        </div>
        <div className="field">
          <label>Para quem (opcional)</label>
          <input maxLength={200} value={tier.targetAudience} onChange={(e) => set('targetAudience', e.target.value)}
            placeholder="Ex.: uso de tela o dia todo, grau alto..." />
        </div>
      </div>

      <CatalogPicker items={items} onPick={(item) => onChange({
        ...tier,
        catalogItemId: item.id,
        manufacturer: item.manufacturer,
        productLine: item.product_line,
        lensIndex: item.lens_index,
        arTreatment: item.ar_treatment,
        price: String(item.price)
      })} />

      <div className="grid grid-2">
        <div className="field">
          <label>Laboratório / marca</label>
          <input maxLength={120} value={tier.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} placeholder="Ex.: Haytek" />
        </div>
        <div className="field">
          <label>Linha</label>
          <input maxLength={160} value={tier.productLine} onChange={(e) => set('productLine', e.target.value)} placeholder="Ex.: Haytek Top" />
        </div>
        <div className="field">
          <label>Índice</label>
          <input maxLength={20} value={tier.lensIndex} onChange={(e) => set('lensIndex', e.target.value)} placeholder="Ex.: 1.59" />
        </div>
        <div className="field">
          <label>Tratamento / AR</label>
          <input maxLength={120} value={tier.arTreatment} onChange={(e) => set('arTreatment', e.target.value)} placeholder="Ex.: AR Premium Azul" />
        </div>
      </div>

      <div className="field">
        <label className="required">Preço final deste nível</label>
        <div className="money"><input type="number" step="0.01" min="0" value={tier.price} onChange={(e) => set('price', e.target.value)} placeholder="0,00" /></div>
      </div>

      <label className="check-row" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={tier.active} onChange={(e) => set('active', e.target.checked)} />
        <span>Nível ativo (visível para uso no atendimento)</span>
      </label>
    </div>
  );
}

type CategoryState = {
  tier1: TierForm;
  tier2: TierForm;
  tier3: TierForm;
  tier4: TierForm;
  hasAddon: boolean;
};

function buildInitialCategoryState(tiers: MenuTier[], lensType: LensType): CategoryState {
  const byNumber = new Map(tiers.filter((t) => t.lens_type === lensType).map((t) => [t.tier_number, t]));
  return {
    tier1: byNumber.has(1) ? fromInitial(byNumber.get(1)!) : emptyTier(1),
    tier2: byNumber.has(2) ? fromInitial(byNumber.get(2)!) : emptyTier(2),
    tier3: byNumber.has(3) ? fromInitial(byNumber.get(3)!) : emptyTier(3),
    tier4: byNumber.has(4) ? fromInitial(byNumber.get(4)!) : emptyTier(4),
    hasAddon: byNumber.has(4)
  };
}

// Cardápio separado por categoria (visão simples / multifocal) — as faixas
// de preço das duas são tão diferentes que um único cardápio de 3 opções
// não fazia sentido pras duas juntas (pedido explícito do usuário,
// 10/09/2026). Cada categoria guarda seus próprios 3 níveis + 1 opcional
// "grife", e o salvamento envia as duas de uma vez (a rota substitui a
// configuração inteira do cardápio, categoria por categoria).
export function LensMenuEditor({ initialTiers, catalogItems }: { initialTiers: MenuTier[]; catalogItems: CatalogItem[] }) {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState<LensType>('single_vision');
  const [singleVision, setSingleVision] = useState<CategoryState>(() => buildInitialCategoryState(initialTiers, 'single_vision'));
  const [multifocal, setMultifocal] = useState<CategoryState>(() => buildInitialCategoryState(initialTiers, 'multifocal'));
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const catalogByCategory = useMemo(() => {
    const map: Record<LensType, CatalogItem[]> = { single_vision: [], multifocal: [] };
    for (const item of catalogItems) {
      if (item.lens_type === 'single_vision' || item.lens_type === 'multifocal') {
        map[item.lens_type].push(item);
      }
    }
    return map;
  }, [catalogItems]);

  const current = activeCategory === 'single_vision' ? singleVision : multifocal;
  const setCurrent = activeCategory === 'single_vision' ? setSingleVision : setMultifocal;

  function updateTier(key: 'tier1' | 'tier2' | 'tier3' | 'tier4', next: TierForm) {
    setCurrent((prev) => ({ ...prev, [key]: next }));
  }

  async function save() {
    setState('saving');
    setMessage('');
    const tiers: Record<string, unknown>[] = [];
    for (const lensType of CATEGORIES) {
      const cat = lensType === 'single_vision' ? singleVision : multifocal;
      const list = [cat.tier1, cat.tier2, cat.tier3, ...(cat.hasAddon ? [cat.tier4] : [])];
      for (const t of list) {
        tiers.push({
          lensType,
          tierNumber: t.tierNumber,
          isAddon: t.isAddon,
          tierName: t.tierName,
          benefitPhrase: t.benefitPhrase,
          targetAudience: t.targetAudience,
          catalogItemId: t.catalogItemId || null,
          manufacturer: t.manufacturer,
          productLine: t.productLine,
          lensIndex: t.lensIndex,
          arTreatment: t.arTreatment,
          price: t.price,
          active: t.active
        });
      }
    }
    const response = await fetch('/api/professional/lens-menu', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiers })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      setState('idle');
      setMessage('Cardápio salvo com sucesso (visão simples e multifocal).');
      router.refresh();
    } else {
      setState('error');
      setMessage(payload.message || 'Não foi possível salvar o cardápio.');
    }
  }

  return (
    <div className="stack">
      <div className="category-tabs">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`category-tab${activeCategory === cat ? ' active' : ''}`}
            onClick={() => setActiveCategory(cat)}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      <TierCard tier={current.tier1} items={catalogByCategory[activeCategory]} onChange={(n) => updateTier('tier1', n)} removable={false} />
      <TierCard tier={current.tier2} items={catalogByCategory[activeCategory]} onChange={(n) => updateTier('tier2', n)} removable={false} />
      <TierCard tier={current.tier3} items={catalogByCategory[activeCategory]} onChange={(n) => updateTier('tier3', n)} removable={false} />

      {current.hasAddon ? (
        <TierCard
          tier={current.tier4}
          items={catalogByCategory[activeCategory]}
          onChange={(n) => updateTier('tier4', n)}
          onRemove={() => setCurrent((prev) => ({ ...prev, hasAddon: false }))}
          removable
        />
      ) : (
        <div className="subsection tier-add-addon">
          <p className="helper" style={{ margin: 0 }}>
            Quer oferecer uma 4ª opção &quot;grife&quot;/topo de linha para {CATEGORY_LABELS[activeCategory].toLowerCase()}
            (ex.: uma marca premium reconhecida, como Varilux)?
          </p>
          <button
            type="button"
            className="button secondary"
            style={{ marginTop: 10 }}
            onClick={() => setCurrent((prev) => ({ ...prev, hasAddon: true }))}
          >
            + Adicionar 4ª opção (grife / topo de linha)
          </button>
        </div>
      )}

      <div className="actions">
        <button className="button primary" type="button" disabled={state === 'saving'} onClick={save}>
          {state === 'saving' ? 'Salvando…' : 'Salvar cardápio'}
        </button>
      </div>
      <p className="helper" style={{ margin: 0 }}>
        O botão salva as duas categorias de uma vez — não é preciso trocar de aba para salvar cada uma separadamente.
      </p>
      {message && <p className={`form-message ${state === 'error' ? 'error' : 'success'}`}>{message}</p>}
    </div>
  );
}
