'use client';

import { useEffect, useRef, useState } from 'react';

/** Native in-page dialog: no window.open and no popup permission required. */
export function PrescriptionPreview({ url, onClose }: { url: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="prescription-preview" onClose={onClose} aria-labelledby="prescription-preview-title">
    <div className="prescription-preview-toolbar">
      <div><strong id="prescription-preview-title">Visualização da prescrição</strong><p>Use “Imprimir / salvar PDF” no documento.</p></div>
      <button autoFocus type="button" className="button secondary" onClick={() => dialog.current?.close()}>Fechar</button>
    </div>
    {!loaded && <p role="status">Carregando prescrição…</p>}
    <iframe src={`${url}?preview=1`} title="Receita de grau — visualização para impressão" onLoad={() => setLoaded(true)} />
    <a href={url} target="_blank" rel="noopener noreferrer">Abrir documento em outra aba</a>
  </dialog>;
}
