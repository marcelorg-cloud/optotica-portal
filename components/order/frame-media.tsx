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

export function FrameProof({ measurementsUrl, modelName, hasProof, children }: {
  measurementsUrl?: string | null; modelName: string; hasProof: boolean; children: ReactNode;
}) {
  const [showMeasures, setShowMeasures] = useState(false);
  if (!measurementsUrl) return <div className="frame-photo-box frame-photo-prova">{children}</div>;
  return <div className={`frame-photo-box frame-photo-prova frame-proof-toggle${!hasProof || showMeasures ? ' show-measures' : ''}`}>
    <button type="button" aria-label={showMeasures ? 'Voltar à prova da armação' : 'Ver medidas do modelo'} aria-pressed={showMeasures} onClick={() => setShowMeasures((value) => !value)}>
      <span className="frame-proof-result">{children}</span>
      <img className="frame-measurements-image" src={measurementsUrl} alt={`Medidas de ${modelName}`} />
      <span className="frame-measurements-hint">{!hasProof ? children : showMeasures ? 'Toque para voltar à prova' : 'Passe o mouse ou toque para ver medidas'}</span>
    </button>
  </div>;
}
