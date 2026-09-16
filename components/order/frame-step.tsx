'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { colorSwatchBackground, colorSwatchIsLight } from '@/lib/catalog/color-swatch-style';
import type { Point } from '@/lib/dnp';

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
// Layout profissional: prova ampliada à esquerda; identificação, cores,
// foto da armação e ações à direita. No celular, a prova vem primeiro.
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

// "Foto de Prova" com o rosto do paciente (15/09/2026) — antes esse card só
// mostrava a foto do óculos sozinho (processed_image_path do catálogo);
// agora mostra a composição real "rosto do paciente + óculos desta cor",
// gerada automaticamente ao trocar de cor (mesmo mecanismo de
// components/client-area/tryon-panel.tsx: detecção de pupilas no navegador
// via lib/dnp-vision.ts + composição final no servidor via sharp), e
// persistida na mesma tabela que a área do próprio paciente usa
// (catalog_patient_display_images) — gerar aqui ou lá reaproveita o mesmo
// resultado, nunca duplica.
const ANALYSIS_WORK_WIDTH = 960;

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load-failed'));
    img.src = url;
  });
}

type PhotoAnalysis = { pupilA: Point; pupilB: Point; nasalCenter: Point; photoWidth: number; photoHeight: number };

async function detectPatientPupils(photoUrl: string): Promise<PhotoAnalysis | null> {
  const img = await loadImageElement(photoUrl);
  const canvas = document.createElement('canvas');
  const scale = ANALYSIS_WORK_WIDTH / img.naturalWidth;
  canvas.width = ANALYSIS_WORK_WIDTH;
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { detectFacePoints } = await import('@/lib/dnp-vision');
  const points = await detectFacePoints(canvas);
  if (!points) return null;
  return { pupilA: points.pupilA, pupilB: points.pupilB, nasalCenter: points.nasalCenter, photoWidth: canvas.width, photoHeight: canvas.height };
}

export function FrameStep({ orderId, models, confirmedFrameName, confirmedColor, locked, clientPhotoUrl, dnpTotalMm }: {
  orderId: string;
  models: ArmacaoModel[];
  confirmedFrameName: string | null;
  confirmedColor: string | null;
  locked: boolean;
  /** Foto oficial de prova online do paciente (já validada na Etapa 1) — null
   * se ainda não houver, o que desabilita a geração automática da prova aqui. */
  clientPhotoUrl: string | null;
  /** DNP total (OD+OE) do paciente, em mm — null se ainda não medida. */
  dnpTotalMm: number | null;
}) {
  const router = useRouter();
  const [activeColorByModel, setActiveColorByModel] = useState<Record<string, string>>(
    Object.fromEntries(models.map((m) => [m.id, m.colors.find((c) => c.confirmed)?.id || m.colors[0]?.id || '']))
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  // Foto e DNP não mudam durante a vida deste componente — a detecção de
  // pupilas (custosa, roda o MediaPipe) é cacheada uma única vez por sessão,
  // mesmo que várias linhas de modelo precisem dela.
  const analysisCache = useRef<{ url: string; analysis: PhotoAnalysis } | null>(null);
  const [generatedProva, setGeneratedProva] = useState<Record<string, string>>({});
  const [provaStatus, setProvaStatus] = useState<Record<string, 'idle' | 'loading' | 'error'>>({});
  const [provaMessage, setProvaMessage] = useState<Record<string, string>>({});

  function activeColorOf(model: ArmacaoModel): ColorOption | undefined {
    const activeId = activeColorByModel[model.id];
    return model.colors.find((c) => c.id === activeId) || model.colors[0];
  }

  async function getAnalysis(): Promise<PhotoAnalysis | null> {
    if (!clientPhotoUrl) return null;
    if (analysisCache.current?.url === clientPhotoUrl) return analysisCache.current.analysis;
    const analysis = await detectPatientPupils(clientPhotoUrl);
    if (analysis) analysisCache.current = { url: clientPhotoUrl, analysis };
    return analysis;
  }

  async function generateProva(color: ColorOption) {
    if (!clientPhotoUrl || !dnpTotalMm) return;
    if (provaStatus[color.id] === 'loading') return;
    setProvaStatus((s) => ({ ...s, [color.id]: 'loading' }));
    setProvaMessage((s) => ({ ...s, [color.id]: '' }));
    try {
      const analysis = await getAnalysis();
      if (!analysis) {
        setProvaStatus((s) => ({ ...s, [color.id]: 'error' }));
        setProvaMessage((s) => ({ ...s, [color.id]: 'Não identificamos o rosto do paciente nesta foto.' }));
        return;
      }
      const response = await fetch(`/api/professional/orders/${orderId}/client/tryon-compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogColorImageId: color.id, ...analysis })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.imageUrl) {
        setGeneratedProva((s) => ({ ...s, [color.id]: payload.imageUrl }));
        setProvaStatus((s) => ({ ...s, [color.id]: 'idle' }));
      } else {
        setProvaStatus((s) => ({ ...s, [color.id]: 'error' }));
        setProvaMessage((s) => ({ ...s, [color.id]: payload.message || 'Não foi possível gerar a prova.' }));
      }
    } catch {
      setProvaStatus((s) => ({ ...s, [color.id]: 'error' }));
      setProvaMessage((s) => ({ ...s, [color.id]: 'Não foi possível gerar a prova.' }));
    }
  }

  function selectColor(model: ArmacaoModel, color: ColorOption) {
    setActiveColorByModel((prev) => ({ ...prev, [model.id]: color.id }));
    const effectiveProva = generatedProva[color.id] ?? color.provaUrl;
    if (!effectiveProva && provaStatus[color.id] !== 'loading') {
      generateProva(color);
    }
  }

  // Gera também pra cor já ativa de cada modelo ao abrir a tela (sem
  // esperar o profissional trocar de cor pra ver a primeira prova). Disparo
  // adiado pra fora do corpo síncrono do efeito (setState de generateProva
  // não pode rodar direto dentro do efeito — regra react-hooks/set-state-in-effect).
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const model of models) {
        const active = activeColorOf(model);
        if (active && !active.provaUrl) generateProva(active);
      }
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              <div className="frame-row professional-frame-row" key={model.id}>
                <div className="frame-photo-box frame-photo-prova">
                  {(() => {
                    const provaUrl = generatedProva[active.id] ?? active.provaUrl;
                    if (provaUrl) return <img src={provaUrl} alt={`Prova da armação ${model.modelName} no rosto do paciente`} />;
                    if (provaStatus[active.id] === 'loading') return <span>Gerando prova com o rosto do paciente…</span>;
                    if (provaStatus[active.id] === 'error') return <span>{provaMessage[active.id] || 'Não foi possível gerar a prova.'}</span>;
                    if (!clientPhotoUrl) return <span>Foto de rosto do paciente pendente (Etapa 1)</span>;
                    if (!dnpTotalMm) return <span>DNP do paciente pendente (Etapa 1)</span>;
                    return <span>Foto de<br />Prova</span>;
                  })()}
                </div>
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
                          onClick={() => selectColor(model, color)}
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
