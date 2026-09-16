'use client';

import { useState, type ReactNode } from 'react';

export function FrameGallery({ images, modelName }: { images: string[]; modelName: string }) {
  const [index, setIndex] = useState(0);
  const active = Math.min(index, Math.max(0, images.length - 1));
  return <div className="frame-gallery" role="group" aria-label={`Fotos de ${modelName}`}>
    <div className="frame-photo-box frame-photo-oculos">
      {images[active] ? <img src={images[active]} alt={`${modelName} — foto ${active + 1} de ${images.length}`} /> : <span>Foto dos óculos ainda não disponível</span>}
    </div>
    {images.length > 1 && <div className="frame-gallery-pagination">
      <button type="button" aria-label="Foto anterior" onClick={() => setIndex((active + images.length - 1) % images.length)}>‹</button>
      {images.map((url, i) => <button key={`${url}-${i}`} type="button" className="frame-gallery-dot" aria-label={`Ver foto ${i + 1} de ${images.length}`} aria-pressed={active === i} onClick={() => setIndex(i)}><span /></button>)}
      <button type="button" aria-label="Próxima foto" onClick={() => setIndex((active + 1) % images.length)}>›</button>
    </div>}
  </div>;
}

export function FrameProof({ measurementsUrl, modelName, proofUrl, generating, children }: {
  measurementsUrl?: string | null; modelName: string; proofUrl: string | null; generating: boolean; children: ReactNode;
}) {
  const [showMeasures, setShowMeasures] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const waiting = generating || Boolean(proofUrl && !ready && !failed);
  const measuresVisible = Boolean(measurementsUrl && (waiting || (ready && showMeasures)));
  return <div className={`frame-photo-box frame-photo-prova frame-proof-toggle${measuresVisible ? ' show-measures' : ''}`}>
    <button type="button" aria-label={measuresVisible ? 'Medidas do modelo — toque para voltar à prova' : 'Ver medidas do modelo'} aria-pressed={measuresVisible}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse' && ready) setShowMeasures(true); }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setShowMeasures(false); }}
      onPointerUp={(event) => { if (event.pointerType !== 'mouse' && ready) setShowMeasures(value => !value); }}
      onClick={(event) => { if (event.detail === 0 && ready) setShowMeasures(value => !value); }}>
      <span className="frame-proof-result">
        {proofUrl && !failed ? <img src={proofUrl} alt={`Prova da armação ${modelName} no rosto do paciente`}
          onLoad={() => { setReady(true); setShowMeasures(false); }} onError={() => { setFailed(true); setReady(false); }} />
          : failed ? <span>Não foi possível carregar a prova. Atualize a página para tentar novamente.</span> : children}
      </span>
      {measurementsUrl && <img className="frame-measurements-image" src={measurementsUrl} alt={`Medidas de ${modelName}`} />}
      {waiting ? <span className="frame-measurements-hint" role="status">Preparando prova online…</span>
        : ready && measurementsUrl ? <span className="frame-measurements-hint">{showMeasures ? 'Retire o mouse ou toque para voltar à prova' : 'Passe o mouse ou toque para ver medidas'}</span> : null}
    </button>
  </div>;
}
