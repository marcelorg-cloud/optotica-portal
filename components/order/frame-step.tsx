'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { colorSwatchBackground, colorSwatchIsLight } from '@/lib/catalog/color-swatch-style';

// Reescrita completa (15/09/2026) — redesenho pedido pelo usuário a partir
// de um wireframe: 1 linha por modelo do catálogo (não mais um card por
// modelo em grid), com um círculo clicável por cor (troca qual "Foto de
// Prova"/"foto do óculos" aparece na linha) e 3 botões — GOSTEI / TALVEZ /
// OCULTAR — no lugar do dropdown de cor + botão único "Selecionar".
//
// Decisões já confirmadas com o usuário (ver migração 202609151600):
// - Fonte de dados: catálogo novo (catalog_products/catalog_product_color_images),
//   não mais a tabela antiga `frames`.
// - GOSTEI/TALVEZ/OCULTAR são uma REAÇÃO por cor (tabela order_frame_reactions),
//   independente da escolha final — marcar o mesmo botão de novo desmarca.
// - OCULTAR é só um marcador visual (esmaece o card, não remove da lista).
// - A confirmação final (equivalente ao antigo "Selecionar") vira uma ação
//   separada, disponível só para cores já marcadas com GOSTEI — feita aqui
//   como um botão "Confirmar esta cor" que aparece dentro do próprio card
//   quando a cor ativa da linha está com reação "gostei".
//
// Layout (15/09/2026, 3ª rodada — pedido do usuário a partir de um print):
// nome do modelo/SKU e os círculos de cor ficam FORA do card cinza, numa
// linha só (`.frame-row-top`); só as duas fotos e os 3 botões de reação
// entram no card (`.frame-card`) — ver app/globals.css.
type ColorOption = {
  id: string;
  colorName: string;
  colorPrincipal: string | null;
  colorSecondary: string | null;
  colorVariantNumber: number | null;
  provaUrl: string | null;
  fotoOculosUrl: string | null;
  reaction: 'gostei' | 'talvez' | 'oculto' | null;
  confirmed: boolean;
};
type ArmacaoModel = { id: string; modelName: string; skuOptotica: string; colors: ColorOption[] };

const REACTIONS: { key: 'gostei' | 'talvez' | 'oculto'; label: string }[] = [
  { key: 'gostei', label: 'GOSTEI' },
  { key: 'talvez', label: 'TALVEZ' },
  { key: 'oculto', label: 'OCULTAR' }
];

export function FrameStep({ orderId, models, confirmedFrameName, confirmedColor, locked }: {
  orderId: string;
  models: ArmacaoModel[];
  confirmedFrameName: string | null;
  confirmedColor: string | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [activeColorByModel, setActiveColorByModel] = useState<Record<string, string>>(
    Object.fromEntries(models.map((m) => [m.id, m.colors.find((c) => c.confirmed)?.id || m.colors[0]?.id || '']))
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  function activeColorOf(model: ArmacaoModel): ColorOption | undefined {
    const activeId = activeColorByModel[model.id];
    return model.colors.find((c) => c.id === activeId) || model.colors[0];
  }

  async function react(color: ColorOption, status: 'gostei' | 'talvez' | 'oculto') {
    if (locked) return;
    const key = `react-${color.id}`;
    setBusyKey(key);
    setMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/frame-reactions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogColorImageId: color.id, status })
    });
    const payload = await response.json().catch(() => ({}));
    setBusyKey(null);
    if (response.ok) router.refresh();
    else setMessage(payload.message || 'Não foi possível registrar a reação.');
  }

  async function confirm(color: ColorOption) {
    if (locked) return;
    const key = `confirm-${color.id}`;
    setBusyKey(key);
    setMessage('');
    const response = await fetch(`/api/professional/orders/${orderId}/frame`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogColorImageId: color.id })
    });
    const payload = await response.json().catch(() => ({}));
    setBusyKey(null);
    if (response.ok) router.refresh();
    else setMessage(payload.message || 'Não foi possível confirmar a armação.');
  }

  return (
    <div className="stack">
      {locked && <div className="notice">🔒 Etapa bloqueada — Comanda final já confirmada.</div>}
      {confirmedFrameName && (
        <div className="notice">Armação confirmada: <strong>{confirmedFrameName}</strong> · cor {confirmedColor}</div>
      )}
      {models.length === 0 && <p className="helper">Nenhum modelo publicado no catálogo ainda.</p>}
      <fieldset disabled={locked} style={{ border: 'none', margin: 0, padding: 0 }}>
        <div className="stack" style={{ gap: 14 }}>
          {models.map((model) => {
            const active = activeColorOf(model);
            if (!active) return null;
            const isHidden = active.reaction === 'oculto';
            return (
              <div className="frame-row" key={model.id}>
                {/* Cabeçalho (nome + SKU) e círculos de cor ficam FORA do
                    card cinza — só as fotos e os botões de reação entram
                    nele (layout pedido pelo usuário a partir de um print,
                    15/09/2026, 3ª rodada). */}
                <div className="frame-row-top">
                  <div className="frame-row-head">
                    <strong>{model.modelName}</strong>
                    <span className="helper">MODELO {model.skuOptotica}</span>
                    {active.confirmed && <span className="complete-tag">Confirmada</span>}
                  </div>

                  <div className="frame-swatches" role="group" aria-label={`Cores de ${model.modelName}`}>
                    {model.colors.map((color) => {
                      const isActive = color.id === active.id;
                      return (
                        <button
                          key={color.id}
                          type="button"
                          className={`frame-swatch${isActive ? ' is-active' : ''}${color.reaction === 'oculto' ? ' is-hidden' : ''}`}
                          style={{ background: colorSwatchBackground(color.colorPrincipal, color.colorSecondary) }}
                          title={`Cor ${color.colorVariantNumber ?? ''} — ${color.colorName}`}
                          aria-pressed={isActive}
                          onClick={() => setActiveColorByModel((prev) => ({ ...prev, [model.id]: color.id }))}
                        >
                          <span className={colorSwatchIsLight(color.colorPrincipal) ? 'dark-label' : 'light-label'}>
                            C{color.colorVariantNumber ?? '?'}
                          </span>
                          {color.reaction === 'gostei' && <span className="frame-swatch-reaction">♥</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={`frame-card${isHidden ? ' is-hidden' : ''}`}>
                  <div className="frame-photos">
                    <div className="frame-photo-box frame-photo-prova">
                      {active.provaUrl ? <img src={active.provaUrl} alt="Foto de Prova" /> : <span>Foto de<br />Prova</span>}
                    </div>
                    <div className="frame-photo-box frame-photo-oculos">
                      {active.fotoOculosUrl ? <img src={active.fotoOculosUrl} alt="Foto do óculos" /> : <span>Foto do óculos ainda sem foto</span>}
                    </div>
                  </div>

                  <div className="frame-actions">
                    {REACTIONS.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        className={`frame-action-pill${active.reaction === r.key ? ' is-active' : ''}`}
                        disabled={busyKey === `react-${active.id}`}
                        onClick={() => react(active, r.key)}
                      >
                        {r.label}
                      </button>
                    ))}
                    {active.reaction === 'gostei' && !active.confirmed && (
                      <button type="button" className="button primary small" disabled={busyKey === `confirm-${active.id}`} onClick={() => confirm(active)}>
                        {busyKey === `confirm-${active.id}` ? 'Confirmando…' : 'Confirmar esta cor'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>
      {message && <p className="form-message error">{message}</p>}
      <p className="helper">O valor do conjunto, incluindo as lentes, será informado pelo optometrista no orçamento.</p>
    </div>
  );
}
